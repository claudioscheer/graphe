//! Reusable searchable module dropdown component with favorites and subtitle support.

use crate::paint;
use graphe_domain::app_state::AppStateStore;
use graphe_domain::i18n;
use graphe_domain::picker;
use graphe_domain::theme::{self, UiPalette};
use graphe_store::catalog::InstalledModule;

/// An item in the dropdown list.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DropdownItem {
    pub id: String,
    pub name: String,
    pub subtitle: Option<String>,
    pub tooltip: Option<String>,
}

impl DropdownItem {
    pub fn new(id: impl Into<String>, name: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            name: name.into(),
            subtitle: None,
            tooltip: None,
        }
    }
}

/// Unified dropdown component for selecting Bible, commentary, dictionary, and other modules.
pub struct ModuleDropdown<'a> {
    pub salt: &'a str,
    pub module_type: &'a str,
    pub current_id: Option<&'a str>,
    pub items: Vec<DropdownItem>,
    pub show_favorites: bool,
    pub allow_none: bool,
    pub none_label: String,
    pub width: Option<f32>,
    pub min_dropdown_width: f32,
    pub truncate_length: usize,
    /// Pane toolbar trigger: no box, just the name and a chevron.
    pub plain: bool,
    pub show_search: bool,
}

impl<'a> ModuleDropdown<'a> {
    /// Creates a dropdown populated with installed modules of the given `module_type` (e.g. "bible", "dictionary", "commentary").
    pub fn from_installed(
        salt: &'a str,
        module_type: &'a str,
        current_id: Option<&'a str>,
        modules: &[InstalledModule],
    ) -> Self {
        let items = modules
            .iter()
            .filter(|m| m.kind == module_type)
            .map(|m| {
                let subtitle = if !m.id.is_empty() && m.id != m.name {
                    Some(m.id.clone())
                } else if let Some(desc) = &m.description {
                    if desc != &m.name {
                        Some(desc.clone())
                    } else {
                        None
                    }
                } else {
                    None
                };
                let mut tooltip_lines = vec![m.name.clone()];
                if let Some(sub) = &subtitle {
                    if sub != &m.name {
                        tooltip_lines.push(sub.clone());
                    }
                }
                if let Some(desc) = &m.description {
                    if desc != &m.name && Some(desc) != subtitle.as_ref() {
                        tooltip_lines.push(desc.clone());
                    }
                }
                let tooltip = Some(tooltip_lines.join("\n"));
                DropdownItem {
                    id: m.id.clone(),
                    name: m.name.clone(),
                    subtitle,
                    tooltip,
                }
            })
            .collect();

        Self {
            salt,
            module_type,
            current_id,
            items,
            show_favorites: true,
            allow_none: false,
            none_label: "—".into(),
            width: None,
            min_dropdown_width: 240.0,
            truncate_length: 50,
            plain: false,
            show_search: true,
        }
    }

    /// Creates a dropdown containing all installed modules regardless of kind (used in module editor).
    pub fn from_all_installed(
        salt: &'a str,
        current_id: Option<&'a str>,
        modules: &[InstalledModule],
    ) -> Self {
        let items = modules
            .iter()
            .map(|m| {
                let subtitle = if !m.id.is_empty() && m.id != m.name {
                    Some(m.id.clone())
                } else if let Some(desc) = &m.description {
                    if desc != &m.name {
                        Some(desc.clone())
                    } else {
                        None
                    }
                } else {
                    None
                };
                let mut tooltip_lines = vec![m.name.clone()];
                if let Some(sub) = &subtitle {
                    if sub != &m.name {
                        tooltip_lines.push(sub.clone());
                    }
                }
                if let Some(desc) = &m.description {
                    if desc != &m.name && Some(desc) != subtitle.as_ref() {
                        tooltip_lines.push(desc.clone());
                    }
                }
                let tooltip = Some(tooltip_lines.join("\n"));
                DropdownItem {
                    id: m.id.clone(),
                    name: m.name.clone(),
                    subtitle,
                    tooltip,
                }
            })
            .collect();

        Self {
            salt,
            module_type: "all",
            current_id,
            items,
            show_favorites: false,
            allow_none: false,
            none_label: "—".into(),
            width: None,
            min_dropdown_width: 240.0,
            truncate_length: 50,
            plain: false,
            show_search: true,
        }
    }

