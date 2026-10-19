#!/usr/bin/env bash
set -euo pipefail

ROOT="${MAIPAI_MAIN_GATE_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)}"
SESSION="${MAIPAI_WT_SESSION:-main-gate}"
WT="${MAIPAI_MAIN_GATE_WT:-$(cd "$ROOT/.." && pwd -P)/home-main-gate}"
STATE="$ROOT/data-scratch/main-gate"
LAST_GREEN="$STATE/last-green"
STATS="$ROOT/data-scratch/gate-stats/main-gate.jsonl"
LOCK="${MAIPAI_STANDARDS_DIR:-$ROOT/../.github}/standards/bin/gate-lock.sh"
GATE_CMD="${MAIPAI_MAIN_GATE_CMD:-bash scripts/check.sh}"

git_root() { git -C "$ROOT" rev-parse --show-toplevel; }
YIELDED=75
GATE_PID=""
kill_tree() {
  local child
  for child in $(pgrep -P "$1" 2>/dev/null); do kill_tree "$child"; done
  kill -TERM "$1" 2>/dev/null || true
}
# Read the whole status first: `status | grep -q` under pipefail fails on SIGPIPE when grep exits at the match.
lock_queued() { local st; st="$(bash "$LOCK" status 2>/dev/null || true)"; [[ $'\n'"$st" == *$'\nqueue:'* ]]; }
run_gate() {
  local output="$1" status_file="$2"
  set +e
  local stats_tmp="" rc
  # idle mode: the gate's runs.jsonl record is held back until the run ends, so a yielded run is not logged as red.
  [[ -n "${MAIN_GATE_YIELD:-}" ]] && stats_tmp="$(mktemp)"
  (cd "$WT" && export MAIPAI_COMMONS_DIR="${MAIPAI_COMMONS_DIR:-$ROOT/../commons}" MAIPAI_STANDARDS_DIR="${MAIPAI_STANDARDS_DIR:-$ROOT/../.github}"
   [[ -z "$stats_tmp" ]] || export MAIPAI_GATE_STATS_OUTPUT="$stats_tmp"
   eval "$GATE_CMD") >"$output" 2>&1 &
  GATE_PID=$!
  if [[ -n "$stats_tmp" ]]; then
    # A session that queues for the machine gate lock never waits on this run.
    while kill -0 "$GATE_PID" 2>/dev/null; do
      if lock_queued; then
        kill_tree "$GATE_PID"; wait "$GATE_PID" 2>/dev/null; GATE_PID=""
        rm -f "$stats_tmp"; printf '%s\n' "$YIELDED" > "$status_file"; set -e; return 0
      fi
      sleep "${MAIPAI_MAIN_GATE_POLL_SECONDS:-5}"
    done
  fi
  wait "$GATE_PID"
  rc=$?
  GATE_PID=""
  if [[ -n "$stats_tmp" ]]; then
    local runs="$ROOT/data-scratch/gate-stats/runs.jsonl"
    mkdir -p "$(dirname "$runs")"
    [[ ! -s "$stats_tmp" ]] || cat "$stats_tmp" >> "$runs"
    rm -f "$stats_tmp"
  fi
  set -e
  printf '%s\n' "$rc" > "$status_file"
  return 0
}

stage_retry() {
  local output="$1" stage="$2"
  # Re-run the individual named stage where its command is a stable standalone check.
  # Stages with setup/stateful generation are not independently repeatable, so rerun
  # the full gate command as the flake guard in those cases.
  case "$stage" in
    "backend: typecheck") (cd "$WT/backend" && bun run tsc --noEmit) ;;
    "scripts: typecheck") (cd "$WT" && bunx tsc --noEmit -p scripts/tsconfig.json) ;;
    "frontend: typecheck") (cd "$WT/frontend" && bun run tsc --noEmit) ;;
    "frontend: eslint") (cd "$WT/frontend" && bunx eslint .) ;;
    "pre: backend and scripts typecheck") (cd "$WT" && bash scripts/check.sh --pre) ;;
    "backend: bun test"|"scripts: bun test"|"frontend: build"|"frontend: a11y"|"frontend: ui rules"|"backend: settings registry, regenerate and check for drift"|"backend: API docs, regenerate and check for drift"|"backend: test server hostname lint"|"backend: rule-budget lint"|"stray root files"|"docs: reading-level lint"|"standards core"|preflight|install|"gate setup")
      case "$stage" in
        *"backend: bun test"*) (cd "$WT/backend" && bun test) ;;
        *"scripts: bun test"*) (cd "$WT" && bun test scripts) ;;
        *"frontend: build"*) (cd "$WT/frontend" && bun run build) ;;
        *"frontend: a11y"*) (cd "$WT/frontend" && bun run a11y) ;;
        *"frontend: ui rules"*) (cd "$WT/frontend" && bun run lint:ui-rules) ;;
        *"backend: test server hostname lint"*) (cd "$WT" && bun run scripts/gate/testServersLint.ts) ;;
        *) return 1 ;;
      esac
      ;;
    *) return 1 ;;
  esac
}

