//! In-process egui_kittest harness for the workbench.
//!
//! Layout marks still own geometry. This module drives a named control, then
//! checks session state. A full-window image diff is not stable across the
//! three CI operating systems, so the render check only proves wgpu produced
//! a frame.

use egui_kittest::kittest::Queryable;

use crate::app::tests::bare;
use crate::app::GrapheApp;
use crate::paint;
use crate::session::{Dialog, Session};
use graphe_domain::i18n;

fn workbench(width: f32, height: f32) -> egui_kittest::Harness<'static, GrapheApp> {
    let app = bare(Session::new());
    i18n::set_lang("en");
    let mut fonts_ready = false;
    egui_kittest::Harness::builder()
        .with_size(egui::vec2(width, height))
        .with_max_steps(16)
        // Verse rows and other painted clicks are not named. The activity
        // buttons this harness drives are named with `widget_info`.
        .with_accessibility_check(false)
        .build_ui_state(
            move |ui, app: &mut GrapheApp| {
                if !fonts_ready {
                    paint::install_fonts(ui.ctx());
                    paint::apply(ui.ctx(), app.session.dark, app.session.font_size);
                    fonts_ready = true;
                }
                app.show_workbench(ui);
            },
            app,
        )
}

#[test]
fn settings_button_opens_the_settings_dialog() {
    let mut harness = workbench(1180.0, 760.0);
    let label = i18n::t("settings");
    harness.get_by_label(&label).click();
    harness.run();
    assert_eq!(harness.state().session.dialog, Dialog::Settings);

    let image = harness.render().expect("wgpu snapshot renderer");
    assert_eq!(
        (image.width(), image.height()),
        (1180, 760),
        "the renderer uses the harness size"
    );
    assert!(
        image.as_raw().iter().any(|channel| *channel > 0),
        "the rendered frame has visible pixels"
    );
}

