//! MySword `.bbl.mybible` / `.dct.mybible` reader and MyBible export.

use super::{file_name, quote_ident, set_delete_journal, value_to_string, ConvertError};
use graphe_domain::books::{tw_book_to_graphe, BOOK_NAMES, GRAPHE_BOOK_NUMBERS};
use graphe_domain::tags::{normalize_strong_number, sanitize_strong_tags, sanitize_supported_tags};
use regex::{Captures, Regex};
use rusqlite::{params, Connection};
use std::collections::{BTreeSet, HashMap};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

#[derive(Debug)]
pub(super) struct MySwordModule {
    conn: Connection,
    pub kind: &'static str,
    pub details: HashMap<String, rusqlite::types::Value>,
    pub bible_table: String,
    pub scripture_col: String,
    pub has_strongs: bool,
    pub dict_table_name: String,
    pub has_lexeme: bool,
    pub has_relative_order: bool,
    pub is_strong: bool,
}

pub(super) fn load(path: &Path) -> Option<MySwordModule> {
    try_load(path).ok().flatten()
}

fn try_load(path: &Path) -> Result<Option<MySwordModule>, ConvertError> {
    let conn = match Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY) {
        Ok(conn) => conn,
        Err(_) => return Ok(None),
    };
    let tables = match table_names(&conn) {
        Ok(tables) => tables,
        Err(_) => return Ok(None),
    };
    let details_table = tables
        .iter()
        .find(|name| name.eq_ignore_ascii_case("details"))
        .cloned();
    let details = match details_table {
        Some(table) => read_details(&conn, &table).unwrap_or_default(),
        None => HashMap::new(),
    };
    if tables.iter().any(|name| name.eq_ignore_ascii_case("bible")) {
        let bible_table = tables
            .iter()
            .find(|name| name.eq_ignore_ascii_case("bible"))
            .cloned()
            .unwrap_or_else(|| "Bible".to_string());
        let scripture_col = detect_scripture_column(&conn, &bible_table)
            .unwrap_or_else(|_| "Scripture".to_string());
        let has_strongs = detect_strongs(&conn, &bible_table, &scripture_col).unwrap_or(false);
        return Ok(Some(MySwordModule {
            conn,
            kind: "bible",
            details,
            bible_table,
            scripture_col,
            has_strongs,
            dict_table_name: String::new(),
            has_lexeme: false,
            has_relative_order: false,
            is_strong: false,
        }));
    }
    if tables
        .iter()
        .any(|name| name.eq_ignore_ascii_case("dictionary"))
    {
        let dict_table = tables
            .iter()
            .find(|name| name.eq_ignore_ascii_case("dictionary"))
            .cloned()
            .unwrap_or_else(|| "Dictionary".to_string());
        let columns = pragma_columns(&conn, &dict_table).unwrap_or_default();
        let has_lexeme = columns
            .iter()
            .any(|name| name.eq_ignore_ascii_case("lexeme"));
        let has_relative_order = columns
            .iter()
            .any(|name| name.eq_ignore_ascii_case("relativeorder"));
        let is_strong = details.get("strong").is_some_and(is_truthy);
        return Ok(Some(MySwordModule {
            conn,
            kind: "dictionary",
            details,
            bible_table: String::new(),
            scripture_col: String::new(),
            has_strongs: false,
            dict_table_name: dict_table,
            has_lexeme,
            has_relative_order,
            is_strong,
        }));
    }
    Ok(None)
}

#[cfg(test)]
pub(super) fn close(_module: MySwordModule) {}

pub(super) fn convert(input: &Path, output_dir: &Path) -> Result<PathBuf, ConvertError> {
    let name = file_name(input).to_lowercase();
    if name.ends_with(".bbl.mybible") {
        convert_bible(input, output_dir)
    } else if name.ends_with(".dct.mybible") {
        convert_dictionary(input, output_dir)
    } else {
        Err(ConvertError(format!(
            "Unsupported MySword format: {}",
            file_name(input)
        )))
    }
}

