//! TheWord plain-text Bible provider and MyBible verse conversion.

use super::{file_name, file_stem, set_delete_journal, ConvertError};
use graphe_domain::books::map::VerseIndexEntry;
use graphe_domain::books::{
    build_verse_index, BOOK_NAMES, GRAPHE_BOOK_NUMBERS, NT_BOOK_OFFSET, VERSES_PER_CHAPTER,
};
#[cfg(test)]
use graphe_domain::model::VerseRecord;
use graphe_domain::tags::{normalize_strong_number, sanitize_strong_tags, sanitize_supported_tags};
use regex::{Captures, Regex};
use rusqlite::{params, Connection};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum VerseScope {
    Nt,
    Ot,
    Full,
}

impl VerseScope {
    #[cfg(test)]
    pub(super) fn as_str(self) -> &'static str {
        match self {
            Self::Nt => "nt",
            Self::Ot => "ot",
            Self::Full => "full",
        }
    }
}

pub(super) struct BibleBook {
    pub book_number: u16,
    pub short_name: &'static str,
    pub long_name: &'static str,
}

#[derive(Debug)]
pub(super) struct TheWordBible {
    #[allow(dead_code)]
    pub format: &'static str,
    #[allow(dead_code)]
    pub file_path: PathBuf,
    pub lines: Vec<String>,
    pub metadata: HashMap<String, String>,
    pub verse_index: HashMap<u16, HashMap<u16, VerseIndexEntry>>,
    #[allow(dead_code)]
    pub scope: VerseScope,
    #[allow(dead_code)]
    pub effective_scope: VerseScope,
    pub is_nt_only: bool,
    pub is_ot_only: bool,
    pub present_books: HashSet<u16>,
    #[allow(dead_code)]
    pub present_chapters: HashMap<u16, HashSet<u16>>,
    #[allow(dead_code)]
    pub non_empty_verse_count: usize,
    pub has_strongs: bool,
}

pub(super) fn total_verse_count() -> usize {
    ot_verse_count() + nt_verse_count()
}

pub(super) fn ot_verse_count() -> usize {
    verse_span(0..NT_BOOK_OFFSET)
}

pub(super) fn nt_verse_count() -> usize {
    verse_span(NT_BOOK_OFFSET..66)
}

fn verse_span(range: std::ops::Range<usize>) -> usize {
    VERSES_PER_CHAPTER[range]
        .iter()
        .map(|chapters| chapters.iter().map(|n| *n as usize).sum::<usize>())
        .sum()
}

pub(super) fn load(path: &Path) -> Result<TheWordBible, ConvertError> {
    let ext = super::dotted_extension(path);
    let kind = module_kind(&ext)
        .ok_or_else(|| ConvertError(format!("Unsupported TheWord Bible extension: {ext}")))?;
    let raw = fs::read(path)?;
    if raw.starts_with(b"TWENCBMOD") {
        return Err(ConvertError(
            "Encrypted TheWord Bible modules (.ontx/.ntx/.otx) are not supported for conversion"
                .into(),
        ));
    }
    let text = decode_theword_text(&raw);
    let mut all_lines = split_lines(&text);
    let scope = infer_scope(kind, all_lines.len()).ok_or_else(|| {
        ConvertError(format!(
            "Invalid or truncated TheWord Bible module: expected at least {} verse lines, got {}",
            nt_verse_count(),
            all_lines.len()
        ))
    })?;
    let expected = match scope {
        VerseScope::Nt => nt_verse_count(),
        VerseScope::Ot => ot_verse_count(),
        VerseScope::Full => total_verse_count(),
    };
    let trailer = if all_lines.len() > expected {
        all_lines.split_off(expected)
    } else {
        Vec::new()
    };
    let lines = all_lines;
    let mut metadata = HashMap::new();
    for line in trailer {
        if let Some((key, value)) = line.split_once('=') {
            if !key.is_empty() {
                metadata.insert(key.trim().to_string(), value.trim().to_string());
            }
        }
    }
    let verse_index = verse_index_for(scope);
    let mut present_books = HashSet::new();
    let mut present_chapters: HashMap<u16, HashSet<u16>> = HashMap::new();
    let mut non_empty = 0usize;
    let mut has_ot = false;
    let mut has_nt = false;
    for (book, chapters) in &verse_index {
        for (chapter, info) in chapters {
            for offset in 0..info.verse_count as usize {
                let idx = info.start_line + offset;
                let raw_line = lines.get(idx).map(String::as_str).unwrap_or("");
                if !has_visible_verse_text(raw_line) {
                    continue;
                }
                non_empty += 1;
                present_books.insert(*book);
                if *book >= 470 {
                    has_nt = true;
                } else {
                    has_ot = true;
                }
                present_chapters.entry(*book).or_default().insert(*chapter);
            }
        }
    }
    let effective = if has_ot && has_nt {
        VerseScope::Full
    } else if has_ot {
        VerseScope::Ot
    } else if has_nt {
        VerseScope::Nt
    } else {
        scope
    };
    let sample = lines.len().min(200);
    let strong_re = strong_sample_re();
    let has_strongs = lines[..sample].iter().any(|line| strong_re.is_match(line));
    Ok(TheWordBible {
        format: "theword-bible",
        file_path: path.to_path_buf(),
        lines,
        metadata,
        verse_index,
        scope,
        effective_scope: effective,
        is_nt_only: effective == VerseScope::Nt,
        is_ot_only: effective == VerseScope::Ot,
        present_books,
        present_chapters,
        non_empty_verse_count: non_empty,
        has_strongs,
    })
}

