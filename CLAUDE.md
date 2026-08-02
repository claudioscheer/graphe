# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Graphe is an Electron desktop Bible study app (Windows, Linux, macOS) with split panes, Strong's numbers, cross-references, commentaries, and dictionary lookups. TypeScript throughout (main process + renderer). No React/Vue — DOM is built imperatively via module singletons.

## Commands

```bash
npm run dev          # Development (main tsc watch + CSS watch + Vite + Electron)
npm run build        # build:main + build:renderer
npm run build:main   # tsc -p tsconfig.main.json → dist/
npm run build:css    # One-time Tailwind CSS build
npm run build:renderer # CSS + Vite renderer bundle
npm run typecheck    # tsc -p tsconfig.json --noEmit
npm run lint:fix     # ESLint auto-fix
npm run format       # Prettier format
npm run test         # Vitest (rebuilds better-sqlite3 native module before/after)
npm run make         # Build distributable installers
```

## Architecture

**Electron with strict context isolation** — main process (Node/SQLite) communicates with renderer (DOM) only through IPC via preload bridge (`window.api`). Types live in `types/window-api.d.ts`.

### Main Process (`src/main/`)

- `main.ts` — Window lifecycle, menus, IPC setup, hot-reload watcher
- `modules.ts` — Data API facade over open module handles
- `ipc-handlers.ts` — Maps IPC channels to `modules.*` functions
- `state-store.ts` — Persists app state to `~/.graphe/state.json`
- `modules/` — SQLite providers per format (MyBible, TheWord, MySword) + converters
- `modules/morphology-resolver.ts` — Morphology orchestration (data in `morphology-i18n-data.ts`, decoders in `morphology-decoders.ts`)

### Preload

- `src/preload.ts` — Whitelists every IPC method exposed as `window.api`

### Renderer (`src/renderer/app/`)

Entry: `main.ts` → `app.ts` (bootstrap). Vite bundles the renderer.

| Module                                                                                 | Role                                                         |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `app.ts`                                                                               | Bootstrap, workbench wiring                                  |
| `settings-dialog.ts` / `about-dialog.ts` / `convert-modal.ts` / `cross-ref-preview.ts` | Dialogs                                                      |
| `content-interactions.ts`                                                              | Clicks, keyboard, Strong's / cross-ref navigation            |
| `pane-manager.ts`                                                                      | Pane tree state, load/navigate orchestration                 |
| `pane-chrome-bible.ts` / `pane-chrome-commentary.ts`                                   | Pane shell DOM                                               |
| `pane-tree.ts` / `pane-model.ts` / `pane-history.ts` / `pane-labels.ts`                | Pure pane helpers                                            |
| `commentary-modals.ts`                                                                 | All-commentaries + coverage modals                           |
| `bible-view.ts` / `commentary-view.ts`                                                 | Chapter / commentary rendering                               |
| `search-panel.ts` / `dict-panel.ts`                                                    | Sidebars                                                     |
| `dict-link-binding.ts`                                                                 | Dictionary content link binding                              |
| `bible-ref.ts` / `book-ids.ts`                                                         | Shared bible ref parsing and book IDs                        |
| `module-picker.ts`                                                                     | Searchable module dropdown (`ModulePickerInstance` exported) |
| `i18n.ts`                                                                              | PT/EN/ES strings + book names                                |
| `app-state-store.ts`                                                                   | Debounced persisted UI state                                 |
| `workbench-shell.ts` / `workspace-manager.ts`                                          | Shell chrome and workspaces                                  |

### Code Pattern

Renderer modules use the IIFE singleton pattern:

```typescript
export const MyModule = (() => {
  let privateState: string;
  function privateFunc() {}
  return { publicFunc };
})();
```

Pure helpers (tree ops, book IDs, ref parsing) are plain exported functions.

### Data Layer

- SQLite3 databases (MyBible format) in `~/.graphe/modules/`
- Module type auto-detected from DB schema (which tables exist)
- Strong's tags in verse text: `<S>H1234</S>`, `<WH1234>`, `<WG5678>`

## Styling

- **Tailwind CSS 4** — input: `src/renderer/styles.css`, output: `src/renderer/dist.css`
- Custom CSS properties (`--ui-bg`, `--ui-text`, `--ui-border`, etc.) with `.dark` variant
- Custom brand/night color palettes in `@theme` block

### Design System: Follow VS Code

UI should follow VS Code's design language — restrained, functional, minimal decoration:

- **Border-radius scale**: 2px (inline marks, tooltips, tabs, badges), 4px (inputs, buttons, scrollbar thumbs, sections), 6px (floating surfaces: dropdowns, popovers, modals), 9999px (pill badges only)
- **No 8px+ radius** on any element except intentional pills
- Subtle borders and shadows — avoid heavy box-shadows or prominent outlines
- Prefer `background-color: transparent` over `background: none` to avoid wiping `background-image`
- Toolbar elements (selects, nav groups) should share the same visual weight and background

## Key Conventions

- State auto-saves with 200ms debounce via `AppStateStore`
- Pane tree state serialized/restored on restart
- `preload.ts` whitelists every IPC method — add new methods there and in `types/window-api.d.ts` when extending the API
- Prefer shared `bible-ref.ts` / `book-ids.ts` over copying book-number tables or href parsers
- Export `ModulePickerInstance` from `module-picker.ts` instead of redeclaring locally
- Tests in `test/` — main-process providers/converters plus renderer pure helpers (`test/renderer/`)
