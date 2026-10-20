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
    // `#dTOPIC` is the dictionary scheme. The `d` is not the topic's first
    // letter: `#dDEMONOLOGIA` is DEMONOLOGIA. `#b…` is a Bible anchor.
    let lower = value.to_ascii_lowercase();
    if lower.starts_with("#b") {
        return String::new();
    } else if lower.starts_with("#d") {
        value = value[2..].to_string();
    } else if value.starts_with('#') {
        value = value[1..].to_string();
    }
    if let Some(idx) = value.find('#') {
        value = value[..idx].to_string();
    }
    if let Some(idx) = value.find('?') {
        value = value[..idx].to_string();
    }
    value = value.trim().to_string();
    // `d:Faith`, `d-Love`, and `d Faith` only. A bare leading D stays, so
    // DEMONOLOGIA is not looked up as EMONOLOGIA.
    static D: OnceLock<Regex> = OnceLock::new();
    let d = D.get_or_init(|| Regex::new(r"(?i)^d[:\-\s]+(.+)$").unwrap());
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

/// Names to try, in order, when a dictionary link is followed.
///
/// The first name is the normalized topic. A second name is added when the
/// topic ends in punctuation, as in `#dSEALTIEL,`.
pub fn topic_candidates(raw: &str) -> Vec<String> {
    let normalized = normalize_topic_candidate(Some(raw));
    if normalized.is_empty() {
        return Vec::new();
    }
    let trimmed = trim_topic_punctuation(&normalized);
    if trimmed.is_empty() || trimmed == normalized {
        vec![normalized]
    } else {
        vec![normalized, trimmed]
    }
}

fn trim_topic_punctuation(value: &str) -> String {
    value
        .trim_end_matches(|ch: char| {
            matches!(
                ch,
                ',' | '.' | ';' | ':' | '!' | '?' | ')' | ']' | '…' | '"' | '\''
            )
        })
        .to_string()
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

    #[test]
    fn topic_candidates_drop_a_trailing_comma() {
        assert_eq!(
            topic_candidates("#dSEALTIEL,"),
            vec!["SEALTIEL,".to_string(), "SEALTIEL".to_string()]
        );
        assert_eq!(topic_candidates("CORES"), vec!["CORES".to_string()]);
        assert!(topic_candidates("").is_empty());
    }

    #[test]
    fn a_leading_d_stays_part_of_the_topic() {
        assert_eq!(
            normalize_topic_candidate(Some("DEMONOLOGIA")),
            "DEMONOLOGIA"
        );
        assert_eq!(
            normalize_topic_candidate(Some("demonologia")),
            "demonologia"
        );
        assert_eq!(
            normalize_topic_candidate(Some("#dDEMONOLOGIA")),
            "DEMONOLOGIA"
        );
        assert_eq!(normalize_topic_candidate(Some("#dCORES")), "CORES");
        assert_eq!(
            topic_candidates("#dDEMONOLOGIA"),
            vec!["DEMONOLOGIA".to_string()]
        );
    }
}