pub(super) fn convert_mysword_tags(text: &str) -> String {
    if !text.contains('<') && !text.contains('「') && !text.contains('」') && !text.contains('＊')
    {
        return text.to_string();
    }
    let re = ms_re();
    let mut result = text.to_string();
    result = re
        .strong
        .replace_all(&result, |caps: &Captures| {
            let number = normalize_strong_number(caps.get(2).map(|m| m.as_str()));
            if number.is_empty() {
                return String::new();
            }
            let morph = caps.get(3).map(|m| m.as_str()).unwrap_or("");
            let lemma = caps.get(4).map(|m| m.as_str()).unwrap_or("");
            let mut tags = format!("<S>{number}</S>");
            if !morph.is_empty() {
                tags.push_str(&format!("<m>{morph}</m>"));
            }
            if !lemma.is_empty() {
                tags.push_str(&format!("<l>{lemma}</l>"));
            }
            tags
        })
        .into_owned();
    result = re.footnote.replace_all(&result, "<f>$1</f>").into_owned();
    result = re.variant.replace_all(&result, "").into_owned();
    result = result.replace('＊', "");
    result = re
        .bracket
        .replace_all(&result, |caps: &Captures| {
            let inner = caps.get(1).map(|m| m.as_str()).unwrap_or("");
            if !re.mn.is_match(inner) {
                return caps.get(0).map(|m| m.as_str()).unwrap_or("").to_string();
            }
            ognte_bracket(inner)
        })
        .into_owned();
    // `regex` has no look-ahead; keep the following <E> and replace only the separator.
    result = re.comma_e.replace_all(&result, " $1").into_owned();
    result = result.replace("<q>", " ").replace("<Q>", "");
    result = re.word_pos.replace_all(&result, "").into_owned();
    result = re.word_pos_close.replace_all(&result, "").into_owned();
    result = convert_section_labels(&result);
    result = re.subtags.replace_all(&result, "").into_owned();
    result = re.br.replace_all(&result, "<pb/>").into_owned();
    result = re
        .na28
        .replace_all(&result, |caps: &Captures| {
            let before = caps.get(1).map(|m| m.as_str()).unwrap_or("");
            let greek = caps.get(2).map(|m| m.as_str()).unwrap_or("");
            let after = caps.get(3).map(|m| m.as_str()).unwrap_or("");
            let combined = format!("{before}{after}");
            let translit = re
                .translit
                .captures(&combined)
                .and_then(|caps| caps.get(1))
                .map(|m| m.as_str())
                .unwrap_or("");
            let mut out = format!("<E>{greek}<e>");
            if !translit.is_empty() {
                out.push_str(&format!("<T>{translit}<t>"));
            }
            out.push(' ');
            out
        })
        .into_owned();
    result = re.greek.replace_all(&result, "<E>$1<e>").into_owned();
    result = result.replace('「', "").replace('」', "");
    result = re.orphan_w.replace_all(&result, "").into_owned();
    result = re.orphan_wt.replace_all(&result, "").into_owned();
    result = sanitize_supported_tags(Some(&result));
    result = sanitize_strong_tags(Some(&result));
    result = re.spaces.replace_all(&result, " ").into_owned();
    result
}

