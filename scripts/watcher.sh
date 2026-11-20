#!/usr/bin/env bash
# MAIPAI_WATCH_LEGS selects real sharder legs; they run scripts, backend, frontend.
# Quiet check sums CPU used by suite-related processes; MAIPAI_WATCH_MAX_CPU defaults to 200.
# Bounds: MAIPAI_WATCH_QUIET_MAX_SECONDS=300, MAIPAI_WATCH_LANDER_BUSY_SECONDS=120,
# MAIPAI_WATCH_LEG_MAX_SECONDS=1500, MAIPAI_WATCH_BISECT_MAX_SECONDS=600,
# MAIPAI_WATCH_BISECT_CANDIDATES=4, MAIPAI_WATCH_BISECT_RERUNS=1.
# Worker ceilings: MAIPAI_WATCH_BACKEND_SHARDS=10,
# MAIPAI_WATCH_FRONTEND_SHARDS=12, MAIPAI_WATCH_SCRIPTS_SHARDS=8.
set -euo pipefail
umask 077
# WATCH-PATH-01: the LaunchAgent PATH lacks ~/.local/bin, where deno lives. Without it the music package's deno smoke test cannot
# start at boot, the package is disabled, and backend/tests/seed.test.ts failed on every run with a 404 on the radio station POST.
for extra in "$HOME/.local/bin" /usr/local/bin; do [[ -d "$extra" && ":$PATH:" != *":$extra:"* ]] && PATH="$PATH:$extra"; done || true
export PATH

error() { echo "watcher.sh: $1" >&2; }
common="$(git rev-parse --git-common-dir 2>/dev/null)" || { error "not inside a git checkout; run this from the main checkout."; exit 1; }
[[ "$common" = /* ]] || common="$(cd "$(dirname "$common")" && pwd -P)/$(basename "$common")"
main="$(cd "$(dirname "$common")" && pwd -P)"
bin="${MAIPAI_PIPELINE_BIN:-$main/data-scratch/pipeline-bin}"
data="${MAIPAI_WATCH_DATA:-$main/data-scratch/watch}"
checkout="${MAIPAI_WATCH_CHECKOUT:-$(cd "$main/.." && pwd -P)/home-watcher}"
gate_lock="${MAIPAI_GATE_LOCK:-$(cd "$main/.." && pwd -P)/.github/standards/bin/gate-lock.sh}"
watcher_lock_held=0
mkdir -p "$data/green" "$data/reds"
mkdir -p "$data/t2-wanted" "$data/t2-red" "$data/t2-discharged"
git_env="${MAIPAI_LAND_GIT_ENV-$main/data-scratch/bin/https-git.env}"
if [[ -n "$git_env" && -f "$git_env" ]]; then source "$git_env"; fi

# LIBS-REFRESH-01: every helper this script sources (scripts/lib/*.sh) is a snapshot taken from origin/main, like this script. They are all
# copied (temp file, then rename) BEFORE any of them is sourced, so a new script never runs against an older helper (2026-11-02: a new
# lander.sh called deps_ensure, added to lib/deps.sh, and failed at startup with "command not found"). When origin/main cannot be read,
# the copies already in $bin stay as they are.
refresh_libs() {
  local names name base tmp
  names="$(git -C "$main" ls-tree --name-only origin/main scripts/lib/ 2>/dev/null)" || return 0
  mkdir -p "$bin"
  while IFS= read -r name; do
    [[ "$name" == scripts/lib/*.sh ]] || continue
    base="${name##*/}"; tmp="$bin/$base.new.$$"
    if git -C "$main" show "origin/main:$name" >"$tmp" 2>/dev/null && [[ -s "$tmp" ]]; then
      if cmp -s "$tmp" "$bin/$base" 2>/dev/null; then rm -f "$tmp"; else mv -f "$tmp" "$bin/$base" || rm -f "$tmp"; fi
    else
      rm -f "$tmp"
    fi
  done <<<"$names"
}
libs_hash() {
  local f
  for f in "$bin"/*.sh; do
    case "${f##*/}" in lander.sh|watcher.sh|pipeline.sh) continue ;; esac
    [[ -f "$f" ]] && printf '%s %s\n' "${f##*/}" "$(git -C "$main" hash-object "$f" 2>/dev/null || true)"
  done | cksum
}
refresh_libs

# GITNET-01: every remote git operation and the dependency install are bounded (scripts/lib/gitnet.sh, kept fresh in $bin by the lander).
# A fetch that never answers used to freeze the watcher with its pid file held; now it times out, retries and logs. Plain git until the lib exists.
gitnet_lib="$bin/gitnet.sh"
[[ -f "$gitnet_lib" ]] || gitnet_lib="$main/scripts/lib/gitnet.sh"
# OUTBOX-01: this script and the helper are separate snapshots taken from origin/main (the lander refreshes both, one after the other). A new
# script that finds an older helper takes the helper from origin/main itself before it sources it, so the two never run out of step.
if [[ "$gitnet_lib" == "$bin/gitnet.sh" && -f "$gitnet_lib" ]] && ! grep -q 'pipeline_main_sha()' "$gitnet_lib" 2>/dev/null; then
  helper_tmp="$gitnet_lib.new"
  if git -C "$main" show "origin/main:scripts/lib/gitnet.sh" >"$helper_tmp" 2>/dev/null && grep -q 'pipeline_main_sha()' "$helper_tmp"; then mv -f "$helper_tmp" "$gitnet_lib"; else rm -f "$helper_tmp"; fi
fi
if [[ -f "$gitnet_lib" ]]; then source "$gitnet_lib"
else
  gitnet_env() { :; }
  bounded_run() { shift 2; "$@"; }
  gitnet() { git "$@"; }
  pipeline_main_sha() { git -C "${1:-.}" rev-parse origin/main; }
fi
declare -F pipeline_main_sha >/dev/null || pipeline_main_sha() { git -C "${1:-.}" rev-parse origin/main; }
mkdir -p "$data/ops"
GITNET_TIMED_OUT=0
export GITNET_OPS_DIR="$data/ops" GITNET_STUCK_LOG="$data/stuck.log"
gitnet_env "$main"

# DEPS-SELFHEAL-01: same install helper as the lander (kept fresh in $bin by the lander).
deps_lib="$bin/deps.sh"
[[ -f "$deps_lib" ]] || deps_lib="$main/scripts/lib/deps.sh"
if [[ -f "$deps_lib" ]]; then source "$deps_lib"
else
  DEPS_ERROR=""; DEPS_LAST_RC=0
  install_deps() { local dir="$1"; shift; bounded_run "${DEPS_INSTALL_SECONDS:-600}" "${DEPS_INSTALL_LABEL:-bun install}" bash -c 'cd "$1" && shift && bun install --frozen-lockfile "$@"' _ "$dir" "$@"; }
  deps_current() { return 1; }
fi

refresh_snapshot() {
  local script="$1" current="$bin/$1" tmp="$bin/$1.new"
  mkdir -p "$bin"
  local interval="${MAIPAI_REFRESH_FETCH_SECONDS:-1800}" now last_fetch ref fetch_rc
  [[ "$interval" =~ ^[0-9]+$ ]] || interval=1800
  now="$(date +%s)"
  last_fetch="$(cat "$bin/.last-refresh-fetch" 2>/dev/null || true)"
  if [[ -z "${REFRESH_SKIP_FETCH:-}" ]] && { [[ "${REFRESH_FETCH:-0}" == 1 ]] || [[ ! "$last_fetch" =~ ^[0-9]+$ ]] || (( now < last_fetch || now - last_fetch >= interval )); }; then
    GITNET_TRIES=1 GITNET_TIMEOUT=30 GITNET_LABEL="refresh fetch" gitnet -C "$main" fetch -q origin main >/dev/null 2>&1 && fetch_rc=0 || fetch_rc=$?
    printf '%s\n' "$now" > "$bin/.last-refresh-fetch"
  fi
  ref="$(pipeline_main_sha "$main" 2>/dev/null || true)"
  [[ -n "$ref" ]] || ref=origin/main
  if ! git -C "$main" show "$ref:scripts/$script" > "$tmp" 2>/dev/null || [[ ! -s "$tmp" ]]; then
    if ! git -C "$main" show "origin/main:scripts/$script" > "$tmp" 2>/dev/null || [[ ! -s "$tmp" ]]; then rm -f "$tmp"; return 1; fi
  fi
  if [[ ! -f "$current" ]] || ! cmp -s "$tmp" "$current"; then
    mv -f "$tmp" "$current" || { rm -f "$tmp"; return 1; }
    echo changed
  else
    rm -f "$tmp"
    echo unchanged
  fi
}

