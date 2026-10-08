use super::*;
use crate::convert::convert_file;
use graphe_domain::books::GRAPHE_BOOK_NUMBERS;
use regex::Regex;
use rusqlite::Connection;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

fn write_numbered(dir: &Path, name: &str, count: usize, metadata: &[&str]) -> PathBuf {
    let mut lines = Vec::with_capacity(count);
    for index in 0..count {
        lines.push(format!("Verse {}", index + 1));
    }
    write_lines(dir, name, &lines, metadata)
}

fn write_lines(dir: &Path, name: &str, lines: &[String], metadata: &[&str]) -> PathBuf {
    let mut body = lines.join("\n");
    body.push('\n');
    for line in metadata {
        body.push_str(line);
        body.push('\n');
    }
    let path = dir.join(name);
    fs::write(&path, body).unwrap();
    path
}

fn info_map(conn: &Connection) -> HashMap<String, String> {
    let mut stmt = conn.prepare("SELECT name, value FROM info").unwrap();
    let rows = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .unwrap();
    rows.filter_map(Result::ok).collect()
}

fn strong_contents_are_digits(text: &str) -> bool {
    let re = Regex::new(r"<S>(.*?)</S>").unwrap();
    let mut any = false;
    for caps in re.captures_iter(text) {
        any = true;
        if !caps[1].chars().all(|ch| ch.is_ascii_digit()) {
            return false;
        }
    }
    any
}

#[test]
fn provider_convert_tags_matches_theword_fixtures() {
    assert_eq!(
        convert_tags("<wt>word<WH1234><WTmorph l=\"lemma\">"),
        "word<S morph=\"morph\" lemma=\"lemma\">H1234</S>"
    );
    assert_eq!(
        convert_tags("<wt>logos<WG3056><WTverb l=\"say\">"),
        "logos<S morph=\"verb\" lemma=\"say\">G3056</S>"
    );
    assert_eq!(
        convert_tags("<wt>word<WH1234><WTmorph1 l=\"lem1\"><WH5678><WTmorph2 l=\"lem2\">"),
        "word<S morph=\"morph1\" lemma=\"lem1\">H1234</S><S morph=\"morph2\" lemma=\"lem2\">H5678</S>"
    );
    assert_eq!(convert_tags("<wt>word<WH1234>"), "word<S>H1234</S>");
    assert_eq!(
        convert_tags("text <RF>footnote content<Rf> more"),
        "text <f>footnote content</f> more"
    );
    assert_eq!(
        convert_tags("some <FI>italic text<Fi> here"),
        "some <i>italic text</i> here"
    );
    assert_eq!(convert_tags("line1<CM>line2"), "line1<pb/>line2");
    assert_eq!(convert_tags("line1<CL>line2"), "line1<pb/>line2");
    assert_eq!(
        convert_tags("<TS>Title Text<Ts>verse content"),
        "verse content"
    );
    assert_eq!(convert_tags("<FR>Jesus said<Fr>"), "Jesus said");
    assert_eq!(convert_tags("<FO>quoted text<Fo>"), "quoted text");
    assert_eq!(convert_tags("text<V1{>variant stuff<V1}>more"), "textmore");
    assert_eq!(convert_tags("word<WH1234>"), "word<S>H1234</S>");
    assert_eq!(convert_tags("word<WH1254><H8804>"), "word<S>H1254</S>");
    let complex = convert_tags(
        "<TS>Section<Ts><FR><wt>In<WH1234><WTnoun l=\"begin\"><Fr> the <FI>beginning<Fi><CM>",
    );
    assert!(complex.contains("In<S morph=\"noun\" lemma=\"begin\">H1234</S>"));
    assert!(complex.contains("<i>beginning</i>"));
    assert!(complex.contains("<pb/>"));
    assert!(!complex.contains("<TS>"));
    assert!(!complex.contains("<FR>"));
}

