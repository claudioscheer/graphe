//! Commentary reference parser.
//!
//! Book numbers come from the caller, parallel to each language's name list.
//! The alias table is the parser's own abbreviation map, not a second copy of
//! [`crate::books::GRAPHE_BOOK_NUMBERS`].

use indexmap::IndexSet;
use regex::Regex;
use std::collections::HashMap;
use std::sync::OnceLock;
use unicode_normalization::UnicodeNormalization;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BookName {
    pub short: String,
    pub long: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedReference {
    pub raw: String,
    pub index: usize,
    pub end_index: usize,
    pub book_num: i64,
    pub chapter: i64,
    pub verse_from: Option<i64>,
    pub verse_to: Option<i64>,
}

/// Chapter/verse picked off the start of plain commentary text.
/// A chapter-only line defaults both verse fields to 1.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LeadingReference {
    pub chapter: i64,
    pub verse_from: i64,
    pub verse_to: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct ContinuationOptions {
    pub require_separator: bool,
}

/// Context for same-book continuations.
///
/// `verses == None` means the source object has no verse fields, so a bare
/// number is a verse in `chapter`. `Some((None, None))` is a chapter-only
/// reference, so a bare number starts a new chapter.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReferenceContext {
    pub book_num: i64,
    pub chapter: i64,
    pub verses: Option<(Option<i64>, Option<i64>)>,
}

#[derive(Debug)]
pub struct ReferenceMatcher {
    aliases: HashMap<String, i64>,
    /// Book alternation plus chapter/verse. No look-behind and no backreference:
    /// the caller rejects a match that sits against a letter or number, and a
    /// duplicated `1`/`2`/`3` prefix is spelled out as `11|22|33`.
    regex: Regex,
}

pub fn build_reference_matcher(
    book_names_by_lang: &[Vec<BookName>],
    book_numbers: &[i64],
) -> ReferenceMatcher {
    let mut aliases: HashMap<String, i64> = HashMap::new();
    let mut base_set: IndexSet<String> = IndexSet::new();

    for names in book_names_by_lang {
        for (index, name) in names.iter().enumerate() {
            let Some(&book_num) = book_numbers.get(index) else {
                continue;
            };
            for form in [&name.short, &name.long] {
                let lower = form.to_lowercase();
                if lower.is_empty() {
                    continue;
                }
                register_alias(&mut aliases, &lower, book_num);
                maybe_register_common_aliases(
                    &mut aliases,
                    &mut base_set,
                    &name.short,
                    &name.long,
                    book_num,
                );

                let compact = remove_whitespace(&lower);
                if compact != lower {
                    aliases.entry(compact).or_insert(book_num);
                }
                let folded = fold_diacritics(form);
                if !folded.is_empty() {
                    add_base(&mut base_set, &folded);
                    add_base(&mut base_set, &remove_whitespace(&folded));
                }
                match strip_if_numbered(&lower) {
                    Some(stripped) => add_base(&mut base_set, &stripped),
                    None => add_base(&mut base_set, &lower),
                }
                if !folded.is_empty() {
                    if let Some(stripped) = strip_if_numbered(&folded) {
                        add_base(&mut base_set, &stripped);
                    }
                }
            }
        }
    }

    let mut bases: Vec<String> = base_set.into_iter().filter(|s| !s.is_empty()).collect();
    // JavaScript alternation is left-first. Longer aliases have to come first
    // so "matt" wins over "mat" the same way the Vitest pattern does.
    bases.sort_by(|a, b| b.chars().count().cmp(&a.chars().count()));
    let regex = if bases.is_empty() {
        Regex::new(r"a\A").unwrap()
    } else {
        let alts = bases
            .iter()
            .map(|base| escape_regex(base))
            .collect::<Vec<_>>()
            .join("|");
        let pattern = format!(
            r"(?i)(?:(11|22|33|[123])\s*\.?\s*)?({alts})(?:\s+|\s*\.\s*)([0-9]{{1,3}})(?:\s*[.:]\s*(?:[.:]\s*)*([0-9]{{1,3}})(?:\s*[-–]\s*([0-9]{{1,3}}))?)?"
        );
        regex::RegexBuilder::new(&pattern)
            .size_limit(64 * 1024 * 1024)
            .dfa_size_limit(64 * 1024 * 1024)
            .build()
            .unwrap_or_else(|err| panic!("commentary ref pattern failed ({err})"))
    };

    ReferenceMatcher { aliases, regex }
}

