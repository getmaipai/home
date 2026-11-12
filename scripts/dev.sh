#!/usr/bin/env bash
# Per-worktree hot-reload Home for the daily development loop.
# State and demo data live under data/dev; this never builds the frontend,
# takes a port lease, or uses the machine-wide app lock. Use `bun run dev`
# to start and `bun run dev:stop` to stop this checkout's development Home.
# `start` also launches a watcher that stops it when the worktree is removed or no browser has been
# connected for MAIPAI_DEV_IDLE_MINUTES (30); `wt.sh done` stops it too.
#
# Workbench (`bun run workbench`, or any command plus --workbench): an optional, persistent dev hub
# for working on the app between releases. Same hot reload and real Stack, but its own demo data in
# data/dev/workbench (seeded once, kept across stop and start; only `reseed --workbench` resets it),
# a fixed port (backend 8780, Home 9780; MAIPAI_WORKBENCH_PORT or --port changes it), no idle stop,
# and a tailnet-only `tailscale serve` HTTPS address that is checked before it is printed. The
# backend runs with MAIPAI_WORKBENCH=1, which skips background jobs that start heavy Stack work or
# reach outside the hub (lib/scheduler.ts), and a status note says it is not the family's hub.
# It refuses ports 3000 and 8787 and any data directory under the live install.
#
# DEV-BUDGET-01 (2026-11-12): the shared workbench is the default preview. `start` with no flag starts (or reuses) the one machine-wide
# workbench; a private per-worktree hub needs an explicit `--own`. In GATED mode the workbench is off, so the default falls back to a
# private hub. `stop`, `status` and `url` with no flag cover both. Every backend and Vite server runs through scripts/jobs/job.sh: its
# own process group, a lifetime, an audit line, a cap of MAIPAI_DEV_HUB_CAP_MB (2048) for the backend after which the launcher restarts it
# cold (a fresh --hot drops the module graphs it kept), and a seat in the dev budget MAIPAI_DEV_BUDGET_GB (24). A start that does not
# fit the budget says so and exits. The watch loop also runs `job.sh reap` (the orphan reaper) every five minutes.
# MAIPAI_JOBS_OFF=1 starts the servers directly, as before. `--takeover` replaces a workbench that runs from another worktree.
set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd -P)"
root="${MAIPAI_DEV_ROOT:-$(cd "$script_dir/.." && pwd -P)}"
live_root="${MAIPAI_LIVE_INSTALL_ROOT:-/usr/local/maipai-home}"
umask 077

action="${1:-}"
shift || true
port_override="${MAIPAI_DEV_PORT:-}"
stack_override="${MAIPAI_DEV_STACK_URL:-}"
no_stack=0
workbench="${MAIPAI_DEV_WORKBENCH:-0}"
[[ "$workbench" == 1 ]] || workbench=0
own=0
takeover=0
orig_args=("$@")
while (($#)); do
  case "$1" in
    --no-stack) no_stack=1; shift ;;
    --workbench) workbench=1; shift ;;
    --own) own=1; shift ;;
    --takeover) takeover=1; shift ;;
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
    *) echo "Unknown option: $1. Use --own, --workbench, --takeover, --no-stack, --stack <url>, or --port <n>." >&2; exit 2 ;;
  esac
done
if ((own && workbench)); then echo "Pick one: --own (a private hub for this worktree) or --workbench (the shared one)." >&2; exit 2; fi

# The shared workbench is the default (see the header). Resolved once, here, so every action agrees.
jobs_state="${MAIPAI_JOBS_DIR:-${HOME:-/tmp}/.local/state/maipai/jobs}"
if ((own == 0 && workbench == 0)) && [[ "${MAIPAI_DEV_WORKBENCH:-}" != 0 ]]; then
  default_workbench=1
  if [[ -f "$script_dir/lib/mode.sh" ]]; then
    source "$script_dir/lib/mode.sh"
    if [[ "$(mode_get)" == gated ]]; then default_workbench=0; fi
  fi
  case "$action" in
    stop|status)
      # Both variants: whatever this worktree runs, private or shared.
      rc=0
      for v in --own --workbench; do MAIPAI_DEV_ROOT="$root" bash "$script_dir/dev.sh" "$action" "$v" ${orig_args[@]+"${orig_args[@]}"} || rc=$?; done
      exit "$rc" ;;
    start|reseed|url) if ((default_workbench)); then workbench=1; fi ;;
  esac