fn ognte_bracket(inner: &str) -> String {
    let greek = extract_field(inner, "Mn");
    let translit = extract_field(inner, "Tr");
    let strongs = ms_re()
        .strongs
        .find(inner)
        .map(|m| m.as_str().to_string())
        .unwrap_or_default();
    let mut parts = Vec::new();
    let pr = extract_field(inner, "Cla");
    if !pr.is_empty() {
        parts.push(format!("pr={pr}"));
    }
    let pbr = extract_field(inner, "Pbr");
    if !pbr.is_empty() {
        parts.push(format!("pbr={pbr}"));
    }
    let es = extract_field(inner, "Es");
    if !es.is_empty() {
        parts.push(format!("es={es}"));
    }
    let og = extract_field(inner, "Og");
    if !og.is_empty() {
        parts.push(format!("og={og}"));
    }
    let ln = extract_ln(inner);
    if !ln.is_empty() {
        parts.push(format!("ln={ln}"));
    }
    let gk = extract_field(inner, "GN");
    if !gk.is_empty() {
        parts.push(format!("gk={gk}"));
    }
    let mut out = String::new();
    if !greek.is_empty() {
        out.push_str(&format!("<E>{greek}<e>"));
    }
    if !translit.is_empty() {
        out.push_str(&format!("<T>{translit}<t>"));
    }
    out.push_str(&strongs);
    if !parts.is_empty() {
        out.push_str(&format!("<X>{}<x>", parts.join("|")));
    }
    out
}

fn extract_field(inner: &str, tag: &str) -> String {
    let pattern = format!(r"(?i)<{tag}>([\s\S]*?)</{tag}>");
    let Ok(re) = Regex::new(&pattern) else {
        return String::new();
    };
    re.captures(inner)
        .and_then(|caps| caps.get(1))
        .map(|m| strip_tags(m.as_str()).trim().to_string())
        .unwrap_or_default()
}

fn extract_ln(inner: &str) -> String {
    ms_re()
        .ln
        .captures(inner)
        .and_then(|caps| caps.get(1))
        .map(|m| {
            strip_tags(m.as_str())
                .replace('，', ", ")
                .trim()
                .to_string()
        })
        .unwrap_or_default()
}

fn strip_tags(text: &str) -> String {
    ms_re().tags.replace_all(text, "").into_owned()
}

fn convert_section_labels(text: &str) -> String {
    let mut result = text.to_string();
    for re in section_regexes() {
        result = re
            .replace_all(&result, |caps: &Captures| {
                let label = caps.get(1).map(|m| m.as_str()).unwrap_or("").trim();
                if label.is_empty() {
                    String::new()
                } else {
                    format!("<h>{label}</h>")
                }
            })
            .into_owned();
    }
    result
}

fn section_regexes() -> &'static [Regex] {
    static RE: OnceLock<Vec<Regex>> = OnceLock::new();
    RE.get_or_init(|| {
        ["HEB", "TRA", "SEP", "ACF", "SBL", "GRC"]
            .into_iter()
            .map(|tag| Regex::new(&format!(r"(?i)<{tag}>([^<]*)</{tag}>")).unwrap())
            .collect()
    })
}

struct MsRegex {
    strong: Regex,
    footnote: Regex,
    variant: Regex,
    bracket: Regex,
    mn: Regex,
    comma_e: Regex,
    word_pos: Regex,
    word_pos_close: Regex,
    subtags: Regex,
    br: Regex,
    na28: Regex,
    translit: Regex,
    greek: Regex,
    orphan_w: Regex,
    orphan_wt: Regex,
    spaces: Regex,
    strongs: Regex,
    ln: Regex,
    tags: Regex,
    sample_strong: Regex,
}

