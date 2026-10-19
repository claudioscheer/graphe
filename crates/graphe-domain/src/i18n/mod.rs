pub mod catalog;

use self::catalog::{book_names, ui_string, BookNamePair};
use crate::books::GRAPHE_BOOK_NUMBERS;
use std::cell::RefCell;
use unicode_normalization::UnicodeNormalization;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Lang {
    Pt,
    En,
    Es,
}

impl Lang {
    pub fn as_str(self) -> &'static str {
        match self {
            Lang::Pt => "pt",
            Lang::En => "en",
            Lang::Es => "es",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "pt" => Some(Lang::Pt),
            "en" => Some(Lang::En),
            "es" => Some(Lang::Es),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocalizedBookName {
    pub short: String,
    pub long: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum I18nNodeKind {
    Text,
    Input,
    TextArea,
    Other,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct I18nNode {
    pub kind: I18nNodeKind,
    pub text_key: Option<String>,
    pub placeholder_key: Option<String>,
    pub title_key: Option<String>,
    pub text: String,
    pub placeholder: String,
    pub title: String,
}

thread_local! {
    static CURRENT: RefCell<Lang> = const { RefCell::new(Lang::Pt) };
    static STORAGE: RefCell<Option<String>> = const { RefCell::new(None) };
}

pub fn reset_lang() {
    STORAGE.with(|s| *s.borrow_mut() = None);
    CURRENT.with(|c| *c.borrow_mut() = Lang::Pt);
}

pub fn get_current_lang() -> Lang {
    STORAGE.with(
        |storage| match storage.borrow().as_deref().and_then(Lang::parse) {
            Some(lang) => lang,
            None => Lang::Pt,
        },
    )
}

pub fn set_lang(lang: &str) {
    let next = Lang::parse(lang).unwrap_or(Lang::Pt);
    STORAGE.with(|storage| *storage.borrow_mut() = Some(next.as_str().to_string()));
    CURRENT.with(|c| *c.borrow_mut() = next);
}

pub fn stored_lang() -> Option<String> {
    STORAGE.with(|storage| storage.borrow().clone())
}

pub fn t(key: &str) -> String {
    let lang = get_current_lang().as_str();
    if let Some(value) = ui_string(lang, key) {
        return value.to_string();
    }
    if let Some(value) = ui_string("en", key) {
        return value.to_string();
    }
    key.to_string()
}

pub fn t_fmt(key: &str, pairs: &[(&str, &str)]) -> String {
    let mut value = t(key);
    for (name, replacement) in pairs {
        value = value.replace(&format!("{{{name}}}"), replacement);
    }
    value
}

pub fn update_all(nodes: &mut [I18nNode]) {
    for node in nodes.iter_mut() {
        if let Some(key) = &node.text_key {
            node.text = t(key);
        }
        if let Some(key) = &node.placeholder_key {
            if matches!(node.kind, I18nNodeKind::Input | I18nNodeKind::TextArea) {
                node.placeholder = t(key);
            }
        }
        if let Some(key) = &node.title_key {
            node.title = t(key);
        }
    }
}

pub fn book_name(book_number: i64) -> LocalizedBookName {
    let idx = GRAPHE_BOOK_NUMBERS
        .iter()
        .position(|n| i64::from(*n) == book_number);
    let Some(idx) = idx else {
        let text = book_number.to_string();
        return LocalizedBookName {
            short: text.clone(),
            long: text,
        };
    };
    let names = book_names(get_current_lang().as_str());
    let pair: &BookNamePair = &names[idx];
    LocalizedBookName {
        short: pair.short.to_string(),
        long: pair.long.to_string(),
    }
}

pub fn book_names_for_current() -> &'static [BookNamePair; 66] {
    book_names(get_current_lang().as_str())
}

fn strip_diacritics(value: &str) -> String {
    value
        .nfd()
        .filter(|ch| !('\u{0300}'..='\u{036f}').contains(ch))
        .collect()
}

pub fn find_book_by_abbrev(abbrev: &str) -> Option<i64> {
    let names = book_names(get_current_lang().as_str());
    let lower = abbrev.to_lowercase();
    let folded = strip_diacritics(&lower);
    for (i, name) in names.iter().enumerate() {
        if name.short.to_lowercase() == lower {
            return Some(i64::from(GRAPHE_BOOK_NUMBERS[i]));
        }
    }
    let folded_hits: Vec<usize> = names
        .iter()
        .enumerate()
        .filter_map(|(i, name)| {
            if strip_diacritics(&name.short.to_lowercase()) == folded {
                Some(i)
            } else {
                None
            }
        })
        .collect();
    if folded_hits.len() == 1 {
        return Some(i64::from(GRAPHE_BOOK_NUMBERS[folded_hits[0]]));
    }
    if folded_hits.len() > 1 {
        let plain = folded_hits
            .iter()
            .copied()
            .find(|i| names[*i].short.to_lowercase() == folded);
        let idx = plain.unwrap_or(folded_hits[0]);
        return Some(i64::from(GRAPHE_BOOK_NUMBERS[idx]));
    }
    for (i, name) in names.iter().enumerate() {
        if name.short.to_lowercase().starts_with(&lower) {
            return Some(i64::from(GRAPHE_BOOK_NUMBERS[i]));
        }
    }
    for (i, name) in names.iter().enumerate() {
        if name.long.to_lowercase() == lower
            || strip_diacritics(&name.long.to_lowercase()) == folded
        {
            return Some(i64::from(GRAPHE_BOOK_NUMBERS[i]));
        }
    }
    for lang in ["pt", "en", "es"] {
        if lang == get_current_lang().as_str() {
            continue;
        }
        let fallback_names = book_names(lang);
        for (i, name) in fallback_names.iter().enumerate() {
            if name.short.to_lowercase() == lower
                || strip_diacritics(&name.short.to_lowercase()) == folded
                || name.long.to_lowercase() == lower
                || strip_diacritics(&name.long.to_lowercase()) == folded
            {
                return Some(i64::from(GRAPHE_BOOK_NUMBERS[i]));
            }
        }
    }
    None
}

#[cfg(test)]
mod i18n_tests {
    use super::*;

    fn fold(value: &str) -> String {
        strip_diacritics(&value.to_lowercase())
    }

    #[test]
    fn selects_supported_languages_and_localizes_book_names() {
        reset_lang();
        assert_eq!(get_current_lang(), Lang::Pt);
        assert_eq!(t("settings"), "Configurações");
        assert_eq!(t("missingKey"), "missingKey");
        assert_eq!(
            book_name(10),
            LocalizedBookName {
                short: "Gn".into(),
                long: "Gênesis".into()
            }
        );
        assert_eq!(
            book_name(999),
            LocalizedBookName {
                short: "999".into(),
                long: "999".into()
            }
        );
        assert_eq!(book_name(find_book_by_abbrev("jo").unwrap()).long, "João");
        assert_eq!(find_book_by_abbrev("j"), Some(60));
        assert_eq!(find_book_by_abbrev("zzz"), None);

        set_lang("en");
        assert_eq!(stored_lang().as_deref(), Some("en"));
        assert_eq!(t("settings"), "Settings");
        assert_eq!(
            book_name(10),
            LocalizedBookName {
                short: "Gen".into(),
                long: "Genesis".into()
            }
        );
        assert_eq!(find_book_by_abbrev("Gen"), Some(10));

        set_lang("invalid");
        assert_eq!(get_current_lang(), Lang::Pt);
        reset_lang();
    }

    #[test]
    fn resolves_accented_abbreviations_without_collapsing_jo() {
        reset_lang();
        assert_eq!(book_name(find_book_by_abbrev("JO").unwrap()).long, "João");
        assert_eq!(book_name(find_book_by_abbrev("jó").unwrap()).long, "Jó");
        assert_eq!(book_name(find_book_by_abbrev("Jó").unwrap()).long, "Jó");
        assert_eq!(
            book_name(find_book_by_abbrev("1Jo").unwrap()).long,
            "1 João"
        );
        assert_eq!(
            book_name(find_book_by_abbrev("2jo").unwrap()).long,
            "2 João"
        );
        assert_eq!(
            book_name(find_book_by_abbrev("3JO").unwrap()).long,
            "3 João"
        );

        for name in book_names("pt") {
            if fold(name.short) == name.short.to_lowercase() {
                continue;
            }
            assert_eq!(
                book_name(find_book_by_abbrev(name.short).unwrap()).long,
                name.long
            );
            let plain_owner = book_names("pt")
                .iter()
                .find(|other| other.short.to_lowercase() == fold(name.short));
            let expected = plain_owner.map(|n| n.long).unwrap_or(name.long);
            assert_eq!(
                book_name(find_book_by_abbrev(&fold(name.short)).unwrap()).long,
                expected
            );
        }

        set_lang("es");
        for name in book_names("es") {
            if fold(name.short) == name.short.to_lowercase() {
                continue;
            }
            assert_eq!(
                book_name(find_book_by_abbrev(name.short).unwrap()).long,
                name.long
            );
            assert_eq!(
                book_name(find_book_by_abbrev(&fold(name.short)).unwrap()).long,
                name.long
            );
        }
        assert_eq!(book_name(find_book_by_abbrev("job").unwrap()).long, "Job");
        assert_eq!(book_name(find_book_by_abbrev("jn").unwrap()).long, "Juan");
        reset_lang();
    }

    #[test]
    fn updates_text_placeholder_and_title_attributes() {
        reset_lang();
        let mut nodes = vec![
            I18nNode {
                kind: I18nNodeKind::Text,
                text_key: Some("search".into()),
                placeholder_key: None,
                title_key: None,
                text: String::new(),
                placeholder: String::new(),
                title: String::new(),
            },
            I18nNode {
                kind: I18nNodeKind::Input,
                text_key: None,
                placeholder_key: Some("searchPlaceholder".into()),
                title_key: None,
                text: String::new(),
                placeholder: String::new(),
                title: String::new(),
            },
            I18nNode {
                kind: I18nNodeKind::Other,
                text_key: None,
                placeholder_key: None,
                title_key: Some("settings".into()),
                text: String::new(),
                placeholder: String::new(),
                title: String::new(),
            },
            I18nNode {
                kind: I18nNodeKind::TextArea,
                text_key: None,
                placeholder_key: Some("dictSearchPlaceholder".into()),
                title_key: None,
                text: String::new(),
                placeholder: String::new(),
                title: String::new(),
            },
            I18nNode {
                kind: I18nNodeKind::Other,
                text_key: None,
                placeholder_key: None,
                title_key: Some("close".into()),
                text: String::new(),
                placeholder: String::new(),
                title: String::new(),
            },
        ];
        set_lang("en");
        update_all(&mut nodes);
        assert_eq!(nodes[0].text, "Search");
        assert_eq!(nodes[1].placeholder, "Search by word...");
        assert_eq!(nodes[3].placeholder, "Search topic...");
        assert_eq!(nodes[2].title, "Settings");
        assert_eq!(nodes[4].title, "Close");
        reset_lang();
    }
}
