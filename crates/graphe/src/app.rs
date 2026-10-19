//! egui workbench. Drawing lives in [`crate::study`], [`crate::side`], and [`crate::dialogs`].

use crate::paint::{self, canon_books};
use crate::session::{Dialog, Session};
use crate::startup::build_running_model;
use graphe_domain::app_state::AppStateStore;
use graphe_domain::books::GRAPHE_BOOK_NUMBERS;
use graphe_domain::commentary_ref::{
    build_reference_matcher, BookName as RefBookName, ReferenceMatcher,
};
use graphe_domain::i18n;
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
            paint::install_fonts(&cc.egui_ctx);
            paint::apply(&cc.egui_ctx, session.dark, session.font_size);
            Ok(Box::new(GrapheApp {
                session,
                modules,
                update_notice: std::sync::Arc::new(std::sync::Mutex::new(None)),
                update_started: false,
                persisted: running.persisted.clone(),
                store,
                nav: None,
                nav_focus: false,
                nav_input_rect: None,
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
                editor: ModuleEditorForm::default(),
                dict_info: None,
                reload_feedback: None,
                search_debounce: None,
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
    pub(crate) nav_focus: bool,
    pub(crate) nav_input_rect: Option<egui::Rect>,
    pub(crate) picker: Option<ModulePicker>,
    pub(crate) morphs: HashMap<PathBuf, LoadedMorph>,
    pub(crate) matcher: Option<ReferenceMatcher>,
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
    pub(crate) editor: ModuleEditorForm,
    pub(crate) dict_info: Option<crate::dialogs::DictInfoState>,
    pub(crate) reload_feedback: Option<std::time::Instant>,
    pub(crate) search_debounce: Option<std::time::Instant>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum EditorTab {
    Info,
    Books,
    Verses,
    Commentaries,
}

pub(crate) struct ModuleEditorForm {
    pub(crate) loaded: Option<PathBuf>,
    pub(crate) tab: EditorTab,
    pub(crate) tables: sqlite::TableAvailability,
    pub(crate) books: Vec<sqlite::EditableBook>,
    pub(crate) description: String,
    pub(crate) language: String,
    pub(crate) short_title: String,
    pub(crate) short_key: String,
    pub(crate) strong: bool,
    pub(crate) extras: Vec<(String, String)>,
    pub(crate) deleted_extras: Vec<String>,
    pub(crate) book: String,
    pub(crate) short_name: String,
    pub(crate) long_name: String,
    pub(crate) chapter: String,
    pub(crate) verse: String,
    pub(crate) verse_text: String,
    pub(crate) commentary_text: String,
    pub(crate) chapter_count: i64,
    pub(crate) verse_numbers: Vec<i64>,
    pub(crate) verse_cache_key: String,
    pub(crate) passage_key: String,
    pub(crate) status: String,
    pub(crate) status_ok: bool,
    pub(crate) armed: bool,
}

impl Default for ModuleEditorForm {
    fn default() -> Self {
        Self {
            loaded: None,
            tab: EditorTab::Info,
            tables: sqlite::TableAvailability::default(),
            books: Vec::new(),
            description: String::new(),
            language: String::new(),
            short_title: String::new(),
            short_key: "short.title".into(),
            strong: false,
            extras: Vec::new(),
            deleted_extras: Vec::new(),
            book: "10".into(),
            short_name: String::new(),
            long_name: String::new(),
            chapter: "1".into(),
            verse: "1".into(),
            verse_text: String::new(),
            commentary_text: String::new(),
            chapter_count: 0,
            verse_numbers: Vec::new(),
            verse_cache_key: String::new(),
            passage_key: String::new(),
            status: String::new(),
            status_ok: true,
            armed: false,
        }
    }
}

impl eframe::App for GrapheApp {
    fn ui(&mut self, ui: &mut egui::Ui, _frame: &mut eframe::Frame) {
        self.show_workbench(ui);
    }

    fn on_exit(&mut self) {
        self.note_workspaces();
        self.store.advance(1_000);
        let _ = state::save_state(&self.store.state);
    }
}

impl GrapheApp {
    /// Draw one workbench frame. Tests and `egui_kittest` call this directly.
    pub(crate) fn show_workbench(&mut self, ui: &mut egui::Ui) {
        let ctx = ui.ctx().clone();
        self.pump_update();
        self.flush_saves();
        let theme_changed = self.theme_ready && self.applied_dark != self.session.dark;
        let font_changed =
            self.theme_ready && (self.applied_font - self.session.font_size).abs() > 0.1;
        if !self.theme_ready || theme_changed || font_changed {
            paint::apply(&ctx, self.session.dark, self.session.font_size);
            self.applied_dark = self.session.dark;
            self.applied_font = self.session.font_size;
            self.theme_ready = true;
            // A font step only changes the shaped lines. Parsed chapters, cross
            // references, and commentary text stay, and the open rows keep a
            // scaled height so the click does not wrap the whole chapter.
            if font_changed && !theme_changed {
                self.reading.drop_shaped();
            } else {
                self.reading.clear();
            }
        }
        if let Some(text) = self.session.pending_copy.take() {
            ctx.copy_text(text);
        }
        self.restore_saved_panels();
        self.handle_keys(&ctx);
        let palette = theme::palette(self.session.dark);
        self.update_banner(ui, &palette);
        self.top_strip(ui, &palette);
        self.activity_bar(ui, &palette);
        self.pump_search(&ctx);
        self.sidebar(ui, &palette);
        self.editor(ui, &palette);
        self.dialogs(&ctx);
        self.drain_navigation(&ctx);
        self.drain_picker();
    }
}

pub(crate) fn label_has_selection(ctx: &egui::Context) -> bool {
    ctx.plugin_opt::<egui::text_selection::LabelSelectionState>()
        .is_some_and(|plugin| plugin.lock().has_selection())
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

    fn pump_search(&mut self, ctx: &egui::Context) {
        if let Some(deadline) = self.search_debounce {
            let now = std::time::Instant::now();
            if now >= deadline {
                self.search_debounce = None;
                self.run_search();
            } else {
                ctx.request_repaint_after(deadline.saturating_duration_since(now));
            }
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
        let cache_key = path
            .map(|path| format!("{}|{book}|{chapter}", path.display()))
            .unwrap_or_default();
        if !cache_key.is_empty() {
            if let Some(verses) = self.reading.cached_verse_text(&cache_key) {
                self.session.show_chapter(verses);
                return;
            }
        }
        let verses: Vec<(i64, String)> = path
            .map(|path| sqlite::chapter_in_file(path, book, chapter))
            .unwrap_or_default()
            .into_iter()
            .map(|verse| (verse.verse, verse.text))
            .collect();
        if !cache_key.is_empty() {
            self.reading.remember_verse_text(cache_key, verses.clone());
        }
        self.session.show_chapter(verses);
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
        let pane = self.session.navigation_target(&self.session.active_pane_id);
        let books = self.nav_books();
        let chapter_count_fn: Box<dyn FnMut(&str, i64) -> i64> =
            Box::new(move |_module: &str, book: i64| chapter_count(&modules, book));
        let verse_fn: Box<dyn FnMut(&str, i64, i64) -> Vec<i64>> =
            Box::new(move |_module: &str, book: i64, chapter: i64| {
                verse_numbers(&modules_verses, book, chapter)
            });
        let target = pane.clone();
        let pane_fn: Box<dyn FnMut(&str) -> Option<String>> =
            Box::new(move |id: &str| (id == target).then(|| "active".to_string()));
        let mut nav = NavigationSession::new(chapter_count_fn, verse_fn, pane_fn);
        nav.open_for(&pane, books);
        nav.input = self.session.nav_input.clone();
        self.nav = Some(nav);
        self.nav_focus = true;
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

    fn drain_navigation(&mut self, ctx: &egui::Context) {
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
        ctx.request_repaint();
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
        let text_focused = ctx.egui_wants_keyboard_input();
        let mut action = None;
        let mut copy_verses = false;
        ctx.input(|input| {
            let primary = input.modifiers.command || input.modifiers.ctrl;
            for event in &input.events {
                if matches!(event, egui::Event::Copy) {
                    // Ctrl+C arrives as a copy event, not as the C key.
                    copy_verses = true;
                    continue;
                }
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
        if copy_verses && !text_focused && !label_has_selection(ctx) {
            let text = self.session.copy_selection();
            if !text.is_empty() {
                self.session.status = text.clone();
                self.session.pending_copy = Some(text);
            }
        }
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

    fn activity_bar(&mut self, ui: &mut egui::Ui, palette: &UiPalette) {
        let bar = if self.session.dark {
            "#181818"
        } else {
            "#f2f0ea"
        };
        egui::Panel::left("activity")
            .exact_size(48.0)
            .resizable(false)
            .frame(paint::panel(bar).inner_margin(egui::Margin {
                left: 2,
                right: 2,
                top: 6,
                bottom: 6,
            }))
            .show(ui, |ui| {
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
                        let label = label_for(view);
                        let response = paint::icon_button(ui, icon, selected, palette);
                        let accessible = label.clone();
                        response.widget_info(|| {
                            egui::WidgetInfo::labeled(egui::Role::Button, true, accessible.clone())
                        });
                        if response.clicked() {
                            self.session.focus_sidebar(view);
                            self.note_workspaces();
                        }
                        paint::hover_tip(response, label);
                    }
                    let gap = (ui.available_height() - 48.0).max(0.0);
                    ui.allocate_space(egui::vec2(0.0, gap));
                    let label = i18n::t("settings");
                    let response = paint::icon_button(ui, paint::Icon::Settings, false, palette);
                    let accessible = label.clone();
                    response.widget_info(|| {
                        egui::WidgetInfo::labeled(egui::Role::Button, true, accessible.clone())
                    });
                    if response.clicked() {
                        self.session.dialog = Dialog::Settings;
                    }
                    paint::hover_tip(response, label);
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

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::RunTestUi;

    pub(crate) fn bare(session: Session) -> GrapheApp {
        GrapheApp {
            session,
            modules: Vec::new(),
            update_notice: std::sync::Arc::new(std::sync::Mutex::new(None)),
            update_started: true,
            persisted: json!({}),
            store: AppStateStore::new(),
            nav: None,
            nav_focus: false,
            nav_input_rect: None,
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
            editor: ModuleEditorForm::default(),
            dict_info: None,
            reload_feedback: None,
            search_debounce: None,
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
        dialog_frame_in(ctx, app, egui::vec2(1200.0, 800.0))
    }

    fn dialog_frame_in(
        ctx: &egui::Context,
        app: &mut GrapheApp,
        screen: egui::Vec2,
    ) -> (egui::FullOutput, Vec<(String, [f32; 4])>) {
        let mut style = (*ctx.global_style()).clone();
        style.animation_time = 0.0;
        ctx.set_global_style(style);
        let mut raw = egui::RawInput::default();
        raw.screen_rect = Some(egui::Rect::from_min_size(egui::Pos2::ZERO, screen));
        let mut marks = Vec::new();
        let output = ctx.run_test_ui(raw, |ctx| {
            ctx.data_mut(|data| {
                data.remove_temp::<Vec<(String, [f32; 4])>>(egui::Id::unique("pane-layout-marks"));
            });
            app.dialogs(ctx);
            marks = ctx.data(|data| {
                data.get_temp::<Vec<(String, [f32; 4])>>(egui::Id::unique("pane-layout-marks"))
                    .unwrap_or_default()
            });
        });
        (output, marks)
    }

    #[test]
    fn about_dialog_shows_the_wordmark_and_centers_the_links() {
        let ctx = egui::Context::default();
        let mut app = bare(Session::new());
        app.session.dialog = Dialog::About;
        let _ = dialog_frame(&ctx, &mut app);
        let (_, marks) = dialog_frame(&ctx, &mut app);
        let card = *mark(&marks, "about-card");
        let logo = *mark(&marks, "about-logo");
        let close = *mark(&marks, "modal-close");
        let github = *mark(&marks, "about-github");
        let issues = *mark(&marks, "about-issues");
        assert!(
            logo[3] > 24.0 && logo[2] > logo[3],
            "the wordmark is a wide image, not the broken icon: {logo:?}"
        );
        assert!(
            (logo[0] + logo[2] / 2.0 - (card[0] + card[2] / 2.0)).abs() < 24.0,
            "the wordmark is centered: logo {logo:?} card {card:?}"
        );
        let top_gap = close[1] - card[1];
        let right_gap = (card[0] + card[2]) - (close[0] + close[2]);
        assert!(
            (top_gap - right_gap).abs() < 0.6,
            "top and right insets differ: top {top_gap} right {right_gap}"
        );
        assert!(
            (top_gap - 20.0).abs() < 0.6,
            "close inset is 20px: top {top_gap} right {right_gap}"
        );
        assert!(
            (github[1] - issues[1]).abs() < 1.0,
            "the two links share a row: {github:?} {issues:?}"
        );
        let pair_mid = (github[0] + issues[0] + issues[2]) / 2.0;
        let card_mid = card[0] + card[2] / 2.0;
        assert!(
            (pair_mid - card_mid).abs() < 12.0,
            "GitHub and Report sit in the middle: pair {pair_mid} card {card_mid}"
        );
        assert!(
            !marks.iter().any(|(key, _)| key == "about-footer-close"),
            "the footer close button is gone"
        );
    }

    #[test]
    fn navigation_picker_uses_the_electron_book_grid() {
        let ctx = egui::Context::default();
        let mut app = bare(Session::new());
        i18n::set_lang("pt");
        app.open_navigation();
        let _ = dialog_frame(&ctx, &mut app);
        let (_output, marks) = dialog_frame(&ctx, &mut app);
        let input = *mark(&marks, "nav-input");
        assert!(
            input[3] >= 40.0,
            "the reference field is a full input: {input:?}"
        );
        let books: Vec<_> = marks
            .iter()
            .filter(|(key, _)| key.starts_with("nav-cell:"))
            .take(5)
            .collect();
        assert_eq!(books.len(), 5, "five books on the first row: {marks:?}");
        let row = books[0].1[1];
        for (key, rect) in &books {
            assert!(
                (rect[1] - row).abs() < 1.0,
                "{key} left the first row: {rect:?}"
            );
            assert!(
                (rect[3] - 44.0).abs() < 1.0,
                "{key} is not a 44px tile: {rect:?}"
            );
        }
        for pair in books.windows(2) {
            let gap = pair[1].1[0] - (pair[0].1[0] + pair[0].1[2]);
            assert!(
                (gap - 6.0).abs() < 1.5,
                "book tiles are not 6px apart: {gap}"
            );
        }
        let genesis = *mark(&marks, "nav-cell:Gn");
        let at = egui::pos2(genesis[0] + genesis[2] * 0.5, genesis[1] + genesis[3] * 0.5);
        let mut raw = egui::RawInput::default();
        raw.screen_rect = Some(egui::Rect::from_min_size(
            egui::Pos2::ZERO,
            egui::vec2(1200.0, 800.0),
        ));
        raw.events = vec![
            egui::Event::PointerMoved(at),
            egui::Event::PointerButton {
                pos: at,
                button: egui::PointerButton::Primary,
                pressed: true,
                modifiers: egui::Modifiers::default(),
            },
            egui::Event::PointerButton {
                pos: at,
                button: egui::PointerButton::Primary,
                pressed: false,
                modifiers: egui::Modifiers::default(),
            },
        ];
        let _ = ctx.run_test_ui(raw, |ctx| {
            app.dialogs(ctx);
        });
        let (_, chapter_marks) = dialog_frame(&ctx, &mut app);
        let chapters: Vec<_> = chapter_marks
            .iter()
            .filter(|(key, _)| key.starts_with("nav-cell:"))
            .take(8)
            .collect();
        assert_eq!(
            chapters.len(),
            8,
            "chapters sit eight across: {chapter_marks:?}"
        );
        let chapter_row = chapters[0].1[1];
        for (key, rect) in &chapters {
            assert!(
                (rect[1] - chapter_row).abs() < 1.0,
                "{key} left the first chapter row"
            );
            assert!((rect[3] - 44.0).abs() < 1.0, "{key} is not a 44px tile");
        }
    }

    #[test]
    fn navigation_dialog_shows_books_without_scroll_and_centers_close() {
        let ctx = egui::Context::default();
        let mut app = bare(Session::new());
        i18n::set_lang("pt");
        app.open_navigation();
        let screen = egui::vec2(1400.0, 1000.0);
        let _ = dialog_frame_in(&ctx, &mut app, screen);
        let (_, marks) = dialog_frame_in(&ctx, &mut app, screen);
        let card = *mark(&marks, "modal-card");
        let input = *mark(&marks, "nav-input");
        let close = *mark(&marks, "modal-close");
        let state = *mark(&marks, "nav-scroll-state");
        let content_h = state[2];
        let viewport_h = state[3];
        assert!(
            content_h <= viewport_h + 1.0,
            "the book grid scrolls: content {content_h} viewport {viewport_h}"
        );
        let cells: Vec<_> = marks
            .iter()
            .filter(|(key, _)| key.starts_with("nav-cell:"))
            .collect();
        assert!(!cells.is_empty(), "the book grid paints tiles");
        let bottom = cells
            .iter()
            .map(|(_, rect)| rect[1] + rect[3])
            .fold(0.0_f32, f32::max);
        assert!(
            bottom <= card[1] + card[3] + 1.0,
            "the last book is clipped: bottom {bottom} card {card:?}"
        );
        let input_mid = input[1] + input[3] / 2.0;
        let close_mid = close[1] + close[3] / 2.0;
        assert!(
            (input_mid - close_mid).abs() < 1.5,
            "the close sits with the field: input {input:?} close {close:?}"
        );
        let right_gap = (card[0] + card[2]) - (close[0] + close[2]);
        assert!(
            (right_gap - 20.0).abs() < 0.6,
            "the close keeps its right inset: {right_gap}"
        );
    }

    #[test]
    fn ctrl_c_copies_the_selected_verses() {
        let ctx = egui::Context::default();
        let mut app = bare(Session::new());
        app.session.show_chapter(vec![
            (1, "In the beginning".into()),
            (2, "And the earth".into()),
        ]);
        app.session.selected_verses = vec![1, 2];
        let mut raw = egui::RawInput::default();
        raw.screen_rect = Some(egui::Rect::from_min_size(
            egui::Pos2::ZERO,
            egui::vec2(800.0, 600.0),
        ));
        raw.events.push(egui::Event::Copy);
        let _ = ctx.run_test_ui(raw, |ctx| app.handle_keys(ctx));
        assert_eq!(
            app.session.pending_copy.as_deref(),
            Some("[Gn 1:1] In the beginning\n[Gn 1:2] And the earth")
        );
    }

    #[test]
    fn settings_card_is_fully_visible_on_the_frame_after_it_opens() {
        let ctx = egui::Context::default();
        let mut app = bare(Session::new());
        app.session.dialog = Dialog::Settings;
        let screen = egui::vec2(1200.0, 800.0);
        let show = |ctx: &egui::Context, app: &mut GrapheApp| {
            let mut raw = egui::RawInput::default();
            raw.screen_rect = Some(egui::Rect::from_min_size(egui::Pos2::ZERO, screen));
            ctx.run_test_ui(raw, |ctx| app.dialogs(ctx))
        };
        let _ = show(&ctx, &mut app);
        let output = show(&ctx, &mut app);
        let paper = paint::color("#fefdf9");
        let painted = output
            .shapes
            .iter()
            .any(|clipped| shape_has_paper(&clipped.shape, paper));
        assert!(
            painted,
            "the settings card is at full strength, not fading in"
        );
    }

    #[test]
    fn cross_reference_settings_show_without_a_strong_dictionary() {
        i18n::set_lang("pt");
        let ctx = egui::Context::default();
        let mut app = bare(Session::new());
        app.modules.push(graphe_store::catalog::InstalledModule {
            id: "tsk".into(),
            name: "The Treasury of Scripture Knowledge".into(),
            kind: "crossreference".into(),
            path: std::path::PathBuf::from("tsk.crossreference.SQLite3"),
            short_title: Some("TSK".into()),
            description: None,
        });
        app.session.dialog = Dialog::Settings;
        let _ = dialog_frame(&ctx, &mut app);
        let (_, marks) = dialog_frame(&ctx, &mut app);
        let card = *mark(&marks, "modal-card");
        let heading = *mark(&marks, "settings-crossrefs");
        assert!(
            marks.iter().all(|(key, _)| key != "settings-strongs"),
            "a Strong's dictionary is not installed, so that section stays hidden"
        );
        let end = *mark(&marks, "settings-crossrefs-end");
        let card_bottom = card[1] + card[3];
        assert!(
            heading[1] >= card[1] && end[1] <= card_bottom + 1.0,
            "cross-reference settings must be on the card without a Strong module: heading {heading:?} end {end:?} card {card:?}"
        );

        app.session.dialog = Dialog::About;
        let _ = dialog_frame(&ctx, &mut app);
        let _ = dialog_frame(&ctx, &mut app);
        app.session.dialog = Dialog::Settings;
        let _ = dialog_frame(&ctx, &mut app);
        let (_, after_about) = dialog_frame(&ctx, &mut app);
        let card = *mark(&after_about, "modal-card");
        let heading = *mark(&after_about, "settings-crossrefs");
        let end = *mark(&after_about, "settings-crossrefs-end");
        let card_bottom = card[1] + card[3];
        assert!(
            heading[1] >= card[1] && end[1] <= card_bottom + 1.0,
            "cross-reference settings stay visible after a shorter dialog: heading {heading:?} end {end:?} card {card:?}"
        );
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
        close_sits_like_the_about_x(&marks);
        assert!(
            marks.iter().all(|(key, _)| key != "settings-close"),
            "settings has no footer close button"
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
        let _ = ctx.run_test_ui(raw, |ctx| {
            app.dialogs(ctx);
        });
        assert!(app.session.dark, "the theme control toggles light and dark");
        assert_eq!(app.store.settings()["theme"], "dark");
    }

    #[test]
    fn settings_dropdowns_render_with_unified_dropdown_style() {
        let ctx = egui::Context::default();
        let mut app = bare(Session::new());
        app.session.dialog = Dialog::Settings;
        let _ = dialog_frame(&ctx, &mut app);
        let (output, marks) = dialog_frame(&ctx, &mut app);

        let font_dd = mark(&marks, "dropdown:font-size");
        let lang_dd = mark(&marks, "dropdown:language");
        assert_eq!(
            font_dd[2], 72.0,
            "font size dropdown has consistent 72px width"
        );
        assert_eq!(
            lang_dd[2], 72.0,
            "language dropdown has consistent 72px width"
        );

        // Verify active label is painted on the trigger
        assert!(
            galley_has(&output, "20px"),
            "active font size is displayed on dropdown"
        );
        assert!(
            galley_has(&output, "PT"),
            "active language is displayed on dropdown"
        );

        // Click language dropdown to open popup
        let pos = egui::pos2(lang_dd[0] + lang_dd[2] * 0.5, lang_dd[1] + lang_dd[3] * 0.5);
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
        let _ = ctx.run_test_ui(raw, |ctx| {
            app.dialogs(ctx);
        });
        let frame_output = ctx.run_test_ui(egui::RawInput::default(), |ctx| {
            app.dialogs(ctx);
        });

        // The dropdown popup is open and renders options with the unified elevated surface
        let palette = theme::palette(app.session.dark);
        let elevated = paint::color(palette.ui_surface_elevated);
        let painted_elevated = frame_output
            .shapes
            .iter()
            .any(|clipped| match &clipped.shape {
                egui::Shape::Rect(rect) => rect.fill == elevated,
                egui::Shape::Vec(shapes) => shapes.iter().any(|s| match s {
                    egui::Shape::Rect(r) => r.fill == elevated,
                    _ => false,
                }),
                _ => false,
            });
        assert!(
            painted_elevated,
            "language dropdown popup uses elevated surface paper"
        );
        assert!(
            galley_has(&frame_output, "EN"),
            "language dropdown displays EN option"
        );
        assert!(
            galley_has(&frame_output, "ES"),
            "language dropdown displays ES option"
        );
    }

    fn close_sits_like_the_about_x(marks: &[(String, [f32; 4])]) {
        let card = *mark(marks, "modal-card");
        let close = *mark(marks, "modal-close");
        let top_gap = close[1] - card[1];
        let right_gap = (card[0] + card[2]) - (close[0] + close[2]);
        assert!(
            (top_gap - right_gap).abs() < 0.6,
            "top and right insets differ: top {top_gap} right {right_gap} close {close:?} card {card:?}"
        );
        assert!(
            (top_gap - 20.0).abs() < 0.6,
            "close inset is 20px: top {top_gap} right {right_gap}"
        );
    }

    #[test]
    fn reference_preview_paints_the_bible_line_and_grows_to_the_verse() {
        let screen = egui::vec2(1400.0, 1000.0);
        let ctx = egui::Context::default();
        let mut app = bare(Session::new());
        app.modules.push(graphe_store::catalog::InstalledModule {
            id: "notes".into(),
            name: "Notes".into(),
            kind: "commentary".into(),
            path: std::path::PathBuf::from("missing.commentaries.SQLite3"),
            short_title: None,
            description: None,
        });
        app.session.coverage_module_id = Some("notes".into());
        app.session.dialog = Dialog::Coverage;
        let _ = dialog_frame_in(&ctx, &mut app, screen);
        let (_, coverage) = dialog_frame_in(&ctx, &mut app, screen);
        let coverage_h = mark(&coverage, "modal-card")[3];

        app.session.show_strongs = true;
        app.session.preview_book = 470;
        app.session.preview_verse = Some(3);
        app.session.preview_title = "Mt 20:3".into();
        app.session.preview_body =
            "E, saindo <S>1831</S><m>V-2AAP-NSM</m><l>ἐξέρχομαι</l> perto da hora ".repeat(14);
        app.session.dialog = Dialog::Preview;
        let _ = dialog_frame_in(&ctx, &mut app, screen);
        let (output, marks) = dialog_frame_in(&ctx, &mut app, screen);
        let card = *mark(&marks, "modal-card");
        let verse = *mark(&marks, "preview-verse");
        let painted = collected_text(&output);
        assert!(
            painted.contains("G1831"),
            "the preview should show the Strong's number like the Bible: {painted}"
        );
        assert!(
            !painted.contains("V-2AAP-NSM") && !painted.contains("ἐξέρχομαι"),
            "morphology and the lemma belong on the number, not in the sentence: {painted}"
        );
        assert!(
            verse[1] + verse[3] <= card[1] + card[3] + 1.0,
            "the verse is clipped inside the card: verse {verse:?} card {card:?}"
        );
        let chrome = 57.0 + 32.0;
        assert!(
            card[3] + 8.0 >= chrome + verse[3] && card[3] + 40.0 < coverage_h,
            "the card should hug the verse, not the previous dialog: card {} verse {} coverage {coverage_h}",
            card[3],
            verse[3]
        );
    }

    fn collected_text(output: &egui::FullOutput) -> String {
        fn walk(shape: &egui::Shape, out: &mut String) {
            match shape {
                egui::Shape::Text(text) => {
                    out.push_str(&text.galley.job.text);
                    out.push('\n');
                }
                egui::Shape::Vec(list) => {
                    for shape in list {
                        walk(shape, out);
                    }
                }
                _ => {}
            }
        }
        let mut out = String::new();
        for clipped in &output.shapes {
            walk(&clipped.shape, &mut out);
        }
        out
    }

    #[test]
    fn settings_hugs_its_rows_after_a_tall_modal() {
        i18n::set_lang("pt");
        let screen = egui::vec2(1400.0, 1000.0);
        let ctx = egui::Context::default();
        let mut app = bare(Session::new());
        app.modules.push(graphe_store::catalog::InstalledModule {
            id: "notes".into(),
            name: "Notes".into(),
            kind: "commentary".into(),
            path: std::path::PathBuf::from("missing.commentaries.SQLite3"),
            short_title: None,
            description: None,
        });
        app.session.coverage_module_id = Some("notes".into());
        app.session.dialog = Dialog::Coverage;
        let _ = dialog_frame_in(&ctx, &mut app, screen);
        let (_, coverage) = dialog_frame_in(&ctx, &mut app, screen);
        close_sits_like_the_about_x(&coverage);
        let coverage_h = mark(&coverage, "modal-card")[3];

        app.session.dialog = Dialog::Settings;
        let _ = dialog_frame_in(&ctx, &mut app, screen);
        let (_, settings) = dialog_frame_in(&ctx, &mut app, screen);
        close_sits_like_the_about_x(&settings);
        let settings_h = mark(&settings, "modal-card")[3];
        assert!(
            settings_h + 80.0 < coverage_h,
            "settings kept the coverage card's empty space: settings {settings_h} coverage {coverage_h}"
        );

        let close = *mark(&settings, "modal-close");
        let at = egui::pos2(close[0] + close[2] * 0.5, close[1] + close[3] * 0.5);
        let _ = dialog_frame_in(&ctx, &mut app, screen);
        let mut raw = egui::RawInput::default();
        raw.screen_rect = Some(egui::Rect::from_min_size(egui::Pos2::ZERO, screen));
        raw.events = click(at);
        let _ = ctx.run_test_ui(raw, |ctx| app.dialogs(ctx));
        assert_eq!(app.session.dialog, Dialog::None);

        for dialog in [
            Dialog::About,
            Dialog::Convert,
            Dialog::Preview,
            Dialog::AllCommentaries,
            Dialog::Picker,
            Dialog::ModuleEditor,
        ] {
            app.session.dialog = dialog.clone();
            let _ = dialog_frame_in(&ctx, &mut app, screen);
            let (_, marks) = dialog_frame_in(&ctx, &mut app, screen);
            close_sits_like_the_about_x(&marks);
        }
        app.session.dialog = Dialog::Navigation;
        let _ = dialog_frame_in(&ctx, &mut app, screen);
        let (_, marks) = dialog_frame_in(&ctx, &mut app, screen);
        let card = *mark(&marks, "modal-card");
        let input = *mark(&marks, "nav-input");
        let close = *mark(&marks, "modal-close");
        let right_gap = (card[0] + card[2]) - (close[0] + close[2]);
        assert!(
            (right_gap - 20.0).abs() < 0.6,
            "navigation keeps its right inset: {right_gap}"
        );
        let input_mid = input[1] + input[3] / 2.0;
        let close_mid = close[1] + close[3] / 2.0;
        assert!(
            (input_mid - close_mid).abs() < 1.5,
            "navigation centers with the field: input {input:?} close {close:?}"
        );
    }

    #[test]
    fn convert_dialog_hugs_the_description_like_electron() {
        i18n::set_lang("pt");
        let screen = egui::vec2(1400.0, 1000.0);
        let ctx = egui::Context::default();
        let mut app = bare(Session::new());
        app.modules.push(graphe_store::catalog::InstalledModule {
            id: "notes".into(),
            name: "Notes".into(),
            kind: "commentary".into(),
            path: std::path::PathBuf::from("missing.commentaries.SQLite3"),
            short_title: None,
            description: None,
        });
        app.session.coverage_module_id = Some("notes".into());
        app.session.dialog = Dialog::Coverage;
        let _ = dialog_frame_in(&ctx, &mut app, screen);
        let (_, coverage_marks) = dialog_frame_in(&ctx, &mut app, screen);
        let coverage = *mark(&coverage_marks, "modal-card");
        assert!(
            coverage[3] > 300.0,
            "coverage has to be tall so a stuck modal would show, got {coverage:?}"
        );

        app.session.dialog = Dialog::Convert;
        let _ = dialog_frame_in(&ctx, &mut app, screen);
        let (_, marks) = dialog_frame_in(&ctx, &mut app, screen);
        let card = *mark(&marks, "modal-card");
        let desc = *mark(&marks, "convert-desc");
        let files = *mark(&marks, "convert-files");
        let folder = *mark(&marks, "convert-folder");
        assert!(
            (card[2] - 600.0).abs() < 2.0,
            "convert card is 600px wide, got {card:?}"
        );
        assert!(
            card[3] < 260.0,
            "convert hugs the description after a tall dialog, coverage {coverage:?} card {card:?}"
        );
        assert!(folder[0] > files[0], "files then folder, left to right");
        let right_gap = (card[0] + card[2]) - (folder[0] + folder[2]);
        assert!(
            (right_gap - 16.0).abs() < 4.0,
            "the folder button sits on the right padding, gap {right_gap}"
        );
        let below = (card[1] + card[3]) - (folder[1] + folder[3]);
        assert!(
            (8.0..24.0).contains(&below),
            "the buttons sit on the footer, not in the middle of the card, below {below}"
        );
        let gap = files[1] - (desc[1] + desc[3]);
        assert!(
            gap < 48.0,
            "the buttons follow the description, gap {gap} desc {desc:?} files {files:?}"
        );
        let install = *mark(&marks, "convert-install");
        assert!(
            install[0] + install[2] <= files[0] + 1.0,
            "checkbox does not overflow into action buttons: install right {} files left {}",
            install[0] + install[2],
            files[0]
        );
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
            let _ = ctx.run_test_ui(raw.clone(), |ctx| {
                app.editor(ctx, palette);
                marks = ctx.data(|data| {
                    data.get_temp::<Vec<(String, [f32; 4])>>(egui::Id::unique("pane-layout-marks"))
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
    fn side_by_side_divider_stays_still_while_the_pointer_rests_on_it() {
        let ctx = egui::Context::default();
        let mut app = bare(Session::new());
        app.session.split(false);
        app.session.active_pane_id = "pane-1".into();
        app.loaded_key = ":10:1:pane-1".into();
        app.session.chapter_text = (1..=80)
            .map(|verse| {
                (
                    verse,
                    "In the beginning God created the heaven and the earth.".into(),
                )
            })
            .collect();
        let mut time = 0.1;
        let _ = study_frame(&ctx, &mut app, time, egui::Modifiers::default(), Vec::new());
        time += 0.05;
        let mut marks = study_frame(&ctx, &mut app, time, egui::Modifiers::default(), Vec::new());
        let handle = *mark(&marks, "split-handle:x:");
        let at = egui::pos2(handle[0] + handle[2] * 0.5, handle[1] + handle[3] * 0.5);
        let mut widths = Vec::new();
        let mut handle_x = Vec::new();
        for _ in 0..8 {
            time += 0.05;
            marks = study_frame(
                &ctx,
                &mut app,
                time,
                egui::Modifiers::default(),
                vec![egui::Event::PointerMoved(at)],
            );
            widths.push(mark(&marks, "toolbar:pane-1")[2]);
            handle_x.push(mark(&marks, "split-handle:x:")[0]);
        }
        let span = |values: &[f32]| {
            let min = values.iter().copied().fold(f32::MAX, f32::min);
            let max = values.iter().copied().fold(f32::MIN, f32::max);
            max - min
        };
        assert!(
            span(&widths) < 1.0,
            "the left bible jumps while the pointer rests on the divider: {widths:?}"
        );
        assert!(
            span(&handle_x) < 1.0,
            "the divider itself jumps under the pointer: {handle_x:?}"
        );
    }

    #[test]
    fn splits_resize_side_by_side_and_the_commentary_edge() {
        let ctx = egui::Context::default();
        let mut app = bare(Session::new());
        let below = app.session.split(true);
        app.session.panes.get_mut(&below).unwrap().pane_type =
            graphe_domain::model::PaneType::Commentary;
        app.session.active_pane_id = "pane-1".into();
        let right = app.session.split(false);
        let palette = theme::palette(false);
        let marks = |app: &mut GrapheApp, time: f64, events: Vec<egui::Event>| {
            let mut raw = egui::RawInput::default();
            raw.screen_rect = Some(egui::Rect::from_min_size(
                egui::Pos2::ZERO,
                egui::vec2(1200.0, 800.0),
            ));
            raw.time = Some(time);
            raw.events = events;
            let mut marks = Vec::new();
            let _ = ctx.run_test_ui(raw, |ctx| {
                app.editor(ctx, palette);
                marks = ctx.data(|data| {
                    data.get_temp::<Vec<(String, [f32; 4])>>(egui::Id::unique("pane-layout-marks"))
                        .unwrap_or_default()
                });
            });
            marks
        };
        let settled = marks(&mut app, 0.1, Vec::new());
        let left = *mark(&settled, "toolbar:pane-1");
        let lower = *mark(&settled, &format!("toolbar:{below}"));
        let column = *mark(&settled, "split-handle:x:0");
        let edge = *mark(&settled, "split-handle:y:");
        assert!(
            column[2] >= 5.0 && column[3] > 40.0,
            "the side-by-side divider can be grabbed: {column:?}"
        );
        assert!(
            edge[3] >= 5.0 && edge[2] > 40.0,
            "the commentary's top edge can be grabbed: {edge:?}"
        );
        let column_at = egui::pos2(column[0] + column[2] * 0.5, column[1] + column[3] * 0.5);
        let _ = marks(&mut app, 0.2, vec![egui::Event::PointerMoved(column_at)]);
        let _ = marks(
            &mut app,
            0.3,
            vec![egui::Event::PointerButton {
                pos: column_at,
                button: egui::PointerButton::Primary,
                pressed: true,
                modifiers: egui::Modifiers::default(),
            }],
        );
        let pulled = column_at + egui::vec2(90.0, 0.0);
        let _ = marks(&mut app, 0.4, vec![egui::Event::PointerMoved(pulled)]);
        let widened = marks(&mut app, 0.5, Vec::new());
        let left_after = *mark(&widened, "toolbar:pane-1");
        let right_after = *mark(&widened, &format!("toolbar:{right}"));
        assert!(
            left_after[2] > left[2] + 40.0,
            "dragging the left divider widens that bible: {left:?} -> {left_after:?}"
        );
        assert!(
            right_after[0] > left[0] + left[2] + 40.0,
            "the bible beside it moves with the divider"
        );
        let _ = marks(
            &mut app,
            0.6,
            vec![egui::Event::PointerButton {
                pos: pulled,
                button: egui::PointerButton::Primary,
                pressed: false,
                modifiers: egui::Modifiers::default(),
            }],
        );
        let edge = *mark(&widened, "split-handle:y:");
        let edge_at = egui::pos2(edge[0] + edge[2] * 0.5, edge[1] + edge[3] * 0.5);
        let _ = marks(&mut app, 0.7, vec![egui::Event::PointerMoved(edge_at)]);
        let _ = marks(
            &mut app,
            0.8,
            vec![egui::Event::PointerButton {
                pos: edge_at,
                button: egui::PointerButton::Primary,
                pressed: true,
                modifiers: egui::Modifiers::default(),
            }],
        );
        let dropped = edge_at + egui::vec2(0.0, 80.0);
        let _ = marks(&mut app, 0.9, vec![egui::Event::PointerMoved(dropped)]);
        let lowered = marks(&mut app, 1.0, Vec::new());
        let lower_after = *mark(&lowered, &format!("toolbar:{below}"));
        assert!(
            lower_after[1] > lower[1] + 40.0,
            "dragging the commentary edge downward gives the bibles more height: {lower:?} -> {lower_after:?}"
        );
        assert!(
            lower_after[3] > 40.0 && lower_after[1] + lower_after[3] < 800.0,
            "the commentary keeps its toolbar on screen: {lower_after:?}"
        );
    }

    #[test]
    fn commentary_reflow_waits_until_the_pane_width_settles() {
        let ctx = egui::Context::default();
        let mut app = bare(Session::new());
        let below = app.session.split(true);
        app.session.panes.get_mut(&below).unwrap().pane_type =
            graphe_domain::model::PaneType::Commentary;
        app.session.active_pane_id = "pane-1".into();
        let right = app.session.split(false);
        app.loaded_key = format!(":10:1:{right}");
        app.session.chapter_text = (1..=80)
            .map(|verse| {
                (
                    verse,
                    "No princípio criou Deus os céus e a terra e viu que era bom.".into(),
                )
            })
            .collect();
        let path = std::path::PathBuf::from("notes.commentaries.SQLite3");
        app.modules.push(graphe_store::catalog::InstalledModule {
            id: "notes".into(),
            name: "Notes".into(),
            kind: "commentary".into(),
            path: path.clone(),
            short_title: None,
            description: None,
        });
        if let Some(record) = app.session.panes.get_mut(&below) {
            record.module_id = Some("notes".into());
        }
        let paragraph = "A graça e a verdade vieram por Jesus Cristo. ".repeat(30);
        let pieces = vec![crate::study::CommentaryPiece::Text(paragraph)];
        let key = crate::study::commentary_key(&path, 10, 1, i18n::get_current_lang().as_str());
        app.reading
            .commentary
            .insert(key, crate::study::CommentaryPaint::new(pieces));
        let frame = |app: &mut GrapheApp, time: f64, width: f32, events: Vec<egui::Event>| {
            let mut raw = egui::RawInput::default();
            raw.screen_rect = Some(egui::Rect::from_min_size(
                egui::Pos2::ZERO,
                egui::vec2(width, 800.0),
            ));
            raw.time = Some(time);
            raw.events = events;
            let _ = ctx.run_test_ui(raw, |ctx| {
                app.editor(ctx, theme::palette(false));
            });
        };
        frame(&mut app, 0.1, 1200.0, Vec::new());
        let layouts = app.reading.commentary_layouts;
        let measures = app.reading.chapter_measures;
        assert_eq!(
            layouts, 1,
            "the commentary lays out once when the width is new"
        );
        assert!(
            measures >= 1,
            "the open chapters are measured once before the drag"
        );
        for (step, width) in [1100.0, 1000.0, 900.0, 800.0].into_iter().enumerate() {
            frame(&mut app, 0.2 + step as f64 * 0.05, width, Vec::new());
            assert_eq!(
                app.reading.commentary_layouts, layouts,
                "width {width} must not reflow the commentary while it is still changing"
            );
            assert_eq!(
                app.reading.chapter_measures, measures,
                "width {width} must not remeasure every verse in the open chapters"
            );
        }
        frame(&mut app, 0.5, 800.0, Vec::new());
        assert_eq!(
            app.reading.commentary_layouts,
            layouts + 1,
            "one commentary reflow after the width settles"
        );
        assert_eq!(
            app.reading.chapter_measures,
            measures + 2,
            "each bible pane measures once after the width settles"
        );
        frame(&mut app, 0.6, 800.0, Vec::new());
        assert_eq!(
            app.reading.commentary_layouts,
            layouts + 1,
            "a stable width reuses the commentary galley"
        );
        assert_eq!(
            app.reading.chapter_measures,
            measures + 2,
            "a stable width reuses the chapter row heights"
        );
        let held = egui::pos2(240.0, 240.0);
        frame(
            &mut app,
            0.7,
            800.0,
            vec![egui::Event::PointerButton {
                pos: held,
                button: egui::PointerButton::Primary,
                pressed: true,
                modifiers: egui::Modifiers::default(),
            }],
        );
        frame(
            &mut app,
            0.8,
            760.0,
            vec![egui::Event::PointerMoved(held + egui::vec2(-40.0, 0.0))],
        );
        frame(&mut app, 0.9, 760.0, Vec::new());
        frame(&mut app, 1.0, 760.0, Vec::new());
        assert_eq!(
            app.reading.commentary_layouts,
            layouts + 1,
            "holding the pointer on one width must not reflow the commentary"
        );
        assert_eq!(
            app.reading.chapter_measures,
            measures + 2,
            "holding the pointer on one width must not remeasure the chapters"
        );
        frame(
            &mut app,
            1.1,
            760.0,
            vec![egui::Event::PointerButton {
                pos: held + egui::vec2(-40.0, 0.0),
                button: egui::PointerButton::Primary,
                pressed: false,
                modifiers: egui::Modifiers::default(),
            }],
        );
        assert_eq!(
            app.reading.commentary_layouts,
            layouts + 2,
            "releasing the pointer reflows the commentary once"
        );
        assert_eq!(
            app.reading.chapter_measures,
            measures + 4,
            "releasing the pointer measures each bible pane once"
        );
    }

    #[test]
    fn switching_back_to_a_commentary_does_not_lay_it_out_again() {
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
        let key = crate::study::commentary_key(&path, 10, 1, i18n::get_current_lang().as_str());
        let paint = |text: &str| {
            crate::study::CommentaryPaint::new(vec![crate::study::CommentaryPiece::Text(
                text.into(),
            )])
        };
        app.reading.commentary.insert(
            key.clone(),
            paint("A graça e a verdade vieram por Jesus Cristo."),
        );
        let frame = |app: &mut GrapheApp, time: f64| {
            let mut raw = egui::RawInput::default();
            raw.screen_rect = Some(egui::Rect::from_min_size(
                egui::Pos2::ZERO,
                egui::vec2(1200.0, 800.0),
            ));
            raw.time = Some(time);
            let _ = ctx.run_test_ui(raw, |ctx| {
                app.editor(ctx, theme::palette(false));
            });
        };
        frame(&mut app, 0.1);
        assert_eq!(app.reading.commentary_layouts, 1);
        app.reading.commentary.insert(
            key.clone(),
            paint("Outro estudo, com outro comentário mais longo sobre o capítulo."),
        );
        frame(&mut app, 0.2);
        assert_eq!(app.reading.commentary_layouts, 2);
        app.reading
            .commentary
            .insert(key, paint("A graça e a verdade vieram por Jesus Cristo."));
        frame(&mut app, 0.3);
        assert_eq!(
            app.reading.commentary_layouts, 2,
            "returning to the first study reuses its commentary galley"
        );
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
            let _ = ctx.run_test_ui(raw.clone(), |ctx| {
                app.editor(ctx, palette);
                marks = ctx.data(|data| {
                    data.get_temp::<Vec<(String, [f32; 4])>>(egui::Id::unique("pane-layout-marks"))
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
            marks
                .iter()
                .any(|(key, _)| key == &format!("options:{below}")),
            "the commentary toolbar can split too: {marks:?}"
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
                let _ = ctx.run_test_ui(raw, |ctx| {
                    let palette = theme::palette(app.session.dark);
                    app.sidebar(ctx, palette);
                });
                let state = egui::containers::panel::PanelState::load(&ctx, sidebar_panel_id());
                assert_eq!(
                    state.map(|s| s.outer_rect.width()),
                    Some(300.0),
                    "View {} grew at frame {}",
                    view,
                    frame
                );
            }
        }
    }

    fn dictionary_with_strong_entry() -> GrapheApp {
        let mut app = bare(Session::from_state(&json!({
            "workbench": {"activeView": "dictionary"}
        })));
        app.session.sidebar = "dictionary".into();
        app.session.dict_query = "G3063".into();
        app.session.dict_module_id = Some("strong-pt".into());
        app.modules = vec![graphe_store::catalog::InstalledModule {
            id: "strong-pt".into(),
            name: "Strong-PT - Dicionários BDB, Thayer e TVM".into(),
            kind: "dictionary".into(),
            path: std::path::PathBuf::from("Strong PT Dicionarios BDB Thayer e TVM.dictionary"),
            short_title: None,
            description: None,
        }];
        app.session.dict_entry = Some(
            [
                ("lexeme".into(), "λοιπόν".into()),
                ("transliteration".into(), "loipón".into()),
                ("pronunciation".into(), "loy-pon'".into()),
                ("short_definition".into(), String::new()),
            ]
            .into_iter()
            .collect(),
        );
        app.session.dict_morph_code = Some("A-ASN".into());
        app.session.dict_morph_lemma = Some("λοιπόν".into());
        app.session.dict_morph_meaning =
            Some("Classe: Adjetivo | Caso: Acusativo | Número: Singular | Gênero: Neutro".into());
        app.session.dict_body = format!(
            "<p>loipon singular neutro do mesmo que G3062 adv n 1 remanescente o resto {} {}</p>",
            "palavra ".repeat(40),
            "X".repeat(2000)
        );
        app.session.dict_cognates = vec!["G3062".into(), "G3588".into(), "G2240".into()];
        app
    }

    fn show_dictionary_frame(ctx: &egui::Context, app: &mut GrapheApp) -> (f32, f32, f32) {
        let mut raw = egui::RawInput::default();
        raw.screen_rect = Some(egui::Rect::from_min_size(
            egui::Pos2::ZERO,
            egui::vec2(1400.0, 900.0),
        ));
        let mut central_left = 0.0;
        let output = ctx.run_test_ui(raw, |ctx| {
            let palette = theme::palette(false);
            app.activity_bar(ctx, palette);
            app.sidebar(ctx, palette);
            egui::CentralPanel::default()
                .frame(egui::Frame::new().inner_margin(egui::Margin::ZERO))
                .show(ctx, |ui| {
                    central_left = ui.max_rect().left();
                });
        });
        let width = egui::containers::panel::PanelState::load(ctx, sidebar_panel_id())
            .map(|state| state.outer_rect.width())
            .unwrap_or(0.0);
        let mut meaning_right = 0.0_f32;
        for clipped in &output.shapes {
            meaning_right = meaning_right.max(text_right(&clipped.shape, "Gênero: Neutro"));
        }
        (width, central_left, meaning_right)
    }

    fn text_right(shape: &egui::Shape, needle: &str) -> f32 {
        match shape {
            egui::Shape::Text(text) if text.galley.job.text.contains(needle) => {
                text.pos.x + text.galley.rect.right()
            }
            egui::Shape::Vec(list) => list
                .iter()
                .map(|shape| text_right(shape, needle))
                .fold(0.0, f32::max),
            _ => 0.0,
        }
    }

    #[test]
    fn strong_lookup_keeps_the_sidebar_width_and_leaves_no_gap() {
        let ctx = egui::Context::default();
        let mut app = dictionary_with_strong_entry();
        let (width, central_left, meaning_right) = show_dictionary_frame(&ctx, &mut app);
        let side =
            egui::containers::panel::PanelState::load(&ctx, sidebar_panel_id()).expect("sidebar");
        assert!(
            (width - 300.0).abs() < 1.0,
            "opening a Strong's entry resized the sidebar to {width}"
        );
        assert!(
            (central_left - side.outer_rect.right()).abs() < 1.0,
            "study pane starts at {central_left}, sidebar ends at {}",
            side.outer_rect.right()
        );
        assert!(
            meaning_right > side.outer_rect.left()
                && meaning_right <= side.outer_rect.right() + 1.0,
            "morphology runs to {meaning_right}, outside sidebar {}",
            side.outer_rect.right()
        );

        for wanted in [420.0_f32, 260.0] {
            ctx.data_mut(|data| {
                data.insert_persisted(
                    sidebar_panel_id(),
                    egui::containers::panel::PanelState {
                        outer_rect: egui::Rect::from_min_size(
                            egui::pos2(48.0, 0.0),
                            egui::vec2(wanted, 900.0),
                        ),
                    },
                );
            });
            let (width, central_left, meaning_right) = show_dictionary_frame(&ctx, &mut app);
            let side = egui::containers::panel::PanelState::load(&ctx, sidebar_panel_id())
                .expect("sidebar");
            assert!(
                (width - wanted).abs() < 1.0,
                "sidebar snapped from {wanted} to {width} while a Strong's entry was open"
            );
            assert!(
                (central_left - side.outer_rect.right()).abs() < 1.0,
                "gap beside a {wanted}px sidebar: study at {central_left}, sidebar at {}",
                side.outer_rect.right()
            );
            assert!(
                meaning_right > side.outer_rect.left()
                    && meaning_right <= side.outer_rect.right() + 1.0,
                "morphology runs to {meaning_right}, outside a {wanted}px sidebar ending at {}",
                side.outer_rect.right()
            );
        }
    }

    /// egui 0.37 panel ids are children of the root `Ui`, not `Id::unique("sidebar")`.
    fn sidebar_panel_id() -> egui::Id {
        egui::ViewportId::ROOT.root_ui_id().with("sidebar")
    }

    fn sidebar_frame(
        ctx: &egui::Context,
        app: &mut GrapheApp,
        events: Vec<egui::Event>,
    ) -> Vec<(String, [f32; 4])> {
        let mut style = (*ctx.global_style()).clone();
        style.animation_time = 0.0;
        ctx.set_global_style(style);
        let mut raw = egui::RawInput::default();
        raw.screen_rect = Some(egui::Rect::from_min_size(
            egui::Pos2::ZERO,
            egui::vec2(1200.0, 800.0),
        ));
        raw.focused = true;
        raw.events = events;
        let mut marks = Vec::new();
        let _ = ctx.run_test_ui(raw, |ctx| {
            let palette = theme::palette(false);
            app.sidebar(ctx, palette);
            marks = ctx.data(|data| {
                data.get_temp::<Vec<(String, [f32; 4])>>(egui::Id::unique("pane-layout-marks"))
                    .unwrap_or_default()
            });
        });
        marks
    }

    fn dialog_events(
        ctx: &egui::Context,
        app: &mut GrapheApp,
        events: Vec<egui::Event>,
    ) -> (egui::FullOutput, Vec<(String, [f32; 4])>) {
        let mut style = (*ctx.global_style()).clone();
        style.animation_time = 0.0;
        ctx.set_global_style(style);
        let mut raw = egui::RawInput::default();
        raw.screen_rect = Some(egui::Rect::from_min_size(
            egui::Pos2::ZERO,
            egui::vec2(1200.0, 800.0),
        ));
        raw.focused = true;
        raw.events = events;
        let mut marks = Vec::new();
        let output = ctx.run_test_ui(raw, |ctx| {
            ctx.data_mut(|data| {
                data.remove_temp::<Vec<(String, [f32; 4])>>(egui::Id::unique("pane-layout-marks"));
            });
            app.dialogs(ctx);
            marks = ctx.data(|data| {
                data.get_temp::<Vec<(String, [f32; 4])>>(egui::Id::unique("pane-layout-marks"))
                    .unwrap_or_default()
            });
        });
        (output, marks)
    }

    fn galley_has(output: &egui::FullOutput, needle: &str) -> bool {
        fn walk(shape: &egui::Shape, needle: &str) -> bool {
            match shape {
                egui::Shape::Text(text) => text.galley.job.text.contains(needle),
                egui::Shape::Vec(shapes) => shapes.iter().any(|shape| walk(shape, needle)),
                _ => false,
            }
        }
        output
            .shapes
            .iter()
            .any(|clipped| walk(&clipped.shape, needle))
    }

    fn center_of(rect: &[f32; 4]) -> egui::Pos2 {
        egui::pos2(rect[0] + rect[2] * 0.5, rect[1] + rect[3] * 0.5)
    }

    fn click_dialog(
        ctx: &egui::Context,
        app: &mut GrapheApp,
        marks: &[(String, [f32; 4])],
        key: &str,
    ) {
        let at = center_of(mark(marks, key));
        let (_, hovered) = dialog_events(ctx, app, vec![egui::Event::PointerMoved(at)]);
        let at = center_of(mark(&hovered, key));
        let _ = dialog_events(ctx, app, click(at));
    }

    #[test]
    fn dictionary_info_button_opens_the_dictionary_browser() {
        i18n::set_lang("pt");
        let dir = std::env::temp_dir().join(format!("graphe-dict-info-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("Strong PT Dicionarios BDB Thayer e TVM.dictionary.SQLite3");
        sqlite::init_module_sql(
            &path,
            "CREATE TABLE info (name TEXT, value TEXT);
             CREATE TABLE dictionary (topic TEXT, definition TEXT);
             INSERT INTO info VALUES ('short.title', 'Strong-PT - Dicionários BDB, Thayer e TVM');
             INSERT INTO info VALUES ('description', 'Dicionários BDB, Thayer e TVM');
             INSERT INTO info VALUES ('is_strong', 'true');
             INSERT INTO dictionary VALUES ('G1', 'um'), ('G10', 'dez'), ('H100', 'cem');",
        )
        .expect("dictionary fixture");
        let mut app = bare(Session::new());
        app.session.sidebar = "dictionary".into();
        app.modules = catalog::scan_modules(&dir);
        assert_eq!(app.modules.len(), 1);
        let module_name = app.modules[0].name.clone();
        let module_id = app.modules[0].id.clone();
        assert_eq!(
            module_id,
            "Strong PT Dicionarios BDB Thayer e TVM.dictionary"
        );
        let ctx = egui::Context::default();
        let _ = sidebar_frame(&ctx, &mut app, Vec::new());
        let marks = sidebar_frame(&ctx, &mut app, Vec::new());
        let at = center_of(mark(&marks, "dict-info-button"));
        let _ = sidebar_frame(&ctx, &mut app, vec![egui::Event::PointerMoved(at)]);
        let _ = sidebar_frame(&ctx, &mut app, click(at));
        assert_eq!(app.session.dialog, Dialog::DictInfo);

        let _ = dialog_frame(&ctx, &mut app);
        let _ = dialog_frame(&ctx, &mut app);
        let (output, marks) = dialog_frame(&ctx, &mut app);
        assert!(
            !marks.iter().any(|(key, _)| key == "about-logo"),
            "the dictionary button must not open About"
        );
        let card = *mark(&marks, "modal-card");
        assert!(
            (card[2] - 760.0).abs() < 8.0,
            "the browser is 760px wide: {card:?}"
        );
        close_sits_like_the_about_x(&marks);
        let usage_y = mark(&marks, "dict-info-usage")[1];
        let available_y = mark(&marks, "dict-info-available")[1];
        let browse_y = mark(&marks, "dict-info-browse")[1];
        assert!(
            usage_y < available_y && available_y < browse_y,
            "usage, availability, then browse: {usage_y} {available_y} {browse_y}"
        );
        let usage_title = i18n::t("dictUsageTitle").to_uppercase();
        let available_title = i18n::t("dictAvailableTitle").to_uppercase();
        let browse_title = i18n::t("dictBrowseTitle").to_uppercase();
        let usage_line = format!(
            "{} ({})",
            i18n::t("dictUsageBody"),
            i18n::t("strongsDictionaries")
        );
        let count_line = i18n::t("dictTotalWords").replace("{count}", "3");
        let random_label = i18n::t("dictRandomSample");
        let prefix_hint = i18n::t("dictBrowsePlaceholder");
        for needle in [
            module_name.as_str(),
            module_id.as_str(),
            usage_title.as_str(),
            available_title.as_str(),
            browse_title.as_str(),
            usage_line.as_str(),
            count_line.as_str(),
            random_label.as_str(),
            prefix_hint.as_str(),
        ] {
            assert!(
                galley_has(&output, needle),
                "missing {needle:?} in the dictionary info modal"
            );
        }
        for topic in ["G1", "G10", "H100"] {
            assert!(
                marks
                    .iter()
                    .any(|(key, _)| key == &format!("dict-info-topic:{topic}")),
                "missing topic {topic}: {marks:?}"
            );
        }
        assert!(
            marks
                .iter()
                .any(|(key, _)| key.starts_with("dict-info-chip:")),
            "the random sample is missing: {marks:?}"
        );

        let next = *mark(&marks, "dict-info-next");
        let card_now = *mark(&marks, "modal-card");
        assert!(
            next[0] >= card_now[0]
                && next[0] + next[2] <= card_now[0] + card_now[2] + 1.0
                && next[1] >= card_now[1]
                && next[1] + next[3] <= card_now[1] + card_now[3] + 1.0,
            "next sits inside the card: next {next:?} card {card_now:?}"
        );
        click_dialog(&ctx, &mut app, &marks, "dict-info-next");
        let (_, stayed) = dialog_frame(&ctx, &mut app);
        assert!(
            stayed.iter().any(|(key, _)| key == "dict-info-topic:G1"),
            "next is disabled on a short page; dialog {:?} marks {:?}",
            app.session.dialog,
            stayed
                .iter()
                .map(|(key, _)| key.as_str())
                .collect::<Vec<_>>()
        );
        assert_eq!(app.session.dialog, Dialog::DictInfo);

        let chip_key = stayed
            .iter()
            .find(|(key, _)| key.starts_with("dict-info-chip:"))
            .map(|(key, _)| key.clone())
            .expect("chip");
        let chip_topic = chip_key.splitn(3, ':').nth(2).unwrap().to_string();
        click_dialog(&ctx, &mut app, &stayed, &chip_key);
        assert_eq!(app.session.dialog, Dialog::None);
        assert!(app.dict_info.is_none());
        assert_eq!(app.session.dict_query, chip_topic);
        assert!(app.session.dict_entry.is_some());

        let marks = sidebar_frame(&ctx, &mut app, Vec::new());
        let at = center_of(mark(&marks, "dict-info-button"));
        let _ = sidebar_frame(&ctx, &mut app, click(at));
        assert_eq!(app.session.dialog, Dialog::DictInfo);
        let _ = dialog_frame(&ctx, &mut app);
        let _ = dialog_frame(&ctx, &mut app);
        let (_, marks) = dialog_frame(&ctx, &mut app);
        click_dialog(&ctx, &mut app, &marks, "dict-info-prefix");
        let _ = dialog_events(&ctx, &mut app, vec![egui::Event::Text("H".into())]);
        let (_, filtered) = dialog_frame(&ctx, &mut app);
        let topics: Vec<_> = filtered
            .iter()
            .filter(|(key, _)| key.starts_with("dict-info-topic:"))
            .map(|(key, _)| key.as_str())
            .collect();
        assert_eq!(
            topics,
            vec!["dict-info-topic:H100"],
            "prefix H keeps only H100, got {topics:?}"
        );
        click_dialog(&ctx, &mut app, &filtered, "dict-info-topic:H100");
        assert_eq!(app.session.dialog, Dialog::None);
        assert_eq!(app.session.dict_query, "H100");
        assert_eq!(
            app.session
                .dict_entry
                .as_ref()
                .and_then(|entry| entry.get("definition"))
                .map(String::as_str),
            Some("cem")
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn dictionary_info_without_a_module_stays_closed() {
        i18n::set_lang("pt");
        let ctx = egui::Context::default();
        let mut app = bare(Session::new());
        app.session.sidebar = "dictionary".into();
        let _ = sidebar_frame(&ctx, &mut app, Vec::new());
        let marks = sidebar_frame(&ctx, &mut app, Vec::new());
        let at = center_of(mark(&marks, "dict-info-button"));
        let _ = sidebar_frame(&ctx, &mut app, click(at));
        assert_eq!(app.session.dialog, Dialog::None);
        assert!(app.dict_info.is_none());
    }

    #[test]
    fn each_split_direction_offers_a_bible_and_a_commentary() {
        let ctx = egui::Context::default();
        let mut app = bare(Session::new());
        let shown = study_frame(&ctx, &mut app, 0.1, egui::Modifiers::default(), Vec::new());
        let menu = open_pane_menu(&ctx, &mut app, 0.2, mark(&shown, "options:pane-1"));
        for key in [
            "split-h-bible:pane-1",
            "split-h-commentary:pane-1",
            "split-v-bible:pane-1",
            "split-v-commentary:pane-1",
        ] {
            assert!(
                menu.iter().any(|(name, _)| name == key),
                "missing {key} in {menu:?}"
            );
        }
        click_mark(&ctx, &mut app, 0.6, &menu, "split-v-commentary:pane-1");
        let commentary = app
            .session
            .panes
            .iter()
            .find(|(_, pane)| pane.pane_type == graphe_domain::model::PaneType::Commentary)
            .map(|(id, _)| id.clone())
            .expect("vertical split opens a commentary");
        match &app.session.tree {
            graphe_domain::model::PaneNode::Split { direction, .. } => {
                assert_eq!(direction, "v", "the commentary stacks under the bible");
            }
            graphe_domain::model::PaneNode::Leaf { .. } => panic!("expected a vertical split"),
        }
        let shown = study_frame(&ctx, &mut app, 1.0, egui::Modifiers::default(), Vec::new());
        let menu = open_pane_menu(
            &ctx,
            &mut app,
            1.1,
            mark(&shown, &format!("options:{commentary}")),
        );
        let bible_key = format!("split-h-bible:{commentary}");
        assert!(
            menu.iter().any(|(name, _)| name == &bible_key),
            "a commentary pane can split horizontally into a bible: {menu:?}"
        );
        let commentary_key = format!("split-v-commentary:{commentary}");
        assert!(
            menu.iter().any(|(name, _)| name == &commentary_key),
            "a commentary pane can split vertically into a commentary: {menu:?}"
        );
        click_mark(&ctx, &mut app, 1.5, &menu, &bible_key);
        match split_holding(&app.session.tree, &commentary) {
            Some((direction, sibling)) => {
                assert_eq!(direction, "h");
                assert_eq!(
                    app.session.panes[&sibling].pane_type,
                    graphe_domain::model::PaneType::Bible
                );
            }
            None => panic!("commentary was not split: {:?}", app.session.tree),
        }
    }

    fn open_pane_menu(
        ctx: &egui::Context,
        app: &mut GrapheApp,
        time: f64,
        options: &[f32; 4],
    ) -> Vec<(String, [f32; 4])> {
        let at = egui::pos2(options[0] + options[2] * 0.5, options[1] + options[3] * 0.5);
        let _ = study_frame(
            ctx,
            app,
            time,
            egui::Modifiers::default(),
            vec![egui::Event::PointerMoved(at)],
        );
        let _opened = study_frame(ctx, app, time + 0.05, egui::Modifiers::default(), click(at));
        // The popup learns its size on the click frame and may move on the next one.
        let settled = study_frame(ctx, app, time + 0.1, egui::Modifiers::default(), Vec::new());
        if settled
            .iter()
            .any(|(key, _)| key.starts_with("split-h-bible:"))
        {
            return settled;
        }
        study_frame(
            ctx,
            app,
            time + 0.15,
            egui::Modifiers::default(),
            Vec::new(),
        )
    }

    fn click_mark(
        ctx: &egui::Context,
        app: &mut GrapheApp,
        time: f64,
        marks: &[(String, [f32; 4])],
        key: &str,
    ) {
        let rect = mark(marks, key);
        let mut at = egui::pos2(rect[0] + rect[2] * 0.5, rect[1] + rect[3] * 0.5);
        let hovered = study_frame(
            ctx,
            app,
            time,
            egui::Modifiers::default(),
            vec![egui::Event::PointerMoved(at)],
        );
        if let Some((_, rect)) = hovered.iter().find(|(name, _)| name == key) {
            at = egui::pos2(rect[0] + rect[2] * 0.5, rect[1] + rect[3] * 0.5);
        }
        let _ = study_frame(ctx, app, time + 0.05, egui::Modifiers::default(), click(at));
    }

    fn click(at: egui::Pos2) -> Vec<egui::Event> {
        vec![
            egui::Event::PointerButton {
                pos: at,
                button: egui::PointerButton::Primary,
                pressed: true,
                modifiers: egui::Modifiers::default(),
            },
            egui::Event::PointerButton {
                pos: at,
                button: egui::PointerButton::Primary,
                pressed: false,
                modifiers: egui::Modifiers::default(),
            },
        ]
    }

    fn split_holding(
        node: &graphe_domain::model::PaneNode,
        pane_id: &str,
    ) -> Option<(String, String)> {
        let graphe_domain::model::PaneNode::Split {
            direction,
            children,
            ..
        } = node
        else {
            return None;
        };
        let leaf = |child: &graphe_domain::model::PaneNode| match child {
            graphe_domain::model::PaneNode::Leaf { pane_id } => Some(pane_id.clone()),
            graphe_domain::model::PaneNode::Split { .. } => None,
        };
        if leaf(&children.0).as_deref() == Some(pane_id) {
            if let Some(sibling) = leaf(&children.1) {
                return Some((direction.clone(), sibling));
            }
        }
        if leaf(&children.1).as_deref() == Some(pane_id) {
            if let Some(sibling) = leaf(&children.0) {
                return Some((direction.clone(), sibling));
            }
        }
        split_holding(&children.0, pane_id).or_else(|| split_holding(&children.1, pane_id))
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
        raw.events.push(egui::Event::ModifiersChanged(modifiers));
        raw.events.extend(events);
        let palette = theme::palette(false);
        let mut marks = Vec::new();
        let _ = ctx.run_test_ui(raw, |ctx| {
            app.editor(ctx, palette);
            marks = ctx.data(|data| {
                data.get_temp::<Vec<(String, [f32; 4])>>(egui::Id::unique("pane-layout-marks"))
                    .unwrap_or_default()
            });
        });
        marks
    }

    fn study_frame_output(
        ctx: &egui::Context,
        app: &mut GrapheApp,
        time: f64,
        modifiers: egui::Modifiers,
        events: Vec<egui::Event>,
    ) -> (egui::FullOutput, Vec<(String, [f32; 4])>) {
        let mut raw = egui::RawInput::default();
        raw.screen_rect = Some(egui::Rect::from_min_size(
            egui::Pos2::ZERO,
            egui::vec2(1200.0, 800.0),
        ));
        raw.time = Some(time);
        raw.events.push(egui::Event::ModifiersChanged(modifiers));
        raw.events.extend(events);
        let palette = theme::palette(false);
        let mut marks = Vec::new();
        let output = ctx.run_test_ui(raw, |ctx| {
            app.editor(ctx, palette);
            marks = ctx.data(|data| {
                data.get_temp::<Vec<(String, [f32; 4])>>(egui::Id::unique("pane-layout-marks"))
                    .unwrap_or_default()
            });
        });
        (output, marks)
    }

    #[test]
    fn commentary_badge_lists_the_bible_views_it_can_follow() {
        i18n::set_lang("pt");
        let ctx = egui::Context::default();
        let mut app = bare(Session::new());
        app.session.sidebar_collapsed = true;
        let other = app.session.split(false);
        app.session.active_pane_id = "pane-1".into();
        let commentary = app.session.split_commentary(false);
        let _ = study_frame(&ctx, &mut app, 0.0, egui::Modifiers::default(), Vec::new());
        let marks = study_frame(&ctx, &mut app, 0.1, egui::Modifiers::default(), Vec::new());
        let badge = format!("sync-badge:{commentary}");
        click_mark(&ctx, &mut app, 0.2, &marks, &badge);
        let menu = study_frame(&ctx, &mut app, 0.4, egui::Modifiers::default(), Vec::new());
        assert!(
            menu.iter()
                .any(|(key, _)| key == &format!("sync-none:{commentary}")),
            "the badge offers none: {menu:?}"
        );
        let other_key = format!("sync-bible:{commentary}:{other}");
        assert!(
            menu.iter().any(|(key, _)| key == &other_key),
            "the badge lists the other Bible view: {menu:?}"
        );
        let none = *mark(&menu, &format!("sync-none:{commentary}"));
        assert!(
            none[2] < 140.0,
            "the sync menu hugs the labels, width {}",
            none[2]
        );
        click_mark(&ctx, &mut app, 0.5, &menu, &other_key);
        assert_eq!(
            app.session.panes[&commentary].synced_to_pane_id.as_deref(),
            Some(other.as_str())
        );
    }

    #[test]
    fn commentary_empty_label_fills_the_pane_body() {
        let ctx = egui::Context::default();
        let mut app = bare(Session::new());
        app.session.sidebar_collapsed = true;
        let commentary = app.session.split_commentary(false);
        let _ = study_frame(&ctx, &mut app, 0.0, egui::Modifiers::default(), Vec::new());
        let marks = study_frame(&ctx, &mut app, 0.1, egui::Modifiers::default(), Vec::new());
        let body = *mark(&marks, &format!("body:{commentary}"));
        let empty = *mark(&marks, &format!("commentary-empty:{commentary}"));
        assert!(
            (empty[2] - body[2]).abs() < 4.0,
            "the empty commentary fills the pane width, body {body:?}, empty {empty:?}"
        );
        assert!(
            (empty[3] - body[3]).abs() < 8.0,
            "the empty commentary fills the pane height, body {body:?}, empty {empty:?}"
        );
        assert!(
            (empty[0] - body[0]).abs() < 4.0 && (empty[1] - body[1]).abs() < 8.0,
            "the empty commentary starts at the body origin, body {body:?}, empty {empty:?}"
        );
    }

    #[test]
    fn bible_empty_label_fills_the_pane_body() {
        let ctx = egui::Context::default();
        let mut app = bare(Session::new());
        app.session.sidebar_collapsed = true;
        app.session.chapter_text.clear();
        let pane = app.session.active_pane_id.clone();
        let _ = study_frame(&ctx, &mut app, 0.0, egui::Modifiers::default(), Vec::new());
        let marks = study_frame(&ctx, &mut app, 0.1, egui::Modifiers::default(), Vec::new());
        let body = *mark(&marks, &format!("body:{pane}"));
        let empty = *mark(&marks, &format!("bible-empty:{pane}"));
        assert!(
            (empty[2] - body[2]).abs() < 4.0,
            "the empty bible fills the pane width, body {body:?}, empty {empty:?}"
        );
        assert!(
            (empty[3] - body[3]).abs() < 8.0,
            "the empty bible fills the pane height, body {body:?}, empty {empty:?}"
        );
        assert!(
            (empty[0] - body[0]).abs() < 4.0 && (empty[1] - body[1]).abs() < 8.0,
            "the empty bible starts at the body origin, body {body:?}, empty {empty:?}"
        );
    }

    #[test]
    fn bible_empty_shows_book_and_chapter_unavailable_messages() {
        i18n::set_lang("pt");
        let ctx = egui::Context::default();
        let mut app = bare(Session::new());
        app.session.sidebar_collapsed = true;

        let dir = std::env::temp_dir().join(format!("graphe-empty-bible-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("ot.SQLite3");
        let sql = "CREATE TABLE books (book_number INTEGER, short_name TEXT, long_name TEXT); \
                   INSERT INTO books VALUES (10, 'Gn', 'Gênesis'); \
                   CREATE TABLE verses (book_number INTEGER, chapter INTEGER, verse INTEGER, text TEXT); \
                   INSERT INTO verses VALUES (10, 1, 1, 'No princípio...');";
        graphe_store::sqlite::init_module_sql(&path, sql).unwrap();
        app.modules.push(graphe_store::catalog::InstalledModule {
            id: "ot".into(),
            name: "OT Only".into(),
            kind: "bible".into(),
            path: path.clone(),
            short_title: Some("OT".into()),
            description: None,
        });
        let pane = app.session.active_pane_id.clone();
        app.session.panes.get_mut(&pane).unwrap().module_id = Some("ot".into());

        // 1. Matthew (470) is missing from the module -> book unavailable
        app.session.panes.get_mut(&pane).unwrap().book_number = 470;
        app.session.panes.get_mut(&pane).unwrap().chapter = 11;
        app.session.chapter_text.clear();
        app.loaded_key.clear();

        let mut raw = egui::RawInput::default();
        raw.screen_rect = Some(egui::Rect::from_min_size(
            egui::Pos2::ZERO,
            egui::vec2(1200.0, 800.0),
        ));
        let output = ctx.run_test_ui(raw.clone(), |ctx| {
            app.editor(ctx, theme::palette(false));
        });
        let _ = first_text_y(&output, &i18n::t("bookUnavailable"));

        // 2. Genesis (10) chapter 99 is missing from the module -> chapter unavailable
        app.session.panes.get_mut(&pane).unwrap().book_number = 10;
        app.session.panes.get_mut(&pane).unwrap().chapter = 99;
        app.session.chapter_text.clear();
        app.loaded_key.clear();

        let output2 = ctx.run_test_ui(raw, |ctx| {
            app.editor(ctx, theme::palette(false));
        });
        let _ = first_text_y(&output2, &i18n::t("chapterUnavailable"));

        let _ = std::fs::remove_dir_all(&dir);
    }

    fn mark<'a>(marks: &'a [(String, [f32; 4])], key: &str) -> &'a [f32; 4] {
        marks
            .iter()
            .find(|(name, _)| name == key)
            .map(|(_, rect)| rect)
            .unwrap_or_else(|| panic!("missing {key} in {marks:?}"))
    }

    fn wheel_down(at: egui::Pos2) -> Vec<egui::Event> {
        vec![
            egui::Event::PointerMoved(at),
            egui::Event::MouseWheel {
                unit: egui::MouseWheelUnit::Point,
                delta: egui::vec2(0.0, -480.0),
                phase: egui::TouchPhase::Move,
                source: egui::MouseWheelSource::Unknown,
                modifiers: egui::Modifiers::default(),
            },
        ]
    }

    fn first_text_y(output: &egui::FullOutput, needle: &str) -> f32 {
        fn walk(shape: &egui::Shape, needle: &str) -> Option<f32> {
            match shape {
                egui::Shape::Text(text) if text.galley.job.text.contains(needle) => {
                    Some(text.pos.y)
                }
                egui::Shape::Vec(list) => list.iter().find_map(|shape| walk(shape, needle)),
                _ => None,
            }
        }
        output
            .shapes
            .iter()
            .find_map(|clipped| walk(&clipped.shape, needle))
            .unwrap_or_else(|| panic!("missing text {needle}"))
    }

    #[test]
    fn selecting_a_verse_does_not_scroll_the_other_bible() {
        let ctx = egui::Context::default();
        let mut app = bare(Session::new());
        app.session.sidebar_collapsed = true;
        let dir = std::env::temp_dir().join(format!("graphe-two-bibles-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("kjv.SQLite3");
        let mut sql = String::from(
            "CREATE TABLE verses (book_number INTEGER, chapter INTEGER, verse INTEGER, text TEXT);",
        );
        for verse in 1..=80 {
            sql.push_str(&format!(
                "INSERT INTO verses VALUES (10, 1, {verse}, 'Verse {verse} of the chapter.');\n"
            ));
        }
        graphe_store::sqlite::init_module_sql(&path, &sql).unwrap();
        app.modules.push(graphe_store::catalog::InstalledModule {
            id: "kjv".into(),
            name: "KJV".into(),
            kind: "bible".into(),
            path: path.clone(),
            short_title: Some("KJV".into()),
            description: None,
        });
        app.session.panes.get_mut("pane-1").unwrap().module_id = Some("kjv".into());
        let other = app.session.split(false);
        let _ = study_frame(&ctx, &mut app, 0.1, egui::Modifiers::default(), Vec::new());
        let shown = study_frame(&ctx, &mut app, 0.2, egui::Modifiers::default(), Vec::new());
        let right = *mark(&shown, &format!("body:{other}"));
        let at = egui::pos2(right[0] + right[2] * 0.5, right[1] + 80.0);
        let mut time = 0.3;
        let mut scrolled = shown;
        for _ in 0..6 {
            scrolled = study_frame(
                &ctx,
                &mut app,
                time,
                egui::Modifiers::default(),
                wheel_down(at),
            );
            time += 0.1;
        }
        let before = *mark(&scrolled, &format!("chapter-offset:{other}"));
        assert!(
            before[1] > 200.0,
            "Bible B should be away from the top before the click, offset {} content {} viewport {}",
            before[1],
            before[0],
            before[2]
        );
        let last_on_b = scrolled
            .iter()
            .filter_map(|(key, rect)| {
                key.strip_prefix(&format!("verse:{other}:"))
                    .and_then(|verse| verse.parse::<i64>().ok())
                    .map(|verse| (verse, *rect))
            })
            .max_by_key(|(verse, _)| *verse)
            .expect("a visible verse on Bible B");
        let click_b = egui::pos2(last_on_b.1[0] + 40.0, last_on_b.1[1] + last_on_b.1[3] * 0.5);
        let _ = study_frame(
            &ctx,
            &mut app,
            time,
            egui::Modifiers::default(),
            click(click_b),
        );
        time += 0.1;
        assert_eq!(
            app.session.active_pane_id, other,
            "selecting Bible B should activate it, selection {:?}",
            app.session.selected_verses
        );
        let selected_b = study_frame(&ctx, &mut app, time, egui::Modifiers::default(), Vec::new());
        time += 0.1;
        let held = *mark(&selected_b, &format!("chapter-offset:{other}"));
        assert!(
            held[1] > 200.0,
            "selecting the last visible verse on Bible B jumped it to {}",
            held[1]
        );
        let left_verse = *mark(&selected_b, "verse:pane-1:1");
        let click_a = egui::pos2(left_verse[0] + 40.0, left_verse[1] + left_verse[3] * 0.5);
        let _ = study_frame(
            &ctx,
            &mut app,
            time,
            egui::Modifiers::default(),
            click(click_a),
        );
        assert_eq!(
            app.session.active_pane_id, "pane-1",
            "the verse click should activate Bible A, selection {:?}",
            app.session.selected_verses
        );
        time += 0.1;
        let after = study_frame(&ctx, &mut app, time, egui::Modifiers::default(), Vec::new());
        let moved = *mark(&after, &format!("chapter-offset:{other}"));
        assert!(
            (moved[1] - held[1]).abs() < 2.0,
            "selecting verse 1 on Bible A moved Bible B from {} to {} (content {} viewport {})",
            held[1],
            moved[1],
            moved[0],
            moved[2]
        );

        let left = *mark(&after, "body:pane-1");
        let left_at = egui::pos2(left[0] + left[2] * 0.5, left[1] + 80.0);
        let mut both = after;
        for _ in 0..6 {
            time += 0.1;
            both = study_frame(
                &ctx,
                &mut app,
                time,
                egui::Modifiers::default(),
                wheel_down(left_at),
            );
        }
        let left_before = *mark(&both, "chapter-offset:pane-1");
        let right_before = *mark(&both, &format!("chapter-offset:{other}"));
        assert!(
            left_before[1] > 200.0 && right_before[1] > 200.0,
            "both bibles should be away from the top, A {} B {}",
            left_before[1],
            right_before[1]
        );
        app.session.active_pane_id = "pane-1".into();
        app.session.scroll_verse = Some(1);
        app.session.scroll_center = false;
        time += 0.1;
        let revealed = study_frame(&ctx, &mut app, time, egui::Modifiers::default(), Vec::new());
        let left_after = *mark(&revealed, "chapter-offset:pane-1");
        let right_after = *mark(&revealed, &format!("chapter-offset:{other}"));
        assert!(
            (right_after[1] - right_before[1]).abs() < 2.0,
            "scrolling Bible A to verse 1 moved Bible B from {} to {}",
            right_before[1],
            right_after[1]
        );
        assert!(
            left_after[1] + 20.0 < left_before[1],
            "Bible A should move toward verse 1, from {} to {}",
            left_before[1],
            left_after[1]
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Two translations of one chapter share a width. The pane that loses the
    /// selection used to adopt the other translation's row heights and clamp
    /// its scroll offset, which threw a Bible that was far down back upward.
    #[test]
    fn selecting_a_verse_keeps_the_other_translations_scroll() {
        let ctx = egui::Context::default();
        let mut app = bare(Session::new());
        app.session.sidebar_collapsed = true;
        let dir =
            std::env::temp_dir().join(format!("graphe-two-translations-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let long_path = dir.join("long.SQLite3");
        let short_path = dir.join("short.SQLite3");
        let long_line = "No principio criou Deus os ceus e a terra. ".repeat(14);
        write_chapter(&long_path, 40, |verse| format!("{verse} {long_line}"));
        write_chapter(&short_path, 40, |verse| format!("Amen {verse}."));
        app.modules.push(bible_module("long", "Long", long_path));
        app.modules.push(bible_module("short", "Short", short_path));
        app.session.panes.get_mut("pane-1").unwrap().module_id = Some("long".into());
        let other = app.session.split(false);
        app.session.panes.get_mut(&other).unwrap().module_id = Some("short".into());
        app.session.active_pane_id = "pane-1".into();
        let _ = study_frame(&ctx, &mut app, 0.1, egui::Modifiers::default(), Vec::new());
        let shown = study_frame(&ctx, &mut app, 0.2, egui::Modifiers::default(), Vec::new());
        let left = *mark(&shown, "body:pane-1");
        let at = egui::pos2(left[0] + left[2] * 0.5, left[1] + 80.0);
        let mut time = 0.3;
        let mut scrolled = shown;
        for _ in 0..8 {
            scrolled = study_frame(
                &ctx,
                &mut app,
                time,
                egui::Modifiers::default(),
                wheel_down(at),
            );
            time += 0.1;
        }
        let before = *mark(&scrolled, "chapter-offset:pane-1");
        assert!(
            before[1] > 400.0,
            "the long Bible should be far down, offset {} content {} viewport {}",
            before[1],
            before[0],
            before[2]
        );
        let short_verse = *mark(&scrolled, &format!("verse:{other}:1"));
        let click_short = egui::pos2(short_verse[0] + 40.0, short_verse[1] + short_verse[3] * 0.5);
        let _ = study_frame(
            &ctx,
            &mut app,
            time,
            egui::Modifiers::default(),
            click(click_short),
        );
        time += 0.1;
        assert_eq!(app.session.active_pane_id, other);
        let after = study_frame(&ctx, &mut app, time, egui::Modifiers::default(), Vec::new());
        let moved = *mark(&after, "chapter-offset:pane-1");
        assert!(
            (moved[1] - before[1]).abs() < 2.0,
            "selecting a verse in the short Bible moved the long one from {} to {} (content {} -> {}, viewport {})",
            before[1],
            moved[1],
            before[0],
            moved[0],
            moved[2]
        );

        let right = *mark(&after, &format!("body:{other}"));
        let right_at = egui::pos2(right[0] + right[2] * 0.5, right[1] + 80.0);
        let mut short_scrolled = after;
        for _ in 0..6 {
            time += 0.1;
            short_scrolled = study_frame(
                &ctx,
                &mut app,
                time,
                egui::Modifiers::default(),
                wheel_down(right_at),
            );
        }
        let short_before = *mark(&short_scrolled, &format!("chapter-offset:{other}"));
        assert!(
            short_before[1] > 200.0,
            "the short Bible should leave the top, offset {}",
            short_before[1]
        );
        let long_body = *mark(&short_scrolled, "body:pane-1");
        let long_verse = short_scrolled
            .iter()
            .filter_map(|(key, rect)| {
                if !key.starts_with("verse:pane-1:") {
                    return None;
                }
                let mid_y = rect[1] + rect[3] * 0.5;
                if mid_y > long_body[1] + 4.0 && mid_y < long_body[1] + long_body[3] - 4.0 {
                    Some(*rect)
                } else {
                    None
                }
            })
            .next()
            .expect("a visible verse on the long Bible");
        let click_long = egui::pos2(long_verse[0] + 40.0, long_verse[1] + long_verse[3] * 0.5);
        time += 0.1;
        let _ = study_frame(
            &ctx,
            &mut app,
            time,
            egui::Modifiers::default(),
            click(click_long),
        );
        time += 0.1;
        assert_eq!(app.session.active_pane_id, "pane-1");
        let back = study_frame(&ctx, &mut app, time, egui::Modifiers::default(), Vec::new());
        let short_after = *mark(&back, &format!("chapter-offset:{other}"));
        let long_after = *mark(&back, "chapter-offset:pane-1");
        assert!(
            (short_after[1] - short_before[1]).abs() < 2.0,
            "selecting a verse in the long Bible moved the short one from {} to {}",
            short_before[1],
            short_after[1]
        );
        assert!(
            (long_after[1] - moved[1]).abs() < 2.0,
            "activating the long Bible moved it from {} to {}",
            moved[1],
            long_after[1]
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    fn bible_module(
        id: &str,
        name: &str,
        path: std::path::PathBuf,
    ) -> graphe_store::catalog::InstalledModule {
        graphe_store::catalog::InstalledModule {
            id: id.into(),
            name: name.into(),
            kind: "bible".into(),
            path,
            short_title: Some(name.into()),
            description: None,
        }
    }

    fn write_chapter(path: &std::path::Path, count: i64, text: impl Fn(i64) -> String) {
        let mut sql = String::from(
            "CREATE TABLE verses (book_number INTEGER, chapter INTEGER, verse INTEGER, text TEXT);",
        );
        for verse in 1..=count {
            let line = text(verse).replace('\'', "''");
            sql.push_str(&format!(
                "INSERT INTO verses VALUES (10, 1, {verse}, '{line}');\n"
            ));
        }
        graphe_store::sqlite::init_module_sql(path, &sql).unwrap();
    }

    #[test]
    fn wheel_past_the_end_does_not_jump_the_text() {
        let ctx = egui::Context::default();
        let mut app = bare(Session::new());
        app.session.sidebar_collapsed = true;
        app.loaded_key = ":10:1:pane-1".into();
        app.session.chapter_text = vec![
            (1, "No princípio.".into()),
            (2, "E a terra era sem forma.".into()),
        ];
        let _ = study_frame(&ctx, &mut app, 0.1, egui::Modifiers::default(), Vec::new());
        let settled = study_frame(&ctx, &mut app, 0.2, egui::Modifiers::default(), Vec::new());
        let verse = *mark(&settled, "verse:pane-1:1");
        let body = *mark(&settled, "body:pane-1");
        let at = egui::pos2(body[0] + 80.0, body[1] + 40.0);
        let spun = study_frame(
            &ctx,
            &mut app,
            0.3,
            egui::Modifiers::default(),
            wheel_down(at),
        );
        let again = study_frame(
            &ctx,
            &mut app,
            0.4,
            egui::Modifiers::default(),
            wheel_down(at),
        );
        let spun_y = mark(&spun, "verse:pane-1:1")[1];
        let again_y = mark(&again, "verse:pane-1:1")[1];
        assert!(
            (spun_y - verse[1]).abs() < 1.0 && (again_y - verse[1]).abs() < 1.0,
            "a short chapter jumped from {} to {spun_y} then {again_y}",
            verse[1]
        );

        let mut app = bare(Session::new());
        app.session.sidebar_collapsed = true;
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
        let paragraph = "A graça e a verdade vieram por Jesus Cristo. ".repeat(30);
        let mut pieces = Vec::new();
        for verse in 1..=12 {
            if verse > 1 {
                pieces.push(crate::study::CommentaryPiece::Text("\n\n".into()));
            }
            pieces.push(crate::study::CommentaryPiece::Text(format!(
                "{verse} {paragraph}"
            )));
        }
        let key = crate::study::commentary_key(&path, 10, 1, i18n::get_current_lang().as_str());
        app.reading
            .commentary
            .insert(key, crate::study::CommentaryPaint::new(pieces));
        let _ = study_frame(&ctx, &mut app, 1.0, egui::Modifiers::default(), Vec::new());
        let start = study_frame(&ctx, &mut app, 1.1, egui::Modifiers::default(), Vec::new());
        let text_key = format!("commentary-text:{pane}");
        let view = *mark(&start, &format!("commentary-view:{pane}"));
        let start_y = mark(&start, &text_key)[1];
        let at = egui::pos2(view[0] + 40.0, view[1] + 40.0);
        let mut stuck = start_y;
        let mut moved = false;
        let mut time = 1.2;
        for _ in 0..12 {
            let frame = study_frame(
                &ctx,
                &mut app,
                time,
                egui::Modifiers::default(),
                wheel_down(at),
            );
            time += 0.1;
            let y = mark(&frame, &text_key)[1];
            if (y - stuck).abs() < 1.0 {
                if moved {
                    break;
                }
            } else {
                moved = true;
                stuck = y;
            }
        }
        assert!(moved, "the commentary never scrolled, still at {start_y}");
        let held = study_frame(
            &ctx,
            &mut app,
            time,
            egui::Modifiers::default(),
            wheel_down(at),
        );
        let held_y = mark(&held, &text_key)[1];
        assert!(
            (held_y - stuck).abs() < 1.0,
            "scrolling past the commentary end jumped from {stuck} to {held_y}"
        );

        let mut app = bare(Session::new());
        app.session.sidebar = "search".into();
        app.session.query = "unico".into();
        app.session.hits = (1..=5)
            .map(|verse| graphe_domain::search::SearchHit {
                book_number: 10,
                chapter: 1,
                verse,
                text: format!("unico resultado {verse}"),
            })
            .collect();
        let mut show = |time: f64, events: Vec<egui::Event>| {
            let mut raw = egui::RawInput::default();
            raw.screen_rect = Some(egui::Rect::from_min_size(
                egui::Pos2::ZERO,
                egui::vec2(1200.0, 800.0),
            ));
            raw.time = Some(time);
            raw.events = events;
            ctx.run_test_ui(raw, |ctx| {
                app.sidebar(ctx, theme::palette(false));
            })
        };
        let _ = show(2.0, Vec::new());
        let settled = show(2.1, Vec::new());
        let y = first_text_y(&settled, "unico resultado 1");
        let spun = show(2.2, wheel_down(egui::pos2(140.0, 420.0)));
        let again = show(2.3, wheel_down(egui::pos2(140.0, 420.0)));
        let spun_y = first_text_y(&spun, "unico resultado 1");
        let again_y = first_text_y(&again, "unico resultado 1");
        assert!(
            (spun_y - y).abs() < 1.0 && (again_y - y).abs() < 1.0,
            "five search rows jumped from {y} to {spun_y} then {again_y}"
        );
    }

    #[test]
    fn search_panel_displays_entire_verse_without_clipping() {
        let ctx = egui::Context::default();
        let mut app = bare(Session::new());
        app.session.sidebar_collapsed = false;
        app.session.sidebar = "search".into();
        app.session.query = "8104".into();
        let long_verse = "E eis que estou contigo, e te guardarei<S>8104</S> por onde quer que fores, e te farei tornar a esta terra; porque não te deixarei, até que haja cumprido o que te tenho dito.";
        app.session.hits = vec![graphe_domain::search::SearchHit {
            book_number: 10,
            chapter: 28,
            verse: 15,
            text: long_verse.into(),
        }];

        let mut raw = egui::RawInput::default();
        raw.screen_rect = Some(egui::Rect::from_min_size(
            egui::Pos2::ZERO,
            egui::vec2(1200.0, 800.0),
        ));
        let output = ctx.run_test_ui(raw, |ctx| {
            app.sidebar(ctx, theme::palette(false));
        });

        assert!(
            galley_has(&output, "cumprido o que te tenho dito"),
            "search card must display the entire verse text without truncation or clipping"
        );
        assert!(
            !galley_has(&output, "..."),
            "search card must not truncate with ellipsis"
        );
    }

    #[test]
    fn search_panel_highlights_words_with_accents_and_exact_terms() {
        let ctx = egui::Context::default();
        let mut app = bare(Session::new());
        app.session.sidebar_collapsed = false;
        app.session.sidebar = "search".into();
        app.session.query = "bencao amor beginning".into();
        let verse = "A bênção do SENHOR traz amor desde o beginning.";
        app.session.hits = vec![graphe_domain::search::SearchHit {
            book_number: 10,
            chapter: 1,
            verse: 1,
            text: verse.into(),
        }];

        let mut raw = egui::RawInput::default();
        raw.screen_rect = Some(egui::Rect::from_min_size(
            egui::Pos2::ZERO,
            egui::vec2(1200.0, 800.0),
        ));
        let output = ctx.run_test_ui(raw, |ctx| {
            app.sidebar(ctx, theme::palette(false));
        });

        assert!(
            galley_has(&output, "bênção"),
            "search card displays accented word"
        );
        assert!(
            galley_has(&output, "amor"),
            "search card displays exact word"
        );
        assert!(
            galley_has(&output, "beginning"),
            "search card displays exact matched word"
        );
    }

    #[test]
    fn search_cards_do_not_overlap() {
        let ctx = egui::Context::default();
        let mut app = bare(Session::new());
        app.session.sidebar_collapsed = false;
        app.session.sidebar = "search".into();
        app.session.query = "Jesuá".into();
        let verse1 = "Então se levantaram Zorobabel , filho de Sealtiel , e Jesuá , filho de Jozadaque , e começaram a edificar a casa de Deus , que está em Jerusalém ; e com eles os profetas de Deus , que os ajudavam .";
        let verse2 = "E no quarto dia se pesou a prata , o ouro e os utensílios , na casa de nosso Deus , por mão de Meremote , filho do sacerdote Urias ; e com ele Eleazar , filho de Fineias , e com eles Jozabade , filho de Jesuá , e Noadias , filho de Binui , levitas .";
        let mut hits = Vec::new();
        for i in 0..50 {
            hits.push(graphe_domain::search::SearchHit {
                book_number: 15,
                chapter: 5,
                verse: i + 1,
                text: if i % 2 == 0 {
                    verse1.into()
                } else {
                    verse2.into()
                },
            });
        }
        app.session.hits = hits;

        let mut raw = egui::RawInput::default();
        raw.screen_rect = Some(egui::Rect::from_min_size(
            egui::Pos2::ZERO,
            egui::vec2(1200.0, 800.0),
        ));

        // Frame 1
        let _output1 = ctx.run_test_ui(raw.clone(), |ctx| {
            app.sidebar(ctx, theme::palette(false));
        });

        // Frame 2
        let output2 = ctx.run_test_ui(raw, |ctx| {
            app.sidebar(ctx, theme::palette(false));
        });

        let mut card_rects: Vec<egui::Rect> = output2
            .shapes
            .iter()
            .filter_map(|shape| match &shape.shape {
                egui::epaint::Shape::Rect(r)
                    if (r.rect.left() - 8.0).abs() < 1.0 && r.rect.width() > 100.0 =>
                {
                    Some(r.rect)
                }
                _ => None,
            })
            .collect();

        card_rects.sort_by(|a, b| a.top().total_cmp(&b.top()));
        assert!(
            card_rects.len() >= 2,
            "Expected at least 2 visible search cards, found {}",
            card_rects.len()
        );

        for window in card_rects.windows(2) {
            let prev = window[0];
            let next = window[1];
            assert!(
                prev.bottom() <= next.top(),
                "Search cards must not overlap! prev: {:?}, next: {:?}",
                prev,
                next
            );
            assert!(
                next.top() - prev.bottom() >= 5.9,
                "Expected at least 6px gap between search cards, but was {:.2}px (prev: {:?}, next: {:?})",
                next.top() - prev.bottom(),
                prev,
                next
            );
        }
    }

    #[test]
    fn search_returns_all_results_without_80_cap() {
        let dir = std::env::temp_dir().join(format!("graphe-search-all-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let bible_path = dir.join("bible.SQLite3");
        write_chapter(&bible_path, 120, |v| {
            format!("Versiculo {v} com amor de Deus.")
        });

        let mut app = bare(Session::new());
        app.modules
            .push(bible_module("test-bible", "Test Bible", bible_path));
        app.session.search_module_id = Some("test-bible".into());
        app.session.query = "amor".into();
        app.run_search();

        assert_eq!(
            app.session.hits.len(),
            120,
            "search must not be capped at 80 results"
        );

        let ctx = egui::Context::default();
        let raw = egui::RawInput {
            screen_rect: Some(egui::Rect::from_min_size(
                egui::Pos2::ZERO,
                egui::vec2(1200.0, 800.0),
            )),
            ..Default::default()
        };
        let output = ctx.run_test_ui(raw, |ctx| {
            app.sidebar(ctx, theme::palette(false));
        });
        assert!(
            galley_has(&output, "120 resultados"),
            "search results counter shows full count of matching verses"
        );
    }

    #[test]
    fn search_panel_displays_searching_feedback_and_no_results() {
        let ctx = egui::Context::default();
        let mut app = bare(Session::new());
        app.session.sidebar_collapsed = false;
        app.session.sidebar = "search".into();
        app.session.query = "jesus".into();
        app.session.searching = true;

        let raw = egui::RawInput {
            screen_rect: Some(egui::Rect::from_min_size(
                egui::Pos2::ZERO,
                egui::vec2(1200.0, 800.0),
            )),
            ..Default::default()
        };
        let output = ctx.run_test_ui(raw.clone(), |ctx| {
            app.sidebar(ctx, theme::palette(false));
        });
        assert!(
            galley_has(&output, &graphe_domain::i18n::t("searching")),
            "shows searching indicator while search is in progress"
        );

        // When search finishes with 0 results
        app.session.searching = false;
        app.session.searched_query = "jesus".into();
        app.session.hits.clear();

        let output2 = ctx.run_test_ui(raw, |ctx| {
            app.sidebar(ctx, theme::palette(false));
        });
        assert!(
            galley_has(&output2, &graphe_domain::i18n::t("searchNoResults")),
            "shows no results feedback when query returns no verses"
        );
    }

    #[test]
    fn search_rejects_unrelated_names_like_jotao_for_joao_and_jesua_for_jesus() {
        let dir = std::env::temp_dir().join(format!("graphe-search-names-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let bible_path = dir.join("bible.SQLite3");

        let mut sql = String::from(
            "CREATE TABLE verses (book_number INTEGER, chapter INTEGER, verse INTEGER, text TEXT);\n",
        );
        sql.push_str("INSERT INTO verses VALUES (10, 1, 1, 'Jotão tinha vinte e cinco anos quando começou a reinar.');\n");
        sql.push_str("INSERT INTO verses VALUES (10, 1, 2, 'Houve um homem enviado de Deus, cujo nome era João.');\n");
        sql.push_str("INSERT INTO verses VALUES (10, 1, 3, 'Estes são os que subiram com Jesuá e Neemias.');\n");
        sql.push_str("INSERT INTO verses VALUES (10, 1, 4, 'Jeús, Jalão e Corá, príncipes.');\n");
        sql.push_str("INSERT INTO verses VALUES (10, 1, 5, 'Livro da genealogia de Jesus Cristo, filho de Davi.');\n");
        graphe_store::sqlite::init_module_sql(&bible_path, &sql).unwrap();

        let mut app = bare(Session::new());
        app.modules
            .push(bible_module("names-bible", "Names Bible", bible_path));
        app.session.search_module_id = Some("names-bible".into());

        // Searching for "joão"
        app.session.query = "joão".into();
        app.run_search();
        assert_eq!(app.session.hits.len(), 1, "only João must match");
        assert_eq!(app.session.hits[0].verse, 2);

        // Searching for "jesus"
        app.session.query = "jesus".into();
        app.run_search();
        assert_eq!(app.session.hits.len(), 1, "only Jesus must match");
        assert_eq!(app.session.hits[0].verse, 5);
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
        app.reading
            .commentary
            .insert(key, crate::study::CommentaryPaint::new(pieces));
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
                    phase: egui::TouchPhase::Move,
                    source: egui::MouseWheelSource::Unknown,
                    modifiers: egui::Modifiers::default(),
                },
            ],
        );
        let scrolled = study_frame(&ctx, &mut app, 0.4, egui::Modifiers::default(), Vec::new());
        let moved = *mark(&scrolled, &format!("commentary-text:{pane}"));
        let bar = *mark(&scrolled, &format!("toolbar:{pane}"));
        assert!(
            moved[1] < text[1] - 20.0,
            "wheel scrolls the commentary, y {} -> {}",
            text[1],
            moved[1]
        );
        assert!(
            moved[1] < bar[1],
            "the commentary galley now starts above the toolbar"
        );
        let painted = editor_frame(&ctx, &mut app, 0.5);
        let clip_top = text_clip_top(&painted, "graça").expect("commentary text");
        assert!(
            clip_top + 0.5 >= bar[1] + bar[3],
            "scrolled commentary paints over the toolbar: clip {clip_top}, bar bottom {}",
            bar[1] + bar[3]
        );
    }

    fn editor_frame(ctx: &egui::Context, app: &mut GrapheApp, time: f64) -> egui::FullOutput {
        let mut raw = egui::RawInput::default();
        raw.screen_rect = Some(egui::Rect::from_min_size(
            egui::Pos2::ZERO,
            egui::vec2(1200.0, 800.0),
        ));
        raw.time = Some(time);
        ctx.run_test_ui(raw, |ctx| {
            app.editor(ctx, theme::palette(false));
        })
    }

    fn painted_text(output: &egui::FullOutput, exact: &str) -> Option<(egui::Rect, egui::Rect)> {
        fn walk(
            shape: &egui::Shape,
            clip: egui::Rect,
            exact: &str,
            found: &mut Option<(egui::Rect, egui::Rect)>,
        ) {
            match shape {
                egui::Shape::Text(text) if text.galley.job.text == exact => {
                    let rect = egui::Rect::from_min_size(text.pos, text.galley.rect.size());
                    *found = Some((rect, clip));
                }
                egui::Shape::Vec(list) => {
                    for shape in list {
                        walk(shape, clip, exact, found);
                    }
                }
                _ => {}
            }
        }
        let mut found = None;
        for clipped in &output.shapes {
            walk(&clipped.shape, clipped.clip_rect, exact, &mut found);
        }
        found
    }

    fn text_clip_top(output: &egui::FullOutput, needle: &str) -> Option<f32> {
        let mut top = None;
        for clipped in &output.shapes {
            note_text_clip(&clipped.shape, clipped.clip_rect, needle, &mut top);
        }
        top
    }

    fn note_text_clip(shape: &egui::Shape, clip: egui::Rect, needle: &str, top: &mut Option<f32>) {
        match shape {
            egui::Shape::Text(text) if text.galley.job.text.contains(needle) => {
                *top = Some(top.map_or(clip.top(), |seen| seen.min(clip.top())));
            }
            egui::Shape::Vec(list) => {
                for shape in list {
                    note_text_clip(shape, clip, needle, top);
                }
            }
            _ => {}
        }
    }

    fn ref_to(book: i64, chapter: i64, verse: i64) -> graphe_store::sqlite::CrossReference {
        graphe_store::sqlite::CrossReference {
            verse: 1,
            verse_end: None,
            book_to: book,
            chapter_to: chapter,
            verse_to_start: Some(verse),
            verse_to_end: None,
            votes: Some(1),
        }
    }

    #[test]
    fn cross_references_start_at_the_verse_text() {
        let ctx = egui::Context::default();
        let mut app = bare(Session::new());
        app.loaded_key = ":10:1:pane-1".into();
        app.session.chapter_text = vec![(1, "No princípio criou Deus os céus e a terra.".into())];
        app.session.xref_modules = vec!["xref".into()];
        let mut grouped = HashMap::new();
        grouped.insert(
            1,
            vec![
                ref_to(650, 7, 27),
                ref_to(20, 29, 38),
                ref_to(20, 29, 38),
                ref_to(40, 28, 24),
                ref_to(40, 28, 3),
            ],
        );
        app.reading.insert_cross_refs(10, 1, "xref", grouped);
        let marks = study_frame(&ctx, &mut app, 0.1, egui::Modifiers::default(), Vec::new());
        let verse = *mark(&marks, "verse:pane-1:1");
        let exodus = *mark(&marks, "ref:pane-1:1:20:29:38");
        let numbers_early = *mark(&marks, "ref:pane-1:1:40:28:3");
        let numbers_late = *mark(&marks, "ref:pane-1:1:40:28:24");
        let hebrews = *mark(&marks, "ref:pane-1:1:650:7:27");
        assert_eq!(
            marks
                .iter()
                .filter(|(key, _)| key == "ref:pane-1:1:20:29:38")
                .count(),
            1,
            "a repeated target is shown once"
        );
        assert!(
            (exodus[0] - (verse[0] + 36.0)).abs() < 2.0,
            "references start with the verse text, not the verse number: verse {verse:?} ref {exodus:?}"
        );
        assert!(
            exodus[0] < numbers_early[0] && numbers_early[0] < numbers_late[0],
            "Exodus comes before Numbers, and the earlier verse comes first"
        );
        assert!(
            numbers_late[0] < hebrews[0] || numbers_late[1] < hebrews[1],
            "Hebrews follows the earlier books"
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
                            phase: egui::TouchPhase::Move,
                            source: egui::MouseWheelSource::Unknown,
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
        let marks = study_frame(&ctx, &mut app, time, egui::Modifiers::default(), Vec::new());
        let bar = *mark(&marks, "toolbar:pane-1");
        let painted = editor_frame(&ctx, &mut app, time + 0.1);
        let clip_top = text_clip_top(&painted, "princípio").expect("verse text");
        assert!(
            clip_top + 0.5 >= bar[1] + bar[3],
            "scrolled chapter paints over the toolbar: clip {clip_top}, bar bottom {}",
            bar[1] + bar[3]
        );
    }

    #[test]
    fn scrolling_reuses_shaped_bible_rows_and_the_commentary_galley() {
        let ctx = egui::Context::default();
        let mut app = bare(Session::new());
        app.loaded_key = ":10:1:pane-1".into();
        let line = "No princípio criou Deus os céus e a terra <S>7225</S>.";
        app.session.chapter_text = (1..=80).map(|verse| (verse, line.to_string())).collect();
        app.session.show_strongs = true;
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
        let paragraph = "A graça e a verdade vieram por Jesus Cristo. ".repeat(12);
        let mut pieces = Vec::new();
        for verse in 1..=24 {
            if verse > 1 {
                pieces.push(crate::study::CommentaryPiece::Break);
                pieces.push(crate::study::CommentaryPiece::Break);
            }
            pieces.push(crate::study::CommentaryPiece::Heading(verse.to_string()));
            pieces.push(crate::study::CommentaryPiece::Break);
            pieces.push(crate::study::CommentaryPiece::Text(paragraph.clone()));
        }
        let key = crate::study::commentary_key(&path, 10, 1, i18n::get_current_lang().as_str());
        app.reading
            .commentary
            .insert(key, crate::study::CommentaryPaint::new(pieces));
        let _ = study_frame(&ctx, &mut app, 0.1, egui::Modifiers::default(), Vec::new());
        let warmed = study_frame(&ctx, &mut app, 0.2, egui::Modifiers::default(), Vec::new());
        let shaped = app.reading.verse_layouts_built;
        let wrapped = app.reading.commentary_layouts;
        assert!(shaped > 0, "the chapter is shaped once");
        assert_eq!(wrapped, 1, "the commentary is wrapped once, got {wrapped}");
        let body = *mark(&warmed, "body:pane-1");
        let before = *mark(&warmed, "verse:pane-1:1");
        let pointer = egui::pos2(body[0] + body[2] * 0.5, body[1] + body[3] * 0.5);
        for frame in 0..4 {
            let _ = study_frame(
                &ctx,
                &mut app,
                0.3 + frame as f64 * 0.05,
                egui::Modifiers::default(),
                vec![
                    egui::Event::PointerMoved(pointer),
                    egui::Event::MouseWheel {
                        unit: egui::MouseWheelUnit::Point,
                        delta: egui::vec2(0.0, -160.0),
                        phase: egui::TouchPhase::Move,
                        source: egui::MouseWheelSource::Unknown,
                        modifiers: egui::Modifiers::default(),
                    },
                ],
            );
        }
        let after = study_frame(&ctx, &mut app, 0.6, egui::Modifiers::default(), Vec::new());
        assert_eq!(
            app.reading.verse_layouts_built, shaped,
            "scrolling reshaped bible rows"
        );
        assert_eq!(
            app.reading.commentary_layouts, wrapped,
            "scrolling rewrapped the commentary"
        );
        assert!(
            after.iter().all(|(key, _)| key != "verse:pane-1:1"),
            "the wheel left verse 1, which started at y {}",
            before[1]
        );
        assert!(
            after
                .iter()
                .any(|(key, _)| key.starts_with("verse:pane-1:")),
            "later verses are still painted"
        );
    }

    #[test]
    fn a_font_change_shapes_only_the_open_rows() {
        let ctx = egui::Context::default();
        let mut app = bare(Session::new());
        app.loaded_key = ":10:1:pane-1".into();
        app.session.chapter_text = (1..=48)
            .map(|verse| {
                (
                    verse,
                    format!(
                        "Verso {verse}: No princípio criou Deus os céus e a terra <S>7225</S> e disse haja luz <S>216</S>."
                    ),
                )
            })
            .collect();
        app.session.show_strongs = true;
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
        let paragraph = "Grace and truth came through Jesus Christ. ".repeat(40);
        let mut pieces = Vec::new();
        for verse in 1..=20 {
            if verse > 1 {
                pieces.push(crate::study::CommentaryPiece::Break);
            }
            pieces.push(crate::study::CommentaryPiece::Heading(verse.to_string()));
            pieces.push(crate::study::CommentaryPiece::Text(paragraph.clone()));
        }
        let key = crate::study::commentary_key(&path, 10, 1, i18n::get_current_lang().as_str());
        app.reading
            .commentary
            .insert(key, crate::study::CommentaryPaint::new(pieces));
        fn frame(ctx: &egui::Context, app: &mut GrapheApp, time: f64) {
            let mut raw = egui::RawInput::default();
            raw.screen_rect = Some(egui::Rect::from_min_size(
                egui::Pos2::ZERO,
                egui::vec2(1200.0, 800.0),
            ));
            raw.time = Some(time);
            let _ = ctx.run_test_ui(raw, |ui| app.show_workbench(ui));
        }
        frame(&ctx, &mut app, 0.1);
        frame(&ctx, &mut app, 0.2);
        let shaped = app.reading.verse_layouts_built;
        let measures = app.reading.chapter_measures;
        let wrapped = app.reading.commentary_layouts;
        let chars = app.reading.commentary_chars;
        assert!(shaped > 0, "the chapter is shaped once");
        assert_eq!(measures, 1, "the chapter is measured once, got {measures}");
        assert!(wrapped >= 1, "the commentary is wrapped once");
        assert!(
            chars > 200 && chars < 12_000,
            "the open commentary slice was {chars} chars"
        );
        app.session.font_size = 28.0;
        frame(&ctx, &mut app, 0.3);
        let shaped_delta = app.reading.verse_layouts_built - shaped;
        let chars_delta = app.reading.commentary_chars - chars;
        assert_eq!(
            app.reading.chapter_measures, measures,
            "a font step measured the whole chapter again"
        );
        assert!(
            shaped_delta > 0 && shaped_delta < 36,
            "a font step shaped {shaped_delta} verses"
        );
        assert!(
            app.reading.commentary_layouts > wrapped,
            "the open commentary was not wrapped at the new size"
        );
        assert!(
            chars_delta > 200 && chars_delta < 12_000,
            "a font step wrapped {chars_delta} commentary chars"
        );
    }

    #[test]
    fn commentary_selected_text_stays_on_words_when_scrolling() {
        let ctx = egui::Context::default();
        let mut app = bare(Session::new());
        app.loaded_key = ":10:1:pane-1".into();
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
        for verse in 1..=20 {
            if verse > 1 {
                pieces.push(crate::study::CommentaryPiece::Break);
            }
            pieces.push(crate::study::CommentaryPiece::Heading(verse.to_string()));
            pieces.push(crate::study::CommentaryPiece::Text(paragraph.clone()));
        }
        let key = crate::study::commentary_key(&path, 10, 1, i18n::get_current_lang().as_str());
        app.reading
            .commentary
            .insert(key, crate::study::CommentaryPaint::new(pieces));

        let warmed = study_frame(&ctx, &mut app, 0.1, egui::Modifiers::default(), Vec::new());
        let text_mark = *mark(&warmed, &format!("commentary-text:{pane}"));
        let p_start = egui::pos2(text_mark[0] + 40.0, text_mark[1] + 30.0);
        let p_end = egui::pos2(text_mark[0] + 160.0, text_mark[1] + 30.0);

        let _ = study_frame(
            &ctx,
            &mut app,
            0.2,
            egui::Modifiers::default(),
            vec![
                egui::Event::PointerMoved(p_start),
                egui::Event::PointerButton {
                    pos: p_start,
                    button: egui::PointerButton::Primary,
                    pressed: true,
                    modifiers: egui::Modifiers::default(),
                },
            ],
        );
        let _ = study_frame(
            &ctx,
            &mut app,
            0.25,
            egui::Modifiers::default(),
            vec![egui::Event::PointerMoved(p_end)],
        );
        let _ = study_frame(
            &ctx,
            &mut app,
            0.3,
            egui::Modifiers::default(),
            vec![egui::Event::PointerButton {
                pos: p_end,
                button: egui::PointerButton::Primary,
                pressed: false,
                modifiers: egui::Modifiers::default(),
            }],
        );

        assert!(
            label_has_selection(&ctx),
            "commentary text must be selected after drag"
        );

        let (output, _) = study_frame_output(
            &ctx,
            &mut app,
            0.35,
            egui::Modifiers::default(),
            vec![egui::Event::Copy],
        );
        let initial_copy = output.platform_output.commands.iter().find_map(|cmd| match cmd {
            egui::OutputCommand::CopyText(text) => Some(text.clone()),
            _ => None,
        });
        assert!(
            initial_copy.as_ref().is_some_and(|text| !text.is_empty()),
            "selected text should be copied, got {initial_copy:?}"
        );

        let pointer = egui::pos2(text_mark[0] + 100.0, text_mark[1] + 100.0);
        let _ = study_frame(
            &ctx,
            &mut app,
            0.4,
            egui::Modifiers::default(),
            vec![
                egui::Event::PointerMoved(pointer),
                egui::Event::MouseWheel {
                    unit: egui::MouseWheelUnit::Point,
                    delta: egui::vec2(0.0, -180.0),
                    phase: egui::TouchPhase::Move,
                    source: egui::MouseWheelSource::Unknown,
                    modifiers: egui::Modifiers::default(),
                },
            ],
        );

        assert!(
            label_has_selection(&ctx),
            "selection must persist during and after scroll"
        );

        let (output, _) = study_frame_output(
            &ctx,
            &mut app,
            0.5,
            egui::Modifiers::default(),
            vec![egui::Event::Copy],
        );
        let after_scroll_copy = output.platform_output.commands.iter().find_map(|cmd| match cmd {
            egui::OutputCommand::CopyText(text) => Some(text.clone()),
            _ => None,
        });
        assert_eq!(
            after_scroll_copy, initial_copy,
            "highlighted and selected text must stay on the same words when scrolling"
        );
    }

    #[test]
    fn scrolled_commentary_list_stays_under_the_dialog_header() {
        let ctx = egui::Context::default();
        let mut app = bare(Session::new());
        app.session.dialog = Dialog::AllCommentaries;
        app.session.commentary_ref = "Hb 10:1".into();
        app.session.commentary_sections = (0..8)
            .map(|index| crate::session::CommentarySection {
                name: format!("Módulo {index}"),
                body: "A graça e a verdade vieram por Jesus Cristo. ".repeat(20),
            })
            .collect();
        app.session.commentary_open = vec![true; 8];
        let (_, settled) = dialog_frame(&ctx, &mut app);
        let header = *mark(&settled, "modal-header");
        let card = *mark(&settled, "modal-card");
        let pointer = egui::pos2(card[0] + card[2] * 0.5, header[1] + header[3] + 80.0);
        let mut raw = egui::RawInput::default();
        raw.screen_rect = Some(egui::Rect::from_min_size(
            egui::Pos2::ZERO,
            egui::vec2(1200.0, 800.0),
        ));
        raw.time = Some(0.2);
        raw.events = vec![egui::Event::PointerMoved(pointer)];
        let _ = ctx.run_test_ui(raw, |ctx| {
            app.dialogs(ctx);
        });
        let mut raw = egui::RawInput::default();
        raw.screen_rect = Some(egui::Rect::from_min_size(
            egui::Pos2::ZERO,
            egui::vec2(1200.0, 800.0),
        ));
        raw.time = Some(0.3);
        raw.events = vec![
            egui::Event::PointerMoved(pointer),
            egui::Event::MouseWheel {
                unit: egui::MouseWheelUnit::Point,
                delta: egui::vec2(0.0, -400.0),
                phase: egui::TouchPhase::Move,
                source: egui::MouseWheelSource::Unknown,
                modifiers: egui::Modifiers::default(),
            },
        ];
        let _ = ctx.run_test_ui(raw, |ctx| {
            app.dialogs(ctx);
        });
        let (output, scrolled) = dialog_frame(&ctx, &mut app);
        let header = *mark(&scrolled, "modal-header");
        let clip_top = text_clip_top(&output, "graça").expect("commentary section");
        assert!(
            clip_top + 0.5 >= header[1] + header[3],
            "scrolled commentaries paint over the dialog header: clip {clip_top}, header bottom {}",
            header[1] + header[3]
        );
    }

    #[test]
    fn all_commentaries_grows_when_a_section_opens_and_stops_at_the_screen_margin() {
        let ctx = egui::Context::default();
        let mut app = bare(Session::new());
        app.session.dialog = Dialog::AllCommentaries;
        app.session.commentary_ref = "Hb 10:11".into();
        let paragraph = "A graça e a verdade vieram por Jesus Cristo. ".repeat(12);
        app.session.commentary_sections = (0..6)
            .map(|index| crate::session::CommentarySection {
                name: format!("Módulo {index}"),
                body: paragraph.clone(),
            })
            .collect();
        app.session.commentary_open = vec![false; 6];
        let _ = dialog_frame(&ctx, &mut app);
        let (_, collapsed_marks) = dialog_frame(&ctx, &mut app);
        let collapsed = *mark(&collapsed_marks, "modal-card");

        app.session.commentary_open[0] = true;
        let _ = dialog_frame(&ctx, &mut app);
        let (_, opened_marks) = dialog_frame(&ctx, &mut app);
        let opened = *mark(&opened_marks, "modal-card");
        assert!(
            opened[3] > collapsed[3] + 40.0,
            "opening a comment grows the card, {} -> {}",
            collapsed[3],
            opened[3]
        );

        app.session.commentary_open = vec![true; 6];
        let _ = dialog_frame(&ctx, &mut app);
        let (_, full_marks) = dialog_frame(&ctx, &mut app);
        let full = *mark(&full_marks, "modal-card");
        let scroll = *mark(&full_marks, "modal-scroll");
        let margin = crate::dialogs::ALL_COMMENTARIES_SCREEN_MARGIN;
        let screen = 800.0_f32;
        let below = screen - (full[1] + full[3]);
        assert!(
            (full[1] - margin).abs() < 6.0 && (below - margin).abs() < 6.0,
            "a full comment list keeps {margin}px of space, top {} bottom {below}, card {full:?}",
            full[1]
        );
        assert!(
            scroll[3] + 8.0 >= full[3] - mark(&full_marks, "modal-header")[3],
            "the reading area fills the grown card, scroll {scroll:?} card {full:?}"
        );

        app.session.commentary_open = vec![false; 6];
        let _ = dialog_frame(&ctx, &mut app);
        let (_, shut_marks) = dialog_frame(&ctx, &mut app);
        let shut = *mark(&shut_marks, "modal-card");
        assert!(
            (shut[3] - collapsed[3]).abs() < 8.0,
            "closing the comments returns the card to the list height, {} vs {}",
            shut[3],
            collapsed[3]
        );
    }

    #[test]
    fn module_editor_fields_are_labeled_and_fill_the_card() {
        i18n::set_lang("pt");
        let path = std::env::temp_dir().join(format!(
            "graphe-editor-{}-strong.sqlite3",
            std::process::id()
        ));
        let _ = std::fs::remove_file(&path);
        graphe_store::sqlite::init_module_sql(
            &path,
            "CREATE TABLE info (name TEXT, value TEXT);
             INSERT INTO info VALUES ('description', 'Dicionários BDB, Thayer e TVM');
             INSERT INTO info VALUES ('language', 'pt');
             INSERT INTO info VALUES ('short.title', 'Strong-PT');
             INSERT INTO info VALUES ('articles_language', 'pt');
             INSERT INTO info VALUES ('strong_numbers', 'true');",
        )
        .expect("module fixture");
        let mut app = bare(Session::new());
        app.modules.push(graphe_store::catalog::InstalledModule {
            id: "strong-pt".into(),
            name: "Strong-PT - Dicionários BDB, Thayer e TVM".into(),
            kind: "dictionary".into(),
            path: path.clone(),
            short_title: Some("Strong-PT".into()),
            description: Some("Dicionários BDB, Thayer e TVM".into()),
        });
        app.editor_path = Some(path.clone());
        app.session.dialog = Dialog::ModuleEditor;
        let ctx = egui::Context::default();
        let _ = dialog_frame(&ctx, &mut app);
        let (output, marks) = dialog_frame(&ctx, &mut app);
        let card = *mark(&marks, "modal-card");
        let description = *mark(&marks, "editor-description");
        let language = *mark(&marks, "editor-language");
        let short_title = *mark(&marks, "editor-short-title");
        let articles = *mark(&marks, "editor-extra:articles_language");
        let save = *mark(&marks, "editor-save");
        let delete = *mark(&marks, "editor-delete");
        assert!(card[2] > 800.0, "the editor is wide, card {card:?}");
        assert!(
            card[3] > 480.0,
            "the editor grows with the form, card {card:?}"
        );
        assert!(
            card[1] > 8.0 && card[1] + card[3] < 792.0,
            "the card stays inside the window, card {card:?}"
        );
        for field in [description, language, short_title, articles, save] {
            assert!(
                (field[0] - description[0]).abs() < 2.0,
                "fields line up on the left, field {field:?} description {description:?}"
            );
            assert!(
                field[2] > card[2] - 80.0,
                "fields fill the card, field {field:?} card {card:?}"
            );
        }
        assert!(
            description[3] > language[3] + 20.0,
            "description is a text area, {description:?} vs {language:?}"
        );
        assert!(
            language[3] >= 32.0,
            "a line is a full input, language {language:?}"
        );
        assert!(
            description[1] < language[1]
                && language[1] < short_title[1]
                && short_title[1] < articles[1]
                && articles[1] < save[1]
        );
        assert!(delete[0] > description[0], "delete sits on the toolbar");
        assert!(painted_text(&output, &i18n::t("moduleDescription").to_uppercase()).is_some());
        assert!(painted_text(&output, &i18n::t("moduleLanguage").to_uppercase()).is_some());
        assert!(painted_text(&output, &i18n::t("moduleShortTitle").to_uppercase()).is_some());
        assert!(painted_text(&output, "ARTICLES LANGUAGE").is_some());
        assert!(painted_text(&output, &i18n::t("moduleKindDictionary")).is_some());
        assert!(text_clip_top(&output, "articles_language = pt").is_none());

        app.editor.language = "en".into();
        app.editor.extras[0].1 = "en".into();
        app.save_module_editor_info();
        let rows = graphe_store::sqlite::info_in_file(&path);
        let value = |name: &str| {
            rows.iter()
                .find(|(key, _)| key == name)
                .map(|(_, item)| item.clone())
        };
        assert_eq!(value("language").as_deref(), Some("en"));
        assert_eq!(value("articles_language").as_deref(), Some("en"));
        assert_eq!(value("short.title").as_deref(), Some("Strong-PT"));

        let removed = app.editor.extras.remove(0);
        app.editor.deleted_extras.push(removed.0);
        app.save_module_editor_info();
        let rows = graphe_store::sqlite::info_in_file(&path);
        assert!(!rows.iter().any(|(k, _)| k == "articles_language"));
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn coverage_fits_every_book_and_scrolls_only_on_a_short_screen() {
        i18n::set_lang("pt");
        let mut app = bare(Session::new());
        app.modules.push(graphe_store::catalog::InstalledModule {
            id: "notes".into(),
            name: "Notes".into(),
            kind: "commentary".into(),
            path: std::path::PathBuf::from("missing.commentaries.SQLite3"),
            short_title: None,
            description: None,
        });
        app.session.coverage_module_id = Some("notes".into());
        app.session.dialog = Dialog::Coverage;

        let wide = egui::Context::default();
        let _ = dialog_frame(&wide, &mut app);
        let (output, marks) = dialog_frame(&wide, &mut app);
        let (genesis, genesis_clip) = painted_text(&output, "Gn").expect("Genesis");
        let (revelation, revelation_clip) = painted_text(&output, "Ap").expect("Revelation");
        assert!(
            genesis.top() >= genesis_clip.top() - 1.0
                && revelation.bottom() <= revelation_clip.bottom() + 1.0,
            "the coverage grid scrolls on a normal screen: Gn {genesis:?} in {genesis_clip:?}, Ap {revelation:?} in {revelation_clip:?}"
        );
        let card = *mark(&marks, "modal-card");
        let margin = crate::dialogs::ALL_COMMENTARIES_SCREEN_MARGIN;
        let below = 800.0 - (card[1] + card[3]);
        assert!(
            card[1] >= margin - 2.0 && below >= margin - 2.0,
            "the coverage card keeps space around it, top {} bottom {below}",
            card[1]
        );

        let short = egui::Context::default();
        let _ = dialog_frame_in(&short, &mut app, egui::vec2(1200.0, 320.0));
        let (output, marks) = dialog_frame_in(&short, &mut app, egui::vec2(1200.0, 320.0));
        let (revelation, revelation_clip) = painted_text(&output, "Ap").expect("Revelation");
        assert!(
            revelation.bottom() > revelation_clip.bottom() + 4.0,
            "a short screen still scrolls the rest of the canon"
        );
        let card = *mark(&marks, "modal-card");
        assert!(
            card[1] >= -1.0 && card[1] + card[3] <= 321.0,
            "the short-screen card stays inside the window, {card:?}"
        );
    }

    #[test]
    fn test_strongs_unconfigured_guidance() {
        let mut app = bare(Session::new());
        app.session.strongs_dicts.clear();
        app.lookup_dict_with_context("H1234", None, None, None);
        assert_eq!(
            app.session.dict_body,
            graphe_domain::i18n::t("dictNoDictsConfigured")
        );
        assert_eq!(app.session.sidebar, "dictionary");
    }

    #[test]
    fn test_pseudo_strong_no_entry_explanation() {
        let mut app = bare(Session::new());
        app.lookup_dict_focused("H9000", false);
        assert_eq!(
            app.session.dict_body,
            graphe_domain::i18n::t("dictPseudoStrongsNoEntry")
        );
    }

    #[test]
    fn test_switching_theme_clears_reading_cache_and_applies_style() {
        let ctx = egui::Context::default();
        let mut app = bare(Session::new());
        app.reading
            .remember_verse_text("k1".into(), vec![(1, "In the beginning".into())]);
        assert!(app.reading.cached_verse_text("k1").is_some());

        // Initial update in light theme
        let mut raw = egui::RawInput::default();
        raw.screen_rect = Some(egui::Rect::from_min_size(
            egui::Pos2::ZERO,
            egui::vec2(800.0, 600.0),
        ));
        let _ = ctx.run_test_ui(raw.clone(), |ctx| {
            let mut frame = eframe::Frame::_new_kittest();
            <GrapheApp as eframe::App>::ui(&mut app, ctx, &mut frame);
        });
        let ramp = ctx
            .global_style()
            .visuals
            .text_options
            .color_transfer_function;
        assert_eq!(
            ramp,
            egui::epaint::FontColorTransferFunction::DARK_MODE_DEFAULT
        );

        // Toggle to dark theme
        app.session.dark = true;
        let _ = ctx.run_test_ui(raw.clone(), |ctx| {
            let mut frame = eframe::Frame::_new_kittest();
            <GrapheApp as eframe::App>::ui(&mut app, ctx, &mut frame);
        });

        assert!(app.applied_dark);
        assert!(app.reading.cached_verse_text("k1").is_none());
        assert!(ctx.global_style().visuals.dark_mode);
        assert_eq!(
            ctx.global_style()
                .visuals
                .text_options
                .color_transfer_function,
            ramp
        );

        // Repopulate and toggle back to light theme
        app.reading
            .remember_verse_text("k2".into(), vec![(2, "God created".into())]);
        app.session.dark = false;
        let _ = ctx.run_test_ui(raw, |ctx| {
            let mut frame = eframe::Frame::_new_kittest();
            <GrapheApp as eframe::App>::ui(&mut app, ctx, &mut frame);
        });

        assert!(!app.applied_dark);
        assert!(app.reading.cached_verse_text("k2").is_none());
        assert!(!ctx.global_style().visuals.dark_mode);
        assert_eq!(
            ctx.global_style()
                .visuals
                .text_options
                .color_transfer_function,
            ramp
        );
    }

    #[test]
    fn test_update_banner_shows_download_button_and_dismisses() {
        let ctx = egui::Context::default();
        let mut app = bare(Session::new());
        let palette = theme::palette(false);

        // When no update notice, update banner produces no marks
        let mut raw = egui::RawInput::default();
        raw.screen_rect = Some(egui::Rect::from_min_size(
            egui::Pos2::ZERO,
            egui::vec2(800.0, 600.0),
        ));
        let _ = ctx.run_test_ui(raw.clone(), |ctx| {
            app.update_banner(ctx, palette);
        });

        // Set an update notice
        *app.update_notice.lock().unwrap() = Some("1.0.14".into());

        // Now update banner renders download and close marks
        let _ = ctx.run_test_ui(raw.clone(), |ctx| {
            ctx.data_mut(|d| {
                d.remove_temp::<Vec<(String, [f32; 4])>>(egui::Id::unique("pane-layout-marks"));
            });
            app.update_banner(ctx, palette);
        });
        let marks = ctx.data(|d| {
            d.get_temp::<Vec<(String, [f32; 4])>>(egui::Id::unique("pane-layout-marks"))
                .unwrap_or_default()
        });
        assert!(marks.iter().any(|(key, _)| key == "update-download"));
        let close_mark = marks
            .iter()
            .find(|(key, _)| key == "update-close")
            .map(|(_, r)| *r)
            .expect("close button");

        // Click the close button
        let mut click_raw = egui::RawInput::default();
        click_raw.screen_rect = Some(egui::Rect::from_min_size(
            egui::Pos2::ZERO,
            egui::vec2(800.0, 600.0),
        ));
        click_raw.events = vec![
            egui::Event::PointerButton {
                pos: egui::pos2(
                    close_mark[0] + close_mark[2] / 2.0,
                    close_mark[1] + close_mark[3] / 2.0,
                ),
                button: egui::PointerButton::Primary,
                pressed: true,
                modifiers: egui::Modifiers::default(),
            },
            egui::Event::PointerButton {
                pos: egui::pos2(
                    close_mark[0] + close_mark[2] / 2.0,
                    close_mark[1] + close_mark[3] / 2.0,
                ),
                button: egui::PointerButton::Primary,
                pressed: false,
                modifiers: egui::Modifiers::default(),
            },
        ];
        let _ = ctx.run_test_ui(click_raw, |ctx| {
            app.update_banner(ctx, palette);
        });

        // Notice should now be None (dismissed)
        assert!(app.update_notice.lock().unwrap().is_none());
    }

    #[test]
    fn following_commentary_ref_scrolls_verse_to_top() {
        let ctx = egui::Context::default();
        let mut app = bare(Session::new());
        app.session.sidebar_collapsed = true;
        let dir = std::env::temp_dir().join(format!("graphe-comm-scroll-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let bible_path = dir.join("bible.SQLite3");
        let line = "No principio criou Deus os ceus e a terra. ".repeat(6);
        write_chapter(&bible_path, 40, |verse| format!("{verse} {line}"));
        app.modules.push(bible_module("bible", "Bible", bible_path));
        app.session.panes.get_mut("pane-1").unwrap().module_id = Some("bible".into());

        let mut time = 0.0;
        let _ = study_frame(&ctx, &mut app, time, egui::Modifiers::default(), Vec::new());

        let commentary_pane = app.session.split_commentary(false);

        time += 0.1;
        let _ = study_frame(&ctx, &mut app, time, egui::Modifiers::default(), Vec::new());

        // Middle verse (verse 15) centers the verse toward the middle of the view
        app.follow_ref(&commentary_pane, 10, 1, Some(15));
        time += 0.1;
        let frame15 = study_frame(&ctx, &mut app, time, egui::Modifiers::default(), Vec::new());
        let offset_15 = mark(&frame15, "chapter-offset:pane-1")[1];
        assert!(offset_15 > 200.0, "offset was {}", offset_15);
        assert_eq!(app.session.selected_verses, vec![15]);

        // First verse (verse 1) shows the verse at the top
        app.follow_ref(&commentary_pane, 10, 1, Some(1));
        time += 0.1;
        let frame1 = study_frame(&ctx, &mut app, time, egui::Modifiers::default(), Vec::new());
        let offset_1 = mark(&frame1, "chapter-offset:pane-1")[1];
        assert_eq!(offset_1, 0.0);
        assert_eq!(app.session.selected_verses, vec![1]);

        // Last verse (verse 40) shows the verse at the bottom
        app.follow_ref(&commentary_pane, 10, 1, Some(40));
        time += 0.1;
        let frame40 = study_frame(&ctx, &mut app, time, egui::Modifiers::default(), Vec::new());
        let offset_40 = mark(&frame40, "chapter-offset:pane-1")[1];
        assert!(
            offset_40 > offset_15,
            "offset_40 {offset_40} should be greater than offset_15 {offset_15}"
        );
        assert_eq!(app.session.selected_verses, vec![40]);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn clicking_search_hit_scrolls_and_selects_verse() {
        let ctx = egui::Context::default();
        let mut app = bare(Session::new());
        let dir = std::env::temp_dir().join(format!("graphe-search-scroll-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let bible_path = dir.join("bible.SQLite3");
        let line = "No principio criou Deus os ceus e a terra. ".repeat(6);
        write_chapter(&bible_path, 40, |verse| format!("{verse} {line}"));
        app.modules.push(bible_module("bible", "Bible", bible_path));
        app.session.panes.get_mut("pane-1").unwrap().module_id = Some("bible".into());

        app.session.sidebar = "search".into();
        let hits = vec![
            graphe_domain::search::SearchHit {
                book_number: 10,
                chapter: 1,
                verse: 1,
                text: "No principio...".into(),
            },
            graphe_domain::search::SearchHit {
                book_number: 10,
                chapter: 1,
                verse: 20,
                text: "No principio...".into(),
            },
            graphe_domain::search::SearchHit {
                book_number: 10,
                chapter: 1,
                verse: 40,
                text: "No principio...".into(),
            },
        ];
        app.session.hits = hits.clone();

        // Click hit 1 (verse 20 - middle verse)
        app.session.open_search_hit(&hits[1]);
        let mut time = 0.1;
        let frame20 = study_frame(&ctx, &mut app, time, egui::Modifiers::default(), Vec::new());
        let offset_20 = mark(&frame20, "chapter-offset:pane-1")[1];
        assert!(offset_20 > 200.0);
        assert_eq!(app.session.selected_verses, vec![20]);

        // Click hit 0 (verse 1 - first verse)
        app.session.open_search_hit(&hits[0]);
        time += 0.1;
        let frame1 = study_frame(&ctx, &mut app, time, egui::Modifiers::default(), Vec::new());
        let offset_1 = mark(&frame1, "chapter-offset:pane-1")[1];
        assert_eq!(offset_1, 0.0);
        assert_eq!(app.session.selected_verses, vec![1]);

        // Click hit 2 (verse 40 - last verse)
        app.session.open_search_hit(&hits[2]);
        time += 0.1;
        let frame40 = study_frame(&ctx, &mut app, time, egui::Modifiers::default(), Vec::new());
        let offset_40 = mark(&frame40, "chapter-offset:pane-1")[1];
        assert!(offset_40 > offset_20);
        assert_eq!(app.session.selected_verses, vec![40]);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn clicking_search_hit_when_already_in_same_chapter_scrolls_to_selected_verse() {
        let ctx = egui::Context::default();
        let mut app = bare(Session::new());
        let dir =
            std::env::temp_dir().join(format!("graphe-search-scroll-same-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let bible_path = dir.join("bible.SQLite3");
        let line = "No principio criou Deus os ceus e a terra. ".repeat(6);
        write_chapter(&bible_path, 40, |verse| format!("{verse} {line}"));
        app.modules.push(bible_module("bible", "Bible", bible_path));
        app.session.panes.get_mut("pane-1").unwrap().module_id = Some("bible".into());

        app.session.sidebar = "search".into();
        let hit = graphe_domain::search::SearchHit {
            book_number: 10,
            chapter: 1,
            verse: 32,
            text: "No principio...".into(),
        };
        app.session.hits = vec![hit.clone()];

        // Render initial frame - pane is on chapter 1
        let mut time = 0.1;
        let frame1 = study_frame(&ctx, &mut app, time, egui::Modifiers::default(), Vec::new());
        let offset_initial = mark(&frame1, "chapter-offset:pane-1")[1];
        assert_eq!(offset_initial, 0.0);

        // Now user clicks search hit Gn 1:32 while already in chapter 1
        app.session.open_search_hit(&hit);
        time += 0.1;
        let frame32 = study_frame(&ctx, &mut app, time, egui::Modifiers::default(), Vec::new());
        let offset_32 = mark(&frame32, "chapter-offset:pane-1")[1];
        assert!(offset_32 > 500.0, "offset_32 was {offset_32}");
        assert_eq!(app.session.selected_verses, vec![32]);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn search_hit_scrolls_to_selected_verse_with_multiline_cross_references() {
        let dir =
            std::env::temp_dir().join(format!("graphe-search-scroll-xrefs-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let bible_path = dir.join("bible.SQLite3");
        let line = "No principio criou Deus os ceus e a terra. ".repeat(4);
        write_chapter(&bible_path, 40, |verse| format!("{verse} {line}"));

        let xref_path = dir.join("xrefs.SQLite3");
        let mut sql = String::from(
            "CREATE TABLE cross_references (book INTEGER, chapter INTEGER, verse INTEGER, verse_end INTEGER, book_to INTEGER, chapter_to INTEGER, verse_to_start INTEGER, verse_to_end INTEGER, votes INTEGER);\n",
        );
        // Add 25 cross references to verses 10..25 to cause row height expansion
        for verse in 10..=25 {
            for v_to in 1..=25 {
                sql.push_str(&format!(
                    "INSERT INTO cross_references VALUES (10, 1, {verse}, NULL, 20, 1, {v_to}, NULL, 1);\n"
                ));
            }
        }
        graphe_store::sqlite::init_module_sql(&xref_path, &sql).unwrap();

        let ctx = egui::Context::default();
        let mut app = bare(Session::new());
        app.modules.push(bible_module("bible", "Bible", bible_path));
        app.modules.push(graphe_store::catalog::InstalledModule {
            id: "xrefs".into(),
            name: "Cross References".into(),
            kind: "crossreference".into(),
            path: xref_path,
            short_title: Some("XREF".into()),
            description: None,
        });
        app.session.xref_modules = vec!["xrefs".into()];
        app.session.panes.get_mut("pane-1").unwrap().module_id = Some("bible".into());
        app.session.panes.get_mut("pane-1").unwrap().book_number = 10;
        app.session.panes.get_mut("pane-1").unwrap().chapter = 1;
        app.session.panes.get_mut("pane-1").unwrap().selected_verse = None;

        let raw = egui::RawInput {
            screen_rect: Some(egui::Rect::from_min_size(
                egui::Pos2::ZERO,
                egui::vec2(1200.0, 800.0),
            )),
            ..Default::default()
        };

        // Render initial frame at top of chapter
        let _ = ctx.run_test_ui(raw.clone(), |ctx| {
            app.sidebar(ctx, theme::palette(false));
            app.editor(ctx, theme::palette(false));
        });

        // User clicks search hit for verse 32
        let hit = graphe_domain::search::SearchHit {
            book_number: 10,
            chapter: 1,
            verse: 32,
            text: "No principio...".into(),
        };
        app.session.open_search_hit(&hit);
        app.loaded_key.clear();
        app.sync_active_chapter();

        // Run multi-frame passes for scroll convergence
        for _ in 0..6 {
            let _ = ctx.run_test_ui(raw.clone(), |ctx| {
                app.sidebar(ctx, theme::palette(false));
                app.editor(ctx, theme::palette(false));
            });
            if app.session.scroll_verse.is_none() {
                break;
            }
        }

        let marks = ctx.data(|data| {
            data.get_temp::<Vec<(String, [f32; 4])>>(egui::Id::unique("pane-layout-marks"))
                .unwrap_or_default()
        });
        let v32 = marks.iter().find(|(k, _)| k.contains("verse:pane-1:32"));
        assert!(v32.is_some(), "verse 32 should be rendered in viewport");
        let rect = v32.unwrap().1;
        assert!(
            rect[1] < 800.0 && rect[1] + rect[3] > 0.0,
            "verse 32 must be visible in viewport, got y={}..{}",
            rect[1],
            rect[1] + rect[3]
        );
        assert_eq!(app.session.selected_verses, vec![32]);
        assert!(
            app.session.scroll_verse.is_none(),
            "scroll_verse should have settled to None"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn search_hit_scrolls_to_gn_18_32_in_acf_with_tsk() {
        let userprofile = match std::env::var("USERPROFILE") {
            Ok(val) => std::path::PathBuf::from(val),
            Err(_) => return,
        };
        let acf_path = userprofile
            .join(".graphe")
            .join("modules")
            .join("Almeida Corrigida Fiel 2011 com Strong.bible.SQLite3");
        if !acf_path.exists() {
            return;
        }

        let ctx = egui::Context::default();
        let mut app = bare(Session::new());
        app.modules.push(bible_module("ACF11", "ACF11*", acf_path));
        app.session.panes.get_mut("pane-1").unwrap().module_id = Some("ACF11".into());
        app.session.panes.get_mut("pane-1").unwrap().book_number = 10;
        app.session.panes.get_mut("pane-1").unwrap().chapter = 18;
        app.session.panes.get_mut("pane-1").unwrap().selected_verse = None;
        app.session.sidebar_collapsed = false;
        app.session.sidebar = "search".into();
        app.session.show_strongs = true;

        let xref_path = userprofile
            .join(".graphe")
            .join("modules")
            .join("The Treasury of Scripture Knowledge.crossreference.SQLite3");
        if xref_path.exists() {
            app.modules.push(graphe_store::catalog::InstalledModule {
                id: "The Treasury of Scripture Knowledge.crossreference".into(),
                name: "TSK".into(),
                kind: "crossreference".into(),
                path: xref_path,
                short_title: Some("TSK".into()),
                description: None,
            });
            app.session.xref_modules =
                vec!["The Treasury of Scripture Knowledge.crossreference".into()];
        }

        let raw = egui::RawInput {
            screen_rect: Some(egui::Rect::from_min_size(
                egui::Pos2::ZERO,
                egui::vec2(1872.0, 974.0),
            )),
            ..Default::default()
        };
        let _ = ctx.run_test_ui(raw.clone(), |ctx| {
            app.sidebar(ctx, theme::palette(false));
            app.editor(ctx, theme::palette(false));
        });

        let hit32 = graphe_domain::search::SearchHit {
            book_number: 10,
            chapter: 18,
            verse: 32,
            text: "Disse mais: Ora...".into(),
        };
        app.session.open_search_hit(&hit32);
        app.loaded_key.clear();
        app.sync_active_chapter();

        for _ in 0..6 {
            let _ = ctx.run_test_ui(raw.clone(), |ctx| {
                app.sidebar(ctx, theme::palette(false));
                app.editor(ctx, theme::palette(false));
            });
            if app.session.scroll_verse.is_none() {
                break;
            }
        }

        let marks = ctx.data(|data| {
            data.get_temp::<Vec<(String, [f32; 4])>>(egui::Id::unique("pane-layout-marks"))
                .unwrap_or_default()
        });
        let v32 = marks.iter().find(|(k, _)| k.contains("verse:pane-1:32"));
        assert!(v32.is_some(), "Gn 18:32 should be rendered in viewport");
        let rect = v32.unwrap().1;
        assert!(
            rect[1] < 974.0 && rect[1] + rect[3] > 0.0,
            "Gn 18:32 must be visible in viewport, got y={}..{}",
            rect[1],
            rect[1] + rect[3]
        );
        assert_eq!(app.session.selected_verses, vec![32]);
        assert!(app.session.scroll_verse.is_none());
    }

    #[test]
    fn clicking_commentary_reference_link_scrolls_verse() {
        let ctx = egui::Context::default();
        let mut app = bare(Session::new());
        app.session.sidebar_collapsed = true;
        let dir = std::env::temp_dir().join(format!("graphe-comm-link-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let bible_path = dir.join("bible.SQLite3");
        let line = "No principio criou Deus os ceus e a terra. ".repeat(6);
        write_chapter(&bible_path, 40, |verse| format!("{verse} {line}"));
        app.modules.push(bible_module("bible", "Bible", bible_path));
        app.session.panes.get_mut("pane-1").unwrap().module_id = Some("bible".into());

        let commentary_pane = app.session.split_commentary(false);
        let path = std::path::PathBuf::from("notes.commentaries.SQLite3");
        app.modules.push(graphe_store::catalog::InstalledModule {
            id: "notes".into(),
            name: "Notes".into(),
            kind: "commentary".into(),
            path: path.clone(),
            short_title: None,
            description: None,
        });
        if let Some(record) = app.session.panes.get_mut(&commentary_pane) {
            record.module_id = Some("notes".into());
        }
        let pieces = vec![
            crate::study::CommentaryPiece::Heading("Commentary".into()),
            crate::study::CommentaryPiece::Break,
            crate::study::CommentaryPiece::Text("See ".into()),
            crate::study::CommentaryPiece::Link {
                label: "Gn 1:25".into(),
                book: 10,
                chapter: 1,
                verse: Some(25),
            },
        ];
        let key = crate::study::commentary_key(&path, 10, 1, i18n::get_current_lang().as_str());
        app.reading
            .commentary
            .insert(key, crate::study::CommentaryPaint::new(pieces));

        let mut time = 0.0;
        let marks = study_frame(&ctx, &mut app, time, egui::Modifiers::default(), Vec::new());
        let text_rect = *mark(&marks, &format!("commentary-text:{commentary_pane}"));
        let link_pos = egui::pos2(text_rect[0] + 35.0, text_rect[1] + 30.0);

        // Hover over link
        time += 0.1;
        let _ = study_frame(
            &ctx,
            &mut app,
            time,
            egui::Modifiers::default(),
            vec![egui::Event::PointerMoved(link_pos)],
        );

        // Click link: press down at time 0.2, release at time 0.3
        time += 0.1;
        let _ = study_frame(
            &ctx,
            &mut app,
            time,
            egui::Modifiers::default(),
            vec![egui::Event::PointerButton {
                pos: link_pos,
                button: egui::PointerButton::Primary,
                pressed: true,
                modifiers: egui::Modifiers::default(),
            }],
        );
        time += 0.1;
        let _ = study_frame(
            &ctx,
            &mut app,
            time,
            egui::Modifiers::default(),
            vec![egui::Event::PointerButton {
                pos: link_pos,
                button: egui::PointerButton::Primary,
                pressed: false,
                modifiers: egui::Modifiers::default(),
            }],
        );

        // Frame after click should have scrolled Bible to verse 25
        time += 0.1;
        let frame1 = study_frame(&ctx, &mut app, time, egui::Modifiers::default(), Vec::new());
        let offset = *mark(&frame1, "chapter-offset:pane-1");
        assert!(offset[1] > 200.0, "offset was {}", offset[1]);
        assert_eq!(app.session.selected_verses, vec![25]);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn clicking_commentary_body_ref_after_selecting_text() {
        let ctx = egui::Context::default();
        let mut app = bare(Session::new());
        app.session.sidebar_collapsed = true;
        let dir = std::env::temp_dir().join(format!("graphe-comm-link-sel-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let bible_path = dir.join("bible.SQLite3");
        let line = "No principio criou Deus os ceus e a terra. ".repeat(6);
        write_chapter(&bible_path, 40, |verse| format!("{verse} {line}"));
        app.modules.push(bible_module("bible", "Bible", bible_path));
        app.session.panes.get_mut("pane-1").unwrap().module_id = Some("bible".into());

        let commentary_pane = app.session.split_commentary(false);
        let path = std::path::PathBuf::from("notes.commentaries.SQLite3");
        app.modules.push(graphe_store::catalog::InstalledModule {
            id: "notes".into(),
            name: "Notes".into(),
            kind: "commentary".into(),
            path: path.clone(),
            short_title: None,
            description: None,
        });
        if let Some(record) = app.session.panes.get_mut(&commentary_pane) {
            record.module_id = Some("notes".into());
        }
        let pieces = vec![
            crate::study::CommentaryPiece::Heading("Commentary".into()),
            crate::study::CommentaryPiece::Break,
            crate::study::CommentaryPiece::Text("See ".into()),
            crate::study::CommentaryPiece::Link {
                label: "Gn 1:25".into(),
                book: 10,
                chapter: 1,
                verse: Some(25),
            },
        ];
        let key = crate::study::commentary_key(&path, 10, 1, i18n::get_current_lang().as_str());
        app.reading
            .commentary
            .insert(key, crate::study::CommentaryPaint::new(pieces));

        let mut time = 0.0;
        let marks = study_frame(&ctx, &mut app, time, egui::Modifiers::default(), Vec::new());
        let text_rect = *mark(&marks, &format!("commentary-text:{commentary_pane}"));
        let p_start = egui::pos2(text_rect[0] + 10.0, text_rect[1] + 10.0);
        let p_end = egui::pos2(text_rect[0] + 80.0, text_rect[1] + 10.0);
        let link_pos = egui::pos2(text_rect[0] + 35.0, text_rect[1] + 30.0);

        // Drag to select "Commentary"
        time += 0.1;
        let _ = study_frame(
            &ctx,
            &mut app,
            time,
            egui::Modifiers::default(),
            vec![
                egui::Event::PointerMoved(p_start),
                egui::Event::PointerButton {
                    pos: p_start,
                    button: egui::PointerButton::Primary,
                    pressed: true,
                    modifiers: egui::Modifiers::default(),
                },
            ],
        );
        time += 0.05;
        let _ = study_frame(
            &ctx,
            &mut app,
            time,
            egui::Modifiers::default(),
            vec![egui::Event::PointerMoved(p_end)],
        );
        time += 0.05;
        let _ = study_frame(
            &ctx,
            &mut app,
            time,
            egui::Modifiers::default(),
            vec![egui::Event::PointerButton {
                pos: p_end,
                button: egui::PointerButton::Primary,
                pressed: false,
                modifiers: egui::Modifiers::default(),
            }],
        );

        assert!(label_has_selection(&ctx), "text should be selected");

        // Hover over link
        time += 0.1;
        let _ = study_frame(
            &ctx,
            &mut app,
            time,
            egui::Modifiers::default(),
            vec![egui::Event::PointerMoved(link_pos)],
        );

        // Click link: press down at time, release
        time += 0.1;
        let _ = study_frame(
            &ctx,
            &mut app,
            time,
            egui::Modifiers::default(),
            vec![egui::Event::PointerButton {
                pos: link_pos,
                button: egui::PointerButton::Primary,
                pressed: true,
                modifiers: egui::Modifiers::default(),
            }],
        );
        time += 0.05;
        let _ = study_frame(
            &ctx,
            &mut app,
            time,
            egui::Modifiers::default(),
            vec![egui::Event::PointerMoved(link_pos + egui::vec2(1.0, 0.0))],
        );
        time += 0.05;
        let _ = study_frame(
            &ctx,
            &mut app,
            time,
            egui::Modifiers::default(),
            vec![egui::Event::PointerButton {
                pos: link_pos + egui::vec2(1.0, 0.0),
                button: egui::PointerButton::Primary,
                pressed: false,
                modifiers: egui::Modifiers::default(),
            }],
        );

        // Frame after click should have scrolled Bible to verse 25
        time += 0.1;
        let frame1 = study_frame(&ctx, &mut app, time, egui::Modifiers::default(), Vec::new());
        let offset = *mark(&frame1, "chapter-offset:pane-1");
        assert!(offset[1] > 200.0, "offset was {}", offset[1]);
        assert_eq!(app.session.selected_verses, vec![25]);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn clicking_champlin_hebrews_10_26_ref_after_selecting_text() {
        let user_profile = match std::env::var("USERPROFILE") {
            Ok(val) => val,
            Err(_) => return,
        };
        let comm_path = std::path::PathBuf::from(user_profile)
            .join(".graphe")
            .join("modules")
            .join("Comentario Biblico Champlin Completo.commentary.SQLite3");
        if !comm_path.exists() {
            return;
        }

        let ctx = egui::Context::default();
        let mut app = bare(Session::new());
        app.session.sidebar_collapsed = true;
        let dir = std::env::temp_dir().join(format!("graphe-comm-champ-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let bible_path = dir.join("bible.SQLite3");
        let line = "No principio criou Deus os ceus e a terra. ".repeat(6);
        write_chapter(&bible_path, 40, |verse| format!("{verse} {line}"));
        app.modules.push(bible_module("bible", "Bible", bible_path));
        app.session.panes.get_mut("pane-1").unwrap().module_id = Some("bible".into());

        let commentary_pane = app.session.split_commentary(false);
        app.modules.push(graphe_store::catalog::InstalledModule {
            id: "champlin".into(),
            name: "Champlin".into(),
            kind: "commentary".into(),
            path: comm_path.clone(),
            short_title: None,
            description: None,
        });
        if let Some(record) = app.session.panes.get_mut(&commentary_pane) {
            record.module_id = Some("champlin".into());
        }

        // Navigate both to Hebrews (650) chapter 10, verse 26
        app.session.active_pane_id = "pane-1".into();
        app.session.navigate(650, 10, Some(26));
        app.loaded_key.clear();

        let mut time = 0.0;
        let _marks = study_frame(&ctx, &mut app, time, egui::Modifiers::default(), Vec::new());
        time += 0.1;
        let marks = study_frame(&ctx, &mut app, time, egui::Modifiers::default(), Vec::new());
        let text_rect = *mark(&marks, &format!("commentary-text:{commentary_pane}"));

        // Select some text in the commentary
        let p_start = egui::pos2(text_rect[0] + 50.0, 300.0);
        let p_end = egui::pos2(text_rect[0] + 150.0, 300.0);
        time += 0.1;
        let _ = study_frame(
            &ctx,
            &mut app,
            time,
            egui::Modifiers::default(),
            vec![
                egui::Event::PointerMoved(p_start),
                egui::Event::PointerButton {
                    pos: p_start,
                    button: egui::PointerButton::Primary,
                    pressed: true,
                    modifiers: egui::Modifiers::default(),
                },
            ],
        );
        time += 0.05;
        let _ = study_frame(
            &ctx,
            &mut app,
            time,
            egui::Modifiers::default(),
            vec![egui::Event::PointerMoved(p_end)],
        );
        time += 0.05;
        let _ = study_frame(
            &ctx,
            &mut app,
            time,
            egui::Modifiers::default(),
            vec![egui::Event::PointerButton {
                pos: p_end,
                button: egui::PointerButton::Primary,
                pressed: false,
                modifiers: egui::Modifiers::default(),
            }],
        );

        assert!(
            label_has_selection(&ctx),
            "commentary must have active selection"
        );

        let (first_link_book, first_link_chapter, first_link_verse, link_pos) = {
            let window = app.reading.commentary_window(&commentary_pane).expect("window exists");
            assert!(!window.links.is_empty(), "there should be links in Hebrews 10:26");
            let first_link = &window.links[0];
            let link_cursor = window.galley.pos_from_cursor(egui::text::CCursor::new(first_link.start));
            let link_pos = egui::pos2(text_rect[0] + link_cursor.min.x + 5.0, text_rect[1] + link_cursor.min.y + 5.0);
            (first_link.book, first_link.chapter, first_link.verse, link_pos)
        };

        time += 0.1;
        let _ = study_frame(
            &ctx,
            &mut app,
            time,
            egui::Modifiers::default(),
            vec![egui::Event::PointerMoved(link_pos)],
        );

        time += 0.1;
        let _ = study_frame(
            &ctx,
            &mut app,
            time,
            egui::Modifiers::default(),
            vec![egui::Event::PointerButton {
                pos: link_pos,
                button: egui::PointerButton::Primary,
                pressed: true,
                modifiers: egui::Modifiers::default(),
            }],
        );

        time += 0.05;
        let _ = study_frame(
            &ctx,
            &mut app,
            time,
            egui::Modifiers::default(),
            vec![egui::Event::PointerButton {
                pos: link_pos,
                button: egui::PointerButton::Primary,
                pressed: false,
                modifiers: egui::Modifiers::default(),
            }],
        );

        time += 0.1;
        let _ = study_frame(&ctx, &mut app, time, egui::Modifiers::default(), Vec::new());
        let bible_pane = app.session.panes.get("pane-1").unwrap();
        assert_eq!(bible_pane.book_number, first_link_book);
        assert_eq!(bible_pane.chapter, first_link_chapter);
        assert_eq!(bible_pane.selected_verse, first_link_verse);
        assert!(!label_has_selection(&ctx), "selection should be cleared after navigating via link");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn champlin_hebrews_10_26_links_deut_17_26() {
        let user_profile = match std::env::var("USERPROFILE") {
            Ok(val) => val,
            Err(_) => return,
        };
        let comm_path = std::path::PathBuf::from(user_profile)
            .join(".graphe")
            .join("modules")
            .join("Comentario Biblico Champlin Completo.commentary.SQLite3");
        if !comm_path.exists() {
            return;
        }

        let ctx = egui::Context::default();
        let mut app = bare(Session::new());
        app.session.sidebar_collapsed = true;
        let commentary_pane = app.session.split_commentary(false);
        app.modules.push(graphe_store::catalog::InstalledModule {
            id: "champlin".into(),
            name: "Champlin".into(),
            kind: "commentary".into(),
            path: comm_path,
            short_title: None,
            description: None,
        });
        if let Some(record) = app.session.panes.get_mut(&commentary_pane) {
            record.module_id = Some("champlin".into());
        }

        app.session.active_pane_id = "pane-1".into();
        app.session.navigate(650, 10, Some(26));
        app.loaded_key.clear();

        let _ = study_frame(&ctx, &mut app, 0.0, egui::Modifiers::default(), Vec::new());
        let _ = study_frame(&ctx, &mut app, 0.1, egui::Modifiers::default(), Vec::new());

        let module = app.modules.iter().find(|m| m.id == "champlin").unwrap().clone();
        let paint = app.load_commentary(&module, 650, 10);
        let deut_piece = paint.pieces.iter().find(|p| match p {
            crate::study::CommentaryPiece::Link { book, chapter, verse, .. } => *book == 50 && *chapter == 17 && *verse == Some(26),
            _ => false,
        });
        assert!(
            deut_piece.is_some(),
            "Deut. 17:26 must be recognized as a link in Hebrews 10:26 pieces"
        );
        // Scroll down to piece 1930
        let at = egui::pos2(800.0, 400.0);
        let mut time = 0.2;
        for _ in 0..4 {
            time += 0.05;
            let _ = study_frame(&ctx, &mut app, time, egui::Modifiers::default(), wheel_down(at));
        }
        let (_deut_link, link_cursor) = {
            let window = app.reading.commentary_window(&commentary_pane).expect("window exists");
            let deut_link = window
                .links
                .iter()
                .find(|l| l.book == 50 && l.chapter == 17 && l.verse == Some(26))
                .copied()
                .expect("Deut. 17:26 must appear in window.links after scrolling to it");
            let link_cursor = window.galley.pos_from_cursor(egui::text::CCursor::new(deut_link.start));
            (deut_link, link_cursor)
        };

        let marks = study_frame(&ctx, &mut app, time, egui::Modifiers::default(), Vec::new());
        let text_rect = *mark(&marks, &format!("commentary-text:{commentary_pane}"));
        let link_pos = egui::pos2(text_rect[0] + link_cursor.min.x + 5.0, text_rect[1] + link_cursor.min.y + 5.0);

        time += 0.1;
        let _ = study_frame(
            &ctx,
            &mut app,
            time,
            egui::Modifiers::default(),
            vec![
                egui::Event::PointerMoved(link_pos),
                egui::Event::PointerButton {
                    pos: link_pos,
                    button: egui::PointerButton::Primary,
                    pressed: true,
                    modifiers: egui::Modifiers::default(),
                },
            ],
        );
        time += 0.05;
        let _ = study_frame(
            &ctx,
            &mut app,
            time,
            egui::Modifiers::default(),
            vec![
                egui::Event::PointerMoved(link_pos + egui::vec2(1.0, 1.0)),
                egui::Event::PointerButton {
                    pos: link_pos + egui::vec2(1.0, 1.0),
                    button: egui::PointerButton::Primary,
                    pressed: false,
                    modifiers: egui::Modifiers::default(),
                },
            ],
        );
        time += 0.1;
        let _ = study_frame(&ctx, &mut app, time, egui::Modifiers::default(), Vec::new());

        let bible = app.session.panes.get("pane-1").unwrap();
        assert_eq!(bible.book_number, 50);
        assert_eq!(bible.chapter, 17);
        assert_eq!(bible.selected_verse, Some(26));
    }

    #[test]
    fn open_navigation_targets_synced_bible_pane_when_commentary_active() {
        let mut app = bare(Session::new());
        let comm_pane = app.session.split_commentary(false);
        if let Some(pane) = app.session.panes.get_mut(&comm_pane) {
            pane.synced_to_pane_id = Some("pane-1".into());
        }
        app.session.active_pane_id = comm_pane;
        app.open_navigation();
        assert_eq!(
            app.nav.as_ref().and_then(|n| n.active_pane_id.as_deref()),
            Some("pane-1")
        );
    }

    #[test]
    fn typing_verse_reference_scrolls_to_verse_even_when_commentary_active() {
        let userprofile = match std::env::var("USERPROFILE") {
            Ok(val) => std::path::PathBuf::from(val),
            Err(_) => return,
        };
        let bible_path = userprofile
            .join(".graphe")
            .join("modules")
            .join("Nova Almeida Atualizada.bible.SQLite3");
        if !bible_path.exists() {
            return;
        }

        let ctx = egui::Context::default();
        let mut app = bare(Session::new());
        app.modules.push(bible_module("NAA", "NAA", bible_path));
        app.session.panes.get_mut("pane-1").unwrap().module_id = Some("NAA".into());
        app.session.panes.get_mut("pane-1").unwrap().book_number = 650;
        app.session.panes.get_mut("pane-1").unwrap().chapter = 10;
        app.session.panes.get_mut("pane-1").unwrap().selected_verse = None;

        let comm_path = userprofile
            .join(".graphe")
            .join("modules")
            .join("Comentario Biblico Champlin Completo.commentary.SQLite3");
        if comm_path.exists() {
            app.modules.push(graphe_store::catalog::InstalledModule {
                id: "Champlin".into(),
                name: "Champlin".into(),
                kind: "commentary".into(),
                path: comm_path,
                short_title: None,
                description: None,
            });
            let comm_pane = app.session.split_commentary(false);
            if let Some(pane) = app.session.panes.get_mut(&comm_pane) {
                pane.module_id = Some("Champlin".into());
                pane.synced_to_pane_id = Some("pane-1".into());
            }
        }

        let xref_path = userprofile
            .join(".graphe")
            .join("modules")
            .join("The Treasury of Scripture Knowledge.crossreference.SQLite3");
        if xref_path.exists() {
            app.modules.push(graphe_store::catalog::InstalledModule {
                id: "TSK".into(),
                name: "TSK".into(),
                kind: "crossreference".into(),
                path: xref_path,
                short_title: None,
                description: None,
            });
            app.session.xref_modules = vec!["TSK".into()];
        }

        // Frame 0: render at top
        let raw = egui::RawInput {
            screen_rect: Some(egui::Rect::from_min_size(
                egui::Pos2::ZERO,
                egui::vec2(1200.0, 800.0),
            )),
            ..Default::default()
        };
        let _ = ctx.run_test_ui(raw.clone(), |ui| app.show_workbench(ui));

        // Open navigation dialog and type Hb 10:26 and press Enter
        app.open_navigation();
        let _ = ctx.run_test_ui(raw.clone(), |ui| app.show_workbench(ui));

        let raw2 = egui::RawInput {
            screen_rect: Some(egui::Rect::from_min_size(
                egui::Pos2::ZERO,
                egui::vec2(1200.0, 800.0),
            )),
            events: vec![
                egui::Event::Text("Hb 10:26".into()),
                egui::Event::Key {
                    key: egui::Key::Enter,
                    physical_key: Some(egui::Key::Enter),
                    pressed: true,
                    repeat: false,
                    modifiers: egui::Modifiers::default(),
                },
            ],
            ..Default::default()
        };
        let _ = ctx.run_test_ui(raw2, |ui| app.show_workbench(ui));

        assert_eq!(app.session.selected_verses, vec![26]);

        for _ in 1..=5 {
            let _ = ctx.run_test_ui(raw.clone(), |ui| app.show_workbench(ui));
        }

        let marks = ctx.data(|d| d.get_temp::<Vec<(String, [f32; 4])>>(egui::Id::unique("pane-layout-marks")).unwrap_or_default());
        let offset = marks.iter().find(|(k, _)| k == "chapter-offset:pane-1").map(|(_, r)| *r).expect("chapter offset");
        assert!(offset[1] > 4000.0, "bible pane should scroll to verse 26, got {}", offset[1]);

        let comm_offset = marks.iter().find(|(k, _)| k.starts_with("commentary-offset")).map(|(_, r)| *r).expect("commentary offset");
        assert!(comm_offset[1] > 50000.0, "commentary pane should scroll to verse 26, got {}", comm_offset[1]);
    }

    #[test]
    fn missing_reference_shows_feedback_and_clears_on_edit() {
        let mut app = bare(Session::new());
        let ctx = egui::Context::default();
        let raw = egui::RawInput {
            screen_rect: Some(egui::Rect::from_min_size(
                egui::Pos2::ZERO,
                egui::vec2(1200.0, 800.0),
            )),
            ..Default::default()
        };
        let _ = ctx.run_test_ui(raw.clone(), |ui| app.show_workbench(ui));

        // Open navigation dialog
        app.open_navigation();
        let _ = ctx.run_test_ui(raw.clone(), |ui| app.show_workbench(ui));
        assert!(app.nav.is_some());
        assert!(!app.nav.as_ref().unwrap().not_found);

        // Submit invalid reference
        let raw2 = egui::RawInput {
            screen_rect: Some(egui::Rect::from_min_size(
                egui::Pos2::ZERO,
                egui::vec2(1200.0, 800.0),
            )),
            events: vec![
                egui::Event::Text("nonexistent 1:1".into()),
                egui::Event::Key {
                    key: egui::Key::Enter,
                    physical_key: Some(egui::Key::Enter),
                    pressed: true,
                    repeat: false,
                    modifiers: egui::Modifiers::default(),
                },
            ],
            ..Default::default()
        };
        let _ = ctx.run_test_ui(raw2, |ui| app.show_workbench(ui));

        // Dialog should remain open, not_found should be true
        assert_eq!(app.session.dialog, Dialog::Navigation);
        assert!(app.nav.as_ref().unwrap().not_found);

        // Next frame renders the feedback label
        let _ = ctx.run_test_ui(raw.clone(), |ui| app.show_workbench(ui));

        let marks = ctx.data(|d| {
            d.get_temp::<Vec<(String, [f32; 4])>>(egui::Id::unique("pane-layout-marks"))
                .unwrap_or_default()
        });
        assert!(
            marks.iter().any(|(k, _)| k == "nav-not-found"),
            "feedback label should be laid out"
        );

        // Typing clears the not_found state
        let raw3 = egui::RawInput {
            screen_rect: Some(egui::Rect::from_min_size(
                egui::Pos2::ZERO,
                egui::vec2(1200.0, 800.0),
            )),
            events: vec![egui::Event::Text("g".into())],
            ..Default::default()
        };
        let _ = ctx.run_test_ui(raw3, |ui| app.show_workbench(ui));
        assert!(!app.nav.as_ref().unwrap().not_found);
    }
}
