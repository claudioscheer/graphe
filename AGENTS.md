# AGENTS.md

Guidance for coding agents working in this repository. Prefer correctness and existing patterns over inventing new architecture.

## Project Overview

Graphe is an Electron desktop Bible study app (Windows, Linux, macOS) with split panes, Strong's numbers, cross-references, commentaries, and dictionary lookups. TypeScript throughout (main process + renderer). No React/Vue — DOM is built imperatively via module singletons.

## Commands

```bash
pnpm install         # Install dependencies
pnpm run dev          # Development (main tsc watch + CSS watch + Vite + Electron)
pnpm run build        # build:main + build:renderer
pnpm run build:main   # tsc -p tsconfig.main.json → dist/
pnpm run build:css    # One-time Tailwind CSS build
pnpm run build:renderer # CSS + Vite renderer bundle
pnpm run typecheck    # tsc -p tsconfig.json --noEmit  (must stay clean)
pnpm run lint:fix     # ESLint auto-fix
pnpm run format       # Prettier format
pnpm test             # Vitest (rebuilds better-sqlite3 native module before/after)
pnpm run make         # Build distributable installers
```

After non-trivial edits, run at least:

1. `pnpm run typecheck`
2. `pnpm test` (or the narrow Vitest path for the area you touched)
3. `pnpm run lint:fix` then `pnpm run format` when you changed many files — do not hand-format against Prettier/ESLint

## Architecture

**Electron with strict context isolation** — main process (Node/SQLite) communicates with renderer (DOM) only through IPC via preload bridge (`window.api`). Types live in `types/window-api.d.ts`.

### Main Process (`src/main/`)

- `main.ts` — Window lifecycle, menus, IPC setup, hot-reload watcher
- `modules.ts` — Data API facade over open module handles
- `ipc-handlers.ts` — Maps IPC channels to `modules.*` functions
- `state-store.ts` — Persists app state to `~/.graphe/state.json`
- `modules/` — SQLite providers per format (MyBible, TheWord, MySword) + converters
- `modules/morphology-resolver.ts` — Morphology orchestration (data in `morphology-i18n-data.ts`, decoders in `morphology-decoders.ts`)

Main compiles to CommonJS (`tsconfig.main.json` → `dist/`). Relative imports in main are usually **extensionless**.

### Preload

- `src/preload.ts` — Whitelists every IPC method exposed as `window.api`

When adding an API surface, update **all three** in the same change:

1. Implementation in `modules.ts` (or providers)
2. `ipc-handlers.ts` + `preload.ts`
3. `types/window-api.d.ts` (`WindowApi` and related interfaces)

Never expose Node APIs to the renderer outside `window.api`.

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

Renderer feature modules use the IIFE singleton pattern:

```typescript
export const MyModule = (() => {
  let privateState: string;
  function privateFunc(): void {}
  return { publicFunc };
})();
```

Pure helpers (tree ops, book IDs, ref parsing) are plain exported functions — prefer that when there is no module state.

### Data Layer

- SQLite3 databases (MyBible format) in `~/.graphe/modules/`
- Module type auto-detected from DB schema (which tables exist)
- Strong's tags in verse text: `<S>H1234</S>`, `<WH1234>`, `<WG5678>`

## TypeScript: Strict Typing (required)

The project is TypeScript-only under `src/` and `test/` (except the CJS Vitest require shim). Treat types as part of the change, not optional polish.

### Hard rules

1. **No new untyped code.** Do not add `.js` under `src/` or `test/`. Do not reintroduce `// @ts-nocheck` on production source. Prefer not adding `@ts-nocheck` on new tests either.
2. **No `any` unless forced by a third-party boundary.** Prefer concrete interfaces, `unknown` + narrowing, or typed row shapes for SQLite `.get()` / `.all()` results (`as SomeRow` after you define `SomeRow`).
3. **Annotate public surface.** Exported functions, returned objects from IIFEs, and callback parameters need explicit types when inference is unclear.
4. **No silent fallbacks that paper over bad types.** If a value can be missing, model that in the type (`T | null`) and handle it; do not cast to silence errors.
5. **`pnpm run typecheck` must pass** before you call the work done.

Config reality (`tsconfig.json`): `strict: true`, `noImplicitAny: true`. Note: `strictNullChecks` is currently **false** — still prefer explicit `| null` / optional fields where null is meaningful; do not loosen checks further.

### Import extensions (autocomplete and checks still work)

