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
git_env="${MAIPAI_LAND_GIT_ENV-$main/data-scratch/bin/https-git.env}"
if [[ -n "$git_env" && -f "$git_env" ]]; then source "$git_env"; fi

pid="$(cat "$pidfile" 2>/dev/null || true)"
is_running() { [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null && ps -p "$pid" -o command= 2>/dev/null | grep -Eq 'lander\.sh'; }
watch_pid="$(cat "$watch_pidfile" 2>/dev/null || true)"
watch_is_running() { [[ "$watch_pid" =~ ^[0-9]+$ ]] && kill -0 "$watch_pid" 2>/dev/null && ps -p "$watch_pid" -o command= 2>/dev/null | grep -Eq 'watcher\.sh'; }

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
  if is_running; then echo "lander: running (pid $pid)"; else echo "lander: stopped"; fi
  if watch_is_running; then echo "watcher: running (pid $watch_pid)"; else echo "watcher: stopped"; fi
  watch_main_status
  local f branch sha requested age now queue_count vals
  queue_count="$(find "$data/queue" -maxdepth 1 -type f -name '*.json' -print | wc -l | tr -d ' ')"
  echo "queue: $queue_count"
  now="$(date +%s)"
  while IFS= read -r f; do
    [[ -f "$f" ]] || continue
    vals="$(python3 - "$f" <<'PY'
import json,sys
try:
 v=json.load(open(sys.argv[1])); print('%s\t%s\t%s' % (v.get('branch','unknown'), v.get('sha','unknown'), v.get('requested_at','')))
except Exception: print('invalid\tunknown\t')
PY
)
    IFS=$'\t' read -r branch sha requested <<< "$vals"
    age="$(python3 - "$requested" "$now" <<'PY'
import datetime,sys
try: print(max(0,int(sys.argv[2])-int(datetime.datetime.fromisoformat(sys.argv[1].replace('Z','+00:00')).timestamp())))
except Exception: print(0)
PY
)
    echo "$branch ${sha:0:7} ${age}s"
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
}

case "${1:-}" in
  status) status ;;
  start)
    if is_running; then echo "lander already running (pid $pid)"; else
      nohup bash "$main/scripts/lander.sh" serve >>"$data/lander.log" 2>&1 </dev/null &
      pid=$!
      echo "lander started (pid $pid)"
    fi
    if watch_is_running; then echo "watcher already running (pid $watch_pid)"; else
      nohup bash "$main/scripts/watcher.sh" serve >>"$watch_data/watcher.log" 2>&1 </dev/null &
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
  *) error "usage: bash scripts/pipeline.sh status | start | stop"; exit 2 ;;
esac
