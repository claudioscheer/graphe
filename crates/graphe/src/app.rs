//! egui workbench. Drawing lives in [`crate::study`], [`crate::side`], and [`crate::dialogs`].

use crate::paint::{self, canon_books};
use crate::session::{Dialog, Session};
use crate::startup::build_running_model;
use graphe_domain::app_state::AppStateStore;
use graphe_domain::books::GRAPHE_BOOK_NUMBERS;
use graphe_domain::commentary_ref::{
    build_reference_matcher, BookName as RefBookName, ReferenceMatcher,
};
use graphe_domain::i18n::{self, Lang};
use graphe_domain::model::BookRecord;
use graphe_domain::navigation::NavigationSession;
use graphe_domain::picker::{favorites, ModulePicker};
use graphe_domain::shortcuts::ShortcutAction;
use graphe_domain::theme::{self, UiPalette};
use graphe_store::catalog::{self, InstalledModule};
use graphe_store::sqlite::{self, LoadedMorph};
use graphe_store::state::{self, modules_dir};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

pub(crate) type LiveNav = NavigationSession<
    Box<dyn FnMut(&str, i64) -> i64>,
    Box<dyn FnMut(&str, i64, i64) -> Vec<i64>>,
    Box<dyn FnMut(&str) -> Option<String>>,
>;

pub fn run() -> eframe::Result {
    let running = build_running_model();
    let mut session = Session::from_state(&running.persisted);
    session.dark = running.palette_dark || session.dark;
    let mut store = AppStateStore::new();
    store.init(Some(&running.persisted));
    let modules = catalog::scan_modules(&modules_dir(&state::user_home()));
    if session
        .panes
        .get(&session.active_pane_id)
        .and_then(|pane| pane.module_id.clone())
        .is_none()
    {
        if let Some(bible) = modules.iter().find(|module| module.kind == "bible") {
            if let Some(pane) = session
                .panes
                .get_mut(&session.bible_target(&session.active_pane_id))
            {
                pane.module_id = Some(bible.id.clone());
            }
        }
    }

    #[cfg(target_os = "linux")]
    crate::icon::ensure_linux_desktop_entry();

    let mut viewport = egui::ViewportBuilder::default()
        .with_inner_size([1180.0, 760.0])
        .with_title("Graphe")
        .with_app_id(crate::icon::APP_ID);
    if let Some(icon) = crate::icon::load_icon() {
        viewport = viewport.with_icon(icon);
    }
    let native_options = eframe::NativeOptions {
        viewport,
        ..Default::default()
    };
    eframe::run_native(
        "Graphe",
        native_options,
        Box::new(move |cc| {
            paint::apply(&cc.egui_ctx, session.dark, session.font_size);
            Ok(Box::new(GrapheApp {
                session,
                modules,
                update_notice: std::sync::Arc::new(std::sync::Mutex::new(None)),
                update_started: false,
                persisted: running.persisted.clone(),
                store,
                nav: None,
                picker: None,
                morphs: HashMap::new(),
                matcher: None,
                matcher_lang: String::new(),
                applied_dark: running.palette_dark,
                applied_font: 20.0,
                theme_ready: false,
                loaded_key: String::new(),
                save_seen: 0,
                rename: String::new(),
                rename_for: String::new(),
                editor_path: None,
                editor_info_name: "description".into(),
                editor_info_value: String::new(),
                editor_book: "10".into(),
                editor_short: String::new(),
                editor_long: String::new(),
                editor_chapter: "1".into(),
                editor_verse: "1".into(),
                editor_text: String::new(),
                editor_armed: false,
            }))
        }),
    )
}

