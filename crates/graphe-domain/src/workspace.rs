use crate::i18n;
use serde_json::{Map, Value};

#[derive(Debug, Clone, PartialEq)]
pub struct WorkspaceItem {
    pub id: String,
    pub name: String,
    pub pane_manager: Option<Value>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct WorkspaceState {
    pub version: i64,
    pub active_workspace_id: String,
    pub items: Vec<WorkspaceItem>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkspaceTabState {
    pub active_workspace_id: Option<String>,
    pub items: Vec<(String, String)>,
}

#[derive(Debug, Clone)]
pub struct WorkspaceLocation {
    pub module_id: Option<String>,
    pub book_number: Option<i64>,
    pub chapter: Option<i64>,
    pub verse: Option<i64>,
}

pub struct WorkspaceManager {
    state: Option<WorkspaceState>,
    id_counter: i64,
    pub state_changes: usize,
    pub active_changes: Vec<Option<Value>>,
}

impl Default for WorkspaceManager {
    fn default() -> Self {
        Self::new()
    }
}

impl WorkspaceManager {
    pub fn new() -> Self {
        Self {
            state: None,
            id_counter: 1,
            state_changes: 0,
            active_changes: Vec::new(),
        }
    }

    pub fn init(&mut self, saved: Option<&Value>, legacy: Option<Value>) {
        self.state = Some(self.normalize(saved, legacy));
        self.id_counter = self
            .state
            .as_ref()
            .map(|state| max_workspace_number(&state.items))
            .unwrap_or(1);
        self.state_changes += 1;
    }

    fn normalize(&self, saved: Option<&Value>, legacy: Option<Value>) -> WorkspaceState {
        if let Some(saved) = saved {
            if let Some(items) = saved.get("items").and_then(|v| v.as_array()) {
                let parsed: Vec<WorkspaceItem> = items
                    .iter()
                    .filter(|item| item.get("id").and_then(|v| v.as_str()).is_some())
                    .enumerate()
                    .map(|(index, item)| {
                        let id = item
                            .get("id")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string();
                        let name = item.get("name").and_then(|v| v.as_str());
                        let pane = item
                            .get("paneManager")
                            .cloned()
                            .filter(|v| v.is_object())
                            .or_else(|| {
                                item.get("paneManagerState")
                                    .cloned()
                                    .filter(|v| v.is_object())
                            });
                        WorkspaceItem {
                            id,
                            name: normalize_name(name, index + 1),
                            pane_manager: pane,
                        }
                    })
                    .collect();
                if !parsed.is_empty() {
                    let requested = saved.get("activeWorkspaceId").and_then(|v| v.as_str());
                    let active = if parsed
                        .iter()
                        .any(|item| Some(item.id.as_str()) == requested)
                    {
                        requested.unwrap().to_string()
                    } else {
                        parsed[0].id.clone()
                    };
                    return WorkspaceState {
                        version: 1,
                        active_workspace_id: active,
                        items: parsed,
                    };
                }
            }
        }
        WorkspaceState {
            version: 1,
            active_workspace_id: "workspace-1".into(),
            items: vec![WorkspaceItem {
                id: "workspace-1".into(),
                name: default_workspace_name(1),
                pane_manager: legacy.filter(|v| v.is_object()),
            }],
        }
    }

    pub fn get_state(&self) -> Option<WorkspaceState> {
        self.state.clone()
    }

    pub fn get_tab_state(&self) -> WorkspaceTabState {
        let Some(state) = &self.state else {
            return WorkspaceTabState {
                active_workspace_id: None,
                items: Vec::new(),
            };
        };
        WorkspaceTabState {
            active_workspace_id: Some(state.active_workspace_id.clone()),
            items: state
                .items
                .iter()
                .map(|item| (item.id.clone(), item.name.clone()))
                .collect(),
        }
    }

    pub fn get_active_pane_state(&self) -> Option<Value> {
        self.active_item()
            .and_then(|item| item.pane_manager.clone())
    }

    fn active_item(&self) -> Option<&WorkspaceItem> {
        let state = self.state.as_ref()?;
        state
            .items
            .iter()
            .find(|item| item.id == state.active_workspace_id)
            .or(state.items.first())
    }

    fn active_item_mut(&mut self) -> Option<&mut WorkspaceItem> {
        let active = self.state.as_ref()?.active_workspace_id.clone();
        let state = self.state.as_mut()?;
        if let Some(pos) = state.items.iter().position(|item| item.id == active) {
            return Some(&mut state.items[pos]);
        }
        state.items.first_mut()
    }

    pub fn update_active_pane_state(&mut self, pane: Option<Value>) {
        if let Some(active) = self.active_item_mut() {
            active.pane_manager = pane;
            self.state_changes += 1;
        }
    }

    pub fn activate_workspace(
        &mut self,
        workspace_id: &str,
        current: Option<Value>,
    ) -> Option<WorkspaceItem> {
        let state = self.state.as_ref()?;
        if workspace_id == state.active_workspace_id {
            return None;
        }
        if !state.items.iter().any(|item| item.id == workspace_id) {
            return None;
        }
        if current.is_some() {
            if let Some(active) = self.active_item_mut() {
                active.pane_manager = current;
            }
        }
        if let Some(state) = self.state.as_mut() {
            state.active_workspace_id = workspace_id.to_string();
        }
        self.state_changes += 1;
        let next = self
            .state
            .as_ref()
            .and_then(|state| state.items.iter().find(|item| item.id == workspace_id))
            .cloned();
        self.active_changes
            .push(next.as_ref().and_then(|item| item.pane_manager.clone()));
        next
    }

    pub fn create_workspace(
        &mut self,
        name: Option<&str>,
        location: Option<WorkspaceLocation>,
    ) -> Option<WorkspaceItem> {
        if self.state.is_none() {
            return None;
        }
        self.id_counter += 1;
        let id = format!("workspace-{}", self.id_counter);
        let len = self.state.as_ref().map(|s| s.items.len()).unwrap_or(0);
        let item = WorkspaceItem {
            id,
            name: name
                .map(str::trim)
                .filter(|name| !name.is_empty())
                .map(|name| name.to_string())
                .unwrap_or_else(|| default_workspace_name(len + 1)),
            pane_manager: Some(single_bible_pane(location.as_ref())),
        };
        if let Some(state) = self.state.as_mut() {
            state.items.push(item.clone());
            state.active_workspace_id = item.id.clone();
        }
        self.state_changes += 1;
        self.active_changes.push(item.pane_manager.clone());
        Some(item)
    }

    pub fn rename_workspace(&mut self, workspace_id: &str, next_name: &str) -> bool {
        let name = next_name.trim();
        if name.is_empty() {
            return false;
        }
        let Some(state) = self.state.as_mut() else {
            return false;
        };
        let Some(item) = state.items.iter_mut().find(|item| item.id == workspace_id) else {
            return false;
        };
        item.name = name.to_string();
        self.state_changes += 1;
        true
    }

    pub fn close_workspace(&mut self, workspace_id: &str, current: Option<Value>) -> bool {
        let Some(state) = self.state.as_ref() else {
            return false;
        };
        if state.items.len() <= 1 {
            return false;
        }
        let Some(index) = state.items.iter().position(|item| item.id == workspace_id) else {
            return false;
        };
        if current.is_some() {
            if let Some(active) = self.active_item_mut() {
                active.pane_manager = current;
            }
        }
        let was_active = self
            .state
            .as_ref()
            .is_some_and(|state| state.active_workspace_id == workspace_id);
        let mut next_pane = None;
        if let Some(state) = self.state.as_mut() {
            state.items.remove(index);
            if was_active {
                let next_index = index
                    .saturating_sub(1)
                    .min(state.items.len().saturating_sub(1));
                let next = &state.items[next_index];
                state.active_workspace_id = next.id.clone();
                next_pane = next.pane_manager.clone();
            }
        }
        self.state_changes += 1;
        if was_active {
            self.active_changes.push(next_pane);
        }
        true
    }

    pub fn get_workspace_name(&self, workspace_id: &str) -> String {
        self.state
            .as_ref()
            .and_then(|state| state.items.iter().find(|item| item.id == workspace_id))
            .map(|item| item.name.clone())
            .unwrap_or_default()
    }
}

fn max_workspace_number(items: &[WorkspaceItem]) -> i64 {
    let mut max = 0i64;
    for item in items {
        if let Some(rest) = item.id.strip_prefix("workspace-") {
            if let Ok(n) = rest.parse::<i64>() {
                max = max.max(n);
            }
        }
    }
    max.max(1)
}

fn default_workspace_name(index: usize) -> String {
    let translated = i18n::t("workspaceDefaultName");
    if !translated.is_empty() && translated != "workspaceDefaultName" {
        translated.replace("{number}", &index.to_string())
    } else {
        format!("Workspace {index}")
    }
}

fn normalize_name(name: Option<&str>, fallback_index: usize) -> String {
    if let Some(name) = name.map(str::trim).filter(|name| !name.is_empty()) {
        name.to_string()
    } else {
        default_workspace_name(fallback_index)
    }
}

fn single_bible_pane(location: Option<&WorkspaceLocation>) -> Value {
    let book = location.and_then(|loc| loc.book_number).unwrap_or(10);
    let chapter = location.and_then(|loc| loc.chapter).unwrap_or(1);
    let verse = location.and_then(|loc| loc.verse);
    let module_id = location.and_then(|loc| loc.module_id.clone());
    let mut pane = Map::new();
    pane.insert("paneType".into(), Value::String("bible".into()));
    pane.insert("windowLabel".into(), Value::String("A".into()));
    pane.insert(
        "moduleId".into(),
        module_id.map(Value::String).unwrap_or(Value::Null),
    );
    pane.insert("bookNumber".into(), json_i64(book));
    pane.insert("chapter".into(), json_i64(chapter));
    pane.insert("bookShortName".into(), Value::String(String::new()));
    pane.insert(
        "selectedVerse".into(),
        verse.map(json_i64).unwrap_or(Value::Null),
    );
    pane.insert("navHistory".into(), Value::Array(Vec::new()));
    pane.insert("navHistoryIdx".into(), json_i64(-1));
    let mut panes = Map::new();
    panes.insert("pane-1".into(), Value::Object(pane));
    let mut root = Map::new();
    root.insert("activePaneId".into(), Value::String("pane-1".into()));
    root.insert("linkTargetPaneId".into(), Value::Null);
    root.insert(
        "tree".into(),
        serde_json::json!({"type": "leaf", "paneId": "pane-1"}),
    );
    root.insert("panes".into(), Value::Object(panes));
    Value::Object(root)
}

fn json_i64(value: i64) -> Value {
    Value::Number(value.into())
}

#[cfg(test)]
mod workspace_tests {
    use super::*;
    use crate::i18n;
    use serde_json::json;

    fn legacy() -> Value {
        json!({"activePaneId": "pane-legacy", "panes": {"pane-legacy": {"paneType": "bible"}}})
    }

    #[test]
    fn starts_empty_before_init_and_creates_a_default_workspace_from_legacy_pane_state() {
        i18n::reset_lang();
        let mut manager = WorkspaceManager::new();
        assert!(manager.get_state().is_none());
        assert_eq!(
            manager.get_tab_state(),
            WorkspaceTabState {
                active_workspace_id: None,
                items: Vec::new()
            }
        );
        assert!(manager.get_active_pane_state().is_none());
        manager.init(None, Some(legacy()));
        let state = manager.get_state().unwrap();
        assert_eq!(state.version, 1);
        assert_eq!(state.active_workspace_id, "workspace-1");
        assert_eq!(state.items[0].id, "workspace-1");
        assert_eq!(state.items[0].name, "Estudo 1");
        assert_eq!(state.items[0].pane_manager, Some(legacy()));
        assert_eq!(manager.state_changes, 1);
    }

    #[test]
    fn normalizes_saved_workspaces_activates_renames_creates_and_closes_them() {
        i18n::reset_lang();
        let mut manager = WorkspaceManager::new();
        let saved = json!({
            "activeWorkspaceId": "missing",
            "items": [
                {"id": "workspace-2", "name": "  Existing  ", "paneManager": {"activePaneId": "pane-2"}},
                {"id": "custom", "name": "", "paneManagerState": {"activePaneId": "pane-custom"}},
                null,
                {"id": 7, "name": "bad"}
            ]
        });
        manager.init(Some(&saved), None);
        let state = manager.get_state().unwrap();
        assert_eq!(state.active_workspace_id, "workspace-2");
        assert_eq!(state.items[0].name, "Existing");
        assert_eq!(state.items[1].name, "Estudo 2");
        assert_eq!(
            state.items[1].pane_manager,
            Some(json!({"activePaneId": "pane-custom"}))
        );
        assert!(manager
            .activate_workspace("workspace-2", Some(json!({"activePaneId": "unchanged"})))
            .is_none());
        assert!(manager.activate_workspace("missing", None).is_none());
        let activated = manager
            .activate_workspace("custom", Some(json!({"activePaneId": "saved-current"})))
            .unwrap();
        assert_eq!(activated.id, "custom");
        assert_eq!(
            activated.pane_manager,
            Some(json!({"activePaneId": "pane-custom"}))
        );
        assert_eq!(
            manager.active_changes.last().cloned().flatten(),
            Some(json!({"activePaneId": "pane-custom"}))
        );
        assert_eq!(
            manager.get_state().unwrap().items[0].pane_manager,
            Some(json!({"activePaneId": "saved-current"}))
        );
        assert!(manager.rename_workspace("custom", "  Renamed  "));
        assert!(!manager.rename_workspace("custom", "   "));
        assert!(!manager.rename_workspace("missing", "Name"));
        assert_eq!(manager.get_workspace_name("custom"), "Renamed");
        assert_eq!(manager.get_workspace_name("missing"), "");
        let created = manager
            .create_workspace(
                Some("  New Study  "),
                Some(WorkspaceLocation {
                    module_id: Some("kjv".into()),
                    book_number: Some(470),
                    chapter: Some(5),
                    verse: Some(3),
                }),
            )
            .unwrap();
        assert_eq!(created.id, "workspace-3");
        assert_eq!(created.name, "New Study");
        let pane = created.pane_manager.unwrap();
        assert_eq!(pane["activePaneId"], "pane-1");
        assert_eq!(pane["panes"]["pane-1"]["moduleId"], "kjv");
        assert_eq!(pane["panes"]["pane-1"]["bookNumber"], 470);
        assert_eq!(pane["panes"]["pane-1"]["chapter"], 5);
        assert_eq!(pane["panes"]["pane-1"]["selectedVerse"], 3);
        manager.update_active_pane_state(Some(json!({"activePaneId": "updated"})));
        assert_eq!(
            manager.get_active_pane_state(),
            Some(json!({"activePaneId": "updated"}))
        );
        assert!(!manager.close_workspace("missing", None));
        assert!(manager.close_workspace("workspace-2", None));
        assert!(manager.close_workspace(
            "workspace-3",
            Some(json!({"activePaneId": "closing-current"}))
        ));
        assert_eq!(
            manager.active_changes.last().cloned().flatten(),
            Some(json!({"activePaneId": "pane-custom"}))
        );
        assert!(!manager.close_workspace("custom", None));
    }

    #[test]
    fn uses_default_names_and_default_bible_location_when_creating_unnamed_workspaces() {
        i18n::reset_lang();
        let mut manager = WorkspaceManager::new();
        manager.init(
            Some(&json!({"activeWorkspaceId": "workspace-1", "items": []})),
            None,
        );
        let created = manager.create_workspace(None, None).unwrap();
        assert_eq!(created.name, "Estudo 2");
        let pane = &created.pane_manager.unwrap()["panes"]["pane-1"];
        assert!(pane["moduleId"].is_null());
        assert_eq!(pane["bookNumber"], 10);
        assert_eq!(pane["chapter"], 1);
        assert!(pane["selectedVerse"].is_null());
    }
}
