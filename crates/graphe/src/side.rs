//! Sidebar: search, dictionary, and installed modules.

use crate::app::{label_for, GrapheApp};
use crate::dropdown::ModuleDropdown;
use crate::paint;
use crate::session::Dialog;
use graphe_domain::dict::normalize_topic_candidate;
use graphe_domain::i18n;
use graphe_domain::search::{
    extract_search_terms, parse_search_query, search_preview_rich_snippet,
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
            .min_width(220.0)
            .max_width(600.0)
            .frame(
                egui::Frame::new()
                    .fill(paint::color(palette.ui_surface_muted))
                    .inner_margin(egui::Margin::ZERO),
            )
            .show(ctx, |ui| {
                // Shared by search, dictionary, and modules. 34px, padding 0 8px 0 12px.
                // Align by font line metrics so all tab titles have identical baseline and cap height.
                let header_height = 34.0;
                let (header_rect, _) = ui.allocate_exact_size(
                    egui::vec2(ui.available_width(), header_height),
                    egui::Sense::hover(),
                );
                let label_color = paint::color(palette.ui_text_muted);
                let galley = egui::WidgetText::from(
                    egui::RichText::new(label_for(&self.session.sidebar).to_uppercase())
                        .size(11.0)
                        .strong()
                        .color(label_color),
                )
                .into_galley(
                    ui,
                    Some(egui::TextWrapMode::Extend),
                    f32::INFINITY,
                    egui::FontSelection::default(),
                );
                let text_y = header_rect.center().y - galley.rect.height() / 4.0;
                ui.painter().galley(
                    egui::pos2(header_rect.left() + 12.0, text_y),
                    galley,
                    label_color,
                );

                let toggle_size = egui::vec2(24.0, 22.0);
                let toggle_rect = egui::Rect::from_center_size(
                    egui::pos2(
                        header_rect.right() - 8.0 - toggle_size.x / 2.0,
                        header_rect.center().y + 2.0,
                    ),
                    toggle_size,
                );
                let toggle_resp = ui.interact(
                    toggle_rect,
                    ui.id().with("sidebar-collapse"),
                    egui::Sense::click(),
                );
                let toggle_color = if toggle_resp.hovered() {
                    paint::color(palette.ui_text)
                } else {
                    paint::color(palette.ui_text_subtle)
                };
                paint::draw_icon(
                    ui.painter(),
                    toggle_rect.center(),
                    toggle_color,
                    paint::Icon::PanelLeftClose,
                );
                if toggle_resp.clicked() {
                    self.session.sidebar_collapsed = true;
                    self.note_workspaces();
                }
                paint::hover_tip(toggle_resp, i18n::t("workbenchToggleSidebar"));
                separator_line(ui, palette.ui_border);

                match self.session.sidebar.as_str() {
                    "dictionary" => self.dictionary_panel(ui, palette),
                    "modules" => self.modules_panel(ui, palette),
                    _ => self.search_panel(ui, palette),
                }
            });
    }

    fn search_panel(&mut self, ui: &mut egui::Ui, palette: &UiPalette) {
        // 1. Search Controls Area (padding 12px)
        egui::Frame::new()
            .inner_margin(egui::Margin::symmetric(12, 10))
            .show(ui, |ui| {
                ui.spacing_mut().item_spacing.y = 8.0;

                // Title row: Search icon + "Pesquisar" label
                ui.horizontal(|ui| {
                    ui.spacing_mut().item_spacing.x = 8.0;
                    let (icon_rect, _) =
                        ui.allocate_exact_size(egui::vec2(16.0, 16.0), egui::Sense::hover());
                    paint::draw_icon(
                        ui.painter(),
                        icon_rect.center(),
                        paint::color(palette.ui_text),
                        paint::Icon::Search,
                    );
                    ui.label(
                        egui::RichText::new(i18n::t("search"))
                            .strong()
                            .size(14.0)
                            .color(paint::color(palette.ui_text)),
                    );
                });

                // Module dropdown selector
                let dropdown = ModuleDropdown::from_installed(
                    "search-module",
                    "bible",
                    self.session.search_module_id.as_deref(),
                    &self.modules,
                );
                if let Some(id) = dropdown.show(ui, &mut self.store, palette, self.session.dark) {
                    self.session.search_module_id = Some(id);
                    self.run_search();
                }

                // Search input with Clear button
                let (response, cleared) = search_input_box(
                    ui,
                    &mut self.session.query,
                    &i18n::t("searchPlaceholder"),
                    palette,
                );
                if cleared {
                    self.session.hits.clear();
                } else if (response.lost_focus() || response.has_focus())
                    && ui.input(|input| input.key_pressed(egui::Key::Enter))
                {
                    self.run_search();
                }
            });
        separator_line(ui, palette.ui_border);

        // 2. Status Line
        let parsed = parse_search_query(Some(&self.session.query));
        if self.session.hits.is_empty()
            && !self.session.query.trim().is_empty()
            && parsed.strongs.is_empty()
            && parsed.exact_phrases.is_empty()
            && parsed.text_terms.is_empty()
        {
            egui::Frame::new()
                .inner_margin(egui::Margin::symmetric(12, 5))
                .show(ui, |ui| {
                    ui.label(
                        egui::RichText::new(i18n::t("searchMinChars"))
                            .size(12.0)
                            .color(paint::color(palette.ui_text_muted)),
                    );
                });
            separator_line(ui, palette.ui_border_soft);
        } else if !self.session.hits.is_empty() {
            egui::Frame::new()
                .inner_margin(egui::Margin::symmetric(12, 5))
                .show(ui, |ui| {
                    ui.label(
                        egui::RichText::new(i18n::t_fmt(
                            "searchResultCount",
                            &[("count", &self.session.hits.len().to_string())],
                        ))
                        .size(12.0)
                        .color(paint::color(palette.ui_text_muted)),
                    );
                });
            separator_line(ui, palette.ui_border_soft);
        }

        // 3. Results List
        let terms = extract_search_terms(&self.session.query);
        let hits = self.session.hits.clone();
        egui::ScrollArea::vertical()
            .auto_shrink([false, false])
            .max_height(ui.available_height())
            .show(ui, |ui| {
                egui::Frame::new()
                    .inner_margin(egui::Margin {
                        left: 8,
                        right: 8,
                        top: 6,
                        bottom: 8,
                    })
                    .show(ui, |ui| {
                        for (index, hit) in hits.into_iter().enumerate() {
                            let snippet = search_preview_rich_snippet(
                                &hit.text,
                                &terms,
                                &parsed.strongs,
                                160,
                            );
                            let label = format!(
                                "{} {}:{}",
                                i18n::book_name(hit.book_number).short,
                                hit.chapter,
                                hit.verse
                            );
                            let hit_id = ui.id().with((
                                "search-hit",
                                index,
                                hit.book_number,
                                hit.chapter,
                                hit.verse,
                            ));
                            let hovered = ui.data(|data| data.get_temp(hit_id).unwrap_or(false));
                            let (fill, stroke_color) = if hovered {
                                (
                                    paint::color(palette.ui_accent_bg_soft),
                                    paint::color(palette.ui_border),
                                )
                            } else {
                                (
                                    paint::color(palette.ui_surface),
                                    paint::color(palette.ui_border_soft),
                                )
                            };
                            let row = egui::Frame::new()
                                .fill(fill)
                                .stroke(egui::Stroke::new(1.0_f32, stroke_color))
                                .inner_margin(egui::Margin::symmetric(8, 7))
                                .corner_radius(egui::CornerRadius::same(2))
                                .show(ui, |ui| {
                                    ui.set_min_width(ui.available_width());
                                    ui.spacing_mut().item_spacing.y = 3.0;
                                    ui.label(
                                        egui::RichText::new(label)
                                            .strong()
                                            .size(12.0)
                                            .color(paint::color(palette.ui_link)),
                                    );
                                    draw_marked(
                                        ui,
                                        &snippet,
                                        12.0,
                                        paint::color(palette.ui_text_muted),
                                        paint::color(palette.ui_text),
                                        palette,
                                    );
                                });
                            let response =
                                ui.interact(row.response.rect, hit_id, egui::Sense::click());
                            let hovered = response.hovered();
                            let clicked = response.clicked();
                            response.on_hover_cursor(egui::CursorIcon::PointingHand);
                            ui.data_mut(|data| data.insert_temp(hit_id, hovered));
                            if clicked {
                                let primary = ui
                                    .input(|input| input.modifiers.command || input.modifiers.ctrl);
                                if primary {
                                    self.session.open_search_hit_in_new_study(&hit);
                                    self.note_workspaces();
                                } else {
                                    self.session.open_search_hit(&hit);
                                }
                                self.loaded_key.clear();
                                self.sync_active_chapter();
                            }
                            ui.add_space(3.0);
                        }
                    });
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
        // 1. Controls Area (padding 12px)
        egui::Frame::new()
            .inner_margin(egui::Margin::symmetric(12, 10))
            .show(ui, |ui| {
                ui.spacing_mut().item_spacing.y = 8.0;

                // Row 1: BookOpen icon + "Dicionário" on left, < > ⓘ on right
                ui.horizontal(|ui| {
                    ui.spacing_mut().item_spacing.x = 8.0;
                    let (icon_rect, _) =
                        ui.allocate_exact_size(egui::vec2(16.0, 16.0), egui::Sense::hover());
                    paint::draw_icon(
                        ui.painter(),
                        icon_rect.center(),
                        paint::color(palette.ui_text),
                        paint::Icon::BookOpen,
                    );
                    ui.label(
                        egui::RichText::new(i18n::t("dictionary"))
                            .strong()
                            .size(14.0)
                            .color(paint::color(palette.ui_text)),
                    );

                    ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                        let (i_rect, i_resp) =
                            ui.allocate_exact_size(egui::vec2(18.0, 18.0), egui::Sense::click());
                        let i_color = if i_resp.hovered() {
                            paint::color(palette.ui_text)
                        } else {
                            paint::color(palette.ui_text_subtle)
                        };
                        paint::draw_icon(ui.painter(), i_rect.center(), i_color, paint::Icon::Info);
                        if i_resp.clicked() {
                            self.session.dialog = Dialog::About;
                        }
                        paint::hover_tip(i_resp, i18n::t("dictInfoTitle"));

                        let has_fwd = self.session.dict_history_index > 0;
                        let fwd_color = if has_fwd {
                            paint::color(palette.ui_text_subtle)
                        } else {
                            paint::color(palette.ui_border)
                        };
                        let (f_rect, f_resp) = ui.allocate_exact_size(
                            egui::vec2(18.0, 18.0),
                            if has_fwd {
                                egui::Sense::click()
                            } else {
                                egui::Sense::hover()
                            },
                        );
                        paint::draw_icon(
                            ui.painter(),
                            f_rect.center(),
                            fwd_color,
                            paint::Icon::ChevronRight,
                        );
                        if has_fwd && f_resp.clicked() {
                            self.session.dict_history_index -= 1;
                            if let Some(topic) = self
                                .session
                                .dict_history
                                .get(self.session.dict_history_index)
                                .cloned()
                            {
                                self.lookup_dict(&topic);
                            }
                        }

                        let has_back =
                            self.session.dict_history_index + 1 < self.session.dict_history.len();
                        let back_color = if has_back {
                            paint::color(palette.ui_text_subtle)
                        } else {
                            paint::color(palette.ui_border)
                        };
                        let (b_rect, b_resp) = ui.allocate_exact_size(
                            egui::vec2(18.0, 18.0),
                            if has_back {
                                egui::Sense::click()
                            } else {
                                egui::Sense::hover()
                            },
                        );
                        paint::draw_icon(
                            ui.painter(),
                            b_rect.center(),
                            back_color,
                            paint::Icon::ChevronLeft,
                        );
                        if has_back && b_resp.clicked() {
                            self.session.dict_history_index += 1;
                            if let Some(topic) = self
                                .session
                                .dict_history
                                .get(self.session.dict_history_index)
                                .cloned()
                            {
                                self.lookup_dict(&topic);
                            }
                        }
                    });
                });

                // Row 2: Module dropdown selector
                let dropdown = ModuleDropdown::from_installed(
                    "dict-module",
                    "dictionary",
                    self.session.dict_module_id.as_deref(),
                    &self.modules,
                );
                if let Some(id) = dropdown.show(ui, &mut self.store, palette, self.session.dark) {
                    if let Some(topic) = self.session.dict_cache.get(&id).cloned() {
                        self.session.dict_query = topic;
                    }
                    self.session.dict_module_id = Some(id);
                }

                // Row 3: Topic search input with Clear button
                let (response, cleared) = search_input_box(
                    ui,
                    &mut self.session.dict_query,
                    &i18n::t("dictSearchPlaceholder"),
                    palette,
                );
                if cleared {
                    self.session.dict_body.clear();
                    self.session.dict_entry = None;
                    self.session.dict_cognates.clear();
                } else if response.lost_focus()
                    && ui.input(|input| input.key_pressed(egui::Key::Enter))
                {
                    let topic = self.session.dict_query.clone();
                    self.lookup_dict(&topic);
                }
            });
        separator_line(ui, palette.ui_border);

        // 2. Entry Content Area
        let active_dict = self.modules.iter().find(|m| {
            self.session.dict_module_id.as_deref() == Some(&m.id)
                || (self.session.dict_module_id.is_none() && m.kind == "dictionary")
        });
        let display_title = active_dict
            .map(|m| m.name.to_uppercase())
            .unwrap_or_else(|| "DICTIONARY".into());
        let desc_tag = active_dict
            .map(|m| {
                m.path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or(&m.id)
                    .to_string()
            })
            .unwrap_or_default();

        let entry = self.session.dict_entry.clone();
        let topic = self.session.dict_query.clone();

        egui::ScrollArea::vertical()
            .auto_shrink([false, false])
            .max_height(ui.available_height())
            .show(ui, |ui| {
                egui::Frame::new()
                    .inner_margin(egui::Margin::symmetric(12, 10))
                    .show(ui, |ui| {
                        if !topic.is_empty()
                            && (entry.is_some() || !self.session.dict_body.is_empty())
                        {
                            // Module Header
                            ui.label(
                                egui::RichText::new(&display_title)
                                    .size(10.0)
                                    .strong()
                                    .color(paint::color(palette.ui_text_subtle)),
                            );
                            if !desc_tag.is_empty() {
                                ui.label(
                                    egui::RichText::new(&desc_tag)
                                        .size(11.0)
                                        .color(paint::color(palette.ui_text_subtle)),
                                );
                            }
                            ui.label(
                                egui::RichText::new(&topic)
                                    .size(11.0)
                                    .strong()
                                    .color(paint::color(palette.ui_link)),
                            );
                            ui.add_space(4.0);

                            // Large lexeme title
                            if let Some(lexeme) = entry
                                .as_ref()
                                .and_then(|e| e.get("lexeme"))
                                .filter(|l| !l.is_empty())
                            {
                                ui.label(
                                    egui::RichText::new(lexeme)
                                        .size(24.0)
                                        .color(paint::color(palette.ui_text)),
                                );
                                ui.add_space(2.0);
                            }

                            // Transliteration / pronunciation meta
                            let translit = entry
                                .as_ref()
                                .and_then(|e| e.get("transliteration"))
                                .cloned()
                                .unwrap_or_default();
                            let pron = entry
                                .as_ref()
                                .and_then(|e| e.get("pronunciation"))
                                .cloned()
                                .unwrap_or_default();
                            let meta = match (!translit.is_empty(), !pron.is_empty()) {
                                (true, true) => format!("{translit} — {pron}"),
                                (true, false) => translit,
                                (false, true) => pron,
                                _ => String::new(),
                            };
                            if !meta.is_empty() {
                                ui.label(
                                    egui::RichText::new(&meta)
                                        .size(13.0)
                                        .italics()
                                        .color(paint::color(palette.ui_text_muted)),
                                );
                                ui.add_space(6.0);
                            }

                            // Short definition (if present)
                            if let Some(short_def) = entry
                                .as_ref()
                                .and_then(|e| e.get("short_definition"))
                                .filter(|s| !s.is_empty())
                            {
                                ui.label(
                                    egui::RichText::new(short_def)
                                        .size(13.0)
                                        .strong()
                                        .color(paint::color(palette.ui_text)),
                                );
                                ui.add_space(6.0);
                            }

                            // Morphology Section Box (if morphology context is present)
                            if let Some(code) = self.session.dict_morph_code.clone() {
                                let lemma =
                                    self.session.dict_morph_lemma.clone().unwrap_or_default();
                                let meaning = self
                                    .session
                                    .dict_morph_meaning
                                    .clone()
                                    .unwrap_or_else(|| code.clone());
                                morphology_box(ui, &code, &lemma, &meaning, palette);
                                ui.add_space(6.0);
                            }

                            // Body definition
                            if !self.session.dict_body.is_empty() {
                                paint::show_html(
                                    ui,
                                    &self.session.dict_body,
                                    13.0,
                                    paint::color(palette.ui_text),
                                    paint::color(palette.ui_link),
                                );
                            }

                            // Cognates
                            if !self.session.dict_cognates.is_empty() {
                                ui.add_space(8.0);
                                ui.label(
                                    egui::RichText::new(i18n::t("dictCognates"))
                                        .size(11.0)
                                        .strong()
                                        .color(paint::color(palette.ui_text_subtle)),
                                );
                                let cognates = self.session.dict_cognates.clone();
                                ui.horizontal_wrapped(|ui| {
                                    for cognate in cognates {
                                        if ui.button(&cognate).clicked() {
                                            self.lookup_dict(&cognate);
                                        }
                                    }
                                });
                            }

                            // History links
                            if !self.session.dict_history.is_empty() {
                                ui.add_space(10.0);
                                separator_line(ui, palette.ui_border_soft);
                                ui.add_space(4.0);
                                let history = self.session.dict_history.clone();
                                for item in history {
                                    if ui.small_button(&item).clicked() {
                                        self.lookup_dict(&item);
                                    }
                                }
                            }
                        } else {
                            ui.label(
                                egui::RichText::new(i18n::t("dictSelectTopic"))
                                    .size(12.0)
                                    .color(paint::color(palette.ui_text_muted)),
                            );
                        }
                    });
            });
    }

    pub(crate) fn lookup_dict(&mut self, topic: &str) {
        self.lookup_dict_focused(topic, true);
    }

    pub(crate) fn lookup_dict_with_context(
        &mut self,
        topic: &str,
        morph: Option<&str>,
        lemma: Option<&str>,
        bible_path: Option<&Path>,
    ) {
        self.session.dict_morph_code = morph.map(str::to_string);
        self.session.dict_morph_lemma = lemma.map(str::to_string);
        self.session.dict_morph_meaning = morph.map(|code| {
            if let Some(path) = bible_path {
                let m = self.morph_text(path, code);
                if !m.is_empty() {
                    return m;
                }
            }
            code.to_string()
        });
        self.lookup_dict_focused(topic, true);
    }

    /// `focus` is for a user click. Restoring `dictPanel` must not switch the saved sidebar.
    pub(crate) fn lookup_dict_focused(&mut self, topic: &str, focus: bool) {
        let topic = normalize_topic_candidate(Some(topic));
        if topic.is_empty() {
            return;
        }
        if self.session.dict_query != topic && self.session.dict_morph_code.is_none() {
            self.session.dict_morph_lemma = None;
            self.session.dict_morph_meaning = None;
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
            self.session.dict_entry = None;
            self.session.dict_cognates.clear();
            return;
        };
        match sqlite::dictionary_entry_in_file(&path, &topic) {
            Some(entry) => {
                let definition = entry.get("definition").cloned().unwrap_or_default();
                self.session.dict_body = definition;
                self.session.dict_cognates = sqlite::dictionary_cognates_in_file(&path, &topic);
                if self.session.dict_morph_lemma.is_none() {
                    if let Some(lexeme) = entry.get("lexeme").filter(|l| !l.is_empty()) {
                        self.session.dict_morph_lemma = Some(lexeme.clone());
                    }
                }
                self.session.dict_entry = Some(entry);
                if !self.session.dict_history.iter().any(|item| item == &topic) {
                    self.session.dict_history.insert(0, topic.clone());
                    self.session.dict_history.truncate(20);
                }
                self.session.dict_history_index = self
                    .session
                    .dict_history
                    .iter()
                    .position(|item| item == &topic)
                    .unwrap_or(0);
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
                self.session.dict_entry = None;
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

    fn modules_panel(&mut self, ui: &mut egui::Ui, palette: &UiPalette) {
        // 1. Actions section (padding 10px)
        egui::Frame::new()
            .inner_margin(egui::Margin::symmetric(10, 10))
            .show(ui, |ui| {
                ui.spacing_mut().item_spacing.y = 6.0;
                if command_button(
                    ui,
                    paint::Icon::Library,
                    &i18n::t("installModules"),
                    palette,
                )
                .clicked()
                {
                    self.install();
                }
                if command_button(ui, paint::Icon::Files, &i18n::t("convertModules"), palette)
                    .clicked()
                {
                    self.session.dialog = Dialog::Convert;
                }
            });
        separator_line(ui, palette.ui_border);

        // 2. Module stats 2x2 grid (padding 10px)
        egui::Frame::new()
            .inner_margin(egui::Margin::symmetric(10, 10))
            .show(ui, |ui| {
                let bible_count = self.modules.iter().filter(|m| m.kind == "bible").count();
                let dict_count = self
                    .modules
                    .iter()
                    .filter(|m| m.kind == "dictionary")
                    .count();
                let comm_count = self
                    .modules
                    .iter()
                    .filter(|m| m.kind == "commentary")
                    .count();
                let xref_count = self
                    .modules
                    .iter()
                    .filter(|m| m.kind == "crossreference")
                    .count();

                let avail = ui.available_width();
                let card_w = ((avail - 6.0) / 2.0).max(60.0);

                // Row 1: Bible & Dicionário
                ui.horizontal(|ui| {
                    ui.spacing_mut().item_spacing.x = 6.0;
                    stat_card(ui, card_w, bible_count, "Bible", palette);
                    stat_card(ui, card_w, dict_count, &i18n::t("dictionary"), palette);
                });
                ui.add_space(6.0);
                // Row 2: Comentário & Referências cruzadas
                ui.horizontal(|ui| {
                    ui.spacing_mut().item_spacing.x = 6.0;
                    stat_card(ui, card_w, comm_count, &i18n::t("commentary"), palette);
                    stat_card(ui, card_w, xref_count, &i18n::t("crossReferences"), palette);
                });
            });
        separator_line(ui, palette.ui_border);

        // 3. Module list (scrollable, padding 6px)
        egui::ScrollArea::vertical()
            .auto_shrink([false, false])
            .max_height(ui.available_height())
            .show(ui, |ui| {
                egui::Frame::new()
                    .inner_margin(egui::Margin::symmetric(6, 6))
                    .show(ui, |ui| {
                        if self.modules.is_empty() {
                            ui.label(
                                egui::RichText::new(i18n::t("noModules"))
                                    .size(12.0)
                                    .color(paint::color(palette.ui_text_subtle)),
                            );
                        }
                        for module in &self.modules {
                            if module_row(ui, &module.name, &module.kind, palette).clicked() {
                                self.editor_path = Some(module.path.clone());
                                self.session.dialog = Dialog::ModuleEditor;
                            }
                            ui.add_space(1.0);
                        }
                    });
            });
    }
}

fn separator_line(ui: &mut egui::Ui, color_hex: &str) {
    let top = ui.cursor().top();
    ui.painter().line_segment(
        [
            egui::pos2(ui.max_rect().left(), top),
            egui::pos2(ui.max_rect().right(), top),
        ],
        egui::Stroke::new(1.0_f32, paint::color(color_hex)),
    );
    ui.allocate_space(egui::vec2(ui.available_width(), 1.0));
}

fn command_button(
    ui: &mut egui::Ui,
    icon: paint::Icon,
    text: &str,
    palette: &UiPalette,
) -> egui::Response {
    let padding_x = 9.0;
    let font_id = egui::FontId::proportional(12.0);
    let galley = ui.painter().layout_no_wrap(
        text.to_string(),
        font_id,
        paint::color(palette.ui_text_muted),
    );
    let width = 16.0 + 6.0 + galley.rect.width() + padding_x * 2.0;
    let height = 28.0;
    let (rect, resp) = ui.allocate_exact_size(egui::vec2(width, height), egui::Sense::click());
    let (fill, stroke_color, text_color) = if resp.hovered() {
        (
            paint::color(palette.ui_surface_elevated),
            paint::color(palette.ui_border_strong),
            paint::color(palette.ui_text),
        )
    } else {
        (
            paint::color(palette.ui_surface),
            paint::color(palette.ui_border),
            paint::color(palette.ui_text_muted),
        )
    };
    ui.painter().rect(
        rect,
        egui::CornerRadius::same(3),
        fill,
        egui::Stroke::new(1.0_f32, stroke_color),
        egui::StrokeKind::Outside,
    );
    let icon_center = egui::pos2(rect.left() + padding_x + 8.0, rect.center().y);
    paint::draw_icon(ui.painter(), icon_center, text_color, icon);
    let text_pos = egui::pos2(
        rect.left() + padding_x + 16.0 + 6.0,
        rect.center().y - galley.rect.height() / 2.0,
    );
    ui.painter().galley(text_pos, galley, text_color);
    resp.on_hover_cursor(egui::CursorIcon::PointingHand)
}

fn stat_card(ui: &mut egui::Ui, width: f32, count: usize, label: &str, palette: &UiPalette) {
    let height = 38.0;
    let (rect, _) = ui.allocate_exact_size(egui::vec2(width, height), egui::Sense::hover());
    ui.painter().rect(
        rect,
        egui::CornerRadius::same(3),
        paint::color(palette.ui_surface),
        egui::Stroke::new(1.0_f32, paint::color(palette.ui_border_soft)),
        egui::StrokeKind::Outside,
    );
    let num_text = count.to_string();
    let num_galley = ui.painter().layout_no_wrap(
        num_text,
        egui::FontId::proportional(15.0),
        paint::color(palette.ui_link),
    );
    let label_galley = ui.painter().layout_no_wrap(
        label.to_string(),
        egui::FontId::proportional(11.0),
        paint::color(palette.ui_text_subtle),
    );
    let x_start = rect.left() + 8.0;
    let baseline_y = rect.center().y + 5.0;
    let num_w = num_galley.rect.width();
    ui.painter().galley(
        egui::pos2(x_start, baseline_y - num_galley.rect.height()),
        num_galley,
        paint::color(palette.ui_link),
    );
    ui.painter().galley(
        egui::pos2(
            x_start + num_w + 6.0,
            baseline_y - label_galley.rect.height() - 1.0,
        ),
        label_galley,
        paint::color(palette.ui_text_subtle),
    );
}

fn module_row(ui: &mut egui::Ui, name: &str, kind: &str, palette: &UiPalette) -> egui::Response {
    let row_id = ui.id().with(("module-row", name, kind));
    let hovered = ui.data(|data| data.get_temp(row_id).unwrap_or(false));
    let (fill, stroke_color) = if hovered {
        (
            paint::color_alpha(palette.ui_surface, 180),
            paint::color(palette.ui_border),
        )
    } else {
        (egui::Color32::TRANSPARENT, egui::Color32::TRANSPARENT)
    };
    let frame = egui::Frame::new()
        .fill(fill)
        .stroke(egui::Stroke::new(1.0_f32, stroke_color))
        .inner_margin(egui::Margin {
            left: 8,
            right: 8,
            top: 7,
            bottom: 7,
        })
        .corner_radius(egui::CornerRadius::same(3))
        .show(ui, |ui| {
            ui.set_min_width(ui.available_width());
            ui.spacing_mut().item_spacing.y = 2.0;
            ui.label(
                egui::RichText::new(name)
                    .strong()
                    .size(12.0)
                    .color(paint::color(palette.ui_text)),
            );
            ui.label(
                egui::RichText::new(kind)
                    .size(11.0)
                    .color(paint::color(palette.ui_text_subtle)),
            );
        });
    let response = frame
        .response
        .interact(egui::Sense::click())
        .on_hover_cursor(egui::CursorIcon::PointingHand);
    ui.data_mut(|data| data.insert_temp(row_id, response.hovered()));
    response
}

fn search_input_box(
    ui: &mut egui::Ui,
    query: &mut String,
    hint: &str,
    palette: &UiPalette,
) -> (egui::Response, bool) {
    let mut cleared = false;
    let frame = egui::Frame::new()
        .fill(paint::color(palette.ui_surface))
        .stroke(egui::Stroke::new(
            1.0_f32,
            paint::color(palette.ui_border_soft),
        ))
        .corner_radius(egui::CornerRadius::same(4))
        .inner_margin(egui::Margin::symmetric(8, 5));
    let inner_resp = frame.show(ui, |ui| {
        ui.horizontal(|ui| {
            ui.spacing_mut().item_spacing.x = 4.0;
            let text_w = if query.is_empty() {
                ui.available_width()
            } else {
                (ui.available_width() - 20.0).max(10.0)
            };
            let text_edit = ui.add(
                egui::TextEdit::singleline(query)
                    .frame(false)
                    .margin(egui::Margin::ZERO)
                    .vertical_align(egui::Align::Center)
                    .hint_text(hint)
                    .font(egui::FontId::proportional(13.0))
                    .text_color(paint::color(palette.ui_text))
                    .desired_width(text_w),
            );
            if !query.is_empty() {
                let (btn_rect, btn_resp) =
                    ui.allocate_exact_size(egui::vec2(16.0, 16.0), egui::Sense::click());
                let icon_color = if btn_resp.hovered() {
                    paint::color(palette.ui_text_muted)
                } else {
                    paint::color(palette.ui_text_subtle)
                };
                let center = btn_rect.center();
                ui.painter().line_segment(
                    [
                        center + egui::vec2(-4.0, -4.0),
                        center + egui::vec2(4.0, 4.0),
                    ],
                    egui::Stroke::new(1.2_f32, icon_color),
                );
                ui.painter().line_segment(
                    [
                        center + egui::vec2(4.0, -4.0),
                        center + egui::vec2(-4.0, 4.0),
                    ],
                    egui::Stroke::new(1.2_f32, icon_color),
                );
                if btn_resp.clicked() {
                    query.clear();
                    cleared = true;
                }
            }
            text_edit
        })
        .inner
    });
    (inner_resp.inner, cleared)
}

fn morphology_box(ui: &mut egui::Ui, code: &str, lemma: &str, meaning: &str, palette: &UiPalette) {
    let frame = egui::Frame::new()
        .fill(paint::color_alpha(palette.ui_link, 16))
        .inner_margin(egui::Margin {
            left: 10,
            right: 10,
            top: 8,
            bottom: 8,
        });
    let resp = frame.show(ui, |ui| {
        ui.spacing_mut().item_spacing.y = 3.0;
        ui.label(
            egui::RichText::new("MORFOLOGIA")
                .size(10.0)
                .strong()
                .color(paint::color(palette.ui_text_subtle)),
        );
        ui.horizontal(|ui| {
            ui.label(
                egui::RichText::new(format!("{}:", i18n::t("dictMorphCode")))
                    .size(12.0)
                    .strong()
                    .color(paint::color(palette.ui_text_muted)),
            );
            ui.label(
                egui::RichText::new(code)
                    .size(12.0)
                    .color(paint::color(palette.ui_text)),
            );
        });
        if !lemma.is_empty() {
            ui.horizontal(|ui| {
                ui.label(
                    egui::RichText::new(format!("{}:", i18n::t("dictMorphLemma")))
                        .size(12.0)
                        .strong()
                        .color(paint::color(palette.ui_text_muted)),
                );
                ui.label(
                    egui::RichText::new(lemma)
                        .size(12.0)
                        .color(paint::color(palette.ui_text)),
                );
            });
        }
        ui.horizontal(|ui| {
            ui.label(
                egui::RichText::new(format!("{}:", i18n::t("dictMorphMeaning")))
                    .size(12.0)
                    .strong()
                    .color(paint::color(palette.ui_text_muted)),
            );
            ui.label(
                egui::RichText::new(meaning)
                    .size(12.0)
                    .color(paint::color(palette.ui_text)),
            );
        });
    });
    // Draw 2.5px solid left border
    let left_border_x = resp.response.rect.left();
    ui.painter().line_segment(
        [
            egui::pos2(left_border_x, resp.response.rect.top()),
            egui::pos2(left_border_x, resp.response.rect.bottom()),
        ],
        egui::Stroke::new(2.5_f32, paint::color(palette.ui_link)),
    );
}

fn draw_marked(
    ui: &mut egui::Ui,
    marked: &str,
    size: f32,
    plain: egui::Color32,
    mark: egui::Color32,
    palette: &UiPalette,
) {
    let mut job = egui::text::LayoutJob::default();
    job.wrap.max_width = ui.available_width();
    let mut rest = marked;
    while let Some(start) = rest.find("<mark>") {
        let (head, tail) = rest.split_at(start);
        append_snippet(
            &mut job,
            &paint::unescape(head),
            size,
            plain,
            false,
            palette,
        );
        let tail = &tail["<mark>".len()..];
        if let Some(end) = tail.find("</mark>") {
            let mark_content = &tail[..end];
            append_snippet(
                &mut job,
                &paint::unescape(mark_content),
                size,
                mark,
                true,
                palette,
            );
            rest = &tail[end + "</mark>".len()..];
        } else {
            rest = tail;
            break;
        }
    }
    append_snippet(
        &mut job,
        &paint::unescape(rest),
        size,
        plain,
        false,
        palette,
    );
    ui.label(job);
}

fn append_snippet(
    job: &mut egui::text::LayoutJob,
    text: &str,
    size: f32,
    color: egui::Color32,
    marked: bool,
    palette: &UiPalette,
) {
    if text.is_empty() {
        return;
    }
    if marked {
        // Warm golden badge: rgba(193, 138, 31, 0.4)
        let bg = paint::color_alpha(palette.ui_warn, 102);
        if let Some(bracket_start) = text.find('[') {
            let (word, tag) = text.split_at(bracket_start);
            job.append(
                word,
                0.0,
                egui::TextFormat {
                    font_id: egui::FontId::proportional(size),
                    color: paint::color(palette.ui_text),
                    background: bg,
                    ..Default::default()
                },
            );
            job.append(
                tag,
                0.0,
                egui::TextFormat {
                    font_id: egui::FontId::proportional(size * 0.85),
                    color: paint::color(palette.ui_text_subtle),
                    background: bg,
                    ..Default::default()
                },
            );
        } else {
            job.append(
                text,
                0.0,
                egui::TextFormat {
                    font_id: egui::FontId::proportional(size),
                    color: paint::color(palette.ui_text),
                    background: bg,
                    ..Default::default()
                },
            );
        }
    } else {
        job.append(
            text,
            0.0,
            egui::TextFormat {
                font_id: egui::FontId::proportional(size),
                color,
                background: egui::Color32::TRANSPARENT,
                ..Default::default()
            },
        );
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn test_header_galley_consistency() {
        let ctx = egui::Context::default();
        let _ = ctx.run(Default::default(), |ctx| {
            egui::CentralPanel::default().show(ctx, |ui| {
                let tabs = ["DICIONÁRIO", "PESQUISAR", "MÓDULOS"];
                let heights: Vec<f32> = tabs
                    .iter()
                    .map(|title| {
                        let galley = egui::WidgetText::from(
                            egui::RichText::new(*title)
                                .size(11.0)
                                .strong()
                                .color(egui::Color32::WHITE),
                        )
                        .into_galley(
                            ui,
                            Some(egui::TextWrapMode::Extend),
                            f32::INFINITY,
                            egui::FontSelection::default(),
                        );
                        galley.rect.height()
                    })
                    .collect();

                assert_eq!(heights[0], heights[1]);
                assert_eq!(heights[1], heights[2]);
            });
        });
    }
}