pub(crate) struct GrapheApp {
    pub(crate) session: Session,
    pub(crate) modules: Vec<InstalledModule>,
    update_notice: std::sync::Arc<std::sync::Mutex<Option<String>>>,
    update_started: bool,
    pub(crate) persisted: Value,
    pub(crate) store: AppStateStore,
    pub(crate) nav: Option<LiveNav>,
    pub(crate) picker: Option<ModulePicker>,
    pub(crate) morphs: HashMap<PathBuf, LoadedMorph>,
    matcher: Option<ReferenceMatcher>,
    pub(crate) matcher_lang: String,
    applied_dark: bool,
    applied_font: f32,
    theme_ready: bool,
    pub(crate) loaded_key: String,
    save_seen: usize,
    pub(crate) rename: String,
    rename_for: String,
    pub(crate) editor_path: Option<PathBuf>,
    pub(crate) editor_info_name: String,
    pub(crate) editor_info_value: String,
    pub(crate) editor_book: String,
    pub(crate) editor_short: String,
    pub(crate) editor_long: String,
    pub(crate) editor_chapter: String,
    pub(crate) editor_verse: String,
    pub(crate) editor_text: String,
    pub(crate) editor_armed: bool,
}

impl eframe::App for GrapheApp {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        self.pump_update();
        self.flush_saves();
        if !self.theme_ready
            || self.applied_dark != self.session.dark
            || (self.applied_font - self.session.font_size).abs() > 0.1
        {
            paint::apply(ctx, self.session.dark, self.session.font_size);
            self.applied_dark = self.session.dark;
            self.applied_font = self.session.font_size;
            self.theme_ready = true;
        }
        if let Some(text) = self.session.pending_copy.take() {
            ctx.copy_text(text);
        }
        self.restore_saved_panels();
        self.handle_keys(ctx);
        let palette = theme::palette(self.session.dark);
        self.menu_bar(ctx);
        self.workspace_strip(ctx, palette);
        self.command_strip(ctx, palette);
        self.activity_bar(ctx, palette);
        self.sidebar(ctx, palette);
        self.editor(ctx, palette);
        self.dialogs(ctx);
        self.drain_navigation();
        self.drain_picker();
    }

    fn on_exit(&mut self, _gl: Option<&eframe::glow::Context>) {
        self.note_workspaces();
        self.store.advance(1_000);
        let _ = state::save_state(&self.store.state);
    }
}

impl GrapheApp {
    fn pump_update(&mut self) {
        if self.update_started {
            return;
        }
        self.update_started = true;
        let slot = self.update_notice.clone();
        std::thread::spawn(move || {
            if let Some(version) = crate::update::fetch_newer_version() {
                if let Ok(mut notice) = slot.lock() {
                    *notice = Some(version);
                }
            }
        });
    }

    fn flush_saves(&mut self) {
        self.store.advance(16);
        if self.store.save_calls.len() != self.save_seen {
            self.save_seen = self.store.save_calls.len();
            let _ = state::save_state(&self.store.state);
            self.persisted = self.store.state.clone();
        }
    }

    pub(crate) fn restore_saved_panels(&mut self) {
        if !self.session.restore_panels {
            return;
        }
        self.session.restore_panels = false;
        let query = self.session.query.clone();
        let topic = self.session.dict_query.clone();
        if !query.is_empty() {
            self.run_search();
        }
        if !topic.is_empty() {
            self.lookup_dict_focused(&topic, false);
        }
    }

    pub(crate) fn patch_settings(&mut self, patch: Value) {
        self.store.set_settings(patch);
    }

    pub(crate) fn note_workspaces(&mut self) {
        self.session.remember_layout();
        let Some(state) = self.session.workspaces.get_state() else {
            return;
        };
        let items: Vec<Value> = state
            .items
            .iter()
            .map(|item| {
                json!({
                    "id": item.id,
                    "name": item.name,
                    "paneManager": item.pane_manager.clone().unwrap_or(Value::Null),
                })
            })
            .collect();
        let value = json!({
            "version": state.version,
            "activeWorkspaceId": state.active_workspace_id,
            "items": items,
        });
        self.store.set_workspaces(Some(&value));
        self.store.set_workbench(json!({
            "activeView": self.session.sidebar,
            "collapsed": self.session.sidebar_collapsed,
        }));
    }