#[test]
fn mybible_tag_conversion_matches_converter_fixtures() {
    assert_eq!(
        convert_tags_to_mybible("<wt>word<WH1234><WTmorph l=\"lemma\">"),
        "word<S>1234</S><m>morph</m><l>lemma</l>"
    );
    assert_eq!(
        convert_tags_to_mybible("<wt>logos<WG3056><WTverb l=\"say\">"),
        "logos<S>3056</S><m>verb</m><l>say</l>"
    );
    assert_eq!(
        convert_tags_to_mybible(
            "<wt>word<WH1234><WTmorph1 l=\"lem1\"><WH5678><WTmorph2 l=\"lem2\">"
        ),
        "word<S>1234</S><m>morph1</m><l>lem1</l><S>5678</S><m>morph2</m><l>lem2</l>"
    );
    let bare = convert_tags_to_mybible("<wt>word<WH1234>");
    assert_eq!(bare, "word<S>1234</S>");
    assert!(!bare.contains("<m>"));
    assert_eq!(
        convert_tags_to_mybible("<FR>Jesus said<Fr>"),
        "<J>Jesus said</J>"
    );
    assert_eq!(
        convert_tags_to_mybible("some <FI>italic text<Fi> here"),
        "some <i>italic text</i> here"
    );
    assert_eq!(
        convert_tags_to_mybible("text <RF>footnote content<Rf> more"),
        "text <f>footnote content</f> more"
    );
    assert_eq!(convert_tags_to_mybible("line1<CM>line2"), "line1<pb/>line2");
    assert_eq!(convert_tags_to_mybible("line1<CL>line2"), "line1<pb/>line2");
    assert_eq!(
        convert_tags_to_mybible("<TS>Title Text<Ts>verse content"),
        "verse content"
    );
    assert_eq!(
        convert_tags_to_mybible("<TS2>O CÉU E A TERRA<Ts>verse content"),
        "<h>O CÉU E A TERRA</h>verse content"
    );
    assert_eq!(
        convert_tags_to_mybible("text<TS2>Heading 1<Ts>middle<TS2>Heading 2<Ts>end"),
        "text<h>Heading 1</h>middle<h>Heading 2</h>end"
    );
    assert_eq!(
        convert_tags_to_mybible("<FO>quoted text<Fo>"),
        "quoted text"
    );
    assert_eq!(
        convert_tags_to_mybible("text<V1{>variant stuff<V1}>more"),
        "textmore"
    );
    assert!(strong_contents_are_digits(&convert_tags_to_mybible(
        "<wt>beginning<WH7225><WTnoun>"
    )));
    assert_eq!(convert_tags_to_mybible("word<WH1234>"), "word<S>1234</S>");
    assert_eq!(
        convert_tags_to_mybible("word<WH1254><H8804>"),
        "word<S>1254</S>"
    );
    assert_eq!(
        convert_tags_to_mybible("criou<WH1254><H8804><WH853>"),
        "criou<S>1254</S><S>853</S>"
    );
    let mixed =
        convert_tags_to_mybible("No princípio,<WH7225> criou<WH1254><H8804><WH853> Deus<WH430>");
    assert!(mixed.contains("<S>7225</S>"));
    assert!(mixed.contains("<S>1254</S>"));
    assert!(mixed.contains("<S>853</S>"));
    assert!(mixed.contains("<S>430</S>"));
    assert!(!Regex::new(r"(?i)<H[0-9]+>").unwrap().is_match(&mixed));
    assert!(!Regex::new(r"(?i)<W[HG][0-9]+>").unwrap().is_match(&mixed));
    let complex = convert_tags_to_mybible(
        "<TS>Section<Ts><FR><wt>In<WH1234><WTnoun l=\"begin\"><Fr> the <FI>beginning<Fi><CM>",
    );
    for piece in [
        "<J>",
        "</J>",
        "<S>1234</S>",
        "<m>noun</m>",
        "<l>begin</l>",
        "<i>beginning</i>",
        "<pb/>",
    ] {
        assert!(complex.contains(piece), "{complex}");
    }
    assert!(!complex.contains("<TS>"));
    assert!(!complex.contains("<FR>"));
    assert!(!complex.contains("H1234"));
    assert_eq!(
        convert_tags_to_mybible("A<font color=red>B</font><sup>C</sup><v>D</v><pb/>E"),
        "ABCD<pb/>E"
    );
    assert_eq!(
        convert_tags_to_mybible("one<WG1161x> two<WH5555(> three<WG3156>"),
        "one<S>1161</S> two<S>5555</S> three<S>3156</S>"
    );
    let inter = convert_tags_to_mybible(
        "<wt><E>Word<e><O>Λόγος<o><T>lógos<t><WG3056><WTN-NSM l=\"λόγος\">",
    );
    assert!(inter.contains("<E>Word<e>"));
    assert!(inter.contains("<O>Λόγος<o>"));
    assert!(inter.contains("<T>lógos<t>"));
    assert!(inter.contains("<S>3056</S>"));
    assert!(convert_tags_to_mybible("<E>Word<e><X>pr=test<x>").contains("<X>pr=test<x>"));
}

