//! Top strip, workspace tabs, and the pane toolbar.
//!
//! The layout follows the Electron workbench: a centered reference field,
//! study tabs beside the sidebar, and a pane strip that shows the module,
//! the previous chapter, the current chapter, and the next chapter.

use crate::app::GrapheApp;
use crate::paint::{self, Icon};
use crate::session::Dialog;
use graphe_domain::i18n;
use graphe_domain::model::PaneType;
use graphe_domain::panes::{
    adjacent_chapter, get_pane_display_label, has_nav_back_history, has_nav_forward_history,
    push_nav_history_entry,
};
use graphe_domain::theme::UiPalette;

const STRIP_HEIGHT: f32 = 35.0;
const TAB_HEIGHT: f32 = 33.0;
const TOOLBAR_HEIGHT: f32 = 44.0;

impl GrapheApp {
    pub(crate) fn update_banner(&mut self, ctx: &egui::Context, palette: &UiPalette) {
        let version = self
            .update_notice
            .lock()
            .ok()
            .and_then(|notice| notice.clone());
        let Some(version) = version else {
            return;
        };
        egui::TopBottomPanel::top("update-banner")
            .exact_height(28.0)
            .frame(
                egui::Frame::new()
                    .fill(paint::color(palette.ui_link))
                    .inner_margin(egui::Margin::symmetric(12, 4)),
            )
            .show(ctx, |ui| {
                ui.label(
                    egui::RichText::new(i18n::t_fmt(
                        "updateAvailable",
                        &[("version", version.as_str())],
                    ))
                    .size(12.0)
                    .color(egui::Color32::WHITE),
                );
            });
    }

    pub(crate) fn top_strip(&mut self, ctx: &egui::Context, palette: &UiPalette) {
        let bg = paint::top_strip_bg(self.session.dark, palette);
        let border = if self.session.dark {
            "#2b2b2b"
        } else {
            palette.ui_border
        };
        egui::TopBottomPanel::top("command")
            .exact_height(34.0)
            .frame(egui::Frame::new().fill(bg).inner_margin(egui::Margin::ZERO))
            .show(ctx, |ui| {
                let rect = ui.max_rect();
                ui.painter().line_segment(
                    [rect.left_bottom(), rect.right_bottom()],
                    egui::Stroke::new(1.0_f32, paint::color(border)),
                );
                self.brand_mark(ui, rect, palette);
                self.reference_field(ui, rect, palette);
                self.about_button(ui, rect, palette);
            });
    }

    fn brand_mark(&mut self, ui: &mut egui::Ui, rect: egui::Rect, palette: &UiPalette) {
        let image_rect = egui::Rect::from_center_size(
            egui::pos2(rect.left() + 17.0, rect.center().y),
            egui::vec2(18.0, 18.0),
        );
        if self.mark.is_none() {
            if let Ok(icon) = eframe::icon_data::from_png_bytes(crate::icon::mark_png()) {
                let image = egui::ColorImage::from_rgba_unmultiplied(
                    [icon.width as usize, icon.height as usize],
                    &icon.rgba,
                );
                self.mark = Some(ui.ctx().load_texture(
                    "graphe-mark",
                    image,
                    egui::TextureOptions::LINEAR,
                ));
            }
        }
        if let Some(mark) = &self.mark {
            ui.painter().image(
                mark.id(),
                image_rect,
                egui::Rect::from_min_max(egui::pos2(0.0, 0.0), egui::pos2(1.0, 1.0)),
                egui::Color32::WHITE,
            );
        }
        let ink = paint::color(palette.ui_text);
        let galley =
            egui::WidgetText::from(egui::RichText::new("Graphe").strong().size(12.0).color(ink))
                .into_galley(
                    ui,
                    Some(egui::TextWrapMode::Extend),
                    120.0,
                    egui::FontSelection::default(),
                );
        ui.painter().galley(
            egui::pos2(
                image_rect.right() + 7.0,
                rect.center().y - galley.rect.height() / 2.0,
            ),
            galley,
            ink,
        );
    }

