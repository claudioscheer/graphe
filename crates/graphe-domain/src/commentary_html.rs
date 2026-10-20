//! Module HTML the way the Electron panes show it.
//!
//! Commentary and dictionary bodies share this parser. Paragraphs, emphasis,
//! and links (`<a href="B:…">`, `#b…`, `#d…`, `S:…`) become runs, `<ol>/<li>`
//! become list items carrying their nesting depth, and other tags are
//! dropped. Script and style elements are dropped with their text.

use crate::bible_ref::{parse_bible_href, ParseBibleHrefOptions};
use crate::commentary_ref::{ContinuationOptions, ReferenceContext, ReferenceMatcher};

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CommentaryRun {
    Break,
    Text {
        text: String,
        italic: bool,
        bold: bool,
        underline: bool,
    },
    /// Small inline label, the `dict-def-label` span of a numbered sense.
    Label {
        text: String,
    },
    Link {
        label: String,
        book: i64,
        chapter: i64,
        verse: Option<i64>,
        italic: bool,
        bold: bool,
    },
    /// A link into the dictionary: another topic (`#d…`) or a Strong's
    /// number (`S:H…`).
    DictLink {
        label: String,
        topic: String,
    },
    /// The start of an `<li>` at `depth` levels of `<ol>` nesting.
    ListItem {
        depth: u8,
    },
}

/// Turn module HTML into runs. Plain-text references are linked when `matcher`
/// is set. A literal newline is a paragraph break, which dictionary bodies use.
pub fn render_entry_runs(html: &str, matcher: Option<&ReferenceMatcher>) -> Vec<CommentaryRun> {
    finish_runs(parse_html(html, true), matcher)
}

/// Turn commentary HTML into runs. Plain-text references are linked when `matcher` is set.
///
/// A newline inside commentary HTML is ordinary whitespace. Paragraph breaks
/// come from the tags (`<p>`, `<br>`, `<li>`), the same as before dictionary
/// bodies shared this parser.
pub fn render_commentary_html(
    html: &str,
    matcher: Option<&ReferenceMatcher>,
) -> Vec<CommentaryRun> {
    finish_runs(parse_html(html, false), matcher)
}

fn finish_runs(
    mut runs: Vec<CommentaryRun>,
    matcher: Option<&ReferenceMatcher>,
) -> Vec<CommentaryRun> {
    if let Some(matcher) = matcher {
        runs = link_plain_references(runs, matcher);
    }
    runs
}