impl ReferenceMatcher {
    pub fn find_matches(&self, text: Option<&str>) -> Vec<ParsedReference> {
        let input = text.unwrap_or("");
        let mut out = Vec::new();
        let mut cursor = 0usize;
        while cursor < input.len() {
            let Some(caps) = self.regex.captures_at(input, cursor) else {
                break;
            };
            let whole = caps.get(0).expect("full match");
            let start = whole.start();
            let end = whole.end();
            if start < cursor {
                break;
            }
            if !is_boundary(input, start) {
                let next = next_char(input, start);
                cursor = if next > cursor {
                    next
                } else {
                    next_char(input, cursor)
                };
                continue;
            }
            let prefix_raw = caps.get(1).map(|m| m.as_str()).unwrap_or("");
            let prefix = first_char_owned(prefix_raw);
            let abbrev = caps.get(2).map(|m| m.as_str()).unwrap_or("");
            let Some(book_num) = self.resolve(&prefix, abbrev) else {
                cursor = if prefix.is_empty() {
                    if end > cursor {
                        end
                    } else {
                        next_char(input, cursor)
                    }
                } else {
                    let next = next_char(input, start);
                    if next > cursor {
                        next
                    } else {
                        next_char(input, cursor)
                    }
                };
                continue;
            };
            let chapter = parse_num(caps.get(3).map(|m| m.as_str()).unwrap_or(""));
            let verse_from = caps.get(4).map(|m| parse_num(m.as_str()));
            let verse_to = match caps.get(5) {
                Some(m) => Some(parse_num(m.as_str())),
                None => verse_from,
            };
            out.push(ParsedReference {
                raw: whole.as_str().to_string(),
                index: start,
                end_index: end,
                book_num,
                chapter,
                verse_from,
                verse_to,
            });
            let cont_context = ReferenceContext {
                book_num,
                chapter,
                verses: Some((verse_from, verse_to)),
            };
            for mut cont in self.find_continuations(
                Some(&input[end..]),
                &cont_context,
                ContinuationOptions {
                    require_separator: true,
                },
            ) {
                cont.index += end;
                cont.end_index += end;
                out.push(cont);
            }
            cursor = if end > cursor {
                end
            } else {
                next_char(input, cursor)
            };
        }
        out
    }

    pub fn find_continuations(
        &self,
        text: Option<&str>,
        context: &ReferenceContext,
        options: ContinuationOptions,
    ) -> Vec<ParsedReference> {
        let _ = self;
        let input = text.unwrap_or("");
        if input.is_empty() {
            return Vec::new();
        }
        let book_num = context.book_num;
        let chapter = context.chapter;
        let chapter_only = matches!(context.verses, Some((None, None)));
        let require_separator = options.require_separator;
        let re = continuation_re(require_separator);

        let mut out = Vec::new();
        let mut last_chapter = chapter;
        let mut cursor = 0usize;
        while cursor < input.len() {
            let tail = &input[cursor..];
            let Some(caps) = re.captures(tail) else {
                break;
            };
            let full = caps.get(0).expect("continuation match");
            let num_group = if require_separator { 3 } else { 2 };
            let from_group = if require_separator { 4 } else { 3 };
            let to_group = if require_separator { 5 } else { 4 };
            let range_group = if require_separator { 6 } else { 5 };
            let Some(num) = caps.get(num_group) else {
                break;
            };
            let num_start = num.start();
            let full_end = full.end();
            if num_start >= full_end {
                break;
            }
            let trailing = &tail[full_end..];
            let explicit_from = caps.get(from_group).map(|m| m.as_str());
            let explicit_to = caps.get(to_group).map(|m| m.as_str());
            let range_to = caps.get(range_group).map(|m| m.as_str());
            if explicit_from.is_none() && range_to.is_none() && bare_number_stops(trailing) {
                break;
            }

            let n1 = parse_num(num.as_str());
            let mut ref_chapter = if chapter_only { n1 } else { last_chapter };
            let mut verse_from = if chapter_only { None } else { Some(n1) };
            let mut verse_to = verse_from;
            if let Some(from_text) = explicit_from {
                let from = parse_num(from_text);
                ref_chapter = n1;
                verse_from = Some(from);
                verse_to = Some(match explicit_to {
                    Some(to_text) => parse_num(to_text),
                    None => from,
                });
            } else if let Some(range_text) = range_to {
                if chapter_only {
                    ref_chapter = n1;
                } else {
                    verse_to = Some(parse_num(range_text));
                }
            }

            out.push(ParsedReference {
                raw: tail[num_start..full_end].to_string(),
                index: cursor + num_start,
                end_index: cursor + full_end,
                book_num,
                chapter: ref_chapter,
                verse_from,
                verse_to,
            });
            last_chapter = ref_chapter;
            let next = cursor + full_end;
            if next <= cursor {
                break;
            }
            cursor = next;
        }
        out
    }

    fn resolve(&self, prefix: &str, abbrev: &str) -> Option<i64> {
        let base = abbrev.to_lowercase();
        let folded = fold_diacritics(abbrev);
        let hit = |key: String| self.aliases.get(&key).copied().filter(|n| *n != 0);
        if !prefix.is_empty() {
            return hit(format!("{prefix}{base}"))
                .or_else(|| hit(format!("{prefix} {base}")))
                .or_else(|| hit(format!("{prefix}{folded}")))
                .or_else(|| hit(format!("{prefix} {folded}")));
        }
        hit(base).or_else(|| hit(folded))
    }
}

pub fn parse_leading_reference_from_plain_text(text: Option<&str>) -> Option<LeadingReference> {
    let raw = text.unwrap_or("");
    let trimmed = raw.trim_start();
    let line_end = trimmed.find(['\r', '\n']).unwrap_or(trimmed.len());
    let first_line = trimmed[..line_end].trim();
    let caps = leading_re().captures(first_line)?;
    let chapter = parse_num(caps.get(1)?.as_str());
    let verse_from = match caps.get(2) {
        Some(m) => parse_num(m.as_str()),
        None => 1,
    };
    let verse_to = match caps.get(3) {
        Some(m) => parse_num(m.as_str()),
        None => verse_from,
    };
    Some(LeadingReference {
        chapter,
        verse_from,
        verse_to,
    })
}

