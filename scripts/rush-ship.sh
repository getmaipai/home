#!/usr/bin/env bash
# RUSH-SHIP-01 (owner rule, 2026-11-10): the owner's "rush ship" / "skip the safety tests" path.
# Use ONLY when Jesse asks for it in that turn (words like "rush ship", "ship now, skip the safety tests").
# It skips the lander queue and its 14 minute safety-surface tests and the watcher wait:
#   1. fetch, rebase this worktree's branch onto origin/main (stops on a conflict; resolve it, then rerun)
#   2. push HEAD to main directly
#   3. ship.sh <sha> --before-green
# Run it from your own worktree, tree clean, branch committed.
# It refuses a diff that touches docs/design/RULES.md (only Jesse changes a rule, and that needs Owner-approved in the commit).
# It records the skipped gate in data-scratch/ship/rush.jsonl so the next session knows main was not tested by the lander.
# The watcher still tests main afterwards; if it goes red, fix forward at once.
set -euo pipefail
[[ "${1:-}" == --owner-asked ]] || { echo "usage: bash scripts/rush-ship.sh --owner-asked   (only when Jesse asked for a rush ship in this turn)" >&2; exit 2; }
git diff --quiet && git diff --cached --quiet || { echo "rush-ship: commit your changes first (tree is dirty)." >&2; exit 1; }
common="$(git rev-parse --git-common-dir)"; [[ "$common" = /* ]] || common="$(cd "$common" && pwd -P)"
main="$(cd "$(dirname "$common")" && pwd -P)"
[[ -f "$main/data-scratch/bin/https-git.env" ]] && source "$main/data-scratch/bin/https-git.env"
branch="$(git rev-parse --abbrev-ref HEAD)"
[[ "$branch" != main && "$branch" != HEAD ]] || { echo "rush-ship: run it from your own worktree branch, not main." >&2; exit 1; }
git fetch -q origin main
git rebase origin/main || { echo "rush-ship: rebase conflict. Resolve it (generated files: take main's, rerun the generator), git rebase --continue, rerun." >&2; exit 1; }
if git diff --name-only origin/main..HEAD | grep -q '^docs/design/RULES.md$'; then
  echo "rush-ship: this diff edits docs/design/RULES.md; only Jesse changes a rule. Use the normal landing." >&2; exit 1
fi
sha="$(git rev-parse HEAD)"
git push origin HEAD:main
mkdir -p "$main/data-scratch/ship"
printf '{"ts":"%s","branch":"%s","sha":"%s","note":"rush ship: lander safety tests and watcher skipped at the owner request"}\n' "$(date -u +%FT%TZ)" "$branch" "$sha" >> "$main/data-scratch/ship/rush.jsonl"
bash scripts/ship.sh "$sha" --before-green