write_note() {
  local sha="$1" stage="$2" output="$3" base="$4" tmp_note
  local note="$STATE/$sha.md"
  mkdir -p "$STATE"
  tmp_note="$(mktemp "$STATE/.${sha}.XXXXXX")"
  {
    printf '# Main gate failure: %s\n\n' "$sha"
    printf 'Failing stage: %s\n\n' "$stage"
    local cause
    cause="$(grep -m1 -E 'Executable not found in \$PATH|Terminated: 15' "$output" || true)"
    # The last started "== " stage can be the wrong one when a tool crashes mid-run; quote the crash itself.
    [[ -z "$cause" ]] || printf 'Probable cause: %s\n\n' "$cause"
    printf '## Last 60 lines of gate output\n\n```text\n'
    tail -n 60 "$output"
    printf '\n```\n\n## Commits since last green\n\n'
    if [[ -n "$base" ]] && git -C "$WT" cat-file -e "$base^{commit}" 2>/dev/null && git -C "$WT" merge-base --is-ancestor "$base" "$sha"; then
      git -C "$WT" log --reverse --format='- %H · %an · %s' "$base..$sha"
      printf '\nChanged files per commit:\n\n'
      while IFS= read -r commit; do
        [[ -n "$commit" ]] || continue
        git -C "$WT" show --format='### %H · %an · %s' --name-only --no-renames "$commit"
        printf '\n'
      done < <(git -C "$WT" rev-list --reverse "$base..$sha")
    else
      git -C "$WT" log -1 --format='- %H · %an · %s' "$sha"
      git -C "$WT" show --format='### %H · %an · %s' --name-only --no-renames "$sha"
    fi
  } > "$tmp_note"
  mv -f "$tmp_note" "$note"
}

