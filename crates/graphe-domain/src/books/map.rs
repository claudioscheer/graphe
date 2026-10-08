use std::collections::HashMap;

pub use super::data::{
    BOOK_NAMES_EN as BOOK_NAMES, GRAPHE_BOOK_NUMBERS, NT_BOOK_OFFSET, VERSES_PER_CHAPTER,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct VerseIndexEntry {
    pub start_line: usize,
    pub verse_count: u16,
}

pub fn tw_book_to_graphe(bi: i64) -> Option<u16> {
    if bi < 1 {
        return None;
    }
    GRAPHE_BOOK_NUMBERS.get((bi - 1) as usize).copied()
}

pub fn graphe_to_tw_book(book_number: i64) -> i64 {
    GRAPHE_BOOK_NUMBERS
        .iter()
        .position(|n| i64::from(*n) == book_number)
        .map(|idx| idx as i64 + 1)
        .unwrap_or(-1)
}

pub fn build_verse_index(is_nt_only: bool) -> HashMap<u16, HashMap<u16, VerseIndexEntry>> {
    let mut index = HashMap::new();
    let mut line = 0usize;
    let start_book = if is_nt_only { NT_BOOK_OFFSET } else { 0 };
    for i in start_book..66 {
        let book_number = GRAPHE_BOOK_NUMBERS[i];
        let chapters = VERSES_PER_CHAPTER[i];
        let mut chapter_map = HashMap::new();
        for (ch, count) in chapters.iter().enumerate() {
            chapter_map.insert(
                (ch + 1) as u16,
                VerseIndexEntry {
                    start_line: line,
                    verse_count: *count,
                },
            );
            line += *count as usize;
        }
        index.insert(book_number, chapter_map);
    }
    index
}

#[cfg(test)]
mod book_map_tests {
    use super::*;

    #[test]
    fn maps_theword_and_graphe_book_numbers_in_both_directions() {
        assert_eq!(GRAPHE_BOOK_NUMBERS.len(), 66);
        assert_eq!(VERSES_PER_CHAPTER.len(), 66);
        assert_eq!(BOOK_NAMES[0].short, "Gen");
        assert_eq!(BOOK_NAMES[0].long, "Genesis");
        assert_eq!(NT_BOOK_OFFSET, 39);
        assert_eq!(tw_book_to_graphe(1), Some(10));
        assert_eq!(tw_book_to_graphe(66), Some(730));
        assert_eq!(tw_book_to_graphe(67), None);
        assert_eq!(graphe_to_tw_book(10), 1);
        assert_eq!(graphe_to_tw_book(730), 66);
        assert_eq!(graphe_to_tw_book(999), -1);
    }

    #[test]
    fn builds_full_and_new_testament_only_verse_indexes() {
        let full = build_verse_index(false);
        let nt_only = build_verse_index(true);
        assert_eq!(
            full.get(&10).and_then(|m| m.get(&1)).copied(),
            Some(VerseIndexEntry {
                start_line: 0,
                verse_count: 31
            })
        );
        assert_eq!(
            full.get(&470).and_then(|m| m.get(&1)).copied(),
            Some(VerseIndexEntry {
                start_line: 23145,
                verse_count: 25
            })
        );
        assert!(!nt_only.contains_key(&10));
        assert_eq!(
            nt_only.get(&470).and_then(|m| m.get(&1)).copied(),
            Some(VerseIndexEntry {
                start_line: 0,
                verse_count: 25
            })
        );
        assert_eq!(
            nt_only.get(&730).and_then(|m| m.get(&22)).copied(),
            Some(VerseIndexEntry {
                start_line: 7936,
                verse_count: 21
            })
        );
    }
}
