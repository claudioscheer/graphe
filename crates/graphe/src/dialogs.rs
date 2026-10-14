//! Settings, navigation, conversion, module editor, and preview windows.

use crate::app::{language_button, EditorTab, GrapheApp};
use crate::dropdown::ModuleDropdown;
use crate::paint;
use crate::session::Dialog;
use graphe_domain::books::{GRAPHE_BOOK_NUMBERS, NT_BOOK_OFFSET};
use graphe_domain::coverage::{build_coverage_cell, CoverageClass};
use graphe_domain::i18n;
use graphe_domain::navigation::NavScreen;
use graphe_domain::picker::PickerRow;
use graphe_domain::theme;
use graphe_store::catalog::InstalledModule;
use graphe_store::sqlite;
use serde_json::json;
use std::path::PathBuf;

fn coverage_fill(class: &CoverageClass, dark: bool) -> egui::Color32 {
    match (class, dark) {
        (CoverageClass::Full, false) => paint::color("#16a34a"),
        (CoverageClass::Full, true) => paint::color("#15803d"),
        (CoverageClass::Partial, false) => paint::color("#eab308"),
        (CoverageClass::Partial, true) => paint::color("#a16207"),
        (CoverageClass::None, false) => paint::color("#dc2626"),
        (CoverageClass::None, true) => paint::color("#991b1b"),
    }
}

const DICT_INFO_PAGE: i64 = 50;
const DICT_INFO_RANDOM: i64 = 20;

/// Browse state for the dictionary info modal. Loaded when the modal opens,
/// then again only when the prefix or the page changes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DictInfoState {
    pub(crate) module_id: String,
    path: PathBuf,
    title: String,
    subtitle: String,
    is_strong: bool,
    count: i64,
    random: Vec<String>,
    prefix: String,
    offset: i64,
    topics: Vec<String>,
}

struct DictInfoEdit {
    prefix: Option<String>,
    page_delta: i64,
    picked: Option<String>,
}

fn coverage_ink(class: &CoverageClass, dark: bool) -> egui::Color32 {
    match (class, dark) {
        (CoverageClass::Partial, false) => paint::color("#422006"),
        (CoverageClass::Partial, true) => paint::color("#fef9c3"),
        _ => egui::Color32::WHITE,
    }
}

impl GrapheApp {
    pub(crate) fn dialogs(&mut self, ctx: &egui::Context) {
        if self.session.dialog == Dialog::None {
            return;
        }
        let dark = self.session.dark;
        let mut dismiss = false;
        let modal_id = egui::Id::new("graphe-modal");
        // The stock modal fades in. That leaves the card half-visible for a
        // moment after the click. Show it at full strength on the first painted frame.
        let modal = egui::Modal::new(modal_id)
            .area(egui::Modal::default_area(modal_id).fade_in(false))
            .backdrop_color(egui::Color32::from_black_alpha(128))
            .frame(modal_frame(dark))
            .show(ctx, |ui| {
                self.prepare_modal_ui(ui);
                let screen_w = ui.ctx().content_rect().width().max(320.0);
                let width = self.dialog_width().min(screen_w * 0.92);
                ui.set_width(width);
                dismiss = self.dialog_card(ui);
                let card = ui.min_rect();
                #[cfg(test)]
                crate::chrome::mark_layout(ui, "modal-card", card);
                if self.modal_close_button(ui, card) {
                    dismiss = true;
                }
            });
        let popup = egui::Popup::is_any_open(ctx);
        let outside = modal.backdrop_response.clicked() && !popup;
        let escape = modal.is_top_modal
            && !modal.any_popup_open
            && ctx.input_mut(|input| input.consume_key(egui::Modifiers::NONE, egui::Key::Escape));
        if dismiss || outside || escape {
            self.close_dialog();
        }
    }

    fn close_dialog(&mut self) {
        self.session.dialog = Dialog::None;
        self.dict_info = None;
        self.nav = None;
        self.picker = None;
        self.editor.loaded = None;
    }

    fn dialog_width(&self) -> f32 {
        match self.session.dialog {
            Dialog::About => 380.0,
            Dialog::Settings | Dialog::Convert | Dialog::Picker => 520.0,
            Dialog::Navigation => 560.0,
            Dialog::ModuleEditor => 920.0,
            Dialog::Coverage => 620.0,
            Dialog::Preview | Dialog::AllCommentaries => 720.0,
            Dialog::DictInfo => 760.0,
            Dialog::None => 520.0,
        }
    }

    fn dialog_card(&mut self, ui: &mut egui::Ui) -> bool {
        match self.session.dialog {
            Dialog::Settings => self.settings_card(ui),
            Dialog::About => self.about_card(ui),
            Dialog::Navigation => self.navigation_body(ui),
            Dialog::Convert => self.convert_card(ui),
            Dialog::ModuleEditor => self.module_editor_card(ui),
            Dialog::Preview => {
                let title = if self.session.preview_title.is_empty() {
                    i18n::t("crossReferences")
                } else {
                    self.session.preview_title.clone()
                };
                self.preview_card(ui, &title)
            }
            Dialog::AllCommentaries => {
                let title = commentaries_title(&self.session.commentary_ref);
                self.growing_card(ui, &title, |app, ui| app.commentaries_body(ui))
            }
            Dialog::Coverage => {
                let title = i18n::t("commentaryCoverage");
                self.growing_card(ui, &title, |app, ui| app.coverage_body(ui))
            }
            Dialog::Picker => {
                let title = i18n::t("workbenchModules");
                self.titled_card(ui, &title, |app, ui| app.picker_body(ui))
            }
            Dialog::DictInfo => self.dict_info_card(ui),
            Dialog::None => false,
        }
    }

    /// The reference preview is one Bible row. The card grows to that row.
    /// A scrollbar appears only when the verse is taller than the screen.
    fn preview_card(&mut self, ui: &mut egui::Ui, title: &str) -> bool {
        self.header_bar(ui, title);
        let chrome = ui.min_rect().height();
        let cap = commentary_body_limit(ui.ctx().content_rect().height(), chrome);
        let inner = (ui.available_width() - 32.0).max(48.0);
        let row_h = self.preview_verse_height(ui, inner);
        let wanted = row_h + 32.0;
        let fits = wanted <= cap + 1.0;
        let max_h = if fits { wanted + 2.0 } else { cap };
        let output = egui::ScrollArea::vertical()
            .id_salt(("modal-scroll", "preview"))
            .max_height(max_h)
            .auto_shrink([false, true])
            .scroll_bar_visibility(if fits {
                egui::containers::scroll_area::ScrollBarVisibility::AlwaysHidden
            } else {
                egui::containers::scroll_area::ScrollBarVisibility::VisibleWhenNeeded
            })
            .scroll_source(egui::containers::scroll_area::ScrollSource {
                scroll_bar: !fits,
                drag: false,
                mouse_wheel: !fits,
            })
            .show(ui, |ui| {
                ui.set_min_width(ui.available_width());
                egui::Frame::new()
                    .inner_margin(egui::Margin::same(16))
                    .show(ui, |ui| {
                        self.paint_preview_verse(ui);
                    });
            });
        let shown = output.inner_rect.height();
        if fits && wanted > shown + 1.0 {
            ui.expand_to_include_y(output.inner_rect.top() + wanted);
            ui.ctx().request_repaint();
        }
        false
    }

    fn titled_card(
        &mut self,
        ui: &mut egui::Ui,
        title: &str,
        body: impl FnOnce(&mut Self, &mut egui::Ui),
    ) -> bool {
        self.header_bar(ui, title);
        let max_h = max_body(ui, 70.0);
        modal_scroll(ui, "titled", max_h, |ui| body(self, ui));
        false
    }

    /// Grow the card to its content, up to a margin from the screen edges.
    /// The modal otherwise keeps the short first-frame height, because its
    /// area size is whatever the scroll box used last frame. A very small
    /// screen still scrolls.
    fn growing_card(
        &mut self,
        ui: &mut egui::Ui,
        title: &str,
        body: impl FnOnce(&mut Self, &mut egui::Ui),
    ) -> bool {
        self.header_bar(ui, title);
        let chrome = ui.min_rect().height();
        let max_h = commentary_body_limit(ui.ctx().content_rect().height(), chrome);
        let output = modal_scroll(ui, "titled", max_h, |ui| body(self, ui));
        let shown = output.viewport.height();
        let wanted = output.content_height.min(max_h);
        if wanted > shown + 1.0 {
            ui.expand_to_include_y(output.viewport.top() + wanted);
            ui.ctx().request_repaint();
        }
        #[cfg(test)]
        crate::chrome::mark_layout(ui, "modal-scroll", output.viewport);
        false
    }

    pub(crate) fn open_dictionary_info(&mut self) {
        let Some(module) = self.active_dictionary().cloned() else {
            return;
        };
        let page =
            sqlite::dictionary_info_page(&module.path, "", DICT_INFO_PAGE, 0, DICT_INFO_RANDOM);
        self.session.dict_module_id = Some(module.id.clone());
        self.dict_info = Some(DictInfoState {
            title: truncate_chars(&module.name, 120),
            subtitle: module.id.clone(),
            module_id: module.id,
            path: module.path,
            is_strong: page.is_strong,
            count: page.count,
            random: page.random,
            prefix: String::new(),
            offset: 0,
            topics: page.topics,
        });
        self.session.dialog = Dialog::DictInfo;
    }

    fn active_dictionary(&self) -> Option<&InstalledModule> {
        if let Some(id) = self.session.dict_module_id.as_deref() {
            if let Some(module) = self
                .modules
                .iter()
                .find(|module| module.kind == "dictionary" && module.id == id)
            {
                return Some(module);
            }
        }
        self.modules
            .iter()
            .find(|module| module.kind == "dictionary")
    }

    fn dict_info_card(&mut self, ui: &mut egui::Ui) -> bool {
        let Some(info) = self.dict_info.clone() else {
            return true;
        };
        self.dict_info_header(ui, &info);
        let max_h = max_body(ui, 80.0);
        let mut edit = DictInfoEdit {
            prefix: None,
            page_delta: 0,
            picked: None,
        };
        let output = egui::ScrollArea::vertical()
            .id_salt("dict-info-body")
            .max_height(max_h)
            .auto_shrink([false, true])
            .show(ui, |ui| {
                ui.set_min_width(ui.available_width());
                egui::Frame::new()
                    .inner_margin(egui::Margin::same(14))
                    .show(ui, |ui| {
                        ui.spacing_mut().item_spacing.y = 14.0;
                        edit = self.dict_info_body(ui, &info);
                    });
            });
        // The shared modal area keeps last frame's height. Grow until the
        // pager and the topic list sit inside the card, then stop at the screen margin.
        let shown = output.inner_rect.height();
        let wanted = output.content_size.y.min(max_h);
        if wanted > shown + 1.0 {
            ui.expand_to_include_y(output.inner_rect.top() + wanted);
            ui.ctx().request_repaint();
        }
        if let Some(topic) = edit.picked {
            self.lookup_dict(&topic);
            return true;
        }
        self.apply_dict_info_edit(edit);
        false
    }

    fn apply_dict_info_edit(&mut self, edit: DictInfoEdit) {
        let reload = {
            let Some(info) = self.dict_info.as_mut() else {
                return;
            };
            let mut reload = false;
            if let Some(prefix) = edit.prefix {
                if prefix != info.prefix {
                    info.prefix = prefix;
                    info.offset = 0;
                    reload = true;
                }
            }
            if edit.page_delta != 0 && !reload {
                let next = (info.offset + edit.page_delta).max(0);
                if next != info.offset {
                    info.offset = next;
                    reload = true;
                }
            }
            if !reload {
                return;
            }
            (info.path.clone(), info.prefix.clone(), info.offset)
        };
        let topics =
            sqlite::dictionary_topics_page_in_file(&reload.0, &reload.1, DICT_INFO_PAGE, reload.2);
        if let Some(info) = self.dict_info.as_mut() {
            info.topics = topics;
        }
        // The list painted this frame still has the previous page.
    }

    fn dict_info_header(&self, ui: &mut egui::Ui, info: &DictInfoState) {
        let palette = theme::palette(self.session.dark);
        let text = paint::color(palette.ui_text);
        let muted = paint::color(palette.ui_text_muted);
        let border = hairline(self.session.dark, palette);
        let width = ui.available_width();
        let title_width = (width - 80.0).max(40.0);
        let title = fit_title(ui, &info.title, title_width, text, 18.0);
        let subtitle = fit_title(ui, &info.subtitle, title_width, muted, 12.0);
        let title_galley =
            ui.painter()
                .layout_no_wrap(title, egui::FontId::proportional(18.0), text);
        let sub_galley =
            ui.painter()
                .layout_no_wrap(subtitle, egui::FontId::proportional(12.0), muted);
        let height = 12.0 + title_galley.rect.height() + 3.0 + sub_galley.rect.height() + 12.0;
        let (rect, _) = ui.allocate_exact_size(egui::vec2(width, height), egui::Sense::hover());
        let title_pos = egui::pos2(rect.left() + 16.0, rect.top() + 12.0);
        let sub_pos = egui::pos2(
            rect.left() + 16.0,
            title_pos.y + title_galley.rect.height() + 3.0,
        );
        #[cfg(test)]
        crate::chrome::mark_layout(
            ui,
            "dict-info-title",
            egui::Rect::from_min_size(title_pos, title_galley.rect.size()),
        );
        #[cfg(test)]
        crate::chrome::mark_layout(
            ui,
            "dict-info-subtitle",
            egui::Rect::from_min_size(sub_pos, sub_galley.rect.size()),
        );
        ui.painter().galley(title_pos, title_galley, text);
        ui.painter().galley(sub_pos, sub_galley, muted);
        ui.painter().hline(
            rect.x_range(),
            rect.bottom() - 0.5,
            egui::Stroke::new(1.0_f32, border),
        );
    }

