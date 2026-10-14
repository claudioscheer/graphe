//! Study session. The window calls these functions; tests call the same ones.

use graphe_domain::i18n;
#[cfg(test)]
use graphe_domain::model::BookRecord;
use graphe_domain::model::{NavHistoryEntry, PaneNode, PaneRecord, PaneType};
#[cfg(test)]
use graphe_domain::navigation::NavigationSession;
use graphe_domain::panes::{self, allocate_pane_label};
use graphe_domain::search::SearchHit;
use graphe_domain::shortcuts::{self, ShortcutAction};
use graphe_domain::workspace::{WorkspaceLocation, WorkspaceManager};
use indexmap::IndexMap;
use serde_json::{json, Value};
use std::collections::BTreeMap;

/// Commentary text for one module inside the all-commentaries dialog.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommentarySection {
    pub name: String,
    pub body: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Dialog {
    None,
    Navigation,
    Settings,
    About,
    Convert,
    ModuleEditor,
    Preview,
    AllCommentaries,
    Coverage,
    Picker,
    /// Dictionary module browser: usage, term count, and prefix paging.
    DictInfo,
}

pub struct Session {
    pub panes: IndexMap<String, PaneRecord>,
    pub tree: PaneNode,
    pub active_pane_id: String,
    pub link_target: Option<String>,
    pub sidebar: String,
    pub sidebar_collapsed: bool,
    pub dark: bool,
    pub font_size: f32,
    pub dialog: Dialog,
    pub query: String,
    pub hits: Vec<SearchHit>,
    pub selected_verses: Vec<i64>,
    /// Verse that starts a shift-click range. Stays put while shift is held.
    pub selection_anchor: Option<i64>,
    /// The next `show_chapter` replaces the selection with the active pane's verse.
    pub reveal_verse: bool,
    /// Verse the Bible pane should bring into view, then clear.
    pub scroll_verse: Option<i64>,
    /// Commentary panes that should scroll to a verse after their Bible moved.
    pub commentary_scroll: Vec<(String, i64)>,
    pub scroll_center: bool,
    pub chapter_text: Vec<(i64, String)>,
    pub workspaces: WorkspaceManager,
    pub next_pane: i64,
    pub status: String,
    pub pending_copy: Option<String>,
    pub preview_pinned: bool,
    pub show_strongs: bool,
    pub nav_input: String,
    pub preview_body: String,
    pub preview_title: String,
    /// One collapsed row per commentary module in the all-commentaries dialog.
    pub commentary_sections: Vec<CommentarySection>,
    pub commentary_open: Vec<bool>,
    /// Short reference shown in the all-commentaries title, such as `Hb 10:2`.
    pub commentary_ref: String,
    /// Commentary module opened in the coverage grid.
    pub coverage_module_id: Option<String>,
    pub dict_query: String,
    pub dict_body: String,
    pub dict_entry: Option<BTreeMap<String, String>>,
    pub dict_morph_code: Option<String>,
    pub dict_morph_lemma: Option<String>,
    pub dict_morph_meaning: Option<String>,
    pub dict_history: Vec<String>,
    pub dict_history_index: usize,
    pub dict_cognates: Vec<String>,
    pub xref_modules: Vec<String>,
    pub strongs_dicts: Vec<String>,
    pub search_module_id: Option<String>,
    pub dict_module_id: Option<String>,
    pub dict_cache: BTreeMap<String, String>,
    pub restore_panels: bool,
}

impl Session {
    pub fn new() -> Self {
        i18n::reset_lang();
        let mut workspaces = WorkspaceManager::new();
        workspaces.init(None, None);
        let mut panes = IndexMap::new();
        panes.insert("pane-1".into(), bible_pane("pane-1", "A"));
        Self {
            panes,
            tree: PaneNode::Leaf {
                pane_id: "pane-1".into(),
            },
            active_pane_id: "pane-1".into(),
            link_target: None,
            sidebar: "search".into(),
            sidebar_collapsed: false,
            dark: false,
            font_size: 20.0,
            dialog: Dialog::None,
            query: String::new(),
            hits: Vec::new(),
            selected_verses: Vec::new(),
            selection_anchor: None,
            reveal_verse: false,
            scroll_verse: None,
            commentary_scroll: Vec::new(),
            scroll_center: false,
            chapter_text: Vec::new(),
            workspaces,
            next_pane: 1,
            status: String::new(),
            pending_copy: None,
            preview_pinned: false,
            show_strongs: true,
            nav_input: String::new(),
            preview_body: String::new(),
            preview_title: String::new(),
            commentary_sections: Vec::new(),
            commentary_open: Vec::new(),
            commentary_ref: String::new(),
            coverage_module_id: None,
            dict_query: String::new(),
            dict_body: String::new(),
            dict_entry: None,
            dict_morph_code: None,
            dict_morph_lemma: None,
            dict_morph_meaning: None,
            dict_history: Vec::new(),
            dict_history_index: 0,
            dict_cognates: Vec::new(),
            xref_modules: Vec::new(),
            strongs_dicts: Vec::new(),
            search_module_id: None,
            dict_module_id: None,
            dict_cache: BTreeMap::new(),
            restore_panels: false,
        }
    }

