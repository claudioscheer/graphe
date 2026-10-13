//! MyBible SQLite reads and edits. Search parsing lives in `graphe-domain`.

use graphe_domain::model::{BookRecord, CommentaryEntry, VerseRecord};
use graphe_domain::morphology::{IndicationRow, MorphTables};
use graphe_domain::search::{matches_parsed_search, parse_search_query, SearchHit};
use rusqlite::{Connection, OptionalExtension, Row};
use std::collections::BTreeMap;
use std::path::Path;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BookRow {
    pub book_number: i64,
    pub short_name: Option<String>,
    pub long_name: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EditableBook {
    pub book_number: i64,
    pub short_name: Option<String>,
    pub long_name: Option<String>,
    pub title: Option<String>,
    pub is_present: i64,
    pub source_table: &'static str,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InfoUpdate {
    pub updated: bool,
    pub inserted: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TableAvailability {
    pub info: bool,
    pub books: bool,
    pub books_all: bool,
    pub verses: bool,
    pub commentaries: bool,
}

pub fn table_exists(db: &Connection, name: &str) -> bool {
    db.query_row(
        "SELECT name FROM sqlite_master WHERE type='table' AND name = ?1",
        [name],
        |_| Ok(()),
    )
    .optional()
    .ok()
    .flatten()
    .is_some()
}

pub fn detect_type(db: &Connection) -> &'static str {
    if table_exists(db, "commentaries") {
        "commentary"
    } else if table_exists(db, "dictionary") {
        "dictionary"
    } else if table_exists(db, "cross_references") {
        "crossreference"
    } else {
        "bible"
    }
}

pub fn is_valid_module(path: &Path) -> bool {
    let Ok(db) = Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
    else {
        return false;
    };
    ["verses", "dictionary", "commentaries", "cross_references"]
        .iter()
        .any(|name| table_exists(&db, name))
}

pub fn get_books(db: &Connection) -> Vec<BookRow> {
    if let Ok(rows) = query_books(
        db,
        "SELECT book_number, short_name, long_name FROM books_all WHERE is_present = 1 ORDER BY book_number",
    ) {
        if !rows.is_empty() {
            return rows;
        }
    }
    if let Ok(rows) = query_books(
        db,
        "SELECT book_number, short_name, long_name FROM books ORDER BY book_number",
    ) {
        if !rows.is_empty() {
            return rows;
        }
    }
    let mut stmt =
        match db.prepare("SELECT DISTINCT book_number FROM commentaries ORDER BY book_number") {
            Ok(stmt) => stmt,
            Err(_) => return Vec::new(),
        };
    stmt.query_map([], |row| {
        Ok(BookRow {
            book_number: row.get(0)?,
            short_name: None,
            long_name: None,
        })
    })
    .ok()
    .map(|rows| rows.filter_map(Result::ok).collect())
    .unwrap_or_default()
}

fn query_books(db: &Connection, sql: &str) -> rusqlite::Result<Vec<BookRow>> {
    let mut stmt = db.prepare(sql)?;
    let rows = stmt.query_map([], |row| {
        Ok(BookRow {
            book_number: row.get(0)?,
            short_name: row.get(1)?,
            long_name: row.get(2)?,
        })
    })?;
    rows.collect()
}

pub fn commentary_in_file(path: &Path, book_number: i64, chapter: i64) -> Vec<CommentaryEntry> {
    let Ok(db) = Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
    else {
        return Vec::new();
    };
    get_commentary(&db, book_number, chapter)
}

pub fn chapter_in_file(path: &Path, book_number: i64, chapter: i64) -> Vec<VerseRecord> {
    let Ok(db) = Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
    else {
        return Vec::new();
    };
    get_chapter(&db, book_number, chapter)
}

pub fn search_in_file(path: &Path, query: &str, limit: Option<f64>) -> Vec<SearchHit> {
    let Ok(db) = Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
    else {
        return Vec::new();
    };
    lexical_search(&db, query, limit).unwrap_or_default()
}

pub fn get_chapter(db: &Connection, book_number: i64, chapter: i64) -> Vec<VerseRecord> {
    let mut stmt = match db.prepare(
        "SELECT verse, text FROM verses WHERE book_number = ?1 AND chapter = ?2 ORDER BY verse",
    ) {
        Ok(stmt) => stmt,
        Err(_) => return Vec::new(),
    };
    stmt.query_map(rusqlite::params![book_number, chapter], |row| {
        Ok(VerseRecord {
            verse: row.get(0)?,
            text: row.get(1)?,
        })
    })
    .ok()
    .map(|rows| rows.filter_map(Result::ok).collect())
    .unwrap_or_default()
}

pub fn get_chapter_count(db: &Connection, book_number: i64) -> i64 {
    db.query_row(
        "SELECT MAX(chapter) FROM verses WHERE book_number = ?1",
        [book_number],
        |row| row.get::<_, Option<i64>>(0),
    )
    .ok()
    .flatten()
    .unwrap_or(0)
}

pub fn get_commentary(db: &Connection, book_number: i64, chapter: i64) -> Vec<CommentaryEntry> {
    let mut stmt = match db.prepare(
        "SELECT verse_number_from, verse_number_to, chapter_number_to, text FROM commentaries WHERE book_number = ?1 AND chapter_number_from = ?2 ORDER BY verse_number_from",
    ) {
        Ok(stmt) => stmt,
        Err(_) => return Vec::new(),
    };
    stmt.query_map(rusqlite::params![book_number, chapter], |row| {
        Ok(CommentaryEntry {
            verse_from: row.get(0)?,
            verse_to: row.get(1)?,
            chapter_to: row.get(2)?,
            text: row.get(3)?,
        })
    })
    .ok()
    .map(|rows| rows.filter_map(Result::ok).collect())
    .unwrap_or_default()
}

pub fn get_commentary_books(db: &Connection) -> Vec<i64> {
    let mut stmt =
        match db.prepare("SELECT DISTINCT book_number FROM commentaries ORDER BY book_number") {
            Ok(stmt) => stmt,
            Err(_) => return Vec::new(),
        };
    stmt.query_map([], |row| row.get(0))
        .ok()
        .map(|rows| rows.filter_map(Result::ok).collect())
        .unwrap_or_default()
}

pub fn get_commentary_coverage(db: &Connection) -> BTreeMap<i64, Vec<i64>> {
    let mut map = BTreeMap::new();
    let mut stmt = match db.prepare(
        "SELECT book_number, chapter_number_from FROM commentaries GROUP BY book_number, chapter_number_from ORDER BY book_number, chapter_number_from",
    ) {
        Ok(stmt) => stmt,
        Err(_) => return map,
    };
    let rows = stmt.query_map([], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)));
    if let Ok(rows) = rows {
        for row in rows.flatten() {
            map.entry(row.0).or_insert_with(Vec::new).push(row.1);
        }
    }
    map
}