    fn dict_info_body(&self, ui: &mut egui::Ui, info: &DictInfoState) -> DictInfoEdit {
        let mut edit = DictInfoEdit {
            prefix: None,
            page_delta: 0,
            picked: None,
        };
        let dark = self.session.dark;
        let palette = theme::palette(dark);
        let kind = if info.is_strong {
            i18n::t("strongsDictionaries")
        } else {
            i18n::t("dictionary")
        };
        let usage = format!("{} ({kind})", i18n::t("dictUsageBody"));
        let count = i18n::t("dictTotalWords").replace("{count}", &info.count.to_string());
        info_section(ui, dark, "dictUsageTitle", "dict-info-usage", |ui| {
            ui.label(
                egui::RichText::new(usage)
                    .size(13.0)
                    .color(paint::color(palette.ui_text_muted)),
            );
        });
        let random = info.random.clone();
        info_section(
            ui,
            dark,
            "dictAvailableTitle",
            "dict-info-available",
            |ui| {
                ui.label(
                    egui::RichText::new(count)
                        .size(13.0)
                        .color(paint::color(palette.ui_text_muted)),
                );
                ui.label(
                    egui::RichText::new(i18n::t("dictRandomSample"))
                        .size(12.0)
                        .color(paint::color(palette.ui_text_muted)),
                );
                ui.horizontal_wrapped(|ui| {
                    ui.spacing_mut().item_spacing = egui::vec2(6.0, 6.0);
                    let text_hex = if dark {
                        palette.ui_link_softest
                    } else {
                        palette.ui_link
                    };
                    let fill_hex = if dark {
                        palette.ui_link_soft
                    } else {
                        palette.ui_link
                    };
                    for (index, topic) in random.iter().enumerate() {
                        let response = paint::cognate_chip(ui, topic, text_hex, fill_hex);
                        #[cfg(test)]
                        crate::chrome::mark_layout(
                            ui,
                            &format!("dict-info-chip:{index}:{topic}"),
                            response.rect,
                        );
                        #[cfg(not(test))]
                        let _ = index;
                        if response.clicked() && edit.picked.is_none() {
                            edit.picked = Some(topic.clone());
                        }
                    }
                });
            },
        );
        info_section(ui, dark, "dictBrowseTitle", "dict-info-browse", |ui| {
            let mut prefix = info.prefix.clone();
            let hint = paint::color(palette.ui_text_dim);
            let response = ui
                .scope(|ui| {
                    let visuals = &mut ui.style_mut().visuals;
                    visuals.weak_text_color = Some(hint);
                    visuals.extreme_bg_color = paint::color(if dark {
                        palette.ui_surface
                    } else {
                        palette.ui_bg
                    });
                    let border = egui::Stroke::new(1.0_f32, paint::color(palette.ui_border_soft));
                    let focus = egui::Stroke::new(1.0_f32, paint::color(palette.ui_border_strong));
                    visuals.widgets.inactive.bg_stroke = border;
                    visuals.widgets.hovered.bg_stroke = focus;
                    visuals.widgets.active.bg_stroke = focus;
                    let radius = egui::CornerRadius::same(4);
                    visuals.widgets.inactive.corner_radius = radius;
                    visuals.widgets.hovered.corner_radius = radius;
                    visuals.widgets.active.corner_radius = radius;
                    ui.add(
                        egui::TextEdit::singleline(&mut prefix)
                            .id(egui::Id::new("dict-info-prefix"))
                            .hint_text(
                                egui::RichText::new(i18n::t("dictBrowsePlaceholder"))
                                    .color(hint)
                                    .size(13.0),
                            )
                            .desired_width(ui.available_width())
                            .font(egui::FontId::proportional(13.0))
                            .margin(egui::Margin::symmetric(10, 8)),
                    )
                })
                .inner;
            #[cfg(test)]
            crate::chrome::mark_layout(ui, "dict-info-prefix", response.rect);
            #[cfg(not(test))]
            let _ = response;
            if prefix != info.prefix {
                edit.prefix = Some(prefix);
            }
            ui.add_space(8.0);
            if info.topics.is_empty() {
                ui.label(
                    egui::RichText::new(i18n::t("dictBrowseNoResults"))
                        .size(13.0)
                        .color(paint::color(palette.ui_text_muted)),
                );
            } else {
                egui::ScrollArea::vertical()
                    .id_salt(("dict-info-topics", &info.prefix, info.offset))
                    .max_height(240.0)
                    .auto_shrink([false, true])
                    .show(ui, |ui| {
                        ui.spacing_mut().item_spacing.y = 4.0;
                        ui.set_min_width(ui.available_width());
                        for topic in &info.topics {
                            if topic_row(ui, topic, dark).clicked() && edit.picked.is_none() {
                                edit.picked = Some(topic.clone());
                            }
                        }
                    });
            }
            ui.add_space(8.0);
            let can_prev = info.offset > 0;
            let can_next = info.topics.len() as i64 >= DICT_INFO_PAGE;
            let (row, _) = ui
                .allocate_exact_size(egui::vec2(ui.available_width(), 28.0), egui::Sense::hover());
            let next_rect = egui::Rect::from_min_size(
                egui::pos2(row.right() - 28.0, row.top()),
                egui::vec2(28.0, 28.0),
            );
            let prev_rect = egui::Rect::from_min_size(
                egui::pos2(row.right() - 62.0, row.top()),
                egui::vec2(28.0, 28.0),
            );
            if page_button(ui, prev_rect, "‹", can_prev, dark, "dict-info-prev") {
                edit.page_delta = -DICT_INFO_PAGE;
            }
            if page_button(ui, next_rect, "›", can_next, dark, "dict-info-next") {
                edit.page_delta = DICT_INFO_PAGE;
            }
        });
        edit
    }

    fn settings_card(&mut self, ui: &mut egui::Ui) -> bool {
        self.header_bar(ui, &i18n::t("settings"));
        // Hug the rows. A footer that takes the leftover height leaves a gap
        // under the last option when a taller modal used this area last.
        // Grow when the rows are taller than the area remembered from a shorter
        // dialog, or the cross-reference section sits past the bottom.
        let max_h = max_body(ui, 70.0);
        let output = modal_scroll(ui, "settings", max_h, |ui| self.settings_body(ui));
        let shown = output.viewport.height();
        let wanted = output.content_height.min(max_h);
        if wanted > shown + 1.0 {
            ui.expand_to_include_y(output.viewport.top() + wanted);
            ui.ctx().request_repaint();
        }
        false
    }

    fn coverage_body(&mut self, ui: &mut egui::Ui) {
        let module = self.session.coverage_module_id.clone().and_then(|id| {
            self.modules
                .iter()
                .find(|module| module.id == id && module.kind == "commentary")
                .cloned()
        });
        let Some(module) = module else {
            ui.label(i18n::t("commentaryUnavailable"));
            return;
        };
        let coverage = self.reading.coverage_map(&module.path);
        let dark = self.session.dark;
        let palette = theme::palette(dark);
        let subtle = paint::color(palette.ui_text_subtle);
        ui.horizontal(|ui| {
            ui.spacing_mut().item_spacing.x = 14.0;
            for (class, key) in [
                (CoverageClass::Full, "coverageFull"),
                (CoverageClass::Partial, "coveragePartial"),
                (CoverageClass::None, "coverageNone"),
            ] {
                ui.horizontal(|ui| {
                    let (rect, _) =
                        ui.allocate_exact_size(egui::vec2(12.0, 12.0), egui::Sense::hover());
                    ui.painter().rect_filled(
                        rect,
                        egui::CornerRadius::same(2),
                        coverage_fill(&class, dark),
                    );
                    ui.label(egui::RichText::new(i18n::t(key)).size(12.0).color(subtle));
                });
            }
        });
        ui.add_space(8.0);
        self.coverage_section(
            ui,
            "oldTestament",
            0,
            NT_BOOK_OFFSET,
            &coverage,
            dark,
            subtle,
        );
        ui.add_space(8.0);
        self.coverage_section(
            ui,
            "newTestament",
            NT_BOOK_OFFSET,
            GRAPHE_BOOK_NUMBERS.len(),
            &coverage,
            dark,
            subtle,
        );
    }

    fn coverage_section(
        &mut self,
        ui: &mut egui::Ui,
        title_key: &str,
        start: usize,
        end: usize,
        coverage: &std::collections::HashMap<i64, Vec<i64>>,
        dark: bool,
        subtle: egui::Color32,
    ) {
        ui.label(
            egui::RichText::new(i18n::t(title_key))
                .size(12.0)
                .strong()
                .color(subtle),
        );
        ui.add_space(4.0);
        ui.horizontal_wrapped(|ui| {
            ui.spacing_mut().item_spacing = egui::vec2(6.0, 6.0);
            for index in start..end {
                let number = i64::from(GRAPHE_BOOK_NUMBERS[index]);
                let cell = build_coverage_cell(number, index, coverage);
                let (rect, response) =
                    ui.allocate_exact_size(egui::vec2(52.0, 32.0), egui::Sense::hover());
                ui.painter().rect_filled(
                    rect,
                    egui::CornerRadius::same(2),
                    coverage_fill(&cell.class_name, dark),
                );
                let ink = coverage_ink(&cell.class_name, dark);
                let galley = ui.painter().layout_no_wrap(
                    cell.text.clone(),
                    egui::FontId::proportional(11.0),
                    ink,
                );
                ui.painter().galley(
                    egui::pos2(
                        rect.center().x - galley.rect.width() / 2.0,
                        rect.center().y - galley.rect.height() / 2.0,
                    ),
                    galley,
                    ink,
                );
                paint::hover_tip(response, cell.title);
            }
        });
    }

    fn settings_body(&mut self, ui: &mut egui::Ui) {
        ui.spacing_mut().item_spacing.y = 0.0;
        self.settings_row(ui, &i18n::t("theme"), &i18n::t("themeHint"), |app, ui| {
            let label = i18n::t(if app.session.dark { "dark" } else { "light" });
            let response = app.paper_button(ui, &label, PaperButton::Quiet);
            #[cfg(test)]
            crate::chrome::mark_layout(ui, "settings-theme", response.rect);
            if response.clicked() {
                app.session.dark = !app.session.dark;
                let theme = if app.session.dark { "dark" } else { "light" };
                app.patch_settings(json!({ "theme": theme }));
            }
        });
        ui.add_space(12.0);
        self.settings_row(
            ui,
            &i18n::t("fontSize"),
            &i18n::t("fontSizeHint"),
            |app, ui| {
                let current = px_label(app.session.font_size);
                let choices: Vec<(String, String)> = FONT_STEPS
                    .iter()
                    .map(|size| {
                        let id = (*size as i32).to_string();
                        (id.clone(), format!("{id}px"))
                    })
                    .collect();
                if let Some(picked) = app.mini_select(ui, "font-size", &current, &choices) {
                    if let Ok(size) = picked.parse::<f32>() {
                        app.session.font_size = size;
                        app.patch_settings(json!({ "fontSize": size }));
                    }
                }
            },
        );
        ui.add_space(12.0);
        self.settings_row(
            ui,
            &i18n::t("language"),
            &i18n::t("languageHint"),
            |app, ui| {
                let choices = [
                    ("pt".to_string(), "PT".to_string()),
                    ("en".to_string(), "EN".to_string()),
                    ("es".to_string(), "ES".to_string()),
                ];
                let current = language_button(i18n::get_current_lang()).to_string();
                if let Some(lang) = app.mini_select(ui, "language", &current, &choices) {
                    i18n::set_lang(&lang);
                    app.patch_settings(json!({ "language": lang }));
                    app.matcher_lang_dirty();
                }
            },
        );

        let has_dicts = self
            .modules
            .iter()
            .any(|module| module.kind == "dictionary");
        if has_dicts {
            self.group_rule(ui);
            let heading = self.section_heading(
                ui,
                &i18n::t("strongsDictionaries"),
                &i18n::t("strongsDictsHint"),
            );
            #[cfg(test)]
            crate::chrome::mark_layout(ui, "settings-strongs", heading);
            #[cfg(not(test))]
            let _ = heading;
            ui.add_space(8.0);
            self.module_combo_setting(ui, "dictionary", true);
        }

        let cross_refs: Vec<(String, String)> = self
            .modules
            .iter()
            .filter(|module| module.kind == "crossreference")
            .map(|module| (module.id.clone(), module.name.clone()))
            .collect();
        if !cross_refs.is_empty() {
            self.group_rule(ui);
            let heading = self.section_heading(
                ui,
                &i18n::t("crossReferences"),
                &i18n::t("crossRefModulesHint"),
            );
            #[cfg(test)]
            crate::chrome::mark_layout(ui, "settings-crossrefs", heading);
            #[cfg(not(test))]
            let _ = heading;
            ui.add_space(8.0);
            for (id, name) in &cross_refs {
                let checked = self.session.xref_modules.iter().any(|item| item == id);
                if self.check_option(ui, checked, name, None) {
                    self.toggle_xref(id);
                }
                ui.add_space(6.0);
            }
            ui.add_space(6.0);
            let pinned = self.session.preview_pinned;
            if self.check_option(
                ui,
                pinned,
                &i18n::t("crossRefPinnedModal"),
                Some(&i18n::t("crossRefPinnedModalHint")),
            ) {
                self.session.preview_pinned = !pinned;
                self.patch_settings(json!({ "openPinnedRefsInModal": !pinned }));
            }
            #[cfg(test)]
            crate::chrome::mark_layout(
                ui,
                "settings-crossrefs-end",
                egui::Rect::from_min_size(ui.cursor().min, egui::vec2(1.0, 1.0)),
            );
        }
    }

    fn toggle_xref(&mut self, id: &str) {
        let mut ids = self.session.xref_modules.clone();
        if let Some(index) = ids.iter().position(|item| item == id) {
            ids.remove(index);
        } else {
            ids.push(id.to_string());
        }
        self.session.xref_modules = ids.clone();
        let value = if ids.is_empty() {
            serde_json::Value::Null
        } else {
            json!(ids)
        };
        self.patch_settings(json!({ "crossRefModules": value }));
    }

