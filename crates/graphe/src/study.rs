//! Study tabs, split panes, verse text, commentary, and cross-references.

use crate::app::GrapheApp;
use crate::paint;
use crate::session::Dialog;
use graphe_domain::books::GRAPHE_BOOK_NUMBERS;
use graphe_domain::coverage::{build_coverage_cell, CoverageClass};
use graphe_domain::i18n;
use graphe_domain::markup::{self, VerseSpan};
use graphe_domain::model::PaneNode;
use graphe_domain::morphology::{resolve_morphology, MorphModule, MorphSources};
use graphe_domain::theme::UiPalette;
use graphe_store::sqlite;
use std::collections::HashMap;
use std::path::Path;

impl GrapheApp {
    pub(crate) fn editor(&mut self, ctx: &egui::Context, palette: &UiPalette) {
        self.sync_active_chapter();
        egui::CentralPanel::default()
            .frame(paint::panel(palette.ui_bg))
            .show(ctx, |ui| {
                let tree = self.session.tree.clone();
                self.draw_node(ui, &tree, palette);
                if self.session.chapter_text.is_empty()
                    && self.modules.iter().all(|module| module.kind != "bible")
                {
                    ui.label(i18n::t("noModules"));
                }
            });
    }

    fn step_chapter(&mut self, delta: i64) {
        let target = self.session.bible_target(&self.session.active_pane_id);
        if let Some(pane) = self.session.panes.get_mut(&target) {
            pane.chapter = (pane.chapter + delta).max(1);
            pane.selected_verse = Some(1);
        }
        self.loaded_key.clear();
        self.sync_active_chapter();
    }

    fn draw_node(&mut self, ui: &mut egui::Ui, node: &PaneNode, palette: &UiPalette) {
        match node {
            PaneNode::Leaf { pane_id } => self.draw_pane(ui, pane_id, palette),
            PaneNode::Split {
                direction,
                ratio,
                children,
            } => {
                let ratio = (*ratio as f32).clamp(0.2, 0.8);
                if direction == "v" {
                    let height = ui.available_height().max(160.0);
                    ui.allocate_ui_with_layout(
                        egui::vec2(ui.available_width(), height * ratio),
                        egui::Layout::top_down(egui::Align::Min),
                        |ui| self.draw_node(ui, &children.0, palette),
                    );
                    ui.separator();
                    self.draw_node(ui, &children.1, palette);
                } else {
                    let width = ui.available_width().max(240.0);
                    let height = ui.available_height().max(160.0);
                    ui.horizontal(|ui| {
                        ui.allocate_ui_with_layout(
                            egui::vec2(width * ratio, height),
                            egui::Layout::top_down(egui::Align::Min),
                            |ui| self.draw_node(ui, &children.0, palette),
                        );
                        ui.separator();
                        ui.allocate_ui_with_layout(
                            egui::vec2(width * (1.0 - ratio), height),
                            egui::Layout::top_down(egui::Align::Min),
                            |ui| self.draw_node(ui, &children.1, palette),
                        );
                    });
                }
            }
        }
    }