atomic_value() {
  local path="$1" value="$2" tmp
  tmp="$(mktemp "$(dirname "$path")/.watch.XXXXXX")"
  printf '%s\n' "$value" > "$tmp"
  mv -f "$tmp" "$path"
}

# WATCHER-STARVED-01 follow-up: a test leg that prints nothing and uses no CPU for MAIPAI_WATCH_IDLE_SECONDS (default 600) is hung, not slow. The leg limit alone left a hung
# shard holding the machine-wide gate lock for up to 25 minutes (2026-11-20). cpu_seconds_of_tree prints the CPU seconds used so far by a process and all its descendants.
cpu_seconds_of_tree() {
  ps -axo pid=,ppid=,cputime= 2>/dev/null | awk -v root="$1" '
    { pid[NR]=$1; ppid[NR]=$2; t=$3; n=split(t, a, ":"); s=a[n]+0; if (n>1) s+=60*a[n-1]; if (n>2) s+=3600*a[n-2]; cpu[$1]=s; par[$1]=$2; seen[NR]=$1 }
    END {
      keep[root]=1; changed=1
      while (changed) { changed=0; for (i=1;i<=NR;i++) { p=seen[i]; if (!(p in keep) && (par[p] in keep)) { keep[p]=1; changed=1 } } }
      total=0; for (p in keep) if (p in cpu) total+=cpu[p]
      printf "%d\n", total
    }'
}

# idle_watch <leg_pid> <output file> <flag file>: runs beside a leg. When the output file has not grown and the leg tree has used no CPU for the idle limit,
# it writes the flag and stops the leg's process group (TERM, then KILL). The leg then counts as stopped (unverified), like a job.sh stop.
idle_watch() {
  local pid="$1" file="$2" flag="$3" limit poll last_size=-1 size last_cpu=-1 cpu idle_since now
  limit="${MAIPAI_WATCH_IDLE_SECONDS:-600}"; [[ "$limit" =~ ^[0-9]+$ ]] || limit=600
  poll="${MAIPAI_WATCH_IDLE_POLL_SECONDS:-30}"; [[ "$poll" =~ ^[0-9]+$ ]] || poll=30
  (( limit > 0 )) || return 0
  idle_since="$(date +%s)"
  while kill -0 "$pid" 2>/dev/null; do
    sleep "$poll"
    kill -0 "$pid" 2>/dev/null || return 0
    size="$(wc -c < "$file" 2>/dev/null | tr -d ' ' || echo 0)"; cpu="$(cpu_seconds_of_tree "$pid")"
    now="$(date +%s)"
    if [[ "$size" != "$last_size" || "$cpu" != "$last_cpu" ]]; then idle_since="$now"; last_size="$size"; last_cpu="$cpu"; continue; fi
    if (( now - idle_since >= limit )); then
      : > "$flag"
      kill -TERM -"$pid" 2>/dev/null || true; sleep 5; kill -KILL -"$pid" 2>/dev/null || true
      return 0
    fi
  done
}

watch_unverified_age() {
  python3 - "$data" "${1:-$(date +%s)}" <<'PY'
import datetime,json,os,sys
d,now=sys.argv[1],int(sys.argv[2]); newest=0; earliest=0; stamp='never'
try:
 for line in open(os.path.join(d,'runs.jsonl')):
  try: r=json.loads(line)
  except Exception: continue
  ts=r.get('ts','')
  try: n=int(datetime.datetime.fromisoformat(ts.replace('Z','+00:00')).timestamp())
  except Exception: continue
  if earliest==0 or n<earliest: earliest=n
  if r.get('result') in ('green','flaky','red') and n>newest: newest=n; stamp=ts
except OSError: pass
# No finished run yet: the gap runs from the first record of any kind (a fresh data folder is not 490,000 hours unverified); no record at all is no gap.
if newest: print(max(0,now-newest), stamp)
elif earliest: print(max(0,now-earliest), 'no finished run yet')
else: print(0, 'never')
PY
}

watch_unverified_alert() {
  local now age stamp threshold key="$data/main-unverified-gap" note="$data/main-unverified.md"
  now="$(date +%s)"; read -r age stamp < <(watch_unverified_age "$now")
  threshold="${MAIPAI_WATCH_UNVERIFIED_SECONDS:-86400}"; [[ "$threshold" =~ ^[0-9]+$ ]] || threshold=86400
  if (( age >= threshold )); then
    if [[ "$(cat "$key" 2>/dev/null || true)" != "$stamp" ]]; then
      printf 'Main has no finished green, flaky or red run for %s hours. Last finished run: %s\n' "$((age/3600))" "$stamp" >"$note"
      file_issue "Watcher: main unverified for $((age/3600)) hours" unverified "$note" || true
      atomic_value "$key" "$stamp"
    fi
  elif [[ -f "$key" ]]; then
    local title="Watcher: main unverified" number
    number="$(cat "$key")"
    if [[ -n "${MAIPAI_WATCH_ISSUE_CMD:-}" ]]; then
      (cd "$main" && bash -c "${MAIPAI_WATCH_CLOSE_ISSUE_CMD:-:} \"\$1\" \"\$2\"" _ "$title" "Main verification resumed at $stamp") >>"$data/watcher.log" 2>&1 || echo "watcher.sh: could not close unverified issue" >>"$data/watcher.log"
    else
      number="$(gh issue list -R getmaipai/home --state open --search 'Watcher: main unverified' --limit 5 --json number -q '.[0].number' 2>/dev/null | head -n 1 || true)"
      [[ -z "$number" ]] || gh issue close "$number" -R getmaipai/home --comment "Main verification resumed at $stamp" >>"$data/watcher.log" 2>&1 || echo "watcher.sh: could not close unverified issue" >>"$data/watcher.log"
    fi
    rm -f "$key"
  fi
}

t2_pick_oldest() {
  python3 - "$data/t2-wanted" "$data/t2-red" "${MAIPAI_WATCH_T2_RERUN_SECONDS:-21600}" <<'PY'
import os,sys,datetime,time
d,red,rerun=sys.argv[1],sys.argv[2],int(sys.argv[3]) if sys.argv[3].isdigit() else 21600
now=time.time(); entries=[]
for name in os.listdir(d):
 p=os.path.join(d,name)
 if not os.path.isfile(p): continue
 lines=open(p,errors='replace').read().splitlines(); stamp=lines[-1] if lines else ''
 try: n=datetime.datetime.fromisoformat(stamp.replace('Z','+00:00')).timestamp()
 except Exception: n=os.stat(p).st_mtime
 r=os.path.join(red,name)
 if os.path.isfile(r):
  try:
   seen=open(r+'.newer').read().strip() if os.path.isfile(r+'.newer') else stamp
   if now-int(open(r).read().split()[0])<rerun and seen==stamp: continue
  except Exception: pass
 entries.append((n,name))
if entries: print(min(entries)[1])
PY
}

t2_discharge() {
  local head="$1" result="$2" discharged="" sha
  [[ "$result" != stalled ]] || return 0
  while IFS= read -r sha; do
    [[ -n "$sha" ]] || continue
    if git -C "$checkout" merge-base --is-ancestor "$sha" "$head" 2>/dev/null; then
      mv -f "$data/t2-wanted/$sha" "$data/t2-discharged/$sha"
      discharged="${discharged:+$discharged }${sha:0:7}"
    fi
  done < <(find "$data/t2-wanted" -maxdepth 1 -type f -exec basename {} \;)
  if [[ -n "$discharged" ]]; then echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) T2 obligations discharged: $discharged" >>"$data/watcher.log"; fi
  printf '%s' "$discharged"
}

checkout_warm() {
  if [[ ! -e "$checkout/.git" ]]; then
    gitnet -C "$main" fetch origin || { error "could not fetch origin; check network and git credentials, then retry checkout."; return 1; }
    git -C "$main" worktree add --detach "$checkout" origin/main || { error "could not create warm checkout at $checkout; remove a stale path and retry."; return 1; }
  fi
}

