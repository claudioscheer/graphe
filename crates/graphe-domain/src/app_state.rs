use serde_json::{json, Map, Value};

#[derive(Debug, Clone, PartialEq)]
pub struct AppStateStore {
    pub state: Value,
    pending_ms: Option<u64>,
    pub save_calls: Vec<Value>,
    pub save_errors: Vec<String>,
    fail_save: bool,
}

impl Default for AppStateStore {
    fn default() -> Self {
        Self::new()
    }
}

impl AppStateStore {
    pub fn new() -> Self {
        Self {
            state: default_state(),
            pending_ms: None,
            save_calls: Vec::new(),
            save_errors: Vec::new(),
            fail_save: false,
        }
    }

    pub fn fail_next_saves(&mut self) {
        self.fail_save = true;
    }

    pub fn init(&mut self, loaded: Option<&Value>) {
        let Some(loaded) = loaded.filter(|value| value.is_object()) else {
            return;
        };
        let mut next = self.state.as_object().cloned().unwrap_or_default();
        if let Some(obj) = loaded.as_object() {
            for (key, value) in obj {
                next.insert(key.clone(), value.clone());
            }
        }
        let mut settings = default_settings();
        if let Some(existing) = self.state.get("settings").and_then(|v| v.as_object()) {
            for (k, v) in existing {
                settings.insert(k.clone(), v.clone());
            }
        }
        if let Some(incoming) = loaded.get("settings").and_then(|v| v.as_object()) {
            for (k, v) in incoming {
                settings.insert(k.clone(), v.clone());
            }
        }
        next.insert("settings".into(), Value::Object(settings));
        next.insert(
            "workbench".into(),
            Value::Object(normalize_workbench(
                loaded.get("workbench"),
                loaded.get("searchPanel"),
            )),
        );
        match normalize_workspaces(loaded.get("workspaces")) {
            Some(value) => next.insert("workspaces".into(), value),
            None => next.insert("workspaces".into(), Value::Null),
        };
        next.insert(
            "searchPanel".into(),
            loaded
                .get("searchPanel")
                .cloned()
                .filter(|v| !v.is_null())
                .unwrap_or(Value::Null),
        );
        next.insert(
            "dictPanel".into(),
            loaded
                .get("dictPanel")
                .cloned()
                .filter(|v| !v.is_null())
                .unwrap_or(Value::Null),
        );
        self.state = Value::Object(next);
    }

    pub fn set_settings(&mut self, patch: Value) {
        let mut settings = self
            .state
            .get("settings")
            .and_then(|v| v.as_object())
            .cloned()
            .unwrap_or_else(default_settings);
        if let Some(obj) = patch.as_object() {
            for (k, v) in obj {
                settings.insert(k.clone(), v.clone());
            }
        }
        self.state
            .as_object_mut()
            .unwrap()
            .insert("settings".into(), Value::Object(settings));
        self.schedule_save();
    }

    pub fn set_pane_manager(&mut self, next: Value) {
        self.state
            .as_object_mut()
            .unwrap()
            .insert("paneManager".into(), next);
        self.schedule_save();
    }

    pub fn set_workspaces(&mut self, next: Option<&Value>) {
        let normalized = normalize_workspaces(next).unwrap_or(Value::Null);
        self.state
            .as_object_mut()
            .unwrap()
            .insert("workspaces".into(), normalized);
        self.schedule_save();
    }

    pub fn set_workbench(&mut self, patch: Value) {
        let mut current = self
            .state
            .get("workbench")
            .and_then(|v| v.as_object())
            .cloned()
            .unwrap_or_else(|| {
                let mut map = Map::new();
                map.insert("version".into(), json!(1));
                map
            });
        if let Some(obj) = patch.as_object() {
            for (k, v) in obj {
                current.insert(k.clone(), v.clone());
            }
        }
        current.insert("version".into(), json!(1));
        self.state
            .as_object_mut()
            .unwrap()
            .insert("workbench".into(), Value::Object(current));
        self.schedule_save();
    }

