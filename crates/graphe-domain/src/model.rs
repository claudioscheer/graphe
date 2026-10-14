use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ModuleRecord {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub display_name: String,
    #[serde(default)]
    pub list_label: Option<String>,
    #[serde(default)]
    pub short_title: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
}

impl ModuleRecord {
    pub fn new(
        id: impl Into<String>,
        kind: impl Into<String>,
        display_name: impl Into<String>,
    ) -> Self {
        Self {
            id: id.into(),
            kind: kind.into(),
            display_name: display_name.into(),
            list_label: None,
            short_title: None,
            description: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BookRecord {
    #[serde(rename = "bookNumber")]
    pub book_number: i64,
    #[serde(rename = "shortName", default)]
    pub short_name: Option<String>,
    #[serde(rename = "longName", default)]
    pub long_name: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct VerseRecord {
    pub verse: i64,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CommentaryEntry {
    #[serde(rename = "verseFrom")]
    pub verse_from: i64,
    #[serde(rename = "verseTo", default)]
    pub verse_to: Option<i64>,
    #[serde(rename = "chapterTo", default)]
    pub chapter_to: Option<i64>,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NavHistoryEntry {
    #[serde(rename = "moduleId")]
    pub module_id: String,
    #[serde(rename = "bookNumber")]
    pub book_number: i64,
    pub chapter: i64,
    pub verse: Option<i64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PaneType {
    Bible,
    Commentary,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PaneRecord {
    pub id: String,
    #[serde(rename = "paneType")]
    pub pane_type: PaneType,
    #[serde(rename = "windowLabel", default)]
    pub window_label: Option<String>,
    #[serde(rename = "moduleId", default)]
    pub module_id: Option<String>,
    #[serde(rename = "bookNumber")]
    pub book_number: i64,
    pub chapter: i64,
    #[serde(rename = "bookShortName", default)]
    pub book_short_name: String,
    #[serde(rename = "selectedVerse", default)]
    pub selected_verse: Option<i64>,
    #[serde(rename = "navHistory", default)]
    pub nav_history: Vec<NavHistoryEntry>,
    #[serde(rename = "navHistoryIdx", default)]
    pub nav_history_idx: i64,
    #[serde(rename = "syncedToPaneId", default)]
    pub synced_to_pane_id: Option<String>,
    #[serde(rename = "contentScrollTop", default)]
    pub content_scroll_top: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum PaneNode {
    Leaf {
        #[serde(rename = "paneId")]
        pane_id: String,
    },
    Split {
        direction: String,
        ratio: f64,
        children: Box<(PaneNode, PaneNode)>,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PaneManagerState {
    #[serde(rename = "activePaneId", default)]
    pub active_pane_id: Option<String>,
    #[serde(default)]
    pub tree: Option<PaneNode>,
    #[serde(default)]
    pub panes: serde_json::Map<String, Value>,
    #[serde(rename = "linkTargetPaneId", default)]
    pub link_target_pane_id: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NavDirection {
    Back,
    Forward,
}

#[derive(Debug, Clone, PartialEq)]
pub struct HistoryMenuItem {
    pub entry: NavHistoryEntry,
    pub index: usize,
}

#[derive(Debug, Clone, PartialEq)]
pub enum CommentaryRestoreScroll {
    ScrollTop { value: f64 },
    Verse { value: i64 },
    Top,
}