# INSTALL-STAMP-01 (2026-11-02): install when node_modules was not installed from the package.json and bun.lock now in the checkout (a stamp inside
# node_modules, lib/deps.sh), not when HEAD history shows a package file moved: a failed install or a pin that landed while the watcher was busy
# left the old packages in place and every later run failed the same way.
install_if_needed() {
  [[ -z "${MAIPAI_WATCH_SKIP_INSTALL:-}" ]] || return 0
  local d
  for d in backend frontend; do
    [[ -d "$checkout/$d" ]] || continue
    deps_current "$checkout/$d" && continue
    # --force for the same reason as the lander: a changed commons pin is a file: dependency and a plain install keeps the old snapshot.
    DEPS_INSTALL_SECONDS="${MAIPAI_WATCH_INSTALL_SECONDS:-600}" DEPS_INSTALL_LABEL="bun install $d" install_deps "$checkout/$d" --force || { error "bun install failed or timed out in $d${DEPS_ERROR:+ ($DEPS_ERROR)}; repair dependencies in $checkout and retry."; return 1; }
  done
}

append_run() {
  python3 - "$data/runs.jsonl" "$1" "$2" "$3" "$4" "$5" <<'PY'
import json, sys, datetime
path, sha, result, seconds, files, culprit = sys.argv[1:]
with open(path, "a") as out:
    out.write(json.dumps(dict(ts=datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z"), sha=sha, result=result, seconds=int(seconds), failing=files.split() if files else [], culprit=culprit or None)) + "\n")
PY
}

# LAND-FIRST-01 (2026-11-12): in DIRECT mode a landing waits for no check, so the typecheck and the boot check of the landed main run
# here, before the suite. A failure is recorded red (runs.jsonl, a note in reds/, the issue) exactly like a failing suite and never holds a
# landing; the suite is skipped for that head (the next head runs everything again). GATED and unset modes check before landing and skip this.
watcher_direct() {
  local lib="$main/scripts/lib/mode.sh"
  [[ -f "$lib" ]] || lib="$checkout/scripts/lib/mode.sh"
  [[ -f "$lib" ]] || return 1
  [[ "$( export MAIPAI_MODE_FILE="${MAIPAI_MODE_FILE:-$main/data-scratch/mode}"; source "$lib"; mode_get )" == direct ]]
}
post_landing_check() {
  local out="$1" command="${MAIPAI_WATCH_POST_CMD:-}"
  [[ -n "$command" ]] || command='bash scripts/check.sh --pre && (cd frontend && bunx eslint . --cache --cache-location .eslintcache) && { [[ ! -f scripts/boot-check.sh ]] || bash scripts/boot-check.sh; }'
  (cd "$checkout" && MAIPAI_COMMONS_DIR="$(cd "$main/.." && pwd -P)/commons" MAIPAI_STANDARDS_DIR="$(cd "$main/.." && pwd -P)/.github" MAIPAI_GATE_NO_FETCH=1 \
    bounded_run "${MAIPAI_WATCH_POST_SECONDS:-900}" "post-landing check" nice -n "${MAIPAI_WATCH_NICE:-10}" bash -c "$command") >"$out" 2>&1
}

mark_green() {
  local sha="$1" tmp
  tmp="$(mktemp "$data/green/.green.XXXXXX")"
  mv -f "$tmp" "$data/green/$sha"
}

run_suite() {
  local output="$1" command="${MAIPAI_WATCH_SUITE_CMD:-}"
  if [[ -n "$command" ]]; then
    (cd "$checkout" && bash -c "$command") >"$output" 2>&1
  else
    local leg rc=0 shards root leg_output leg_status leg_rc leg_seconds wait_rc timed_out leg_limit idle_pid
    local requested configured="${MAIPAI_WATCH_LEGS:-backend frontend scripts}"
    local -a requested_legs=() legs=()
    read -r -a requested_legs <<< "$configured"
    if [[ "${#requested_legs[@]}" -eq 0 ]]; then error "MAIPAI_WATCH_LEGS must name backend, frontend, and/or scripts."; return 2; fi
    for requested in "${requested_legs[@]}"; do
      case "$requested" in backend|frontend|scripts) ;; *) error "unknown MAIPAI_WATCH_LEGS entry: $requested"; return 2 ;; esac
    done
    for leg in scripts backend frontend; do
      for requested in "${requested_legs[@]}"; do
        if [[ "$requested" == "$leg" ]]; then legs+=("$leg"); break; fi
      done
    done
    : > "$output"; rm -f "$output.stopped"
    for leg in "${legs[@]}"; do
      leg_output="$output.$leg"
      leg_status="$output.$leg.status"
      case "$leg" in
        backend) shards="${MAIPAI_WATCH_BACKEND_SHARDS:-10}"; root=tests ;;
        frontend) shards="${MAIPAI_WATCH_FRONTEND_SHARDS:-12}"; root=. ;;
        scripts) shards="${MAIPAI_WATCH_SCRIPTS_SHARDS:-8}"; root=. ;;
      esac
      min_shards="${MAIPAI_WATCH_MIN_SHARDS:-8}"
      [[ "$min_shards" =~ ^[0-9]+$ ]] || min_shards=8
      (( min_shards > shards )) && min_shards="$shards"
      leg_limit="${MAIPAI_WATCH_LEG_MAX_SECONDS:-1500}"
      [[ "$leg_limit" =~ ^[0-9]+$ ]] || leg_limit=1500
      timed_out=""
      local_started="$(date +%s)"
      (cd "$checkout" && export MAIPAI_GATE_MIN_SHARDS="$min_shards" MAIPAI_GATE_YIELD_FILE="${MAIPAI_LAND_DATA:-$main/data-scratch/land}/current-entry" MAIPAI_COMMONS_DIR="$(cd "$main/.." && pwd -P)/commons" MAIPAI_STANDARDS_DIR="$(cd "$main/.." && pwd -P)/.github" && exec perl -e 'setpgrp(0, 0); exec @ARGV' -- bash -c 'started=$(date +%s); nice -n ${MAIPAI_WATCH_NICE:-10} bun scripts/gate/shardTests.ts --dir "$1" --root "$2" --shards "$3"; rc=$?; printf "%s %s\n" "$rc" "$(( $(date +%s) - started ))" > "$4"; exit "$rc"' _ "$leg" "$root" "$shards" "$leg_status") >"$leg_output" 2>&1 &
      leg_pid=$!
      rm -f "$leg_status.idle"
      idle_watch "$leg_pid" "$leg_output" "$leg_status.idle" &
      idle_pid=$!
      if (( leg_limit > 0 )); then
        ( sleep "$leg_limit"; if kill -0 "$leg_pid" 2>/dev/null; then : > "$leg_status.timeout"; kill -TERM -"$leg_pid" 2>/dev/null || true; sleep 10; kill -KILL -"$leg_pid" 2>/dev/null || true; fi ) &
        watchdog_pid=$!
        if wait "$leg_pid"; then wait_rc=0; else wait_rc=$?; fi
        pkill -P "$watchdog_pid" 2>/dev/null || true
        kill "$watchdog_pid" 2>/dev/null || true
        wait "$watchdog_pid" 2>/dev/null || true
      else
        if wait "$leg_pid"; then wait_rc=0; else wait_rc=$?; fi
      fi
      pkill -P "$idle_pid" 2>/dev/null || true
      kill "$idle_pid" 2>/dev/null || true
      wait "$idle_pid" 2>/dev/null || true
      if [[ -e "$leg_status.idle" ]]; then
        printf '%s\n' "$leg" >> "$output.stopped"
        printf 'shard: leg %s was stopped after %s s with no output and no CPU (hung); it is not counted as a failure or a pass\n' "$leg" "${MAIPAI_WATCH_IDLE_SECONDS:-600}" >> "$output"
        echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) leg $leg hung (no output, no CPU for ${MAIPAI_WATCH_IDLE_SECONDS:-600} s): stopped, the pass is unverified" >> "$data/watcher.log"
        rm -f "$leg_output" "$leg_status" "$leg_status.timeout" "$leg_status.idle"
        continue
      fi
      if [[ -e "$leg_status.timeout" ]]; then
        printf '124 %s timed_out\n' "$(( $(date +%s) - local_started ))" > "$leg_status"
        printf '== leg: %s (exit 124, timed out after %s s)\n' "$leg" "$leg_limit" >> "$output"
      fi
      leg_output="$output.$leg"
      leg_status="$output.$leg.status"
      if [[ -s "$leg_status" ]] && read -r leg_rc leg_seconds timed_out < "$leg_status"; then
        :
      else
        leg_rc=137
        leg_seconds=0
      fi
      if [[ "$timed_out" == timed_out ]]; then :
      else printf '== leg: %s (exit %s, %s s)\n' "$leg" "$leg_rc" "$leg_seconds" >> "$output"; fi
      if [[ "$leg_rc" -eq 137 && ! -s "$leg_status" ]]; then
        printf 'shard: failing files: unknown\n' >> "$output"
      fi
      cat "$leg_output" >> "$output"
      # WATCHER-STARVED-01: a leg job.sh stopped ("STOPPED: ... This is not a pass", memory pressure or any other stop) did not run to the end. It is neither a failure nor a pass:
      # it is listed in "$output.stopped", and the pass says which legs did not run.
      if (( leg_rc != 0 )) && grep -q '^job\.sh: STOPPED:' "$leg_output" 2>/dev/null; then
        printf '%s\n' "$leg" >> "$output.stopped"
        printf 'shard: leg %s was stopped before it finished; it is not counted as a failure or a pass\n' "$leg" >> "$output"
        rm -f "$leg_output" "$leg_status" "$leg_status.timeout"
        continue
      fi
      rm -f "$leg_output" "$leg_status" "$leg_status.timeout"
      (( leg_rc == 0 )) || rc=1
    done
    return "$rc"
  fi
}