    fn draw_pane(&mut self, ui: &mut egui::Ui, pane_id: &str, palette: &UiPalette) {
        let Some(pane) = self.session.panes.get(pane_id).cloned() else {
            return;
        };
        let (book, chapter, verse) = self.session.reading_location(pane_id);
        let active = self.session.active_pane_id == pane_id;
        let pinned = self.session.link_target.as_deref() == Some(pane_id);
        ui.push_id(pane_id, |ui| {
            ui.horizontal(|ui| {
                let title = pane
                    .window_label
                    .clone()
                    .unwrap_or_else(|| pane_id.to_string());
                if ui.selectable_label(active, title).clicked() {
                    self.session.active_pane_id = pane_id.to_string();
                    self.loaded_key.clear();
                    self.sync_active_chapter();
                }
                self.module_combo(ui, pane_id, &pane.pane_type);
                let place = format!("{} {}", i18n::book_name(book).short, chapter);
                if ui.small_button("<").clicked() {
                    self.session.active_pane_id = self.session.bible_target(pane_id);
                    self.step_chapter(-1);
                }
                if ui.button(place).clicked() {
                    self.session.active_pane_id = pane_id.to_string();
                    self.open_navigation();
                }
                if ui.small_button(">").clicked() {
                    self.session.active_pane_id = self.session.bible_target(pane_id);
                    self.step_chapter(1);
                }
                if pinned {
                    ui.label("📌");
                }
                ui.menu_button("⋯", |ui| {
                    if ui.button(i18n::t("back")).clicked() {
                        self.session.active_pane_id = self.session.bible_target(pane_id);
                        if self.session.back() {
                            self.loaded_key.clear();
                            self.sync_active_chapter();
                        }
                        ui.close();
                    }
                    if ui.button("→").clicked() {
                        self.session.active_pane_id = self.session.bible_target(pane_id);
                        if self.session.forward() {
                            self.loaded_key.clear();
                            self.sync_active_chapter();
                        }
                        ui.close();
                    }
                    if ui.button(i18n::t("pinLinkTarget")).clicked() {
                        self.session.active_pane_id = pane_id.to_string();
                        self.session.toggle_pin();
                        self.note_workspaces();
                        ui.close();
                    }
                    if ui.button("Split Horizontal").clicked() {
                        self.session.active_pane_id = pane_id.to_string();
                        self.session.split(false);
                        self.note_workspaces();
                        ui.close();
                    }
                    if ui.button("Split Vertical").clicked() {
                        self.session.active_pane_id = pane_id.to_string();
                        self.session.split(true);
                        self.note_workspaces();
                        ui.close();
                    }
                    if ui.button(i18n::t("commentary")).clicked() {
                        self.session.active_pane_id = pane_id.to_string();
                        self.session.split_commentary(false);
                        self.note_workspaces();
                        ui.close();
                    }
                    if ui.button("×").clicked() && self.session.close_pane(pane_id) {
                        self.loaded_key.clear();
                        self.sync_active_chapter();
                        self.note_workspaces();
                        ui.close();
                    }
                });
            });
            if pane.pane_type == graphe_domain::model::PaneType::Commentary {
                self.draw_commentary(ui, pane_id, book, chapter, verse, palette);
            } else {
                self.draw_bible(ui, pane_id, book, chapter, palette);
            }
            ui.separator();
        });
    }

    fn draw_bible(
        &mut self,
        ui: &mut egui::Ui,
        pane_id: &str,
        book: i64,
        chapter: i64,
        palette: &UiPalette,
    ) {
        let active_bible = self.session.bible_target(&self.session.active_pane_id) == pane_id;
        let verses = if active_bible {
            self.session.chapter_text.clone()
        } else {
            let module_id = self
                .session
                .panes
                .get(pane_id)
                .and_then(|pane| pane.module_id.clone());
            self.bible_path(module_id.as_deref())
                .map(|path| {
                    sqlite::chapter_in_file(path, book, chapter)
                        .into_iter()
                        .map(|verse| (verse.verse, verse.text))
                        .collect()
                })
                .unwrap_or_default()
        };
        let module_path = self
            .session
            .panes
            .get(pane_id)
            .and_then(|pane| pane.module_id.clone())
            .and_then(|id| self.bible_path(Some(&id)).map(Path::to_path_buf))
            .or_else(|| self.bible_path(None).map(Path::to_path_buf));
        let prefix = if book < 470 { "H" } else { "G" };
        let cross_refs = self.chapter_cross_refs(book, chapter);
        egui::ScrollArea::vertical()
            .id_salt(("chapter", pane_id))
            .auto_shrink([false, false])
            .max_height(ui.available_height())
            .show(ui, |ui| {
                for (verse, text) in verses {
                    let selected = active_bible && self.session.selected_verses.contains(&verse);
                    ui.horizontal_wrapped(|ui| {
                        if ui.button(verse.to_string()).clicked() {
                            self.session.active_pane_id = pane_id.to_string();
                            let shift = ui.input(|input| input.modifiers.shift);
                            if shift {
                                if !self.session.selected_verses.contains(&verse) {
                                    self.session.selected_verses.push(verse);
                                }
                            } else {
                                self.session.selected_verses = vec![verse];
                                if let Some(pane) = self.session.panes.get_mut(pane_id) {
                                    pane.selected_verse = Some(verse);
                                }
                            }
                        }
                        let (spans, _) =
                            markup::verse_spans(&text, self.session.show_strongs, prefix);
                        for span in spans {
                            match span {
                                VerseSpan::Text(body) => {
                                    ui.label(
                                        egui::RichText::new(body)
                                            .size(self.session.font_size)
                                            .color(paint::color(if selected {
                                                palette.ui_link
                                            } else {
                                                palette.ui_text
                                            })),
                                    );
                                }
                                VerseSpan::Strong {
                                    display,
                                    morph,
                                    lemma,
                                } => {
                                    let mark = egui::RichText::new(display.clone())
                                        .size(self.session.font_size * 0.55)
                                        .color(paint::color(palette.ui_text_subtle));
                                    let response =
                                        ui.add(egui::Label::new(mark).sense(egui::Sense::click()));
                                    if response.hovered() {
                                        ui.ctx().set_cursor_icon(egui::CursorIcon::PointingHand);
                                    }
                                    if response.clicked() {
                                        self.lookup_dict(&display);
                                    }
                                    response.context_menu(|ui| {
                                        if ui.button(i18n::t("strongsSearchOccurrences")).clicked()
                                        {
                                            self.session.query = format!("strong:{display}");
                                            self.session.focus_sidebar("search");
                                            self.run_search();
                                            ui.close();
                                        }
                                        if ui.button(i18n::t("strongsDictionaryLookup")).clicked() {
                                            self.lookup_dict(&display);
                                            ui.close();
                                        }
                                    });
                                    let mut tip = Vec::new();
                                    if let Some(lemma) = lemma {
                                        tip.push(lemma);
                                    }
                                    if let Some(code) = &morph {
                                        if let Some(path) = &module_path {
                                            let meaning = self.morph_text(path, code);
                                            if !meaning.is_empty() {
                                                response
                                                    .on_hover_text(format!("{code}: {meaning}"));
                                            }
                                        }
                                    }
                                }
                                VerseSpan::Annotation {
                                    original,
                                    transliteration,
                                    pronunciation,
                                    glosses,
                                    references,
                                } => {
                                    let mut notes = Vec::new();
                                    if let Some(value) = original {
                                        notes.push(value);
                                    }
                                    if let Some(value) = transliteration {
                                        notes.push(value);
                                    }
                                    if let Some(value) = pronunciation {
                                        notes.push(value);
                                    }
                                    notes.extend(glosses);
                                    notes.extend(references);
                                    if !notes.is_empty() {
                                        ui.label(
                                            egui::RichText::new(notes.join(" · "))
                                                .size(self.session.font_size * 0.72)
                                                .color(paint::color(palette.ui_text_muted)),
                                        );
                                    }
                                }
                                VerseSpan::Footnote(note) => {
                                    ui.small(
                                        egui::RichText::new(note)
                                            .color(paint::color(palette.ui_text_muted)),
                                    );
                                }
                            }
                        }
                    });
                    self.draw_verse_refs(ui, pane_id, &cross_refs, verse, palette);
                }
            });
    }

