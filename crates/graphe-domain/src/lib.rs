//! Bible-study rules with no filesystem, SQLite, or UI toolkit.
//!
//! The egui app and the module store both call this crate. Book numbers live
//! in [`books`] and are not duplicated.

pub mod app_state;
pub mod bible_ref;
pub mod bidi;
pub mod books;
pub mod commentary_html;
pub mod commentary_ref;
pub mod coverage;
pub mod dict;
pub mod i18n;
pub mod markup;
pub mod model;
pub mod morphology;
pub mod navigation;
pub mod panes;
pub mod picker;
pub mod search;
pub mod shortcuts;
pub mod tags;
pub mod theme;
pub mod workbench;
pub mod workspace;

pub use books::{map_canonical_index_to_graphe, GRAPHE_BOOK_NUMBERS};
pub use model::{ModuleRecord, PaneNode, PaneRecord, PaneType};
pub use theme::{palette, DARK, LIGHT};
pub use workbench::SIDEBAR_VIEWS;
