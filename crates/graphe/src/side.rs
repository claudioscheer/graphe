//! Sidebar: search, dictionary, and installed modules.

use crate::app::{label_for, GrapheApp};
use crate::paint;
use crate::session::Dialog;
use graphe_domain::dict::normalize_topic_candidate;
use graphe_domain::i18n;
use graphe_domain::search::{
    extract_search_terms, highlight_text, parse_search_query, search_preview_snippet,
};
use graphe_domain::theme::UiPalette;
use graphe_store::sqlite;
use std::path::{Path, PathBuf};

impl GrapheApp {
    pub(crate) fn sidebar(&mut self, ctx: &egui::Context, palette: &UiPalette) {
        if self.session.sidebar_collapsed {
            return;
        }
        egui::SidePanel::left("sidebar")
            .resizable(true)
            .default_width(300.0)
            .frame(paint::panel(palette.ui_surface))
            .show(ctx, |ui| {
                ui.horizontal(|ui| {
                    ui.label(
                        egui::RichText::new(label_for(&self.session.sidebar).to_uppercase())
                            .size(11.0)
                            .strong()
                            .color(paint::color(palette.ui_text_muted)),
                    );
                });
                ui.separator();
                match self.session.sidebar.as_str() {
                    "dictionary" => self.dictionary_panel(ui, palette),
                    "modules" => self.modules_panel(ui),
                    _ => self.search_panel(ui, palette),
                }
            });
    }

    fn search_panel(&mut self, ui: &mut egui::Ui, palette: &UiPalette) {
        let bibles: Vec<_> = self
            .modules
            .iter()
            .filter(|module| module.kind == "bible")
            .cloned()
            .collect();
        let current_name = bibles
            .iter()
            .find(|module| self.session.search_module_id.as_deref() == Some(module.id.as_str()))
            .or_else(|| bibles.first())
            .map(|module| module.name.clone())
            .unwrap_or_else(|| "—".into());
        let options: Vec<(String, String)> = bibles
            .iter()
            .map(|module| (module.id.clone(), module.name.clone()))
            .collect();
        if let Some(id) = crate::study::choose_module(
            ui,
            "search-module",
            &current_name,
            &options,
            self.session.search_module_id.as_deref(),
        ) {
            self.session.search_module_id = Some(id);
        }
        let response = ui.add(
            egui::TextEdit::singleline(&mut self.session.query)
                .hint_text(i18n::t("searchPlaceholder"))
                .desired_width(ui.available_width()),
        );
        if response.lost_focus() && ui.input(|input| input.key_pressed(egui::Key::Enter)) {
            self.run_search();
        }
        let parsed = parse_search_query(Some(&self.session.query));
        if self.session.hits.is_empty()
            && !self.session.query.trim().is_empty()
            && parsed.strongs.is_empty()
            && parsed.exact_phrases.is_empty()
            && parsed.text_terms.is_empty()
        {
            ui.label(i18n::t("searchMinChars"));
        } else if !self.session.hits.is_empty() {
            ui.label(i18n::t_fmt(
                "searchResultCount",
                &[("count", &self.session.hits.len().to_string())],
            ));
        }
        let terms = extract_search_terms(&self.session.query);
        let hits = self.session.hits.clone();
        egui::ScrollArea::vertical()
            .auto_shrink([false, false])
            .max_height(ui.available_height())
            .show(ui, |ui| {
                for hit in hits {
                    let snippet = search_preview_snippet(&hit.text, &terms, 160);
                    let marked = highlight_text(&snippet, &terms);
                    let label = format!(
                        "{} {}:{}",
                        i18n::book_name(hit.book_number).short,
                        hit.chapter,
                        hit.verse
                    );
                    ui.vertical(|ui| {
                        ui.spacing_mut().item_spacing.y = 2.0;
                        let response = ui.add(
                            egui::Label::new(
                                egui::RichText::new(label)
                                    .strong()
                                    .size(13.0)
                                    .color(paint::color(palette.ui_link)),
                            )
                            .sense(egui::Sense::click()),
                        );
                        if response.clicked() {
                            let primary =
                                ui.input(|input| input.modifiers.command || input.modifiers.ctrl);
                            if primary {
                                self.session.open_search_hit_in_new_study(&hit);
                                self.note_workspaces();
                            } else {
                                let source = self.session.active_pane_id.clone();
                                let target = self.session.navigation_target(&source);
                                self.session.active_pane_id = target;
                                self.session.navigate(
                                    hit.book_number,
                                    hit.chapter,
                                    Some(hit.verse),
                                );
                            }
                            self.loaded_key.clear();
                            self.sync_active_chapter();
                        }
                        draw_marked(
                            ui,
                            &marked,
                            13.0,
                            paint::color(palette.ui_text),
                            paint::color(palette.ui_link),
                        );
                    });
                    ui.separator();
                }
            });
    }

