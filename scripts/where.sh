#!/usr/bin/env bash
# Where is a change? Prints, in plain words, whether a commit is only local, on GitHub main, in a
# release tag, and on the live hub, and which newer GitHub commits the hub lacks.
# usage: bash scripts/where.sh [<sha>]   (default: HEAD)
set -euo pipefail
sha="$(git rev-parse --verify "${1:-HEAD}^{commit}" 2>/dev/null)" || { echo "where.sh: '${1:-HEAD}' is not a commit here. Pass a sha or branch name." >&2; exit 1; }
live="${MAIPAI_SHIP_LIVE:-/usr/local/maipai-home}"
git fetch -q origin main 2>/dev/null || echo "where.sh: could not fetch GitHub; using the last known origin/main." >&2
short="$(git rev-parse --short "$sha")"
echo "Change $short: $(git log -1 --format=%s "$sha" | cut -c1-80)"
if git merge-base --is-ancestor "$sha" origin/main 2>/dev/null; then echo "GitHub main: yes"; else echo "GitHub main: NO (only in a branch or worktree: $(git branch --contains "$sha" --format='%(refname:short)' | head -3 | paste -sd, -))"; fi
tags="$(git tag --contains "$sha" 2>/dev/null | head -3 | paste -sd, -)"
echo "Release tag: ${tags:-none}"
tagfile="$live/.installed-tag"
if [[ ! -f "$tagfile" ]]; then echo "Live hub: unknown ($tagfile not found)"; exit 0; fi
installed="$(tr -d '[:space:]' < "$tagfile")"
case "$installed" in sha-*) hubsha="$(git rev-parse --verify "${installed#sha-}^{commit}" 2>/dev/null || true)";; *) hubsha="$(git rev-parse --verify "$installed^{commit}" 2>/dev/null || true)";; esac
if [[ -z "$hubsha" ]]; then echo "Live hub: runs $installed (commit not found here; fetch and retry)"; exit 0; fi
if git merge-base --is-ancestor "$sha" "$hubsha"; then echo "Live hub: yes (runs $installed)"; else echo "Live hub: NO (runs $installed)"; fi
lack="$(git rev-list --count "$hubsha..origin/main")"
if [[ "$lack" == 0 ]]; then echo "Hub matches GitHub main."; else echo "Hub lacks $lack newer GitHub commits, newest:"; git log --format='  %h %s' -5 "$hubsha..origin/main" | cut -c1-100; fi
