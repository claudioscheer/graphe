use regex::Regex;
use std::sync::OnceLock;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DefinitionItem {
    pub label: String,
    pub text: String,
}

struct DefinitionIndex {
    label: String,
    start: usize,
    content_start: usize,
}

pub fn get_level(label: &str) -> u8 {
    static DEEP: OnceLock<Regex> = OnceLock::new();
    static MID: OnceLock<Regex> = OnceLock::new();
    let deep = DEEP.get_or_init(|| Regex::new(r"^\d+[a-z]\d+$").unwrap());
    let mid = MID.get_or_init(|| Regex::new(r"^\d+[a-z]$").unwrap());
    if deep.is_match(label) {
        2
    } else if mid.is_match(label) {
        1
    } else {
        0
    }
}

pub fn build_sub_list(items: &[DefinitionItem], restore: &dyn Fn(&str) -> String) -> String {
    let mut html = String::from("<ol class=\"dict-def-sublist\">");
    let mut i = 0;
    while i < items.len() {
        let item = &items[i];
        html.push_str("<li><span class=\"dict-def-label\">");
        html.push_str(&item.label);
        html.push_str("</span> ");
        html.push_str(&restore(&item.text));
        let mut deep = Vec::new();
        let mut j = i + 1;
        while j < items.len() && get_level(&items[j].label) > get_level(&item.label) {
            deep.push(items[j].clone());
            j += 1;
        }
        if !deep.is_empty() {
            html.push_str("<ol class=\"dict-def-sublist\">");
            for di in &deep {
                html.push_str("<li><span class=\"dict-def-label\">");
                html.push_str(&di.label);
                html.push_str("</span> ");
                html.push_str(&restore(&di.text));
                html.push_str("</li>");
            }
            html.push_str("</ol>");
        }
        html.push_str("</li>");
        i = if j > i + 1 { j } else { i + 1 };
    }
    html.push_str("</ol>");
    html
}

pub fn build_nested_list(items: &[DefinitionItem], restore: &dyn Fn(&str) -> String) -> String {
    let mut html = String::from("<ol class=\"dict-def-list\">");
    let mut i = 0;
    while i < items.len() {
        let item = &items[i];
        let level = get_level(&item.label);
        if level == 0 {
            html.push_str("<li><span class=\"dict-def-label\">");
            html.push_str(&item.label);
            html.push_str("</span> ");
            html.push_str(&restore(&item.text));
            let mut sub_items = Vec::new();
            let mut j = i + 1;
            while j < items.len() && get_level(&items[j].label) > 0 {
                sub_items.push(items[j].clone());
                j += 1;
            }
            if !sub_items.is_empty() {
                html.push_str(&build_sub_list(&sub_items, restore));
            }
            html.push_str("</li>");
            i = j;
        } else {
            html.push_str("<li><span class=\"dict-def-label\">");
            html.push_str(&item.label);
            html.push_str("</span> ");
            html.push_str(&restore(&item.text));
            html.push_str("</li>");
            i += 1;
        }
    }
    html.push_str("</ol>");
    html
}

pub fn format_definition(html: &str) -> String {
    static LEAD: OnceLock<Regex> = OnceLock::new();
    static ANCHOR: OnceLock<Regex> = OnceLock::new();
    static DEF_START: OnceLock<Regex> = OnceLock::new();
    let lead = LEAD.get_or_init(|| Regex::new(r"(?i)^\s*<b>[^<]*</b>\s*<p\s*/?>\s*").unwrap());
    let anchor = ANCHOR.get_or_init(|| Regex::new(r"(?i)<a\b[^>]*>.*?</a>").unwrap());
    let def_start = DEF_START.get_or_init(|| Regex::new(r"(?:^|\s)(1)\s+([a-z])").unwrap());

    let mut text = lead.replace(html, "").into_owned();
    let mut anchors = Vec::new();
    let mut rebuilt = String::new();
    let mut last = 0;
    for caps in anchor.captures_iter(&text) {
        let m = caps.get(0).unwrap();
        rebuilt.push_str(&text[last..m.start()]);
        rebuilt.push('\u{0}');
        rebuilt.push_str("LINK");
        rebuilt.push_str(&anchors.len().to_string());
        rebuilt.push('\u{0}');
        anchors.push(m.as_str().to_string());
        last = m.end();
    }
    rebuilt.push_str(&text[last..]);
    text = rebuilt;

    let restore = |value: &str| -> String {
        static PLACE: OnceLock<Regex> = OnceLock::new();
        let place = PLACE.get_or_init(|| Regex::new(r"\x00LINK(\d+)\x00").unwrap());
        place
            .replace_all(value, |caps: &regex::Captures| {
                caps.get(1)
                    .and_then(|m| m.as_str().parse::<usize>().ok())
                    .and_then(|idx| anchors.get(idx).cloned())
                    .unwrap_or_default()
            })
            .into_owned()
    };

    let Some(def_match) = def_start.captures(&text) else {
        return format!(
            "<div class=\"dict-def-preamble\">{}</div>",
            restore(text.trim())
        );
    };
    let start = def_match.get(0).unwrap().start();
    // JS exec index is the match index, which includes the leading whitespace alternative.
    let match_index = def_match.get(0).unwrap().start();
    let preamble = text[..match_index].trim();
    let def_text = text[start..].trim().to_string();
    // contentStart uses original defText before trim? JS: defText = text.substring(match.index).trim()
    // then item regex runs on trimmed defText. start in regex is relative to trimmed string.
    // But defStartMatch.index is used on untrimmed text for preamble. The trim of defText
    // removes leading whitespace that was part of the match if match started with space.
    // If match is `(?:^|\s)(1)\s+`, and text has leading space before 1, match.index points at space,
    // substring from there trimmed removes that space. The item regex then sees "1 first...".
    // I used start = match start then trim. Good. preamble uses match_index. Good.
    let _ = start;

    let raw_indices = find_definition_indices(&def_text);
    let mut indices = Vec::new();
    let mut last_top = 0i64;
    for idx in &raw_indices {
        // parseInt("1a", 10) in JavaScript is 1.
        let top_num = leading_int(&idx.label);
        let level = get_level(&idx.label);
        if level == 0 {
            if top_num <= last_top + 1 {
                indices.push(idx);
                last_top = top_num;
            }
        } else if top_num == last_top {
            indices.push(idx);
        }
    }
    let mut items = Vec::new();
    for i in 0..indices.len() {
        let end = if i + 1 < indices.len() {
            indices[i + 1].start
        } else {
            def_text.len()
        };
        items.push(DefinitionItem {
            label: indices[i].label.clone(),
            text: def_text[indices[i].content_start..end].trim().to_string(),
        });
    }
    let mut out = String::new();
    if !preamble.is_empty() {
        out.push_str("<div class=\"dict-def-preamble\">");
        out.push_str(&restore(preamble));
        out.push_str("</div>");
    }
    if !items.is_empty() {
        out.push_str(&build_nested_list(&items, &restore));
    }
    out
}

