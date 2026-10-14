//! Verse markup shared by the window and the tests.
//!
//! MyBible `<S>` tags and theWord interlinear pairs become spans the UI can draw
//! without keeping an HTML parser in the shell.

use regex::Regex;
use std::sync::OnceLock;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VerseSpan {
    Text(String),
    Strong {
        display: String,
        morph: Option<String>,
        lemma: Option<String>,
    },
    /// Interlinear note under a word: original, transliteration, pronunciation, gloss, LN/GK.
    Annotation {
        original: Option<String>,
        transliteration: Option<String>,
        pronunciation: Option<String>,
        glosses: Vec<String>,
        references: Vec<String>,
    },
    Footnote(String),
}

/// Verse line the reader sees: translation words, without Strong's tags or interlinear notes.
pub fn visible_verse_line(text: &str) -> String {
    let (spans, _) = verse_spans(text, false, "");
    spans
        .iter()
        .filter_map(|span| match span {
            VerseSpan::Text(body) => Some(body.as_str()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join(" ")
}

pub fn verse_spans(
    text: &str,
    show_strongs: bool,
    strongs_prefix: &str,
) -> (Vec<VerseSpan>, Vec<String>) {
    let mut footnotes = Vec::new();
    let input = strip_footnotes(text, &mut footnotes);
    let normalized = normalize_plain(&input);
    let mut spans = Vec::new();
    consume_mixed(&mut spans, &normalized, show_strongs, strongs_prefix);
    (spans, footnotes)
}

fn consume_mixed(spans: &mut Vec<VerseSpan>, text: &str, show_strongs: bool, prefix: &str) {
    let mut rest = text;
    while !rest.is_empty() {
        let Some(pos) = find_ci(rest, "<E>") else {
            push_markup(spans, rest, show_strongs, prefix);
            break;
        };
        if pos > 0 {
            push_markup(spans, &rest[..pos], show_strongs, prefix);
        }
        match take_interlinear(&rest[pos..], prefix) {
            Some((word, consumed)) if consumed > 0 => {
                spans.extend(word);
                rest = &rest[pos + consumed..];
            }
            _ => {
                let after = pos + 1;
                let next = rest[after..]
                    .find('<')
                    .map(|index| after + index)
                    .unwrap_or(rest.len());
                push_markup(spans, &rest[pos..next], show_strongs, prefix);
                rest = &rest[next..];
            }
        }
    }
}

fn take_interlinear(text: &str, prefix: &str) -> Option<(Vec<VerseSpan>, usize)> {
    let (translated, mut cursor) = extract_pair(text, &["E"])?;
    let mut original = None;
    let mut transliteration = None;
    if let Some((value, next)) = extract_pair(&text[cursor..], &["OG", "OH", "O"]) {
        original = nonempty(value.trim());
        cursor += next;
    }
    if let Some((value, next)) = extract_pair(&text[cursor..], &["TG", "TH", "T"]) {
        transliteration = nonempty(value.trim());
        cursor += next;
    }
    let next_word = find_ci(&text[cursor..], "<E>").unwrap_or(text.len() - cursor);
    let segment = &text[cursor..cursor + next_word];
    let consumed = cursor + next_word;
    let strongs = collect_strongs(segment, prefix);
    let annotation = annotation_from(segment, original, transliteration);
    let trailing = collapse(&plain_trailing(segment));
    let mut top = translated.trim().to_string();
    if !trailing.is_empty() {
        if !top.is_empty() {
            top.push(' ');
        }
        top.push_str(&trailing);
    }
    let mut spans = Vec::new();
    if !top.is_empty() {
        spans.push(VerseSpan::Text(top));
    }
    spans.extend(strongs);
    if let Some(annotation) = annotation {
        spans.push(VerseSpan::Annotation {
            original: annotation.0,
            transliteration: annotation.1,
            pronunciation: annotation.2,
            glosses: annotation.3,
            references: annotation.4,
        });
    }
    Some((spans, consumed))
}

fn annotation_from(
    segment: &str,
    original: Option<String>,
    transliteration: Option<String>,
) -> Option<(
    Option<String>,
    Option<String>,
    Option<String>,
    Vec<String>,
    Vec<String>,
)> {
    let mut pronunciation = None;
    let mut glosses = Vec::new();
    let mut references = Vec::new();
    if let Some(body) = x_body(segment) {
        for pair in body.split('|') {
            let Some((key, value)) = pair.split_once('=') else {
                continue;
            };
            let value = value.trim();
            if value.is_empty() {
                continue;
            }
            match key.trim() {
                "pr" => pronunciation = Some(value.to_string()),
                "pbr" | "og" | "es" => glosses.push(value.to_string()),
                "ln" => references.push(format!("LN {value}")),
                "gk" => references.push(format!("GK {value}")),
                _ => {}
            }
        }
    }
    if original.is_none()
        && transliteration.is_none()
        && pronunciation.is_none()
        && glosses.is_empty()
        && references.is_empty()
    {
        return None;
    }
    Some((
        original,
        transliteration,
        pronunciation,
        glosses,
        references,
    ))
}

fn x_body(segment: &str) -> Option<String> {
    let lower = segment.to_ascii_lowercase();
    let start = lower.find("<x>")?;
    let end = lower[start + 3..].find("<x>")?;
    Some(segment[start + 3..start + 3 + end].to_string())
}

fn collect_strongs(segment: &str, prefix: &str) -> Vec<VerseSpan> {
    let prepared = attach_morph_lemma(segment);
    static STRONG: OnceLock<Regex> = OnceLock::new();
    let strong = STRONG.get_or_init(|| {
        Regex::new(r#"(?i)<S(?:\s+morph="([^"]*)")?(?:\s+lemma="([^"]*)")?>([GH]?\d+\w*)</S>"#)
            .unwrap()
    });
    let mut spans = Vec::new();
    for caps in strong.captures_iter(&prepared) {
        let num = caps.get(3).map(|m| m.as_str()).unwrap_or("");
        let display = strong_display(num, prefix);
        if display.is_empty() {
            continue;
        }
        spans.push(VerseSpan::Strong {
            display,
            morph: caps
                .get(1)
                .map(|m| m.as_str().to_string())
                .filter(|s| !s.is_empty()),
            lemma: caps
                .get(2)
                .map(|m| m.as_str().to_string())
                .filter(|s| !s.is_empty()),
        });
    }
    static WORD: OnceLock<Regex> = OnceLock::new();
    let word = WORD.get_or_init(|| Regex::new(r"(?i)<W([HG])(\d+)>").unwrap());
    for caps in word.captures_iter(segment) {
        spans.push(VerseSpan::Strong {
            display: format!("{}{}", caps[1].to_uppercase(), &caps[2]),
            morph: None,
            lemma: None,
        });
    }
    spans
}

fn plain_trailing(segment: &str) -> String {
    static DROP: OnceLock<Regex> = OnceLock::new();
    let drop = DROP.get_or_init(|| {
        Regex::new(
            r"(?i)<S[^>]*>[\s\S]*?</S>|<W[HG]\d+>|<m>[\s\S]*?</m>|<l>[\s\S]*?</l>|<X>[\s\S]*?<x>|<wt>|<RX[^>]*>|</?(?:E|O|T|OG|OH|TG|TH)>",
        )
        .unwrap()
    });
    strip_tags(&drop.replace_all(segment, " "))
}

fn extract_pair<'a>(text: &'a str, openings: &[&str]) -> Option<(&'a str, usize)> {
    let trimmed_len = text.len() - text.trim_start().len();
    let trimmed = text.trim_start();
    for open in openings {
        let open_tag = format!("<{open}>");
        if !starts_with_ignore_ascii_case(trimmed, &open_tag) {
            continue;
        }
        let close_tag = format!("<{}>", open.to_lowercase());
        let body_start = open_tag.len();
        let rel = find_ci(&trimmed[body_start..], &close_tag)?;
        let value = &trimmed[body_start..body_start + rel];
        let next = trimmed_len + body_start + rel + close_tag.len();
        return Some((value, next));
    }
    None
}

fn starts_with_ignore_ascii_case(text: &str, prefix: &str) -> bool {
    let mut chars = text.chars();
    for expected in prefix.chars() {
        match chars.next() {
            Some(ch) if ch.eq_ignore_ascii_case(&expected) => {}
            _ => return false,
        }
    }
    true
}

fn find_ci(hay: &str, needle: &str) -> Option<usize> {
    let needle = needle.as_bytes();
    hay.as_bytes()
        .windows(needle.len())
        .position(|window| window.eq_ignore_ascii_case(needle))
}

fn nonempty(value: &str) -> Option<String> {
    if value.is_empty() {
        None
    } else {
        Some(value.to_string())
    }
}

fn push_markup(spans: &mut Vec<VerseSpan>, text: &str, show_strongs: bool, strongs_prefix: &str) {
    if text.is_empty() {
        return;
    }
    if !show_strongs {
        static STRONG_BLOCK: OnceLock<Regex> = OnceLock::new();
        let block = STRONG_BLOCK.get_or_init(|| Regex::new(r"(?i)<S[^>]*>[\s\S]*?</S>").unwrap());
        let plain = collapse(&strip_tags(&block.replace_all(text, " ")));
        push_text(spans, &plain);
        return;
    }
    static STRONG: OnceLock<Regex> = OnceLock::new();
    let strong = STRONG.get_or_init(|| {
        Regex::new(r#"(?i)<S(?:\s+morph="([^"]*)")?(?:\s+lemma="([^"]*)")?>([GH]?\d+\w*)</S>"#)
            .unwrap()
    });
    let prepared = attach_morph_lemma(text);
    let mut last = 0;
    for caps in strong.captures_iter(&prepared) {
        let whole = caps.get(0).unwrap();
        push_text(spans, &strip_tags(&prepared[last..whole.start()]));
        let display = strong_display(
            caps.get(3).map(|m| m.as_str()).unwrap_or(""),
            strongs_prefix,
        );
        if !display.is_empty() {
            spans.push(VerseSpan::Strong {
                display,
                morph: caps
                    .get(1)
                    .map(|m| m.as_str().to_string())
                    .filter(|s| !s.is_empty()),
                lemma: caps
                    .get(2)
                    .map(|m| m.as_str().to_string())
                    .filter(|s| !s.is_empty()),
            });
        }
        last = whole.end();
    }
    push_text(spans, &strip_tags(&prepared[last..]));
}

fn strong_display(num: &str, prefix: &str) -> String {
    let num = num.trim();
    if num.is_empty() {
        return String::new();
    }
    if num.starts_with(['G', 'g', 'H', 'h']) {
        num.to_uppercase()
    } else {
        format!("{prefix}{num}")
    }
}

fn push_text(spans: &mut Vec<VerseSpan>, text: &str) {
    let collapsed = collapse(text);
    if !collapsed.is_empty() {
        spans.push(VerseSpan::Text(collapsed));
    }
}

fn collapse(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn strip_footnotes(text: &str, footnotes: &mut Vec<String>) -> String {
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| Regex::new(r"(?i)<f>([\s\S]*?)</f>").unwrap());
    re.replace_all(text, |caps: &regex::Captures| {
        footnotes.push(caps[1].trim().to_string());
        ""
    })
    .into_owned()
}

fn attach_morph_lemma(text: &str) -> String {
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| {
        Regex::new(r"(?i)<S>(\d+\w*)</S>(?:\s*<m>([^<]*)</m>)?(?:\s*<l>([^<]*)</l>)?").unwrap()
    });
    re.replace_all(text, |caps: &regex::Captures| {
        let num = &caps[1];
        let morph = caps.get(2).map(|m| m.as_str()).unwrap_or("");
        let lemma = caps.get(3).map(|m| m.as_str()).unwrap_or("");
        let mut attrs = String::new();
        if !morph.is_empty() {
            attrs.push_str(&format!(" morph=\"{morph}\""));
        }
        if !lemma.is_empty() {
            attrs.push_str(&format!(" lemma=\"{lemma}\""));
        }
        format!("<S{attrs}>{num}</S>")
    })
    .into_owned()
}

fn strip_tags(text: &str) -> String {
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| Regex::new(r"<[^>]+>").unwrap());
    re.replace_all(text, " ").into_owned()
}

fn normalize_plain(text: &str) -> String {
    static HIDDEN: OnceLock<Regex> = OnceLock::new();
    let hidden = HIDDEN.get_or_init(|| Regex::new(r"(?i)<n>[\s\S]*?</n>").unwrap());
    hidden.replace_all(text, "").into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_mybible_strongs_morph_lemma_and_footnotes() {
        let (spans, footnotes) = verse_spans(
            "<pb/><J>Jesus</J> <i>said</i> word <S>123</S><m>N-NSM</m><l>lemma</l><f>foot note</f><h>Heading</h><n>hidden</n>",
            true,
            "H",
        );
        assert_eq!(footnotes, vec!["foot note".to_string()]);
        assert!(spans.iter().any(|span| matches!(span, VerseSpan::Strong { display, morph, lemma }
            if display == "H123" && morph.as_deref() == Some("N-NSM") && lemma.as_deref() == Some("lemma"))));
        let plain = spans
            .iter()
            .filter_map(|span| match span {
                VerseSpan::Text(text) => Some(text.as_str()),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join(" ");
        assert!(plain.contains("Jesus"));
        assert!(plain.contains("Heading"));
        assert!(!plain.contains("hidden"));
        assert!(!plain.contains("foot note"));
    }

    #[test]
    fn interlinear_tags_stay_annotations_instead_of_verse_text() {
        let raw =
            "<E>Word<e><O>Λόγος<o><T>lógos<t><S>3056</S><X>pr=lo-gos|pbr=word|ln=33.1|gk=3364<x>";
        let (spans, _) = verse_spans(raw, true, "G");
        let line = visible_verse_line(raw);
        assert_eq!(line, "Word");
        assert!(!line.contains("pr="));
        assert!(!line.contains("Λόγος"));
        assert!(spans.iter().any(|span| matches!(
            span,
            VerseSpan::Strong { display, .. } if display == "G3056"
        )));
        assert!(spans.iter().any(|span| matches!(
            span,
            VerseSpan::Annotation {
                original,
                transliteration,
                pronunciation,
                glosses,
                references,
            } if original.as_deref() == Some("Λόγος")
                && transliteration.as_deref() == Some("lógos")
                && pronunciation.as_deref() == Some("lo-gos")
                && glosses == &vec!["word".to_string()]
                && references == &vec!["LN 33.1".to_string(), "GK 3364".to_string()]
        )));
    }

    #[test]
    fn hides_strongs_when_display_is_off() {
        let (spans, _) = verse_spans("word <S>123</S>", false, "G");
        assert_eq!(spans, vec![VerseSpan::Text("word".into())]);
    }
}