    pub(crate) fn reload_modules(&mut self) {
        self.modules = catalog::scan_modules(&modules_dir(&state::user_home()));
        self.loaded_key.clear();
        self.sync_active_chapter();
    }

    pub(crate) fn sync_active_chapter(&mut self) {
        let target = self.session.bible_target(&self.session.active_pane_id);
        let (module_id, book, chapter) = self
            .session
            .panes
            .get(&target)
            .map(|pane| (pane.module_id.clone(), pane.book_number, pane.chapter))
            .unwrap_or((None, 10, 1));
        let key = format!(
            "{}:{}:{}:{}",
            module_id.clone().unwrap_or_default(),
            book,
            chapter,
            target
        );
        if key == self.loaded_key {
            return;
        }
        self.loaded_key = key;
        let path = self.bible_path(module_id.as_deref());
        let verses = path
            .map(|path| sqlite::chapter_in_file(path, book, chapter))
            .unwrap_or_default();
        self.session.show_chapter(
            verses
                .into_iter()
                .map(|verse| (verse.verse, verse.text))
                .collect(),
        );
    }

    pub(crate) fn bible_path(&self, module_id: Option<&str>) -> Option<&Path> {
        if let Some(id) = module_id {
            if let Some(module) = self.modules.iter().find(|module| module.id == id) {
                return Some(&module.path);
            }
        }
        self.modules
            .iter()
            .find(|module| module.kind == "bible")
            .map(|module| module.path.as_path())
    }

    pub(crate) fn nav_books(&self) -> Vec<BookRecord> {
        let target = self.session.bible_target(&self.session.active_pane_id);
        let module_id = self
            .session
            .panes
            .get(&target)
            .and_then(|pane| pane.module_id.clone());
        if let Some(path) = self.bible_path(module_id.as_deref()) {
            let books = sqlite::books_in_file(path);
            if !books.is_empty() {
                return books;
            }
        }
        canon_books()
    }

    pub(crate) fn open_navigation(&mut self) {
        let modules = self.modules.clone();
        let modules_verses = modules.clone();
        let pane = self.session.active_pane_id.clone();
        let books = self.nav_books();
        let chapter_count_fn: Box<dyn FnMut(&str, i64) -> i64> =
            Box::new(move |_module: &str, book: i64| chapter_count(&modules, book));
        let verse_fn: Box<dyn FnMut(&str, i64, i64) -> Vec<i64>> =
            Box::new(move |_module: &str, book: i64, chapter: i64| {
                verse_numbers(&modules_verses, book, chapter)
            });
        let pane_fn: Box<dyn FnMut(&str) -> Option<String>> =
            Box::new(move |id: &str| (id == pane).then(|| "active".to_string()));
        let mut nav = NavigationSession::new(chapter_count_fn, verse_fn, pane_fn);
        nav.open_for(&self.session.active_pane_id, books);
        nav.input = self.session.nav_input.clone();
        self.nav = Some(nav);
        self.session.dialog = Dialog::Navigation;
    }

    pub(crate) fn open_picker(&mut self) {
        let kind = self
            .session
            .panes
            .get(&self.session.active_pane_id)
            .map(|pane| match pane.pane_type {
                graphe_domain::model::PaneType::Commentary => "commentary",
                graphe_domain::model::PaneType::Bible => "bible",
            })
            .unwrap_or("bible");
        let selected = self
            .session
            .panes
            .get(&self.session.active_pane_id)
            .and_then(|pane| pane.module_id.clone());
        let modules = self
            .modules
            .iter()
            .filter(|module| module.kind == kind)
            .map(|module| {
                graphe_domain::model::ModuleRecord::new(&module.id, &module.kind, &module.name)
            })
            .collect();
        let mut picker = ModulePicker::create(graphe_domain::picker::PickerOptions {
            modules,
            selected_id: selected,
            module_type: kind.into(),
            show_favorites: true,
            ..graphe_domain::picker::PickerOptions::default()
        });
        picker.toggle_open(&self.store);
        self.picker = Some(picker);
        self.session.dialog = Dialog::Picker;
    }