    pub fn from_state(state: &Value) -> Self {
        let mut session = Self::new();
        let workspaces = state.get("workspaces").filter(|value| !value.is_null());
        let legacy = state
            .get("paneManager")
            .filter(|value| value.is_object())
            .cloned();
        if workspaces.is_some() || legacy.is_some() {
            session.workspaces.init(workspaces, legacy);
        }
        if let Some(pane) = session.workspaces.get_active_pane_state() {
            session.restore_layout(&pane);
        }
        if let Some(settings) = state.get("settings") {
            session.dark = settings.get("theme").and_then(|value| value.as_str()) == Some("dark");
            if let Some(size) = settings.get("fontSize").and_then(|value| value.as_f64()) {
                session.font_size = size as f32;
            }
            session.preview_pinned = settings
                .get("openPinnedRefsInModal")
                .and_then(|value| value.as_bool())
                .unwrap_or(false);
            session.show_strongs = settings
                .get("showStrongs")
                .and_then(|value| value.as_bool())
                .unwrap_or(true);
            session.strongs_dicts = string_list(settings.get("strongsDicts"));
            session.xref_modules = string_list(settings.get("crossRefModules"));
            if let Some(lang) = settings.get("language").and_then(|value| value.as_str()) {
                i18n::set_lang(lang);
            }
        }
        if let Some(view) = state
            .pointer("/workbench/activeView")
            .and_then(|value| value.as_str())
        {
            session.focus_sidebar(view);
        }
        if let Some(search) = state.get("searchPanel").filter(|value| value.is_object()) {
            if let Some(query) = search.get("query").and_then(|value| value.as_str()) {
                session.query = query.to_string();
            }
            session.search_module_id = search
                .get("moduleId")
                .and_then(|value| value.as_str())
                .filter(|value| !value.is_empty())
                .map(str::to_string);
        }
        if let Some(dict) = state.get("dictPanel").filter(|value| value.is_object()) {
            session.dict_module_id = dict
                .get("selectedModuleId")
                .and_then(|value| value.as_str())
                .filter(|value| !value.is_empty())
                .map(str::to_string);
            if let Some(cache) = dict
                .get("moduleSearchCache")
                .and_then(|value| value.as_object())
            {
                for (module_id, topic) in cache {
                    if let Some(topic) = topic.as_str().filter(|topic| !topic.trim().is_empty()) {
                        session
                            .dict_cache
                            .insert(module_id.clone(), topic.to_string());
                    }
                }
            }
            if let Some(module_id) = session.dict_module_id.clone() {
                if let Some(topic) = session.dict_cache.get(&module_id) {
                    session.dict_query = topic.clone();
                }
            }
        }
        session.restore_panels = !session.query.is_empty() || !session.dict_query.is_empty();
        session
    }

    #[cfg(test)]
    pub fn sidebar_views(&self) -> [&'static str; 3] {
        graphe_domain::SIDEBAR_VIEWS
    }

    pub fn show_chapter(&mut self, verses: Vec<(i64, String)>) {
        self.chapter_text = verses;
        let present: Vec<i64> = self.chapter_text.iter().map(|(verse, _)| *verse).collect();
        if self.reveal_verse {
            self.reveal_verse = false;
            let verse = self
                .panes
                .get(&self.active_pane_id)
                .and_then(|pane| pane.selected_verse)
                .filter(|verse| present.contains(verse));
            self.selected_verses = verse.into_iter().collect();
            self.selection_anchor = verse;
            return;
        }
        self.selected_verses.retain(|verse| present.contains(verse));
        if self
            .selection_anchor
            .is_some_and(|anchor| !present.contains(&anchor))
        {
            self.selection_anchor = self.selected_verses.first().copied();
        }
    }

    pub fn navigate(&mut self, book: i64, chapter: i64, verse: Option<i64>) {
        let moved = self.active_pane_id.clone();
        let is_bible = {
            let Some(pane) = self.panes.get_mut(&moved) else {
                return;
            };
            pane.book_number = book;
            pane.chapter = chapter;
            pane.selected_verse = verse;
            panes::push_nav_history_entry(pane);
            pane.pane_type == PaneType::Bible
        };
        self.dialog = Dialog::None;
        self.reveal_selected_verse(verse.is_some());
        if is_bible {
            self.note_bible_moved(&moved);
        }
    }

    /// Copy the active pane's verse into the visible selection and ask the view to scroll to it.
    pub fn reveal_selected_verse(&mut self, center: bool) {
        let verse = self
            .panes
            .get(&self.active_pane_id)
            .and_then(|pane| pane.selected_verse);
        self.reveal_verse = true;
        self.scroll_center = center;
        match verse {
            Some(verse) => {
                self.selected_verses = vec![verse];
                self.selection_anchor = Some(verse);
                self.scroll_verse = Some(verse);
            }
            None => {
                self.selected_verses.clear();
                self.selection_anchor = None;
                self.scroll_verse = None;
            }
        }
    }

    /// Open a search hit in the pinned Bible pane, or the active one.
    pub fn open_search_hit(&mut self, hit: &SearchHit) {
        let source = self.active_pane_id.clone();
        let target = self.navigation_target(&source);
        self.active_pane_id = target;
        self.navigate(hit.book_number, hit.chapter, Some(hit.verse));
    }

    /// Plain click replaces the selection. Shift extends from the anchor. Ctrl or Cmd toggles.
    pub fn select_verse(&mut self, verse: i64, shift: bool, toggle: bool) {
        let order: Vec<i64> = self.chapter_text.iter().map(|(item, _)| *item).collect();
        if !order.contains(&verse) {
            return;
        }
        if shift {
            let anchor = self
                .selection_anchor
                .filter(|anchor| order.contains(anchor))
                .unwrap_or(verse);
            if let (Some(from), Some(to)) = (
                order.iter().position(|item| *item == anchor),
                order.iter().position(|item| *item == verse),
            ) {
                let (start, end) = if from <= to { (from, to) } else { (to, from) };
                self.selected_verses = order[start..=end].to_vec();
            }
        } else if toggle {
            if let Some(index) = self.selected_verses.iter().position(|item| *item == verse) {
                self.selected_verses.remove(index);
            } else {
                self.selected_verses.push(verse);
            }
            self.selection_anchor = Some(verse);
        } else {
            self.selected_verses = vec![verse];
            self.selection_anchor = Some(verse);
        }
        let target = self.bible_target(&self.active_pane_id);
        if let Some(pane) = self.panes.get_mut(&target) {
            pane.selected_verse = self.selected_verses.last().copied();
        }
        self.note_bible_moved(&target);
    }