pub fn dict_columns(db: &Connection) -> Vec<String> {
    let mut stmt = match db.prepare("PRAGMA table_info(dictionary)") {
        Ok(stmt) => stmt,
        Err(_) => return Vec::new(),
    };
    stmt.query_map([], |row| row.get::<_, String>(1))
        .ok()
        .map(|rows| rows.filter_map(Result::ok).collect())
        .unwrap_or_default()
}

pub fn get_dictionary_entry(db: &Connection, topic: &str) -> Option<BTreeMap<String, String>> {
    let cols = dict_columns(db);
    if cols.is_empty() {
        return None;
    }
    let select = cols.join(", ");
    let sql = format!("SELECT {select} FROM dictionary WHERE topic = ?1");
    let mut stmt = db.prepare(&sql).ok()?;
    let mut rows = stmt.query(rusqlite::params![topic]).ok()?;
    let row = rows.next().ok()??;
    let mut map = BTreeMap::new();
    for (index, name) in cols.iter().enumerate() {
        let value = sqlite_string(row, index);
        map.insert(name.clone(), value);
    }
    Some(map)
}

fn sqlite_string(row: &Row<'_>, index: usize) -> String {
    row.get::<_, String>(index)
        .or_else(|_| row.get::<_, i64>(index).map(|n| n.to_string()))
        .or_else(|_| row.get::<_, f64>(index).map(|n| n.to_string()))
        .unwrap_or_default()
}

pub fn search_dictionary_topics(db: &Connection, prefix: &str, limit: i64) -> Vec<String> {
    let limit = if limit == 0 { 20 } else { limit };
    let mut stmt = match db
        .prepare("SELECT topic FROM dictionary WHERE topic LIKE ?1 ORDER BY topic LIMIT ?2")
    {
        Ok(stmt) => stmt,
        Err(_) => return Vec::new(),
    };
    stmt.query_map(rusqlite::params![format!("{prefix}%"), limit], |row| {
        row.get(0)
    })
    .ok()
    .map(|rows| rows.filter_map(Result::ok).collect())
    .unwrap_or_default()
}