    pub(crate) fn cycle_favorite(&mut self) {
        let kind = self
            .session
            .panes
            .get(&self.session.active_pane_id)
            .map(|pane| match pane.pane_type {
                graphe_domain::model::PaneType::Commentary => "commentary",
                graphe_domain::model::PaneType::Bible => "bible",
            })
            .unwrap_or("bible");
        let ids = favorites(&self.store, kind);
        if self.session.cycle_favorite(&ids).is_some() {
            self.loaded_key.clear();
            self.sync_active_chapter();
        }
    }

    fn drain_navigation(&mut self) {
        let Some(nav) = self.nav.as_mut() else {
            return;
        };
        if nav.navigations.is_empty() {
            return;
        }
        let actions: Vec<_> = nav.navigations.drain(..).collect();
        let closed = !nav.open;
        for action in actions {
            self.session.active_pane_id = action.pane_id;
            self.session
                .navigate(action.book_number, action.chapter, action.verse);
        }
        if closed {
            self.nav = None;
            if self.session.dialog == Dialog::Navigation {
                self.session.dialog = Dialog::None;
            }
        }
        self.loaded_key.clear();
        self.sync_active_chapter();
    }

    fn drain_picker(&mut self) {
        let Some(picker) = self.picker.as_ref() else {
            return;
        };
        if picker.open || picker.changes.is_empty() {
            return;
        }
        let chosen = picker.changes.last().cloned().unwrap_or(None);
        self.picker = None;
        if self.session.dialog == Dialog::Picker {
            self.session.dialog = Dialog::None;
        }
        if let Some(pane) = self.session.panes.get_mut(&self.session.active_pane_id) {
            pane.module_id = chosen;
        }
        self.loaded_key.clear();
        self.sync_active_chapter();
    }

    pub(crate) fn matcher(&mut self) -> &ReferenceMatcher {
        let lang = i18n::get_current_lang().as_str().to_string();
        if self.matcher.is_none() || self.matcher_lang != lang {
            let names: Vec<RefBookName> = GRAPHE_BOOK_NUMBERS
                .iter()
                .map(|number| {
                    let name = i18n::book_name(i64::from(*number));
                    RefBookName {
                        short: name.short,
                        long: name.long,
                    }
                })
                .collect();
            let numbers: Vec<i64> = GRAPHE_BOOK_NUMBERS
                .iter()
                .map(|number| i64::from(*number))
                .collect();
            self.matcher = Some(build_reference_matcher(&[names], &numbers));
            self.matcher_lang = lang;
        }
        self.matcher.as_ref().expect("matcher")
    }

    fn handle_keys(&mut self, ctx: &egui::Context) {
        let text_focused = ctx.wants_keyboard_input();
        let mut action = None;
        ctx.input(|input| {
            let primary = input.modifiers.command || input.modifiers.ctrl;
            for event in &input.events {
                let egui::Event::Key {
                    key,
                    pressed,
                    modifiers,
                    ..
                } = event
                else {
                    continue;
                };
                if !pressed {
                    continue;
                }
                let name = match key {
                    egui::Key::F3 => "F3",
                    egui::Key::Escape => "Escape",
                    egui::Key::Tab => "Tab",
                    egui::Key::ArrowUp => "ArrowUp",
                    egui::Key::ArrowDown => "ArrowDown",
                    egui::Key::F => "F",
                    egui::Key::H => "H",
                    egui::Key::V => "V",
                    egui::Key::A => "A",
                    egui::Key::C => "C",
                    egui::Key::E => "E",
                    egui::Key::T => "T",
                    egui::Key::Comma => ",",
                    egui::Key::Enter => "Enter",
                    _ => continue,
                };
                action = self.session.handle_shortcut_input(
                    name,
                    primary,
                    modifiers.shift,
                    text_focused,
                );
            }
        });
        match action {
            Some(ShortcutAction::ToggleTranslationPicker) => self.open_picker(),
            Some(ShortcutAction::CycleFavoriteTranslations) => self.cycle_favorite(),
            Some(ShortcutAction::OpenNavigation) => {
                if self.nav.is_none() {
                    self.open_navigation();
                }
            }
            Some(ShortcutAction::SplitHorizontal)
            | Some(ShortcutAction::SplitVertical)
            | Some(ShortcutAction::NextPane) => {
                self.loaded_key.clear();
                self.sync_active_chapter();
                self.note_workspaces();
            }
            _ => {}
        }
    }