failing_files() {
  local output="$1" leg="" line file command="${MAIPAI_WATCH_SUITE_CMD:-}" seen=" "
  local -a files=()
  if [[ -n "$command" ]]; then
    while IFS= read -r line; do
      for file in $line; do
        case "$seen" in *" $file "*) ;; *) [[ -n "$file" ]] && { files+=("$file"); seen+="$file "; } ;; esac
      done
    done < <(sed -n -E 's/^(shard: )?failing files:[[:space:]]*//p' "$output")
  else
    while IFS= read -r line; do
      if [[ "$line" =~ ^==[[:space:]]leg:[[:space:]](backend|frontend|scripts)[[:space:]]\(exit[[:space:]] ]]; then
        leg="${BASH_REMATCH[1]}"
      elif [[ "$line" =~ ^shard:\ failing\ files:[[:space:]]*(.*)$ ]]; then
        for file in ${BASH_REMATCH[1]}; do
          [[ "$file" == unknown ]] || file="$leg/$file"
          case "$seen" in *" $file "*) ;; *) [[ -n "$leg" && -n "$file" ]] && { files+=("$file"); seen+="$file "; } ;; esac
        done
      fi
    done < "$output"
  fi
  # bash 3.2 (macOS) treats an empty array as unset under set -u; the ${var+...} guard keeps "no failing files" a plain empty string.
  printf '%s' "${files[*]+${files[*]}}"
}