pub(super) fn get_books(handle: &TheWordBible) -> Vec<BibleBook> {
    let filter = !handle.present_books.is_empty();
    let start = if handle.is_nt_only { NT_BOOK_OFFSET } else { 0 };
    let end = if handle.is_ot_only {
        NT_BOOK_OFFSET
    } else {
        66
    };
    let mut books = Vec::new();
    for i in start..end {
        let book_number = GRAPHE_BOOK_NUMBERS[i];
        if filter && !handle.present_books.contains(&book_number) {
            continue;
        }
        books.push(BibleBook {
            book_number,
            short_name: BOOK_NAMES[i].short,
            long_name: BOOK_NAMES[i].long,
        });
    }
    books
}

#[cfg(test)]
pub(super) fn get_chapter_count(handle: &TheWordBible, book_number: u16) -> usize {
    if !handle.present_books.contains(&book_number) {
        return 0;
    }
    if let Some(chapters) = handle.present_chapters.get(&book_number) {
        return chapters.len();
    }
    handle
        .verse_index
        .get(&book_number)
        .map(|m| m.len())
        .unwrap_or(0)
}

#[cfg(test)]
pub(super) fn get_chapter(
    handle: &TheWordBible,
    book_number: u16,
    chapter: u16,
) -> Vec<VerseRecord> {
    if !handle.present_books.contains(&book_number) {
        return Vec::new();
    }
    let Some(info) = handle
        .verse_index
        .get(&book_number)
        .and_then(|m| m.get(&chapter))
        .copied()
    else {
        return Vec::new();
    };
    let mut verses = Vec::new();
    for offset in 0..info.verse_count as usize {
        let idx = info.start_line + offset;
        if idx >= handle.lines.len() {
            break;
        }
        let converted = convert_tags(&handle.lines[idx]);
        if normalize_for_presence(&converted).is_empty() {
            continue;
        }
        verses.push(VerseRecord {
            verse: (offset + 1) as i64,
            text: converted,
        });
    }
    verses
}

#[cfg(test)]
pub(super) fn is_valid_file(path: &Path) -> bool {
    let ext = super::dotted_extension(path);
    if module_kind(&ext).is_none() {
        return false;
    }
    let Ok(mut file) = fs::File::open(path) else {
        return false;
    };
    let mut buf = [0u8; 512];
    let Ok(n) = std::io::Read::read(&mut file, &mut buf) else {
        return false;
    };
    let head = &buf[..n];
    if head.starts_with(b"TWENCBMOD") {
        return true;
    }
    let text = decode_theword_text(head);
    valid_head_re().is_match(&text)
}

pub(super) fn convert_tags(line: &str) -> String {
    convert_theword_line(line, false)
}

pub(super) fn convert_tags_to_mybible(line: &str) -> String {
    convert_theword_line(line, true)
}

