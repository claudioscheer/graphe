//! Per-pane back/forward history.
use crate::model::{
    HistoryMenuItem, ModuleRecord, NavDirection, NavHistoryEntry, PaneRecord, PaneType,
};
use indexmap::IndexMap;

pub fn sanitize_nav_history(
    raw: Option<&[NavHistoryEntry]>,
    modules: &[ModuleRecord],
) -> Vec<NavHistoryEntry> {
    let Some(raw) = raw else {
        return Vec::new();
    };
    let bible_ids: Vec<&str> = modules
        .iter()
        .filter(|module| module.kind == "bible")
        .map(|module| module.id.as_str())
        .collect();
    raw.iter()
        .filter(|entry| bible_ids.contains(&entry.module_id.as_str()))
        .map(|entry| NavHistoryEntry {
            module_id: entry.module_id.clone(),
            book_number: entry.book_number,
            chapter: entry.chapter,
            verse: entry.verse,
        })
        .collect()
}
pub fn sanitize_nav_history_loose(
    entries: &[Option<LooseHistory>],
    modules: &[ModuleRecord],
) -> Vec<NavHistoryEntry> {
    let bible_ids: Vec<&str> = modules
        .iter()
        .filter(|module| module.kind == "bible")
        .map(|module| module.id.as_str())
        .collect();
    entries
        .iter()
        .filter_map(|entry| entry.as_ref())
        .filter(|entry| {
            entry
                .module_id
                .as_ref()
                .is_some_and(|id| bible_ids.contains(&id.as_str()))
        })
        .map(|entry| NavHistoryEntry {
            module_id: entry.module_id.clone().unwrap_or_default(),
            book_number: if entry.book_number.is_some_and(|n| n.fract() == 0.0) {
                entry.book_number.unwrap() as i64
            } else {
                10
            },
            chapter: if entry.chapter.is_some_and(|n| n.fract() == 0.0) {
                entry.chapter.unwrap() as i64
            } else {
                1
            },
            verse: entry.verse.and_then(|n| {
                if n.fract() == 0.0 {
                    Some(n as i64)
                } else {
                    None
                }
            }),
        })
        .collect()
}

#[derive(Debug, Clone)]
pub struct LooseHistory {
    pub module_id: Option<String>,
    pub book_number: Option<f64>,
    pub chapter: Option<f64>,
    pub verse: Option<f64>,
}

pub fn normalize_nav_history_indexes(panes: &mut IndexMap<String, PaneRecord>) {
    for pane in panes.values_mut() {
        if pane.pane_type != PaneType::Bible {
            continue;
        }
        if pane.nav_history.is_empty() {
            pane.nav_history_idx = -1;
            continue;
        }
        let max = pane.nav_history.len() as i64 - 1;
        let idx = if pane.nav_history_idx >= 0 {
            pane.nav_history_idx
        } else {
            0
        };
        pane.nav_history_idx = idx.clamp(0, max);
    }
}

pub fn has_nav_back_history(pane: Option<&PaneRecord>) -> bool {
    pane.is_some_and(|pane| pane.nav_history_idx > 0)
}

pub fn has_nav_forward_history(pane: Option<&PaneRecord>) -> bool {
    let Some(pane) = pane else {
        return false;
    };
    !pane.nav_history.is_empty()
        && pane.nav_history_idx >= 0
        && (pane.nav_history_idx as usize) + 1 < pane.nav_history.len()
}

pub fn get_nav_history_entries(
    pane: Option<&PaneRecord>,
    direction: NavDirection,
) -> Vec<HistoryMenuItem> {
    let Some(pane) = pane else {
        return Vec::new();
    };
    match direction {
        NavDirection::Back => pane.nav_history[..pane.nav_history_idx.max(0) as usize]
            .iter()
            .enumerate()
            .map(|(index, entry)| HistoryMenuItem {
                entry: entry.clone(),
                index,
            })
            .rev()
            .collect(),
        NavDirection::Forward => {
            let start = (pane.nav_history_idx + 1).max(0) as usize;
            pane.nav_history
                .get(start..)
                .unwrap_or(&[])
                .iter()
                .enumerate()
                .map(|(offset, entry)| HistoryMenuItem {
                    entry: entry.clone(),
                    index: start + offset,
                })
                .collect()
        }
    }
}