#[test]
fn clicking_commentary_reference_after_selecting_text_in_workbench() {
    let user_profile = match std::env::var("USERPROFILE") {
        Ok(val) => val,
        Err(_) => return,
    };
    let bible_path = std::path::PathBuf::from(&user_profile)
        .join(".graphe")
        .join("modules")
        .join("Nova Almeida Atualizada.bible.SQLite3");
    let comm_path = std::path::PathBuf::from(&user_profile)
        .join(".graphe")
        .join("modules")
        .join("Comentario Biblico Champlin Completo.commentary.SQLite3");
    if !bible_path.exists() || !comm_path.exists() {
        return;
    }

    let mut app = bare(Session::new());
    app.session.sidebar_collapsed = true;
    app.modules.push(graphe_store::catalog::InstalledModule {
        id: "NAA".into(),
        name: "NAA".into(),
        kind: "bible".into(),
        path: bible_path,
        short_title: None,
        description: None,
    });
    app.modules.push(graphe_store::catalog::InstalledModule {
        id: "Champlin".into(),
        name: "Champlin".into(),
        kind: "commentary".into(),
        path: comm_path,
        short_title: None,
        description: None,
    });
    app.session.panes.get_mut("pane-1").unwrap().module_id = Some("NAA".into());
    let comm_pane = app.session.split_commentary(false);
    if let Some(record) = app.session.panes.get_mut(&comm_pane) {
        record.module_id = Some("Champlin".into());
        record.synced_to_pane_id = Some("pane-1".into());
    }
    app.session.active_pane_id = "pane-1".into();
    app.session.navigate(650, 10, Some(26));

    let mut fonts_ready = false;
    let mut harness = egui_kittest::Harness::builder()
        .with_size(egui::vec2(1200.0, 800.0))
        .with_max_steps(16)
        .with_accessibility_check(false)
        .build_ui_state(
            move |ui, app: &mut GrapheApp| {
                if !fonts_ready {
                    paint::install_fonts(ui.ctx());
                    paint::apply(ui.ctx(), app.session.dark, app.session.font_size);
                    fonts_ready = true;
                }
                app.show_workbench(ui);
            },
            app,
        );

    harness.run();

    let repo_root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|p| p.parent())
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| std::path::PathBuf::from("."));
    let shot_dir = repo_root.join("temp").join("screenshots");
    let _ = std::fs::create_dir_all(&shot_dir);

    let img = harness.render().expect("render before");
    let _ = img.save(shot_dir.join("60-before.png"));

    let marks = harness.ctx.data(|d| {
        d.get_temp::<Vec<(String, [f32; 4])>>(egui::Id::unique("pane-layout-marks"))
            .unwrap_or_default()
    });
    let text_rect = marks
        .iter()
        .find(|(k, _)| k == &format!("commentary-text:{comm_pane}"))
        .map(|(_, r)| *r)
        .expect("commentary text rect");

    let window = harness
        .state()
        .reading
        .commentary_window(&comm_pane)
        .expect("commentary window");
    assert!(!window.links.is_empty(), "links must exist in Hebrews 10:26");
    let first_link = window.links[0];
    let link_cursor = window.galley.pos_from_cursor(egui::text::CCursor::new(first_link.start));
    let link_pos = egui::pos2(
        text_rect[0] + link_cursor.min.x + 5.0,
        text_rect[1] + link_cursor.min.y + 5.0,
    );

    let p_start = egui::pos2(text_rect[0] + 50.0, 300.0);
    let p_end = egui::pos2(text_rect[0] + 150.0, 300.0);
    harness.event(egui::Event::PointerMoved(p_start));
    harness.event(egui::Event::PointerButton {
        pos: p_start,
        button: egui::PointerButton::Primary,
        pressed: true,
        modifiers: egui::Modifiers::default(),
    });
    harness.step();
    harness.event(egui::Event::PointerMoved(p_end));
    harness.step();
    harness.event(egui::Event::PointerButton {
        pos: p_end,
        button: egui::PointerButton::Primary,
        pressed: false,
        modifiers: egui::Modifiers::default(),
    });
    harness.step();

    assert!(crate::app::label_has_selection(&harness.ctx));

    // Click link:
    harness.event(egui::Event::PointerMoved(link_pos));
    harness.step();
    harness.event(egui::Event::PointerButton {
        pos: link_pos,
        button: egui::PointerButton::Primary,
        pressed: true,
        modifiers: egui::Modifiers::default(),
    });
    harness.step();
    harness.event(egui::Event::PointerMoved(link_pos + egui::vec2(2.0, 1.0)));
    harness.step();
    harness.event(egui::Event::PointerButton {
        pos: link_pos + egui::vec2(2.0, 1.0),
        button: egui::PointerButton::Primary,
        pressed: false,
        modifiers: egui::Modifiers::default(),
    });
    harness.run();

    let bible = harness.state().session.panes.get("pane-1").unwrap();
    assert_eq!(bible.book_number, first_link.book);
    assert_eq!(bible.chapter, first_link.chapter);
    assert_eq!(bible.selected_verse, first_link.verse);
    assert!(!crate::app::label_has_selection(&harness.ctx));

    let img_after = harness.render().expect("render after");
    let _ = img_after.save(shot_dir.join("60-after.png"));
}