    fn reference_field(&mut self, ui: &mut egui::Ui, rect: egui::Rect, palette: &UiPalette) {
        let search_w = (rect.width() * 0.42)
            .clamp(120.0, 520.0)
            .min((rect.width() - 220.0).max(80.0));
        let search = egui::Rect::from_center_size(rect.center(), egui::vec2(search_w, 24.0));
        let response = ui.interact(search, ui.id().with("nav-search"), egui::Sense::click());
        let fill = if self.session.dark {
            paint::color("#2b2b2b")
        } else {
            paint::color(palette.ui_surface)
        };
        let stroke = if self.session.dark {
            paint::color("#3a3a3a")
        } else {
            paint::color(palette.ui_border)
        };
        if response.hovered() {
            ui.painter()
                .rect_filled(search, 4.0, paint::color(palette.ui_surface_elevated));
        }
        ui.painter().rect_stroke(
            search,
            4.0,
            egui::Stroke::new(1.0_f32, stroke),
            egui::StrokeKind::Inside,
        );
        if !response.hovered() {
            ui.painter().rect_filled(search.shrink(1.0), 3.0, fill);
        }
        paint::draw_icon(
            ui.painter(),
            egui::pos2(search.left() + 16.0, search.center().y),
            paint::color(palette.ui_text_subtle),
            Icon::Search,
        );
        let galley = egui::WidgetText::from(
            egui::RichText::new(i18n::t("navPlaceholder"))
                .size(12.0)
                .color(paint::color(palette.ui_text_subtle)),
        )
        .into_galley(
            ui,
            Some(egui::TextWrapMode::Truncate),
            (search.width() - 36.0).max(8.0),
            egui::FontSelection::default(),
        );
        ui.painter().galley(
            egui::pos2(
                search.left() + 28.0,
                search.center().y - galley.rect.height() / 2.0,
            ),
            galley,
            paint::color(palette.ui_text_subtle),
        );
        if response.hovered() {
            ui.ctx().set_cursor_icon(egui::CursorIcon::PointingHand);
        }
        if paint::hover_tip(response, "F3").clicked() {
            self.open_navigation();
        }
    }

    fn about_button(&mut self, ui: &mut egui::Ui, rect: egui::Rect, palette: &UiPalette) {
        let info = egui::Rect::from_center_size(
            egui::pos2(rect.right() - 21.0, rect.center().y),
            egui::vec2(26.0, 24.0),
        );
        let response = ui.interact(info, ui.id().with("about"), egui::Sense::click());
        if response.hovered() {
            ui.painter().rect_filled(
                info,
                3.0,
                paint::color_alpha(palette.ui_text, if self.session.dark { 28 } else { 18 }),
            );
            ui.ctx().set_cursor_icon(egui::CursorIcon::PointingHand);
        }
        paint::draw_icon(
            ui.painter(),
            info.center(),
            paint::color(if response.hovered() {
                palette.ui_text
            } else {
                palette.ui_text_subtle
            }),
            Icon::Info,
        );
        if paint::hover_tip(response, i18n::t("aboutTitle")).clicked() {
            self.session.dialog = Dialog::About;
        }
    }

