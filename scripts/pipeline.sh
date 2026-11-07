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
# GITNET-01: remote git operations are bounded (scripts/lib/gitnet.sh); a checkout that predates the helper runs plain git.
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
if [[ -f "$here/lib/gitnet.sh" ]]; then source "$here/lib/gitnet.sh"; gitnet_env "$main"; else
  GITNET_TIMED_OUT=0; gitnet() { git "$@"; }
  pipeline_main_sha() { git -C "${1:-.}" rev-parse --verify -q 'origin/main^{commit}'; }
  pipeline_main_state() { echo unknown; }
fi

refresh_snapshot() {
  local script="$1" current="$bin/$1" tmp="$bin/$1.new"
  mkdir -p "$bin"
  GITNET_TRIES=1 GITNET_TIMEOUT=30 gitnet -C "$main" fetch -q origin main >/dev/null 2>&1 || true
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

# deno is listed because backend/tests/support/deno.ts finds it on PATH; launchd's default PATH lacks ~/.local/bin, so the
# lander's safety-surface shard saw HAS_DENO false and tests/denoGate.test.ts failed (2026-11-07).
launch_path() {
  local found="" p
  for p in bun git gh node python3 deno; do
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

# GITNET-01: say loudly when the lander or watcher is inside one operation past its bound or one landing phase with no progress,
# and when a hung operation was killed recently. Reads the ops records and stuck log the bounded steps write; no new daemon.
stuck_status() {
  python3 - "$data" "$watch_data" "$(date +%s)" "$(is_running && echo 1 || echo 0)" <<'PY'
import datetime, glob, json, os, sys
data, watch, now, lander_up = sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4] == '1'
def alive(pid):
    try: os.kill(pid, 0); return True
    except ProcessLookupError: return False
    except PermissionError: return True
for root, who in ((data, 'lander'), (watch, 'watcher')):
    for rec in glob.glob(os.path.join(root, 'ops', '*.op')):
        try:
            pid, start, secs, label = open(rec).read().rstrip('\n').split('\t', 3)
            pid, start, secs = int(pid), int(start), int(secs)
        except Exception:
            continue
        if not alive(pid):
            try: os.unlink(rec)
            except OSError: pass
            continue
        run = now - start
        if run > secs + 60: print('STUCK: %s %s for %d min (pid %d, bound %d s)' % (who, label, run // 60, pid, secs))
    try:
        for line in open(os.path.join(root, 'stuck.log')).read().splitlines()[-20:]:
            x = json.loads(line)
            ts = int(datetime.datetime.fromisoformat(x['ts'].replace('Z', '+00:00')).timestamp())
            if now - ts <= 3600: print('note: %s hung "%s" (bound %d s) and was stopped %d min ago' % (who, x['op'], x['seconds'], (now - ts) // 60))
    except (OSError, ValueError, KeyError):
        pass
if lander_up:
    try:
        branch, started, phase_ts, phase = open(os.path.join(data, 'current-entry')).read().rstrip('\n').split('\t', 3)
        idle = now - int(phase_ts)
        limit = int(os.environ.get('MAIPAI_STUCK_PHASE_SECONDS', '3600'))
        if idle > limit: print("STUCK: lander on %s at '%s' for %d min with no progress" % (branch, phase, idle // 60))
    except (OSError, ValueError):
        pass
PY
}

# OUTBOX-01: how far the pipeline's main is ahead of GitHub (landed commits the outbox has not pushed yet), one line.
outbox_status() {
  local state since tries next err now dir="$data/outbox"
  state="$(pipeline_main_state "$main" 2>/dev/null || echo unknown)"; now="$(date +%s)"
  case "$state" in
    sync) echo "GitHub main: in sync" ;;
    diverged) echo "STUCK: GitHub main and the landed main diverged; nothing is force-pushed. Run bash scripts/pipeline.sh outbox reset-to-github (it parks the landed commits on a branch first)" ;;
    ahead*)
      since="$(cat "$dir/pending-since" 2>/dev/null || echo "$now")"; [[ "$since" =~ ^[0-9]+$ ]] || since="$now"
      tries="$(cat "$dir/tries" 2>/dev/null || echo 0)"; [[ "$tries" =~ ^[0-9]+$ ]] || tries=0
      next="$(cat "$dir/next-try" 2>/dev/null || echo 0)"; [[ "$next" =~ ^[0-9]+$ ]] || next=0
      err="$(cat "$dir/last-error" 2>/dev/null || true)"
      if (( tries > 0 )); then
        echo "GitHub main: main is ahead of GitHub by ${state#ahead } commits (oldest $(( (now - since) / 60 )) min), push retrying (try $tries$( (( next > now )) && echo ", next in $(( next - now ))s")${err:+, last error: $err})"
      else
        echo "GitHub main: main is ahead of GitHub by ${state#ahead } commits (oldest $(( (now - since) / 60 )) min), push pending"
      fi ;;
    *) echo "GitHub main: unknown (no origin/main in this clone yet)" ;;
  esac
}

# outbox [status|flush|reset-to-github]: runs the lander's own outbox commands (the running daemon's copy of the code).
outbox_cmd() {
  local script="$bin/lander.sh"
  [[ -f "$script" ]] || script="$main/scripts/lander.sh"
  shift
  bash "$script" outbox "${1:-status}"
}

status() {
  local fetched=1
  GITNET_TRIES=1 GITNET_TIMEOUT=20 gitnet -C "$main" fetch -q origin main >/dev/null 2>&1 || fetched=0
  if is_running; then echo "lander: running (pid $pid)"; else echo "lander: stopped"; fi
  if watch_is_running; then echo "watcher: running (pid $watch_pid)"; else echo "watcher: stopped"; fi
  stuck_status
  code_status lander.sh
  code_status watcher.sh
  watch_main_status
  outbox_status
  local f branch sha requested age now queue_count vals deferred_note deferred_until
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
    deferred_note=""
    if [[ -f "$data/deferred/$(basename "$f").until" ]]; then
      deferred_until="$(cat "$data/deferred/$(basename "$f").until" 2>/dev/null || echo 0)"; [[ "$deferred_until" =~ ^[0-9]+$ ]] || deferred_until=0
      if (( deferred_until > now )); then
        if [[ -s "$data/deferred/$(basename "$f").reason" ]]; then deferred_note=" (held: $(cat "$data/deferred/$(basename "$f").reason"); next look in $(( deferred_until - now ))s)"
        else deferred_note=" (GitHub did not answer; try $(cat "$data/deferred/$(basename "$f").n" 2>/dev/null || echo 1), next in $(( deferred_until - now ))s)"; fi
      fi
    fi
    echo "  $branch ${sha:0:7} ${age}s$deferred_note"
  done < <(find "$data/queue" -maxdepth 1 -type f -name '*.json' -print | sort)
  bash "$main/scripts/worktree-map.sh" counts 2>/dev/null || echo "worktrees: unknown (map build failed)"
  echo "last landings:"
  if [[ -f "$data/landings.jsonl" ]]; then
    tail -n 5 "$data/landings.jsonl" | python3 -c 'import json,sys,datetime
for line in sys.stdin:
 try:
  x=json.loads(line); ts=datetime.datetime.fromisoformat(x["ts"].replace("Z","+00:00")).astimezone().strftime("%Y-%m-%d %H:%M:%S"); print("%s %s %s %ss %s" % (ts, x["status"], x["branch"], x["seconds"], x["reason"]))
 except Exception: pass'
  fi
  if git -C "$main" log origin/main -1 --format='origin/main: %h %s' 2>/dev/null; then (( fetched )) || echo "origin/main: the line above may be stale (GitHub did not answer the last fetch)"; else echo "origin/main: unknown (fetch failed)"; fi
  service_state com.maipai.lander "$pidfile" "$(service_plist lander)"
  service_state com.maipai.watcher "$watch_pidfile" "$(service_plist watcher)"
}

# DISK-WAIT-01: block on a FIFO until a condition holds; the lander (ring_waiters) writes one line when it does. No loop, no sleep.
wait_cmd() {
  local kind="" a1="" tmo=3600 wdir="$data/waiters" line="" result=""
  shift
  while (($#)); do
    case "$1" in
      --timeout) (($# >= 2)) && [[ "$2" =~ ^[0-9]+$ ]] || { error "usage: bash scripts/pipeline.sh wait <landed SHA|queue-empty|main-green|branch BRANCH> [--timeout S]"; return 2; }; tmo="$2"; shift 2 ;;
      queue-empty|main-green) kind="$1"; shift ;;
      branch) (($# >= 2)) || { error "usage: wait branch BRANCH"; return 2; }; kind=branch; a1="$2"; shift 2 ;;
      *) [[ "$1" =~ ^[0-9a-fA-F]{7,64}$ ]] || { error "unknown wait condition '$1'; use a commit SHA, queue-empty, main-green or branch BRANCH."; return 2; }; kind=sha; a1="$1"; shift ;;
    esac
  done
  [[ -n "$kind" ]] || { error "usage: bash scripts/pipeline.sh wait <landed SHA|queue-empty|main-green|branch BRANCH> [--timeout S]"; return 2; }
  mkdir -p "$wdir"
  wait_fifo="$wdir/$$.fifo"; wait_want="$wdir/$$.want"; wait_timer=""
  wait_cleanup() { if [[ -n "$wait_timer" ]]; then pkill -P "$wait_timer" 2>/dev/null || true; kill "$wait_timer" 2>/dev/null || true; wait_timer=""; fi; exec 3<&- 2>/dev/null || true; rm -f "$wait_fifo" "$wait_want"; }
  trap wait_cleanup EXIT
  trap 'exit 130' INT TERM HUP
  rm -f "$wait_fifo"; mkfifo "$wait_fifo"
  exec 3<>"$wait_fifo"
  printf '%s\t%s\n' "$kind" "$a1" > "$wait_want"
  # Already true: print and exit.
  result="$(python3 - "$data" "$watch_data" "$kind" "$a1" <<'PY'
import glob, json, os, sys
data, watch, kind, a = sys.argv[1:]
def rd(p):
    try: return open(p).read().strip()
    except OSError: return ''
notes=[]
for f in glob.glob(os.path.join(data, 'notes', '*.json')):
    try: notes.append(json.load(open(f)))
    except Exception: pass
out=''
if kind == 'sha':
    for n in notes:
        if str(n.get('sha','')).startswith(a) and n.get('status') == 'landed': out = 'landed ' + a
    try:
        for line in open(os.path.join(data, 'landings.jsonl')):
            try: r = json.loads(line)
            except Exception: continue
            if str(r.get('sha','')).startswith(a) and r.get('status') == 'landed': out = 'landed ' + a
    except OSError: pass
elif kind == 'branch':
    for n in notes:
        if n.get('branch') == a: out = n.get('status', '')
elif kind == 'queue-empty':
    if not glob.glob(os.path.join(data, 'queue', '*.json')): out = 'queue empty'
elif kind == 'main-green':
    run = rd(os.path.join(watch, 'last-run'))
    if run and run == rd(os.path.join(watch, 'last-green')): out = 'main green at ' + run[:7]
print(out)
PY
)"
  if [[ -z "$result" && "$kind" == sha ]]; then
    GITNET_TRIES=1 GITNET_TIMEOUT=30 gitnet -C "$main" fetch -q origin main >/dev/null 2>&1 || true
    if git -C "$main" merge-base --is-ancestor "$a1" "$(pipeline_main_sha "$main" 2>/dev/null || echo origin/main)" 2>/dev/null; then result="landed $a1 (on main)"; fi
  fi
  if [[ -n "$result" ]]; then echo "$result"; return 0; fi
  if (( tmo == 0 )); then echo "pipeline.sh: timed out waiting for $kind $a1" >&2; return 2; fi
  ( sleep "$tmo"; echo TIMEOUT >&3 ) &
  wait_timer=$!
  IFS= read -r line <&3 || true
  if [[ "$line" == TIMEOUT || -z "$line" ]]; then echo "pipeline.sh: timed out waiting for $kind $a1; check the lander with: bash scripts/pipeline.sh status" >&2; return 2; fi
  echo "$line"
}

# sweep [--dry-run]: remove finished wt/* worktrees (DISK-REMOVE-01). A worktree goes only when all of these are proven:
# branch tip is on origin/main, nothing uncommitted (ignored files aside), no process has it as cwd, no file changed
# in the last 10 minutes. Anything unproven stays and gets one line in reaped.md. Never uses --force.
has_landing_record() {
  local slug="${1//\//-}"
  grep -q '"status": *"landed"' "$data/notes/$slug.json" 2>/dev/null && return 0
  grep -F "\"branch\": \"$1\"" "$data/landings.jsonl" 2>/dev/null | grep -q '"status": *"landed"'
}

sweep() {
  local dry=0 sdir pdir reaped f name path branch real reason lsout="" lsrc=0 tip porcelain
  [[ "${1:-}" == "--dry-run" ]] && dry=1
  sdir="${MAIPAI_WT_DATA:-$main/data-scratch}/sessions"; pdir="${MAIPAI_WT_DATA:-$main/data-scratch}/ports"
  reaped="${MAIPAI_WT_DATA:-$main/data-scratch}/reaped.md"
  [[ -d "$sdir" ]] || return 0
  lsout="$(lsof -d cwd -Fn 2>/dev/null)" || lsrc=$?
  for f in "$sdir"/*.json; do
    [[ -f "$f" ]] || continue
    name="$(basename "$f" .json)"
    IFS='|' read -r path branch < <(python3 - "$f" <<'PY'
import json,sys
try:
 v=json.load(open(sys.argv[1])); print('%s|%s' % (v.get('path',''),v.get('branch','')))
except Exception: print('|')
PY
)
    [[ "$branch" == wt/* && -n "$path" ]] || continue
    if [[ ! -e "$path/.git" ]]; then continue; fi
    real="$(cd "$path" 2>/dev/null && pwd -P)" || continue
    [[ "$real" != "$main" && "$real" != "$(cd "$main/.." && pwd -P)/home-lander" ]] || continue
    reason=""
    tip="$(git -C "$main" rev-parse --verify -q "refs/heads/$branch" 2>/dev/null || true)"
    if [[ -z "$tip" ]]; then reason="branch ref not found"
    elif ! git -C "$main" merge-base --is-ancestor "$tip" origin/main 2>/dev/null; then reason="branch has commits not on origin/main"
    elif ! has_landing_record "$branch"; then reason="no landing record"
    elif ! porcelain="$(git -C "$real" status --porcelain 2>/dev/null)"; then reason="git status failed"
    elif [[ -n "$porcelain" ]]; then reason="uncommitted or untracked files"
    elif [[ "$lsrc" != 0 && -z "$lsout" ]]; then reason="lsof failed, cannot rule out a running process"
    elif printf '%s\n' "$lsout" | WT_P="$real" awk 'substr($0,1,1)=="n" {d=substr($0,2); p=ENVIRON["WT_P"]; if (d==p || index(d, p "/")==1) f=1} END {exit !f}'; then reason="a process has its working directory inside"
    elif [[ -n "$(find "$real" \( -name node_modules -o -name .git \) -prune -o -type f -mmin -10 -print -quit 2>/dev/null)" ]]; then reason="a file changed within the last 10 minutes"
    fi
    if [[ -n "$reason" ]]; then
      if (( dry )); then echo "keep $name: $reason"; else
        grep -qF "| $name | $path | kept: $reason" "$reaped" 2>/dev/null || printf '%s | %s | %s | kept: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$name" "$path" "$reason" >> "$reaped"
      fi
      continue
    fi
    if (( dry )); then echo "would remove $name ($real)"; continue; fi
    if git -C "$main" worktree remove "$real" >/dev/null 2>&1; then
      git -C "$main" branch -d "$branch" >/dev/null 2>&1 || true
      rm -f "$f" "$sdir/$name.beat"
      find "$pdir" -type f -name '*.lease' -exec grep -lF "$name" {} \; -delete 2>/dev/null || true
      echo "removed $name"
    else
      grep -qF "| $name | $path | kept: git worktree remove refused" "$reaped" 2>/dev/null || printf '%s | %s | %s | kept: git worktree remove refused\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$name" "$path" >> "$reaped"
    fi
  done
}

case "${1:-}" in
  status) status ;;
  wait) wait_cmd "$@" ;;
  sweep) shift; sweep "$@" ;;
  outbox) outbox_cmd "$@" ;;
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
  stack)
    # The Stack holds the chat engine (about 32 GB) and picture workers; while the queue is deep and nobody uses the app,
    # stopping it frees memory and CPU for landings and the watcher. MAIPAI_STACK_LABEL / MAIPAI_STACK_PLIST are test seams.
    stack_label="${MAIPAI_STACK_LABEL:-com.maipai.stack}"; stack_plist="${MAIPAI_STACK_PLIST:-$agents_dir/com.maipai.stack.plist}"; stack_uid="$(id -u)"
    stack_loaded() { "$launchctl_cmd" print "gui/$stack_uid/$stack_label" >/dev/null 2>&1; }
    case "${2:-status}" in
      off) if stack_loaded; then "$launchctl_cmd" bootout "gui/$stack_uid/$stack_label" && echo "stack stopped; bring it back with: bash scripts/pipeline.sh stack on"; else echo "stack already stopped"; fi ;;
      on) if stack_loaded; then echo "stack already running"; else "$launchctl_cmd" bootstrap "gui/$stack_uid" "$stack_plist" && echo "stack started"; fi ;;
      status) if stack_loaded; then echo "stack: running"; else echo "stack: stopped"; fi ;;
      *) error "usage: bash scripts/pipeline.sh stack off | on | status"; exit 2 ;;
    esac
    ;;
  fsmonitor)
    # Repo-local core.fsmonitor / core.untrackedCache for the main, lander and watcher checkouts only. Off by default.
    fs_dirs=("$main" "$main/../home-lander" "$main/../home-watcher")
    case "${2:-status}" in
      on|off)
        if [[ "$2" == on ]]; then fs_val=true; else fs_val=false; fi
        for d in "${fs_dirs[@]}"; do
          [[ -e "$d/.git" ]] || { echo "skipped (no checkout): $d"; continue; }
          git -C "$d" config --local core.fsmonitor "$fs_val"; git -C "$d" config --local core.untrackedCache "$fs_val"
          echo "$d: fsmonitor $fs_val"
        done ;;
      status)
        for d in "${fs_dirs[@]}"; do
          [[ -e "$d/.git" ]] || { echo "skipped (no checkout): $d"; continue; }
          echo "$d: fsmonitor=$(git -C "$d" config --local core.fsmonitor 2>/dev/null || echo unset) untrackedCache=$(git -C "$d" config --local core.untrackedCache 2>/dev/null || echo unset)"
        done
        echo "fsmonitor daemons: $(ps -axo command= 2>/dev/null | grep -c 'fsmonitor--daemon' || true)" ;;
      *) error "usage: bash scripts/pipeline.sh fsmonitor on | off | status"; exit 2 ;;
    esac
    ;;
  *) error "usage: bash scripts/pipeline.sh status | wait <SHA|queue-empty|main-green|branch B> | fsmonitor on|off|status | start | stop | stack off|on|status | sweep [--dry-run] | outbox [status|flush|reset-to-github] | install-service [--load] | uninstall-service"; exit 2 ;;
esac