fn ms_re() -> &'static MsRegex {
    static RE: OnceLock<MsRegex> = OnceLock::new();
    RE.get_or_init(|| MsRegex {
        strong: Regex::new(r#"(?i)<W([HG])([0-9]+)>(?:<WT([^ >]*?)(?:\s+l="([^"]*)")?>)?"#)
            .unwrap(),
        footnote: Regex::new(r"(?i)<RF[^>]*>([\s\S]*?)<Rf>").unwrap(),
        variant: Regex::new(r"(?i)＊<Vr>[\s\S]*?</vr>").unwrap(),
        bracket: Regex::new(r"「([\s\S]*?)」").unwrap(),
        mn: Regex::new(r"(?i)<Mn>").unwrap(),
        comma_e: Regex::new(r",&?\s*(<E>)").unwrap(),
        word_pos: Regex::new(r"(?i)<W>[0-9]+<w>").unwrap(),
        word_pos_close: Regex::new(r"(?i)<W>[0-9]+</w>").unwrap(),
        subtags: Regex::new(r"(?i)</?(?:HEB|TRA|SEP|ACF|SBL|GRC|Tr|Cla|Mn|Wn|Ko|LN|GN|Pbr|Es|Og)>")
            .unwrap(),
        br: Regex::new(r"(?i)<br\s*/?>").unwrap(),
        na28: Regex::new(r"「([^」]*?)<G>([\s\S]*?)<g>([^」]*?)」").unwrap(),
        translit: Regex::new(r"(?i)<T>([\s\S]*?)<t>").unwrap(),
        greek: Regex::new(r"(?i)<G>([\s\S]*?)<g>").unwrap(),
        orphan_w: Regex::new(r"(?i)<W[HG][^>]*>").unwrap(),
        orphan_wt: Regex::new(r"(?i)<WT[^>]*>").unwrap(),
        spaces: Regex::new(r" {2,}").unwrap(),
        strongs: Regex::new(r"<S>[0-9]+</S>(?:<m>[^<]*</m>)?(?:<l>[^<]*</l>)?").unwrap(),
        ln: Regex::new(r"(?i)<LN>([\s\S]*?)</LN>").unwrap(),
        tags: Regex::new(r"<[^>]+>").unwrap(),
        sample_strong: Regex::new(r"(?i)<W[HG][0-9]").unwrap(),
    })
}

fn convert_bible(input: &Path, output_dir: &Path) -> Result<PathBuf, ConvertError> {
    let handle = load(input)
        .filter(|module| module.kind == "bible")
        .ok_or_else(|| ConvertError(format!("Cannot load MySword Bible: {}", file_name(input))))?;
    let basename = mysword_basename(input);
    let output = output_dir.join(format!("{basename}.SQLite3"));
    let mut conn = Connection::open(&output)?;
    set_delete_journal(&conn)?;
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS info (name TEXT, value TEXT);
        CREATE TABLE IF NOT EXISTS books (
            book_number INTEGER, book_color TEXT, short_name TEXT, long_name TEXT, sorting_order NUMERIC
        );
        CREATE TABLE IF NOT EXISTS verses (
            book_number INTEGER, chapter INTEGER, verse INTEGER, text TEXT
        );
        CREATE UNIQUE INDEX IF NOT EXISTS verses_index ON verses (book_number, chapter, verse);
        ",
    )?;
    let title = detail_string(&handle, "title");
    let description = detail_string(&handle, "description");
    let abbreviation = detail_string(&handle, "abbreviation");
    let language = detail_string(&handle, "language");
    let display = if !title.is_empty() {
        title.clone()
    } else if !description.is_empty() {
        description.clone()
    } else if !abbreviation.is_empty() {
        abbreviation
    } else {
        basename
    };
    let description_value = if description.is_empty() {
        display
    } else {
        description
    };
    let sql = format!(
        "SELECT Book, Chapter, Verse, {} as text FROM {} ORDER BY Book, Chapter, Verse",
        quote_ident(&handle.scripture_col),
        quote_ident(&handle.bible_table)
    );
    let tx = conn.transaction()?;
    {
        let mut info = tx.prepare("INSERT INTO info (name, value) VALUES (?1, ?2)")?;
        info.execute(params!["description", description_value])?;
        if !title.is_empty() {
            info.execute(params!["short.title", title])?;
        }
        info.execute(params!["language", language])?;
        info.execute(params![
            "strong_numbers",
            if handle.has_strongs { "true" } else { "false" }
        ])?;
        drop(info);
        let mut insert = tx.prepare(
            "INSERT OR REPLACE INTO verses (book_number, chapter, verse, text) VALUES (?1, ?2, ?3, ?4)",
        )?;
        let mut query = handle.conn.prepare(&sql)?;
        let mut rows = query.query([])?;
        let mut inserted = 0usize;
        let mut non_empty = 0usize;
        let mut inserted_books = BTreeSet::new();
        while let Some(row) = rows.next()? {
            let book: i64 = row.get(0)?;
            let chapter: i64 = row.get(1)?;
            let verse: i64 = row.get(2)?;
            let text: Option<String> = row.get(3)?;
            let Some(graphe) = tw_book_to_graphe(book) else {
                continue;
            };
            let converted = convert_mysword_tags(text.as_deref().unwrap_or(""));
            insert.execute(params![graphe as i64, chapter, verse, converted])?;
            inserted += 1;
            if !normalize_verse(&converted).is_empty() {
                non_empty += 1;
            }
            inserted_books.insert(graphe);
        }
        drop(rows);
        drop(query);
        drop(insert);
        if inserted == 0 || non_empty == 0 {
            return Err(ConvertError(format!(
                "MySword module has no non-empty verse text: {}",
                file_name(input)
            )));
        }
        let mut book_stmt = tx.prepare(
            "INSERT INTO books (book_number, book_color, short_name, long_name, sorting_order) VALUES (?1, ?2, ?3, ?4, ?5)",
        )?;
        for book in inserted_books {
            let Some(idx) = GRAPHE_BOOK_NUMBERS
                .iter()
                .position(|number| *number == book)
            else {
                continue;
            };
            book_stmt.execute(params![
                book as i64,
                rusqlite::types::Null,
                BOOK_NAMES[idx].short,
                BOOK_NAMES[idx].long,
                rusqlite::types::Null
            ])?;
        }
    }
    tx.commit()?;
    Ok(output)
}

