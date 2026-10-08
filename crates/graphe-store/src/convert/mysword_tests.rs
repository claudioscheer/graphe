use super::*;
use crate::convert::convert_file;
use regex::Regex;
use rusqlite::{params, Connection};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

fn tags(text: &str) -> String {
    convert_mysword_tags(text)
}

fn strong_digits(text: &str) -> bool {
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
fn converts_mysword_inline_tags() {
    assert!(tags("word<WH1234>").contains("<S>1234</S>"));
    assert!(tags("word<WG5678>").contains("<S>5678</S>"));
    let morph = tags("<WG976><WTN-NSF l=\"βίβλος\">");
    assert!(morph.contains("<S>976</S>"));
    assert!(morph.contains("<m>N-NSF</m>"));
    assert!(morph.contains("<l>βίβλος</l>"));
    let morph_only = tags("<WG976><WTN-NSF>");
    assert!(morph_only.contains("<S>976</S>") && morph_only.contains("<m>N-NSF</m>"));
    assert!(!morph_only.contains("<l>"));
    assert!(!Regex::new(r"(?i)<W>[0-9]+<w>")
        .unwrap()
        .is_match(&tags("<T>biblos<t><G>βιβλοσ<g><W>1<w>")));
    let brackets = tags("「<T>biblos<t>」");
    assert!(!brackets.contains('「') && !brackets.contains('」'));
    assert!(tags("line1<br>line2").contains("<pb/>"));
    assert!(tags("line1<br/>line2").contains("<pb/>"));
    assert_eq!(
        tags("text <RF q=✮>footnote content<Rf> more"),
        "text <f>footnote content</f> more"
    );
    assert!(tags("<T>lógos<t>").contains("<T>lógos<t>"));
    assert_eq!(
        tags("In the beginning God created"),
        "In the beginning God created"
    );
    assert_eq!(tags(""), "");
    assert!(strong_digits(&tags("<WH7225><WG976>")));
    let hb = tags("<Q>בְּרֵאשִׁ֖ית<WH7225><q><Q>בָּרָ֣א<WH1254><q>");
    assert!(hb.contains("<S>7225</S>") && hb.contains("<S>1254</S>"));
    assert!(!Regex::new(r"(?i)<WH").unwrap().is_match(&hb));
    let ogn = tags("<WG2455><WTN-NSM-P l=\"Ἰούδας\">");
    assert!(
        ogn.contains("<S>2455</S>")
            && ogn.contains("<m>N-NSM-P</m>")
            && ogn.contains("<l>Ἰούδας</l>")
    );
    let labels = tags("<HEB>HEB </HEB>some hebrew text<br><TRA>TRA </TRA>transliteration");
    assert!(!Regex::new(r"(?i)</?HEB>").unwrap().is_match(&labels));
    assert!(!Regex::new(r"(?i)</?TRA>").unwrap().is_match(&labels));
    assert!(labels.contains("<h>HEB</h>") && labels.contains("<h>TRA</h>"));
    assert_eq!(
        tags("「<T>biblos<t><G>βιβλοσ<g><W>1<w>」").trim(),
        "<E>βιβλοσ<e><T>biblos<t>"
    );
    assert_eq!(tags("「<G>βιβλοσ<g><W>1<w>」").trim(), "<E>βιβλοσ<e>");
    assert!(
        tags("「<T>biblos<t><G>βιβλοσ<g><W>1<w>」「<T>geneseōs<t><G>γενεσεωσ<g><W>2<w>」")
            .contains("<t> <E>")
    );
    assert_eq!(tags("<G>λόγος<g>"), "<E>λόγος<e>");
    let plain = tags("「<T>biblos<t>」");
    assert!(plain.contains("<T>biblos<t>") && !plain.contains('「') && !plain.contains('」'));
    let na28 = tags("「<T>biblos<t><G>βιβλοσ<g><W>1<w>」\n「<T>geneseōs<t><G>γενεσεωσ<g><W>2<w>」");
    assert!(!na28.contains('「') && !na28.contains('」'));
    assert!(!Regex::new(r"<W>[0-9]+<w>").unwrap().is_match(&na28));
    assert!(!na28.contains("<G>"));
    assert!(na28.contains("<E>βιβλοσ<e><T>biblos<t>"));
    assert!(na28.contains("<E>γενεσεωσ<e><T>geneseōs<t>"));
    let full_hb = tags("<HEB>HEB </HEB><Q>בְּרֵאשִׁ֖ית<WH7225><q><Q>בָּרָ֣א<WH1254><q><Q>אֱלֹהִ֑ים<WH430><q><br><br><TRA>TRA </TRA>bereshit bara elohim");
    assert!(
        full_hb.contains("<S>7225</S>")
            && full_hb.contains("<S>1254</S>")
            && full_hb.contains("<S>430</S>")
    );
    assert!(!Regex::new(r"(?i)<WH").unwrap().is_match(&full_hb));
    assert!(!Regex::new(r"(?i)</?HEB>").unwrap().is_match(&full_hb));
    assert!(full_hb.contains("bereshit bara elohim"));
    let stripped = tags("<Tr>Biblos</Tr><Mn>Βίβλος</Mn>");
    assert!(stripped.contains("Biblos") && stripped.contains("Βίβλος"));
    assert!(!Regex::new(r"(?i)</?Tr>").unwrap().is_match(&stripped));
    assert!(!Regex::new(r"(?i)</?Mn>").unwrap().is_match(&stripped));
    let ognte = tags(concat!(
        "「<Tr>Biblos</Tr><Cla><a class=\"d\" href=\"d-OGNTd 000001\">viyvlos</a></Cla>",
        "<Mn>Βίβλος</Mn><Wn>1</wn><Ko>Βιβλος</ko>",
        "<WG976><WTN-NSF l=\"βίβλος\">",
        "<LN><a class=\"Lw\" href=\"d-LouwNida 33.38\">33.38</a></LN>",
        "<GN>1047</Gn><Pbr>Livro</Pbr><Es>Libro</es><Og>book</og>」"
    ));
    for piece in [
        "<E>Βίβλος<e>",
        "<T>Biblos<t>",
        "<S>976</S>",
        "<m>N-NSF</m>",
        "<l>βίβλος</l>",
        "<X>",
        "pr=viyvlos",
        "pbr=Livro",
        "es=Libro",
        "og=book",
        "ln=33.38",
        "gk=1047",
    ] {
        assert!(ognte.contains(piece), "{piece} missing in {ognte}");
    }
    assert!(!Regex::new(r"(?i)<Wn>").unwrap().is_match(&ognte));
    assert!(!Regex::new(r"(?i)<Ko>").unwrap().is_match(&ognte));
    assert!(!ognte.contains('「') && !ognte.contains('」'));
    let variant = tags("word＊<Vr><b>IMNW: </b><Vg>Χριστοῦ</Vg></vr>next");
    assert!(!variant.contains("IMNW") && !variant.contains('＊'));
    assert!(!Regex::new(r"(?i)</?Vr>").unwrap().is_match(&variant));
    assert!(variant.contains("word") && variant.contains("next"));
    let many = tags(concat!(
        "「<Tr>Biblos</Tr><Mn>Βίβλος</Mn><WG976><WTN-NSF l=\"βίβλος\">」,",
        "「<Tr>geneseōs</Tr><Mn>γενέσεως</Mn><WG1078><WTN-GSF l=\"γένεσις\">」,&",
        "「<Tr>Iēsou</Tr><Mn>Ἰησοῦ</Mn><WG2424><WTN-GSM-P l=\"Ἰησοῦς\">」"
    ));
    assert!(
        many.contains("<E>Βίβλος<e>")
            && many.contains("<E>γενέσεως<e>")
            && many.contains("<E>Ἰησοῦ<e>")
    );
    assert!(!many.contains(",&"));
    assert!(!Regex::new(r",\s*<E>").unwrap().is_match(&many));
    assert_eq!(
        tags("「<T>biblos<t><G>βιβλοσ<g><W>1<w>」").trim(),
        "<E>βιβλοσ<e><T>biblos<t>"
    );
    let ln = tags(concat!(
        "「<Tr>geneseōs</Tr><Mn>γενέσεως</Mn><WG1078><WTN-GSF l=\"γένεσις\">",
        "<LN><a class=\"Lw\" href=\"d-LouwNida 10.24\">10.24</a>，<a class=\"Lw\" href=\"d-LouwNida 33.19\">33.19</a></LN>",
        "<GN>1161</Gn>」"
    ));
    assert!(ln.contains("ln=10.24, 33.19"), "{ln}");
}

fn support() -> &'static Path {
    static DIR: OnceLock<tempfile::TempDir> = OnceLock::new();
    DIR.get_or_init(|| {
        let dir = tempfile::tempdir().unwrap();
        write_fixtures(dir.path());
        dir
    })
    .path()
}

