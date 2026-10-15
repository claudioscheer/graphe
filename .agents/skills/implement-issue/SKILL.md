---
name: implement-issue
description: >
  End-to-end GitHub issue implementation for the Graphe Bible study desktop app
  (Rust + egui): issue intake and comment analysis, idiomatic Rust implementation
  respecting crate boundaries, unit tests, headless and visual egui UI verification,
  before/after screenshot capture (bug reproduction and feature working) embedded in
  the PR, desktop build and smoke checks, clean commits adhering to AGENTS.md, PR creation
  with ASD-STE100 descriptions, CI monitoring, and merging into main with workspace
  cleanup. Use when asked to implement, fix, or ship a GitHub issue in Graphe.
---

# Implement Issue (Graphe Desktop App)

Self-contained end-to-end workflow for the Graphe Bible study desktop app:
**Issue URL / #N → Reproduce & Screenshot Before → Fix → Test & Screenshot After → PR → Green CI → Merge & Cleanup**.

The user provides a GitHub issue. Execute the complete cycle without stopping for intermediate prompts unless blocked by a missing architectural decision or external dependency.

Every user-facing or visual pull request **must include visual screenshot evidence**:
1. A screenshot reproducing the bug (before fix).
2. A screenshot of the feature working (after fix).

---

## Architectural Invariants & Rust Standards

