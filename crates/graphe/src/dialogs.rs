//! Settings, navigation, conversion, module editor, and preview windows.

use crate::app::{language_button, GrapheApp};
use crate::session::Dialog;
use graphe_domain::i18n::{self, Lang};
use graphe_domain::navigation::NavScreen;
use graphe_domain::picker::PickerRow;
use graphe_store::sqlite;
use serde_json::json;

impl GrapheApp {
    pub(crate) fn dialogs(&mut self, ctx: &egui::Context) {
        let open = self.session.dialog != Dialog::None;
        if !open {
            return;
        }
        let title = match self.session.dialog {
            Dialog::Navigation => i18n::t("navPlaceholder"),
            Dialog::Settings => i18n::t("settings"),
            Dialog::About => i18n::t("aboutTitle"),
            Dialog::Convert => i18n::t("convertModules"),
            Dialog::ModuleEditor => i18n::t("editModuleData"),
            Dialog::Preview => i18n::book_name(10).short,
            Dialog::AllCommentaries => i18n::t("allCommentaries"),
            Dialog::Picker => i18n::t("workbenchModules"),
            Dialog::None => return,
        };
        let mut still_open = true;
        let size = if self.session.dialog == Dialog::Navigation {
            [560.0, 560.0]
        } else {
            [560.0, 480.0]
        };
        egui::Window::new(title)
            .open(&mut still_open)
            .resizable(true)
            .default_size(size)
            .min_width(420.0)
            .min_height(320.0)
            .scroll(true)
            .show(ctx, |ui| match self.session.dialog {
                Dialog::Settings => self.settings_body(ui),
                Dialog::About => {
                    ui.label(i18n::t("aboutOpenSource"));
                }
                Dialog::Navigation => self.navigation_body(ui),
                Dialog::Convert => self.convert_body(ui),
                Dialog::ModuleEditor => self.editor_body(ui),
                Dialog::Preview => {
                    ui.label(&self.session.preview_body);
                }
                Dialog::AllCommentaries => {
                    ui.label(&self.session.commentary_overview);
                }
                Dialog::Picker => self.picker_body(ui),
                Dialog::None => {}
            });
        if !still_open {
            self.session.dialog = Dialog::None;
            self.nav = None;
            self.picker = None;
        }
    }

    fn settings_body(&mut self, ui: &mut egui::Ui) {
        ui.horizontal(|ui| {
            if ui.button(i18n::t("light")).clicked() {
                self.session.dark = false;
                self.patch_settings(json!({"theme": "light"}));
            }
            if ui.button(i18n::t("dark")).clicked() {
                self.session.dark = true;
                self.patch_settings(json!({"theme": "dark"}));
            }
        });
        if ui
            .add(
                egui::Slider::new(&mut self.session.font_size, 12.0..=32.0)
                    .text(i18n::t("fontSize")),
            )
            .changed()
        {
            self.patch_settings(json!({"fontSize": self.session.font_size}));
        }
        ui.horizontal(|ui| {
            for lang in [Lang::Pt, Lang::En, Lang::Es] {
                if ui.button(language_button(lang)).clicked() {
                    i18n::set_lang(lang.as_str());
                    self.patch_settings(json!({"language": lang.as_str()}));
                    self.matcher_lang_dirty();
                }
            }
        });
        let mut show = self.session.show_strongs;
        if ui
            .checkbox(&mut show, i18n::t("strongsDictionaries"))
            .changed()
        {
            self.session.show_strongs = show;
            self.patch_settings(json!({"showStrongs": show}));
        }
        ui.label(i18n::t("strongsDictsHint"));
        self.module_combo_setting(ui, "dictionary", true);
        ui.label(i18n::t("crossRefModulesHint"));
        egui::ScrollArea::vertical()
            .max_height(180.0)
            .show(ui, |ui| {
                self.toggle_module_list(ui, "crossreference", false);
            });
        let mut preview = self.session.preview_pinned;
        if ui
            .checkbox(&mut preview, i18n::t("crossRefPinnedModal"))
            .changed()
        {
            self.session.preview_pinned = preview;
            self.patch_settings(json!({"openPinnedRefsInModal": preview}));
        }
        ui.label(i18n::t("crossRefPinnedModalHint"));
    }

    fn matcher_lang_dirty(&mut self) {
        self.matcher_lang.clear();
    }

    fn module_combo_setting(&mut self, ui: &mut egui::Ui, kind: &str, strongs: bool) {
        let modules: Vec<_> = self
            .modules
            .iter()
            .filter(|module| module.kind == kind)
            .cloned()
            .collect();
        let current = if strongs {
            self.session.strongs_dicts.first().cloned()
        } else {
            self.session.xref_modules.first().cloned()
        };
        let label = modules
            .iter()
            .find(|module| current.as_deref() == Some(module.id.as_str()))
            .map(|module| module.name.clone())
            .unwrap_or_else(|| i18n::t("coverageNone"));
        egui::ComboBox::from_id_salt(format!("settings-{kind}"))
            .width(ui.available_width().min(420.0))
            .selected_text(label)
            .show_ui(ui, |ui| {
                if ui
                    .selectable_label(current.is_none(), i18n::t("coverageNone"))
                    .clicked()
                {
                    if strongs {
                        self.session.strongs_dicts.clear();
                        self.patch_settings(json!({"strongsDicts": null}));
                    } else {
                        self.session.xref_modules.clear();
                        self.patch_settings(json!({"crossRefModules": null}));
                    }
                }
                for module in &modules {
                    let selected = current.as_deref() == Some(module.id.as_str());
                    if ui.selectable_label(selected, &module.name).clicked() {
                        if strongs {
                            self.session.strongs_dicts = vec![module.id.clone()];
                            self.patch_settings(
                                json!({"strongsDicts": self.session.strongs_dicts}),
                            );
                        } else if !self.session.xref_modules.iter().any(|id| id == &module.id) {
                            self.session.xref_modules.push(module.id.clone());
                            self.patch_settings(
                                json!({"crossRefModules": self.session.xref_modules}),
                            );
                        }
                    }
                }
            });
    }