    /// Creates a dropdown populated with custom items (e.g. font size, language).
    pub fn from_items(
        salt: &'a str,
        current_id: Option<&'a str>,
        items: Vec<DropdownItem>,
    ) -> Self {
        Self {
            salt,
            module_type: "custom",
            current_id,
            items,
            show_favorites: false,
            allow_none: false,
            none_label: "—".into(),
            width: None,
            min_dropdown_width: 72.0,
            truncate_length: 50,
            plain: false,
            show_search: false,
        }
    }

    /// Enable or disable the search box in the popup.
    #[allow(dead_code)]
    pub fn show_search(mut self, show: bool) -> Self {
        self.show_search = show;
        self
    }

    /// Explicit width for the trigger button.
    pub fn width(mut self, width: f32) -> Self {
        self.width = Some(width);
        self
    }

    /// Enable or disable favorite stars and favorites section.
    pub fn show_favorites(mut self, show: bool) -> Self {
        self.show_favorites = show;
        self
    }

    /// Allow selecting None (empty id).
    pub fn allow_none(mut self, allow: bool) -> Self {
        self.allow_none = allow;
        self
    }

    /// Label to show for None.
    pub fn none_label(mut self, label: impl Into<String>) -> Self {
        self.none_label = label.into();
        self
    }

    /// Minimum width of the popup dropdown.
    #[allow(dead_code)]
    pub fn min_dropdown_width(mut self, width: f32) -> Self {
        self.min_dropdown_width = width;
        self
    }

    /// Draw the trigger as text and a chevron, without a bordered box.
    pub fn plain(mut self) -> Self {
        self.plain = true;
        self
    }

    fn trigger_label(&self) -> String {
        if self.allow_none && self.current_id.is_none() {
            return self.none_label.clone();
        }
        if let Some(id) = self.current_id {
            if let Some(item) = self.items.iter().find(|item| item.id == id) {
                return item.name.clone();
            }
            return id.to_string();
        }
        "—".to_string()
    }

    /// Maximum character length before truncating trigger button text.
    #[allow(dead_code)]
    pub fn truncate_length(mut self, len: usize) -> Self {
        self.truncate_length = len;
        self
    }