    fn matcher_lang_dirty(&mut self) {
        self.matcher_lang.clear();
    }

    fn module_combo_setting(&mut self, ui: &mut egui::Ui, kind: &str, strongs: bool) {
        let palette = graphe_domain::theme::palette(self.session.dark);
        let current = if strongs {
            self.session.strongs_dicts.first().cloned()
        } else {
            self.session.xref_modules.first().cloned()
        };
        let salt = format!("settings-{kind}");
        let dropdown =
            ModuleDropdown::from_installed(&salt, kind, current.as_deref(), &self.modules)
                .allow_none(true)
                .none_label(i18n::t("coverageNone"))
                .show_favorites(false)
                .width(ui.available_width());

        if let Some(chosen_id) = dropdown.show(ui, &mut self.store, palette, self.session.dark) {
            let val = if chosen_id.is_empty() {
                None
            } else {
                Some(chosen_id)
            };
            if strongs {
                self.session.strongs_dicts = val.clone().into_iter().collect();
                self.patch_settings(json!({
                    "strongsDicts": val.map(|id| vec![id])
                }));
            } else {
                self.session.xref_modules = val.clone().into_iter().collect();
                self.patch_settings(json!({
                    "crossRefModules": val.map(|id| vec![id])
                }));
            }
        }
    }

    fn navigation_body(&mut self, ui: &mut egui::Ui) -> bool {
        if self.nav.is_none() {
            self.open_navigation();
        }
        self.nav_input_bar(ui);
        let screen = self.nav.as_ref().map(|nav| nav.screen.clone());
        let max_h = max_body(ui, 180.0);
        egui::ScrollArea::vertical()
            .id_salt("nav-grid")
            .max_height(max_h)
            .auto_shrink([false, true])
            .show(ui, |ui| {
                egui::Frame::new()
                    .inner_margin(egui::Margin::same(16))
                    .show(ui, |ui| match screen {
                        Some(NavScreen::Books { ot, nt }) => {
                            if !ot.is_empty() {
                                self.nav_section(ui, &i18n::t("oldTestament"));
                                self.nav_grid(ui, &ot, 5);
                            }
                            if !nt.is_empty() {
                                ui.add_space(8.0);
                                self.nav_section(ui, &i18n::t("newTestament"));
                                self.nav_grid(ui, &nt, 5);
                            }
                        }
                        Some(NavScreen::Chapters {
                            book_number,
                            title,
                            count,
                        }) => {
                            self.nav_heading(ui, &title);
                            let numbers: Vec<i64> = (1..=count).collect();
                            self.number_grid(ui, &numbers, 8, |nav, number| {
                                nav.select_chapter(book_number, number);
                            });
                        }
                        Some(NavScreen::Verses { title, verses, .. }) => {
                            self.nav_heading(ui, &title);
                            self.number_grid(ui, &verses, 8, |nav, number| {
                                nav.select_verse(number)
                            });
                        }
                        _ => {}
                    });
            });
        let back_visible = self.nav.as_ref().is_some_and(|nav| nav.back_visible);
        if !back_visible {
            return false;
        }
        let dark = self.session.dark;
        footer_shell(ui, dark, |ui| {
            if self.nav_footer_button(ui, &i18n::t("back"), true).clicked() {
                if let Some(nav) = self.nav.as_mut() {
                    nav.back();
                }
            }
            false
        })
    }

    fn nav_input_bar(&mut self, ui: &mut egui::Ui) {
        let palette = theme::palette(self.session.dark);
        let border = paint::color(if self.session.dark {
            palette.ui_border_strong
        } else {
            palette.ui_border
        });
        let width = ui.available_width();
        egui::Frame::new()
            .inner_margin(egui::Margin {
                left: 16,
                right: 48,
                top: 16,
                bottom: 16,
            })
            .show(ui, |ui| {
                ui.set_min_width((width - 64.0).max(0.0));
                let mut input = self
                    .nav
                    .as_ref()
                    .map(|nav| nav.input.clone())
                    .unwrap_or_default();
                let hint = paint::color(palette.ui_text_dim);
                let response = ui
                    .scope(|ui| {
                        let visuals = &mut ui.style_mut().visuals;
                        visuals.weak_text_color = Some(hint);
                        visuals.extreme_bg_color = paint::color(if self.session.dark {
                            palette.ui_surface
                        } else {
                            palette.ui_bg
                        });
                        let border = egui::Stroke::new(1.0_f32, hint);
                        let focus =
                            egui::Stroke::new(1.0_f32, paint::color(palette.ui_border_strong));
                        visuals.widgets.inactive.bg_stroke = border;
                        visuals.widgets.hovered.bg_stroke = focus;
                        visuals.widgets.active.bg_stroke = focus;
                        let radius = egui::CornerRadius::same(2);
                        visuals.widgets.inactive.corner_radius = radius;
                        visuals.widgets.hovered.corner_radius = radius;
                        visuals.widgets.active.corner_radius = radius;
                        ui.add(
                            egui::TextEdit::singleline(&mut input)
                                .id(ui.id().with("nav-input"))
                                .hint_text(
                                    egui::RichText::new(i18n::t("navPlaceholder"))
                                        .color(hint)
                                        .size(18.0),
                                )
                                .desired_width(ui.available_width())
                                .font(egui::FontId::proportional(18.0))
                                .margin(egui::Margin::symmetric(16, 12)),
                        )
                    })
                    .inner;
                #[cfg(test)]
                crate::chrome::mark_layout(ui, "nav-input", response.rect);
                if self.nav_focus {
                    response.request_focus();
                    self.nav_focus = false;
                }
                let submitted = response.lost_focus()
                    && ui.input(|input_state| input_state.key_pressed(egui::Key::Enter));
                if let Some(nav) = self.nav.as_mut() {
                    nav.input = input;
                    if submitted {
                        nav.submit_input();
                    }
                }
            });
        let (rect, _) = ui.allocate_exact_size(egui::vec2(width, 1.0), egui::Sense::hover());
        ui.painter().hline(
            rect.x_range(),
            rect.center().y,
            egui::Stroke::new(1.0_f32, border),
        );
    }

    fn nav_section(&self, ui: &mut egui::Ui, title: &str) {
        let palette = theme::palette(self.session.dark);
        let color = paint::color(if self.session.dark {
            palette.ui_text_subtle
        } else {
            palette.ui_border_stronger
        });
        ui.label(
            egui::RichText::new(title.to_uppercase())
                .size(12.0)
                .strong()
                .color(color),
        );
        ui.add_space(8.0);
    }

    fn nav_heading(&self, ui: &mut egui::Ui, title: &str) {
        let palette = theme::palette(self.session.dark);
        let color = paint::color(if self.session.dark {
            palette.ui_text
        } else {
            palette.ui_text_muted
        });
        ui.label(egui::RichText::new(title).size(14.0).strong().color(color));
        ui.add_space(12.0);
    }

    fn nav_grid(&mut self, ui: &mut egui::Ui, books: &[i64], columns: usize) {
        let labels: Vec<(String, i64, String)> = books
            .iter()
            .map(|number| {
                let label = self
                    .nav
                    .as_ref()
                    .map(|nav| nav.book_button_label(*number))
                    .unwrap_or_else(|| number.to_string());
                (label, *number, i18n::book_name(*number).long)
            })
            .collect();
        self.nav_tiles(ui, &labels, columns, 14.0, |nav, number| {
            nav.select_book(number);
        });
    }

    fn number_grid(
        &mut self,
        ui: &mut egui::Ui,
        numbers: &[i64],
        columns: usize,
        mut select: impl FnMut(&mut crate::app::LiveNav, i64),
    ) {
        let labels: Vec<(String, i64, String)> = numbers
            .iter()
            .map(|number| (number.to_string(), *number, String::new()))
            .collect();
        self.nav_tiles(ui, &labels, columns, 16.0, |nav, number| {
            select(nav, number);
        });
    }

    /// Cream tiles in a fixed column count, matching the Electron book and chapter grids.
    fn nav_tiles(
        &mut self,
        ui: &mut egui::Ui,
        items: &[(String, i64, String)],
        columns: usize,
        font: f32,
        mut select: impl FnMut(&mut crate::app::LiveNav, i64),
    ) {
        let columns = columns.max(1);
        let gap = 6.0;
        let width = ui.available_width().max(80.0);
        let cell_w = ((width - gap * (columns as f32 - 1.0)) / columns as f32).max(36.0);
        ui.spacing_mut().item_spacing.y = gap;
        for row in items.chunks(columns) {
            ui.horizontal(|ui| {
                ui.spacing_mut().item_spacing.x = gap;
                for (label, number, tip) in row {
                    let response = self.nav_tile(ui, label, cell_w, 44.0, font);
                    let response = if tip.is_empty() {
                        response
                    } else {
                        paint::hover_tip(response, tip)
                    };
                    if response.clicked() {
                        if let Some(nav) = self.nav.as_mut() {
                            select(nav, *number);
                        }
                    }
                }
            });
        }
    }

