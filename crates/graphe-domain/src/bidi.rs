//! Visual order for scripts egui draws left to right.
//!
//! Hebrew and Arabic stay in the string as grapheme clusters, then each
//! right-to-left run is reversed so a left-to-right painter shows the word
//! the way it is read.

use std::borrow::Cow;

/// Leave Latin, Greek, and digits alone. Reverse Hebrew and Arabic runs.
pub fn display_text(text: &str) -> Cow<'_, str> {
    if !text.chars().any(is_rtl_letter) {
        if text.chars().any(is_rtl_punctuation) {
            let replaced: String = text.chars().map(normalize_rtl_punctuation).collect();
            return Cow::Owned(replaced);
        }
        return Cow::Borrowed(text);
    }
    let clusters = clusters(text);
    let mut out = String::with_capacity(text.len());
    let mut index = 0;
    while index < clusters.len() {
        if cluster_has(&clusters[index], is_rtl_letter) {
            let start = index;
            index += 1;
            while index < clusters.len() && !cluster_has(&clusters[index], is_ltr_letter) {
                if cluster_has(&clusters[index], is_rtl_letter) {
                    index += 1;
                    continue;
                }
                let mut ahead = index;
                while ahead < clusters.len()
                    && !cluster_has(&clusters[ahead], is_rtl_letter)
                    && !cluster_has(&clusters[ahead], is_ltr_letter)
                {
                    ahead += 1;
                }
                if ahead < clusters.len() && cluster_has(&clusters[ahead], is_rtl_letter) {
                    index = ahead + 1;
                } else {
                    break;
                }
            }
            for cluster in clusters[start..index].iter().rev() {
                out.push_str(cluster);
            }
        } else {
            let cluster = clusters[index];
            if cluster.chars().any(is_rtl_punctuation) {
                for ch in cluster.chars() {
                    out.push(normalize_rtl_punctuation(ch));
                }
            } else {
                out.push_str(cluster);
            }
            index += 1;
        }
    }
    Cow::Owned(out)
}

fn clusters(text: &str) -> Vec<&str> {
    let mut clusters = Vec::new();
    let mut rest = text;
    while !rest.is_empty() {
        let mut end = 0;
        for (offset, ch) in rest.char_indices() {
            if offset > 0 && !is_combining(ch) {
                break;
            }
            end = offset + ch.len_utf8();
        }
        clusters.push(&rest[..end]);
        rest = &rest[end..];
    }
    clusters
}

fn cluster_has(cluster: &str, test: fn(char) -> bool) -> bool {
    cluster.chars().any(test)
}

fn is_rtl_punctuation(ch: char) -> bool {
    matches!(
        ch,
        '\u{05BE}' | '\u{05C0}' | '\u{05C3}' | '\u{05C6}' | '\u{05F3}' | '\u{05F4}'
    )
}

fn normalize_rtl_punctuation(ch: char) -> char {
    match ch {
        '\u{05BE}' => '-',
        '\u{05C0}' => '|',
        '\u{05C3}' => ':',
        '\u{05F3}' => '\'',
        '\u{05F4}' => '"',
        _ => ch,
    }
}

fn is_rtl_letter(ch: char) -> bool {
    matches!(
        ch,
        '\u{05D0}'..='\u{05EA}'
            | '\u{05F0}'..='\u{05F2}'
            | '\u{0620}'..='\u{064A}'
            | '\u{066E}'..='\u{06D3}'
            | '\u{06D5}'
            | '\u{06EE}'..='\u{06EF}'
            | '\u{06FA}'..='\u{06FC}'
            | '\u{06FF}'
            | '\u{0750}'..='\u{077F}'
            | '\u{08A0}'..='\u{08FF}'
            | '\u{FB1D}'..='\u{FB4F}'
            | '\u{FB50}'..='\u{FDFF}'
            | '\u{FE70}'..='\u{FEFF}'
    ) && !is_combining(ch)
}

fn is_ltr_letter(ch: char) -> bool {
    ch.is_ascii_alphanumeric()
        || matches!(
            ch,
            '\u{00C0}'..='\u{024F}'
                | '\u{0370}'..='\u{03FF}'
                | '\u{0400}'..='\u{04FF}'
                | '\u{1F00}'..='\u{1FFF}'
        )
}

fn is_combining(ch: char) -> bool {
    matches!(
        ch,
        '\u{0300}'..='\u{036F}'
            | '\u{0591}'..='\u{05BD}'
            | '\u{05BF}'
            | '\u{05C1}'..='\u{05C2}'
            | '\u{05C4}'..='\u{05C5}'
            | '\u{05C7}'
            | '\u{0610}'..='\u{061A}'
            | '\u{064B}'..='\u{065F}'
            | '\u{0670}'
            | '\u{06D6}'..='\u{06ED}'
            | '\u{1AB0}'..='\u{1AFF}'
            | '\u{1DC0}'..='\u{1DFF}'
            | '\u{20D0}'..='\u{20FF}'
            | '\u{FE20}'..='\u{FE2F}'
    )
}

#[cfg(test)]
mod tests {
    use super::display_text;

    #[test]
    fn hebrew_points_stay_on_their_letters_and_the_word_reads_from_the_right() {
        let shown = display_text("אֱלֹהִים");
        assert!(
            shown.starts_with('ם'),
            "the word starts on the right: {shown}"
        );
        assert!(
            shown.ends_with("אֱ"),
            "the first letter keeps its vowel: {shown}"
        );
        let mem = shown.find('ם').expect("final mem");
        let alef = shown.find('א').expect("alef");
        assert!(mem < alef);
    }

    #[test]
    fn latin_around_a_hebrew_word_stays_in_place() {
        let shown = display_text("H430 אֱלֹהִים plural");
        assert!(shown.starts_with("H430 "));
        assert!(shown.ends_with(" plural"));
        let mem = shown.find('ם').expect("final mem");
        let alef = shown.find('א').expect("alef");
        assert!(mem < alef);
        assert_eq!(display_text("elohim").as_ref(), "elohim");
    }

    #[test]
    fn isolated_maqaf_in_latin_text_normalizes_to_hyphen() {
        let text = "6:48־; 12:2529־. A seriedade da apostasia";
        let shown = display_text(text);
        assert_eq!(shown.as_ref(), "6:48-; 12:2529-. A seriedade da apostasia");
    }

    #[test]
    fn hebrew_phrase_preserves_maqaf_in_rtl_run() {
        let text = "אֵת־הַשָּׁמַיִם";
        let shown = display_text(text);
        assert!(shown.contains('־'), "Hebrew run preserves maqaf: {shown}");
        // In visual order for LTR renderer, the second word appears first
        assert!(shown.starts_with("םיִמַשָּׁהַ־"));
    }
}