once() {
  mkdir -p "$STATE" "$(dirname "$STATS")"
  git -C "$ROOT" fetch origin
  local sha origin_main base start output status_file rc stage
  origin_main="$(git -C "$ROOT" rev-parse origin/main)"
  if [[ -f "$LAST_GREEN" ]] && [[ "$(cat "$LAST_GREEN")" == "$origin_main" ]]; then
    echo "main-gate: $origin_main unchanged since last green"
    return 0
  fi
  if [[ -e "$WT/.git" ]]; then
    git -C "$WT" fetch origin main
    origin_main="$(git -C "$WT" rev-parse FETCH_HEAD)"
    git -C "$WT" checkout --detach "$origin_main"
    git -C "$WT" reset --hard "$origin_main"
    # Untracked leftovers would mark the run as not clean, and a release could not reuse it.
    git -C "$WT" clean -fdq
  else
    git -C "$ROOT" worktree add --detach "$WT" "$origin_main"
  fi
  if [[ -z "${MAIPAI_MAIN_GATE_SKIP_INSTALL:-}" ]]; then
    for d in backend frontend; do [[ -d "$WT/$d" ]] && (cd "$WT/$d" && bun install --frozen-lockfile >/dev/null 2>&1); done
  fi
  base="$(cat "$LAST_GREEN" 2>/dev/null || true)"
  start="$(date +%s)"
  output="$(mktemp)"; status_file="$(mktemp)"
  run_gate "$output" "$status_file"
  rc="$(cat "$status_file")"
  if (( rc == YIELDED )); then
    echo "main-gate: yielded $origin_main to a session waiting for the gate lock; the next landing tries again"
    rm -f "$output" "$status_file"
    return 0
  fi
  # A failing check.sh stage is the last started stage before its final report.
  stage="$(awk '/^== / && $0 !~ /all checks passed/{s=substr($0,4)} END{print s}' "$output")"
  if (( rc != 0 )); then
    set +e
    stage_retry "$output" "$stage"
    local retry_rc=$?
    if (( retry_rc == 0 )); then
      rc=0
    fi
    set -e
  fi
  local seconds=$(( $(date +%s) - start ))
  if (( rc == 0 )); then
    printf '%s\n' "$origin_main" > "$LAST_GREEN"
    printf '{"sha":"%s","result":"green","seconds":%d}\n' "$origin_main" "$seconds" >> "$STATS"
    rm -f "$output" "$status_file"
    return 0
  fi
  write_note "$origin_main" "$stage" "$output" "$base"
  echo "main-gate: wrote failure note $STATE/$origin_main.md" >&2
  printf '{"sha":"%s","result":"red","seconds":%d}\n' "$origin_main" "$seconds" >> "$STATS"
  local commits=()
  if [[ -n "$base" ]] && git -C "$WT" cat-file -e "$base^{commit}" 2>/dev/null; then
    while IFS= read -r commit; do [[ -n "$commit" ]] && commits+=("$commit"); done < <(git -C "$WT" rev-list --reverse "$base..$origin_main")
  else
    parent="$(git -C "$WT" rev-parse "$origin_main^" 2>/dev/null || true)"
    if [[ -n "$parent" ]]; then
      while IFS= read -r commit; do [[ -n "$commit" ]] && commits+=("$commit"); done < <(git -C "$WT" rev-list --reverse "$parent..$origin_main")
    else
      commits=("$origin_main")
    fi
  fi
  # GATE-FAST-01 (2026-10-16): report only. The automatic revert reverted
  # seven good commits on false reds between 10-09 and 10-16 (each then
  # "restored"); a red note names the commits since last green instead, and
  # a person decides. launchd runs `once` daily (com.maipai.main-gate,
  # StartCalendarInterval 04:00), never a loop.
  echo "main-gate: red at $origin_main; ${#commits[@]} commit(s) since last green, no automatic revert; note at $STATE/$origin_main.md" >&2
  rm -f "$output" "$status_file"
  return 1
}

# RELEASE-GATE-01 (2026-10-19): `wt.sh land` starts `idle` in the background
# after each landing so main's newest commit gets a clean full gate a release
# can reuse (check.sh --release). It runs only while the machine gate lock is
# free and yields the moment a session queues for it. One idle run at a time;
# a landing during a run asks that run to go again on the newer main.
idle() {
  mkdir -p "$STATE"
  local running="$STATE/idle.run" again="$STATE/idle.again"
  # mkdir is atomic, so two landings at the same moment cannot both start a run.
  if ! mkdir "$running" 2>/dev/null; then
    if kill -0 "$(cat "$running/pid" 2>/dev/null)" 2>/dev/null; then
      touch "$again"
      echo "main-gate: an idle run is already going; it will check the newer main when it ends"
      return 0
    fi
    rm -rf "$running"
    mkdir "$running" 2>/dev/null || { touch "$again"; echo "main-gate: another idle run just started"; return 0; }
  fi
  echo "$$" > "$running/pid"
  # Killing this run also stops its gate, so it never keeps the machine lock unattended.
  # shellcheck disable=SC2064 # expand now: $running is local and gone by the time the trap fires
  trap "[[ -z \"\$GATE_PID\" ]] || kill_tree \"\$GATE_PID\"; rm -rf '$running'" EXIT
  trap 'exit 143' TERM INT HUP
  while :; do
    rm -f "$again"
    if [[ "$(bash "$LOCK" status 2>/dev/null | head -1)" != free ]]; then
      echo "main-gate: the gate lock is busy, skipped; the next landing tries again"
      return 0
    fi
    MAIN_GATE_YIELD=1 once || true
    [[ -f "$again" ]] || return 0
  done
}

case "${1:-once}" in
  once) once ;;
  idle) idle ;;
  loop) echo "main-gate: the loop mode was retired on 2026-10-16 (GATE-FAST-01); run 'once' from launchd daily or by hand." >&2; exit 2 ;;
  *) echo "usage: main-gate.sh [once|idle]" >&2; exit 2 ;;
esac
