use crate::i18n::{self, book_name};
use crate::model::BookRecord;
use regex::Regex;
use std::sync::OnceLock;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NavScreen {
    Books {
        ot: Vec<i64>,
        nt: Vec<i64>,
    },
    Chapters {
        book_number: i64,
        title: String,
        count: i64,
    },
    Verses {
        book_number: i64,
        chapter: i64,
        title: String,
        verses: Vec<i64>,
    },
    Closed,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NavAction {
    pub pane_id: String,
    pub book_number: i64,
    pub chapter: i64,
    pub verse: Option<i64>,
}

pub struct NavigationSession<C, V, P> {
    pub active_pane_id: Option<String>,
    pub books: Vec<BookRecord>,
    pub selected_book: Option<i64>,
    pub selected_chapter: Option<i64>,
    pub open: bool,
    pub input: String,
    pub screen: NavScreen,
    pub back_visible: bool,
    pub navigations: Vec<NavAction>,
    chapter_count: C,
    chapter_verses: V,
    pane_module: P,
}

impl<C, V, P> NavigationSession<C, V, P>
where
    C: FnMut(&str, i64) -> i64,
    V: FnMut(&str, i64, i64) -> Vec<i64>,
    P: FnMut(&str) -> Option<String>,
{
    pub fn new(chapter_count: C, chapter_verses: V, pane_module: P) -> Self {
        Self {
            active_pane_id: None,
            books: Vec::new(),
            selected_book: None,
            selected_chapter: None,
            open: false,
            input: String::new(),
            screen: NavScreen::Closed,
            back_visible: false,
            navigations: Vec::new(),
            chapter_count,
            chapter_verses,
            pane_module,
        }
    }

    pub fn open_for(&mut self, pane_id: &str, books: Vec<BookRecord>) {
        self.active_pane_id = Some(pane_id.to_string());
        self.books = books;
        self.selected_book = None;
        self.selected_chapter = None;
        self.open = true;
        self.input.clear();
        self.show_books();
    }

    pub fn close(&mut self) {
        self.open = false;
        self.active_pane_id = None;
        self.selected_book = None;
        self.selected_chapter = None;
        self.screen = NavScreen::Closed;
        self.back_visible = false;
    }

    pub fn show_books(&mut self) {
        self.selected_book = None;
        self.selected_chapter = None;
        self.back_visible = false;
        let ot = self
            .books
            .iter()
            .filter(|book| book.book_number < 470)
            .map(|book| book.book_number)
            .collect();
        let nt = self
            .books
            .iter()
            .filter(|book| book.book_number >= 470)
            .map(|book| book.book_number)
            .collect();
        self.screen = NavScreen::Books { ot, nt };
    }

    pub fn book_button_label(&self, book_number: i64) -> String {
        book_name(book_number).short
    }

    pub fn select_book(&mut self, book_number: i64) {
        self.selected_book = Some(book_number);
        self.selected_chapter = None;
        self.back_visible = true;
        let Some(pane_id) = self.active_pane_id.clone() else {
            return;
        };
        let Some(module_id) = (self.pane_module)(&pane_id) else {
            return;
        };
        let count = (self.chapter_count)(&module_id, book_number);
        if self.selected_book != Some(book_number) || self.selected_chapter.is_some() {
            return;
        }
        self.screen = NavScreen::Chapters {
            book_number,
            title: book_name(book_number).long,
            count,
        };
    }

    pub fn select_chapter(&mut self, book_number: i64, chapter: i64) {
        self.selected_book = Some(book_number);
        self.selected_chapter = Some(chapter);
        self.back_visible = true;
        let Some(pane_id) = self.active_pane_id.clone() else {
            return;
        };
        let Some(module_id) = (self.pane_module)(&pane_id) else {
            return;
        };
        let mut verses = (self.chapter_verses)(&module_id, book_number, chapter);
        verses.retain(|verse| *verse > 0 || *verse == 0);
        let mut unique = Vec::new();
        for verse in verses {
            if verse < 0 {
                continue;
            }
            if !unique.contains(&verse) {
                unique.push(verse);
            }
        }
        // NaN verses are not representable as i64; callers filter them before passing.
        if self.selected_book != Some(book_number) || self.selected_chapter != Some(chapter) {
            return;
        }
        if unique.is_empty() {
            self.navigations.push(NavAction {
                pane_id,
                book_number,
                chapter,
                verse: None,
            });
            self.close();
            return;
        }
        self.screen = NavScreen::Verses {
            book_number,
            chapter,
            title: format!("{} {chapter}", book_name(book_number).long),
            verses: unique,
        };
    }

    pub fn select_verse(&mut self, verse: i64) {
        let (Some(pane_id), Some(book), Some(chapter)) = (
            self.active_pane_id.clone(),
            self.selected_book,
            self.selected_chapter,
        ) else {
            return;
        };
        self.navigations.push(NavAction {
            pane_id,
            book_number: book,
            chapter,
            verse: Some(verse),
        });
        self.close();
    }

    pub fn back(&mut self) {
        if self.selected_book.is_some() && self.selected_chapter.is_some() {
            if let Some(book) = self.selected_book {
                self.select_book(book);
            }
            return;
        }
        self.show_books();
    }

    pub fn submit_input(&mut self) {
        let raw = self.input.trim().to_string();
        if raw.is_empty() {
            return;
        }
        let Some(pane_id) = self.active_pane_id.clone() else {
            return;
        };
        if (self.pane_module)(&pane_id).is_none() {
            return;
        }
        static RE: OnceLock<Regex> = OnceLock::new();
        let re = RE
            .get_or_init(|| Regex::new(r"(?i)^(\d?\s*[A-Za-zÀ-ÿ]+)\s*(\d+)(?::(\d+))?$").unwrap());
        let Some(caps) = re.captures(&raw) else {
            return;
        };
        let abbrev = caps[1].trim().to_lowercase();
        let chapter: i64 = caps[2].parse().unwrap_or(0);
        let verse = caps.get(3).and_then(|m| m.as_str().parse().ok());
        let Some(book_number) = i18n::find_book_by_abbrev(&abbrev) else {
            return;
        };
        if !self
            .books
            .iter()
            .any(|book| book.book_number == book_number)
        {
            return;
        }
        self.navigations.push(NavAction {
            pane_id,
            book_number,
            chapter,
            verse,
        });
        self.close();
    }

    pub fn escape(&mut self) {
        if self.open {
            self.close();
        }
    }

    pub fn book_labels(&self) -> Vec<String> {
        let NavScreen::Books { ot, nt } = &self.screen else {
            return Vec::new();
        };
        ot.iter()
            .chain(nt.iter())
            .map(|n| self.book_button_label(*n))
            .collect()
    }

    pub fn chapter_count_shown(&self) -> usize {
        match &self.screen {
            NavScreen::Chapters { count, .. } => *count as usize,
            _ => 0,
        }
    }

    pub fn verse_numbers(&self) -> Vec<i64> {
        match &self.screen {
            NavScreen::Verses { verses, .. } => verses.clone(),
            _ => Vec::new(),
        }
    }
}

#[cfg(test)]
mod navigation_tests {
    use super::*;
    use crate::i18n::{self, Lang};

    fn books() -> Vec<BookRecord> {
        vec![
            BookRecord {
                book_number: 10,
                short_name: Some("Gen".into()),
                long_name: Some("Genesis".into()),
            },
            BookRecord {
                book_number: 470,
                short_name: Some("Mat".into()),
                long_name: Some("Matthew".into()),
            },
        ]
    }

    #[test]
    fn navigates_through_book_chapter_verse_quick_input_back_and_close() {
        i18n::reset_lang();
        i18n::set_lang("en");
        assert_eq!(i18n::get_current_lang(), Lang::En);
        let counts = std::cell::RefCell::new(Vec::new());
        let chapters = std::cell::RefCell::new(Vec::new());
        let mut nav = NavigationSession::new(
            |module, book| {
                counts.borrow_mut().push((module.to_string(), book));
                2
            },
            |module, book, chapter| {
                chapters
                    .borrow_mut()
                    .push((module.to_string(), book, chapter));
                vec![1, 2, 2]
            },
            |_| Some("kjv".into()),
        );
        nav.open_for("pane-1", books());
        assert!(nav.open);
        assert_eq!(
            nav.book_labels(),
            vec!["Gen".to_string(), "Mat".to_string()]
        );
        nav.select_book(10);
        assert_eq!(*counts.borrow(), vec![("kjv".into(), 10)]);
        assert_eq!(nav.chapter_count_shown(), 2);
        nav.back();
        assert_eq!(nav.book_labels().len(), 2);
        nav.select_book(10);
        nav.select_chapter(10, 1);
        assert_eq!(chapters.borrow()[0], ("kjv".into(), 10, 1));
        assert_eq!(nav.verse_numbers(), vec![1, 2]);
        nav.back();
        assert_eq!(nav.chapter_count_shown(), 2);
        nav.select_chapter(10, 1);
        nav.select_verse(2);
        assert_eq!(
            nav.navigations.last(),
            Some(&NavAction {
                pane_id: "pane-1".into(),
                book_number: 10,
                chapter: 1,
                verse: Some(2),
            })
        );
        assert!(!nav.open);

        nav.open_for("pane-1", books());
        nav.input = "Gen 2:1".into();
        nav.submit_input();
        assert_eq!(
            nav.navigations.last(),
            Some(&NavAction {
                pane_id: "pane-1".into(),
                book_number: 10,
                chapter: 2,
                verse: Some(1),
            })
        );
        let calls = nav.navigations.len();
        nav.open_for("pane-1", books());
        nav.input = "not a ref".into();
        nav.submit_input();
        assert_eq!(nav.navigations.len(), calls);
        nav.open_for("pane-1", books());
        nav.escape();
        assert!(!nav.open);
        nav.open_for("pane-1", books());
        nav.close();
        assert!(!nav.open);
        nav.open_for("pane-1", books());
        nav.close();
        assert!(!nav.open);
        i18n::reset_lang();
    }

    #[test]
    fn navigates_directly_to_a_chapter_when_no_verse_numbers_are_available() {
        i18n::set_lang("en");
        let mut nav =
            NavigationSession::new(|_, _| 2, |_, _, _| Vec::new(), |_| Some("kjv".into()));
        nav.open_for(
            "pane-2",
            vec![BookRecord {
                book_number: 10,
                short_name: Some("Gen".into()),
                long_name: Some("Genesis".into()),
            }],
        );
        nav.select_book(10);
        nav.select_chapter(10, 1);
        assert_eq!(
            nav.navigations,
            vec![NavAction {
                pane_id: "pane-2".into(),
                book_number: 10,
                chapter: 1,
                verse: None,
            }]
        );
        assert!(!nav.open);
        i18n::reset_lang();
    }

    #[test]
    fn returns_early_when_no_pane_is_active_or_quick_input_is_empty() {
        i18n::set_lang("en");
        let counts = std::cell::Cell::new(0);
        let mut nav = NavigationSession::new(
            |_, _| {
                counts.set(counts.get() + 1);
                2
            },
            |_, _, _| vec![1],
            |_| None,
        );
        nav.open_for(
            "pane-3",
            vec![BookRecord {
                book_number: 10,
                short_name: Some("Gen".into()),
                long_name: Some("Genesis".into()),
            }],
        );
        nav.select_book(10);
        assert_eq!(counts.get(), 0);
        nav.input.clear();
        nav.submit_input();
        nav.input = "Gen 1".into();
        nav.submit_input();
        assert!(nav.navigations.is_empty());
        i18n::reset_lang();
    }
}
