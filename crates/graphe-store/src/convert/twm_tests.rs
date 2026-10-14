use super::*;
use crate::convert::convert_file;
use flate2::write::ZlibEncoder;
use flate2::Compression;
use rusqlite::{params, Connection};
use std::io::Write;
use std::path::{Path, PathBuf};

fn utf16le(text: &str) -> Vec<u8> {
    let mut out = Vec::new();
    for unit in text.encode_utf16() {
        out.extend_from_slice(&unit.to_le_bytes());
    }
    out
}

fn deflate(bytes: &[u8]) -> Vec<u8> {
    let mut encoder = ZlibEncoder::new(Vec::new(), Compression::default());
    encoder.write_all(bytes).unwrap();
    encoder.finish().unwrap()
}

fn write_type2(dir: &Path) -> PathBuf {
    let path = dir.join("fixture.cmt.twm");
    let db = Connection::open(&path).unwrap();
    db.execute_batch(
        "
        CREATE TABLE config (name TEXT, value TEXT);
        CREATE TABLE content (topic_id INTEGER, data BLOB);
        CREATE TABLE content_search (topic_id INTEGER, data BLOB);
        CREATE TABLE bible_refs (topic_id INTEGER, bi INTEGER, ci INTEGER, fvi INTEGER, tvi INTEGER);
        ",
    )
    .unwrap();
    db.execute(
        "INSERT INTO config VALUES ('title', 'Fixture Type 2 Commentary')",
        [],
    )
    .unwrap();
    db.execute("INSERT INTO config VALUES ('type', '2')", [])
        .unwrap();
    db.execute("INSERT INTO config VALUES ('lang', 'en')", [])
        .unwrap();
    db.execute("INSERT INTO content VALUES (1, 'Plain commentary')", [])
        .unwrap();
    db.execute(
        "INSERT INTO content_search VALUES (1, ?1)",
        params![utf16le("Plain commentary")],
    )
    .unwrap();
    db.execute("INSERT INTO bible_refs VALUES (1, 1, 1, 1, 2)", [])
        .unwrap();
    drop(db);
    path
}

fn write_type3(dir: &Path) -> PathBuf {
    let path = dir.join("fixture-topic.cmt.twm");
    let db = Connection::open(&path).unwrap();
    db.execute_batch(
        "
        CREATE TABLE config (name TEXT, value TEXT);
        CREATE TABLE topics (id INTEGER, pid INTEGER, subject TEXT, rel_order INTEGER);
        CREATE TABLE content (topic_id INTEGER, data BLOB);
        CREATE TABLE content_search (topic_id INTEGER, data BLOB);
        CREATE TABLE bible_link_search (topic_id INTEGER, data BLOB);
        ",
    )
    .unwrap();
    db.execute(
        "INSERT INTO config VALUES ('title', 'Fixture Type 3 Commentary')",
        [],
    )
    .unwrap();
    db.execute("INSERT INTO config VALUES ('type', '3')", [])
        .unwrap();
    db.execute("INSERT INTO config VALUES ('lang', 'en')", [])
        .unwrap();
    db.execute("INSERT INTO topics VALUES (1, 0, 'Genesis', 1)", [])
        .unwrap();
    db.execute("INSERT INTO content VALUES (1, 'Topic commentary')", [])
        .unwrap();
    db.execute(
        "INSERT INTO content_search VALUES (1, ?1)",
        params![utf16le("Topic commentary")],
    )
    .unwrap();
    db.execute("INSERT INTO bible_link_search VALUES (1, ',1.1.1,')", [])
        .unwrap();
    drop(db);
    path
}

fn write_dict(dir: &Path, name: &str, compressed: bool) -> PathBuf {
    let path = dir.join(name);
    let db = Connection::open(&path).unwrap();
    db.execute_batch(
        "
        CREATE TABLE config (name TEXT, value TEXT);
        CREATE TABLE topics (id INTEGER, pid INTEGER, subject TEXT, rel_order INTEGER);
        CREATE TABLE content (topic_id INTEGER, data BLOB);
        CREATE TABLE content_search (topic_id INTEGER, data BLOB);
        ",
    )
    .unwrap();
    db.execute(
        "INSERT INTO config VALUES ('title', 'Fixture Dictionary')",
        [],
    )
    .unwrap();
    db.execute("INSERT INTO config VALUES ('type', '1')", [])
        .unwrap();
    db.execute("INSERT INTO config VALUES ('lang', 'pt')", [])
        .unwrap();
    db.execute("INSERT INTO config VALUES ('strong.g', '1')", [])
        .unwrap();
    if compressed {
        db.execute("INSERT INTO config VALUES ('compressed', '1')", [])
            .unwrap();
    }
    db.execute("INSERT INTO topics VALUES (1, 0, 'G3588', 1)", [])
        .unwrap();
    db.execute("INSERT INTO content VALUES (1, 'Dictionary content')", [])
        .unwrap();
    let text = "artigo definido\nfixture definition";
    let payload = if compressed {
        deflate(&utf16le(text))
    } else {
        utf16le(text)
    };
    db.execute(
        "INSERT INTO content_search VALUES (1, ?1)",
        params![payload],
    )
    .unwrap();
    drop(db);
    path
}

