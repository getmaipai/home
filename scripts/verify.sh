#!/usr/bin/env bash
# Intent: ONE command that proves a change before landing. Prints one result line; the exit code is the verdict (0 pass, 1 fail). Full output goes to data-scratch/runs/verify-<mode>.log.
# Usage: bash scripts/verify.sh <code|ui|docs>
#   code  typecheck of each workspace the change touches (backend tsc; frontend tsc and eslint), tests that cover the changed files (scripts/test-changed.sh), then check.sh --pre (secrets, PII, drift)
#   ui    frontend tsc and eslint, the UI rule lints (bun run lint:ui-rules), then the changed-file tests. Still open the change in bun run dev yourself.
#   docs  bash scripts/check.sh --docs
# A step that fails only on a problem listed in scripts/verify-known.txt is skipped loudly, never silently.
# Name the mode in the commit message (`Test: bash scripts/verify.sh code`). Landing (scripts/land.sh) still runs the static check, the watcher runs the suites.
# Placement: repo gate. Upstream: none.
set -u
MODE="${1:-}"
cd "$(dirname "$0")/.."
case "$MODE" in code|ui|docs) ;; *) echo "verify: pass one mode: code, ui or docs. Example: bash scripts/verify.sh code"; exit 2 ;; esac
mkdir -p data-scratch/runs
LOG="data-scratch/runs/verify-$MODE.log"; : > "$LOG"
ref=origin/main; git rev-parse -q --verify 'refs/pipeline/main^{commit}' >/dev/null && git merge-base --is-ancestor origin/main refs/pipeline/main 2>/dev/null && ref=refs/pipeline/main
CHANGED=$( { git diff --name-only "$(git merge-base HEAD "$ref")" HEAD; git diff --name-only HEAD; git ls-files -o --exclude-standard; } | sort -u)
BACK=0; FRONT=0
echo "$CHANGED" | grep -q '^backend/' && BACK=1
echo "$CHANGED" | grep -q '^frontend/' && FRONT=1
SUMMARY=""; BEGAN=$SECONDS; SKIPS=0
step() {  # step NAME COMMAND...: output to the log; stops the run on failure
  local name="$1"; shift; local t=$SECONDS
  echo "=== $name: $*" >> "$LOG"
  if "$@" >> "$LOG" 2>&1; then SUMMARY="$SUMMARY $name $((SECONDS - t))s,"
  else
    local pat reason line known=""
    while IFS= read -r line; do
      case "$line" in ''|'#'*) continue ;; esac
      pat="${line%% => *}"; reason="${line#* => }"
      if tail -n 40 "$LOG" | grep -Eq "$pat"; then known="$reason"; break; fi
    done < scripts/verify-known.txt
    if [ -n "$known" ]; then
      SKIPS=$((SKIPS + 1)); SUMMARY="$SUMMARY $name KNOWN-SKIP,"
      echo "verify $MODE: KNOWN SKIP at $name (already on main, not this change): $known"
      return 0
    fi
    echo "verify $MODE: FAIL at $name ($((SECONDS - BEGAN))s). Last lines:"; tail -n 12 "$LOG" | cut -c1-240
    echo "verify $MODE: FAIL at $name. Full log: $LOG"; exit 1
  fi
}
case "$MODE" in
  code)
    [ $BACK = 1 ] && step backend-tsc bash -c "cd backend && bunx tsc --noEmit"
    [ $FRONT = 1 ] && step frontend-lint bash -c "cd frontend && bunx tsc --noEmit && bunx eslint ."
    step tests bash scripts/test-changed.sh
    step pre bash scripts/check.sh --pre
    ;;
  ui)
    step frontend-lint bash -c "cd frontend && bunx tsc --noEmit && bunx eslint ."
    step ui-rules bash -c "cd frontend && bun run lint:ui-rules"
    step tests bash scripts/test-changed.sh
    ;;
  docs)
    step docs bash scripts/check.sh --docs
    ;;
esac
echo "verify $MODE: PASS$([ "$SKIPS" -gt 0 ] && echo " WITH $SKIPS KNOWN SKIP (see above; scripts/verify-known.txt)") in $((SECONDS - BEGAN))s (${SUMMARY%,})"
grep "NO TESTS MAPPED" "$LOG" | head -1
exit 0
