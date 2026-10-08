use crate::app_state::AppStateStore;
use crate::model::ModuleRecord;
use serde_json::{json, Value};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PickerRow {
    Divider,
    Item {
        id: String,
        name: String,
        is_fav: bool,
        is_none: bool,
        highlighted: bool,
        selected: bool,
    },
}

#[derive(Debug, Clone)]
pub struct ModulePicker {
    pub modules: Vec<ModuleRecord>,
    pub current_id: Option<String>,
    pub module_type: String,
    pub truncate_length: usize,
    pub allow_none: bool,
    pub none_label: String,
    pub show_favorites: bool,
    pub open: bool,
    pub search: String,
    pub highlight_idx: i64,
    pub rows: Vec<PickerRow>,
    pub changes: Vec<Option<String>>,
    pub favorite_events: Vec<String>,
    pub dropdown_left: f32,
    pub dropdown_top: f32,
}

#[derive(Debug, Clone)]
pub struct PickerOptions {
    pub modules: Vec<ModuleRecord>,
    pub selected_id: Option<String>,
    pub module_type: String,
    pub truncate_length: usize,
    pub allow_none: bool,
    pub none_label: String,
    pub show_favorites: bool,
}

impl Default for PickerOptions {
    fn default() -> Self {
        Self {
            modules: Vec::new(),
            selected_id: None,
            module_type: "bible".into(),
            truncate_length: 80,
            allow_none: false,
            none_label: "—".into(),
            show_favorites: true,
        }
    }
}

impl ModulePicker {
    pub fn create(options: PickerOptions) -> Self {
        let mut picker = Self {
            modules: options.modules,
            current_id: options.selected_id,
            module_type: options.module_type,
            truncate_length: options.truncate_length,
            allow_none: options.allow_none,
            none_label: options.none_label,
            show_favorites: options.show_favorites,
            open: false,
            search: String::new(),
            highlight_idx: -1,
            rows: Vec::new(),
            changes: Vec::new(),
            favorite_events: Vec::new(),
            dropdown_left: 0.0,
            dropdown_top: 0.0,
        };
        picker.render();
        picker
    }

    pub fn trigger_text(&self) -> String {
        if self.allow_none && self.current_id.is_none() {
            return self.none_label.clone();
        }
        if let Some(id) = &self.current_id {
            if let Some(module) = self.modules.iter().find(|module| &module.id == id) {
                return truncate(&display_name(module), self.truncate_length);
            }
            return id.clone();
        }
        "—".into()
    }

    pub fn trigger_title(&self) -> String {
        self.current_id
            .as_ref()
            .and_then(|id| self.modules.iter().find(|module| &module.id == id))
            .map(display_name)
            .unwrap_or_default()
    }

    pub fn toggle_open(&mut self, store: &AppStateStore) {
        if self.open {
            self.close();
        } else {
            self.open_dropdown(store, 0.0, 0.0, 0.0, 1000.0, 800.0);
        }
    }

    pub fn open_dropdown(
        &mut self,
        store: &AppStateStore,
        trigger_left: f32,
        trigger_top: f32,
        trigger_bottom: f32,
        viewport_w: f32,
        viewport_h: f32,
    ) {
        if self.open {
            return;
        }
        self.open = true;
        self.search.clear();
        self.position(
            trigger_left,
            trigger_top,
            trigger_bottom,
            220.0,
            180.0,
            viewport_w,
            viewport_h,
        );
        self.render_with(store);
    }

    pub fn position(
        &mut self,
        trigger_left: f32,
        trigger_top: f32,
        trigger_bottom: f32,
        dd_w: f32,
        dd_h: f32,
        viewport_w: f32,
        viewport_h: f32,
    ) {
        let mut left = trigger_left;
        let mut top = trigger_bottom;
        if left + dd_w > viewport_w {
            left = (viewport_w - dd_w).max(0.0);
        }
        if top + dd_h > viewport_h {
            top = (trigger_top - dd_h).max(0.0);
        }
        self.dropdown_left = left;
        self.dropdown_top = top;
    }

    pub fn close(&mut self) {
        self.open = false;
        self.rows.clear();
    }

    pub fn set_search(&mut self, store: &AppStateStore, value: &str) {
        self.search = value.to_string();
        self.render_with(store);
    }

    pub fn clear_search(&mut self, store: &AppStateStore) {
        self.search.clear();
        self.render_with(store);
    }

    pub fn arrow(&mut self, down: bool) {
        let selectable = self.selectable();
        if selectable.is_empty() {
            return;
        }
        let cur = selectable
            .iter()
            .position(|idx| *idx as i64 == self.highlight_idx);
        let next = if down {
            match cur {
                Some(pos) if pos + 1 < selectable.len() => selectable[pos + 1],
                Some(_) => selectable[0],
                None => selectable[0],
            }
        } else {
            match cur {
                Some(pos) if pos > 0 => selectable[pos - 1],
                _ => *selectable.last().unwrap(),
            }
        };
        self.highlight_idx = next as i64;
        self.apply_highlight();
    }