fn write_bible(
    path: &Path,
    scripture: &str,
    rows: &[(i64, i64, i64, String)],
    details: (&str, &str, &str, &str),
) {
    let db = Connection::open(path).unwrap();
    db.execute_batch(&format!(
        "CREATE TABLE Details (Title TEXT, Description TEXT, Abbreviation TEXT, Language TEXT);
         CREATE TABLE Bible (Book INTEGER, Chapter INTEGER, Verse INTEGER, \"{scripture}\" TEXT);"
    ))
    .unwrap();
    db.execute(
        "INSERT INTO Details (Title, Description, Abbreviation, Language) VALUES (?1, ?2, ?3, ?4)",
        params![details.0, details.1, details.2, details.3],
    )
    .unwrap();
    let tx = db.unchecked_transaction().unwrap();
    {
        let mut insert = tx
            .prepare(&format!(
                "INSERT INTO Bible (Book, Chapter, Verse, \"{scripture}\") VALUES (?1, ?2, ?3, ?4)"
            ))
            .unwrap();
        for (book, chapter, verse, text) in rows {
            insert.execute(params![book, chapter, verse, text]).unwrap();
        }
    }
    tx.commit().unwrap();
}

fn write_dict(
    path: &Path,
    table: &str,
    strong: bool,
    lexeme: bool,
    relative: bool,
    rows: &[(&str, &str, Option<&str>)],
) {
    let db = Connection::open(path).unwrap();
    let mut extra = String::new();
    if lexeme {
        extra.push_str(", lexeme TEXT");
    }
    if relative {
        extra.push_str(", relativeorder INTEGER");
    }
    db.execute_batch(&format!(
        "CREATE TABLE Details (Title TEXT, Description TEXT, Abbreviation TEXT, Language TEXT, Strong INTEGER);
         CREATE TABLE \"{table}\" (word TEXT, data TEXT{extra});"
    ))
    .unwrap();
    let name = path.file_name().unwrap().to_string_lossy().to_string();
    let abbrev: String = name.chars().take(8).collect();
    db.execute(
        "INSERT INTO Details (Title, Description, Abbreviation, Language, Strong) VALUES (?1, ?2, ?3, 'en', ?4)",
        params![name.as_str(), name.as_str(), abbrev, if strong { 1 } else { 0 }],
    )
    .unwrap();
    let columns = if lexeme && relative {
        "word, data, lexeme, relativeorder"
    } else if lexeme {
        "word, data, lexeme"
    } else if relative {
        "word, data, relativeorder"
    } else {
        "word, data"
    };
    let marks = columns.matches(',').count() + 1;
    let placeholders = vec!["?"; marks].join(", ");
    let tx = db.unchecked_transaction().unwrap();
    let mut insert = tx
        .prepare(&format!(
            "INSERT INTO \"{table}\" ({columns}) VALUES ({placeholders})"
        ))
        .unwrap();
    for (index, (word, data, lex)) in rows.iter().enumerate() {
        let mut values = vec![
            rusqlite::types::Value::Text((*word).to_string()),
            rusqlite::types::Value::Text((*data).to_string()),
        ];
        if lexeme {
            values.push(rusqlite::types::Value::Text(
                lex.unwrap_or(word).to_string(),
            ));
        }
        if relative {
            values.push(rusqlite::types::Value::Integer((index as i64) + 1));
        }
        insert
            .execute(rusqlite::params_from_iter(values.iter()))
            .unwrap();
    }
    drop(insert);
    tx.commit().unwrap();
}

fn write_fixtures(dir: &Path) {
    let mut na28 = Vec::with_capacity(7915);
    for i in 0..7915 {
        na28.push((
            40 + (i % 27),
            (i / 200) + 1,
            (i % 200) + 1,
            "「<T>logos<t><G>λόγος<g><W>1<w>」".to_string(),
        ));
    }
    na28[0].3 = "「<T>Biblos<t><G>Βίβλος<g>」".into();
    write_bible(
        &dir.join("NA28.bbl.mybible"),
        "Scripture",
        &na28,
        ("NA28.bbl.mybible", "NA28.bbl.mybible", "NA28.bbl", "en"),
    );
    write_bible(
        &dir.join("HbGr Interlinear e Trasnliterado.bbl.mybible"),
        "scripture",
        &[
            (1, 1, 1, "בראשית<WH7225>".into()),
            (40, 1, 1, "Βίβλος<WG976>".into()),
            (66, 1, 1, "Ἀποκάλυψις<WG602>".into()),
        ],
        ("HbGr", "HbGr", "HbGr", "en"),
    );
    write_bible(
        &dir.join("GR OGNTe Br +exegese.bbl.mybible"),
        "Scripture",
        &[(
            40,
            1,
            1,
            concat!(
                "「<Tr>Biblos</Tr><Cla><a class=\"d\" href=\"d-OGNTd 000001\">viyvlos</a></Cla>",
                "<Mn>Βίβλος</Mn><Wn>1</wn><Ko>Βιβλος</ko>",
                "<WG976><WTN-NSF l=\"βίβλος\">",
                "<LN><a class=\"Lw\" href=\"d-LouwNida 33.38\">33.38</a></LN>",
                "<GN>1047</Gn><Pbr>Livro</Pbr><Es>Libro</es><Og>book</og>」"
            )
            .into(),
        )],
        ("OGNTe", "OGNTe", "OGNTe", "en"),
    );
    let normal = [
        ("Alpha", "First entry", None),
        ("Beta", "Second entry", None),
    ];
    let berean: Vec<(String, String, Option<&str>)> = (1..=25111)
        .map(|index| (format!("G{index}"), format!("Definition {index}"), None))
        .collect();
    let berean_rows: Vec<(&str, &str, Option<&str>)> = berean
        .iter()
        .map(|(word, data, lex)| (word.as_str(), data.as_str(), *lex))
        .collect();
    write_dict(
        &dir.join("Berean Strongs.dct.mybible"),
        "Dictionary",
        true,
        false,
        false,
        &berean_rows,
    );
    write_dict(
        &dir.join("THOMPSON.dct.mybible"),
        "dictionary",
        false,
        false,
        false,
        &normal,
    );
    write_dict(
        &dir.join("Léxico Gesenius.dct.mybible"),
        "Dictionary",
        false,
        true,
        false,
        &[("H7225", "Beginning", Some("reshith"))],
    );
    write_dict(
        &dir.join("Enciclopédia Mundo Bíblico.dct.mybible"),
        "Dictionary",
        false,
        false,
        true,
        &normal,
    );
    for name in [
        "Dicionario Transliterado.dct.mybible",
        "Wycliffe.dct.mybible",
        "Sermões de John MacArthur.dct.mybible",
        "Novo Dic Teologia NT_Hagnos.dct.mybible",
    ] {
        write_dict(&dir.join(name), "Dictionary", false, false, false, &normal);
    }
}

fn out_dir() -> PathBuf {
    static DIR: OnceLock<tempfile::TempDir> = OnceLock::new();
    DIR.get_or_init(|| tempfile::tempdir().unwrap())
        .path()
        .to_path_buf()
}

#[test]
fn converts_bibles_and_reads_provider_handles() {
    let input = support().join("NA28.bbl.mybible");
    let output = convert_file(&input, &out_dir()).unwrap();
    assert!(output.to_string_lossy().ends_with(".SQLite3"));
    let db = Connection::open(&output).unwrap();
    let description: String = db
        .query_row(
            "SELECT value FROM info WHERE name = 'description'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert!(!description.is_empty());
    let mut stmt = db.prepare("SELECT book_number FROM books").unwrap();
    let books: Vec<i64> = stmt
        .query_map([], |row| row.get(0))
        .unwrap()
        .filter_map(Result::ok)
        .collect();
    assert!(books.iter().all(|book| *book >= 470));
    let total: i64 = db
        .query_row("SELECT COUNT(*) FROM verses", [], |row| row.get(0))
        .unwrap();
    assert_eq!(total, 7915);
    let mut stmt = db
        .prepare("SELECT text FROM verses WHERE book_number = 470 AND chapter = 1 LIMIT 10")
        .unwrap();
    let sample: Vec<String> = stmt
        .query_map([], |row| row.get(0))
        .unwrap()
        .filter_map(Result::ok)
        .collect();
    for text in sample {
        assert!(!Regex::new(r"(?i)<W>[0-9]+<w>").unwrap().is_match(&text));
        assert!(
            !text.contains('「')
                && !text.contains('」')
                && !Regex::new(r"(?i)<G>").unwrap().is_match(&text)
        );
        assert!(text.contains("<E>"));
    }

    let hb = convert_file(
        &support().join("HbGr Interlinear e Trasnliterado.bbl.mybible"),
        &out_dir(),
    )
    .unwrap();
    let db = Connection::open(&hb).unwrap();
    let low: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM books WHERE book_number < 470",
            [],
            |row| row.get(0),
        )
        .unwrap();
    let high: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM books WHERE book_number >= 470",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert!(low > 0 && high > 0);
    for book in [10, 470, 730] {
        let count: i64 = db
            .query_row(
                "SELECT COUNT(*) FROM verses WHERE book_number = ?1",
                [book],
                |row| row.get(0),
            )
            .unwrap();
        assert!(count > 0, "{book}");
    }
    let min_book: i64 = db
        .query_row("SELECT MIN(book_number) FROM verses", [], |row| row.get(0))
        .unwrap();
    assert_eq!(min_book, 10);
    let strong: String = db
        .query_row(
            "SELECT value FROM info WHERE name = 'strong_numbers'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(strong, "true");
    let gen: String = db
        .query_row(
            "SELECT text FROM verses WHERE book_number = 10 AND chapter = 1 AND verse = 1",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert!(gen.contains("<S>7225</S>"));
    assert!(!Regex::new(r"(?i)<WH").unwrap().is_match(&gen));

    let ogn = convert_file(
        &support().join("GR OGNTe Br +exegese.bbl.mybible"),
        &out_dir(),
    )
    .unwrap();
    let db = Connection::open(&ogn).unwrap();
    let text: String = db
        .query_row(
            "SELECT text FROM verses WHERE book_number = 470 AND chapter = 1 AND verse = 1",
            [],
            |row| row.get(0),
        )
        .unwrap();
    for piece in [
        "<E>Βίβλος<e>",
        "<T>Biblos<t>",
        "<S>976</S>",
        "<m>N-NSF</m>",
        "<l>βίβλος</l>",
        "<X>",
    ] {
        assert!(text.contains(piece), "{piece} missing in {text}");
    }
    assert!(!Regex::new(r"(?i)<WG[0-9]").unwrap().is_match(&text));
    assert!(!Regex::new(r"(?i)<WT[^>]*>").unwrap().is_match(&text));
    assert!(!Regex::new(r"(?i)<Mn>").unwrap().is_match(&text));
    assert!(!Regex::new(r"(?i)<Tr>").unwrap().is_match(&text));
    assert!(!text.contains('＊') && !text.contains('「') && !text.contains('」'));

    let na = load(&support().join("NA28.bbl.mybible")).unwrap();
    assert_eq!(na.kind, "bible");
    assert!(!na.scripture_col.is_empty());
    assert!(!na.has_strongs);
    close(na);
    let hb = load(&support().join("HbGr Interlinear e Trasnliterado.bbl.mybible")).unwrap();
    assert_eq!(hb.scripture_col, "scripture");
    assert!(hb.has_strongs);
    close(hb);
    let junk = support().join("not-a-db.mybible");
    fs::write(&junk, "not a sqlite file").unwrap();
    assert!(load(&junk).is_none());
}

#[test]
fn converts_dictionary_shapes() {
    let cases = [
        ("Berean Strongs.dct.mybible", true, 25111),
        ("THOMPSON.dct.mybible", false, 2),
        ("Léxico Gesenius.dct.mybible", false, 1),
        ("Enciclopédia Mundo Bíblico.dct.mybible", false, 2),
        ("Dicionario Transliterado.dct.mybible", false, 2),
        ("Wycliffe.dct.mybible", false, 2),
        ("Sermões de John MacArthur.dct.mybible", false, 2),
        ("Novo Dic Teologia NT_Hagnos.dct.mybible", false, 2),
    ];
    for (name, strong, count) in cases {
        let output = convert_file(&support().join(name), &out_dir()).unwrap();
        assert!(output.to_string_lossy().contains(".dictionary.SQLite3"));
        let db = Connection::open(&output).unwrap();
        let rows: i64 = db
            .query_row("SELECT COUNT(*) FROM dictionary", [], |row| row.get(0))
            .unwrap();
        assert_eq!(rows, count, "{name}");
        let description: String = db
            .query_row(
                "SELECT value FROM info WHERE name = 'description'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(!description.is_empty());
        if strong {
            let flag: String = db
                .query_row(
                    "SELECT value FROM info WHERE name = 'is_strong'",
                    [],
                    |row| row.get(0),
                )
                .unwrap();
            let kind: String = db
                .query_row("SELECT value FROM info WHERE name = 'type'", [], |row| {
                    row.get(0)
                })
                .unwrap();
            assert_eq!(flag, "true");
            assert_eq!(kind, "strong lexicon");
        }
        if name.starts_with("Léxico") {
            let lexeme: String = db
                .query_row(
                    "SELECT lexeme FROM dictionary WHERE topic = 'H7225'",
                    [],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(lexeme, "reshith");
            let mut stmt = db.prepare("PRAGMA table_info(dictionary)").unwrap();
            let names: Vec<String> = stmt
                .query_map([], |row| row.get(1))
                .unwrap()
                .filter_map(Result::ok)
                .collect();
            assert!(names.iter().any(|name| name == "lexeme"));
        }
    }
    let berean = load(&support().join("Berean Strongs.dct.mybible")).unwrap();
    assert_eq!(berean.kind, "dictionary");
    assert!(berean.is_strong);
    close(berean);
    let thompson = load(&support().join("THOMPSON.dct.mybible")).unwrap();
    assert_eq!(thompson.dict_table_name, "dictionary");
    close(thompson);
    let gesenius = load(&support().join("Léxico Gesenius.dct.mybible")).unwrap();
    assert!(gesenius.has_lexeme);
    close(gesenius);
    let mundo = load(&support().join("Enciclopédia Mundo Bíblico.dct.mybible")).unwrap();
    assert!(mundo.has_relative_order);
    close(mundo);
}