    fn menu_bar(&mut self, ctx: &egui::Context) {
        let menu_bg = if self.session.dark {
            "#2b2b2b"
        } else {
            "#f3f3f3"
        };
        egui::TopBottomPanel::top("menu")
            .exact_height(26.0)
            .frame(paint::panel(menu_bg).inner_margin(egui::Margin::symmetric(4, 0)))
            .show(ctx, |ui| {
                egui::MenuBar::new().ui(ui, |ui| {
                    ui.menu_button("File", |ui| {
                        if ui.button(i18n::t("installModules")).clicked() {
                            self.install();
                            ui.close();
                        }
                        if ui.button(i18n::t("convertModules")).clicked() {
                            self.session.dialog = Dialog::Convert;
                            ui.close();
                        }
                        if ui.button(i18n::t("reloadModules")).clicked() {
                            self.reload_modules();
                            ui.close();
                        }
                        ui.separator();
                        if ui.button(i18n::t("settings")).clicked() {
                            self.session.dialog = Dialog::Settings;
                            ui.close();
                        }
                        ui.separator();
                        if ui.button("Quit").clicked() {
                            ui.ctx().send_viewport_cmd(egui::ViewportCommand::Close);
                        }
                    });
                    ui.menu_button("Edit", |ui| {
                        if ui.button(i18n::t("editModuleData")).clicked() {
                            self.session.dialog = Dialog::ModuleEditor;
                            ui.close();
                        }
                    });
                    ui.menu_button("View", |ui| {
                        ui.menu_button("Split Horizontal", |ui| {
                            if ui.button("Bible View").clicked() {
                                self.session.split(false);
                                self.after_split();
                                ui.close();
                            }
                            if ui.button(i18n::t("commentary")).clicked() {
                                self.session.split_commentary(false);
                                self.after_split();
                                ui.close();
                            }
                        });
                        ui.menu_button("Split Vertical", |ui| {
                            if ui.button("Bible View").clicked() {
                                self.session.split(true);
                                self.after_split();
                                ui.close();
                            }
                            if ui.button(i18n::t("commentary")).clicked() {
                                self.session.split_commentary(true);
                                self.after_split();
                                ui.close();
                            }
                        });
                    });
                    ui.menu_button("Help", |ui| {
                        if ui.button(i18n::t("aboutTitle")).clicked() {
                            self.session.dialog = Dialog::About;
                            ui.close();
                        }
                        if ui.button(i18n::t("reportIssue")).clicked() {
                            let _ = open::that(crate::update::ISSUES_URL);
                            ui.close();
                        }
                    });
                    if let Some(version) = self
                        .update_notice
                        .lock()
                        .ok()
                        .and_then(|notice| notice.clone())
                    {
                        ui.label(i18n::t_fmt(
                            "updateAvailable",
                            &[("version", version.as_str())],
                        ));
                    }
                });
            });
    }

    fn after_split(&mut self) {
        self.loaded_key.clear();
        self.sync_active_chapter();
        self.note_workspaces();
    }