    pub fn enter(&mut self) {
        let Some(row) = self.rows.get(self.highlight_idx as usize) else {
            return;
        };
        if let PickerRow::Item { id, is_none, .. } = row {
            let id = if *is_none { None } else { Some(id.clone()) };
            self.select(id);
        }
    }

    pub fn click_index(&mut self, index: usize) {
        if let Some(PickerRow::Item { id, is_none, .. }) = self.rows.get(index) {
            let id = if *is_none { None } else { Some(id.clone()) };
            self.select(id);
        }
    }

    pub fn hover(&mut self, index: usize) {
        if matches!(self.rows.get(index), Some(PickerRow::Item { .. })) {
            self.highlight_idx = index as i64;
            self.apply_highlight();
        }
    }

    pub fn toggle_favorite(&mut self, store: &mut AppStateStore, module_id: &str) {
        let mut favs = favorites(store, &self.module_type);
        if let Some(pos) = favs.iter().position(|id| id == module_id) {
            favs.remove(pos);
        } else {
            favs.push(module_id.to_string());
        }
        set_favorites(store, &self.module_type, favs);
        self.favorite_events.push(self.module_type.clone());
        self.render_with(store);
    }

    pub fn set_selected(&mut self, id: Option<String>) {
        self.current_id = id.filter(|id| !id.is_empty());
        if self.open {
            self.apply_highlight();
        }
    }

    pub fn set_modules(&mut self, modules: Vec<ModuleRecord>) {
        self.modules = modules;
    }

    fn select(&mut self, id: Option<String>) {
        self.current_id = id.clone().filter(|id| !id.is_empty());
        self.close();
        self.changes.push(self.current_id.clone());
    }

    fn render(&mut self) {
        self.rows.clear();
    }

    pub fn render_with(&mut self, store: &AppStateStore) {
        if !self.open {
            self.rows.clear();
            return;
        }
        let fav_ids = if self.show_favorites {
            favorites(store, &self.module_type)
        } else {
            Vec::new()
        };
        let query = self.search.to_lowercase();
        let query = query.trim();
        let mut all = Vec::new();
        if self.allow_none {
            all.push((String::new(), self.none_label.clone(), false, true));
        }
        for module in &self.modules {
            let name = display_name(module);
            if !query.is_empty()
                && !name.to_lowercase().contains(query)
                && !module.id.to_lowercase().contains(query)
            {
                continue;
            }
            all.push((
                module.id.clone(),
                name,
                fav_ids.iter().any(|id| id == &module.id),
                false,
            ));
        }
        let favs: Vec<_> = all.iter().filter(|item| item.2).cloned().collect();
        let rest: Vec<_> = all.iter().filter(|item| !item.2).cloned().collect();
        let mut rows = Vec::new();
        let push_item = |rows: &mut Vec<PickerRow>, item: (String, String, bool, bool)| {
            rows.push(PickerRow::Item {
                id: item.0,
                name: item.1,
                is_fav: item.2,
                is_none: item.3,
                highlighted: false,
                selected: false,
            });
        };
        if !favs.is_empty() {
            for item in favs {
                push_item(&mut rows, item);
            }
            rows.push(PickerRow::Divider);
        }
        for item in rest {
            push_item(&mut rows, item);
        }
        for row in &mut rows {
            if let PickerRow::Item {
                id,
                is_none,
                selected,
                ..
            } = row
            {
                *selected = self.current_id.as_deref() == Some(id.as_str())
                    || (*is_none && self.current_id.is_none());
            }
        }
        self.rows = rows;
        self.highlight_idx = -1;
    }

    fn selectable(&self) -> Vec<usize> {
        self.rows
            .iter()
            .enumerate()
            .filter_map(|(idx, row)| matches!(row, PickerRow::Item { .. }).then_some(idx))
            .collect()
    }

    fn apply_highlight(&mut self) {
        for (idx, row) in self.rows.iter_mut().enumerate() {
            if let PickerRow::Item { highlighted, .. } = row {
                *highlighted = idx as i64 == self.highlight_idx;
            }
        }
    }

    pub fn item_count(&self) -> usize {
        self.rows
            .iter()
            .filter(|row| matches!(row, PickerRow::Item { .. }))
            .count()
    }

    pub fn highlighted_name(&self) -> Option<String> {
        self.rows.iter().find_map(|row| match row {
            PickerRow::Item {
                name, highlighted, ..
            } if *highlighted => Some(name.clone()),
            _ => None,
        })
    }
}

pub fn display_name(module: &ModuleRecord) -> String {
    module
        .list_label
        .clone()
        .or_else(|| {
            if module.display_name.is_empty() {
                None
            } else {
                Some(module.display_name.clone())
            }
        })
        .or_else(|| module.short_title.clone())
        .or_else(|| module.description.clone())
        .unwrap_or_else(|| module.id.clone())
}

pub fn truncate(text: &str, max_len: usize) -> String {
    if max_len == 0 {
        return String::new();
    }
    text.chars().take(max_len).collect()
}