    /// Renders the trigger button and popup dropdown. Returns `Some(chosen_id)` if an item was selected.
    pub fn show(
        &self,
        ui: &mut egui::Ui,
        store: &mut AppStateStore,
        palette: &UiPalette,
        dark: bool,
    ) -> Option<String> {
        ui.push_id(self.salt, |ui| {
            let trigger_text = self.trigger_label();
            let font_size = if self.plain { 12.0 } else { 13.0 };
            let height = if self.plain { 28.0 } else { 30.0 };
            let trigger_width = self.width.unwrap_or_else(|| {
                if self.plain {
                    (trigger_text.chars().count() as f32 * 7.2 + 28.0).clamp(72.0, 168.0)
                } else {
                    ui.available_width()
                }
            });
            let (rect, resp) =
                ui.allocate_exact_size(egui::vec2(trigger_width, height), egui::Sense::click());

            let popup_id = resp.id.with("popup");
            let is_open = egui::Popup::is_id_open(ui.ctx(), popup_id);

            if self.plain {
                if resp.hovered() || is_open {
                    ui.painter().rect_filled(
                        rect,
                        egui::CornerRadius::same(theme::RADIUS_CONTROL as u8),
                        paint::color_alpha(palette.ui_surface, if dark { 26 } else { 72 }),
                    );
                }
            } else {
                let (fill, stroke_color) = if resp.hovered() || is_open {
                    (
                        paint::color(palette.ui_surface),
                        paint::color(palette.ui_border_strong),
                    )
                } else {
                    (
                        paint::color(palette.ui_surface),
                        paint::color(palette.ui_border_soft),
                    )
                };
                ui.painter().rect(
                    rect,
                    egui::CornerRadius::same(theme::RADIUS_CONTROL as u8),
                    fill,
                    egui::Stroke::new(1.0_f32, stroke_color),
                    egui::StrokeKind::Inside,
                );
            }

            let ink = paint::color(if self.plain {
                palette.ui_accent_ink
            } else {
                palette.ui_text
            });
            let galley = if self.plain {
                let text_width = (rect.width() - 26.0).max(8.0);
                egui::WidgetText::from(egui::RichText::new(trigger_text).size(font_size).color(ink))
                    .into_galley(
                        ui,
                        Some(egui::TextWrapMode::Truncate),
                        text_width,
                        egui::FontSelection::default(),
                    )
            } else {
                let max_chars = ((rect.width() - 28.0) / 7.5) as usize;
                let display_text = if trigger_text.chars().count() > max_chars && max_chars > 3 {
                    format!(
                        "{}…",
                        trigger_text.chars().take(max_chars - 1).collect::<String>()
                    )
                } else if trigger_text.chars().count() > self.truncate_length {
                    format!(
                        "{}…",
                        trigger_text
                            .chars()
                            .take(self.truncate_length)
                            .collect::<String>()
                    )
                } else {
                    trigger_text
                };
                ui.painter().layout_no_wrap(
                    display_text,
                    egui::FontId::proportional(font_size),
                    ink,
                )
            };
            let text_pos = egui::pos2(
                rect.left() + 8.0,
                rect.center().y - galley.rect.height() / 2.0,
            );
            ui.painter().galley(text_pos, galley, ink);
            #[cfg(test)]
            if self.plain {
                crate::chrome::mark_layout(ui, &format!("picker:{}", self.salt), rect);
            }
            #[cfg(test)]
            crate::chrome::mark_layout(ui, &format!("dropdown:{}", self.salt), rect);

            // Chevron sits at the right edge of the trigger, away from a short name.
            let chevron_center = egui::pos2(
                rect.right() - if self.plain { 11.0 } else { 14.0 },
                rect.center().y,
            );
            paint::draw_icon(
                ui.painter(),
                chevron_center,
                paint::color(palette.ui_text_subtle),
                paint::Icon::ChevronDown,
            );

            if resp.hovered() {
                ui.ctx().set_cursor_icon(egui::CursorIcon::PointingHand);
            }

            let mut chosen = None;
            let popup_width = rect.width().max(self.min_dropdown_width);

            let popup_frame = egui::Frame::new()
                .fill(paint::color(palette.ui_surface_elevated))
                .stroke(egui::Stroke::new(
                    1.0_f32,
                    paint::color(if dark {
                        palette.ui_border_strong
                    } else {
                        palette.ui_border_soft
                    }),
                ))
                .corner_radius(egui::CornerRadius::same(theme::RADIUS_CONTROL as u8))
                .shadow(egui::Shadow {
                    offset: [0, 4],
                    blur: 16,
                    spread: 0,
                    color: egui::Color32::from_black_alpha(if dark { 120 } else { 35 }),
                })
                .inner_margin(egui::Margin {
                    left: 0,
                    right: 0,
                    top: 6,
                    bottom: 6,
                });

            egui::Popup::from_toggle_button_response(&resp)
                .close_behavior(egui::PopupCloseBehavior::CloseOnClickOutside)
                .frame(popup_frame)
                .width(popup_width)
                .show(|ui| {
                    ui.set_width(popup_width);
                    ui.set_max_width(popup_width);

                    let query = if self.show_search {
                        let search_id = popup_id.with("search");
                        let mut search_query = ui
                            .ctx()
                            .data(|d| d.get_temp::<String>(search_id).unwrap_or_default());

                        let was_open_id = popup_id.with("was_open");
                        let was_open = ui
                            .ctx()
                            .data(|d| d.get_temp::<bool>(was_open_id).unwrap_or(false));
                        if !was_open {
                            search_query.clear();
                        }
                        ui.ctx().data_mut(|d| d.insert_temp(was_open_id, true));

                        // 1. Search Box with rounded border and optional clear button
                        let search_h = 28.0_f32;
                        let (search_row_rect, _) = ui.allocate_exact_size(
                            egui::vec2(popup_width, search_h + 4.0),
                            egui::Sense::hover(),
                        );
                        let box_margin_h = 6.0_f32;
                        let box_rect = egui::Rect::from_min_size(
                            egui::pos2(
                                search_row_rect.left() + box_margin_h,
                                search_row_rect.top() + 2.0,
                            ),
                            egui::vec2(popup_width - 2.0 * box_margin_h, search_h),
                        );

                        ui.painter().rect(
                            box_rect,
                            egui::CornerRadius::same(theme::RADIUS_CONTROL as u8),
                            paint::color(palette.ui_surface),
                            egui::Stroke::new(1.0_f32, paint::color(palette.ui_border_soft)),
                            egui::StrokeKind::Inside,
                        );

                        let is_empty = search_query.is_empty();
                        let text_w = if is_empty {
                            box_rect.width() - 16.0
                        } else {
                            box_rect.width() - 32.0
                        };
                        let text_edit_rect = egui::Rect::from_min_size(
                            egui::pos2(box_rect.left() + 8.0, box_rect.top()),
                            egui::vec2(text_w, box_rect.height()),
                        );

                        let text_resp = ui.put(
                            text_edit_rect,
                            egui::TextEdit::singleline(&mut search_query)
                                .hint_text(i18n::t("searchPlaceholder"))
                                .frame(false)
                                .margin(egui::Margin::ZERO)
                                .vertical_align(egui::Align::Center)
                                .font(egui::FontId::proportional(13.0)),
                        );

                        if !was_open {
                            text_resp.request_focus();
                        }

                        if !is_empty {
                            let clear_rect = egui::Rect::from_center_size(
                                egui::pos2(box_rect.right() - 13.0, box_rect.center().y),
                                egui::vec2(18.0, 18.0),
                            );
                            let clear_resp =
                                ui.interact(clear_rect, popup_id.with("clear"), egui::Sense::click());
                            if clear_resp.hovered() {
                                ui.ctx().set_cursor_icon(egui::CursorIcon::PointingHand);
                            }
                            let clear_color = if clear_resp.hovered() {
                                paint::color(palette.ui_text)
                            } else {
                                paint::color(palette.ui_text_subtle)
                            };
                            let clear_galley = ui.painter().layout_no_wrap(
                                "×".into(),
                                egui::FontId::proportional(15.0),
                                clear_color,
                            );
                            let clear_pos = egui::pos2(
                                clear_rect.center().x - clear_galley.rect.width() / 2.0,
                                clear_rect.center().y - clear_galley.rect.height() / 2.0,
                            );
                            ui.painter().galley(clear_pos, clear_galley, clear_color);

                            if clear_resp.clicked() {
                                search_query.clear();
                                text_resp.request_focus();
                            }
                        }

                        ui.ctx()
                            .data_mut(|d| d.insert_temp(search_id, search_query.clone()));

                        ui.add_space(4.0);
                        search_query.trim().to_lowercase()
                    } else {
                        String::new()
                    };

                    // 2. Filter items and separate into favorites vs non-favorites
                    let fav_ids = if self.show_favorites {
                        picker::favorites(store, self.module_type)
                    } else {
                        Vec::new()
                    };

                    let mut matching_items = Vec::new();
                    if self.allow_none
                        && (query.is_empty() || self.none_label.to_lowercase().contains(&query))
                    {
                        matching_items.push(DropdownItem {
                            id: String::new(),
                            name: self.none_label.clone(),
                            subtitle: None,
                            tooltip: Some(self.none_label.clone()),
                        });
                    }

                    for item in &self.items {
                        if !query.is_empty()
                            && !item.name.to_lowercase().contains(&query)
                            && !item.id.to_lowercase().contains(&query)
                            && !item
                                .subtitle
                                .as_deref()
                                .unwrap_or("")
                                .to_lowercase()
                                .contains(&query)
                        {
                            continue;
                        }
                        matching_items.push(item.clone());
                    }

                    let fav_items: Vec<_> = matching_items
                        .iter()
                        .filter(|item| !item.id.is_empty() && fav_ids.contains(&item.id))
                        .cloned()
                        .collect();
                    let non_fav_items: Vec<_> = matching_items
                        .iter()
                        .filter(|item| item.id.is_empty() || !fav_ids.contains(&item.id))
                        .cloned()
                        .collect();

                    // Keyboard navigation
                    let hl_id = popup_id.with("hl");
                    let mut hl = ui.ctx().data(|d| d.get_temp::<i32>(hl_id).unwrap_or(-1));
                    let total_items = fav_items.len() + non_fav_items.len();

                    if ui.input(|i| i.key_pressed(egui::Key::ArrowDown)) {
                        hl = (hl + 1).min(total_items as i32 - 1);
                    }
                    if ui.input(|i| i.key_pressed(egui::Key::ArrowUp)) {
                        hl = (hl - 1).max(0);
                    }

                    let enter_pressed = ui.input(|i| i.key_pressed(egui::Key::Enter));

                    // 3. Scroll area containing the rows. Keep names under the search field.
                    paint::clip_scroll_to_viewport(ui);
                    egui::ScrollArea::vertical()
                        .id_salt(popup_id.with("scroll"))
                        .max_height(260.0)
                        .auto_shrink([false, true])
                        .show(ui, |ui| {
                            if fav_items.is_empty() && non_fav_items.is_empty() {
                                ui.add_space(14.0);
                                ui.vertical_centered(|ui| {
                                    ui.label(
                                        egui::RichText::new(i18n::t("searchNoResults"))
                                            .size(12.0)
                                            .color(paint::color(palette.ui_text_subtle)),
                                    );
                                });
                                ui.add_space(14.0);
                                return;
                            }

                            let mut current_idx = 0;

                            // Favorite items
                            for item in &fav_items {
                                let is_highlighted = hl == current_idx;
                                if let Some(selected_id) = self.render_row(
                                    ui,
                                    item,
                                    true,
                                    is_highlighted,
                                    store,
                                    palette,
                                    popup_id,
                                ) {
                                    chosen = Some(selected_id);
                                }
                                if enter_pressed && is_highlighted {
                                    chosen = Some(item.id.clone());
                                    egui::Popup::close_id(ui.ctx(), popup_id);
                                }
                                current_idx += 1;
                            }

                            // Divider between favorites and non-favorites
                            if !fav_items.is_empty() && !non_fav_items.is_empty() {
                                ui.add_space(3.0);
                                let (div_rect, _) = ui.allocate_exact_size(
                                    egui::vec2(ui.available_width(), 1.0),
                                    egui::Sense::hover(),
                                );
                                ui.painter().line_segment(
                                    [
                                        egui::pos2(div_rect.left() + 8.0, div_rect.center().y),
                                        egui::pos2(div_rect.right() - 8.0, div_rect.center().y),
                                    ],
                                    egui::Stroke::new(
                                        1.0_f32,
                                        paint::color(palette.ui_border_soft),
                                    ),
                                );
                                ui.add_space(3.0);
                            }

                            // Non-favorite items
                            for item in &non_fav_items {
                                let is_highlighted = hl == current_idx;
                                if let Some(selected_id) = self.render_row(
                                    ui,
                                    item,
                                    false,
                                    is_highlighted,
                                    store,
                                    palette,
                                    popup_id,
                                ) {
                                    chosen = Some(selected_id);
                                }
                                if enter_pressed && is_highlighted {
                                    chosen = Some(item.id.clone());
                                    egui::Popup::close_id(ui.ctx(), popup_id);
                                }
                                current_idx += 1;
                            }
                        });

                    ui.ctx().data_mut(|d| d.insert_temp(hl_id, hl));
                });

            if !is_open && self.show_search {
                ui.ctx()
                    .data_mut(|d| d.insert_temp(popup_id.with("was_open"), false));
            }

            chosen
        })
        .inner
    }

