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

atomic_value() {
  local path="$1" value="$2" tmp
  tmp="$(mktemp "$(dirname "$path")/.watch.XXXXXX")"
  printf '%s\n' "$value" > "$tmp"
  mv -f "$tmp" "$path"
}

checkout_warm() {
  if [[ ! -e "$checkout/.git" ]]; then
    git -C "$main" fetch origin || { error "could not fetch origin; check network and git credentials, then retry checkout."; return 1; }
    git -C "$main" worktree add --detach "$checkout" origin/main || { error "could not create warm checkout at $checkout; remove a stale path and retry."; return 1; }
  fi
}

install_if_needed() {
  [[ -z "${MAIPAI_WATCH_SKIP_INSTALL:-}" ]] || return 0
  local previous="${1:-}" changed=0 d
  if [[ -z "$previous" ]] || ! git -C "$checkout" cat-file -e "$previous^{commit}" 2>/dev/null; then changed=1
  elif [[ -n "$(git -C "$checkout" diff --name-only "$previous" HEAD -- backend/package.json backend/bun.lock frontend/package.json frontend/bun.lock 2>/dev/null || true)" ]]; then changed=1
  fi
  [[ "$changed" -eq 1 ]] || return 0
  for d in backend frontend; do
    [[ -d "$checkout/$d" ]] || continue
    # --force for the same reason as the lander: a changed commons pin is a file: dependency and a plain install keeps the old snapshot.
    (cd "$checkout/$d" && bun install --frozen-lockfile --force) || { error "bun install failed in $d; repair dependencies in $checkout and retry."; return 1; }
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
    local leg rc=0 shards root leg_output leg_status leg_rc leg_seconds wait_rc timed_out leg_limit
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
    : > "$output"
    for leg in "${legs[@]}"; do
      leg_output="$output.$leg"
      leg_status="$output.$leg.status"
      case "$leg" in
        backend) shards="${MAIPAI_WATCH_BACKEND_SHARDS:-10}"; root=tests ;;
        frontend) shards="${MAIPAI_WATCH_FRONTEND_SHARDS:-12}"; root=. ;;
        scripts) shards="${MAIPAI_WATCH_SCRIPTS_SHARDS:-8}"; root=. ;;
      esac
      leg_limit="${MAIPAI_WATCH_LEG_MAX_SECONDS:-1500}"
      [[ "$leg_limit" =~ ^[0-9]+$ ]] || leg_limit=1500
      timed_out=""
      local_started="$(date +%s)"
      (cd "$checkout" && export MAIPAI_COMMONS_DIR="$(cd "$main/.." && pwd -P)/commons" MAIPAI_STANDARDS_DIR="$(cd "$main/.." && pwd -P)/.github" && exec perl -e 'setpgrp(0, 0); exec @ARGV' -- bash -c 'started=$(date +%s); nice -n 10 bun scripts/gate/shardTests.ts --dir "$1" --root "$2" --shards "$3"; rc=$?; printf "%s %s\n" "$rc" "$(( $(date +%s) - started ))" > "$4"; exit "$rc"' _ "$leg" "$root" "$shards" "$leg_status") >"$leg_output" 2>&1 &
      leg_pid=$!
      if (( leg_limit > 0 )); then
        ( sleep "$leg_limit"; if kill -0 "$leg_pid" 2>/dev/null; then : > "$leg_status.timeout"; kill -TERM -"$leg_pid" 2>/dev/null || true; sleep 10; kill -KILL -"$leg_pid" 2>/dev/null || true; fi ) &
        watchdog_pid=$!
        if wait "$leg_pid"; then wait_rc=0; else wait_rc=$?; rc=1; fi
        pkill -P "$watchdog_pid" 2>/dev/null || true
        kill "$watchdog_pid" 2>/dev/null || true
        wait "$watchdog_pid" 2>/dev/null || true
      else
        if wait "$leg_pid"; then wait_rc=0; else wait_rc=$?; rc=1; fi
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
  printf '%s' "${files[*]}"
}

