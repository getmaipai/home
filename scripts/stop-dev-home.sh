#!/usr/bin/env bash
# Stops a development Home started from the MAIN checkout (bun start with MAIPAI_MAIN_CHECKOUT=1, port 8787) so the Home installer can run.
# Such a hub holds the per-user hub lock and 8787, blocked the live Home installer three times on 2026-10-23 and each time took the live hub
# down for minutes. scripts/release-home.sh calls this BEFORE it asks the installer to stop the live service.
#
# A process is stopped only when ALL of these hold: it is this user's, it is the lock file's pid or listens on the dev port, its command
# runs src/index.ts, and its working directory is inside the MAIN checkout (a folder whose .git is a directory; a worktree's .git is a
# file) and not the installed hub. The environment (MAIPAI_MAIN_CHECKOUT=1) is not read: macOS no longer shows another process's
# environment, and a hub in the main checkout is the one that takes 8787 either way. Anything else is left alone. It gets TERM, then up to 10 seconds to exit; it is never killed harder, and if it stays up this exits 1 and says so.
# Usage: scripts/stop-dev-home.sh [--lock-file PATH] [--port N] [--live DIR] [--wait SECONDS]
set -uo pipefail
LOCK="${MAIPAI_HUB_LOCK_PATH:-$HOME/.maipai/home/hub.lock}"; PORT=8787; LIVE=/usr/local/maipai-home; WAIT=10
while [[ $# -gt 0 ]]; do
  case "$1" in
    --lock-file) shift; LOCK="${1:-}";; --port) shift; PORT="${1:-}";; --live) shift; LIVE="${1:-}";; --wait) shift; WAIT="${1:-10}";;
    *) echo "Unknown option $1. See the usage at the top of scripts/stop-dev-home.sh." >&2; exit 2;;
  esac; shift
done
LIVE="$(cd "$LIVE" 2>/dev/null && pwd -P || printf %s "$LIVE")"
candidates=()
if [[ -f "$LOCK" ]]; then
  pid="$(sed -n 's/.*"pid"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$LOCK" | head -1)"
  [[ -z "$pid" ]] || candidates+=("$pid")
fi
while read -r pid; do [[ -z "$pid" ]] || candidates+=("$pid"); done < <(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null | sort -u)
stopped=0
declare -a seen=()
for pid in "${candidates[@]+"${candidates[@]}"}"; do
  [[ " ${seen[*]-} " == *" $pid "* ]] && continue; seen+=("$pid")
  kill -0 "$pid" 2>/dev/null || continue
  [[ "$(ps -p "$pid" -o user= 2>/dev/null | tr -d ' ')" == "$(id -un)" ]] || continue
  line="$(ps -ww -p "$pid" -o command= 2>/dev/null || true)"
  [[ "$line" == *"src/index.ts"* ]] || continue
  cwd="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1)"
  [[ -n "$cwd" && "$cwd" != "$LIVE" && "$cwd" != "$LIVE"/* ]] || continue
  root="${cwd%/backend}"
  [[ -d "$root/.git" ]] || continue
  kill -TERM "$pid" 2>/dev/null || continue
  for ((i = 0; i < WAIT * 10; i++)); do kill -0 "$pid" 2>/dev/null || break; sleep 0.1; done
  if kill -0 "$pid" 2>/dev/null; then
    echo "The development Home in ${cwd} (pid ${pid}) did not stop within ${WAIT} seconds. Run \"bun stop\" there, then run this again. Nothing else was touched." >&2
    exit 1
  fi
  echo "Stopped the development Home that was running from ${cwd} (pid ${pid}) because it blocks the installer. Restart it afterwards with \"bun start\" in that folder."
  stopped=1
done
exit 0