/// Newest dictionary topic is index 0. Going back raises the index.
///
/// A new topic drops every topic newer than the current one. Those are the
/// words already left behind with Back, and a new visit replaces them.
pub fn push_dict_history(history: &mut Vec<String>, index: &mut usize, topic: &str) {
    let topic = topic.trim();
    if topic.is_empty() {
        return;
    }
    if history.get(*index).is_some_and(|item| item == topic) {
        return;
    }
    let at = (*index).min(history.len());
    if at > 0 {
        history.drain(0..at);
    }
    history.insert(0, topic.to_string());
    history.truncate(20);
    *index = 0;
}

pub fn push_nav_history_entry(pane: &mut PaneRecord) -> bool {
    let current_index = if pane.nav_history_idx >= 0 {
        pane.nav_history_idx
    } else {
        -1
    };
    let verse = if pane.selected_verse.unwrap_or(0) == 0 {
        None
    } else {
        pane.selected_verse
    };
    let entry = NavHistoryEntry {
        module_id: pane.module_id.clone().unwrap_or_default(),
        book_number: pane.book_number,
        chapter: pane.chapter,
        verse,
    };
    let keep = (current_index + 1).max(0) as usize;
    if keep < pane.nav_history.len() {
        pane.nav_history.truncate(keep);
    }
    if let Some(top) = pane
        .nav_history
        .get(current_index.max(0) as usize)
        .filter(|_| current_index >= 0)
    {
        if top.module_id == entry.module_id
            && top.book_number == entry.book_number
            && top.chapter == entry.chapter
            && top.verse == entry.verse
        {
            return false;
        }
    }
    pane.nav_history.push(entry);
    pane.nav_history_idx = pane.nav_history.len() as i64 - 1;
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bible_module() -> ModuleRecord {
        ModuleRecord::new("kjv", "bible", "KJV")
    }
    fn dict_module() -> ModuleRecord {
        ModuleRecord::new("strong", "dictionary", "Strong")
    }
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
        pane.synced_to_pane_id = synced.map(|value| value.to_string());
        pane
    }

    #[test]
    fn sanitizes_history_against_available_bible_modules() {
        let history = vec![
            NavHistoryEntry {
                module_id: "kjv".into(),
                book_number: 10,
                chapter: 1,
                verse: None,
            },
            NavHistoryEntry {
                module_id: "kjv".into(),
                book_number: 10,
                chapter: 2,
                verse: Some(3),
            },
        ];
        assert!(sanitize_nav_history(None, &[bible_module()]).is_empty());
        assert_eq!(
            sanitize_nav_history(Some(&history), &[bible_module(), dict_module()]),
            history
        );
        assert_eq!(
            sanitize_nav_history_loose(
                &[
                    Some(LooseHistory {
                        module_id: Some("missing".into()),
                        book_number: Some(1.0),
                        chapter: Some(1.0),
                        verse: Some(1.0),
                    }),
                    Some(LooseHistory {
                        module_id: Some("kjv".into()),
                        book_number: Some(4.5),
                        chapter: Some(0.5),
                        verse: Some(2.5),
                    }),
                ],
                &[bible_module()]
            ),
            vec![NavHistoryEntry {
                module_id: "kjv".into(),
                book_number: 10,
                chapter: 1,
                verse: None,
            }]
        );
    }

    #[test]
    fn normalizes_indexes_and_slices_back_forward_entries() {
        let history = vec![
            NavHistoryEntry {
                module_id: "kjv".into(),
                book_number: 10,
                chapter: 1,
                verse: None,
            },
            NavHistoryEntry {
                module_id: "kjv".into(),
                book_number: 10,
                chapter: 2,
                verse: Some(3),
            },
        ];
        let mut panes = IndexMap::new();
        let mut p1 = bible_pane("pane-1");
        p1.nav_history = history.clone();
        p1.nav_history_idx = 99;
        let mut p2 = bible_pane("pane-2");
        p2.nav_history_idx = 5;
        panes.insert("pane-1".into(), p1);
        panes.insert("pane-2".into(), p2);
        panes.insert("pane-3".into(), commentary_pane("pane-3", None));
        normalize_nav_history_indexes(&mut panes);
        assert_eq!(panes["pane-1"].nav_history_idx, 1);
        assert_eq!(panes["pane-2"].nav_history_idx, -1);
        assert!(has_nav_back_history(Some(&panes["pane-1"])));
        assert!(!has_nav_forward_history(Some(&panes["pane-1"])));
        assert!(!has_nav_back_history(None));
        assert!(!has_nav_forward_history(None));
        assert_eq!(
            get_nav_history_entries(Some(&panes["pane-1"]), NavDirection::Back),
            vec![HistoryMenuItem {
                entry: history[0].clone(),
                index: 0
            }]
        );
        assert!(get_nav_history_entries(Some(&panes["pane-1"]), NavDirection::Forward).is_empty());
    }

    #[test]
    fn pushes_unique_history_entries_and_truncates_forward_history() {
        let mut pane = bible_pane("pane-1");
        pane.nav_history = vec![
            NavHistoryEntry {
                module_id: "kjv".into(),
                book_number: 10,
                chapter: 1,
                verse: None,
            },
            NavHistoryEntry {
                module_id: "kjv".into(),
                book_number: 10,
                chapter: 2,
                verse: Some(3),
            },
        ];
        pane.nav_history_idx = 0;
        assert!(!push_nav_history_entry(&mut pane));
        pane.chapter = 3;
        pane.selected_verse = Some(4);
        assert!(push_nav_history_entry(&mut pane));
        assert_eq!(
            pane.nav_history,
            vec![
                NavHistoryEntry {
                    module_id: "kjv".into(),
                    book_number: 10,
                    chapter: 1,
                    verse: None,
                },
                NavHistoryEntry {
                    module_id: "kjv".into(),
                    book_number: 10,
                    chapter: 3,
                    verse: Some(4),
                },
            ]
        );
        assert_eq!(pane.nav_history_idx, 1);
    }

    #[test]
    fn a_new_dictionary_word_drops_the_words_ahead() {
        let mut history = vec!["third".into(), "second".into(), "first".into()];
        let mut index = 2;
        push_dict_history(&mut history, &mut index, "first");
        assert_eq!(history, vec!["third", "second", "first"]);
        assert_eq!(index, 2);

        push_dict_history(&mut history, &mut index, "fresh");
        assert_eq!(history, vec!["fresh", "first"]);
        assert_eq!(index, 0);
        index += 1;
        assert_eq!(history[index], "first");
        assert_eq!(index + 1, history.len());
    }

    #[test]
    fn a_new_dictionary_word_from_the_middle_keeps_the_older_ones() {
        let mut history = vec!["third".into(), "second".into(), "first".into()];
        let mut index = 1;
        push_dict_history(&mut history, &mut index, "fresh");
        assert_eq!(history, vec!["fresh", "second", "first"]);
        assert_eq!(index, 0);
    }

    #[test]
    fn a_new_dictionary_word_at_the_newest_keeps_the_trail() {
        let mut history = vec!["third".into(), "second".into(), "first".into()];
        let mut index = 0;
        push_dict_history(&mut history, &mut index, "fresh");
        assert_eq!(history, vec!["fresh", "third", "second", "first"]);
        assert_eq!(index, 0);
    }
}