    pub fn split(&mut self, vertical: bool) -> String {
        self.next_pane += 1;
        let id = format!("pane-{}", self.next_pane);
        let label =
            allocate_pane_label(&self.panes, PaneType::Bible, None).unwrap_or_else(|| "A".into());
        let mut pane = bible_pane(&id, &label);
        let source_id = self.bible_target(&self.active_pane_id);
        if let Some(active) = self.panes.get(&source_id) {
            pane.module_id = active.module_id.clone();
            pane.book_number = active.book_number;
            pane.chapter = active.chapter;
        }
        self.panes.insert(id.clone(), pane);
        let replacement = PaneNode::Split {
            direction: if vertical { "v" } else { "h" }.into(),
            ratio: 0.5,
            children: Box::new((
                PaneNode::Leaf {
                    pane_id: self.active_pane_id.clone(),
                },
                PaneNode::Leaf {
                    pane_id: id.clone(),
                },
            )),
        };
        self.tree = replace_leaf(&self.tree, &self.active_pane_id, &replacement);
        self.active_pane_id = id.clone();
        id
    }

    pub fn split_commentary(&mut self, vertical: bool) -> String {
        let synced = self.bible_target(&self.active_pane_id);
        self.next_pane += 1;
        let id = format!("pane-{}", self.next_pane);
        let label = allocate_pane_label(&self.panes, PaneType::Commentary, None)
            .unwrap_or_else(|| "A".into());
        let (book_number, chapter) = self
            .panes
            .get(&synced)
            .map(|pane| (pane.book_number, pane.chapter))
            .unwrap_or((10, 1));
        self.panes.insert(
            id.clone(),
            PaneRecord {
                id: id.clone(),
                pane_type: PaneType::Commentary,
                window_label: Some(label),
                module_id: None,
                book_number,
                chapter,
                book_short_name: String::new(),
                selected_verse: None,
                nav_history: Vec::new(),
                nav_history_idx: -1,
                synced_to_pane_id: Some(synced),
                content_scroll_top: None,
            },
        );
        let anchor = self.active_pane_id.clone();
        let replacement = PaneNode::Split {
            direction: if vertical { "v" } else { "h" }.into(),
            ratio: 0.5,
            children: Box::new((
                PaneNode::Leaf { pane_id: anchor },
                PaneNode::Leaf {
                    pane_id: id.clone(),
                },
            )),
        };
        self.tree = replace_leaf(&self.tree, &self.active_pane_id, &replacement);
        self.active_pane_id = id.clone();
        id
    }

    pub fn toggle_pin(&mut self) {
        if self.link_target.as_deref() == Some(self.active_pane_id.as_str()) {
            self.link_target = None;
        } else {
            self.link_target = Some(self.active_pane_id.clone());
        }
    }

    pub fn select_all(&mut self) {
        self.selected_verses = self.chapter_text.iter().map(|(verse, _)| *verse).collect();
        self.selection_anchor = self.selected_verses.first().copied();
    }

    pub fn copy_selection(&self) -> String {
        let target = self.bible_target(&self.active_pane_id);
        let pane = self.panes.get(&target);
        let book = pane.map(|pane| pane.book_number).unwrap_or(10);
        let chapter = pane.map(|pane| pane.chapter).unwrap_or(1);
        let short = pane
            .map(|pane| pane.book_short_name.trim())
            .filter(|name| !name.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| i18n::book_name(book).short);
        self.chapter_text
            .iter()
            .filter(|(verse, _)| self.selected_verses.contains(verse))
            .map(|(verse, text)| {
                format!(
                    "[{short} {chapter}:{verse}] {}",
                    graphe_domain::markup::visible_verse_line(text)
                )
            })
            .collect::<Vec<_>>()
            .join("\n")
    }

    pub fn move_verse(&mut self, delta: i64, extend: bool) {
        let current = self.selected_verses.last().copied().unwrap_or(0);
        let verses: Vec<i64> = self.chapter_text.iter().map(|(verse, _)| *verse).collect();
        if verses.is_empty() {
            return;
        }
        let pos = verses
            .iter()
            .position(|verse| *verse == current)
            .unwrap_or(0);
        let next_pos = (pos as i64 + delta).clamp(0, verses.len() as i64 - 1) as usize;
        let next = verses[next_pos];
        if extend {
            if !self.selected_verses.contains(&next) {
                self.selected_verses.push(next);
            }
        } else {
            self.selected_verses = vec![next];
            self.selection_anchor = Some(next);
        }
        let target = self.bible_target(&self.active_pane_id);
        if let Some(pane) = self.panes.get_mut(&target) {
            pane.selected_verse = Some(next);
        }
        self.scroll_verse = Some(next);
        self.scroll_center = false;
    }

    pub fn focus_sidebar(&mut self, view: &str) {
        self.sidebar = if graphe_domain::SIDEBAR_VIEWS.contains(&view) {
            view.to_string()
        } else {
            "search".into()
        };
        self.sidebar_collapsed = false;
    }

    pub fn open_search_hit_in_new_study(&mut self, hit: &SearchHit) {
        self.remember_layout();
        let created = self.workspaces.create_workspace(
            None,
            Some(WorkspaceLocation {
                module_id: self
                    .panes
                    .get(&self.active_pane_id)
                    .and_then(|pane| pane.module_id.clone()),
                book_number: Some(hit.book_number),
                chapter: Some(hit.chapter),
                verse: Some(hit.verse),
            }),
        );
        if let Some(created) = created {
            self.status = created.name.clone();
            if let Some(pane) = created.pane_manager.clone() {
                self.restore_layout(&pane);
            }
        }
        self.navigate(hit.book_number, hit.chapter, Some(hit.verse));
    }