    fn toggle_module_list(&mut self, ui: &mut egui::Ui, kind: &str, strongs: bool) {
        let modules = self
            .modules
            .iter()
            .filter(|module| module.kind == kind)
            .cloned()
            .collect::<Vec<_>>();
        for module in modules {
            let selected = if strongs {
                self.session.strongs_dicts.iter().any(|id| id == &module.id)
            } else {
                self.session.xref_modules.iter().any(|id| id == &module.id)
            };
            if ui.selectable_label(selected, &module.name).clicked() {
                let list = if strongs {
                    &mut self.session.strongs_dicts
                } else {
                    &mut self.session.xref_modules
                };
                if let Some(pos) = list.iter().position(|id| id == &module.id) {
                    list.remove(pos);
                } else {
                    list.push(module.id.clone());
                }
                if strongs {
                    let values = self.session.strongs_dicts.clone();
                    self.patch_settings(json!({"strongsDicts": values}));
                } else {
                    let values = self.session.xref_modules.clone();
                    self.patch_settings(json!({"crossRefModules": values}));
                }
            }
        }
    }

    fn navigation_body(&mut self, ui: &mut egui::Ui) {
        if self.nav.is_none() {
            self.open_navigation();
        }
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
                    .font(egui::FontId::proportional(18.0)),
            )
            .lost_focus()
            && ui.input(|input_state| input_state.key_pressed(egui::Key::Enter));
        if let Some(nav) = self.nav.as_mut() {
            nav.input = input;
            if submitted {
                nav.submit_input();
            }
        }
        ui.separator();
        let screen = self.nav.as_ref().map(|nav| nav.screen.clone());
        egui::ScrollArea::vertical()
            .id_salt("nav-grid")
            .max_height(360.0)
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
                    self.number_grid(ui, &verses, 8, |nav, number| nav.select_verse(number));
                }
                _ => {}
            });
        ui.separator();
        ui.horizontal(|ui| {
            let back_visible = self.nav.as_ref().is_some_and(|nav| nav.back_visible);
            if back_visible && ui.button(i18n::t("back")).clicked() {
                if let Some(nav) = self.nav.as_mut() {
                    nav.back();
                }
            }
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                if ui.button(i18n::t("close")).clicked() {
                    self.session.dialog = Dialog::None;
                    self.nav = None;
                }
            });
        });
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
                if ui
                    .add_sized([cell - 6.0, 40.0], egui::Button::new(label).truncate())
                    .on_hover_text(title)
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

    fn convert_body(&mut self, ui: &mut egui::Ui) {
        ui.label(i18n::t("convertModulesDesc"));
        if ui.button(i18n::t("selectFiles")).clicked() {
            if let Some(files) = rfd::FileDialog::new().pick_files() {
                let dir = graphe_store::state::modules_dir(&graphe_store::state::user_home());
                let _ = std::fs::create_dir_all(&dir);
                for file in files {
                    self.session.status = match graphe_store::convert::convert_file(&file, &dir) {
                        Ok(path) => path.display().to_string(),
                        Err(err) => err.0,
                    };
                }
                self.reload_modules();
            }
        }
        if !self.session.status.is_empty() {
            ui.label(&self.session.status);
        }
    }

    fn picker_body(&mut self, ui: &mut egui::Ui) {
        if self.picker.is_none() {
            self.open_picker();
        }
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
                    is_fav,
                    highlighted,
                    ..
                } => {
                    ui.horizontal(|ui| {
                        if ui.selectable_label(*highlighted, name).clicked() {
                            if let Some(picker) = self.picker.as_mut() {
                                picker.click_index(index);
                            }
                        }
                        let mark = if *is_fav { "★" } else { "☆" };
                        if ui.button(mark).clicked() {
                            let module_id = id.clone();
                            let mut picker = self.picker.take();
                            if let Some(picker) = picker.as_mut() {
                                picker.toggle_favorite(&mut self.store, &module_id);
                            }
                            self.picker = picker;
                        }
                    });
                }
            }
        }
    }

    fn editor_body(&mut self, ui: &mut egui::Ui) {
        if self.editor_path.is_none() {
            self.editor_path = self.modules.first().map(|module| module.path.clone());
        }
        for module in self.modules.clone() {
            let selected = self.editor_path.as_ref() == Some(&module.path);
            if ui
                .selectable_label(selected, format!("{} ({})", module.name, module.kind))
                .clicked()
            {
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
}