#[test]
fn encrypted_ontx_is_a_valid_file_but_load_rejects_it() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("enc.ontx");
    fs::write(&path, b"TWENCBMOD\x00\x01\x02\x03").unwrap();
    let err = load(&path).unwrap_err();
    assert!(err.to_string().contains("Encrypted TheWord Bible"), "{err}");
    assert!(is_valid_file(&path));
}

#[test]
fn loads_utf8_bom_and_latin1_nt_modules() {
    let dir = tempfile::tempdir().unwrap();
    let sentence = "No princípio criou Deus o céu e a terra.";
    let mut lines = vec![String::new(); nt_verse_count()];
    lines[0] = sentence.to_string();
    let mut body = lines.join("\n");
    body.push('\n');
    let utf8 = dir.path().join("sample-utf8-bom.nt");
    let mut bytes = vec![0xEF, 0xBB, 0xBF];
    bytes.extend(body.as_bytes());
    fs::write(&utf8, bytes).unwrap();
    let handle = load(&utf8).unwrap();
    let chapter = get_chapter(&handle, 470, 1);
    assert_eq!(chapter[0].text, sentence);
    assert!(!chapter[0].text.contains('Ã'));
    assert!(!chapter[0].text.contains("ï»¿"));

    let latin = "Estes últimos se haviam concentrado no vale de Sidim (que agora é o mar Morto).";
    let mut lines = vec![String::new(); nt_verse_count()];
    lines[0] = latin.to_string();
    let mut body = lines.join("\n");
    body.push('\n');
    let encoded: Vec<u8> = body
        .chars()
        .map(|ch| u8::try_from(u32::from(ch)).unwrap())
        .collect();
    let path = dir.path().join("sample-latin1.nt");
    fs::write(&path, encoded).unwrap();
    let handle = load(&path).unwrap();
    let chapter = get_chapter(&handle, 470, 1);
    assert_eq!(chapter[0].text, latin);
    assert!(!chapter[0].text.contains('\u{fffd}'));
}

#[test]
fn loads_ot_scopes_and_hides_empty_placeholders() {
    let dir = tempfile::tempdir().unwrap();
    let ot = write_numbered(
        dir.path(),
        "sample.ot",
        ot_verse_count(),
        &["description=Sample OT"],
    );
    let handle = load(&ot).unwrap();
    assert_eq!(handle.format, "theword-bible");
    assert!(handle.file_path.ends_with("sample.ot"));
    assert_eq!(handle.scope.as_str(), "ot");
    assert!(handle.is_ot_only);
    assert!(!handle.is_nt_only);
    let books = get_books(&handle);
    assert_eq!(books.len(), 39);
    assert_eq!(books[0].book_number, 10);
    assert_eq!(books.last().unwrap().book_number, 460);
    let gen = get_chapter(&handle, 10, 1);
    assert_eq!(gen.len(), 31);
    assert_eq!(gen[0].verse, 1);
    assert_eq!(gen[0].text, "Verse 1");
    assert!(get_chapter(&handle, 470, 1).is_empty());

    let full = write_numbered(
        dir.path(),
        "sample-full.ot",
        total_verse_count(),
        &["description=Sample Full"],
    );
    let handle = load(&full).unwrap();
    assert_eq!(handle.scope.as_str(), "full");
    assert!(!handle.is_ot_only && !handle.is_nt_only);
    assert_eq!(get_books(&handle).len(), 66);
    assert!(!get_chapter(&handle, 470, 1).is_empty());
    assert!(is_valid_file(&ot));

    let mut sparse = vec![String::new(); total_verse_count()];
    sparse[0] = "Verse 1".into();
    sparse[1] = "Verse 2".into();
    let path = write_lines(
        dir.path(),
        "sparse-full.ot",
        &sparse,
        &["description=Sparse OT-like"],
    );
    let handle = load(&path).unwrap();
    assert_eq!(handle.scope.as_str(), "full");
    assert_eq!(handle.effective_scope.as_str(), "ot");
    assert!(handle.is_ot_only && !handle.is_nt_only);
    assert_eq!(handle.non_empty_verse_count, 2);
    assert_eq!(
        get_books(&handle)
            .iter()
            .map(|book| book.book_number)
            .collect::<Vec<_>>(),
        vec![10]
    );
    let gen = get_chapter(&handle, 10, 1);
    assert_eq!(
        gen.iter().map(|verse| verse.verse).collect::<Vec<_>>(),
        vec![1, 2]
    );
    assert!(gen.iter().all(|verse| !verse.text.trim().is_empty()));
    assert!(get_chapter(&handle, 470, 1).is_empty());
    assert_eq!(get_chapter_count(&handle, 470), 0);
    let _ = GRAPHE_BOOK_NUMBERS;
}