    fn chapter_cross_refs(
        &self,
        book: i64,
        chapter: i64,
    ) -> Vec<graphe_store::sqlite::CrossReference> {
        let mut refs = Vec::new();
        for id in &self.session.xref_modules {
            if let Some(module) = self.modules.iter().find(|module| &module.id == id) {
                refs.extend(sqlite::cross_refs_in_file(&module.path, book, chapter));
            }
        }
        refs
    }

    fn draw_verse_refs(
        &mut self,
        ui: &mut egui::Ui,
        pane_id: &str,
        refs: &[graphe_store::sqlite::CrossReference],
        verse: i64,
        palette: &UiPalette,
    ) {
        let mine: Vec<_> = refs
            .iter()
            .filter(|reference| reference.verse == verse)
            .collect();
        if mine.is_empty() {
            return;
        }
        ui.horizontal_wrapped(|ui| {
            ui.spacing_mut().item_spacing.x = 6.0;
            for reference in mine {
                let label = format!(
                    "{} {}:{}",
                    i18n::book_name(reference.book_to).short,
                    reference.chapter_to,
                    reference.verse_to_start.unwrap_or(1)
                );
                let text = egui::RichText::new(label)
                    .size(self.session.font_size * 0.55)
                    .color(paint::color(palette.ui_link));
                let response = ui.add(egui::Label::new(text).sense(egui::Sense::click()));
                if response.hovered() {
                    ui.ctx().set_cursor_icon(egui::CursorIcon::PointingHand);
                }
                if response.clicked() {
                    self.follow_ref(
                        pane_id,
                        reference.book_to,
                        reference.chapter_to,
                        reference.verse_to_start,
                    );
                }
            }
        });
    }

