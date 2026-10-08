//! Palette, radii, and small text helpers shared by the shell.

use graphe_domain::books::{CHAPTER_COUNTS, GRAPHE_BOOK_NUMBERS, VERSES_PER_CHAPTER};
use graphe_domain::i18n;
use graphe_domain::model::BookRecord;
use graphe_domain::theme::{self, UiPalette};

pub(crate) fn apply(ctx: &egui::Context, dark: bool, font: f32) {
    let palette = theme::palette(dark);
    let mut visuals = if dark {
        egui::Visuals::dark()
    } else {
        egui::Visuals::light()
    };
    visuals.window_corner_radius = egui::CornerRadius::same(theme::RADIUS_SURFACE as u8);
    visuals.widgets.noninteractive.corner_radius =
        egui::CornerRadius::same(theme::RADIUS_INLINE as u8);
    visuals.widgets.inactive.corner_radius = egui::CornerRadius::same(theme::RADIUS_CONTROL as u8);
    visuals.widgets.hovered.corner_radius = egui::CornerRadius::same(theme::RADIUS_CONTROL as u8);
    visuals.widgets.active.corner_radius = egui::CornerRadius::same(theme::RADIUS_CONTROL as u8);
    visuals.menu_corner_radius = egui::CornerRadius::same(theme::RADIUS_SURFACE as u8);
    visuals.panel_fill = color(palette.ui_surface);
    visuals.window_fill = color(palette.ui_bg);
    visuals.extreme_bg_color = color(palette.ui_bg);
    ctx.set_visuals(visuals);
    let mut style = (*ctx.style()).clone();
    style
        .text_styles
        .insert(egui::TextStyle::Body, egui::FontId::proportional(font));
    style
        .text_styles
        .insert(egui::TextStyle::Button, egui::FontId::proportional(font));
    ctx.set_style(style);
}

pub(crate) fn panel(hex: &str) -> egui::Frame {
    egui::Frame::new()
        .fill(color(hex))
        .inner_margin(egui::Margin::same(8))
}

pub(crate) fn color(hex: &str) -> egui::Color32 {
    let hex = hex.trim_start_matches('#');
    let value = u32::from_str_radix(hex, 16).unwrap_or(0);
    egui::Color32::from_rgb(
        ((value >> 16) & 0xff) as u8,
        ((value >> 8) & 0xff) as u8,
        (value & 0xff) as u8,
    )
}

pub(crate) fn canon_books() -> Vec<BookRecord> {
    GRAPHE_BOOK_NUMBERS
        .iter()
        .map(|number| {
            let name = i18n::book_name(i64::from(*number));
            BookRecord {
                book_number: i64::from(*number),
                short_name: Some(name.short),
                long_name: Some(name.long),
            }
        })
        .collect()
}

pub(crate) fn chapter_count_fallback(book: i64) -> i64 {
    let index = GRAPHE_BOOK_NUMBERS
        .iter()
        .position(|number| i64::from(*number) == book);
    index
        .and_then(|index| CHAPTER_COUNTS.get(index).copied())
        .map(i64::from)
        .unwrap_or(1)
}

pub(crate) fn verse_count_fallback(book: i64, chapter: i64) -> i64 {
    let index = GRAPHE_BOOK_NUMBERS
        .iter()
        .position(|number| i64::from(*number) == book);
    index
        .and_then(|index| VERSES_PER_CHAPTER.get(index))
        .and_then(|chapters| chapters.get(chapter.saturating_sub(1) as usize).copied())
        .map(i64::from)
        .unwrap_or(1)
}

#[derive(Clone, Copy)]
pub(crate) enum Icon {
    Search,
    Book,
    Library,
    Settings,
}

pub(crate) fn icon_button(
    ui: &mut egui::Ui,
    icon: Icon,
    active: bool,
    palette: &UiPalette,
) -> egui::Response {
    let (rect, response) = ui.allocate_exact_size(egui::vec2(48.0, 42.0), egui::Sense::click());
    if active {
        ui.painter()
            .rect_filled(rect, 0.0, color(palette.ui_surface));
        let marker = egui::Rect::from_min_size(
            rect.left_top() + egui::vec2(0.0, 8.0),
            egui::vec2(2.0, rect.height() - 16.0),
        );
        ui.painter()
            .rect_filled(marker, 0.0, color(palette.ui_link));
    }
    let ink = color(if active || response.hovered() {
        palette.ui_link_strong
    } else {
        palette.ui_text_subtle
    });
    draw_icon(ui.painter(), rect.center(), ink, icon);
    response
}

