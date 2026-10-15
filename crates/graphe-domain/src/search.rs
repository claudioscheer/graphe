use regex::Regex;
use std::sync::OnceLock;
use unicode_normalization::UnicodeNormalization;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SearchStrongTerm {
    pub prefix: String,
    pub number: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedSearchQuery {
    pub strongs: Vec<SearchStrongTerm>,
    pub text_terms: Vec<String>,
    pub exact_phrases: Vec<String>,
    pub text_part: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SearchHit {
    pub book_number: i64,
    pub chapter: i64,
    pub verse: i64,
    pub text: String,
}

fn strong_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?i)strong:([HhGg]?)(\d+\w*)").unwrap())
}

fn phrase_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r#""([^"]+)""#).unwrap())
}

pub fn parse_search_query(query: Option<&str>) -> ParsedSearchQuery {
    let input = query.unwrap_or("").trim().to_string();
    if input.is_empty() {
        return ParsedSearchQuery {
            strongs: Vec::new(),
            text_terms: Vec::new(),
            exact_phrases: Vec::new(),
            text_part: String::new(),
        };
    }
    let strongs = strong_re()
        .captures_iter(&input)
        .map(|caps| SearchStrongTerm {
            prefix: caps
                .get(1)
                .map(|m| m.as_str().to_uppercase())
                .unwrap_or_default(),
            number: caps[2].to_string(),
        })
        .collect();
    let without_strongs = strong_re().replace_all(&input, " ");
    let mut exact_phrases = Vec::new();
    let text_without = phrase_re().replace_all(&without_strongs, |caps: &regex::Captures| {
        let normalized = collapse_ws(&caps[1]);
        if normalized.chars().count() >= 2 {
            exact_phrases.push(normalized);
        }
        " "
    });
    let text_part = collapse_ws(&text_without);
    let text_terms = if text_part.is_empty() {
        Vec::new()
    } else {
        text_part
            .split_whitespace()
            .filter(|term| term.chars().count() >= 2)
            .map(|term| term.to_string())
            .collect()
    };
    ParsedSearchQuery {
        strongs,
        text_terms,
        exact_phrases,
        text_part,
    }
}

