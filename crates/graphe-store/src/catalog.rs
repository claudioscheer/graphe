//! Installed modules under `~/.graphe/modules` (or the Windows profile equivalent).

use crate::sqlite::{self, detect_type};
use rusqlite::Connection;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InstalledModule {
    pub id: String,
    pub path: PathBuf,
    pub kind: String,
    pub name: String,
}

pub fn scan_modules(dir: &Path) -> Vec<InstalledModule> {
    let mut found = Vec::new();
    let Ok(entries) = fs::read_dir(dir) else {
        return found;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() || !sqlite::is_valid_module(&path) {
            continue;
        }
        let id = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("module")
            .to_string();
        let Some(module) = describe(&path, &id) else {
            continue;
        };
        found.push(module);
    }
    found.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    found
}

fn describe(path: &Path, id: &str) -> Option<InstalledModule> {
    let db = Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).ok()?;
    let kind = detect_type(&db).to_string();
    let name = sqlite::info_rows(&db)
        .into_iter()
        .find(|(key, _)| key == "description" || key == "short.title")
        .map(|(_, value)| value)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| id.to_string());
    Some(InstalledModule {
        id: id.to_string(),
        path: path.to_path_buf(),
        kind,
        name,
    })
}

pub fn install_files(dir: &Path, files: &[PathBuf]) -> Vec<PathBuf> {
    let _ = fs::create_dir_all(dir);
    let mut installed = Vec::new();
    for file in files {
        if !sqlite::is_valid_module(file) {
            continue;
        }
        let name = file.file_name().unwrap_or_default();
        let dest = dir.join(name);
        if fs::copy(file, &dest).is_ok() {
            installed.push(dest);
        }
    }
    installed
}

pub fn delete_module(path: &Path) -> std::io::Result<()> {
    fs::remove_file(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    #[test]
    fn scans_and_installs_a_bible_module() {
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("src");
        let modules = dir.path().join("modules");
        fs::create_dir_all(&src).unwrap();
        let file = src.join("kjv.SQLite3");
        let db = Connection::open(&file).unwrap();
        db.execute_batch(
            "CREATE TABLE info (name TEXT, value TEXT);
             CREATE TABLE verses (book_number INTEGER, chapter INTEGER, verse INTEGER, text TEXT);
             INSERT INTO info VALUES ('description', 'King James');
             INSERT INTO verses VALUES (10, 1, 1, 'In the beginning');",
        )
        .unwrap();
        drop(db);
        let copied = install_files(&modules, &[file]);
        assert_eq!(copied.len(), 1);
        let found = scan_modules(&modules);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].kind, "bible");
        assert_eq!(found[0].name, "King James");
    }
}
