use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};

pub fn graphe_dir(home: &Path) -> PathBuf {
    home.join(".graphe")
}

pub fn state_file(home: &Path) -> PathBuf {
    graphe_dir(home).join("state.json")
}

pub fn modules_dir(home: &Path) -> PathBuf {
    graphe_dir(home).join("modules")
}

pub fn default_state() -> Value {
    json!({
        "settings": {
            "theme": null,
            "language": "pt",
            "fontSize": 20,
            "strongsDicts": null,
            "favoriteModules": {}
        },
        "paneManager": null,
        "searchPanel": null,
        "dictPanel": null
    })
}

fn merge_state(next: Option<&Value>) -> Value {
    let mut state = default_state();
    let Some(next) = next else {
        return state;
    };
    if let (Some(base), Some(incoming)) = (state.as_object_mut(), next.as_object()) {
        for (key, value) in incoming {
            if key != "settings" {
                base.insert(key.clone(), value.clone());
            }
        }
    }
    let mut settings = default_state()["settings"]
        .as_object()
        .cloned()
        .unwrap_or_default();
    if let Some(incoming) = next.get("settings").and_then(|v| v.as_object()) {
        for (key, value) in incoming {
            settings.insert(key.clone(), value.clone());
        }
    }
    if let Some(base) = state.as_object_mut() {
        base.insert("settings".into(), Value::Object(settings));
    }
    state
}

pub fn load_state_in(home: &Path) -> Value {
    let _ = fs::create_dir_all(graphe_dir(home));
    let path = state_file(home);
    if !path.exists() {
        return default_state();
    }
    match fs::read_to_string(&path) {
        Ok(raw) => match serde_json::from_str::<Value>(&raw) {
            Ok(value) if value.is_object() => merge_state(Some(&value)),
            _ => {
                eprintln!("Failed to load app state: invalid JSON");
                default_state()
            }
        },
        Err(err) => {
            eprintln!("Failed to load app state: {err}");
            default_state()
        }
    }
}

pub fn save_state_in(home: &Path, next: &Value) -> std::io::Result<Value> {
    let _ = fs::create_dir_all(graphe_dir(home));
    let state = merge_state(Some(next));
    fs::write(
        state_file(home),
        serde_json::to_string_pretty(&state).unwrap_or_else(|_| "{}".into()),
    )?;
    Ok(state)
}

pub fn user_home() -> PathBuf {
    dirs::home_dir().unwrap_or_else(|| PathBuf::from("."))
}

pub fn load_state() -> Value {
    load_state_in(&user_home())
}

pub fn save_state(next: &Value) -> std::io::Result<Value> {
    save_state_in(&user_home(), next)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn returns_default_state_when_no_state_file_exists() {
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path();
        assert_eq!(state_file(home), home.join(".graphe/state.json"));
        let loaded = load_state_in(home);
        assert!(loaded["settings"]["theme"].is_null());
        assert_eq!(loaded["settings"]["language"], "pt");
        assert_eq!(loaded["settings"]["fontSize"], 20);
        assert!(loaded["settings"]["strongsDicts"].is_null());
        assert!(loaded["settings"]["favoriteModules"]
            .as_object()
            .unwrap()
            .is_empty());
        assert!(loaded["paneManager"].is_null());
        assert!(loaded["searchPanel"].is_null());
        assert!(loaded["dictPanel"].is_null());
        assert!(home.join(".graphe").is_dir());
    }

    #[test]
    fn merges_loaded_and_saved_state_including_renderer_fields() {
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path();
        fs::create_dir_all(graphe_dir(home)).unwrap();
        fs::write(
            state_file(home),
            serde_json::to_string(&json!({
                "settings": {"language": "en", "fontSize": 18},
                "paneManager": {"activePaneId": "pane-1"},
                "workspaces": {"activeWorkspaceId": "workspace-1"},
                "workbench": {"activeView": "dictionary"}
            }))
            .unwrap(),
        )
        .unwrap();
        let loaded = load_state_in(home);
        assert_eq!(loaded["settings"]["language"], "en");
        assert_eq!(loaded["settings"]["fontSize"], 18);
        assert!(loaded["settings"]["theme"].is_null());
        assert_eq!(loaded["paneManager"]["activePaneId"], "pane-1");
        assert_eq!(loaded["workspaces"]["activeWorkspaceId"], "workspace-1");
        let saved = save_state_in(
            home,
            &json!({
                "settings": {"language": "es"},
                "dictPanel": {"selectedModuleId": "strong", "moduleSearchCache": {}}
            }),
        )
        .unwrap();
        assert_eq!(saved["settings"]["language"], "es");
        assert_eq!(saved["settings"]["fontSize"], 20);
        assert_eq!(saved["dictPanel"]["selectedModuleId"], "strong");
        let raw = fs::read_to_string(state_file(home)).unwrap();
        assert!(raw.contains("\"language\": \"es\""));
        assert!(raw.contains("\"selectedModuleId\": \"strong\""));
    }

    #[test]
    fn falls_back_to_defaults_for_invalid_json() {
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path();
        fs::create_dir_all(graphe_dir(home)).unwrap();
        fs::write(state_file(home), "{broken").unwrap();
        assert_eq!(load_state_in(home)["settings"]["language"], "pt");
    }
}
