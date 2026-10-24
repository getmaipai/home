#!/usr/bin/env bash
# MAIPAI_WATCH_LEGS selects real sharder legs (default: backend frontend scripts).
# Concurrent worker ceilings: MAIPAI_WATCH_BACKEND_SHARDS=4,
# MAIPAI_WATCH_FRONTEND_SHARDS=2, MAIPAI_WATCH_SCRIPTS_SHARDS=2.
set -euo pipefail
umask 077

error() { echo "watcher.sh: $1" >&2; }
common="$(git rev-parse --git-common-dir 2>/dev/null)" || { error "not inside a git checkout; run this from the main checkout."; exit 1; }
[[ "$common" = /* ]] || common="$(cd "$(dirname "$common")" && pwd -P)/$(basename "$common")"
main="$(cd "$(dirname "$common")" && pwd -P)"
data="${MAIPAI_WATCH_DATA:-$main/data-scratch/watch}"
checkout="${MAIPAI_WATCH_CHECKOUT:-$(cd "$main/.." && pwd -P)/home-watcher}"
mkdir -p "$data/green" "$data/reds"
git_env="${MAIPAI_LAND_GIT_ENV-$main/data-scratch/bin/https-git.env}"
if [[ -n "$git_env" && -f "$git_env" ]]; then source "$git_env"; fi

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
    (cd "$checkout/$d" && bun install --frozen-lockfile) || { error "bun install failed in $d; repair dependencies in $checkout and retry."; return 1; }
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
    local leg rc=0 shards root leg_output leg_status leg_rc leg_seconds
    local requested configured="${MAIPAI_WATCH_LEGS:-backend frontend scripts}"
    local -a requested_legs=() legs=() pids=()
    read -r -a requested_legs <<< "$configured"
    if [[ "${#requested_legs[@]}" -eq 0 ]]; then error "MAIPAI_WATCH_LEGS must name backend, frontend, and/or scripts."; return 2; fi
    for requested in "${requested_legs[@]}"; do
      case "$requested" in backend|frontend|scripts) ;; *) error "unknown MAIPAI_WATCH_LEGS entry: $requested"; return 2 ;; esac
    done
    for leg in backend frontend scripts; do
      for requested in "${requested_legs[@]}"; do
        if [[ "$requested" == "$leg" ]]; then legs+=("$leg"); break; fi
      done
    done
    : > "$output"
    for leg in "${legs[@]}"; do
      leg_output="$output.$leg"
      leg_status="$output.$leg.status"
      case "$leg" in
        backend) shards="${MAIPAI_WATCH_BACKEND_SHARDS:-4}"; root=tests ;;
        frontend) shards="${MAIPAI_WATCH_FRONTEND_SHARDS:-2}"; root=. ;;
        scripts) shards="${MAIPAI_WATCH_SCRIPTS_SHARDS:-2}"; root=. ;;
      esac
      (
        local_started="$(date +%s)"
        if (cd "$checkout" && export MAIPAI_COMMONS_DIR="$(cd "$main/.." && pwd -P)/commons" MAIPAI_STANDARDS_DIR="$(cd "$main/.." && pwd -P)/.github" && nice -n 10 bun scripts/gate/shardTests.ts --dir "$leg" --root "$root" --shards "$shards"); then
          leg_rc=0
        else
          leg_rc=$?
        fi
        leg_seconds=$(( $(date +%s) - local_started ))
        printf '%s %s\n' "$leg_rc" "$leg_seconds" > "$leg_status"
        exit "$leg_rc"
      ) >"$leg_output" 2>&1 &
      pids+=("$!")
    done
    for i in "${!legs[@]}"; do
      leg="${legs[$i]}"
      if wait "${pids[$i]}"; then :; else rc=1; fi
      leg_output="$output.$leg"
      leg_status="$output.$leg.status"
      read -r leg_rc leg_seconds < "$leg_status"
      printf '== leg: %s (exit %s, %s s)\n' "$leg" "$leg_rc" "$leg_seconds" >> "$output"
      cat "$leg_output" >> "$output"
      rm -f "$leg_output" "$leg_status"
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
          file="$leg/$file"
          case "$seen" in *" $file "*) ;; *) [[ -n "$leg" && -n "$file" ]] && { files+=("$file"); seen+="$file "; } ;; esac
        done
      fi
    done < "$output"
  fi
  printf '%s' "${files[*]}"
}

rerun_file() {
  local file="$1" command="${MAIPAI_WATCH_RERUN_CMD:-}"
  if [[ -n "$command" ]]; then (cd "$checkout" && bash -c "$command \"\$1\"" _ "$file")
  elif [[ "$file" == backend/* ]]; then (cd "$checkout/backend" && bun test --timeout 20000 "${file#backend/}")
  elif [[ "$file" == frontend/* ]]; then (cd "$checkout/frontend" && bun test --timeout 20000 "${file#frontend/}")
  elif [[ "$file" == scripts/* ]]; then (cd "$checkout" && bun test --timeout 20000 "$file")
  else return 1
  fi
}

candidate_is_red() {
  local candidate="$1" files="$2" file
  git -C "$checkout" checkout --detach "$candidate" >/dev/null 2>&1 || return 1
  for file in $files; do
    rerun_file "$file" >/dev/null 2>&1 || return 0
  done
  return 1
}

find_culprit() {
  local head="$1" last_green="$2" files="$3" candidates count lo hi mid candidate culprit="unknown"
  [[ -n "$last_green" ]] || { echo unknown; return 0; }
  candidates="$(git -C "$checkout" rev-list --first-parent --reverse "$last_green..$head" 2>/dev/null || true)"
  count="$(printf '%s\n' "$candidates" | sed '/^$/d' | wc -l | tr -d ' ')"
  if (( count == 1 )); then printf '%s\n' "$candidates"; return 0; fi
  if (( count > 8 )); then
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) more than 8 first-parent candidates between $last_green and $head; testing newest candidates in order" >> "$data/watcher.log"
    while IFS= read -r candidate; do
      [[ -n "$candidate" ]] || continue
      if candidate_is_red "$candidate" "$files"; then culprit="$candidate"; break; fi
    done < <(printf '%s\n' "$candidates" | awk 'NF { a[NR]=$0 } END { for (i=NR;i>NR-8 && i>0;i--) print a[i] }')
    echo "$culprit"
    return 0
  fi
  local -a list=()
  while IFS= read -r candidate; do [[ -n "$candidate" ]] && list+=("$candidate"); done <<< "$candidates"
  lo=0; hi=$((${#list[@]} - 1))
  while (( lo <= hi )); do
    mid=$(((lo + hi) / 2)); candidate="${list[$mid]}"
    if candidate_is_red "$candidate" "$files"; then culprit="$candidate"; hi=$((mid - 1)); else lo=$((mid + 1)); fi
  done
  echo "$culprit"
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
  local head last_run last_green previous started output seconds rc files file all_pass=1 result culprit subject title note_tmp note
  git -C "$checkout" fetch origin || { echo "watcher.sh: fetch failed" >> "$data/watcher.log"; return 0; }
  head="$(git -C "$checkout" rev-parse origin/main)"
  last_run="$(cat "$data/last-run" 2>/dev/null || true)"
  last_green="$(cat "$data/last-green" 2>/dev/null || true)"
  if [[ "$head" == "$last_run" || "$head" == "$last_green" ]]; then echo "up to date at ${head:0:7}"; return 0; fi
  previous="$last_run"
  git -C "$checkout" checkout --detach "$head" >/dev/null 2>&1
  install_if_needed "$previous"
  started="$(date +%s)"; output="$(mktemp "$data/.suite.XXXXXX")"
  set +e
  run_suite "$output"
  rc=$?
  set -e
  seconds=$(( $(date +%s) - started ))
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
  for file in $files; do if ! rerun_file "$file" >/dev/null 2>&1; then all_pass=0; fi; done
  if [[ -n "$files" && "$all_pass" -eq 1 ]]; then
    mark_green "$head"
    atomic_value "$data/last-green" "$head"
    atomic_value "$data/last-run" "$head"
    append_run "$head" flaky "$seconds" "$files" ""
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) flaky at $head; isolated reruns passed: $files" >> "$data/watcher.log"
    rm -f "$output" "$output.backend" "$output.frontend" "$output.scripts"
    echo "flaky at ${head:0:7}: $files"
    return 0
  fi
  culprit="$(find_culprit "$head" "$last_green" "$files")"
  git -C "$checkout" checkout --detach "$head" >/dev/null 2>&1 || true
  subject="unknown"
  if [[ "$culprit" != unknown ]]; then subject="$(git -C "$checkout" show -s --format=%s "$culprit" 2>/dev/null || echo unknown)"; fi
  note="$data/reds/$head.md"; note_tmp="$(mktemp "$data/reds/.red.XXXXXX")"
  {
    printf '# Main test failure: %s\n\n' "$head"
    printf -- '- Main SHA: `%s`\n- Culprit: `%s` (%s)\n- Failing files: %s\n\n' "$head" "$culprit" "$subject" "${files:-unknown}"
    printf '## Last 60 lines of suite output\n\n```text\n'
    tail -n 60 "$output"
    printf '\n```\n'
  } > "$note_tmp"
  mv -f "$note_tmp" "$note"
  append_run "$head" red "$seconds" "$files" "$culprit"
  atomic_value "$data/last-run" "$head"
  file="${files%% *}"; title="Watcher: main red at ${head:0:7}: ${file:-unknown}"
  file_issue "$title" "${file:-unknown}" "$note"
  rm -f "$output" "$output.backend" "$output.frontend" "$output.scripts"
  echo "red at ${head:0:7}: ${files:-unknown}; culprit ${culprit:0:7}"
}

serve() {
  local pidfile="$data/watcher.pid" poll="${MAIPAI_WATCH_POLL_SECONDS:-30}" old
  if [[ -f "$pidfile" ]]; then
    old="$(cat "$pidfile" 2>/dev/null || true)"
    if [[ "$old" =~ ^[0-9]+$ ]] && kill -0 "$old" 2>/dev/null && ps -p "$old" -o command= 2>/dev/null | grep -Eq 'watcher\.sh'; then error "already running as pid $old; stop it with bash scripts/pipeline.sh stop."; return 1; fi
  fi
  echo "$$" > "$pidfile"
  local stop_requested=0 sleep_pid=""
  trap 'stop_requested=1; if [[ -n "$sleep_pid" ]]; then kill "$sleep_pid" 2>/dev/null || true; fi' TERM INT HUP
  trap 'rm -f "$data/watcher.pid"' EXIT
  set +e
  while :; do
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
  checkout) checkout_warm ;;
  run-once) checkout_warm && run_once ;;
  serve) checkout_warm && serve ;;
  *) error "usage: bash scripts/watcher.sh run-once | serve | checkout"; exit 2 ;;
esac
