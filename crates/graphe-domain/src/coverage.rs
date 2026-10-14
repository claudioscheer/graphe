use crate::books::CHAPTER_COUNTS;
use crate::i18n::{book_name, t};
use std::collections::{HashMap, HashSet};

pub fn compact_ranges(nums: &[i64]) -> String {
    if nums.is_empty() {
        return String::new();
    }
    let mut ranges = Vec::new();
    let mut start = nums[0];
    let mut end = start;
    for value in nums.iter().skip(1) {
        if *value == end + 1 {
            end = *value;
        } else {
            ranges.push(if start == end {
                start.to_string()
            } else {
                format!("{start}-{end}")
            });
            start = *value;
            end = start;
        }
    }
    ranges.push(if start == end {
        start.to_string()
    } else {
        format!("{start}-{end}")
    });
    ranges.join(", ")
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CoverageClass {
    None,
    Partial,
    Full,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CoverageCell {
    pub class_name: CoverageClass,
    pub title: String,
    pub text: String,
}

pub fn build_coverage_cell(
    book_number: i64,
    book_index: usize,
    coverage: &HashMap<i64, Vec<i64>>,
) -> CoverageCell {
    let total = CHAPTER_COUNTS.get(book_index).copied().unwrap_or(0) as f64;
    let covered = coverage.get(&book_number).cloned().unwrap_or_default();
    let name = book_name(book_number);
    let ratio = if total == 0.0 {
        0.0
    } else {
        covered.len() as f64 / total
    };
    if ratio == 0.0 {
        CoverageCell {
            class_name: CoverageClass::None,
            title: format!("{}: {}", name.long, t("coverageNone")),
            text: name.short,
        }
    } else if ratio >= 1.0 {
        CoverageCell {
            class_name: CoverageClass::Full,
            title: format!(
                "{}: {} ({} {})",
                name.long,
                t("coverageFull"),
                total as i64,
                t("coverageChapters")
            ),
            text: name.short,
        }
    } else {
        let covered_set: HashSet<i64> = covered.iter().copied().collect();
        let mut missing = Vec::new();
        for ch in 1..=total as i64 {
            if !covered_set.contains(&ch) {
                missing.push(ch);
            }
        }
        CoverageCell {
            class_name: CoverageClass::Partial,
            title: format!(
                "{}: {}/{} {}\n{}: {}",
                name.long,
                covered.len(),
                total as i64,
                t("coverageChapters"),
                t("coverageMissingChapters"),
                compact_ranges(&missing)
            ),
            text: name.short,
        }
    }
}

#[cfg(test)]
mod commentary_coverage_tests {
    use super::*;
    use crate::books::GRAPHE_BOOK_NUMBERS;
    use crate::i18n::reset_lang;

    #[test]
    fn compacts_numeric_ranges() {
        assert_eq!(compact_ranges(&[]), "");
        assert_eq!(compact_ranges(&[1]), "1");
        assert_eq!(compact_ranges(&[1, 2, 3, 5, 7, 8]), "1-3, 5, 7-8");
    }

    #[test]
    fn classifies_full_partial_and_none_coverage() {
        reset_lang();
        let genesis = i64::from(GRAPHE_BOOK_NUMBERS[0]);
        let none = build_coverage_cell(genesis, 0, &HashMap::new());
        assert_eq!(none.class_name, CoverageClass::None);

        let full_chapters: Vec<i64> = (1..=50).collect();
        let mut full_map = HashMap::new();
        full_map.insert(genesis, full_chapters);
        let full = build_coverage_cell(genesis, 0, &full_map);
        assert_eq!(full.class_name, CoverageClass::Full);

        let mut partial_map = HashMap::new();
        partial_map.insert(genesis, vec![1, 2, 3]);
        let partial = build_coverage_cell(genesis, 0, &partial_map);
        assert_eq!(partial.class_name, CoverageClass::Partial);
        assert!(partial.title.contains("3/50"));
    }
}
