//! TheWord .twm commentary and dictionary provider, plus MyBible export.

#[path = "twm_scan.rs"]
mod scan;

use super::rtf::convert_rtf_to_html;
use super::{file_name, file_stem, set_delete_journal, value_to_string, ConvertError};
#[cfg(test)]
use graphe_domain::books::graphe_to_tw_book;
use graphe_domain::books::tw_book_to_graphe;
#[cfg(test)]
use graphe_domain::model::CommentaryEntry;
use rusqlite::{params, Connection, OptionalExtension};
use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};

pub(super) struct TwmInfo {
    #[allow(dead_code)]
    pub kind: &'static str,
    pub description: String,
    pub is_strong_dict: bool,
    pub language: Option<String>,
}

#[derive(Debug)]
#[cfg(test)]
pub(super) struct DictionaryEntry {
    pub topic: String,
    pub definition: String,
}

#[derive(Debug)]
pub(super) struct TwmModule {
    #[allow(dead_code)]
    pub format: &'static str,
    pub file_path: PathBuf,
    conn: Connection,
    pub config: HashMap<String, String>,
    pub has_content_search: bool,
    pub topic_based: bool,
    pub is_dictionary: bool,
    pub topic_book_map: BTreeMap<u16, Vec<i64>>,
    compressed: bool,
}

pub(super) fn load(path: &Path) -> Option<TwmModule> {
    let conn =
        Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).ok()?;
    let tables = table_names(&conn).ok()?;
    let has = |name: &str| tables.iter().any(|table| table == name);
    if !has("config") || !has("content") {
        return None;
    }
    let config = read_config(&conn).ok()?;
    let has_content_search = has("content_search");
    let compressed = config
        .get("compressed")
        .is_some_and(|value| value.trim() == "1");
    if has("bible_refs") {
        return Some(TwmModule {
            format: "theword-twm",
            file_path: path.to_path_buf(),
            conn,
            config,
            has_content_search,
            topic_based: false,
            is_dictionary: false,
            topic_book_map: BTreeMap::new(),
            compressed,
        });
    }
    if has("topics") && has_content_search {
        let is_dictionary = config.get("type").is_some_and(|kind| kind == "1");
        let topic_book_map = if is_dictionary {
            BTreeMap::new()
        } else {
            scan::build_topic_book_map(&conn).ok()?
        };
        return Some(TwmModule {
            format: "theword-twm",
            file_path: path.to_path_buf(),
            conn,
            config,
            has_content_search: true,
            topic_based: !is_dictionary,
            is_dictionary,
            topic_book_map,
            compressed,
        });
    }
    None
}

pub(super) fn get_module_info(handle: &TwmModule) -> TwmInfo {
    let module_type = handle.config.get("type").map(String::as_str).unwrap_or("");
    let description = handle
        .config
        .get("title")
        .filter(|value| !value.is_empty())
        .or_else(|| {
            handle
                .config
                .get("description")
                .filter(|value| !value.is_empty())
        })
        .cloned()
        .unwrap_or_else(|| file_stem(&handle.file_path));
    if module_type == "1" || handle.is_dictionary {
        let is_strong = ["strong", "strong.h", "strong.g"]
            .iter()
            .any(|key| handle.config.get(*key).is_some_and(|value| value == "1"));
        return TwmInfo {
            kind: "dictionary",
            description,
            is_strong_dict: is_strong,
            language: handle
                .config
                .get("lang")
                .filter(|value| !value.is_empty())
                .cloned(),
        };
    }
    TwmInfo {
        kind: "commentary",
        description,
        is_strong_dict: false,
        language: None,
    }
}

#[cfg(test)]
pub(super) fn get_commentary(
    handle: &TwmModule,
    book_number: i64,
    chapter: i64,
) -> Result<Vec<CommentaryEntry>, ConvertError> {
    if handle.topic_based {
        let Some(book) = u16::try_from(book_number).ok() else {
            return Ok(Vec::new());
        };
        let Some(topic_ids) = handle.topic_book_map.get(&book) else {
            return Ok(Vec::new());
        };
        let texts: Vec<String> = topic_ids
            .iter()
            .filter_map(|id| extract_plain_text(handle, *id))
            .collect();
        if texts.is_empty() {
            return Ok(Vec::new());
        }
        return Ok(vec![CommentaryEntry {
            verse_from: 1,
            verse_to: None,
            chapter_to: None,
            text: texts.join("\n"),
        }]);
    }
    let bi = graphe_to_tw_book(book_number);
    if bi < 0 {
        return Ok(Vec::new());
    }
    let mut stmt = handle.conn.prepare(
        "SELECT topic_id, fvi, tvi FROM bible_refs WHERE bi = ?1 AND ci = ?2 ORDER BY fvi",
    )?;
    let rows = stmt.query_map(params![bi, chapter], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, i64>(1)?,
            row.get::<_, Option<i64>>(2)?,
        ))
    })?;
    let mut entries = Vec::new();
    for row in rows {
        let (topic_id, verse_from, verse_to) = row?;
        let text = commentary_body(handle, topic_id);
        if text.is_empty() {
            continue;
        }
        entries.push(CommentaryEntry {
            verse_from,
            verse_to,
            chapter_to: None,
            text,
        });
    }
    Ok(entries)
}

