use crate::i18n;
use crate::model::ModuleRecord;
use crate::picker::display_name;

pub const SIDEBAR_VIEWS: [&str; 3] = ["search", "dictionary", "modules"];

#[derive(Debug, Clone, PartialEq)]
pub struct WorkbenchState {
    pub version: i64,
    pub active_view: String,
    pub collapsed: bool,
    pub width_ratio: f64,
    pub sidebar_width: i64,
}

#[derive(Debug, Clone)]
pub struct WorkbenchHandlers {
    pub navigation: usize,
    pub about: usize,
    pub settings: usize,
    pub convert: usize,
    pub editor: Vec<String>,
    pub install: usize,
    pub tab_activate: Vec<String>,
    pub tab_create: usize,
    pub tab_rename: Vec<(String, String)>,
    pub tab_close: Vec<String>,
}

impl Default for WorkbenchHandlers {
    fn default() -> Self {
        Self {
            navigation: 0,
            about: 0,
            settings: 0,
            convert: 0,
            editor: Vec::new(),
            install: 0,
            tab_activate: Vec::new(),
            tab_create: 0,
            tab_rename: Vec::new(),
            tab_close: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkspaceTab {
    pub id: String,
    pub name: String,
    pub renaming: bool,
    pub draft: String,
}

pub struct WorkbenchShell {
    pub ready: bool,
    pub state: WorkbenchState,
    pub modules: Vec<ModuleRecord>,
    pub empty_message: Option<String>,
    pub tabs: Vec<WorkspaceTab>,
    pub active_tab: Option<String>,
    pub title: String,
    pub command_label: String,
    pub state_changes: usize,
    pub handlers: WorkbenchHandlers,
    pub viewport_width: f64,
    drag_origin: Option<(f64, f64)>,
}

impl WorkbenchShell {
    pub fn init(
        host_present: bool,
        saved_view: Option<&str>,
        collapsed: bool,
        width_ratio: Option<f64>,
        modules: Vec<ModuleRecord>,
        viewport_width: f64,
    ) -> Self {
        if !host_present {
            return Self::empty(viewport_width);
        }
        let active = normalize_view(saved_view.unwrap_or("search"));
        let ratio = resolve_ratio(width_ratio, viewport_width);
        let width = clamp_width((viewport_width * ratio).round(), viewport_width);
        let mut shell = Self {
            ready: true,
            state: WorkbenchState {
                version: 1,
                active_view: active.clone(),
                collapsed,
                width_ratio: ratio,
                sidebar_width: width,
            },
            modules,
            empty_message: None,
            tabs: Vec::new(),
            active_tab: None,
            title: view_label(&active),
            command_label: i18n::t("navPlaceholder"),
            state_changes: 0,
            handlers: WorkbenchHandlers::default(),
            viewport_width,
            drag_origin: None,
        };
        shell.refresh_modules_message();
        shell
    }

    fn empty(viewport_width: f64) -> Self {
        Self {
            ready: false,
            state: WorkbenchState {
                version: 1,
                active_view: "search".into(),
                collapsed: false,
                width_ratio: 0.3,
                sidebar_width: 0,
            },
            modules: Vec::new(),
            empty_message: None,
            tabs: Vec::new(),
            active_tab: None,
            title: String::new(),
            command_label: String::new(),
            state_changes: 0,
            handlers: WorkbenchHandlers::default(),
            viewport_width,
            drag_origin: None,
        }
    }

    pub fn view_active(&self, view: &str) -> bool {
        self.ready && normalize_view(view) == self.state.active_view
    }

    pub fn click_navigation(&mut self) {
        self.handlers.navigation += 1;
    }
    pub fn click_about(&mut self) {
        self.handlers.about += 1;
    }
    pub fn click_settings(&mut self) {
        self.handlers.settings += 1;
    }
    pub fn click_install(&mut self) {
        self.handlers.install += 1;
    }
    pub fn click_convert(&mut self) {
        self.handlers.convert += 1;
    }
    pub fn click_module(&mut self, id: &str) {
        self.handlers.editor.push(id.to_string());
    }

    pub fn activate_view(&mut self, view: &str) {
        if !self.ready {
            return;
        }
        self.state.active_view = normalize_view(view);
        self.state.collapsed = false;
        self.title = view_label(&self.state.active_view);
        self.state_changes += 1;
    }

    pub fn toggle_sidebar(&mut self) {
        if !self.ready {
            return;
        }
        self.state.collapsed = !self.state.collapsed;
    }

    pub fn activate_sidebar(&mut self, view: &str) {
        if !self.ready {
            return;
        }
        self.state.active_view = normalize_view(view);
        self.state.collapsed = false;
        self.title = view_label(&self.state.active_view);
        self.state_changes += 1;
    }

    pub fn set_modules(&mut self, modules: Vec<ModuleRecord>) {
        self.modules = modules;
        self.refresh_modules_message();
    }

    fn refresh_modules_message(&mut self) {
        self.empty_message = if self.modules.is_empty() {
            Some(i18n::t("noModules"))
        } else {
            None
        };
    }

    pub fn module_counts(&self) -> usize {
        self.modules.len()
    }

    pub fn set_workspace_tabs(&mut self, active: Option<&str>, items: Vec<(String, String)>) {
        self.active_tab = active.map(|s| s.to_string());
        self.tabs = items
            .into_iter()
            .map(|(id, name)| WorkspaceTab {
                id,
                name,
                renaming: false,
                draft: String::new(),
            })
            .collect();
    }

    pub fn activate_tab(&mut self, id: &str) {
        self.handlers.tab_activate.push(id.to_string());
    }
    pub fn create_tab(&mut self) {
        self.handlers.tab_create += 1;
    }
    pub fn close_tab(&mut self, id: &str) {
        self.handlers.tab_close.push(id.to_string());
    }
    pub fn begin_rename(&mut self, id: &str) {
        if let Some(tab) = self.tabs.iter_mut().find(|tab| tab.id == id) {
            tab.renaming = true;
            tab.draft = tab.name.clone();
        }
    }
    pub fn set_rename_draft(&mut self, id: &str, value: &str) {
        if let Some(tab) = self.tabs.iter_mut().find(|tab| tab.id == id) {
            tab.draft = value.to_string();
        }
    }
    pub fn commit_rename(&mut self, id: &str) {
        let Some(tab) = self.tabs.iter_mut().find(|tab| tab.id == id) else {
            return;
        };
        let next = tab.draft.trim().to_string();
        tab.renaming = false;
        if next.is_empty() {
            return;
        }
        self.handlers.tab_rename.push((id.to_string(), next));
    }
    pub fn cancel_rename(&mut self, id: &str) {
        if let Some(tab) = self.tabs.iter_mut().find(|tab| tab.id == id) {
            tab.renaming = false;
        }
    }

    pub fn begin_drag(&mut self, client_x: f64, sidebar_width: f64) {
        self.drag_origin = Some((client_x, sidebar_width));
    }

    pub fn drag_to(&mut self, client_x: f64) {
        let Some((start_x, start_width)) = self.drag_origin else {
            return;
        };
        let next = clamp_width(start_width + (client_x - start_x), self.viewport_width);
        self.state.sidebar_width = next;
        self.state.width_ratio = (next as f64 / self.viewport_width).clamp(0.12, 0.6);
    }

    pub fn end_drag(&mut self) {
        if self.drag_origin.take().is_some() {
            self.state_changes += 1;
        }
    }

    pub fn on_resize(&mut self, viewport_width: f64) {
        self.viewport_width = viewport_width;
        let next = clamp_width(
            (viewport_width * self.state.width_ratio).round(),
            viewport_width,
        );
        self.state.sidebar_width = next;
    }

    pub fn refresh_labels(&mut self) {
        self.command_label = i18n::t("navPlaceholder");
        self.title = view_label(&self.state.active_view);
        self.refresh_modules_message();
    }
}

pub fn normalize_view(view: &str) -> String {
    if SIDEBAR_VIEWS.contains(&view) {
        view.to_string()
    } else {
        "search".into()
    }
}

fn view_label(view: &str) -> String {
    match view {
        "dictionary" => i18n::t("dictionary"),
        "modules" => i18n::t("workbenchModules"),
        _ => i18n::t("search"),
    }
}

fn resolve_ratio(saved: Option<f64>, viewport: f64) -> f64 {
    if let Some(value) = saved.filter(|v| v.is_finite()) {
        return value.clamp(0.12, 0.6);
    }
    (300.0 / viewport.max(1.0)).clamp(0.12, 0.6)
}

fn clamp_width(width: f64, viewport: f64) -> i64 {
    let max_width = ((viewport * 0.6).floor() as i64).max(260);
    (width.round() as i64).clamp(220, max_width)
}

pub fn module_label(module: &ModuleRecord) -> String {
    display_name(module)
}

#[cfg(test)]
mod workbench_tests {
    use super::*;
    use crate::i18n;

    fn modules() -> Vec<ModuleRecord> {
        vec![
            ModuleRecord::new("kjv", "bible", "KJV"),
            ModuleRecord::new("strong", "dictionary", "Strong"),
            ModuleRecord::new("comm", "commentary", "Notes"),
            ModuleRecord::new("cross", "crossreference", "Crossrefs"),
        ]
    }

    #[test]
    fn does_nothing_without_a_pane_root() {
        let shell = WorkbenchShell::init(false, None, false, None, Vec::new(), 1000.0);
        assert!(!shell.ready);
    }

    #[test]
    fn builds_the_shell_and_handles_views_modules_tabs_and_resizing() {
        i18n::set_lang("en");
        let mut shell =
            WorkbenchShell::init(true, Some("dictionary"), true, Some(0.9), modules(), 1000.0);
        assert!(shell.ready);
        assert!(shell.state.collapsed);
        assert_eq!(shell.state.active_view, "dictionary");
        assert_eq!(shell.state.width_ratio, 0.6);
        assert!(shell.view_active("dictionary"));
        assert_eq!(normalize_view("missing"), normalize_view("search"));
        shell.click_navigation();
        shell.click_about();
        shell.click_settings();
        assert_eq!(shell.handlers.navigation, 1);
        assert_eq!(shell.handlers.about, 1);
        assert_eq!(shell.handlers.settings, 1);
        shell.activate_view("modules");
        assert_eq!(shell.state.active_view, "modules");
        assert!(!shell.state.collapsed);
        assert_eq!(shell.state_changes, 1);
        assert_eq!(shell.title, "Modules");
        assert_eq!(shell.module_counts(), 4);
        shell.click_install();
        shell.click_convert();
        shell.click_module("kjv");
        assert_eq!(shell.handlers.install, 1);
        assert_eq!(shell.handlers.convert, 1);
        assert_eq!(shell.handlers.editor, vec!["kjv".to_string()]);
        shell.toggle_sidebar();
        assert!(shell.state.collapsed);
        shell.activate_sidebar("unknown");
        assert_eq!(shell.state.active_view, "search");
        assert!(!shell.state.collapsed);
        shell.set_modules(Vec::new());
        assert_eq!(
            shell.empty_message.as_deref(),
            Some("No Bible modules found.")
        );
        shell.set_workspace_tabs(
            Some("a"),
            vec![("a".into(), "Alpha".into()), ("b".into(), "Beta".into())],
        );
        assert_eq!(shell.tabs.len(), 2);
        shell.activate_tab("b");
        shell.create_tab();
        shell.close_tab("a");
        assert_eq!(shell.handlers.tab_activate, vec!["b".to_string()]);
        assert_eq!(shell.handlers.tab_create, 1);
        assert_eq!(shell.handlers.tab_close, vec!["a".to_string()]);
        shell.begin_rename("b");
        shell.set_rename_draft("b", " Renamed ");
        shell.commit_rename("b");
        assert_eq!(
            shell.handlers.tab_rename,
            vec![("b".into(), "Renamed".into())]
        );
        shell.set_workspace_tabs(Some("b"), vec![("b".into(), "Beta".into())]);
        shell.begin_rename("b");
        shell.set_rename_draft("b", "");
        shell.commit_rename("b");
        assert!(!shell.tabs[0].renaming);
        shell.begin_rename("b");
        shell.cancel_rename("b");
        assert!(!shell.tabs[0].renaming);
        shell.begin_drag(300.0, 300.0);
        shell.drag_to(450.0);
        shell.end_drag();
        assert_eq!(shell.state.sidebar_width, 450);
        assert!((shell.state.width_ratio - 0.45).abs() < 0.0001);
        shell.on_resize(800.0);
        assert_eq!(shell.state.sidebar_width, 360);
        i18n::set_lang("pt");
        shell.refresh_labels();
        assert!(shell.command_label.contains("Digite"));
        i18n::reset_lang();
    }

    #[test]
    fn uses_the_default_sidebar_width_when_saved_state_has_no_width_ratio() {
        let shell = WorkbenchShell::init(true, None, false, None, Vec::new(), 1000.0);
        assert!((shell.state.width_ratio - 0.3).abs() < 0.0001);
        assert_eq!(shell.state.sidebar_width, 300);
    }
}
