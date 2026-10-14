//! Pane split tree: sanitize, serialize, and locate leaves.
use crate::model::PaneNode;
use serde_json::Value;

pub fn clamp_ratio(value: f64) -> f64 {
    if !value.is_finite() {
        return 0.5;
    }
    value.clamp(0.1, 0.9)
}

pub fn sanitize_tree(node: Option<&Value>, leaf_ids: &mut Vec<String>) -> Option<PaneNode> {
    let node = node?;
    if !node.is_object() {
        return None;
    }
    let kind = node.get("type").and_then(|v| v.as_str());
    if kind == Some("leaf") {
        let pane_id = node.get("paneId").and_then(|v| v.as_str())?;
        leaf_ids.push(pane_id.to_string());
        return Some(PaneNode::Leaf {
            pane_id: pane_id.to_string(),
        });
    }
    if kind != Some("split") {
        return None;
    }
    let children = node.get("children").and_then(|v| v.as_array())?;
    if children.len() != 2 {
        return None;
    }
    let left = sanitize_tree(Some(&children[0]), leaf_ids)?;
    let right = sanitize_tree(Some(&children[1]), leaf_ids)?;
    let ratio = node.get("ratio").and_then(|v| v.as_f64())?;
    if !ratio.is_finite() {
        return None;
    }
    let direction = if node.get("direction").and_then(|v| v.as_str()) == Some("v") {
        "v"
    } else {
        "h"
    };
    Some(PaneNode::Split {
        direction: direction.to_string(),
        children: Box::new((left, right)),
        ratio: clamp_ratio(ratio),
    })
}

pub fn serialize_tree(node: Option<&PaneNode>) -> Option<PaneNode> {
    match node? {
        PaneNode::Leaf { pane_id } => Some(PaneNode::Leaf {
            pane_id: pane_id.clone(),
        }),
        PaneNode::Split {
            direction,
            children,
            ratio,
        } => Some(PaneNode::Split {
            direction: if direction == "v" { "v" } else { "h" }.to_string(),
            ratio: clamp_ratio(*ratio),
            children: Box::new((
                serialize_tree(Some(&children.0))?,
                serialize_tree(Some(&children.1))?,
            )),
        }),
    }
}

pub fn get_first_leaf_id(node: &PaneNode) -> String {
    match node {
        PaneNode::Leaf { pane_id } => pane_id.clone(),
        PaneNode::Split { children, .. } => get_first_leaf_id(&children.0),
    }
}

pub fn get_all_leaf_ids(node: Option<&PaneNode>) -> Vec<String> {
    match node {
        None => Vec::new(),
        Some(PaneNode::Leaf { pane_id }) => vec![pane_id.clone()],
        Some(PaneNode::Split { children, .. }) => {
            let mut ids = get_all_leaf_ids(Some(&children.0));
            ids.extend(get_all_leaf_ids(Some(&children.1)));
            ids
        }
    }
}

pub fn contains_pane(node: &PaneNode, pane_id: &str) -> bool {
    match node {
        PaneNode::Leaf { pane_id: id } => id == pane_id,
        PaneNode::Split { children, .. } => {
            contains_pane(&children.0, pane_id) || contains_pane(&children.1, pane_id)
        }
    }
}

pub fn find_parent<'a>(node: &'a PaneNode, pane_id: &str) -> Option<&'a PaneNode> {
    let PaneNode::Split { children, .. } = node else {
        return None;
    };
    for child in [&children.0, &children.1] {
        if let PaneNode::Leaf { pane_id: id } = child {
            if id == pane_id {
                return Some(node);
            }
        }
        if let Some(found) = find_parent(child, pane_id) {
            return Some(found);
        }
    }
    None
}

pub fn find_split_child_index(parent: &PaneNode, pane_id: &str) -> usize {
    let PaneNode::Split { children, .. } = parent else {
        return 0;
    };
    if contains_pane(&children.0, pane_id) {
        0
    } else if contains_pane(&children.1, pane_id) {
        1
    } else {
        0
    }
}

