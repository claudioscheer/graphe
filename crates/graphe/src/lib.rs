//! Graphe desktop shell.
//!
//! [`session`] owns study actions. [`app`] draws them with egui. Book numbers,
//! search parsing, and pane rules stay in `graphe-domain`. SQLite stays in
//! `graphe-store`.

mod app;
mod dialogs;
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