pub(super) fn convert_bible(input: &Path, output_dir: &Path) -> Result<PathBuf, ConvertError> {
    let handle = load(input)?;
    let output = output_dir.join(format!("{}.SQLite3", file_stem(input)));
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
    let short_title = meta_first(&handle, &["short.title", "short_title"]);
    let description = meta_first(&handle, &["description"]);
    let basename = file_stem(input);
    let display = if !short_title.is_empty() {
        short_title.clone()
    } else if !description.is_empty() {
        description.clone()
    } else {
        basename
    };
    let description_value = if description.is_empty() {
        display
    } else {
        description
    };
    let language = meta_first(&handle, &["lang"]);
    let tx = conn.transaction()?;
    {
        let mut info = tx.prepare("INSERT INTO info (name, value) VALUES (?1, ?2)")?;
        info.execute(params!["description", description_value])?;
        if !short_title.is_empty() {
            info.execute(params!["short.title", short_title])?;
        }
        info.execute(params!["language", language])?;
        info.execute(params![
            "strong_numbers",
            if handle.has_strongs { "true" } else { "false" }
        ])?;
        drop(info);

        let mut insert = tx.prepare(
            "INSERT INTO verses (book_number, chapter, verse, text) VALUES (?1, ?2, ?3, ?4)",
        )?;
        let mut books: Vec<u16> = handle.verse_index.keys().copied().collect();
        books.sort_unstable();
        let mut inserted = 0usize;
        let mut non_empty = 0usize;
        let mut inserted_books = HashSet::new();
        for book in books {
            let mut chapters: Vec<u16> = handle.verse_index[&book].keys().copied().collect();
            chapters.sort_unstable();
            for chapter in chapters {
                let info = handle.verse_index[&book][&chapter];
                for offset in 0..info.verse_count as usize {
                    let idx = info.start_line + offset;
                    let raw = handle.lines.get(idx).map(String::as_str).unwrap_or("");
                    let converted = convert_tags_to_mybible(raw);
                    insert.execute(params![
                        book as i64,
                        chapter as i64,
                        (offset + 1) as i64,
                        converted
                    ])?;
                    inserted += 1;
                    if !normalize_converted_verse(&converted).is_empty() {
                        non_empty += 1;
                    }
                    inserted_books.insert(book);
                }
            }
        }
        drop(insert);
        if inserted == 0 || non_empty == 0 {
            return Err(ConvertError(format!(
                "TheWord module has no non-empty verse text: {}",
                file_name(input)
            )));
        }
        let mut book_stmt = tx.prepare(
            "INSERT INTO books (book_number, book_color, short_name, long_name, sorting_order) VALUES (?1, ?2, ?3, ?4, ?5)",
        )?;
        for book in get_books(&handle) {
            if !inserted_books.contains(&book.book_number) {
                continue;
            }
            book_stmt.execute(params![
                book.book_number as i64,
                rusqlite::types::Null,
                book.short_name,
                book.long_name,
                rusqlite::types::Null
            ])?;
        }
    }
    tx.commit()?;
    drop(conn);
    Ok(output)
}

fn meta_first(handle: &TheWordBible, keys: &[&str]) -> String {
    for key in keys {
        if let Some(value) = handle.metadata.get(*key) {
            if !value.is_empty() {
                return value.clone();
            }
        }
    }
    String::new()
}

fn module_kind(ext: &str) -> Option<VerseScope> {
    match ext {
        ".nt" | ".ntx" => Some(VerseScope::Nt),
        ".ot" | ".otx" => Some(VerseScope::Ot),
        ".ont" | ".ontx" => Some(VerseScope::Full),
        _ => None,
    }
}

fn infer_scope(kind: VerseScope, total_lines: usize) -> Option<VerseScope> {
    let can_nt = total_lines >= nt_verse_count();
    let can_ot = total_lines >= ot_verse_count();
    let can_full = total_lines >= total_verse_count();
    match kind {
        VerseScope::Nt => can_nt.then_some(VerseScope::Nt),
        VerseScope::Ot | VerseScope::Full => {
            if can_full {
                Some(VerseScope::Full)
            } else if can_ot {
                Some(VerseScope::Ot)
            } else if can_nt {
                Some(VerseScope::Nt)
            } else {
                None
            }
        }
    }
}

fn verse_index_for(scope: VerseScope) -> HashMap<u16, HashMap<u16, VerseIndexEntry>> {
    match scope {
        VerseScope::Nt => build_verse_index(true),
        VerseScope::Full => build_verse_index(false),
        VerseScope::Ot => {
            let mut index = build_verse_index(false);
            index.retain(|book, _| *book < 470);
            index
        }
    }
}

fn decode_theword_text(raw: &[u8]) -> String {
    let (bytes, force_utf8) =
        if raw.len() >= 3 && raw[0] == 0xEF && raw[1] == 0xBB && raw[2] == 0xBF {
            (&raw[3..], true)
        } else {
            (raw, false)
        };
    let mut text = if force_utf8 {
        String::from_utf8_lossy(bytes).into_owned()
    } else {
        match std::str::from_utf8(bytes) {
            Ok(text) => text.to_string(),
            Err(_) => bytes.iter().map(|byte| char::from(*byte)).collect(),
        }
    };
    if text.starts_with('\u{feff}') {
        text.remove(0);
    }
    text
}

