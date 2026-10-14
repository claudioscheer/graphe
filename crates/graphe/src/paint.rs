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
    // A floating bar normally widens under the pointer. On a side-by-side split
    // that widening sits on the divider, and egui then prefers whichever of the
    // bar and the divider is thinner, so hover flips every frame and the line flashes.
    style.spacing.scroll.floating_width = style.spacing.scroll.bar_width;
    // Menus and panels otherwise ease open. A click should show the surface at once.
    style.animation_time = 0.0;
    ctx.set_style(style);
    // One notch is 100 points before a view multiplies it. The view applies
    // that full step at once; egui would otherwise ease it over later frames.
    ctx.options_mut(|options| {
        options.input_options.line_scroll_speed = 100.0;
    });
    install_fonts(ctx);
}

/// Ubuntu-Light has no Hebrew, so dictionary lemmas draw as empty boxes.
/// DejaVu is always available. A system face, when present, is tried first
/// and matches the letters the Electron window gets from the OS.
fn install_fonts(ctx: &egui::Context) {
    let mut fonts = egui::FontDefinitions::default();
    fonts.font_data.insert(
        "DejaVuSans".to_owned(),
        std::sync::Arc::new(egui::FontData::from_static(include_bytes!(
            "../../../assets/fonts/DejaVuSans.ttf"
        ))),
    );
    if let Some(bytes) = system_ui_font() {
        fonts.font_data.insert(
            "system-ui".to_owned(),
            std::sync::Arc::new(egui::FontData::from_owned(bytes)),
        );
    }
    for family in [egui::FontFamily::Proportional, egui::FontFamily::Monospace] {
        let Some(list) = fonts.families.get_mut(&family) else {
            continue;
        };
        let at = list
            .iter()
            .position(|name| name == "NotoEmoji-Regular")
            .unwrap_or(list.len());
        list.insert(at, "DejaVuSans".to_owned());
        if fonts.font_data.contains_key("system-ui") {
            list.insert(at, "system-ui".to_owned());
        }
    }
    ctx.set_fonts(fonts);
}