fn fold_diacritics(value: &str) -> String {
    value
        .nfd()
        .filter(|c| !('\u{0300}'..='\u{036f}').contains(c))
        .collect::<String>()
        .to_lowercase()
}

fn remove_whitespace(value: &str) -> String {
    value.chars().filter(|c| !c.is_whitespace()).collect()
}

fn add_base(set: &mut IndexSet<String>, value: &str) {
    if !value.is_empty() {
        set.insert(value.to_string());
    }
}

fn strip_if_numbered(value: &str) -> Option<String> {
    let mut chars = value.chars();
    match chars.next() {
        Some('1' | '2' | '3') => Some(
            chars
                .as_str()
                .trim_start_matches(char::is_whitespace)
                .to_string(),
        ),
        _ => None,
    }
}

fn escape_regex(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for c in value.chars() {
        if matches!(
            c,
            '.' | '*' | '+' | '?' | '^' | '$' | '{' | '}' | '(' | ')' | '|' | '[' | ']' | '\\'
        ) {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

fn register_alias(map: &mut HashMap<String, i64>, alias: &str, book_num: i64) {
    if alias.is_empty() {
        return;
    }
    let lower = alias.to_lowercase();
    map.entry(lower.clone()).or_insert(book_num);
    let compact = remove_whitespace(&lower);
    if compact != lower {
        map.entry(compact).or_insert(book_num);
    }
    let folded = fold_diacritics(alias);
    if !folded.is_empty() {
        map.entry(folded.clone()).or_insert(book_num);
        let folded_compact = remove_whitespace(&folded);
        if folded_compact != folded {
            map.entry(folded_compact).or_insert(book_num);
        }
    }
}

fn numbered_prefix<'a>(short_lower: &'a str, long_lower: &'a str, long_fold: &'a str) -> &'a str {
    for value in [short_lower, long_lower, long_fold] {
        if matches!(value.chars().next(), Some('1' | '2' | '3')) {
            return &value[..1];
        }
    }
    ""
}

fn register_book_alias(
    map: &mut HashMap<String, i64>,
    base_set: &mut IndexSet<String>,
    alias: &str,
    numbered_only: bool,
    numbered_prefix: &str,
    book_num: i64,
) {
    if alias.is_empty() {
        return;
    }
    if numbered_only && !numbered_prefix.is_empty() {
        register_alias(map, &format!("{numbered_prefix}{alias}"), book_num);
        register_alias(map, &format!("{numbered_prefix} {alias}"), book_num);
    } else {
        register_alias(map, alias, book_num);
    }
    base_set.insert(alias.to_string());
}

fn maybe_register_common_aliases(
    map: &mut HashMap<String, i64>,
    base_set: &mut IndexSet<String>,
    short_name: &str,
    long_name: &str,
    book_num: i64,
) {
    let short_lower = short_name.to_lowercase();
    let long_lower = long_name.to_lowercase();
    let short_fold = fold_diacritics(short_name);
    let long_fold = fold_diacritics(long_name);
    let prefix = numbered_prefix(&short_lower, &long_lower, &long_fold);
    let mut add = |alias: &str, numbered_only: bool| {
        register_book_alias(map, base_set, alias, numbered_only, prefix, book_num);
    };

    if short_lower == "mt"
        || contains_any(&long_lower, &["mateus", "matthew"])
        || contains_any(&long_fold, &["mateus", "matthew"])
    {
        add("mat", false);
        add("matt", false);
    }
    if contains_any(&long_lower, &["exodus"]) || contains_any(&long_fold, &["exodus"]) {
        add("exod", false);
    }
    if contains_any(&long_lower, &["deuteronomy"]) || contains_any(&long_fold, &["deuteronomy"]) {
        add("deut", false);
    }
    if contains_any(&long_lower, &["joshua"]) || contains_any(&long_fold, &["joshua"]) {
        add("josh", false);
    }
    if contains_any(&long_lower, &["judges"]) || contains_any(&long_fold, &["judges"]) {
        add("judg", false);
    }
    if contains_any(&long_lower, &["zechariah"]) || contains_any(&long_fold, &["zechariah"]) {
        add("zech", false);
    }
    if contains_any(&long_lower, &["isaiah", "isaias"])
        || contains_any(&long_fold, &["isaiah", "isaias"])
    {
        add("isa", false);
    }
    if contains_any(&long_lower, &["jeremiah", "jeremias"])
        || contains_any(&long_fold, &["jeremiah", "jeremias"])
    {
        add("jer", false);
    }
    if long_lower.contains("proverbs")
        || long_fold.contains("proverb")
        || short_fold == "pv"
        || short_fold == "pr"
    {
        add("prov", false);
        add("prv", false);
        add("pro", false);
        add("pró", false);
    }
    if contains_any(
        &long_lower,
        &["song of solomon", "song of songs", "cantares"],
    ) || contains_any(
        &long_fold,
        &["song of solomon", "song of songs", "cantares"],
    ) {
        add("song", false);
    }
    if contains_any(&long_lower, &["philippians", "filipenses"])
        || contains_any(&long_fold, &["philippians", "filipenses"])
    {
        add("phil", false);
    }
    if contains_any(&long_lower, &["corinthians", "corintios"])
        || contains_any(&long_fold, &["corinthians", "corintios"])
    {
        add("cor", true);
        add("corinth", true);
    }
    if contains_any(&long_lower, &["philemon", "filemom", "filemon"])
        || contains_any(&long_fold, &["philemon", "filemom", "filemon"])
    {
        add("philem", false);
    }
    if contains_any(&long_lower, &["samuel"]) || contains_any(&long_fold, &["samuel"]) {
        add("sam", true);
    }
    if contains_any(&long_lower, &["psalm", "psalms", "salmo", "salmos"])
        || contains_any(&long_fold, &["psalm", "psalms", "salmo", "salmos"])
    {
        add("psalm", false);
        add("salmo", false);
        add("ps", false);
    }
}

fn contains_any(haystack: &str, needles: &[&str]) -> bool {
    needles.iter().any(|needle| haystack.contains(needle))
}

fn parse_num(value: &str) -> i64 {
    value.parse::<i64>().unwrap_or(0)
}

fn first_char_owned(value: &str) -> String {
    value
        .chars()
        .next()
        .map(|c| c.to_string())
        .unwrap_or_default()
}

fn next_char(input: &str, index: usize) -> usize {
    if index >= input.len() {
        return input.len();
    }
    match input[index..].chars().next() {
        Some(c) => index + c.len_utf8(),
        None => input.len(),
    }
}

fn is_boundary(input: &str, start: usize) -> bool {
    if start == 0 {
        return true;
    }
    match input[..start].chars().next_back() {
        Some(prev) => !is_unicode_letter_or_number(prev),
        None => true,
    }
}

fn is_unicode_letter_or_number(ch: char) -> bool {
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| Regex::new(r"\A[\p{L}\p{N}]\z").unwrap());
    let mut buf = [0u8; 4];
    re.is_match(ch.encode_utf8(&mut buf))
}