pub fn lexical_search(
    db: &Connection,
    query: &str,
    limit: Option<f64>,
) -> Result<Vec<SearchHit>, rusqlite::Error> {
    let parsed = parse_search_query(Some(query));
    if parsed.strongs.is_empty() && parsed.text_terms.is_empty() && parsed.exact_phrases.is_empty()
    {
        return Ok(Vec::new());
    }
    let mut conditions = Vec::new();
    let mut params: Vec<String> = Vec::new();
    for term in &parsed.strongs {
        if term.prefix.is_empty() {
            conditions.push("(text LIKE '%<S>' || ? || '</S>%' OR text LIKE '%<S>H' || ? || '</S>%' OR text LIKE '%<S>G' || ? || '</S>%')".to_string());
            params.push(term.number.clone());
            params.push(term.number.clone());
            params.push(term.number.clone());
        } else {
            conditions.push(
                "(text LIKE '%<S>' || ? || '</S>%' OR text LIKE '%<S>' || ? || '</S>%')"
                    .to_string(),
            );
            params.push(term.number.clone());
            params.push(format!("{}{}", term.prefix, term.number));
        }
        if term.prefix == "H" {
            conditions.push("book_number < 470".into());
        } else if term.prefix == "G" {
            conditions.push("book_number >= 470".into());
        }
    }
    let mut sql = String::from("SELECT book_number, chapter, verse, text FROM verses");
    if !conditions.is_empty() {
        sql.push_str(" WHERE ");
        sql.push_str(&conditions.join(" AND "));
    }
    sql.push_str(" ORDER BY book_number, chapter, verse");
    let mut stmt = db.prepare(&sql)?;
    let rows = stmt.query_map(rusqlite::params_from_iter(params.iter()), |row| {
        Ok(SearchHit {
            book_number: row.get(0)?,
            chapter: row.get(1)?,
            verse: row.get(2)?,
            text: row.get(3)?,
        })
    })?;
    let cap = limit
        .filter(|value| value.is_finite() && *value > 0.0)
        .map(|value| value.floor() as usize);
    let mut results = Vec::new();
    for row in rows {
        let row = row?;
        if !matches_parsed_search(&row.text, &parsed) {
            continue;
        }
        results.push(row);
        if cap.is_some_and(|limit| results.len() >= limit) {
            break;
        }
    }
    Ok(results)
}

pub fn info_rows(db: &Connection) -> Vec<(String, String)> {
    if !table_exists(db, "info") {
        return Vec::new();
    }
    let mut stmt = match db.prepare("SELECT name, value FROM info ORDER BY name") {
        Ok(stmt) => stmt,
        Err(_) => return Vec::new(),
    };
    stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .ok()
        .map(|rows| rows.filter_map(Result::ok).collect())
        .unwrap_or_default()
}

pub fn upsert_info_value(db: &Connection, name: &str, value: &str) -> rusqlite::Result<InfoUpdate> {
    if !table_exists(db, "info") {
        return Err(rusqlite::Error::InvalidParameterName(
            "Module does not have info table".into(),
        ));
    }
    let key = name.trim();
    if key.is_empty() {
        return Err(rusqlite::Error::InvalidParameterName(
            "Info key is required".into(),
        ));
    }
    let changed = db.execute(
        "UPDATE info SET value = ?1 WHERE name = ?2",
        rusqlite::params![value, key],
    )?;
    if changed > 0 {
        return Ok(InfoUpdate {
            updated: true,
            inserted: false,
        });
    }
    db.execute(
        "INSERT INTO info (name, value) VALUES (?1, ?2)",
        rusqlite::params![key, value],
    )?;
    Ok(InfoUpdate {
        updated: false,
        inserted: true,
    })
}

pub fn editable_books(db: &Connection) -> Vec<EditableBook> {
    if table_exists(db, "books_all") {
        return map_edit_books(db, "SELECT book_number, short_name, long_name, title, is_present FROM books_all ORDER BY book_number", true, "books_all");
    }
    if table_exists(db, "books") {
        return map_edit_books(
            db,
            "SELECT book_number, short_name, long_name FROM books ORDER BY book_number",
            false,
            "books",
        );
    }
    get_commentary_books(db)
        .into_iter()
        .map(|book_number| EditableBook {
            book_number,
            short_name: None,
            long_name: None,
            title: None,
            is_present: 1,
            source_table: "commentaries",
        })
        .collect()
}