fn system_ui_font() -> Option<Vec<u8>> {
    [
        r"C:\Windows\Fonts\segoeui.ttf",
        r"C:\Windows\Fonts\arial.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/noto/NotoSansHebrew-Regular.ttf",
        "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
        "/Library/Fonts/Arial Unicode.ttf",
    ]
    .iter()
    .find_map(|path| std::fs::read(path).ok())
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

fn scroll_limit_id(scroll_id: egui::Id) -> egui::Id {
    scroll_id.with("wheel-limit")
}

/// Remember how far this scroll area can move. The wheel handler reads it
/// next frame so a notch past the end does not shift the text and snap back.
pub(crate) fn remember_scroll_extent(
    ui: &egui::Ui,
    scroll_id: egui::Id,
    content: egui::Vec2,
    viewport: egui::Vec2,
) {
    let max = egui::vec2(
        (content.x - viewport.x).max(0.0),
        (content.y - viewport.y).max(0.0),
    );
    ui.data_mut(|data| data.insert_persisted(scroll_limit_id(scroll_id), max));
    let Some(mut state) = egui::containers::scroll_area::State::load(ui.ctx(), scroll_id) else {
        return;
    };
    let clamped = egui::vec2(
        state.offset.x.clamp(0.0, max.x),
        state.offset.y.clamp(0.0, max.y),
    );
    if clamped != state.offset {
        state.offset = clamped;
        state.store(ui.ctx(), scroll_id);
    }
}

/// Move a scroll area by the whole wheel step. egui eases large notches, which
/// feels like a delay. `speed` scales the step: 1 keeps it, 2 doubles it.
/// The offset stays inside the last measured range, including when the content
/// already fits and the range is zero.
pub(crate) fn scroll_by_wheel(ui: &egui::Ui, scroll_id: egui::Id, speed: f32) {
    let raw = ui.input(|input| input.raw_scroll_delta);
    if raw == egui::Vec2::ZERO {
        return;
    }
    if !ui.rect_contains_pointer(ui.available_rect_before_wrap()) {
        return;
    }
    let Some(mut state) = egui::containers::scroll_area::State::load(ui.ctx(), scroll_id) else {
        return;
    };
    let max = ui
        .data_mut(|data| data.get_persisted::<egui::Vec2>(scroll_limit_id(scroll_id)))
        .unwrap_or(egui::Vec2::ZERO);
    let next = egui::vec2(
        (state.offset.x - raw.x * speed).clamp(0.0, max.x),
        (state.offset.y - raw.y * speed).clamp(0.0, max.y),
    );
    if next != state.offset {
        state.offset = next;
        state.store(ui.ctx(), scroll_id);
    }
    ui.input_mut(|input| {
        input.smooth_scroll_delta = egui::Vec2::ZERO;
        input.raw_scroll_delta = egui::Vec2::ZERO;
    });
}

pub(crate) fn scroll_id(ui: &egui::Ui, salt: impl std::hash::Hash) -> egui::Id {
    ui.make_persistent_id(egui::Id::new(salt))
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
    PinOff,
    Refresh,
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

/// Magnifying glass. `scale` 1 is the sidebar mark; the reference field uses a smaller one.
pub(crate) fn draw_search_icon(
    painter: &egui::Painter,
    center: egui::Pos2,
    ink: egui::Color32,
    scale: f32,
) {
    let scale = scale.max(0.5);
    let stroke = egui::Stroke::new(1.5 * scale, ink);
    painter.circle_stroke(center + egui::vec2(-2.0, -2.0) * scale, 5.5 * scale, stroke);
    painter.line_segment(
        [
            center + egui::vec2(2.5, 2.5) * scale,
            center + egui::vec2(7.5, 7.5) * scale,
        ],
        stroke,
    );
}

/// Classic settings cog at the Electron activity-bar size (`w-5`, 20px).
/// Lucide's later `settings` mark is a scalloped rosette and reads as a flower.
fn draw_settings_icon(painter: &egui::Painter, center: egui::Pos2, ink: egui::Color32) {
    const SCALE: f32 = 20.0 / 24.0;
    let map = |x: f32, y: f32| center + egui::vec2((x - 12.0) * SCALE, (y - 12.0) * SCALE);
    let stroke_w = 2.0 * SCALE;
    let mut points: Vec<egui::Pos2> = settings_gear_points()
        .into_iter()
        .map(|(x, y)| map(x, y))
        .collect();
    if points.len() > 2 {
        let last = points.len() - 1;
        if points[0].distance(points[last]) < 0.4 {
            points.pop();
        }
    }
    painter.add(egui::Shape::Path(egui::epaint::PathShape::closed_line(
        points,
        egui::Stroke::new(stroke_w, ink),
    )));
    painter.circle_stroke(
        map(12.0, 12.0),
        3.0 * SCALE,
        egui::Stroke::new(stroke_w, ink),
    );
}

/// Feather settings cog in the 24×24 viewBox: six teeth and a flat crown.
fn settings_gear_points() -> Vec<(f32, f32)> {
    #[derive(Clone, Copy)]
    enum Step {
        H(f32),
        V(f32),
        L(f32, f32),
        /// Relative circular arc, radius 2, large-arc 0.
        A(bool, f32, f32),
    }
    use Step::{A, H, L, V};
    // https://unpkg.com/lucide-static@0.263.0/icons/settings.svg
    let steps = [
        H(-0.44),
        A(false, -2.0, 2.0),
        L(0.0, 0.18),
        A(true, -1.0, 1.73),
        L(-0.43, 0.25),
        A(true, -2.0, 0.0),
        L(-0.15, -0.08),
        A(false, -2.73, 0.73),
        L(-0.22, 0.38),
        A(false, 0.73, 2.73),
        L(0.15, 0.1),
        A(true, 1.0, 1.72),
        L(0.0, 0.51),
        A(true, -1.0, 1.74),
        L(-0.15, 0.09),
        A(false, -0.73, 2.73),
        L(0.22, 0.38),
        A(false, 2.73, 0.73),
        L(0.15, -0.08),
        A(true, 2.0, 0.0),
        L(0.43, 0.25),
        A(true, 1.0, 1.73),
        V(20.0),
        A(false, 2.0, 2.0),
        H(0.44),
        A(false, 2.0, -2.0),
        L(0.0, -0.18),
        A(true, 1.0, -1.73),
        L(0.43, -0.25),
        A(true, 2.0, 0.0),
        L(0.15, 0.08),
        A(false, 2.73, -0.73),
        L(0.22, -0.39),
        A(false, -0.73, -2.73),
        L(-0.15, -0.08),
        A(true, -1.0, -1.74),
        L(0.0, -0.5),
        A(true, 1.0, -1.74),
        L(0.15, -0.09),
        A(false, 0.73, -2.73),
        L(-0.22, -0.38),
        A(false, -2.73, -0.73),
        L(-0.15, 0.08),
        A(true, -2.0, 0.0),
        L(-0.43, -0.25),
        A(true, -1.0, -1.73),
        V(4.0),
        A(false, -2.0, -2.0),
    ];
    let mut points = vec![(12.22, 2.0)];
    for step in steps {
        let (x, y) = *points.last().expect("gear starts at a point");
        match step {
            H(dx) => points.push((x + dx, y)),
            V(y) => points.push((x, y)),
            L(dx, dy) => points.push((x + dx, y + dy)),
            A(sweep, dx, dy) => {
                points.extend(sample_gear_arc(x, y, sweep, x + dx, y + dy, 4));
            }
        }
    }
    points
}

/// One circular SVG arc with large-arc 0, equal radii, and no rotation.
/// `sample_svg_arc` keeps the sign the pin paths were tuned against.
fn sample_gear_arc(
    x1: f32,
    y1: f32,
    sweep: bool,
    x2: f32,
    y2: f32,
    steps: usize,
) -> Vec<(f32, f32)> {
    let dx = (x1 - x2) / 2.0;
    let dy = (y1 - y2) / 2.0;
    let mut radius = 2.0_f32;
    let lambda = (dx * dx + dy * dy) / (radius * radius);
    if lambda > 1.0 {
        radius *= lambda.sqrt();
    }
    let denom = radius * radius * (dx * dx + dy * dy);
    let numer =
        (radius * radius * radius * radius - radius * radius * (dx * dx + dy * dy)).max(0.0);
    // large-arc is 0, so the center sits on the opposite side of a set sweep.
    let sign = if sweep { 1.0 } else { -1.0 };
    let coef = if denom <= f32::EPSILON {
        0.0
    } else {
        sign * (numer / denom).sqrt()
    };
    let cxp = coef * dy;
    let cyp = coef * -dx;
    let cx = (x1 + x2) / 2.0 + cxp;
    let cy = (y1 + y2) / 2.0 + cyp;
    let theta1 = vector_angle(1.0, 0.0, (dx - cxp) / radius, (dy - cyp) / radius);
    let mut delta = vector_angle(
        (dx - cxp) / radius,
        (dy - cyp) / radius,
        (-dx - cxp) / radius,
        (-dy - cyp) / radius,
    );
    if !sweep && delta > 0.0 {
        delta -= std::f32::consts::TAU;
    } else if sweep && delta < 0.0 {
        delta += std::f32::consts::TAU;
    }
    (1..=steps)
        .map(|step| {
            let theta = theta1 + delta * (step as f32 / steps as f32);
            (cx + radius * theta.cos(), cy + radius * theta.sin())
        })
        .collect()
}

/// Sample one circular SVG arc (`a`/`A` with equal radii and no rotation).
fn sample_svg_arc(
    x1: f32,
    y1: f32,
    radius: f32,
    sweep: bool,
    x2: f32,
    y2: f32,
    steps: usize,
) -> Vec<(f32, f32)> {
    let dx = (x1 - x2) / 2.0;
    let dy = (y1 - y2) / 2.0;
    let mut rx = radius.abs();
    let mut ry = radius.abs();
    let lambda = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry);
    if lambda > 1.0 {
        let scale = lambda.sqrt();
        rx *= scale;
        ry *= scale;
    }
    let denom = rx * rx * dy * dy + ry * ry * dx * dx;
    let numer = (rx * rx * ry * ry - rx * rx * dy * dy - ry * ry * dx * dx).max(0.0);
    // large-arc is 0, so the center sign is negative when sweep is set.
    let sign = if sweep { -1.0 } else { 1.0 };
    let coef = if denom <= f32::EPSILON {
        0.0
    } else {
        sign * (numer / denom).sqrt()
    };
    let cxp = coef * rx * dy / ry;
    let cyp = coef * -ry * dx / rx;
    let cx = (x1 + x2) / 2.0 + cxp;
    let cy = (y1 + y2) / 2.0 + cyp;
    let theta1 = vector_angle(1.0, 0.0, (dx - cxp) / rx, (dy - cyp) / ry);
    let mut delta = vector_angle(
        (dx - cxp) / rx,
        (dy - cyp) / ry,
        (-dx - cxp) / rx,
        (-dy - cyp) / ry,
    );
    if !sweep && delta > 0.0 {
        delta -= std::f32::consts::TAU;
    } else if sweep && delta < 0.0 {
        delta += std::f32::consts::TAU;
    }
    (1..=steps)
        .map(|step| {
            let theta = theta1 + delta * (step as f32 / steps as f32);
            (cx + rx * theta.cos(), cy + ry * theta.sin())
        })
        .collect()
}

fn vector_angle(ux: f32, uy: f32, vx: f32, vy: f32) -> f32 {
    let dot = ux * vx + uy * vy;
    let len = (ux * ux + uy * uy).sqrt() * (vx * vx + vy * vy).sqrt();
    if len <= f32::EPSILON {
        return 0.0;
    }
    let mut angle = (dot / len).clamp(-1.0, 1.0).acos();
    if ux * vy - uy * vx < 0.0 {
        angle = -angle;
    }
    angle
}

pub(crate) fn draw_icon(
    painter: &egui::Painter,
    center: egui::Pos2,
    ink: egui::Color32,
    icon: Icon,
) {
    let stroke = egui::Stroke::new(1.5_f32, ink);
    match icon {
        Icon::Search => draw_search_icon(painter, center, ink, 1.0),
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
        Icon::Settings => draw_settings_icon(painter, center, ink),
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
        Icon::Pin => draw_pin_icon(painter, center, ink, false),
        Icon::PinOff => draw_pin_icon(painter, center, ink, true),
        Icon::Refresh => {
            let r = 5.0_f32;
            let mut points = Vec::new();
            for i in 0..=12 {
                let frac = i as f32 / 12.0;
                let angle = std::f32::consts::PI * (-0.7 + 1.5 * frac);
                points.push(center + egui::vec2(r * angle.cos(), r * angle.sin()));
            }
            painter.add(egui::Shape::Path(egui::epaint::PathShape::line(points, stroke)));
            let tip = center + egui::vec2(r * (-0.7 * std::f32::consts::PI).cos(), r * (-0.7 * std::f32::consts::PI).sin());
            painter.line_segment([tip, tip + egui::vec2(2.5, 0.5)], stroke);
            painter.line_segment([tip, tip + egui::vec2(-0.5, -2.5)], stroke);
        }
    }
}

/// Lucide `pin` / `pin-off` at the Electron menu size (`w-4`, 16px).
fn draw_pin_icon(painter: &egui::Painter, center: egui::Pos2, ink: egui::Color32, off: bool) {
    const SCALE: f32 = 16.0 / 24.0;
    let stroke = egui::Stroke::new(2.0 * SCALE, ink);
    let map = |points: Vec<(f32, f32)>| -> Vec<egui::Pos2> {
        points
            .into_iter()
            .map(|(x, y)| center + egui::vec2((x - 12.0) * SCALE, (y - 12.0) * SCALE))
            .collect()
    };
    let paths = if off { pin_off_paths() } else { pin_paths() };
    for (points, closed) in paths {
        let shape = if closed {
            egui::epaint::PathShape::closed_line(map(points), stroke)
        } else {
            egui::epaint::PathShape::line(map(points), stroke)
        };
        painter.add(egui::Shape::Path(shape));
    }
}

fn pin_paths() -> Vec<(Vec<(f32, f32)>, bool)> {
    let mut body = StrokePath::start(9.0, 10.76);
    body.rel_arc(2.0, true, -1.11, 1.79);
    body.rel_line(-1.78, 0.9);
    body.arc(2.0, false, 5.0, 15.24);
    body.line(5.0, 16.0);
    body.rel_arc(1.0, false, 1.0, 1.0);
    body.rel_line(12.0, 0.0);
    body.rel_arc(1.0, false, 1.0, -1.0);
    body.rel_line(0.0, -0.76);
    body.rel_arc(2.0, false, -1.11, -1.79);
    body.rel_line(-1.78, -0.9);
    body.arc(2.0, true, 15.0, 10.76);
    body.line(15.0, 7.0);
    body.rel_arc(1.0, true, 1.0, -1.0);
    body.rel_arc(2.0, false, 0.0, -4.0);
    body.line(8.0, 2.0);
    body.rel_arc(2.0, false, 0.0, 4.0);
    body.rel_arc(1.0, true, 1.0, 1.0);
    vec![
        (vec![(12.0, 17.0), (12.0, 22.0)], false),
        (body.points, true),
    ]
}

fn pin_off_paths() -> Vec<(Vec<(f32, f32)>, bool)> {
    let mut head = StrokePath::start(15.0, 9.34);
    head.line(15.0, 7.0);
    head.rel_arc(1.0, true, 1.0, -1.0);
    head.rel_arc(2.0, false, 0.0, -4.0);
    head.line(7.89, 2.0);
    let mut base = StrokePath::start(9.0, 9.0);
    base.line(9.0, 10.76);
    base.rel_arc(2.0, true, -1.11, 1.79);
    base.rel_line(-1.78, 0.9);
    base.arc(2.0, false, 5.0, 15.24);
    base.line(5.0, 16.0);
    base.rel_arc(1.0, false, 1.0, 1.0);
    base.rel_line(11.0, 0.0);
    vec![
        (vec![(12.0, 17.0), (12.0, 22.0)], false),
        (head.points, false),
        (vec![(2.0, 2.0), (22.0, 22.0)], false),
        (base.points, false),
    ]
}

struct StrokePath {
    points: Vec<(f32, f32)>,
}

impl StrokePath {
    fn start(x: f32, y: f32) -> Self {
        Self {
            points: vec![(x, y)],
        }
    }

    fn line(&mut self, x: f32, y: f32) {
        self.points.push((x, y));
    }

    fn rel_line(&mut self, dx: f32, dy: f32) {
        let (x, y) = *self.points.last().expect("path has a point");
        self.line(x + dx, y + dy);
    }

    fn arc(&mut self, radius: f32, sweep: bool, x: f32, y: f32) {
        let (x1, y1) = *self.points.last().expect("path has a point");
        self.points
            .extend(sample_svg_arc(x1, y1, radius, sweep, x, y, 6));
    }

    fn rel_arc(&mut self, radius: f32, sweep: bool, dx: f32, dy: f32) {
        let (x, y) = *self.points.last().expect("path has a point");
        self.arc(radius, sweep, x + dx, y + dy);
    }
}

pub(crate) fn show_html(
    ui: &mut egui::Ui,
    html: &str,
    size: f32,
    text: egui::Color32,
    muted: egui::Color32,
    link: egui::Color32,
) {
    let formatted = graphe_domain::dict::format_definition(html);
    render_definition(ui, formatted.trim(), size, text, muted, link);
}

/// Pill for a related Strong's number. Electron uses `.dict-cognate-tag`.
pub(crate) fn cognate_chip(
    ui: &mut egui::Ui,
    label: &str,
    text_hex: &str,
    fill_hex: &str,
) -> egui::Response {
    let ink = color(text_hex);
    let galley =
        ui.painter()
            .layout_no_wrap(label.to_string(), egui::FontId::proportional(11.0), ink);
    let width = galley.rect.width() + 16.0;
    let height = (galley.rect.height() + 4.0).max(18.0);
    let (rect, response) = ui.allocate_exact_size(egui::vec2(width, height), egui::Sense::click());
    let alpha = if response.hovered() { 64 } else { 32 };
    ui.painter().rect_filled(
        rect,
        egui::CornerRadius::same((height / 2.0).ceil() as u8),
        color_alpha(fill_hex, alpha),
    );
    ui.painter().galley(
        egui::pos2(
            rect.center().x - galley.rect.width() / 2.0,
            rect.center().y - galley.rect.height() / 2.0,
        ),
        galley,
        ink,
    );
    if response.hovered() {
        ui.ctx().set_cursor_icon(egui::CursorIcon::PointingHand);
    }
    response
}

fn render_definition(
    ui: &mut egui::Ui,
    html: &str,
    size: f32,
    text: egui::Color32,
    muted: egui::Color32,
    link: egui::Color32,
) {
    let mut rest = html;
    while !rest.is_empty() {
        rest = rest.trim_start();
        if rest.is_empty() {
            break;
        }
        if rest.starts_with("<div") {
            if let Some((inner, after)) = element_inner(rest, "div") {
                render_inline_block(ui, inner, 12.0, muted, link, 0.0);
                ui.add_space(8.0);
                rest = after;
                continue;
            }
        }
        if rest.starts_with("<ol") {
            if let Some((inner, after)) = element_inner(rest, "ol") {
                render_items(ui, inner, 0, size, text, link);
                rest = after;
                continue;
            }
        }
        render_inline_block(ui, rest, size, text, link, 0.0);
        break;
    }
}

fn render_items(
    ui: &mut egui::Ui,
    html: &str,
    depth: u8,
    size: f32,
    text: egui::Color32,
    link: egui::Color32,
) {
    let mut rest = html;
    while let Some((inner, after)) = next_element(rest, "li") {
        let (head, nested) = split_before_tag(inner, "<ol");
        if !head.trim().is_empty() {
            ui.add_space(if depth == 0 { 6.0 } else { 4.0 });
            render_inline_block(ui, head, size, text, link, depth as f32 * 16.0);
        }
        let mut nested = nested;
        while let Some(start) = nested.find("<ol") {
            nested = &nested[start..];
            let Some((ol_inner, after_ol)) = element_inner(nested, "ol") else {
                break;
            };
            render_items(ui, ol_inner, depth + 1, size, text, link);
            nested = after_ol;
        }
        rest = after;
    }
}

fn render_inline_block(
    ui: &mut egui::Ui,
    html: &str,
    size: f32,
    text: egui::Color32,
    link: egui::Color32,
    indent: f32,
) {
    let label = definition_label(html);
    #[cfg(not(test))]
    let _ = &label;
    ui.horizontal(|ui| {
        ui.spacing_mut().item_spacing.x = 0.0;
        if indent > 0.0 {
            ui.add_space(indent);
        }
        let width = ui.available_width();
        ui.vertical(|ui| {
            ui.set_width(width);
            let mut job = egui::text::LayoutJob::default();
            job.wrap.max_width = width;
            push_inline_html(&mut job, html, size, text, link);
            let response = ui.label(job);
            #[cfg(test)]
            if let Some(label) = &label {
                crate::chrome::mark_layout(ui, &format!("dict-item:{label}"), response.rect);
            }
            #[cfg(not(test))]
            let _ = response;
        });
    });
}

fn definition_label(html: &str) -> Option<String> {
    let marker = "dict-def-label\">";
    let start = html.find(marker)? + marker.len();
    let end = html[start..].find('<')? + start;
    let label = html[start..end].trim();
    if label.is_empty() {
        None
    } else {
        Some(label.to_string())
    }
}

fn push_inline_html(
    job: &mut egui::text::LayoutJob,
    html: &str,
    size: f32,
    text: egui::Color32,
    link: egui::Color32,
) {
    let mut rest = html;
    let mut italic = false;
    let mut label = false;
    let mut anchor = false;
    while let Some(start) = rest.find('<') {
        push_html_text(
            job,
            &decode_entities(&rest[..start]),
            if label { 11.0 } else { size },
            if label || anchor { link } else { text },
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
            "i" | "em" => italic = !closing,
            "span" => {
                if !closing && tag.contains("dict-def-label") {
                    label = true;
                } else if closing {
                    label = false;
                }
            }
            "a" => anchor = !closing,
            _ => {}
        }
    }
    push_html_text(
        job,
        &decode_entities(rest),
        if label { 11.0 } else { size },
        if label || anchor { link } else { text },
        italic,
    );
}

fn next_element<'a>(html: &'a str, name: &str) -> Option<(&'a str, &'a str)> {
    let open = format!("<{name}");
    let Some(start) = html.find(&open) else {
        return None;
    };
    let boundary = html.as_bytes().get(start + open.len()).copied();
    if !matches!(boundary, Some(b'>' | b' ' | b'/')) {
        return None;
    }
    element_inner(&html[start..], name).map(|(inner, after)| (inner, after))
}