    pub fn set_search_panel(&mut self, next: Value) {
        self.state
            .as_object_mut()
            .unwrap()
            .insert("searchPanel".into(), next);
        self.schedule_save();
    }

    pub fn set_dict_panel(&mut self, next: Value) {
        self.state
            .as_object_mut()
            .unwrap()
            .insert("dictPanel".into(), next);
        self.schedule_save();
    }

    pub fn settings(&self) -> &Value {
        self.state.get("settings").unwrap_or(&Value::Null)
    }

    pub fn workbench(&self) -> &Value {
        self.state.get("workbench").unwrap_or(&Value::Null)
    }

    pub fn workspaces(&self) -> &Value {
        self.state.get("workspaces").unwrap_or(&Value::Null)
    }

    pub fn search_panel(&self) -> &Value {
        self.state.get("searchPanel").unwrap_or(&Value::Null)
    }

    pub fn dict_panel(&self) -> &Value {
        self.state.get("dictPanel").unwrap_or(&Value::Null)
    }

    pub fn pane_manager(&self) -> &Value {
        self.state.get("paneManager").unwrap_or(&Value::Null)
    }

    fn schedule_save(&mut self) {
        self.pending_ms = Some(200);
    }

    pub fn advance(&mut self, ms: u64) {
        if let Some(pending) = self.pending_ms.as_mut() {
            if ms < *pending {
                *pending -= ms;
                return;
            }
        } else {
            return;
        }
        self.pending_ms = None;
        self.flush();
    }

    fn flush(&mut self) {
        if self.fail_save {
            self.save_errors
                .push("Failed to save app state: disk".into());
            return;
        }
        self.save_calls.push(self.state.clone());
    }
}

fn default_settings() -> Map<String, Value> {
    let mut settings = Map::new();
    settings.insert("theme".into(), Value::Null);
    settings.insert("language".into(), json!("pt"));
    settings.insert("fontSize".into(), json!(20));
    settings.insert("strongsDicts".into(), Value::Null);
    settings.insert("crossRefModules".into(), Value::Null);
    settings.insert("openPinnedRefsInModal".into(), json!(false));
    settings.insert("favoriteModules".into(), json!({}));
    settings
}

fn default_state() -> Value {
    json!({
        "settings": default_settings(),
        "paneManager": null,
        "workspaces": null,
        "workbench": null,
        "searchPanel": null,
        "dictPanel": null
    })
}

fn normalize_workbench(
    workbench: Option<&Value>,
    legacy_search: Option<&Value>,
) -> Map<String, Value> {
    let source = workbench.and_then(|v| v.as_object());
    let active = source
        .and_then(|s| s.get("activeView"))
        .and_then(|v| v.as_str())
        .filter(|v| !v.is_empty())
        .unwrap_or("search");
    let collapsed = source
        .and_then(|s| s.get("collapsed"))
        .and_then(|v| v.as_bool())
        == Some(true);
    let width = source
        .and_then(|s| s.get("widthRatio"))
        .and_then(|v| v.as_f64())
        .filter(|v| v.is_finite())
        .or_else(|| {
            legacy_search
                .and_then(|v| v.get("widthRatio"))
                .and_then(|v| v.as_f64())
                .filter(|v| v.is_finite())
        });
    let mut map = Map::new();
    map.insert("version".into(), json!(1));
    map.insert("activeView".into(), json!(active));
    map.insert("collapsed".into(), json!(collapsed));
    map.insert(
        "widthRatio".into(),
        width
            .map(|value| json!(value.clamp(0.12, 0.6)))
            .unwrap_or(Value::Null),
    );
    map
}