fi

state="$root/data/dev"
((workbench == 0)) || state="$root/data/dev/workbench"
hub="$state/hub"
backend_pid_file="$state/backend.pid"
vite_pid_file="$state/vite.pid"
watch_pid_file="$state/watch.pid"
backend_log="$state/backend.log"
vite_log="$state/vite.log"
seed_marker="$state/seeded"
seed_output="$state/seed.json"
port_file="$state/port"
tailscale_host_file="$state/tailscale-host"

# The path itself if it exists, else its nearest existing parent resolved plus the rest.
resolved_path() {
  local path="$1" rest=""
  while [[ ! -e "$path" && "$path" != / ]]; do rest="/$(basename "$path")$rest"; path="$(dirname "$path")"; done
  printf '%s%s' "$(cd "$path" && pwd -P)" "$rest"
}
if ((workbench)) && [[ -f "$(dirname "${BASH_SOURCE[0]}")/lib/mode.sh" ]]; then
  # MODE-01: the workbench is a DIRECT-mode hub (disposable data, hot reload); in GATED mode the family is on the live hub and this Mac keeps its load.
  source "$(dirname "${BASH_SOURCE[0]}")/lib/mode.sh"
  [[ "$(mode_get)" != gated ]] || { echo "GATED: checked first, then run. The workbench hub is off in gated mode; use bun run dev, or switch with bash scripts/mode.sh direct." >&2; exit 2; }
fi
if ((workbench)); then
  [[ -n "$port_override" ]] || port_override="${MAIPAI_WORKBENCH_PORT:-8780}"
  live_resolved="$(resolved_path "$live_root")"
  state_resolved="$(resolved_path "$state")"
  if [[ "$state_resolved/" == "$live_resolved/"* || "$state_resolved/" == "$live_root/"* ]]; then
    echo "The workbench refuses to use $state: it is inside the live install ($live_root), whose data the family's hub owns. Run it from a worktree instead." >&2; exit 2
  fi
fi

mkdir -p "$state"

if [[ -n "$port_override" ]]; then
  if [[ ! "$port_override" =~ ^[0-9]+$ ]] || ((port_override < 1 || port_override > 64535)); then
    echo "Invalid development port '$port_override'. Pass a number from 1 to 64535." >&2; exit 2
  fi
  backend_port=$port_override
elif [[ -d "$root/.git" ]]; then
  backend_port=8787
elif [[ -f "$root/.git" ]]; then
  path_sum="$(cksum <<< "$root" | cut -d' ' -f1)"
  hashed_port=$((8800 + path_sum % 100))
  alive_port=""
  for pid_file in "$backend_pid_file" "$vite_pid_file"; do
    if [[ -f "$port_file" && -f "$pid_file" ]]; then
      IFS= read -r saved_port < "$port_file" || true
      IFS= read -r saved_pid < "$pid_file" || true
      if [[ "$saved_port" =~ ^[0-9]+$ && "$saved_pid" =~ ^[0-9]+$ ]] && kill -0 "$saved_pid" 2>/dev/null; then
        alive_port="$saved_port"; break
      fi
    fi
  done
  backend_port="${alive_port:-$hashed_port}"
else
  echo "Cannot choose a development port because $root has no .git file or directory. Run this from a checkout." >&2; exit 1
fi
vite_port=$((backend_port + 1000))
if ((workbench)); then
  for reserved in 3000 8787; do
    if ((backend_port == reserved || vite_port == reserved)); then
      echo "The workbench never uses port $reserved: it belongs to the live hub or the main checkout. Pass --port <n> with another number." >&2; exit 2
    fi
  done
fi

# Tailscale for the workbench only: MAIPAI_DEV_TAILSCALE=off skips it (tests do).
tailscale_cli() {
  [[ "${MAIPAI_DEV_TAILSCALE:-on}" != off ]] || return 1
  command -v tailscale >/dev/null 2>&1 || return 1
  tailscale "$@"
}
tailscale_host() {
  tailscale_cli status --json 2>/dev/null | bun -e 'const s = JSON.parse(await Bun.stdin.text()); const n = String(s?.Self?.DNSName ?? "").replace(/\.$/, ""); if (!n.endsWith(".ts.net")) process.exit(1); console.log(n);' 2>/dev/null
}