rerun_file() {
  local file="$1" command="${MAIPAI_WATCH_RERUN_CMD:-}"
  if [[ -n "$command" ]]; then (cd "$checkout" && nice -n ${MAIPAI_WATCH_NICE:-10} bash -c "$command \"\$1\"" _ "$file")
  elif [[ "$file" == backend/* ]]; then (cd "$checkout/backend" && nice -n ${MAIPAI_WATCH_NICE:-10} bun test --timeout 20000 "${file#backend/}")
  elif [[ "$file" == frontend/* ]]; then (cd "$checkout/frontend" && nice -n ${MAIPAI_WATCH_NICE:-10} bun test --timeout 20000 "${file#frontend/}")
  elif [[ "$file" == scripts/* ]]; then (cd "$checkout" && nice -n ${MAIPAI_WATCH_NICE:-10} bun test --timeout 20000 "$file")
  else return 1
  fi
}

candidate_is_red() {
  local candidate="$1" files="$2" file reruns="${MAIPAI_WATCH_BISECT_RERUNS:-1}" attempt
  [[ "$reruns" =~ ^[1-9][0-9]*$ ]] || reruns=1
  git -C "$checkout" checkout --detach "$candidate" >/dev/null 2>&1 || return 1
  for file in $files; do
    for (( attempt=1; attempt<=reruns; attempt++ )); do
      if rerun_file "$file" >/dev/null 2>&1; then break; fi
      if (( attempt == reruns )); then return 0; fi
    done
  done
  return 1
}

file_is_red() {
  local file="$1" reruns="${MAIPAI_WATCH_RERUNS:-3}" attempt
  [[ "$reruns" =~ ^[1-9][0-9]*$ ]] || reruns=3
  for (( attempt=1; attempt<=reruns; attempt++ )); do
    if rerun_file "$file" >/dev/null 2>&1; then return 1; fi
  done
  return 0
}

file_flake_issue() {
  local file="$1" issue_file="$data/flake-issues.json" details title body
  details="$(python3 - "$data/runs.jsonl" "$issue_file" "$file" <<'PY'
import datetime, json, os, sys
runs_path, issues_path, target = sys.argv[1:]
try:
    issues=json.load(open(issues_path))
    if not isinstance(issues, dict): issues={}
except Exception: issues={}
if target in issues: raise SystemExit(0)
now=datetime.datetime.now(datetime.timezone.utc)
since=now-datetime.timedelta(days=7)
matches=[]
try:
    with open(runs_path) as f:
        for line in f:
            try: run=json.loads(line)
            except Exception: continue
            if run.get('result') != 'flaky' or target not in run.get('failing', []): continue
            try: ts=datetime.datetime.fromisoformat(run['ts'].replace('Z','+00:00'))
            except Exception: continue
            if since <= ts <= now: matches.append((ts, run))
except OSError: pass
if len(matches) >= 3:
    for _, run in matches[-3:]: print('%s %s' % (run.get('ts','unknown'), run.get('sha','unknown')))
PY
)"
  [[ -n "$details" ]] || return 0
  title="Flaky: $file failed with the suite and passed alone 3 times in 7 days"
  body="$(printf 'The last three flaky suite runs for %s were:\n%s\n\nMove this file to scripts/gate/flakes.json as bench or serial, with the cause.\n\nfiled by the watcher' "$file" "$details")"
  local body_file
  body_file="$(mktemp "$data/.flake-issue.XXXXXX")"
  printf '%s\n' "$body" > "$body_file"
  set +e
  file_issue "$title" "$file" "$body_file"
  local issue_rc=$?
  set -e
  rm -f "$body_file"
  (( issue_rc == 0 )) || return 0
  python3 - "$issue_file" "$file" <<'PY'
import json, os, sys, tempfile, datetime
path, target = sys.argv[1:]
try:
    value=json.load(open(path))
    if not isinstance(value, dict): value={}
except Exception: value={}
if target not in value:
    value[target]=datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00','Z')
    fd, tmp=tempfile.mkstemp(prefix='.flake-issues.', dir=os.path.dirname(path))
    with os.fdopen(fd,'w') as f:
        json.dump(value,f,indent=2,sort_keys=True); f.write('\n')
    os.replace(tmp,path)
PY
}

find_culprit_raw() {
  local head="$1" last_green="$2" files="$3" candidates count lo hi mid candidate culprit="unknown"
  local started budget max_candidates spent
  budget="${MAIPAI_WATCH_BISECT_MAX_SECONDS:-600}"; [[ "$budget" =~ ^[0-9]+$ ]] || budget=600
  max_candidates="${MAIPAI_WATCH_BISECT_CANDIDATES:-4}"; [[ "$max_candidates" =~ ^[1-9][0-9]*$ ]] || max_candidates=4
  started="$(date +%s)"
  [[ -n "$last_green" ]] || { echo unknown; return 0; }
  candidates="$(git -C "$checkout" rev-list --first-parent --reverse "$last_green..$head" 2>/dev/null || true)"
  count="$(printf '%s\n' "$candidates" | sed '/^$/d' | wc -l | tr -d ' ')"
  if (( count == 1 )); then printf '%s\n' "$candidates"; return 0; fi
  if (( count > max_candidates )); then
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) more than $max_candidates first-parent candidates between $last_green and $head; testing newest candidates in order" >> "$data/watcher.log"
    while IFS= read -r candidate; do
      [[ -n "$candidate" ]] || continue
      spent=$(( $(date +%s) - started )); if (( spent >= budget )); then break; fi
      if candidate_is_red "$candidate" "$files"; then culprit="$candidate"; break; fi
    done < <(printf '%s\n' "$candidates" | awk -v cap="$max_candidates" 'NF { a[NR]=$0 } END { for (i=NR;i>NR-cap && i>0;i--) print a[i] }')
    spent=$(( $(date +%s) - started )); if (( spent >= budget )); then echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) bisect budget spent after ${spent} s; culprit unknown" >> "$data/watcher.log"; echo unknown; return 0; fi
    echo "$culprit"
    return 0
  fi
  local -a list=()
  while IFS= read -r candidate; do [[ -n "$candidate" ]] && list+=("$candidate"); done <<< "$candidates"
  lo=0; hi=$((${#list[@]} - 1))
  [[ -n "$files" ]] || { echo unknown; return 0; }
  while (( lo <= hi )); do
    spent=$(( $(date +%s) - started )); if (( spent >= budget )); then break; fi
    mid=$(((lo + hi) / 2)); candidate="${list[$mid]}"
    if candidate_is_red "$candidate" "$files"; then culprit="$candidate"; hi=$((mid - 1)); else lo=$((mid + 1)); fi
  done
  spent=$(( $(date +%s) - started )); if (( spent >= budget )); then echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) bisect budget spent after ${spent} s; culprit unknown" >> "$data/watcher.log"; echo unknown; return 0; fi
  echo "$culprit"
}

# WATCHER-STARVED-01: a commit is blamed only if the failing files still fail there, alone, on every confirming rerun (MAIPAI_WATCH_RERUNS, 3). A file that passes alone
# at the named commit failed because the machine was busy: the answer is "flaky", not a commit (the bisect's single rerun under load blamed a UI commit that never touched the file).
confirm_culprit() {
  local culprit="$1" files="$2" file
  [[ "$culprit" != unknown && -n "$files" ]] || { printf '%s\n' "$culprit"; return 0; }
  git -C "$checkout" checkout --detach "$culprit" >/dev/null 2>&1 || { printf '%s\n' "$culprit"; return 0; }
  for file in $files; do file_is_red "$file" && { printf '%s\n' "$culprit"; return 0; }; done
  printf '%s\n' flaky
}
find_culprit() { local raw; raw="$(find_culprit_raw "$@")"; confirm_culprit "$raw" "${3:-}"; }

work_cpu_percent() {
  local raw
  if [[ -n "${MAIPAI_WATCH_CPU_CMD:-}" ]]; then
    raw="$(bash -c "$MAIPAI_WATCH_CPU_CMD" 2>/dev/null || true)"
    awk -v value="$raw" 'BEGIN { if (value ~ /^[0-9]+([.][0-9]+)?$/) print value; else print "unknown" }'
  else
    raw="$(ps -Ao pid=,ppid=,pcpu=,comm=,args= 2>/dev/null)" || { printf '%s\n' unknown; return; }
    [[ -n "$raw" ]] || { printf '%s\n' unknown; return; }
    awk -v self="$$" '
      NF >= 5 {
        pid[NR]=$1; parent[NR]=$2; cpu[NR]=$3; comm[NR]=$4
        command=$5
        for (i=6; i<=NF; i++) command=command " " $i
        args[NR]=command
        count=NR
      }
      END {
        total=0
        for (i=1; i<=count; i++) {
          if (cpu[i] !~ /^[0-9]+([.][0-9]+)?$/) continue
          excluded=0; p=pid[i]
          for (depth=0; depth<=count && p!=""; depth++) {
            if (p==self) { excluded=1; break }
            ancestor=""
            for (j=1; j<=count; j++) if (pid[j]==p) { ancestor=parent[j]; break }
            if (ancestor==p) break
            p=ancestor
          }
          if (excluded || args[i] ~ /lander\.sh serve|watcher\.sh serve/) continue
          n=split(comm[i], parts, "/"); base=parts[n]
          if (base ~ /^(bun|node|codex|tsc|vite|eslint|gitleaks|deno|sqlite3|python3)$/ || args[i] ~ /shardTests\.ts|maipai-stack/) total+=cpu[i]
        }
        printf "%.10g\n", total
      }
    ' <<< "$raw"
  fi
}

free_memory_gb() {
  local command="${MAIPAI_WATCH_FREE_GB_CMD:-}" stats
  if [[ -n "$command" ]]; then
    if ! stats="$(bash -c "$command" 2>/dev/null)"; then echo unknown; return 0; fi
    awk 'NR==1 && $1 ~ /^[0-9]+([.][0-9]+)?$/ { print $1; ok=1; exit } END { if (!ok) print "unknown" }' <<< "$stats"
    return
  fi
  if ! stats="$(vm_stat 2>/dev/null)"; then echo unknown; return 0; fi
  awk '
    NR==1 { line=$0; sub(/^.*page size of /, "", line); sub(/ bytes.*$/, "", line); page=line }
    /Pages free:/ { free=$3 }
    /Pages inactive:/ { inactive=$3 }
    /Pages speculative:/ { speculative=$3 }
    END {
      gsub(/\./, "", free); gsub(/\./, "", inactive); gsub(/\./, "", speculative)
      if (page ~ /^[0-9]+$/ && free ~ /^[0-9]+$/ && inactive ~ /^[0-9]+$/ && speculative ~ /^[0-9]+$/)
        printf "%.6g\n", (free + inactive + speculative) * page / 1073741824
      else print "unknown"
    }
  ' <<< "$stats"
}

wait_for_quiet() {
  local land_data="${MAIPAI_LAND_DATA:-$main/data-scratch/land}"
  local max_seconds="${MAIPAI_WATCH_QUIET_MAX_SECONDS:-300}"
  local busy_seconds="${MAIPAI_WATCH_LANDER_BUSY_SECONDS:-120}"
  local poll_seconds="${MAIPAI_WATCH_QUIET_POLL_SECONDS:-15}"
  local max_cpu="${MAIPAI_WATCH_MAX_CPU:-200}"
  local min_free_gb="${MAIPAI_WATCH_MIN_FREE_GB:-40}"
  local started now cpu free_gb free_display lander_busy reason last_log=0 remaining sleep_for
  [[ "$max_seconds" =~ ^[0-9]+$ ]] || max_seconds=300
  [[ "$busy_seconds" =~ ^[0-9]+$ ]] || busy_seconds=120
  [[ "$poll_seconds" =~ ^[0-9]+([.][0-9]+)?$ ]] || poll_seconds=15
  [[ "$min_free_gb" =~ ^[0-9]+([.][0-9]+)?$ ]] || min_free_gb=40
  # Zero is used by tests and operators to disable waiting.
  (( max_seconds > 0 )) || return 0
  started="$(date +%s)"
  while :; do
    if [[ "${stop_requested:-0}" -eq 1 ]]; then return 1; fi
    lander_busy=0
    if compgen -G "$land_data/queue/*.json" >/dev/null; then lander_busy=1; fi
    cpu="$(work_cpu_percent)"
    free_gb="$(free_memory_gb)"
    reason=""
    now="$(date +%s)"
    if (( lander_busy && now - started < busy_seconds )); then reason="waiting: lander busy"
    elif [[ "$cpu" != unknown ]] && awk -v cpu="$cpu" -v max="$max_cpu" 'BEGIN { exit !(cpu >= max) }'; then
      reason="waiting: our work uses ${cpu}% cpu, above ${max_cpu}%"
    elif [[ "$free_gb" != unknown ]] && awk -v free="$free_gb" -v min="$min_free_gb" 'BEGIN { exit !(free < min) }'; then
      free_display="$(awk -v free="$free_gb" 'BEGIN { printf "%.0f", free }')"
      reason="waiting: free memory ${free_display} GB below ${min_free_gb} GB"
    fi
    if [[ -z "$reason" ]]; then return 0; fi
    now="$(date +%s)"
    # date +%s has one-second resolution; the extra tick prevents the cap from firing early at a second boundary.
    if (( now - started >= max_seconds + 1 )); then
      echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) waited ${max_seconds}s; $reason; running anyway" >> "$data/watcher.log"
      return 0
    fi
    if (( now - last_log >= 60 )); then
      echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $reason" >> "$data/watcher.log"
      last_log="$now"
    fi
    remaining=$((max_seconds - (now - started)))
    sleep_for="$poll_seconds"
    if awk -v poll="$sleep_for" -v remaining="$remaining" 'BEGIN { exit !(poll > remaining) }'; then sleep_for="$remaining"; fi
    sleep "$sleep_for" & sleep_pid=$!
    wait "$sleep_pid" || true
    sleep_pid=""
  done
}

file_issue() {
  local title="$1" first_file="$2" note="$3" command="${MAIPAI_WATCH_ISSUE_CMD:-}" number
  if [[ -n "$command" ]]; then
    (cd "$main" && bash -c "$command \"\$1\" \"\$2\"" _ "$title" "$note") || { echo "watcher.sh: could not file issue for $title" >> "$data/watcher.log"; return 1; }
    return 0
  fi
  # WATCHER-STARVED-01 B: a duplicate is an open issue with the exact same title (which names the sha). GitHub search is fuzzy: a looser
  # match once buried a red main as a comment on an old issue about another file.
  number="$(gh issue list -R getmaipai/home --state open --search "$title in:title" --limit 30 --json number,title 2>/dev/null | python3 -c 'import json,sys
t=sys.argv[1]
try: rows=json.load(sys.stdin)
except Exception: rows=[]
print(next((str(r["number"]) for r in rows if r.get("title")==t),""))' "$title" 2>/dev/null || true)"
  if [[ -n "$number" ]]; then
    gh issue comment "$number" --body-file "$note" >>"$data/watcher.log" 2>&1 || { echo "watcher.sh: could not comment on issue $number" >> "$data/watcher.log"; return 1; }
  else
    gh issue create -R getmaipai/home --title "$title" --body-file "$note" --label bug >>"$data/watcher.log" 2>&1 || gh issue create -R getmaipai/home --title "$title" --body-file "$note" >>"$data/watcher.log" 2>&1 || { echo "watcher.sh: could not create issue: $title" >> "$data/watcher.log"; return 1; }
  fi
}

checkout_lock="$data/checkout.lock.d"
checkout_lock_take() {
  local holder
  if mkdir "$checkout_lock" 2>/dev/null; then echo "$$" >"$checkout_lock/pid"; echo watcher >"$checkout_lock/who"; return 0; fi
  holder="$(cat "$checkout_lock/pid" 2>/dev/null || true)"
  if [[ "$holder" == "$$" ]]; then return 0; fi
  if [[ "$holder" =~ ^[0-9]+$ ]] && kill -0 "$holder" 2>/dev/null; then return 1; fi
  rm -rf "$checkout_lock"; mkdir "$checkout_lock" 2>/dev/null || return 1; echo "$$" >"$checkout_lock/pid"; echo watcher >"$checkout_lock/who"
}
checkout_lock_release() { [[ "$(cat "$checkout_lock/pid" 2>/dev/null || true)" != "$$" ]] || rm -rf "$checkout_lock"; }

run_t2_wanted() {
  local dir="$data/t2-wanted" sha branch files rc=0 output command item now rerun
  [[ -d "$dir" ]] || return 1
  sha="$(t2_pick_oldest)"; [[ -n "$sha" ]] || return 1
  now="$(date +%s)"; rerun="${MAIPAI_WATCH_T2_RERUN_SECONDS:-21600}"; [[ "$rerun" =~ ^[0-9]+$ ]] || rerun=21600
  IFS= read -r branch <"$dir/$sha" || branch=unknown
  files="$(sed -n '2,$p' "$dir/$sha" | sed '$d')"
  checkout_lock_take || { echo "checked T2 waiting: checkout busy"; return 0; }
  output="$(mktemp "$data/.t2.$sha.XXXXXX")"
  if ! gitnet -C "$checkout" fetch origin >/dev/null 2>&1 || ! git -C "$checkout" checkout --detach "$sha" >>"$output" 2>&1; then
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) checked T2 could not check out $sha ($branch); wanted entry retained" >>"$data/watcher.log"
    rm -f "$output"; checkout_lock_release; return 0
  fi
  install_if_needed || rc=$?
  command="${MAIPAI_LAND_T2_CMD:-bun scripts/gate/shardTests.ts --dir backend --root tests && bun scripts/gate/shardTests.ts --dir frontend --root .}"
  if (( rc == 0 )); then
    ( cd "$checkout" && nice -n "${MAIPAI_WATCH_NICE:-10}" env MAIPAI_GATE_MIN_SHARDS=8 MAIPAI_GATE_SHARD_PEAKS_DIR="$main/data-scratch/gate-stats/shard-peaks" bash -c "eval \"$command\"" ) >"$output" 2>&1 || rc=$?
  fi
  mkdir -p "$data/t2-green" "$data/reds"
  if (( rc == 0 )); then
    : >"$data/t2-green/$sha"
    while IFS= read -r item; do if git -C "$checkout" merge-base --is-ancestor "$item" "$sha" 2>/dev/null; then mv -f "$dir/$item" "$data/t2-discharged/$item"; fi; done < <(find "$dir" -maxdepth 1 -type f -exec basename {} \;)
    rm -f "$data/t2-red/$sha"
    echo "checked T2 green at ${sha:0:7} ($branch)"
  else
    printf '%s\n' "$now" >"$data/t2-red/$sha"; tail -n 1 "$dir/$sha" >"$data/t2-red/$sha.newer"
    { printf 'checked T2 failed: %s\nbranch: %s\nsafety files: %s\n' "$sha" "$branch" "$files"; tail -n 80 "$output"; } >"$data/reds/t2-$sha.md"
    echo "checked T2 red at ${sha:0:7} ($branch); wanted entry retained"
    if [[ ! -f "$data/t2-issue-filed/$sha" ]]; then mkdir -p "$data/t2-issue-filed"; file_issue "Watcher: T2 red at ${sha:0:7} ($branch)" "t2-$sha" "$data/reds/t2-$sha.md" || true; : >"$data/t2-issue-filed/$sha"; fi
  fi
  rm -f "$output"; checkout_lock_release
  return 0
}

run_once() {
  local rc=0
  # WATCHER-STARVED-01: one generation of rotation, checked every tick (the watcher runs for days).
  if [[ -f "$data/watcher.log" ]] && (( $(wc -c <"$data/watcher.log") > 5242880 )); then cp -f "$data/watcher.log" "$data/watcher.log.1" && : > "$data/watcher.log"; fi
  run_once_body "$@" || rc=$?
  checkout_lock_release
  return "$rc"
}

run_once_body() {
  local head last_run last_green started output seconds rc files file all_pass=1 result culprit subject title note_tmp note timed_leg timed_seconds red_files="" budget_spent=0 stopped_legs=""
  local bisect_started bisect_budget bisect_spent has_t2=0
  mkdir -p "$data/t2-wanted" "$data/t2-green"
  [[ -z "$(find "$data/t2-wanted" -maxdepth 1 -type f -print -quit 2>/dev/null)" ]] || has_t2=1
  # OUTBOX-01: check the local landed main first, then check origin on the refresh interval.
  head="$(pipeline_main_sha "$checkout")"
  last_run="$(cat "$data/last-run" 2>/dev/null || true)"
  last_green="$(cat "$data/last-green" 2>/dev/null || true)"
  local refresh_interval="${MAIPAI_REFRESH_FETCH_SECONDS:-1800}" last_refresh_fetch refresh_now refresh_fetch_rc
  [[ "$refresh_interval" =~ ^[0-9]+$ ]] || refresh_interval=1800
  refresh_now="$(date +%s)"
  last_refresh_fetch="$(cat "$bin/.last-refresh-fetch" 2>/dev/null || true)"
  if [[ ! "$last_refresh_fetch" =~ ^[0-9]+$ ]] || (( refresh_now < last_refresh_fetch || refresh_now - last_refresh_fetch >= refresh_interval )); then
    GITNET_LABEL="watcher fetch" gitnet -C "$checkout" fetch origin && refresh_fetch_rc=0 || refresh_fetch_rc=$?
    printf '%s\n' "$refresh_now" > "$bin/.last-refresh-fetch"
    if (( refresh_fetch_rc != 0 )); then echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) watcher.sh: fetch failed$( ((GITNET_TIMED_OUT)) && echo ' (timed out)'); testing the landed main" >> "$data/watcher.log"; fi
    head="$(pipeline_main_sha "$checkout")"
    last_run="$(cat "$data/last-run" 2>/dev/null || true)"
    last_green="$(cat "$data/last-green" 2>/dev/null || true)"
  fi
  if [[ "$head" == "$last_run" || "$head" == "$last_green" ]]; then watch_unverified_alert; if (( has_t2 )); then run_t2_wanted || true; else echo "up to date at ${head:0:7}"; fi; return 0; fi
  head="$(pipeline_main_sha "$checkout")"
  # HOST-GUARD-09: no suite starts under memory pressure or while the host guard paused heavy work; the next tick tries again.
  local hostmem_lib="$main/scripts/lib/hostmem.sh" gate_line=""
  if [[ -f "$hostmem_lib" ]]; then
    # shellcheck source=lib/hostmem.sh
    source "$hostmem_lib"
    if ! gate_line="$(hostmem_gate "Watcher run" 2>&1)"; then
      echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) deferred (memory) at ${head:0:7}: $gate_line" >> "$data/watcher.log"
      echo "deferred (memory) at ${head:0:7}"; return 0
    fi
  fi
  if ! wait_for_quiet; then return 0; fi
  refresh_now="$(date +%s)"
  last_refresh_fetch="$(cat "$bin/.last-refresh-fetch" 2>/dev/null || true)"
  if [[ ! "$last_refresh_fetch" =~ ^[0-9]+$ ]] || (( refresh_now < last_refresh_fetch || refresh_now - last_refresh_fetch >= refresh_interval )); then
    GITNET_LABEL="watcher fetch (after quiet wait)" gitnet -C "$checkout" fetch origin && refresh_fetch_rc=0 || refresh_fetch_rc=$?
    printf '%s\n' "$refresh_now" > "$bin/.last-refresh-fetch"
    if (( refresh_fetch_rc != 0 )); then echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) watcher.sh: fetch failed after quiet wait$( ((GITNET_TIMED_OUT)) && echo ' (timed out)'); testing the landed main" >> "$data/watcher.log"; fi
  fi
  # A landing may have arrived or been tested during the quiet wait: always re-read the local landed main (no network).
  head="$(pipeline_main_sha "$checkout")"
  last_run="$(cat "$data/last-run" 2>/dev/null || true)"
  last_green="$(cat "$data/last-green" 2>/dev/null || true)"
  if [[ "$head" == "$last_run" || "$head" == "$last_green" ]]; then watch_unverified_alert; if (( has_t2 )); then run_t2_wanted || true; else echo "up to date at ${head:0:7}"; fi; return 0; fi
  local checkout_error checkout_head
  # AUDIT-GATE-01: a tree that was not checked out is never tested or marked green. The failure is logged once per sha
  # (data/checkout-failed holds the last sha that failed) and retried on the next tick, since an index.lock is often transient.
  checkout_failed() {
    local why="$1"
    if [[ "$(cat "$data/checkout-failed" 2>/dev/null || true)" != "$head" ]]; then
      echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) watcher: could not check out $head: $why; not marking green" >> "$data/watcher.log"
      printf '%s\n' "$head" > "$data/checkout-failed"
    fi
    return 0
  }
  # STABLE-01: the nightly stable run uses this same checkout; whoever holds the lock has the tree, the other waits for its next tick.
  checkout_lock_take || { echo "checkout busy (nightly run)"; return 0; }
  checkout_error="$(git -C "$checkout" checkout --detach "$head" 2>&1)" || { checkout_failed "$checkout_error"; return 0; }
  checkout_head="$(git -C "$checkout" rev-parse HEAD 2>&1)" || checkout_head=""
  [[ "$checkout_head" == "$head" ]] || { checkout_failed "${checkout_error:-HEAD is $checkout_head}"; return 0; }
  rm -f "$data/checkout-failed"
  install_if_needed
  started="$(date +%s)"; output="$(mktemp "$data/.suite.XXXXXX")"
  if watcher_direct; then
    local post_rc=0
    post_landing_check "$output" || post_rc=$?
    if (( post_rc != 0 )); then
      seconds=$(( $(date +%s) - started ))
      note="$data/reds/$head.md"; note_tmp="$(mktemp "$data/reds/.red.XXXXXX")"
      { printf '# Main post-landing check failure: %s\n\n- Main SHA: `%s`\n- Failing: post-landing-check (typecheck or boot check, DIRECT mode)\n\n## Last 60 lines of output\n\n```text\n' "$head" "$head"; tail -n 60 "$output"; printf '\n```\n'; } > "$note_tmp"
      mv -f "$note_tmp" "$note"
      append_run "$head" red "$seconds" "post-landing-check" ""
      atomic_value "$data/last-run" "$head"
      file_issue "Watcher: main red at ${head:0:7}: post-landing-check" "post-landing-check" "$note" || true
      rm -f "$output"
      echo "red at ${head:0:7}: post-landing-check (typecheck or boot check)"
      return 0
    fi
  fi
  if [[ "${MAIPAI_WATCH_NO_LOCK:-}" == 1 ]]; then :
  elif [[ ! -f "$gate_lock" ]]; then
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) gate lock missing at $gate_lock; running watcher suite without it" >> "$data/watcher.log"
  elif bash "$gate_lock" acquire "watcher-$$" main; then watcher_lock_held=1
  else echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) gate lock acquire failed; running watcher suite without it" >> "$data/watcher.log"
  fi
  set +e
  run_suite "$output"
  rc=$?
  set -e
  if (( watcher_lock_held )); then bash "$gate_lock" release "watcher-$$" || true; watcher_lock_held=0; fi
  seconds=$(( $(date +%s) - started ))
  stopped_legs="$(tr '\n' ' ' < "$output.stopped" 2>/dev/null | sed 's/ *$//')"
  # A leg the sharder deferred for memory pressure (exit 75) is neither green nor red: nothing is recorded and the next tick retries.
  if grep -qE '^== leg: [a-z]+ \(exit 75,' "$output"; then
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) deferred (memory) at $head: $(grep -E '^shard: deferred' "$output" | tail -n 1 | sed 's/^shard: deferred (memory): //')" >> "$data/watcher.log"
    rm -f "$output" "$output.backend" "$output.frontend" "$output.scripts"
    echo "deferred (memory) at ${head:0:7}"
    return 0
  fi
  timed_leg="$(awk '$1=="==" && $2=="leg:" && /timed out after/ { print $3; exit }' "$output")"
  timed_seconds="$(sed -nE 's/^== leg: [^ ]+ \(exit 124, timed out after ([0-9]+) s\).*/\1/p' "$output" | head -n 1)"
  if [[ -n "$timed_leg" ]]; then
    append_run "$head" stalled "$seconds" "" ""
    atomic_value "$data/last-run" "$head"
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) stalled at $head: leg $timed_leg timed out after $timed_seconds s" >> "$data/watcher.log"
    rm -f "$output" "$output.backend" "$output.frontend" "$output.scripts"
    echo "stalled at ${head:0:7}: leg $timed_leg timed out"
    return 0
  fi
  if (( rc == 0 )) && [[ -n "$stopped_legs" ]]; then
    # WATCHER-STARVED-01: every leg that ran passed, but at least one was stopped: neither green nor red. No green marker, no red issue, no culprit; the 24 hour alert still counts it as unverified.
    local tokens="" leg
    for leg in $stopped_legs; do tokens="${tokens:+$tokens }stopped:$leg"; done
    append_run "$head" unverified "$seconds" "$tokens" ""
    atomic_value "$data/last-run" "$head"
    watch_unverified_alert
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) unverified at $head: legs stopped before they finished (not a pass): $stopped_legs" >> "$data/watcher.log"
    rm -f "$output" "$output.backend" "$output.frontend" "$output.scripts" "$output.stopped"
    echo "unverified at ${head:0:7}: $stopped_legs stopped (not a pass)"
    return 0
  fi
  if (( rc == 0 )); then
    mark_green "$head"
    atomic_value "$data/last-green" "$head"
    atomic_value "$data/last-run" "$head"
    append_run "$head" green "$seconds" "" ""
    t2_discharge "$head" green >/dev/null
    watch_unverified_alert
    rm -f "$output" "$output.backend" "$output.frontend" "$output.scripts"
    echo "green at ${head:0:7} ($seconds s)"
    return 0
  fi
  files="$(failing_files "$output")"
  [[ -z "$files" ]] || wait_for_quiet || true
  for file in $files; do
    if file_is_red "$file"; then all_pass=0; red_files="${red_files:+$red_files }$file"; fi
  done
  if [[ -n "$files" && "$all_pass" -eq 1 ]]; then
    mark_green "$head"
    atomic_value "$data/last-green" "$head"
    atomic_value "$data/last-run" "$head"
    append_run "$head" flaky "$seconds" "$files" ""
    t2_discharge "$head" flaky >/dev/null
    watch_unverified_alert
    for file in $files; do file_flake_issue "$file"; done
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) flaky at $head; isolated reruns passed: $files" >> "$data/watcher.log"
    rm -f "$output" "$output.backend" "$output.frontend" "$output.scripts"
    echo "flaky at ${head:0:7}: $files"
    return 0
  fi
  bisect_started="$(date +%s)"
  culprit="$(find_culprit "$head" "$last_green" "$red_files")"
  bisect_budget="${MAIPAI_WATCH_BISECT_MAX_SECONDS:-600}"
  bisect_spent=$(( $(date +%s) - bisect_started ))
  if [[ "$culprit" == unknown ]] && (( bisect_spent >= bisect_budget )); then budget_spent=1; fi
  git -C "$checkout" checkout --detach "$head" >/dev/null 2>&1 || true
  subject="unknown"
  if [[ "$culprit" != unknown && "$culprit" != flaky ]]; then subject="$(git -C "$checkout" show -s --format=%s "$culprit" 2>/dev/null || echo unknown)"; fi
  note="$data/reds/$head.md"; note_tmp="$(mktemp "$data/reds/.red.XXXXXX")"
  {
    printf '# Main test failure: %s\n\n' "$head"
    if (( budget_spent )); then printf -- '- Main SHA: `%s`\n- Culprit: unknown (bisect budget spent)\n- Failing files: %s\n\n' "$head" "${files:-unknown}"
    elif [[ "$culprit" == flaky ]]; then printf -- '- Main SHA: `%s`\n- Culprit: none (flaky under load: the failing files pass alone at the commit the bisect named, so no commit is blamed)\n- Failing files: %s\n\n' "$head" "${files:-unknown}"
    else printf -- '- Main SHA: `%s`\n- Culprit: `%s` (%s)\n- Failing files: %s\n\n' "$head" "$culprit" "$subject" "${files:-unknown}"; fi
    if [[ -n "$stopped_legs" ]]; then printf -- '- Legs that did not run (stopped before they finished, not a pass): %s\n\n' "$stopped_legs"; fi
    printf '## Last 60 lines of suite output\n\n```text\n'
    tail -n 60 "$output"
    printf '\n```\n\n## Failure messages (every leg, WATCH-RED-KEEP-01)\n\n```text\n'
    grep -h -E -B6 '^\(fail\)|^error:|timed out' "$output" "$output.backend" "$output.frontend" "$output.scripts" 2>/dev/null | head -n "${MAIPAI_WATCH_RED_FAILURE_LINES:-400}" || true
    printf '\n```\n'
  } > "$note_tmp"
  mv -f "$note_tmp" "$note"
  append_run "$head" red "$seconds" "$files" "$([[ "$culprit" == unknown || "$culprit" == flaky ]] || printf %s "$culprit")"
  t2_discharge "$head" red >"$data/.discharged-$head"
  if [[ -s "$data/.discharged-$head" ]]; then { printf "\n## T2 obligations discharged by this run\n\n"; sed "s/ /\n- /g" "$data/.discharged-$head" | sed "s/^/- /"; } >>"$note"; rm -f "$data/.discharged-$head"; fi
  watch_unverified_alert
  atomic_value "$data/last-run" "$head"
  file="${files%% *}"; title="Watcher: main red at ${head:0:7}: ${file:-unknown}"
  file_issue "$title" "${file:-unknown}" "$note"
  rm -f "$output" "$output.backend" "$output.frontend" "$output.scripts" "$output.stopped"
  echo "red at ${head:0:7}: ${files:-unknown}; culprit ${culprit:0:7}"
}

