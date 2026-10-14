//! Study tabs, split panes, verse text, commentary, and cross-references.

use crate::app::GrapheApp;
use crate::dropdown::ModuleDropdown;
use crate::paint;
use crate::session::Dialog;
use graphe_domain::books::GRAPHE_BOOK_NUMBERS;
use graphe_domain::coverage::{build_coverage_cell, CoverageClass};
use graphe_domain::i18n;
use graphe_domain::markup::{self, VerseSpan};
use graphe_domain::model::PaneNode;
use graphe_domain::morphology::{resolve_morphology, MorphModule, MorphSources};
use graphe_domain::theme::UiPalette;
use graphe_store::catalog::InstalledModule;
use graphe_store::sqlite::{self, CrossReference};
use std::collections::{HashMap, HashSet};
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::Arc;

impl GrapheApp {
    pub(crate) fn editor(&mut self, ctx: &egui::Context, palette: &UiPalette) {
        #[cfg(test)]
        ctx.data_mut(|data| {
            data.remove_temp::<Vec<(String, [f32; 4])>>(egui::Id::new("pane-layout-marks"));
        });
        #[cfg(test)]
        {
            self.reading.rows_painted = 0;
        }
        self.sync_active_chapter();
        egui::CentralPanel::default()
            .frame(
                egui::Frame::new()
                    .fill(paint::color(palette.ui_bg))
                    .inner_margin(egui::Margin::ZERO),
            )
            .show(ctx, |ui| {
                self.workspace_tabs(ui, palette);
                let tree = self.session.tree.clone();
                self.draw_node(ui, &tree, palette);
                if self.session.chapter_text.is_empty()
                    && self.modules.iter().all(|module| module.kind != "bible")
                {
                    ui.label(i18n::t("noModules"));
                }
            });
    }

    fn draw_node(&mut self, ui: &mut egui::Ui, node: &PaneNode, palette: &UiPalette) {
        let width = ui.available_width().max(0.0);
        let height = ui.available_height().max(0.0);
        match node {
            PaneNode::Leaf { pane_id } => {
                let pane_id = pane_id.clone();
                self.fit_region(ui, width, height, |app, ui| {
                    app.draw_pane(ui, &pane_id, palette);
                });
            }
            PaneNode::Split {
                direction,
                ratio,
                children,
            } => {
                let ratio = (*ratio as f32).clamp(0.2, 0.8);
                let gap = 5.0;
                if direction == "v" {
                    let top_h = ((height - gap) * ratio).max(0.0);
                    let bottom_h = (height - gap - top_h).max(0.0);
                    ui.allocate_ui_with_layout(
                        egui::vec2(width, height),
                        egui::Layout::top_down(egui::Align::Min),
                        |ui| {
                            self.fit_region(ui, width, top_h, |app, ui| {
                                app.draw_node(ui, &children.0, palette);
                            });
                            split_rule(ui, width, gap, false, palette);
                            self.fit_region(ui, width, bottom_h, |app, ui| {
                                app.draw_node(ui, &children.1, palette);
                            });
                        },
                    );
                } else {
                    let left_w = ((width - gap) * ratio).max(0.0);
                    let right_w = (width - gap - left_w).max(0.0);
                    ui.allocate_ui_with_layout(
                        egui::vec2(width, height),
                        egui::Layout::left_to_right(egui::Align::Min),
                        |ui| {
                            self.fit_region(ui, left_w, height, |app, ui| {
                                app.draw_node(ui, &children.0, palette);
                            });
                            split_rule(ui, height, gap, true, palette);
                            self.fit_region(ui, right_w, height, |app, ui| {
                                app.draw_node(ui, &children.1, palette);
                            });
                        },
                    );
                }
            }
        }
    }

    fn fit_region(
        &mut self,
        ui: &mut egui::Ui,
        width: f32,
        height: f32,
        draw: impl FnOnce(&mut Self, &mut egui::Ui),
    ) {
        ui.allocate_ui_with_layout(
            egui::vec2(width, height),
            egui::Layout::top_down(egui::Align::Min),
            |ui| {
                ui.set_min_size(egui::vec2(width, height));
                draw(self, ui);
            },
        );
    }