fn element_inner<'a>(html: &'a str, name: &str) -> Option<(&'a str, &'a str)> {
    let open = format!("<{name}");
    if !html.starts_with(&open) {
        return None;
    }
    let boundary = html.as_bytes().get(open.len()).copied();
    if !matches!(boundary, Some(b'>' | b' ' | b'/')) {
        return None;
    }
    let gt = html.find('>')?;
    if html[..gt].ends_with('/') {
        return Some(("", &html[gt + 1..]));
    }
    let close = format!("</{name}>");
    let mut depth = 1i32;
    let mut index = gt + 1;
    while depth > 0 {
        let next_open = find_open(&html[index..], &open).map(|at| index + at);
        let next_close = html[index..].find(&close).map(|at| index + at);
        match (next_open, next_close) {
            (Some(open_at), Some(close_at)) if open_at < close_at => {
                depth += 1;
                index = open_at + open.len();
            }
            (_, Some(close_at)) => {
                depth -= 1;
                if depth == 0 {
                    return Some((&html[gt + 1..close_at], &html[close_at + close.len()..]));
                }
                index = close_at + close.len();
            }
            _ => return None,
        }
    }
    None
}

fn find_open(html: &str, open: &str) -> Option<usize> {
    let mut from = 0usize;
    while let Some(at) = html[from..].find(open) {
        let start = from + at;
        let boundary = html.as_bytes().get(start + open.len()).copied();
        if matches!(boundary, Some(b'>' | b' ' | b'/')) {
            return Some(start);
        }
        from = start + open.len();
    }
    None
}

