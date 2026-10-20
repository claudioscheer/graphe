# AGENTS.md

Guidance for coding agents working in this repository. Prefer correctness and existing patterns over inventing new architecture.

## Project Overview

Graphe is a desktop Bible study app (Windows, Linux, macOS) with split panes, Strong's numbers, cross-references, commentaries, and dictionary lookups. The interface is egui. Behavior lives in Rust crates, not in the window code.

## Commands

```bash
cargo test            # All workspace tests
cargo test -p graphe-domain
cargo test -p graphe-store
cargo run -p graphe   # Open the window
```

After non-trivial edits, run `cargo test`. Narrow it to the crate you touched when the change is local.

## Crates

| Crate | Role |
| ----- | ---- |
| `graphe-domain` | Pure rules: book numbers, refs, i18n, panes, navigation, search parsing, morphology, coverage, dictionary formatting. No filesystem, SQLite, or egui. |
| `graphe-store` | MyBible SQLite, theWord/MySword conversion, `~/.graphe/modules`, `~/.graphe/state.json`. |
| `graphe` | egui shell. It draws and forwards input into the other two crates. |

Root `Cargo.toml` is the workspace (`resolver = "2"`).

### Window

- `crates/graphe/src/main.rs` prints the startup line, then `graphe::run()`.
- `startup.rs` builds the model the binary prints and the launch test asserts.
- `session.rs` owns study actions (navigate, split, history, copy, workspaces).
- `app.rs`, `study.rs`, `side.rs`, `dialogs.rs` draw the workbench.

Do not put a second copy of a rule in the window. Call the domain or store function.

### Data

- SQLite modules in `~/.graphe/modules/` (`%USERPROFILE%\.graphe\modules` on Windows).
- UI state in `~/.graphe/state.json`, saved through `AppStateStore` (200 ms debounce).
- Module type comes from which tables exist.
- Strong's tags in verse text: `<S>H1234</S>`, `<WH1234>`, `<WG5678>`.

## Rust

- Edition 2021. No `unsafe` unless a dependency forces it.
- Keep `unwrap` off library paths that see user files. Return `Result` or an empty value the UI can show.
- Annotate public items when inference is not obvious.
- SQLite rows get a small struct. Do not poke untyped columns.
- `regex` has no look-ahead, look-behind, or backreferences. Spell those cases out.
- One book-number table: `graphe_domain::books`. Do not paste another 66-entry list.
- Bible hrefs go through `bible_ref::parse_bible_href`. Typed refs such as `Gn 1:3` go through `NavigationSession::submit_input`.
- Prefer a focused module over a file that keeps growing. Pure helpers stay out of the window.

## Style

The workbench follows the same regions as the previous app: study tabs, horizontal and vertical splits, sidebar (search, dictionary, modules), light and dark palettes.

- Light `--ui-bg` `#fefdf9`, dark `#181818`. Values live in `graphe_domain::theme`.
- Corner radii are 2, 4, and 6 px. Only a pill mark may be fully round.
- UI language is Portuguese, English, or Spanish (`graphe_domain::i18n`). It does not change the Bible module.
- Shortcuts are `Ctrl` elsewhere and `Cmd` on macOS. The map is `graphe_domain::shortcuts`.

## Testing

Tests sit next to the code they call (`#[cfg(test)]` modules). They construct the real function from its start state.

- Domain tests cover books, hrefs, panes, navigation, workspaces, picker, search parsing, morphology, commentary refs, dictionary formatting, coverage, and app state.
- Store tests use temporary SQLite files for reads, edits, and theWord/MySword conversion, including encrypted `.ontx` rejection.
- `graphe` tests call `Session` and `build_startup_model`.

## Git

- Only commit when asked. Only push when asked.
- No AI attribution or co-author trailers.
- Commit messages are complete sentences and say why the change exists.

## Documentation & Processes

Standard process guides for agents are stored in `docs/processes/`:
- [Release Process](docs/processes/release.md): Version bumping, manifests, tests, tags, and GitHub release automation.
- [Update Banner & UI Test Notes](docs/processes/ui-banner-and-test-notes.md): Update plumbing, the egui 0.37 `Button` theming rule, the kittest render lock, and previewing UI changes locally.