#[cfg(test)]
pub(super) fn get_commentary_books(handle: &TwmModule) -> Result<Vec<u16>, ConvertError> {
    if handle.topic_based {
        return Ok(handle.topic_book_map.keys().copied().collect());
    }
    let mut stmt = handle
        .conn
        .prepare("SELECT DISTINCT bi FROM bible_refs WHERE ci > 0 ORDER BY bi")?;
    let rows = stmt.query_map([], |row| row.get::<_, i64>(0))?;
    let mut books = Vec::new();
    for bi in rows {
        if let Some(book) = tw_book_to_graphe(bi?) {
            books.push(book);
        }
    }
    Ok(books)
}

#[cfg(test)]
pub(super) fn get_dictionary_entry(handle: &TwmModule, topic: &str) -> Option<DictionaryEntry> {
    let id = handle
        .conn
        .query_row("SELECT id FROM topics WHERE subject = ?1", [topic], |row| {
            row.get::<_, i64>(0)
        })
        .optional()
        .ok()
        .flatten()?;
    let definition = extract_plain_text(handle, id)?;
    Some(DictionaryEntry {
        topic: topic.to_string(),
        definition,
    })
}

#[cfg(test)]
pub(super) fn search_dictionary_topics(
    handle: &TwmModule,
    prefix: &str,
    limit: Option<i64>,
) -> Vec<String> {
    let limit = limit.unwrap_or(20);
    let pattern = format!("{prefix}%");
    let mut stmt = match handle.conn.prepare(
        "SELECT subject AS topic FROM topics WHERE pid = 0 AND subject LIKE ?1 ORDER BY subject LIMIT ?2",
    ) {
        Ok(stmt) => stmt,
        Err(_) => return Vec::new(),
    };
    stmt.query_map(params![pattern, limit], |row| row.get::<_, String>(0))
        .ok()
        .map(|rows| rows.filter_map(Result::ok).collect())
        .unwrap_or_default()
}

#[cfg(test)]
pub(super) fn has_dictionary_table(handle: &TwmModule) -> bool {
    handle.is_dictionary
}

#[cfg(test)]
pub(super) fn is_valid_file(path: &Path) -> bool {
    if super::dotted_extension(path) != ".twm" {
        return false;
    }
    let Ok(conn) = Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
    else {
        return false;
    };
    let Ok(tables) = table_names(&conn) else {
        return false;
    };
    let has = |name: &str| tables.iter().any(|table| table == name);
    has("config")
        && has("content")
        && (has("bible_refs") || (has("topics") && has("content_search")))
}

#[cfg(test)]
pub(super) fn close(_handle: TwmModule) {}

pub(super) fn extract_plain_text(handle: &TwmModule, topic_id: i64) -> Option<String> {
    if !handle.has_content_search {
        return None;
    }
    let blob: Option<Vec<u8>> = handle
        .conn
        .query_row(
            "SELECT CAST(data AS BLOB) AS data FROM content_search WHERE topic_id = ?1",
            [topic_id],
            |row| row.get::<_, Option<Vec<u8>>>(0),
        )
        .optional()
        .ok()
        .flatten()
        .flatten();
    let blob = blob?;
    if blob.is_empty() {
        return None;
    }
    let text = scan::decode_content_search_blob(&blob, handle.compressed);
    if text.trim().is_empty() {
        return None;
    }
    let html = text
        .split('\n')
        .map(|line| line.trim_end_matches('\r'))
        .filter(|line| !line.trim().is_empty())
        .map(|line| format!("<p>{}</p>", scan::escape_html(line)))
        .collect::<Vec<_>>()
        .join("\n");
    if html.trim().is_empty() {
        None
    } else {
        Some(html)
    }
}

pub(super) fn convert_twm(input: &Path, output_dir: &Path) -> Result<PathBuf, ConvertError> {
    let handle = load(input)
        .ok_or_else(|| ConvertError(format!("Cannot load TWM module: {}", file_name(input))))?;
    if handle
        .config
        .get("secure")
        .is_some_and(|value| value == "1")
    {
        return Err(ConvertError(format!(
            "Encrypted TheWord TWM module: {}",
            file_name(input)
        )));
    }
    if handle.is_dictionary {
        convert_dictionary(&handle, input, output_dir)
    } else if handle.topic_based {
        convert_commentary_type3(&handle, input, output_dir)
    } else {
        convert_commentary_type2(&handle, input, output_dir)
    }
}