    pub(crate) fn workspace_tabs(&mut self, ui: &mut egui::Ui, palette: &UiPalette) {
        let width = ui.available_width();
        let (rect, _) =
            ui.allocate_exact_size(egui::vec2(width, STRIP_HEIGHT), egui::Sense::hover());
        ui.painter()
            .rect_filled(rect, 0.0, paint::top_strip_bg(self.session.dark, palette));
        #[cfg(test)]
        mark_layout(ui, "workspace-tabs", rect);

        let tabs = self.session.workspaces.get_tab_state();
        let items = tabs.items.clone();
        let count = items.len();
        let gap = 2.0;
        let add_w = 28.0;
        let left = rect.left() + 8.0;
        let usable = (rect.width() - 16.0 - add_w).max(36.0);
        let raw = if count == 0 {
            0.0
        } else {
            (usable - gap * count.saturating_sub(1) as f32) / count as f32
        };
        let tab_w = raw.clamp(36.0, 150.0);
        let tab_y = rect.bottom() - TAB_HEIGHT;

        let mut activate: Option<String> = None;
        let mut close: Option<String> = None;
        let mut start_rename: Option<String> = None;
        let mut commit_rename = false;
        let mut cancel_rename = false;
        let renaming = self.renaming.clone();

        for (index, (id, name)) in items.iter().enumerate() {
            let tab_rect = egui::Rect::from_min_size(
                egui::pos2(left + index as f32 * (tab_w + gap), tab_y),
                egui::vec2(tab_w, TAB_HEIGHT),
            );
            if tab_rect.left() > rect.right() - add_w {
                break;
            }
            let active = tabs.active_workspace_id.as_deref() == Some(id.as_str());
            let tab_response = ui.interact(
                tab_rect,
                ui.id().with(("workspace", id)),
                egui::Sense::click(),
            );
            if active {
                ui.painter().rect_filled(
                    tab_rect,
                    egui::CornerRadius {
                        nw: 4,
                        ne: 4,
                        sw: 0,
                        se: 0,
                    },
                    paint::workspace_tab_active(self.session.dark),
                );
            } else if tab_response.hovered() {
                ui.painter().rect_filled(
                    tab_rect,
                    egui::CornerRadius {
                        nw: 4,
                        ne: 4,
                        sw: 0,
                        se: 0,
                    },
                    paint::color_alpha(palette.ui_text, 12),
                );
            }

            if renaming.as_deref() == Some(id.as_str()) {
                let edit_rect = tab_rect.shrink2(egui::vec2(6.0, 4.0));
                let response = ui.put(
                    edit_rect,
                    egui::TextEdit::singleline(&mut self.rename)
                        .font(egui::FontId::proportional(12.0))
                        .desired_width(edit_rect.width())
                        .margin(egui::Margin::symmetric(4, 0)),
                );
                if self.rename_focus {
                    response.request_focus();
                    self.rename_focus = false;
                }
                let escape = ui.input(|input| input.key_pressed(egui::Key::Escape));
                if response.lost_focus() {
                    if escape {
                        cancel_rename = true;
                    } else {
                        commit_rename = true;
                    }
                }
                continue;
            }

            let ink = paint::color(if active || tab_response.hovered() {
                palette.ui_text
            } else {
                palette.ui_text_subtle
            });
            let mut text = egui::RichText::new(name).size(12.0).color(ink);
            if active {
                text = text.strong();
            }
            let galley = egui::WidgetText::from(text).into_galley(
                ui,
                Some(egui::TextWrapMode::Truncate),
                (tab_w - 28.0).max(8.0),
                egui::FontSelection::default(),
            );
            ui.painter().galley(
                egui::pos2(
                    tab_rect.left() + 10.0,
                    tab_rect.center().y - galley.rect.height() / 2.0,
                ),
                galley,
                ink,
            );

            let close_rect = egui::Rect::from_center_size(
                egui::pos2(tab_rect.right() - 12.0, tab_rect.center().y),
                egui::vec2(16.0, 16.0),
            );
            let close_response = if count > 1 {
                Some(ui.interact(
                    close_rect,
                    ui.id().with(("workspace-close", id)),
                    egui::Sense::click(),
                ))
            } else {
                None
            };
            let show_close = close_response
                .as_ref()
                .is_some_and(|response| response.hovered() || tab_response.hovered());
            if show_close {
                paint::draw_icon(
                    ui.painter(),
                    close_rect.center(),
                    paint::color(
                        if close_response
                            .as_ref()
                            .is_some_and(|response| response.hovered())
                        {
                            palette.ui_text
                        } else {
                            palette.ui_text_subtle
                        },
                    ),
                    Icon::Close,
                );
            }
            if tab_response.hovered() {
                ui.ctx().set_cursor_icon(egui::CursorIcon::PointingHand);
            }
            if close_response
                .as_ref()
                .is_some_and(|response| response.clicked())
            {
                close = Some(id.clone());
            } else if tab_response.double_clicked() {
                start_rename = Some(id.clone());
            } else if tab_response.clicked() {
                activate = Some(id.clone());
            }
        }

        let add_rect = egui::Rect::from_min_size(
            egui::pos2(left + count as f32 * (tab_w + gap), tab_y + 2.0),
            egui::vec2(24.0, 24.0),
        );
        let add = ui.interact(
            add_rect,
            ui.id().with("workspace-add"),
            egui::Sense::click(),
        );
        paint::draw_icon(
            ui.painter(),
            add_rect.center(),
            paint::color(if add.hovered() {
                palette.ui_text
            } else {
                palette.ui_text_subtle
            }),
            Icon::Plus,
        );
        if add.hovered() {
            ui.ctx().set_cursor_icon(egui::CursorIcon::PointingHand);
        }
        let add_clicked = paint::hover_tip(add, i18n::t("workspaceNew")).clicked();

        if cancel_rename {
            self.renaming = None;
        } else if commit_rename {
            if let Some(id) = self.renaming.clone() {
                if self.session.workspaces.rename_workspace(&id, &self.rename) {
                    self.note_workspaces();
                }
            }
            self.renaming = None;
        }
        if let Some(id) = close {
            if self.session.close_workspace(&id) {
                self.loaded_key.clear();
                self.sync_active_chapter();
                self.note_workspaces();
            }
            if self.renaming.as_deref() == Some(id.as_str()) {
                self.renaming = None;
            }
        } else if let Some(id) = start_rename {
            self.rename = items
                .iter()
                .find(|(item_id, _)| item_id == &id)
                .map(|(_, item_name)| item_name.clone())
                .unwrap_or_default();
            self.renaming = Some(id);
            self.rename_focus = true;
        } else if let Some(id) = activate {
            if self.session.open_workspace(&id) {
                self.loaded_key.clear();
                self.sync_active_chapter();
                self.note_workspaces();
            }
        } else if add_clicked {
            self.session.new_workspace();
            self.loaded_key.clear();
            self.sync_active_chapter();
            self.note_workspaces();
        }
    }

