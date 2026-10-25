#!/usr/bin/env bash
# Worktree workflow for this repo (start, tmux, port, check, land, done, reap, tier).
# The logic is one shared script, getmaipai/.github standards/bin/wt.sh; this wrapper
# only says what is specific to this repo and runs it. The shared script is read from
# the sibling .github checkout's origin/main (never its working tree, which may be
# stale or mid-edit); `start` and `land` fetch it first. MAIPAI_WT_SHARED=<file>
# overrides the source.
set -euo pipefail

export WT_INSTALL_DIRS="backend frontend"
# T2 (full gate, review, architect) is the safety and auth surface only (GATE-FAST-01, 2026-10-16):
# everything else, pins and the turn pipeline included, is T1 (preflight plus the tests beside the change).
export WT_T2_GLOBS="docs/design/RULES.md backend/src/auth/* backend/src/credentials* backend/src/consent* backend/src/people/*child* backend/src/people/*teen* backend/src/db/migrations/*"
export WT_TEST_WORKSPACES="backend frontend scripts"
export WT_PIN_REMINDER="a pin changed; run bun install --force in backend and frontend, then bun restart, in the main checkout to make it live."
common="$(git rev-parse --git-common-dir)"
case "$common" in /*) ;; *) common="$(cd "$common" && pwd)" ;; esac
std="$(cd "$common/.." && pwd)/../.github"

if [[ -n "${MAIPAI_WT_SHARED:-}" ]]; then exec bash "$MAIPAI_WT_SHARED" "$@"; fi
[[ -d "$std/.git" || -f "$std/.git" ]] || { echo "wt: getmaipai/.github is missing at $std; clone it next to this repo and retry." >&2; exit 1; }
case "${1:-}" in start|land) git -C "$std" fetch -q origin main 2>/dev/null || echo "wt: could not fetch .github; using its last known origin/main." >&2;; esac
shared="$(mktemp)"
trap 'rm -f "$shared"' EXIT
git -C "$std" show origin/main:standards/bin/wt.sh > "$shared" 2>/dev/null || { echo "wt: .github has no standards/bin/wt.sh on origin/main; fetch it and retry." >&2; exit 1; }
bash "$shared" "$@"