fn convert_commentary_type2(
    handle: &TwmModule,
    input: &Path,
    output_dir: &Path,
) -> Result<PathBuf, ConvertError> {
    let output = output_dir.join(format!("{}.commentaries.SQLite3", file_stem(input)));
    let mut conn = Connection::open(&output)?;
    prepare_commentary_db(&conn)?;
    let info = get_module_info(handle);
    let mut stmt = handle
        .conn
        .prepare("SELECT topic_id, bi, ci, fvi, tvi FROM bible_refs ORDER BY bi, ci, fvi")?;
    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, i64>(1)?,
            row.get::<_, i64>(2)?,
            row.get::<_, i64>(3)?,
            row.get::<_, Option<i64>>(4)?,
        ))
    })?;
    let mut batch = Vec::new();
    let mut books = Vec::new();
    for row in rows {
        let (topic_id, bi, chapter_from, verse_from, verse_to) = row?;
        let Some(book) = tw_book_to_graphe(bi) else {
            continue;
        };
        let text = commentary_body(handle, topic_id);
        if text.is_empty() {
            continue;
        }
        if !books.contains(&book) {
            books.push(book);
        }
        batch.push((book, chapter_from, verse_from, verse_to, text));
    }
    drop(stmt);
    let tx = conn.transaction()?;
    write_commentary_info(
        &tx,
        &info,
        handle.config.get("lang").map(String::as_str).unwrap_or(""),
    )?;
    insert_commentary_rows(&tx, &books, &batch)?;
    tx.commit()?;
    Ok(output)
}

fn convert_commentary_type3(
    handle: &TwmModule,
    input: &Path,
    output_dir: &Path,
) -> Result<PathBuf, ConvertError> {
    let output = output_dir.join(format!("{}.commentaries.SQLite3", file_stem(input)));
    let mut conn = Connection::open(&output)?;
    prepare_commentary_db(&conn)?;
    let info = get_module_info(handle);
    let mut books = Vec::new();
    let mut batch = Vec::new();
    for (book, topic_ids) in &handle.topic_book_map {
        let texts: Vec<String> = topic_ids
            .iter()
            .filter_map(|id| extract_plain_text(handle, *id))
            .collect();
        if texts.is_empty() {
            continue;
        }
        books.push(*book);
        batch.push((*book, 1, 1, None, texts.join("\n")));
    }
    let tx = conn.transaction()?;
    write_commentary_info(
        &tx,
        &info,
        handle.config.get("lang").map(String::as_str).unwrap_or(""),
    )?;
    insert_commentary_rows(&tx, &books, &batch)?;
    tx.commit()?;
    Ok(output)
}

