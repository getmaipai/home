#!/usr/bin/env bash
# Per-worktree hot-reload Home for the daily development loop.
# State and demo data live under data/dev; this never builds the frontend,
# takes a port lease, or uses the machine-wide app lock. Use `bun run dev`
# to start and `bun run dev:stop` to stop this checkout's development Home.
set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd -P)"
root="${MAIPAI_DEV_ROOT:-$(cd "$script_dir/.." && pwd -P)}"
state="$root/data/dev"
hub="$state/hub"
backend_pid_file="$state/backend.pid"
vite_pid_file="$state/vite.pid"
backend_log="$state/backend.log"
vite_log="$state/vite.log"
seed_marker="$state/seeded"
seed_output="$state/seed.json"
umask 077

action="${1:-}"
shift || true
port_override="${MAIPAI_DEV_PORT:-}"
stack_override="${MAIPAI_DEV_STACK_URL:-}"
no_stack=0
while (($#)); do
  case "$1" in
    --no-stack) no_stack=1; shift ;;
    --stack)
      if (($# < 2)) || [[ -z "$2" || "$2" == --* ]]; then
        echo "Missing URL after --stack. Pass --stack <url> or omit the option." >&2; exit 2
      fi
      stack_override="$2"; shift 2 ;;
    --port)
      if (($# < 2)) || [[ ! "$2" =~ ^[0-9]+$ ]]; then
        echo "Missing or invalid port after --port. Pass a number from 1 to 64535." >&2; exit 2
      fi
      port_override="$2"; shift 2 ;;
    *) echo "Unknown option: $1. Use --no-stack, --stack <url>, or --port <n>." >&2; exit 2 ;;
  esac
done

if [[ -n "$port_override" ]]; then
  if [[ ! "$port_override" =~ ^[0-9]+$ ]] || ((port_override < 1 || port_override > 64535)); then
    echo "Invalid development port '$port_override'. Pass a number from 1 to 64535." >&2; exit 2
  fi
  backend_port=$port_override
elif [[ -d "$root/.git" ]]; then
  backend_port=8787
elif [[ -f "$root/.git" ]]; then
  path_sum="$(cksum <<< "$root" | cut -d' ' -f1)"
  backend_port=$((8800 + path_sum % 100))
else
  echo "Cannot choose a development port because $root has no .git file or directory. Run this from a checkout." >&2; exit 1
fi
vite_port=$((backend_port + 1000))

mkdir -p "$state"

pid_value() {
  local file="$1" value
  [[ -f "$file" ]] || return 1
  IFS= read -r value < "$file" || true
  [[ "$value" =~ ^[0-9]+$ ]] && ((value > 1)) || return 1
  printf '%s' "$value"
}

process_command() { ps -p "$1" -o command= 2>/dev/null || true; }
live_backend() {
  local candidate command
  candidate="$(pid_value "$backend_pid_file" 2>/dev/null || true)"
  [[ -n "$candidate" ]] || return 1
  kill -0 "$candidate" 2>/dev/null || return 1
  command="$(process_command "$candidate")"
  [[ "$command" == *"src/index.ts"* && "$command" == *bun* ]] || return 1
  pid="$candidate"
}
live_vite() {
  local candidate command
  candidate="$(pid_value "$vite_pid_file" 2>/dev/null || true)"
  [[ -n "$candidate" ]] || return 1
  kill -0 "$candidate" 2>/dev/null || return 1
  command="$(process_command "$candidate")"
  [[ "$command" == *"vite"* || "$command" == *"bun run dev"* ]] || return 1
  pid="$candidate"
}
print_urls() {
  echo "Home: http://localhost:$vite_port"
  echo "API: http://127.0.0.1:$backend_port"
}
process_status() {
  local label="$1" file="$2" candidate command port
  if candidate="$(pid_value "$file" 2>/dev/null)" && kill -0 "$candidate" 2>/dev/null; then
    command="$(process_command "$candidate")"
    if [[ ( "$label" == backend && "$command" == *"src/index.ts"* && "$command" == *bun* ) || ( "$label" == vite && ( "$command" == *vite* || "$command" == *"bun run dev"* ) ) ]]; then
      port="$backend_port"; [[ "$label" == backend ]] || port="$vite_port"
      echo "$label: running (pid $candidate, port $port)"
      return 0
    fi
  fi
  echo "$label: stopped"
}
stop_one() {
  local label="$1" file="$2" candidate command
  candidate="$(pid_value "$file" 2>/dev/null || true)"
  if [[ -n "$candidate" ]] && kill -0 "$candidate" 2>/dev/null; then
    command="$(process_command "$candidate")"
    if [[ ( "$label" == backend && "$command" == *"src/index.ts"* && "$command" == *bun* ) || ( "$label" == vite && ( "$command" == *vite* || "$command" == *"bun run dev"* ) ) ]]; then
      kill -TERM "$candidate" 2>/dev/null || true
      for ((attempt=0; attempt<100; attempt++)); do
        if ! kill -0 "$candidate" 2>/dev/null; then break; fi
        sleep 0.1
      done
      if kill -0 "$candidate" 2>/dev/null; then
        echo "$label process $candidate did not stop within 10 seconds. Inspect $state and stop it manually before retrying." >&2
        return 1
      fi
    fi
  fi
  rm -f "$file"
}

case "$action" in
  port) echo "$backend_port" ;;
  url) print_urls ;;
  status)
    process_status backend "$backend_pid_file"
    process_status vite "$vite_pid_file"
    ;;
  stop)
    stop_one backend "$backend_pid_file"
    stop_one vite "$vite_pid_file"
    echo "Dev Home stopped."
    ;;
  reseed)
    stop_one backend "$backend_pid_file"
    stop_one vite "$vite_pid_file"
    rm -rf "$hub"
    rm -f "$seed_marker" "$seed_output"
    reseed_args=(start)
    ((no_stack == 0)) || reseed_args+=(--no-stack)
    [[ -z "$stack_override" ]] || reseed_args+=(--stack "$stack_override")
    [[ -z "$port_override" ]] || reseed_args+=(--port "$port_override")
    exec bash "$script_dir/dev.sh" "${reseed_args[@]}"
    ;;
  start)
    if live_backend; then
      echo "A development backend is already running (pid $pid)."
      print_urls
      exit 0
    fi
    rm -f "$backend_pid_file"
    if live_vite; then
      echo "A development frontend is already running (pid $pid). Stop it with bash scripts/dev.sh stop before starting again." >&2
      exit 1
    fi
    rm -f "$vite_pid_file"

    if [[ ! -d "$root/backend/node_modules" ]]; then
      if ! (cd "$root/backend" && bun install --frozen-lockfile); then
        echo "Dependency install failed in $root/backend. Fix the install error above, then run dev start again." >&2; exit 1
      fi
    fi
    if [[ ! -d "$root/frontend/node_modules" ]]; then
      if ! (cd "$root/frontend" && bun install --frozen-lockfile); then
        echo "Dependency install failed in $root/frontend. Fix the install error above, then run dev start again." >&2; exit 1
      fi
    fi

    stack_url=""
    if ((no_stack == 0)); then
      stack_url="${stack_override:-http://127.0.0.1:8770}"
      if ! curl -fsS -m 3 "$stack_url/stack/v1/roles" >/dev/null 2>&1; then
        echo "Stack not answering at $stack_url; starting without it (chat will say the engine is unavailable). Pass --stack <url> or --no-stack."
        stack_url=""
      fi
    fi

    was_seeded=0
    [[ -f "$seed_marker" ]] && was_seeded=1
    if ((was_seeded == 0)) && [[ -f "$hub/hub.db" ]]; then
      echo "Removing an unseeded data directory from an earlier failed start."
      rm -rf "$hub"
    fi
    mkdir -p "$hub"
    (
      cd "$root/backend"
      MAIPAI_TEST_ALLOW_MULTIPLE_HUBS=1 MAIPAI_MDNS=off MAIPAI_LAN_EXPOSURE=loopback PORT="$backend_port" \
        MAIPAI_DATA_DIR="$hub" MAIPAI_BACKUP_DIR="$hub/backups" MAIPAI_KEYSTORE_BACKEND=file \
        MAIPAI_TTS_DISABLE_SPAWN=1 MAIPAI_WYOMING_PORT=0 MAIPAI_BACKGROUND_URL=http://127.0.0.1:1 \
        MAIPAI_LLAMA_SERVER_URL= MAIPAI_EMBED_URL= MAIPAI_HUB_LOCK_PATH="$hub.lock" \
        nohup bun run --hot src/index.ts </dev/null >"$backend_log" 2>&1 &
      echo $! > "$backend_pid_file"
    )
    backend_pid="$(pid_value "$backend_pid_file")"
    ready=0
    for ((attempt=0; attempt<600; attempt++)); do
      if grep -q '^Home server ready\.$' "$backend_log" 2>/dev/null; then ready=1; break; fi
      if ! kill -0 "$backend_pid" 2>/dev/null; then break; fi
      sleep 0.1
    done
    if ((ready == 0)); then
      echo "Backend did not report ready within 60 seconds. Last backend log lines:" >&2
      tail -n 20 "$backend_log" >&2 || true
      echo "Inspect $backend_log, fix the startup error, then run dev start again." >&2
      exit 1
    fi
    if ((was_seeded == 0)); then
      seed_args=(run "$root/scripts/seed.ts" --base "http://127.0.0.1:$backend_port" --data-dir "$hub")
      [[ -z "$stack_url" ]] || seed_args+=(--stack "$stack_url")
      if ! (cd "$root" && bun "${seed_args[@]}" >"$seed_output" 2>"$state/seed.stderr"); then
        echo "Demo household seeding failed:" >&2
        cat "$state/seed.stderr" >&2 || true
        echo "The backend remains running; inspect $backend_log and retry with bash scripts/dev.sh reseed." >&2
        exit 1
      fi
      rm -f "$state/seed.stderr"
      : > "$seed_marker"
      echo "Seeded the demo household (Sage, Marlow, Nova)."
    fi

    (
      cd "$root/frontend"
      VITE_BACKEND_PORT="$backend_port" nohup bun run dev -- --port "$vite_port" --strictPort </dev/null >"$vite_log" 2>&1 &
      echo $! > "$vite_pid_file"
    )
    frontend_ready=0
    for ((attempt=0; attempt<300; attempt++)); do
      if curl -fsS -o /dev/null "http://localhost:$vite_port/" 2>/dev/null; then frontend_ready=1; break; fi
      vite_pid="$(pid_value "$vite_pid_file" 2>/dev/null || true)"
      [[ -z "$vite_pid" ]] || kill -0 "$vite_pid" 2>/dev/null || break
      sleep 0.1
    done
    if ((frontend_ready == 0)); then
      echo "Vite did not answer within 30 seconds. Last frontend log lines:" >&2
      tail -n 20 "$vite_log" >&2 || true
      echo "Inspect $vite_log, fix the startup error, then run dev start again." >&2
      exit 1
    fi
    print_urls
    echo "Data: $hub"
    echo "Backend log: $backend_log"
    echo "Vite log: $vite_log"
    echo "Sign in as Sage with the secret correcthorsebattery."
    ;;
  *)
    echo "Usage: bash scripts/dev.sh <start|stop|status|url|port|reseed> [--no-stack] [--stack <url>] [--port <n>]" >&2
    exit 2
    ;;
esac