    fn workspace_strip(&mut self, ctx: &egui::Context, palette: &UiPalette) {
        egui::TopBottomPanel::top("workspaces")
            .exact_height(28.0)
            .frame(
                paint::panel(palette.ui_surface_muted).inner_margin(egui::Margin::symmetric(8, 2)),
            )
            .show(ctx, |ui| {
                let tabs = self.session.workspaces.get_tab_state();
                ui.horizontal(|ui| {
                    let items = tabs.items.clone();
                    for (id, name) in items {
                        let active = tabs.active_workspace_id.as_deref() == Some(id.as_str());
                        ui.push_id(&id, |ui| {
                            if ui
                                .selectable_label(active, egui::RichText::new(name).size(12.0))
                                .clicked()
                                && self.session.open_workspace(&id)
                            {
                                self.loaded_key.clear();
                                self.sync_active_chapter();
                                self.note_workspaces();
                            }
                            if active
                                && ui.small_button("×").clicked()
                                && self.session.close_active_workspace()
                            {
                                self.loaded_key.clear();
                                self.sync_active_chapter();
                                self.note_workspaces();
                            }
                        });
                    }
                    if ui.small_button("+").clicked() {
                        self.session.new_workspace();
                        self.loaded_key.clear();
                        self.sync_active_chapter();
                        self.note_workspaces();
                    }
                    self.active_rename(ui);
                });
            });
    }

    fn command_strip(&mut self, ctx: &egui::Context, palette: &UiPalette) {
        egui::TopBottomPanel::top("command")
            .exact_height(36.0)
            .frame(
                paint::panel(palette.ui_surface_muted).inner_margin(egui::Margin::symmetric(8, 4)),
            )
            .show(ctx, |ui| {
                ui.horizontal(|ui| {
                    ui.label(egui::RichText::new("Graphe").strong().size(12.0));
                    if ui
                        .add(
                            egui::Button::new(
                                egui::RichText::new(i18n::t("navPlaceholder"))
                                    .size(12.0)
                                    .color(paint::color(palette.ui_text_subtle)),
                            )
                            .min_size(egui::vec2(320.0, 24.0))
                            .corner_radius(egui::CornerRadius::same(4)),
                        )
                        .clicked()
                    {
                        self.open_navigation();
                    }
                    if !self.session.status.is_empty() {
                        ui.label(self.session.status.clone());
                    }
                });
            });
    }

    fn activity_bar(&mut self, ctx: &egui::Context, palette: &UiPalette) {
        let bar = if self.session.dark {
            "#181818"
        } else {
            "#f2f0ea"
        };
        egui::SidePanel::left("activity")
            .exact_width(48.0)
            .frame(paint::panel(bar).inner_margin(egui::Margin::ZERO))
            .show(ctx, |ui| {
                ui.vertical(|ui| {
                    for (view, icon) in [
                        ("search", paint::Icon::Search),
                        ("dictionary", paint::Icon::Book),
                        ("modules", paint::Icon::Library),
                    ] {
                        let selected = self.session.sidebar == view;
                        let response = paint::icon_button(ui, icon, selected, palette);
                        if response.clicked() {
                            self.session.focus_sidebar(view);
                            self.note_workspaces();
                        }
                        response.on_hover_text(label_for(view));
                    }
                    let gap = (ui.available_height() - 48.0).max(0.0);
                    ui.allocate_space(egui::vec2(0.0, gap));
                    let response = paint::icon_button(ui, paint::Icon::Settings, false, palette);
                    if response.clicked() {
                        self.session.dialog = Dialog::Settings;
                    }
                    response.on_hover_text(i18n::t("settings"));
                });
            });
    }

    fn install(&mut self) {
        if let Some(files) = rfd::FileDialog::new().pick_files() {
            let dir = modules_dir(&state::user_home());
            catalog::install_files(&dir, &files);
            self.reload_modules();
        }
    }

