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
run_gate() {
  local output="$1" status_file="$2"
  set +e
  (cd "$WT" && export MAIPAI_COMMONS_DIR="${MAIPAI_COMMONS_DIR:-$ROOT/../commons}" MAIPAI_STANDARDS_DIR="${MAIPAI_STANDARDS_DIR:-$ROOT/../.github}"; eval "$GATE_CMD") >"$output" 2>&1
  local rc=$?
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
  else
    git -C "$ROOT" worktree add --detach "$WT" "$origin_main"
  fi
  base="$(cat "$LAST_GREEN" 2>/dev/null || true)"
  start="$(date +%s)"
  output="$(mktemp)"; status_file="$(mktemp)"
  run_gate "$output" "$status_file"
  rc="$(cat "$status_file")"
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
  if [[ -z "$base" ]]; then
    echo "main-gate: no last-green recorded; no automatic revert (note only)" >&2
  elif (( ${#commits[@]} == 1 )); then
    git -C "$WT" -c core.hooksPath=/dev/null revert --no-edit "${commits[0]}"
    if ! git -C "$WT" push origin HEAD:refs/heads/main; then
      git -C "$WT" fetch origin main
      echo "main-gate: push rejected; fetched origin/main and left failure note at $STATE/$origin_main.md" >&2
      rm -f "$output" "$status_file"
      return 1
    fi
  else
    echo "main-gate: $(( ${#commits[@]} )) commits since last green; no automatic revert" >&2
  fi
  rm -f "$output" "$status_file"
  return 1
}

case "${1:-once}" in
  once) once ;;
  loop) while :; do once || true; sleep 60; done ;;
  *) echo "usage: main-gate.sh [once|loop]" >&2; exit 2 ;;
esac