    pub(crate) fn run_search(&mut self) {
        let Some(module) = self.active_search_module() else {
            self.session.hits.clear();
            return;
        };
        let parsed = parse_search_query(Some(&self.session.query));
        if parsed.strongs.is_empty()
            && parsed.text_terms.is_empty()
            && parsed.exact_phrases.is_empty()
        {
            self.session.hits.clear();
            return;
        }
        if self.session.search_module_id.is_none() {
            if let Some(found) = self.modules.iter().find(|item| item.path == module) {
                self.session.search_module_id = Some(found.id.clone());
            }
        }
        self.session.hits = sqlite::search_in_file(&module, &self.session.query, Some(80.0));
        self.store.set_search_panel(serde_json::json!({
            "moduleId": self.session.search_module_id,
            "query": self.session.query.trim(),
        }));
    }

    fn active_search_module(&self) -> Option<PathBuf> {
        if let Some(id) = &self.session.search_module_id {
            if let Some(module) = self
                .modules
                .iter()
                .find(|module| &module.id == id && module.kind == "bible")
            {
                return Some(module.path.clone());
            }
        }
        let target = self.session.bible_target(&self.session.active_pane_id);
        let module_id = self
            .session
            .panes
            .get(&target)
            .and_then(|pane| pane.module_id.clone());
        let path = self.bible_path(module_id.as_deref()).map(Path::to_path_buf);
        path
    }

    fn dictionary_panel(&mut self, ui: &mut egui::Ui, palette: &UiPalette) {
        let dicts: Vec<_> = self
            .modules
            .iter()
            .filter(|module| module.kind == "dictionary")
            .cloned()
            .collect();
        let current_name = dicts
            .iter()
            .find(|module| self.session.dict_module_id.as_deref() == Some(module.id.as_str()))
            .or_else(|| dicts.first())
            .map(|module| module.name.clone())
            .unwrap_or_else(|| "—".into());
        let options: Vec<(String, String)> = dicts
            .iter()
            .map(|module| (module.id.clone(), module.name.clone()))
            .collect();
        if let Some(id) = crate::study::choose_module(
            ui,
            "dict-module",
            &current_name,
            &options,
            self.session.dict_module_id.as_deref(),
        ) {
            if let Some(topic) = self.session.dict_cache.get(&id).cloned() {
                self.session.dict_query = topic;
            }
            self.session.dict_module_id = Some(id);
        }
        ui.label(i18n::t("dictSelectTopic"));
        if self.session.strongs_dicts.is_empty() {
            ui.label(i18n::t("dictNoDictsConfigured"));
        }
        let response = ui.add(
            egui::TextEdit::singleline(&mut self.session.dict_query)
                .hint_text(i18n::t("dictSearchPlaceholder"))
                .desired_width(ui.available_width()),
        );
        if response.lost_focus() && ui.input(|input| input.key_pressed(egui::Key::Enter)) {
            let topic = self.session.dict_query.clone();
            self.lookup_dict(&topic);
        }
        ui.horizontal(|ui| {
            if ui.button(i18n::t("dictRandomSample")).clicked() {
                if let Some(path) = self.dict_path_for(&self.session.dict_query) {
                    if let Some(topic) = sqlite::random_topics_in_file(&path, 8).into_iter().next()
                    {
                        self.lookup_dict(&topic);
                    }
                }
            }
            if ui.button(i18n::t("dictBrowseTitle")).clicked() {
                let prefix = self.session.dict_query.clone();
                if let Some(path) = self.dict_path_for(&prefix) {
                    self.session.dict_topics =
                        sqlite::dictionary_topics_in_file(&path, &prefix, 40);
                }
            }
        });
        let topics = self.session.dict_topics.clone();
        egui::ScrollArea::vertical()
            .auto_shrink([false, false])
            .max_height(ui.available_height())
            .show(ui, |ui| {
                for topic in topics {
                    if ui.button(&topic).clicked() {
                        self.lookup_dict(&topic);
                    }
                }
                if !self.session.dict_body.is_empty() {
                    paint::show_html(
                        ui,
                        &self.session.dict_body,
                        self.session.font_size,
                        paint::color(palette.ui_text),
                        paint::color(palette.ui_link),
                    );
                }
                if !self.session.dict_cognates.is_empty() {
                    ui.label(i18n::t("dictCognates"));
                    let cognates = self.session.dict_cognates.clone();
                    ui.horizontal_wrapped(|ui| {
                        for cognate in cognates {
                            if ui.button(&cognate).clicked() {
                                self.lookup_dict(&cognate);
                            }
                        }
                    });
                }
                if !self.session.dict_history.is_empty() {
                    ui.separator();
                    let history = self.session.dict_history.clone();
                    for topic in history {
                        if ui.small_button(&topic).clicked() {
                            self.lookup_dict(&topic);
                        }
                    }
                }
            });
    }

    pub(crate) fn lookup_dict(&mut self, topic: &str) {
        self.lookup_dict_focused(topic, true);
    }