    pub(crate) fn pane_toolbar(&mut self, ui: &mut egui::Ui, pane_id: &str, palette: &UiPalette) {
        let Some(pane) = self.session.panes.get(pane_id).cloned() else {
            return;
        };
        let active = self.session.active_pane_id == pane_id;
        let (book, chapter, verse) = self.session.reading_location(pane_id);
        let pane_width = ui.available_width();
        let bible = pane.pane_type == PaneType::Bible;
        let kind = pane.pane_type;
        let bg = paint::workspace_tab_active(self.session.dark);
        // A fixed strip. `with_layout` would inherit the whole pane and center the controls in it.
        let inner = ui.allocate_ui_with_layout(
            egui::vec2(pane_width, TOOLBAR_HEIGHT),
            egui::Layout::left_to_right(egui::Align::Center),
            |ui| {
                let rect = ui.max_rect();
                ui.painter().rect_filled(rect, 0.0, bg);
                ui.set_min_size(rect.size());
                ui.add_space(8.0);
                ui.spacing_mut().item_spacing.x = 4.0;
                // The letter mark hides once the pane is too narrow to keep the chapter group.
                if pane_width >= 420.0 {
                    self.pane_badge(ui, pane_id, palette);
                }
                self.module_combo(ui, pane_id, &kind, pane_width);
                if bible {
                    self.chapter_nav(ui, pane_id, book, chapter, pane_width, palette);
                } else {
                    self.place_label(ui, pane_id, book, chapter, palette);
                }
                // Icon slots, the gap egui inserts before each one, and 8px before the pane edge.
                let actions = if bible { 76.0 } else { 108.0 };
                let pad = (ui.available_width() - actions).max(0.0);
                let (_, pad_response) =
                    ui.allocate_exact_size(egui::vec2(pad, 28.0), egui::Sense::click());
                if pad_response.clicked() {
                    self.activate_pane(pane_id);
                }
                if bible {
                    self.pane_options(ui, pane_id, palette);
                } else {
                    self.commentary_toolbar_actions(ui, pane_id, book, chapter, verse, palette);
                }
                self.pane_close(ui, pane_id, palette);
                #[cfg(test)]
                mark_layout(ui, &format!("toolbar:{pane_id}"), rect);
            },
        );
        let rect = inner.response.rect;
        let border = if active {
            if self.session.dark {
                palette.ui_link_strong
            } else {
                palette.ui_border_strong
            }
        } else {
            palette.ui_border
        };
        ui.painter().line_segment(
            [rect.left_bottom(), rect.right_bottom()],
            egui::Stroke::new(1.0_f32, paint::color(border)),
        );
        if active {
            let bar = egui::Rect::from_min_size(
                egui::pos2(rect.left(), rect.center().y - 13.0),
                egui::vec2(3.0, 26.0),
            );
            let ink = if self.session.dark {
                palette.ui_link_soft
            } else {
                palette.ui_link_strong
            };
            ui.painter().rect_filled(bar, 0.0, paint::color(ink));
        }
    }

    fn commentary_toolbar_actions(
        &mut self,
        ui: &mut egui::Ui,
        pane_id: &str,
        book: i64,
        chapter: i64,
        verse: Option<i64>,
        palette: &UiPalette,
    ) {
        if self.toolbar_icon(
            ui,
            Icon::BookOpen,
            i18n::t("allCommentaries"),
            palette,
            Some(&format!("all-commentaries:{pane_id}")),
        ) {
            self.load_all_commentaries(book, chapter, verse);
        }
        if self.toolbar_icon(
            ui,
            Icon::Info,
            i18n::t("commentaryCoverage"),
            palette,
            Some(&format!("coverage:{pane_id}")),
        ) {
            self.session.coverage_module_id = self.commentary_module_id(pane_id);
            self.session.dialog = Dialog::Coverage;
        }
    }