fn bare_number_stops(trailing: &str) -> bool {
    static SPACE: OnceLock<Regex> = OnceLock::new();
    static DOTS: OnceLock<Regex> = OnceLock::new();
    let space = SPACE.get_or_init(|| Regex::new(r"^\s+[A-ZÀ-ÖØ-Þ]").unwrap());
    let dots = DOTS.get_or_init(|| Regex::new(r"^\s*(?:\.\s*)+[A-ZÀ-ÖØ-Þ]").unwrap());
    space.is_match(trailing) || dots.is_match(trailing)
}

fn continuation_re(require_separator: bool) -> &'static Regex {
    static WITH_SEP: OnceLock<Regex> = OnceLock::new();
    static NO_SEP: OnceLock<Regex> = OnceLock::new();
    if require_separator {
        WITH_SEP.get_or_init(|| {
            Regex::new(
                r"^((?:\s*\.\s*[0-9]{1,3})*)(\s*[;,]\s*(?:\.+\s*)?)([0-9]{1,3})(?:(?:\s*[.:]\s*(?:[.:]\s*)*([0-9]{1,3})(?:\s*[-–]\s*([0-9]{1,3}))?)|(?:\s*[-–]\s*([0-9]{1,3})))?",
            )
            .unwrap()
        })
    } else {
        NO_SEP.get_or_init(|| {
            Regex::new(
                r"^(\s*(?:[;,]\s*(?:\.+\s*)?)?)([0-9]{1,3})(?:(?:\s*[.:]\s*(?:[.:]\s*)*([0-9]{1,3})(?:\s*[-–]\s*([0-9]{1,3}))?)|(?:\s*[-–]\s*([0-9]{1,3})))?",
            )
            .unwrap()
        })
    }
}