    fn nav_tile(
        &self,
        ui: &mut egui::Ui,
        label: &str,
        width: f32,
        height: f32,
        font: f32,
    ) -> egui::Response {
        let palette = theme::palette(self.session.dark);
        let (rect, response) =
            ui.allocate_exact_size(egui::vec2(width, height), egui::Sense::click());
        let fill = if self.session.dark {
            paint::color(if response.hovered() {
                "#454545"
            } else {
                "#333333"
            })
        } else {
            paint::color(if response.hovered() {
                palette.ui_accent_bg
            } else {
                palette.ui_surface_muted
            })
        };
        let ink = paint::color(if self.session.dark {
            palette.ui_text
        } else {
            palette.ui_link_strong
        });
        ui.painter()
            .rect_filled(rect, egui::CornerRadius::same(2), fill);
        let galley = egui::WidgetText::from(egui::RichText::new(label).size(font).color(ink))
            .into_galley(
                ui,
                Some(egui::TextWrapMode::Truncate),
                (width - 12.0).max(8.0),
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
        #[cfg(test)]
        crate::chrome::mark_layout(ui, &format!("nav-cell:{label}"), rect);
        response
    }

    fn nav_footer_button(&self, ui: &mut egui::Ui, label: &str, arrow: bool) -> egui::Response {
        let palette = theme::palette(self.session.dark);
        let dark = self.session.dark;
        let ink = paint::color(if dark {
            palette.ui_text
        } else {
            palette.ui_link_strong
        });
        let galley =
            ui.painter()
                .layout_no_wrap(label.to_string(), egui::FontId::proportional(14.0), ink);
        let icon_w = if arrow { 20.0 } else { 0.0 };
        let width = (galley.rect.width() + 32.0 + icon_w).max(72.0);
        let (rect, response) =
            ui.allocate_exact_size(egui::vec2(width, 36.0), egui::Sense::click());
        let fill = paint::color(if dark {
            if response.hovered() {
                "#454545"
            } else {
                "#333333"
            }
        } else if response.hovered() {
            palette.ui_border
        } else {
            palette.ui_accent_bg
        });
        ui.painter()
            .rect_filled(rect, egui::CornerRadius::same(2), fill);
        let content_w = galley.rect.width() + icon_w;
        let mut x = rect.center().x - content_w / 2.0;
        if arrow {
            paint::draw_icon(
                ui.painter(),
                egui::pos2(x + 8.0, rect.center().y),
                ink,
                paint::Icon::ArrowLeft,
            );
            x += icon_w;
        }
        ui.painter().galley(
            egui::pos2(x, rect.center().y - galley.rect.height() / 2.0),
            galley,
            ink,
        );
        if response.hovered() {
            ui.ctx().set_cursor_icon(egui::CursorIcon::PointingHand);
        }
        response
    }

    fn convert_card(&mut self, ui: &mut egui::Ui) -> bool {
        self.header_bar(ui, &i18n::t("convertModules"));
        let status = self.session.status.clone();
        let dark = self.session.dark;
        // Cap a long result list. The empty state is one paragraph, so the
        // scroll area shrinks to that instead of reserving most of the screen.
        let max_h = commentary_body_limit(
            ui.ctx().content_rect().height(),
            ui.min_rect().height() + 72.0,
        );
        modal_scroll(ui, "convert", max_h, |ui| {
            let palette = theme::palette(self.session.dark);
            // Electron uses text-sm text-brand-600 (light) / night-300 (dark).
            let hint = paint::color(if self.session.dark {
                palette.ui_text_subtle
            } else {
                palette.ui_border_stronger
            });
            let desc = ui.label(
                egui::RichText::new(i18n::t("convertModulesDesc"))
                    .size(14.0)
                    .color(hint),
            );
            #[cfg(test)]
            crate::chrome::mark_layout(ui, "convert-desc", desc.rect);
            #[cfg(not(test))]
            let _ = desc;
            if !status.is_empty() {
                ui.add_space(8.0);
                ui.label(egui::RichText::new(status).size(12.0).color(hint));
            }
        });
        let clicked = footer_shell(ui, dark, |ui| {
            // `with_layout` claims every pixel left in the modal. After a taller
            // dialog the shared area is still tall, so the buttons float in the
            // middle of that leftover. Ask only for the button row.
            let row_width = ui.available_width();
            ui.allocate_ui_with_layout(
                egui::vec2(row_width, 36.0),
                egui::Layout::left_to_right(egui::Align::Center),
                |ui| {
                    let install = self.session.convert_install;
                    if self.check_option(ui, install, &i18n::t("installAfterConvert"), None) {
                        self.session.convert_install = !install;
                    }
                    ui.with_layout(
                        egui::Layout::right_to_left(egui::Align::Center),
                        |ui| {
                            ui.spacing_mut().item_spacing.x = 8.0;
                            let folder =
                                self.paper_button(ui, &i18n::t("selectFolder"), PaperButton::Outline);
                            let files =
                                self.paper_button(ui, &i18n::t("selectFiles"), PaperButton::Primary);
                            #[cfg(test)]
                            {
                                crate::chrome::mark_layout(ui, "convert-folder", folder.rect);
                                crate::chrome::mark_layout(ui, "convert-files", files.rect);
                            }
                            if folder.clicked() {
                                if let Some(dir) = rfd::FileDialog::new().pick_folder() {
                                    self.convert_paths(convertible_in_folder(&dir));
                                }
                            }
                            if files.clicked() {
                                if let Some(paths) = rfd::FileDialog::new().pick_files() {
                                    self.convert_paths(paths);
                                }
                            }
                        },
                    );
                },
            );
            false
        });
        clicked
    }

    fn convert_paths(&mut self, files: Vec<std::path::PathBuf>) {
        if files.is_empty() {
            return;
        }
        let global_dir = graphe_store::state::modules_dir(&graphe_store::state::user_home());
        let _ = std::fs::create_dir_all(&global_dir);
        let mut notes = Vec::new();
        let install = self.session.convert_install;
        for file in files {
            let out_dir = file.parent().unwrap_or(&global_dir);
            match graphe_store::convert::convert_file(&file, out_dir) {
                Ok(path) => {
                    let mut note = path.display().to_string();
                    if install {
                        if let Some(file_name) = path.file_name() {
                            let dest = global_dir.join(file_name);
                            if dest != path {
                                let _ = std::fs::copy(&path, &dest);
                            }
                        }
                        note.push_str(" (");
                        note.push_str(&i18n::t("installConverted"));
                        note.push(')');
                    }
                    notes.push(note);
                }
                Err(err) => notes.push(err.0),
            }
        }
        self.session.status = notes.join("\n");
        if install {
            self.reload_modules();
        }
    }

    fn picker_body(&mut self, ui: &mut egui::Ui) {
        if self.picker.is_none() {
            self.open_picker();
        }
        let palette = graphe_domain::theme::palette(self.session.dark);
        let mut search = self
            .picker
            .as_ref()
            .map(|picker| picker.search.clone())
            .unwrap_or_default();
        if ui.text_edit_singleline(&mut search).changed() {
            if let Some(picker) = self.picker.as_mut() {
                picker.set_search(&self.store, &search);
            }
        }
        let rows = self
            .picker
            .as_ref()
            .map(|picker| picker.rows.clone())
            .unwrap_or_default();
        for (index, row) in rows.iter().enumerate() {
            match row {
                PickerRow::Divider => {
                    ui.separator();
                }
                PickerRow::Item {
                    id,
                    name,
                    subtitle,
                    is_fav,
                    highlighted,
                    ..
                } => {
                    ui.horizontal(|ui| {
                        let (star_rect, star_resp) =
                            ui.allocate_exact_size(egui::vec2(20.0, 24.0), egui::Sense::click());
                        let star_color = if *is_fav || star_resp.hovered() {
                            paint::color(palette.ui_warn)
                        } else {
                            paint::color(palette.ui_text_dim)
                        };
                        crate::dropdown::draw_star(
                            ui.painter(),
                            star_rect.center(),
                            6.0,
                            star_color,
                            *is_fav,
                        );
                        if star_resp.clicked() {
                            let module_id = id.clone();
                            let mut picker = self.picker.take();
                            if let Some(picker) = picker.as_mut() {
                                picker.toggle_favorite(&mut self.store, &module_id);
                            }
                            self.picker = picker;
                        }

                        ui.vertical(|ui| {
                            if ui.selectable_label(*highlighted, name).clicked() {
                                if let Some(picker) = self.picker.as_mut() {
                                    picker.click_index(index);
                                }
                            }
                            if let Some(sub) = subtitle {
                                ui.label(
                                    egui::RichText::new(sub)
                                        .size(11.0)
                                        .color(paint::color(palette.ui_text_subtle)),
                                );
                            }
                        });
                    });
                }
            }
        }
    }

    fn module_editor_card(&mut self, ui: &mut egui::Ui) -> bool {
        if self.editor_path.is_none() {
            self.editor_path = self.modules.first().map(|module| module.path.clone());
        }
        self.load_editor();
        let subtitle = module_kind_label(&self.editor_kind());
        self.editor_header(ui, &subtitle);
        let deleted = self.editor_toolbar(ui);
        self.editor_tabs(ui);
        let chrome = ui.min_rect().height() + 36.0;
        let max_h = commentary_body_limit(ui.ctx().content_rect().height(), chrome);
        let output = modal_scroll(ui, "editor", max_h, |ui| {
            ui.spacing_mut().item_spacing.y = 6.0;
            self.editor_tab_body(ui);
        });
        let shown = output.viewport.height();
        let wanted = output.content_height.min(max_h);
        if wanted > shown + 1.0 {
            ui.expand_to_include_y(output.viewport.top() + wanted);
            ui.ctx().request_repaint();
        }
        #[cfg(test)]
        crate::chrome::mark_layout(ui, "modal-scroll", output.viewport);
        self.editor_status_line(ui);
        deleted
    }

    fn editor_kind(&self) -> String {
        self.editor_path
            .as_ref()
            .and_then(|path| {
                self.modules
                    .iter()
                    .find(|module| &module.path == path)
                    .map(|module| module.kind.clone())
            })
            .unwrap_or_default()
    }

    fn load_editor(&mut self) {
        let Some(path) = self.editor_path.clone() else {
            self.editor.loaded = None;
            return;
        };
        if self.editor.loaded.as_ref() == Some(&path) {
            return;
        }
        let rows = sqlite::info_in_file(&path);
        let value = |name: &str| -> String {
            rows.iter()
                .find(|(key, _)| key == name)
                .map(|(_, item)| item.clone())
                .unwrap_or_default()
        };
        self.editor.description = value("description");
        self.editor.language = value("language");
        if rows.iter().any(|(key, _)| key == "short.title") {
            self.editor.short_key = "short.title".into();
            self.editor.short_title = value("short.title");
        } else if rows.iter().any(|(key, _)| key == "short_title") {
            self.editor.short_key = "short_title".into();
            self.editor.short_title = value("short_title");
        } else {
            self.editor.short_key = "short.title".into();
            self.editor.short_title.clear();
        }
        self.editor.strong = value("strong_numbers").eq_ignore_ascii_case("true");
        self.editor.extras = rows
            .into_iter()
            .filter(|(key, _)| !known_info_key(key))
            .collect();
        self.editor.deleted_extras.clear();
        self.editor.tables = sqlite::tables_in_file(&path);
        self.editor.books = sqlite::editable_books_in_file(&path);
        if self.editor.books.is_empty() && self.editor.tables.verses {
            self.editor.books = sqlite::chapter_spans_in_file(&path)
                .into_iter()
                .map(|(book_number, _)| sqlite::EditableBook {
                    book_number,
                    short_name: None,
                    long_name: None,
                    title: None,
                    is_present: 1,
                    source_table: "verses",
                })
                .collect();
        }
        if self
            .editor
            .books
            .iter()
            .all(|book| book.book_number.to_string() != self.editor.book)
        {
            if let Some(book) = self.editor.books.first() {
                self.editor.book = book.book_number.to_string();
            }
        }
        self.hydrate_book_names();
        self.editor.verse_cache_key.clear();
        self.editor.passage_key.clear();
        self.editor.loaded = Some(path);
        self.editor.armed = false;
        self.editor.status.clear();
        self.editor.status_ok = true;
        let tabs = self.editor_tabs_available();
        if !tabs.contains(&self.editor.tab) {
            self.editor.tab = tabs.first().copied().unwrap_or(EditorTab::Info);
        }
    }

    fn editor_tabs_available(&self) -> Vec<EditorTab> {
        let mut tabs = Vec::new();
        if self.editor.tables.info {
            tabs.push(EditorTab::Info);
        }
        if self.editor.tables.books || self.editor.tables.books_all {
            tabs.push(EditorTab::Books);
        }
        if self.editor.tables.verses {
            tabs.push(EditorTab::Verses);
        }
        if self.editor.tables.commentaries {
            tabs.push(EditorTab::Commentaries);
        }
        tabs
    }

    fn hydrate_book_names(&mut self) {
        let names = self
            .editor
            .books
            .iter()
            .find(|book| book.book_number.to_string() == self.editor.book)
            .map(|book| {
                (
                    book.short_name.clone().unwrap_or_default(),
                    book.long_name.clone().unwrap_or_default(),
                )
            });
        if let Some((short_name, long_name)) = names {
            self.editor.short_name = short_name;
            self.editor.long_name = long_name;
        }
    }

    fn editor_header(&self, ui: &mut egui::Ui, subtitle: &str) {
        let palette = theme::palette(self.session.dark);
        let text = paint::color(palette.ui_text);
        let subtle = paint::color(palette.ui_text_subtle);
        let border = hairline(self.session.dark, palette);
        let width = ui.available_width();
        let height = if subtitle.is_empty() { 57.0 } else { 72.0 };
        let (rect, _) = ui.allocate_exact_size(egui::vec2(width, height), egui::Sense::hover());
        let title = fit_title(
            ui,
            &i18n::t("editModuleData"),
            (rect.width() - 64.0).max(40.0),
            text,
            18.0,
        );
        let title_galley =
            ui.painter()
                .layout_no_wrap(title, egui::FontId::proportional(18.0), text);
        let title_y = if subtitle.is_empty() {
            rect.center().y - title_galley.rect.height() / 2.0
        } else {
            rect.top() + 14.0
        };
        ui.painter()
            .galley(egui::pos2(rect.left() + 16.0, title_y), title_galley, text);
        if !subtitle.is_empty() {
            let sub = ui.painter().layout_no_wrap(
                subtitle.to_string(),
                egui::FontId::proportional(13.0),
                subtle,
            );
            ui.painter().galley(
                egui::pos2(rect.left() + 16.0, rect.bottom() - 12.0 - sub.rect.height()),
                sub,
                subtle,
            );
        }
        ui.painter().hline(
            rect.x_range(),
            rect.bottom() - 0.5,
            egui::Stroke::new(1.0_f32, border),
        );
        #[cfg(test)]
        crate::chrome::mark_layout(ui, "modal-header", rect);
    }

    fn editor_toolbar(&mut self, ui: &mut egui::Ui) -> bool {
        let palette = theme::palette(self.session.dark);
        let dark = self.session.dark;
        let width = ui.available_width();
        let mut deleted = false;
        egui::Frame::new()
            .inner_margin(egui::Margin::symmetric(16, 12))
            .show(ui, |ui| {
                ui.set_min_width((width - 32.0).max(0.0));
                ui.horizontal(|ui| {
                    ui.spacing_mut().item_spacing.x = 10.0;
                    let delete_label = if self.editor.armed {
                        i18n::t("confirmDeleteModule")
                    } else {
                        i18n::t("deleteModule")
                    };
                    let delete_w = delete_button_width(ui, &delete_label);
                    let dropdown_w = (ui.available_width() - delete_w - 80.0).clamp(160.0, 360.0);
                    let current_owned = self.editor_path.as_ref().and_then(|path| {
                        self.modules
                            .iter()
                            .find(|module| &module.path == path)
                            .map(|module| module.id.clone())
                    });
                    let dropdown = ModuleDropdown::from_all_installed(
                        "editor-module",
                        current_owned.as_deref(),
                        &self.modules,
                    )
                    .show_favorites(false)
                    .width(dropdown_w);
                    if let Some(id) = dropdown.show(ui, &mut self.store, palette, dark) {
                        if let Some(module) = self.modules.iter().find(|module| module.id == id) {
                            if self.editor_path.as_ref() != Some(&module.path) {
                                self.editor_path = Some(module.path.clone());
                                self.editor.loaded = None;
                                self.editor.armed = false;
                                self.load_editor();
                            }
                        }
                    }
                    let path_w = (ui.available_width() - delete_w - 10.0).max(24.0);
                    self.editor_path_label(ui, path_w);
                    if delete_module_button(ui, &delete_label).clicked() {
                        deleted = self.confirm_delete_module();
                    }
                });
            });
        editor_rule(ui, dark);
        deleted
    }

    fn editor_path_label(&self, ui: &mut egui::Ui, width: f32) {
        let palette = theme::palette(self.session.dark);
        let color = paint::color(palette.ui_text_subtle);
        let path = self
            .editor_path
            .as_ref()
            .map(|path| path.display().to_string())
            .unwrap_or_default();
        let (rect, response) =
            ui.allocate_exact_size(egui::vec2(width, 36.0), egui::Sense::hover());
        let font = egui::FontId::proportional(12.0);
        let shown = ellipsize_start(
            ui,
            &path,
            (rect.width() - 4.0).max(0.0),
            font.clone(),
            color,
        );
        let galley = ui.painter().layout_no_wrap(shown, font, color);
        ui.painter().galley(
            egui::pos2(rect.left(), rect.center().y - galley.rect.height() / 2.0),
            galley,
            color,
        );
        if !path.is_empty() {
            let _ = response.on_hover_text(path);
        }
        #[cfg(test)]
        crate::chrome::mark_layout(ui, "editor-path", rect);
    }

    fn confirm_delete_module(&mut self) -> bool {
        if !self.editor.armed {
            self.editor.armed = true;
            return false;
        }
        let Some(path) = self.editor_path.clone() else {
            return false;
        };
        if graphe_store::catalog::delete_module(&path).is_ok() {
            self.editor_path = None;
            self.editor = crate::app::ModuleEditorForm::default();
            self.reload_modules();
            self.session.dialog = Dialog::None;
            true
        } else {
            self.editor.status = i18n::t("saveFailed");
            self.editor.status_ok = false;
            self.editor.armed = false;
            false
        }
    }

    fn editor_tabs(&mut self, ui: &mut egui::Ui) {
        let tabs = self.editor_tabs_available();
        if tabs.is_empty() {
            return;
        }
        let dark = self.session.dark;
        let width = ui.available_width();
        egui::Frame::new()
            .inner_margin(egui::Margin::symmetric(16, 10))
            .show(ui, |ui| {
                ui.set_min_width((width - 32.0).max(0.0));
                ui.horizontal(|ui| {
                    ui.spacing_mut().item_spacing.x = 6.0;
                    for tab in tabs {
                        let active = self.editor.tab == tab;
                        if tab_button(ui, dark, &editor_tab_label(tab), active).clicked() {
                            self.editor.tab = tab;
                        }
                    }
                });
            });
        editor_rule(ui, dark);
    }

    fn editor_tab_body(&mut self, ui: &mut egui::Ui) {
        if self.editor_path.is_none() {
            ui.label(i18n::t("noModules"));
            return;
        }
        if self.editor_tabs_available().is_empty() {
            ui.label(i18n::t("moduleNothing"));
            return;
        }
        match self.editor.tab {
            EditorTab::Info => self.editor_info_tab(ui),
            EditorTab::Books => self.editor_books_tab(ui),
            EditorTab::Verses => self.editor_verses_tab(ui),
            EditorTab::Commentaries => self.editor_commentaries_tab(ui),
        }
    }

    fn editor_info_tab(&mut self, ui: &mut egui::Ui) {
        let dark = self.session.dark;
        form_label(ui, dark, &i18n::t("moduleDescription"));
        form_area(ui, &mut self.editor.description, 4, "editor-description");
        ui.add_space(6.0);
        form_label(ui, dark, &i18n::t("moduleLanguage"));
        form_line(ui, &mut self.editor.language, "editor-language");
        ui.add_space(6.0);
        form_label(ui, dark, &i18n::t("moduleShortTitle"));
        form_line(ui, &mut self.editor.short_title, "editor-short-title");
        ui.add_space(6.0);
        let palette = theme::palette(dark);
        let mut to_remove = None;
        for (index, (key, value)) in self.editor.extras.iter_mut().enumerate() {
            let label = info_field_label(key);
            let mark = format!("editor-extra:{}", key);
            ui.horizontal(|ui| {
                form_label(ui, dark, &label);
                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    let del_btn = ui.add(
                        egui::Button::new(
                            egui::RichText::new("×")
                                .size(16.0)
                                .color(paint::color(palette.ui_text_subtle)),
                        )
                        .frame(false),
                    );
                    if del_btn.on_hover_text(i18n::t("deleteRow")).clicked() {
                        to_remove = Some(index);
                    }
                });
            });
            form_line(ui, value, &mark);
            ui.add_space(6.0);
        }
        if let Some(index) = to_remove {
            let removed = self.editor.extras.remove(index);
            self.editor.deleted_extras.push(removed.0);
        }
        ui.add_space(4.0);
        let strong = self.editor.strong;
        if self.check_option(ui, strong, &i18n::t("moduleStrongNumbers"), None) {
            self.editor.strong = !strong;
        }
        ui.add_space(10.0);
        if fill_button(ui, dark, &i18n::t("saveInfo"), "editor-save").clicked() {
            self.save_module_editor_info();
        }
    }

    pub(crate) fn save_module_editor_info(&mut self) {
        let Some(path) = self.editor_path.clone() else {
            return;
        };
        for name in &self.editor.deleted_extras {
            if let Err(err) = sqlite::delete_info(&path, name) {
                self.note_editor_result(Err(err), "");
                return;
            }
        }
        let mut rows = vec![
            ("description".to_string(), self.editor.description.clone()),
            ("language".to_string(), self.editor.language.clone()),
            (
                self.editor.short_key.clone(),
                self.editor.short_title.clone(),
            ),
            (
                "strong_numbers".to_string(),
                if self.editor.strong {
                    "true".to_string()
                } else {
                    "false".to_string()
                },
            ),
        ];
        rows.extend(self.editor.extras.iter().cloned());
        for (name, value) in &rows {
            if let Err(err) = sqlite::write_info(&path, name, value) {
                self.note_editor_result(Err(err), "");
                return;
            }
        }
        self.editor.deleted_extras.clear();
        self.note_editor_result(Ok(()), &i18n::t("savedModuleInfo"));
        self.reload_modules();
    }

    fn editor_books_tab(&mut self, ui: &mut egui::Ui) {
        let dark = self.session.dark;
        if self.editor.books.is_empty() {
            ui.label(i18n::t("noEditableBooks"));
            return;
        }
        self.book_select(ui, "editor-book");
        form_label(ui, dark, &i18n::t("moduleShortName"));
        form_line(ui, &mut self.editor.short_name, "editor-short-name");
        ui.add_space(6.0);
        form_label(ui, dark, &i18n::t("moduleLongName"));
        form_line(ui, &mut self.editor.long_name, "editor-long-name");
        ui.add_space(10.0);
        if fill_button(ui, dark, &i18n::t("saveBook"), "editor-save-book").clicked() {
            self.save_editor_book();
        }
    }

    fn save_editor_book(&mut self) {
        let Some(path) = self.editor_path.clone() else {
            return;
        };
        let Ok(book) = self.editor.book.parse::<i64>() else {
            self.editor.status = i18n::t("selectBookFirst");
            self.editor.status_ok = false;
            return;
        };
        let result = sqlite::write_book_names(
            &path,
            book,
            Some(&self.editor.short_name),
            Some(&self.editor.long_name),
        );
        if result.is_ok() {
            if let Some(row) = self
                .editor
                .books
                .iter_mut()
                .find(|row| row.book_number == book)
            {
                row.short_name = Some(self.editor.short_name.clone());
                row.long_name = Some(self.editor.long_name.clone());
            }
        }
        self.note_editor_result(result, &i18n::t("savedBook"));
    }

    fn editor_verses_tab(&mut self, ui: &mut egui::Ui) {
        let dark = self.session.dark;
        if self.editor.books.is_empty() {
            ui.label(i18n::t("noBooksFound"));
            return;
        }
        if self.book_select(ui, "editor-verse-book") {
            self.editor.verse_cache_key.clear();
            self.editor.passage_key.clear();
        }
        self.refresh_editor_verses();
        let chapters: Vec<(String, String)> = (1..=self.editor.chapter_count.max(1))
            .take(self.editor.chapter_count.max(0) as usize)
            .map(|chapter| {
                let label = chapter.to_string();
                (label.clone(), label)
            })
            .collect();
        let chapter_now = self.editor.chapter.clone();
        if let Some(chapter) = numbered_select(
            ui,
            dark,
            "editor-chapter",
            &i18n::t("moduleChapter"),
            &chapter_now,
            &chapters,
        ) {
            self.editor.chapter = chapter;
            self.editor.verse_cache_key.clear();
            self.editor.passage_key.clear();
            self.refresh_editor_verses();
        }
        let verses: Vec<(String, String)> = self
            .editor
            .verse_numbers
            .iter()
            .map(|verse| {
                let label = verse.to_string();
                (label.clone(), label)
            })
            .collect();
        let verse_now = self.editor.verse.clone();
        if let Some(verse) = numbered_select(
            ui,
            dark,
            "editor-verse",
            &i18n::t("moduleVerse"),
            &verse_now,
            &verses,
        ) {
            self.editor.verse = verse;
            self.editor.passage_key.clear();
        }
        self.load_editor_verse();
        form_label(ui, dark, &i18n::t("moduleText"));
        form_area(ui, &mut self.editor.verse_text, 8, "editor-verse-text");
        ui.add_space(10.0);
        if fill_button(ui, dark, &i18n::t("saveVerse"), "editor-save-verse").clicked() {
            self.save_editor_verse();
        }
    }

    fn refresh_editor_verses(&mut self) {
        let Some(path) = self.editor_path.clone() else {
            return;
        };
        let book = self.editor.book.parse::<i64>().unwrap_or(0);
        let chapter = self.editor.chapter.parse::<i64>().unwrap_or(1).max(1);
        let key = format!("{book}:{chapter}");
        if self.editor.verse_cache_key == key {
            return;
        }
        self.editor.chapter_count = sqlite::chapter_count_in_file(&path, book);
        let chapter = if self.editor.chapter_count > 0 {
            chapter.min(self.editor.chapter_count)
        } else {
            chapter
        };
        self.editor.chapter = chapter.to_string();
        self.editor.verse_numbers = sqlite::chapter_in_file(&path, book, chapter)
            .into_iter()
            .map(|row| row.verse)
            .collect();
        self.editor.verse_cache_key = format!("{book}:{chapter}");
        if !self
            .editor
            .verse_numbers
            .iter()
            .any(|verse| verse.to_string() == self.editor.verse)
        {
            if let Some(first) = self.editor.verse_numbers.first() {
                self.editor.verse = first.to_string();
                self.editor.passage_key.clear();
            }
        }
    }

    fn load_editor_verse(&mut self) {
        let Some(path) = self.editor_path.clone() else {
            return;
        };
        let Some((book, chapter, verse)) = self.editor_passage() else {
            return;
        };
        let key = format!("{book}:{chapter}:{verse}");
        if self.editor.passage_key == key {
            return;
        }
        self.editor.passage_key = key;
        if let Some(record) = sqlite::chapter_in_file(&path, book, chapter)
            .into_iter()
            .find(|row| row.verse == verse)
        {
            self.editor.verse_text = record.text;
        } else {
            self.editor.verse_text.clear();
        }
    }

    fn save_editor_verse(&mut self) {
        let Some(path) = self.editor_path.clone() else {
            return;
        };
        let Some((book, chapter, verse)) = self.editor_passage() else {
            self.editor.status = i18n::t("choosePassageFirst");
            self.editor.status_ok = false;
            return;
        };
        let result = sqlite::write_verse_text(&path, book, chapter, verse, &self.editor.verse_text);
        if result.is_ok() {
            self.reading.clear();
            self.loaded_key.clear();
        }
        self.note_editor_result(result, &i18n::t("savedVerse"));
    }

    fn editor_commentaries_tab(&mut self, ui: &mut egui::Ui) {
        let dark = self.session.dark;
        if self.editor.books.is_empty() {
            ui.label(i18n::t("noBooksFound"));
            return;
        }
        self.book_select(ui, "editor-commentary-book");
        form_label(ui, dark, &i18n::t("moduleChapter"));
        form_line(ui, &mut self.editor.chapter, "editor-commentary-chapter");
        ui.add_space(6.0);
        form_label(ui, dark, &i18n::t("moduleVerseFrom"));
        form_line(ui, &mut self.editor.verse, "editor-commentary-verse");
        ui.add_space(6.0);
        form_label(ui, dark, &i18n::t("moduleText"));
        form_area(
            ui,
            &mut self.editor.commentary_text,
            8,
            "editor-commentary-text",
        );
        ui.add_space(10.0);
        ui.horizontal(|ui| {
            ui.spacing_mut().item_spacing.x = 8.0;
            if self
                .paper_button(ui, &i18n::t("loadCommentary"), PaperButton::Outline)
                .clicked()
            {
                self.load_editor_commentary();
            }
            if self
                .paper_button(ui, &i18n::t("saveCommentary"), PaperButton::Quiet)
                .clicked()
            {
                self.save_editor_commentary();
            }
        });
    }

    fn load_editor_commentary(&mut self) {
        let Some(path) = self.editor_path.clone() else {
            return;
        };
        let Some((book, chapter, verse)) = self.editor_passage() else {
            self.editor.status = i18n::t("choosePassageFirst");
            self.editor.status_ok = false;
            return;
        };
        if let Some(entry) = sqlite::commentary_in_file(&path, book, chapter)
            .into_iter()
            .find(|entry| entry.verse_from == verse)
        {
            self.editor.commentary_text = entry.text;
            self.editor.status.clear();
            self.editor.status_ok = true;
        } else {
            self.editor.commentary_text.clear();
            self.editor.status = i18n::t("moduleEntryMissing");
            self.editor.status_ok = false;
        }
    }

    fn save_editor_commentary(&mut self) {
        let Some(path) = self.editor_path.clone() else {
            return;
        };
        let Some((book, chapter, verse)) = self.editor_passage() else {
            self.editor.status = i18n::t("choosePassageFirst");
            self.editor.status_ok = false;
            return;
        };
        let result = sqlite::write_commentary_text(
            &path,
            book,
            chapter,
            verse,
            &self.editor.commentary_text,
        );
        if result.is_ok() {
            self.reading.clear();
        }
        self.note_editor_result(result, &i18n::t("savedCommentary"));
    }

    fn editor_passage(&self) -> Option<(i64, i64, i64)> {
        Some((
            self.editor.book.parse().ok()?,
            self.editor.chapter.parse().ok()?,
            self.editor.verse.parse().ok()?,
        ))
    }

    fn book_select(&mut self, ui: &mut egui::Ui, salt: &str) -> bool {
        let dark = self.session.dark;
        let choices: Vec<(String, String)> = self
            .editor
            .books
            .iter()
            .map(|book| {
                let short = i18n::book_name(book.book_number).short;
                (
                    book.book_number.to_string(),
                    format!("{short} ({})", book.book_number),
                )
            })
            .collect();
        let current = self.editor.book.clone();
        form_label(ui, dark, &i18n::t("moduleBook"));
        let shown = choices
            .iter()
            .find(|(id, _)| id == &current)
            .map(|(_, text)| text.clone())
            .unwrap_or(current);
        let picked = form_select(ui, dark, salt, &shown, &choices);
        ui.add_space(6.0);
        if let Some(id) = picked {
            if id != self.editor.book {
                self.editor.book = id;
                self.hydrate_book_names();
                return true;
            }
        }
        false
    }

    fn note_editor_result(&mut self, result: Result<(), String>, ok: &str) {
        match result {
            Ok(()) => {
                self.editor.status = ok.to_string();
                self.editor.status_ok = true;
            }
            Err(err) => {
                self.editor.status = if err.is_empty() {
                    i18n::t("saveFailed")
                } else {
                    err
                };
                self.editor.status_ok = false;
            }
        }
    }

    fn editor_status_line(&self, ui: &mut egui::Ui) {
        let dark = self.session.dark;
        editor_rule(ui, dark);
        let width = ui.available_width();
        let (rect, _) = ui.allocate_exact_size(egui::vec2(width, 34.0), egui::Sense::hover());
        if self.editor.status.is_empty() {
            return;
        }
        let color = if self.editor.status_ok {
            paint::color(if dark { "#7adf84" } else { "#1d6b2a" })
        } else {
            paint::color(if dark { "#f29b9b" } else { "#8d2222" })
        };
        let galley = ui.painter().layout_no_wrap(
            self.editor.status.clone(),
            egui::FontId::proportional(13.0),
            color,
        );
        ui.painter().galley(
            egui::pos2(
                rect.left() + 16.0,
                rect.center().y - galley.rect.height() / 2.0,
            ),
            galley,
            color,
        );
    }

    fn prepare_modal_ui(&self, ui: &mut egui::Ui) {
        let dark = self.session.dark;
        let palette = theme::palette(dark);
        let fill = card_fill(dark);
        let text = paint::color(palette.ui_text);
        let ink = paint::color(if dark {
            palette.ui_text
        } else {
            palette.ui_link_strong
        });
        ui.spacing_mut().item_spacing = egui::vec2(8.0, 0.0);
        ui.spacing_mut().button_padding = egui::vec2(16.0, 6.0);
        let style = ui.style_mut();
        style
            .text_styles
            .insert(egui::TextStyle::Body, egui::FontId::proportional(14.0));
        style
            .text_styles
            .insert(egui::TextStyle::Button, egui::FontId::proportional(14.0));
        style
            .text_styles
            .insert(egui::TextStyle::Small, egui::FontId::proportional(12.0));
        let visuals = &mut style.visuals;
        visuals.clip_rect_margin = 0.0;
        visuals.override_text_color = Some(text);
        visuals.panel_fill = fill;
        visuals.window_fill = fill;
        visuals.extreme_bg_color = fill;
        visuals.widgets.noninteractive.fg_stroke = egui::Stroke::new(1.0_f32, text);
        visuals.widgets.inactive.bg_fill = paint::color(if dark {
            palette.ui_border
        } else {
            palette.ui_accent_bg
        });
        visuals.widgets.inactive.weak_bg_fill = fill;
        visuals.widgets.inactive.fg_stroke = egui::Stroke::new(1.0_f32, ink);
        visuals.widgets.inactive.bg_stroke =
            egui::Stroke::new(1.0_f32, paint::color(palette.ui_text_dim));
        visuals.widgets.hovered.bg_fill = paint::color(if dark {
            palette.ui_border_strong
        } else {
            palette.ui_border
        });
        visuals.widgets.hovered.weak_bg_fill = paint::color(palette.ui_surface_muted);
        visuals.widgets.hovered.fg_stroke = egui::Stroke::new(1.0_f32, text);
        visuals.widgets.hovered.bg_stroke =
            egui::Stroke::new(1.0_f32, paint::color(palette.ui_border_strong));
        visuals.widgets.active.bg_fill = visuals.widgets.hovered.bg_fill;
        visuals.widgets.active.fg_stroke = egui::Stroke::new(1.0_f32, text);
        visuals.selection.bg_fill = paint::color(palette.ui_accent_bg);
        visuals.selection.stroke = egui::Stroke::new(1.0_f32, paint::color(palette.ui_link));
        let radius = egui::CornerRadius::same(2);
        visuals.widgets.inactive.corner_radius = radius;
        visuals.widgets.hovered.corner_radius = radius;
        visuals.widgets.active.corner_radius = radius;
        visuals.window_corner_radius = egui::CornerRadius::same(0);
    }

    fn header_bar(&self, ui: &mut egui::Ui, title: &str) {
        let palette = theme::palette(self.session.dark);
        let text = paint::color(palette.ui_text);
        let border = hairline(self.session.dark, palette);
        let width = ui.available_width();
        let (rect, _) = ui.allocate_exact_size(egui::vec2(width, 57.0), egui::Sense::hover());
        let shown = fit_title(ui, title, (rect.width() - 64.0).max(40.0), text, 18.0);
        let galley = ui
            .painter()
            .layout_no_wrap(shown, egui::FontId::proportional(18.0), text);
        ui.painter().galley(
            egui::pos2(
                rect.left() + 16.0,
                rect.center().y - galley.rect.height() / 2.0,
            ),
            galley,
            text,
        );
        ui.painter().hline(
            rect.x_range(),
            rect.bottom() - 0.5,
            egui::Stroke::new(1.0_f32, border),
        );
        #[cfg(test)]
        crate::chrome::mark_layout(ui, "modal-header", rect);
    }

    /// The About dialog's X: no fill, same mark as a pane close, equal inset from the top and the right.
    fn modal_close_button(&self, ui: &mut egui::Ui, card: egui::Rect) -> bool {
        let palette = theme::palette(self.session.dark);
        let inset = 20.0;
        let half = 4.0 + 1.5 / 2.0;
        let center = egui::pos2(card.right() - inset - half, card.top() + inset + half);
        let hit = egui::Rect::from_center_size(center, egui::vec2(28.0, 28.0));
        let response = ui.interact(hit, ui.id().with("modal-x"), egui::Sense::click());
        let ink = paint::color(if response.hovered() {
            palette.ui_text
        } else {
            palette.ui_text_subtle
        });
        paint::draw_icon(ui.painter(), center, ink, paint::Icon::Close);
        if response.hovered() {
            ui.ctx().set_cursor_icon(egui::CursorIcon::PointingHand);
        }
        #[cfg(test)]
        {
            let mark = egui::Rect::from_center_size(center, egui::vec2(half * 2.0, half * 2.0));
            crate::chrome::mark_layout(ui, "modal-close", mark);
        }
        paint::hover_tip(response, i18n::t("close")).clicked()
    }

    fn paper_button(&self, ui: &mut egui::Ui, label: &str, kind: PaperButton) -> egui::Response {
        let palette = theme::palette(self.session.dark);
        let dark = self.session.dark;
        let probe = ui.painter().layout_no_wrap(
            label.to_string(),
            egui::FontId::proportional(14.0),
            egui::Color32::PLACEHOLDER,
        );
        let (rect, response) = ui.allocate_exact_size(
            egui::vec2((probe.rect.width() + 32.0).max(64.0), 36.0),
            egui::Sense::click(),
        );
        let hovered = response.hovered();
        let (fill, stroke, ink) = match kind {
            PaperButton::Quiet => {
                let fill = if dark {
                    paint::color(if hovered {
                        "#454545"
                    } else {
                        palette.ui_border
                    })
                } else {
                    paint::color(if hovered {
                        palette.ui_border
                    } else {
                        palette.ui_accent_bg
                    })
                };
                let ink = paint::color(if dark {
                    palette.ui_text
                } else {
                    palette.ui_link_strong
                });
                (fill, egui::Stroke::NONE, ink)
            }
            PaperButton::Primary => {
                let fill = if dark {
                    paint::color(if hovered { "#6e6e6e" } else { "#5f5f5f" })
                } else {
                    paint::color(if hovered {
                        palette.ui_text_muted
                    } else {
                        palette.ui_border_stronger
                    })
                };
                (fill, egui::Stroke::NONE, egui::Color32::WHITE)
            }
            PaperButton::Outline => {
                let fill = if hovered {
                    paint::color(if dark {
                        palette.ui_border
                    } else {
                        palette.ui_surface_muted
                    })
                } else {
                    egui::Color32::TRANSPARENT
                };
                let stroke = paint::color(if dark { "#5f5f5f" } else { palette.ui_text_dim });
                let ink = paint::color(if dark {
                    "#c8c8c8"
                } else {
                    palette.ui_text_muted
                });
                (fill, egui::Stroke::new(1.0_f32, stroke), ink)
            }
        };
        ui.painter().rect(
            rect,
            egui::CornerRadius::same(2),
            fill,
            stroke,
            egui::StrokeKind::Inside,
        );
        let galley =
            ui.painter()
                .layout_no_wrap(label.to_string(), egui::FontId::proportional(14.0), ink);
        ui.painter().galley(
            egui::pos2(
                rect.center().x - galley.rect.width() / 2.0,
                rect.center().y - galley.rect.height() / 2.0,
            ),
            galley,
            ink,
        );
        if hovered {
            ui.ctx().set_cursor_icon(egui::CursorIcon::PointingHand);
        }
        response
    }

    fn mini_select(
        &self,
        ui: &mut egui::Ui,
        salt: &str,
        label: &str,
        choices: &[(String, String)],
    ) -> Option<String> {
        let palette = theme::palette(self.session.dark);
        let dark = self.session.dark;
        ui.push_id(salt, |ui| {
            let text = paint::color(palette.ui_text);
            let probe = ui.painter().layout_no_wrap(
                label.to_string(),
                egui::FontId::proportional(14.0),
                text,
            );
            let width = (probe.rect.width() + 36.0).max(68.0);
            let (rect, response) =
                ui.allocate_exact_size(egui::vec2(width, 32.0), egui::Sense::click());
            let popup_id = egui::Popup::default_response_id(&response);
            let open = egui::Popup::is_id_open(ui.ctx(), popup_id);
            let stroke = paint::color(if response.hovered() || open {
                palette.ui_border_strong
            } else if dark {
                "#5f5f5f"
            } else {
                palette.ui_text_dim
            });
            let fill = paint::color(if dark {
                palette.ui_border
            } else {
                palette.ui_bg
            });
            ui.painter().rect(
                rect,
                egui::CornerRadius::same(2),
                fill,
                egui::Stroke::new(1.0_f32, stroke),
                egui::StrokeKind::Inside,
            );
            ui.painter().galley(
                egui::pos2(
                    rect.left() + 12.0,
                    rect.center().y - probe.rect.height() / 2.0,
                ),
                probe,
                text,
            );
            paint::draw_icon(
                ui.painter(),
                egui::pos2(rect.right() - 14.0, rect.center().y),
                paint::color(palette.ui_text_subtle),
                paint::Icon::ChevronDown,
            );
            if response.hovered() {
                ui.ctx().set_cursor_icon(egui::CursorIcon::PointingHand);
            }
            let mut picked = None;
            let popup_width = width.max(88.0);
            egui::Popup::from_toggle_button_response(&response)
                .close_behavior(egui::PopupCloseBehavior::CloseOnClickOutside)
                .width(popup_width)
                .show(|ui| {
                    ui.set_min_width(popup_width);
                    for (id, text) in choices {
                        if ui.selectable_label(text == label, text.as_str()).clicked() {
                            picked = Some(id.clone());
                            egui::Popup::close_id(ui.ctx(), popup_id);
                        }
                    }
                });
            picked
        })
        .inner
    }

    fn settings_row(
        &mut self,
        ui: &mut egui::Ui,
        title: &str,
        hint: &str,
        control: impl FnOnce(&mut Self, &mut egui::Ui),
    ) {
        let palette = theme::palette(self.session.dark);
        let text = paint::color(palette.ui_text);
        let hint_color = paint::color(if self.session.dark {
            palette.ui_text_subtle
        } else {
            palette.ui_text_muted
        });
        ui.horizontal(|ui| {
            ui.spacing_mut().item_spacing.x = 12.0;
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                control(self, ui);
                let width = ui.available_width();
                ui.allocate_ui_with_layout(
                    egui::vec2(width, 0.0),
                    egui::Layout::top_down(egui::Align::Min),
                    |ui| {
                        ui.set_width(width);
                        ui.spacing_mut().item_spacing.y = 2.0;
                        ui.label(egui::RichText::new(title).size(14.0).strong().color(text));
                        ui.label(egui::RichText::new(hint).size(12.0).color(hint_color));
                    },
                );
            });
        });
    }

    fn section_heading(&self, ui: &mut egui::Ui, title: &str, hint: &str) -> egui::Rect {
        let palette = theme::palette(self.session.dark);
        let text = paint::color(palette.ui_text);
        let hint_color = paint::color(if self.session.dark {
            palette.ui_text_subtle
        } else {
            palette.ui_text_muted
        });
        let title = ui.label(egui::RichText::new(title).size(14.0).strong().color(text));
        ui.add_space(4.0);
        ui.label(egui::RichText::new(hint).size(12.0).color(hint_color));
        title.rect
    }

    fn group_rule(&self, ui: &mut egui::Ui) {
        let palette = theme::palette(self.session.dark);
        ui.add_space(16.0);
        let width = ui.available_width();
        let (rect, _) = ui.allocate_exact_size(egui::vec2(width, 1.0), egui::Sense::hover());
        ui.painter().hline(
            rect.x_range(),
            rect.center().y,
            egui::Stroke::new(1.0_f32, hairline(self.session.dark, palette)),
        );
        ui.add_space(12.0);
    }

    fn check_option(
        &self,
        ui: &mut egui::Ui,
        checked: bool,
        title: &str,
        hint: Option<&str>,
    ) -> bool {
        let palette = theme::palette(self.session.dark);
        let text = paint::color(palette.ui_text);
        let hint_color = paint::color(if self.session.dark {
            palette.ui_text_subtle
        } else {
            palette.ui_text_muted
        });
        let mut toggle = false;
        ui.with_layout(egui::Layout::left_to_right(egui::Align::Min), |ui| {
            ui.spacing_mut().item_spacing.x = 8.0;
            ui.vertical(|ui| {
                ui.add_space(1.0);
                if self.check_square(ui, checked).clicked() {
                    toggle = true;
                }
            });
            ui.vertical(|ui| {
                ui.spacing_mut().item_spacing.y = 2.0;
                let label = ui.add(
                    egui::Label::new(egui::RichText::new(title).size(13.0).color(text))
                        .sense(egui::Sense::click()),
                );
                if label.clicked() {
                    toggle = true;
                }
                if let Some(hint) = hint {
                    ui.label(egui::RichText::new(hint).size(12.0).color(hint_color));
                }
            });
        });
        toggle
    }

    fn check_square(&self, ui: &mut egui::Ui, checked: bool) -> egui::Response {
        let palette = theme::palette(self.session.dark);
        let (rect, response) = ui.allocate_exact_size(egui::vec2(16.0, 16.0), egui::Sense::click());
        let accent = paint::color(palette.ui_link);
        let fill = if checked {
            accent
        } else {
            paint::color(if self.session.dark {
                palette.ui_border
            } else {
                palette.ui_bg
            })
        };
        let stroke = if checked {
            accent
        } else {
            paint::color(palette.ui_text_dim)
        };
        ui.painter().rect(
            rect,
            egui::CornerRadius::same(2),
            fill,
            egui::Stroke::new(1.0_f32, stroke),
            egui::StrokeKind::Inside,
        );
        if checked {
            let mark = egui::Stroke::new(1.6_f32, egui::Color32::WHITE);
            ui.painter().line_segment(
                [
                    rect.left_top() + egui::vec2(3.5, 8.0),
                    rect.left_top() + egui::vec2(6.5, 11.0),
                ],
                mark,
            );
            ui.painter().line_segment(
                [
                    rect.left_top() + egui::vec2(6.5, 11.0),
                    rect.left_top() + egui::vec2(12.5, 4.5),
                ],
                mark,
            );
        }
        if response.hovered() {
            ui.ctx().set_cursor_icon(egui::CursorIcon::PointingHand);
        }
        response
    }

    fn about_card(&mut self, ui: &mut egui::Ui) -> bool {
        let palette = theme::palette(self.session.dark);
        let muted = paint::color(if self.session.dark {
            palette.ui_text_subtle
        } else {
            palette.ui_border_stronger
        });
        let framed = egui::Frame::new()
            .inner_margin(egui::Margin {
                left: 28,
                right: 28,
                top: 28,
                bottom: 28,
            })
            .show(ui, |ui| {
                let width = ui.available_width();
                ui.vertical_centered(|ui| {
                    ui.set_width(width);
                    self.about_wordmark(ui);
                    ui.add_space(16.0);
                    ui.label(
                        egui::RichText::new(format!("v{}", crate::update::VERSION))
                            .size(14.0)
                            .color(muted),
                    );
                    ui.add_space(2.0);
                    ui.label(
                        egui::RichText::new("Claudio Scheer")
                            .size(14.0)
                            .color(muted),
                    );
                    ui.add_space(12.0);
                    ui.add(
                        egui::Label::new(
                            egui::RichText::new(i18n::t("aboutOpenSource"))
                                .size(14.0)
                                .color(muted),
                        )
                        .wrap_mode(egui::TextWrapMode::Wrap)
                        .halign(egui::Align::Center),
                    );
                    ui.add_space(20.0);
                    let github = "GitHub";
                    let report = i18n::t("reportIssue");
                    let gap = 16.0;
                    let pair =
                        quiet_button_width(ui, github) + gap + quiet_button_width(ui, &report);
                    let spare = (ui.available_width() - pair).max(0.0) / 2.0;
                    ui.horizontal(|ui| {
                        ui.spacing_mut().item_spacing.x = 0.0;
                        ui.add_space(spare);
                        let repo = self.paper_button(ui, github, PaperButton::Quiet);
                        #[cfg(test)]
                        crate::chrome::mark_layout(ui, "about-github", repo.rect);
                        if repo.clicked() {
                            let _ = open::that("https://github.com/claudioscheer/graphe");
                        }
                        ui.add_space(gap);
                        let issues = self.paper_button(ui, &report, PaperButton::Quiet);
                        #[cfg(test)]
                        crate::chrome::mark_layout(ui, "about-issues", issues.rect);
                        if issues.clicked() {
                            let _ = open::that(crate::update::ISSUES_URL);
                        }
                    });
                });
            });
        let card = framed.response.rect;
        #[cfg(test)]
        crate::chrome::mark_layout(ui, "about-card", card);
        #[cfg(not(test))]
        let _ = card;
        false
    }

    /// The wordmark PNG. `Image::from_bytes` has no loader here, so decode it like the navbar mark.
    fn about_wordmark(&self, ui: &mut egui::Ui) {
        let bytes = include_bytes!("../../../assets/graphe-full.png");
        let Ok(icon) = eframe::icon_data::from_png_bytes(bytes) else {
            ui.label(
                egui::RichText::new("Graphe")
                    .strong()
                    .size(28.0)
                    .color(paint::color(theme::palette(self.session.dark).ui_text)),
            );
            return;
        };
        let texture_id = egui::Id::new("graphe-wordmark");
        let existing = ui
            .ctx()
            .data(|data| data.get_temp::<egui::TextureHandle>(texture_id));
        let handle = if let Some(handle) = existing {
            handle
        } else {
            let image = egui::ColorImage::from_rgba_unmultiplied(
                [icon.width as usize, icon.height as usize],
                &icon.rgba,
            );
            let handle =
                ui.ctx()
                    .load_texture("graphe-wordmark", image, egui::TextureOptions::LINEAR);
            ui.ctx()
                .data_mut(|data| data.insert_temp(texture_id, handle.clone()));
            handle
        };
        let aspect = icon.width as f32 / icon.height.max(1) as f32;
        let max_w = ui.available_width().min(280.0);
        let mut height = 80.0;
        let mut width = height * aspect;
        if width > max_w {
            width = max_w;
            height = width / aspect.max(0.01);
        }
        let (rect, _) = ui.allocate_exact_size(egui::vec2(width, height), egui::Sense::hover());
        ui.painter().image(
            handle.id(),
            rect,
            egui::Rect::from_min_max(egui::pos2(0.0, 0.0), egui::pos2(1.0, 1.0)),
            egui::Color32::WHITE,
        );
        #[cfg(test)]
        crate::chrome::mark_layout(ui, "about-logo", rect);
    }

    fn commentaries_body(&mut self, ui: &mut egui::Ui) {
        let palette = theme::palette(self.session.dark);
        let text = paint::color(palette.ui_text);
        let subtle = paint::color(palette.ui_text_subtle);
        if self.session.commentary_sections.is_empty() {
            ui.label(
                egui::RichText::new(i18n::t("allCommentariesNoResults"))
                    .size(14.0)
                    .italics()
                    .color(subtle),
            );
            return;
        }
        let count = self.session.commentary_sections.len();
        if self.session.commentary_open.len() != count {
            self.session.commentary_open = vec![false; count];
        }
        let sections = self.session.commentary_sections.clone();
        for (index, section) in sections.iter().enumerate() {
            let open = self.session.commentary_open[index];
            if self.commentary_row(ui, &section.name, open).clicked() {
                self.session.commentary_open[index] = !open;
            }
            if self.session.commentary_open[index] {
                ui.add_space(8.0);
                ui.label(egui::RichText::new(&section.body).size(14.0).color(text));
                ui.add_space(12.0);
            }
        }
    }

    fn commentary_row(&self, ui: &mut egui::Ui, name: &str, open: bool) -> egui::Response {
        let palette = theme::palette(self.session.dark);
        let text = paint::color(palette.ui_text);
        let subtle = paint::color(palette.ui_text_subtle);
        let width = ui.available_width();
        let (rect, response) =
            ui.allocate_exact_size(egui::vec2(width, 42.0), egui::Sense::click());
        if response.hovered() {
            ui.painter().rect_filled(
                rect,
                0.0,
                paint::color_alpha(
                    palette.ui_border_soft,
                    if self.session.dark { 80 } else { 160 },
                ),
            );
            ui.ctx().set_cursor_icon(egui::CursorIcon::PointingHand);
        }
        let icon = if open {
            paint::Icon::ChevronDown
        } else {
            paint::Icon::ChevronRight
        };
        paint::draw_icon(
            ui.painter(),
            egui::pos2(rect.left() + 8.0, rect.center().y),
            subtle,
            icon,
        );
        let galley =
            ui.painter()
                .layout_no_wrap(name.to_string(), egui::FontId::proportional(14.0), text);
        ui.painter().galley(
            egui::pos2(
                rect.left() + 26.0,
                rect.center().y - galley.rect.height() / 2.0,
            ),
            galley,
            text,
        );
        ui.painter().hline(
            rect.x_range(),
            rect.bottom() - 0.5,
            egui::Stroke::new(1.0_f32, hairline(self.session.dark, palette)),
        );
        response
    }
}