pub fn find_parent_of_node<'a>(root: &'a PaneNode, target: &PaneNode) -> Option<&'a PaneNode> {
    let PaneNode::Split { children, .. } = root else {
        return None;
    };
    for child in [&children.0, &children.1] {
        if std::ptr::eq(child, target) {
            return Some(root);
        }
        if let Some(found) = find_parent_of_node(child, target) {
            return Some(found);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn sample_tree() -> Value {
        json!({
            "type": "split",
            "direction": "h",
            "ratio": 0.65,
            "children": [
                {"type": "leaf", "paneId": "pane-1"},
                {
                    "type": "split",
                    "direction": "v",
                    "ratio": 1.0,
                    "children": [
                        {"type": "leaf", "paneId": "pane-2"},
                        {"type": "leaf", "paneId": "pane-3"}
                    ]
                }
            ]
        })
    }

    #[test]
    fn sanitizes_and_serializes_tree_nodes() {
        let mut leaf_ids = Vec::new();
        let clean = sanitize_tree(Some(&sample_tree()), &mut leaf_ids).unwrap();
        assert_eq!(leaf_ids, vec!["pane-1", "pane-2", "pane-3"]);
        let expected = PaneNode::Split {
            direction: "h".into(),
            ratio: 0.65,
            children: Box::new((
                PaneNode::Leaf {
                    pane_id: "pane-1".into(),
                },
                PaneNode::Split {
                    direction: "v".into(),
                    ratio: 0.9,
                    children: Box::new((
                        PaneNode::Leaf {
                            pane_id: "pane-2".into(),
                        },
                        PaneNode::Leaf {
                            pane_id: "pane-3".into(),
                        },
                    )),
                },
            )),
        };
        assert_eq!(clean, expected);
        assert_eq!(serialize_tree(Some(&clean)).as_ref(), Some(&clean));
        assert_eq!(serialize_tree(None), None);
    }

    #[test]
    fn rejects_invalid_trees_and_clamps_ratios() {
        let mut leaf_ids = Vec::new();
        assert!(sanitize_tree(None, &mut leaf_ids).is_none());
        assert_eq!(
            sanitize_tree(
                Some(&json!({"type": "leaf", "paneId": "pane-1"})),
                &mut leaf_ids
            ),
            Some(PaneNode::Leaf {
                pane_id: "pane-1".into()
            })
        );
        assert!(sanitize_tree(
            Some(&json!({
                "type": "split",
                "direction": "h",
                "ratio": null,
                "children": [
                    {"type": "leaf", "paneId": "pane-1"},
                    {"type": "leaf", "paneId": "pane-2"}
                ]
            })),
            &mut Vec::new()
        )
        .is_none());
        assert!(sanitize_tree(
            Some(&json!({
                "type": "split",
                "direction": "h",
                "ratio": 0.5,
                "children": [{"type": "leaf", "paneId": "pane-1"}]
            })),
            &mut Vec::new()
        )
        .is_none());
        assert_eq!(clamp_ratio(f64::NAN), 0.5);
        assert_eq!(clamp_ratio(0.0), 0.1);
        assert_eq!(clamp_ratio(1.0), 0.9);
    }

    #[test]
    fn finds_leaves_and_parents() {
        let mut ids = Vec::new();
        let tree = sanitize_tree(Some(&sample_tree()), &mut ids).unwrap();
        // sample_tree ratio 1 is clamped, but getFirstLeafId uses the raw tree in TS.
        // The raw tree and sanitized tree have the same leaf structure.
        assert_eq!(get_first_leaf_id(&tree), "pane-1");
        assert!(get_all_leaf_ids(None).is_empty());
        assert_eq!(
            get_all_leaf_ids(Some(&tree)),
            vec!["pane-1", "pane-2", "pane-3"]
        );
        assert!(contains_pane(&tree, "pane-2"));
        assert!(!contains_pane(&tree, "pane-x"));
        let parent = find_parent(&tree, "pane-2").unwrap();
        assert!(matches!(parent, PaneNode::Split { .. }));
        let leaf = PaneNode::Leaf {
            pane_id: "pane-1".into(),
        };
        assert!(find_parent(&leaf, "pane-1").is_none());
        assert!(find_parent(&tree, "pane-x").is_none());
        assert_eq!(find_split_child_index(parent, "pane-3"), 1);
        assert_eq!(find_split_child_index(parent, "pane-x"), 0);
        assert!(std::ptr::eq(
            find_parent_of_node(&tree, parent).unwrap(),
            &tree
        ));
        assert!(find_parent_of_node(&leaf, &tree).is_none());
    }
}
