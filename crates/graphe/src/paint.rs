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
    visuals.widgets.noninteractive.bg_stroke = egui::Stroke::new(1.0_f32, color(palette.ui_border));
    visuals.panel_fill = color(palette.ui_surface);
    visuals.window_fill = color(palette.ui_bg);
    visuals.extreme_bg_color = color(palette.ui_bg);
    // egui otherwise lets a scroll area paint a few pixels outside its box,
    // which draws chapter and commentary text across the bar above it.
    visuals.clip_rect_margin = 0.0;
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

/// Stop a scroll area from painting into the fixed bar above it.
pub(crate) fn clip_scroll_to_viewport(ui: &mut egui::Ui) {
    ui.visuals_mut().clip_rect_margin = 0.0;
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

pub(crate) fn color_alpha(hex: &str, alpha: u8) -> egui::Color32 {
    let opaque = color(hex);
    egui::Color32::from_rgba_unmultiplied(opaque.r(), opaque.g(), opaque.b(), alpha)
}

pub(crate) fn mix(from_hex: &str, to_hex: &str, from_weight: f32) -> egui::Color32 {
    let from = color(from_hex);
    let to = color(to_hex);
    let weight = from_weight.clamp(0.0, 1.0);
    let channel = |a: u8, b: u8| (a as f32 * weight + b as f32 * (1.0 - weight)).round() as u8;
    egui::Color32::from_rgb(
        channel(from.r(), to.r()),
        channel(from.g(), to.g()),
        channel(from.b(), to.b()),
    )
}

/// Active workspace tab and pane toolbar fill from the Electron stylesheet.
pub(crate) fn workspace_tab_active(dark: bool) -> egui::Color32 {
    if dark {
        mix("#252526", "#000000", 0.72)
    } else {
        mix("#f8f5ed", "#1a1612", 0.945)
    }
}

pub(crate) fn top_strip_bg(dark: bool, palette: &UiPalette) -> egui::Color32 {
    if dark {
        color("#202020")
    } else {
        color(palette.ui_surface_muted)
    }
}

const TIP_WIDTH: f32 = 280.0;

/// Hover card in the same voice as the pane menu.
pub(crate) fn hover_tip(response: egui::Response, text: impl Into<String>) -> egui::Response {
    show_hover_tip(&response, text.into(), false);
    response
}

/// Same card as [`hover_tip`], anchored at the pointer.
pub(crate) fn hover_tip_at_pointer(
    response: egui::Response,
    text: impl Into<String>,
) -> egui::Response {
    show_hover_tip(&response, text.into(), true);
    response
}

fn show_hover_tip(response: &egui::Response, text: String, at_pointer: bool) {
    if text.trim().is_empty() {
        return;
    }
    let dark = response.ctx.style().visuals.dark_mode;
    let mut tip = egui::Tooltip::for_enabled(response);
    tip.popup = tip.popup.frame(tip_frame(dark)).width(TIP_WIDTH);
    tip = if at_pointer {
        tip.at_pointer().gap(16.0)
    } else {
        tip.gap(8.0)
    };
    let lines: Vec<String> = text
        .split('\n')
        .filter(|line| !line.trim().is_empty())
        .map(str::to_string)
        .collect();
    tip.show(move |ui| {
        ui.set_max_width(TIP_WIDTH);
        ui.spacing_mut().item_spacing.y = 2.0;
        let palette = theme::palette(ui.visuals().dark_mode);
        for (index, line) in lines.iter().enumerate() {
            let secondary = index > 0;
            ui.label(
                egui::RichText::new(line)
                    .size(if secondary { 12.0 } else { 13.0 })
                    .color(color(if secondary {
                        palette.ui_text_subtle
                    } else {
                        palette.ui_text
                    })),
            );
        }
    });
}

fn tip_frame(dark: bool) -> egui::Frame {
    let palette = theme::palette(dark);
    egui::Frame::new()
        .inner_margin(egui::Margin::symmetric(10, 8))
        .corner_radius(egui::CornerRadius::same(theme::RADIUS_SURFACE as u8))
        .fill(color(palette.ui_surface_elevated))
        .stroke(egui::Stroke::new(1.0_f32, color(palette.ui_border)))
        .shadow(egui::Shadow {
            offset: [0, 4],
            blur: 16,
            spread: 0,
            color: egui::Color32::from_black_alpha(if dark { 120 } else { 35 }),
        })
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

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Icon {
    Search,
    Book,
    BookOpen,
    Library,
    Files,
    Settings,
    PanelLeftClose,
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    Info,
    Plus,
    Close,
    Ellipsis,
    ArrowLeft,
    ArrowRight,
    Pin,
}

pub(crate) fn icon_button(
    ui: &mut egui::Ui,
    icon: Icon,
    active: bool,
    palette: &UiPalette,
) -> egui::Response {
    let (rect, response) = ui.allocate_exact_size(egui::vec2(44.0, 42.0), egui::Sense::click());
    if active {
        ui.painter()
            .rect_filled(rect, 0.0, color(palette.ui_surface_muted));
        let marker = egui::Rect::from_min_size(
            rect.left_top() + egui::vec2(0.0, 8.0),
            egui::vec2(2.0, rect.height() - 16.0),
        );
        ui.painter()
            .rect_filled(marker, 0.0, color(palette.ui_link));
    }
    let ink = color(if active {
        palette.ui_link_strong
    } else if response.hovered() {
        palette.ui_text_muted
    } else {
        palette.ui_text_subtle
    });
    draw_icon(ui.painter(), rect.center(), ink, icon);
    response.on_hover_cursor(egui::CursorIcon::PointingHand)
}

pub(crate) fn draw_icon(
    painter: &egui::Painter,
    center: egui::Pos2,
    ink: egui::Color32,
    icon: Icon,
) {
    let stroke = egui::Stroke::new(1.5_f32, ink);
    match icon {
        Icon::Search => {
            painter.circle_stroke(center + egui::vec2(-2.0, -2.0), 5.5, stroke);
            painter.line_segment(
                [center + egui::vec2(2.5, 2.5), center + egui::vec2(7.5, 7.5)],
                stroke,
            );
        }
        Icon::Book => {
            // Lucide book-marked: closed book with bookmark tab
            let rect = egui::Rect::from_center_size(center, egui::vec2(14.0, 17.0));
            painter.rect_stroke(
                rect,
                egui::CornerRadius::same(2),
                stroke,
                egui::StrokeKind::Outside,
            );
            // Ribbon at top
            let rx = rect.center().x;
            painter.line_segment(
                [
                    egui::pos2(rx - 2.5, rect.top()),
                    egui::pos2(rx - 2.5, rect.top() + 6.0),
                ],
                stroke,
            );
            painter.line_segment(
                [
                    egui::pos2(rx + 2.5, rect.top()),
                    egui::pos2(rx + 2.5, rect.top() + 6.0),
                ],
                stroke,
            );
            painter.line_segment(
                [
                    egui::pos2(rx - 2.5, rect.top() + 6.0),
                    egui::pos2(rx, rect.top() + 4.5),
                ],
                stroke,
            );
            painter.line_segment(
                [
                    egui::pos2(rx + 2.5, rect.top() + 6.0),
                    egui::pos2(rx, rect.top() + 4.5),
                ],
                stroke,
            );
        }
        Icon::BookOpen => {
            // Lucide book-open
            let left_top = center + egui::vec2(-7.0, -6.0);
            let right_top = center + egui::vec2(7.0, -6.0);
            let spine_top = center + egui::vec2(0.0, -4.0);
            let spine_bottom = center + egui::vec2(0.0, 6.0);
            let left_bottom = center + egui::vec2(-7.0, 4.0);
            let right_bottom = center + egui::vec2(7.0, 4.0);
            painter.line_segment([spine_top, spine_bottom], stroke);
            painter.line_segment([left_top, spine_top], stroke);
            painter.line_segment([spine_top, right_top], stroke);
            painter.line_segment([left_bottom, spine_bottom], stroke);
            painter.line_segment([spine_bottom, right_bottom], stroke);
            painter.line_segment([left_top, left_bottom], stroke);
            painter.line_segment([right_top, right_bottom], stroke);
        }
        Icon::Library => {
            // Lucide library: 2 upright books, 1 leaning right
            let y_top = center.y - 7.0;
            let y_bot = center.y + 7.0;
            // Book 1
            painter.line_segment(
                [
                    egui::pos2(center.x - 6.0, y_top),
                    egui::pos2(center.x - 6.0, y_bot),
                ],
                stroke,
            );
            painter.line_segment(
                [
                    egui::pos2(center.x - 3.0, y_top),
                    egui::pos2(center.x - 3.0, y_bot),
                ],
                stroke,
            );
            painter.line_segment(
                [
                    egui::pos2(center.x - 6.0, y_top),
                    egui::pos2(center.x - 3.0, y_top),
                ],
                stroke,
            );
            // Book 2
            painter.line_segment(
                [
                    egui::pos2(center.x - 1.0, y_top),
                    egui::pos2(center.x - 1.0, y_bot),
                ],
                stroke,
            );
            painter.line_segment(
                [
                    egui::pos2(center.x + 2.0, y_top),
                    egui::pos2(center.x + 2.0, y_bot),
                ],
                stroke,
            );
            painter.line_segment(
                [
                    egui::pos2(center.x - 1.0, y_top),
                    egui::pos2(center.x + 2.0, y_top),
                ],
                stroke,
            );
            // Book 3 (leaning right)
            painter.line_segment(
                [
                    egui::pos2(center.x + 3.5, y_top + 1.0),
                    egui::pos2(center.x + 7.5, y_bot),
                ],
                stroke,
            );
            painter.line_segment(
                [
                    egui::pos2(center.x + 5.5, y_top + 0.0),
                    egui::pos2(center.x + 9.5, y_bot - 1.0),
                ],
                stroke,
            );
        }
        Icon::Files => {
            // Lucide files: overlapping documents
            let back_rect =
                egui::Rect::from_min_size(center + egui::vec2(-2.0, -7.0), egui::vec2(9.0, 11.0));
            painter.rect_stroke(
                back_rect,
                egui::CornerRadius::same(2),
                stroke,
                egui::StrokeKind::Outside,
            );
            let front_rect =
                egui::Rect::from_min_size(center + egui::vec2(-7.0, -3.0), egui::vec2(9.0, 11.0));
            painter.rect_filled(
                front_rect,
                egui::CornerRadius::same(2),
                egui::Color32::from_rgb(254, 253, 249),
            );
            painter.rect_stroke(
                front_rect,
                egui::CornerRadius::same(2),
                stroke,
                egui::StrokeKind::Outside,
            );
        }
        Icon::Settings => {
            painter.circle_stroke(center, 3.5, stroke);
            for index in 0..8 {
                let angle = index as f32 * std::f32::consts::FRAC_PI_4;
                let dir = egui::vec2(angle.cos(), angle.sin());
                painter.line_segment([center + dir * 5.0, center + dir * 7.5], stroke);
            }
        }
        Icon::PanelLeftClose => {
            // Lucide panel-left-close: rect with divider and left arrow
            let rect = egui::Rect::from_center_size(center, egui::vec2(15.0, 13.0));
            painter.rect_stroke(
                rect,
                egui::CornerRadius::same(2),
                stroke,
                egui::StrokeKind::Outside,
            );
            // Right divider
            let div_x = rect.right() - 4.5;
            painter.line_segment(
                [
                    egui::pos2(div_x, rect.top()),
                    egui::pos2(div_x, rect.bottom()),
                ],
                stroke,
            );
            // Left arrow inside
            let arr_tip_x = rect.left() + 3.0;
            let arr_base_x = rect.left() + 6.0;
            let cy = rect.center().y;
            painter.line_segment(
                [egui::pos2(arr_base_x, cy - 2.5), egui::pos2(arr_tip_x, cy)],
                stroke,
            );
            painter.line_segment(
                [egui::pos2(arr_tip_x, cy), egui::pos2(arr_base_x, cy + 2.5)],
                stroke,
            );
        }
        Icon::ChevronDown => {
            painter.line_segment(
                [
                    center + egui::vec2(-4.0, -2.0),
                    center + egui::vec2(0.0, 2.0),
                ],
                stroke,
            );
            painter.line_segment(
                [
                    center + egui::vec2(0.0, 2.0),
                    center + egui::vec2(4.0, -2.0),
                ],
                stroke,
            );
        }
        Icon::ChevronLeft => {
            painter.line_segment(
                [
                    center + egui::vec2(2.0, -4.0),
                    center + egui::vec2(-2.0, 0.0),
                ],
                stroke,
            );
            painter.line_segment(
                [
                    center + egui::vec2(-2.0, 0.0),
                    center + egui::vec2(2.0, 4.0),
                ],
                stroke,
            );
        }
        Icon::ChevronRight => {
            painter.line_segment(
                [
                    center + egui::vec2(-2.0, -4.0),
                    center + egui::vec2(2.0, 0.0),
                ],
                stroke,
            );
            painter.line_segment(
                [
                    center + egui::vec2(2.0, 0.0),
                    center + egui::vec2(-2.0, 4.0),
                ],
                stroke,
            );
        }
        Icon::Info => {
            painter.circle_stroke(center, 6.0, stroke);
            painter.circle_filled(center + egui::vec2(0.0, -2.5), 0.9, ink);
            painter.line_segment(
                [
                    center + egui::vec2(0.0, -0.5),
                    center + egui::vec2(0.0, 3.5),
                ],
                stroke,
            );
        }
        Icon::Plus => {
            painter.line_segment(
                [
                    center + egui::vec2(-5.0, 0.0),
                    center + egui::vec2(5.0, 0.0),
                ],
                stroke,
            );
            painter.line_segment(
                [
                    center + egui::vec2(0.0, -5.0),
                    center + egui::vec2(0.0, 5.0),
                ],
                stroke,
            );
        }
        Icon::Close => {
            painter.line_segment(
                [
                    center + egui::vec2(-4.0, -4.0),
                    center + egui::vec2(4.0, 4.0),
                ],
                stroke,
            );
            painter.line_segment(
                [
                    center + egui::vec2(4.0, -4.0),
                    center + egui::vec2(-4.0, 4.0),
                ],
                stroke,
            );
        }
        Icon::Ellipsis => {
            for offset in [-5.0, 0.0, 5.0] {
                painter.circle_filled(center + egui::vec2(offset, 0.0), 1.3, ink);
            }
        }
        Icon::ArrowLeft => {
            painter.line_segment(
                [
                    center + egui::vec2(5.0, 0.0),
                    center + egui::vec2(-5.0, 0.0),
                ],
                stroke,
            );
            painter.line_segment(
                [
                    center + egui::vec2(-5.0, 0.0),
                    center + egui::vec2(-1.0, -3.5),
                ],
                stroke,
            );
            painter.line_segment(
                [
                    center + egui::vec2(-5.0, 0.0),
                    center + egui::vec2(-1.0, 3.5),
                ],
                stroke,
            );
        }
        Icon::ArrowRight => {
            painter.line_segment(
                [
                    center + egui::vec2(-5.0, 0.0),
                    center + egui::vec2(5.0, 0.0),
                ],
                stroke,
            );
            painter.line_segment(
                [
                    center + egui::vec2(5.0, 0.0),
                    center + egui::vec2(1.0, -3.5),
                ],
                stroke,
            );
            painter.line_segment(
                [center + egui::vec2(5.0, 0.0), center + egui::vec2(1.0, 3.5)],
                stroke,
            );
        }
        Icon::Pin => {
            painter.circle_stroke(center + egui::vec2(0.0, -3.0), 3.0, stroke);
            painter.line_segment(
                [center + egui::vec2(0.0, 0.0), center + egui::vec2(0.0, 6.0)],
                stroke,
            );
            painter.line_segment(
                [
                    center + egui::vec2(-3.0, 3.0),
                    center + egui::vec2(3.0, 3.0),
                ],
                stroke,
            );
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
            "span" => {
                if tag.contains("dict-def-label") {
                    bold = true;
                } else if closing {
                    bold = false;
                }
            }
            "br" | "p" | "div" | "li" | "ol" | "ul" => {
                if name != "br" && !closing && name != "ol" && name != "ul" {
                    flush(ui, &mut job);
                }
                if closing || name == "br" {
                    flush(ui, &mut job);
                }
                if name == "li" && !closing {
                    push_html_text(&mut job, "    ", size, text, emphasis, false, false);
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tip_frame_matches_the_pane_menu() {
        let light = tip_frame(false);
        assert_eq!(light.fill, color(theme::LIGHT.ui_surface_elevated));
        assert_eq!(light.stroke.color, color(theme::LIGHT.ui_border));
        assert_eq!(light.stroke.width, 1.0);
        assert_eq!(
            light.corner_radius,
            egui::CornerRadius::same(theme::RADIUS_SURFACE as u8)
        );
        assert_eq!(light.shadow.offset, [0, 4]);
        assert_eq!(light.shadow.blur, 16);
        assert_eq!(light.shadow.color, egui::Color32::from_black_alpha(35));
        assert_eq!(light.inner_margin, egui::Margin::symmetric(10, 8));

        let dark = tip_frame(true);
        assert_eq!(dark.fill, color(theme::DARK.ui_surface_elevated));
        assert_eq!(dark.stroke.color, color(theme::DARK.ui_border));
        assert_eq!(dark.shadow.color, egui::Color32::from_black_alpha(120));
    }

    #[test]
    fn hover_tip_paints_a_small_warm_card() {
        let ctx = egui::Context::default();
        let mut style = (*ctx.style()).clone();
        style.visuals = egui::Visuals::light();
        style.interaction.tooltip_delay = 0.0;
        style.interaction.show_tooltips_only_when_still = false;
        ctx.set_style(style);

        let mut pointer = egui::pos2(80.0, 40.0);
        let mut output = None;
        for time in [0.0_f64, 0.2, 0.4] {
            let mut raw = egui::RawInput::default();
            raw.screen_rect = Some(egui::Rect::from_min_size(
                egui::Pos2::ZERO,
                egui::vec2(480.0, 320.0),
            ));
            raw.time = Some(time);
            raw.events.push(egui::Event::PointerMoved(pointer));
            output = Some(ctx.run(raw, |ctx| {
                egui::CentralPanel::default().show(ctx, |ui| {
                    let (rect, response) =
                        ui.allocate_exact_size(egui::vec2(160.0, 32.0), egui::Sense::click());
                    pointer = rect.center();
                    hover_tip_at_pointer(
                        response,
                        "Comentário Expositivo - W. W. Wiersbe\nComentário Expositivo.commentary",
                    );
                });
            }));
        }

        let output = output.expect("frame");
        let mut cards = Vec::new();
        let mut text_heights = Vec::new();
        for clipped in &output.shapes {
            collect(&clipped.shape, &mut cards, &mut text_heights);
        }
        let fill = color(theme::LIGHT.ui_surface_elevated);
        let border = color(theme::LIGHT.ui_border);
        let card = cards
            .iter()
            .find(|rect| rect.fill == fill && rect.stroke.color == border)
            .expect("warm tooltip card");
        assert_eq!(
            card.corner_radius,
            egui::CornerRadius::same(theme::RADIUS_SURFACE as u8)
        );
        assert!(
            card.rect.width() > 40.0 && card.rect.width() <= TIP_WIDTH + 24.0,
            "width {}",
            card.rect.width()
        );
        let smallest = text_heights.iter().copied().fold(f32::MAX, f32::min);
        assert!(
            smallest < 18.0,
            "tip text should stay at the chrome size, got {smallest}"
        );
    }

    fn collect(shape: &egui::Shape, cards: &mut Vec<egui::epaint::RectShape>, text: &mut Vec<f32>) {
        match shape {
            egui::Shape::Rect(rect) => cards.push(rect.clone()),
            egui::Shape::Text(text_shape) => text.push(text_shape.galley.size().y),
            egui::Shape::Vec(list) => {
                for shape in list {
                    collect(shape, cards, text);
                }
            }
            _ => {}
        }
    }
}