fn map_edit_books(
    db: &Connection,
    sql: &str,
    full: bool,
    source: &'static str,
) -> Vec<EditableBook> {
    let mut stmt = match db.prepare(sql) {
        Ok(stmt) => stmt,
        Err(_) => return Vec::new(),
    };
    let rows = stmt.query_map([], |row| {
        if full {
            Ok(EditableBook {
                book_number: row.get(0)?,
                short_name: row.get(1)?,
                long_name: row.get(2)?,
                title: row.get(3)?,
                is_present: row.get::<_, Option<i64>>(4)?.unwrap_or(1),
                source_table: source,
            })
        } else {
            Ok(EditableBook {
                book_number: row.get(0)?,
                short_name: row.get(1)?,
                long_name: row.get(2)?,
                title: None,
                is_present: 1,
                source_table: source,
            })
        }
    });
    rows.ok()
        .map(|rows| rows.filter_map(Result::ok).collect())
        .unwrap_or_default()
}

pub fn update_book_names(
    db: &Connection,
    book_number: i64,
    short_name: Option<&str>,
    long_name: Option<&str>,
) -> rusqlite::Result<()> {
    let table = if table_exists(db, "books_all") {
        "books_all"
    } else if table_exists(db, "books") {
        "books"
    } else {
        return Err(rusqlite::Error::InvalidParameterName(
            "Module does not have books table".into(),
        ));
    };
    let mut sets = Vec::new();
    let mut params: Vec<String> = Vec::new();
    if let Some(value) = short_name {
        sets.push("short_name = ?");
        params.push(value.to_string());
    }
    if let Some(value) = long_name {
        sets.push("long_name = ?");
        params.push(value.to_string());
    }
    if sets.is_empty() {
        return Err(rusqlite::Error::InvalidParameterName(
            "No allowed fields provided".into(),
        ));
    }
    params.push(book_number.to_string());
    let sql = format!(
        "UPDATE {table} SET {} WHERE book_number = ?",
        sets.join(", ")
    );
    let changed = db.execute(&sql, rusqlite::params_from_iter(params.iter()))?;
    if changed == 0 {
        return Err(rusqlite::Error::QueryReturnedNoRows);
    }
    Ok(())
}

pub fn get_verse_record(
    db: &Connection,
    book: i64,
    chapter: i64,
    verse: i64,
) -> Option<VerseRecord> {
    db.query_row(
        "SELECT verse, text FROM verses WHERE book_number = ?1 AND chapter = ?2 AND verse = ?3 LIMIT 1",
        rusqlite::params![book, chapter, verse],
        |row| Ok(VerseRecord { verse: row.get(0)?, text: row.get(1)? }),
    )
    .ok()
}

pub fn update_verse_text(
    db: &Connection,
    book: i64,
    chapter: i64,
    verse: i64,
    text: &str,
) -> rusqlite::Result<()> {
    let changed = db.execute(
        "UPDATE verses SET text = ?1 WHERE book_number = ?2 AND chapter = ?3 AND verse = ?4",
        rusqlite::params![text, book, chapter, verse],
    )?;
    if changed == 0 {
        Err(rusqlite::Error::QueryReturnedNoRows)
    } else {
        Ok(())
    }
}

pub fn get_commentary_entry(
    db: &Connection,
    book: i64,
    chapter: i64,
    verse_from: i64,
) -> Option<CommentaryEntry> {
    db.query_row(
        "SELECT verse_number_from, verse_number_to, chapter_number_to, text FROM commentaries WHERE book_number = ?1 AND chapter_number_from = ?2 AND verse_number_from = ?3 LIMIT 1",
        rusqlite::params![book, chapter, verse_from],
        |row| {
            Ok(CommentaryEntry {
                verse_from: row.get(0)?,
                verse_to: row.get(1)?,
                chapter_to: row.get(2)?,
                text: row.get(3)?,
            })
        },
    )
    .ok()
}

