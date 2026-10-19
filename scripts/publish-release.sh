#!/usr/bin/env bash
# Publishes the GitHub Release for a tag already pushed to origin: the notes are that version's CHANGELOG.md section.
# usage: scripts/publish-release.sh vX.Y.Z [--latest]     (run from the repo root; needs `gh` signed in)
# Part of every release: the installer reads the tag archive, but people read the Releases page and its "Latest" badge.
set -euo pipefail
tag="${1:-}"; latest="${2:-}"
[[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "usage: scripts/publish-release.sh vX.Y.Z [--latest]" >&2; exit 64; }
version="${tag#v}"
notes="$(awk -v v="$version" '$0 ~ "^## \\[" v "\\]" {on=1; next} on && /^## \[/ {exit} on {print}' CHANGELOG.md | sed -e :a -e '/^\n*$/{$d;N;ba' -e '}')"
[[ -n "$notes" ]] || { echo "publish-release: no CHANGELOG.md section for $version; add it, then run again." >&2; exit 1; }
git rev-parse -q --verify "refs/tags/$tag" >/dev/null || { echo "publish-release: tag $tag is not in this checkout; run git fetch --tags." >&2; exit 1; }
if gh release view "$tag" >/dev/null 2>&1; then
  gh release edit "$tag" --title "$tag" --notes "$notes" ${latest:+--latest}
else
  gh release create "$tag" --verify-tag --title "$tag" --notes "$notes" $([[ "$latest" == "--latest" ]] && echo --latest || echo --latest=false)
fi
echo "published $tag"