fn normalize_workspaces(workspaces: Option<&Value>) -> Option<Value> {
    let Some(workspaces) = workspaces.filter(|v| v.is_object()) else {
        return None;
    };
    let raw = workspaces
        .get("items")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let items: Vec<Value> = raw
        .into_iter()
        .filter(|item| item.get("id").and_then(|v| v.as_str()).is_some())
        .enumerate()
        .map(|(index, item)| {
            let name = item
                .get("name")
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|name| !name.is_empty())
                .map(|name| name.to_string())
                .unwrap_or_else(|| format!("Workspace {}", index + 1));
            let pane = item
                .get("paneManager")
                .cloned()
                .filter(|v| v.is_object())
                .unwrap_or(Value::Null);
            json!({
                "id": item.get("id").and_then(|v| v.as_str()).unwrap_or(""),
                "name": name,
                "paneManager": pane
            })
        })
        .collect();
    if items.is_empty() {
        return None;
    }
    let active = workspaces.get("activeWorkspaceId").and_then(|v| v.as_str());
    let active = if items
        .iter()
        .any(|item| item.get("id").and_then(|v| v.as_str()) == active)
    {
        active.unwrap()
    } else {
        items[0].get("id").and_then(|v| v.as_str()).unwrap_or("")
    };
    Some(json!({
        "version": 1,
        "activeWorkspaceId": active,
        "items": items
    }))
}

#[cfg(test)]
mod app_state_store_tests {
    use super::*;

    #[test]
    fn normalizes_loaded_state_and_debounces_persistence() {
        let mut store = AppStateStore::new();
        store.init(Some(&json!({
            "settings": {"language": "en", "fontSize": 18},
            "workbench": {"version": 1, "activeView": "", "collapsed": true, "widthRatio": 0.9},
            "searchPanel": {"moduleId": "kjv", "query": "faith", "widthRatio": 0.2},
            "workspaces": {
                "activeWorkspaceId": "missing",
                "items": [
                    {"id": "a", "name": "  First  ", "paneManager": {"activePaneId": "pane-1"}},
                    {"id": "b", "name": "", "paneManager": null}
                ]
            },
            "dictPanel": {"selectedModuleId": "strong", "moduleSearchCache": {"strong": "G3056"}}
        })));
        assert_eq!(store.settings()["language"], "en");
        assert_eq!(store.settings()["fontSize"], 18);
        assert_eq!(store.workbench()["version"], 1);
        assert_eq!(store.workbench()["activeView"], "search");
        assert_eq!(store.workbench()["collapsed"], true);
        assert_eq!(store.workbench()["widthRatio"], 0.6);
        assert_eq!(store.workspaces()["activeWorkspaceId"], "a");
        assert_eq!(store.workspaces()["items"][0]["name"], "First");
        assert_eq!(store.workspaces()["items"][1]["name"], "Workspace 2");
        assert!(store.workspaces()["items"][1]["paneManager"].is_null());
        assert_eq!(store.search_panel()["moduleId"], "kjv");
        assert_eq!(store.search_panel()["query"], "faith");
        assert_eq!(store.dict_panel()["selectedModuleId"], "strong");
        assert_eq!(store.dict_panel()["moduleSearchCache"]["strong"], "G3056");

        store.set_settings(json!({"theme": "dark"}));
        store.set_pane_manager(json!({"activePaneId": "pane-2"}));
        store.set_workbench(json!({"widthRatio": 0.3}));
        store.set_search_panel(json!({"moduleId": "kjv", "query": "hope"}));
        store.set_dict_panel(json!({"selectedModuleId": null, "moduleSearchCache": {}}));
        store.advance(199);
        assert!(store.save_calls.is_empty());
        store.advance(1);
        assert_eq!(store.save_calls.len(), 1);
        assert_eq!(store.pane_manager()["activePaneId"], "pane-2");
        assert_eq!(store.workbench()["widthRatio"], 0.3);
        assert_eq!(store.search_panel()["query"], "hope");
        assert!(store.dict_panel()["selectedModuleId"].is_null());
    }

    #[test]
    fn handles_empty_init_invalid_workspaces_and_save_failures() {
        let mut store = AppStateStore::new();
        store.init(None);
        assert!(store.workspaces().is_null());
        store.set_workspaces(Some(&json!({"items": []})));
        assert!(store.workspaces().is_null());
        store.fail_next_saves();
        store.set_settings(json!({"language": "pt"}));
        store.advance(200);
        assert_eq!(
            store.save_errors,
            vec!["Failed to save app state: disk".to_string()]
        );
        assert!(store.save_calls.is_empty());
    }
}