#[test]
fn converts_ont_fixture_and_sparse_or_empty_ot_files() {
    let dir = tempfile::tempdir().unwrap();
    let total = total_verse_count();
    let mut lines = vec![String::new(); total];
    lines[0] = "<wt>In<WH7225><WTN l=\"beginning\"> the beginning".into();
    lines[1] = "2 And the earth was without form".into();
    let ont = write_lines(
        dir.path(),
        "fixture-strong.ont",
        &lines,
        &["description=Fixture Bible", "short.title=FX", "lang=en"],
    );
    let output = convert_file(&ont, dir.path()).unwrap();
    assert!(output.to_string_lossy().ends_with(".SQLite3"));
    let db = Connection::open(&output).unwrap();
    let info = info_map(&db);
    assert!(!info.get("description").unwrap().is_empty());
    let books: i64 = db
        .query_row("SELECT COUNT(*) FROM books", [], |row| row.get(0))
        .unwrap();
    assert!(books > 0);
    let verse: (i64, String) = db
        .query_row(
            "SELECT verse, text FROM verses WHERE book_number = 10 AND chapter = 1 ORDER BY verse LIMIT 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!(verse.0, 1);
    assert_eq!(verse.1, convert_tags_to_mybible(&lines[0]));
    let mut stmt = db
        .prepare("SELECT text FROM verses WHERE book_number = 10 AND chapter = 1 ORDER BY verse LIMIT 10")
        .unwrap();
    let texts: Vec<String> = stmt
        .query_map([], |row| row.get(0))
        .unwrap()
        .filter_map(Result::ok)
        .collect();
    let raw_wt = Regex::new(r"(?i)<wt>").unwrap();
    let raw_w = Regex::new(r"(?i)<W[HG][0-9]").unwrap();
    let raw_morph = Regex::new(r"(?i)<WT[^>]*>").unwrap();
    for text in &texts {
        assert!(!raw_wt.is_match(text));
        assert!(!raw_w.is_match(text));
        assert!(!raw_morph.is_match(text));
        assert!(!text.contains("<FR>"));
    }
    let strong = texts.iter().find(|text| text.contains("<S>")).unwrap();
    assert!(strong_contents_are_digits(strong));

    let sparse_dir = tempfile::tempdir().unwrap();
    let mut sparse = vec![String::new(); total];
    sparse[0] = "1 In the beginning".into();
    sparse[1] = "2 And the earth was without form".into();
    let input = write_lines(
        sparse_dir.path(),
        "sparse.ot",
        &sparse,
        &["description=Sparse OT"],
    );
    let output = convert_file(&input, sparse_dir.path()).unwrap();
    let db = Connection::open(&output).unwrap();
    let empty: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM verses WHERE trim(replace(replace(text, char(13), ''), char(10), '')) = ''",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert!(empty > 0);
    let has_gen: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM books WHERE book_number = 10",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert!(has_gen > 0);
    let ot: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM verses WHERE book_number < 470",
            [],
            |row| row.get(0),
        )
        .unwrap();
    let all: i64 = db
        .query_row("SELECT COUNT(*) FROM verses", [], |row| row.get(0))
        .unwrap();
    let nt: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM verses WHERE book_number >= 470",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(ot as usize, ot_verse_count());
    assert_eq!(all as usize, total);
    assert_eq!(nt as usize, total - ot_verse_count());

    let empty_dir = tempfile::tempdir().unwrap();
    let blanks = vec![String::new(); total];
    let input = write_lines(
        empty_dir.path(),
        "empty.ot",
        &blanks,
        &["description=Empty"],
    );
    let err = convert_file(&input, empty_dir.path()).unwrap_err();
    assert!(
        err.to_string()
            .to_lowercase()
            .contains("no non-empty verse text"),
        "{err}"
    );
}
