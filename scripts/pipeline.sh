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
git_env="${MAIPAI_LAND_GIT_ENV-$main/data-scratch/bin/https-git.env}"
if [[ -n "$git_env" && -f "$git_env" ]]; then source "$git_env"; fi

pid="$(cat "$pidfile" 2>/dev/null || true)"
is_running() { [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null && ps -p "$pid" -o command= 2>/dev/null | grep -Eq 'lander\.sh'; }

status() {
  if is_running; then echo "lander: running (pid $pid)"; else echo "lander: stopped"; fi
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
    if is_running; then echo "lander already running (pid $pid)"; exit 0; fi
    nohup bash "$main/scripts/lander.sh" serve >>"$data/lander.log" 2>&1 </dev/null &
    pid=$!
    echo "lander started (pid $pid)"
    ;;
  stop)
    if ! is_running; then rm -f "$pidfile"; echo "lander already stopped"; exit 0; fi
    kill -TERM "$pid" 2>/dev/null || { error "could not signal pid $pid; inspect process permissions, then retry."; exit 1; }
    for ((i=0; i<60; i++)); do
      if ! kill -0 "$pid" 2>/dev/null || ! ps -p "$pid" -o command= 2>/dev/null | grep -Eq 'lander\.sh'; then rm -f "$pidfile"; echo "lander stopped"; exit 0; fi
      sleep 1
    done
    error "lander pid $pid did not stop within 60 seconds; inspect $data/lander.log and retry stop."
    exit 1
    ;;
  *) error "usage: bash scripts/pipeline.sh status | start | stop"; exit 2 ;;
esac
