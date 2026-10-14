//! Commentary pane scroll restoration.
use crate::model::CommentaryRestoreScroll;

pub fn normalize_content_scroll_top(value: Option<f64>) -> Option<f64> {
    value.filter(|value| value.is_finite() && *value >= 0.0)
}

pub fn pick_commentary_restore_scroll(
    restore_scroll: bool,
    saved_scroll_top: Option<f64>,
    scroll_to_verse: Option<i64>,
) -> CommentaryRestoreScroll {
    if restore_scroll {
        if let Some(value) = saved_scroll_top.filter(|v| v.is_finite()) {
            return CommentaryRestoreScroll::ScrollTop { value };
        }
    }
    if let Some(value) = scroll_to_verse {
        if value > 0 {
            return CommentaryRestoreScroll::Verse { value };
        }
    }
    CommentaryRestoreScroll::Top
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn normalizes_saved_content_scroll_offsets() {
        assert_eq!(normalize_content_scroll_top(Some(120.5)), Some(120.5));
        assert_eq!(normalize_content_scroll_top(Some(0.0)), Some(0.0));
        assert_eq!(normalize_content_scroll_top(Some(-1.0)), None);
        assert_eq!(normalize_content_scroll_top(None), None);
    }

    #[test]
    fn prefers_saved_scroll_when_restoring_a_commentary_pane() {
        assert_eq!(
            pick_commentary_restore_scroll(true, Some(240.0), Some(5)),
            CommentaryRestoreScroll::ScrollTop { value: 240.0 }
        );
        assert_eq!(
            pick_commentary_restore_scroll(true, Some(0.0), Some(5)),
            CommentaryRestoreScroll::ScrollTop { value: 0.0 }
        );
        assert_eq!(
            pick_commentary_restore_scroll(true, None, Some(5)),
            CommentaryRestoreScroll::Verse { value: 5 }
        );
        assert_eq!(
            pick_commentary_restore_scroll(true, None, None),
            CommentaryRestoreScroll::Top
        );
    }

    #[test]
    fn scrolls_to_the_verse_or_top_when_not_restoring_a_saved_offset() {
        assert_eq!(
            pick_commentary_restore_scroll(false, Some(240.0), Some(8)),
            CommentaryRestoreScroll::Verse { value: 8 }
        );
        assert_eq!(
            pick_commentary_restore_scroll(false, Some(240.0), None),
            CommentaryRestoreScroll::Top
        );
        assert_eq!(
            pick_commentary_restore_scroll(false, Some(240.0), Some(0)),
            CommentaryRestoreScroll::Top
        );
    }
}