fn draw_icon(painter: &egui::Painter, center: egui::Pos2, ink: egui::Color32, icon: Icon) {
    let stroke = egui::Stroke::new(1.6_f32, ink);
    match icon {
        Icon::Search => {
            painter.circle_stroke(center + egui::vec2(-2.0, -2.0), 6.0, stroke);
            painter.line_segment(
                [center + egui::vec2(3.0, 3.0), center + egui::vec2(8.0, 8.0)],
                stroke,
            );
        }
        Icon::Book => {
            let rect = egui::Rect::from_center_size(center, egui::vec2(14.0, 16.0));
            painter.rect_stroke(rect, 1.0, stroke, egui::StrokeKind::Outside);
            painter.line_segment(
                [
                    rect.center_top() + egui::vec2(0.0, 1.0),
                    rect.center_bottom(),
                ],
                stroke,
            );
        }
        Icon::Library => {
            for dx in [-6.0, 0.0, 6.0] {
                let rect = egui::Rect::from_center_size(
                    center + egui::vec2(dx, 0.0),
                    egui::vec2(4.0, 14.0),
                );
                painter.rect_stroke(rect, 1.0, stroke, egui::StrokeKind::Outside);
            }
        }
        Icon::Settings => {
            painter.circle_stroke(center, 4.0, stroke);
            for index in 0..8 {
                let angle = index as f32 * std::f32::consts::FRAC_PI_4;
                let dir = egui::vec2(angle.cos(), angle.sin());
                painter.line_segment([center + dir * 6.0, center + dir * 8.5], stroke);
            }
        }
    }
}

pub(crate) fn show_html(
    ui: &mut egui::Ui,
    html: &str,
    size: f32,
    text: egui::Color32,
    emphasis: egui::Color32,
) {
    let formatted = graphe_domain::dict::format_definition(html);
    let mut job = egui::text::LayoutJob::default();
    let mut bold = false;
    let mut italic = false;
    let mut rest = formatted.as_str();
    let flush = |ui: &mut egui::Ui, job: &mut egui::text::LayoutJob| {
        if job.is_empty() {
            return;
        }
        let finished = std::mem::take(job);
        ui.label(finished);
    };
    while let Some(start) = rest.find('<') {
        push_html_text(
            &mut job,
            &decode_entities(&rest[..start]),
            size,
            text,
            emphasis,
            bold,
            italic,
        );
        let after = &rest[start + 1..];
        let Some(end) = after.find('>') else {
            break;
        };
        let tag = after[..end].trim().to_ascii_lowercase();
        rest = &after[end + 1..];
        let closing = tag.starts_with('/');
        let name = tag
            .trim_start_matches('/')
            .split_whitespace()
            .next()
            .unwrap_or("");
        match name {
            "b" | "strong" => bold = !closing,
            "i" | "em" => italic = !closing,
            "br" | "p" | "div" | "li" | "ol" | "ul" => {
                if name != "br" && !closing && name != "ol" && name != "ul" {
                    flush(ui, &mut job);
                }
                if closing || name == "br" {
                    flush(ui, &mut job);
                }
                if name == "li" && !closing {
                    push_html_text(&mut job, "• ", size, emphasis, emphasis, true, false);
                }
            }
            _ => {}
        }
    }
    push_html_text(
        &mut job,
        &decode_entities(rest),
        size,
        text,
        emphasis,
        bold,
        italic,
    );
    flush(ui, &mut job);
}

fn push_html_text(
    job: &mut egui::text::LayoutJob,
    text: &str,
    size: f32,
    color: egui::Color32,
    emphasis: egui::Color32,
    bold: bool,
    italic: bool,
) {
    if text.is_empty() {
        return;
    }
    job.append(
        text,
        0.0,
        egui::TextFormat {
            font_id: egui::FontId::proportional(size),
            color: if bold { emphasis } else { color },
            italics: italic,
            ..Default::default()
        },
    );
}

fn decode_entities(value: &str) -> String {
    value
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
}

pub(crate) fn unescape(value: &str) -> String {
    value
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&amp;", "&")
}
