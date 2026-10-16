//! Graphe desktop shell.
//!
//! [`session`] owns study actions. [`app`] draws them with egui. Book numbers,
//! search parsing, and pane rules stay in `graphe-domain`. SQLite stays in
//! `graphe-store`.

mod app;
#[cfg(test)]
mod kit;

/// Test frames are not painted by a window backend. egui 0.37 debug-asserts
/// if a [`egui::FullOutput`] is dropped while it still holds a font-atlas
/// update, which aborts the test and hides the real assertion.
#[cfg(test)]
pub(crate) trait RunTestUi {
    fn run_test_ui(
        &self,
        new_input: egui::RawInput,
        run_ui: impl FnMut(&mut egui::Ui),
    ) -> egui::FullOutput;
}

#[cfg(test)]
impl RunTestUi for egui::Context {
    fn run_test_ui(
        &self,
        new_input: egui::RawInput,
        run_ui: impl FnMut(&mut egui::Ui),
    ) -> egui::FullOutput {
        let mut output = self.run_ui(new_input, run_ui);
        output.textures_delta.clear();
        output
    }
}
mod chrome;
mod dialogs;
pub(crate) mod dropdown;
mod icon;
mod paint;
mod session;
mod side;
pub mod startup;
mod study;
mod update;

pub use startup::{build_running_model, build_startup_model, describe_startup};

pub fn run() -> eframe::Result {
    app::run()
}