pub fn favorites(store: &AppStateStore, module_type: &str) -> Vec<String> {
    store
        .settings()
        .get("favoriteModules")
        .and_then(|v| v.get(module_type))
        .and_then(|v| v.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default()
}

pub fn set_favorites(store: &mut AppStateStore, module_type: &str, ids: Vec<String>) {
    let mut favs = store
        .settings()
        .get("favoriteModules")
        .and_then(|v| v.as_object())
        .cloned()
        .unwrap_or_default();
    favs.insert(
        module_type.to_string(),
        Value::Array(ids.into_iter().map(Value::String).collect()),
    );
    store.set_settings(json!({"favoriteModules": Value::Object(favs)}));
}

#[cfg(test)]
mod module_picker_tests {
    use super::*;

    fn bible(id: &str, name: &str) -> ModuleRecord {
        ModuleRecord::new(id, "bible", name)
    }

    #[test]
    fn opens_filters_highlights_selects_clears_and_closes() {
        let mut store = AppStateStore::new();
        store.init(Some(
            &json!({"settings": {"favoriteModules": {"bible": ["web"]}}}),
        ));
        let mut picker = ModulePicker::create(PickerOptions {
            modules: vec![
                bible("kjv", "King James Version"),
                bible("web", "World English Bible"),
            ],
            selected_id: Some("kjv".into()),
            module_type: "bible".into(),
            truncate_length: 12,
            allow_none: true,
            none_label: "None".into(),
            show_favorites: true,
        });
        assert!(picker.trigger_text().contains("King James V"));
        assert_eq!(favorites(&store, "bible"), vec!["web".to_string()]);
        assert!(favorites(&store, "dictionary").is_empty());
        picker.open_dropdown(&store, 250.0, 180.0, 205.0, 320.0, 220.0);
        assert!(picker.open);
        assert_eq!(picker.item_count(), 3);
        assert!(picker
            .rows
            .iter()
            .any(|row| matches!(row, PickerRow::Divider)));
        assert_eq!(picker.dropdown_left, 100.0);
        assert_eq!(picker.dropdown_top, 0.0);
        picker.close();
        assert!(!picker.open);
        picker.open_dropdown(&store, 250.0, 180.0, 205.0, 320.0, 220.0);
        picker.set_search(&store, "king");
        assert_eq!(picker.item_count(), 2);
        picker.clear_search(&store);
        assert_eq!(picker.item_count(), 3);
        picker.arrow(true);
        picker.arrow(false);
        assert!(picker.highlighted_name().is_some());
        picker.enter();
        assert_eq!(
            picker.changes.last().cloned().flatten().as_deref(),
            Some("kjv")
        );
        assert!(picker.trigger_text().contains("King James V"));
        assert!(!picker.open);

        picker.open_dropdown(&store, 0.0, 0.0, 20.0, 1000.0, 800.0);
        picker.toggle_favorite(&mut store, "web");
        assert!(favorites(&store, "bible").is_empty());
        assert_eq!(
            picker.favorite_events.last().map(String::as_str),
            Some("bible")
        );
        picker.toggle_favorite(&mut store, "kjv");
        assert_eq!(favorites(&store, "bible"), vec!["kjv".to_string()]);
        picker.click_index(
            picker
                .rows
                .iter()
                .position(|row| matches!(row, PickerRow::Item { is_none: true, .. }))
                .unwrap(),
        );
        assert_eq!(picker.changes.last(), Some(&None));
        picker.set_selected(Some("missing".into()));
        assert!(picker.trigger_text().contains("missing"));
        picker.set_modules(vec![bible("asv", "American Standard Version")]);
        picker.set_selected(Some("asv".into()));
        assert_eq!(picker.trigger_title(), "American Standard Version");
        picker.open_dropdown(&store, 0.0, 0.0, 20.0, 1000.0, 800.0);
        picker.close();
        assert!(!picker.open);
        store.advance(200);
        assert!(!store.save_calls.is_empty());
    }

    #[test]
    fn supports_non_favorite_pickers_empty_results_escape_and_single_open() {
        let store = AppStateStore::new();
        let mut first = ModulePicker::create(PickerOptions {
            modules: vec![ModuleRecord::new("dict", "dictionary", "Dictionary")],
            module_type: "dictionary".into(),
            show_favorites: false,
            ..PickerOptions::default()
        });
        let mut second = ModulePicker::create(PickerOptions {
            modules: vec![ModuleRecord::new("comm", "commentary", "Commentary")],
            module_type: "commentary".into(),
            ..PickerOptions::default()
        });
        first.open_dropdown(&store, 0.0, 0.0, 10.0, 800.0, 600.0);
        assert!(first.open);
        second.open_dropdown(&store, 0.0, 0.0, 10.0, 800.0, 600.0);
        first.close();
        assert!(!first.open);
        assert!(second.open);
        second.set_search(&store, "missing");
        assert_eq!(second.item_count(), 0);
        second.arrow(true);
        second.clear_search(&store);
        second.close();
        assert!(!second.open);
    }
}
