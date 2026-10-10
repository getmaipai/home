#!/usr/bin/env bash
# Fails when a tracked file at the repo root looks like a lane report or leftover artifact.
# Reports belong in data-scratch/reports/ (git-ignored). Run alone or from check.sh.
set -euo pipefail
cd "$(dirname "$0")/.."
bad="$(git ls-files | grep -E '^[^/]+$' | grep -Ei '(report|draft)[^/]*\.md$|\.(patch|orig|bak|rej|log)$|^codex-' || true)"
if [ -n "$bad" ]; then
  echo "stray-files-check: these tracked root files look like lane reports or leftovers:"
  echo "$bad"
  echo "Move each into data-scratch/reports/ and run 'git rm --cached' on it, then commit the removal."
  exit 1
fi
echo "stray-files-check: no stray root files"
