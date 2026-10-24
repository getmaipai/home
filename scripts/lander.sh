#!/usr/bin/env bash
set -euo pipefail
umask 077

error() { echo "lander.sh: $1" >&2; }
common="$(git rev-parse --git-common-dir 2>/dev/null)" || { error "not inside a git checkout; run this from the main checkout."; exit 1; }
[[ "$common" = /* ]] || common="$(cd "$(dirname "$common")" && pwd -P)/$(basename "$common")"
main="$(cd "$(dirname "$common")" && pwd -P)"
data="${MAIPAI_LAND_DATA:-$main/data-scratch/land}"
checkout="${MAIPAI_LAND_CHECKOUT:-$(cd "$main/.." && pwd -P)/home-lander}"
mkdir -p "$data/queue" "$data/notes" "$data"
git_env="${MAIPAI_LAND_GIT_ENV-$main/data-scratch/bin/https-git.env}"
if [[ -n "$git_env" && -f "$git_env" ]]; then source "$git_env"; fi

checkout_warm() {
  if [[ ! -e "$checkout/.git" ]]; then
    git -C "$main" fetch origin || { error "could not fetch origin; check network and git credentials, then retry checkout."; return 1; }
    git -C "$main" worktree add --detach "$checkout" origin/main || { error "could not create warm checkout at $checkout; remove a stale path and retry."; return 1; }
  fi
  if [[ -z "${MAIPAI_LAND_SKIP_INSTALL:-}" ]]; then
    local d
    for d in backend frontend; do
      [[ -d "$checkout/$d" ]] || continue
      (cd "$checkout/$d" && bun install --frozen-lockfile) || { error "bun install failed in $d; repair dependencies in $checkout and retry."; return 1; }
    done
  fi
}

atomic_json_note() {
  local branch="$1" sha="$2" status="$3" reason="$4" main_sha="$5" tail_file="$6" seconds="$7"
  local slug="${branch//\//-}" json_tmp md_tmp finished check_tail
  local json="$data/notes/$slug.json" md="$data/notes/$slug.md"
  finished="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  check_tail="$(tail -n 40 "$tail_file" 2>/dev/null || true)"
  json_tmp="$(mktemp "$data/notes/.note.XXXXXX")"
  md_tmp="$(mktemp "$data/notes/.note.XXXXXX")"
  python3 - "$json_tmp" "$branch" "$sha" "$status" "$reason" "$main_sha" "$check_tail" "$seconds" "$finished" <<'PY'
import json, sys
with open(sys.argv[1], 'w') as f:
    json.dump(dict(branch=sys.argv[2], sha=sys.argv[3], status=sys.argv[4], reason=sys.argv[5], main_sha=sys.argv[6], check_tail=sys.argv[7], seconds=int(sys.argv[8]), finished_at=sys.argv[9]), f)
    f.write('\n')
PY
  {
    printf '# %s: %s\n\n' "$status" "$branch"
    printf -- '- Branch: `%s`\n- SHA: `%s`\n- Main SHA: `%s`\n- Reason: %s\n\n' "$branch" "$sha" "$main_sha" "$reason"
    printf '## Last 40 lines of check output\n\n```text\n%s\n```\n' "$check_tail"
  } > "$md_tmp"
  mv -f "$json_tmp" "$json"
  mv -f "$md_tmp" "$md"
}

log_line() {
  python3 - "$1" "$2" "$3" "$4" "$5" "$6" "$7" "$8" <<'PY'
import json, sys
with open(sys.argv[1], 'a') as f:
    f.write(json.dumps(dict(ts=sys.argv[2], branch=sys.argv[3], sha=sys.argv[4], main_sha=sys.argv[5], status=sys.argv[6], seconds=int(sys.argv[7]), reason=sys.argv[8])) + '\n')
PY
}

bounce() {
  local request="$1" branch="$2" sha="$3" reason="$4" started="$5" output="$6" main_sha seconds slug
  main_sha="$(git -C "$checkout" rev-parse origin/main 2>/dev/null || git -C "$checkout" rev-parse HEAD 2>/dev/null || echo unknown)"
  seconds=$(( $(date +%s) - started )); slug="${branch//\//-}"
  atomic_json_note "$branch" "$sha" bounced "$reason" "$main_sha" "$output" "$seconds"
  log_line "$data/landings.jsonl" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$branch" "$sha" "$main_sha" bounced "$seconds" "$reason"
  rm -f "$request"
  echo "bounced: $branch at $sha: $reason"
}

run_one() {
  local request="$1" branch sha started output origin_branch prev_sha conflict reason check_cmd main_sha seconds attempt changed before_rebase after_rebase intersect
  started="$(date +%s)"; output="$(mktemp "$data/.check.XXXXXX")"
  if ! python3 - "$request" >"$data/.request-values" <<'PY'
import json, sys
try:
    v=json.load(open(sys.argv[1]))
    assert all(isinstance(v.get(k), str) and v[k] for k in ('branch','sha','worktree','requested_at'))
    assert isinstance(v.get('session'), str)
    print(v['branch']); print(v['sha'])
except Exception:
    sys.exit(1)
PY
  then
    mkdir -p "$data/queue/bad"
    mv "$request" "$data/queue/bad/$(basename "$request")"
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) invalid request $(basename "$request") moved to queue/bad; repair or remove it" >> "$data/lander.log"
    echo "lander.sh: invalid request moved to queue/bad; repair or remove it and inspect $data/lander.log" >&2
    rm -f "$output" "$data/.request-values"
    return 0
  fi
  branch="$(sed -n '1p' "$data/.request-values")"; sha="$(sed -n '2p' "$data/.request-values")"; rm -f "$data/.request-values"
  if [[ ! "$branch" == wt/* || ! "$sha" =~ ^[0-9a-fA-F]{40,64}$ ]]; then
    mkdir -p "$data/queue/bad"; mv "$request" "$data/queue/bad/$(basename "$request")"
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) malformed request $(basename "$request") moved to queue/bad; repair or remove it" >> "$data/lander.log"
    echo "lander.sh: malformed branch or sha moved to queue/bad; repair or remove it and inspect $data/lander.log" >&2
    rm -f "$output"; return 0
  fi
  if ! git -C "$checkout" fetch origin; then bounce "$request" "$branch" "$sha" "could not fetch origin; check network and git credentials, then land.sh again" "$started" "$output"; rm -f "$output"; return 0; fi
  origin_branch="$(git -C "$checkout" rev-parse --verify "origin/$branch" 2>/dev/null || true)"
  if [[ "$origin_branch" != "$sha" ]]; then bounce "$request" "$branch" "$sha" "branch not on origin at $sha; run land.sh again" "$started" "$output"; rm -f "$output"; return 0; fi
  prev_sha="$(git -C "$checkout" rev-parse HEAD 2>/dev/null || echo origin/main)"
  if ! git -C "$checkout" checkout --detach "$sha"; then bounce "$request" "$branch" "$sha" "could not check out $sha; inspect the warm checkout, then land.sh again" "$started" "$output"; rm -f "$output"; return 0; fi
  if ! git -C "$checkout" rebase origin/main; then
    conflict="$(git -C "$checkout" diff --name-only --diff-filter=U || true)"
    git -C "$checkout" rebase --abort || true
    reason="rebase conflict in: ${conflict:-unknown files}; rebase onto origin/main in your worktree, then land.sh again"
    bounce "$request" "$branch" "$sha" "$reason" "$started" "$output"; rm -f "$output"; return 0
  fi
  local rebased_sha
  rebased_sha="$(git -C "$checkout" rev-parse HEAD)"
  local package_changed
  package_changed="$(git -C "$checkout" diff --name-only "$prev_sha" "$rebased_sha" 2>/dev/null | grep -E '^(backend|frontend)/(package\.json|bun\.lock)$' || true)"
  if [[ -n "$package_changed" && -z "${MAIPAI_LAND_SKIP_INSTALL:-}" ]]; then
    local d
    for d in backend frontend; do
      if printf '%s\n' "$package_changed" | grep -Eq "^$d/"; then
        (cd "$checkout/$d" && bun install --frozen-lockfile) || { bounce "$request" "$branch" "$sha" "bun install failed in $d; repair dependencies and run land.sh again" "$started" "$output"; rm -f "$output"; return 0; }
      fi
    done
  fi
  check_cmd="${MAIPAI_LAND_CHECK_CMD:-}"
  if [[ -n "$check_cmd" ]]; then
    (cd "$checkout" && eval "$check_cmd") >"$output" 2>&1 || { bounce "$request" "$branch" "$sha" "static check failed" "$started" "$output"; rm -f "$output"; return 0; }
  else
    (cd "$checkout" && export MAIPAI_COMMONS_DIR="$(cd "$main/.." && pwd -P)/commons" MAIPAI_STANDARDS_DIR="$(cd "$main/.." && pwd -P)/.github" && bash scripts/check.sh --pre && (cd frontend && bunx eslint . --cache --cache-location .eslintcache)) >"$output" 2>&1 || { bounce "$request" "$branch" "$sha" "static check failed" "$started" "$output"; rm -f "$output"; return 0; }
  fi

  for attempt in 1 2 3; do
    if git -C "$checkout" push origin HEAD:refs/heads/main; then
      main_sha="$(git -C "$checkout" rev-parse HEAD)"
      git -C "$checkout" push origin --delete "$branch" >>"$data/lander.log" 2>&1 || echo "lander.sh: could not delete remote $branch; remove it when convenient." >&2
      seconds=$(( $(date +%s) - started ))
      atomic_json_note "$branch" "$sha" landed "landed" "$main_sha" "$output" "$seconds"
      log_line "$data/landings.jsonl" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$branch" "$sha" "$main_sha" landed "$seconds" "landed"
      rm -f "$request" "$output"
      echo "landed: $branch at $sha"
      return 0
    fi
    if (( attempt == 3 )); then break; fi
    before_rebase="$(git -C "$checkout" rev-parse HEAD)"
    changed="$(git -C "$checkout" diff --name-only origin/main...HEAD || true)"
    git -C "$checkout" fetch origin || break
    if ! git -C "$checkout" rebase origin/main; then
      git -C "$checkout" rebase --abort || true
      break
    fi
    after_rebase="$(git -C "$checkout" rev-parse HEAD)"
    intersect=""
    if [[ -n "$changed" ]]; then
      intersect="$(comm -12 <(printf '%s\n' "$changed" | sort -u) <(git -C "$checkout" diff --name-only "$before_rebase" "$after_rebase" | sort -u))"
    fi
    if [[ -n "$intersect" ]]; then
      if [[ -n "$check_cmd" ]]; then
        (cd "$checkout" && eval "$check_cmd") >"$output" 2>&1 || { bounce "$request" "$branch" "$sha" "static check failed" "$started" "$output"; rm -f "$output"; return 0; }
      else
        (cd "$checkout" && export MAIPAI_COMMONS_DIR="$(cd "$main/.." && pwd -P)/commons" MAIPAI_STANDARDS_DIR="$(cd "$main/.." && pwd -P)/.github" && bash scripts/check.sh --pre && (cd frontend && bunx eslint . --cache --cache-location .eslintcache)) >"$output" 2>&1 || { bounce "$request" "$branch" "$sha" "static check failed" "$started" "$output"; rm -f "$output"; return 0; }
      fi
    fi
  done
  bounce "$request" "$branch" "$sha" "main moved three times during landing; run land.sh again" "$started" "$output"
  rm -f "$output"
}

run_once() {
  local request
  request="$(find "$data/queue" -maxdepth 1 -type f -name '*.json' -print | sort | head -n 1)"
  if [[ -z "$request" ]]; then echo "queue empty"; return 0; fi
  run_one "$request"
}

serve() {
  local pidfile="$data/lander.pid" poll="${MAIPAI_LAND_POLL_SECONDS:-2}" old
  if [[ -f "$pidfile" ]]; then
    old="$(cat "$pidfile" 2>/dev/null || true)"
    if [[ "$old" =~ ^[0-9]+$ ]] && kill -0 "$old" 2>/dev/null && ps -p "$old" -o command= 2>/dev/null | grep -Eq 'lander\.sh'; then error "already running as pid $old; stop it with bash scripts/pipeline.sh stop."; return 1; fi
  fi
  echo "$$" > "$pidfile"
  local stop_requested=0 sleep_pid=""
  trap 'stop_requested=1; if [[ -n "$sleep_pid" ]]; then kill "$sleep_pid" 2>/dev/null || true; fi' TERM INT HUP
  trap 'rm -f "$data/lander.pid"' EXIT
  set +e
  while :; do
    run_once || echo "lander.sh: run-once failed; inspect the request and lander.log, then restart with bash scripts/pipeline.sh start." >&2
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
  *) error "usage: bash scripts/lander.sh run-once | serve | checkout"; exit 2 ;;
esac
