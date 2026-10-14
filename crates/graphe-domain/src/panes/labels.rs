//! Spreadsheet-style pane labels (A, B, … AA).
use crate::model::{PaneRecord, PaneType};
use indexmap::IndexMap;

pub fn parse_pane_number(id: Option<&str>) -> i64 {
    let Some(id) = id else {
        return 0;
    };
    let Some(rest) = id.strip_prefix("pane-") else {
        return 0;
    };
    if rest.is_empty() || !rest.chars().all(|c| c.is_ascii_digit()) {
        return 0;
    }
    rest.parse().unwrap_or(0)
}

pub fn label_for_index(index: i64) -> String {
    let alphabet = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    let mut n = index.max(0);
    let mut out = String::new();
    loop {
        out.insert(0, alphabet[(n % 26) as usize] as char);
        n = n / 26 - 1;
        if n < 0 {
            break;
        }
    }
    out
}

pub fn normalize_window_label(candidate: Option<&str>) -> Option<String> {
    let trimmed = candidate?.trim().to_uppercase();
    if !trimmed.is_empty() && trimmed.chars().all(|c| c.is_ascii_uppercase()) {
        Some(trimmed)
    } else {
        None
    }
}

pub fn collect_used_window_labels(panes: &IndexMap<String, PaneRecord>) -> Vec<String> {
    let mut used = Vec::new();
    for pane in panes.values() {
        if pane.pane_type != PaneType::Bible {
            continue;
        }
        if let Some(label) = normalize_window_label(pane.window_label.as_deref()) {
            if !used.contains(&label) {
                used.push(label);
            }
        }
    }
    used
}

pub fn allocate_pane_label(
    panes: &IndexMap<String, PaneRecord>,
    pane_type: PaneType,
    preferred: Option<&str>,
) -> Option<String> {
    if pane_type != PaneType::Bible {
        return None;
    }
    let used = collect_used_window_labels(panes);
    if let Some(preferred) = normalize_window_label(preferred) {
        if !used.contains(&preferred) {
            return Some(preferred);
        }
    }
    let mut idx = 0;
    while used.iter().any(|label| label == &label_for_index(idx)) {
        idx += 1;
    }
    Some(label_for_index(idx))
}

pub fn get_pane_display_label(panes: &IndexMap<String, PaneRecord>, pane_id: &str) -> String {
    let Some(pane) = panes.get(pane_id) else {
        return String::new();
    };
    if pane.pane_type == PaneType::Commentary {
        if let Some(synced) = pane.synced_to_pane_id.as_deref() {
            if panes.get(synced).map(|p| p.pane_type) == Some(PaneType::Bible) {
                return get_pane_display_label(panes, synced);
            }
        }
        return "–".to_string();
    }
    normalize_window_label(pane.window_label.as_deref())
        .unwrap_or_else(|| pane_id.replace("pane-", ""))
}

pub fn ensure_window_labels(panes: &mut IndexMap<String, PaneRecord>) {
    let mut used = Vec::new();
    let ids: Vec<String> = panes.keys().cloned().collect();
    for id in ids {
        let pane = panes.get_mut(&id).unwrap();
        if pane.pane_type != PaneType::Bible {
            pane.window_label = None;
            continue;
        }
        if let Some(normalized) = normalize_window_label(pane.window_label.as_deref()) {
            if !used.contains(&normalized) {
                pane.window_label = Some(normalized.clone());
                used.push(normalized);
                continue;
            }
        }
        let mut idx = 0;
        while used.iter().any(|label| label == &label_for_index(idx)) {
            idx += 1;
        }
        let label = label_for_index(idx);
        pane.window_label = Some(label.clone());
        used.push(label);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::PaneType;

    fn bible_pane(id: &str) -> PaneRecord {
        PaneRecord {
            id: id.into(),
            pane_type: PaneType::Bible,
            window_label: None,
            module_id: Some("kjv".into()),
            book_number: 10,
            chapter: 1,
            book_short_name: "Gen".into(),
            selected_verse: None,
            nav_history: Vec::new(),
            nav_history_idx: -1,
            synced_to_pane_id: None,
            content_scroll_top: None,
        }
    }

    fn commentary_pane(id: &str, synced: Option<&str>) -> PaneRecord {
        let mut pane = bible_pane(id);
        pane.pane_type = PaneType::Commentary;
        pane.module_id = Some("comm".into());
        pane.synced_to_pane_id = synced.map(|s| s.to_string());
        pane
    }
    #[test]
    fn parses_pane_ids_and_generates_spreadsheet_labels() {
        assert_eq!(parse_pane_number(Some("pane-27")), 27);
        assert_eq!(parse_pane_number(Some("pane-x")), 0);
        assert_eq!(parse_pane_number(None), 0);
        assert_eq!(label_for_index(-1), "A");
        assert_eq!(label_for_index(0), "A");
        assert_eq!(label_for_index(25), "Z");
        assert_eq!(label_for_index(26), "AA");
        assert_eq!(label_for_index(27), "AB");
    }

    #[test]
    fn normalizes_allocates_collects_and_repairs_bible_labels() {
        let mut panes = IndexMap::new();
        let mut p1 = bible_pane("pane-1");
        p1.window_label = Some(" a ".into());
        let mut p2 = bible_pane("pane-2");
        p2.window_label = Some("A".into());
        panes.insert("pane-1".into(), p1);
        panes.insert("pane-2".into(), p2);
        panes.insert("pane-3".into(), commentary_pane("pane-3", Some("pane-1")));

        assert_eq!(normalize_window_label(Some(" ab ")).as_deref(), Some("AB"));
        assert_eq!(normalize_window_label(Some("a1")), None);
        assert_eq!(normalize_window_label(None), None);
        assert_eq!(collect_used_window_labels(&panes), vec!["A".to_string()]);
        assert_eq!(
            allocate_pane_label(&panes, PaneType::Commentary, Some("C")),
            None
        );
        assert_eq!(
            allocate_pane_label(&panes, PaneType::Bible, Some("B")).as_deref(),
            Some("B")
        );
        assert_eq!(
            allocate_pane_label(&panes, PaneType::Bible, Some("A")).as_deref(),
            Some("B")
        );

        ensure_window_labels(&mut panes);
        assert_eq!(panes["pane-1"].window_label.as_deref(), Some("A"));
        assert_eq!(panes["pane-2"].window_label.as_deref(), Some("B"));
        assert_eq!(panes["pane-3"].window_label, None);
        assert_eq!(get_pane_display_label(&panes, "pane-3"), "A");
        assert_eq!(get_pane_display_label(&panes, "missing"), "");
        let mut only = IndexMap::new();
        only.insert("pane-4".into(), commentary_pane("pane-4", None));
        assert_eq!(get_pane_display_label(&only, "pane-4"), "–");
        let mut unlabeled = IndexMap::new();
        unlabeled.insert("pane-7".into(), bible_pane("pane-7"));
        assert_eq!(get_pane_display_label(&unlabeled, "pane-7"), "7");
    }
}
