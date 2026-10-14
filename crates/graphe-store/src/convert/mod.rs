//! theWord and MySword conversion into MyBible SQLite.

mod bible;
mod mysword;
mod rtf;
mod twm;

use rusqlite::types::Value;
use std::path::{Path, PathBuf};

#[derive(Debug)]
pub struct ConvertError(pub String);

impl std::fmt::Display for ConvertError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for ConvertError {}

impl From<rusqlite::Error> for ConvertError {
    fn from(err: rusqlite::Error) -> Self {
        Self(err.to_string())
    }
}

impl From<std::io::Error> for ConvertError {
    fn from(err: std::io::Error) -> Self {
        Self(err.to_string())
    }
}

pub fn supported_extensions() -> &'static [&'static str] {
    &[
        ".ont", ".ontx", ".nt", ".ntx", ".ot", ".otx", ".twm", ".mybible",
    ]
}

pub fn convert_file(input: &Path, output_dir: &Path) -> Result<PathBuf, ConvertError> {
    let name = file_name(input).to_lowercase();
    if name.ends_with(".bbl.mybible") || name.ends_with(".dct.mybible") {
        return mysword::convert(input, output_dir);
    }
    let ext = dotted_extension(input);
    match ext.as_str() {
        ".ont" | ".ontx" | ".nt" | ".ntx" | ".ot" | ".otx" => {
            bible::convert_bible(input, output_dir)
        }
        ".twm" => twm::convert_twm(input, output_dir),
        ".mybible" => mysword::convert(input, output_dir),
        _ => Err(ConvertError(format!("Unsupported format: {ext}"))),
    }
}

pub(super) fn file_name(path: &Path) -> String {
    path.file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("module")
        .to_string()
}

pub(super) fn file_stem(path: &Path) -> String {
    path.file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("module")
        .to_string()
}

pub(super) fn dotted_extension(path: &Path) -> String {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| format!(".{}", ext.to_lowercase()))
        .unwrap_or_default()
}

pub(super) fn quote_ident(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

pub(super) fn value_to_string(value: Value) -> String {
    match value {
        Value::Null => String::new(),
        Value::Integer(v) => v.to_string(),
        Value::Real(v) => {
            if v.is_finite() && v.fract() == 0.0 && v.abs() < 1e15 {
                format!("{}", v as i64)
            } else {
                v.to_string()
            }
        }
        Value::Text(v) => v,
        Value::Blob(v) => String::from_utf8_lossy(&v).into_owned(),
    }
}

pub(super) fn set_delete_journal(conn: &rusqlite::Connection) -> Result<(), ConvertError> {
    let _: String = conn.query_row("PRAGMA journal_mode = DELETE", [], |row| row.get(0))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;
    use std::fs;

    #[test]
    fn lists_supported_extensions_and_rejects_unknown_input() {
        assert_eq!(
            supported_extensions(),
            &[".ont", ".ontx", ".nt", ".ntx", ".ot", ".otx", ".twm", ".mybible"][..]
        );
        let err = convert_file(Path::new("/tmp/module.unknown"), Path::new("/tmp")).unwrap_err();
        assert_eq!(err.to_string(), "Unsupported format: .unknown");
    }

    #[test]
    fn rejects_encrypted_ontx_and_secure_twm() {
        let dir = tempfile::tempdir().unwrap();
        let ontx = dir.path().join("sample.ontx");
        fs::write(&ontx, b"TWENCBMOD\x00\x01\x02\x03").unwrap();
        let err = convert_file(&ontx, dir.path()).unwrap_err();
        assert!(err.to_string().contains("Encrypted TheWord Bible"), "{err}");

        let twm = dir.path().join("secure.cmt.twm");
        let db = Connection::open(&twm).unwrap();
        db.execute_batch(
            "
            CREATE TABLE config (name TEXT, value TEXT);
            CREATE TABLE content (topic_id INTEGER, data BLOB);
            CREATE TABLE bible_refs (
                topic_id INTEGER, bi INTEGER, ci INTEGER, fvi INTEGER, tvi INTEGER
            );
            ",
        )
        .unwrap();
        db.execute("INSERT INTO config VALUES ('secure', '1')", [])
            .unwrap();
        db.execute("INSERT INTO config VALUES ('title', 'Locked')", [])
            .unwrap();
        db.execute("INSERT INTO config VALUES ('type', '2')", [])
            .unwrap();
        drop(db);
        let err = convert_file(&twm, dir.path()).unwrap_err();
        assert!(err.to_string().contains("Encrypted TheWord TWM"), "{err}");
    }
}