fn module_kind_label(kind: &str) -> String {
    match kind {
        "bible" => i18n::t("moduleKindBible"),
        "commentary" => i18n::t("moduleKindCommentary"),
        "dictionary" => i18n::t("moduleKindDictionary"),
        "crossreference" => i18n::t("moduleKindCrossreference"),
        "" => String::new(),
        other => other.to_string(),
    }
}

fn editor_tab_label(tab: EditorTab) -> String {
    match tab {
        EditorTab::Info => i18n::t("moduleInfo"),
        EditorTab::Books => i18n::t("moduleBooks"),
        EditorTab::Verses => i18n::t("moduleVerses"),
        EditorTab::Commentaries => i18n::t("commentaries"),
    }
}

fn known_info_key(key: &str) -> bool {
    matches!(
        key,
        "description" | "language" | "short.title" | "short_title" | "strong_numbers"
    )
}

fn info_field_label(key: &str) -> String {
    key.replace(['_', '.'], " ")
}

fn editor_rule(ui: &mut egui::Ui, dark: bool) {
    let palette = theme::palette(dark);
    let width = ui.available_width();
    let (rect, _) = ui.allocate_exact_size(egui::vec2(width, 1.0), egui::Sense::hover());
    ui.painter().hline(
        rect.x_range(),
        rect.center().y,
        egui::Stroke::new(1.0_f32, hairline(dark, palette)),
    );
}