/// `(?:^|\s)(\d+[a-z]?\d?)\s+(?=[a-z\0])` without regex look-ahead.
fn find_definition_indices(def_text: &str) -> Vec<DefinitionIndex> {
    let chars: Vec<(usize, char)> = def_text.char_indices().collect();
    let mut indices = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        let at_boundary = i == 0 || chars[i - 1].1.is_whitespace();
        if !at_boundary || !chars[i].1.is_ascii_digit() {
            i += 1;
            continue;
        }
        let start = if i > 0 && chars[i - 1].1.is_whitespace() {
            chars[i - 1].0
        } else {
            chars[i].0
        };
        let mut j = i;
        while j < chars.len() && chars[j].1.is_ascii_digit() {
            j += 1;
        }
        if j < chars.len() && chars[j].1.is_ascii_lowercase() {
            j += 1;
            if j < chars.len() && chars[j].1.is_ascii_digit() {
                j += 1;
            }
        }
        let label: String = chars[i..j].iter().map(|(_, ch)| *ch).collect();
        let mut k = j;
        if k < chars.len() && chars[k].1.is_whitespace() {
            while k < chars.len() && chars[k].1.is_whitespace() {
                k += 1;
            }
            if k < chars.len() && (chars[k].1.is_ascii_lowercase() || chars[k].1 == '\u{0}') {
                let content_start = chars[k - 1].0;
                indices.push(DefinitionIndex {
                    label,
                    start,
                    content_start,
                });
                i = k;
                continue;
            }
        }
        i += 1;
    }
    indices
}

fn leading_int(label: &str) -> i64 {
    let digits: String = label.chars().take_while(|c| c.is_ascii_digit()).collect();
    digits.parse().unwrap_or(0)
}

#[cfg(test)]
mod dictionary_formatting_tests {
    use super::*;

    fn restore(value: &str) -> String {
        value.to_string()
    }

    #[test]
    fn formats_preamble_only_definitions() {
        assert_eq!(
            format_definition("<b>λόγος</b><p/>word speech"),
            "<div class=\"dict-def-preamble\">word speech</div>"
        );
    }

    #[test]
    fn formats_top_level_and_nested_numbered_definitions_while_preserving_anchors() {
        assert_eq!(
            format_definition(
                "from root <a href=\"S:G3056\">link</a> 1 first meaning 1a sub meaning 1a1 deep meaning 2 second meaning"
            ),
            "<div class=\"dict-def-preamble\">from root <a href=\"S:G3056\">link</a></div><ol class=\"dict-def-list\"><li><span class=\"dict-def-label\">1</span> first meaning<ol class=\"dict-def-sublist\"><li><span class=\"dict-def-label\">1a</span> sub meaning<ol class=\"dict-def-sublist\"><li><span class=\"dict-def-label\">1a1</span> deep meaning</li></ol></li></ol></li><li><span class=\"dict-def-label\">2</span> second meaning</li></ol>"
        );
    }

    #[test]
    fn formats_orphan_sub_items_as_list_items() {
        assert_eq!(
            build_nested_list(
                &[DefinitionItem {
                    label: "1a".into(),
                    text: "orphan".into()
                }],
                &restore
            ),
            "<ol class=\"dict-def-list\"><li><span class=\"dict-def-label\">1a</span> orphan</li></ol>"
        );
    }

    #[test]
    fn formats_sublists_and_levels_directly() {
        assert_eq!(
            build_sub_list(
                &[
                    DefinitionItem {
                        label: "1a".into(),
                        text: "sub".into()
                    },
                    DefinitionItem {
                        label: "1a1".into(),
                        text: "deep".into()
                    }
                ],
                &restore
            ),
            "<ol class=\"dict-def-sublist\"><li><span class=\"dict-def-label\">1a</span> sub<ol class=\"dict-def-sublist\"><li><span class=\"dict-def-label\">1a1</span> deep</li></ol></li></ol>"
        );
        assert_eq!(get_level("1"), 0);
        assert_eq!(get_level("1a"), 1);
        assert_eq!(get_level("1a1"), 2);
    }
}
