# Headless Visual & UI Testing in Graphe (egui)

This reference documents how to write headless visual and layout tests for the Graphe Bible study desktop application.

Graphe runs on `egui` and `eframe`. Rather than relying only on manual clicking or full system GUI automation, Graphe has a built-in headless testing harness that executes full egui frames in memory and asserts on geometry, layout marks, rendered text galleys, shapes, and theme colors.

---

## 1. Core Testing Harness Architecture

### Frame Execution Helper

Tests instantiate `egui::Context::default()`, configure `egui::RawInput` with virtual screen dimensions, and execute frame passes:

```rust
use crate::app::tests::bare;
use crate::session::Session;

let ctx = egui::Context::default();
let mut app = bare(Session::new());

// Set screen size (e.g., 1200x800 desktop viewport)
let mut raw = egui::RawInput::default();
raw.screen_rect = Some(egui::Rect::from_min_size(
    egui::Pos2::ZERO,
    egui::vec2(1200.0, 800.0),
));

// Disable animation delay for deterministic test runs
let mut style = (*ctx.style()).clone();
style.animation_time = 0.0;
ctx.set_style(style);

// Run the frame
let output = ctx.run(raw, |ctx| {
    app.update_workbench(ctx); // or app.dialogs(ctx), app.editor(ctx, palette), etc.
});
```

---

## 2. Layout Marks (`mark_layout` and `pane-layout-marks`)

Graphe instruments key UI widgets with layout marks during test builds (`#[cfg(test)]`).

### Instrumenting Code (`crates/graphe/src/chrome.rs`)
```rust
#[cfg(test)]
pub(crate) fn mark_layout(ui: &egui::Ui, key: &str, rect: egui::Rect) {
    ui.ctx().data_mut(|data| {
        let id = egui::Id::new("pane-layout-marks");
        let mut marks = data
            .get_temp::<Vec<(String, [f32; 4])>>(id)
            .unwrap_or_default();
        marks.push((
            key.to_string(),
            [rect.min.x, rect.min.y, rect.width(), rect.height()],
        ));
        data.insert_temp(id, marks);
    });
}
```

### Asserting on Layout Marks in Tests
Retrieve the marked bounding boxes and assert on positions, widths, heights, or spacing:

```rust
fn mark<'a>(marks: &'a [(String, [f32; 4])], key: &str) -> &'a [f32; 4] {
    marks
        .iter()
        .find(|(name, _)| name == key)
        .map(|(_, rect)| rect)
        .unwrap_or_else(|| panic!("expected layout mark '{key}', found {marks:?}"))
}

// Example assertions:
let card = mark(&marks, "about-card");
let logo = mark(&marks, "about-logo");

assert!(card[2] > 400.0, "card width must accommodate content");
assert!(logo[1] >= card[1], "logo must be inside the card bounds");
```

---

## 3. Visual Inspections

### A. Checking Rendered Text Galleys (`galley_has`)
Verify that specific text was actually laid out and rendered into text shapes:

```rust
fn galley_has(output: &egui::FullOutput, needle: &str) -> bool {
    fn walk(shape: &egui::Shape, needle: &str) -> bool {
        match shape {
            egui::Shape::Text(text) => text.galley.job.text.contains(needle),
            egui::Shape::Vec(shapes) => shapes.iter().any(|shape| walk(shape, needle)),
            _ => false,
        }
    }
    output.shapes.iter().any(|clipped| walk(&clipped.shape, needle))
}

// Assertion:
assert!(galley_has(&output, "Genesis 1:1"));
```

### B. Checking Palette Shapes and Backgrounds (`shape_has_paper`)
Verify that panels and cards paint the correct theme color and dimensions:

```rust
fn shape_has_paper(shape: &egui::Shape, paper: egui::Color32) -> bool {
    match shape {
        egui::Shape::Rect(rect) => {
            rect.fill == paper && (rect.rect.width() - 520.0).abs() < 8.0
        }
        egui::Shape::Vec(shapes) => shapes.iter().any(|s| shape_has_paper(s, paper)),
        _ => false,
    }
}
```