fn form_label(ui: &mut egui::Ui, dark: bool, text: &str) {
    let palette = theme::palette(dark);
    ui.label(
        egui::RichText::new(text.to_uppercase())
            .size(12.0)
            .strong()
            .color(paint::color(palette.ui_text_muted)),
    );
}

fn form_line(ui: &mut egui::Ui, value: &mut String, mark: &str) {
    let response = ui.add(
        egui::TextEdit::singleline(value)
            .desired_width(ui.available_width())
            .font(egui::FontId::proportional(14.0))
            .margin(egui::Margin::symmetric(12, 10)),
    );
    #[cfg(test)]
    crate::chrome::mark_layout(ui, mark, response.rect);
    #[cfg(not(test))]
    let _ = (mark, response);
}

fn form_area(ui: &mut egui::Ui, value: &mut String, rows: usize, mark: &str) {
    let response = ui.add(
        egui::TextEdit::multiline(value)
            .desired_width(ui.available_width())
            .desired_rows(rows)
            .font(egui::FontId::proportional(14.0))
            .margin(egui::Margin::symmetric(12, 10)),
    );
    #[cfg(test)]
    crate::chrome::mark_layout(ui, mark, response.rect);
    #[cfg(not(test))]
    let _ = (mark, response);
}

fn fill_button(ui: &mut egui::Ui, dark: bool, label: &str, mark: &str) -> egui::Response {
    let palette = theme::palette(dark);
    let width = ui.available_width();
    let (rect, response) = ui.allocate_exact_size(egui::vec2(width, 40.0), egui::Sense::click());
    let fill = paint::color(if response.hovered() && !dark {
        palette.ui_border
    } else {
        palette.ui_accent_bg
    });
    let ink = paint::color(palette.ui_accent_ink);
    ui.painter().rect(
        rect,
        egui::CornerRadius::same(2),
        fill,
        egui::Stroke::NONE,
        egui::StrokeKind::Inside,
    );
    let galley =
        ui.painter()
            .layout_no_wrap(label.to_string(), egui::FontId::proportional(14.0), ink);
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
    #[cfg(test)]
    crate::chrome::mark_layout(ui, mark, rect);
    #[cfg(not(test))]
    let _ = mark;
    response
}

