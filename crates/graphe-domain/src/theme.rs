/// Light and dark workbench colors. Light background `#fefdf9`, dark `#181818`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct UiPalette {
    pub ui_bg: &'static str,
    pub ui_surface: &'static str,
    pub ui_surface_muted: &'static str,
    pub ui_surface_elevated: &'static str,
    pub ui_text: &'static str,
    pub ui_text_muted: &'static str,
    pub ui_text_subtle: &'static str,
    pub ui_text_dim: &'static str,
    pub ui_border: &'static str,
    pub ui_border_soft: &'static str,
    pub ui_border_strong: &'static str,
    pub ui_border_stronger: &'static str,
    pub ui_link: &'static str,
    pub ui_link_strong: &'static str,
    pub ui_link_soft: &'static str,
    pub ui_link_softest: &'static str,
    pub ui_accent_bg_soft: &'static str,
    pub ui_accent_bg: &'static str,
    pub ui_accent_ink: &'static str,
    pub ui_warn: &'static str,
    pub ui_warn_text: &'static str,
    pub ui_verse_num: &'static str,
}

pub const LIGHT: UiPalette = UiPalette {
    ui_bg: "#fefdf9",
    ui_surface: "#ffffff",
    ui_surface_muted: "#f8f5ed",
    ui_surface_elevated: "#ffffff",
    ui_text: "#362f27",
    ui_text_muted: "#65543f",
    ui_text_subtle: "#99835f",
    ui_text_dim: "#b6ad8c",
    ui_border: "#d3ceb9",
    ui_border_soft: "#e3e0d3",
    ui_border_strong: "#99835f",
    ui_border_stronger: "#7f6b4f",
    ui_link: "#65543f",
    ui_link_strong: "#4c4134",
    ui_link_soft: "#99835f",
    ui_link_softest: "#b6ad8c",
    ui_accent_bg_soft: "#f8f5ed",
    ui_accent_bg: "#e3e0d3",
    ui_accent_ink: "#362f27",
    ui_warn: "#c18a1f",
    ui_warn_text: "#8f5f11",
    ui_verse_num: "#9b4d3a",
};

pub const DARK: UiPalette = UiPalette {
    ui_bg: "#181818",
    ui_surface: "#1f1f1f",
    ui_surface_muted: "#252526",
    ui_surface_elevated: "#2d2d2d",
    ui_text: "#e7e7e7",
    ui_text_muted: "#c8c8c8",
    ui_text_subtle: "#9d9d9d",
    ui_text_dim: "#747474",
    ui_border: "#333333",
    ui_border_soft: "#2a2a2a",
    ui_border_strong: "#3f3f46",
    ui_border_stronger: "#52525b",
    ui_link: "#d6a85f",
    ui_link_strong: "#f0c776",
    ui_link_soft: "#c89b55",
    ui_link_softest: "#e0bb78",
    ui_accent_bg_soft: "#2a2520",
    ui_accent_bg: "#3a2f22",
    ui_accent_ink: "#f3f3f3",
    ui_warn: "#c18a1f",
    ui_warn_text: "#f6df9c",
    ui_verse_num: "#d4a089",
};

/// VS Code-like radii from the design system. 8px+ is reserved for pills.
pub const RADIUS_INLINE: f32 = 2.0;
pub const RADIUS_CONTROL: f32 = 4.0;
pub const RADIUS_SURFACE: f32 = 6.0;
pub const RADIUS_PILL: f32 = 9999.0;

pub fn palette(dark: bool) -> &'static UiPalette {
    if dark {
        &DARK
    } else {
        &LIGHT
    }
}

#[cfg(test)]
mod theme_tests {
    use super::*;

    #[test]
    fn light_and_dark_ui_colors_match_the_stylesheet() {
        assert_eq!(LIGHT.ui_bg, "#fefdf9");
        assert_eq!(DARK.ui_bg, "#181818");
        assert_eq!(LIGHT.ui_text, "#362f27");
        assert_eq!(DARK.ui_text, "#e7e7e7");
        assert_eq!(LIGHT.ui_surface, "#ffffff");
        assert_eq!(DARK.ui_surface, "#1f1f1f");
        assert_eq!(LIGHT.ui_border, "#d3ceb9");
        assert_eq!(DARK.ui_border, "#333333");
        assert_eq!(LIGHT.ui_link, "#65543f");
        assert_eq!(DARK.ui_link, "#d6a85f");
        assert!(RADIUS_INLINE < 8.0 && RADIUS_CONTROL < 8.0 && RADIUS_SURFACE < 8.0);
        assert!(RADIUS_PILL > 8.0);
    }
}