    pub(crate) fn active_rename(&mut self, ui: &mut egui::Ui) {
        let Some(state) = self.session.workspaces.get_state() else {
            return;
        };
        let active = state.active_workspace_id.clone();
        let name = state
            .items
            .iter()
            .find(|item| item.id == active)
            .map(|item| item.name.clone())
            .unwrap_or_default();
        if self.rename_for != active {
            self.rename_for = active.clone();
            self.rename = name;
        }
        if ui.text_edit_singleline(&mut self.rename).lost_focus()
            && self
                .session
                .workspaces
                .rename_workspace(&active, &self.rename)
        {
            self.note_workspaces();
        }
    }
}

pub(crate) fn label_for(view: &str) -> String {
    match view {
        "dictionary" => i18n::t("dictionary"),
        "modules" => i18n::t("workbenchModules"),
        _ => i18n::t("search"),
    }
}

fn chapter_count(modules: &[InstalledModule], book: i64) -> i64 {
    if let Some(module) = modules.iter().find(|module| module.kind == "bible") {
        let count = sqlite::chapter_count_in_file(&module.path, book);
        if count > 0 {
            return count;
        }
    }
    paint::chapter_count_fallback(book)
}

fn verse_numbers(modules: &[InstalledModule], book: i64, chapter: i64) -> Vec<i64> {
    if let Some(module) = modules.iter().find(|module| module.kind == "bible") {
        let verses: Vec<i64> = sqlite::chapter_in_file(&module.path, book, chapter)
            .into_iter()
            .map(|verse| verse.verse)
            .filter(|verse| *verse >= 0)
            .collect();
        if !verses.is_empty() {
            return verses;
        }
    }
    (1..=paint::verse_count_fallback(book, chapter)).collect()
}

pub(crate) fn language_button(lang: Lang) -> &'static str {
    match lang {
        Lang::Pt => "PT",
        Lang::En => "EN",
        Lang::Es => "ES",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bare(session: Session) -> GrapheApp {
        GrapheApp {
            session,
            modules: Vec::new(),
            update_notice: std::sync::Arc::new(std::sync::Mutex::new(None)),
            update_started: true,
            persisted: json!({}),
            store: AppStateStore::new(),
            nav: None,
            picker: None,
            morphs: HashMap::new(),
            matcher: None,
            matcher_lang: String::new(),
            applied_dark: false,
            applied_font: 20.0,
            theme_ready: true,
            loaded_key: String::new(),
            save_seen: 0,
            rename: String::new(),
            rename_for: String::new(),
            editor_path: None,
            editor_info_name: String::new(),
            editor_info_value: String::new(),
            editor_book: String::new(),
            editor_short: String::new(),
            editor_long: String::new(),
            editor_chapter: String::new(),
            editor_verse: String::new(),
            editor_text: String::new(),
            editor_armed: false,
        }
    }

    #[test]
    fn restoring_a_dictionary_topic_keeps_the_saved_sidebar() {
        for view in ["search", "modules"] {
            let mut app = bare(Session::from_state(&json!({
                "workbench": {"activeView": view},
                "dictPanel": {
                    "selectedModuleId": "strong",
                    "moduleSearchCache": {"strong": "G3056"}
                }
            })));
            app.session.dialog = Dialog::Settings;
            assert_eq!(app.session.sidebar, view);
            assert!(app.session.restore_panels);
            app.restore_saved_panels();
            assert_eq!(app.session.sidebar, view);
            assert_eq!(app.session.dict_query, "G3056");
            assert_eq!(app.session.dialog, Dialog::Settings);
            assert!(!app.session.restore_panels);
        }
    }

    #[test]
    fn a_dictionary_click_still_opens_the_dictionary_sidebar() {
        let mut app = bare(Session::from_state(&json!({
            "workbench": {"activeView": "search"}
        })));
        assert_eq!(app.session.sidebar, "search");
        app.lookup_dict("G3056");
        assert_eq!(app.session.sidebar, "dictionary");
        assert_eq!(app.session.dialog, Dialog::None);
    }
}