fn split_lines(raw: &str) -> Vec<String> {
    let mut lines: Vec<String> = raw
        .split('\n')
        .map(|line| line.trim_end_matches('\r').to_string())
        .collect();
    if lines.last().is_some_and(|line| line.is_empty()) {
        lines.pop();
    }
    lines
}

fn has_visible_verse_text(raw_line: &str) -> bool {
    !normalize_for_presence(&convert_tags(raw_line)).is_empty()
}

fn normalize_for_presence(text: &str) -> String {
    let cleaned = text.replace('\r', "").replace('\u{00a0}', " ");
    tag_strip_re().replace_all(&cleaned, " ").trim().to_string()
}

fn normalize_converted_verse(text: &str) -> String {
    normalize_for_presence(text)
}

fn strong_sample_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"<W[HG][0-9]").unwrap())
}

#[cfg(test)]
fn valid_head_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?i)^(?:<wt>|<TS>|\s*\S)").unwrap())
}

fn tag_strip_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"<[^>]+>").unwrap())
}

struct TwRegex {
    ts2: Regex,
    ts: Regex,
    fo: Regex,
    fi: Regex,
    rf: Regex,
    vblock: Regex,
    vtag: Regex,
    cm: Regex,
    cl: Regex,
    wt_my: Regex,
    strong_my: Regex,
    bare_my: Regex,
    wt_pr: Regex,
    strong_pr: Regex,
    bare_pr: Regex,
    hcode: Regex,
    wt_open: Regex,
    wt_morph: Regex,
    whg: Regex,
    nb: Regex,
    fr: Regex,
}

fn tw_re() -> &'static TwRegex {
    static RE: OnceLock<TwRegex> = OnceLock::new();
    RE.get_or_init(|| TwRegex {
        ts2: Regex::new(r"(?i)<TS2>([\s\S]*?)<Ts>").unwrap(),
        ts: Regex::new(r"(?i)<TS>[\s\S]*?<Ts>").unwrap(),
        fo: Regex::new(r"(?i)<fo>").unwrap(),
        fi: Regex::new(r"(?i)<FI>([\s\S]*?)<Fi>").unwrap(),
        rf: Regex::new(r"(?i)<RF[^>]*>([\s\S]*?)<Rf>").unwrap(),
        vblock: Regex::new(r"(?i)<V1\{>[\s\S]*?<V1\}>").unwrap(),
        vtag: Regex::new(r"(?i)<V[12][^>]*>").unwrap(),
        cm: Regex::new(r"(?i)<CM>").unwrap(),
        cl: Regex::new(r"(?i)<CL>").unwrap(),
        wt_my: Regex::new(r"(?i)<wt>([^<]*)((?:<W[HG][^>]*>(?:<WT[^>]*>)?)+)").unwrap(),
        strong_my: Regex::new(r#"(?i)<W[HG]([^>]*)>(?:<WT([^ >]*?)(?:\s+l="([^"]*)")?>)?"#)
            .unwrap(),
        bare_my: Regex::new(r"(?i)<W([HG])([^>]*)>").unwrap(),
        wt_pr: Regex::new(r"(?i)<wt>([^<]*)((?:<W[HG][0-9]+[A-Za-z0-9_]*>(?:<WT[^>]*>)?)+)")
            .unwrap(),
        strong_pr: Regex::new(
            r#"(?i)<W([HG])([0-9]+[A-Za-z0-9_]*)>(?:<WT([^ >]*?)(?:\s+l="([^"]*)")?>)?"#,
        )
        .unwrap(),
        bare_pr: Regex::new(r"(?i)<W([HG])([0-9]+[A-Za-z0-9_]*)>").unwrap(),
        hcode: Regex::new(r"(?i)<H[0-9]+[A-Za-z0-9_]*>").unwrap(),
        wt_open: Regex::new(r"(?i)<wt>").unwrap(),
        wt_morph: Regex::new(r"(?i)<WT[^>]*>").unwrap(),
        whg: Regex::new(r"(?i)<W[HG][^>]*>").unwrap(),
        nb: Regex::new(r"(?i)</?nb>").unwrap(),
        fr: Regex::new(r"(?i)<fr>").unwrap(),
    })
}

