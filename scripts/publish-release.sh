#!/usr/bin/env bash
# Publishes the GitHub Release for a tag already pushed to origin. Notes default to that version's CHANGELOG.md section.
# usage: scripts/publish-release.sh vX.Y.Z [--latest] [--notes-file path]     (run from the repo root; needs `gh` signed in)
# Part of every release: the installer reads the tag archive, but people read the Releases page and its "Latest" badge.
set -euo pipefail
tag="${1:-}"; shift || true; latest=; notes_file=
[[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "usage: scripts/publish-release.sh vX.Y.Z [--latest]" >&2; exit 64; }
while (($#)); do
  case "$1" in
    --latest) latest=1 ;;
    --notes-file) (($# >= 2)) || { echo "publish-release: --notes-file needs a path." >&2; exit 64; }; notes_file="$2"; shift ;;
    *) echo "usage: scripts/publish-release.sh vX.Y.Z [--latest] [--notes-file path]" >&2; exit 64 ;;
  esac
  shift
done
version="${tag#v}"
if [[ -n "$notes_file" ]]; then
  [[ -f "$notes_file" ]] || { echo "publish-release: notes file not found: $notes_file" >&2; exit 1; }
  notes="$(cat "$notes_file")"
else
  notes="$(awk -v v="$version" '$0 ~ "^## \\[" v "\\]" {on=1; next} on && /^## \[/ {exit} on {print}' CHANGELOG.md | sed -e :a -e '/^\n*$/{$d;N;ba' -e '}')"
fi
[[ -n "$notes" ]] || { echo "publish-release: no CHANGELOG.md section for $version; add it, then run again." >&2; exit 1; }
git rev-parse -q --verify "refs/tags/$tag" >/dev/null || { echo "publish-release: tag $tag is not in this checkout; run git fetch --tags." >&2; exit 1; }
if gh release view "$tag" >/dev/null 2>&1; then
  gh release edit "$tag" --title "$tag" --notes "$notes" ${latest:+--latest}
else
  gh release create "$tag" --verify-tag --title "$tag" --notes "$notes" $([[ -n "$latest" ]] && echo --latest || echo --latest=false)
fi
echo "published $tag"