    fn draw_commentary(
        &mut self,
        ui: &mut egui::Ui,
        pane_id: &str,
        book: i64,
        chapter: i64,
        verse: Option<i64>,
        palette: &UiPalette,
    ) {
        let module_id = self
            .session
            .panes
            .get(pane_id)
            .and_then(|pane| pane.module_id.clone());
        let module = module_id
            .as_ref()
            .and_then(|id| {
                self.modules
                    .iter()
                    .find(|module| &module.id == id && module.kind == "commentary")
                    .cloned()
            })
            .or_else(|| {
                self.modules
                    .iter()
                    .find(|module| module.kind == "commentary")
                    .cloned()
            });
        ui.horizontal(|ui| {
            if ui.button(i18n::t("allCommentaries")).clicked() {
                self.load_all_commentaries(book, chapter, verse);
            }
            if ui.button(i18n::t("commentaryCoverage")).clicked() {
                self.session.dialog = Dialog::None;
            }
        });
        let Some(module) = module else {
            ui.label(i18n::t("commentaryUnavailable"));
            return;
        };
        if self
            .session
            .panes
            .get(pane_id)
            .and_then(|pane| pane.module_id.clone())
            .is_none()
        {
            if let Some(pane) = self.session.panes.get_mut(pane_id) {
                pane.module_id = Some(module.id.clone());
            }
        }
        let coverage = sqlite::commentary_coverage_in_file(&module.path);
        let index = GRAPHE_BOOK_NUMBERS
            .iter()
            .position(|number| i64::from(*number) == book)
            .unwrap_or(0);
        let map: HashMap<i64, Vec<i64>> = coverage.into_iter().collect();
        let cell = build_coverage_cell(book, index, &map);
        let coverage_color = match cell.class_name {
            CoverageClass::Full => palette.ui_link,
            CoverageClass::Partial => palette.ui_warn,
            CoverageClass::None => palette.ui_text_muted,
        };
        ui.label(
            egui::RichText::new(format!("{} — {}", cell.text, cell.title))
                .color(paint::color(coverage_color)),
        );
        let entries = sqlite::commentary_in_file(&module.path, book, chapter);
        if entries.is_empty() {
            ui.label(i18n::t("commentaryUnavailable"));
            return;
        }
        let text = entries
            .iter()
            .map(|entry| format!("{} {}", entry.verse_from, entry.text))
            .collect::<Vec<_>>()
            .join("\n");
        let matches = self.matcher().find_matches(Some(&text));
        ui.horizontal_wrapped(|ui| {
            let mut cursor = 0usize;
            for reference in &matches {
                let head = slice_between(&text, cursor, reference.index);
                if !head.is_empty() {
                    ui.label(
                        egui::RichText::new(head)
                            .size(self.session.font_size)
                            .color(paint::color(palette.ui_text)),
                    );
                }
                let label = slice_between(&text, reference.index, reference.end_index);
                let label = if label.is_empty() {
                    reference.raw.clone()
                } else {
                    label.to_string()
                };
                let link = egui::RichText::new(label)
                    .size(self.session.font_size)
                    .color(paint::color(palette.ui_link))
                    .underline();
                let response = ui.add(egui::Label::new(link).sense(egui::Sense::click()));
                if response.clicked() {
                    self.follow_ref(
                        pane_id,
                        reference.book_num,
                        reference.chapter,
                        reference.verse_from,
                    );
                }
                cursor = reference.end_index;
            }
            let tail = slice_between(&text, cursor, text.len());
            if !tail.is_empty() {
                ui.label(
                    egui::RichText::new(tail)
                        .size(self.session.font_size)
                        .color(paint::color(palette.ui_text)),
                );
            }
        });
    }

    fn load_all_commentaries(&mut self, book: i64, chapter: i64, verse: Option<i64>) {
        let verse = verse.unwrap_or(1);
        let mut parts = Vec::new();
        for module in self
            .modules
            .iter()
            .filter(|module| module.kind == "commentary")
            .cloned()
        {
            for entry in sqlite::commentary_in_file(&module.path, book, chapter) {
                let end = entry.verse_to.unwrap_or(entry.verse_from);
                if verse < entry.verse_from || verse > end {
                    continue;
                }
                parts.push(format!("{}\n{}", module.name, entry.text));
            }
        }
        self.session.commentary_overview = if parts.is_empty() {
            i18n::t("allCommentariesNoResults")
        } else {
            parts.join("\n\n")
        };
        self.session.dialog = Dialog::AllCommentaries;
    }

    pub(crate) fn follow_ref(
        &mut self,
        pane_id: &str,
        book: i64,
        chapter: i64,
        verse: Option<i64>,
    ) {
        if self.session.follow_link(pane_id, book, chapter, verse) {
            self.session.preview_body = self.verse_preview(book, chapter, verse);
            self.session.dialog = Dialog::Preview;
            return;
        }
        self.loaded_key.clear();
        self.sync_active_chapter();
    }