    #[cfg(test)]
    pub fn apply_quick_ref(&mut self, raw: &str, books: Vec<BookRecord>) -> bool {
        let pane_id = self.active_pane_id.clone();
        let mut nav =
            NavigationSession::new(|_: &str, _: i64| 1, |_: &str, _: i64, _: i64| vec![1], {
                let pane_id = pane_id.clone();
                move |pane: &str| (pane == pane_id).then(|| "module".to_string())
            });
        nav.open_for(&pane_id, books);
        nav.input = raw.to_string();
        nav.submit_input();
        let Some(action) = nav.navigations.pop() else {
            return false;
        };
        self.navigate(action.book_number, action.chapter, action.verse);
        true
    }

    pub fn cycle_favorite(&mut self, ids: &[String]) -> Option<String> {
        if ids.is_empty() {
            return None;
        }
        let current = self
            .panes
            .get(&self.active_pane_id)
            .and_then(|pane| pane.module_id.clone());
        let pos = current
            .as_ref()
            .and_then(|id| ids.iter().position(|candidate| candidate == id))
            .unwrap_or(0);
        let next = ids[(pos + 1) % ids.len()].clone();
        if let Some(pane) = self.panes.get_mut(&self.active_pane_id) {
            pane.module_id = Some(next.clone());
        }
        Some(next)
    }

    /// Point a commentary at a Bible pane, or at none. None keeps the place it was showing.
    pub fn set_commentary_sync(&mut self, commentary_id: &str, target: Option<String>) {
        let target = target.filter(|id| {
            self.panes
                .get(id)
                .is_some_and(|pane| pane.pane_type == PaneType::Bible)
        });
        if target.is_none() {
            let (book, chapter, verse) = self.reading_location(commentary_id);
            let Some(pane) = self.panes.get_mut(commentary_id) else {
                return;
            };
            if pane.pane_type != PaneType::Commentary {
                return;
            }
            pane.book_number = book;
            pane.chapter = chapter;
            pane.selected_verse = verse;
            pane.synced_to_pane_id = None;
            self.commentary_scroll.retain(|(id, _)| id != commentary_id);
            return;
        }
        let target = target.expect("filtered");
        let (book, chapter, verse) = self
            .panes
            .get(&target)
            .map(|pane| (pane.book_number, pane.chapter, pane.selected_verse))
            .unwrap_or((10, 1, None));
        if let Some(pane) = self.panes.get_mut(commentary_id) {
            if pane.pane_type != PaneType::Commentary {
                return;
            }
            pane.synced_to_pane_id = Some(target);
            pane.book_number = book;
            pane.chapter = chapter;
            pane.selected_verse = verse;
        }
        if let Some(verse) = verse {
            self.queue_commentary_scroll(commentary_id, verse);
        }
    }

    /// Copy a Bible pane's place into every commentary that follows it.
    pub fn note_bible_moved(&mut self, bible_id: &str) {
        let Some(source) = self.panes.get(bible_id).cloned() else {
            return;
        };
        if source.pane_type != PaneType::Bible {
            return;
        }
        let followers: Vec<String> = self
            .panes
            .iter()
            .filter(|(_, pane)| {
                pane.pane_type == PaneType::Commentary
                    && pane.synced_to_pane_id.as_deref() == Some(bible_id)
            })
            .map(|(id, _)| id.clone())
            .collect();
        for id in followers {
            if let Some(pane) = self.panes.get_mut(&id) {
                pane.book_number = source.book_number;
                pane.chapter = source.chapter;
                pane.selected_verse = source.selected_verse;
            }
            if let Some(verse) = source.selected_verse {
                self.queue_commentary_scroll(&id, verse);
            }
        }
    }

    pub fn commentary_scroll_verse(&self, pane_id: &str) -> Option<i64> {
        self.commentary_scroll
            .iter()
            .find(|(id, _)| id == pane_id)
            .map(|(_, verse)| *verse)
    }

    pub fn clear_commentary_scroll(&mut self, pane_id: &str) {
        self.commentary_scroll.retain(|(id, _)| id != pane_id);
    }

    fn queue_commentary_scroll(&mut self, pane_id: &str, verse: i64) {
        self.commentary_scroll.retain(|(id, _)| id != pane_id);
        self.commentary_scroll.push((pane_id.to_string(), verse));
    }

    pub fn reading_location(&self, pane_id: &str) -> (i64, i64, Option<i64>) {
        let Some(pane) = self.panes.get(pane_id) else {
            return (10, 1, None);
        };
        if pane.pane_type == PaneType::Commentary {
            if let Some(source) = pane
                .synced_to_pane_id
                .as_ref()
                .and_then(|id| self.panes.get(id))
            {
                return (source.book_number, source.chapter, source.selected_verse);
            }
        }
        (pane.book_number, pane.chapter, pane.selected_verse)
    }

    pub fn layout_value(&self) -> Value {
        let mut panes = serde_json::Map::new();
        for (id, pane) in &self.panes {
            panes.insert(
                id.clone(),
                serde_json::to_value(pane).unwrap_or(Value::Null),
            );
        }
        json!({
            "activePaneId": self.active_pane_id,
            "linkTargetPaneId": self.link_target,
            "tree": self.tree,
            "panes": Value::Object(panes),
        })
    }

