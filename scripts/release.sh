#!/usr/bin/env bash
#
# Release automation script for Graphe.
#
# Usage:
#   ./scripts/release.sh [patch|minor|major|<version>] [--dry-run] [--no-push]
#
set -euo pipefail

BUMP="patch"
DRY_RUN=false
NO_PUSH=false

for arg in "$@"; do
  case "$arg" in
    --dry-run)
      DRY_RUN=true
      ;;
    --no-push)
      NO_PUSH=true
      ;;
    patch|minor|major|[0-9]*.[0-9]*.[0-9]*)
      BUMP="$arg"
      ;;
    *)
      echo "Unknown argument: $arg"
      echo "Usage: ./scripts/release.sh [patch|minor|major|<version>] [--dry-run] [--no-push]"
      exit 1
      ;;
  esac
done

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$REPO_ROOT" ]; then
  echo "Error: Not inside a git repository."
  exit 1
fi
cd "$REPO_ROOT"

# 1. Clean working tree check
if [ -n "$(git status --porcelain)" ]; then
  if [ "$DRY_RUN" = true ]; then
    echo "Warning: Working directory has uncommitted changes (ignored for --dry-run)."
  else
    echo "Error: Working directory has uncommitted changes. Commit or stash them first."
    git status --short
    exit 1
  fi
fi

# 2. Branch check
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [ "$BRANCH" != "main" ]; then
  echo "Warning: Current branch is '$BRANCH', expected 'main'."
  read -r -p "Proceed anyway? (y/N) " confirm
  if [[ ! "$confirm" =~ ^[yY]$ ]]; then
    echo "Aborted."
    exit 0
  fi
fi

# 3. Read current version from Cargo.toml
CURRENT_VERSION="$(cargo pkgid -p graphe | awk -F'[@#]' '{print $NF}')"
echo "Current version: $CURRENT_VERSION"

# 4. Calculate new version
IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT_VERSION"

case "$BUMP" in
  patch)
    PATCH=$((PATCH + 1))
    NEW_VERSION="${MAJOR}.${MINOR}.${PATCH}"
    ;;
  minor)
    MINOR=$((MINOR + 1))
    PATCH=0
    NEW_VERSION="${MAJOR}.${MINOR}.${PATCH}"
    ;;
  major)
    MAJOR=$((MAJOR + 1))
    MINOR=0
    PATCH=0
    NEW_VERSION="${MAJOR}.${MINOR}.${PATCH}"
    ;;
  *)
    NEW_VERSION="$BUMP"
    ;;
esac

echo "Target release version: $NEW_VERSION"
TAG="v${NEW_VERSION}"

if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "Error: Tag '$TAG' already exists in git. Cannot release an existing version."
  exit 1
fi

if [ "$DRY_RUN" = true ]; then
  echo "[DRY RUN] Would bump version from $CURRENT_VERSION to $NEW_VERSION in:"
  echo "  - Cargo.toml"
  echo "  - Cargo.lock"
  echo "  - packaging/windows/setup.iss"
  echo "  - packaging/macos/Info.plist"
  echo "[DRY RUN] Would run cargo test"
  echo "[DRY RUN] Would create git commit: 'Release version $NEW_VERSION.'"
  echo "[DRY RUN] Would create git tag: '$TAG'"
  if [ "$NO_PUSH" = false ]; then
    echo "[DRY RUN] Would push commit and tag to origin"
  fi
  exit 0
fi

# 5. Update files
echo "Updating Cargo.toml..."
sed -i.bak -E 's/^version = "[^"]+"/version = "'"$NEW_VERSION"'"/' Cargo.toml
rm -f Cargo.toml.bak

CARGO_UPDATED="$(cargo pkgid -p graphe | awk -F'[@#]' '{print $NF}')"
if [ "$CARGO_UPDATED" != "$NEW_VERSION" ]; then
  echo "Error: Failed to update Cargo.toml to $NEW_VERSION (still $CARGO_UPDATED)."
  exit 1
fi

if [ -f "packaging/windows/setup.iss" ]; then
  echo "Updating packaging/windows/setup.iss..."
  sed -i.bak -E 's/(#define MyAppVersion\s+)"[^"]+"/\1"'"$NEW_VERSION"'"/' packaging/windows/setup.iss
  rm -f packaging/windows/setup.iss.bak
fi

if [ -f "packaging/macos/Info.plist" ]; then
  echo "Updating packaging/macos/Info.plist..."
  sed -i.bak -E '/<key>CFBundle(ShortVersionString|Version)<\/key>/{n;s|<string>[^<]+</string>|<string>'"$NEW_VERSION"'</string>|;}' packaging/macos/Info.plist
  rm -f packaging/macos/Info.plist.bak
fi

echo "Syncing Cargo.lock..."
cargo check --quiet

# 6. Run tests
echo "Running tests..."
if ! cargo test; then
  echo "Error: Tests failed! Reverting modified files..."
  git checkout -- Cargo.toml Cargo.lock packaging/windows/setup.iss packaging/macos/Info.plist
  exit 1
fi

# 7. Commit and tag
echo "Committing release version $NEW_VERSION..."
git add Cargo.toml Cargo.lock packaging/windows/setup.iss packaging/macos/Info.plist
git commit -m "Release version $NEW_VERSION."
git tag -a "$TAG" -m "Release $TAG"

# 8. Push
if [ "$NO_PUSH" = true ]; then
  echo ""
  echo "Release $TAG created locally (commit and tag)."
  echo "To publish, run:"
  echo "  git push origin $BRANCH"
  echo "  git push origin $TAG"
else
  echo "Pushing commit and tag to origin..."
  git push origin "$BRANCH"
  git push origin "$TAG"
  echo ""
  echo "Successfully released and pushed $TAG!"
  echo "GitHub Actions has been triggered to build and publish the release."
fi