probe_taken() {
  local probe_port="$1"
  if [[ -n "${MAIPAI_DEV_PROBE_CMD:-}" ]]; then
    bash -c "$MAIPAI_DEV_PROBE_CMD" _ "$probe_port"
  elif command -v nc >/dev/null 2>&1; then
    nc -z 127.0.0.1 "$probe_port" >/dev/null 2>&1
  else
    (exec 3<>"/dev/tcp/127.0.0.1/$probe_port") >/dev/null 2>&1
  fi
}

choose_worktree_port() {
  local offset candidate candidate_vite
  for ((offset=0; offset<100; offset++)); do
    candidate=$((8800 + ((hashed_port - 8800 + offset) % 100)))
    candidate_vite=$((candidate + 1000))
    if ! probe_taken "$candidate" && ! probe_taken "$candidate_vite"; then
      backend_port="$candidate"
      vite_port="$candidate_vite"
      return 0
    fi
  done
  echo "No free development port pair in 8800-8899 (or 9800-9899)." >&2
  return 1
}

pid_value() {
  local file="$1" value
  [[ -f "$file" ]] || return 1
  IFS= read -r value < "$file" || true
  [[ "$value" =~ ^[0-9]+$ ]] && ((value > 1)) || return 1
  printf '%s' "$value"
}

process_command() { ps -p "$1" -o command= 2>/dev/null || true; }
# DEV-BUDGET-01: the launcher words that go in front of a server command ("<cap MB>" "<lifetime>"). Empty when MAIPAI_JOBS_OFF=1 or the
# launcher is missing (a stripped checkout), in which case the server starts directly.
job_prefix() {
  job_prefix_words=()
  [[ "${MAIPAI_JOBS_OFF:-0}" != 1 && -f "$script_dir/jobs/job.sh" ]] || return 0
  local life=24h
  ((workbench == 0)) || life=30d
  job_prefix_words=(bash "$script_dir/jobs/job.sh" run --type server --lifetime "$life" --max-rss-mb "$1" --restart-over-cap --no-wait --session "$(basename "$root")" --)
}
workbench_owner_file="$jobs_state/workbench-owner"
# RSS in MB of the backend this worktree's pid file names, or of its child when the file names the launcher; 0 when unknown.
backend_rss_mb() {
  local p kid kb
  p="$(pid_value "$backend_pid_file" 2>/dev/null || true)"; [[ -n "$p" ]] || { echo 0; return; }
  kid="$(pgrep -P "$p" 2>/dev/null | head -n 1 || true)"
  kb="$(ps -o rss= -p "${kid:-$p}" 2>/dev/null | tr -d ' ' || true)"
  [[ "$kb" =~ ^[0-9]+$ ]] && echo $((kb / 1024)) || echo 0
}
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
  if ((workbench)) && [[ -s "$tailscale_host_file" ]]; then
    IFS= read -r saved_host < "$tailscale_host_file" || true
    [[ -z "${saved_host:-}" ]] || echo "Tailscale: https://$saved_host:$vite_port (tailnet only)"
  fi
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
# HOST-GUARD-08: when the host guard restarts the Mac's file-event service (fseventsd), every running file watcher (Vite, bun --hot)
# keeps a dead stream and misses edits. The guard only writes this file (it never touches a user process); the watch loop below
# restarts this hub in full, which rereads every file from disk, so an edit made during the restart is picked up.
fsevents_restarted_at() {
  local f="${MAIPAI_HOST_GUARD_STATE_DIR:-/var/db/maipai-host-guard}/fsevents-restarted" v=""
  [[ -f "$f" ]] && v="$(sed -n 's/.*"restarted_at":\([0-9]*\).*/\1/p' "$f" 2>/dev/null | head -n 1)"
  [[ "$v" =~ ^[0-9]+$ ]] && echo "$v" || echo 0
}

