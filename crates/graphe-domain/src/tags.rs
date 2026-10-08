use regex::Regex;
use std::sync::OnceLock;

pub fn normalize_strong_number(value: Option<&str>) -> String {
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| Regex::new(r"\d+").unwrap());
    re.find(value.unwrap_or(""))
        .map(|m| m.as_str().to_string())
        .unwrap_or_default()
}

pub fn sanitize_strong_tags(text: Option<&str>) -> String {
    static PAIR: OnceLock<Regex> = OnceLock::new();
    static INNER: OnceLock<Regex> = OnceLock::new();
    static TAGS: OnceLock<Regex> = OnceLock::new();
    static OPEN: OnceLock<Regex> = OnceLock::new();
    static CLOSE: OnceLock<Regex> = OnceLock::new();
    let pair = PAIR.get_or_init(|| Regex::new(r"(?i)<S[^>]*>[\s\S]*?</S>").unwrap());
    let inner = INNER.get_or_init(|| Regex::new(r"(?i)^<S[^>]*>([\s\S]*?)</S>$").unwrap());
    let tags = TAGS.get_or_init(|| Regex::new(r"<[^>]+>").unwrap());
    let open = OPEN.get_or_init(|| Regex::new(r"(?i)<S[^>]*>").unwrap());
    let close = CLOSE.get_or_init(|| Regex::new(r"(?i)</S>").unwrap());

    let mut tokens = Vec::new();
    let mut index = 0usize;
    let replaced = pair.replace_all(text.unwrap_or(""), |caps: &regex::Captures| {
        let raw = caps.get(0).map(|m| m.as_str()).unwrap_or("");
        let raw_inner = inner
            .captures(raw)
            .and_then(|c| c.get(1))
            .map(|m| m.as_str())
            .unwrap_or("");
        let inner_text = tags.replace_all(raw_inner, "");
        let number = normalize_strong_number(Some(&inner_text));
        if number.is_empty() {
            return String::new();
        }
        let token = format!("__GRAPHE_S_TOKEN_{index}__");
        index += 1;
        tokens.push((token.clone(), format!("<S>{number}</S>")));
        token
    });
    let mut result = open.replace_all(&replaced, "").into_owned();
    result = close.replace_all(&result, "").into_owned();
    for (token, value) in tokens {
        result = result.replace(&token, &value);
    }
    result
}

pub fn sanitize_supported_tags(text: Option<&str>) -> String {
    static TAG: OnceLock<Regex> = OnceLock::new();
    static PB: OnceLock<Regex> = OnceLock::new();
    static UPPER: OnceLock<Regex> = OnceLock::new();
    static LOWER: OnceLock<Regex> = OnceLock::new();
    static CLOSE: OnceLock<Regex> = OnceLock::new();
    static OPEN: OnceLock<Regex> = OnceLock::new();
    let tag_re = TAG.get_or_init(|| Regex::new(r"<[^>]*>").unwrap());
    let pb = PB.get_or_init(|| Regex::new(r"(?i)^<pb\s*/?>$").unwrap());
    let upper = UPPER.get_or_init(|| Regex::new(r"^<(E|O|T|OG|OH|TG|TH|X)>$").unwrap());
    let lower = LOWER.get_or_init(|| Regex::new(r"^<(e|o|t|og|oh|tg|th|x)>$").unwrap());
    let close = CLOSE.get_or_init(|| Regex::new(r"(?i)^</\s*([a-z0-9]+)\s*>$").unwrap());
    let open = OPEN.get_or_init(|| Regex::new(r"(?i)^<\s*([a-z0-9]+)(?:\s+[^>]*)?\s*>$").unwrap());
    let allowed = ["i", "f", "j", "h", "m", "l"];
    tag_re
        .replace_all(text.unwrap_or(""), |caps: &regex::Captures| {
            let tag = caps.get(0).map(|m| m.as_str()).unwrap_or("");
            if pb.is_match(tag) {
                return "<pb/>".to_string();
            }
            if upper.is_match(tag) || lower.is_match(tag) {
                return tag.to_string();
            }
            if let Some(close_caps) = close.captures(tag) {
                let name = close_caps[1].to_lowercase();
                if name == "s" {
                    return "</S>".to_string();
                }
                if allowed.contains(&name.as_str()) {
                    let canon = if name == "j" { "J" } else { name.as_str() };
                    return format!("</{canon}>");
                }
                return String::new();
            }
            let Some(open_caps) = open.captures(tag) else {
                return String::new();
            };
            let name = open_caps[1].to_lowercase();
            if name == "s" {
                return "<S>".to_string();
            }
            if allowed.contains(&name.as_str()) {
                let canon = if name == "j" { "J" } else { name.as_str() };
                return format!("<{canon}>");
            }
            String::new()
        })
        .into_owned()
}

#[cfg(test)]
mod tag_sanitizer_tests {
    use super::*;

    #[test]
    fn normalizes_strong_numbers_and_removes_malformed_strong_tags() {
        assert_eq!(normalize_strong_number(Some("H0430")), "0430");
        assert_eq!(normalize_strong_number(Some("3056")), "3056");
        assert_eq!(normalize_strong_number(None), "");
        assert_eq!(
            sanitize_strong_tags(Some(
                "a<S>H0430</S>b<S><i>G3056</i></S>c<S>abc</S>d<S>orphan"
            )),
            "a<S>0430</S>b<S>3056</S>cdorphan"
        );
    }

    #[test]
    fn keeps_supported_tags_in_canonical_form_and_strips_unsupported_tags() {
        let input = "<pb><pb/><E><e><O><o><T><t><OG><og><OH><oh><TG><tg><TH><th><X><x><s></s><j>Jesus</j><i>x</i><f>n</f><h>h</h><m>m</m><l>l</l><span data-x=\"1\">bad</span><bad/>";
        assert_eq!(
            sanitize_supported_tags(Some(input)),
            "<pb/><pb/><E><e><O><o><T><t><OG><og><OH><oh><TG><tg><TH><th><X><x><S></S><J>Jesus</J><i>x</i><f>n</f><h>h</h><m>m</m><l>l</l>bad"
        );
    }
}
