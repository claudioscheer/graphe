//! The shell the binary prints at startup and the launch test asserts.

use graphe_domain::i18n;
use graphe_domain::theme::{UiPalette, DARK, LIGHT};
use graphe_domain::workbench::SIDEBAR_VIEWS;
use graphe_domain::workspace::WorkspaceManager;
use graphe_store::state::load_state;
use serde_json::Value;

#[derive(Debug, Clone, PartialEq)]
pub struct StartupModel {
    pub workspace_count: usize,
    pub active_workspace_id: String,
    pub workspace_name: String,
    pub sidebar_views: [&'static str; 3],
    pub light: &'static UiPalette,
    pub dark: &'static UiPalette,
    pub language: String,
    pub font_size: f64,
    pub theme: Option<String>,
}

pub fn build_startup_model() -> StartupModel {
    i18n::reset_lang();
    let mut workspaces = WorkspaceManager::new();
    workspaces.init(None, None);
    let state = workspaces.get_state().expect("default workspace");
    StartupModel {
        workspace_count: state.items.len(),
        active_workspace_id: state.active_workspace_id,
        workspace_name: state.items[0].name.clone(),
        sidebar_views: SIDEBAR_VIEWS,
        light: &LIGHT,
        dark: &DARK,
        language: "pt".into(),
        font_size: 20.0,
        theme: None,
    }
}

pub fn describe_startup(model: &StartupModel) -> String {
    format!(
        "startup workspaces={} active={} name={} views={},{},{} light_bg={} dark_bg={} language={} font={}",
        model.workspace_count,
        model.active_workspace_id,
        model.workspace_name,
        model.sidebar_views[0],
        model.sidebar_views[1],
        model.sidebar_views[2],
        model.light.ui_bg,
        model.dark.ui_bg,
        model.language,
        model.font_size
    )
}

#[derive(Debug, Clone)]
pub struct RunningModel {
    pub startup: StartupModel,
    pub persisted: Value,
    pub palette_dark: bool,
}

pub fn build_running_model() -> RunningModel {
    let startup = build_startup_model();
    let persisted = load_state();
    let theme = persisted
        .get("settings")
        .and_then(|settings| settings.get("theme"))
        .and_then(|value| value.as_str())
        .map(str::to_string);
    RunningModel {
        palette_dark: theme.as_deref() == Some("dark"),
        startup,
        persisted,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn startup_state_has_one_workspace_three_sidebar_views_and_both_palettes() {
        let model = build_startup_model();
        assert_eq!(model.workspace_count, 1);
        assert_eq!(model.sidebar_views, ["search", "dictionary", "modules"]);
        assert_eq!(model.light.ui_bg, "#fefdf9");
        assert_eq!(model.dark.ui_bg, "#181818");
        assert_eq!(model.light.ui_text, "#362f27");
        assert_eq!(model.dark.ui_text, "#e7e7e7");
        assert_eq!(model.light.ui_surface, "#ffffff");
        assert_eq!(model.dark.ui_surface, "#1f1f1f");
        assert_eq!(model.light.ui_border, "#d3ceb9");
        assert_eq!(model.dark.ui_border, "#333333");
        assert_eq!(model.light.ui_link, "#65543f");
        assert_eq!(model.dark.ui_link, "#d6a85f");
        let described = describe_startup(&model);
        assert!(described.contains("workspaces=1"));
        assert!(described.contains("search,dictionary,modules"));
        let running = build_running_model();
        assert_eq!(running.startup.workspace_count, 1);
        assert_eq!(running.startup.light.ui_bg, model.light.ui_bg);
        assert_eq!(running.startup.dark.ui_bg, model.dark.ui_bg);
    }
}