    fn commentary_module_id(&self, pane_id: &str) -> Option<String> {
        let assigned = self
            .session
            .panes
            .get(pane_id)
            .and_then(|pane| pane.module_id.clone());
        if assigned.is_some() {
            return assigned;
        }
        self.modules
            .iter()
            .find(|module| module.kind == "commentary")
            .map(|module| module.id.clone())
    }

    fn toolbar_icon(
        &mut self,
        ui: &mut egui::Ui,
        icon: Icon,
        tip: String,
        palette: &UiPalette,
        mark: Option<&str>,
    ) -> bool {
        let (rect, response) = ui.allocate_exact_size(egui::vec2(28.0, 28.0), egui::Sense::click());
        if response.hovered() {
            ui.ctx().set_cursor_icon(egui::CursorIcon::PointingHand);
        }
        let ink = paint::color(if response.hovered() {
            palette.ui_text
        } else {
            palette.ui_text_subtle
        });
        paint::draw_icon(ui.painter(), rect.center(), ink, icon);
        #[cfg(test)]
        if let Some(mark) = mark {
            mark_layout(ui, mark, rect);
        }
        #[cfg(not(test))]
        let _ = mark;
        paint::hover_tip(response, tip).clicked()
    }

    fn pane_badge(&self, ui: &mut egui::Ui, pane_id: &str, palette: &UiPalette) {
        let label = get_pane_display_label(&self.session.panes, pane_id);
        let (rect, _) = ui.allocate_exact_size(egui::vec2(20.0, 20.0), egui::Sense::hover());
        let fill = if self.session.dark {
            paint::color_alpha(palette.ui_surface, 28)
        } else {
            paint::color_alpha("#1a1612", 16)
        };
        ui.painter()
            .rect_filled(rect, egui::CornerRadius::same(10), fill);
        let ink = paint::color(if self.session.dark {
            palette.ui_text_muted
        } else {
            palette.ui_text_subtle
        });
        let galley = egui::WidgetText::from(
            egui::RichText::new(label)
                .monospace()
                .size(11.0)
                .strong()
                .color(ink),
        )
        .into_galley(
            ui,
            Some(egui::TextWrapMode::Extend),
            24.0,
            egui::FontSelection::default(),
        );
        ui.painter().galley(
            egui::pos2(
                rect.center().x - galley.rect.width() / 2.0,
                rect.center().y - galley.rect.height() / 2.0,
            ),
            galley,
            ink,
        );
    }

    fn chapter_nav(
        &mut self,
        ui: &mut egui::Ui,
        pane_id: &str,
        book: i64,
        chapter: i64,
        pane_width: f32,
        palette: &UiPalette,
    ) {
        let spans = self.chapter_spans(pane_id);
        let prev = adjacent_chapter(&spans, book, chapter, -1);
        let next = adjacent_chapter(&spans, book, chapter, 1);
        let compact = pane_width < 560.0;
        let nav_w = if pane_width < 420.0 {
            118.0
        } else if compact {
            150.0
        } else {
            240.0
        };
        let (rect, _) = ui.allocate_exact_size(egui::vec2(nav_w, 32.0), egui::Sense::hover());
        #[cfg(test)]
        mark_layout(ui, &format!("nav:{pane_id}"), rect);
        if ui.rect_contains_pointer(rect) {
            ui.painter().rect_filled(
                rect,
                4.0,
                paint::color_alpha(palette.ui_surface, if self.session.dark { 26 } else { 72 }),
            );
        }
        let side = if compact { 32.0 } else { 80.0 };
        let prev_rect = egui::Rect::from_min_size(rect.min, egui::vec2(side, rect.height()));
        let next_rect = egui::Rect::from_min_size(
            egui::pos2(rect.right() - side, rect.top()),
            egui::vec2(side, rect.height()),
        );
        let mid_rect = egui::Rect::from_min_max(prev_rect.right_top(), next_rect.left_bottom());
        if !compact {
            self.nav_divider(ui, prev_rect.right(), rect.center().y, palette);
            self.nav_divider(ui, next_rect.left(), rect.center().y, palette);
        }
        if self.nav_end(ui, prev_rect, prev, true, !compact, palette) {
            self.go_chapter(pane_id, -1);
        }
        if self.nav_current(ui, mid_rect, book, chapter, palette) {
            self.activate_pane(pane_id);
            self.open_navigation();
        }
        if self.nav_end(ui, next_rect, next, false, !compact, palette) {
            self.go_chapter(pane_id, 1);
        }
    }

    fn nav_divider(&self, ui: &mut egui::Ui, x: f32, y: f32, palette: &UiPalette) {
        ui.painter().line_segment(
            [egui::pos2(x, y - 7.0), egui::pos2(x, y + 7.0)],
            egui::Stroke::new(1.0_f32, paint::color(palette.ui_border_soft)),
        );
    }

