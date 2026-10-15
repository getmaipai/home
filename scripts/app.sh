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

# SINGLE-INSTANCE-01 (#194): a hub this script did not start (run by hand,
# or left over from another checkout) can hold the port. Without this,
# stop said "already stopped" and start launched a copy that could not
# bind. Report the holder plainly so nobody has to hunt for it.
#
# SINGLE-INSTANCE-02 (#196): at most one hub per machine, whatever its data
# directory or port. The hub records itself in a machine-wide lock file
# (backend/src/lib/instanceLock.ts, hubLockPath), so a hub on another port or
# another data directory is found there first; the port check stays as the
# fallback for a hub old enough to predate the lock.
# PORTS-01 (workflow step 11): 8787 belongs to the main checkout's hub. A
# worktree leases a port from `wt.sh port` (8800-8899), remembers it in
# $state/port so stop and restart find the same hub, and keeps its own
# machine lock beside its own data directory so it never fights the main hub.
# MAIPAI_MAIN_CHECKOUT=1 lets a worktree take 8787 on purpose.
in_worktree=0
git_dir=""
git_common=""
if git -C "$root" rev-parse --git-dir >/dev/null 2>&1; then
  git_dir="$(git -C "$root" rev-parse --path-format=absolute --git-dir 2>/dev/null || true)"
  git_common="$(git -C "$root" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"
  if [ -n "$git_dir" ] && [ "$git_dir" != "$git_common" ] && [ "${MAIPAI_MAIN_CHECKOUT:-}" != "1" ]; then
    in_worktree=1
  fi
fi
port_file="$state/port"
lease_dir="$(dirname "${git_common:-$root/.git}")/data-scratch/ports"
[ -z "${MAIPAI_WT_DATA:-}" ] || lease_dir="$MAIPAI_WT_DATA/ports"
if [ "$in_worktree" = 1 ]; then
  : "${MAIPAI_HUB_LOCK_PATH:=$state/hub.lock}"
  export MAIPAI_HUB_LOCK_PATH
  port="${PORT:-}"
  if [ -z "$port" ] && [ -f "$port_file" ]; then read -r port < "$port_file" || true; fi
  case "$port" in ''|*[!0-9]*) port=0 ;; esac
else
  port="${PORT:-8787}"
fi
lock_file="${MAIPAI_HUB_LOCK_PATH:-$HOME/.maipai/home/hub.lock}"
lock_num() { grep -o "\"$1\":[0-9]*" "$lock_file" 2>/dev/null | head -n 1 | sed 's/^[^:]*://' || true; }
lock_str() { grep -o "\"$1\":\"[^\"]*\"" "$lock_file" 2>/dev/null | head -n 1 | sed 's/^[^:]*:"//; s/"$//' || true; }

lock_holder() {
  [ -f "$lock_file" ] || return 1
  local lpid lcommand
  lpid="$(lock_num pid)"
  case "$lpid" in ''|*[!0-9]*) return 1 ;; esac
  [ "$lpid" -gt 1 ] || return 1
  kill -0 "$lpid" 2>/dev/null || return 1
  # A reused pid belonging to something that is not a hub is not a holder.
  lcommand="$(ps -p "$lpid" -o command= 2>/dev/null || true)"
  [[ "$lcommand" == *bun* && "$lcommand" == *index.ts* ]] || return 1
  holder="$lpid"
  return 0
}

foreign_hub() {
  holder=""
  lock_holder && return 0
  # Prefer the socket table, not a machine-wide `lsof -i` scan. Some macOS
  # environments return an empty netstat table even for a listening socket;
  # in that case, ask lsof only about this port.
  if [ "$(uname -s)" = "Darwin" ]; then
    holder="$(netstat -anv -p tcp 2>/dev/null | awk -v p="$port" '
      $6 == "LISTEN" && $4 ~ ("[.:]" p "$") { n = split($11, a, ":"); print a[n]; exit }' || true)"
    if [ -z "$holder" ] && command -v lsof >/dev/null 2>&1; then
      holder="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null | head -n 1 || true)"
    fi
  elif command -v ss >/dev/null 2>&1; then
    holder="$(ss -ltnpH "sport = :$port" 2>/dev/null | sed -n 's/.*pid=\([0-9][0-9]*\).*/\1/p' | head -n 1 || true)"
  fi
  case "$holder" in ''|*[!0-9]*) return 1 ;; esac
  return 0
}