---

## 4. Simulating User Interactions

### A. Mouse Clicks on UI Components
Compute the center of a widget's rect and send a pointer click event:

```rust
fn center_of(rect: &[f32; 4]) -> egui::Pos2 {
    egui::pos2(rect[0] + rect[2] * 0.5, rect[1] + rect[3] * 0.5)
}

// 1. Move pointer to widget
let mut raw = egui::RawInput::default();
let target = center_of(mark(&marks, "settings-theme-toggle"));
raw.events.push(egui::Event::PointerMoved(target));
ctx.run(raw, |ctx| app.dialogs(ctx));

// 2. Click pointer
let mut raw = egui::RawInput::default();
raw.events.push(egui::Event::PointerButton {
    pos: target,
    button: egui::PointerButton::Primary,
    pressed: true,
    modifiers: egui::Modifiers::default(),
});
raw.events.push(egui::Event::PointerButton {
    pos: target,
    button: egui::PointerButton::Primary,
    pressed: false,
    modifiers: egui::Modifiers::default(),
});
ctx.run(raw, |ctx| app.dialogs(ctx));
```

### B. Keyboard Shortcuts and Text Input
Send key events or text modifications:

```rust
let mut raw = egui::RawInput::default();
raw.events.push(egui::Event::Key {
    key: egui::Key::Escape,
    physical_key: None,
    pressed: true,
    repeat: false,
    modifiers: egui::Modifiers::default(),
});
ctx.run(raw, |ctx| app.dialogs(ctx));
```

---

## 5. Verse Scroll and Viewport Position Verification

When testing verse navigation, scroll position, and reference clicks (such as in Issue #17):

1. **Test state restoration and offset computation**:
   Verify `panes::scroll::tests` in `graphe-domain`.
2. **Test reading cache layout**:
   Verify row heights, prefix sums, and visible rows in `crates/graphe/src/study.rs`.
3. **Verify scroll offset in app tests**:
   Assert that clicking a reference link or search hit sets `target_scroll` or adjusts `reading.scroll_offset` appropriately without jumping other panes.

---

## 6. Capturing Visual Screenshots (Before & After Evidence)

Pull requests for visual changes must include before (reproduction) and after (fixed) screenshots:

### Before Screenshot (Bug Reproduction)
1. Run the application before applying code edits:
   ```bash
   cargo run -p graphe
   ```
2. Capture the window in its bugged state:
   - Linux / Git Bash / macOS:
     ```bash
     bash .agents/skills/implement-issue/scripts/capture_screenshot.sh -o temp/screenshots/<N>-before.png
     ```
   - Windows PowerShell:
     ```powershell
     powershell -File .agents/skills/implement-issue/scripts/capture_screenshot.ps1 -OutputPath temp/screenshots/<N>-before.png
     ```

### After Screenshot (Feature Working)
1. Run the application with the fix applied:
   ```bash
   cargo run -p graphe
   ```
2. Navigate to verify the feature and capture the clean state:
   - Linux / Git Bash / macOS:
     ```bash
     bash .agents/skills/implement-issue/scripts/capture_screenshot.sh -o temp/screenshots/<N>-after.png
     ```
   - Windows PowerShell:
     ```powershell
     powershell -File .agents/skills/implement-issue/scripts/capture_screenshot.ps1 -OutputPath temp/screenshots/<N>-after.png
     ```

### Inclusion in PR
Screenshots remain in the gitignored `temp/screenshots/` folder. **Do not commit images into git**.
Attach them directly when creating the pull request via GitHub CLI:
```bash
gh pr create --base main --title "[#<N>] - <title>" --body-file temp_pr_body.md \
  --attach "temp/screenshots/<N>-before.png#Bug Reproduction" \
  --attach "temp/screenshots/<N>-after.png#Feature Working"
```
GitHub CLI uploads the images to GitHub user attachments and automatically rewrites the markdown links in the PR body.