pub fn update_commentary_text(
    db: &Connection,
    book: i64,
    chapter: i64,
    verse_from: i64,
    text: &str,
) -> rusqlite::Result<()> {
    let changed = db.execute(
        "UPDATE commentaries SET text = ?1 WHERE book_number = ?2 AND chapter_number_from = ?3 AND verse_number_from = ?4",
        rusqlite::params![text, book, chapter, verse_from],
    )?;
    if changed == 0 {
        Err(rusqlite::Error::QueryReturnedNoRows)
    } else {
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CrossReference {
    pub verse: i64,
    pub verse_end: Option<i64>,
    pub book_to: i64,
    pub chapter_to: i64,
    pub verse_to_start: Option<i64>,
    pub verse_to_end: Option<i64>,
    pub votes: Option<i64>,
}

#[derive(Debug, Clone)]
pub struct LoadedMorph {
    pub rows: Vec<IndicationRow>,
    pub topic_by_indication: BTreeMap<String, String>,
    pub has_indications: bool,
    pub has_language_column: bool,
    pub info_language: Option<String>,
    pub articles_language: Option<String>,
}

impl MorphTables for LoadedMorph {
    fn indications(&self) -> Vec<IndicationRow> {
        self.rows.clone()
    }

    fn topics(&self, indication: &str, _language: Option<&str>) -> Option<String> {
        self.topic_by_indication.get(indication).cloned()
    }
}

fn open_read(path: &Path) -> Option<Connection> {
    Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).ok()
}

pub fn books_in_file(path: &Path) -> Vec<BookRecord> {
    let Some(db) = open_read(path) else {
        return Vec::new();
    };
    get_books(&db)
        .into_iter()
        .map(|row| BookRecord {
            book_number: row.book_number,
            short_name: row.short_name,
            long_name: row.long_name,
        })
        .collect()
}

pub fn chapter_count_in_file(path: &Path, book_number: i64) -> i64 {
    open_read(path)
        .map(|db| get_chapter_count(&db, book_number))
        .unwrap_or(0)
}

/// Books present in the module, each with its chapter count, from one connection.
pub fn chapter_spans_in_file(path: &Path) -> Vec<(i64, i64)> {
    let Some(db) = open_read(path) else {
        return Vec::new();
    };
    get_books(&db)
        .into_iter()
        .filter_map(|book| {
            let count = get_chapter_count(&db, book.book_number);
            (count > 0).then_some((book.book_number, count))
        })
        .collect()
}

pub fn commentary_coverage_in_file(path: &Path) -> BTreeMap<i64, Vec<i64>> {
    open_read(path)
        .map(|db| get_commentary_coverage(&db))
        .unwrap_or_default()
}

pub fn dictionary_topics_in_file(path: &Path, prefix: &str, limit: i64) -> Vec<String> {
    open_read(path)
        .map(|db| search_dictionary_topics(&db, prefix, limit))
        .unwrap_or_default()
}

pub fn dictionary_entry_in_file(path: &Path, topic: &str) -> Option<BTreeMap<String, String>> {
    open_read(path).and_then(|db| get_dictionary_entry(&db, topic))
}

pub fn random_dictionary_topics(db: &Connection, limit: i64) -> Vec<String> {
    let limit = if limit <= 0 { 8 } else { limit };
    let mut stmt = match db.prepare("SELECT topic FROM dictionary ORDER BY RANDOM() LIMIT ?1") {
        Ok(stmt) => stmt,
        Err(_) => return Vec::new(),
    };
    stmt.query_map(rusqlite::params![limit], |row| row.get(0))
        .ok()
        .map(|rows| rows.filter_map(Result::ok).collect())
        .unwrap_or_default()
}

pub fn random_topics_in_file(path: &Path, limit: i64) -> Vec<String> {
    open_read(path)
        .map(|db| random_dictionary_topics(&db, limit))
        .unwrap_or_default()
}

pub fn get_dictionary_cognates(db: &Connection, strongs_number: &str) -> Vec<String> {
    if !table_exists(db, "cognate_strong_numbers") {
        return Vec::new();
    }
    let group_id: Option<i64> = db
        .query_row(
            "SELECT group_id FROM cognate_strong_numbers WHERE strong_number = ?1 LIMIT 1",
            [strongs_number],
            |row| row.get(0),
        )
        .optional()
        .ok()
        .flatten();
    let Some(group_id) = group_id else {
        return Vec::new();
    };
    let mut stmt = match db.prepare(
        "SELECT strong_number FROM cognate_strong_numbers WHERE group_id = ?1 AND strong_number != ?2 ORDER BY strong_number",
    ) {
        Ok(stmt) => stmt,
        Err(_) => return Vec::new(),
    };
    stmt.query_map(rusqlite::params![group_id, strongs_number], |row| {
        row.get(0)
    })
    .ok()
    .map(|rows| rows.filter_map(Result::ok).collect())
    .unwrap_or_default()
}

pub fn dictionary_cognates_in_file(path: &Path, strongs_number: &str) -> Vec<String> {
    open_read(path)
        .map(|db| get_dictionary_cognates(&db, strongs_number))
        .unwrap_or_default()
}

pub fn get_cross_references(db: &Connection, book: i64, chapter: i64) -> Vec<CrossReference> {
    let mut stmt = match db.prepare(
        "SELECT verse, verse_end, book_to, chapter_to, verse_to_start, verse_to_end, votes FROM cross_references WHERE book = ?1 AND chapter = ?2 ORDER BY verse, votes DESC",
    ) {
        Ok(stmt) => stmt,
        Err(_) => return Vec::new(),
    };
    stmt.query_map(rusqlite::params![book, chapter], |row| {
        Ok(CrossReference {
            verse: row.get(0)?,
            verse_end: row.get(1)?,
            book_to: row.get(2)?,
            chapter_to: row.get(3)?,
            verse_to_start: row.get(4)?,
            verse_to_end: row.get(5)?,
            votes: row.get(6)?,
        })
    })
    .ok()
    .map(|rows| rows.filter_map(Result::ok).collect())
    .unwrap_or_default()
}

pub fn cross_refs_in_file(path: &Path, book: i64, chapter: i64) -> Vec<CrossReference> {
    open_read(path)
        .map(|db| get_cross_references(&db, book, chapter))
        .unwrap_or_default()
}

pub fn info_in_file(path: &Path) -> Vec<(String, String)> {
    open_read(path).map(|db| info_rows(&db)).unwrap_or_default()
}

pub fn editable_books_in_file(path: &Path) -> Vec<EditableBook> {
    open_read(path)
        .map(|db| editable_books(&db))
        .unwrap_or_default()
}

pub fn load_morphology(db: &Connection) -> LoadedMorph {
    let has_indications = table_exists(db, "morphology_indications");
    let has_language_column = if has_indications {
        let mut stmt = db.prepare("PRAGMA table_info(morphology_indications)").ok();
        stmt.as_mut()
            .and_then(|stmt| {
                stmt.query_map([], |row| row.get::<_, String>(1))
                    .ok()
                    .map(|rows| {
                        rows.filter_map(Result::ok)
                            .any(|name| name.eq_ignore_ascii_case("language"))
                    })
            })
            .unwrap_or(false)
    } else {
        false
    };
    let mut rows = Vec::new();
    if has_indications {
        let sql = if has_language_column {
            "SELECT indication, applicable_to, language, meaning FROM morphology_indications"
        } else {
            "SELECT indication, applicable_to, '' AS language, meaning FROM morphology_indications"
        };
        if let Ok(mut stmt) = db.prepare(sql) {
            if let Ok(mapped) = stmt.query_map([], |row| {
                Ok(IndicationRow::new(
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1).unwrap_or_default(),
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, String>(3).unwrap_or_default(),
                ))
            }) {
                rows.extend(mapped.filter_map(Result::ok));
            }
        }
    }
    let mut topic_by_indication = BTreeMap::new();
    if table_exists(db, "morphology_topics") {
        if let Ok(mut stmt) = db.prepare("SELECT indication, topic FROM morphology_topics") {
            if let Ok(mapped) = stmt.query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            }) {
                for (indication, topic) in mapped.filter_map(Result::ok) {
                    topic_by_indication.insert(indication, topic);
                }
            }
        }
    }
    let info = info_rows(db);
    let info_language = info
        .iter()
        .find(|(name, _)| name == "language")
        .map(|(_, value)| value.clone());
    let articles_language = info
        .iter()
        .find(|(name, _)| name == "articles_language")
        .map(|(_, value)| value.clone());
    LoadedMorph {
        has_indications,
        has_language_column,
        rows,
        topic_by_indication,
        info_language,
        articles_language,
    }
}

