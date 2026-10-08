pub use super::data::{CHAPTER_COUNTS, GRAPHE_BOOK_NUMBERS};

/// Map canonical Protestant book index (1..=66) to a Graphe book number.
pub fn map_canonical_index_to_graphe(book_index: f64) -> Option<u16> {
    if book_index.fract() != 0.0 {
        return None;
    }
    let index = book_index as i64;
    if index < 1 || index > GRAPHE_BOOK_NUMBERS.len() as i64 {
        return None;
    }
    Some(GRAPHE_BOOK_NUMBERS[(index - 1) as usize])
}

pub fn chapter_count_for_index(book_index: usize) -> Option<u16> {
    CHAPTER_COUNTS.get(book_index).copied()
}

#[cfg(test)]
mod book_ids_tests {
    use super::*;
    use crate::books::map::GRAPHE_BOOK_NUMBERS as MAP_NUMBERS;

    #[test]
    fn maps_canonical_indices() {
        assert_eq!(map_canonical_index_to_graphe(1.0), Some(10));
        assert_eq!(map_canonical_index_to_graphe(40.0), Some(470));
        assert_eq!(map_canonical_index_to_graphe(66.0), Some(730));
        assert_eq!(map_canonical_index_to_graphe(0.0), None);
        assert_eq!(map_canonical_index_to_graphe(67.0), None);
        assert_eq!(map_canonical_index_to_graphe(1.5), None);
    }

    #[test]
    fn has_66_book_numbers_and_chapter_counts() {
        assert_eq!(GRAPHE_BOOK_NUMBERS.len(), 66);
        assert_eq!(CHAPTER_COUNTS.len(), 66);
    }

    #[test]
    fn stays_in_sync_with_book_map() {
        assert_eq!(GRAPHE_BOOK_NUMBERS, MAP_NUMBERS);
    }
}
