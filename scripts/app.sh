#!/usr/bin/env bash
# Local source-checkout lifecycle. Installed services use their OS manager.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
state="$root/data/local-app"
entry="$root/backend/src/index.ts"
umask 077
mkdir -p "$state"
if ! mkdir "$state/lock" 2>/dev/null; then
  echo "Another start or stop is running: $state/lock" >&2
  exit 1
fi
trap 'rmdir "$state/lock"' EXIT

running() {
  [ -f "$state/pid" ] || return 1
  read -r pid < "$state/pid"
  case "$pid" in ''|*[!0-9]*) return 1 ;; esac
  [ "$pid" -gt 1 ] || return 1
  kill -0 "$pid" 2>/dev/null || return 1
  # Refuse to signal a reused PID belonging to another command.
  local command
  command="$(ps -p "$pid" -o command=)" || return 1
  [[ "$command" == *"bun $entry" ]]
}

print_urls() {
  awk '
    /^Home URL: / { sub(/^Home URL: /, "  "); pending = pending $0 "\n" }
    /^Home server ready\.$/ { latest = pending; pending = "" }
    END { printf "%s", latest }
  ' "$state/app.log"
}

case "${1:-}" in
  start)
    if running; then
      ready_count=$(grep -c '^Home server ready\.$' "$state/app.log" || true)
      kill -USR1 "$pid"
      for ((attempt=0; attempt<50; attempt++)); do
        if [ "$(grep -c '^Home server ready\.$' "$state/app.log" || true)" -gt "$ready_count" ]; then break; fi
        sleep 0.1
      done
      echo "Home is already running (PID $pid)."
      print_urls
      exit 0
    fi
    rm -f "$state/pid"
    (cd "$root/frontend" && bun run build)
    cd "$root/backend"
    nohup bun "$entry" </dev/null >"$state/app.log" 2>&1 &
    pid=$!
    echo "$pid" > "$state/pid"
    sleep 1
    for ((attempt=0; attempt<60; attempt++)); do
      running || break
      if grep -q '^Home server ready\.$' "$state/app.log"; then break; fi
      sleep 1
    done
    if ! running; then
      rm -f "$state/pid"
      echo "Home exited during startup. Check $state/app.log" >&2
      exit 1
    fi
    if ! grep -q '^Home server ready\.$' "$state/app.log"; then
      echo "Home is still starting (PID $pid). Check $state/app.log" >&2
      exit 1
    fi
    echo "Home started (PID $pid). Open:"
    print_urls
    echo "Log: $state/app.log"
    ;;
  stop)
    if ! running; then
      rm -f "$state/pid"
      echo "Home is already stopped (no managed process)."
      exit 0
    fi
    kill -TERM "$pid"
    for ((attempt=0; attempt<30; attempt++)); do
      if ! running; then
        rm -f "$state/pid"
        echo "Home stopped."
        exit 0
      fi
      sleep 1
    done
    echo "Home has not stopped after 30 seconds. Check $state/app.log" >&2
    exit 1
    ;;
  *)
    echo "Usage: bun start | bun stop | bun restart" >&2
    exit 2
    ;;
esac
