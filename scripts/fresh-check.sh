#!/usr/bin/env bash
# Intent: tell a session at once when its checkout is stale, so nobody reads old code.
# Prints one line. Exit 0 when HEAD is within 20 commits and 12 hours of the newest main (GitHub main or the lander's pipeline main), exit 1 when not.
# Usage: bash scripts/fresh-check.sh   (FRESH_NO_FETCH=1 skips the fetch)
set -u
cd "$(dirname "$0")/.."
if [ "${FRESH_NO_FETCH:-0}" != 1 ]; then
  git -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=15 fetch -q origin main 2>/dev/null \
    || echo "fresh-check: could not fetch origin (using the last fetched main)"
fi
ref=origin/main
git rev-parse -q --verify origin/main >/dev/null || { echo "fresh-check: no origin/main here. Run: git fetch origin main"; exit 1; }
# The lander can hold commits that are not on GitHub yet; use whichever main is ahead.
if git rev-parse -q --verify 'refs/pipeline/main^{commit}' >/dev/null && git merge-base --is-ancestor origin/main refs/pipeline/main 2>/dev/null; then ref=refs/pipeline/main; fi
behind=$(git rev-list --count HEAD.."$ref")
base=$(git merge-base HEAD "$ref")
age=$(( ( $(git log -1 --format=%ct "$ref") - $(git log -1 --format=%ct "$base") ) / 3600 ))
if [ "$behind" -gt 20 ] || [ "$age" -gt 12 ]; then
  echo "fresh-check: STALE, this checkout is $behind commits and ${age}h behind main. Start a new worktree (bash scripts/wt.sh start) or, if this branch has no work, git merge --ff-only $ref before reading code."
  exit 1
fi
echo "fresh-check: ok, $behind commits and ${age}h behind main"