fn convert_dictionary(
    handle: &TwmModule,
    input: &Path,
    output_dir: &Path,
) -> Result<PathBuf, ConvertError> {
    let output = output_dir.join(format!("{}.dictionary.SQLite3", file_stem(input)));
    let mut conn = Connection::open(&output)?;
    set_delete_journal(&conn)?;
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS info (name TEXT, value TEXT);
        CREATE TABLE IF NOT EXISTS dictionary (
            topic TEXT, definition TEXT NOT NULL,
            short_definition TEXT, lexeme TEXT, transliteration TEXT, pronunciation TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_dictionary ON dictionary (topic);
        ",
    )?;
    let info = get_module_info(handle);
    let mut stmt = handle
        .conn
        .prepare("SELECT id, subject FROM topics WHERE pid = 0 ORDER BY rel_order")?;
    let topics = stmt.query_map([], |row| {
        Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
    })?;
    let mut entries = Vec::new();
    for topic in topics {
        let (id, subject) = topic?;
        if let Some(definition) = extract_plain_text(handle, id) {
            entries.push((subject, definition));
        }
    }
    drop(stmt);
    let tx = conn.transaction()?;
    {
        let mut info_stmt = tx.prepare("INSERT INTO info (name, value) VALUES (?1, ?2)")?;
        info_stmt.execute(params!["description", info.description])?;
        info_stmt.execute(params!["language", info.language.unwrap_or_default()])?;
        info_stmt.execute(params![
            "is_strong",
            if info.is_strong_dict { "true" } else { "false" }
        ])?;
        info_stmt.execute(params![
            "type",
            if info.is_strong_dict {
                "strong lexicon"
            } else {
                "explanatory"
            }
        ])?;
        drop(info_stmt);
        let mut insert = tx.prepare(
            "INSERT INTO dictionary (topic, definition, short_definition, lexeme, transliteration, pronunciation) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        )?;
        for (topic, definition) in entries {
            insert.execute(params![
                topic,
                definition,
                rusqlite::types::Null,
                rusqlite::types::Null,
                rusqlite::types::Null,
                rusqlite::types::Null
            ])?;
        }
    }
    tx.commit()?;
    Ok(output)
}

fn prepare_commentary_db(conn: &Connection) -> Result<(), ConvertError> {
    set_delete_journal(conn)?;
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS info (name TEXT, value TEXT);
        CREATE TABLE IF NOT EXISTS books (book_number INTEGER, short_name TEXT, long_name TEXT);
        CREATE TABLE IF NOT EXISTS commentaries (
            book_number INTEGER,
            chapter_number_from INTEGER,
            verse_number_from INTEGER,
            chapter_number_to INTEGER,
            verse_number_to INTEGER,
            is_preceding INTEGER,
            marker TEXT,
            text TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_commentaries ON commentaries (book_number, chapter_number_from);
        ",
    )?;
    Ok(())
}

fn write_commentary_info(
    tx: &rusqlite::Transaction<'_>,
    info: &TwmInfo,
    language: &str,
) -> Result<(), ConvertError> {
    let mut stmt = tx.prepare("INSERT INTO info (name, value) VALUES (?1, ?2)")?;
    stmt.execute(params!["description", info.description])?;
    stmt.execute(params!["language", language])?;
    Ok(())
}

fn insert_commentary_rows(
    tx: &rusqlite::Transaction<'_>,
    books: &[u16],
    rows: &[(u16, i64, i64, Option<i64>, String)],
) -> Result<(), ConvertError> {
    let mut book_stmt =
        tx.prepare("INSERT INTO books (book_number, short_name, long_name) VALUES (?1, ?2, ?3)")?;
    for book in books {
        book_stmt.execute(params![
            *book as i64,
            rusqlite::types::Null,
            rusqlite::types::Null
        ])?;
    }
    drop(book_stmt);
    let mut insert = tx.prepare(
        "INSERT INTO commentaries (book_number, chapter_number_from, verse_number_from, chapter_number_to, verse_number_to, is_preceding, marker, text) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
    )?;
    for (book, chapter_from, verse_from, verse_to, text) in rows {
        insert.execute(params![
            *book as i64,
            chapter_from,
            verse_from,
            rusqlite::types::Null,
            verse_to,
            rusqlite::types::Null,
            rusqlite::types::Null,
            text
        ])?;
    }
    Ok(())
}

fn commentary_body(handle: &TwmModule, topic_id: i64) -> String {
    let Some(data) = read_content_string(&handle.conn, topic_id) else {
        return String::new();
    };
    if data.is_empty() {
        return String::new();
    }
    let config_rtf = handle
        .config
        .get("content.type")
        .is_some_and(|value| value.eq_ignore_ascii_case("rtf"));
    let is_rtf = config_rtf || data.starts_with("{\\rtf");
    if is_rtf {
        if let Ok(html) = convert_rtf_to_html(&data) {
            if !html.trim().is_empty() {
                return html;
            }
        }
        if let Some(plain) = extract_plain_text(handle, topic_id) {
            return plain;
        }
        return scan::escape_html(&data);
    }
    if let Some(plain) = extract_plain_text(handle, topic_id) {
        return plain;
    }
    if data.trim().is_empty() {
        return String::new();
    }
    let wrapped = format!("{{\\rtf1\\ansi\\deff0 {data}}}");
    if let Ok(html) = convert_rtf_to_html(&wrapped) {
        if !html.trim().is_empty() {
            return html;
        }
    }
    scan::escape_html(&data)
}

fn read_content_string(conn: &Connection, topic_id: i64) -> Option<String> {
    let value: rusqlite::types::Value = conn
        .query_row(
            "SELECT data FROM content WHERE topic_id = ?1",
            [topic_id],
            |row| row.get(0),
        )
        .optional()
        .ok()
        .flatten()?;
    if matches!(value, rusqlite::types::Value::Null) {
        return None;
    }
    Some(value_to_string(value))
}

fn table_names(conn: &Connection) -> Result<Vec<String>, ConvertError> {
    let mut stmt = conn.prepare("SELECT name FROM sqlite_master WHERE type='table'")?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(ConvertError::from)
}

fn read_config(conn: &Connection) -> Result<HashMap<String, String>, ConvertError> {
    let mut stmt = conn.prepare("SELECT name, value FROM config")?;
    let rows = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, value_to_string(row.get(1)?)))
    })?;
    let mut config = HashMap::new();
    for row in rows {
        let (name, value) = row?;
        config.insert(name, value);
    }
    Ok(config)
}

#[cfg(test)]
#[path = "twm_tests.rs"]
mod tests;
