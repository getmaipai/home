#!/usr/bin/env bash
# Intent: run only the tests a change can affect, so a one-file change gets a verdict in seconds. Never replaces the lander's suites.
# Picks, for each changed backend or frontend source file: its same-name test, tests that import it, and rules in scripts/test-changed.map. Changed test files run as they are.
# Usage: bash scripts/test-changed.sh [--list] [file...]   (no files = changed vs the merge-base with main, plus uncommitted and new files)
# Prints one result line. Exit 0 pass (or nothing mappable: it says so, it never claims tested), 1 a test failed.
set -u
cd "$(dirname "$0")/.."
LIST=0; [ "${1:-}" = "--list" ] && { LIST=1; shift; }
if [ $# -gt 0 ]; then CHANGED=$(printf '%s\n' "$@")
else
  ref=origin/main; git rev-parse -q --verify 'refs/pipeline/main^{commit}' >/dev/null && git merge-base --is-ancestor origin/main refs/pipeline/main 2>/dev/null && ref=refs/pipeline/main
  CHANGED=$( { git diff --name-only "$(git merge-base HEAD "$ref")" HEAD; git diff --name-only HEAD; git ls-files -o --exclude-standard; } | sort -u)
fi
WIDE=""; TESTS=$(mktemp); trap 'rm -f "$TESTS"' EXIT
while IFS= read -r f; do
  [ -n "$f" ] || continue
  case "$f" in
    backend/*.test.ts|backend/*.test.tsx|frontend/*.test.ts|frontend/*.test.tsx) [ -f "$f" ] && echo "$f" >> "$TESTS"; continue ;;
    backend/*.ts|frontend/*.ts|frontend/*.tsx) ;;
    *) continue ;;
  esac
  case "$f" in *.d.ts) continue ;; esac
  stem="${f%.*}"; base="$(basename "$stem")"
  for t in "$stem.test.ts" "$stem.test.tsx"; do [ -f "$t" ] && echo "$t" >> "$TESTS"; done
  # tests in the workspace's tests/ folder named after the file
  for t in "backend/tests/$base.test.ts" "frontend/src/tests/$base.test.ts" "frontend/src/tests/$base.test.tsx"; do [ -f "$t" ] && echo "$t" >> "$TESTS"; done
  # tests that import it (path ends with /<base> in an import or require)
  # A file imported by more than 25 tests (app, schema, db) is "wide": only the same-name tests and the hand map run for it, and the line says so.
  hits=$(git grep -l -E "(from|import|require)[ (]*['\"][^'\"]*/${base}(\\.[jt]sx?)?['\"]" -- '*.test.ts' '*.test.tsx' 2>/dev/null)
  if [ "$(printf '%s\n' "$hits" | grep -c .)" -gt 25 ]; then WIDE="$WIDE $base"; else printf '%s\n' "$hits" | grep . >> "$TESTS"; fi
done <<< "$CHANGED"
while IFS= read -r line; do
  case "$line" in ''|'#'*) continue ;; esac
  prefix="${line%% => *}"; target="${line##* => }"
  echo "$CHANGED" | grep -q "^$prefix" && [ -e "$target" ] && echo "$target" >> "$TESTS"
done < scripts/test-changed.map
sort -u "$TESTS" -o "$TESTS"
if [ ! -s "$TESTS" ]; then echo "test-changed: NO TESTS MAPPED for this change (nothing run). The lander's suites still run at landing."; exit 0; fi
if [ "$LIST" = 1 ]; then cat "$TESTS"; exit 0; fi
mkdir -p data-scratch/runs; LOG=data-scratch/runs/test-changed.log; : > "$LOG"; BEGAN=$SECONDS; rc=0; n=$(wc -l < "$TESTS" | tr -d ' ')
for ws in backend frontend; do
  files=$(grep "^$ws/" "$TESTS" | sed "s#^$ws/##")
  [ -n "$files" ] || continue
  # shellcheck disable=SC2086
  (cd "$ws" && MAIPAI_TEST_NO_PORTS="${MAIPAI_TEST_NO_PORTS:-}" bun test $(echo $files | sed 's#\([^ ]*\)#./\1#g')) >> "$LOG" 2>&1 || rc=1
done
if [ $rc = 0 ]; then echo "test-changed: PASS $n test files in $((SECONDS - BEGAN))s${WIDE:+ (wide, import scan skipped for:$WIDE; the lander runs the suites)}"; else tail -n 15 "$LOG" | cut -c1-200; echo "test-changed: FAIL after $((SECONDS - BEGAN))s, log $LOG"; fi
exit $rc