pub fn load_morphology_in_file(path: &Path) -> LoadedMorph {
    open_read(path)
        .map(|db| load_morphology(&db))
        .unwrap_or(LoadedMorph {
            rows: Vec::new(),
            topic_by_indication: BTreeMap::new(),
            has_indications: false,
            has_language_column: false,
            info_language: None,
            articles_language: None,
        })
}

pub fn write_info(path: &Path, name: &str, value: &str) -> Result<(), String> {
    let db = Connection::open(path).map_err(|err| err.to_string())?;
    upsert_info_value(&db, name, value)
        .map(|_| ())
        .map_err(|err| err.to_string())
}

pub fn write_book_names(
    path: &Path,
    book_number: i64,
    short_name: Option<&str>,
    long_name: Option<&str>,
) -> Result<(), String> {
    let db = Connection::open(path).map_err(|err| err.to_string())?;
    update_book_names(&db, book_number, short_name, long_name).map_err(|err| err.to_string())
}

pub fn write_verse_text(
    path: &Path,
    book: i64,
    chapter: i64,
    verse: i64,
    text: &str,
) -> Result<(), String> {
    let db = Connection::open(path).map_err(|err| err.to_string())?;
    update_verse_text(&db, book, chapter, verse, text).map_err(|err| err.to_string())
}