    pub fn restore_layout(&mut self, value: &Value) {
        let Some(panes_val) = value.get("panes").and_then(|entry| entry.as_object()) else {
            return;
        };
        let mut panes = IndexMap::new();
        for (id, entry) in panes_val {
            let mut entry = entry.clone();
            if let Some(map) = entry.as_object_mut() {
                map.entry("id").or_insert_with(|| Value::String(id.clone()));
            }
            if let Ok(record) = serde_json::from_value::<PaneRecord>(entry) {
                panes.insert(id.clone(), record);
            }
        }
        if panes.is_empty() {
            return;
        }
        self.panes = panes;
        if let Some(tree) = value
            .get("tree")
            .and_then(|tree| serde_json::from_value(tree.clone()).ok())
        {
            self.tree = tree;
        } else if let Some(id) = self.panes.keys().next() {
            self.tree = PaneNode::Leaf {
                pane_id: id.clone(),
            };
        }
        if let Some(id) = value.get("activePaneId").and_then(|item| item.as_str()) {
            if self.panes.contains_key(id) {
                self.active_pane_id = id.to_string();
            }
        }
        if !self.panes.contains_key(&self.active_pane_id) {
            if let Some(id) = self.panes.keys().next() {
                self.active_pane_id = id.clone();
            }
        }
        self.link_target = value
            .get("linkTargetPaneId")
            .and_then(|item| item.as_str())
            .filter(|id| self.panes.contains_key(*id))
            .map(|id| id.to_string());
        self.next_pane = self
            .panes
            .keys()
            .filter_map(|id| id.strip_prefix("pane-")?.parse::<i64>().ok())
            .max()
            .unwrap_or(1);
    }

    /// `path` is empty for the root split and `0/1` for a nested one.
    /// The value is clamped to the range the layout file already stores.
    pub fn set_split_ratio(&mut self, path: &str, ratio: f64) -> bool {
        set_ratio(&mut self.tree, path, panes::clamp_ratio(ratio))
    }

    pub fn remember_layout(&mut self) {
        self.workspaces
            .update_active_pane_state(Some(self.layout_value()));
    }

    pub fn open_workspace(&mut self, id: &str) -> bool {
        let current = self.layout_value();
        let Some(item) = self.workspaces.activate_workspace(id, Some(current)) else {
            return false;
        };
        if let Some(pane) = item.pane_manager {
            self.restore_layout(&pane);
        }
        true
    }

    pub fn new_workspace(&mut self) -> Option<String> {
        self.remember_layout();
        let location = self
            .panes
            .get(&self.active_pane_id)
            .map(|pane| WorkspaceLocation {
                module_id: pane.module_id.clone(),
                book_number: Some(pane.book_number),
                chapter: Some(pane.chapter),
                verse: pane.selected_verse,
            });
        let created = self.workspaces.create_workspace(None, location)?;
        if let Some(pane) = created.pane_manager.clone() {
            self.restore_layout(&pane);
        }
        Some(created.id)
    }

    pub fn close_workspace(&mut self, id: &str) -> bool {
        let was_active = self
            .workspaces
            .get_state()
            .is_some_and(|state| state.active_workspace_id == id);
        let current = self.layout_value();
        if !self.workspaces.close_workspace(id, Some(current)) {
            return false;
        }
        if was_active {
            if let Some(pane) = self.workspaces.get_active_pane_state() {
                self.restore_layout(&pane);
            }
        }
        true
    }

    pub fn bible_target(&self, pane_id: &str) -> String {
        let Some(pane) = self.panes.get(pane_id) else {
            return pane_id.to_string();
        };
        if pane.pane_type == PaneType::Commentary {
            if let Some(source) = &pane.synced_to_pane_id {
                if self.panes.contains_key(source) {
                    return source.clone();
                }
            }
        }
        pane_id.to_string()
    }

    pub fn navigation_target(&self, source_pane: &str) -> String {
        if let Some(id) = &self.link_target {
            if self
                .panes
                .get(id)
                .is_some_and(|pane| pane.pane_type == PaneType::Bible)
            {
                return id.clone();
            }
        }
        let bible = self.bible_target(source_pane);
        if self
            .panes
            .get(&bible)
            .is_some_and(|pane| pane.pane_type == PaneType::Bible)
        {
            return bible;
        }
        self.panes
            .iter()
            .find(|(_, pane)| pane.pane_type == PaneType::Bible)
            .map(|(id, _)| id.clone())
            .unwrap_or_else(|| source_pane.to_string())
    }

    /// Cross-references and search hits open in the pinned bible pane.
    /// The preview modal is only for a reference clicked inside that pinned pane.
    pub fn follow_link(
        &mut self,
        source_pane: &str,
        book: i64,
        chapter: i64,
        verse: Option<i64>,
    ) -> bool {
        let target = self.navigation_target(source_pane);
        let clicked_pin = self.link_target.as_deref() == Some(source_pane);
        let target_is_pin = self.link_target.as_deref() == Some(target.as_str());
        if self.preview_pinned && clicked_pin && target_is_pin {
            return true;
        }
        self.active_pane_id = target;
        self.navigate(book, chapter, verse);
        false
    }

    pub fn close_pane(&mut self, pane_id: &str) -> bool {
        if self.panes.len() <= 1 {
            return false;
        }
        let Some(tree) = remove_leaf(&self.tree, pane_id) else {
            return false;
        };
        self.tree = tree;
        self.panes.shift_remove(pane_id);
        if self.link_target.as_deref() == Some(pane_id) {
            self.link_target = None;
        }
        for pane in self.panes.values_mut() {
            if pane.synced_to_pane_id.as_deref() == Some(pane_id) {
                pane.synced_to_pane_id = None;
            }
        }
        self.commentary_scroll.retain(|(id, _)| id != pane_id);
        if !self.panes.contains_key(&self.active_pane_id) {
            let id = graphe_domain::panes::get_first_leaf_id(&self.tree);
            if self.panes.contains_key(&id) {
                self.active_pane_id = id;
            }
        }
        true
    }

    pub fn handle_shortcut_input(
        &mut self,
        key: &str,
        primary: bool,
        shift: bool,
        text_focused: bool,
    ) -> Option<ShortcutAction> {
        let action = shortcuts::match_shortcut(key, primary, shift)?;
        if (text_focused || self.dialog != Dialog::None)
            && shortcuts::suppressed_when_typing(action)
        {
            return None;
        }
        self.handle_shortcut(key, primary, shift)
    }

