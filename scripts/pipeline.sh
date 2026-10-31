#!/usr/bin/env bash
set -euo pipefail
umask 077

error() { echo "pipeline.sh: $1" >&2; }
common="$(git rev-parse --git-common-dir 2>/dev/null)" || { error "not inside a git checkout; run this from the main checkout."; exit 1; }
[[ "$common" = /* ]] || common="$(cd "$(dirname "$common")" && pwd -P)/$(basename "$common")"
main="$(cd "$(dirname "$common")" && pwd -P)"
data="${MAIPAI_LAND_DATA:-$main/data-scratch/land}"
mkdir -p "$data/queue" "$data/notes"
pidfile="$data/lander.pid"
watch_data="${MAIPAI_WATCH_DATA:-$main/data-scratch/watch}"
mkdir -p "$watch_data/green" "$watch_data/reds"
watch_pidfile="$watch_data/watcher.pid"
agents_dir="${MAIPAI_LAUNCH_AGENTS_DIR:-$HOME/Library/LaunchAgents}"
launchctl_cmd="${MAIPAI_LAUNCHCTL:-launchctl}"
bin="${MAIPAI_PIPELINE_BIN:-$main/data-scratch/pipeline-bin}"
git_env="${MAIPAI_LAND_GIT_ENV-$main/data-scratch/bin/https-git.env}"
if [[ -n "$git_env" && -f "$git_env" ]]; then source "$git_env"; fi

refresh_snapshot() {
  local script="$1" current="$bin/$1" tmp="$bin/$1.new"
  mkdir -p "$bin"
  git -C "$main" fetch -q origin main >/dev/null 2>&1 || true
  if ! git -C "$main" show "origin/main:scripts/$script" > "$tmp" 2>/dev/null || [[ ! -s "$tmp" ]]; then
    rm -f "$tmp"
    return 1
  fi
  if [[ ! -f "$current" ]] || ! cmp -s "$tmp" "$current"; then
    mv -f "$tmp" "$current" || { rm -f "$tmp"; return 1; }
    echo changed
  else
    rm -f "$tmp"
    echo unchanged
  fi
}

ensure_snapshot() {
  local script="$1"
  if ! refresh_snapshot "$script"; then
    echo "pipeline.sh: origin/main has no readable scripts/$script; using the main checkout copy." >&2
    mkdir -p "$bin"
    if [[ -r "$main/scripts/$script" && -s "$main/scripts/$script" ]]; then
      cp "$main/scripts/$script" "$bin/$script.new"
      mv -f "$bin/$script.new" "$bin/$script"
    else
      error "cannot find scripts/$script in origin/main or the main checkout."
      return 1
    fi
  fi
}

code_status() {
  local script="$1" label="${1%.sh}" hash
  hash="$(git -C "$main" rev-parse "origin/main:scripts/$script" 2>/dev/null || true)"
  if [[ -n "$hash" && -f "$bin/$script" ]] && [[ "$(git -C "$main" hash-object "$bin/$script" 2>/dev/null || true)" == "$hash" ]]; then
    echo "$label code: current"
  else
    echo "$label code: older than origin/main"
  fi
}

pid="$(cat "$pidfile" 2>/dev/null || true)"
is_running() { [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null && ps -p "$pid" -o command= 2>/dev/null | grep -Eq 'lander\.sh'; }
watch_pid="$(cat "$watch_pidfile" 2>/dev/null || true)"
watch_is_running() { [[ "$watch_pid" =~ ^[0-9]+$ ]] && kill -0 "$watch_pid" 2>/dev/null && ps -p "$watch_pid" -o command= 2>/dev/null | grep -Eq 'watcher\.sh'; }

service_plist() {
  local kind="$1"
  if [[ "$kind" == lander ]]; then echo "$agents_dir/com.maipai.lander.plist"; else echo "$agents_dir/com.maipai.watcher.plist"; fi
}

service_state() {
  local label="$1" pidfile_path="$2" pid_value="" plist_path="$3"
  [[ -f "$plist_path" ]] || { echo "service: not installed"; return; }
  pid_value="$(cat "$pidfile_path" 2>/dev/null || true)"
  if [[ "$label" == com.maipai.lander ]]; then
    if [[ "$pid_value" =~ ^[0-9]+$ ]] && kill -0 "$pid_value" 2>/dev/null && ps -p "$pid_value" -o command= 2>/dev/null | grep -Eq 'lander\.sh'; then echo "service: installed (running)"; else echo "service: installed (stopped)"; fi
  else
    if [[ "$pid_value" =~ ^[0-9]+$ ]] && kill -0 "$pid_value" 2>/dev/null && ps -p "$pid_value" -o command= 2>/dev/null | grep -Eq 'watcher\.sh'; then echo "service: installed (running)"; else echo "service: installed (stopped)"; fi
  fi
}

launch_path() {
  local found="" p
  for p in bun git gh node python3; do
    found="$(command -v "$p" 2>/dev/null || true)"
    if [[ -n "$found" ]]; then printf '%s\n' "$(dirname "$found")"; fi
  done | awk '!seen[$0]++' | paste -sd ':' -
}

write_service_plist() {
  local kind="$1" label plist_path target_data script stdout_file path_value
  if [[ "$kind" == lander ]]; then label=com.maipai.lander; target_data="$data"; script=lander.sh; stdout_file="$data/lander.log"; else label=com.maipai.watcher; target_data="$watch_data"; script=watcher.sh; stdout_file="$watch_data/watcher.log"; fi
  plist_path="$(service_plist "$kind")"
  path_value="$(launch_path):/usr/bin:/bin:/usr/sbin:/sbin"
  mkdir -p "$agents_dir" "$target_data"
  python3 - "$plist_path" "$label" "$bin/$script" "$main" "$path_value" "$HOME" "$stdout_file" <<'PY'
import os, plistlib, sys, tempfile
path, label, program, cwd, env_path, home, log = sys.argv[1:]
value = {
    "Label": label,
    "ProgramArguments": ["/bin/bash", program, "serve"],
    "WorkingDirectory": cwd,
    "RunAtLoad": True,
    "KeepAlive": True,
    "ThrottleInterval": 10,
    "EnvironmentVariables": {"PATH": env_path, "HOME": home},
    "StandardOutPath": log,
    "StandardErrorPath": log,
}
fd, tmp = tempfile.mkstemp(prefix=".service.", dir=os.path.dirname(path))
try:
    with os.fdopen(fd, "wb") as f: plistlib.dump(value, f, fmt=plistlib.FMT_XML, sort_keys=True)
    os.replace(tmp, path)
finally:
    if os.path.exists(tmp): os.unlink(tmp)
PY
  echo "$plist_path"
}

install_service() {
  local load=0 kind plist uid
  [[ "${2:-}" == "--load" ]] && load=1
  ensure_snapshot lander.sh || return 1
  ensure_snapshot watcher.sh || return 1
  uid="$(id -u)"
  for kind in lander watcher; do
    plist="$(write_service_plist "$kind")"
    echo "$plist"
    if [[ "$kind" == lander ]]; then echo "would run: /bin/bash $bin/lander.sh serve"; else echo "would run: /bin/bash $bin/watcher.sh serve"; fi
    if (( load )); then "$launchctl_cmd" bootstrap "gui/$uid" "$plist"; fi
  done
}

uninstall_service() {
  local kind plist uid
  uid="$(id -u)"
  for kind in lander watcher; do
    plist="$(service_plist "$kind")"
    if [[ -f "$plist" ]]; then
      "$launchctl_cmd" bootout "gui/$uid" "$plist" >/dev/null 2>&1 || true
      rm -f "$plist"
      echo "removed: $plist"
    else echo "not installed: $plist"; fi
  done
}

watch_main_status() {
  python3 - "$watch_data" <<'PY'
import json, os, sys, datetime
data=sys.argv[1]
last_run=(open(os.path.join(data,"last-run")).read().strip() if os.path.isfile(os.path.join(data,"last-run")) else "")
last_green=(open(os.path.join(data,"last-green")).read().strip() if os.path.isfile(os.path.join(data,"last-green")) else "")
records=[]
try:
    with open(os.path.join(data,"runs.jsonl")) as f:
        for line in f:
            try: records.append(json.loads(line))
            except Exception: pass
except OSError: pass
record=next((r for r in reversed(records) if r.get("sha")==last_run), records[-1] if records else None)
if not last_run or not record:
    print("main: never run")
elif record.get("result")=="red":
    files=", ".join(record.get("failing",[])) or "unknown"
    culprit=record.get("culprit") or "unknown"
    print("main: red at %s: %s (culprit %s)" % (last_run[:7], files, culprit[:7]))
elif record.get("result")=="flaky":
    print("main: flaky at %s: %s" % (last_run[:7], ", ".join(record.get("failing",[])) or "unknown"))
elif record.get("result")=="stalled":
    print("main: stalled at %s: %s" % (last_run[:7], ", ".join(record.get("failing",[])) or "a test leg timed out"))
elif last_run==last_green:
    try:
        ts=datetime.datetime.fromisoformat(record["ts"].replace("Z","+00:00"))
        seconds=max(0,int((datetime.datetime.now(datetime.timezone.utc)-ts).total_seconds()))
        if seconds<60: age="%ds" % seconds
        elif seconds<3600: age="%dm" % (seconds//60)
        elif seconds<86400: age="%dh" % (seconds//3600)
        else: age="%dd" % (seconds//86400)
    except Exception: age="unknown"
    print("main: green at %s (%s ago)" % (last_run[:7], age))
else:
    print("main: never run")
PY
}

status() {
  git -C "$main" fetch -q origin main >/dev/null 2>&1 || true
  if is_running; then echo "lander: running (pid $pid)"; else echo "lander: stopped"; fi
  if watch_is_running; then echo "watcher: running (pid $watch_pid)"; else echo "watcher: stopped"; fi
  code_status lander.sh
  code_status watcher.sh
  watch_main_status
  local f branch sha requested age now queue_count vals
  queue_count="$(find "$data/queue" -maxdepth 1 -type f -name '*.json' -print | wc -l | tr -d ' ')"
  echo "queue: $queue_count"
  now="$(date +%s)"
  while IFS= read -r f; do
    [[ -f "$f" ]] || continue
    IFS='|' read -r branch sha requested < <(python3 - "$f" <<'PY'
import json,sys
try:
 v=json.load(open(sys.argv[1])); print('%s|%s|%s' % (v.get('branch','unknown'),v.get('sha','unknown'),v.get('requested_at','')))
except Exception: print('invalid|unknown|')
PY
)
    age="$(python3 -c 'import datetime,sys
try: print(max(0,int(sys.argv[2])-int(datetime.datetime.fromisoformat(sys.argv[1].replace("Z","+00:00")).timestamp())))
except Exception: print(0)' "$requested" "$now")"
    echo "  $branch ${sha:0:7} ${age}s"
  done < <(find "$data/queue" -maxdepth 1 -type f -name '*.json' -print | sort)
  echo "last landings:"
  if [[ -f "$data/landings.jsonl" ]]; then
    tail -n 5 "$data/landings.jsonl" | python3 -c 'import json,sys,datetime
for line in sys.stdin:
 try:
  x=json.loads(line); ts=datetime.datetime.fromisoformat(x["ts"].replace("Z","+00:00")).astimezone().strftime("%Y-%m-%d %H:%M:%S"); print("%s %s %s %ss %s" % (ts, x["status"], x["branch"], x["seconds"], x["reason"]))
 except Exception: pass'
  fi
  if git -C "$main" fetch origin >/dev/null 2>&1 && git -C "$main" log origin/main -1 --format='origin/main: %h %s' 2>/dev/null; then :; else echo "origin/main: unknown (fetch failed)"; fi
  service_state com.maipai.lander "$pidfile" "$(service_plist lander)"
  service_state com.maipai.watcher "$watch_pidfile" "$(service_plist watcher)"
}

case "${1:-}" in
  status) status ;;
  install-service) install_service "$@" ;;
  uninstall-service) uninstall_service ;;
  start)
    ensure_snapshot lander.sh || exit 1
    ensure_snapshot watcher.sh || exit 1
    cd "$main"
    if is_running; then echo "lander already running (pid $pid)"; else
      nohup bash "$bin/lander.sh" serve >>"$data/lander.log" 2>&1 </dev/null &
      pid=$!
      echo "lander started (pid $pid)"
    fi
    if watch_is_running; then echo "watcher already running (pid $watch_pid)"; else
      nohup bash "$bin/watcher.sh" serve >>"$watch_data/watcher.log" 2>&1 </dev/null &
      watch_pid=$!
      echo "watcher started (pid $watch_pid)"
    fi
    ;;
  stop)
    failed=0
    if is_running; then
      kill -TERM "$pid" 2>/dev/null || { error "could not signal pid $pid; inspect process permissions, then retry."; exit 1; }
      for ((i=0; i<60; i++)); do
        if ! kill -0 "$pid" 2>/dev/null || ! ps -p "$pid" -o command= 2>/dev/null | grep -Eq 'lander\.sh'; then rm -f "$pidfile"; echo "lander stopped"; break; fi
        sleep 1
      done
      if is_running; then error "lander pid $pid did not stop within 60 seconds; inspect $data/lander.log and retry stop."; failed=1; fi
    else rm -f "$pidfile"; echo "lander already stopped"; fi
    if watch_is_running; then
      kill -TERM "$watch_pid" 2>/dev/null || { error "could not signal watcher pid $watch_pid; inspect process permissions, then retry."; exit 1; }
      for ((i=0; i<60; i++)); do
        if ! kill -0 "$watch_pid" 2>/dev/null || ! ps -p "$watch_pid" -o command= 2>/dev/null | grep -Eq 'watcher\.sh'; then rm -f "$watch_pidfile"; echo "watcher stopped"; break; fi
        sleep 1
      done
      if watch_is_running; then error "watcher pid $watch_pid did not stop within 60 seconds; inspect $watch_data/watcher.log and retry stop."; failed=1; fi
    else rm -f "$watch_pidfile"; echo "watcher already stopped"; fi
    (( failed == 0 ))
    ;;
  *) error "usage: bash scripts/pipeline.sh status | start | stop | install-service [--load] | uninstall-service"; exit 2 ;;
esac
