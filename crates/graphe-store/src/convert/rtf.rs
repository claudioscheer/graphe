//! Small RTF-to-HTML converter for TheWord commentary bodies.
//! Covers the control words the fixtures and provider fallback actually hit.
//! `@iarna/rtf-to-html` is not available here; output is the HTML body only.

use super::ConvertError;

struct Fmt {
    bold: bool,
    italic: bool,
    underline: bool,
    uc: usize,
}

struct Parser {
    chars: Vec<char>,
    i: usize,
    out: String,
    bold: bool,
    italic: bool,
    underline: bool,
    uc: usize,
    stack: Vec<Fmt>,
}

pub fn convert_rtf_to_html(input: &str) -> Result<String, ConvertError> {
    let rtf = input.replace("\\ansicpg0", "\\ansicpg1252");
    let body = Parser::new(&rtf).run();
    let trimmed = body.trim();
    if trimmed.is_empty() {
        Err(ConvertError("RTF conversion produced no text".into()))
    } else {
        Ok(trimmed.to_string())
    }
}

impl Parser {
    fn new(input: &str) -> Self {
        Self {
            chars: input.chars().collect(),
            i: 0,
            out: String::new(),
            bold: false,
            italic: false,
            underline: false,
            uc: 1,
            stack: Vec::new(),
        }
    }

    fn run(mut self) -> String {
        while self.i < self.chars.len() {
            match self.chars[self.i] {
                '{' => {
                    if self.is_ignorable_dest() {
                        self.i += 1;
                        self.skip_braced();
                    } else {
                        self.stack.push(Fmt {
                            bold: self.bold,
                            italic: self.italic,
                            underline: self.underline,
                            uc: self.uc,
                        });
                        self.i += 1;
                    }
                }
                '}' => {
                    if let Some(prev) = self.stack.pop() {
                        self.set_bold(prev.bold);
                        self.set_italic(prev.italic);
                        self.set_underline(prev.underline);
                        self.uc = prev.uc;
                    }
                    self.i += 1;
                }
                '\\' => self.parse_control(),
                '\r' | '\n' => self.i += 1,
                ch => {
                    self.emit(ch);
                    self.i += 1;
                }
            }
        }
        self.set_bold(false);
        self.set_italic(false);
        self.set_underline(false);
        let body = self.out.trim().to_string();
        if body.is_empty() {
            String::new()
        } else if body.contains("<p>") {
            body
        } else {
            format!("<p>{body}</p>")
        }
    }

    fn is_ignorable_dest(&self) -> bool {
        let mut j = self.i + 1;
        while j < self.chars.len() && self.chars[j].is_whitespace() {
            j += 1;
        }
        if j >= self.chars.len() || self.chars[j] != '\\' {
            return false;
        }
        j += 1;
        if j < self.chars.len() && self.chars[j] == '*' {
            return true;
        }
        let start = j;
        while j < self.chars.len() && self.chars[j].is_ascii_alphabetic() {
            j += 1;
        }
        let word: String = self.chars[start..j]
            .iter()
            .collect::<String>()
            .to_ascii_lowercase();
        matches!(
            word.as_str(),
            "fonttbl"
                | "colortbl"
                | "stylesheet"
                | "info"
                | "pict"
                | "object"
                | "footer"
                | "header"
                | "footerf"
                | "headerf"
                | "footnote"
                | "fldinst"
                | "xe"
                | "tc"
                | "listtable"
                | "listoverridetable"
                | "rsidtbl"
                | "generator"
                | "datafield"
                | "themedata"
                | "colorschememapping"
                | "latentstyles"
                | "datastore"
                | "xmlnstbl"
                | "pgdsctbl"
                | "revtbl"
                | "filetbl"
                | "falt"
                | "panose"
                | "annotation"
        )
    }

    fn skip_braced(&mut self) {
        let mut depth = 1;
        while self.i < self.chars.len() && depth > 0 {
            let c = self.chars[self.i];
            if c == '\\' {
                self.i += 1;
                if self.i >= self.chars.len() {
                    break;
                }
                let n = self.chars[self.i];
                if n == '\'' {
                    self.i = (self.i + 3).min(self.chars.len());
                    continue;
                }
                if n.is_ascii_alphabetic() {
                    self.i += 1;
                    while self.i < self.chars.len() && self.chars[self.i].is_ascii_alphabetic() {
                        self.i += 1;
                    }
                    if self.i < self.chars.len()
                        && (self.chars[self.i] == '-' || self.chars[self.i].is_ascii_digit())
                    {
                        if self.chars[self.i] == '-' {
                            self.i += 1;
                        }
                        while self.i < self.chars.len() && self.chars[self.i].is_ascii_digit() {
                            self.i += 1;
                        }
                    }
                    if self.i < self.chars.len() && self.chars[self.i] == ' ' {
                        self.i += 1;
                    }
                    continue;
                }
                self.i += 1;
                continue;
            }
            if c == '{' {
                depth += 1;
            } else if c == '}' {
                depth -= 1;
            }
            self.i += 1;
        }
    }