    #[allow(clippy::too_many_arguments)]
    fn render_row(
        &self,
        ui: &mut egui::Ui,
        item: &DropdownItem,
        is_fav: bool,
        is_highlighted: bool,
        store: &mut AppStateStore,
        palette: &UiPalette,
        popup_id: egui::Id,
    ) -> Option<String> {
        let is_selected = if item.id.is_empty() {
            self.current_id.is_none()
        } else {
            self.current_id == Some(&item.id)
        };

        let star_width = if self.show_favorites && !item.id.is_empty() {
            26.0_f32
        } else {
            8.0_f32
        };

        let max_text_width = (ui.available_width() - star_width - 8.0).max(20.0);

        let name_color = if is_selected {
            paint::color(palette.ui_link_strong)
        } else {
            paint::color(palette.ui_text)
        };

        let mut title_job = egui::text::LayoutJob::simple(
            item.name.clone(),
            egui::FontId::proportional(13.0),
            name_color,
            max_text_width,
        );
        title_job.wrap.max_rows = 1;
        title_job.wrap.overflow_character = Some('…');
        title_job.wrap.break_anywhere = true;
        let title_galley = ui.painter().layout_job(title_job);
        let is_title_truncated = title_galley.elided;

        let (row_height, sub_layout) = if let Some(subtitle) = &item.subtitle {
            let sub_color = paint::color(palette.ui_text_subtle);
            let mut sub_job = egui::text::LayoutJob::simple(
                subtitle.clone(),
                egui::FontId::proportional(11.0),
                sub_color,
                max_text_width,
            );
            sub_job.wrap.max_rows = 2;
            sub_job.wrap.overflow_character = Some('…');
            sub_job.wrap.break_anywhere = true;
            let sub_galley = ui.painter().layout_job(sub_job);
            let is_sub_truncated = sub_galley.elided;
            let h = 5.0 + title_galley.size().y + 2.0 + sub_galley.size().y + 5.0;
            (h.max(38.0), Some((sub_galley, is_sub_truncated)))
        } else {
            (28.0_f32, None)
        };

        let (row_rect, mut row_resp) = ui.allocate_exact_size(
            egui::vec2(ui.available_width(), row_height),
            egui::Sense::click(),
        );

        let is_sub_truncated = sub_layout
            .as_ref()
            .map_or(false, |(_, truncated)| *truncated);
        let has_subtitle = item
            .subtitle
            .as_ref()
            .map_or(false, |s| !s.is_empty() && s != &item.name);
        if is_title_truncated || is_sub_truncated || has_subtitle || item.tooltip.is_some() {
            let tooltip_text = item.tooltip.clone().unwrap_or_else(|| {
                if has_subtitle {
                    let sub = item.subtitle.as_deref().unwrap_or("");
                    format!("{}\n{}", item.name, sub)
                } else {
                    item.name.clone()
                }
            });
            row_resp = paint::hover_tip_at_pointer(row_resp, tooltip_text);
        }

        // Row background
        let bg_fill = if is_selected {
            Some(paint::color_alpha(palette.ui_link_soft, 32))
        } else if is_highlighted || row_resp.hovered() {
            Some(paint::color(palette.ui_accent_bg_soft))
        } else {
            None
        };

        let painter = ui.painter().with_clip_rect(row_rect);

        if let Some(fill) = bg_fill {
            painter.rect_filled(row_rect, egui::CornerRadius::same(2), fill);
        }

        let mut star_clicked = false;
        if self.show_favorites && !item.id.is_empty() {
            let star_center = egui::pos2(row_rect.left() + 14.0, row_rect.center().y);
            let star_box = egui::Rect::from_center_size(star_center, egui::vec2(22.0, 22.0));

            let hover_pos = ui.input(|i| i.pointer.hover_pos());
            let interact_pos = ui.input(|i| i.pointer.interact_pos());
            let is_star_hovered = hover_pos.is_some_and(|pos| star_box.contains(pos));
            let is_star_pressed = ui.input(|i| i.pointer.primary_clicked())
                && interact_pos.is_some_and(|pos| star_box.contains(pos));

            if is_star_hovered {
                ui.ctx().set_cursor_icon(egui::CursorIcon::PointingHand);
            }

            if is_star_pressed {
                star_clicked = true;
                picker::toggle_favorite_id(store, self.module_type, &item.id);
            }

            let star_color = if is_fav || is_star_hovered {
                paint::color(palette.ui_warn)
            } else {
                paint::color(palette.ui_text_dim)
            };

            draw_star(&painter, star_center, 6.5, star_color, is_fav);
        }

        let text_left = row_rect.left() + star_width;

        // Render label text
        if let Some((sub_galley, _)) = sub_layout {
            let title_pos = egui::pos2(text_left, row_rect.top() + 5.0);
            let title_h = title_galley.size().y;
            painter.galley(title_pos, title_galley, name_color);

            let sub_pos = egui::pos2(text_left, title_pos.y + title_h + 2.0);
            painter.galley(sub_pos, sub_galley, paint::color(palette.ui_text_subtle));
        } else {
            let text_pos = egui::pos2(text_left, row_rect.center().y - title_galley.size().y / 2.0);
            painter.galley(text_pos, title_galley, name_color);
        }

        if row_resp.hovered() && !star_clicked {
            ui.ctx().set_cursor_icon(egui::CursorIcon::PointingHand);
        }

        // Selection when clicking the row (outside the star button)
        if row_resp.clicked() && !star_clicked {
            egui::Popup::close_id(ui.ctx(), popup_id);
            Some(item.id.clone())
        } else {
            None
        }
    }
}

