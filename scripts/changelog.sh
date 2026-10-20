#!/usr/bin/env bash
#
# Build the release-notes body for a tag, in the house format: one bullet per
# commit with its subject, the tagged GitHub author, and a link to the commit,
# followed by the compare link. The release workflow feeds this to the publish
# step, so the published release always documents its own commits.
#
# Usage: ./scripts/changelog.sh <tag> [previous-tag]
#
# A commit may end with a `Topic: <area>` trailer; it becomes the bullet's
# bold lead. Without one, the subject alone carries the bullet.
set -euo pipefail

TAG="${1:?Usage: changelog.sh <tag> [previous-tag]}"
PREV="${2:-}"

if ! git rev-parse -q --verify "$TAG" >/dev/null; then
  echo "Error: tag '$TAG' does not exist." >&2
  exit 1
fi

if [ -z "$PREV" ]; then
  PREV="$(git tag --sort=-creatordate --merged "$TAG" | grep -vx "$TAG" | head -1 || true)"
fi
if [ -z "$PREV" ]; then
  PREV="$(git rev-list --max-parents=0 "$TAG" | tail -1)"
fi

REMOTE_URL="$(git remote get-url origin)"
SLUG="$(echo "$REMOTE_URL" | sed -E 's#^(git@github.com:|https://github.com/)##; s#\.git$##')"
REPO_URL="https://github.com/$SLUG"

echo "## What's Changed"
echo
for sha in $(git log --no-merges --reverse --format='%H' "$PREV..$TAG"); do
  subject="$(git log -1 --format='%s' "$sha")"
  case "$subject" in
    # The version-bump commit carries no user-facing change.
    "Release version "[0-9]*".") continue;;
  esac
  topic="$(git log -1 --format='%(trailers:key=Topic,valueonly)' "$sha" | head -1 || true)"
  author_name="$(git log -1 --format='%aN' "$sha")"
  login="$(gh api "repos/$SLUG/commits/$sha" --jq '.author.login // .committer.login // ""' 2>/dev/null || true)"
  # GitHub logins are letters, digits, and hyphens; anything else (an error
  # payload, an empty answer) falls back to the git author name.
  if [[ "$login" =~ ^[A-Za-z0-9-]+$ ]]; then
    author="@$login"
  else
    author="$author_name"
  fi
  link="[${sha:0:7}]($REPO_URL/commit/$sha)"
  if [ -n "$topic" ]; then
    echo "- **$topic** — $subject $author ($link)"
  else
    echo "- $subject $author ($link)"
  fi
done
echo
echo "**Full Changelog**: $REPO_URL/compare/$PREV...$TAG"