Always follow the architecture documented in [`AGENTS.md`](file:///C:/Users/water/Projects/graphe/AGENTS.md):

| Crate | Role | Strict Boundaries |
| ----- | ---- | ----------------- |
| `graphe-domain` | Pure business rules: book numbers, refs, i18n, panes, navigation, search parsing, morphology, coverage, dictionary formatting. | **Zero** filesystem, SQLite, or egui dependencies. |
| `graphe-store` | Data storage: SQLite MyBible, theWord/MySword conversion, `~/.graphe/modules`, state persistence. | SQLite queries, typed row structs, file converters. **Zero** egui dependencies. |
| `graphe` | Desktop workbench (egui / eframe): draws UI, delegates actions to domain and store. | **Never duplicate domain rules or storage logic** in window code. Call domain/store functions. |

### Rust Idioms Bar
- **Edition 2021**: No `unsafe` code unless forced by an external dependency.
- **No panics on user data**: Never use `.unwrap()` on paths that parse Bible files, user settings, or SQLite data. Return `Result` or a fallback value that the UI can present gracefully.
- **Typed SQLite rows**: Always map query results into dedicated structs. Do not index untyped columns.
- **Single source of truth**: Book tables live exclusively in `graphe_domain::books`. Never duplicate canon lists.
- **Bible hrefs**: Always parse via `bible_ref::parse_bible_href`. Typed refs go through `NavigationSession::submit_input`.
- **Palette and visual geometry**:
  - Light `--ui-bg` `#fefdf9`, Dark `#181818` (defined in `graphe_domain::theme`).
  - Corner radii: strictly 2, 4, and 6 px. Only pill marks may be fully round.
  - UI languages: Portuguese, English, Spanish (`graphe_domain::i18n`). Language change never mutates Bible modules.

---

## Phase 0 — Intake & Issue Context

1. Parse the issue number or URL:
   ```bash
   gh issue view <N> --json number,title,body,labels,assignees,state,url,comments
   ```
2. **Inspect comments**: Always read issue comments. Comments often contain vital reproduction steps, screenshots, or user clarification.
3. Categorize the change:
   - `Domain`: purely business rules, refs, parser, morphology, or math.
   - `Store`: SQLite queries, module parsing, schema, or conversion.
   - `UI / Visual`: egui workbench layout, verse scrolling, panes, dialogs, palette, or themes.
   - `Full-stack`: touches domain/store and renders through egui.
4. Restate in chat (concise ASD-STE100):
   - Problem and symptoms
   - Affected crate(s)
   - Scope and acceptance criteria
   - Visual / UI impact (if UI is touched)

---

## Phase 1 — Board & PR Hygiene

1. Assign the issue to `claudioscheer`:
   ```bash
   gh issue edit <N> --add-assignee claudioscheer
   ```
2. Check for existing PRs tied to the issue:
   ```bash
   gh pr list --state all --search "<N> in:title,body" --json number,title,state,url,headRefName
   ```
   - If an open PR exists: check out its branch and reuse it. Do not create a duplicate competing PR.
   - If a closed (unmerged) PR exists: reopen it (`gh pr reopen <N>`) and continue on its branch.
   - If none: create a new branch from `main` (`git checkout -b fix/<n>-<short-slug>` or `feat/<n>-<short-slug>`).

---

## Phase 2 — Research, Root-Cause Reproduction & Before Screenshot

1. Trace execution path from entry to presentation:
   - Bible navigation / references: `bible_ref`, `NavigationSession`, `session.rs`.
   - Study view & scroll offsets: `crates/graphe/src/study.rs`, `ReadingCache`, row layout.
   - Dialogs & modals: `crates/graphe/src/dialogs.rs`.
   - Sidebar panels: `crates/graphe/src/side.rs`.
   - Application shell: `crates/graphe/src/app.rs`, `crates/graphe/src/chrome.rs`.
2. Pinpoint root cause before modifying code.
3. **Capture Bug Reproduction Screenshot (Mandatory)**:
   - Run the application or test harness to reproduce the bug:
     ```bash
     cargo run -p graphe
     ```
   - While the app exhibits the defect, capture the window screenshot using the helper script:
     ```bash
     powershell -File .agents/skills/implement-issue/scripts/capture_screenshot.ps1 -OutputPath assets/screenshots/<N>-before.png
     ```
   - Verify that `assets/screenshots/<N>-before.png` clearly displays the reported bug.
4. Outline a minimal plan in chat.

---

## Phase 3 — Solid Rust Implementation

1. Keep edits minimal, self-contained, and focused on the issue.
2. Maintain crate separation:
   - Logic belongs in `graphe-domain`.
   - SQLite / filesystem queries belong in `graphe-store`.
   - egui widgets and event handling belong in `graphe`.
3. Preserve all existing comments and documentation.
4. Avoid drive-by refactorings.

---

## Phase 4 — Testing, Visual Verification & After Screenshot (Mandatory)

Desktop applications require both algorithmic correctness and visual reliability. Execute all applicable levels:

### 4.1 Unit Tests (Crate-level)
- Write unit tests next to source in `#[cfg(test)] mod tests`.
- Bug fixes must include a regression test that fails without the fix.
- Run focused tests:
  ```bash
  cargo test -p graphe-domain <test_name>
  cargo test -p graphe-store <test_name>
  cargo test -p graphe <test_name>
  ```

### 4.2 Headless egui Visual & Layout Verification
When any UI, visual layout, dialog, or scroll behavior is touched, write or run headless egui frame tests. See [`references/egui-visual-testing.md`](file:///C:/Users/water/Projects/graphe/.agents/skills/implement-issue/references/egui-visual-testing.md) for full harness details:

- **Instantiate headless app**: Use `tests::bare(Session::from_state(...))` in `crates/graphe/src/app.rs`.
- **Execute frame passes**: Run `ctx.run(raw_input, |ctx| ...)` with virtual desktop dimensions (e.g., 1200x800).
- **Inspect Layout Marks**: Check bounding boxes recorded via `mark_layout(ui, key, rect)` and stored in `pane-layout-marks`.
- **Verify Text Galleys**: Use `galley_has(&output, "expected text")` to confirm rendered text shapes.
- **Verify Paper & Colors**: Use `shape_has_paper(&shape, palette_color)` to verify backgrounds and card borders.
- **Simulate User Events**: Send `egui::Event::PointerMoved`, `egui::Event::PointerButton`, or keyboard shortcuts to verify interaction transitions.
- **Scroll & Viewport Verification**: Ensure verse clicks or navigation commands set the correct `target_scroll` and do not disturb sibling panes.

### 4.3 Desktop Build & Smoke Check
- Validate workspace compilation:
  ```bash
  cargo check --workspace
  ```
- Verify startup model matches binary launch:
  ```bash
  cargo test -p graphe startup::tests
  ```

### 4.4 Capture Feature Working Screenshot (Mandatory)
- Run the desktop app with the fix applied:
  ```bash
  cargo run -p graphe
  ```
- Navigate to the affected view, trigger the feature or navigation path, and capture the window screenshot:
  ```bash
  powershell -File .agents/skills/implement-issue/scripts/capture_screenshot.ps1 -OutputPath assets/screenshots/<N>-after.png
  ```
- Verify that `assets/screenshots/<N>-after.png` clearly displays the feature working cleanly.

### 4.5 Full Workspace Regression Suite & Lint
- Run the full workspace test suite:
  ```bash
  cargo test
  ```
  All tests (118 domain, 30 store, 84 graphe) must pass.
- Run Clippy for idiom enforcement:
  ```bash
  cargo clippy --workspace --all-targets
  ```

---

## Phase 5 — Branch & Commit

1. Stage source files AND both visual screenshots:
   ```bash
   git add <code-files> assets/screenshots/<N>-before.png assets/screenshots/<N>-after.png
   ```
2. Commit rules from [`AGENTS.md`](file:///C:/Users/water/Projects/graphe/AGENTS.md):
   - Complete sentence explaining why the change exists.
   - **No AI attribution or co-author trailers**.
   - Example:
     ```text
     git commit -m "Fix verse scroll alignment when clicking commentary references."
     ```

---

## Phase 6 — Push & Open Ready-for-Review PR with Screenshots

1. Push branch to origin:
   ```bash
   git push -u origin HEAD
   ```
2. Format PR Title:
   `[#<N>] - <Short Description>`
3. Format PR Body in ASD-STE100 (matching `.github/pull_request_template.md` and `write-from-library` guidelines):
   - First sentence states problem, fix, or result.
   - One idea per sentence. 25 words or fewer per sentence.
   - Active voice. One verb per action. Keep articles.
   - Include `Closes #<N>`.
   - Complete the template checklist (`cargo test`, UI change verified).
   - **Embed the Before & After screenshot table in `## Notes`**:

```markdown
## Summary

<1-2 sentences in ASD-STE100 describing the change and user outcome.>

## Related issues

Closes #<N>

## Type of change

- [x] Bug fix
- [ ] New feature
- [ ] Refactor
- [ ] Packaging / CI / docs

## Testing

- [x] `cargo test`
- [x] UI change verified in `cargo run -p graphe`

## Notes

### Visual Verification

| Bug Reproduction (Before) | Feature Working (After) |
| :---: | :---: |
| ![Bug Reproduction](https://raw.githubusercontent.com/claudioscheer/graphe/<branch>/assets/screenshots/<N>-before.png) | ![Feature Working](https://raw.githubusercontent.com/claudioscheer/graphe/<branch>/assets/screenshots/<N>-after.png) |
```

4. Create the PR:
   ```bash
   gh pr create --base main --title "[#<N>] - <title>" --body "..."
   ```
5. Assign to `claudioscheer`:
   ```bash
   gh pr edit <PR> --add-assignee claudioscheer
   ```

---

## Phase 7 — Monitor CI Checks

1. Watch remote GitHub Actions:
   ```bash
   gh pr checks <PR> --watch
   ```
2. If checks fail:
   - View failure logs: `gh run view --log-failed`.
   - Fix the issue locally.
   - Re-run local tests (`cargo test`).
   - Commit and push fix.
   - Re-watch CI checks until all green.

---

## Phase 8 — Merge PR & Workspace Cleanup

Once all CI checks pass:

1. Merge the PR and delete the remote branch:
   ```bash
   gh pr merge <PR> --merge --delete-branch
   ```
2. Clean up local workspace:
   ```bash
   git checkout main
   git pull
   git branch -d <branch-name>
   git status
   ```

---

## Phase 9 — Final Report

Report outcome concisely in ASD-STE100:
1. Issue number and link
2. Rust implementation and crate summary
3. Unit and visual test results
4. Confirmation of both before and after screenshots embedded in the PR
5. PR URL and merge confirmation
6. Confirmation that local workspace is on clean `main`