/// Tags removed, links reduced to their labels. Used by the all-commentaries list.
pub fn plain_text(html: &str) -> String {
    let mut out = String::new();
    for run in render_commentary_html(html, None) {
        match run {
            CommentaryRun::Break | CommentaryRun::ListItem { .. } => out.push('\n'),
            CommentaryRun::Text { text, .. } | CommentaryRun::Label { text } => out.push_str(&text),
            CommentaryRun::Link { label, .. } | CommentaryRun::DictLink { label, .. } => {
                out.push_str(&label)
            }
        }
    }
    out.lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

/// The link target an open `<a>` tag is accumulating text for.
enum PendingLink {
    Bible {
        book: i64,
        chapter: i64,
        verse: Option<i64>,
    },
    Topic(String),
}

fn parse_html(html: &str, break_on_newline: bool) -> Vec<CommentaryRun> {
    let chars: Vec<char> = html.chars().collect();
    let mut runs = Vec::new();
    let mut buf = String::new();
    let mut italic = 0i32;
    let mut bold = 0i32;
    let mut underline = 0i32;
    let mut label_span = 0i32;
    let mut list_depth = 0u8;
    let mut link: Option<PendingLink> = None;
    let mut i = 0usize;
    while i < chars.len() {
        if chars[i] == '\r' || chars[i] == '\n' {
            if chars[i] == '\r' && chars.get(i + 1) == Some(&'\n') {
                i += 1;
            }
            if break_on_newline {
                flush(
                    &mut runs,
                    &mut buf,
                    italic > 0,
                    bold > 0,
                    underline > 0,
                    label_span > 0,
                    link.as_ref(),
                );
                push_break(&mut runs);
            } else {
                buf.push('\n');
            }
            i += 1;
            continue;
        }
        if chars[i] == '<' && looks_like_tag(&chars, i) {
            flush(
                &mut runs,
                &mut buf,
                italic > 0,
                bold > 0,
                underline > 0,
                label_span > 0,
                link.as_ref(),
            );
            if let Some(end) = skip_comment(&chars, i) {
                i = end;
                continue;
            }
            let Some((end, tag)) = read_tag(&chars, i) else {
                buf.push('<');
                i += 1;
                continue;
            };
            i = end;
            let name = tag.name.as_str();
            if matches!(
                name,
                "script" | "style" | "iframe" | "object" | "embed" | "form"
            ) {
                if !tag.closing && !tag.self_closing {
                    i = skip_until_close(&chars, i, name);
                }
                continue;
            }
            if tag.closing {
                match name {
                    "em" | "i" => italic = (italic - 1).max(0),
                    "strong" | "b" => bold = (bold - 1).max(0),
                    "u" => underline = (underline - 1).max(0),
                    "span" => label_span = (label_span - 1).max(0),
                    "a" => link = None,
                    "ol" => list_depth = list_depth.saturating_sub(1),
                    "li" => push_break(&mut runs),
                    "p" | "div" | "tr" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "blockquote" => {
                        push_break(&mut runs)
                    }
                    _ => {}
                }
                continue;
            }
            match name {
                "br" | "hr" | "pb" => push_break(&mut runs),
                "p" | "div" | "tr" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "blockquote" => {
                    push_break(&mut runs);
                }
                "em" | "i" => italic += 1,
                "strong" | "b" => bold += 1,
                "u" => underline += 1,
                "ol" => list_depth = list_depth.saturating_add(1),
                "li" => {
                    push_break(&mut runs);
                    runs.push(CommentaryRun::ListItem {
                        depth: list_depth.saturating_sub(1),
                    });
                }
                "span" => {
                    if tag
                        .attr("class")
                        .is_some_and(|class| class.to_ascii_lowercase().contains("dict-def-label"))
                    {
                        label_span += 1;
                    }
                }
                "a" => {
                    link = tag.attr("href").and_then(|href| parse_link_href(&href));
                }
                _ => {}
            }
            continue;
        }
        if chars[i] == '&' {
            if let Some((text, next)) = read_entity(&chars, i) {
                buf.push_str(&text);
                i = next;
                continue;
            }
        }
        buf.push(chars[i]);
        i += 1;
    }
    flush(
        &mut runs,
        &mut buf,
        italic > 0,
        bold > 0,
        underline > 0,
        label_span > 0,
        link.as_ref(),
    );
    runs
}

/// `<a href>` values become link targets. `B:`/`#b…` bible hrefs stay bible
/// links; `#d…` and `S:…` hrefs point at dictionary topics. Anything else
/// (or a missing href) keeps the anchor as plain text.
fn parse_link_href(href: &str) -> Option<PendingLink> {
    let href = href.trim();
    if crate::dict::is_external_href(Some(href)) {
        return Some(PendingLink::Topic(href.to_string()));
    }
    let lower = href.to_ascii_lowercase();
    if lower.starts_with("#d") {
        let topic = href[2..].trim().to_string();
        if !topic.is_empty() {
            return Some(PendingLink::Topic(topic));
        }
        return None;
    }
    if lower.starts_with("s:") {
        let topic = href[2..].trim().to_string();
        if !topic.is_empty() {
            return Some(PendingLink::Topic(topic));
        }
        return None;
    }
    if let Some(parsed) = parse_bible_href(Some(href), ParseBibleHrefOptions::default()) {
        return Some(PendingLink::Bible {
            book: parsed.book_number,
            chapter: parsed.chapter,
            verse: parsed.verse,
        });
    }
    None
}

fn link_plain_references(
    runs: Vec<CommentaryRun>,
    matcher: &ReferenceMatcher,
) -> Vec<CommentaryRun> {
    let mut out = Vec::new();
    let mut context: Option<ReferenceContext> = None;
    for run in runs {
        let CommentaryRun::Text {
            text,
            italic,
            bold,
            underline,
        } = run
        else {
            if let CommentaryRun::Link {
                book,
                chapter,
                verse,
                ..
            } = &run
            {
                context = Some(ReferenceContext {
                    book_num: *book,
                    chapter: *chapter,
                    verses: Some((*verse, *verse)),
                });
            }
            out.push(run);
            continue;
        };
        let mut matches = matcher.find_matches(Some(&text));
        if matches.is_empty() {
            if let Some(ctx) = &context {
                matches = matcher.find_continuations(
                    Some(&text),
                    ctx,
                    ContinuationOptions {
                        require_separator: true,
                    },
                );
            }
        }
        if matches.is_empty() {
            out.push(CommentaryRun::Text {
                text,
                italic,
                bold,
                underline,
            });
            continue;
        }
        let mut cursor = 0usize;
        for reference in &matches {
            if reference.index > cursor {
                let head = slice_bytes(&text, cursor, reference.index);
                if !head.is_empty() {
                    out.push(CommentaryRun::Text {
                        text: head,
                        italic,
                        bold,
                        underline,
                    });
                }
            }
            let label = if reference.raw.is_empty() {
                slice_bytes(&text, reference.index, reference.end_index)
            } else {
                reference.raw.clone()
            };
            if !label.is_empty() {
                out.push(CommentaryRun::Link {
                    label,
                    book: reference.book_num,
                    chapter: reference.chapter,
                    verse: reference.verse_from,
                    italic,
                    bold,
                });
            }
            cursor = reference.end_index;
            context = Some(ReferenceContext {
                book_num: reference.book_num,
                chapter: reference.chapter,
                verses: Some((reference.verse_from, reference.verse_to)),
            });
        }
        if cursor < text.len() {
            let tail = slice_bytes(&text, cursor, text.len());
            if !tail.is_empty() {
                out.push(CommentaryRun::Text {
                    text: tail,
                    italic,
                    bold,
                    underline,
                });
            }
        }
    }
    out
}

fn slice_bytes(text: &str, start: usize, end: usize) -> String {
    let end = end.min(text.len());
    if start >= end || !text.is_char_boundary(start) || !text.is_char_boundary(end) {
        return String::new();
    }
    text[start..end].to_string()
}

struct Tag {
    closing: bool,
    self_closing: bool,
    name: String,
    attrs: Vec<(String, String)>,
}

impl Tag {
    fn attr(&self, key: &str) -> Option<String> {
        self.attrs
            .iter()
            .find(|(name, _)| name == key)
            .map(|(_, value)| value.clone())
    }
}

fn looks_like_tag(chars: &[char], index: usize) -> bool {
    let Some(next) = chars.get(index + 1) else {
        return false;
    };
    next.is_ascii_alphabetic() || *next == '/' || *next == '!'
}

fn skip_comment(chars: &[char], index: usize) -> Option<usize> {
    if chars.get(index..index + 4) != Some(&['<', '!', '-', '-']) {
        return None;
    }
    let mut i = index + 4;
    while i + 2 < chars.len() {
        if chars[i] == '-' && chars[i + 1] == '-' && chars[i + 2] == '>' {
            return Some(i + 3);
        }
        i += 1;
    }
    Some(chars.len())
}

fn read_tag(chars: &[char], index: usize) -> Option<(usize, Tag)> {
    let end = chars[index..].iter().position(|ch| *ch == '>')? + index;
    let body: String = chars[index + 1..end].iter().collect();
    let body = body.trim();
    if body.is_empty() {
        return None;
    }
    let mut closing = false;
    let mut rest = body;
    if let Some(stripped) = rest.strip_prefix('/') {
        closing = true;
        rest = stripped.trim();
    }
    let mut self_closing = false;
    if let Some(stripped) = rest.strip_suffix('/') {
        self_closing = true;
        rest = stripped.trim();
    }
    let mut parts = rest.split_whitespace();
    let name = parts.next()?.to_ascii_lowercase();
    let attr_src: String = rest[name.len()..].to_string();
    Some((
        end + 1,
        Tag {
            closing,
            self_closing,
            name,
            attrs: parse_attrs(&attr_src),
        },
    ))
}

fn parse_attrs(source: &str) -> Vec<(String, String)> {
    let mut attrs = Vec::new();
    let chars: Vec<char> = source.chars().collect();
    let mut i = 0usize;
    while i < chars.len() {
        while i < chars.len() && chars[i].is_whitespace() {
            i += 1;
        }
        if i >= chars.len() {
            break;
        }
        let start = i;
        while i < chars.len() && chars[i] != '=' && !chars[i].is_whitespace() {
            i += 1;
        }
        let name: String = chars[start..i]
            .iter()
            .collect::<String>()
            .to_ascii_lowercase();
        while i < chars.len() && chars[i].is_whitespace() {
            i += 1;
        }
        if i >= chars.len() || chars[i] != '=' {
            if !name.is_empty() {
                attrs.push((name, String::new()));
            }
            continue;
        }
        i += 1;
        while i < chars.len() && chars[i].is_whitespace() {
            i += 1;
        }
        if i >= chars.len() {
            attrs.push((name, String::new()));
            break;
        }
        let quote = chars[i];
        if quote == '"' || quote == '\'' {
            i += 1;
            let value_start = i;
            while i < chars.len() && chars[i] != quote {
                i += 1;
            }
            let value: String = chars[value_start..i].iter().collect();
            if i < chars.len() {
                i += 1;
            }
            attrs.push((name, value));
        } else {
            let value_start = i;
            while i < chars.len() && !chars[i].is_whitespace() {
                i += 1;
            }
            let value: String = chars[value_start..i].iter().collect();
            attrs.push((name, value));
        }
    }
    attrs
}

fn skip_until_close(chars: &[char], mut index: usize, name: &str) -> usize {
    let close = format!("</{name}");
    let close: Vec<char> = close.chars().collect();
    while index + close.len() <= chars.len() {
        if chars[index..index + close.len()]
            .iter()
            .zip(close.iter())
            .all(|(got, want)| got.eq_ignore_ascii_case(want))
        {
            if let Some(end) = chars[index..].iter().position(|ch| *ch == '>') {
                return index + end + 1;
            }
        }
        index += 1;
    }
    chars.len()
}

fn read_entity(chars: &[char], index: usize) -> Option<(String, usize)> {
    if chars.get(index) != Some(&'&') {
        return None;
    }
    let end = chars[index + 1..]
        .iter()
        .position(|ch| *ch == ';' || ch.is_whitespace() || *ch == '<')?;
    if chars.get(index + 1 + end) != Some(&';') {
        return None;
    }
    let body: String = chars[index + 1..index + 1 + end].iter().collect();
    let next = index + 1 + end + 1;
    let text = if let Some(hex) = body.strip_prefix("#x").or_else(|| body.strip_prefix("#X")) {
        let code = u32::from_str_radix(hex, 16).ok()?;
        char::from_u32(code)?.to_string()
    } else if let Some(dec) = body.strip_prefix('#') {
        let code = dec.parse::<u32>().ok()?;
        char::from_u32(code)?.to_string()
    } else {
        match body.to_ascii_lowercase().as_str() {
            "amp" => "&".to_string(),
            "lt" => "<".to_string(),
            "gt" => ">".to_string(),
            "quot" => "\"".to_string(),
            "apos" => "'".to_string(),
            "nbsp" => " ".to_string(),
            _ => return None,
        }
    };
    Some((text, next))
}

fn flush(
    runs: &mut Vec<CommentaryRun>,
    buf: &mut String,
    italic: bool,
    bold: bool,
    underline: bool,
    label: bool,
    link: Option<&PendingLink>,
) {
    let mut text = normalize_space(buf);
    buf.clear();
    // A list item is a break for the text that follows it. Trimming here keeps
    // `<li> item</li>` as `item`, which is what commentary offsets already use.
    if matches!(
        runs.last(),
        Some(CommentaryRun::Break) | Some(CommentaryRun::ListItem { .. }) | None
    ) {
        text = text.trim_start().to_string();
    }
    if text.is_empty() {
        return;
    }
    if label {
        runs.push(CommentaryRun::Label { text });
        return;
    }
    match link {
        Some(PendingLink::Bible {
            book,
            chapter,
            verse,
        }) => runs.push(CommentaryRun::Link {
            label: text,
            book: *book,
            chapter: *chapter,
            verse: *verse,
            italic,
            bold,
        }),
        Some(PendingLink::Topic(topic)) => runs.push(CommentaryRun::DictLink {
            label: text,
            topic: topic.clone(),
        }),
        None => runs.push(CommentaryRun::Text {
            text,
            italic,
            bold,
            underline,
        }),
    }
}

fn normalize_space(text: &str) -> String {
    let lead = text.chars().next().is_some_and(char::is_whitespace);
    let trail = text.chars().next_back().is_some_and(char::is_whitespace);
    let inner = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if inner.is_empty() {
        return if lead { " ".to_string() } else { String::new() };
    }
    let mut out = String::new();
    if lead {
        out.push(' ');
    }
    out.push_str(&inner);
    if trail {
        out.push(' ');
    }
    out
}

fn push_break(runs: &mut Vec<CommentaryRun>) {
    if matches!(runs.last(), Some(CommentaryRun::Break) | None) {
        return;
    }
    runs.push(CommentaryRun::Break);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn commentary_html_renders_emphasis_and_bible_links() {
        let html = "<p><strong>Capítulo Dez</strong></p><p>Os <em>críticos</em> <a class='bible' href='B:10 10:1'>Gênesis 10.1</a>.</p><script>alert(1)</script>";
        let runs = render_commentary_html(html, None);
        let dumped = dump(&runs);
        assert!(!dumped.contains('<'), "{dumped}");
        assert!(!dumped.contains("alert"));
        assert!(dumped.contains("Capítulo Dez"));
        assert!(runs.iter().any(|run| matches!(
            run,
            CommentaryRun::Text {
                text,
                bold: true,
                ..
            } if text.contains("Capítulo Dez")
        )));
        assert!(runs.iter().any(|run| matches!(
            run,
            CommentaryRun::Text {
                text,
                italic: true,
                ..
            } if text.contains("críticos")
        )));
        assert!(runs.iter().any(|run| matches!(
            run,
            CommentaryRun::Link {
                label,
                book: 10,
                chapter: 10,
                verse: Some(1),
                ..
            } if label.contains("Gênesis 10.1")
        )));
        assert!(runs.iter().any(|run| matches!(run, CommentaryRun::Break)));
    }

    #[test]
    fn entry_runs_link_bible_dictionary_and_strong_anchors() {
        let html = "<p>Os zuzins (<a class='bible' href='#b1.14.5'>Gn 14.5</a>). Veja <a class='dict' href='#dCORES'>Cores</a>. Ver <a href='S:H8818'>H8818</a>.</p>";
        let runs = render_entry_runs(html, None);
        assert!(runs.iter().any(|run| matches!(
            run,
            CommentaryRun::Link {
                label,
                book: 10,
                chapter: 14,
                verse: Some(5),
                ..
            } if label == "Gn 14.5"
        )));
        assert!(runs.iter().any(|run| matches!(
            run,
            CommentaryRun::DictLink { label, topic }
                if label == "Cores" && topic == "CORES"
        )));
        assert!(runs.iter().any(|run| matches!(
            run,
            CommentaryRun::DictLink { label, topic }
                if label == "H8818" && topic == "H8818"
        )));
    }

    #[test]
    fn entry_runs_underline_strong_text_and_break_paragraphs() {
        let html =
            "<p><strong>DICIONÁRIO</strong> <u>VENDA PROIBIDA</u><br/>Módulo</p><p/>Segundo.";
        let runs = render_entry_runs(html, None);
        assert!(runs.iter().any(|run| matches!(
            run,
            CommentaryRun::Text { bold: true, .. } if run_text(run) == "DICIONÁRIO"
        )));
        assert!(runs.iter().any(|run| matches!(
            run,
            CommentaryRun::Text { underline: true, .. } if run_text(run) == "VENDA PROIBIDA"
        )));
        assert!(runs.iter().any(|run| matches!(
            run,
            CommentaryRun::Text { text, .. } if text == "Segundo."
        )));
        assert!(
            runs.iter()
                .filter(|run| matches!(run, CommentaryRun::Break))
                .count()
                >= 2
        );
    }

    #[test]
    fn entry_runs_split_numbered_senses_into_list_items() {
        let formatted = crate::dict::format_definition(
            "raiz 1 primeiro sentido 1a sub sentido 1a1 fundo 2 segundo",
        );
        let runs = render_entry_runs(&formatted, None);
        let depths: Vec<u8> = runs
            .iter()
            .filter_map(|run| match run {
                CommentaryRun::ListItem { depth } => Some(*depth),
                _ => None,
            })
            .collect();
        assert_eq!(depths, vec![0, 1, 2, 0]);
        assert!(runs.iter().any(|run| matches!(
            run,
            CommentaryRun::Label { text } if text == "1a1"
        )));
        assert!(runs.iter().any(|run| matches!(
            run,
            CommentaryRun::Text { text, .. } if text.contains("fundo")
        )));
    }

    #[test]
    fn entry_runs_break_on_a_literal_newline() {
        let runs = render_entry_runs("primeiro\nsegundo", None);
        assert!(runs.iter().any(|run| matches!(run, CommentaryRun::Break)));
        assert!(runs
            .iter()
            .any(|run| matches!(run, CommentaryRun::Text { text, .. } if text == "primeiro")));
        assert!(runs
            .iter()
            .any(|run| matches!(run, CommentaryRun::Text { text, .. } if text == "segundo")));
    }

    #[test]
    fn commentary_html_keeps_a_newline_inside_the_paragraph() {
        let runs = render_commentary_html("primeiro\r\nsegundo", None);
        assert!(runs.iter().all(|run| !matches!(run, CommentaryRun::Break)));
        assert!(runs.iter().any(
            |run| matches!(run, CommentaryRun::Text { text, .. } if text == "primeiro segundo")
        ));
    }

    #[test]
    fn commentary_list_item_drops_the_leading_space() {
        let runs = render_commentary_html("<li> item</li>", None);
        assert!(runs
            .iter()
            .any(|run| matches!(run, CommentaryRun::Text { text, .. } if text == "item")));
    }

    #[test]
    fn entry_runs_keep_an_external_href_colored_and_inert() {
        let runs = render_entry_runs("<a href='https://example.test/a'>site</a>", None);
        assert!(runs.iter().any(|run| matches!(
            run,
            CommentaryRun::DictLink { label, topic }
                if label == "site" && topic == "https://example.test/a"
        )));
    }

    #[test]
    fn entry_runs_link_plain_references_in_dictionary_text() {
        let matcher = crate::commentary_ref::build_reference_matcher(
            &[vec![crate::commentary_ref::BookName {
                short: "Gn".into(),
                long: "Gênesis".into(),
            }]],
            &[1],
        );
        let html =
            "<p>Acepção especial da palavra em sua primeira ocorrência (Gn 2.24) e depois.</p>";
        let runs = render_entry_runs(html, Some(&matcher));
        assert!(runs.iter().any(|run| matches!(
            run,
            CommentaryRun::Link {
                label,
                book: 1,
                chapter: 2,
                verse: Some(24),
                ..
            } if label == "Gn 2.24"
        )));
    }

    fn run_text(run: &CommentaryRun) -> &str {
        match run {
            CommentaryRun::Text { text, .. } => text,
            _ => "",
        }
    }

    #[test]
    fn commentary_html_links_deut_reference_followed_by_bold_punctuation() {
        let matcher = crate::commentary_ref::build_reference_matcher(
            &[vec![crate::commentary_ref::BookName {
                short: "Dt".into(),
                long: "Deuteronômio".into(),
            }]],
            &[50],
        );
        let html = "porquanto o antigo pacto punia os ofensores deliberados com a morte (ver Deut. 17:26<strong>־</strong>);";
        let runs = render_commentary_html(html, Some(&matcher));
        let link = runs
            .iter()
            .find(|r| matches!(r, CommentaryRun::Link { .. }));
        assert_eq!(
            link,
            Some(&CommentaryRun::Link {
                label: "Deut. 17:26".into(),
                book: 50,
                chapter: 17,
                verse: Some(26),
                italic: false,
                bold: false,
            })
        );
    }

    fn dump(runs: &[CommentaryRun]) -> String {
        runs.iter()
            .map(|run| match run {
                CommentaryRun::Break | CommentaryRun::ListItem { .. } => "\n".to_string(),
                CommentaryRun::Text { text, .. } | CommentaryRun::Label { text } => text.clone(),
                CommentaryRun::Link { label, .. } | CommentaryRun::DictLink { label, .. } => {
                    label.clone()
                }
            })
            .collect()
    }
}