    fn draw_pane(&mut self, ui: &mut egui::Ui, pane_id: &str, palette: &UiPalette) {
        let Some(pane) = self.session.panes.get(pane_id).cloned() else {
            return;
        };
        let (book, chapter, verse) = self.session.reading_location(pane_id);
        ui.push_id(pane_id, |ui| {
            self.pane_toolbar(ui, pane_id, palette);
            let body = egui::vec2(ui.available_width(), ui.available_height().max(0.0));
            ui.allocate_ui_with_layout(body, egui::Layout::top_down(egui::Align::Min), |ui| {
                ui.set_min_size(body);
                #[cfg(test)]
                crate::chrome::mark_layout(ui, &format!("body:{pane_id}"), ui.max_rect());
                if pane.pane_type == graphe_domain::model::PaneType::Bible {
                    self.draw_favorite_quick_bar(ui, pane_id, palette);
                }
                if pane.pane_type == graphe_domain::model::PaneType::Commentary {
                    self.draw_commentary(ui, pane_id, book, chapter, verse, palette);
                } else {
                    self.draw_bible(ui, pane_id, book, chapter, palette);
                }
            });
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
        let show_strongs = self.session.show_strongs;
        let font = self.session.font_size;
        let dark = self.session.dark;
        let module_path = self
            .session
            .panes
            .get(pane_id)
            .and_then(|pane| pane.module_id.clone())
            .and_then(|id| self.bible_path(Some(&id)).map(Path::to_path_buf))
            .or_else(|| self.bible_path(None).map(Path::to_path_buf));
        let paint = self.prepared_chapter(
            pane_id,
            active_bible,
            book,
            chapter,
            show_strongs,
            module_path.as_deref(),
        );
        let xref_ids = self.session.xref_modules.clone();
        let refs = self
            .reading
            .cross_refs(&self.modules, &xref_ids, book, chapter);
        let selected: HashSet<i64> = if active_bible {
            self.session.selected_verses.iter().copied().collect()
        } else {
            HashSet::new()
        };
        let scroll_verse = active_bible.then_some(self.session.scroll_verse).flatten();
        let scroll_center = self.session.scroll_center;
        let xref_key = xref_ids.join(",");
        egui::ScrollArea::vertical()
            .id_salt(("chapter", pane_id))
            .auto_shrink([false, false])
            .max_height(ui.available_height())
            .show_viewport(ui, |ui, viewport| {
                let full = ui.available_width();
                let row_width = (full - BIBLE_PAD_LEFT - BIBLE_PAD_RIGHT).max(48.0);
                let text_width = (row_width - VERSE_NUM_W).max(32.0);
                let height_key = layout_key(paint.fingerprint, font, text_width, &xref_key);
                if self.reading.heights(pane_id, height_key).is_none() {
                    let heights: Vec<f32> = paint
                        .spans
                        .iter()
                        .enumerate()
                        .map(|(index, spans)| {
                            let verse = paint.verses[index].0;
                            measure_verse_height(
                                ui,
                                spans,
                                text_width,
                                font,
                                palette,
                                refs.get(&verse).is_some(),
                            )
                        })
                        .collect();
                    self.reading.set_heights(pane_id, height_key, heights);
                }
                let heights = self
                    .reading
                    .heights(pane_id, height_key)
                    .unwrap_or_default();
                let total = BIBLE_PAD_TOP + rows_prefix(&heights, heights.len()) + BIBLE_PAD_BOTTOM;
                ui.set_min_width(full);
                ui.set_min_height(total);
                if let Some(verse) = scroll_verse {
                    if let Some(index) = paint.verses.iter().position(|(item, _)| *item == verse) {
                        let top =
                            ui.max_rect().top() + BIBLE_PAD_TOP + rows_prefix(&heights, index);
                        let height = heights.get(index).copied().unwrap_or(24.0);
                        let rect = egui::Rect::from_min_size(
                            egui::pos2(ui.max_rect().left() + BIBLE_PAD_LEFT, top),
                            egui::vec2(row_width, height),
                        );
                        ui.scroll_to_rect(rect, scroll_center.then_some(egui::Align::Center));
                    }
                }
                let (start, end) =
                    visible_row_span(&heights, BIBLE_PAD_TOP, viewport.min.y, viewport.max.y);
                if start >= end {
                    return;
                }
                let y0 = ui.max_rect().top() + BIBLE_PAD_TOP + rows_prefix(&heights, start);
                let y1 = ui.max_rect().top() + BIBLE_PAD_TOP + rows_prefix(&heights, end);
                let band = egui::Rect::from_min_max(
                    egui::pos2(ui.max_rect().left() + BIBLE_PAD_LEFT, y0),
                    egui::pos2(
                        ui.max_rect().left() + BIBLE_PAD_LEFT + row_width,
                        y1.max(y0 + 1.0),
                    ),
                );
                let mut grew = false;
                ui.scope_builder(egui::UiBuilder::new().max_rect(band), |ui| {
                    ui.skip_ahead_auto_ids(start);
                    ui.spacing_mut().item_spacing.y = ROW_GAP;
                    for index in start..end {
                        let before = ui.cursor().min.y;
                        let verse = paint.verses[index].0;
                        let verse_refs = refs.get(&verse).map(Vec::as_slice).unwrap_or(&[]);
                        self.paint_verse_row(
                            ui,
                            pane_id,
                            verse,
                            &paint.spans[index],
                            text_width,
                            font,
                            dark,
                            selected.contains(&verse),
                            verse_refs,
                            module_path.as_deref(),
                            active_bible,
                            palette,
                        );
                        let stride = (ui.cursor().min.y - before).max(1.0);
                        if self.reading.update_height(pane_id, index, stride) {
                            grew = true;
                        }
                        #[cfg(test)]
                        {
                            self.reading.rows_painted += 1;
                        }
                    }
                });
                if grew {
                    ui.ctx().request_repaint();
                }
            });
        if active_bible && scroll_verse.is_some() {
            self.session.scroll_verse = None;
        }
    }

    fn select_bible_verse(
        &mut self,
        pane_id: &str,
        verse: i64,
        active_bible: bool,
        shift: bool,
        toggle: bool,
    ) {
        self.session.active_pane_id = pane_id.to_string();
        if active_bible {
            self.session.select_verse(verse, shift, toggle);
            return;
        }
        if let Some(pane) = self.session.panes.get_mut(pane_id) {
            pane.selected_verse = Some(verse);
        }
        self.session.reveal_selected_verse(false);
        self.loaded_key.clear();
    }

    fn draw_verse_refs(
        &mut self,
        ui: &mut egui::Ui,
        pane_id: &str,
        refs: &[CrossReference],
        palette: &UiPalette,
    ) {
        if refs.is_empty() {
            return;
        }
        ui.horizontal_wrapped(|ui| {
            ui.spacing_mut().item_spacing.x = 6.0;
            for reference in refs {
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
        let paint = self.load_commentary(&module, book, chapter);
        let coverage_color = match paint.coverage_class {
            CoverageClass::Full => palette.ui_link,
            CoverageClass::Partial => palette.ui_warn,
            CoverageClass::None => palette.ui_text_muted,
        };
        ui.label(egui::RichText::new(&paint.coverage_text).color(paint::color(coverage_color)));
        if paint.pieces.is_empty() {
            ui.label(i18n::t("commentaryUnavailable"));
            return;
        }
        let font = self.session.font_size;
        let text_color = paint::color(palette.ui_text);
        let link_color = paint::color(palette.ui_link);
        let _output = egui::ScrollArea::vertical()
            .id_salt(("commentary", pane_id))
            .auto_shrink([false, false])
            .max_height(ui.available_height())
            .show(ui, |ui| {
                let width = ui.available_width();
                ui.set_min_width(width);
                let _frame = egui::Frame::new()
                    .inner_margin(COMMENTARY_MARGIN)
                    .show(ui, |ui| {
                        let inner = ui.available_width().max(32.0);
                        ui.set_min_width(inner);
                        self.paint_commentary_body(
                            ui,
                            pane_id,
                            &paint.pieces,
                            inner,
                            font,
                            text_color,
                            link_color,
                        );
                    });
                #[cfg(test)]
                crate::chrome::mark_layout(
                    ui,
                    &format!("commentary-frame:{pane_id}"),
                    _frame.response.rect,
                );
            });
        #[cfg(test)]
        crate::chrome::mark_layout(ui, &format!("commentary-view:{pane_id}"), _output.inner_rect);
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

    pub(crate) fn module_combo(
        &mut self,
        ui: &mut egui::Ui,
        pane_id: &str,
        kind: &graphe_domain::model::PaneType,
    ) {
        let wanted = match kind {
            graphe_domain::model::PaneType::Commentary => "commentary",
            graphe_domain::model::PaneType::Bible => "bible",
        };
        let current = self
            .session
            .panes
            .get(pane_id)
            .and_then(|pane| pane.module_id.clone());
        let palette = graphe_domain::theme::palette(self.session.dark);
        let dropdown =
            ModuleDropdown::from_installed(pane_id, wanted, current.as_deref(), &self.modules)
                .plain();

        if let Some(id) = dropdown.show(ui, &mut self.store, palette, self.session.dark) {
            if let Some(pane) = self.session.panes.get_mut(pane_id) {
                pane.module_id = Some(id);
            }
            self.loaded_key.clear();
            self.sync_active_chapter();
        }
    }

    fn draw_favorite_quick_bar(&mut self, ui: &mut egui::Ui, pane_id: &str, palette: &UiPalette) {
        let favs = graphe_domain::picker::favorites(&self.store, "bible");
        if favs.is_empty() {
            return;
        }
        let current_mod = self
            .session
            .panes
            .get(pane_id)
            .and_then(|p| p.module_id.clone());

        let mut switch_to = None;
        ui.horizontal_wrapped(|ui| {
            ui.spacing_mut().item_spacing = egui::vec2(4.0, 4.0);
            for fav_id in &favs {
                let Some(module) = self.modules.iter().find(|m| &m.id == fav_id) else {
                    continue;
                };
                let is_active = current_mod.as_deref() == Some(fav_id.as_str());
                let label = module.short_title.as_deref().unwrap_or(&module.name);

                let text = egui::RichText::new(label).size(11.0).color(if is_active {
                    paint::color(palette.ui_accent_ink)
                } else {
                    paint::color(palette.ui_text_muted)
                });
                let stroke = egui::Stroke::new(
                    1.0_f32,
                    paint::color(if is_active {
                        palette.ui_border_strong
                    } else {
                        palette.ui_border_soft
                    }),
                );
                let fill = paint::color(if is_active {
                    palette.ui_accent_bg
                } else {
                    palette.ui_surface
                });

                let button = egui::Button::new(text)
                    .corner_radius(egui::CornerRadius::same(12))
                    .stroke(stroke)
                    .fill(fill)
                    .min_size(egui::vec2(0.0, 20.0));

                let response = ui.add(button);
                if response.clicked() && !is_active {
                    switch_to = Some(fav_id.clone());
                }
            }
        });

        if let Some(new_id) = switch_to {
            if let Some(pane) = self.session.panes.get_mut(pane_id) {
                pane.module_id = Some(new_id);
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

    pub(crate) fn morph_text(&mut self, path: &Path, code: &str) -> String {
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

    fn prepared_chapter(
        &mut self,
        pane_id: &str,
        active: bool,
        book: i64,
        chapter: i64,
        show_strongs: bool,
        module_path: Option<&Path>,
    ) -> ChapterPaint {
        let prefix = if book < 470 { "H" } else { "G" };
        if active {
            let fingerprint = text_fingerprint(&self.session.chapter_text, show_strongs, prefix);
            let key = format!("a|{pane_id}|{book}|{chapter}");
            if let Some(paint) = self.reading.cached_chapter(&key, Some(fingerprint)) {
                return paint;
            }
            let verses = self.session.chapter_text.clone();
            return self
                .reading
                .insert_chapter(key, fingerprint, verses, show_strongs, prefix);
        }
        let path = module_path
            .map(|path| path.to_string_lossy().to_string())
            .unwrap_or_default();
        let key = format!("f|{path}|{book}|{chapter}|{show_strongs}");
        if let Some(paint) = self.reading.cached_chapter(&key, None) {
            return paint;
        }
        let verses = module_path
            .map(|path| {
                sqlite::chapter_in_file(path, book, chapter)
                    .into_iter()
                    .map(|verse| (verse.verse, verse.text))
                    .collect()
            })
            .unwrap_or_default();
        self.reading
            .insert_chapter(key, 0, verses, show_strongs, prefix)
    }

    fn load_commentary(
        &mut self,
        module: &InstalledModule,
        book: i64,
        chapter: i64,
    ) -> CommentaryPaint {
        let lang = i18n::get_current_lang().as_str();
        let key = commentary_key(&module.path, book, chapter, lang);
        if let Some(paint) = self.reading.commentary.get(&key) {
            return paint.clone();
        }
        let coverage = self.reading.coverage_map(&module.path);
        let index = GRAPHE_BOOK_NUMBERS
            .iter()
            .position(|number| i64::from(*number) == book)
            .unwrap_or(0);
        let cell = build_coverage_cell(book, index, &coverage);
        let entries = sqlite::commentary_in_file(&module.path, book, chapter);
        let pieces = if entries.is_empty() {
            Arc::new(Vec::new())
        } else {
            Arc::new(pieces_from_entries(&entries, self.matcher()))
        };
        let paint = CommentaryPaint {
            coverage_text: format!("{} — {}", cell.text, cell.title),
            coverage_class: cell.class_name,
            pieces,
        };
        if self.reading.commentary.len() >= 8 {
            self.reading.commentary.clear();
        }
        self.reading.commentary.insert(key, paint.clone());
        paint
    }

    fn paint_verse_row(
        &mut self,
        ui: &mut egui::Ui,
        pane_id: &str,
        verse: i64,
        spans: &[VerseSpan],
        text_width: f32,
        font: f32,
        dark: bool,
        selected: bool,
        refs: &[CrossReference],
        module_path: Option<&Path>,
        active_bible: bool,
        palette: &UiPalette,
    ) {
        let layout = verse_layout(ui, spans, text_width, font, palette);
        let row_height = layout.galley.rect.height().max(font * 0.8) + 8.0;
        let (rect, response) = ui.allocate_exact_size(
            egui::vec2(ui.available_width(), row_height),
            egui::Sense::click(),
        );
        #[cfg(test)]
        crate::chrome::mark_layout(ui, &format!("verse:{pane_id}:{verse}"), rect);
        let fill = if selected {
            verse_selected_fill(dark, palette)
        } else {
            egui::Color32::TRANSPARENT
        };
        if fill != egui::Color32::TRANSPARENT {
            ui.painter()
                .rect_filled(rect, egui::CornerRadius::same(2), fill);
        }
        let bar = if selected {
            paint::color(if dark {
                palette.ui_link
            } else {
                palette.ui_link_strong
            })
        } else if response.hovered() {
            paint::color_alpha(palette.ui_link, 140)
        } else {
            egui::Color32::TRANSPARENT
        };
        ui.painter().rect_filled(
            egui::Rect::from_min_size(rect.left_top(), egui::vec2(3.0, rect.height())),
            0.0,
            bar,
        );
        ui.painter().text(
            rect.left_top() + egui::vec2(8.0, 4.0),
            egui::Align2::LEFT_TOP,
            verse.to_string(),
            egui::FontId::proportional(font * 0.8),
            paint::color(palette.ui_verse_num),
        );
        let origin = rect.left_top() + egui::vec2(VERSE_NUM_W, 4.0);
        ui.painter().galley(
            origin,
            Arc::clone(&layout.galley),
            paint::color(palette.ui_text),
        );
        if response.hovered() {
            ui.ctx().set_cursor_icon(egui::CursorIcon::PointingHand);
        }
        let pointer = response
            .hover_pos()
            .or_else(|| response.interact_pointer_pos());
        let strong = pointer
            .and_then(|pos| strong_at(&layout, origin, pos))
            .cloned();
        if let Some(code) = strong.as_ref().and_then(|hit| hit.morph.clone()) {
            if let Some(path) = module_path {
                let meaning = self.morph_text(path, &code);
                if !meaning.is_empty() {
                    response.clone().on_hover_text(format!("{code}: {meaning}"));
                }
            }
        }
        if response.clicked() {
            let (shift, toggle) = click_modifiers(ui);
            self.select_bible_verse(pane_id, verse, active_bible, shift, toggle);
            if !shift && !toggle {
                if let Some(hit) = &strong {
                    self.lookup_dict_with_context(
                        &hit.display,
                        hit.morph.as_deref(),
                        hit.lemma.as_deref(),
                        module_path,
                    );
                }
            }
        }
        let menu_id = egui::Id::new(("strong-menu", pane_id, verse));
        if response.secondary_clicked() {
            if let Some(hit) = &strong {
                let saved = hit.clone();
                ui.data_mut(|data| data.insert_temp(menu_id, saved));
            } else {
                ui.data_mut(|data| data.remove_temp::<StrongHit>(menu_id));
            }
        }
        let menu_open = ui
            .data(|data| data.get_temp::<StrongHit>(menu_id))
            .is_some();
        if menu_open {
            response.context_menu(|ui| {
                let Some(hit) = ui.data(|data| data.get_temp::<StrongHit>(menu_id)) else {
                    return;
                };
                if ui.button(i18n::t("strongsSearchOccurrences")).clicked() {
                    self.session.query = format!("strong:{}", hit.display);
                    self.session.focus_sidebar("search");
                    self.run_search();
                    ui.close();
                }
                if ui.button(i18n::t("strongsDictionaryLookup")).clicked() {
                    self.lookup_dict_with_context(
                        &hit.display,
                        hit.morph.as_deref(),
                        hit.lemma.as_deref(),
                        module_path,
                    );
                    ui.close();
                }
            });
        }
        self.draw_verse_refs(ui, pane_id, refs, palette);
    }

    fn paint_commentary_body(
        &mut self,
        ui: &mut egui::Ui,
        pane_id: &str,
        pieces: &[CommentaryPiece],
        width: f32,
        font: f32,
        text_color: egui::Color32,
        link_color: egui::Color32,
    ) {
        let (galley, links) = commentary_layout(ui, pieces, width, font, text_color, link_color);
        let (rect, response) = ui.allocate_exact_size(
            egui::vec2(width, galley.rect.height().max(1.0)),
            egui::Sense::click(),
        );
        #[cfg(test)]
        crate::chrome::mark_layout(ui, &format!("commentary-text:{pane_id}"), rect);
        ui.painter()
            .galley(rect.min, Arc::clone(&galley), text_color);
        let pointer = response
            .hover_pos()
            .or_else(|| response.interact_pointer_pos());
        let link = pointer.and_then(|pos| link_at(&galley, rect.min, &links, pos));
        if link.is_some() && response.hovered() {
            ui.ctx().set_cursor_icon(egui::CursorIcon::PointingHand);
        }
        if response.clicked() {
            if let Some(hit) = link {
                self.follow_ref(pane_id, hit.book, hit.chapter, hit.verse);
            }
        }
    }
}

fn split_rule(ui: &mut egui::Ui, span: f32, gap: f32, vertical: bool, palette: &UiPalette) {
    let (rect, _) = ui.allocate_exact_size(
        if vertical {
            egui::vec2(gap, span)
        } else {
            egui::vec2(span, gap)
        },
        egui::Sense::hover(),
    );
    let mid = if vertical {
        [rect.center_top(), rect.center_bottom()]
    } else {
        [rect.left_center(), rect.right_center()]
    };
    ui.painter().line_segment(
        mid,
        egui::Stroke::new(1.0_f32, paint::color(palette.ui_border)),
    );
}

fn verse_selected_fill(dark: bool, palette: &UiPalette) -> egui::Color32 {
    if dark {
        paint::color_alpha(palette.ui_link_soft, 96)
    } else {
        paint::color_alpha(palette.ui_link_strong, 64)
    }
}

fn click_modifiers(ui: &egui::Ui) -> (bool, bool) {
    ui.input(|input| {
        (
            input.modifiers.shift,
            input.modifiers.ctrl || input.modifiers.command,
        )
    })
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

/// Space around the bible list so the first and last verse can scroll clear of the pane edge.
const BIBLE_PAD_LEFT: f32 = 8.0;
const BIBLE_PAD_RIGHT: f32 = 14.0;
const BIBLE_PAD_TOP: f32 = 10.0;
const BIBLE_PAD_BOTTOM: f32 = 28.0;
const VERSE_NUM_W: f32 = 36.0;
const ROW_GAP: f32 = 1.0;

/// Commentary text inset. The bottom margin is taller so the last line can scroll fully into view.
const COMMENTARY_MARGIN: egui::Margin = egui::Margin {
    left: 16,
    right: 18,
    top: 12,
    bottom: 28,
};

#[derive(Clone)]
pub(crate) struct ChapterPaint {
    fingerprint: u64,
    verses: Arc<Vec<(i64, String)>>,
    spans: Arc<Vec<Vec<VerseSpan>>>,
}

#[derive(Clone)]
pub(crate) struct CommentaryPaint {
    pub(crate) coverage_text: String,
    pub(crate) coverage_class: CoverageClass,
    pub(crate) pieces: Arc<Vec<CommentaryPiece>>,
}

#[derive(Clone)]
pub(crate) enum CommentaryPiece {
    Text(String),
    Link {
        label: String,
        book: i64,
        chapter: i64,
        verse: Option<i64>,
    },
}

struct ChapterSlot {
    fingerprint: u64,
    paint: ChapterPaint,
}

#[derive(Clone, Default)]
struct StrongHit {
    start: usize,
    end: usize,
    display: String,
    morph: Option<String>,
    lemma: Option<String>,
}

struct VerseLayout {
    galley: Arc<egui::Galley>,
    strongs: Vec<StrongHit>,
}

struct LinkHit {
    start: usize,
    end: usize,
    book: i64,
    chapter: i64,
    verse: Option<i64>,
}

pub(crate) struct ReadingCache {
    chapters: HashMap<String, ChapterSlot>,
    xrefs: HashMap<String, Arc<HashMap<i64, Vec<CrossReference>>>>,
    pub(crate) commentary: HashMap<String, CommentaryPaint>,
    coverage: HashMap<PathBuf, Arc<HashMap<i64, Vec<i64>>>>,
    heights: HashMap<String, (u64, Vec<f32>)>,
    #[cfg(test)]
    pub(crate) rows_painted: usize,
}

impl ReadingCache {
    pub(crate) fn new() -> Self {
        Self {
            chapters: HashMap::new(),
            xrefs: HashMap::new(),
            commentary: HashMap::new(),
            coverage: HashMap::new(),
            heights: HashMap::new(),
            #[cfg(test)]
            rows_painted: 0,
        }
    }

    pub(crate) fn clear(&mut self) {
        self.chapters.clear();
        self.xrefs.clear();
        self.commentary.clear();
        self.coverage.clear();
        self.heights.clear();
    }

    fn cached_chapter(&self, key: &str, fingerprint: Option<u64>) -> Option<ChapterPaint> {
        let slot = self.chapters.get(key)?;
        if fingerprint.is_some_and(|expected| slot.fingerprint != expected) {
            return None;
        }
        Some(slot.paint.clone())
    }

    fn insert_chapter(
        &mut self,
        key: String,
        fingerprint: u64,
        verses: Vec<(i64, String)>,
        show_strongs: bool,
        prefix: &str,
    ) -> ChapterPaint {
        let spans = Arc::new(
            verses
                .iter()
                .map(|(_, text)| markup::verse_spans(text, show_strongs, prefix).0)
                .collect::<Vec<_>>(),
        );
        let paint = ChapterPaint {
            fingerprint,
            verses: Arc::new(verses),
            spans,
        };
        if self.chapters.len() >= 8 {
            self.chapters.clear();
        }
        self.chapters.insert(
            key,
            ChapterSlot {
                fingerprint,
                paint: paint.clone(),
            },
        );
        paint
    }

    pub(crate) fn cross_refs(
        &mut self,
        modules: &[InstalledModule],
        ids: &[String],
        book: i64,
        chapter: i64,
    ) -> Arc<HashMap<i64, Vec<CrossReference>>> {
        let key = format!("{book}:{chapter}:{}", ids.join(","));
        if let Some(hit) = self.xrefs.get(&key) {
            return Arc::clone(hit);
        }
        let mut grouped: HashMap<i64, Vec<CrossReference>> = HashMap::new();
        for id in ids {
            if let Some(module) = modules.iter().find(|module| &module.id == id) {
                for reference in sqlite::cross_refs_in_file(&module.path, book, chapter) {
                    grouped.entry(reference.verse).or_default().push(reference);
                }
            }
        }
        let grouped = Arc::new(grouped);
        if self.xrefs.len() >= 6 {
            self.xrefs.clear();
        }
        self.xrefs.insert(key, Arc::clone(&grouped));
        grouped
    }

    fn coverage_map(&mut self, path: &Path) -> Arc<HashMap<i64, Vec<i64>>> {
        if let Some(hit) = self.coverage.get(path) {
            return Arc::clone(hit);
        }
        let map = Arc::new(
            sqlite::commentary_coverage_in_file(path)
                .into_iter()
                .collect::<HashMap<_, _>>(),
        );
        self.coverage.insert(path.to_path_buf(), Arc::clone(&map));
        map
    }

    fn heights(&self, pane_id: &str, key: u64) -> Option<Vec<f32>> {
        self.heights
            .get(pane_id)
            .filter(|(stored, _)| *stored == key)
            .map(|(_, heights)| heights.clone())
    }

    fn set_heights(&mut self, pane_id: &str, key: u64, heights: Vec<f32>) {
        self.heights.insert(pane_id.to_string(), (key, heights));
    }

    fn update_height(&mut self, pane_id: &str, index: usize, height: f32) -> bool {
        let Some((_, heights)) = self.heights.get_mut(pane_id) else {
            return false;
        };
        let Some(slot) = heights.get_mut(index) else {
            return false;
        };
        if (*slot - height).abs() <= 1.0 {
            return false;
        }
        *slot = height;
        true
    }
}

pub(crate) fn commentary_key(path: &Path, book: i64, chapter: i64, lang: &str) -> String {
    format!("{}|{book}|{chapter}|{lang}", path.display())
}

fn text_fingerprint(verses: &[(i64, String)], show_strongs: bool, prefix: &str) -> u64 {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    show_strongs.hash(&mut hasher);
    prefix.hash(&mut hasher);
    verses.len().hash(&mut hasher);
    for (verse, text) in verses {
        verse.hash(&mut hasher);
        text.hash(&mut hasher);
    }
    hasher.finish()
}

fn layout_key(fingerprint: u64, font: f32, text_width: f32, xref_key: &str) -> u64 {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    fingerprint.hash(&mut hasher);
    font.to_bits().hash(&mut hasher);
    (text_width.round() as i32).hash(&mut hasher);
    xref_key.hash(&mut hasher);
    hasher.finish()
}

pub(crate) fn rows_prefix(heights: &[f32], count: usize) -> f32 {
    heights.iter().take(count).sum()
}

/// Rows that intersect the viewport, plus one neighbor on each side.
pub(crate) fn visible_row_span(
    heights: &[f32],
    pad_top: f32,
    view_min: f32,
    view_max: f32,
) -> (usize, usize) {
    if heights.is_empty() {
        return (0, 0);
    }
    let mut y = pad_top;
    let mut first = None;
    let mut last = 0usize;
    for (index, height) in heights.iter().enumerate() {
        let bottom = y + *height;
        if bottom > view_min && y < view_max {
            if first.is_none() {
                first = Some(index);
            }
            last = index;
        }
        y = bottom;
    }
    let Some(first) = first else {
        if view_max <= pad_top {
            return (0, 1.min(heights.len()));
        }
        return (heights.len() - 1, heights.len());
    };
    (first.saturating_sub(1), (last + 2).min(heights.len()))
}

fn pieces_from_entries(
    entries: &[graphe_domain::model::CommentaryEntry],
    matcher: &graphe_domain::commentary_ref::ReferenceMatcher,
) -> Vec<CommentaryPiece> {
    let mut pieces = Vec::new();
    for (index, entry) in entries.iter().enumerate() {
        if index > 0 {
            pieces.push(CommentaryPiece::Text("\n".into()));
        }
        let block = format!("{} {}", entry.verse_from, entry.text);
        append_linked(&mut pieces, &block, matcher);
    }
    pieces
}

fn append_linked(
    pieces: &mut Vec<CommentaryPiece>,
    text: &str,
    matcher: &graphe_domain::commentary_ref::ReferenceMatcher,
) {
    let matches = matcher.find_matches(Some(text));
    let mut cursor = 0usize;
    for reference in &matches {
        let head = slice_between(text, cursor, reference.index);
        if !head.is_empty() {
            pieces.push(CommentaryPiece::Text(head.to_string()));
        }
        let label = slice_between(text, reference.index, reference.end_index);
        let label = if label.is_empty() {
            reference.raw.clone()
        } else {
            label.to_string()
        };
        pieces.push(CommentaryPiece::Link {
            label,
            book: reference.book_num,
            chapter: reference.chapter,
            verse: reference.verse_from,
        });
        cursor = reference.end_index;
    }
    let tail = slice_between(text, cursor, text.len());
    if !tail.is_empty() {
        pieces.push(CommentaryPiece::Text(tail.to_string()));
    }
}

fn text_format(size: f32, color: egui::Color32) -> egui::TextFormat {
    egui::TextFormat {
        font_id: egui::FontId::proportional(size),
        color,
        ..Default::default()
    }
}

fn push_chars(
    job: &mut egui::text::LayoutJob,
    chars: &mut usize,
    text: &str,
    format: egui::TextFormat,
) {
    if text.is_empty() {
        return;
    }
    *chars += text.chars().count();
    job.append(text, 0.0, format);
}

fn verse_layout(
    ui: &egui::Ui,
    spans: &[VerseSpan],
    text_width: f32,
    font: f32,
    palette: &UiPalette,
) -> VerseLayout {
    let mut job = egui::text::LayoutJob::default();
    job.wrap.max_width = text_width;
    job.break_on_newline = true;
    let mut chars = 0usize;
    let mut strongs = Vec::new();
    let body = text_format(font, paint::color(palette.ui_text));
    let strong_fmt = text_format(font * 0.55, paint::color(palette.ui_text_subtle));
    let note_fmt = text_format(font * 0.72, paint::color(palette.ui_text_muted));
    for span in spans {
        match span {
            VerseSpan::Text(text) => push_chars(&mut job, &mut chars, text, body.clone()),
            VerseSpan::Strong {
                display,
                morph,
                lemma,
            } => {
                if display.is_empty() {
                    continue;
                }
                let label = format!(" {display}");
                let start = chars;
                push_chars(&mut job, &mut chars, &label, strong_fmt.clone());
                strongs.push(StrongHit {
                    start,
                    end: chars,
                    display: display.clone(),
                    morph: morph.clone(),
                    lemma: lemma.clone(),
                });
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
                    notes.push(value.clone());
                }
                if let Some(value) = transliteration {
                    notes.push(value.clone());
                }
                if let Some(value) = pronunciation {
                    notes.push(value.clone());
                }
                notes.extend(glosses.clone());
                notes.extend(references.clone());
                if !notes.is_empty() {
                    push_chars(
                        &mut job,
                        &mut chars,
                        &format!(" {}", notes.join(" · ")),
                        note_fmt.clone(),
                    );
                }
            }
            VerseSpan::Footnote(note) => {
                push_chars(&mut job, &mut chars, &format!(" {note}"), note_fmt.clone());
            }
        }
    }
    let galley = ui.painter().layout_job(job);
    VerseLayout { galley, strongs }
}

fn measure_verse_height(
    ui: &egui::Ui,
    spans: &[VerseSpan],
    text_width: f32,
    font: f32,
    palette: &UiPalette,
    has_refs: bool,
) -> f32 {
    let layout = verse_layout(ui, spans, text_width, font, palette);
    let text = layout.galley.rect.height().max(font * 0.8) + 8.0;
    let refs = if has_refs {
        (font * 0.7).max(14.0)
    } else {
        0.0
    };
    text + refs + ROW_GAP
}

fn commentary_layout(
    ui: &egui::Ui,
    pieces: &[CommentaryPiece],
    width: f32,
    font: f32,
    text_color: egui::Color32,
    link_color: egui::Color32,
) -> (Arc<egui::Galley>, Vec<LinkHit>) {
    let mut job = egui::text::LayoutJob::default();
    job.wrap.max_width = width;
    job.break_on_newline = true;
    let mut chars = 0usize;
    let mut links = Vec::new();
    let body = text_format(font, text_color);
    let mut link_fmt = text_format(font, link_color);
    link_fmt.underline = egui::Stroke::new(1.0_f32, link_color);
    for piece in pieces {
        match piece {
            CommentaryPiece::Text(text) => push_chars(&mut job, &mut chars, text, body.clone()),
            CommentaryPiece::Link {
                label,
                book,
                chapter,
                verse,
            } => {
                let start = chars;
                push_chars(&mut job, &mut chars, label, link_fmt.clone());
                links.push(LinkHit {
                    start,
                    end: chars,
                    book: *book,
                    chapter: *chapter,
                    verse: *verse,
                });
            }
        }
    }
    (ui.painter().layout_job(job), links)
}

fn char_index_at(galley: &egui::Galley, origin: egui::Pos2, pos: egui::Pos2) -> Option<usize> {
    let local = pos - origin;
    let cursor = egui::pos2(local.x, local.y);
    if !galley.rect.expand(3.0).contains(cursor) {
        return None;
    }
    Some(galley.cursor_from_pos(local).index)
}

fn strong_at(layout: &VerseLayout, origin: egui::Pos2, pos: egui::Pos2) -> Option<&StrongHit> {
    let index = char_index_at(&layout.galley, origin, pos)?;
    layout
        .strongs
        .iter()
        .find(|hit| index >= hit.start && index < hit.end)
}

fn link_at<'a>(
    galley: &egui::Galley,
    origin: egui::Pos2,
    links: &'a [LinkHit],
    pos: egui::Pos2,
) -> Option<&'a LinkHit> {
    let index = char_index_at(galley, origin, pos)?;
    links
        .iter()
        .find(|hit| index >= hit.start && index < hit.end)
}

#[cfg(test)]
mod tests {
    use super::{rows_prefix, visible_row_span};

    #[test]
    fn row_prefix_sums_only_the_rows_above() {
        assert_eq!(rows_prefix(&[10.0, 20.0, 30.0], 0), 0.0);
        assert_eq!(rows_prefix(&[10.0, 20.0, 30.0], 2), 30.0);
        assert_eq!(rows_prefix(&[10.0, 20.0, 30.0], 9), 60.0);
    }

    #[test]
    fn visible_rows_include_the_viewport_and_one_neighbor() {
        let heights = vec![10.0; 20];
        let (start, end) = visible_row_span(&heights, 0.0, 25.0, 55.0);
        assert_eq!(start, 1);
        assert_eq!(end, 7);
        assert!(end - start < heights.len());
    }

    #[test]
    fn visible_rows_stay_inside_a_short_chapter() {
        let heights = vec![20.0; 3];
        assert_eq!(visible_row_span(&heights, 8.0, 0.0, 40.0), (0, 3));
        assert_eq!(visible_row_span(&[], 0.0, 0.0, 40.0), (0, 0));
    }
}