fn delete_button_width(ui: &egui::Ui, label: &str) -> f32 {
    let probe = ui.painter().layout_no_wrap(
        label.to_string(),
        egui::FontId::proportional(13.0),
        egui::Color32::WHITE,
    );
    (probe.rect.width() + 24.0).max(128.0)
}

fn delete_module_button(ui: &mut egui::Ui, label: &str) -> egui::Response {
    let font = egui::FontId::proportional(13.0);
    let width = delete_button_width(ui, label);
    let (rect, response) = ui.allocate_exact_size(egui::vec2(width, 36.0), egui::Sense::click());
    let fill = paint::color(if response.hovered() {
        "#731b1b"
    } else {
        "#8d2222"
    });
    ui.painter().rect(
        rect,
        egui::CornerRadius::same(2),
        fill,
        egui::Stroke::new(1.0_f32, paint::color("#9f2f2f")),
        egui::StrokeKind::Inside,
    );
    let galley = ui
        .painter()
        .layout_no_wrap(label.to_string(), font, egui::Color32::WHITE);
    ui.painter().galley(
        egui::pos2(
            rect.center().x - galley.rect.width() / 2.0,
            rect.center().y - galley.rect.height() / 2.0,
        ),
        galley,
        egui::Color32::WHITE,
    );
    if response.hovered() {
        ui.ctx().set_cursor_icon(egui::CursorIcon::PointingHand);
    }
    #[cfg(test)]
    crate::chrome::mark_layout(ui, "editor-delete", rect);
    response
}

