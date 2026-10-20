# Release Process

This document describes how to release a new version of Graphe. Follow these steps to bump the version, update all packaging manifests, run the test suite, create the release tag, and publish multi-platform release artifacts through GitHub Actions.

---

## 1. Overview

Graphe uses semantic versioning (`MAJOR.MINOR.PATCH`). A release consists of:

1. Updating the workspace version in `Cargo.toml`.
2. Syncing `Cargo.lock` via `cargo check`.
3. Updating platform-specific packaging manifests (`setup.iss` and `Info.plist`).
4. Running the full test suite (`cargo test`).
5. Committing the changes with message `Release version X.Y.Z.`.
6. Creating an annotated Git tag `vX.Y.Z` with message `Release vX.Y.Z`.
7. Pushing the commit and tag to `origin/main`.
8. GitHub Actions (`.github/workflows/release.yml`) builds Windows, Linux, and macOS binaries, installers, and bundles, then publishes a GitHub Release with all assets attached.

---

## 2. Files Containing the Version

When bumping the version, four files must be kept in sync:

| File | Location | Format / Key |
| --- | --- | --- |
| `Cargo.toml` | Workspace root | `[workspace.package]` block:<br>`version = "X.Y.Z"` |
| `Cargo.lock` | Workspace root | Run `cargo check` to automatically update the version for all workspace crates (`graphe`, `graphe-domain`, `graphe-store`). |
| `packaging/windows/setup.iss` | Windows Inno Setup script | `#define MyAppVersion "X.Y.Z"` |
| `packaging/macos/Info.plist` | macOS App bundle manifest | `<key>CFBundleShortVersionString</key>`<br>`<string>X.Y.Z</string>`<br>`<key>CFBundleVersion</key>`<br>`<string>X.Y.Z</string>` |

> [!NOTE]
> All workspace crates (`crates/graphe/Cargo.toml`, `crates/graphe-domain/Cargo.toml`, `crates/graphe-store/Cargo.toml`) use `version.workspace = true`, so only the root `Cargo.toml` workspace definition needs to be edited directly.

---

## 3. Automated Release (Recommended)

Automated scripts exist for Windows (PowerShell) and Unix (Bash). They validate prerequisites, update files, run tests, commit, tag, and push.

### Prerequisites

- You must be on the `main` branch.
- The working directory must be clean (`git status` shows no uncommitted changes).
- The local branch must be up to date with `origin/main` (`git pull origin main`).

### Running the Release Script

#### Windows (PowerShell)

```powershell
# Patch release (default: e.g., 1.0.15 -> 1.0.16)
powershell -ExecutionPolicy Bypass -File .\scripts\release.ps1 patch

# Minor release (e.g., 1.0.15 -> 1.1.0)
powershell -ExecutionPolicy Bypass -File .\scripts\release.ps1 minor

# Major release (e.g., 1.0.15 -> 2.0.0)
powershell -ExecutionPolicy Bypass -File .\scripts\release.ps1 major

# Explicit version
powershell -ExecutionPolicy Bypass -File .\scripts\release.ps1 1.0.16

# Dry run (verify what would change without modifying files, committing, or pushing)
powershell -ExecutionPolicy Bypass -File .\scripts\release.ps1 patch -DryRun

# Local only (updates files, commits, and tags, but does not push to origin)
powershell -ExecutionPolicy Bypass -File .\scripts\release.ps1 patch -NoPush
```

#### Linux / macOS (Bash)

```bash
# Patch release (default: e.g., 1.0.15 -> 1.0.16)
./scripts/release.sh patch

# Minor or major release
./scripts/release.sh minor
./scripts/release.sh major

# Explicit version
./scripts/release.sh 1.0.16

# Dry run
./scripts/release.sh patch --dry-run

# Local only
./scripts/release.sh patch --no-push
```

---

## 4. Manual Release Procedure (Fallback)

If you need to perform the release manually without the script, follow these steps in order:

### Step 1: Verify git state

Ensure you are on `main` and clean:

```bash
git checkout main
git pull origin main
git status
```