fn split_before_tag<'a>(html: &'a str, tag: &str) -> (&'a str, &'a str) {
    match html.find(tag) {
        Some(at) => (&html[..at], &html[at..]),
        None => (html, ""),
    }
}

fn push_html_text(
    job: &mut egui::text::LayoutJob,
    text: &str,
    size: f32,
    color: egui::Color32,
    italic: bool,
) {
    if text.is_empty() {
        return;
    }
    let shown = graphe_domain::bidi::display_text(text);
    job.append(
        shown.as_ref(),
        0.0,
        egui::TextFormat {
            font_id: egui::FontId::proportional(size),
            color,
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
    fn dictionary_senses_indent_like_the_electron_outline() {
        let ctx = egui::Context::default();
        let mut raw = egui::RawInput::default();
        raw.screen_rect = Some(egui::Rect::from_min_size(
            egui::Pos2::ZERO,
            egui::vec2(280.0, 600.0),
        ));
        let output = ctx.run(raw, |ctx| {
            egui::CentralPanel::default().show(ctx, |ui| {
                show_html(
                    ui,
                    "biyn uma raiz 1 discernir 1a qal 1a1 perceber 2 ditat",
                    13.0,
                    color("#362f27"),
                    color("#65543f"),
                    color("#65543f"),
                );
            });
        });
        let _ = output;
        let marks = ctx.data(|data| {
            data.get_temp::<Vec<(String, [f32; 4])>>(egui::Id::new("pane-layout-marks"))
                .unwrap_or_default()
        });
        let top = mark_x(&marks, "dict-item:1");
        let mid = mark_x(&marks, "dict-item:1a");
        let deep = mark_x(&marks, "dict-item:1a1");
        assert!(
            (mid - top - 16.0).abs() < 1.0,
            "1a is one step in from 1: {top} {mid}"
        );
        assert!(
            (deep - mid - 16.0).abs() < 1.0,
            "1a1 is one step in from 1a: {mid} {deep}"
        );
    }

    fn mark_x(marks: &[(String, [f32; 4])], key: &str) -> f32 {
        marks
            .iter()
            .find(|(name, _)| name == key)
            .map(|(_, rect)| rect[0])
            .unwrap_or_else(|| panic!("missing {key} in {marks:?}"))
    }

    #[test]
    fn proportional_font_covers_hebrew_points_and_greek() {
        let ctx = egui::Context::default();
        let mut raw = egui::RawInput::default();
        raw.screen_rect = Some(egui::Rect::from_min_size(
            egui::Pos2::ZERO,
            egui::vec2(800.0, 600.0),
        ));
        let _ = ctx.run(raw.clone(), |ctx| apply(ctx, false, 16.0));
        // New font definitions load at the start of the next pass.
        let _ = ctx.run(raw, |_| {});
        let id = egui::FontId::proportional(16.0);
        ctx.fonts_mut(|fonts| {
            for ch in ['א', 'ֱ', 'ֹ', 'ִ', 'ם', 'λ', 'ἀ', 'ĕ'] {
                assert!(
                    fonts.has_glyph(&id, ch),
                    "missing {ch} U+{:04X}",
                    u32::from(ch)
                );
            }
        });
    }

    #[test]
    fn pin_icon_is_a_thumbtack() {
        let body = pin_paths()
            .into_iter()
            .find(|(_, closed)| *closed)
            .map(|(points, _)| points)
            .expect("the pin body is a closed thumbtack");
        let min_y = body.iter().map(|point| point.1).fold(f32::MAX, f32::min);
        let max_y = body.iter().map(|point| point.1).fold(f32::MIN, f32::max);
        let head: Vec<_> = body.iter().filter(|point| point.1 < 3.0).collect();
        let head_width = head.iter().map(|point| point.0).fold(f32::MIN, f32::max)
            - head.iter().map(|point| point.0).fold(f32::MAX, f32::min);
        assert!(
            min_y < 3.0 && max_y > 16.0 && head_width > 6.0,
            "the pin has a wide head and a base, not a circle on a stick: y {min_y}..{max_y} head {head_width}"
        );
    }

    #[test]
    fn settings_icon_is_the_lucide_gear() {
        let points = settings_gear_points();
        let first = points[0];
        let last = *points.last().expect("gear");
        assert!(
            (first.0 - last.0).abs() < 0.08 && (first.1 - last.1).abs() < 0.08,
            "the gear outline closes: start {first:?} end {last:?}"
        );
        let crown: Vec<_> = points
            .iter()
            .filter(|point| (point.1 - 2.0).abs() < 0.05)
            .collect();
        let crown_x = crown.iter().map(|point| point.0).fold(f32::MIN, f32::max)
            - crown.iter().map(|point| point.0).fold(f32::MAX, f32::min);
        assert!(
            crown.len() >= 2 && crown_x > 0.3 && crown_x < 1.2,
            "the top tooth is a short flat crown, not a petal: {crown:?}"
        );
        let radius = |point: (f32, f32)| {
            let dx = point.0 - 12.0;
            let dy = point.1 - 12.0;
            (dx * dx + dy * dy).sqrt()
        };
        let mut teeth = Vec::new();
        let mut notches = Vec::new();
        let count = points.len();
        for index in 0..count {
            let previous = radius(points[(index + count - 1) % count]);
            let current = radius(points[index]);
            let next = radius(points[(index + 1) % count]);
            if current >= previous && current > next && current > 9.2 {
                teeth.push(current);
            }
            if current <= previous && current < next && current < 8.0 {
                notches.push(current);
            }
        }
        assert!(
            teeth.len() == 6 && notches.len() >= 6,
            "the cog has six teeth and a notch between each, not a flower: teeth {teeth:?} notches {notches:?}"
        );
    }

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