    fn module_combo(
        &mut self,
        ui: &mut egui::Ui,
        pane_id: &str,
        kind: &graphe_domain::model::PaneType,
    ) {
        let wanted = match kind {
            graphe_domain::model::PaneType::Commentary => "commentary",
            graphe_domain::model::PaneType::Bible => "bible",
        };
        let modules: Vec<_> = self
            .modules
            .iter()
            .filter(|module| module.kind == wanted)
            .cloned()
            .collect();
        let current = self
            .session
            .panes
            .get(pane_id)
            .and_then(|pane| pane.module_id.clone());
        let label = modules
            .iter()
            .find(|module| current.as_deref() == Some(module.id.as_str()))
            .map(|module| module.name.clone())
            .unwrap_or_else(|| "—".into());
        let label = if label.chars().count() > 28 {
            format!("{}…", label.chars().take(28).collect::<String>())
        } else {
            label
        };
        let options: Vec<(String, String)> = modules
            .iter()
            .map(|module| (module.id.clone(), module.name.clone()))
            .collect();
        if let Some(id) = choose_module(ui, pane_id, &label, &options, current.as_deref()) {
            if let Some(pane) = self.session.panes.get_mut(pane_id) {
                pane.module_id = Some(id);
            }
            self.loaded_key.clear();
            self.sync_active_chapter();
        }
    }

    fn verse_preview(&self, book: i64, chapter: i64, verse: Option<i64>) -> String {
        let name = i18n::book_name(book);
        let text = self
            .bible_path(None)
            .and_then(|path| {
                sqlite::chapter_in_file(path, book, chapter)
                    .into_iter()
                    .find(|row| verse.is_none_or(|value| row.verse == value))
                    .map(|row| row.text)
            })
            .unwrap_or_default();
        let (spans, _) = markup::verse_spans(&text, false, "");
        let plain = spans
            .iter()
            .filter_map(|span| match span {
                VerseSpan::Text(body) => Some(body.as_str()),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join(" ");
        format!("{} {}:{} {plain}", name.short, chapter, verse.unwrap_or(1))
    }

    fn morph_text(&mut self, path: &Path, code: &str) -> String {
        if !self.morphs.contains_key(path) {
            self.morphs
                .insert(path.to_path_buf(), sqlite::load_morphology_in_file(path));
        }
        let loaded = &self.morphs[path];
        let lang = i18n::get_current_lang().as_str();
        let sources = MorphSources {
            bible: Some(MorphModule {
                tables: loaded,
                has_indications: loaded.has_indications,
                has_language_column: loaded.has_language_column,
                info_language: loaded.info_language.as_deref(),
                articles_language: loaded.articles_language.as_deref(),
            }),
            dictionary: None,
        };
        resolve_morphology(&sources, Some(code), Some(lang))
            .map(|result| result.display_text)
            .unwrap_or_default()
    }
}

pub(crate) fn choose_module(
    ui: &mut egui::Ui,
    salt: &str,
    label: &str,
    options: &[(String, String)],
    current: Option<&str>,
) -> Option<String> {
    ui.push_id(salt, |ui| {
        let response = ui.add(egui::Button::new(label).min_size(egui::vec2(160.0, 22.0)));
        let mut chosen = None;
        egui::Popup::menu(&response).width(280.0).show(|ui| {
            let filter_id = ui.id().with("filter");
            let mut filter = ui
                .ctx()
                .data(|data| data.get_temp::<String>(filter_id).unwrap_or_default());
            ui.add(
                egui::TextEdit::singleline(&mut filter)
                    .hint_text(i18n::t("searchPlaceholder"))
                    .desired_width(260.0),
            );
            let needle = filter.to_lowercase();
            ui.ctx()
                .data_mut(|data| data.insert_temp(filter_id, filter));
            egui::ScrollArea::vertical()
                .id_salt(("module-scroll", salt))
                .max_height(260.0)
                .show(ui, |ui| {
                    let mut shown = 0;
                    for (id, name) in options {
                        if !needle.is_empty() && !name.to_lowercase().contains(&needle) {
                            continue;
                        }
                        shown += 1;
                        if shown > 40 {
                            ui.label("…");
                            break;
                        }
                        if ui
                            .selectable_label(current == Some(id.as_str()), name)
                            .clicked()
                        {
                            chosen = Some(id.clone());
                        }
                    }
                });
        });
        chosen
    })
    .inner
}

fn slice_between(text: &str, start: usize, end: usize) -> &str {
    if start <= end
        && end <= text.len()
        && text.is_char_boundary(start)
        && text.is_char_boundary(end)
    {
        &text[start..end]
    } else {
        ""
    }
}