#[test]
fn clicking_champlin_deut_reference_in_workbench() {
    let user_profile = match std::env::var("USERPROFILE") {
        Ok(val) => val,
        Err(_) => return,
    };
    let bible_path = std::path::PathBuf::from(&user_profile)
        .join(".graphe")
        .join("modules")
        .join("Nova Almeida Atualizada.bible.SQLite3");
    let comm_path = std::path::PathBuf::from(&user_profile)
        .join(".graphe")
        .join("modules")
        .join("Comentario Biblico Champlin Completo.commentary.SQLite3");
    if !bible_path.exists() || !comm_path.exists() {
        return;
    }

    i18n::set_lang("pt");
    let mut app = bare(Session::new());
    app.session.sidebar_collapsed = true;
    app.modules.push(graphe_store::catalog::InstalledModule {
        id: "NAA".into(),
        name: "NAA".into(),
        kind: "bible".into(),
        path: bible_path.clone(),
        short_title: None,
        description: None,
    });
    app.modules.push(graphe_store::catalog::InstalledModule {
        id: "Champlin".into(),
        name: "Champlin".into(),
        kind: "commentary".into(),
        path: comm_path.clone(),
        short_title: None,
        description: None,
    });
    app.session.panes.get_mut("pane-1").unwrap().module_id = Some("NAA".into());
    let comm_pane = app.session.split_commentary(false);
    if let Some(record) = app.session.panes.get_mut(&comm_pane) {
        record.module_id = Some("Champlin".into());
        record.synced_to_pane_id = Some("pane-1".into());
    }
    app.session.active_pane_id = "pane-1".into();
    app.session.navigate(650, 10, Some(26));

    let repo_root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|p| p.parent())
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| std::path::PathBuf::from("."));
    let shot_dir = repo_root.join("temp").join("screenshots");
    let _ = std::fs::create_dir_all(&shot_dir);

    // 1. Capture bug reproduction (before fix): Deut. 17:26 stayed plain text
    {
        let mut app_before = bare(Session::new());
        app_before.session.sidebar_collapsed = true;
        app_before.modules.push(graphe_store::catalog::InstalledModule {
            id: "NAA".into(),
            name: "NAA".into(),
            kind: "bible".into(),
            path: bible_path.clone(),
            short_title: None,
            description: None,
        });
        app_before.modules.push(graphe_store::catalog::InstalledModule {
            id: "Champlin".into(),
            name: "Champlin".into(),
            kind: "commentary".into(),
            path: comm_path.clone(),
            short_title: None,
            description: None,
        });
        app_before.session.panes.get_mut("pane-1").unwrap().module_id = Some("NAA".into());
        let comm = app_before.session.split_commentary(false);
        if let Some(r) = app_before.session.panes.get_mut(&comm) {
            r.module_id = Some("Champlin".into());
            r.synced_to_pane_id = Some("pane-1".into());
        }
        app_before.session.active_pane_id = "pane-1".into();
        app_before.session.navigate(650, 10, Some(26));
        let legacy_names = graphe_domain::books::GRAPHE_BOOK_NUMBERS
            .iter()
            .map(|n| {
                let name = i18n::book_name(i64::from(*n));
                graphe_domain::commentary_ref::BookName {
                    short: name.short,
                    long: if *n == 50 { "Dt".into() } else { name.long },
                }
            })
            .collect();
        let legacy_numbers: Vec<i64> = graphe_domain::books::GRAPHE_BOOK_NUMBERS
            .iter()
            .map(|n| if *n == 50 { 999 } else { i64::from(*n) })
            .collect();
        app_before.matcher = Some(graphe_domain::commentary_ref::build_reference_matcher(
            &[legacy_names],
            &legacy_numbers,
        ));
        app_before.matcher_lang = "pt".into();

        let mut fonts_ready = false;
        let mut harness_before = egui_kittest::Harness::builder()
            .with_size(egui::vec2(1200.0, 800.0))
            .with_max_steps(16)
            .with_accessibility_check(false)
            .build_ui_state(
                move |ui, app: &mut GrapheApp| {
                    if !fonts_ready {
                        paint::install_fonts(ui.ctx());
                        paint::apply(ui.ctx(), app.session.dark, app.session.font_size);
                        fonts_ready = true;
                    }
                    app.show_workbench(ui);
                },
                app_before,
            );
        harness_before.run();
        let wheel_at = egui::pos2(800.0, 400.0);
        for _ in 0..4 {
            harness_before.event(egui::Event::PointerMoved(wheel_at));
            harness_before.event(egui::Event::MouseWheel {
                unit: egui::MouseWheelUnit::Point,
                delta: egui::vec2(0.0, -480.0),
                phase: egui::TouchPhase::Move,
                source: egui::MouseWheelSource::Unknown,
                modifiers: egui::Modifiers::default(),
            });
            harness_before.step();
        }
        harness_before.event(egui::Event::PointerMoved(wheel_at));
        harness_before.event(egui::Event::MouseWheel {
            unit: egui::MouseWheelUnit::Point,
            delta: egui::vec2(0.0, -200.0),
            phase: egui::TouchPhase::Move,
            source: egui::MouseWheelSource::Unknown,
            modifiers: egui::Modifiers::default(),
        });
        harness_before.step();
        harness_before.run();

        let img_before = harness_before.render().expect("render before");
        let _ = img_before.save(shot_dir.join("61-before.png"));
    }

    let mut fonts_ready = false;
    let mut harness = egui_kittest::Harness::builder()
        .with_size(egui::vec2(1200.0, 800.0))
        .with_max_steps(16)
        .with_accessibility_check(false)
        .build_ui_state(
            move |ui, app: &mut GrapheApp| {
                if !fonts_ready {
                    paint::install_fonts(ui.ctx());
                    paint::apply(ui.ctx(), app.session.dark, app.session.font_size);
                    fonts_ready = true;
                }
                app.show_workbench(ui);
            },
            app,
        );

    // Initial render at Hebrews 10:26
    harness.run();

    // Scroll down to piece containing Deut. 17:26
    let wheel_at = egui::pos2(800.0, 400.0);
    for _ in 0..4 {
        harness.event(egui::Event::PointerMoved(wheel_at));
        harness.event(egui::Event::MouseWheel {
            unit: egui::MouseWheelUnit::Point,
            delta: egui::vec2(0.0, -480.0),
            phase: egui::TouchPhase::Move,
            source: egui::MouseWheelSource::Unknown,
            modifiers: egui::Modifiers::default(),
        });
        harness.step();
    }
    harness.event(egui::Event::PointerMoved(wheel_at));
    harness.event(egui::Event::MouseWheel {
        unit: egui::MouseWheelUnit::Point,
        delta: egui::vec2(0.0, -200.0),
        phase: egui::TouchPhase::Move,
        source: egui::MouseWheelSource::Unknown,
        modifiers: egui::Modifiers::default(),
    });
    harness.step();
    harness.run();

    let marks = harness.ctx.data(|d| {
        d.get_temp::<Vec<(String, [f32; 4])>>(egui::Id::unique("pane-layout-marks"))
            .unwrap_or_default()
    });
    let text_rect = marks
        .iter()
        .find(|(k, _)| k == &format!("commentary-text:{comm_pane}"))
        .map(|(_, r)| *r)
        .expect("commentary text rect");

    let (_deut_link, link_pos) = {
        let window = harness
            .state()
            .reading
            .commentary_window(&comm_pane)
            .expect("commentary window");
        let deut_link = window
            .links
            .iter()
            .find(|l| l.book == 50 && l.chapter == 17 && l.verse == Some(26))
            .copied()
            .expect("Deut. 17:26 link must exist in commentary window");
        let link_cursor = window.galley.pos_from_cursor(egui::text::CCursor::new(deut_link.start));
        let link_pos = egui::pos2(
            text_rect[0] + link_cursor.min.x + 5.0,
            text_rect[1] + link_cursor.min.y + 5.0,
        );
        (deut_link, link_pos)
    };

    // Click link:
    harness.event(egui::Event::PointerMoved(link_pos));
    harness.step();
    harness.event(egui::Event::PointerButton {
        pos: link_pos,
        button: egui::PointerButton::Primary,
        pressed: true,
        modifiers: egui::Modifiers::default(),
    });
    harness.step();
    harness.event(egui::Event::PointerMoved(link_pos + egui::vec2(2.0, 1.0)));
    harness.step();
    harness.event(egui::Event::PointerButton {
        pos: link_pos + egui::vec2(2.0, 1.0),
        button: egui::PointerButton::Primary,
        pressed: false,
        modifiers: egui::Modifiers::default(),
    });
    harness.run();

    let bible = harness.state().session.panes.get("pane-1").unwrap();
    assert_eq!(bible.book_number, 50);
    assert_eq!(bible.chapter, 17);
    assert_eq!(bible.selected_verse, Some(26));

    let img_after = harness.render().expect("render after");
    let _ = img_after.save(shot_dir.join("61-after.png"));
}