#[test]
fn type2_commentary_provider_and_conversion() {
    let dir = tempfile::tempdir().unwrap();
    let path = write_type2(dir.path());
    assert!(is_valid_file(&path));
    let handle = load(&path).unwrap();
    assert_eq!(handle.format, "theword-twm");
    assert!(!handle.topic_based);
    assert!(!handle.config.is_empty());
    let info = get_module_info(&handle);
    assert_eq!(info.kind, "commentary");
    assert!(!info.description.is_empty());
    let books = get_commentary_books(&handle).unwrap();
    assert!(!books.is_empty());
    let entries = get_commentary(&handle, i64::from(books[0]), 1).unwrap();
    assert!(!entries.is_empty());
    assert_eq!(entries[0].verse_from, 1);
    assert!(entries[0].verse_to.is_some());
    assert!(entries[0].chapter_to.is_none());
    assert!(entries[0].text.contains("Plain commentary"));
    close(handle);

    let output = convert_file(&path, dir.path()).unwrap();
    assert!(output.to_string_lossy().contains(".commentaries.SQLite3"));
    let db = Connection::open(&output).unwrap();
    let description: String = db
        .query_row(
            "SELECT value FROM info WHERE name = 'description'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert!(!description.is_empty());
    let text: String = db
        .query_row("SELECT text FROM commentaries LIMIT 1", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert!(text.contains("Plain commentary"));
    let books: i64 = db
        .query_row("SELECT COUNT(*) FROM books", [], |row| row.get(0))
        .unwrap();
    assert!(books > 0);
}

#[test]
fn type3_commentary_maps_books_from_bible_links() {
    let dir = tempfile::tempdir().unwrap();
    let path = write_type3(dir.path());
    assert!(is_valid_file(&path));
    let handle = load(&path).unwrap();
    assert!(handle.topic_based);
    assert!(!handle.topic_book_map.is_empty());
    assert_eq!(get_module_info(&handle).kind, "commentary");
    let books = get_commentary_books(&handle).unwrap();
    assert!(!books.is_empty());
    let entries = get_commentary(&handle, i64::from(books[0]), 1).unwrap();
    assert_eq!(entries[0].verse_from, 1);
    assert!(entries[0].verse_to.is_none());
    assert!(entries[0].chapter_to.is_none());
    assert!(entries[0].text.contains("Topic commentary"));
}

#[test]
fn dictionary_provider_decodes_plain_and_compressed_blobs() {
    let dir = tempfile::tempdir().unwrap();
    let path = write_dict(dir.path(), "fixture.dct.twm", false);
    let compressed = write_dict(dir.path(), "fixture-compressed.dct.twm", true);
    assert!(is_valid_file(&path));
    assert!(!is_valid_file(Path::new("/nonexistent/file.twm")));
    let handle = load(&path).unwrap();
    assert!(handle.is_dictionary);
    let info = get_module_info(&handle);
    assert_eq!(info.kind, "dictionary");
    assert!(!info.description.is_empty());
    assert!(info.is_strong_dict);
    assert!(has_dictionary_table(&handle));
    let topics = search_dictionary_topics(&handle, "", Some(10));
    assert!(!topics.is_empty());
    let entry = get_dictionary_entry(&handle, &topics[0]).unwrap();
    assert_eq!(entry.topic, topics[0]);
    assert!(!entry.definition.is_empty());
    assert!(get_dictionary_entry(&handle, "NONEXISTENT_TOPIC_XYZ").is_none());

    let strong = load(&compressed).unwrap();
    let entry = get_dictionary_entry(&strong, "G3588").unwrap();
    assert_eq!(entry.topic, "G3588");
    assert!(entry.definition.contains("artigo definido"));
    assert!(entry.definition.contains("<p>"));
    close(strong);

    let output = convert_file(&path, dir.path()).unwrap();
    assert!(output.to_string_lossy().contains(".dictionary.SQLite3"));
    let db = Connection::open(&output).unwrap();
    let definition: String = db
        .query_row(
            "SELECT definition FROM dictionary WHERE topic = 'G3588'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert!(definition.contains("artigo definido"));
    let is_strong: String = db
        .query_row(
            "SELECT value FROM info WHERE name = 'is_strong'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(is_strong, "true");
}