rerun_file() {
  local file="$1" command="${MAIPAI_WATCH_RERUN_CMD:-}"
  if [[ -n "$command" ]]; then (cd "$checkout" && nice -n 10 bash -c "$command \"\$1\"" _ "$file")
  elif [[ "$file" == backend/* ]]; then (cd "$checkout/backend" && nice -n 10 bun test --timeout 20000 "${file#backend/}")
  elif [[ "$file" == frontend/* ]]; then (cd "$checkout/frontend" && nice -n 10 bun test --timeout 20000 "${file#frontend/}")
  elif [[ "$file" == scripts/* ]]; then (cd "$checkout" && nice -n 10 bun test --timeout 20000 "$file")
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
  file_issue "$title" "$file" "$body"
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

find_culprit() {
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
    (cd "$main" && bash -c "$command \"\$1\" \"\$2\"" _ "$title" "$note") || echo "watcher.sh: could not file issue for $title" >> "$data/watcher.log"
    return 0
  fi
  number="$(gh issue list -R getmaipai/home --state open --search "Watcher: $first_file" --limit 5 --json number -q '.[0].number' 2>/dev/null || true)"
  if [[ -n "$number" ]]; then
    gh issue comment "$number" --body-file "$note" >>"$data/watcher.log" 2>&1 || echo "watcher.sh: could not comment on issue $number" >> "$data/watcher.log"
  else
    gh issue create -R getmaipai/home --title "$title" --body-file "$note" --label bug >>"$data/watcher.log" 2>&1 || gh issue create -R getmaipai/home --title "$title" --body-file "$note" >>"$data/watcher.log" 2>&1 || echo "watcher.sh: could not create issue: $title" >> "$data/watcher.log"
  fi
}

run_once() {
  local head last_run last_green previous started output seconds rc files file all_pass=1 result culprit subject title note_tmp note timed_leg timed_seconds red_files="" budget_spent=0
  local bisect_started bisect_budget bisect_spent
  git -C "$checkout" fetch origin || { echo "watcher.sh: fetch failed" >> "$data/watcher.log"; return 0; }
  head="$(git -C "$checkout" rev-parse origin/main)"
  last_run="$(cat "$data/last-run" 2>/dev/null || true)"
  last_green="$(cat "$data/last-green" 2>/dev/null || true)"
  if [[ "$head" == "$last_run" || "$head" == "$last_green" ]]; then echo "up to date at ${head:0:7}"; return 0; fi
  if ! wait_for_quiet; then return 0; fi
  git -C "$checkout" fetch origin || { echo "watcher.sh: fetch failed after quiet wait" >> "$data/watcher.log"; return 0; }
  head="$(git -C "$checkout" rev-parse origin/main)"
  last_run="$(cat "$data/last-run" 2>/dev/null || true)"
  last_green="$(cat "$data/last-green" 2>/dev/null || true)"
  if [[ "$head" == "$last_run" || "$head" == "$last_green" ]]; then echo "up to date at ${head:0:7}"; return 0; fi
  previous="$last_run"
  git -C "$checkout" checkout --detach "$head" >/dev/null 2>&1
  install_if_needed "$previous"
  started="$(date +%s)"; output="$(mktemp "$data/.suite.XXXXXX")"
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
  if (( rc == 0 )); then
    mark_green "$head"
    atomic_value "$data/last-green" "$head"
    atomic_value "$data/last-run" "$head"
    append_run "$head" green "$seconds" "" ""
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
  if [[ "$culprit" != unknown ]]; then subject="$(git -C "$checkout" show -s --format=%s "$culprit" 2>/dev/null || echo unknown)"; fi
  note="$data/reds/$head.md"; note_tmp="$(mktemp "$data/reds/.red.XXXXXX")"
  {
    printf '# Main test failure: %s\n\n' "$head"
    if (( budget_spent )); then printf -- '- Main SHA: `%s`\n- Culprit: unknown (bisect budget spent)\n- Failing files: %s\n\n' "$head" "${files:-unknown}"
    else printf -- '- Main SHA: `%s`\n- Culprit: `%s` (%s)\n- Failing files: %s\n\n' "$head" "$culprit" "$subject" "${files:-unknown}"; fi
    printf '## Last 60 lines of suite output\n\n```text\n'
    tail -n 60 "$output"
    printf '\n```\n'
  } > "$note_tmp"
  mv -f "$note_tmp" "$note"
  append_run "$head" red "$seconds" "$files" "$([[ "$culprit" == unknown ]] || printf %s "$culprit")"
  atomic_value "$data/last-run" "$head"
  file="${files%% *}"; title="Watcher: main red at ${head:0:7}: ${file:-unknown}"
  file_issue "$title" "${file:-unknown}" "$note"
  rm -f "$output" "$output.backend" "$output.frontend" "$output.scripts"
  echo "red at ${head:0:7}: ${files:-unknown}; culprit ${culprit:0:7}"
}

serve() {
  local pidfile="$data/watcher.pid" poll="${MAIPAI_WATCH_POLL_SECONDS:-30}" old
  local refresh_seconds="${MAIPAI_PIPELINE_REFRESH_SECONDS:-60}" last_refresh=0 now refresh_result running_hash snapshot_hash
  running_hash="$(git -C "$main" hash-object "$0" 2>/dev/null || true)"
  [[ "$refresh_seconds" =~ ^[0-9]+$ ]] || refresh_seconds=60
  (( refresh_seconds > 0 )) || refresh_seconds=1
  if [[ -f "$pidfile" ]]; then
    old="$(cat "$pidfile" 2>/dev/null || true)"
    if [[ "$old" =~ ^[0-9]+$ && "$old" != "$$" ]] && kill -0 "$old" 2>/dev/null && ps -p "$old" -o command= 2>/dev/null | grep -Eq 'watcher\.sh'; then error "already running as pid $old; stop it with bash scripts/pipeline.sh stop."; return 1; fi
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