    /// `focus` is for a user click. Restoring `dictPanel` must not switch the saved sidebar.
    pub(crate) fn lookup_dict_focused(&mut self, topic: &str, focus: bool) {
        let topic = normalize_topic_candidate(Some(topic));
        if topic.is_empty() {
            return;
        }
        self.session.dict_query = topic.clone();
        if focus {
            self.session.focus_sidebar("dictionary");
            self.session.dialog = Dialog::None;
        }
        let Some(path) = self.dict_path_for(&topic) else {
            self.session.dict_body = if self
                .modules
                .iter()
                .any(|module| module.kind == "dictionary")
            {
                i18n::t("dictNoEntry")
            } else {
                i18n::t("dictNoModulesInstalled")
            };
            self.session.dict_cognates.clear();
            return;
        };
        match sqlite::dictionary_entry_in_file(&path, &topic) {
            Some(entry) => {
                let definition = entry.get("definition").cloned().unwrap_or_default();
                self.session.dict_body = definition;
                self.session.dict_cognates = sqlite::dictionary_cognates_in_file(&path, &topic);
                if !self.session.dict_history.iter().any(|item| item == &topic) {
                    self.session.dict_history.insert(0, topic.clone());
                    self.session.dict_history.truncate(20);
                }
                if let Some(found) = self.modules.iter().find(|module| module.path == path) {
                    self.session.dict_module_id = Some(found.id.clone());
                    self.session
                        .dict_cache
                        .insert(found.id.clone(), topic.clone());
                }
                self.store.set_dict_panel(serde_json::json!({
                    "selectedModuleId": self.session.dict_module_id,
                    "moduleSearchCache": self.session.dict_cache,
                }));
            }
            None => {
                self.session.dict_body = i18n::t("dictNoEntry");
                self.session.dict_cognates.clear();
            }
        }
    }

    fn dict_path_for(&self, topic: &str) -> Option<PathBuf> {
        let strong = topic.starts_with(['H', 'G', 'h', 'g'])
            && topic.chars().skip(1).all(|ch| ch.is_ascii_digit());
        if strong {
            for id in &self.session.strongs_dicts {
                if let Some(module) = self
                    .modules
                    .iter()
                    .find(|module| &module.id == id && module.kind == "dictionary")
                {
                    return Some(module.path.clone());
                }
            }
        }
        if let Some(id) = &self.session.dict_module_id {
            if let Some(module) = self
                .modules
                .iter()
                .find(|module| &module.id == id && module.kind == "dictionary")
            {
                return Some(module.path.clone());
            }
        }
        self.modules
            .iter()
            .find(|module| module.kind == "dictionary")
            .map(|module| module.path.clone())
    }

    fn modules_panel(&mut self, ui: &mut egui::Ui) {
        if self.modules.is_empty() {
            ui.label(i18n::t("noModules"));
        }
        if ui.button(i18n::t("installModules")).clicked() {
            if let Some(files) = rfd::FileDialog::new().pick_files() {
                let dir = graphe_store::state::modules_dir(&graphe_store::state::user_home());
                graphe_store::catalog::install_files(&dir, &files);
                self.reload_modules();
            }
        }
        for module in self.modules.clone() {
            ui.horizontal(|ui| {
                ui.label(format!("{}  {}", module.name, module.kind));
                if ui.button(i18n::t("editModuleData")).clicked() {
                    self.editor_path = Some(module.path.clone());
                    self.session.dialog = Dialog::ModuleEditor;
                }
            });
        }
    }
}

fn draw_marked(
    ui: &mut egui::Ui,
    marked: &str,
    size: f32,
    plain: egui::Color32,
    mark: egui::Color32,
) {
    let mut job = egui::text::LayoutJob::default();
    job.wrap.max_width = ui.available_width();
    let mut rest = marked;
    while let Some(start) = rest.find("<mark>") {
        let (head, tail) = rest.split_at(start);
        append_snippet(&mut job, &paint::unescape(head), size, plain, false);
        let tail = &tail["<mark>".len()..];
        if let Some(end) = tail.find("</mark>") {
            append_snippet(&mut job, &paint::unescape(&tail[..end]), size, mark, true);
            rest = &tail[end + "</mark>".len()..];
        } else {
            rest = tail;
            break;
        }
    }
    append_snippet(&mut job, &paint::unescape(rest), size, plain, false);
    ui.label(job);
}

fn append_snippet(
    job: &mut egui::text::LayoutJob,
    text: &str,
    size: f32,
    color: egui::Color32,
    marked: bool,
) {
    if text.is_empty() {
        return;
    }
    job.append(
        text,
        0.0,
        egui::TextFormat {
            font_id: egui::FontId::proportional(size),
            color,
            background: if marked {
                egui::Color32::from_rgba_unmultiplied(214, 168, 95, 90)
            } else {
                egui::Color32::TRANSPARENT
            },
            ..Default::default()
        },
    );
}