    fn parse_control(&mut self) {
        self.i += 1;
        if self.i >= self.chars.len() {
            return;
        }
        let c = self.chars[self.i];
        match c {
            '\\' | '{' | '}' => {
                self.emit(c);
                self.i += 1;
                return;
            }
            '\'' => {
                self.parse_hex();
                return;
            }
            '~' => {
                self.emit('\u{00a0}');
                self.i += 1;
                return;
            }
            '-' | '_' => {
                if c == '_' {
                    self.emit('-');
                }
                self.i += 1;
                return;
            }
            '\n' | '\r' => {
                self.paragraph_break();
                self.i += 1;
                return;
            }
            '*' => {
                self.i += 1;
                return;
            }
            _ => {}
        }
        if !c.is_ascii_alphabetic() {
            self.i += 1;
            return;
        }
        let start = self.i;
        while self.i < self.chars.len() && self.chars[self.i].is_ascii_alphabetic() {
            self.i += 1;
        }
        let word: String = self.chars[start..self.i]
            .iter()
            .collect::<String>()
            .to_ascii_lowercase();
        let mut param = None;
        if self.i < self.chars.len()
            && (self.chars[self.i] == '-' || self.chars[self.i].is_ascii_digit())
        {
            let neg = self.chars[self.i] == '-';
            if neg {
                self.i += 1;
            }
            let mut n = 0i32;
            let mut any = false;
            while self.i < self.chars.len() && self.chars[self.i].is_ascii_digit() {
                any = true;
                n = n
                    .saturating_mul(10)
                    .saturating_add((self.chars[self.i] as u8 - b'0') as i32);
                self.i += 1;
            }
            if any {
                param = Some(if neg { -n } else { n });
            }
        }
        if self.i < self.chars.len() && self.chars[self.i] == ' ' {
            self.i += 1;
        }
        self.apply_control(&word, param);
    }

    fn parse_hex(&mut self) {
        self.i += 1;
        if self.i + 1 >= self.chars.len() {
            return;
        }
        let h1 = self.chars[self.i].to_digit(16);
        let h2 = self.chars[self.i + 1].to_digit(16);
        self.i += 2;
        if let (Some(a), Some(b)) = (h1, h2) {
            self.emit(cp1252((a * 16 + b) as u8));
        }
    }

    fn apply_control(&mut self, word: &str, param: Option<i32>) {
        match word {
            "par" | "line" | "lbr" => self.paragraph_break(),
            "tab" => self.emit('\t'),
            "b" => self.set_bold(param.unwrap_or(1) != 0),
            "i" => self.set_italic(param.unwrap_or(1) != 0),
            "ul" => self.set_underline(param.unwrap_or(1) != 0),
            "ulnone" => self.set_underline(false),
            "plain" => {
                self.set_bold(false);
                self.set_italic(false);
                self.set_underline(false);
            }
            "uc" => {
                if let Some(n) = param {
                    self.uc = n.max(0) as usize;
                }
            }
            "u" => {
                if let Some(n) = param {
                    let cp = if n < 0 { n + 65536 } else { n };
                    if let Some(ch) = char::from_u32(cp as u32) {
                        self.emit(ch);
                    }
                    for _ in 0..self.uc {
                        self.skip_fallback_char();
                    }
                }
            }
            _ => {}
        }
    }

    fn skip_fallback_char(&mut self) {
        if self.i >= self.chars.len() {
            return;
        }
        if self.chars[self.i] == '\\' {
            if self.i + 1 < self.chars.len() && self.chars[self.i + 1] == '\'' {
                self.i = (self.i + 4).min(self.chars.len());
                return;
            }
            self.i += 1;
            if self.i < self.chars.len() && !self.chars[self.i].is_ascii_alphabetic() {
                self.i += 1;
            }
            return;
        }
        if self.chars[self.i] != '{' && self.chars[self.i] != '}' {
            self.i += 1;
        }
    }

    fn emit(&mut self, ch: char) {
        self.out.push(ch);
    }

    fn paragraph_break(&mut self) {
        self.out.push_str("<br>");
    }

    fn set_bold(&mut self, on: bool) {
        self.toggle(self.bold, on, "<b>", "</b>");
        self.bold = on;
    }

    fn set_italic(&mut self, on: bool) {
        self.toggle(self.italic, on, "<i>", "</i>");
        self.italic = on;
    }

    fn set_underline(&mut self, on: bool) {
        self.toggle(self.underline, on, "<u>", "</u>");
        self.underline = on;
    }

    fn toggle(&mut self, was: bool, on: bool, open: &str, close: &str) {
        if was == on {
            return;
        }
        self.out.push_str(if on { open } else { close });
    }
}

fn cp1252(byte: u8) -> char {
    const MAP: [char; 32] = [
        '\u{20ac}', '\u{0081}', '\u{201a}', '\u{0192}', '\u{201e}', '\u{2026}', '\u{2020}',
        '\u{2021}', '\u{02c6}', '\u{2030}', '\u{0160}', '\u{2039}', '\u{0152}', '\u{008d}',
        '\u{017d}', '\u{008f}', '\u{0090}', '\u{2018}', '\u{2019}', '\u{201c}', '\u{201d}',
        '\u{2022}', '\u{2013}', '\u{2014}', '\u{02dc}', '\u{2122}', '\u{0161}', '\u{203a}',
        '\u{0153}', '\u{009d}', '\u{017e}', '\u{0178}',
    ];
    if (0x80..0xA0).contains(&byte) {
        MAP[(byte - 0x80) as usize]
    } else {
        char::from(byte)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_plain_bold_and_hex_escapes() {
        let html = convert_rtf_to_html(r"{\rtf1\ansi{\fonttbl{\f0 Times;}}Hello \b bold\b0 \'e9}")
            .unwrap();
        assert!(html.contains("Hello"));
        assert!(html.contains("<b>bold</b>"));
        assert!(html.contains('é'));
        assert!(!html.contains("Times"));
    }

    #[test]
    fn converts_unicode_and_paragraphs() {
        let html = convert_rtf_to_html(r"{\rtf1\ansi \u233\'3f there\par Next}").unwrap();
        assert!(html.contains('é'));
        assert!(html.contains("there"));
        assert!(html.contains("<br>"));
        assert!(html.contains("Next"));
        assert!(!html.contains('?'));
    }
}
