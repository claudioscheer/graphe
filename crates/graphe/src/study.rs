//! Study tabs, split panes, verse text, commentary, and cross-references.

use crate::app::GrapheApp;
use crate::dropdown::ModuleDropdown;
use crate::paint;
use crate::session::{CommentarySection, Dialog};

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
                // The tab row sits on the toolbar. A gap here shows the paper fill as a white line.
                ui.spacing_mut().item_spacing.y = 0.0;
                self.workspace_tabs(ui, palette);
                let tree = self.session.tree.clone();
                self.draw_node(ui, &tree, palette, "");
                if self.session.chapter_text.is_empty()
                    && self.modules.iter().all(|module| module.kind != "bible")
                {
                    ui.label(i18n::t("noModules"));
                }
            });
    }

    fn draw_node(&mut self, ui: &mut egui::Ui, node: &PaneNode, palette: &UiPalette, path: &str) {
        let width = ui.available_width().max(0.0);
        let height = ui.available_height().max(0.0);
        match node {
            PaneNode::Leaf { pane_id } => {
                let pane_id = pane_id.clone();
                let spacing = ui.spacing().item_spacing;
                self.fit_region(ui, width, height, spacing, |app, ui| {
                    app.draw_pane(ui, &pane_id, palette);
                });
            }
            PaneNode::Split {
                direction,
                ratio,
                children,
            } => {
                let vertical = direction == "v";
                let span = if vertical { height } else { width };
                let min_px = if vertical {
                    SPLIT_MIN_HEIGHT
                } else {
                    SPLIT_MIN_WIDTH
                };
                let shown = clamp_split_ratio(*ratio as f32, span, min_px);
                let spacing = ui.spacing().item_spacing;
                let left_path = child_path(path, 0);
                let right_path = child_path(path, 1);
                // No gutter: the toolbar color runs across the split and the close
                // control stays inside the pane. The hairline is the drag handle.
                let gesture = if vertical {
                    let top_h = (height * shown).max(0.0);
                    let bottom_h = (height - top_h).max(0.0);
                    ui.allocate_ui_with_layout(
                        egui::vec2(width, height),
                        egui::Layout::top_down(egui::Align::Min),
                        |ui| {
                            ui.spacing_mut().item_spacing = egui::Vec2::ZERO;
                            let origin = ui.max_rect().min;
                            self.fit_region(ui, width, top_h, spacing, |app, ui| {
                                app.draw_node(ui, &children.0, palette, &left_path);
                            });
                            self.fit_region(ui, width, bottom_h, spacing, |app, ui| {
                                app.draw_node(ui, &children.1, palette, &right_path);
                            });
                            split_handle(ui, origin, width, top_h, false, palette, path)
                        },
                    )
                    .inner
                } else {
                    let left_w = (width * shown).max(0.0);
                    let right_w = (width - left_w).max(0.0);
                    ui.allocate_ui_with_layout(
                        egui::vec2(width, height),
                        egui::Layout::left_to_right(egui::Align::Min),
                        |ui| {
                            ui.spacing_mut().item_spacing = egui::Vec2::ZERO;
                            let origin = ui.max_rect().min;
                            self.fit_region(ui, left_w, height, spacing, |app, ui| {
                                app.draw_node(ui, &children.0, palette, &left_path);
                            });
                            self.fit_region(ui, right_w, height, spacing, |app, ui| {
                                app.draw_node(ui, &children.1, palette, &right_path);
                            });
                            split_handle(ui, origin, height, left_w, true, palette, path)
                        },
                    )
                    .inner
                };
                self.apply_split_gesture(path, shown, gesture, span, min_px);
            }
        }
    }

    fn apply_split_gesture(
        &mut self,
        path: &str,
        shown: f32,
        gesture: SplitGesture,
        span: f32,
        min_px: f32,
    ) {
        if gesture.delta.abs() > 0.0 && span > 1.0 {
            let (min_ratio, max_ratio) = split_ratio_limits(span, min_px);
            let next = (shown + gesture.delta / span).clamp(min_ratio, max_ratio);
            self.session.set_split_ratio(path, next as f64);
        }
        if gesture.stopped {
            self.note_workspaces();
        }
    }

    fn fit_region(
        &mut self,
        ui: &mut egui::Ui,
        width: f32,
        height: f32,
        spacing: egui::Vec2,
        draw: impl FnOnce(&mut Self, &mut egui::Ui),
    ) {
        ui.allocate_ui_with_layout(
            egui::vec2(width, height),
            egui::Layout::top_down(egui::Align::Min),
            |ui| {
                ui.spacing_mut().item_spacing = spacing;
                ui.set_min_size(egui::vec2(width, height));
                draw(self, ui);
            },
        );
    }

    fn draw_pane(&mut self, ui: &mut egui::Ui, pane_id: &str, palette: &UiPalette) {
        let Some(pane) = self.session.panes.get(pane_id).cloned() else {
            return;
        };
        let (book, chapter, _) = self.session.reading_location(pane_id);
        ui.push_id(pane_id, |ui| {
            let pane_rect = ui.max_rect();
            let toolbar_rect = egui::Rect::from_min_size(
                pane_rect.min,
                egui::vec2(pane_rect.width(), crate::chrome::TOOLBAR_HEIGHT),
            );
            let body_rect = egui::Rect::from_min_max(
                egui::pos2(pane_rect.left(), toolbar_rect.bottom()),
                pane_rect.max,
            );
            // Paint the chapter first, clipped to the area under the bar, then
            // paint the bar. Scrolled text stays underneath the controls.
            {
                let mut body = ui.new_child(
                    egui::UiBuilder::new()
                        .id_salt("pane-body")
                        .max_rect(body_rect)
                        .layout(egui::Layout::top_down(egui::Align::Min)),
                );
                body.set_min_size(body_rect.size());
                body.shrink_clip_rect(body_rect);
                paint::clip_scroll_to_viewport(&mut body);
                #[cfg(test)]
                crate::chrome::mark_layout(&body, &format!("body:{pane_id}"), body.max_rect());
                if pane.pane_type == graphe_domain::model::PaneType::Commentary {
                    self.draw_commentary(&mut body, pane_id, book, chapter, palette);
                } else {
                    self.draw_bible(&mut body, pane_id, book, chapter, palette);
                }
            }
            {
                let mut bar = ui.new_child(
                    egui::UiBuilder::new()
                        .id_salt("pane-bar")
                        .max_rect(toolbar_rect)
                        .layout(egui::Layout::top_down(egui::Align::Min)),
                );
                self.pane_toolbar(&mut bar, pane_id, palette);
            }
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
        // Keep the vertical bar off the side-by-side divider. The grab strip owns that edge.
        let scroll_width = (ui.available_width() - SPLIT_HIT).max(32.0);
        ui.set_max_width(scroll_width);
        let chapter_scroll = paint::scroll_id(ui, ("chapter", pane_id));
        paint::scroll_by_wheel(ui, chapter_scroll, 1.45);
        let chapter_view = egui::ScrollArea::vertical()
            .id_salt(("chapter", pane_id))
            .auto_shrink([false, false])
            .animated(false)
            .scroll_source(egui::containers::scroll_area::ScrollSource {
                scroll_bar: true,
                drag: true,
                mouse_wheel: false,
            })
            .max_height(ui.available_height())
            .show_viewport(ui, |ui, viewport| {
                let full = ui.available_width();
                let row_width = (full - BIBLE_PAD_LEFT - BIBLE_PAD_RIGHT).max(48.0);
                let text_width = (row_width - VERSE_NUM_W).max(32.0);
                let width_px = text_width.round() as i32;
                let content_key = content_layout_key(paint.fingerprint, font, &xref_key);
                // Measuring every verse on every pixel stalls a drag once several
                // chapters are open. Reuse the last heights while the pointer is down
                // or the width just changed, then measure once it stays put.
                let pointer_down = ui.input(|input| input.pointer.primary_down());
                let held = self.reading.prepare_heights(
                    pane_id,
                    content_key,
                    width_px,
                    paint.spans.len(),
                    pointer_down,
                );
                let (heights, provisional) = if let Some(held) = held {
                    (held.heights, held.provisional)
                } else {
                    #[cfg(test)]
                    {
                        self.reading.chapter_measures += 1;
                    }
                    let heights: Vec<f32> = paint
                        .spans
                        .iter()
                        .enumerate()
                        .map(|(index, spans)| {
                            let verse = paint.verses[index].0;
                            self.measure_verse_height(
                                ui,
                                spans,
                                text_width,
                                font,
                                palette,
                                refs.get(&verse).is_some(),
                            )
                        })
                        .collect();
                    self.reading
                        .set_heights(pane_id, content_key, width_px, heights.clone());
                    (heights, false)
                };
                let total = BIBLE_PAD_TOP + rows_prefix(&heights, heights.len()) + BIBLE_PAD_BOTTOM;
                ui.set_width(full);
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
                let mut y1 = ui.max_rect().top() + BIBLE_PAD_TOP + rows_prefix(&heights, end);
                if provisional {
                    // The old row heights may be short for the new width. Let the
                    // visible rows use their real height down through the viewport.
                    y1 = y1.max(ui.max_rect().top() + viewport.max.y);
                }
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
        paint::remember_scroll_extent(
            ui,
            chapter_scroll,
            chapter_view.content_size,
            chapter_view.inner_rect.size(),
        );
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
        self.session.note_bible_moved(pane_id);
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
        let mut ordered = refs.to_vec();
        order_cross_refs(&mut ordered);
        // The verse number keeps the left column. References start where the verse text starts.
        let width = ui.available_width();
        let wrap = (width - VERSE_NUM_W).max(32.0);
        ui.horizontal(|ui| {
            ui.spacing_mut().item_spacing.x = 0.0;
            ui.add_space(VERSE_NUM_W);
            ui.allocate_ui_with_layout(
                egui::vec2(wrap, 0.0),
                egui::Layout::left_to_right(egui::Align::Min).with_main_wrap(true),
                |ui| {
                    ui.spacing_mut().item_spacing = egui::vec2(6.0, 2.0);
                    for reference in &ordered {
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
                        #[cfg(test)]
                        crate::chrome::mark_layout(
                            ui,
                            &format!(
                                "ref:{pane_id}:{}:{}:{}:{}",
                                reference.verse,
                                reference.book_to,
                                reference.chapter_to,
                                reference.verse_to_start.unwrap_or(1)
                            ),
                            response.rect,
                        );
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
                },
            );
        });
    }

    fn draw_commentary(
        &mut self,
        ui: &mut egui::Ui,
        pane_id: &str,
        book: i64,
        chapter: i64,
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
        if paint.pieces.is_empty() {
            ui.label(i18n::t("commentaryUnavailable"));
            return;
        }
        let font = self.session.font_size;
        let text_color = paint::color(palette.ui_text);
        let link_color = paint::color(palette.ui_link);
        let scroll_width = (ui.available_width() - SPLIT_HIT).max(32.0);
        ui.set_max_width(scroll_width);
        let commentary_scroll = paint::scroll_id(ui, ("commentary", pane_id));
        paint::scroll_by_wheel(ui, commentary_scroll, 2.1);
        let _output = egui::ScrollArea::vertical()
            .id_salt(("commentary", pane_id))
            .auto_shrink([false, false])
            .animated(false)
            .scroll_source(egui::containers::scroll_area::ScrollSource {
                scroll_bar: true,
                drag: false,
                mouse_wheel: false,
            })
            .max_height(ui.available_height())
            .show(ui, |ui| {
                let width = ui.available_width();
                ui.set_width(width);
                let _frame = egui::Frame::new()
                    .inner_margin(COMMENTARY_MARGIN)
                    .show(ui, |ui| {
                        let inner = ui.available_width().max(32.0);
                        ui.set_min_width(inner);
                        self.paint_commentary_body(
                            ui, pane_id, &paint, inner, font, text_color, link_color,
                        );
                    });
                #[cfg(test)]
                crate::chrome::mark_layout(
                    ui,
                    &format!("commentary-frame:{pane_id}"),
                    _frame.response.rect,
                );
            });
        paint::remember_scroll_extent(
            ui,
            commentary_scroll,
            _output.content_size,
            _output.inner_rect.size(),
        );
        #[cfg(test)]
        crate::chrome::mark_layout(
            ui,
            &format!("commentary-view:{pane_id}"),
            _output.inner_rect,
        );
    }

    pub(crate) fn load_all_commentaries(&mut self, book: i64, chapter: i64, verse: Option<i64>) {
        let verse = verse.unwrap_or(1);
        let mut sections = Vec::new();
        for module in self
            .modules
            .iter()
            .filter(|module| module.kind == "commentary")
            .cloned()
        {
            let mut bodies = Vec::new();
            for entry in sqlite::commentary_in_file(&module.path, book, chapter) {
                let end = entry.verse_to.unwrap_or(entry.verse_from);
                if verse < entry.verse_from || verse > end {
                    continue;
                }
                let plain = commentary_plain(&entry.text);
                if !plain.is_empty() {
                    bodies.push(plain);
                }
            }
            if bodies.is_empty() {
                continue;
            }
            sections.push(CommentarySection {
                name: module.name,
                body: bodies.join("\n\n"),
            });
        }
        self.session.commentary_open = vec![false; sections.len()];
        self.session.commentary_sections = sections;
        let name = i18n::book_name(book);
        self.session.commentary_ref = format!("{} {chapter}:{verse}", name.short);
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
            let name = i18n::book_name(book);
            self.session.preview_title = match verse {
                Some(value) => format!("{} {chapter}:{value}", name.short),
                None => format!("{} {chapter}", name.short),
            };
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
        pane_width: f32,
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
        let width =
            crate::chrome::toolbar_picker_width(pane_width, ui.ctx().content_rect().width());
        let dropdown =
            ModuleDropdown::from_installed(pane_id, wanted, current.as_deref(), &self.modules)
                .plain()
                .width(width);

        if let Some(id) = dropdown.show(ui, &mut self.store, palette, self.session.dark) {
            if let Some(pane) = self.session.panes.get_mut(pane_id) {
                pane.module_id = Some(id);
            }
            self.loaded_key.clear();
            self.sync_active_chapter();
        }
    }

    fn verse_preview(&self, book: i64, chapter: i64, verse: Option<i64>) -> String {
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
        plain
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
        let entries = sqlite::commentary_in_file(&module.path, book, chapter);
        let (pieces, anchors) = if entries.is_empty() {
            (Vec::new(), Vec::new())
        } else {
            pieces_from_entries(&entries, self.matcher(), chapter)
        };
        let mut paint = CommentaryPaint::new(pieces);
        paint.anchors = Arc::new(anchors);
        if self.reading.commentary.len() >= 24 {
            self.reading.commentary.clear();
        }
        self.reading.commentary.insert(key, paint.clone());
        paint
    }

    fn verse_row_layout(
        &mut self,
        ui: &egui::Ui,
        spans: &[VerseSpan],
        text_width: f32,
        font: f32,
        palette: &UiPalette,
    ) -> VerseLayout {
        let key = verse_layout_key(spans, text_width, font, palette);
        if let Some(hit) = self.reading.verse_layouts.get(&key) {
            return hit.clone();
        }
        #[cfg(test)]
        {
            self.reading.verse_layouts_built += 1;
        }
        let layout = verse_layout(ui, spans, text_width, font, palette);
        if self.reading.verse_layouts.len() >= 180 && !self.reading.verse_layouts.contains_key(&key)
        {
            self.reading.verse_layouts.clear();
        }
        self.reading.verse_layouts.insert(key, layout.clone());
        layout
    }

    fn measure_verse_height(
        &mut self,
        ui: &egui::Ui,
        spans: &[VerseSpan],
        text_width: f32,
        font: f32,
        palette: &UiPalette,
        has_refs: bool,
    ) -> f32 {
        let layout = self.verse_row_layout(ui, spans, text_width, font, palette);
        row_height_from_galley(layout.galley.rect.height(), font, has_refs)
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
        let layout = self.verse_row_layout(ui, spans, text_width, font, palette);
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
                    paint::hover_tip(response.clone(), format!("{code}: {meaning}"));
                }
            }
        }
        if response.clicked() {
            ui.ctx().memory_mut(|mem| mem.stop_text_input());
            if let Some(plugin) = ui
                .ctx()
                .plugin_opt::<egui::text_selection::LabelSelectionState>()
            {
                plugin.lock().clear_selection();
            }
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
        paint: &CommentaryPaint,
        width: f32,
        font: f32,
        text_color: egui::Color32,
        link_color: egui::Color32,
    ) {
        let width_px = width.round() as i32;
        // Reflowing a whole commentary on every pixel of a sidebar or split drag
        // stalls the frame. Keep the last wrap until the pointer is up and the
        // width has stayed put for a frame.
        let pointer_down = ui.input(|input| input.pointer.primary_down());
        let cached = self.reading.commentary_galley(
            pane_id,
            paint.fingerprint,
            width_px,
            font,
            text_color,
            link_color,
            pointer_down,
        );
        let (galley, links) = if let Some(cached) = cached {
            cached
        } else {
            #[cfg(test)]
            {
                self.reading.commentary_layouts += 1;
            }
            let (galley, links) =
                commentary_layout(ui, &paint.pieces, width, font, text_color, link_color);
            let links = Arc::new(links);
            self.reading.store_commentary_galley(
                pane_id,
                GalleyKey::new(paint.fingerprint, width_px, font, text_color, link_color),
                Arc::clone(&galley),
                Arc::clone(&links),
            );
            (galley, links)
        };
        // Dragging the text selects it. Reuse the shaped galley so a selection
        // or a wheel step does not wrap the chapter again.
        let selecting =
            ui.input(|input| input.pointer.primary_down()) || label_has_selection(ui.ctx());
        let response = if selecting {
            ui.add(egui::Label::new(Arc::clone(&galley)).selectable(true))
        } else {
            let (rect, response) = ui.allocate_exact_size(
                egui::vec2(width, galley.rect.height().max(1.0)),
                egui::Sense::click(),
            );
            ui.painter()
                .galley(rect.min, Arc::clone(&galley), text_color);
            response
        };
        let rect = response.rect;
        #[cfg(test)]
        crate::chrome::mark_layout(ui, &format!("commentary-text:{pane_id}"), rect);
        if let Some(verse) = self.session.commentary_scroll_verse(pane_id) {
            if let Some(index) = anchor_for_verse(&paint.anchors, verse) {
                let local = galley.pos_from_cursor(egui::text::CCursor::new(index));
                ui.scroll_to_rect(local.translate(rect.min.to_vec2()), Some(egui::Align::TOP));
                self.session.clear_commentary_scroll(pane_id);
            } else if !paint.pieces.is_empty() {
                self.session.clear_commentary_scroll(pane_id);
            }
        }
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

struct SplitGesture {
    delta: f32,
    stopped: bool,
}

/// Hairline on the shared edge, with a grab strip that does not reserve a gutter.
/// `vertical` is a left/right divider. The returned delta is in pixels along the drag.
fn split_handle(
    ui: &egui::Ui,
    origin: egui::Pos2,
    span: f32,
    at: f32,
    vertical: bool,
    palette: &UiPalette,
    path: &str,
) -> SplitGesture {
    let line = if vertical {
        egui::Rect::from_min_size(
            egui::pos2(origin.x + at - 0.5, origin.y),
            egui::vec2(1.0, span),
        )
    } else {
        egui::Rect::from_min_size(
            egui::pos2(origin.x, origin.y + at - 0.5),
            egui::vec2(span, 1.0),
        )
    };
    let hit = if vertical {
        line.expand2(egui::vec2(SPLIT_HIT * 0.5, 0.0))
    } else {
        line.expand2(egui::vec2(0.0, SPLIT_HIT * 0.5))
    };
    let response = ui.interact(
        hit,
        egui::Id::new(("split-handle", path)),
        egui::Sense::drag(),
    );
    let cursor = if vertical {
        egui::CursorIcon::ResizeHorizontal
    } else {
        egui::CursorIcon::ResizeVertical
    };
    if response.hovered() || response.dragged() {
        ui.ctx().set_cursor_icon(cursor);
    }
    let color = if response.hovered() || response.dragged() {
        palette.ui_text_subtle
    } else {
        palette.ui_border
    };
    let mid = if vertical {
        [line.center_top(), line.center_bottom()]
    } else {
        [line.left_center(), line.right_center()]
    };
    ui.painter()
        .line_segment(mid, egui::Stroke::new(1.0_f32, paint::color(color)));
    #[cfg(test)]
    {
        crate::chrome::mark_layout(ui, "split-rule", line);
        let axis = if vertical { "x" } else { "y" };
        crate::chrome::mark_layout(ui, &format!("split-handle:{axis}:{path}"), hit);
    }
    let delta = if response.dragged() {
        if vertical {
            response.drag_delta().x
        } else {
            response.drag_delta().y
        }
    } else {
        0.0
    };
    SplitGesture {
        delta,
        stopped: response.drag_stopped(),
    }
}

fn child_path(path: &str, index: usize) -> String {
    if path.is_empty() {
        index.to_string()
    } else {
        format!("{path}/{index}")
    }
}

/// Each side keeps enough room for a toolbar. The saved ratio stays inside 0.1–0.9.
fn split_ratio_limits(span: f32, min_px: f32) -> (f32, f32) {
    if !span.is_finite() || span <= 1.0 {
        return (0.5, 0.5);
    }
    let min_ratio = (min_px / span).clamp(0.1, 0.5);
    let max_ratio = (1.0 - min_px / span).clamp(0.5, 0.9);
    if min_ratio > max_ratio {
        (0.5, 0.5)
    } else {
        (min_ratio, max_ratio)
    }
}

fn clamp_split_ratio(ratio: f32, span: f32, min_px: f32) -> f32 {
    let ratio = if ratio.is_finite() { ratio } else { 0.5 };
    let (min_ratio, max_ratio) = split_ratio_limits(span, min_px);
    ratio.clamp(min_ratio, max_ratio)
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

fn label_has_selection(ctx: &egui::Context) -> bool {
    ctx.plugin_opt::<egui::text_selection::LabelSelectionState>()
        .is_some_and(|plugin| plugin.lock().has_selection())
}

/// Grab strip centered on the hairline. It overlaps both panes and does not open a gap.
const SPLIT_HIT: f32 = 6.0;
const SPLIT_MIN_WIDTH: f32 = 168.0;
const SPLIT_MIN_HEIGHT: f32 = 88.0;

/// Space around the bible list so the first and last verse can scroll clear of the pane edge.
const BIBLE_PAD_LEFT: f32 = 8.0;
const BIBLE_PAD_RIGHT: f32 = 24.0;
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
    pub(crate) pieces: Arc<Vec<CommentaryPiece>>,
    fingerprint: u64,
    /// `(verse_from, verse_to, char index)` so a Bible verse can scroll this chapter.
    anchors: Arc<Vec<(i64, i64, usize)>>,
}

impl CommentaryPaint {
    pub(crate) fn new(pieces: impl Into<Arc<Vec<CommentaryPiece>>>) -> Self {
        let pieces = pieces.into();
        let fingerprint = pieces_fingerprint(&pieces);
        Self {
            pieces,
            fingerprint,
            anchors: Arc::new(Vec::new()),
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Hash)]
struct GalleyKey {
    fingerprint: u64,
    width: i32,
    font_bits: u32,
    text: u32,
    link: u32,
}

impl GalleyKey {
    fn new(
        fingerprint: u64,
        width: i32,
        font: f32,
        text: egui::Color32,
        link: egui::Color32,
    ) -> Self {
        Self {
            fingerprint,
            width,
            font_bits: font.to_bits(),
            text: color_key(text),
            link: color_key(link),
        }
    }

    fn same_style(self, other: Self) -> bool {
        self.fingerprint == other.fingerprint
            && self.font_bits == other.font_bits
            && self.text == other.text
            && self.link == other.link
    }
}

fn color_key(color: egui::Color32) -> u32 {
    u32::from_le_bytes(color.to_array())
}

struct CommentaryGalley {
    galley: Arc<egui::Galley>,
    links: Arc<Vec<LinkHit>>,
}

#[derive(Clone, Copy)]
struct PaneGalleyState {
    key: GalleyKey,
    seen_width: i32,
}

#[derive(Clone, Copy)]
struct PaneHeightState {
    key: u64,
    painted_width: i32,
    seen_width: i32,
}

#[derive(Clone)]
pub(crate) enum CommentaryPiece {
    Text(String),
    Rich {
        text: String,
        italic: bool,
        bold: bool,
    },
    Heading(String),
    Break,
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

#[derive(Clone)]
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
    commentary_galleys: HashMap<GalleyKey, CommentaryGalley>,
    pane_galleys: HashMap<String, PaneGalleyState>,
    coverage: HashMap<PathBuf, Arc<HashMap<i64, Vec<i64>>>>,
    /// Row heights kept by chapter and width, so switching studies does not measure again.
    heights: HashMap<(u64, i32), Vec<f32>>,
    pane_heights: HashMap<String, PaneHeightState>,
    verse_text: HashMap<String, Vec<(i64, String)>>,
    /// Shaped verse lines. Scrolling paints these again instead of wrapping the words.
    verse_layouts: HashMap<u64, VerseLayout>,
    #[cfg(test)]
    pub(crate) rows_painted: usize,
    #[cfg(test)]
    pub(crate) verse_layouts_built: u32,
    #[cfg(test)]
    pub(crate) commentary_layouts: u32,
    #[cfg(test)]
    pub(crate) chapter_measures: u32,
}

impl ReadingCache {
    pub(crate) fn new() -> Self {
        Self {
            chapters: HashMap::new(),
            xrefs: HashMap::new(),
            commentary: HashMap::new(),
            commentary_galleys: HashMap::new(),
            pane_galleys: HashMap::new(),
            coverage: HashMap::new(),
            heights: HashMap::new(),
            pane_heights: HashMap::new(),
            verse_text: HashMap::new(),
            verse_layouts: HashMap::new(),
            #[cfg(test)]
            rows_painted: 0,
            #[cfg(test)]
            verse_layouts_built: 0,
            #[cfg(test)]
            commentary_layouts: 0,
            #[cfg(test)]
            chapter_measures: 0,
        }
    }

    pub(crate) fn clear(&mut self) {
        self.chapters.clear();
        self.xrefs.clear();
        self.commentary.clear();
        self.commentary_galleys.clear();
        self.pane_galleys.clear();
        self.coverage.clear();
        self.heights.clear();
        self.pane_heights.clear();
        self.verse_text.clear();
        self.verse_layouts.clear();
    }

    pub(crate) fn cached_verse_text(&self, key: &str) -> Option<Vec<(i64, String)>> {
        self.verse_text.get(key).cloned()
    }

    pub(crate) fn remember_verse_text(&mut self, key: String, verses: Vec<(i64, String)>) {
        if self.verse_text.len() >= 32 && !self.verse_text.contains_key(&key) {
            self.verse_text.clear();
        }
        self.verse_text.insert(key, verses);
    }

    /// A galley already wrapped for this commentary. Other studies stay in the map,
    /// and a drag reuses the last wrap until the button is up and the width has settled.
    fn commentary_galley(
        &mut self,
        pane_id: &str,
        fingerprint: u64,
        width: i32,
        font: f32,
        text: egui::Color32,
        link: egui::Color32,
        pointer_down: bool,
    ) -> Option<(Arc<egui::Galley>, Arc<Vec<LinkHit>>)> {
        let want = GalleyKey::new(fingerprint, width, font, text, link);
        let state = self.pane_galleys.get(pane_id).copied();
        let width_changed =
            state.is_some_and(|state| state.key.same_style(want) && state.seen_width != width);
        if let Some(hit) = self.commentary_galleys.get(&want) {
            self.pane_galleys.insert(
                pane_id.to_string(),
                PaneGalleyState {
                    key: want,
                    seen_width: width,
                },
            );
            return Some((Arc::clone(&hit.galley), Arc::clone(&hit.links)));
        }
        if pointer_down || width_changed {
            if let Some(state) = state.filter(|state| state.key.same_style(want)) {
                if let Some(hit) = self.commentary_galleys.get(&state.key) {
                    self.pane_galleys.insert(
                        pane_id.to_string(),
                        PaneGalleyState {
                            key: state.key,
                            seen_width: width,
                        },
                    );
                    return Some((Arc::clone(&hit.galley), Arc::clone(&hit.links)));
                }
            }
        }
        None
    }

    fn store_commentary_galley(
        &mut self,
        pane_id: &str,
        key: GalleyKey,
        galley: Arc<egui::Galley>,
        links: Arc<Vec<LinkHit>>,
    ) {
        if self.commentary_galleys.len() >= 12 && !self.commentary_galleys.contains_key(&key) {
            if let Some(old) = self.commentary_galleys.keys().next().copied() {
                self.commentary_galleys.remove(&old);
            }
        }
        self.commentary_galleys
            .insert(key, CommentaryGalley { galley, links });
        self.pane_galleys.insert(
            pane_id.to_string(),
            PaneGalleyState {
                key,
                seen_width: key.width,
            },
        );
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
        if self.chapters.len() >= 32 {
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

    #[cfg(test)]
    pub(crate) fn insert_cross_refs(
        &mut self,
        book: i64,
        chapter: i64,
        module_ids: &str,
        grouped: HashMap<i64, Vec<CrossReference>>,
    ) {
        let key = format!("{book}:{chapter}:{module_ids}");
        self.xrefs.insert(key, Arc::new(grouped));
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
        if self.xrefs.len() >= 16 {
            self.xrefs.clear();
        }
        self.xrefs.insert(key, Arc::clone(&grouped));
        grouped
    }

    pub(crate) fn coverage_map(&mut self, path: &Path) -> Arc<HashMap<i64, Vec<i64>>> {
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

    fn prepare_heights(
        &mut self,
        pane_id: &str,
        key: u64,
        width: i32,
        len: usize,
        pointer_down: bool,
    ) -> Option<HeldRows> {
        let state = self.pane_heights.get(pane_id).copied();
        let width_changed =
            state.is_some_and(|state| state.key == key && state.seen_width != width);
        if let Some(heights) = self
            .heights
            .get(&(key, width))
            .filter(|heights| heights.len() == len)
            .cloned()
        {
            self.pane_heights.insert(
                pane_id.to_string(),
                PaneHeightState {
                    key,
                    painted_width: width,
                    seen_width: width,
                },
            );
            return Some(HeldRows {
                heights,
                provisional: false,
            });
        }
        if pointer_down || width_changed {
            let fallback = self
                .heights
                .iter()
                .find(|((stored, _), heights)| *stored == key && heights.len() == len)
                .map(|((_, painted), heights)| (*painted, heights.clone()));
            if let Some((painted_width, heights)) = fallback {
                self.pane_heights.insert(
                    pane_id.to_string(),
                    PaneHeightState {
                        key,
                        painted_width,
                        seen_width: width,
                    },
                );
                return Some(HeldRows {
                    heights,
                    provisional: true,
                });
            }
        }
        None
    }

    fn set_heights(&mut self, pane_id: &str, key: u64, width: i32, heights: Vec<f32>) {
        if self.heights.len() >= 24 && !self.heights.contains_key(&(key, width)) {
            if let Some(old) = self.heights.keys().next().copied() {
                self.heights.remove(&old);
            }
        }
        self.heights.insert((key, width), heights);
        self.pane_heights.insert(
            pane_id.to_string(),
            PaneHeightState {
                key,
                painted_width: width,
                seen_width: width,
            },
        );
    }

    fn update_height(&mut self, pane_id: &str, index: usize, height: f32) -> bool {
        let Some(state) = self.pane_heights.get(pane_id).copied() else {
            return false;
        };
        let Some(row) = self
            .heights
            .get_mut(&(state.key, state.painted_width))
            .and_then(|heights| heights.get_mut(index))
        else {
            return false;
        };
        if (*row - height).abs() <= 1.0 {
            return false;
        }
        *row = height;
        true
    }
}

struct HeldRows {
    heights: Vec<f32>,
    provisional: bool,
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

/// Canon order, then chapter and verse. The same target is shown once.
fn order_cross_refs(refs: &mut Vec<CrossReference>) {
    refs.sort_by_key(|reference| {
        let canon = graphe_domain::books::graphe_to_tw_book(reference.book_to);
        let canon = if canon < 0 { i64::MAX } else { canon };
        (
            canon,
            reference.chapter_to,
            reference.verse_to_start.unwrap_or(0),
        )
    });
    refs.dedup_by(|a, b| {
        a.book_to == b.book_to
            && a.chapter_to == b.chapter_to
            && a.verse_to_start == b.verse_to_start
    });
}

fn content_layout_key(fingerprint: u64, font: f32, xref_key: &str) -> u64 {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    fingerprint.hash(&mut hasher);
    font.to_bits().hash(&mut hasher);
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

fn pieces_fingerprint(pieces: &[CommentaryPiece]) -> u64 {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    pieces.len().hash(&mut hasher);
    for piece in pieces {
        match piece {
            CommentaryPiece::Text(text) => {
                0u8.hash(&mut hasher);
                text.hash(&mut hasher);
            }
            CommentaryPiece::Rich { text, italic, bold } => {
                2u8.hash(&mut hasher);
                text.hash(&mut hasher);
                italic.hash(&mut hasher);
                bold.hash(&mut hasher);
            }
            CommentaryPiece::Heading(text) => {
                3u8.hash(&mut hasher);
                text.hash(&mut hasher);
            }
            CommentaryPiece::Break => {
                4u8.hash(&mut hasher);
            }
            CommentaryPiece::Link {
                label,
                book,
                chapter,
                verse,
            } => {
                1u8.hash(&mut hasher);
                label.hash(&mut hasher);
                book.hash(&mut hasher);
                chapter.hash(&mut hasher);
                verse.hash(&mut hasher);
            }
        }
    }
    hasher.finish()
}

fn commentary_plain(text: &str) -> String {
    graphe_domain::commentary_html::plain_text(text)
}

fn anchor_for_verse(anchors: &[(i64, i64, usize)], verse: i64) -> Option<usize> {
    anchors
        .iter()
        .filter(|(from, to, _)| verse >= *from && verse <= *to)
        .min_by_key(|(from, to, _)| to - from)
        .map(|(_, _, index)| *index)
}

fn pieces_from_entries(
    entries: &[graphe_domain::model::CommentaryEntry],
    matcher: &graphe_domain::commentary_ref::ReferenceMatcher,
    chapter: i64,
) -> (Vec<CommentaryPiece>, Vec<(i64, i64, usize)>) {
    let mut pieces = Vec::new();
    let mut anchors = Vec::new();
    let mut chars = 0usize;
    for entry in entries {
        if !pieces.is_empty() {
            pieces.push(CommentaryPiece::Break);
            pieces.push(CommentaryPiece::Break);
            chars += 2;
        }
        let end = entry.verse_to.unwrap_or(entry.verse_from);
        anchors.push((entry.verse_from, end, chars));
        let heading = if end > entry.verse_from {
            format!("{}-{end}", entry.verse_from)
        } else {
            entry.verse_from.to_string()
        };
        chars += heading.chars().count();
        pieces.push(CommentaryPiece::Heading(heading));
        pieces.push(CommentaryPiece::Break);
        chars += 1;
        let runs =
            graphe_domain::commentary_html::render_commentary_html(&entry.text, Some(matcher));
        let mut at_break = true;
        for run in runs {
            match run {
                graphe_domain::commentary_html::CommentaryRun::Break => {
                    pieces.push(CommentaryPiece::Break);
                    chars += 1;
                    at_break = true;
                }
                graphe_domain::commentary_html::CommentaryRun::Text { text, italic, bold } => {
                    if at_break {
                        note_body_anchor(&text, chars, chapter, &mut anchors);
                    }
                    at_break = false;
                    chars += text.chars().count();
                    if italic || bold {
                        pieces.push(CommentaryPiece::Rich { text, italic, bold });
                    } else {
                        pieces.push(CommentaryPiece::Text(text));
                    }
                }
                graphe_domain::commentary_html::CommentaryRun::Link {
                    label,
                    book,
                    chapter,
                    verse,
                    ..
                } => {
                    at_break = false;
                    chars += label.chars().count();
                    pieces.push(CommentaryPiece::Link {
                        label,
                        book,
                        chapter,
                        verse,
                    });
                }
            }
        }
    }
    (pieces, anchors)
}

fn note_body_anchor(text: &str, chars: usize, chapter: i64, anchors: &mut Vec<(i64, i64, usize)>) {
    let Some(leading) =
        graphe_domain::commentary_ref::parse_leading_reference_from_plain_text(Some(text))
    else {
        return;
    };
    if leading.chapter != chapter {
        return;
    }
    anchors.push((leading.verse_from, leading.verse_to, chars));
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
    push_chars_leading(job, chars, text, 0.0, format);
}

fn push_chars_leading(
    job: &mut egui::text::LayoutJob,
    chars: &mut usize,
    text: &str,
    leading: f32,
    format: egui::TextFormat,
) {
    if text.is_empty() {
        return;
    }
    let shown = graphe_domain::bidi::display_text(text);
    *chars += shown.chars().count();
    job.append(shown.as_ref(), leading, format);
}

fn verse_layout_key(spans: &[VerseSpan], text_width: f32, font: f32, palette: &UiPalette) -> u64 {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    (text_width.round() as i32).hash(&mut hasher);
    font.to_bits().hash(&mut hasher);
    palette.ui_text.hash(&mut hasher);
    palette.ui_text_subtle.hash(&mut hasher);
    palette.ui_text_muted.hash(&mut hasher);
    for span in spans {
        match span {
            VerseSpan::Text(text) => {
                0u8.hash(&mut hasher);
                text.hash(&mut hasher);
            }
            VerseSpan::Strong {
                display,
                morph,
                lemma,
            } => {
                1u8.hash(&mut hasher);
                display.hash(&mut hasher);
                morph.hash(&mut hasher);
                lemma.hash(&mut hasher);
            }
            VerseSpan::Annotation {
                original,
                transliteration,
                pronunciation,
                glosses,
                references,
            } => {
                2u8.hash(&mut hasher);
                original.hash(&mut hasher);
                transliteration.hash(&mut hasher);
                pronunciation.hash(&mut hasher);
                glosses.hash(&mut hasher);
                references.hash(&mut hasher);
            }
            VerseSpan::Footnote(note) => {
                3u8.hash(&mut hasher);
                note.hash(&mut hasher);
            }
        }
    }
    hasher.finish()
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
    // Electron `.strongs` is 0.5em, raised, with 2px on the left and a word space after.
    let mut body = text_format(font, paint::color(palette.ui_text));
    body.extra_letter_spacing = 0.45;
    let mut strong_fmt = text_format(font * 0.5, paint::color(palette.ui_text_subtle));
    strong_fmt.valign = egui::Align::TOP;
    let note_fmt = text_format(font * 0.72, paint::color(palette.ui_text_muted));
    for (index, span) in spans.iter().enumerate() {
        match span {
            VerseSpan::Text(text) => {
                push_chars(&mut job, &mut chars, text, body.clone());
            }
            VerseSpan::Strong {
                display,
                morph,
                lemma,
            } => {
                if display.is_empty() {
                    continue;
                }
                let start = chars;
                chars += display.chars().count();
                job.append(display, 2.0, strong_fmt.clone());
                strongs.push(StrongHit {
                    start,
                    end: chars,
                    display: display.clone(),
                    morph: morph.clone(),
                    lemma: lemma.clone(),
                });
                if gap_after_strong(spans.get(index + 1)) {
                    // A little more than one word space, on the right of the number.
                    push_chars_leading(&mut job, &mut chars, " ", 3.0, body.clone());
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

/// A word follows the number. Another number, or punctuation, stays closer: `G4228.`
fn gap_after_strong(next: Option<&VerseSpan>) -> bool {
    match next {
        Some(VerseSpan::Text(text)) => text.chars().next().is_some_and(|ch| ch.is_alphanumeric()),
        _ => false,
    }
}

fn row_height_from_galley(layout_height: f32, font: f32, has_refs: bool) -> f32 {
    let text = layout_height.max(font * 0.8) + 8.0;
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
    let mut heading = text_format(font * 0.85, link_color);
    heading.extra_letter_spacing = 0.2;
    for piece in pieces {
        match piece {
            CommentaryPiece::Break => push_chars(&mut job, &mut chars, "\n", body.clone()),
            CommentaryPiece::Heading(text) => {
                push_chars(&mut job, &mut chars, text, heading.clone())
            }
            CommentaryPiece::Text(text) => push_chars(&mut job, &mut chars, text, body.clone()),
            CommentaryPiece::Rich { text, italic, .. } => {
                let mut format = body.clone();
                format.italics = *italic;
                push_chars(&mut job, &mut chars, text, format);
            }
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
    use super::{
        anchor_for_verse, pieces_from_entries, rows_prefix, verse_layout, visible_row_span,
        CommentaryPiece, VerseSpan,
    };

    #[test]
    fn switching_back_to_a_chapter_reuses_its_row_heights() {
        let mut cache = super::ReadingCache::new();
        cache.set_heights("pane-1", 11, 400, vec![10.0, 20.0]);
        cache.set_heights("pane-1", 22, 400, vec![30.0]);
        let first = cache
            .prepare_heights("pane-1", 11, 400, 2, false)
            .expect("the first study is still measured");
        assert!(!first.provisional);
        assert_eq!(first.heights, vec![10.0, 20.0]);
        let second = cache
            .prepare_heights("pane-1", 22, 400, 1, false)
            .expect("the second study is still measured");
        assert_eq!(second.heights, vec![30.0]);
    }

    #[test]
    fn split_limits_keep_a_readable_pane_inside_the_saved_range() {
        let (min_ratio, max_ratio) = super::split_ratio_limits(1000.0, 160.0);
        assert!((min_ratio - 0.16).abs() < 1e-4);
        assert!((max_ratio - 0.84).abs() < 1e-4);
        let (tight_min, tight_max) = super::split_ratio_limits(200.0, 160.0);
        assert!((tight_min - 0.5).abs() < 1e-4);
        assert!((tight_max - 0.5).abs() < 1e-4);
        assert!((super::clamp_split_ratio(0.02, 1000.0, 160.0) - 0.16).abs() < 1e-4);
        assert!((super::clamp_split_ratio(0.95, 1000.0, 160.0) - 0.84).abs() < 1e-4);
    }

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

    #[test]
    fn cross_references_follow_bible_order_without_duplicates() {
        let mut refs = vec![
            xref(650, 7, 27),
            xref(20, 29, 38),
            xref(40, 28, 24),
            xref(40, 28, 3),
            xref(20, 29, 38),
            xref(470, 1, 1),
        ];
        super::order_cross_refs(&mut refs);
        let order: Vec<_> = refs
            .iter()
            .map(|reference| {
                (
                    reference.book_to,
                    reference.chapter_to,
                    reference.verse_to_start,
                )
            })
            .collect();
        assert_eq!(
            order,
            vec![
                (20, 29, Some(38)),
                (40, 28, Some(3)),
                (40, 28, Some(24)),
                (470, 1, Some(1)),
                (650, 7, Some(27)),
            ]
        );
    }

    fn xref(book: i64, chapter: i64, verse: i64) -> super::CrossReference {
        super::CrossReference {
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
    fn commentary_html_becomes_text_and_a_bible_link() {
        let matcher = graphe_domain::commentary_ref::build_reference_matcher(&[], &[]);
        let entries = vec![graphe_domain::model::CommentaryEntry {
            verse_from: 1,
            verse_to: Some(1),
            chapter_to: None,
            text: "<p><strong>Capítulo</strong> <em>Dez</em> <a class='bible' href='B:10 10:1'>Gênesis 10.1</a></p>".into(),
        }];
        let (pieces, anchors) = pieces_from_entries(&entries, &matcher, 10);
        let dumped: String = pieces
            .iter()
            .map(|piece| match piece {
                CommentaryPiece::Text(text)
                | CommentaryPiece::Heading(text)
                | CommentaryPiece::Rich { text, .. } => text.clone(),
                CommentaryPiece::Link { label, .. } => label.clone(),
                CommentaryPiece::Break => "\n".into(),
            })
            .collect();
        assert!(!dumped.contains('<'), "{dumped}");
        assert!(pieces.iter().any(|piece| matches!(
            piece,
            CommentaryPiece::Link {
                book: 10,
                chapter: 10,
                verse: Some(1),
                ..
            }
        )));
        assert_eq!(anchor_for_verse(&anchors, 1), Some(0));
    }

    #[test]
    fn strong_number_keeps_a_word_space_before_the_next_word() {
        let ctx = egui::Context::default();
        let _ = ctx.run(egui::RawInput::default(), |ctx| {
            egui::CentralPanel::default().show(ctx, |ui| {
                let spans = vec![
                    VerseSpan::Text("diante".into()),
                    strong("G3588"),
                    strong("G3063"),
                    VerseSpan::Text("esperando".into()),
                    strong("G4228"),
                    VerseSpan::Text(".".into()),
                ];
                let palette = graphe_domain::theme::palette(false);
                let layout = verse_layout(ui, &spans, 480.0, 18.0, &palette);
                assert_eq!(layout.galley.job.text, "dianteG3588G3063 esperandoG4228.");
                let strong = layout
                    .galley
                    .job
                    .sections
                    .iter()
                    .find(|section| section.format.font_id.size < 18.0)
                    .expect("a strong number");
                assert_eq!(strong.format.valign, egui::Align::TOP);
                assert!((strong.format.font_id.size - 9.0).abs() < 0.1);
                let word_y = glyph_y(&layout.galley, 'd');
                let number_y = glyph_y(&layout.galley, 'G');
                assert!(
                    number_y + 1.0 < word_y,
                    "the number sits above the word: number {number_y} word {word_y}"
                );
            });
        });
    }

    fn strong(display: &str) -> VerseSpan {
        VerseSpan::Strong {
            display: display.into(),
            morph: None,
            lemma: None,
        }
    }

    fn glyph_y(galley: &egui::Galley, ch: char) -> f32 {
        for row in &galley.rows {
            for glyph in &row.glyphs {
                if glyph.chr == ch {
                    return glyph.pos.y;
                }
            }
        }
        panic!("missing {ch}");
    }
}
