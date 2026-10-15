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
2. **Inspect comments and user attachments**:
   - Always read issue comments. Comments often contain reproduction steps or clarifications.
   - **Download User Attachment First**: If the issue description or comments contain user-uploaded bug screenshots (e.g., `https://github.com/user-attachments/assets/<uuid>`), download the authentic image directly:
     - Linux / Git Bash / macOS:
       ```bash
       curl.exe -sL "<attachment_url>" -o assets/screenshots/<N>-before.png
       ```
     - Windows PowerShell:
       ```powershell
       Invoke-WebRequest -Uri "<attachment_url>" -OutFile "assets/screenshots/<N>-before.png"
       ```
     *Benefit*: Captures the exact defect reported by the user, avoids synthetic display simulation errors, and works reliably in headless or remote environments.
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
   gh issue edit <N> --add-assignee claudioscheer || true
   ```
2. Check for existing PRs tied to the issue:
   ```bash
   gh pr list --state all --search "<N> in:title,body" --json number,title,state,url,headRefName
   ```
   - If an open PR exists: check out its branch and reuse it. Do not create a duplicate competing PR.
   - If a closed (unmerged) PR exists: reopen it (`gh pr reopen <N>`) and continue on its branch.
   - If none: create a new branch from fresh `main`:
     ```bash
     git checkout main
     git pull origin main
     git checkout -b fix/<n>-<short-slug>
     ```

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
   - If authentic user reproduction image was already downloaded in Phase 0, verify it at `assets/screenshots/<N>-before.png`.
   - Otherwise, run the application to reproduce the defect and capture via script:
     - **Linux / Git Bash / macOS**:
       ```bash
       bash .agents/skills/implement-issue/scripts/capture_screenshot.sh -o assets/screenshots/<N>-before.png
       ```
     - **Windows PowerShell**:
       ```powershell
       powershell -File .agents/skills/implement-issue/scripts/capture_screenshot.ps1 -OutputPath assets/screenshots/<N>-before.png
       ```
   - *Technical note*:
     - On Windows, `capture_screenshot.ps1` enumerates top-level visible windows (`FindMainWindow`) to bypass winit's 6x6 hidden helper window, uses `CopyFromScreen` for GPU swapchain capture, and falls back to `PrintWindow`.
     - On Linux, `capture_screenshot.sh` handles Wayland (`grim` / `gnome-screenshot`) and X11 (`maim` / `import` / `scrot`) with `xdotool` window focus.
     - Under Git Bash on Windows, `capture_screenshot.sh` automatically bridges paths via `cygpath -w` to the PowerShell script.
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
When any UI layout, card height, verse clipping, dialog, or scroll behavior is touched, write or run headless egui frame tests. See [`references/egui-visual-testing.md`](file:///C:/Users/water/Projects/graphe/.agents/skills/implement-issue/references/egui-visual-testing.md) for full harness details:

- **Instantiate headless app**: Use `tests::bare(Session::from_state(...))` in `crates/graphe/src/app.rs`.
- **Execute frame passes**: Run `ctx.run(raw_input, |ctx| ...)` with virtual desktop dimensions (e.g., 1200x800).
- **Inspect Layout Marks**: Check bounding boxes recorded via `mark_layout(ui, key, rect)` and stored in `pane-layout-marks`.
- **Verify Text Galleys**: Use `galley_has(&output, "expected text")` to confirm rendered text shapes.
- **Verify Paper & Colors**: Use `shape_has_paper(&shape, palette_color)` to verify backgrounds and card borders.
- **Simulate User Events**: Send `egui::Event::PointerMoved`, `egui::Event::PointerButton`, or keyboard shortcuts to verify interaction transitions.
- **Deterministic & Fast**: Runs in < 0.3s, needs zero display server, and executes reliably on all CI runners.

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
- Navigate to the affected view, trigger the feature, and capture the window screenshot:
  - **Linux / Git Bash / macOS**:
    ```bash
    bash .agents/skills/implement-issue/scripts/capture_screenshot.sh -o assets/screenshots/<N>-after.png
    ```
  - **Windows PowerShell**:
    ```powershell
    powershell -File .agents/skills/implement-issue/scripts/capture_screenshot.ps1 -OutputPath assets/screenshots/<N>-after.png
    ```
- Verify that `assets/screenshots/<N>-after.png` clearly displays the feature working cleanly.

### 4.5 Full Workspace Regression Suite & Lint
- Run the full workspace test suite:
  ```bash
  cargo test
  ```
  All workspace tests must pass.
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
3. **Capture Commit SHA**:
   Save the commit SHA for permanent screenshot URLs in the PR body:
   - Bash: `COMMIT_SHA=$(git rev-parse HEAD)`
   - PowerShell: `$commitSha = git rev-parse HEAD`

---

## Phase 6 — Push & Open Ready-for-Review PR with Screenshots

1. Push branch to origin:
   ```bash
   git push -u origin HEAD
   ```
2. Format PR Title:
   `[#<N>] - <Short Description>`
3. **CRITICAL PR BODY FORMATTING RULES**:
   - **Permanent Image URLs via Commit SHA**:
     ALWAYS reference screenshot images using the commit SHA:
     `https://raw.githubusercontent.com/claudioscheer/graphe/<COMMIT_SHA>/assets/screenshots/<N>-before.png`
     `https://raw.githubusercontent.com/claudioscheer/graphe/<COMMIT_SHA>/assets/screenshots/<N>-after.png`
     **NEVER use branch names** (`<branch>`) in raw URLs. When a PR is merged with `--delete-branch`, GitHub deletes the branch and breaks all image links with HTTP 404. Commit SHAs never expire.
   - **Always Use `--body-file`**:
     NEVER pass inline markdown with backticks and tables via `--body "..."` on the command line. Shell string interpolation corrupts backticks into backslashes (e.g. converting `` `cargo test` `` into `\cargo test\`).
     Always write the PR body to a temporary file (e.g., `temp_pr_body.md`) and pass `--body-file temp_pr_body.md`. Delete the temporary file afterwards.
   - **ASD-STE100 Style**:
     - One idea per sentence. 25 words or fewer per sentence.
     - Active voice. One verb per action. Keep articles.
     - Include `Closes #<N>`.
     - Complete the checklist (`cargo test`, UI change verified).

### PR Body Template

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
| ![Bug Reproduction](https://raw.githubusercontent.com/claudioscheer/graphe/<COMMIT_SHA>/assets/screenshots/<N>-before.png) | ![Feature Working](https://raw.githubusercontent.com/claudioscheer/graphe/<COMMIT_SHA>/assets/screenshots/<N>-after.png) |
```

4. Create the PR using `--body-file`:
   ```bash
   gh pr create --base main --title "[#<N>] - <title>" --body-file temp_pr_body.md
   rm -f temp_pr_body.md
   ```
5. Assign to `claudioscheer`:
   ```bash
   gh pr edit <PR> --add-assignee claudioscheer || true
   ```

---

## Phase 7 — Monitor CI Checks (Strict Anti-Polling)

1. Watch remote GitHub Actions:
   ```bash
   gh pr checks <PR> --watch
   ```
2. **STRICT ANTI-POLLING RULE**:
   - **NEVER poll `manage_task status` or loop checking CI**.
   - Launch `gh pr checks <PR> --watch` with sufficient `WaitMsBeforeAsync` or send to background, and rely on reactive system wakeup when the task finishes.
3. If checks fail:
   - View failure logs: `gh run view --log-failed`.
   - Fix the issue locally.
   - Re-run local tests (`cargo test`).
   - Commit and push fix.
   - Re-watch CI checks until all green.

---

## Phase 8 — Merge PR & Safe Workspace Cleanup

Once all CI checks pass:

1. Merge the PR and delete the remote branch:
   ```bash
   gh pr merge <PR> --merge --delete-branch
   ```
2. Clean up local workspace safely:
   ```bash
   git checkout main
   git pull origin main
   git branch -d <branch-name> 2>/dev/null || git branch -D <branch-name> 2>/dev/null || true
   git status
   ```
   *Note*: The fallback to `-D` and error suppression prevents local script failures when GitHub's remote branch deletion desyncs local branch tracking.

---

## Phase 9 — Final Report

Report outcome concisely in ASD-STE100:
1. Issue number and link
2. Rust implementation and crate summary
3. Unit and visual test results
4. Confirmation of both before and after screenshots embedded in the PR
5. PR URL and merge confirmation
6. Confirmation that local workspace is on clean `main`