fn leading_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(
            r"^(?:[\[({]\s*)?(?:(?:[1-3]\s*)?[A-Za-zÀ-ÖØ-öø-ÿ.]+(?:\s+|\s*\.\s*))?([0-9]{1,3})(?:\s*[:.]\s*([0-9]{1,3})(?:\s*-\s*([0-9]{1,3}))?)?(?-u:\b)",
        )
        .unwrap()
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::books::GRAPHE_BOOK_NUMBERS;

    fn books(pairs: &[(&str, &str)]) -> Vec<BookName> {
        pairs
            .iter()
            .map(|(short, long)| BookName {
                short: (*short).to_string(),
                long: (*long).to_string(),
            })
            .collect()
    }

    fn matcher(pairs: &[(&str, &str)], numbers: &[i64]) -> ReferenceMatcher {
        build_reference_matcher(&[books(pairs)], numbers)
    }

    fn dump(refs: &[ParsedReference]) -> String {
        refs.iter()
            .map(|r| {
                format!(
                    "{}:{}:{:?}-{:?} {:?}",
                    r.book_num, r.chapter, r.verse_from, r.verse_to, r.raw
                )
            })
            .collect::<Vec<_>>()
            .join(" | ")
    }

    fn assert_ref(
        refs: &[ParsedReference],
        idx: usize,
        book_num: i64,
        chapter: i64,
        verse_from: Option<i64>,
        verse_to: Option<i64>,
    ) {
        let r = &refs[idx];
        assert_eq!(
            (r.book_num, r.chapter, r.verse_from, r.verse_to),
            (book_num, chapter, verse_from, verse_to),
            "ref {idx} raw {:?} all {}",
            r.raw,
            dump(refs)
        );
    }

    fn assert_all(refs: &[ParsedReference], expected: &[(i64, i64, Option<i64>, Option<i64>)]) {
        assert_eq!(refs.len(), expected.len(), "{}", dump(refs));
        for (idx, (book, chapter, from, to)) in expected.iter().copied().enumerate() {
            assert_ref(refs, idx, book, chapter, from, to);
        }
    }

    fn basic_matcher() -> ReferenceMatcher {
        matcher(
            &[
                ("Mt", "Mateus"),
                ("Mc", "Marcos"),
                ("Lc", "Lucas"),
                ("Jo", "João"),
                ("1Co", "1 Coríntios"),
                ("Jd", "Judas"),
            ],
            &[470, 480, 490, 500, 540, 730],
        )
    }

    fn broad_matcher() -> ReferenceMatcher {
        matcher(
            &[
                ("Exod", "Exodus"),
                ("Deut", "Deuteronomy"),
                ("Josh", "Joshua"),
                ("Judg", "Judges"),
                ("2Sa", "2 Samuel"),
                ("Psa", "Psalms"),
                ("Isa", "Isaiah"),
                ("Jer", "Jeremiah"),
                ("Zeph", "Zephaniah"),
                ("Prov", "Proverbs"),
                ("Song", "Song of Solomon"),
                ("Zech", "Zechariah"),
                ("Gal", "Galatians"),
                ("Col", "Colossians"),
                ("Phil", "Philippians"),
            ],
            &[
                20, 50, 60, 70, 100, 230, 290, 300, 360, 200, 220, 380, 550, 580, 610,
            ],
        )
    }

    fn pt_matcher() -> ReferenceMatcher {
        let numbers: Vec<i64> = GRAPHE_BOOK_NUMBERS.iter().copied().map(i64::from).collect();
        matcher(
            &[
                ("Gn", "Gênesis"),
                ("Êx", "Êxodo"),
                ("Lv", "Levítico"),
                ("Nm", "Números"),
                ("Dt", "Deuteronômio"),
                ("Js", "Josué"),
                ("Jz", "Juízes"),
                ("Rt", "Rute"),
                ("1Sm", "1 Samuel"),
                ("2Sm", "2 Samuel"),
                ("1Rs", "1 Reis"),
                ("2Rs", "2 Reis"),
                ("1Cr", "1 Crônicas"),
                ("2Cr", "2 Crônicas"),
                ("Ed", "Esdras"),
                ("Ne", "Neemias"),
                ("Et", "Ester"),
                ("Jó", "Jó"),
                ("Sl", "Salmos"),
                ("Pv", "Provérbios"),
                ("Ec", "Eclesiastes"),
                ("Ct", "Cantares"),
                ("Is", "Isaías"),
                ("Jr", "Jeremias"),
                ("Lm", "Lamentações"),
                ("Ez", "Ezequiel"),
                ("Dn", "Daniel"),
                ("Os", "Oséias"),
                ("Jl", "Joel"),
                ("Am", "Amós"),
                ("Ob", "Obadias"),
                ("Jn", "Jonas"),
                ("Mq", "Miquéias"),
                ("Na", "Naum"),
                ("Hc", "Habacuque"),
                ("Sf", "Sofonias"),
                ("Ag", "Ageu"),
                ("Zc", "Zacarias"),
                ("Ml", "Malaquias"),
                ("Mt", "Mateus"),
                ("Mc", "Marcos"),
                ("Lc", "Lucas"),
                ("Jo", "João"),
                ("At", "Atos"),
                ("Rm", "Romanos"),
                ("1Co", "1 Coríntios"),
                ("2Co", "2 Coríntios"),
                ("Gl", "Gálatas"),
                ("Ef", "Efésios"),
                ("Fp", "Filipenses"),
                ("Cl", "Colossenses"),
                ("1Ts", "1 Tessalonicenses"),
                ("2Ts", "2 Tessalonicenses"),
                ("1Tm", "1 Timóteo"),
                ("2Tm", "2 Timóteo"),
                ("Tt", "Tito"),
                ("Fm", "Filemom"),
                ("Hb", "Hebreus"),
                ("Tg", "Tiago"),
                ("1Pe", "1 Pedro"),
                ("2Pe", "2 Pedro"),
                ("1Jo", "1 João"),
                ("2Jo", "2 João"),
                ("3Jo", "3 João"),
                ("Jd", "Judas"),
                ("Ap", "Apocalipse"),
            ],
            &numbers,
        )
    }

    #[test]
    fn parses_spaced_references() {
        let refs = basic_matcher().find_matches(Some("Veja Mt 2:11 e Lc 1:2."));
        assert_all(
            &refs,
            &[(470, 2, Some(11), Some(11)), (490, 1, Some(2), Some(2))],
        );
    }

    #[test]
    fn parses_dotted_references() {
        let refs = basic_matcher().find_matches(Some("V. nota em Mt.2:11; compare Jo.4:20."));
        assert_all(
            &refs,
            &[(470, 2, Some(11), Some(11)), (500, 4, Some(20), Some(20))],
        );
    }

    #[test]
    fn parses_numbered_books_with_dot_form() {
        let refs = basic_matcher().find_matches(Some("Paulo diz em 1Co.9:5."));
        assert_all(&refs, &[(540, 9, Some(5), Some(5))]);
    }

    #[test]
    fn parses_numbered_books_with_space_between_number_and_abbreviation() {
        let refs = basic_matcher().find_matches(Some("Paulo diz em 1 Co 2:1."));
        assert_all(&refs, &[(540, 2, Some(1), Some(1))]);
    }

    #[test]
    fn parses_1_cor_and_philem_aliases() {
        let m = matcher(
            &[("1Co", "1 Corinthians"), ("Phm", "Philemon")],
            &[540, 570],
        );
        let refs = m.find_matches(Some("1 Cor 1:1-9 Philem 4"));
        assert_all(&refs, &[(540, 1, Some(1), Some(9)), (570, 4, None, None)]);
    }

    #[test]
    fn does_not_match_cor_without_numeric_prefix() {
        let m = matcher(&[("1Co", "1 Coríntios")], &[540]);
        assert!(m.find_matches(Some("Cor 1:1-9")).is_empty());
        assert_eq!(m.find_matches(Some("1 Cor 1:1-9")).len(), 1);
    }

    #[test]
    fn parses_noisy_chained_legacy_references_with_duplicated_numbered_prefix() {
        let m = matcher(
            &[
                ("1Co", "1 Coríntios"),
                ("Fp", "Filipenses"),
                ("Cl", "Colossenses"),
                ("1Ts", "1 Tessalonicenses"),
                ("2Ts", "2 Tessalonicenses"),
                ("2Tm", "2 Timóteo"),
                ("Fm", "Filemom"),
            ],
            &[540, 610, 620, 630, 640, 660, 570],
        );
        let text =
            "f. 1 Cor 1:1-9;.. Phil 1:1-8; Colossenses 1:1-8;. 1 Tessalonicenses 1:2; 22 Ts 1. :. 3, 2 Tm 1:3; Philem 4";
        let refs = m.find_matches(Some(text));
        assert_all(
            &refs,
            &[
                (540, 1, Some(1), Some(9)),
                (610, 1, Some(1), Some(8)),
                (620, 1, Some(1), Some(8)),
                (630, 1, Some(2), Some(2)),
                (640, 1, Some(3), Some(3)),
                (660, 1, Some(3), Some(3)),
                (570, 4, None, None),
            ],
        );
    }

    #[test]
    fn parses_chained_refs_with_2_sam_chapter_only_salmo_and_dotted_spacing() {
        let m = matcher(
            &[
                ("2Sm", "2 Samuel"),
                ("Sl", "Salmos"),
                ("Is", "Isaías"),
                ("Jr", "Jeremias"),
                ("Ez", "Ezequiel"),
            ],
            &[100, 230, 290, 300, 260],
        );
        let text = "er 2 Sam 7:12-16;. Salmo 89; 132;. Isa 11:1-5; Jer . 23:5-6;. Ez 34:23-24).";
        let refs = m.find_matches(Some(text));
        assert_all(
            &refs,
            &[
                (100, 7, Some(12), Some(16)),
                (230, 89, None, None),
                (230, 132, None, None),
                (290, 11, Some(1), Some(5)),
                (300, 23, Some(5), Some(6)),
                (260, 34, Some(23), Some(24)),
            ],
        );
    }

    #[test]
    fn parses_mixed_dotted_number_prefix_and_psalm_isaiah_continuations() {
        let m = matcher(
            &[
                ("Dt", "Deuteronômio"),
                ("1Sm", "1 Samuel"),
                ("Sl", "Salmos"),
                ("Is", "Isaías"),
                ("Lm", "Lamentações"),
                ("Lam", "Lamentations"),
            ],
            &[50, 90, 230, 290, 310, 310],
        );
        let text = "g, Dt 30:3;. 1. Sam 23:21;. Ps 103 : 13; Isa 49:15; 54:8; Lam 4:10)";
        let refs = m.find_matches(Some(text));
        assert_all(
            &refs,
            &[
                (50, 30, Some(3), Some(3)),
                (90, 23, Some(21), Some(21)),
                (230, 103, Some(13), Some(13)),
                (290, 49, Some(15), Some(15)),
                (290, 54, Some(8), Some(8)),
                (310, 4, Some(10), Some(10)),
            ],
        );
    }

    #[test]
    fn parses_ranges() {
        let refs = basic_matcher().find_matches(Some("Leia Mt.5:3-10."));
        assert_all(&refs, &[(470, 5, Some(3), Some(10))]);
    }

    #[test]
    fn parses_same_book_follow_up_references_after_semicolon_comma() {
        let refs = basic_matcher().find_matches(Some("Veja Jo 3:16; 4:2, 5 e Jo 5:24."));
        assert_all(
            &refs,
            &[
                (500, 3, Some(16), Some(16)),
                (500, 4, Some(2), Some(2)),
                (500, 4, Some(5), Some(5)),
                (500, 5, Some(24), Some(24)),
            ],
        );
    }

    #[test]
    fn parses_continuation_only_chunks_using_context() {
        let refs = basic_matcher().find_continuations(
            Some(" 25, 27; 7:1-2"),
            &ReferenceContext {
                book_num: 490,
                chapter: 6,
                verses: None,
            },
            ContinuationOptions::default(),
        );
        assert_all(
            &refs,
            &[
                (490, 6, Some(25), Some(25)),
                (490, 6, Some(27), Some(27)),
                (490, 7, Some(1), Some(2)),
            ],
        );
    }

    #[test]
    fn parses_chapter_only_references() {
        let refs = basic_matcher().find_matches(Some("Veja Mt.23 e depois Jo 3:16."));
        assert_all(
            &refs,
            &[(470, 23, None, None), (500, 3, Some(16), Some(16))],
        );
    }

    #[test]
    fn parses_matt_alias_without_turning_into_titus() {
        let refs = basic_matcher().find_matches(Some("Matt 21:12-17"));
        assert_all(&refs, &[(470, 21, Some(12), Some(17))]);
        assert!(refs[0].raw.to_lowercase().contains("matt"));
    }

    #[test]
    fn ignores_non_reference_tokens() {
        let refs = basic_matcher().find_matches(Some("Isso nao deve virar link: Mt2:11 e XX.1:1"));
        assert!(refs.is_empty(), "{}", dump(&refs));
    }

    #[test]
    fn parses_mixed_commentary_patterns_from_legacy_modules() {
        let text = "Exod 20:3-21 Deut 4:5-6 Josh 10:24-25 Zech 5:3; 14:12 2Sa 5:14 Solomon Prov 6:33 Prov 8:6 Judg 7:9 Song 1:3 Josh 2:14 Col 3:12 Phil 2:1-3 Phil 4:2 Deut 2:4";
        let refs = broad_matcher().find_matches(Some(text));
        assert_all(
            &refs,
            &[
                (20, 20, Some(3), Some(21)),
                (50, 4, Some(5), Some(6)),
                (60, 10, Some(24), Some(25)),
                (380, 5, Some(3), Some(3)),
                (380, 14, Some(12), Some(12)),
                (100, 5, Some(14), Some(14)),
                (200, 6, Some(33), Some(33)),
                (200, 8, Some(6), Some(6)),
                (70, 7, Some(9), Some(9)),
                (220, 1, Some(3), Some(3)),
                (60, 2, Some(14), Some(14)),
                (580, 3, Some(12), Some(12)),
                (610, 2, Some(1), Some(3)),
                (610, 4, Some(2), Some(2)),
                (50, 2, Some(4), Some(4)),
            ],
        );
    }

    #[test]
    fn parses_long_chained_semicolon_lists_and_repeated_book_headers() {
        let text = "Jer 31:18-20  Psa 1:1; 2:12; 32:1-2; 41:1; 84:12; 112:1 Psa 119:1-2; 128:1; 146:5 Zeph 3:12 Gal 5:23 Isa 25:6; 41:17; 44:3 Isa 49:9-10; 55:1-3; 65:13; 66:11";
        let refs = broad_matcher().find_matches(Some(text));
        assert_all(
            &refs,
            &[
                (300, 31, Some(18), Some(20)),
                (230, 1, Some(1), Some(1)),
                (230, 2, Some(12), Some(12)),
                (230, 32, Some(1), Some(2)),
                (230, 41, Some(1), Some(1)),
                (230, 84, Some(12), Some(12)),
                (230, 112, Some(1), Some(1)),
                (230, 119, Some(1), Some(2)),
                (230, 128, Some(1), Some(1)),
                (230, 146, Some(5), Some(5)),
                (360, 3, Some(12), Some(12)),
                (550, 5, Some(23), Some(23)),
                (290, 25, Some(6), Some(6)),
                (290, 41, Some(17), Some(17)),
                (290, 44, Some(3), Some(3)),
                (290, 49, Some(9), Some(10)),
                (290, 55, Some(1), Some(3)),
                (290, 65, Some(13), Some(13)),
                (290, 66, Some(11), Some(11)),
            ],
        );
    }

    #[test]
    fn parses_split_node_continuation_style() {
        let broad = broad_matcher();
        let first = broad.find_matches(Some("Prov 8:6"));
        assert_eq!(first.len(), 1);
        let refs = broad.find_continuations(
            Some("31:8-9"),
            &ReferenceContext {
                book_num: first[0].book_num,
                chapter: first[0].chapter,
                verses: None,
            },
            ContinuationOptions::default(),
        );
        assert_all(&refs, &[(200, 31, Some(8), Some(9))]);
    }

    #[test]
    fn supports_common_english_aliases_even_when_canonical_short_differs() {
        let m = matcher(
            &[
                ("Exo", "Exodus"),
                ("Deu", "Deuteronomy"),
                ("Jos", "Joshua"),
                ("Jdg", "Judges"),
                ("Pro", "Proverbs"),
                ("Sol", "Song of Solomon"),
            ],
            &[20, 50, 60, 70, 200, 220],
        );
        let refs = m.find_matches(Some(
            "Exod 20:3 Deut 2:4 Josh 2:14 Judg 7:9 Prov 8:6 Song 1:3",
        ));
        assert_all(
            &refs,
            &[
                (20, 20, Some(3), Some(3)),
                (50, 2, Some(4), Some(4)),
                (60, 2, Some(14), Some(14)),
                (70, 7, Some(9), Some(9)),
                (200, 8, Some(6), Some(6)),
                (220, 1, Some(3), Some(3)),
            ],
        );
    }

    #[test]
    fn parses_legacy_portuguese_like_aliases_and_chapter_only_chained_refs() {
        let refs = broad_matcher().find_matches(Some("2 Sam 7:12-16;. Salmo 89; 132;"));
        assert_all(
            &refs,
            &[
                (100, 7, Some(12), Some(16)),
                (230, 89, None, None),
                (230, 132, None, None),
            ],
        );
    }

    #[test]
    fn requires_explicit_separator_for_continuation_only_chunks_when_requested() {
        let refs = broad_matcher().find_continuations(
            Some("01:05 A missão de Paulo"),
            &ReferenceContext {
                book_num: 470,
                chapter: 28,
                verses: None,
            },
            ContinuationOptions {
                require_separator: true,
            },
        );
        assert!(refs.is_empty(), "{}", dump(&refs));
    }

    #[test]
    fn parses_the_noisy_examples_from_patristic_commentary_text() {
        let pt = pt_matcher();
        assert_all(
            &pt.find_matches(Some("1Timóteo 4:10")),
            &[(610, 4, Some(10), Some(10))],
        );
        assert_all(
            &pt.find_matches(Some(
                "foi feito. [ João 1:1-3.] Homilias sobre o Gênesis 1.1. [FC 71:47.]",
            )),
            &[(500, 1, Some(1), Some(3)), (10, 1, Some(1), Some(1))],
        );
        assert_all(
            &pt.find_matches(Some("Colossenses 1:16 ]")),
            &[(580, 1, Some(16), Some(16))],
        );
        assert_all(
            &pt.find_matches(Some("sobre Gênesis 1.8.3; 9.2. [FC 91:81.]")),
            &[(10, 1, Some(8), Some(8)), (10, 9, Some(2), Some(2))],
        );
        assert_all(
            &pt.find_matches(Some("sobre Gênesis 1.14.1; 15.1. [FC")),
            &[(10, 1, Some(14), Some(14)), (10, 15, Some(1), Some(1))],
        );
        assert_all(
            &pt.find_matches(Some("sobre João 18. [")),
            &[(500, 18, None, None)],
        );
        assert_all(
            &pt.find_matches(Some("João 51.6.")),
            &[(500, 51, Some(6), Some(6))],
        );
    }

    #[test]
    fn accepts_unaccented_forms_for_accented_portuguese_book_names() {
        let refs = pt_matcher().find_matches(Some("Genesis 1:1 Joao 3:16 1Timoteo 4:10"));
        assert_all(
            &refs,
            &[
                (10, 1, Some(1), Some(1)),
                (500, 3, Some(16), Some(16)),
                (610, 4, Some(10), Some(10)),
            ],
        );
    }

    #[test]
    fn supports_long_name_references_across_the_full_portuguese_canon() {
        let refs = pt_matcher().find_matches(Some(
            "Gênesis 1:1 Êxodo 2:2 Levítico 3:3 Números 4:4 Deuteronômio 5:5 Josué 6:6 Juízes 7:7 Rute 1:1 1Samuel 2:2 2Samuel 3:3 1Reis 4:4 2Reis 5:5 1Crônicas 6:6 2Crônicas 7:7 Esdras 8:8 Neemias 9:9 Ester 1:1 Jó 2:2 Salmos 3:3 Provérbios 4:4 Eclesiastes 5:5 Cantares 6:6 Isaías 7:7 Jeremias 8:8 Lamentações 9:9 Ezequiel 10:10 Daniel 11:11 Oséias 12:12 Joel 1:1 Amós 2:2 Obadias 1:1 Jonas 2:2 Miquéias 3:3 Naum 1:1 Habacuque 2:2 Sofonias 3:3 Ageu 1:1 Zacarias 2:2 Malaquias 3:3 Mateus 4:4 Marcos 5:5 Lucas 6:6 João 7:7 Atos 8:8 Romanos 9:9 1Coríntios 10:10 2Coríntios 11:11 Gálatas 1:1 Efésios 2:2 Filipenses 3:3 Colossenses 4:4 1Tessalonicenses 5:5 2Tessalonicenses 1:1 1Timóteo 2:2 2Timóteo 3:3 Tito 1:1 Filemom 1 Hebreus 2:2 Tiago 3:3 1Pedro 4:4 2Pedro 5:5 1João 1:1 2João 1:1 3João 1:1 Judas 1 Apocalipse 2:2",
        ));
        assert_eq!(refs.len(), 66, "{}", dump(&refs));
        assert_ref(&refs, 0, 10, 1, Some(1), Some(1));
        assert_ref(&refs, 42, 500, 7, Some(7), Some(7));
        assert_ref(&refs, 53, 610, 2, Some(2), Some(2));
        assert_ref(&refs, 65, 730, 2, Some(2), Some(2));
    }

    #[test]
    fn parses_chapter_verse_with_dot_separator_after_abbreviation() {
        assert_eq!(
            parse_leading_reference_from_plain_text(Some("Mt.2:11 texto")),
            Some(LeadingReference {
                chapter: 2,
                verse_from: 11,
                verse_to: 11,
            })
        );
    }

    #[test]
    fn parses_ranges_at_line_start() {
        assert_eq!(
            parse_leading_reference_from_plain_text(Some("1Co 13:4-7 amor")),
            Some(LeadingReference {
                chapter: 13,
                verse_from: 4,
                verse_to: 7,
            })
        );
    }

    #[test]
    fn handles_leading_bracket_markers() {
        assert_eq!(
            parse_leading_reference_from_plain_text(Some("(Lc.1:1) introducao")),
            Some(LeadingReference {
                chapter: 1,
                verse_from: 1,
                verse_to: 1,
            })
        );
    }

    #[test]
    fn returns_null_when_no_leading_reference_is_present() {
        assert_eq!(
            parse_leading_reference_from_plain_text(Some("Sem referencia aqui")),
            None
        );
    }

    #[test]
    fn parses_chapter_only_leading_reference_and_defaults_verse_to_1() {
        assert_eq!(
            parse_leading_reference_from_plain_text(Some("Mt.23 comentario")),
            Some(LeadingReference {
                chapter: 23,
                verse_from: 1,
                verse_to: 1,
            })
        );
    }
}