fn collapse_ws(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub fn strip_search_markup(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let bytes = text.as_bytes();
    let len = bytes.len();
    let mut i = 0;
    while i < len {
        if bytes[i] == b'<' {
            let mut tag_end = i + 1;
            while tag_end < len && bytes[tag_end] != b'>' {
                tag_end += 1;
            }
            if tag_end < len {
                let tag_content = &bytes[i + 1..tag_end];
                if !tag_content.is_empty() && tag_content[0] != b'/' {
                    let first = tag_content[0].to_ascii_uppercase();
                    if matches!(first, b'S' | b'F' | b'N' | b'M' | b'L' | b'X' | b'O' | b'T') {
                        let mut found_close = false;
                        let mut j = tag_end + 1;
                        while j + 2 < len {
                            if bytes[j] == b'<'
                                && bytes[j + 1] == b'/'
                                && bytes[j + 2].to_ascii_uppercase() == first
                            {
                                let mut close_end = j + 3;
                                while close_end < len && bytes[close_end] != b'>' {
                                    close_end += 1;
                                }
                                if close_end < len {
                                    i = close_end + 1;
                                    out.push(' ');
                                    found_close = true;
                                    break;
                                }
                            }
                            j += 1;
                        }
                        if found_close {
                            continue;
                        }
                    }
                }
                i = tag_end + 1;
                out.push(' ');
                continue;
            }
        }
        let next_tag = bytes[i..]
            .iter()
            .position(|&b| b == b'<')
            .map(|offset| i + offset)
            .unwrap_or(len);
        out.push_str(&text[i..next_tag]);
        i = next_tag;
    }
    out
}

/// Plain verse wording for a search hit.
///
/// Drops Strong's tags, morphology (`<m>`), lemmas (`<l>`), original-language
/// and transliteration pairs, and extended notes. Keeps the translated words.
pub fn search_preview_plain(text: &str) -> String {
    static STEPS: OnceLock<Vec<(Regex, &'static str)>> = OnceLock::new();
    let steps = STEPS.get_or_init(|| {
        [
            (r"(?i)<n>[\s\S]*?</n>", ""),
            (r"<O[GH]?>[\s\S]*?<o[gh]?>", ""),
            (r"<T[GH]?>[\s\S]*?<t[gh]?>", ""),
            (r"(?i)<X>[\s\S]*?<x>", ""),
            (r"(?i)<m>[\s\S]*?</m>", ""),
            (r"(?i)<l>[\s\S]*?</l>", ""),
            (r"(?i)<pb\s*/?>", " "),
            (r"(?i)<S[^>]*>[\s\S]*?</S>", " "),
            (r"(?i)<f>[\s\S]*?</f>", " "),
            (r"(?i)<i>([\s\S]*?)</i>", "$1"),
            (r"<E>([\s\S]*?)<e>", "$1"),
            (r"<[^>]+>", " "),
        ]
        .into_iter()
        .map(|(pattern, replacement)| (Regex::new(pattern).unwrap(), replacement))
        .collect()
    });
    let mut cleaned = text.to_string();
    for (pattern, replacement) in steps {
        cleaned = pattern.replace_all(&cleaned, *replacement).into_owned();
    }
    collapse_ws(&cleaned)
}

/// Verse wording with matched Strong's numbers highlighted as `<mark>{word} [{clean_number}]</mark>`.
pub fn clean_text_with_strongs(text: &str, strong_terms: &[SearchStrongTerm]) -> String {
    if strong_terms.is_empty() {
        return search_preview_plain(text);
    }
    static PRE_STEPS: OnceLock<Vec<(Regex, &'static str)>> = OnceLock::new();
    let steps = PRE_STEPS.get_or_init(|| {
        [
            (r"(?i)<n>[\s\S]*?</n>", ""),
            (r"<O[GH]?>[\s\S]*?<o[gh]?>", ""),
            (r"<T[GH]?>[\s\S]*?<t[gh]?>", ""),
            (r"(?i)<X>[\s\S]*?<x>", ""),
            (r"(?i)<m>[\s\S]*?</m>", ""),
            (r"(?i)<l>[\s\S]*?</l>", ""),
            (r"(?i)<pb\s*/?>", " "),
            (r"(?i)<f>[\s\S]*?</f>", " "),
            (r"(?i)<i>([\s\S]*?)</i>", "$1"),
            (r"<E>([\s\S]*?)<e>", "$1"),
        ]
        .into_iter()
        .map(|(pattern, replacement)| (Regex::new(pattern).unwrap(), replacement))
        .collect()
    });
    let mut cleaned = text.to_string();
    for (pattern, replacement) in steps {
        cleaned = pattern.replace_all(&cleaned, *replacement).into_owned();
    }
    let mut match_set = std::collections::HashSet::new();
    for term in strong_terms {
        let full = format!("{}{}", term.prefix, term.number).to_uppercase();
        let num = term.number.to_uppercase();
        match_set.insert(full);
        match_set.insert(num);
    }
    static S_RE: OnceLock<Regex> = OnceLock::new();
    let s_re = S_RE.get_or_init(|| Regex::new(r"(\S+)\s*<S[^>]*>([\s\S]*?)</S>").unwrap());
    cleaned = s_re
        .replace_all(&cleaned, |caps: &regex::Captures| {
            let word = &caps[1];
            let raw_code = caps[2].trim().to_uppercase();
            if match_set.contains(&raw_code)
                || match_set
                    .iter()
                    .any(|m| raw_code.ends_with(m) || m.ends_with(&raw_code))
            {
                let clean_num = raw_code.trim_start_matches(|c: char| c.is_alphabetic());
                format!("<mark>{word} [{clean_num}]</mark>")
            } else {
                word.to_string()
            }
        })
        .into_owned();
    static TAG_RE: OnceLock<Regex> = OnceLock::new();
    let tag_re = TAG_RE.get_or_init(|| Regex::new(r"<[^>]+>").unwrap());
    cleaned = tag_re
        .replace_all(&cleaned, |caps: &regex::Captures| {
            let tag = &caps[0];
            if tag == "<mark>" || tag == "</mark>" {
                tag.to_string()
            } else {
                " ".to_string()
            }
        })
        .into_owned();
    collapse_ws(&cleaned)
}

/// The full verse text formatted for search results, with matched Strong's numbers
/// and search terms highlighted, without truncating the verse.
pub fn search_result_verse(
    text: &str,
    terms: &[String],
    strong_terms: &[SearchStrongTerm],
) -> String {
    if strong_terms.is_empty() {
        let plain = search_preview_plain(text);
        if terms.is_empty() {
            plain
        } else {
            highlight_text(&plain, terms)
        }
    } else {
        let with_strongs = clean_text_with_strongs(text, strong_terms);
        if terms.is_empty() {
            with_strongs
        } else {
            highlight_outside_marks(&with_strongs, terms)
        }
    }
}

fn highlight_outside_marks(text: &str, terms: &[String]) -> String {
    let mut result = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = rest.find("<mark>") {
        let (outside, tail) = rest.split_at(start);
        result.push_str(&highlight_text(outside, terms));
        if let Some(end) = tail.find("</mark>") {
            let mark_end = end + "</mark>".len();
            result.push_str(&tail[..mark_end]);
            rest = &tail[mark_end..];
        } else {
            result.push_str(tail);
            rest = "";
            break;
        }
    }
    if !rest.is_empty() {
        result.push_str(&highlight_text(rest, terms));
    }
    result
}

/// A short window around the first match, with Strong's tags highlighted.
pub fn search_preview_rich_snippet(
    text: &str,
    terms: &[String],
    strong_terms: &[SearchStrongTerm],
    max_chars: usize,
) -> String {
    if max_chars == usize::MAX {
        return search_result_verse(text, terms, strong_terms);
    }
    if strong_terms.is_empty() {
        let snippet = search_preview_snippet(text, terms, max_chars);
        return highlight_text(&snippet, terms);
    }
    let with_strongs = clean_text_with_strongs(text, strong_terms);
    if with_strongs.len() <= max_chars {
        return with_strongs;
    }
    let lower = with_strongs.to_lowercase();
    let mark_pos = lower.find("<mark>").unwrap_or(0);
    let chars: Vec<char> = with_strongs.chars().collect();
    let mark_char_idx = with_strongs[..mark_pos].chars().count();
    let mut start = mark_char_idx.saturating_sub(max_chars / 3);
    let mut end = (start + max_chars).min(chars.len());
    if end - start < max_chars && start > 0 {
        start = end.saturating_sub(max_chars);
    }
    start = word_boundary(&chars, start, -1);
    end = word_boundary(&chars, end, 1);
    let mut snippet: String = chars[start..end].iter().collect();
    if snippet.contains("<mark>") && !snippet.contains("</mark>") {
        snippet.push_str("</mark>");
    } else if !snippet.contains("<mark>") && snippet.contains("</mark>") {
        snippet.insert_str(0, "<mark>");
    }
    if start > 0 {
        snippet.insert_str(0, "...");
    }
    if end < chars.len() {
        snippet.push_str("...");
    }
    snippet
}

/// A short window around the first match, the same 160-character preview the search list used.
pub fn search_preview_snippet(text: &str, terms: &[String], max_chars: usize) -> String {
    let compact = search_preview_plain(text);
    if compact.is_empty() || compact.chars().count() <= max_chars {
        return compact;
    }
    let chars: Vec<char> = compact.chars().collect();
    let lower: String = chars.iter().collect::<String>().to_lowercase();
    let first = terms
        .iter()
        .filter_map(|term| lower.find(&term.to_lowercase()))
        .min();
    let Some(first) = first else {
        let end = word_boundary(&chars, max_chars.min(chars.len()), 1);
        let mut snippet: String = chars[..end].iter().collect();
        snippet = snippet.trim_end().to_string();
        snippet.push_str("...");
        return snippet;
    };
    let first_chars = lower[..first].chars().count();
    let mut start = first_chars.saturating_sub(max_chars / 2);
    let mut end = (start + max_chars).min(chars.len());
    if end - start < max_chars && start > 0 {
        start = end.saturating_sub(max_chars);
    }
    start = word_boundary(&chars, start, -1);
    end = word_boundary(&chars, end, 1);
    while start < end && chars[start].is_whitespace() {
        start += 1;
    }
    while end > start && chars[end - 1].is_whitespace() {
        end -= 1;
    }
    let mut snippet: String = chars[start..end].iter().collect();
    if start > 0 {
        snippet.insert_str(0, "...");
    }
    if end < chars.len() {
        snippet.push_str("...");
    }
    snippet
}

fn word_boundary(chars: &[char], pos: usize, direction: i32) -> usize {
    if direction < 0 {
        let mut index = pos.min(chars.len());
        while index > 0 && !chars[index - 1].is_whitespace() {
            index -= 1;
        }
        index
    } else {
        let mut index = pos.min(chars.len());
        while index < chars.len() && !chars[index].is_whitespace() {
            index += 1;
        }
        index
    }
}

pub fn normalize_search_text(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut pending_space = false;
    for ch in text.nfd() {
        if ('\u{0300}'..='\u{036f}').contains(&ch) {
            continue;
        }
        for lower_ch in ch.to_lowercase() {
            if lower_ch.is_ascii_alphanumeric() {
                if pending_space && !out.is_empty() {
                    out.push(' ');
                }
                pending_space = false;
                out.push(lower_ch);
            } else {
                pending_space = true;
            }
        }
    }
    out
}

pub fn matches_parsed_search(text: &str, parsed: &ParsedSearchQuery) -> bool {
    if parsed.text_terms.is_empty() && parsed.exact_phrases.is_empty() {
        return true;
    }
    let stripped = strip_search_markup(text);
    let normalized_text = normalize_search_text(&stripped);
    if normalized_text.is_empty() {
        return false;
    }
    if !parsed.exact_phrases.is_empty() {
        let padded_text = format!(" {normalized_text} ");
        for phrase in &parsed.exact_phrases {
            let normalized_phrase = normalize_search_text(phrase);
            if normalized_phrase.is_empty() {
                return false;
            }
            let padded_phrase = format!(" {normalized_phrase} ");
            if !padded_text.contains(&padded_phrase) {
                return false;
            }
        }
    }
    for term in &parsed.text_terms {
        let norm_term = normalize_search_text(term);
        if norm_term.is_empty() {
            continue;
        }
        if !normalized_text.contains(&norm_term) {
            return false;
        }
        if !normalized_text.split_whitespace().any(|tok| tok == norm_term) {
            return false;
        }
    }
    true
}

pub fn extract_search_terms(query: &str) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    let mut terms = Vec::new();
    let without_strongs = strong_re().replace_all(query, " ");
    let without_quoted = phrase_re().replace_all(&without_strongs, |caps: &regex::Captures| {
        let normalized = collapse_ws(&caps[1]);
        if normalized.chars().count() >= 2 {
            terms.push(normalized);
        }
        " "
    });
    for term in without_quoted
        .split_whitespace()
        .filter(|t| t.chars().count() >= 2)
    {
        let key = term.to_lowercase();
        if seen.insert(key) {
            terms.push(term.to_string());
        }
    }
    terms
}

pub fn highlight_text(text: &str, terms: &[String]) -> String {
    if text.is_empty() || terms.is_empty() {
        return escape_html(text);
    }

    struct WordSpan {
        start: usize,
        end: usize,
        norm: String,
    }

    let mut spans = Vec::new();
    let mut word_start = None;
    for (idx, ch) in text.char_indices() {
        if ch.is_alphanumeric() {
            if word_start.is_none() {
                word_start = Some(idx);
            }
        } else if let Some(s) = word_start {
            let slice = &text[s..idx];
            spans.push(WordSpan {
                start: s,
                end: idx,
                norm: normalize_search_text(slice),
            });
            word_start = None;
        }
    }
    if let Some(s) = word_start {
        let slice = &text[s..];
        spans.push(WordSpan {
            start: s,
            end: text.len(),
            norm: normalize_search_text(slice),
        });
    }

    let mut matched_ranges: Vec<(usize, usize)> = Vec::new();

    for term in terms {
        let norm_term = normalize_search_text(term);
        if norm_term.is_empty() {
            continue;
        }

        let term_words: Vec<&str> = norm_term.split(' ').filter(|w| !w.is_empty()).collect();
        if term_words.is_empty() {
            continue;
        }

        if term_words.len() == 1 {
            let single_term = term_words[0];
            for span in &spans {
                if span.norm == single_term {
                    matched_ranges.push((span.start, span.end));
                }
            }
        } else {
            let phrase_len = term_words.len();
            if spans.len() >= phrase_len {
                for i in 0..=(spans.len() - phrase_len) {
                    let window = &spans[i..i + phrase_len];
                    let matches_phrase = window
                        .iter()
                        .zip(term_words.iter())
                        .all(|(span, target)| span.norm == **target);
                    if matches_phrase {
                        let start = window[0].start;
                        let end = window[phrase_len - 1].end;
                        matched_ranges.push((start, end));
                    }
                }
            }
        }
    }

    if matched_ranges.is_empty() {
        return escape_html(text);
    }

    matched_ranges.sort_by_key(|&(s, _)| s);
    let mut merged: Vec<(usize, usize)> = Vec::with_capacity(matched_ranges.len());
    for (start, end) in matched_ranges {
        if let Some(last) = merged.last_mut() {
            if start <= last.1 {
                last.1 = last.1.max(end);
                continue;
            }
        }
        merged.push((start, end));
    }

    let mut result = String::with_capacity(text.len() + merged.len() * 15);
    let mut cursor = 0;
    for (start, end) in merged {
        if start > cursor {
            result.push_str(&escape_html(&text[cursor..start]));
        }
        result.push_str("<mark>");
        result.push_str(&escape_html(&text[start..end]));
        result.push_str("</mark>");
        cursor = end;
    }
    if cursor < text.len() {
        result.push_str(&escape_html(&text[cursor..]));
    }
    result
}

pub fn escape_html(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

#[cfg(test)]
mod search_query_tests {
    use super::*;

    #[test]
    fn parses_strong_numbers() {
        let result = parse_search_query(Some("strong:H1234"));
        assert_eq!(
            result.strongs,
            vec![SearchStrongTerm {
                prefix: "H".into(),
                number: "1234".into()
            }]
        );
        assert!(result.text_terms.is_empty());
    }

    #[test]
    fn parses_greek_strong_numbers() {
        let result = parse_search_query(Some("strong:G5678"));
        assert_eq!(
            result.strongs,
            vec![SearchStrongTerm {
                prefix: "G".into(),
                number: "5678".into()
            }]
        );
    }

    #[test]
    fn parses_mixed_query() {
        let result = parse_search_query(Some("strong:H1234 love"));
        assert_eq!(result.strongs.len(), 1);
        assert_eq!(result.text_terms, vec!["love".to_string()]);
    }

    #[test]
    fn parses_exact_quoted_phrases_separately_from_fuzzy_terms() {
        let result = parse_search_query(Some(r#"strong:G123 "kingdom of God" creatd"#));
        assert_eq!(
            result.strongs,
            vec![SearchStrongTerm {
                prefix: "G".into(),
                number: "123".into()
            }]
        );
        assert_eq!(result.exact_phrases, vec!["kingdom of God".to_string()]);
        assert_eq!(result.text_terms, vec!["creatd".to_string()]);
    }

    #[test]
    fn treats_unmatched_quotes_as_normal_text_while_typing() {
        let result = parse_search_query(Some("\"kingdom"));
        assert!(result.exact_phrases.is_empty());
        assert_eq!(result.text_terms, vec!["\"kingdom".to_string()]);
    }

    #[test]
    fn search_preview_hides_morphology_lemmas_and_original_words() {
        let raw = "E ao jebuseu<S>2983</S><m>subs.m.sg.a</m><l>יְבוּסִי</l>, ao amorreu<S>567</S><m>subs.m.sg.a</m><l>אֱמֹרִי</l>,";
        let plain = search_preview_plain(raw);
        assert_eq!(plain, "E ao jebuseu , ao amorreu ,");
        assert!(!plain.contains("subs."));
        assert!(!plain.contains('י'));
        assert!(!plain.contains('א'));
        let snippet = search_preview_snippet(raw, &["jebuseu".into()], 160);
        assert!(snippet.contains("jebuseu"));
        assert!(!snippet.contains("subs."));
    }

    #[test]
    fn handles_empty_query() {
        let result = parse_search_query(Some(""));
        assert!(result.strongs.is_empty());
        assert!(result.text_terms.is_empty());
    }

    #[test]
    fn clean_text_with_strongs_marks_matched_occurrences() {
        let raw = "E as ensinarás<S>8150</S> a teus filhos e delas falarás assentado em tua casa,";
        let strongs = vec![SearchStrongTerm {
            prefix: "H".into(),
            number: "8150".into(),
        }];
        let marked = clean_text_with_strongs(raw, &strongs);
        assert_eq!(
            marked,
            "E as <mark>ensinarás [8150]</mark> a teus filhos e delas falarás assentado em tua casa,"
        );
        let snippet = search_preview_rich_snippet(raw, &[], &strongs, 160);
        assert_eq!(
            snippet,
            "E as <mark>ensinarás [8150]</mark> a teus filhos e delas falarás assentado em tua casa,"
        );
    }

    #[test]
    fn search_result_verse_shows_entire_verse_without_clipping_for_strongs() {
        let raw = "E eis que estou contigo, e te guardarei<S>8104</S> por onde quer que fores, e te farei tornar a esta terra; porque não te deixarei, até que haja cumprido o que te tenho dito.";
        let strongs = vec![SearchStrongTerm {
            prefix: "H".into(),
            number: "8104".into(),
        }];
        let result = search_result_verse(raw, &[], &strongs);
        assert_eq!(
            result,
            "E eis que estou contigo, e te <mark>guardarei [8104]</mark> por onde quer que fores, e te farei tornar a esta terra; porque não te deixarei, até que haja cumprido o que te tenho dito."
        );
        assert!(!result.contains("..."));
    }

    #[test]
    fn search_result_verse_shows_entire_verse_without_clipping_for_text_terms() {
        let raw = "E eis que estou contigo, e te guardarei por onde quer que fores, e te farei tornar a esta terra; porque não te deixarei, até que haja cumprido o que te tenho dito.";
        let terms = vec!["guardarei".into()];
        let result = search_result_verse(raw, &terms, &[]);
        assert_eq!(
            result,
            "E eis que estou contigo, e te <mark>guardarei</mark> por onde quer que fores, e te farei tornar a esta terra; porque não te deixarei, até que haja cumprido o que te tenho dito."
        );
        assert!(!result.contains("..."));
    }

    #[test]
    fn highlight_text_handles_diacritics_accent_insensitively() {
        let raw = "A bênção do SENHOR é que enriquece, e a graça de Deus traz salvação pelo Espírito Santo a João.";
        let terms = vec![
            "bencao".into(),
            "graca".into(),
            "espirito".into(),
            "joao".into(),
        ];
        let highlighted = highlight_text(raw, &terms);
        assert_eq!(
            highlighted,
            "A <mark>bênção</mark> do SENHOR é que enriquece, e a <mark>graça</mark> de Deus traz salvação pelo <mark>Espírito</mark> Santo a <mark>João</mark>."
        );
    }

    #[test]
    fn search_matching_and_highlighting_reject_unrelated_similar_names() {
        let joao_query = parse_search_query(Some("joão"));
        let jotao_verse = "Jotão tinha vinte e cinco anos quando começou a reinar.";
        let joao_verse = "Houve um homem enviado de Deus, cujo nome era João.";
        assert!(!matches_parsed_search(jotao_verse, &joao_query));
        assert!(matches_parsed_search(joao_verse, &joao_query));

        let highlighted_joao = highlight_text("Jotão e João foram ao templo", &["joao".into()]);
        assert_eq!(
            highlighted_joao,
            "Jotão e <mark>João</mark> foram ao templo"
        );

        let jesus_query = parse_search_query(Some("jesus"));
        let jesua_verse = "Estes são os que subiram com Jesuá e Neemias.";
        let jeus_verse = "Estes foram os filhos de Oolibama: Jeús, Jalão e Corá.";
        let jesus_verse = "Livro da genealogia de Jesus Cristo, filho de Davi.";
        assert!(!matches_parsed_search(jesua_verse, &jesus_query));
        assert!(!matches_parsed_search(jeus_verse, &jesus_query));
        assert!(matches_parsed_search(jesus_verse, &jesus_query));

        let highlighted_jesus = highlight_text("Jesuá, Jeús e Jesus Cristo", &["jesus".into()]);
        assert_eq!(
            highlighted_jesus,
            "Jesuá, Jeús e <mark>Jesus</mark> Cristo"
        );
    }

    #[test]
    fn search_matching_rejects_unrelated_near_words_and_substrings() {
        let parsed = parse_search_query(Some("amor"));

        // Unrelated near words that differ by 1 letter on short words must NOT match
        let gn_19_38 = "E a menor também deu à luz um filho , e chamou o seu nome Ben-Ami ; este é o pai dos filhos de Amom até o dia de hoje .";
        assert!(!matches_parsed_search(gn_19_38, &parsed));

        let gn_24_67 = "E Isaque trouxe -a para a tenda de sua mãe Sara , e tomou a Rebeca , e foi-lhe por mulher , e amou -a. Assim Isaque foi consolado depois da morte de sua mãe .";
        assert!(!matches_parsed_search(gn_24_67, &parsed));

        let gn_29_30 = "E possuiu também a Raquel , e amou também a Raquel mais do que a Lia e serviu com ele ainda outros sete anos .";
        assert!(!matches_parsed_search(gn_29_30, &parsed));

        // Substring inside unrelated words must NOT match
        let gn_19_13 = "Porque nós vamos destruir este lugar , porque o seu clamor tem aumentado diante da face do SENHOR , e o SENHOR nos enviou a destruí -lo.";
        assert!(!matches_parsed_search(gn_19_13, &parsed));

        let dt_3_9 = "A Hermom os sidônios chamam Siriom ; porém os amorreus o chamam Senir";
        assert!(!matches_parsed_search(dt_3_9, &parsed));

        // Actual occurrences of the searched word MUST match
        let gn_26_7 = "E perguntando -lhe os homens daquele lugar acerca de sua mulher , disse : É minha irmã ; porque temia dizer : É minha mulher ; para que porventura (dizia ele) não me matem os homens daquele lugar por amor de Rebeca ; porque era formosa à vista .";
        assert!(matches_parsed_search(gn_26_7, &parsed));

        let gn_26_24 = "E apareceu -lhe o SENHOR naquela mesma noite , e disse : Eu sou o Deus de Abraão teu pai ; não temas , porque eu sou contigo , e abençoar -te-ei, e multiplicarei a tua descendência por amor de Abraão meu servo .";
        assert!(matches_parsed_search(gn_26_24, &parsed));
    }

    #[test]
    fn highlight_text_does_not_mark_inside_unrelated_words() {
        let gn_19_13 = "porque o seu clamor tem aumentado diante da face do SENHOR";
        let highlighted = highlight_text(gn_19_13, &["amor".into()]);
        assert_eq!(highlighted, gn_19_13);
        assert!(!highlighted.contains("<mark>"));
    }
}