fn convert_theword_line(line: &str, mybible: bool) -> String {
    if !line.contains('<') {
        return line.to_string();
    }
    let re = tw_re();
    let mut result = line.to_string();
    if mybible {
        result = re.ts2.replace_all(&result, "<h>$1</h>").into_owned();
    }
    result = re.ts.replace_all(&result, "").into_owned();
    if mybible {
        result = result.replace("<FR>", "<J>").replace("<Fr>", "</J>");
    } else {
        result = re.fr.replace_all(&result, "").into_owned();
    }
    result = re.fo.replace_all(&result, "").into_owned();
    result = re.fi.replace_all(&result, "<i>$1</i>").into_owned();
    result = re.rf.replace_all(&result, "<f>$1</f>").into_owned();
    result = re.vblock.replace_all(&result, "").into_owned();
    result = re.vtag.replace_all(&result, "").into_owned();
    result = re.cm.replace_all(&result, "<pb/>").into_owned();
    result = re.cl.replace_all(&result, "<pb/>").into_owned();
    if mybible {
        result = re
            .wt_my
            .replace_all(&result, |caps: &Captures| {
                let word = caps.get(1).map(|m| m.as_str()).unwrap_or("");
                let block = caps.get(2).map(|m| m.as_str()).unwrap_or("");
                format!("{word}{}", strongs_mybible(block))
            })
            .into_owned();
        result = re
            .bare_my
            .replace_all(&result, |caps: &Captures| {
                let raw = caps.get(2).map(|m| m.as_str()).unwrap_or("");
                let number = normalize_strong_number(Some(raw));
                if number.is_empty() {
                    String::new()
                } else {
                    format!("<S>{number}</S>")
                }
            })
            .into_owned();
    } else {
        result = re
            .wt_pr
            .replace_all(&result, |caps: &Captures| {
                let word = caps.get(1).map(|m| m.as_str()).unwrap_or("");
                let block = caps.get(2).map(|m| m.as_str()).unwrap_or("");
                format!("{word}{}", strongs_provider(block))
            })
            .into_owned();
        result = re
            .bare_pr
            .replace_all(&result, |caps: &Captures| {
                let prefix = caps.get(1).map(|m| m.as_str()).unwrap_or("").to_uppercase();
                let number = caps.get(2).map(|m| m.as_str()).unwrap_or("");
                format!("<S>{prefix}{number}</S>")
            })
            .into_owned();
    }
    result = re.hcode.replace_all(&result, "").into_owned();
    result = re.wt_open.replace_all(&result, "").into_owned();
    result = re.wt_morph.replace_all(&result, "").into_owned();
    result = re.whg.replace_all(&result, "").into_owned();
    result = re.nb.replace_all(&result, "").into_owned();
    if mybible {
        result = sanitize_supported_tags(Some(&result));
        result = sanitize_strong_tags(Some(&result));
    }
    result
}

fn strongs_mybible(block: &str) -> String {
    let mut tags = String::new();
    for caps in tw_re().strong_my.captures_iter(block) {
        let raw = caps.get(1).map(|m| m.as_str()).unwrap_or("");
        let number = normalize_strong_number(Some(raw));
        if number.is_empty() {
            continue;
        }
        let morph = caps.get(2).map(|m| m.as_str()).unwrap_or("");
        let lemma = caps.get(3).map(|m| m.as_str()).unwrap_or("");
        tags.push_str(&format!("<S>{number}</S>"));
        if !morph.is_empty() {
            tags.push_str(&format!("<m>{morph}</m>"));
        }
        if !lemma.is_empty() {
            tags.push_str(&format!("<l>{lemma}</l>"));
        }
    }
    tags
}

fn strongs_provider(block: &str) -> String {
    let mut tags = String::new();
    for caps in tw_re().strong_pr.captures_iter(block) {
        let prefix = caps.get(1).map(|m| m.as_str()).unwrap_or("").to_uppercase();
        let number = caps.get(2).map(|m| m.as_str()).unwrap_or("");
        let morph = caps.get(3).map(|m| m.as_str()).unwrap_or("");
        let lemma = caps.get(4).map(|m| m.as_str()).unwrap_or("");
        let mut attrs = Vec::new();
        if !morph.is_empty() {
            attrs.push(format!("morph=\"{morph}\""));
        }
        if !lemma.is_empty() {
            attrs.push(format!("lemma=\"{lemma}\""));
        }
        let attr = if attrs.is_empty() {
            String::new()
        } else {
            format!(" {}", attrs.join(" "))
        };
        tags.push_str(&format!("<S{attr}>{prefix}{number}</S>"));
    }
    tags
}

#[cfg(test)]
#[path = "bible_tests.rs"]
mod tests;