fn tab_button(ui: &mut egui::Ui, dark: bool, label: &str, active: bool) -> egui::Response {
    let palette = theme::palette(dark);
    let font = egui::FontId::proportional(13.0);
    let probe =
        ui.painter()
            .layout_no_wrap(label.to_string(), font.clone(), egui::Color32::PLACEHOLDER);
    let (rect, response) = ui.allocate_exact_size(
        egui::vec2((probe.rect.width() + 22.0).max(72.0), 32.0),
        egui::Sense::click(),
    );
    let fill = if active {
        paint::color(palette.ui_accent_bg)
    } else {
        paint::color(if dark {
            palette.ui_surface_muted
        } else {
            palette.ui_accent_bg_soft
        })
    };
    let ink = paint::color(if active {
        palette.ui_accent_ink
    } else {
        palette.ui_text_muted
    });
    let stroke = paint::color(if active {
        palette.ui_border_strong
    } else {
        palette.ui_border
    });
    ui.painter().rect(
        rect,
        egui::CornerRadius::same(2),
        fill,
        egui::Stroke::new(1.0_f32, stroke),
        egui::StrokeKind::Inside,
    );
    let galley = ui.painter().layout_no_wrap(label.to_string(), font, ink);
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
    response
}

fn form_select(
    ui: &mut egui::Ui,
    dark: bool,
    salt: &str,
    label: &str,
    choices: &[(String, String)],
) -> Option<String> {
    let palette = theme::palette(dark);
    ui.push_id(salt, |ui| {
        let text = paint::color(palette.ui_text);
        let width = ui.available_width();
        let (rect, response) =
            ui.allocate_exact_size(egui::vec2(width, 40.0), egui::Sense::click());
        let popup_id = egui::Popup::default_response_id(&response);
        let open = egui::Popup::is_id_open(ui.ctx(), popup_id);
        let stroke = paint::color(if response.hovered() || open {
            palette.ui_border_strong
        } else {
            palette.ui_border
        });
        ui.painter().rect(
            rect,
            egui::CornerRadius::same(2),
            card_fill(dark),
            egui::Stroke::new(1.0_f32, stroke),
            egui::StrokeKind::Inside,
        );
        let shown =
            ui.painter()
                .layout_no_wrap(label.to_string(), egui::FontId::proportional(14.0), text);
        ui.painter().galley(
            egui::pos2(
                rect.left() + 12.0,
                rect.center().y - shown.rect.height() / 2.0,
            ),
            shown,
            text,
        );
        paint::draw_icon(
            ui.painter(),
            egui::pos2(rect.right() - 16.0, rect.center().y),
            paint::color(palette.ui_text_subtle),
            paint::Icon::ChevronDown,
        );
        if response.hovered() {
            ui.ctx().set_cursor_icon(egui::CursorIcon::PointingHand);
        }
        let mut picked = None;
        egui::Popup::from_toggle_button_response(&response)
            .close_behavior(egui::PopupCloseBehavior::CloseOnClickOutside)
            .width(width)
            .show(|ui| {
                ui.set_min_width(width);
                egui::ScrollArea::vertical()
                    .max_height(240.0)
                    .show(ui, |ui| {
                        for (id, text) in choices {
                            if ui.selectable_label(text == label, text.as_str()).clicked() {
                                picked = Some(id.clone());
                                egui::Popup::close_id(ui.ctx(), popup_id);
                            }
                        }
                    });
            });
        picked
    })
    .inner
}

fn numbered_select(
    ui: &mut egui::Ui,
    dark: bool,
    salt: &str,
    title: &str,
    current: &str,
    choices: &[(String, String)],
) -> Option<String> {
    form_label(ui, dark, title);
    let shown = choices
        .iter()
        .find(|(id, _)| id == current)
        .map(|(_, text)| text.clone())
        .unwrap_or_else(|| current.to_string());
    let picked = form_select(ui, dark, salt, &shown, choices);
    ui.add_space(6.0);
    picked.filter(|id| id != current)
}

fn ellipsize_start(
    ui: &egui::Ui,
    text: &str,
    max_width: f32,
    font: egui::FontId,
    color: egui::Color32,
) -> String {
    if text.is_empty() || max_width <= 8.0 {
        return String::new();
    }
    let full = ui
        .painter()
        .layout_no_wrap(text.to_string(), font.clone(), color);
    if full.rect.width() <= max_width {
        return text.to_string();
    }
    let chars: Vec<char> = text.chars().collect();
    let mut start = 1;
    while start < chars.len() {
        let tail: String = chars[start..].iter().collect();
        let shown = format!("…{tail}");
        let galley = ui
            .painter()
            .layout_no_wrap(shown.clone(), font.clone(), color);
        if galley.rect.width() <= max_width {
            return shown;
        }
        start += 1;
    }
    "…".to_string()
}

const FONT_STEPS: [f32; 7] = [14.0, 16.0, 18.0, 20.0, 22.0, 24.0, 28.0];

enum PaperButton {
    Quiet,
    Primary,
    Outline,
}

fn card_fill(dark: bool) -> egui::Color32 {
    let palette = theme::palette(dark);
    paint::color(if dark {
        palette.ui_surface_muted
    } else {
        palette.ui_bg
    })
}

fn hairline(dark: bool, palette: &graphe_domain::theme::UiPalette) -> egui::Color32 {
    paint::color(if dark {
        palette.ui_border_strong
    } else {
        palette.ui_border
    })
}

fn modal_frame(dark: bool) -> egui::Frame {
    egui::Frame::new()
        .fill(card_fill(dark))
        .corner_radius(egui::CornerRadius::same(0))
        .inner_margin(egui::Margin::same(0))
        .shadow(egui::Shadow {
            offset: [0, 16],
            blur: 40,
            spread: 0,
            color: egui::Color32::from_black_alpha(if dark { 150 } else { 56 }),
        })
}

fn max_body(ui: &egui::Ui, chrome: f32) -> f32 {
    let screen = ui.ctx().content_rect().height().max(480.0);
    (screen * 0.85 - chrome).max(160.0)
}

/// Gap kept above and below the all-commentaries card.
pub(crate) const ALL_COMMENTARIES_SCREEN_MARGIN: f32 = 48.0;

fn commentary_body_limit(screen: f32, chrome: f32) -> f32 {
    let fitted = (screen - ALL_COMMENTARIES_SCREEN_MARGIN * 2.0 - chrome).max(160.0);
    let room = (screen - chrome - 8.0).max(0.0);
    fitted.min(room)
}

struct ModalScroll {
    content_height: f32,
    viewport: egui::Rect,
}

fn modal_scroll(
    ui: &mut egui::Ui,
    salt: &str,
    max_h: f32,
    body: impl FnOnce(&mut egui::Ui),
) -> ModalScroll {
    let output = egui::ScrollArea::vertical()
        .id_salt(("modal-scroll", salt))
        .max_height(max_h)
        .auto_shrink([false, true])
        .show(ui, |ui| {
            ui.set_min_width(ui.available_width());
            egui::Frame::new()
                .inner_margin(egui::Margin::same(16))
                .show(ui, |ui| {
                    ui.spacing_mut().item_spacing.y = 8.0;
                    body(ui);
                });
        });
    ModalScroll {
        content_height: output.content_size.y,
        viewport: output.inner_rect,
    }
}

fn footer_shell(
    ui: &mut egui::Ui,
    dark: bool,
    contents: impl FnOnce(&mut egui::Ui) -> bool,
) -> bool {
    let palette = theme::palette(dark);
    let width = ui.available_width();
    let (line, _) = ui.allocate_exact_size(egui::vec2(width, 1.0), egui::Sense::hover());
    ui.painter().hline(
        line.x_range(),
        line.center().y,
        egui::Stroke::new(1.0_f32, hairline(dark, palette)),
    );
    egui::Frame::new()
        .inner_margin(egui::Margin {
            left: 16,
            right: 16,
            top: 12,
            bottom: 12,
        })
        .show(ui, |ui| {
            ui.set_min_width((width - 32.0).max(0.0));
            contents(ui)
        })
        .inner
}

fn quiet_button_width(ui: &egui::Ui, label: &str) -> f32 {
    let probe = ui.painter().layout_no_wrap(
        label.to_string(),
        egui::FontId::proportional(14.0),
        egui::Color32::PLACEHOLDER,
    );
    (probe.rect.width() + 32.0).max(64.0)
}

fn px_label(size: f32) -> String {
    format!("{}px", size.round() as i32)
}

fn commentaries_title(reference: &str) -> String {
    if reference.is_empty() {
        i18n::t("allCommentaries")
    } else {
        format!("{} — {}", i18n::t("allCommentaries"), reference)
    }
}

fn info_section(
    ui: &mut egui::Ui,
    dark: bool,
    title_key: &str,
    mark: &str,
    body: impl FnOnce(&mut egui::Ui),
) {
    let palette = theme::palette(dark);
    let shown = egui::Frame::new()
        .fill(paint::color(palette.ui_surface_elevated))
        .stroke(egui::Stroke::new(
            1.0_f32,
            paint::color(palette.ui_border_soft),
        ))
        .corner_radius(egui::CornerRadius::same(4))
        .inner_margin(egui::Margin::same(10))
        .show(ui, |ui| {
            ui.spacing_mut().item_spacing = egui::vec2(8.0, 8.0);
            ui.label(
                egui::RichText::new(i18n::t(title_key).to_uppercase())
                    .size(12.0)
                    .strong()
                    .extra_letter_spacing(0.6)
                    .color(paint::color(palette.ui_text_dim)),
            );
            body(ui);
        });
    #[cfg(test)]
    crate::chrome::mark_layout(ui, mark, shown.response.rect);
    #[cfg(not(test))]
    let _ = (mark, shown);
}

fn topic_row(ui: &mut egui::Ui, topic: &str, dark: bool) -> egui::Response {
    let palette = theme::palette(dark);
    let link = paint::color(palette.ui_link);
    let width = ui.available_width();
    let galley = ui.painter().layout(
        topic.to_string(),
        egui::FontId::proportional(13.0),
        link,
        (width - 12.0).max(40.0),
    );
    let height = (galley.rect.height() + 8.0).max(22.0);
    let (rect, response) = ui.allocate_exact_size(egui::vec2(width, height), egui::Sense::click());
    let fill = if response.hovered() {
        paint::color(palette.ui_accent_bg_soft)
    } else {
        egui::Color32::TRANSPARENT
    };
    let stroke = if response.hovered() {
        egui::Stroke::new(1.0_f32, paint::color(palette.ui_border_soft))
    } else {
        egui::Stroke::NONE
    };
    ui.painter().rect(
        rect,
        egui::CornerRadius::same(4),
        fill,
        stroke,
        egui::StrokeKind::Inside,
    );
    ui.painter().galley(
        egui::pos2(
            rect.left() + 6.0,
            rect.center().y - galley.rect.height() / 2.0,
        ),
        galley,
        link,
    );
    if response.hovered() {
        ui.ctx().set_cursor_icon(egui::CursorIcon::PointingHand);
    }
    #[cfg(test)]
    crate::chrome::mark_layout(ui, &format!("dict-info-topic:{topic}"), rect);
    response
}

fn page_button(
    ui: &mut egui::Ui,
    rect: egui::Rect,
    label: &str,
    enabled: bool,
    dark: bool,
    mark: &str,
) -> bool {
    let palette = theme::palette(dark);
    // A disabled control still takes the click, so it does not fall through to the backdrop.
    let response = ui.interact(rect, ui.id().with(mark), egui::Sense::click());
    let mut ink = paint::color(palette.ui_text_muted);
    let mut border = paint::color(palette.ui_border_soft);
    let mut fill = if response.hovered() && enabled {
        paint::color(palette.ui_accent_bg_soft)
    } else {
        paint::color(palette.ui_surface)
    };
    if !enabled {
        ink = ink.gamma_multiply(0.45);
        border = border.gamma_multiply(0.45);
        fill = fill.gamma_multiply(0.45);
    }
    ui.painter().rect(
        rect,
        egui::CornerRadius::same(4),
        fill,
        egui::Stroke::new(1.0_f32, border),
        egui::StrokeKind::Inside,
    );
    let galley =
        ui.painter()
            .layout_no_wrap(label.to_string(), egui::FontId::proportional(16.0), ink);
    ui.painter().galley(
        egui::pos2(
            rect.center().x - galley.rect.width() / 2.0,
            rect.center().y - galley.rect.height() / 2.0,
        ),
        galley,
        ink,
    );
    if response.hovered() && enabled {
        ui.ctx().set_cursor_icon(egui::CursorIcon::PointingHand);
    }
    #[cfg(test)]
    crate::chrome::mark_layout(ui, mark, rect);
    #[cfg(not(test))]
    let _ = mark;
    response.clicked() && enabled
}

fn truncate_chars(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        text.to_string()
    } else {
        text.chars().take(max).collect()
    }
}

fn fit_title(
    ui: &egui::Ui,
    title: &str,
    max_width: f32,
    color: egui::Color32,
    size: f32,
) -> String {
    let font = egui::FontId::proportional(size);
    let full = ui
        .painter()
        .layout_no_wrap(title.to_string(), font.clone(), color);
    if full.rect.width() <= max_width {
        return title.to_string();
    }
    let mut shown: String = title.chars().collect();
    while shown.chars().count() > 1 {
        shown.pop();
        let galley = ui
            .painter()
            .layout_no_wrap(format!("{shown}…"), font.clone(), color);
        if galley.rect.width() <= max_width {
            return format!("{shown}…");
        }
    }
    title.to_string()
}

fn convertible_in_folder(dir: &std::path::Path) -> Vec<std::path::PathBuf> {
    let mut files = Vec::new();
    let Ok(entries) = std::fs::read_dir(dir) else {
        return files;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() && convertible_name(&path) {
            files.push(path);
        }
    }
    files.sort();
    files
}

fn convertible_name(path: &std::path::Path) -> bool {
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_lowercase();
    graphe_store::convert::supported_extensions()
        .iter()
        .any(|ext| name.ends_with(ext))
}

#[cfg(test)]
mod tests {
    use super::commentaries_title;
    use graphe_domain::i18n;

    #[test]
    fn commentaries_title_includes_the_reference() {
        i18n::set_lang("pt");
        assert_eq!(
            commentaries_title("Hb 10:2"),
            "Todos os Comentários — Hb 10:2"
        );
        assert_eq!(commentaries_title(""), i18n::t("allCommentaries"));
    }
}
