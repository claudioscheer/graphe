# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Graphe is an Electron desktop Bible study app (Windows, Linux, macOS) with split panes, Strong's numbers, cross-references, commentaries, and dictionary lookups. Vanilla JS — no React/Vue/framework.

## Commands

```bash
npm run dev          # Development (watch CSS + Electron hot-reload)
npm run build:css    # One-time Tailwind CSS build
npm run lint:fix     # ESLint auto-fix
npm run format       # Prettier format
npm run test         # Vitest (rebuilds better-sqlite3 native module before/after)
npm run make         # Build distributable installers
```

## Architecture

**Electron with strict context isolation** — main process (Node/SQLite) communicates with renderer (DOM) only through IPC via preload bridge (`window.api`).

### Main Process (`src/main/`)
- `main.js` — Window lifecycle, menus, IPC setup, hot-reload watcher
- `modules.js` — All data queries (Bible verses, dictionaries, commentaries, cross-refs)
- `ipc-handlers.js` — Maps IPC channels to `modules.*` functions
- `state-store.js` — Persists app state to `~/.graphe/state.json`
- `modules/` — SQLite providers per format (MyBible, TheWord, MySword) + converters

### Renderer (`src/renderer/`)
- `js/app.js` — Entry point, settings, state management (AppStateStore singleton)
- `js/pane-manager.js` — **Recursive binary tree** layout (Leaf | Split{direction, ratio, children})
- `js/bible-view.js` — Verse rendering, Strong's tag parsing, keyboard nav
- `js/commentary-view.js` — Commentary rendering with reference link parsing
- `js/search-panel.js` — Left sidebar full-text/Strong's search
- `js/dict-panel.js` — Right sidebar dictionary/Strong's lookup
- `js/module-picker.js` — Searchable dropdown with favorites
- `js/i18n.js` — Hardcoded translations (PT/EN/ES) with `I18n.t(key)` + `data-i18n` attributes
- `js/navigation.js` — Quick book/chapter navigation dialog

### Code Pattern
All renderer modules use the IIFE singleton pattern:
```javascript
const MyModule = (() => {
  let privateState;
  function privateFunc() {}
  return { publicFunc };
})();
```

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
- `preload.js` whitelists every IPC method — add new methods there when extending the API
- Renderer scripts load in dependency order via `<script>` tags in `index.html` (no bundler)
- Tests in `test/` directory — focused on main-process data providers and converters