/// Draws a 5-pointed regular star (filled or outlined).
pub(crate) fn draw_star(
    painter: &egui::Painter,
    center: egui::Pos2,
    radius: f32,
    color: egui::Color32,
    filled: bool,
) {
    let inner_radius = radius * 0.42;
    let mut points = Vec::with_capacity(10);
    for i in 0..10 {
        let r = if i % 2 == 0 { radius } else { inner_radius };
        let angle = -std::f32::consts::FRAC_PI_2 + (i as f32) * (std::f32::consts::PI / 5.0);
        points.push(center + egui::vec2(angle.cos() * r, angle.sin() * r));
    }

    if filled {
        let mut mesh = egui::Mesh::default();
        mesh.colored_vertex(center, color);
        for p in &points {
            mesh.colored_vertex(*p, color);
        }
        for i in 0..10 {
            let next = (i + 1) % 10;
            mesh.add_triangle(0, (i + 1) as u32, (next + 1) as u32);
        }
        painter.add(egui::Shape::mesh(mesh));
    } else {
        painter.add(egui::Shape::closed_line(
            points,
            egui::Stroke::new(1.2_f32, color),
        ));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn sample_modules() -> Vec<InstalledModule> {
        vec![
            InstalledModule {
                id: "acf".into(),
                path: PathBuf::from("acf.bible"),
                kind: "bible".into(),
                name: "Almeida Corrigida Fiel".into(),
                short_title: Some("ACF".into()),
                description: Some("Almeida Corrigida Fiel 2011".into()),
            },
            InstalledModule {
                id: "naa".into(),
                path: PathBuf::from("naa.bible"),
                kind: "bible".into(),
                name: "Nova Almeida Atualizada".into(),
                short_title: Some("NAA".into()),
                description: None,
            },
            InstalledModule {
                id: "strong".into(),
                path: PathBuf::from("strong.dictionary"),
                kind: "dictionary".into(),
                name: "Strong's Exhaustive Dictionary".into(),
                short_title: Some("Strongs".into()),
                description: Some("Exhaustive Concordance".into()),
            },
            InstalledModule {
                id: "tske".into(),
                path: PathBuf::from("tske.crossreference"),
                kind: "crossreference".into(),
                name: "Treasury of Scripture Knowledge".into(),
                short_title: Some("TSK".into()),
                description: None,
            },
        ]
    }

    #[test]
    fn from_installed_filters_by_kind_and_extracts_subtitles() {
        let mods = sample_modules();
        let dd = ModuleDropdown::from_installed("test-salt", "bible", Some("acf"), &mods);
        assert_eq!(dd.salt, "test-salt");
        assert_eq!(dd.module_type, "bible");
        assert_eq!(dd.current_id, Some("acf"));
        assert_eq!(dd.items.len(), 2);

        // acf: name is "Almeida Corrigida Fiel", id is "acf" (different from name), so subtitle is "acf"
        assert_eq!(dd.items[0].id, "acf");
        assert_eq!(dd.items[0].name, "Almeida Corrigida Fiel");
        assert_eq!(dd.items[0].subtitle.as_deref(), Some("acf"));

        // naa: name is "Nova Almeida Atualizada", id is "naa", subtitle is "naa"
        assert_eq!(dd.items[1].id, "naa");
        assert_eq!(dd.items[1].subtitle.as_deref(), Some("naa"));
    }

    #[test]
    fn from_all_installed_includes_all_kinds() {
        let mods = sample_modules();
        let dd = ModuleDropdown::from_all_installed("all-salt", Some("tske"), &mods);
        assert_eq!(dd.items.len(), 4);
        assert_eq!(dd.module_type, "all");
        assert!(!dd.show_favorites);
    }

    #[test]
    fn builder_options_configure_dropdown() {
        let mods = sample_modules();
        let dd = ModuleDropdown::from_installed("salt", "dictionary", None, &mods)
            .allow_none(true)
            .none_label("Nenhum")
            .show_favorites(false)
            .width(300.0)
            .min_dropdown_width(260.0)
            .truncate_length(40);

        assert!(dd.allow_none);
        assert_eq!(dd.none_label, "Nenhum");
        assert!(!dd.show_favorites);
        assert_eq!(dd.width, Some(300.0));
        assert_eq!(dd.min_dropdown_width, 260.0);
        assert_eq!(dd.truncate_length, 40);
    }

    #[test]
    fn tooltip_includes_name_and_description() {
        let mods = sample_modules();
        let dd = ModuleDropdown::from_installed("test-salt", "bible", None, &mods);
        let acf_item = &dd.items[0];
        assert_eq!(acf_item.id, "acf");
        assert_eq!(acf_item.name, "Almeida Corrigida Fiel");
        // Tooltip includes name, subtitle (acf), and description (Almeida Corrigida Fiel 2011)
        let tooltip = acf_item.tooltip.as_deref().unwrap();
        assert!(tooltip.contains("Almeida Corrigida Fiel"));
        assert!(tooltip.contains("acf"));
        assert!(tooltip.contains("Almeida Corrigida Fiel 2011"));
    }

    #[test]
    fn from_items_configures_custom_dropdown_without_search() {
        let items = vec![
            DropdownItem::new("14", "14px"),
            DropdownItem::new("20", "20px"),
        ];
        let dd = ModuleDropdown::from_items("font-size", Some("20"), items);
        assert_eq!(dd.salt, "font-size");
        assert_eq!(dd.current_id, Some("20"));
        assert_eq!(dd.items.len(), 2);
        assert!(!dd.show_search);
        assert!(!dd.show_favorites);
        assert_eq!(dd.min_dropdown_width, 72.0);
        assert_eq!(dd.trigger_label(), "20px");
    }

    #[test]
    fn show_search_builder_can_toggle_search_box() {
        let items = vec![DropdownItem::new("pt", "PT")];
        let dd = ModuleDropdown::from_items("lang", Some("pt"), items).show_search(true);
        assert!(dd.show_search);
    }
}
