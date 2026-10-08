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
    static RE_S: OnceLock<Regex> = OnceLock::new();
    static RE_TAG: OnceLock<Regex> = OnceLock::new();
    let re_s = RE_S.get_or_init(|| Regex::new(r"(?i)<S[^>]*>[\s\S]*?</S>").unwrap());
    let re_tag = RE_TAG.get_or_init(|| Regex::new(r"<[^>]+>").unwrap());
    re_tag
        .replace_all(&re_s.replace_all(text, " "), " ")
        .into_owned()
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
    let folded: String = text
        .nfd()
        .filter(|ch| !('\u{0300}'..='\u{036f}').contains(ch))
        .collect();
    let lower = folded.to_lowercase();
    let mut out = String::new();
    let mut pending_space = false;
    for ch in lower.chars() {
        if ch.is_ascii_alphanumeric() {
            if pending_space && !out.is_empty() {
                out.push(' ');
            }
            pending_space = false;
            out.push(ch);
        } else {
            pending_space = true;
        }
    }
    out
}

fn allowed_edit_distance(term: &str) -> usize {
    if term.chars().count() >= 4 {
        1
    } else {
        0
    }
}

fn edit_distance_within(a: &str, b: &str, max_distance: usize) -> bool {
    if a == b {
        return true;
    }
    let a: Vec<char> = a.chars().collect();
    let b: Vec<char> = b.chars().collect();
    if a.len().abs_diff(b.len()) > max_distance {
        return false;
    }
    let mut prev: Vec<usize> = (0..=b.len()).collect();
    for i in 1..=a.len() {
        let mut curr = vec![i];
        let mut row_min = curr[0];
        for j in 1..=b.len() {
            let cost = if a[i - 1] == b[j - 1] { 0 } else { 1 };
            let value = (curr[j - 1] + 1).min(prev[j] + 1).min(prev[j - 1] + cost);
            curr.push(value);
            row_min = row_min.min(value);
        }
        if row_min > max_distance {
            return false;
        }
        prev = curr;
    }
    prev[b.len()] <= max_distance
}

fn matches_fuzzy_term(term: &str, normalized_text: &str, tokens: &[&str]) -> bool {
    if term.is_empty() {
        return false;
    }
    if normalized_text.contains(term) {
        return true;
    }
    if tokens.iter().any(|token| token.starts_with(term)) {
        return true;
    }
    let max_distance = allowed_edit_distance(term);
    if max_distance == 0 {
        return false;
    }
    let term_first = term.chars().next();
    tokens.iter().any(|token| {
        if token.chars().next() != term_first {
            return false;
        }
        if token.chars().count().abs_diff(term.chars().count()) > max_distance {
            return false;
        }
        edit_distance_within(token, term, max_distance)
    })
}

pub fn matches_parsed_search(text: &str, parsed: &ParsedSearchQuery) -> bool {
    if parsed.text_terms.is_empty() && parsed.exact_phrases.is_empty() {
        return true;
    }
    let normalized_text = normalize_search_text(&strip_search_markup(text));
    if normalized_text.is_empty() {
        return false;
    }
    for phrase in &parsed.exact_phrases {
        let normalized_phrase = normalize_search_text(phrase);
        if normalized_phrase.is_empty() || !normalized_text.contains(&normalized_phrase) {
            return false;
        }
    }
    let owned: Vec<String> = normalized_text
        .split(' ')
        .filter(|t| !t.is_empty())
        .map(|t| t.to_string())
        .collect();
    let tokens: Vec<&str> = owned.iter().map(|s| s.as_str()).collect();
    for term in &parsed.text_terms {
        if !matches_fuzzy_term(&normalize_search_text(term), &normalized_text, &tokens) {
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
    let mut result = escape_html(text);
    for term in terms {
        let escaped = escape_html(term);
        if escaped.is_empty() {
            continue;
        }
        let pattern = format!("(?i)({})", regex::escape(&escaped));
        if let Ok(re) = Regex::new(&pattern) {
            result = re.replace_all(&result, "<mark>$1</mark>").into_owned();
        }
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
}
