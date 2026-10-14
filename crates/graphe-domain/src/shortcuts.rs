/// README keyboard shortcuts. `primary` is Ctrl on Windows/Linux and Cmd on macOS.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ShortcutAction {
    FocusSearch,
    OpenNavigation,
    OpenSettings,
    OpenModuleEditor,
    ToggleTranslationPicker,
    CycleFavoriteTranslations,
    SplitHorizontal,
    SplitVertical,
    SelectAllVerses,
    CopyVerses,
    NextPane,
    VerseUp,
    VerseDown,
    ExtendUp,
    ExtendDown,
    CloseOverlay,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Shortcut {
    pub action: ShortcutAction,
    pub key: &'static str,
    pub primary: bool,
    pub shift: bool,
}

pub const SHORTCUTS: &[Shortcut] = &[
    Shortcut {
        action: ShortcutAction::FocusSearch,
        key: "F",
        primary: true,
        shift: true,
    },
    Shortcut {
        action: ShortcutAction::OpenNavigation,
        key: "F3",
        primary: false,
        shift: false,
    },
    Shortcut {
        action: ShortcutAction::OpenSettings,
        key: ",",
        primary: true,
        shift: false,
    },
    Shortcut {
        action: ShortcutAction::OpenModuleEditor,
        key: "E",
        primary: true,
        shift: false,
    },
    Shortcut {
        action: ShortcutAction::ToggleTranslationPicker,
        key: "T",
        primary: true,
        shift: false,
    },
    Shortcut {
        action: ShortcutAction::CycleFavoriteTranslations,
        key: "T",
        primary: true,
        shift: true,
    },
    Shortcut {
        action: ShortcutAction::SplitHorizontal,
        key: "H",
        primary: true,
        shift: true,
    },
    Shortcut {
        action: ShortcutAction::SplitVertical,
        key: "V",
        primary: true,
        shift: true,
    },
    Shortcut {
        action: ShortcutAction::SelectAllVerses,
        key: "A",
        primary: true,
        shift: false,
    },
    Shortcut {
        action: ShortcutAction::CopyVerses,
        key: "C",
        primary: true,
        shift: false,
    },
    Shortcut {
        action: ShortcutAction::NextPane,
        key: "Tab",
        primary: false,
        shift: false,
    },
    Shortcut {
        action: ShortcutAction::VerseUp,
        key: "ArrowUp",
        primary: false,
        shift: false,
    },
    Shortcut {
        action: ShortcutAction::VerseDown,
        key: "ArrowDown",
        primary: false,
        shift: false,
    },
    Shortcut {
        action: ShortcutAction::ExtendUp,
        key: "ArrowUp",
        primary: false,
        shift: true,
    },
    Shortcut {
        action: ShortcutAction::ExtendDown,
        key: "ArrowDown",
        primary: false,
        shift: true,
    },
    Shortcut {
        action: ShortcutAction::CloseOverlay,
        key: "Escape",
        primary: false,
        shift: false,
    },
];

/// Verse navigation and copy are ignored while a text field or dialog has focus.
pub fn suppressed_when_typing(action: ShortcutAction) -> bool {
    matches!(
        action,
        ShortcutAction::SelectAllVerses
            | ShortcutAction::CopyVerses
            | ShortcutAction::NextPane
            | ShortcutAction::VerseUp
            | ShortcutAction::VerseDown
            | ShortcutAction::ExtendUp
            | ShortcutAction::ExtendDown
    )
}

pub fn match_shortcut(key: &str, primary: bool, shift: bool) -> Option<ShortcutAction> {
    SHORTCUTS
        .iter()
        .find(|shortcut| {
            shortcut.key.eq_ignore_ascii_case(key)
                && shortcut.primary == primary
                && shortcut.shift == shift
        })
        .map(|shortcut| shortcut.action)
}

pub fn primary_modifier_name(macos: bool) -> &'static str {
    if macos {
        "Cmd"
    } else {
        "Ctrl"
    }
}

#[cfg(test)]
mod shortcut_tests {
    use super::*;

    #[test]
    fn readme_shortcuts_map_to_study_actions() {
        assert_eq!(
            match_shortcut("F", true, true),
            Some(ShortcutAction::FocusSearch)
        );
        assert_eq!(
            match_shortcut("F3", false, false),
            Some(ShortcutAction::OpenNavigation)
        );
        assert_eq!(
            match_shortcut(",", true, false),
            Some(ShortcutAction::OpenSettings)
        );
        assert_eq!(
            match_shortcut("E", true, false),
            Some(ShortcutAction::OpenModuleEditor)
        );
        assert_eq!(
            match_shortcut("T", true, false),
            Some(ShortcutAction::ToggleTranslationPicker)
        );
        assert_eq!(
            match_shortcut("T", true, true),
            Some(ShortcutAction::CycleFavoriteTranslations)
        );
        assert_eq!(
            match_shortcut("H", true, true),
            Some(ShortcutAction::SplitHorizontal)
        );
        assert_eq!(
            match_shortcut("V", true, true),
            Some(ShortcutAction::SplitVertical)
        );
        assert_eq!(
            match_shortcut("A", true, false),
            Some(ShortcutAction::SelectAllVerses)
        );
        assert_eq!(
            match_shortcut("C", true, false),
            Some(ShortcutAction::CopyVerses)
        );
        assert_eq!(
            match_shortcut("Tab", false, false),
            Some(ShortcutAction::NextPane)
        );
        assert_eq!(
            match_shortcut("ArrowUp", false, true),
            Some(ShortcutAction::ExtendUp)
        );
        assert_eq!(
            match_shortcut("Escape", false, false),
            Some(ShortcutAction::CloseOverlay)
        );
        assert_eq!(primary_modifier_name(true), "Cmd");
        assert_eq!(primary_modifier_name(false), "Ctrl");
        assert_eq!(SHORTCUTS.len(), 16);
        assert!(suppressed_when_typing(ShortcutAction::SelectAllVerses));
        assert!(suppressed_when_typing(ShortcutAction::NextPane));
        assert!(suppressed_when_typing(ShortcutAction::VerseDown));
        assert!(!suppressed_when_typing(ShortcutAction::OpenNavigation));
        assert!(!suppressed_when_typing(ShortcutAction::FocusSearch));
    }
}
