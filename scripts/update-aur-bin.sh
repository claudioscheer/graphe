#!/usr/bin/env bash
# Sync aur/graphe-bin with package.json and the GitHub Linux zip checksum.
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
pkgdir="${repo_root}/aur/graphe-bin"
pkgbuild="${pkgdir}/PKGBUILD"
version="$(node -p "require('${repo_root}/package.json').version")"

if [[ ! -f "${pkgbuild}" ]]; then
  echo "error: missing ${pkgbuild}" >&2
  exit 1
fi

cp -f "${repo_root}/assets/graphe.png" "${pkgdir}/graphe.png"

sed -i "s/^pkgver=.*/pkgver=${version}/" "${pkgbuild}"
sed -i "s/^pkgrel=.*/pkgrel=1/" "${pkgbuild}"

(
  cd "${pkgdir}"
  if command -v updpkgsums >/dev/null 2>&1; then
    updpkgsums
  else
    makepkg -g >>"${pkgbuild}.sums"
    echo "error: updpkgsums not found; wrote ${pkgbuild}.sums — paste into PKGBUILD" >&2
    exit 1
  fi
  makepkg --printsrcinfo >.SRCINFO
)

echo "Updated aur/graphe-bin for ${version}."
echo "Next: commit PKGBUILD, .SRCINFO, graphe.desktop, graphe.png"
echo "Then push to ssh://aur@aur.archlinux.org/graphe-bin.git"
