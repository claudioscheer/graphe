//! Window, dock, and taskbar icon.
//!
//! The PNG is passed to eframe so Linux, macOS, and Windows get it at runtime.
//! On Linux a Wayland panel looks the icon up by app id, so startup also writes
//! `graphe.desktop` and a hicolor PNG under the user's data directory.

use std::path::Path;
#[cfg(target_os = "linux")]
use std::path::PathBuf;

pub(crate) const APP_ID: &str = "graphe";

const ICON_PNG: &[u8] = include_bytes!("../../../assets/graphe.png");

pub(crate) fn mark_png() -> &'static [u8] {
    ICON_PNG
}

pub(crate) fn load_icon() -> Option<egui::IconData> {
    match eframe::icon_data::from_png_bytes(ICON_PNG) {
        Ok(icon) => Some(icon),
        Err(err) => {
            eprintln!("Failed to load app icon: {err}");
            None
        }
    }
}

#[allow(dead_code)]
pub(crate) fn desktop_entry(exe: &str) -> String {
    format!(
        "[Desktop Entry]\n\
         Name=Graphe\n\
         Comment=Bible study\n\
         Exec={exe}\n\
         Icon={APP_ID}\n\
         Terminal=false\n\
         Type=Application\n\
         Categories=Education;\n\
         StartupWMClass={APP_ID}\n"
    )
}

/// Writes the hicolor PNGs and the desktop file. Returns whether an icon file changed.
#[allow(dead_code)]
pub(crate) fn install_desktop_files(data_dir: &Path, exe: &str) -> bool {
    let apps_dir = data_dir.join("applications");
    let png_256 = data_dir.join("icons/hicolor/256x256/apps");
    let png_512 = data_dir.join("icons/hicolor/512x512/apps");
    let _ = std::fs::create_dir_all(&apps_dir);
    let _ = std::fs::create_dir_all(&png_256);
    let _ = std::fs::create_dir_all(&png_512);

    let mut icon_updated = write_if_changed(&png_256.join("graphe.png"), ICON_PNG);
    if write_if_changed(&png_512.join("graphe.png"), ICON_PNG) {
        icon_updated = true;
    }

    let desktop = desktop_entry(exe);
    let _ = write_if_changed(&apps_dir.join("graphe.desktop"), desktop.as_bytes());
    icon_updated
}

#[allow(dead_code)]
fn write_if_changed(path: &Path, bytes: &[u8]) -> bool {
    if std::fs::read(path).ok().as_deref() == Some(bytes) {
        return false;
    }
    std::fs::write(path, bytes).is_ok()
}

#[cfg(target_os = "linux")]
pub(crate) fn ensure_linux_desktop_entry() {
    let Some(data_dir) = xdg_data_home() else {
        return;
    };
    let exe = std::env::current_exe()
        .map(|path| path.to_string_lossy().into_owned())
        .unwrap_or_else(|_| APP_ID.to_string());
    if install_desktop_files(&data_dir, &exe) {
        let hicolor = data_dir.join("icons/hicolor");
        let _ = std::process::Command::new("gtk-update-icon-cache")
            .arg("-q")
            .arg("-f")
            .arg("-t")
            .arg(&hicolor)
            .status();
    }
}

#[cfg(target_os = "linux")]
fn xdg_data_home() -> Option<PathBuf> {
    std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".local/share")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn load_icon_is_the_graphe_mark() {
        let icon = load_icon().expect("graphe.png");
        assert_eq!(icon.width, 512);
        assert_eq!(icon.height, 512);
        assert_eq!(icon.rgba.len(), 512 * 512 * 4);
    }

    #[test]
    fn desktop_entry_names_the_graphe_icon() {
        let entry = desktop_entry("/usr/bin/graphe");
        assert!(entry.contains("Name=Graphe\n"));
        assert!(entry.contains("Exec=/usr/bin/graphe\n"));
        assert!(entry.contains("Icon=graphe\n"));
        assert!(entry.contains("StartupWMClass=graphe\n"));
    }

    #[test]
    fn install_writes_the_png_and_desktop_file_once() {
        let root = std::env::temp_dir().join(format!("graphe-icon-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        assert!(install_desktop_files(&root, "/tmp/graphe"));
        assert_eq!(
            std::fs::read(root.join("icons/hicolor/256x256/apps/graphe.png")).unwrap(),
            ICON_PNG
        );
        assert_eq!(
            std::fs::read(root.join("icons/hicolor/512x512/apps/graphe.png")).unwrap(),
            ICON_PNG
        );
        assert_eq!(
            std::fs::read_to_string(root.join("applications/graphe.desktop")).unwrap(),
            desktop_entry("/tmp/graphe")
        );
        assert!(!install_desktop_files(&root, "/tmp/graphe"));
        assert!(!install_desktop_files(&root, "/opt/graphe"));
        assert_eq!(
            std::fs::read_to_string(root.join("applications/graphe.desktop")).unwrap(),
            desktop_entry("/opt/graphe")
        );
        let _ = std::fs::remove_dir_all(&root);
    }
}