| Area                         | Specifier style                         | Example                                      |
| ---------------------------- | --------------------------------------- | -------------------------------------------- |
| Renderer (`src/renderer/**`) | Relative imports end in **`.js`**       | `from './book-ids.js'`                       |
| Main / preload (CJS emit)    | Usually **extensionless**               | `from './morphology-decoders'`               |
| Tests importing main         | Often **`.ts`** (Vitest + require shim) | `from '../src/main/modules/book-map.ts'`     |
| Tests importing renderer     | Match renderer: **`.js`**               | `from '../../src/renderer/app/pane-tree.js'` |

The `.js` in a renderer import is the **module specifier**, not a claim that a `.js` source file exists. TypeScript + Vite resolve it to the `.ts` file. IDE go-to-definition, autocomplete, and `tsc` all use the `.ts` types.

`rewriteRelativeImportExtensions` is enabled — keep this convention; do not invent a third style.

### Shared types and globals

- App/IPC contracts: `types/window-api.d.ts` (`WindowApi`, `ModuleRecord`, verse/dict types, etc.)
- Prefer exporting types next to their owner (`export interface ModulePickerInstance` from `module-picker.ts`) instead of redeclaring the same shape in five files
- Do not hang new feature APIs on `window` (e.g. no `window.Settings`). Import the module or inject a callback

### SQLite / better-sqlite3

Query results are loosely typed by the library. Define a small interface for the columns you read and assert once:

```typescript
interface InfoRow {
  name: string;
  value: string;
}
const rows = db.prepare('SELECT name, value FROM info').all() as InfoRow[];
```

Do not leave query results as implicit `any`/`unknown` and poke properties without a type.

## Structure and File Size

- Prefer focused modules under ~800–1000 lines. Do not grow megamodules (`pane-manager`, `dict-panel`, etc.) with more DOM or modals — extract chrome, modals, pure helpers, or link-binding instead.
- Put pure logic in pure files (`pane-tree`, `bible-ref`, `book-ids`, converters) so tests stay cheap.
- One concept per file when extracting: chrome vs orchestration vs modal vs data tables.

## Domain Invariants (do not fork)

- **Book numbers:** use `book-ids.ts` / `I18n._BOOK_NUMBERS` in the renderer and `book-map.ts` `GRAPHE_BOOK_NUMBERS` in main. Never paste another 66-entry book ID array. Keep renderer and main tables in sync (see `test/renderer/bible-ref.test.ts`).
- **Bible hrefs:** use `bible-ref.ts` (`parseBibleHref`) for `B:` / `#b` forms. Dict panel uses `{ requireVerse: true }`; commentary/content may allow optional verse.
- **Module picker:** import `ModulePicker` / `ModulePickerInstance` from `module-picker.ts`. Pane manager stores instances in a `Map`, not magic DOM properties.

## Behavior and Refactors

- Default to **no behavior change** unless the task is a feature or bugfix.
- Prefer deleting duplication and special-case branches over adding flags.
- Do not “improve” UI copy, layout, or design tokens while doing structural work unless asked.
- Scope tightly: one concern per PR/commit when possible.

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

## Testing

- Tests live under `test/` (main providers/converters) and `test/renderer/` (pure helpers + some UI modules)
- Prefer unit tests on pure helpers over brittle full-DOM integration unless the bug is interaction-specific
- Fixtures: `test/support/module-fixtures.ts`
- Vitest setup: `test/setup/require-ts-resolution.cjs` (keep as CJS; it patches `require` for `.ts`) and `test/setup/web-storage.ts` (in-memory `localStorage` for Node ≥ 25, whose inert experimental global shadows jsdom's)
- When changing providers/converters/ref parsers, extend existing tests rather than only manual Electron checks
- Renderer tests often need `/** @vitest-environment jsdom */` or the `test/renderer/**` jsdom glob

## Formatting and Lint

- Prettier and ESLint own formatting. Do not restate style nits in comments or commit messages.
- Run `pnpm run lint:fix` and `pnpm run format` after large edits; verify the tools actually succeeded (wrappers can exit 0 while reporting issues — read the output).

## Git / Commits

- Only commit when asked. Only push when asked.
- No AI attribution / co-author trailers in commits.
- Commit messages: complete sentences, why the change exists, focused scope.

## Key Conventions (checklist)

- [ ] State auto-saves with 200ms debounce via `AppStateStore`
- [ ] Pane tree state serializes/restores on restart
- [ ] New IPC: `modules` + handlers + preload + `types/window-api.d.ts`
- [ ] Shared `bible-ref` / `book-ids` — no copied book tables or href parsers
- [ ] Export shared types from the owning module
- [ ] `typecheck` + relevant tests green
- [ ] No new `any` / `@ts-nocheck` in product code
- [ ] Renderer imports use `.js` specifiers; types still resolve to `.ts`
