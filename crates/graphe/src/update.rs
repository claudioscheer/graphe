//! Compare the running version with a GitHub release tag.

pub const VERSION: &str = env!("CARGO_PKG_VERSION");
pub const RELEASES_LATEST: &str =
    "https://api.github.com/repos/claudioscheer/graphe/releases/latest";
pub const ISSUES_URL: &str = "https://github.com/claudioscheer/graphe/issues";

/// Negative when `current` is older than `latest`.
pub fn compare_versions(current: &str, latest: &str) -> i32 {
    let left = parts(current);
    let right = parts(latest);
    let len = left.len().max(right.len());
    for index in 0..len {
        let a = left.get(index).copied().unwrap_or(0);
        let b = right.get(index).copied().unwrap_or(0);
        if a != b {
            return a - b;
        }
    }
    0
}

pub fn fetch_newer_version() -> Option<String> {
    let response = ureq::get(RELEASES_LATEST)
        .set("User-Agent", &format!("Graphe/{VERSION}"))
        .set("Accept", "application/vnd.github+json")
        .timeout(std::time::Duration::from_secs(4))
        .call()
        .ok()?;
    let text = response.into_string().ok()?;
    let body: serde_json::Value = serde_json::from_str(&text).ok()?;
    let tag = body.get("tag_name")?.as_str()?;
    newer_release(VERSION, tag)
}

pub fn newer_release(current: &str, tag: &str) -> Option<String> {
    let tag = tag.trim().trim_start_matches('v');
    if tag.is_empty() || compare_versions(current, tag) >= 0 {
        None
    } else {
        Some(tag.to_string())
    }
}

fn parts(value: &str) -> Vec<i32> {
    value
        .trim()
        .trim_start_matches('v')
        .split(|ch: char| !ch.is_ascii_digit())
        .filter(|part| !part.is_empty())
        .filter_map(|part| part.parse().ok())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_a_newer_github_tag() {
        assert!(compare_versions("1.0.11", "1.0.12") < 0);
        assert_eq!(compare_versions("1.0.11", "1.0.11"), 0);
        assert_eq!(newer_release("1.0.11", "v1.2.0").as_deref(), Some("1.2.0"));
        assert!(newer_release("1.0.11", "v1.0.11").is_none());
        assert!(newer_release("1.0.11", "v1.0.10").is_none());
    }
}
