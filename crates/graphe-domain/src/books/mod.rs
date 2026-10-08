//! Canonical 66-book numbers, chapter counts, and TheWord index.
//! One table, shared by the renderer logic and the module converters.

pub mod data;
pub mod ids;
pub mod map;

pub use data::{CHAPTER_COUNTS, GRAPHE_BOOK_NUMBERS, NT_BOOK_OFFSET, VERSES_PER_CHAPTER};
pub use ids::map_canonical_index_to_graphe;
pub use map::{
    build_verse_index, graphe_to_tw_book, tw_book_to_graphe, VerseIndexEntry, BOOK_NAMES,
};
