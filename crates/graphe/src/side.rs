//! Sidebar: search, dictionary, and installed modules.

use crate::app::{label_for, GrapheApp};
use crate::dropdown::ModuleDropdown;
use crate::paint;
use crate::session::Dialog;
use graphe_domain::dict::normalize_topic_candidate;
use graphe_domain::i18n;
use graphe_domain::search::{extract_search_terms, parse_search_query, search_result_verse};
use graphe_domain::theme::UiPalette;
use graphe_store::sqlite;
use std::path::{Path, PathBuf};

impl GrapheApp {
    pub(crate) fn sidebar(&mut self, ui: &mut egui::Ui, palette: &UiPalette) {
        if self.session.sidebar_collapsed {
            return;
        }
        egui::Panel::left("sidebar")
            .resizable(true)
            .default_size(300.0)
            .min_size(220.0)
            .max_size(600.0)
            .frame(
                egui::Frame::new()
                    .fill(paint::color(palette.ui_surface_muted))
                    .inner_margin(egui::Margin::ZERO),
            )
            .show(ui, |ui| {
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
                    ui.scope_id().with("sidebar-collapse"),
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
                let (response, _box_rect, cleared) = search_input_box(
                    ui,
                    &mut self.session.query,
                    &i18n::t("searchPlaceholder"),
                    palette,
                );
                if cleared {
                    self.session.hits.clear();
                    self.session.searched_query.clear();
                    self.session.searching = false;
                    self.search_debounce = None;
                } else if response.changed() {
                    let parsed = parse_search_query(Some(&self.session.query));
                    if self.session.query.trim().is_empty() {
                        self.session.hits.clear();
                        self.session.searched_query.clear();
                        self.session.searching = false;
                        self.search_debounce = None;
                    } else if !parsed.strongs.is_empty()
                        || !parsed.exact_phrases.is_empty()
                        || !parsed.text_terms.is_empty()
                    {
                        self.session.searching = true;
                        self.search_debounce =
                            Some(std::time::Instant::now() + std::time::Duration::from_millis(300));
                    } else {
                        self.session.hits.clear();
                        self.session.searching = false;
                        self.search_debounce = None;
                    }
                } else if (response.lost_focus() || response.has_focus())
                    && ui.input(|input| input.key_pressed(egui::Key::Enter))
                {
                    self.run_search();
                }
            });
        separator_line(ui, palette.ui_border);

        if let Some(deadline) = self.search_debounce {
            let now = std::time::Instant::now();
            if now >= deadline {
                self.run_search();
            } else {
                ui.ctx()
                    .request_repaint_after(deadline.saturating_duration_since(now));
            }
        }

        // 2. Status Line
        let parsed = parse_search_query(Some(&self.session.query));
        let trimmed = self.session.query.trim();
        let query_has_terms = !parsed.strongs.is_empty()
            || !parsed.exact_phrases.is_empty()
            || !parsed.text_terms.is_empty();

        if self.session.searching {
            egui::Frame::new()
                .inner_margin(egui::Margin::symmetric(12, 5))
                .show(ui, |ui| {
                    ui.horizontal(|ui| {
                        ui.spacing_mut().item_spacing.x = 6.0;
                        ui.add(egui::Spinner::new().size(12.0));
                        ui.label(
                            egui::RichText::new(i18n::t("searching"))
                                .size(12.0)
                                .color(paint::color(palette.ui_text_muted)),
                        );
                    });
                });
            separator_line(ui, palette.ui_border_soft);
        } else if !trimmed.is_empty() && !query_has_terms {
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
        } else if query_has_terms {
            egui::Frame::new()
                .inner_margin(egui::Margin::symmetric(12, 5))
                .show(ui, |ui| {
                    ui.label(
                        egui::RichText::new(i18n::t("searchNoResults"))
                            .size(12.0)
                            .color(paint::color(palette.ui_text_muted)),
                    );
                });
            separator_line(ui, palette.ui_border_soft);
        }

        // 3. Results List
        if self.session.searching || self.session.hits.is_empty() {
            return;
        }
        let terms = extract_search_terms(&self.session.query);
        let hits = self.session.hits.clone();
        // Each card is only as tall as its verse, with a small gap. A fixed
        // slot left a hole under short verses. The row is clipped to the list
        // so a verse cannot paint over the count or the search field.
        const SEARCH_GAP: f32 = 6.0;
        let search_scroll = paint::scroll_id(ui, "search-hits");
        paint::scroll_by_wheel(ui, search_scroll, 2.1);
        let search_view = paint::with_scroll_override(
            egui::ScrollArea::vertical()
                .id_salt("search-hits")
                .auto_shrink([false, false])
                .animated(false)
                .scroll_source(egui::containers::scroll_area::ScrollSource {
                    scroll_bar: true,
                    drag: egui::containers::scroll_area::DragScroll::Never,
                    mouse_wheel: false,
                })
                .max_height(ui.available_height()),
            ui,
            search_scroll,
        )
        .show_viewport(ui, |ui, viewport| {
            let width = ui.available_width();
            let card_width = (width - 16.0).max(32.0);
            let text_width = (card_width - 18.0).max(32.0);
            let plain = paint::color(palette.ui_text_muted);
            let mark = paint::color(palette.ui_text);
            // The cards are 12px. Leaving the Bible font out of the key
            // keeps a font click from wrapping every hit.
            let cache_id = ui.scope_id().with((
                text_width.round() as i32,
                self.session.query.clone(),
                self.session.search_module_id.clone(),
                hits.len(),
            ));
            let cached = ui.data(|data| data.get_temp::<SearchRowLayout>(cache_id));
            let rows = if let Some(cached) = cached {
                cached
            } else {
                let mut snippets = Vec::with_capacity(hits.len());
                let mut offsets = Vec::with_capacity(hits.len() + 1);
                offsets.push(0.0);
                for hit in &hits {
                    let snippet = search_result_verse(&hit.text, &terms, &parsed.strongs);
                    let label = format!(
                        "{} {}:{}",
                        i18n::book_name(hit.book_number).short,
                        hit.chapter,
                        hit.verse
                    );
                    let label_galley = egui::WidgetText::from(
                        egui::RichText::new(&label)
                            .strong()
                            .size(12.0)
                            .color(paint::color(palette.ui_link)),
                    )
                    .into_galley(
                        ui,
                        Some(egui::TextWrapMode::Extend),
                        f32::INFINITY,
                        egui::FontSelection::default(),
                    );
                    let galley = ui
                        .painter()
                        .layout_job(marked_job(&snippet, text_width, 12.0, plain, mark, palette));
                    let card =
                        14.0 + 2.0 + label_galley.rect.height() + 3.0 + galley.rect.height() + 2.0;
                    let last = *offsets.last().unwrap_or(&0.0);
                    offsets.push(last + card + SEARCH_GAP);
                    snippets.push(snippet);
                }
                let rows = SearchRowLayout { offsets, snippets };
                ui.data_mut(|data| data.insert_temp(cache_id, rows.clone()));
                rows
            };
            let offsets = &rows.offsets;
            let snippets = &rows.snippets;
            ui.set_min_height((*offsets.last().unwrap_or(&1.0)).max(1.0));
            if hits.is_empty() {
                return;
            }
            let first = offsets
                .partition_point(|y| *y <= viewport.min.y)
                .saturating_sub(1)
                .min(hits.len());
            let mut last = offsets.partition_point(|y| *y < viewport.max.y);
            if last > hits.len() {
                last = hits.len();
            }
            let first = first.min(last);
            let top = ui.max_rect().top();
            let list_clip = ui.clip_rect();
            for index in first..last {
                let hit = &hits[index];
                let snippet = &snippets[index];
                let rect = egui::Rect::from_min_size(
                    egui::pos2(ui.max_rect().left() + 8.0, top + offsets[index]),
                    egui::vec2(card_width, offsets[index + 1] - offsets[index] - SEARCH_GAP),
                );
                let hit_id =
                    ui.scope_id()
                        .with(("search-hit", hit.book_number, hit.chapter, hit.verse, index));
                let mut row_ui = ui.new_child(
                    egui::UiBuilder::new()
                        .id_salt(hit_id)
                        .max_rect(rect)
                        .layout(egui::Layout::top_down(egui::Align::Min)),
                );
                row_ui.set_clip_rect(list_clip);
                let label = format!(
                    "{} {}:{}",
                    i18n::book_name(hit.book_number).short,
                    hit.chapter,
                    hit.verse
                );
                let hovered = row_ui.data(|data| data.get_temp(hit_id).unwrap_or(false));
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
                    .show(&mut row_ui, |ui| {
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
                            snippet,
                            text_width,
                            12.0,
                            paint::color(palette.ui_text_muted),
                            paint::color(palette.ui_text),
                            palette,
                        );
                    });
                let response = row_ui.interact(row.response.rect, hit_id, egui::Sense::click());
                let hovered = response.hovered();
                let clicked = response.clicked();
                response.on_hover_cursor(egui::CursorIcon::PointingHand);
                row_ui.data_mut(|data| data.insert_temp(hit_id, hovered));
                if clicked {
                    let primary =
                        row_ui.input(|input| input.modifiers.command || input.modifiers.ctrl);
                    if primary {
                        self.session.open_search_hit_in_new_study(hit);
                        self.note_workspaces();
                    } else {
                        self.session.open_search_hit(hit);
                    }
                    self.loaded_key.clear();
                    self.sync_active_chapter();
                    row_ui.ctx().request_repaint();
                }
            }
        });
        paint::remember_scroll_extent(
            ui,
            search_scroll,
            search_view.content_size,
            search_view.inner_rect.size(),
        );
    }

    pub(crate) fn run_search(&mut self) {
        self.search_debounce = None;
        self.session.searching = false;
        let Some(module) = self.active_search_module() else {
            self.session.hits.clear();
            self.session.searched_query.clear();
            return;
        };
        let parsed = parse_search_query(Some(&self.session.query));
        if parsed.strongs.is_empty()
            && parsed.text_terms.is_empty()
            && parsed.exact_phrases.is_empty()
        {
            self.session.hits.clear();
            self.session.searched_query.clear();
            return;
        }
        if self.session.search_module_id.is_none() {
            if let Some(found) = self.modules.iter().find(|item| item.path == module) {
                self.session.search_module_id = Some(found.id.clone());
            }
        }
        self.session.searched_query = self.session.query.clone();
        self.session.hits = sqlite::search_in_file(&module, &self.session.query, None);
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
                            self.open_dictionary_info();
                        }
                        #[cfg(test)]
                        crate::chrome::mark_layout(ui, "dict-info-button", i_rect);
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
                    if self.session.dict_module_id.as_deref() != Some(&id) {
                        self.session.dict_module_id = Some(id.clone());
                        self.session.dict_query.clear();
                        self.session.dict_body.clear();
                        self.session.dict_entry = None;
                        self.session.dict_cognates.clear();
                        self.session.dict_morph_code = None;
                        self.session.dict_morph_lemma = None;
                        self.session.dict_morph_meaning = None;
                        self.session.dict_suggestions.clear();
                        self.session.dict_suggestions_open = false;
                        self.session.dict_suggestions_index = None;
                        self.store.set_dict_panel(serde_json::json!({
                            "selectedModuleId": self.session.dict_module_id,
                            "moduleSearchCache": self.session.dict_cache,
                        }));
                    }
                }

                let active_path = self.active_dictionary().map(|m| m.path.clone());

                // Row 3: Topic search input with Clear button
                let (response, box_rect, cleared) = search_input_box(
                    ui,
                    &mut self.session.dict_query,
                    &i18n::t("dictSearchPlaceholder"),
                    palette,
                );
                #[cfg(test)]
                crate::chrome::mark_layout(ui, "dict-search-box", box_rect);

                if cleared {
                    self.session.dict_body.clear();
                    self.session.dict_entry = None;
                    self.session.dict_cognates.clear();
                    self.session.dict_morph_code = None;
                    self.session.dict_morph_lemma = None;
                    self.session.dict_morph_meaning = None;
                    self.session.dict_suggestions.clear();
                    self.session.dict_suggestions_open = false;
                    self.session.dict_suggestions_index = None;
                } else if response.changed() {
                    let trimmed = self.session.dict_query.trim();
                    if trimmed.chars().count() < 2 {
                        self.session.dict_suggestions.clear();
                        self.session.dict_suggestions_open = false;
                        self.session.dict_suggestions_index = None;
                    } else if let Some(path) = &active_path {
                        self.session.dict_suggestions =
                            sqlite::dictionary_topics_in_file(path, trimmed, 20);
                        self.session.dict_suggestions_open =
                            !self.session.dict_suggestions.is_empty();
                        self.session.dict_suggestions_index = None;
                    }
                }

                if self.session.dict_suggestions_open && !self.session.dict_suggestions.is_empty() {
                    if ui.input(|input| input.key_pressed(egui::Key::ArrowDown)) {
                        self.session.dict_suggestions_index = match self.session.dict_suggestions_index {
                            None => Some(0),
                            Some(idx) => Some(
                                (idx + 1).min(self.session.dict_suggestions.len().saturating_sub(1)),
                            ),
                        };
                        ui.ctx().request_repaint();
                    } else if ui.input(|input| input.key_pressed(egui::Key::ArrowUp)) {
                        self.session.dict_suggestions_index = match self.session.dict_suggestions_index {
                            None | Some(0) => None,
                            Some(idx) => Some(idx - 1),
                        };
                        ui.ctx().request_repaint();
                    } else if ui.input(|input| input.key_pressed(egui::Key::Escape)) {
                        self.session.dict_suggestions.clear();
                        self.session.dict_suggestions_open = false;
                        self.session.dict_suggestions_index = None;
                        ui.ctx().request_repaint();
                    }
                }

                let enter_pressed = ui.input(|input| input.key_pressed(egui::Key::Enter))
                    && (response.lost_focus()
                        || response.has_focus()
                        || self.session.dict_suggestions_open);

                if !cleared && enter_pressed {
                    let topic = if self.session.dict_suggestions_open {
                        if let Some(idx) = self.session.dict_suggestions_index {
                            self.session
                                .dict_suggestions
                                .get(idx)
                                .cloned()
                                .unwrap_or_else(|| self.session.dict_query.clone())
                        } else {
                            self.session.dict_query.clone()
                        }
                    } else {
                        self.session.dict_query.clone()
                    };
                    self.session.dict_suggestions.clear();
                    self.session.dict_suggestions_open = false;
                    self.session.dict_suggestions_index = None;
                    let trimmed = topic.trim();
                    if !trimmed.is_empty() {
                        self.session.dict_query = trimmed.to_string();
                        self.lookup_dict(trimmed);
                    }
                }

                let popup_id = ui.scope_id().with("dict_suggestions_popup");
                let popup_rect_id = ui.scope_id().with("dict_suggestions_rect");

                if self.session.dict_suggestions_open && !self.session.dict_suggestions.is_empty() {
                    let mut picked = None;
                    let popup_pos = egui::pos2(box_rect.left(), box_rect.bottom() + 2.0);
                    let box_width = box_rect.width();
                    let frame_stroke = 1.0_f32;
                    let frame_margin_x = 2.0_f32;
                    let inner_width = (box_width - 2.0 * (frame_stroke + frame_margin_x)).max(10.0);
                    let suggestions = self.session.dict_suggestions.clone();
                    let active_idx = self.session.dict_suggestions_index;

                    let area_response = egui::Area::new(popup_id)
                        .fixed_pos(popup_pos)
                        .order(egui::Order::Foreground)
                        .show(ui.ctx(), |ui| {
                            ui.set_width(box_width);
                            ui.set_max_width(box_width);

                            let frame = egui::Frame::new()
                                .fill(paint::color(palette.ui_surface_elevated))
                                .stroke(egui::Stroke::new(
                                    frame_stroke,
                                    paint::color(if self.session.dark {
                                        palette.ui_border_strong
                                    } else {
                                        palette.ui_border_soft
                                    }),
                                ))
                                .corner_radius(egui::CornerRadius::same(
                                    graphe_domain::theme::RADIUS_CONTROL as u8,
                                ))
                                .shadow(egui::Shadow {
                                    offset: [0, 4],
                                    blur: 16,
                                    spread: 0,
                                    color: egui::Color32::from_black_alpha(if self.session.dark {
                                        120
                                    } else {
                                        35
                                    }),
                                })
                                .inner_margin(egui::Margin::symmetric(frame_margin_x as i8, 4));

                            frame.show(ui, |ui| {
                                ui.set_width(inner_width);
                                ui.set_max_width(inner_width);
                                // Shrink to the result count (width stays glued to
                                // the search box); only cap at 200px — and show the
                                // scrollbar — when the list is long enough.
                                egui::ScrollArea::vertical()
                                    .max_height(200.0)
                                    .auto_shrink([false, true])
                                    .show(ui, |ui| {
                                        ui.spacing_mut().item_spacing.y = 1.0;
                                        for (idx, topic) in suggestions.iter().enumerate() {
                                            let is_highlighted = active_idx == Some(idx);
                                            let _row_id =
                                                ui.scope_id().with(("dict-suggest", idx, topic));
                                            let row_w = ui.available_width();
                                            let (row_rect, row_resp) = ui.allocate_exact_size(
                                                egui::vec2(row_w, 26.0),
                                                egui::Sense::click(),
                                            );
                                            let is_hovered = row_resp.hovered();
                                            if is_hovered || is_highlighted {
                                                ui.painter().rect_filled(
                                                    row_rect,
                                                    egui::CornerRadius::same(2),
                                                    paint::color(palette.ui_accent_bg_soft),
                                                );
                                            }
                                            let text_color = if is_hovered || is_highlighted {
                                                paint::color(palette.ui_link)
                                            } else {
                                                paint::color(palette.ui_text)
                                            };
                                            let galley = ui.painter().layout_no_wrap(
                                                topic.clone(),
                                                egui::FontId::proportional(12.0),
                                                text_color,
                                            );
                                            let text_pos = egui::pos2(
                                                row_rect.left() + 8.0,
                                                row_rect.center().y - galley.rect.height() / 2.0,
                                            );
                                            ui.painter().galley(text_pos, galley, text_color);
                                            if is_hovered {
                                                ui.ctx().set_cursor_icon(egui::CursorIcon::PointingHand);
                                            }
                                            #[cfg(test)]
                                            crate::chrome::mark_layout(
                                                ui,
                                                &format!("dict-suggestion:{topic}"),
                                                row_rect,
                                            );
                                            if row_resp.clicked() {
                                                picked = Some(topic.clone());
                                            }
                                        }
                                    });
                            });
                        });

                    let rendered_rect = area_response.response.rect;
                    ui.data_mut(|d| d.insert_temp(popup_rect_id, rendered_rect));
                    #[cfg(test)]
                    crate::chrome::mark_layout(ui, "dict-suggestions-popup", rendered_rect);

                    if let Some(topic) = picked {
                        self.session.dict_query = topic.clone();
                        self.session.dict_suggestions.clear();
                        self.session.dict_suggestions_open = false;
                        self.session.dict_suggestions_index = None;
                        self.lookup_dict(&topic);
                        ui.ctx().request_repaint();
                    }
                } else {
                    ui.data_mut(|d| d.insert_temp(popup_rect_id, egui::Rect::NAN));
                }

                if self.session.dict_suggestions_open {
                    if ui.input(|i| i.pointer.any_click()) {
                        if let Some(pos) = ui.input(|i| i.pointer.interact_pos()) {
                            let last_popup_rect = ui.data(|d| d.get_temp::<egui::Rect>(popup_rect_id));
                            if !box_rect.contains(pos)
                                && !last_popup_rect.is_some_and(|r| r.contains(pos))
                            {
                                self.session.dict_suggestions.clear();
                                self.session.dict_suggestions_open = false;
                                self.session.dict_suggestions_index = None;
                            }
                        }
                    }
                }
            });
        separator_line(ui, palette.ui_border);

        // 2. Entry Content Area
        let active_dict = self.active_dictionary();
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
        let dict_font = graphe_domain::dict::dict_font_size(self.session.font_size);
        let meta_font = (dict_font - 1.0).max(13.0);
        let lexeme_font = (self.session.font_size * 1.25).max(22.0);

        // A wide entry must scroll inside the panel. Growing the scroll area
        // pushes the study pane and leaves an unpainted gap, and the resize
        // handle then snaps back to that content width.
        egui::ScrollArea::vertical()
            .auto_shrink([false, false])
            .hscroll(true)
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
                                let lexeme = graphe_domain::bidi::display_text(lexeme);
                                ui.label(
                                    egui::RichText::new(lexeme.as_ref())
                                        .size(lexeme_font)
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
                                        .size(meta_font)
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
                                let short_def = graphe_domain::bidi::display_text(short_def);
                                ui.label(
                                    egui::RichText::new(short_def.as_ref())
                                        .size(dict_font)
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
                            if self.session.dict_body == i18n::t("dictNoDictsConfigured") {
                                ui.horizontal_wrapped(|ui| {
                                    ui.label(
                                        egui::RichText::new(i18n::t("dictNoDictsConfigured"))
                                            .size(dict_font)
                                            .color(paint::color(palette.ui_text_subtle)),
                                    );
                                    if ui
                                        .link(
                                            egui::RichText::new(i18n::t("settings"))
                                                 .size(dict_font)
                                                 .color(paint::color(palette.ui_link)),
                                        )
                                        .clicked()
                                    {
                                        self.session.dialog = Dialog::Settings;
                                    }
                                });
                            } else if !self.session.dict_body.is_empty() {
                                paint::show_html(
                                    ui,
                                    &self.session.dict_body,
                                    dict_font,
                                    paint::color(palette.ui_text),
                                    paint::color(if self.session.dark {
                                        palette.ui_text_subtle
                                    } else {
                                        palette.ui_text_muted
                                    }),
                                    paint::color(palette.ui_link),
                                );
                            }

                            // Cognates
                            if !self.session.dict_cognates.is_empty() {
                                ui.add_space(10.0);
                                separator_line(ui, palette.ui_border);
                                ui.add_space(8.0);
                                ui.label(
                                    egui::RichText::new(i18n::t("dictCognates").to_uppercase())
                                        .size(10.0)
                                        .strong()
                                        .color(paint::color(if self.session.dark {
                                            palette.ui_text_muted
                                        } else {
                                            palette.ui_text_subtle
                                        })),
                                );
                                ui.add_space(6.0);
                                let cognates = self.session.dict_cognates.clone();
                                let text_hex = if self.session.dark {
                                    palette.ui_link_softest
                                } else {
                                    palette.ui_link
                                };
                                let fill_hex = if self.session.dark {
                                    palette.ui_link_soft
                                } else {
                                    palette.ui_link
                                };
                                ui.horizontal_wrapped(|ui| {
                                    ui.spacing_mut().item_spacing = egui::vec2(4.0, 4.0);
                                    for cognate in cognates {
                                        if paint::cognate_chip(ui, &cognate, text_hex, fill_hex)
                                            .clicked()
                                        {
                                            self.lookup_dict(&cognate);
                                        }
                                    }
                                });
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
        if self.session.strongs_dicts.is_empty() {
            self.session.dict_query = topic.to_string();
            self.session.dict_body = i18n::t("dictNoDictsConfigured");
            self.session.dict_entry = None;
            self.session.dict_cognates.clear();
            self.session.focus_sidebar("dictionary");
            self.session.dialog = Dialog::None;
            return;
        }
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
        let is_strong = topic.starts_with(['H', 'G', 'h', 'g'])
            && topic.chars().skip(1).all(|ch| ch.is_ascii_digit());
        let Some(path) = self.dict_path_for(&topic) else {
            self.session.dict_body = if is_strong && is_pseudo_strong(&topic) {
                i18n::t("dictPseudoStrongsNoEntry")
            } else if self
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
                self.session.dict_body = if is_pseudo_strong(&topic) {
                    i18n::t("dictPseudoStrongsNoEntry")
                } else {
                    i18n::t("dictNoEntry")
                };
                self.session.dict_entry = None;
                self.session.dict_cognates.clear();
            }
        }
    }

    fn dict_path_for(&self, topic: &str) -> Option<PathBuf> {
        if let Some(module) = self.active_dictionary() {
            if sqlite::dictionary_entry_in_file(&module.path, topic).is_some() {
                return Some(module.path.clone());
            }
        }
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
                let (key, is_reloading) = match self.reload_feedback {
                    Some(start) => {
                        let (key, reloading, repaint) =
                            reload_feedback_status(start.elapsed().as_millis());
                        if let Some(dur) = repaint {
                            ui.ctx().request_repaint_after(dur);
                        }
                        (key, reloading)
                    }
                    None => ("reloadModules", false),
                };
                let reload_label = i18n::t(key);
                let reload_resp = ui.add_enabled_ui(!is_reloading, |ui| {
                    command_button(ui, paint::Icon::Refresh, &reload_label, palette)
                });
                if reload_resp.inner.clicked() && !is_reloading {
                    self.reload_modules();
                    self.reload_feedback = Some(std::time::Instant::now());
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
    let row_id = ui.scope_id().with(("module-row", name, kind));
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
) -> (egui::Response, egui::Rect, bool) {
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
            // The first keystroke is applied by the TextEdit below, after this
            // row is measured. Giving the TextEdit the full width only when the
            // query was empty made that first character land after the
            // measurement: the clear button then pushed the row 20px past the
            // panel, and the panel stored the overflow as a permanently wider
            // sidebar. Reserving the button slot up front keeps the row at
            // exactly one width whether the query is empty or not.
            let text_w = (ui.available_width() - 20.0).max(10.0);
            let text_edit = ui.add(
                egui::TextEdit::singleline(query)
                    .frame(egui::Frame::NONE)
                    .margin(egui::Margin::ZERO)
                    .align(egui::Align2::LEFT_CENTER)
                    .hint_text(egui::RichText::new(hint).size(11.0))
                    .font(egui::FontId::proportional(13.0))
                    .text_color(paint::color(palette.ui_text))
                    .desired_width(text_w),
            );
            let (btn_rect, btn_resp) =
                ui.allocate_exact_size(egui::vec2(16.0, 16.0), egui::Sense::click());
            if !query.is_empty() {
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
    (inner_resp.inner, inner_resp.response.rect, cleared)
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
        ui.set_min_width(ui.available_width());
        ui.spacing_mut().item_spacing.y = 3.0;
        ui.label(
            egui::RichText::new("MORFOLOGIA")
                .size(10.0)
                .strong()
                .color(paint::color(palette.ui_text_subtle)),
        );
        morph_line(ui, &i18n::t("dictMorphCode"), code, palette);
        if !lemma.is_empty() {
            morph_line(ui, &i18n::t("dictMorphLemma"), lemma, palette);
        }
        morph_line(ui, &i18n::t("dictMorphMeaning"), meaning, palette);
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

/// Label and value on one wrapping line. A non-wrapping row is as wide as the
/// morphology sentence and drags the sidebar open with it.
fn morph_line(ui: &mut egui::Ui, label: &str, value: &str, palette: &UiPalette) {
    let width = ui.available_width().max(1.0);
    let mut job = egui::text::LayoutJob::default();
    job.wrap.max_width = width;
    let label_fmt = egui::TextFormat {
        font_id: egui::FontId::proportional(12.0),
        color: paint::color(palette.ui_text_muted),
        ..Default::default()
    };
    let value_fmt = egui::TextFormat {
        font_id: egui::FontId::proportional(12.0),
        color: paint::color(palette.ui_text),
        ..Default::default()
    };
    job.append(&format!("{label}:"), 0.0, label_fmt);
    let value = graphe_domain::bidi::display_text(value);
    job.append(value.as_ref(), 6.0, value_fmt);
    ui.label(job);
}

#[derive(Clone)]
struct SearchRowLayout {
    offsets: Vec<f32>,
    snippets: Vec<String>,
}

fn marked_job(
    marked: &str,
    width: f32,
    size: f32,
    plain: egui::Color32,
    mark: egui::Color32,
    palette: &UiPalette,
) -> egui::text::LayoutJob {
    let mut job = egui::text::LayoutJob::default();
    job.wrap.max_width = width;
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
    job
}

fn draw_marked(
    ui: &mut egui::Ui,
    marked: &str,
    width: f32,
    size: f32,
    plain: egui::Color32,
    mark: egui::Color32,
    palette: &UiPalette,
) {
    let job = marked_job(marked, width, size, plain, mark, palette);
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
    let text = graphe_domain::bidi::display_text(text);
    let text = text.as_ref();
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

fn is_pseudo_strong(topic: &str) -> bool {
    let strong = topic.starts_with(['H', 'G', 'h', 'g'])
        && topic.chars().skip(1).all(|ch| ch.is_ascii_digit());
    if strong {
        if let Ok(num) = topic[1..].parse::<u32>() {
            return num >= 9000;
        }
    }
    false
}

fn reload_feedback_status(elapsed_ms: u128) -> (&'static str, bool, Option<std::time::Duration>) {
    if elapsed_ms < 400 {
        (
            "reloadingModules",
            true,
            Some(std::time::Duration::from_millis(50)),
        )
    } else if elapsed_ms < 1600 {
        (
            "modulesReloaded",
            false,
            Some(std::time::Duration::from_millis(100)),
        )
    } else {
        ("reloadModules", false, None)
    }
}

#[cfg(test)]
mod tests {
    use crate::RunTestUi;

    #[test]
    fn test_header_galley_consistency() {
        let ctx = egui::Context::default();
        let _ = ctx.run_test_ui(Default::default(), |ctx| {
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

    #[test]
    fn test_pseudo_strong_detection() {
        use super::is_pseudo_strong;
        assert!(is_pseudo_strong("H9000"));
        assert!(is_pseudo_strong("H9009"));
        assert!(is_pseudo_strong("G9050"));
        assert!(!is_pseudo_strong("H1234"));
        assert!(!is_pseudo_strong("G1"));
        assert!(!is_pseudo_strong("word"));
    }

    #[test]
    fn test_reload_feedback_stages() {
        use super::reload_feedback_status;
        let (key, reloading, repaint) = reload_feedback_status(0);
        assert_eq!(key, "reloadingModules");
        assert!(reloading);
        assert_eq!(repaint, Some(std::time::Duration::from_millis(50)));

        let (key, reloading, _repaint) = reload_feedback_status(399);
        assert_eq!(key, "reloadingModules");
        assert!(reloading);

        let (key, reloading, repaint) = reload_feedback_status(400);
        assert_eq!(key, "modulesReloaded");
        assert!(!reloading);
        assert_eq!(repaint, Some(std::time::Duration::from_millis(100)));

        let (key, reloading, _repaint) = reload_feedback_status(1599);
        assert_eq!(key, "modulesReloaded");
        assert!(!reloading);

        let (key, reloading, repaint) = reload_feedback_status(1600);
        assert_eq!(key, "reloadModules");
        assert!(!reloading);
        assert_eq!(repaint, None);
    }

    #[test]
    fn test_search_input_box_placeholder_size() {
        let ctx = egui::Context::default();
        crate::paint::apply(&ctx, false, 20.0);
        let palette = graphe_domain::theme::palette(false);
        let mut query = String::new();
        let hint = "Buscar por palavra...";
        let output = ctx.run_test_ui(Default::default(), |ctx| {
            egui::CentralPanel::default().show(ctx, |ui| {
                let _ = super::search_input_box(ui, &mut query, hint, palette);
            });
        });

        fn galley_font_size(output: &egui::FullOutput, needle: &str) -> Option<f32> {
            fn walk(shape: &egui::Shape, needle: &str) -> Option<f32> {
                match shape {
                    egui::Shape::Text(text) if text.galley.job.text.contains(needle) => text
                        .galley
                        .job
                        .sections
                        .first()
                        .map(|section| section.format.font_id.size),
                    egui::Shape::Vec(list) => list.iter().find_map(|shape| walk(shape, needle)),
                    _ => None,
                }
            }
            output.shapes.iter().find_map(|cs| walk(&cs.shape, needle))
        }

        let size = galley_font_size(&output, hint).expect("placeholder painted");
        assert_eq!(size, 11.0, "placeholder font size must be 11.0, not the large reader body font");
    }

    #[test]
    fn test_dictionary_panel_scales_font_size() {
        let mut app = crate::app::tests::bare(crate::session::Session::new());
        app.session.sidebar = "dictionary".to_string();
        app.session.dict_query = "G3056".to_string();
        app.session.dict_body = "<p>Palavra grega logos</p>".to_string();

        fn get_font_size_for_needle(app: &mut crate::app::GrapheApp, font_size: f32, needle: &str) -> f32 {
            app.session.font_size = font_size;
            let ctx = egui::Context::default();
            crate::paint::apply(&ctx, app.session.dark, app.session.font_size);
            let output = ctx.run_test_ui(Default::default(), |ctx| {
                let palette = graphe_domain::theme::palette(app.session.dark);
                app.sidebar(ctx, palette);
            });
            fn walk(shape: &egui::Shape, needle: &str) -> Option<f32> {
                match shape {
                    egui::Shape::Text(text) if text.galley.job.text.contains(needle) => text
                        .galley
                        .job
                        .sections
                        .first()
                        .map(|section| section.format.font_id.size),
                    egui::Shape::Vec(list) => list.iter().find_map(|shape| walk(shape, needle)),
                    _ => None,
                }
            }
            output
                .shapes
                .iter()
                .find_map(|cs| walk(&cs.shape, needle))
                .expect("needle text must be painted")
        }

        let size_default = get_font_size_for_needle(&mut app, 20.0, "Palavra grega logos");
        assert_eq!(size_default, 16.0);

        let size_large = get_font_size_for_needle(&mut app, 24.0, "Palavra grega logos");
        assert_eq!(size_large, 20.0);
    }

    #[test]
    fn test_switching_dictionary_clears_search() {
        let dir = std::env::temp_dir().join(format!("graphe-dict-switch-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path_a = dir.join("DictA.dictionary.SQLite3");
        let path_b = dir.join("DictB.dictionary.SQLite3");
        graphe_store::sqlite::init_module_sql(
            &path_a,
            "CREATE TABLE info (name TEXT, value TEXT);
             CREATE TABLE dictionary (topic TEXT, definition TEXT);
             INSERT INTO info VALUES ('short.title', 'Dict A');
             INSERT INTO dictionary VALUES ('G1', 'um');",
        )
        .unwrap();
        graphe_store::sqlite::init_module_sql(
            &path_b,
            "CREATE TABLE info (name TEXT, value TEXT);
             CREATE TABLE dictionary (topic TEXT, definition TEXT);
             INSERT INTO info VALUES ('short.title', 'Dict B');
             INSERT INTO dictionary VALUES ('H1', 'paz');",
        )
        .unwrap();
        let mut app = crate::app::tests::bare(crate::session::Session::new());
        app.modules = graphe_store::catalog::scan_modules(&dir);
        assert_eq!(app.modules.len(), 2);
        let id_a = app.modules[0].id.clone();
        let id_b = app.modules[1].id.clone();

        app.session.dict_module_id = Some(id_a);
        app.session.dict_query = "G1".into();
        app.session.dict_body = "um".into();
        app.session.dict_suggestions = vec!["G1".into()];
        app.session.dict_suggestions_open = true;
        app.session.dict_suggestions_index = Some(0);

        if app.session.dict_module_id.as_deref() != Some(&id_b) {
            app.session.dict_module_id = Some(id_b);
            app.session.dict_query.clear();
            app.session.dict_body.clear();
            app.session.dict_entry = None;
            app.session.dict_cognates.clear();
            app.session.dict_morph_code = None;
            app.session.dict_morph_lemma = None;
            app.session.dict_morph_meaning = None;
            app.session.dict_suggestions.clear();
            app.session.dict_suggestions_open = false;
            app.session.dict_suggestions_index = None;
        }

        assert!(app.session.dict_query.is_empty(), "query must be cleared on dictionary switch");
        assert!(app.session.dict_body.is_empty(), "body must be cleared on dictionary switch");
        assert!(app.session.dict_suggestions.is_empty(), "suggestions must be cleared on dictionary switch");
        assert!(!app.session.dict_suggestions_open, "suggestions popup must be closed on dictionary switch");
        assert_eq!(app.session.dict_suggestions_index, None);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_dictionary_search_suggestions_lifecycle() {
        let dir = std::env::temp_dir().join(format!("graphe-dict-sugg-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("StrongTest.dictionary.SQLite3");
        graphe_store::sqlite::init_module_sql(
            &path,
            "CREATE TABLE info (name TEXT, value TEXT);
             CREATE TABLE dictionary (topic TEXT, definition TEXT);
             INSERT INTO info VALUES ('short.title', 'Strong Test');
             INSERT INTO dictionary VALUES ('G1', 'um'), ('G10', 'dez'), ('G100', 'cem'), ('H10', 'dez hebraico');",
        )
        .unwrap();
        let mut app = crate::app::tests::bare(crate::session::Session::new());
        app.modules = graphe_store::catalog::scan_modules(&dir);
        assert_eq!(app.modules.len(), 1);
        app.session.dict_module_id = Some(app.modules[0].id.clone());
        app.session.sidebar = "dictionary".into();

        // 1. Startup with existing query should NOT open suggestions dropdown
        app.session.dict_query = "G1".into();
        let ctx = egui::Context::default();
        crate::paint::apply(&ctx, false, 14.0);
        let palette = graphe_domain::theme::palette(false);

        let _ = ctx.run_test_ui(Default::default(), |ctx| {
            app.sidebar(ctx, palette);
        });

        assert!(
            app.session.dict_suggestions.is_empty(),
            "restored query must not open suggestions on startup"
        );
        assert!(
            !app.session.dict_suggestions_open,
            "suggestions dropdown must not be open on startup"
        );

        // 2. Click search box to focus it
        let marks = ctx.data(|d| {
            d.get_temp::<Vec<(String, [f32; 4])>>(egui::Id::unique("pane-layout-marks"))
                .unwrap_or_default()
        });
        let box_rect = marks
            .iter()
            .find(|(k, _)| k == "dict-search-box")
            .map(|(_, r)| *r)
            .expect("dict-search-box layout mark");
        let click_pos = egui::pos2(box_rect[0] + 10.0, box_rect[1] + box_rect[3] * 0.5);

        let _ = ctx.run_test_ui(
            egui::RawInput {
                events: vec![
                    egui::Event::PointerMoved(click_pos),
                    egui::Event::PointerButton {
                        pos: click_pos,
                        button: egui::PointerButton::Primary,
                        pressed: true,
                        modifiers: egui::Modifiers::default(),
                    },
                    egui::Event::PointerButton {
                        pos: click_pos,
                        button: egui::PointerButton::Primary,
                        pressed: false,
                        modifiers: egui::Modifiers::default(),
                    },
                ],
                ..Default::default()
            },
            |ctx| {
                app.sidebar(ctx, palette);
            },
        );

        // 3. Type 1 character ("G") - length < 2 characters must NOT open suggestions
        app.session.dict_query.clear();
        let _ = ctx.run_test_ui(
            egui::RawInput {
                events: vec![egui::Event::Text("G".into())],
                ..Default::default()
            },
            |ctx| {
                app.sidebar(ctx, palette);
            },
        );
        assert_eq!(app.session.dict_query, "G");
        assert!(
            app.session.dict_suggestions.is_empty(),
            "1 character must not trigger suggestions"
        );
        assert!(
            !app.session.dict_suggestions_open,
            "dropdown must remain closed when query has < 2 characters"
        );

        // 4. Type second character ("1") - query is now "G1" (>= 2 chars), suggestions open
        let _ = ctx.run_test_ui(
            egui::RawInput {
                events: vec![egui::Event::Text("1".into())],
                ..Default::default()
            },
            |ctx| {
                app.sidebar(ctx, palette);
            },
        );
        assert_eq!(app.session.dict_query, "G1");
        assert_eq!(app.session.dict_suggestions, vec!["G1", "G10", "G100"]);
        assert!(
            app.session.dict_suggestions_open,
            "suggestions dropdown should open for >= 2 chars"
        );
        assert_eq!(app.session.dict_suggestions_index, None);

        let marks = ctx.data(|d| {
            d.get_temp::<Vec<(String, [f32; 4])>>(egui::Id::unique("pane-layout-marks"))
                .unwrap_or_default()
        });
        let popup_rect = marks
            .iter()
            .rfind(|(k, _)| k == "dict-suggestions-popup")
            .map(|(_, r)| *r)
            .expect("dict-suggestions-popup layout mark");
        let current_box_rect = marks
            .iter()
            .rfind(|(k, _)| k == "dict-search-box")
            .map(|(_, r)| *r)
            .expect("dict-search-box layout mark");
        assert_eq!(
            popup_rect[2], current_box_rect[2],
            "popup width must match search box width exactly"
        );
        let popup_height = popup_rect[3];
        assert!(
            (78.0..120.0).contains(&popup_height),
            "dropdown must shrink to its 3 rows instead of filling the 200px cap, got {popup_height:.0}px"
        );

        // 5. Navigate with ArrowDown
        let _ = ctx.run_test_ui(
            egui::RawInput {
                events: vec![egui::Event::Key {
                    key: egui::Key::ArrowDown,
                    pressed: true,
                    repeat: false,
                    modifiers: egui::Modifiers::NONE,
                    physical_key: None,
                }],
                ..Default::default()
            },
            |ctx| {
                app.sidebar(ctx, palette);
            },
        );
        assert_eq!(app.session.dict_suggestions_index, Some(0));

        let _ = ctx.run_test_ui(
            egui::RawInput {
                events: vec![egui::Event::Key {
                    key: egui::Key::ArrowDown,
                    pressed: true,
                    repeat: false,
                    modifiers: egui::Modifiers::NONE,
                    physical_key: None,
                }],
                ..Default::default()
            },
            |ctx| {
                app.sidebar(ctx, palette);
            },
        );
        assert_eq!(app.session.dict_suggestions_index, Some(1));

        // 6. Select item with Enter - closes dropdown immediately and loads entry
        let _ = ctx.run_test_ui(
            egui::RawInput {
                events: vec![egui::Event::Key {
                    key: egui::Key::Enter,
                    pressed: true,
                    repeat: false,
                    modifiers: egui::Modifiers::NONE,
                    physical_key: None,
                }],
                ..Default::default()
            },
            |ctx| {
                app.sidebar(ctx, palette);
            },
        );
        assert_eq!(app.session.dict_query, "G10");
        assert!(
            !app.session.dict_suggestions_open,
            "dropdown must close immediately upon selecting an item"
        );
        assert!(
            app.session.dict_suggestions.is_empty(),
            "suggestions list should be cleared on selection"
        );
        assert_eq!(app.session.dict_body, "dez");

        // 7. Click search box to refocus, type "G1" again and test Escape closes dropdown
        app.session.dict_query.clear();
        let _ = ctx.run_test_ui(
            egui::RawInput {
                events: vec![
                    egui::Event::PointerMoved(click_pos),
                    egui::Event::PointerButton {
                        pos: click_pos,
                        button: egui::PointerButton::Primary,
                        pressed: true,
                        modifiers: egui::Modifiers::default(),
                    },
                    egui::Event::PointerButton {
                        pos: click_pos,
                        button: egui::PointerButton::Primary,
                        pressed: false,
                        modifiers: egui::Modifiers::default(),
                    },
                ],
                ..Default::default()
            },
            |ctx| {
                app.sidebar(ctx, palette);
            },
        );

        let _ = ctx.run_test_ui(
            egui::RawInput {
                events: vec![egui::Event::Text("G1".into())],
                ..Default::default()
            },
            |ctx| {
                app.sidebar(ctx, palette);
            },
        );
        assert_eq!(app.session.dict_query, "G1");
        assert!(app.session.dict_suggestions_open);

        let _ = ctx.run_test_ui(
            egui::RawInput {
                events: vec![egui::Event::Key {
                    key: egui::Key::Escape,
                    pressed: true,
                    repeat: false,
                    modifiers: egui::Modifiers::NONE,
                    physical_key: None,
                }],
                ..Default::default()
            },
            |ctx| {
                app.sidebar(ctx, palette);
            },
        );
        assert!(!app.session.dict_suggestions_open);
        assert!(app.session.dict_suggestions.is_empty());

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// The clear button only paints when the query is non-empty, but the
    /// TextEdit applies the first keystroke after the row was measured. Making
    /// that button optional left the search box one row 20px wider than the
    /// panel, which egui then stored as the sidebar's new width.
    #[test]
    fn first_dictionary_letter_keeps_search_box_and_sidebar_width() {
        let dir = std::env::temp_dir()
            .join(format!("graphe-dict-sugg-first-letter-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("StrongTest.dictionary.SQLite3");
        graphe_store::sqlite::init_module_sql(
            &path,
            "CREATE TABLE info (name TEXT, value TEXT);
             CREATE TABLE dictionary (topic TEXT, definition TEXT);
             INSERT INTO info VALUES ('short.title', 'Strong Test');
             INSERT INTO dictionary VALUES ('G1', 'um'), ('G10', 'dez'), ('G100', 'cem'), ('H10', 'dez hebraico');",
        )
        .unwrap();
        let mut app = crate::app::tests::bare(crate::session::Session::new());
        app.modules = graphe_store::catalog::scan_modules(&dir);
        assert_eq!(app.modules.len(), 1);
        app.session.dict_module_id = Some(app.modules[0].id.clone());
        app.session.sidebar = "dictionary".into();

        let ctx = egui::Context::default();
        crate::paint::apply(&ctx, false, 14.0);
        let palette = graphe_domain::theme::palette(false);
        let panel_id = egui::ViewportId::ROOT.root_ui_id().with("sidebar");
        let sidebar_width =
            |ctx: &egui::Context| -> f32 {
                egui::containers::panel::PanelState::load(ctx, panel_id)
                    .map(|s| s.outer_rect.width())
                    .unwrap_or_default()
            };
        let search_box_width = |ctx: &egui::Context| -> f32 {
            ctx.data(|d| {
                d.get_temp::<Vec<(String, [f32; 4])>>(egui::Id::unique("pane-layout-marks"))
                    .unwrap_or_default()
                    .iter()
                    .rfind(|(k, _)| k == "dict-search-box")
                    .map(|(_, r)| r[2])
                    .unwrap_or_default()
            })
        };

        // 1. Startup frame
        let _ = ctx.run_test_ui(Default::default(), |ctx| {
            app.sidebar(ctx, palette);
        });
        let empty_box_width = search_box_width(&ctx);
        assert_eq!(empty_box_width, 275.0, "search box at default panel size");
        assert_eq!(sidebar_width(&ctx), 300.0, "startup frame");

        // 2. Click search box to focus it
        let marks = ctx.data(|d| {
            d.get_temp::<Vec<(String, [f32; 4])>>(egui::Id::unique("pane-layout-marks"))
                .unwrap_or_default()
        });
        let box_rect = marks
            .iter()
            .find(|(k, _)| k == "dict-search-box")
            .map(|(_, r)| *r)
            .expect("dict-search-box layout mark");
        let click_pos = egui::pos2(box_rect[0] + 10.0, box_rect[1] + box_rect[3] * 0.5);
        let _ = ctx.run_test_ui(
            egui::RawInput {
                events: vec![
                    egui::Event::PointerMoved(click_pos),
                    egui::Event::PointerButton {
                        pos: click_pos,
                        button: egui::PointerButton::Primary,
                        pressed: true,
                        modifiers: egui::Modifiers::default(),
                    },
                    egui::Event::PointerButton {
                        pos: click_pos,
                        button: egui::PointerButton::Primary,
                        pressed: false,
                        modifiers: egui::Modifiers::default(),
                    },
                ],
                ..Default::default()
            },
            |ctx| {
                app.sidebar(ctx, palette);
            },
        );
        assert_eq!(sidebar_width(&ctx), 300.0, "click frame");

        // 3. Type 1 character - the frame that used to overflow the row
        app.session.dict_query.clear();
        let _ = ctx.run_test_ui(
            egui::RawInput {
                events: vec![egui::Event::Text("G".into())],
                ..Default::default()
            },
            |ctx| {
                app.sidebar(ctx, palette);
            },
        );
        assert_eq!(app.session.dict_query, "G");
        assert_eq!(
            search_box_width(&ctx),
            empty_box_width,
            "the first letter must not widen the search box"
        );
        assert_eq!(sidebar_width(&ctx), 300.0, "first character frame");

        // 4. Second character opens the suggestions dropdown
        let _ = ctx.run_test_ui(
            egui::RawInput {
                events: vec![egui::Event::Text("1".into())],
                ..Default::default()
            },
            |ctx| {
                app.sidebar(ctx, palette);
            },
        );
        assert_eq!(app.session.dict_query, "G1");
        assert_eq!(
            search_box_width(&ctx),
            empty_box_width,
            "search box width is one constant, empty or not"
        );
        assert_eq!(sidebar_width(&ctx), 300.0, "second character frame");

        // Idle frames with the popup open keep every width in place
        for frame in 0..2 {
            let _ = ctx.run_test_ui(Default::default(), |ctx| {
                app.sidebar(ctx, palette);
            });
            assert_eq!(sidebar_width(&ctx), 300.0, "idle frame {frame}");
            assert_eq!(
                search_box_width(&ctx),
                empty_box_width,
                "idle frame {frame} keeps the search box width"
            );
        }

        let _ = std::fs::remove_dir_all(&dir);
    }
}

