#!/usr/bin/env bash
# RUSH-SHIP-01 (owner rule, 2026-11-10), SHIP-NOW-01 (owner standing approval, 2026-11-11, see scripts/ship-now.sh) and SINGLE-WRITER-01
# (2026-11-12). The lander is the only process that pushes main to GitHub, so a rush ship no longer pushes anything itself:
#   1. bash scripts/land.sh --express: the lander takes this branch at its next phase boundary (it waits for the current lander operation and
#      delays other queued work), rebases it on the landed main, refuses docs/design/RULES.md and (without MAIPAI_RUSH_SAFETY_OK=1) safety,
#      auth and credential files, typechecks the changed workspaces, boot-checks the exact rebased commit, runs NO test suite, moves main and
#      pushes it to GitHub before it answers. What it proves: "starts and typechecks on top of main". It is never called tested.
#   2. bash scripts/ship.sh <that exact commit> --before-green: the commit that was checked and pushed is the commit that is installed.
# Use it when Jesse said "rush ship" / "ship now" in that turn, or under his standing ship-now approval (scripts/ship-now.sh). Run it from
# your own worktree, tree clean, branch committed. It records the skipped tests in data-scratch/ship/rush.jsonl. The watcher still tests
# main afterwards; if it goes red, fix forward at once.
set -euo pipefail
[[ "${1:-}" == --owner-asked ]] || { echo "usage: bash scripts/rush-ship.sh --owner-asked   (only when Jesse asked for a rush ship in this turn, or via scripts/ship-now.sh)" >&2; exit 2; }
git diff --quiet && git diff --cached --quiet || { echo "rush-ship: commit your changes first (tree is dirty)." >&2; exit 1; }
common="$(git rev-parse --git-common-dir)"; [[ "$common" = /* ]] || common="$(cd "$common" && pwd -P)"
main="$(cd "$(dirname "$common")" && pwd -P)"
branch="$(git rev-parse --abbrev-ref HEAD)"
[[ "$branch" == wt/* ]] || { echo "rush-ship: run it from your own wt/* worktree branch, not $branch." >&2; exit 1; }

out="$(mktemp "${TMPDIR:-/tmp}/rush-ship.XXXXXX")"
trap 'rm -f "$out"' EXIT
rc=0
bash scripts/land.sh --express "$@" 2>&1 | tee "$out" || rc=${PIPESTATUS[0]}
(( rc == 0 )) || { echo "rush-ship: the express landing did not land (see above); nothing was installed." >&2; exit "$rc"; }
sha="$(sed -n 's/^landed-sha: \([0-9a-f]\{40\}\)$/\1/p' "$out" | tail -n 1)"
[[ -n "$sha" ]] || { echo "rush-ship: the lander did not name the landed commit; run bash scripts/pipeline.sh status, then ship.sh <sha> --before-green." >&2; exit 1; }
mkdir -p "$main/data-scratch/ship"
printf '{"ts":"%s","branch":"%s","sha":"%s","note":"rush ship through the express lane: starts and typechecks on top of main; no tests run before the install"}\n' "$(date -u +%FT%TZ)" "$branch" "$sha" >> "$main/data-scratch/ship/rush.jsonl"
bash scripts/ship.sh "$sha" --before-green