stop_one() {
  local label="$1" file="$2" candidate command
  candidate="$(pid_value "$file" 2>/dev/null || true)"
  if [[ -n "$candidate" ]] && kill -0 "$candidate" 2>/dev/null; then
    command="$(process_command "$candidate")"
    if [[ ( "$label" == backend && "$command" == *"src/index.ts"* && "$command" == *bun* ) || ( "$label" == vite && ( "$command" == *vite* || "$command" == *"bun run dev"* ) ) || ( "$label" == watch && "$command" == *dev.sh*watch* ) ]]; then
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
  port)
    if [[ -z "$port_override" && -f "$root/.git" && -z "${alive_port:-}" ]]; then
      choose_worktree_port || exit 1
    fi
    echo "$backend_port"
    ;;
  url) print_urls ;;
  status)
    process_status backend "$backend_pid_file"
    process_status vite "$vite_pid_file"
    ;;
  stop)
    stop_one watch "$watch_pid_file"
    stop_one backend "$backend_pid_file"
    stop_one vite "$vite_pid_file"
    if ((workbench)) && [[ -s "$tailscale_host_file" ]]; then
      tailscale_cli serve --https="$vite_port" off >/dev/null 2>&1 || true
      rm -f "$tailscale_host_file"
    fi
    if ((workbench)) && [[ -f "$workbench_owner_file" ]] && [[ "$(cat "$workbench_owner_file" 2>/dev/null)" == "$root" ]]; then rm -f "$workbench_owner_file"; fi
    if ((workbench)); then echo "Workbench stopped; its data stays in $hub."; else echo "Dev Home stopped."; fi
    ;;
  restart-hub)
    # Hidden: started by `watch` after the file-event service restarted. Stops this hub and starts it with the options it had.
    stop_one backend "$backend_pid_file" || true
    stop_one vite "$vite_pid_file" || true
    restart_args=(start)
    if [[ -f "$state/start-args" ]]; then while IFS= read -r arg; do [[ -z "$arg" ]] || restart_args+=("$arg"); done < "$state/start-args"; fi
    bash "$script_dir/dev.sh" "${restart_args[@]}" || echo "$(date '+%F %T') dev Home did not start again after the file-event service restart; run bash scripts/dev.sh start" >> "$state/watch.log"
    # Recovery check (as the owner): a change is seen by a real watcher, and the restart-window file is there. The result goes to the
    # host guard's recovery folder in Home's data directory, which the guard reads; a failure keeps new dev work paused.
    restarted_at="$(fsevents_restarted_at)"
    guard_data="$(sed -n 's/.*"data_dir":"\([^"]*\)".*/\1/p' "${MAIPAI_HOST_GUARD_STATE_DIR:-/var/db/maipai-host-guard}/config.json" 2>/dev/null | head -n 1)"
    copy_args=()
    [[ -z "$guard_data" ]] || copy_args=(--copy-to "$guard_data/host-guard/recovery/$(cksum <<< "$root" | cut -d' ' -f1).json")
    (cd "$root" && ${MAIPAI_DEV_BUN:-bun} scripts/fseventsRecovery.ts --probe "$state/fsevents-probe" --restarted-at "$restarted_at" --token "$restarted_at" \
      --out "$state/fsevents-recovery.json" ${copy_args[@]+"${copy_args[@]}"}) >> "$state/watch.log" 2>&1 || true
    ;;
  reseed)
    stop_one watch "$watch_pid_file"
    stop_one backend "$backend_pid_file"
    stop_one vite "$vite_pid_file"
    rm -rf "$hub"
    rm -f "$seed_marker" "$seed_output"
    reseed_args=(start)
    if ((workbench)); then reseed_args+=(--workbench); else reseed_args+=(--own); fi
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
    if ((workbench)); then
      owner=""; [[ -f "$workbench_owner_file" ]] && IFS= read -r owner < "$workbench_owner_file" || true
      if ((takeover)) && [[ -n "$owner" && "$owner" != "$root" && -f "$owner/scripts/dev.sh" ]]; then
        echo "Replacing the shared workbench that runs from $owner."
        MAIPAI_DEV_ROOT="$owner" bash "$script_dir/dev.sh" stop --workbench >/dev/null 2>&1 || true
      fi
      for wanted in "$backend_port" "$vite_port"; do
        if probe_taken "$wanted"; then
          echo "Port $wanted is already in use, so the shared workbench cannot start from here (only one workbench runs per machine)${owner:+; it runs from $owner}. To preview this worktree on it, run bash scripts/dev.sh start --takeover (it stops that one). For a private hub instead, run bash scripts/dev.sh start --own." >&2; exit 1
        fi
      done
    fi

    if [[ -z "$port_override" && -f "$root/.git" ]]; then
      choose_worktree_port || exit 1
    fi
    printf '%s\n' "$backend_port" > "$port_file"

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
    job_prefix "${MAIPAI_DEV_HUB_CAP_MB:-2048}"
    (
      cd "$root/backend"
      MAIPAI_WORKBENCH="$workbench" MAIPAI_TEST_ALLOW_MULTIPLE_HUBS=1 MAIPAI_MDNS=off MAIPAI_LAN_EXPOSURE=loopback PORT="$backend_port" \
        MAIPAI_DATA_DIR="$hub" MAIPAI_BACKUP_DIR="$hub/backups" MAIPAI_KEYSTORE_BACKEND=file \
        MAIPAI_TTS_DISABLE_SPAWN=1 MAIPAI_WYOMING_PORT=0 MAIPAI_BACKGROUND_URL=http://127.0.0.1:1 \
        MAIPAI_LLAMA_SERVER_URL= MAIPAI_EMBED_URL= MAIPAI_HUB_LOCK_PATH="$hub.lock" \
        nohup ${job_prefix_words[@]+"${job_prefix_words[@]}"} bun run --hot src/index.ts </dev/null >"$backend_log" 2>&1 &
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
      if ((workbench)); then
        # The existing status note (Status page) marks this hub; no new status surface (RULES S6).
        seed_cookie="$(bun -e 'const r = JSON.parse(await Bun.file(process.argv[1]).text()); console.log(r.cookie ?? "")' "$seed_output" 2>/dev/null || true)"
        if [[ -z "$seed_cookie" ]] || ! curl -fsS -m 10 -o /dev/null -X POST -H 'Content-Type: application/json' -H "Cookie: $seed_cookie" \
          --data '{"body":"Workbench: a development hub with demo data. This is not the family hub."}' "http://127.0.0.1:$backend_port/api/status/note"; then
          echo "Could not post the workbench status note; the hub still runs. Post it from Status if you want the marker."
        fi
      fi
    fi

    job_prefix 512
    ts_host=""
    rm -f "$tailscale_host_file"
    ((workbench == 0)) || ts_host="$(tailscale_host || true)"
    (
      cd "$root/frontend"
      VITE_ALLOWED_HOSTS="${ts_host:-${VITE_ALLOWED_HOSTS:-}}" VITE_BACKEND_PORT="$backend_port" nohup ${job_prefix_words[@]+"${job_prefix_words[@]}"} bun run dev -- --port "$vite_port" --strictPort </dev/null >"$vite_log" 2>&1 &
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
    rm -f "$watch_pid_file"
    if ((workbench)) && [[ -n "$ts_host" ]]; then
      # Tailnet only (serve, never funnel), the same way other dev ports on this Mac are reached.
      if tailscale_cli serve --bg --https="$vite_port" "http://localhost:$vite_port" >/dev/null 2>&1 \
        && curl -fsS -m 15 -o /dev/null "https://$ts_host:$vite_port/" 2>/dev/null; then
        printf '%s\n' "$ts_host" > "$tailscale_host_file"
      else
        echo "The Tailscale address https://$ts_host:$vite_port did not answer; use the local address. Check tailscale serve status."
      fi
    elif ((workbench)); then
      echo "Tailscale is not available here, so the workbench has only a local address."
    fi
    if ((workbench)); then mkdir -p "$jobs_state" && printf '%s\n' "$root" > "$workbench_owner_file" || true; fi
    watch_args=(watch)
    ((workbench == 0)) || watch_args+=(--workbench)
    # The options this hub started with, so a restart after a file-event service restart starts it the same way.
    { ((workbench != 0)) || echo --own; ((no_stack == 0)) || echo --no-stack; [[ -z "$stack_override" ]] || printf '%s\n' --stack "$stack_override"; [[ -z "$port_override" ]] || printf '%s\n' --port "$port_override"; ((workbench == 0)) || echo --workbench; } > "$state/start-args"
    MAIPAI_DEV_ROOT="$root" nohup bash "$script_dir/dev.sh" "${watch_args[@]}" </dev/null >/dev/null 2>&1 &
    echo $! > "$watch_pid_file"
    print_urls
    echo "Data: $hub"
    echo "Backend log: $backend_log"
    echo "Vite log: $vite_log"
    echo "Sign in as Sage with the secret correcthorsebattery."
    ;;
  watch)
    # Hidden: started by `start`. Stops this dev Home when its worktree is deleted or no browser
    # has been connected for MAIPAI_DEV_IDLE_MINUTES (default 30), so a forgotten one cannot keep
    # holding connections to the shared Stack (2026-10-27: one stalled chat for hours).
    # The workbench is meant to stay up, so it has no idle stop unless MAIPAI_DEV_IDLE_MINUTES asks for one.
    idle_default=30
    ((workbench == 0)) || idle_default=0
    idle_limit=$(( ${MAIPAI_DEV_IDLE_MINUTES:-$idle_default} * 60 ))
    interval="${MAIPAI_DEV_WATCH_SECONDS:-30}"
    idle=0
    ticks=0
    cold_done=0
    cold_after=$(( ${MAIPAI_WORKBENCH_IDLE_RESTART_MINUTES:-30} * 60 ))
    fsevents_seen="$(fsevents_restarted_at)"
    while sleep "$interval"; do
      # DEV-REAPER-01: every ~5 minutes, stop development hubs that are provably dead (no pid file, no watcher, for 60 minutes).
      ticks=$((ticks + 1))
      if ((ticks % 10 == 0)) && [[ "${MAIPAI_JOBS_OFF:-0}" != 1 && -f "$script_dir/jobs/job.sh" ]]; then
        bash "$script_dir/jobs/job.sh" reap >>"$state/watch.log" 2>&1 || true
      fi
      if ! live_backend && ! live_vite; then rm -f "$watch_pid_file"; exit 0; fi
      reason=""
      if [[ ! -e "$root/.git" ]]; then reason="its worktree was removed"; fi
      if [[ -z "$reason" ]] && (( $(fsevents_restarted_at) > fsevents_seen )); then
        echo "$(date '+%F %T') restarting dev Home: the Mac's file-event service was restarted by the host guard, so its file watchers start fresh" >> "$state/watch.log"
        # A file changed during the restart window; the recovery check after the restart expects to find it.
        mkdir -p "$state/fsevents-probe"; fsevents_restarted_at > "$state/fsevents-probe/window.txt"
        rm -f "$watch_pid_file"
        MAIPAI_DEV_ROOT="$root" nohup bash -c "${MAIPAI_DEV_RESTART_CMD:-bash \"\$0\" restart-hub}" "$script_dir/dev.sh" </dev/null >>"$state/watch.log" 2>&1 &
        exit 0
      fi
      if [[ -z "$reason" ]]; then
        if lsof -nP -iTCP:"$vite_port" -sTCP:ESTABLISHED >/dev/null 2>&1; then idle=0; else idle=$((idle + interval)); fi
        if ((idle_limit > 0 && idle >= idle_limit)); then reason="no browser was connected for $((idle_limit / 60)) minutes"; fi
        # The workbench never stops, so while nobody is looking it is restarted cold once (a fresh --hot drops the module graphs it kept).
        if [[ -z "$reason" ]] && ((workbench && cold_after > 0)); then
          if ((idle == 0)); then cold_done=0; fi
          if ((idle >= cold_after && cold_done == 0)) && (($(backend_rss_mb) >= ${MAIPAI_WORKBENCH_COLD_MIN_MB:-700})); then
            cold_done=1
            echo "$(date '+%F %T') restarting the workbench cold: no browser was connected for $((cold_after / 60)) minutes" >> "$state/watch.log"
            rm -f "$watch_pid_file"
            MAIPAI_DEV_ROOT="$root" nohup bash -c "${MAIPAI_DEV_RESTART_CMD:-bash \"\$0\" restart-hub}" "$script_dir/dev.sh" </dev/null >>"$state/watch.log" 2>&1 &
            exit 0
          fi
        fi
      fi
      if [[ -n "$reason" ]]; then
        echo "$(date '+%F %T') stopping dev Home: $reason" >> "$state/watch.log"
        rm -f "$watch_pid_file"
        stop_one backend "$backend_pid_file" || true
        stop_one vite "$vite_pid_file" || true
        exit 0
      fi
    done
    ;;
  *)
    echo "Usage: bash scripts/dev.sh <start|stop|status|url|port|reseed> [--own|--workbench] [--takeover] [--no-stack] [--stack <url>] [--port <n>]" >&2
    exit 2
    ;;
esac
