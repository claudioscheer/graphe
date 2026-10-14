use crate::bible_ref::decode_uri_component;
use regex::Regex;
use std::sync::OnceLock;

pub fn is_external_href(href: Option<&str>) -> bool {
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| Regex::new(r"(?i)^(https?:|mailto:|tel:)").unwrap());
    re.is_match(href.unwrap_or("").trim())
}

pub fn normalize_topic_candidate(raw: Option<&str>) -> String {
    let Some(raw) = raw else {
        return String::new();
    };
    let mut value = decode_uri_component(raw.trim());
    value = value.trim().to_string();
    if value.is_empty() {
        return String::new();
    }
    if value.starts_with('#')
        && !value[1..].to_ascii_lowercase().starts_with('b')
        && !value.to_ascii_lowercase().starts_with("#b")
    {
        value = value[1..].to_string();
    }
    if let Some(idx) = value.find('#') {
        value = value[..idx].to_string();
    }
    if let Some(idx) = value.find('?') {
        value = value[..idx].to_string();
    }
    static D: OnceLock<Regex> = OnceLock::new();
    let d = D.get_or_init(|| Regex::new(r"(?i)^d(?:[:\-\s]+)?(.+)$").unwrap());
    if let Some(caps) = d.captures(&value) {
        if let Some(rest) = caps.get(1) {
            let trimmed = rest.as_str().trim();
            if !trimmed.is_empty() {
                value = trimmed.to_string();
            }
        }
    }
    value
}

#[cfg(test)]
mod dict_topic_tests {
    use super::*;

    #[test]
    fn recognizes_external_links() {
        assert!(is_external_href(Some("https://example.test")));
        assert!(is_external_href(Some("mailto:test@example.test")));
        assert!(is_external_href(Some("tel:555")));
        assert!(!is_external_href(Some("B:1 1:1")));
        assert!(!is_external_href(None));
    }

    #[test]
    fn normalizes_topic_candidates_without_changing_bible_anchors() {
        assert_eq!(normalize_topic_candidate(None), "");
        assert_eq!(normalize_topic_candidate(Some("")), "");
        assert_eq!(normalize_topic_candidate(Some("#Grace?x=1")), "Grace");
        assert_eq!(normalize_topic_candidate(Some("#b1")), "");
        assert_eq!(normalize_topic_candidate(Some("d:Faith")), "Faith");
        assert_eq!(normalize_topic_candidate(Some("d-Love")), "Love");
        assert_eq!(
            normalize_topic_candidate(Some("%E1%BC%80%CE%B3%CE%AC%CF%80%CE%B7")),
            "ἀγάπη"
        );
        assert_eq!(normalize_topic_candidate(Some("%E0%A4%A")), "%E0%A4%A");
    }
}