serve() {
  local pidfile="$data/watcher.pid" poll="${MAIPAI_WATCH_POLL_SECONDS:-30}" old
  local refresh_seconds="${MAIPAI_PIPELINE_REFRESH_SECONDS:-60}" last_refresh=0 now refresh_result running_hash snapshot_hash
  running_hash="$(git -C "$main" hash-object "$0" 2>/dev/null || true)"
  local lib_hash
  lib_hash="$(libs_hash)"
  [[ "$refresh_seconds" =~ ^[0-9]+$ ]] || refresh_seconds=60
  (( refresh_seconds > 0 )) || refresh_seconds=1
  if [[ -f "$pidfile" ]]; then
    old="$(cat "$pidfile" 2>/dev/null || true)"
    if [[ "$old" =~ ^[0-9]+$ && "$old" != "$$" ]] && kill -0 "$old" 2>/dev/null && ps -p "$old" -o command= 2>/dev/null | grep -Eq 'watcher\.sh'; then if [[ ! -f "$data/.duplicate-logged" ]] || [[ -n "$(find "$data/.duplicate-logged" -mmin +60 2>/dev/null)" ]]; then error "already running as pid $old; stop it with bash scripts/pipeline.sh stop."; : > "$data/.duplicate-logged"; fi; sleep "${MAIPAI_WATCH_DUPLICATE_SLEEP:-300}"; return 0; fi
  fi
  echo "$$" > "$pidfile"
  local stop_requested=0 sleep_pid=""
  trap 'stop_requested=1; if [[ -n "$sleep_pid" ]]; then kill "$sleep_pid" 2>/dev/null || true; fi' TERM INT HUP
  trap 'if (( watcher_lock_held )); then bash "$gate_lock" release "watcher-$$" || true; watcher_lock_held=0; fi; rm -f "$data/watcher.pid"' EXIT
  set +e
  while :; do
    now="$(date +%s)"
    if (( now - last_refresh >= refresh_seconds )); then
      last_refresh="$now"
      refresh_result="$(refresh_snapshot watcher.sh)"
      snapshot_hash="$(git -C "$main" hash-object "$bin/watcher.sh" 2>/dev/null || true)"
      if [[ "$refresh_result" == changed || ( -n "$running_hash" && "$snapshot_hash" != "$running_hash" ) ]]; then
        echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) code refreshed from origin/main; restarting watcher" >> "$data/watcher.log"
        exec bash "$bin/watcher.sh" "$@"
      fi
      refresh_libs
      snapshot_hash="$(libs_hash)"
      if [[ "$snapshot_hash" != "$lib_hash" ]]; then
        echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) helper libraries refreshed from origin/main; restarting watcher" >> "$data/watcher.log"
        exec bash "$bin/watcher.sh" "$@"
      fi
    fi
    run_once || echo "watcher.sh: run-once failed; inspect watcher.log, then restart with bash scripts/pipeline.sh start." >&2
    if (( stop_requested )); then break; fi
    sleep "$poll" & sleep_pid=$!
    wait "$sleep_pid" || true
    sleep_pid=""
    if (( stop_requested )); then break; fi
  done
  rm -f "$pidfile"
  trap - EXIT
  exit 0
}

case "${1:-}" in
  refresh) refresh_snapshot watcher.sh || exit 1 ;;
  checkout) checkout_warm ;;
  run-once) checkout_warm && run_once ;;
  serve) checkout_warm && serve "$@" ;;
  *) error "usage: bash scripts/watcher.sh refresh | run-once | serve | checkout"; exit 2 ;;
esac
