//! Previous and next chapter, including the step across a book boundary.

use crate::books::{CHAPTER_COUNTS, GRAPHE_BOOK_NUMBERS};

/// A book the pane can step through, in reading order, with its chapter count.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ChapterSpan {
    pub book_number: i64,
    pub chapters: i64,
}

/// Canon order and chapter counts. A module with its own book list replaces this.
pub fn canon_chapter_spans() -> Vec<ChapterSpan> {
    GRAPHE_BOOK_NUMBERS
        .iter()
        .zip(CHAPTER_COUNTS)
        .map(|(number, chapters)| ChapterSpan {
            book_number: i64::from(*number),
            chapters: i64::from(chapters).max(1),
        })
        .collect()
}

/// The chapter reached by moving `delta` chapters (`-1` or `1`).
///
/// The first chapter of a book steps into the previous book's last chapter.
/// The last chapter steps into the next book's first chapter. Genesis 1 and the
/// end of Revelation stay put.
pub fn adjacent_chapter(
    books: &[ChapterSpan],
    book: i64,
    chapter: i64,
    delta: i64,
) -> Option<(i64, i64)> {
    if delta == 0 {
        return None;
    }
    let index = books.iter().position(|item| item.book_number == book)?;
    let chapters = books[index].chapters.max(1);
    if delta < 0 {
        if chapter > 1 {
            return Some((book, chapter - 1));
        }
        let prev = books.get(index.checked_sub(1)?)?;
        return Some((prev.book_number, prev.chapters.max(1)));
    }
    if chapter < chapters {
        return Some((book, chapter + 1));
    }
    let next = books.get(index + 1)?;
    Some((next.book_number, 1))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ephesians_four_shows_the_neighboring_chapters() {
        let books = canon_chapter_spans();
        assert_eq!(adjacent_chapter(&books, 560, 4, -1), Some((560, 3)));
        assert_eq!(adjacent_chapter(&books, 560, 4, 1), Some((560, 5)));
    }

    #[test]
    fn the_first_chapter_steps_back_into_the_previous_book() {
        let books = canon_chapter_spans();
        let (book, chapter) = adjacent_chapter(&books, 560, 1, -1).unwrap();
        assert_eq!(book, 550);
        assert!(chapter > 1);
    }

    #[test]
    fn the_last_chapter_steps_forward_into_the_next_book() {
        let books = canon_chapter_spans();
        let ephesians = books.iter().find(|item| item.book_number == 560).unwrap();
        assert_eq!(
            adjacent_chapter(&books, 560, ephesians.chapters, 1),
            Some((570, 1))
        );
    }

    #[test]
    fn the_ends_of_the_canon_do_not_step_past_the_list() {
        let books = canon_chapter_spans();
        assert_eq!(adjacent_chapter(&books, 10, 1, -1), None);
        let last = books.last().unwrap();
        assert_eq!(
            adjacent_chapter(&books, last.book_number, last.chapters, 1),
            None
        );
        assert_eq!(adjacent_chapter(&books, 999, 1, 1), None);
        assert_eq!(adjacent_chapter(&books, 560, 4, 0), None);
    }
}