### Step 2: Bump version in `Cargo.toml`

Edit `Cargo.toml`:
```toml
[workspace.package]
version = "X.Y.Z"
```

### Step 3: Sync `Cargo.lock`

```bash
cargo check
```

Verify the version:
```bash
cargo pkgid -p graphe
```

### Step 4: Update Windows setup script

Edit `packaging/windows/setup.iss`:
```iss
#define MyAppVersion "X.Y.Z"
```

### Step 5: Update macOS Info.plist

Edit `packaging/macos/Info.plist`:
```xml
    <key>CFBundleShortVersionString</key>
    <string>X.Y.Z</string>
    <key>CFBundleVersion</key>
    <string>X.Y.Z</string>
```

### Step 6: Run tests

All workspace tests must pass before committing:
```bash
cargo test
```

### Step 7: Commit and tag

Create the release commit and annotated tag adhering to project conventions:

```bash
git add Cargo.toml Cargo.lock packaging/windows/setup.iss packaging/macos/Info.plist
git commit -m "Release version X.Y.Z."
git tag -a "vX.Y.Z" -m "Release vX.Y.Z"
```

### Step 8: Push to GitHub

Push both the branch and the tag to trigger the release workflow:

```bash
git push origin main
git push origin vX.Y.Z
```

---

## 5. GitHub Actions Release Workflow

Pushing a tag matching `v*` triggers `.github/workflows/release.yml`.

### Jobs

1. **`build-windows`**:
   - Asserts `TAG_VERSION` matches `cargo pkgid -p graphe`.
   - Builds release binary: `cargo build --release -p graphe`.
   - Installs Inno Setup and compiles `dist/graphe-windows-installer.exe`.
   - Zips portable binaries and docs into `dist/graphe-windows.zip`.
2. **`build-linux`**:
   - Asserts `TAG_VERSION` matches `cargo pkgid -p graphe`.
   - Builds Linux release binary.
   - Generates Debian `.deb` package (`dist/graphe_${VERSION}_amd64.deb`).
   - Generates AppImage (`dist/graphe-${VERSION}-x86_64.AppImage`).
   - Packages `dist/graphe-linux.tar.gz`.
3. **`build-macos`**:
   - Asserts `TAG_VERSION` matches `cargo pkgid -p graphe`.
   - Cross-compiles Apple Silicon (`aarch64-apple-darwin`) and Intel (`x86_64-apple-darwin`).
   - Uses `lipo` to create a universal macOS bundle (`Graphe.app`).
   - Creates `dist/graphe-macos.dmg` and `dist/graphe-macos.zip`.
4. **`publish`**:
   - Collects all platform artifacts.
   - Creates or updates the GitHub Release corresponding to the tag.
   - Generates automatic release notes from merged PRs and commit history.
   - Uploads all release assets.

### Monitoring the Release

To inspect the build progress from the CLI:

```bash
gh run list --workflow=release.yml
gh run watch <run-id>
```

Or view releases:
```bash
gh release list
gh release view vX.Y.Z
```

---

## 6. Release Notes (Changelog)

Every release ships a changelog built from the commits included in its tag (`git log vPREVIOUS..vX.Y.Z`). The workflow's auto-generated PR list is not enough, because most releases carry direct commits to `main`. After the release workflow publishes, rewrite the notes:

```bash
gh release edit vX.Y.Z --notes-file notes.md
```

One bullet per commit, oldest first, skipping the `Release version X.Y.Z.` commit itself. Each bullet has:

1. A bold topic naming the area of the change.
2. A short description taken from the commit subject.
3. The GitHub user who authored the commit, tagged.
4. A link to the commit.

Example:

```markdown
- **Reference navigation** — The reference dialog now changes the Bible pane
  you selected instead of the pinned one. @claudioscheer
  ([d5e245f](https://github.com/claudioscheer/graphe/commit/d5e245f01a5cdece4940f32f5298fad65e172bdd))
```

Close the notes with the compare link:

```markdown
**Full Changelog**: https://github.com/claudioscheer/graphe/compare/vPREVIOUS...vX.Y.Z
```