    fn nav_end(
        &mut self,
        ui: &mut egui::Ui,
        rect: egui::Rect,
        target: Option<(i64, i64)>,
        previous: bool,
        show_label: bool,
        palette: &UiPalette,
    ) -> bool {
        let response = ui.interact(
            rect,
            ui.id().with((
                if previous { "nav-prev" } else { "nav-next" },
                rect.left() as i32,
            )),
            if target.is_some() {
                egui::Sense::click()
            } else {
                egui::Sense::hover()
            },
        );
        let ink = paint::color(if target.is_some() {
            palette.ui_text_muted
        } else {
            palette.ui_text_dim
        });
        let label = if show_label {
            target.map(|(book, chapter)| {
                ui.painter().layout_no_wrap(
                    place_text(book, chapter),
                    egui::FontId::proportional(11.0),
                    ink,
                )
            })
        } else {
            None
        };
        let text_w = label
            .as_ref()
            .map(|galley| galley.rect.width())
            .unwrap_or(0.0);
        let gap = if text_w > 0.0 { 4.0 } else { 0.0 };
        let icon_span = 10.0;
        let content_w = icon_span + gap + text_w;
        let origin = rect.center().x - content_w / 2.0;
        let (icon_x, text_x) = if previous {
            (origin + icon_span / 2.0, origin + icon_span + gap)
        } else {
            (origin + text_w + gap + icon_span / 2.0, origin)
        };
        paint::draw_icon(
            ui.painter(),
            egui::pos2(icon_x, rect.center().y),
            ink,
            if previous {
                Icon::ChevronLeft
            } else {
                Icon::ChevronRight
            },
        );
        if let Some(galley) = label {
            ui.painter().galley(
                egui::pos2(text_x, rect.center().y - galley.rect.height() / 2.0),
                galley,
                ink,
            );
        }
        if target.is_some() && response.hovered() {
            ui.ctx().set_cursor_icon(egui::CursorIcon::PointingHand);
        }
        let hint = if previous {
            i18n::t("prevChapter")
        } else {
            i18n::t("nextChapter")
        };
        paint::hover_tip(response, hint).clicked() && target.is_some()
    }

    fn nav_current(
        &mut self,
        ui: &mut egui::Ui,
        rect: egui::Rect,
        book: i64,
        chapter: i64,
        palette: &UiPalette,
    ) -> bool {
        let response = ui.interact(rect, ui.id().with("nav-current"), egui::Sense::click());
        let ink = paint::color(palette.ui_text);
        let galley = egui::WidgetText::from(
            egui::RichText::new(place_text(book, chapter))
                .size(14.0)
                .strong()
                .color(ink),
        )
        .into_galley(
            ui,
            Some(egui::TextWrapMode::Truncate),
            rect.width().max(8.0),
            egui::FontSelection::default(),
        );
        ui.painter().galley(
            egui::pos2(
                rect.center().x - galley.rect.width() / 2.0,
                rect.center().y - galley.rect.height() / 2.0,
            ),
            galley,
            ink,
        );
        if response.hovered() {
            ui.ctx().set_cursor_icon(egui::CursorIcon::PointingHand);
        }
        response.clicked()
    }

    fn place_label(
        &mut self,
        ui: &mut egui::Ui,
        pane_id: &str,
        book: i64,
        chapter: i64,
        palette: &UiPalette,
    ) {
        let ink = paint::color(palette.ui_text_muted);
        let galley = ui.painter().layout_no_wrap(
            place_text(book, chapter),
            egui::FontId::proportional(14.0),
            ink,
        );
        let width = galley.rect.width() + 16.0;
        let (rect, response) =
            ui.allocate_exact_size(egui::vec2(width, 28.0), egui::Sense::click());
        #[cfg(test)]
        mark_layout(ui, &format!("place:{pane_id}"), rect);
        ui.painter().galley(
            egui::pos2(
                rect.left() + 8.0,
                rect.center().y - galley.rect.height() / 2.0,
            ),
            galley,
            ink,
        );
        if response.hovered() {
            ui.ctx().set_cursor_icon(egui::CursorIcon::PointingHand);
        }
        if response.clicked() {
            self.activate_pane(pane_id);
            self.open_navigation();
        }
    }