pub fn write_commentary_text(
    path: &Path,
    book: i64,
    chapter: i64,
    verse_from: i64,
    text: &str,
) -> Result<(), String> {
    let db = Connection::open(path).map_err(|err| err.to_string())?;
    update_commentary_text(&db, book, chapter, verse_from, text).map_err(|err| err.to_string())
}

pub fn table_availability(db: &Connection) -> TableAvailability {
    TableAvailability {
        info: table_exists(db, "info"),
        books: table_exists(db, "books"),
        books_all: table_exists(db, "books_all"),
        verses: table_exists(db, "verses"),
        commentaries: table_exists(db, "commentaries"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bible() -> Connection {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch(
            "CREATE TABLE info (name TEXT, value TEXT);
             CREATE TABLE books (book_number INTEGER, short_name TEXT, long_name TEXT);
             CREATE TABLE verses (book_number INTEGER, chapter INTEGER, verse INTEGER, text TEXT);
             INSERT INTO info VALUES ('description', 'Fixture Bible');
             INSERT INTO books VALUES (10, 'Gen', 'Genesis');
             INSERT INTO verses VALUES (10, 1, 1, 'In<S>7225</S>');",
        )
        .unwrap();
        db
    }

    #[test]
    fn bible_rows_are_verse_and_text_with_strong_tags() {
        let db = bible();
        assert_eq!(detect_type(&db), "bible");
        let books = get_books(&db);
        assert_eq!(books[0].book_number, 10);
        assert_eq!(books[0].short_name.as_deref(), Some("Gen"));
        assert_eq!(books[0].long_name.as_deref(), Some("Genesis"));
        let verses = get_chapter(&db, 10, 1);
        assert_eq!(verses[0].verse, 1);
        assert!(verses[0].text.contains("<S>"));
    }

    #[test]
    fn commentary_rows_keep_from_to_shape() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch(
            "CREATE TABLE commentaries (book_number INTEGER, chapter_number_from INTEGER, verse_number_from INTEGER, chapter_number_to INTEGER, verse_number_to INTEGER, text TEXT);
             INSERT INTO commentaries VALUES (10, 1, 1, NULL, 1, 'Commentary text');",
        )
        .unwrap();
        assert_eq!(detect_type(&db), "commentary");
        let books = get_commentary_books(&db);
        let entries = get_commentary(&db, books[0], 1);
        assert_eq!(entries[0].verse_from, 1);
        assert_eq!(entries[0].verse_to, Some(1));
        assert_eq!(entries[0].text, "Commentary text");
    }

    #[test]
    fn dictionary_entries_include_topic() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch(
            "CREATE TABLE dictionary (topic TEXT, definition TEXT);
             INSERT INTO dictionary VALUES ('Alpha', 'Definition text');",
        )
        .unwrap();
        assert!(dict_columns(&db).iter().any(|c| c == "topic"));
        let topics = search_dictionary_topics(&db, "", 1);
        let entry = get_dictionary_entry(&db, &topics[0]).unwrap();
        assert_eq!(entry.get("topic").map(String::as_str), Some("Alpha"));
        assert!(get_dictionary_entry(&db, "NONEXISTENT_TOPIC_XYZ_999").is_none());
    }

    #[test]
    fn edits_info_books_verses_and_commentary() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch(
            "CREATE TABLE info (name TEXT, value TEXT);
             CREATE TABLE books (book_number NUMERIC, short_name TEXT, long_name TEXT);
             CREATE TABLE verses (book_number NUMERIC, chapter NUMERIC, verse NUMERIC, text TEXT);
             CREATE TABLE commentaries (book_number NUMERIC, chapter_number_from NUMERIC, verse_number_from NUMERIC, chapter_number_to NUMERIC, verse_number_to NUMERIC, text TEXT);
             INSERT INTO info VALUES ('description', 'Demo');
             INSERT INTO books VALUES (10, 'Gn', 'Genesis');
             INSERT INTO verses VALUES (10, 1, 1, 'In the beginning');
             INSERT INTO commentaries VALUES (10, 1, 1, 1, 1, 'Commentary text');",
        )
        .unwrap();
        assert!(
            upsert_info_value(&db, "description", "Demo 2")
                .unwrap()
                .updated
        );
        assert!(upsert_info_value(&db, "short.title", "D").unwrap().inserted);
        let info = info_rows(&db);
        assert!(info
            .iter()
            .any(|(k, v)| k == "description" && v == "Demo 2"));
        update_book_names(&db, 10, Some("Gen"), Some("Genesis Book")).unwrap();
        let book = editable_books(&db)
            .into_iter()
            .find(|b| b.book_number == 10)
            .unwrap();
        assert_eq!(book.short_name.as_deref(), Some("Gen"));
        assert_eq!(book.long_name.as_deref(), Some("Genesis Book"));
        update_verse_text(&db, 10, 1, 1, "Edited verse").unwrap();
        assert_eq!(
            get_verse_record(&db, 10, 1, 1).unwrap().text,
            "Edited verse"
        );
        update_commentary_text(&db, 10, 1, 1, "Edited commentary").unwrap();
        assert_eq!(
            get_commentary_entry(&db, 10, 1, 1).unwrap().text,
            "Edited commentary"
        );
        let available = table_availability(&db);
        assert!(available.info && available.books && available.verses && available.commentaries);
    }

    #[test]
    fn editable_books_fall_back_to_commentaries() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch(
            "CREATE TABLE commentaries (book_number NUMERIC, chapter_number_from NUMERIC, verse_number_from NUMERIC, chapter_number_to NUMERIC, verse_number_to NUMERIC, text TEXT);
             INSERT INTO commentaries VALUES (10, 1, 1, 1, 1, 'note');",
        )
        .unwrap();
        let books = editable_books(&db);
        assert_eq!(books[0].book_number, 10);
        assert_eq!(books[0].source_table, "commentaries");
    }

    fn search_db() -> Connection {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch(
            "CREATE TABLE verses (book_number INTEGER, chapter INTEGER, verse INTEGER, text TEXT)",
        )
        .unwrap();
        let rows = [
            (
                10,
                1,
                1,
                "In the beginning God created the heavens and the earth",
            ),
            (10, 1, 2, "The kingdom of God is near"),
            (10, 1, 3, "God will make the kingdom bright"),
            (10, 1, 4, "created<S>H1254</S> the world"),
            (10, 1, 8, "O rei decidiu revogar a ordem"),
        ];
        for (book, chapter, verse, text) in rows {
            db.execute(
                "INSERT INTO verses VALUES (?1, ?2, ?3, ?4)",
                rusqlite::params![book, chapter, verse, text],
            )
            .unwrap();
        }
        db
    }

    #[test]
    fn lexical_search_matches_the_sqlite_provider_cases() {
        let db = search_db();
        assert_eq!(
            lexical_search(&db, "begnning creatd", None).unwrap()[0].verse,
            1
        );
        assert_eq!(
            lexical_search(&db, "revogar", None)
                .unwrap()
                .iter()
                .map(|h| h.verse)
                .collect::<Vec<_>>(),
            vec![8]
        );
        assert_eq!(
            lexical_search(&db, "\"kingdom of God\"", None).unwrap()[0].verse,
            2
        );
        assert!(lexical_search(&db, "\"God kingdom\"", None)
            .unwrap()
            .is_empty());
        let limited = lexical_search(&db, "strong:H1254 wrld", Some(1.0)).unwrap();
        assert_eq!(limited.len(), 1);
        assert_eq!(limited[0].verse, 4);
    }

    #[test]
    fn cross_references_cognates_and_file_reads_use_the_module() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("module.sqlite");
        let db = Connection::open(&path).unwrap();
        db.execute_batch(
            "CREATE TABLE cross_references (book INTEGER, chapter INTEGER, verse INTEGER, verse_end INTEGER, book_to INTEGER, chapter_to INTEGER, verse_to_start INTEGER, verse_to_end INTEGER, votes INTEGER);
             INSERT INTO cross_references VALUES (10, 1, 1, 1, 470, 1, 1, 2, 5);
             CREATE TABLE dictionary (topic TEXT, definition TEXT);
             INSERT INTO dictionary VALUES ('H1', 'father');
             CREATE TABLE cognate_strong_numbers (group_id INTEGER, strong_number TEXT);
             INSERT INTO cognate_strong_numbers VALUES (1, 'H1'), (1, 'H2');",
        )
        .unwrap();
        drop(db);
        let refs = cross_refs_in_file(&path, 10, 1);
        assert_eq!(refs.len(), 1);
        assert_eq!(refs[0].book_to, 470);
        assert_eq!(refs[0].verse_to_start, Some(1));
        assert_eq!(
            dictionary_cognates_in_file(&path, "H1"),
            vec!["H2".to_string()]
        );
        assert_eq!(
            dictionary_entry_in_file(&path, "H1")
                .unwrap()
                .get("topic")
                .map(String::as_str),
            Some("H1")
        );
        assert_eq!(random_topics_in_file(&path, 4), vec!["H1".to_string()]);
    }
}
