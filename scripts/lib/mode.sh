#!/bin/bash
# MODE-01 (2026-11-12): the one definition of the operating mode, sourced by land.sh, lander.sh, ship.sh, rush-ship.sh, dev.sh and pipeline.sh.
#   direct  DIRECT: run first, checked after. Nobody is on the hub, data is disposable. Landings use the express lane and wait for no check (the watcher typechecks and boots the landed main after), ship-now is allowed
#           before green, safety-surface (T2) tests do not hold a landing (the nightly runs them), the workbench hub is allowed.
#   gated   GATED: checked first, then run. The family is on the hub. Normal landings with their safety tests, no express lane, no
#           --before-green ship, a ship needs a watcher green run or `stable`, and a change to a safety surface ships only once `stable` holds it.
#   (unset) the pipeline as it was before the switch; nothing in this file changes it.
# State lives in one file, data-scratch/mode of the main checkout (MAIPAI_MODE_FILE moves it; MAIPAI_MODE=direct|gated overrides it, for tests).
mode_main() {
  local c; c="$(git -C "${1:-$(dirname "${BASH_SOURCE[0]}")}" rev-parse --git-common-dir 2>/dev/null)" || return 1
  [[ "$c" = /* ]] || c="$(cd "${1:-$(dirname "${BASH_SOURCE[0]}")}" && cd "$c" && pwd -P)"
  (cd "$(dirname "$c")" && pwd -P)
}
mode_file() { printf '%s' "${MAIPAI_MODE_FILE:-$(mode_main)/data-scratch/mode}"; }
mode_get() {
  local v="${MAIPAI_MODE:-}"
  [[ -n "$v" ]] || v="$(tr -d '[:space:]' <"$(mode_file)" 2>/dev/null || true)"
  case "$v" in direct|gated) echo "$v" ;; *) echo unset ;; esac
}
mode_line() {
  case "$(mode_get)" in
    direct) echo "DIRECT: run first, checked after (a landing waits for no check; typecheck, boot check and tests run after it)" ;;
    gated) echo "GATED: checked first, then run" ;;
    *) echo "mode: not set (the pipeline runs as it did before the switch; bash scripts/mode.sh direct|gated sets it)" ;;
  esac
}
