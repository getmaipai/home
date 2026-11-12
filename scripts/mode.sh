#!/usr/bin/env bash
# MODE-01: the one-line switch between the two operating modes (scripts/lib/mode.sh has the definitions).
#   bash scripts/mode.sh direct | gated | status
# Direct: express lane for landings, ship-now before green, no held T2 landings, workbench hub allowed, data disposable.
# Gated: boot check, safety gates, backup before ship, safety-surface changes held until the nightly pass (`stable`).
# Switching changes no data and stops or starts no service; the scripts read the file each time they run.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
source "$here/lib/mode.sh"
case "${1:-status}" in
  direct|gated)
    f="$(mode_file)"; mkdir -p "$(dirname "$f")"
    printf '%s\n' "$1" >"$f.tmp.$$" && mv -f "$f.tmp.$$" "$f"
    MAIPAI_MODE= mode_line ;;
  status) mode_line ;;
  *) echo "usage: bash scripts/mode.sh direct | gated | status" >&2; exit 2 ;;
esac
