use crate::books::map_canonical_index_to_graphe;
use regex::Regex;
use std::sync::OnceLock;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedBibleRef {
    pub book_number: i64,
    pub chapter: i64,
    pub verse: Option<i64>,
}

#[derive(Debug, Clone, Copy, Default)]
pub struct ParseBibleHrefOptions {
    pub require_verse: bool,
}

fn strict_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?i)^B:(\d+)\s+(\d+):(\d+)").unwrap())
}

fn loose_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?i)^B:(\d+)\s+(\d+)(?::(\d+))?").unwrap())
}

fn hash_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?i)^#b(\d+)\.(\d+)\.(\d+)").unwrap())
}

/// Percent-decode like `decodeURIComponent`. Invalid sequences return the original string.
pub fn decode_uri_component(raw: &str) -> String {
    match try_decode(raw) {
        Ok(value) => value,
        Err(()) => raw.to_string(),
    }
}

fn try_decode(raw: &str) -> Result<String, ()> {
    let bytes = raw.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            if i + 2 >= bytes.len() {
                return Err(());
            }
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).map_err(|_| ())?;
            let value = u8::from_str_radix(hex, 16).map_err(|_| ())?;
            out.push(value);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).map_err(|_| ())
}

pub fn parse_bible_href(
    raw_href: Option<&str>,
    options: ParseBibleHrefOptions,
) -> Option<ParsedBibleRef> {
    let raw = raw_href?;
    if raw.is_empty() {
        return None;
    }
    let decoded = decode_uri_component(raw.trim());
    let decoded = decoded.trim();
    if decoded.is_empty() {
        return None;
    }
    if options.require_verse {
        if let Some(caps) = strict_re().captures(decoded) {
            return Some(ParsedBibleRef {
                book_number: caps[1].parse().ok()?,
                chapter: caps[2].parse().ok()?,
                verse: Some(caps[3].parse().ok()?),
            });
        }
    } else if let Some(caps) = loose_re().captures(decoded) {
        return Some(ParsedBibleRef {
            book_number: caps[1].parse().ok()?,
            chapter: caps[2].parse().ok()?,
            verse: caps.get(3).and_then(|m| m.as_str().parse().ok()),
        });
    }
    let caps = hash_re().captures(decoded)?;
    let mapped = map_canonical_index_to_graphe(caps[1].parse::<f64>().ok()?)?;
    Some(ParsedBibleRef {
        book_number: i64::from(mapped),
        chapter: caps[2].parse().ok()?,
        verse: Some(caps[3].parse().ok()?),
    })
}

#[cfg(test)]
mod bible_href_tests {
    use super::*;

    #[test]
    fn parses_b_refs_with_required_verse() {
        assert_eq!(
            parse_bible_href(
                Some("B:50 7:7"),
                ParseBibleHrefOptions {
                    require_verse: true
                }
            ),
            Some(ParsedBibleRef {
                book_number: 50,
                chapter: 7,
                verse: Some(7)
            })
        );
        assert_eq!(
            parse_bible_href(
                Some("B:50 7"),
                ParseBibleHrefOptions {
                    require_verse: true
                }
            ),
            None
        );
    }

    #[test]
    fn parses_b_refs_with_optional_verse() {
        assert_eq!(
            parse_bible_href(Some("B:50 7:7"), ParseBibleHrefOptions::default()),
            Some(ParsedBibleRef {
                book_number: 50,
                chapter: 7,
                verse: Some(7)
            })
        );
        assert_eq!(
            parse_bible_href(Some("B:50 7"), ParseBibleHrefOptions::default()),
            Some(ParsedBibleRef {
                book_number: 50,
                chapter: 7,
                verse: None
            })
        );
    }

    #[test]
    fn parses_mysword_hash_refs() {
        assert_eq!(
            parse_bible_href(Some("#b1.10.16"), ParseBibleHrefOptions::default()),
            Some(ParsedBibleRef {
                book_number: 10,
                chapter: 10,
                verse: Some(16)
            })
        );
        assert_eq!(
            parse_bible_href(Some("#b40.3.16"), ParseBibleHrefOptions::default()),
            Some(ParsedBibleRef {
                book_number: 470,
                chapter: 3,
                verse: Some(16)
            })
        );
    }

    #[test]
    fn returns_none_for_empty_or_invalid_input() {
        assert_eq!(
            parse_bible_href(None, ParseBibleHrefOptions::default()),
            None
        );
        assert_eq!(
            parse_bible_href(Some(""), ParseBibleHrefOptions::default()),
            None
        );
        assert_eq!(
            parse_bible_href(Some("not-a-ref"), ParseBibleHrefOptions::default()),
            None
        );
        assert_eq!(
            parse_bible_href(Some("#b99.1.1"), ParseBibleHrefOptions::default()),
            None
        );
    }
}