    fn pane_options(&mut self, ui: &mut egui::Ui, pane_id: &str, palette: &UiPalette) {
        let (rect, response) = ui.allocate_exact_size(egui::vec2(28.0, 28.0), egui::Sense::click());
        #[cfg(test)]
        mark_layout(ui, &format!("options:{pane_id}"), rect);
        if response.hovered() {
            ui.ctx().set_cursor_icon(egui::CursorIcon::PointingHand);
        }
        paint::draw_icon(
            ui.painter(),
            rect.center(),
            paint::color(if response.hovered() {
                palette.ui_text
            } else {
                palette.ui_text_subtle
            }),
            Icon::Ellipsis,
        );
        let target = self.session.bible_target(pane_id);
        let history = self.session.panes.get(&target);
        let can_back = has_nav_back_history(history);
        let can_forward = has_nav_forward_history(history);
        let pinned = self.session.link_target.as_deref() == Some(pane_id);
        let popup_id = response.id.with("menu");
        egui::Popup::from_toggle_button_response(&response)
            .close_behavior(egui::PopupCloseBehavior::CloseOnClickOutside)
            .frame(
                egui::Frame::new()
                    .fill(paint::color(palette.ui_surface_elevated))
                    .stroke(egui::Stroke::new(1.0_f32, paint::color(palette.ui_border)))
                    .corner_radius(egui::CornerRadius::same(6))
                    .inner_margin(egui::Margin::same(4))
                    .shadow(egui::Shadow {
                        offset: [0, 4],
                        blur: 16,
                        spread: 0,
                        color: egui::Color32::from_black_alpha(if self.session.dark {
                            120
                        } else {
                            35
                        }),
                    }),
            )
            .show(|ui| {
                ui.set_min_width(210.0);
                if menu_item(
                    ui,
                    Icon::ArrowLeft,
                    &i18n::t("crossRefBackTooltip"),
                    can_back,
                    palette,
                ) {
                    self.session.active_pane_id = target.clone();
                    if self.session.back() {
                        self.loaded_key.clear();
                        self.sync_active_chapter();
                        self.note_workspaces();
                    }
                    egui::Popup::close_id(ui.ctx(), popup_id);
                }
                if menu_item(
                    ui,
                    Icon::ArrowRight,
                    &i18n::t("crossRefForwardTooltip"),
                    can_forward,
                    palette,
                ) {
                    self.session.active_pane_id = target.clone();
                    if self.session.forward() {
                        self.loaded_key.clear();
                        self.sync_active_chapter();
                        self.note_workspaces();
                    }
                    egui::Popup::close_id(ui.ctx(), popup_id);
                }
                let pin_label = if pinned {
                    i18n::t("unpinLinkTarget")
                } else {
                    i18n::t("pinLinkTarget")
                };
                if menu_item(ui, Icon::Pin, &pin_label, true, palette) {
                    self.activate_pane(pane_id);
                    self.session.toggle_pin();
                    self.note_workspaces();
                    egui::Popup::close_id(ui.ctx(), popup_id);
                }
                ui.separator();
                if menu_item(ui, Icon::Plus, "Split Horizontal", true, palette) {
                    self.activate_pane(pane_id);
                    self.session.split(false);
                    self.after_toolbar_change();
                    egui::Popup::close_id(ui.ctx(), popup_id);
                }
                if menu_item(ui, Icon::Plus, "Split Vertical", true, palette) {
                    self.activate_pane(pane_id);
                    self.session.split(true);
                    self.after_toolbar_change();
                    egui::Popup::close_id(ui.ctx(), popup_id);
                }
                if menu_item(ui, Icon::BookOpen, &i18n::t("commentary"), true, palette) {
                    self.activate_pane(pane_id);
                    self.session.split_commentary(false);
                    self.after_toolbar_change();
                    egui::Popup::close_id(ui.ctx(), popup_id);
                }
            });
        paint::hover_tip(response, i18n::t("paneOptions"));
    }

    fn pane_close(&mut self, ui: &mut egui::Ui, pane_id: &str, palette: &UiPalette) {
        let enabled = self.session.panes.len() > 1;
        let (rect, response) = ui.allocate_exact_size(
            egui::vec2(28.0, 28.0),
            if enabled {
                egui::Sense::click()
            } else {
                egui::Sense::hover()
            },
        );
        #[cfg(test)]
        mark_layout(ui, &format!("close:{pane_id}"), rect);
        let ink = paint::color(if !enabled {
            palette.ui_text_dim
        } else if response.hovered() {
            palette.ui_text
        } else {
            palette.ui_text_subtle
        });
        paint::draw_icon(ui.painter(), rect.center(), ink, Icon::Close);
        if enabled && response.hovered() {
            ui.ctx().set_cursor_icon(egui::CursorIcon::PointingHand);
        }
        if paint::hover_tip(response, i18n::t("closePane")).clicked()
            && self.session.close_pane(pane_id)
        {
            self.after_toolbar_change();
        }
    }