    pub fn handle_shortcut(
        &mut self,
        key: &str,
        primary: bool,
        shift: bool,
    ) -> Option<ShortcutAction> {
        let action = shortcuts::match_shortcut(key, primary, shift)?;
        match action {
            ShortcutAction::FocusSearch => self.focus_sidebar("search"),
            ShortcutAction::OpenNavigation => self.dialog = Dialog::Navigation,
            ShortcutAction::OpenSettings => self.dialog = Dialog::Settings,
            ShortcutAction::OpenModuleEditor => self.dialog = Dialog::ModuleEditor,
            ShortcutAction::SplitHorizontal => {
                self.split(false);
            }
            ShortcutAction::SplitVertical => {
                self.split(true);
            }
            ShortcutAction::SelectAllVerses => self.select_all(),
            ShortcutAction::CopyVerses => {
                let text = self.copy_selection();
                if !text.is_empty() {
                    self.status = text.clone();
                    self.pending_copy = Some(text);
                }
            }
            ShortcutAction::VerseUp => self.move_verse(-1, false),
            ShortcutAction::VerseDown => self.move_verse(1, false),
            ShortcutAction::ExtendUp => self.move_verse(-1, true),
            ShortcutAction::ExtendDown => self.move_verse(1, true),
            ShortcutAction::CloseOverlay => self.dialog = Dialog::None,
            ShortcutAction::NextPane => self.activate_next_pane(),
            ShortcutAction::ToggleTranslationPicker | ShortcutAction::CycleFavoriteTranslations => {
            }
        }
        Some(action)
    }

    fn activate_next_pane(&mut self) {
        let ids = panes::get_all_leaf_ids(Some(&self.tree));
        if ids.is_empty() {
            return;
        }
        let pos = ids
            .iter()
            .position(|id| id == &self.active_pane_id)
            .unwrap_or(0);
        self.active_pane_id = ids[(pos + 1) % ids.len()].clone();
    }

    pub fn back(&mut self) -> bool {
        let center = {
            let Some(pane) = self.panes.get_mut(&self.active_pane_id) else {
                return false;
            };
            if !panes::has_nav_back_history(Some(pane)) {
                return false;
            }
            pane.nav_history_idx -= 1;
            let entry = pane.nav_history[pane.nav_history_idx as usize].clone();
            apply_entry(pane, &entry);
            entry.verse.is_some()
        };
        self.reveal_selected_verse(center);
        true
    }

    pub fn forward(&mut self) -> bool {
        let center = {
            let Some(pane) = self.panes.get_mut(&self.active_pane_id) else {
                return false;
            };
            if !panes::has_nav_forward_history(Some(pane)) {
                return false;
            }
            pane.nav_history_idx += 1;
            let entry = pane.nav_history[pane.nav_history_idx as usize].clone();
            apply_entry(pane, &entry);
            entry.verse.is_some()
        };
        self.reveal_selected_verse(center);
        true
    }
}

fn apply_entry(pane: &mut PaneRecord, entry: &NavHistoryEntry) {
    pane.module_id = Some(entry.module_id.clone());
    pane.book_number = entry.book_number;
    pane.chapter = entry.chapter;
    pane.selected_verse = entry.verse;
}

