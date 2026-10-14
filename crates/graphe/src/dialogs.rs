//! Settings, navigation, conversion, module editor, and preview windows.

use crate::app::{language_button, GrapheApp};
use crate::dropdown::ModuleDropdown;
use crate::paint;
use crate::session::Dialog;
use graphe_domain::books::{GRAPHE_BOOK_NUMBERS, NT_BOOK_OFFSET};
use graphe_domain::coverage::{build_coverage_cell, CoverageClass};
use graphe_domain::i18n;
use graphe_domain::navigation::NavScreen;
use graphe_domain::picker::PickerRow;
use graphe_domain::theme;
use graphe_store::sqlite;
use serde_json::json;

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
        let modal = egui::Modal::new(egui::Id::new("graphe-modal"))
            .backdrop_color(egui::Color32::from_black_alpha(128))
            .frame(modal_frame(dark))
            .show(ctx, |ui| {
                self.prepare_modal_ui(ui);
                let screen_w = ui.ctx().content_rect().width().max(320.0);
                let width = self.dialog_width().min(screen_w * 0.92);
                ui.set_width(width);
                dismiss = self.dialog_card(ui);
                #[cfg(test)]
                crate::chrome::mark_layout(ui, "modal-card", ui.min_rect());
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
        self.nav = None;
        self.picker = None;
    }

    fn dialog_width(&self) -> f32 {
        match self.session.dialog {
            Dialog::About => 380.0,
            Dialog::Settings | Dialog::Convert | Dialog::Picker => 520.0,
            Dialog::Navigation | Dialog::ModuleEditor => 560.0,
            Dialog::Coverage => 620.0,
            Dialog::Preview | Dialog::AllCommentaries => 720.0,
            Dialog::None => 520.0,
        }
    }

    fn dialog_card(&mut self, ui: &mut egui::Ui) -> bool {
        match self.session.dialog {
            Dialog::Settings => self.settings_card(ui),
            Dialog::About => self.about_card(ui),
            Dialog::Navigation => self.navigation_body(ui),
            Dialog::Convert => self.convert_card(ui),
            Dialog::ModuleEditor => self.titled_card(ui, &i18n::t("editModuleData"), |app, ui| {
                app.editor_body(ui);
            }),
            Dialog::Preview => {
                let title = if self.session.preview_title.is_empty() {
                    i18n::t("crossReferences")
                } else {
                    self.session.preview_title.clone()
                };
                let body = self.session.preview_body.clone();
                self.titled_card(ui, &title, move |_app, ui| {
                    ui.label(egui::RichText::new(body).size(15.0));
                })
            }
            Dialog::AllCommentaries => {
                let title = commentaries_title(&self.session.commentary_ref);
                self.titled_card(ui, &title, |app, ui| app.commentaries_body(ui))
            }
            Dialog::Coverage => {
                let title = i18n::t("commentaryCoverage");
                self.titled_card(ui, &title, |app, ui| app.coverage_body(ui))
            }
            Dialog::Picker => {
                let title = i18n::t("workbenchModules");
                self.titled_card(ui, &title, |app, ui| app.picker_body(ui))
            }
            Dialog::None => false,
        }
    }

    fn titled_card(
        &mut self,
        ui: &mut egui::Ui,
        title: &str,
        body: impl FnOnce(&mut Self, &mut egui::Ui),
    ) -> bool {
        let dismiss = self.header_bar(ui, title, true);
        let max_h = max_body(ui, 70.0);
        modal_scroll(ui, "titled", max_h, |ui| body(self, ui));
        dismiss
    }

    fn settings_card(&mut self, ui: &mut egui::Ui) -> bool {
        let _ = self.header_bar(ui, &i18n::t("settings"), false);
        let max_h = max_body(ui, 130.0);
        modal_scroll(ui, "settings", max_h, |ui| self.settings_body(ui));
        let dark = self.session.dark;
        footer_shell(ui, dark, |ui| {
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                let response = self.paper_button(ui, &i18n::t("close"), PaperButton::Quiet);
                #[cfg(test)]
                crate::chrome::mark_layout(ui, "settings-close", response.rect);
                response.clicked()
            })
            .inner
        })
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
            self.section_heading(
                ui,
                &i18n::t("strongsDictionaries"),
                &i18n::t("strongsDictsHint"),
            );
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
            self.section_heading(
                ui,
                &i18n::t("crossReferences"),
                &i18n::t("crossRefModulesHint"),
            );
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
                                ui.label(
                                    egui::RichText::new(i18n::t("oldTestament"))
                                        .small()
                                        .strong(),
                                );
                                self.nav_grid(ui, &ot, 5, true);
                            }
                            if !nt.is_empty() {
                                ui.add_space(8.0);
                                ui.label(
                                    egui::RichText::new(i18n::t("newTestament"))
                                        .small()
                                        .strong(),
                                );
                                self.nav_grid(ui, &nt, 5, true);
                            }
                        }
                        Some(NavScreen::Chapters {
                            book_number,
                            title,
                            count,
                        }) => {
                            ui.label(egui::RichText::new(title).strong());
                            let numbers: Vec<i64> = (1..=count).collect();
                            self.number_grid(ui, &numbers, 8, |nav, number| {
                                nav.select_chapter(book_number, number);
                            });
                        }
                        Some(NavScreen::Verses { title, verses, .. }) => {
                            ui.label(egui::RichText::new(title).strong());
                            self.number_grid(ui, &verses, 8, |nav, number| {
                                nav.select_verse(number)
                            });
                        }
                        _ => {}
                    });
            });
        let dark = self.session.dark;
        footer_shell(ui, dark, |ui| {
            let back_visible = self.nav.as_ref().is_some_and(|nav| nav.back_visible);
            let mut dismiss = false;
            ui.horizontal(|ui| {
                if back_visible
                    && self
                        .paper_button(ui, &i18n::t("back"), PaperButton::Quiet)
                        .clicked()
                {
                    if let Some(nav) = self.nav.as_mut() {
                        nav.back();
                    }
                }
                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    if self
                        .paper_button(ui, &i18n::t("close"), PaperButton::Quiet)
                        .clicked()
                    {
                        dismiss = true;
                    }
                });
            });
            dismiss
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
            .inner_margin(egui::Margin::same(16))
            .show(ui, |ui| {
                ui.set_min_width((width - 32.0).max(0.0));
                let mut input = self
                    .nav
                    .as_ref()
                    .map(|nav| nav.input.clone())
                    .unwrap_or_default();
                let submitted = ui
                    .add(
                        egui::TextEdit::singleline(&mut input)
                            .hint_text(i18n::t("navPlaceholder"))
                            .desired_width(ui.available_width())
                            .font(egui::FontId::proportional(18.0))
                            .margin(egui::Margin::symmetric(12, 10)),
                    )
                    .lost_focus()
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

    fn nav_grid(&mut self, ui: &mut egui::Ui, books: &[i64], columns: usize, _books: bool) {
        let width = ui.available_width().max(80.0);
        let cell = (width / columns as f32).max(72.0);
        ui.horizontal_wrapped(|ui| {
            ui.spacing_mut().item_spacing = egui::vec2(6.0, 6.0);
            for number in books {
                let label = self
                    .nav
                    .as_ref()
                    .map(|nav| nav.book_button_label(*number))
                    .unwrap_or_else(|| number.to_string());
                let title = i18n::book_name(*number).long;
                if paint::hover_tip(
                    ui.add_sized([cell - 6.0, 40.0], egui::Button::new(label).truncate()),
                    title,
                )
                .clicked()
                {
                    if let Some(nav) = self.nav.as_mut() {
                        nav.select_book(*number);
                    }
                }
            }
        });
    }

    fn number_grid(
        &mut self,
        ui: &mut egui::Ui,
        numbers: &[i64],
        columns: usize,
        mut select: impl FnMut(&mut crate::app::LiveNav, i64),
    ) {
        let width = ui.available_width().max(80.0);
        let cell = (width / columns as f32).max(44.0);
        ui.horizontal_wrapped(|ui| {
            ui.spacing_mut().item_spacing = egui::vec2(6.0, 6.0);
            for number in numbers {
                if ui
                    .add_sized([cell - 6.0, 40.0], egui::Button::new(number.to_string()))
                    .clicked()
                {
                    if let Some(nav) = self.nav.as_mut() {
                        select(nav, *number);
                    }
                }
            }
        });
    }

    fn convert_card(&mut self, ui: &mut egui::Ui) -> bool {
        let dismiss = self.header_bar(ui, &i18n::t("convertModules"), true);
        let max_h = max_body(ui, 130.0);
        let status = self.session.status.clone();
        modal_scroll(ui, "convert", max_h, |ui| {
            let palette = theme::palette(self.session.dark);
            let hint = paint::color(if self.session.dark {
                palette.ui_text_subtle
            } else {
                palette.ui_text_muted
            });
            ui.label(
                egui::RichText::new(i18n::t("convertModulesDesc"))
                    .size(14.0)
                    .color(hint),
            );
            if !status.is_empty() {
                ui.add_space(8.0);
                ui.label(egui::RichText::new(status).size(12.0).color(hint));
            }
        });
        let dark = self.session.dark;
        let clicked = footer_shell(ui, dark, |ui| {
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                ui.spacing_mut().item_spacing.x = 8.0;
                let folder = self.paper_button(ui, &i18n::t("selectFolder"), PaperButton::Outline);
                let files = self.paper_button(ui, &i18n::t("selectFiles"), PaperButton::Primary);
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
            });
            false
        });
        dismiss || clicked
    }

    fn convert_paths(&mut self, files: Vec<std::path::PathBuf>) {
        if files.is_empty() {
            return;
        }
        let dir = graphe_store::state::modules_dir(&graphe_store::state::user_home());
        let _ = std::fs::create_dir_all(&dir);
        let mut notes = Vec::new();
        for file in files {
            notes.push(match graphe_store::convert::convert_file(&file, &dir) {
                Ok(path) => path.display().to_string(),
                Err(err) => err.0,
            });
        }
        self.session.status = notes.join("\n");
        self.reload_modules();
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

    fn editor_body(&mut self, ui: &mut egui::Ui) {
        if self.editor_path.is_none() {
            self.editor_path = self.modules.first().map(|module| module.path.clone());
        }
        let current_id = self.editor_path.as_ref().and_then(|path| {
            self.modules
                .iter()
                .find(|m| &m.path == path)
                .map(|m| m.id.as_str())
        });
        let palette = graphe_domain::theme::palette(self.session.dark);
        let dropdown =
            ModuleDropdown::from_all_installed("editor-module", current_id, &self.modules)
                .show_favorites(false)
                .width(ui.available_width().min(420.0));

        if let Some(id) = dropdown.show(ui, &mut self.store, palette, self.session.dark) {
            if let Some(module) = self.modules.iter().find(|m| m.id == id) {
                self.editor_path = Some(module.path.clone());
                self.editor_armed = false;
            }
        }
        let Some(path) = self.editor_path.clone() else {
            ui.label(i18n::t("noModules"));
            return;
        };
        ui.separator();
        ui.label("info");
        for (name, value) in sqlite::info_in_file(&path) {
            if ui.button(format!("{name} = {value}")).clicked() {
                self.editor_info_name = name;
                self.editor_info_value = value;
            }
        }
        ui.text_edit_singleline(&mut self.editor_info_name);
        ui.text_edit_singleline(&mut self.editor_info_value);
        if ui.button("info").clicked() {
            self.session.status =
                sqlite::write_info(&path, &self.editor_info_name, &self.editor_info_value)
                    .err()
                    .unwrap_or_default();
            self.reload_modules();
        }
        ui.separator();
        ui.label(i18n::book_name(self.editor_book.parse().unwrap_or(10)).long);
        for book in sqlite::editable_books_in_file(&path) {
            let label = format!(
                "{} {} {}",
                book.book_number,
                book.short_name.clone().unwrap_or_default(),
                book.long_name.clone().unwrap_or_default()
            );
            if ui.button(label).clicked() {
                self.editor_book = book.book_number.to_string();
                self.editor_short = book.short_name.unwrap_or_default();
                self.editor_long = book.long_name.unwrap_or_default();
            }
        }
        ui.text_edit_singleline(&mut self.editor_book);
        ui.text_edit_singleline(&mut self.editor_short);
        ui.text_edit_singleline(&mut self.editor_long);
        if ui.button(i18n::t("commentarySyncBiblePrefix")).clicked() {
            if let Ok(book) = self.editor_book.parse::<i64>() {
                self.session.status = sqlite::write_book_names(
                    &path,
                    book,
                    Some(&self.editor_short),
                    Some(&self.editor_long),
                )
                .err()
                .unwrap_or_default();
            }
        }
        ui.separator();
        ui.text_edit_singleline(&mut self.editor_chapter);
        ui.text_edit_singleline(&mut self.editor_verse);
        ui.text_edit_multiline(&mut self.editor_text);
        if ui.button(i18n::t("search")).clicked() {
            if let (Ok(book), Ok(chapter), Ok(verse)) = (
                self.editor_book.parse::<i64>(),
                self.editor_chapter.parse::<i64>(),
                self.editor_verse.parse::<i64>(),
            ) {
                if let Some(record) = sqlite::chapter_in_file(&path, book, chapter)
                    .into_iter()
                    .find(|row| row.verse == verse)
                {
                    self.editor_text = record.text;
                } else if let Some(entry) = sqlite::commentary_in_file(&path, book, chapter)
                    .into_iter()
                    .find(|entry| entry.verse_from == verse)
                {
                    self.editor_text = entry.text;
                }
            }
        }
        if ui.button("verse").clicked() {
            if let (Ok(book), Ok(chapter), Ok(verse)) = (
                self.editor_book.parse::<i64>(),
                self.editor_chapter.parse::<i64>(),
                self.editor_verse.parse::<i64>(),
            ) {
                self.session.status =
                    sqlite::write_verse_text(&path, book, chapter, verse, &self.editor_text)
                        .err()
                        .unwrap_or_default();
                self.reading.clear();
                self.loaded_key.clear();
            }
        }
        if ui.button(i18n::t("commentary")).clicked() {
            if let (Ok(book), Ok(chapter), Ok(verse)) = (
                self.editor_book.parse::<i64>(),
                self.editor_chapter.parse::<i64>(),
                self.editor_verse.parse::<i64>(),
            ) {
                self.session.status =
                    sqlite::write_commentary_text(&path, book, chapter, verse, &self.editor_text)
                        .err()
                        .unwrap_or_default();
                self.reading.clear();
            }
        }
        let delete_label = if self.editor_armed {
            i18n::t("editModuleData")
        } else {
            "Delete".into()
        };
        if ui.button(delete_label).clicked() {
            if self.editor_armed {
                if graphe_store::catalog::delete_module(&path).is_ok() {
                    self.editor_path = None;
                    self.editor_armed = false;
                    self.reload_modules();
                    self.session.dialog = Dialog::None;
                }
            } else {
                self.editor_armed = true;
            }
        }
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

    fn header_bar(&self, ui: &mut egui::Ui, title: &str, show_close: bool) -> bool {
        let palette = theme::palette(self.session.dark);
        let text = paint::color(palette.ui_text);
        let border = hairline(self.session.dark, palette);
        let width = ui.available_width();
        let (rect, _) = ui.allocate_exact_size(egui::vec2(width, 57.0), egui::Sense::hover());
        let reserve = if show_close { 64.0 } else { 32.0 };
        let shown = fit_title(ui, title, (rect.width() - reserve).max(40.0), text);
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
        if !show_close {
            return false;
        }
        let button = egui::Rect::from_center_size(
            egui::pos2(rect.right() - 28.0, rect.center().y),
            egui::vec2(28.0, 28.0),
        );
        let response = ui.interact(button, ui.id().with("modal-x"), egui::Sense::click());
        if response.hovered() {
            ui.painter().rect_filled(
                button,
                egui::CornerRadius::same(2),
                paint::color(if self.session.dark {
                    palette.ui_border
                } else {
                    palette.ui_accent_bg
                }),
            );
            ui.ctx().set_cursor_icon(egui::CursorIcon::PointingHand);
        }
        paint::draw_icon(
            ui.painter(),
            button.center(),
            paint::color(palette.ui_text_subtle),
            paint::Icon::Close,
        );
        response.clicked()
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

    fn section_heading(&self, ui: &mut egui::Ui, title: &str, hint: &str) {
        let palette = theme::palette(self.session.dark);
        let text = paint::color(palette.ui_text);
        let hint_color = paint::color(if self.session.dark {
            palette.ui_text_subtle
        } else {
            palette.ui_text_muted
        });
        ui.label(egui::RichText::new(title).size(14.0).strong().color(text));
        ui.add_space(4.0);
        ui.label(egui::RichText::new(hint).size(12.0).color(hint_color));
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
            palette.ui_text_muted
        });
        let mut dismiss = false;
        egui::Frame::new()
            .inner_margin(egui::Margin::same(32))
            .show(ui, |ui| {
                ui.vertical_centered(|ui| {
                    ui.add(
                        egui::Image::from_bytes(
                            "bytes://graphe-full.png",
                            include_bytes!("../../../assets/graphe-full.png").as_slice(),
                        )
                        .max_height(80.0),
                    );
                    ui.add_space(12.0);
                    ui.label(
                        egui::RichText::new(crate::update::VERSION)
                            .size(14.0)
                            .color(muted),
                    );
                    ui.add_space(4.0);
                    ui.label(
                        egui::RichText::new("Claudio Scheer")
                            .size(14.0)
                            .color(muted),
                    );
                    ui.add_space(12.0);
                    ui.label(
                        egui::RichText::new(i18n::t("aboutOpenSource"))
                            .size(14.0)
                            .color(muted),
                    );
                    ui.add_space(16.0);
                    ui.horizontal(|ui| {
                        ui.spacing_mut().item_spacing.x = 16.0;
                        if self
                            .paper_button(ui, "GitHub", PaperButton::Quiet)
                            .clicked()
                        {
                            let _ = open::that("https://github.com/claudioscheer/graphe");
                        }
                        if self
                            .paper_button(ui, &i18n::t("reportIssue"), PaperButton::Quiet)
                            .clicked()
                        {
                            let _ = open::that(crate::update::ISSUES_URL);
                        }
                    });
                    ui.add_space(16.0);
                    if self
                        .paper_button(ui, &i18n::t("close"), PaperButton::Quiet)
                        .clicked()
                    {
                        dismiss = true;
                    }
                });
            });
        dismiss
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

fn modal_scroll(ui: &mut egui::Ui, salt: &str, max_h: f32, body: impl FnOnce(&mut egui::Ui)) {
    egui::ScrollArea::vertical()
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

fn fit_title(ui: &egui::Ui, title: &str, max_width: f32, color: egui::Color32) -> String {
    let font = egui::FontId::proportional(18.0);
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