    fn go_chapter(&mut self, pane_id: &str, delta: i64) {
        let target = self.session.bible_target(pane_id);
        let spans = self.chapter_spans(&target);
        let current = self
            .session
            .panes
            .get(&target)
            .map(|pane| (pane.book_number, pane.chapter));
        let Some((book, chapter)) =
            current.and_then(|(book, chapter)| adjacent_chapter(&spans, book, chapter, delta))
        else {
            return;
        };
        self.session.active_pane_id = target.clone();
        if let Some(pane) = self.session.panes.get_mut(&target) {
            push_nav_history_entry(pane);
            pane.book_number = book;
            pane.chapter = chapter;
            pane.selected_verse = Some(1);
            push_nav_history_entry(pane);
        }
        self.session.reveal_selected_verse(true);
        self.after_toolbar_change();
    }

    fn activate_pane(&mut self, pane_id: &str) {
        if self.session.active_pane_id == pane_id {
            return;
        }
        self.session.active_pane_id = pane_id.to_string();
        self.after_toolbar_change();
    }

    fn after_toolbar_change(&mut self) {
        self.loaded_key.clear();
        self.sync_active_chapter();
        self.note_workspaces();
    }
}

#[cfg(test)]
pub(crate) fn mark_layout(ui: &egui::Ui, key: &str, rect: egui::Rect) {
    ui.ctx().data_mut(|data| {
        let id = egui::Id::new("pane-layout-marks");
        let mut marks = data
            .get_temp::<Vec<(String, [f32; 4])>>(id)
            .unwrap_or_default();
        marks.push((
            key.to_string(),
            [rect.min.x, rect.min.y, rect.width(), rect.height()],
        ));
        data.insert_temp(id, marks);
    });
}

fn place_text(book: i64, chapter: i64) -> String {
    format!("{} {}", i18n::book_name(book).short, chapter)
}

/// Module trigger width from the Electron pane toolbar.
/// Wide panes use a slice of the window. Narrow panes shrink with the pane.
pub(crate) fn toolbar_picker_width(pane_width: f32, screen_width: f32) -> f32 {
    if pane_width < 330.0 {
        68.0
    } else if pane_width < 420.0 {
        80.0
    } else if pane_width < 560.0 {
        (pane_width * 0.28).clamp(88.0, 128.0)
    } else {
        (screen_width * 0.20).clamp(112.0, 192.0)
    }
}

fn menu_item(
    ui: &mut egui::Ui,
    icon: Icon,
    label: &str,
    enabled: bool,
    palette: &UiPalette,
) -> bool {
    let width = ui.available_width().max(200.0);
    let (rect, response) = ui.allocate_exact_size(
        egui::vec2(width, 32.0),
        if enabled {
            egui::Sense::click()
        } else {
            egui::Sense::hover()
        },
    );
    if enabled && response.hovered() {
        ui.painter()
            .rect_filled(rect, 4.0, paint::color_alpha(palette.ui_text, 16));
        ui.ctx().set_cursor_icon(egui::CursorIcon::PointingHand);
    }
    let ink = paint::color(if enabled {
        palette.ui_text_muted
    } else {
        palette.ui_text_dim
    });
    paint::draw_icon(
        ui.painter(),
        egui::pos2(rect.left() + 16.0, rect.center().y),
        ink,
        icon,
    );
    let galley =
        ui.painter()
            .layout_no_wrap(label.to_string(), egui::FontId::proportional(12.0), ink);
    ui.painter().galley(
        egui::pos2(
            rect.left() + 32.0,
            rect.center().y - galley.rect.height() / 2.0,
        ),
        galley,
        ink,
    );
    enabled && response.clicked()
}

#[cfg(test)]
mod tests {
    use super::toolbar_picker_width;

    #[test]
    fn picker_width_follows_the_pane() {
        assert!((toolbar_picker_width(800.0, 1400.0) - 192.0).abs() < 0.1);
        assert!((toolbar_picker_width(800.0, 500.0) - 112.0).abs() < 0.1);
        assert!((toolbar_picker_width(500.0, 1400.0) - 128.0).abs() < 0.1);
        assert!((toolbar_picker_width(400.0, 1400.0) - 80.0).abs() < 0.1);
        assert!((toolbar_picker_width(300.0, 1400.0) - 68.0).abs() < 0.1);
    }
}
