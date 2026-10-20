# Update Banner & UI Test Notes

## Update plumbing

- `crates/graphe/src/update.rs`: `fetch_newer_version()` compares `CARGO_PKG_VERSION` against the latest GitHub tag.
- `crates/graphe/src/app.rs` `pump_update()`: checks once per launch, stores the notice in memory only.
- `crates/graphe/src/chrome.rs` `update_banner()`: 28 px `Panel::top`, vertically centered row, layout marks `update-label`, `update-download`, `update-close`.
- Dismiss (`×`) hides the banner until restart on purpose. There is no `state.json` key and no "skip this version". Do not add persistence without a new decision.

## egui 0.37 `Button` theming rule

`egui::Button` (atoms system) resolves its look through the widget theme, **not** `visuals.widgets` directly:

- Face fill comes from `weak_bg_fill`, **not** `bg_fill`.
- Text color comes from `fg_stroke.color`. A `RichText` color passed to `Button::new` is dropped (`layout.text()` keeps a plain `String`).
- `.fill(color)` on the widget fixes one fill for all states ("overrides any on-hover effects").

So a scoped button style must set `weak_bg_fill` + `fg_stroke` per state (`inactive`/`hovered`/`active`), with `expansion = 0.0` to keep the rect stable. The banner download button does this in `style_update_download_button`, pinned by `update_download_button_style_only_lifts_fill_on_hover`. Rect-only layout tests cannot catch paint regressions like a white button face; assert the resolved style values.

## kittest render lock

`crates/graphe/src/kit.rs` drives the workbench through `egui_kittest` and snapshots via wgpu. Each `render()` builds its own instance/device, but creating and driving those from several test threads at once crashes the process (`STATUS_ACCESS_VIOLATION`). All snapshot calls go through `render_locked()`, which serializes only the GPU section on a process-wide mutex. Everything else stays parallel; do not replace the lock with `--test-threads=1`.

## Previewing UI changes locally

The banner only appears when a newer release exists, so force it with a temporary local hack (never commit it):

1. Close **every** Graphe window first. The installed release shows identical banner text with old code and is easy to confuse with the dev build.
2. Rebuild, then run the binary with stdout to a log file (a piped `tail` buffers until exit and hides live output).
3. `taskkill` the running preview before rebuilding, or linking fails with `Access denied` (locked exe).
