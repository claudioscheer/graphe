//! Commentary HTML the way the Electron pane shows it.
//!
//! Paragraphs, emphasis, and `<a href="B:…">` bible links become runs.
//! Other tags are dropped. Script and style elements are dropped with their text.

use crate::bible_ref::{parse_bible_href, ParseBibleHrefOptions};
use crate::commentary_ref::{ContinuationOptions, ReferenceContext, ReferenceMatcher};

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CommentaryRun {
    Break,
    Text {
        text: String,
        italic: bool,
        bold: bool,
    },
    Link {
        label: String,
        book: i64,
        chapter: i64,
        verse: Option<i64>,
        italic: bool,
        bold: bool,
    },
}

/// Turn commentary HTML into runs. Plain-text references are linked when `matcher` is set.
pub fn render_commentary_html(
    html: &str,
    matcher: Option<&ReferenceMatcher>,
) -> Vec<CommentaryRun> {
    let mut runs = parse_html(html);
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
            CommentaryRun::Break => out.push('\n'),
            CommentaryRun::Text { text, .. } => out.push_str(&text),
            CommentaryRun::Link { label, .. } => out.push_str(&label),
        }
    }
    out.lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

fn parse_html(html: &str) -> Vec<CommentaryRun> {
    let chars: Vec<char> = html.chars().collect();
    let mut runs = Vec::new();
    let mut buf = String::new();
    let mut italic = 0i32;
    let mut bold = 0i32;
    let mut link: Option<(i64, i64, Option<i64>)> = None;
    let mut i = 0usize;
    while i < chars.len() {
        if chars[i] == '<' && looks_like_tag(&chars, i) {
            flush(&mut runs, &mut buf, italic > 0, bold > 0, link);
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
                    "a" => link = None,
                    "p" | "div" | "li" | "tr" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6"
                    | "blockquote" => push_break(&mut runs),
                    _ => {}
                }
                continue;
            }
            match name {
                "br" | "hr" | "pb" => push_break(&mut runs),
                "p" | "div" | "li" | "tr" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6"
                | "blockquote" => {
                    push_break(&mut runs);
                }
                "em" | "i" => italic += 1,
                "strong" | "b" => bold += 1,
                "a" => {
                    if let Some(href) = tag.attr("href") {
                        if let Some(parsed) =
                            parse_bible_href(Some(&href), ParseBibleHrefOptions::default())
                        {
                            link = Some((parsed.book_number, parsed.chapter, parsed.verse));
                        }
                    }
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
    flush(&mut runs, &mut buf, italic > 0, bold > 0, link);
    runs
}

fn link_plain_references(
    runs: Vec<CommentaryRun>,
    matcher: &ReferenceMatcher,
) -> Vec<CommentaryRun> {
    let mut out = Vec::new();
    let mut context: Option<ReferenceContext> = None;
    for run in runs {
        let CommentaryRun::Text { text, italic, bold } = run else {
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
            out.push(CommentaryRun::Text { text, italic, bold });
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
    link: Option<(i64, i64, Option<i64>)>,
) {
    let mut text = normalize_space(buf);
    buf.clear();
    if matches!(runs.last(), Some(CommentaryRun::Break) | None) {
        text = text.trim_start().to_string();
    }
    if text.is_empty() {
        return;
    }
    if let Some((book, chapter, verse)) = link {
        runs.push(CommentaryRun::Link {
            label: text,
            book,
            chapter,
            verse,
            italic,
            bold,
        });
    } else {
        runs.push(CommentaryRun::Text { text, italic, bold });
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

    fn dump(runs: &[CommentaryRun]) -> String {
        runs.iter()
            .map(|run| match run {
                CommentaryRun::Break => "\n".to_string(),
                CommentaryRun::Text { text, .. } => text.clone(),
                CommentaryRun::Link { label, .. } => label.clone(),
            })
            .collect()
    }
}
