#!/usr/bin/env bash
# RUSH-SHIP-01 (owner rule, 2026-11-10) and SHIP-NOW-01 (owner standing approval, 2026-11-11, see scripts/ship-now.sh).
# Skips the lander queue and its 14 minute safety-surface tests and the watcher wait:
#   1. take the push lock (one rush at a time, machine-wide), fetch, rebase this worktree's branch onto origin/main
#   2. BOOT-CHECK the rebased commit BEFORE anything is pushed (2026-11-11: a commit whose entry crashed sat on main because the check ran after the push)
#   3. push HEAD to main (a non-fast-forward means someone pushed first: rebase and boot-check again, up to 5 tries)
#   4. ship.sh <sha> --before-green (it waits its turn on the machine-wide ship lock, boot-checks again when HEAD is the commit, installs, rolls back on failure)
# Use it when Jesse said "rush ship" / "ship now" in that turn, or under his standing ship-now approval (scripts/ship-now.sh).
# Run it from your own worktree, tree clean, branch committed. It refuses a diff that touches docs/design/RULES.md (only Jesse changes a rule) or a
# safety, auth or credential file (the T2 list in scripts/wt.sh minus the pipeline scripts), unless MAIPAI_RUSH_SAFETY_OK=1 (Jesse said so in that turn).
# It records the skipped gate in data-scratch/ship/rush.jsonl. The watcher still tests main afterwards; if it goes red, fix forward at once.
set -euo pipefail
[[ "${1:-}" == --owner-asked ]] || { echo "usage: bash scripts/rush-ship.sh --owner-asked   (only when Jesse asked for a rush ship in this turn, or via scripts/ship-now.sh)" >&2; exit 2; }
git diff --quiet && git diff --cached --quiet || { echo "rush-ship: commit your changes first (tree is dirty)." >&2; exit 1; }
common="$(git rev-parse --git-common-dir)"; [[ "$common" = /* ]] || common="$(cd "$common" && pwd -P)"
main="$(cd "$(dirname "$common")" && pwd -P)"
[[ -f "$main/data-scratch/bin/https-git.env" ]] && source "$main/data-scratch/bin/https-git.env"
branch="$(git rev-parse --abbrev-ref HEAD)"
[[ "$branch" != main && "$branch" != HEAD ]] || { echo "rush-ship: run it from your own worktree branch, not main." >&2; exit 1; }

# One rush at a time: the lock covers rebase, boot check and push (about 30 s). A dead holder is cleared by pid.
lock="${MAIPAI_RUSH_LOCK:-$main/data-scratch/ship/rush.lock.d}"
mkdir -p "$(dirname "$lock")"
held=0
release() { if (( held )); then rm -rf "$lock"; held=0; fi; }
trap release EXIT
waited=0
until mkdir "$lock" 2>/dev/null; do
  owner="$(cat "$lock/pid" 2>/dev/null || true)"
  if [[ "$owner" =~ ^[0-9]+$ ]] && ! kill -0 "$owner" 2>/dev/null; then rm -rf "$lock"; continue; fi
  (( waited < 600 )) || { echo "rush-ship: another rush ($(cat "$lock/what" 2>/dev/null || echo unknown)) still holds the push lock after 600 s; wait for it and run again." >&2; exit 1; }
  (( waited % 20 )) || echo "rush-ship: waiting for another rush to finish ($(cat "$lock/what" 2>/dev/null || echo starting)); ${waited}s so far." >&2
  sleep 2; waited=$((waited + 2))
done
held=1; echo "$$" > "$lock/pid"; echo "$branch from $(hostname -s)" > "$lock/what"

# Safety, auth and credential files are not rushed (only Jesse decides those): the T2 globs minus the pipeline scripts.
t2="$(sed -n 's/^export WT_T2_GLOBS="\(.*\)"$/\1/p' scripts/wt.sh | head -n 1)"
guard_diff() {
  git diff --name-only origin/main..HEAD | grep -q '^docs/design/RULES.md$' && { echo "rush-ship: this diff edits docs/design/RULES.md; only Jesse changes a rule. Use the normal landing." >&2; return 1; }
  [[ "${MAIPAI_RUSH_SAFETY_OK:-}" == 1 ]] && return 0
  local f g re
  for f in $(git diff --name-only origin/main..HEAD); do
    for g in $t2; do
      case "$g" in docs/design/RULES.md|scripts/*) continue;; esac
      re="$(printf '%s' "$g" | sed -E 's/[][(){}.+?^$|\\]/\\&/g; s/\*/.*/g')"
      if printf '%s\n' "$f" | grep -Eq "^${re}$"; then echo "rush-ship: $f is a safety, auth or credential file; those need Jesse's word in that turn (MAIPAI_RUSH_SAFETY_OK=1) or the normal landing." >&2; return 1; fi
    done
  done
}

sha=""
for attempt in 1 2 3 4 5; do
  git fetch -q origin main
  git rebase origin/main || { echo "rush-ship: rebase conflict. Resolve it (generated files: take main's, rerun the generator), git rebase --continue, rerun." >&2; exit 1; }
  guard_diff || exit 1
  sha="$(git rev-parse HEAD)"
  if [[ "${MAIPAI_SKIP_BOOT_CHECK:-}" != 1 && -f scripts/boot-check.sh ]]; then
    bash scripts/boot-check.sh || { echo "rush-ship: ${sha:0:7} does not boot; nothing was pushed or installed. Fix it and run again." >&2; exit 1; }
  fi
  if git push origin HEAD:main 2>/tmp/rush-push.$$; then rm -f /tmp/rush-push.$$; break; fi
  echo "rush-ship: push refused (main moved, attempt $attempt of 5); rebasing and checking again." >&2; cat /tmp/rush-push.$$ >&2; rm -f /tmp/rush-push.$$; sha=""
done
[[ -n "$sha" ]] || { echo "rush-ship: could not push after 5 tries; run it again." >&2; exit 1; }
mkdir -p "$main/data-scratch/ship"
printf '{"ts":"%s","branch":"%s","sha":"%s","note":"rush ship: lander safety tests and watcher skipped at the owner request; boot check passed before the push"}\n' "$(date -u +%FT%TZ)" "$branch" "$sha" >> "$main/data-scratch/ship/rush.jsonl"
release   # the push lock is only for rebase, boot check and push; ship.sh takes its own lock
bash scripts/ship.sh "$sha" --before-green