fn convert_dictionary(input: &Path, output_dir: &Path) -> Result<PathBuf, ConvertError> {
    let handle = load(input)
        .filter(|module| module.kind == "dictionary")
        .ok_or_else(|| {
            ConvertError(format!(
                "Cannot load MySword Dictionary: {}",
                file_name(input)
            ))
        })?;
    let basename = mysword_basename(input);
    let output = output_dir.join(format!("{basename}.dictionary.SQLite3"));
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
    let title = detail_string(&handle, "title");
    let description = detail_string(&handle, "description");
    let language = detail_string(&handle, "language");
    let description_value = if !description.is_empty() {
        description
    } else if !title.is_empty() {
        title
    } else {
        basename
    };
    let select_cols = if handle.has_lexeme {
        "word, data, lexeme"
    } else {
        "word, data"
    };
    let order_col = if handle.has_relative_order {
        "relativeorder"
    } else {
        "rowid"
    };
    let sql = format!(
        "SELECT {select_cols} FROM {} ORDER BY \"{order_col}\"",
        quote_ident(&handle.dict_table_name)
    );
    let tx = conn.transaction()?;
    {
        let mut info = tx.prepare("INSERT INTO info (name, value) VALUES (?1, ?2)")?;
        info.execute(params!["description", description_value])?;
        info.execute(params!["language", language])?;
        info.execute(params![
            "is_strong",
            if handle.is_strong { "true" } else { "false" }
        ])?;
        info.execute(params![
            "type",
            if handle.is_strong {
                "strong lexicon"
            } else {
                "explanatory"
            }
        ])?;
        drop(info);
        let mut insert = tx.prepare(
            "INSERT INTO dictionary (topic, definition, short_definition, lexeme, transliteration, pronunciation) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        )?;
        let mut query = handle.conn.prepare(&sql)?;
        let mut rows = query.query([])?;
        while let Some(row) = rows.next()? {
            let word = value_to_string(row.get(0)?);
            let data_value: rusqlite::types::Value = row.get(1)?;
            if matches!(data_value, rusqlite::types::Value::Null) {
                continue;
            }
            let data = value_to_string(data_value);
            if data.is_empty() {
                continue;
            }
            let lexeme = if handle.has_lexeme {
                let value: rusqlite::types::Value = row.get(2)?;
                let text = value_to_string(value);
                if text.is_empty() {
                    None
                } else {
                    Some(text)
                }
            } else {
                None
            };
            insert.execute(params![
                word,
                data,
                rusqlite::types::Null,
                lexeme,
                rusqlite::types::Null,
                rusqlite::types::Null
            ])?;
        }
    }
    tx.commit()?;
    Ok(output)
}

fn mysword_basename(path: &Path) -> String {
    let name = file_name(path);
    let lower = name.to_lowercase();
    for suffix in [".bbl.mybible", ".dct.mybible"] {
        if lower.ends_with(suffix) {
            return name[..name.len() - suffix.len()].to_string();
        }
    }
    super::file_stem(path)
}

fn detail_string(module: &MySwordModule, key: &str) -> String {
    module
        .details
        .get(key)
        .map(|value| value_to_string(value.clone()))
        .unwrap_or_default()
}

fn normalize_verse(text: &str) -> String {
    let cleaned = text.replace('\r', "").replace('\u{00a0}', " ");
    ms_re().tags.replace_all(&cleaned, " ").trim().to_string()
}

fn is_truthy(value: &rusqlite::types::Value) -> bool {
    use rusqlite::types::Value;
    match value {
        Value::Null => false,
        Value::Integer(0) => false,
        Value::Integer(_) => true,
        Value::Real(number) if *number == 0.0 => false,
        Value::Real(_) => true,
        Value::Text(text) => !text.is_empty(),
        Value::Blob(bytes) => !bytes.is_empty(),
    }
}

fn table_names(conn: &Connection) -> Result<Vec<String>, ConvertError> {
    let mut stmt = conn.prepare("SELECT name FROM sqlite_master WHERE type='table'")?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(ConvertError::from)
}

fn read_details(
    conn: &Connection,
    table: &str,
) -> Result<HashMap<String, rusqlite::types::Value>, ConvertError> {
    let sql = format!("SELECT * FROM {} LIMIT 1", quote_ident(table));
    let mut stmt = conn.prepare(&sql)?;
    let names = (0..stmt.column_count())
        .map(|index| Ok(stmt.column_name(index)?.to_lowercase()))
        .collect::<Result<Vec<_>, rusqlite::Error>>()?;
    let mut rows = stmt.query([])?;
    let Some(row) = rows.next()? else {
        return Ok(HashMap::new());
    };
    let mut details = HashMap::new();
    for (index, name) in names.into_iter().enumerate() {
        details.insert(name, row.get(index)?);
    }
    Ok(details)
}

fn pragma_columns(conn: &Connection, table: &str) -> Result<Vec<String>, ConvertError> {
    let sql = format!("PRAGMA table_info({})", quote_ident(table));
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(1))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(ConvertError::from)
}

fn detect_scripture_column(conn: &Connection, table: &str) -> Result<String, ConvertError> {
    let columns = pragma_columns(conn, table)?;
    Ok(columns
        .into_iter()
        .find(|name| name.eq_ignore_ascii_case("scripture"))
        .unwrap_or_else(|| "Scripture".to_string()))
}

fn detect_strongs(conn: &Connection, table: &str, column: &str) -> Result<bool, ConvertError> {
    let sql = format!(
        "SELECT {} as text FROM {} WHERE {} IS NOT NULL LIMIT 200",
        quote_ident(column),
        quote_ident(table),
        quote_ident(column)
    );
    let mut stmt = conn.prepare(&sql)?;
    let mut rows = stmt.query([])?;
    while let Some(row) = rows.next()? {
        let text: Option<String> = row.get(0)?;
        if ms_re()
            .sample_strong
            .is_match(text.as_deref().unwrap_or(""))
        {
            return Ok(true);
        }
    }
    Ok(false)
}

#[cfg(test)]
#[path = "mysword_tests.rs"]
mod tests;
