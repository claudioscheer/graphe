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
