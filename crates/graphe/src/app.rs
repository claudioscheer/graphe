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
use graphe_domain::panes::{canon_chapter_spans, ChapterSpan};
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
                mark: None,
                renaming: None,
                rename_focus: false,
                chapter_span_cache: HashMap::new(),
                reading: crate::study::ReadingCache::new(),
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
    pub(crate) update_notice: std::sync::Arc<std::sync::Mutex<Option<String>>>,
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
    pub(crate) mark: Option<egui::TextureHandle>,
    pub(crate) renaming: Option<String>,
    pub(crate) rename_focus: bool,
    chapter_span_cache: HashMap<String, Vec<ChapterSpan>>,
    pub(crate) reading: crate::study::ReadingCache,
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
        self.update_banner(ctx, palette);
        self.top_strip(ctx, palette);
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
        self.chapter_span_cache.clear();
        self.reading.clear();
        self.loaded_key.clear();
        self.sync_active_chapter();
    }

    pub(crate) fn chapter_spans(&mut self, pane_id: &str) -> Vec<ChapterSpan> {
        let module_id = self
            .session
            .panes
            .get(pane_id)
            .and_then(|pane| pane.module_id.clone())
            .unwrap_or_default();
        if let Some(cached) = self.chapter_span_cache.get(&module_id) {
            return cached.clone();
        }
        let from_module = {
            let id = (!module_id.is_empty()).then_some(module_id.as_str());
            self.bible_path(id)
                .map(sqlite::chapter_spans_in_file)
                .filter(|rows| !rows.is_empty())
        };
        let spans = from_module
            .map(|rows| {
                rows.into_iter()
                    .map(|(book_number, chapters)| ChapterSpan {
                        book_number,
                        chapters: chapters.max(1),
                    })
                    .collect()
            })
            .unwrap_or_else(canon_chapter_spans);
        self.chapter_span_cache.insert(module_id, spans.clone());
        spans
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
            .map(|module| module.to_module_record())
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

    fn activity_bar(&mut self, ctx: &egui::Context, palette: &UiPalette) {
        let bar = if self.session.dark {
            "#181818"
        } else {
            "#f2f0ea"
        };
        egui::SidePanel::left("activity")
            .exact_width(48.0)
            .resizable(false)
            .frame(paint::panel(bar).inner_margin(egui::Margin {
                left: 2,
                right: 2,
                top: 6,
                bottom: 6,
            }))
            .show(ctx, |ui| {
                let border_x = ui.max_rect().right() + 2.0;
                ui.painter().line_segment(
                    [
                        egui::pos2(border_x, ui.max_rect().top() - 6.0),
                        egui::pos2(border_x, ui.max_rect().bottom() + 6.0),
                    ],
                    egui::Stroke::new(1.0_f32, paint::color(palette.ui_border)),
                );
                ui.spacing_mut().item_spacing.y = 2.0;
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
                        paint::hover_tip(response, label_for(view));
                    }
                    let gap = (ui.available_height() - 48.0).max(0.0);
                    ui.allocate_space(egui::vec2(0.0, gap));
                    let response = paint::icon_button(ui, paint::Icon::Settings, false, palette);
                    if response.clicked() {
                        self.session.dialog = Dialog::Settings;
                    }
                    paint::hover_tip(response, i18n::t("settings"));
                });
            });
    }

    pub(crate) fn install(&mut self) {
        if let Some(files) = rfd::FileDialog::new().pick_files() {
            let dir = modules_dir(&state::user_home());
            catalog::install_files(&dir, &files);
            self.reload_modules();
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
            mark: None,
            renaming: None,
            rename_focus: false,
            chapter_span_cache: HashMap::new(),
            reading: crate::study::ReadingCache::new(),
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

    fn shape_has_paper(shape: &egui::Shape, paper: egui::Color32) -> bool {
        match shape {
            egui::Shape::Rect(rect) => {
                rect.fill == paper && (rect.rect.width() - 520.0).abs() < 8.0
            }
            egui::Shape::Vec(shapes) => shapes.iter().any(|shape| shape_has_paper(shape, paper)),
            _ => false,
        }
    }

    fn dialog_frame(
        ctx: &egui::Context,
        app: &mut GrapheApp,
    ) -> (egui::FullOutput, Vec<(String, [f32; 4])>) {
        let mut style = (*ctx.style()).clone();
        style.animation_time = 0.0;
        ctx.set_style(style);
        let mut raw = egui::RawInput::default();
        raw.screen_rect = Some(egui::Rect::from_min_size(
            egui::Pos2::ZERO,
            egui::vec2(1200.0, 800.0),
        ));
        let mut marks = Vec::new();
        let output = ctx.run(raw, |ctx| {
            ctx.data_mut(|data| {
                data.remove_temp::<Vec<(String, [f32; 4])>>(egui::Id::new("pane-layout-marks"));
            });
            app.dialogs(ctx);
            marks = ctx.data(|data| {
                data.get_temp::<Vec<(String, [f32; 4])>>(egui::Id::new("pane-layout-marks"))
                    .unwrap_or_default()
            });
        });
        (output, marks)
    }

    #[test]
    fn settings_opens_as_a_paper_card_and_the_theme_button_flips_the_theme() {
        let ctx = egui::Context::default();
        let mut app = bare(Session::new());
        app.session.dialog = Dialog::Settings;
        let _ = dialog_frame(&ctx, &mut app);
        let (output, marks) = dialog_frame(&ctx, &mut app);
        let card = mark(&marks, "modal-card");
        assert!(
            (card[2] - 520.0).abs() < 2.0,
            "settings card is 520px wide, got {card:?}"
        );
        let paper = paint::color("#fefdf9");
        let painted = output
            .shapes
            .iter()
            .any(|clipped| shape_has_paper(&clipped.shape, paper));
        assert!(painted, "the settings card uses the cream surface");
        let theme = *mark(&marks, "settings-theme");
        let close = *mark(&marks, "settings-close");
        assert!(
            close[0] + close[2] > card[0] + card[2] - 28.0,
            "Fechar sits at the right of the footer, card {card:?} close {close:?}"
        );
        let pos = egui::pos2(theme[0] + theme[2] * 0.5, theme[1] + theme[3] * 0.5);
        let mut raw = egui::RawInput::default();
        raw.screen_rect = Some(egui::Rect::from_min_size(
            egui::Pos2::ZERO,
            egui::vec2(1200.0, 800.0),
        ));
        raw.events = vec![
            egui::Event::PointerMoved(pos),
            egui::Event::PointerButton {
                pos,
                button: egui::PointerButton::Primary,
                pressed: true,
                modifiers: egui::Modifiers::default(),
            },
            egui::Event::PointerButton {
                pos,
                button: egui::PointerButton::Primary,
                pressed: false,
                modifiers: egui::Modifiers::default(),
            },
        ];
        let _ = ctx.run(raw, |ctx| {
            app.dialogs(ctx);
        });
        assert!(app.session.dark, "the theme control toggles light and dark");
        assert_eq!(app.store.settings()["theme"], "dark");
    }

    #[test]
    fn all_commentaries_keeps_the_reference_in_the_title() {
        let mut app = bare(Session::new());
        i18n::set_lang("pt");
        app.load_all_commentaries(650, 10, Some(2));
        assert_eq!(app.session.commentary_ref, "Hb 10:2");
        assert!(app.session.commentary_sections.is_empty());
        assert_eq!(app.session.dialog, Dialog::AllCommentaries);
    }

    #[test]
    fn split_panes_pin_the_toolbar_to_the_top_and_fill_the_rest_with_the_chapter() {
        let ctx = egui::Context::default();
        let mut app = bare(Session::new());
        app.session.split(false);
        app.session.split(true);
        app.session.chapter_text = (1..=24)
            .map(|verse| {
                (
                    verse,
                    "No princípio criou Deus os céus e a terra.".to_string(),
                )
            })
            .collect();
        let mut raw = egui::RawInput::default();
        raw.screen_rect = Some(egui::Rect::from_min_size(
            egui::Pos2::ZERO,
            egui::vec2(1200.0, 800.0),
        ));
        let palette = theme::palette(false);
        let mut marks = Vec::new();
        for _ in 0..2 {
            let _ = ctx.run(raw.clone(), |ctx| {
                app.editor(ctx, palette);
                marks = ctx.data(|data| {
                    data.get_temp::<Vec<(String, [f32; 4])>>(egui::Id::new("pane-layout-marks"))
                        .unwrap_or_default()
                });
            });
        }
        let toolbars: Vec<_> = marks
            .iter()
            .filter(|(key, _)| key.starts_with("toolbar:"))
            .collect();
        let bodies: Vec<_> = marks
            .iter()
            .filter(|(key, _)| key.starts_with("body:"))
            .collect();
        assert_eq!(
            toolbars.len(),
            3,
            "one column plus a vertical split: {marks:?}"
        );
        assert_eq!(bodies.len(), 3, "{marks:?}");
        let mut tops: Vec<f32> = toolbars.iter().map(|(_, rect)| rect[1]).collect();
        tops.sort_by(f32::total_cmp);
        assert!(
            tops[0] < 80.0,
            "the upper toolbars sit under the study tabs, not mid-pane: {marks:?}"
        );
        assert!(
            (tops[0] - tops[1]).abs() < 2.0,
            "side-by-side toolbars share a row: {marks:?}"
        );
        assert!(
            tops[2] > 300.0 && tops[2] < 560.0,
            "the lower pane toolbar starts its own half: {marks:?}"
        );
        for (key, rect) in &toolbars {
            assert!(
                (rect[3] - 44.0).abs() < 2.0,
                "{key} is a 44px strip, got {}",
                rect[3]
            );
            let pane = key.trim_start_matches("toolbar:");
            let body = bodies
                .iter()
                .find(|(body_key, _)| body_key == &format!("body:{pane}"))
                .unwrap_or_else(|| panic!("missing body for {pane}: {marks:?}"));
            assert!(
                (body.1[1] - (rect[1] + rect[3])).abs() < 4.0,
                "{pane} chapter starts under its toolbar: {marks:?}"
            );
            assert!(
                body.1[3] > 200.0,
                "{pane} chapter fills its pane, height {}: {marks:?}",
                body.1[3]
            );
        }
    }

    #[test]
    fn split_toolbars_meet_and_keep_the_close_button_on_screen() {
        let ctx = egui::Context::default();
        let mut app = bare(Session::new());
        let below = app.session.split(true);
        app.session.panes.get_mut(&below).unwrap().pane_type =
            graphe_domain::model::PaneType::Commentary;
        app.session.active_pane_id = "pane-1".into();
        let right = app.session.split(false);
        let mut raw = egui::RawInput::default();
        raw.screen_rect = Some(egui::Rect::from_min_size(
            egui::Pos2::ZERO,
            egui::vec2(1200.0, 800.0),
        ));
        let palette = theme::palette(false);
        let mut marks = Vec::new();
        for _ in 0..2 {
            let _ = ctx.run(raw.clone(), |ctx| {
                app.editor(ctx, palette);
                marks = ctx.data(|data| {
                    data.get_temp::<Vec<(String, [f32; 4])>>(egui::Id::new("pane-layout-marks"))
                        .unwrap_or_default()
                });
            });
        }
        let toolbar = |id: &str| *mark(&marks, &format!("toolbar:{id}"));
        let close = |id: &str| *mark(&marks, &format!("close:{id}"));
        let left = toolbar("pane-1");
        let right_bar = toolbar(&right);
        let lower = toolbar(&below);
        assert!(
            (left[0] + left[2] - right_bar[0]).abs() < 1.0,
            "side-by-side toolbars meet: {marks:?}"
        );
        let tabs = *mark(&marks, "workspace-tabs");
        assert!(
            (tabs[1] + tabs[3] - left[1]).abs() < 1.0,
            "the study tabs sit on the toolbar with no paper gap: {tabs:?} {left:?}"
        );
        assert!(
            marks.iter().any(|(key, rect)| {
                key == "split-rule" && (rect[0] - right_bar[0]).abs() < 1.5 && rect[3] > 40.0
            }),
            "a vertical rule separates the side-by-side panes: {marks:?}"
        );
        assert!(
            (left[1] - right_bar[1]).abs() < 1.0,
            "side-by-side toolbars share a row: {marks:?}"
        );
        assert!(
            (right_bar[0] + right_bar[2] - (lower[0] + lower[2])).abs() < 1.0,
            "the commentary bar reaches the same right edge: {marks:?}"
        );
        assert!(
            right_bar[0] + right_bar[2] > 1190.0,
            "the right toolbar reaches the window edge: {marks:?}"
        );
        let upper_bottom = marks
            .iter()
            .filter(|(key, _)| key == "body:pane-1" || key == &format!("body:{right}"))
            .map(|(_, rect)| rect[1] + rect[3])
            .fold(0.0_f32, f32::max);
        assert!(
            (lower[1] - upper_bottom).abs() < 1.0,
            "the commentary bar sits against the panes above it: {marks:?}"
        );
        for id in ["pane-1", right.as_str(), below.as_str()] {
            let bar = toolbar(id);
            let button = close(id);
            let button_right = button[0] + button[2];
            let bar_right = bar[0] + bar[2];
            assert!(
                button_right <= bar_right + 0.5 && button_right <= 1200.5,
                "{id} close is clipped: button {button:?} bar {bar:?}"
            );
            assert!(
                button_right > bar_right - 36.0,
                "{id} close is not at the end of its bar: {button:?} {bar:?}"
            );
        }
        let all = *mark(&marks, &format!("all-commentaries:{below}"));
        let coverage = *mark(&marks, &format!("coverage:{below}"));
        assert!(
            all[1] >= lower[1] - 1.0 && all[1] + all[3] <= lower[1] + lower[3] + 1.0,
            "all-commentaries sits in the commentary toolbar: {all:?} {lower:?}"
        );
        assert!(
            coverage[0] > all[0] && coverage[0] + coverage[2] < close(&below)[0],
            "coverage info icon sits between the book icon and close: {marks:?}"
        );
        assert!(
            marks.iter().any(|(key, _)| key == "options:pane-1"),
            "the bible toolbar keeps the options menu: {marks:?}"
        );
        assert!(
            !marks
                .iter()
                .any(|(key, _)| key == &format!("options:{below}")),
            "the commentary toolbar has no options menu: {marks:?}"
        );
        let nav = *mark(&marks, "nav:pane-1");
        let expected_nav = if left[2] < 420.0 {
            118.0
        } else if left[2] < 560.0 {
            150.0
        } else {
            240.0
        };
        assert!(
            (nav[2] - expected_nav).abs() < 1.0,
            "chapter group is {expected_nav}px on a {}px pane: {nav:?}",
            left[2]
        );
        let place = *mark(&marks, &format!("place:{below}"));
        assert!(
            place[2] < 80.0,
            "commentary place is the book and chapter, not a wide slot: {place:?}"
        );
        let picker = *mark(&marks, "picker:pane-1");
        assert!(
            (picker[2] - 192.0).abs() < 1.0 || (picker[2] - 112.0).abs() < 1.0,
            "bible module name sits in a wide plain trigger: {picker:?}"
        );
    }

    #[test]
    fn sidebar_width_stays_stable_on_pointer_events() {
        for view in ["modules", "search", "dictionary"] {
            let ctx = egui::Context::default();
            let mut app = bare(Session::from_state(&json!({
                "workbench": {"activeView": view}
            })));
            app.modules = vec![graphe_store::catalog::InstalledModule {
                id: "acf".to_string(),
                name: "Almeida Corrigida Fiel".to_string(),
                kind: "bible".to_string(),
                path: std::path::PathBuf::from("acf.bible"),
                short_title: Some("ACF".to_string()),
                description: Some("Almeida Corrigida Fiel".to_string()),
            }];
            app.session.sidebar = view.to_string();
            if view == "dictionary" {
                app.session.dict_query = "G3056".to_string();
                app.session.dict_body = "<p>Palavra grega logos</p>".to_string();
                app.session.dict_cognates = vec!["G3004".to_string(), "G3050".to_string()];
            }
            if view == "search" {
                app.session.query = "deus".to_string();
                app.session.hits = vec![
                    graphe_domain::search::SearchHit {
                        book_number: 1,
                        chapter: 1,
                        verse: 1,
                        text: "No princípio criou Deus os céus e a terra.".to_string(),
                    },
                    graphe_domain::search::SearchHit {
                        book_number: 1,
                        chapter: 1,
                        verse: 3,
                        text: "E disse Deus: Haja luz; e houve luz.".to_string(),
                    },
                ];
            }
            for frame in 0..10 {
                let mut raw = egui::RawInput::default();
                raw.events.push(egui::Event::PointerMoved(egui::pos2(
                    150.0 + frame as f32,
                    150.0,
                )));
                let _ = ctx.run(raw, |ctx| {
                    let palette = theme::palette(app.session.dark);
                    app.sidebar(ctx, palette);
                });
                let state =
                    egui::containers::panel::PanelState::load(&ctx, egui::Id::new("sidebar"));
                assert_eq!(
                    state.map(|s| s.rect.width()),
                    Some(300.0),
                    "View {} grew at frame {}",
                    view,
                    frame
                );
            }
        }
    }

    fn study_frame(
        ctx: &egui::Context,
        app: &mut GrapheApp,
        time: f64,
        modifiers: egui::Modifiers,
        events: Vec<egui::Event>,
    ) -> Vec<(String, [f32; 4])> {
        let mut raw = egui::RawInput::default();
        raw.screen_rect = Some(egui::Rect::from_min_size(
            egui::Pos2::ZERO,
            egui::vec2(1200.0, 800.0),
        ));
        raw.time = Some(time);
        raw.modifiers = modifiers;
        raw.events = events;
        let palette = theme::palette(false);
        let mut marks = Vec::new();
        let _ = ctx.run(raw, |ctx| {
            app.editor(ctx, palette);
            marks = ctx.data(|data| {
                data.get_temp::<Vec<(String, [f32; 4])>>(egui::Id::new("pane-layout-marks"))
                    .unwrap_or_default()
            });
        });
        marks
    }

    fn mark<'a>(marks: &'a [(String, [f32; 4])], key: &str) -> &'a [f32; 4] {
        marks
            .iter()
            .find(|(name, _)| name == key)
            .map(|(_, rect)| rect)
            .unwrap_or_else(|| panic!("missing {key} in {marks:?}"))
    }

    #[test]
    fn commentary_padding_keeps_the_text_inside_a_scrollable_view() {
        let ctx = egui::Context::default();
        let mut app = bare(Session::new());
        let pane = app.session.split_commentary(false);
        let path = std::path::PathBuf::from("notes.commentaries.SQLite3");
        app.modules.push(graphe_store::catalog::InstalledModule {
            id: "notes".into(),
            name: "Notes".into(),
            kind: "commentary".into(),
            path: path.clone(),
            short_title: None,
            description: None,
        });
        if let Some(record) = app.session.panes.get_mut(&pane) {
            record.module_id = Some("notes".into());
        }
        let paragraph = "A graça e a verdade vieram por Jesus Cristo. ".repeat(40);
        let mut pieces = Vec::new();
        for verse in 1..=16 {
            if verse > 1 {
                pieces.push(crate::study::CommentaryPiece::Text("\n\n".into()));
            }
            pieces.push(crate::study::CommentaryPiece::Text(format!(
                "{verse} {paragraph}"
            )));
            pieces.push(crate::study::CommentaryPiece::Link {
                label: "Jo 1:1".into(),
                book: 43,
                chapter: 1,
                verse: Some(1),
            });
        }
        let key = crate::study::commentary_key(&path, 10, 1, i18n::get_current_lang().as_str());
        app.reading.commentary.insert(
            key,
            crate::study::CommentaryPaint {
                pieces: std::sync::Arc::new(pieces),
            },
        );
        let settled = study_frame(&ctx, &mut app, 0.1, egui::Modifiers::default(), Vec::new());
        let view = *mark(&settled, &format!("commentary-view:{pane}"));
        let text = *mark(&settled, &format!("commentary-text:{pane}"));
        let frame = *mark(&settled, &format!("commentary-frame:{pane}"));
        assert!(
            text[0] >= view[0] + 12.0,
            "left padding, text x {} view x {}",
            text[0],
            view[0]
        );
        assert!(
            text[1] >= view[1] + 8.0,
            "top padding, text y {} view y {}",
            text[1],
            view[1]
        );
        assert!(
            (view[0] + view[2]) - (text[0] + text[2]) >= 12.0,
            "right padding, text ends at {} view ends at {}",
            text[0] + text[2],
            view[0] + view[2]
        );
        assert!(
            (frame[1] + frame[3]) - (text[1] + text[3]) >= 20.0,
            "bottom padding, frame bottom {} text bottom {}",
            frame[1] + frame[3],
            text[1] + text[3]
        );
        assert!(
            frame[3] > view[3] + 28.0,
            "the commentary is taller than the viewport so it can scroll: frame {} view {}",
            frame[3],
            view[3]
        );
        let pointer = egui::pos2(view[0] + view[2] * 0.5, view[1] + view[3] * 0.5);
        let _ = study_frame(
            &ctx,
            &mut app,
            0.2,
            egui::Modifiers::default(),
            vec![egui::Event::PointerMoved(pointer)],
        );
        let _ = study_frame(
            &ctx,
            &mut app,
            0.3,
            egui::Modifiers::default(),
            vec![
                egui::Event::PointerMoved(pointer),
                egui::Event::MouseWheel {
                    unit: egui::MouseWheelUnit::Point,
                    delta: egui::vec2(0.0, -280.0),
                    modifiers: egui::Modifiers::default(),
                },
            ],
        );
        let scrolled = study_frame(&ctx, &mut app, 0.4, egui::Modifiers::default(), Vec::new());
        let moved = *mark(&scrolled, &format!("commentary-text:{pane}"));
        assert!(
            moved[1] < text[1] - 20.0,
            "wheel scrolls the commentary, y {} -> {}",
            text[1],
            moved[1]
        );
    }

    #[test]
    fn chapter_scroll_and_ctrl_click_stay_on_the_visible_rows() {
        let ctx = egui::Context::default();
        let mut app = bare(Session::new());
        app.loaded_key = ":10:1:pane-1".into();
        let line = "No princípio criou Deus os céus e a terra <S>7225</S> e a luz <S>216</S> sobre o abismo.";
        app.session.chapter_text = (1..=150).map(|verse| (verse, line.to_string())).collect();
        app.session.show_strongs = true;
        let _ = study_frame(&ctx, &mut app, 0.1, egui::Modifiers::default(), Vec::new());
        let warmed = study_frame(&ctx, &mut app, 0.2, egui::Modifiers::default(), Vec::new());
        assert!(
            app.reading.rows_painted > 0 && app.reading.rows_painted < 40,
            "a 150-verse chapter paints only the visible rows, painted {}",
            app.reading.rows_painted
        );
        let body = *mark(&warmed, "body:pane-1");
        let verse_one = *mark(&warmed, "verse:pane-1:1");
        let verse_two = *mark(&warmed, "verse:pane-1:2");
        assert!(
            verse_one[0] >= body[0] + 6.0,
            "the chapter text is inset from the pane edge"
        );
        let ctrl = egui::Modifiers {
            ctrl: true,
            ..Default::default()
        };
        let click = |pos: egui::Pos2| {
            vec![
                egui::Event::PointerMoved(pos),
                egui::Event::PointerButton {
                    pos,
                    button: egui::PointerButton::Primary,
                    pressed: true,
                    modifiers: ctrl,
                },
                egui::Event::PointerButton {
                    pos,
                    button: egui::PointerButton::Primary,
                    pressed: false,
                    modifiers: ctrl,
                },
            ]
        };
        let started = std::time::Instant::now();
        let mut time = 0.3;
        for frame in 0..24 {
            let (modifiers, events) = if frame == 0 {
                (
                    ctrl,
                    click(egui::pos2(
                        verse_one[0] + 48.0,
                        verse_one[1] + verse_one[3] * 0.5,
                    )),
                )
            } else if frame == 1 {
                (
                    ctrl,
                    click(egui::pos2(
                        verse_two[0] + 48.0,
                        verse_two[1] + verse_two[3] * 0.5,
                    )),
                )
            } else {
                (
                    egui::Modifiers::default(),
                    vec![
                        egui::Event::PointerMoved(egui::pos2(body[0] + 80.0, body[1] + 120.0)),
                        egui::Event::MouseWheel {
                            unit: egui::MouseWheelUnit::Point,
                            delta: egui::vec2(0.0, if frame % 2 == 0 { -90.0 } else { 70.0 }),
                            modifiers: egui::Modifiers::default(),
                        },
                    ],
                )
            };
            let _ = study_frame(&ctx, &mut app, time, modifiers, events);
            time += 1.0 / 60.0;
            assert!(
                app.reading.rows_painted > 0 && app.reading.rows_painted < 40,
                "frame {frame} painted {} rows",
                app.reading.rows_painted
            );
        }
        let elapsed = started.elapsed();
        assert!(
            app.session.selected_verses.len() >= 2,
            "ctrl-click keeps both verses, got {:?}",
            app.session.selected_verses
        );
        assert!(
            elapsed.as_millis() < 900,
            "scrolling and ctrl-selecting a long chapter took {} ms",
            elapsed.as_millis()
        );
    }
}