fn string_list(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(|item| item.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

fn remove_leaf(node: &PaneNode, pane_id: &str) -> Option<PaneNode> {
    match node {
        PaneNode::Leaf { pane_id: id } if id == pane_id => None,
        PaneNode::Leaf { pane_id } => Some(PaneNode::Leaf {
            pane_id: pane_id.clone(),
        }),
        PaneNode::Split {
            direction,
            ratio,
            children,
        } => {
            let left = remove_leaf(&children.0, pane_id);
            let right = remove_leaf(&children.1, pane_id);
            match (left, right) {
                (None, Some(other)) | (Some(other), None) => Some(other),
                (Some(left), Some(right)) => Some(PaneNode::Split {
                    direction: direction.clone(),
                    ratio: *ratio,
                    children: Box::new((left, right)),
                }),
                (None, None) => None,
            }
        }
    }
}

fn bible_pane(id: &str, label: &str) -> PaneRecord {
    PaneRecord {
        id: id.into(),
        pane_type: PaneType::Bible,
        window_label: Some(label.into()),
        module_id: None,
        book_number: 10,
        chapter: 1,
        book_short_name: String::new(),
        selected_verse: None,
        nav_history: Vec::new(),
        nav_history_idx: -1,
        synced_to_pane_id: None,
        content_scroll_top: None,
    }
}

fn set_ratio(node: &mut PaneNode, path: &str, ratio: f64) -> bool {
    if path.is_empty() {
        return match node {
            PaneNode::Split { ratio: slot, .. } => {
                *slot = ratio;
                true
            }
            PaneNode::Leaf { .. } => false,
        };
    }
    let (head, tail) = path.split_once('/').unwrap_or((path, ""));
    let PaneNode::Split { children, .. } = node else {
        return false;
    };
    let child = match head {
        "0" => &mut children.0,
        "1" => &mut children.1,
        _ => return false,
    };
    set_ratio(child, tail, ratio)
}

fn replace_leaf(node: &PaneNode, pane_id: &str, replacement: &PaneNode) -> PaneNode {
    match node {
        PaneNode::Leaf { pane_id: id } if id == pane_id => clone_tree(replacement),
        PaneNode::Leaf { pane_id } => PaneNode::Leaf {
            pane_id: pane_id.clone(),
        },
        PaneNode::Split {
            direction,
            ratio,
            children,
        } => PaneNode::Split {
            direction: direction.clone(),
            ratio: *ratio,
            children: Box::new((
                replace_leaf(&children.0, pane_id, replacement),
                replace_leaf(&children.1, pane_id, replacement),
            )),
        },
    }
}

fn clone_tree(node: &PaneNode) -> PaneNode {
    match node {
        PaneNode::Leaf { pane_id } => PaneNode::Leaf {
            pane_id: pane_id.clone(),
        },
        PaneNode::Split {
            direction,
            ratio,
            children,
        } => PaneNode::Split {
            direction: direction.clone(),
            ratio: *ratio,
            children: Box::new((clone_tree(&children.0), clone_tree(&children.1))),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn starts_with_one_bible_pane_and_three_sidebar_views() {
        let session = Session::new();
        assert_eq!(session.workspaces.get_state().unwrap().items.len(), 1);
        assert_eq!(session.sidebar_views(), ["search", "dictionary", "modules"]);
        assert!(matches!(session.tree, PaneNode::Leaf { .. }));
    }

    #[test]
    fn dragging_a_split_changes_only_that_divider() {
        let mut session = Session::new();
        session.split(true);
        session.active_pane_id = "pane-1".into();
        session.split(false);
        assert!(session.set_split_ratio("0", 0.7));
        assert!(session.set_split_ratio("", 0.35));
        assert!(!session.set_split_ratio("1", 0.2));
        match &session.tree {
            PaneNode::Split {
                direction,
                ratio,
                children,
            } => {
                assert_eq!(direction, "v");
                assert!((*ratio - 0.35).abs() < 1e-9);
                match &children.0 {
                    PaneNode::Split {
                        direction, ratio, ..
                    } => {
                        assert_eq!(direction, "h");
                        assert!((*ratio - 0.7).abs() < 1e-9);
                    }
                    PaneNode::Leaf { .. } => panic!("the upper half is the side-by-side split"),
                }
            }
            PaneNode::Leaf { .. } => panic!("expected a split tree"),
        }
        assert!(session.set_split_ratio("", f64::NAN));
        match &session.tree {
            PaneNode::Split { ratio, .. } => assert!((*ratio - 0.5).abs() < 1e-9),
            PaneNode::Leaf { .. } => panic!("expected a split tree"),
        }
    }

    #[test]
    fn splits_navigates_copies_and_opens_a_hit_in_a_new_study() {
        let mut session = Session::new();
        session.show_chapter(vec![
            (1, "In the beginning".into()),
            (2, "And the earth".into()),
        ]);
        session.handle_shortcut("H", true, true);
        assert!(matches!(session.tree, PaneNode::Split { .. }));
        assert_eq!(session.panes.len(), 2);
        session.navigate(10, 1, Some(1));
        assert!(session.panes[&session.active_pane_id].nav_history.len() >= 1);
        session.handle_shortcut("A", true, false);
        assert_eq!(
            session.copy_selection(),
            "[Gn 1:1] In the beginning\n[Gn 1:2] And the earth"
        );
        session.show_chapter(vec![(1, "<E>Word<e><S>1</S><X>pr=hidden<x>".into())]);
        session.selected_verses = vec![1];
        assert_eq!(session.copy_selection(), "[Gn 1:1] Word");
        assert!(!session.copy_selection().contains("pr="));
        session.handle_shortcut("F3", false, false);
        assert_eq!(session.dialog, Dialog::Navigation);
        session.handle_shortcut("Escape", false, false);
        assert_eq!(session.dialog, Dialog::None);
        let before = session.workspaces.get_state().unwrap().items.len();
        session.open_search_hit_in_new_study(&SearchHit {
            book_number: 470,
            chapter: 5,
            verse: 3,
            text: "blessed".into(),
        });
        assert!(session.workspaces.get_state().unwrap().items.len() > before);
        assert_eq!(session.panes[&session.active_pane_id].book_number, 470);
        assert_eq!(
            session.workspaces.get_state().unwrap().items[0]
                .pane_manager
                .is_some(),
            true
        );
    }

    #[test]
    fn quick_ref_commentary_split_history_and_workspace_switch_use_the_domain() {
        i18n::reset_lang();
        let mut session = Session::new();
        let books = vec![
            BookRecord {
                book_number: 10,
                short_name: Some("Gn".into()),
                long_name: Some("Gênesis".into()),
            },
            BookRecord {
                book_number: 470,
                short_name: Some("Mt".into()),
                long_name: Some("Mateus".into()),
            },
        ];
        assert!(session.apply_quick_ref("Gn 1:3", books.clone()));
        assert_eq!(session.panes[&session.active_pane_id].book_number, 10);
        assert_eq!(session.panes[&session.active_pane_id].chapter, 1);
        assert_eq!(
            session.panes[&session.active_pane_id].selected_verse,
            Some(3)
        );
        assert!(session.apply_quick_ref("Mt 5", books));
        assert_eq!(session.panes[&session.active_pane_id].book_number, 470);
        assert_eq!(session.panes[&session.active_pane_id].chapter, 5);
        assert_eq!(session.panes[&session.active_pane_id].selected_verse, None);
        assert!(session.back());
        assert_eq!(session.panes[&session.active_pane_id].book_number, 10);
        assert!(session.forward());
        assert_eq!(session.panes[&session.active_pane_id].book_number, 470);
        let bible = session.active_pane_id.clone();
        let commentary = session.split_commentary(false);
        assert_eq!(session.panes[&commentary].pane_type, PaneType::Commentary);
        assert_eq!(
            session.panes[&commentary].synced_to_pane_id.as_deref(),
            Some(bible.as_str())
        );
        assert_eq!(session.reading_location(&commentary).0, 470);
        let first = session
            .workspaces
            .get_state()
            .unwrap()
            .active_workspace_id
            .clone();
        let second = session.new_workspace().unwrap();
        assert_ne!(first, second);
        assert!(session.open_workspace(&first));
        assert!(session
            .panes
            .values()
            .any(|pane| pane.pane_type == PaneType::Commentary));
    }

    #[test]
    fn commentary_follows_the_bible_picked_from_the_badge() {
        let mut session = Session::new();
        session.panes.get_mut("pane-1").unwrap().book_number = 10;
        session.panes.get_mut("pane-1").unwrap().chapter = 1;
        let other = session.split(false);
        session.panes.get_mut(&other).unwrap().book_number = 470;
        session.panes.get_mut(&other).unwrap().chapter = 5;
        session.panes.get_mut(&other).unwrap().selected_verse = Some(2);
        session.active_pane_id = other.clone();
        let commentary = session.split_commentary(false);
        assert_eq!(
            session.panes[&commentary].synced_to_pane_id.as_deref(),
            Some(other.as_str())
        );
        session.set_commentary_sync(&commentary, Some("pane-1".into()));
        assert_eq!(session.reading_location(&commentary), (10, 1, None));
        session.active_pane_id = "pane-1".into();
        session.navigate(10, 11, Some(4));
        assert_eq!(session.reading_location(&commentary), (10, 11, Some(4)));
        assert_eq!(session.commentary_scroll_verse(&commentary), Some(4));
        session.set_commentary_sync(&commentary, None);
        assert!(session.panes[&commentary].synced_to_pane_id.is_none());
        assert_eq!(session.reading_location(&commentary).1, 11);
        session.navigate(10, 12, Some(1));
        assert_eq!(
            session.reading_location(&commentary).1,
            11,
            "an unsynced commentary stays where it was"
        );
    }

    #[test]
    fn pinned_pane_receives_refs_and_only_a_click_there_previews() {
        let mut session = Session::new();
        let other = session.split(false);
        session.active_pane_id = "pane-1".into();
        session.toggle_pin();
        session.preview_pinned = true;
        assert!(session.follow_link("pane-1", 470, 5, Some(3)));
        assert_eq!(session.panes["pane-1"].book_number, 10);
        assert!(!session.follow_link(&other, 470, 5, Some(3)));
        assert_eq!(session.panes["pane-1"].book_number, 470);
        assert_eq!(session.panes["pane-1"].chapter, 5);
        assert_eq!(session.active_pane_id, "pane-1");
    }

    #[test]
    fn typing_and_dialogs_do_not_move_the_verse_selection() {
        let mut session = Session::new();
        session.show_chapter(vec![(1, "a".into()), (2, "b".into())]);
        session.selected_verses = vec![1];
        assert!(session
            .handle_shortcut_input("ArrowDown", false, false, true)
            .is_none());
        assert_eq!(session.selected_verses, vec![1]);
        session.dialog = Dialog::Navigation;
        assert!(session
            .handle_shortcut_input("A", true, false, false)
            .is_none());
        assert_eq!(session.selected_verses, vec![1]);
        session.dialog = Dialog::None;
        assert_eq!(
            session.handle_shortcut_input("ArrowDown", false, false, false),
            Some(ShortcutAction::VerseDown)
        );
        assert_eq!(session.selected_verses, vec![2]);
    }

    #[test]
    fn saved_search_and_dictionary_panels_come_back() {
        let state = json!({
            "searchPanel": {"moduleId": "kjv", "query": "faith"},
            "dictPanel": {
                "selectedModuleId": "strong",
                "moduleSearchCache": {"strong": "G3056", "empty": "  "}
            }
        });
        let session = Session::from_state(&state);
        assert_eq!(session.query, "faith");
        assert_eq!(session.search_module_id.as_deref(), Some("kjv"));
        assert_eq!(session.dict_module_id.as_deref(), Some("strong"));
        assert_eq!(session.dict_query, "G3056");
        assert_eq!(
            session.dict_cache.get("strong").map(String::as_str),
            Some("G3056")
        );
        assert!(session.restore_panels);
    }

    #[test]
    fn a_search_hit_selects_the_pinned_verse_after_the_chapter_loads() {
        let mut session = Session::new();
        let other = session.split(false);
        session.active_pane_id = other;
        session.link_target = Some("pane-1".into());
        session.open_search_hit(&SearchHit {
            book_number: 10,
            chapter: 12,
            verse: 16,
            text: "amor".into(),
        });
        assert_eq!(session.active_pane_id, "pane-1");
        assert_eq!(session.panes["pane-1"].book_number, 10);
        assert_eq!(session.panes["pane-1"].chapter, 12);
        assert_eq!(session.panes["pane-1"].selected_verse, Some(16));
        assert_eq!(session.selected_verses, vec![16]);
        assert_eq!(session.scroll_verse, Some(16));
        assert!(session.scroll_center);
        session.show_chapter(vec![
            (15, "antes".into()),
            (16, "amor".into()),
            (17, "depois".into()),
        ]);
        assert_eq!(session.selected_verses, vec![16]);
        assert_eq!(session.scroll_verse, Some(16));
    }

    #[test]
    fn shift_click_selects_a_range_and_ctrl_click_toggles() {
        let mut session = Session::new();
        session.show_chapter(vec![
            (1, "a".into()),
            (2, "b".into()),
            (3, "c".into()),
            (4, "d".into()),
        ]);
        session.select_verse(2, false, false);
        session.select_verse(4, true, false);
        assert_eq!(session.selected_verses, vec![2, 3, 4]);
        session.select_verse(3, false, true);
        assert_eq!(session.selected_verses, vec![2, 4]);
        session.select_verse(3, false, true);
        assert_eq!(session.selected_verses, vec![2, 4, 3]);
        session.select_all();
        assert_eq!(session.selected_verses, vec![1, 2, 3, 4]);
    }

    #[test]
    fn reloading_the_same_chapter_keeps_a_multi_select() {
        let mut session = Session::new();
        session.show_chapter(vec![(1, "a".into()), (2, "b".into())]);
        session.select_all();
        session.show_chapter(vec![(1, "a".into()), (2, "b changed".into())]);
        assert_eq!(session.selected_verses, vec![1, 2]);
        session.navigate(470, 5, None);
        session.show_chapter(vec![(1, "x".into()), (2, "y".into())]);
        assert!(session.selected_verses.is_empty());
        assert!(session.scroll_verse.is_none());
    }
}