report_foreign_hub() {
  local cwd command data hub_port
  hub_port="$port"
  cwd="$(lsof -a -p "$holder" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1 || true)"
  command="$(ps -p "$holder" -o command= 2>/dev/null || true)"
  data="$(ps eww -p "$holder" -o command= 2>/dev/null | grep -o 'MAIPAI_DATA_DIR=[^ ]*' | head -n 1 | sed 's/^MAIPAI_DATA_DIR=//' || true)"
  if [ -z "$data" ] && [ -f "$root/data/hub.lock" ] && grep -q "\"pid\":$holder[,}]" "$root/data/hub.lock"; then
    data="$root/data"
  fi
  # The machine lock, when it names this pid, is the authority: it records
  # the port and data directory the hub actually booted with.
  if [ "$(lock_num pid)" = "$holder" ]; then
    hub_port="$(lock_num port)"
    data="$(lock_str dataDir)"
    cwd="$(lock_str cwd)"
  fi
  [ -n "$data" ] || data="not set in its environment (an older hub uses <its working directory>/../data)"
  if [ "$(lock_num pid)" = "$holder" ]; then
    echo "A Home hub is already running as PID $holder (port $hub_port), which this script did not start." >&2
    echo "Only one hub runs per machine, whatever its data directory or port." >&2
  else
    echo "Port $port is held by PID $holder, which this script did not start." >&2
  fi
  echo "  command:           ${command:-unknown}" >&2
  echo "  working directory: ${cwd:-unknown}" >&2
  echo "  data directory:    $data" >&2
  echo "To stop it: kill $holder" >&2
  echo "Then run this command again. Nothing was changed." >&2
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
    if [ "$in_worktree" = 1 ]; then
      if [ "${PORT:-}" = "8787" ]; then
        echo "Port 8787 belongs to the main checkout's hub, and this is a worktree ($root)." >&2
        echo "Run bun start without PORT to lease a free 88xx port, or set MAIPAI_MAIN_CHECKOUT=1 to take 8787 on purpose. Nothing was changed." >&2
        exit 1
      fi
      if [ -z "${PORT:-}" ]; then
        port="$(cd "$root" && MAIPAI_WT_PID="$$" bash scripts/wt.sh port)" || {
          echo "Could not lease a port from scripts/wt.sh port. Free a stale 88xx server, then run bun start again." >&2
          exit 1
        }
      fi
      echo "$port" > "$port_file"
      export PORT="$port"
    fi
    if foreign_hub; then
      report_foreign_hub
      exit 1
    fi
    (cd "$root/frontend" && bun run build)
    cd "$root/backend"
    nohup bun "$entry" </dev/null >"$state/app.log" 2>&1 &
    pid=$!
    echo "$pid" > "$state/pid"
    if [ "$in_worktree" = 1 ] && [ -f "$lease_dir/$port.lease" ]; then
      # The lease named this script's pid; hand it to the hub so it lives as long as the hub.
      read -r _ lease_session < "$lease_dir/$port.lease" || true
      echo "$pid $lease_session" > "$lease_dir/$port.lease"
    fi
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
      if [ "$in_worktree" = 1 ]; then
        rm -f "$lease_dir/$port.lease" "$port_file"
      fi
      if foreign_hub; then
        report_foreign_hub
        exit 1
      fi
      echo "Home is already stopped (no managed process)."
      exit 0
    fi
    kill -TERM "$pid"
    for ((attempt=0; attempt<30; attempt++)); do
      if ! running; then
        rm -f "$state/pid"
        if [ "$in_worktree" = 1 ]; then
          rm -f "$lease_dir/$port.lease" "$port_file"
        fi
        echo "Home stopped."
        exit 0
      fi
      sleep 1
    done
    echo "Home has not stopped after 30 seconds. Check $state/app.log" >&2
    exit 1
    ;;
  pull)
    # bun restart runs this first. Only the main checkout is the runtime that
    # follows origin; a worktree restarts its own code as it is. A directory
    # that is not a Git checkout (a test fixture, an unpacked release) is left alone.
    if [ "$in_worktree" = 1 ] || ! git -C "$root" rev-parse --git-dir >/dev/null 2>&1; then
      exit 0
    fi
    if ! git -C "$root" pull --ff-only; then
      echo "Restart stopped before touching the running hub: $root could not fast-forward to origin." >&2
      echo "It has local commits or edits that conflict with origin/main. Inspect it with git -C $root status, move that work into a worktree, then run bun restart again." >&2
      exit 1
    fi
    ;;
  *)
    echo "Usage: bun start | bun stop | bun restart" >&2
    exit 2
    ;;
esac
