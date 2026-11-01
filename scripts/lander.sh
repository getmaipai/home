#!/usr/bin/env bash
set -euo pipefail
umask 077

error() { echo "lander.sh: $1" >&2; }
common="$(git rev-parse --git-common-dir 2>/dev/null)" || { error "not inside a git checkout; run this from the main checkout."; exit 1; }
[[ "$common" = /* ]] || common="$(cd "$(dirname "$common")" && pwd -P)/$(basename "$common")"
main="$(cd "$(dirname "$common")" && pwd -P)"
export GATE_HEAVY_HELD=1
bin="${MAIPAI_PIPELINE_BIN:-$main/data-scratch/pipeline-bin}"
data="${MAIPAI_LAND_DATA:-$main/data-scratch/land}"
checkout="${MAIPAI_LAND_CHECKOUT:-$(cd "$main/.." && pwd -P)/home-lander}"
mkdir -p "$data/queue" "$data/notes" "$data"
git_env="${MAIPAI_LAND_GIT_ENV-$main/data-scratch/bin/https-git.env}"
if [[ -n "$git_env" && -f "$git_env" ]]; then source "$git_env"; fi

# GITNET-01: every remote git operation and every long step is bounded (scripts/lib/gitnet.sh), so one hung connection cannot hold the queue.
# The lib is a snapshot taken from origin/main like this script; until it is present the plain, unbounded behaviour below applies.
gitnet_lib="$bin/gitnet.sh"
[[ -f "$gitnet_lib" ]] || gitnet_lib="$main/scripts/lib/gitnet.sh"
if [[ -f "$gitnet_lib" ]]; then source "$gitnet_lib"
else
  gitnet_lib=""
  gitnet_env() { :; }
  bounded_run() { shift 2; "$@"; }
  gitnet() { git "$@"; }
fi
mkdir -p "$data/ops"
GITNET_TIMED_OUT=0
export GITNET_OPS_DIR="$data/ops" GITNET_STUCK_LOG="$data/stuck.log"
gitnet_env "$main"

refresh_snapshot() {
  local script="$1" src="${2:-scripts/$1}" current="$bin/$1" tmp="$bin/$1.new"
  mkdir -p "$bin"
  [[ -n "${REFRESH_SKIP_FETCH:-}" ]] || GITNET_TRIES=1 GITNET_TIMEOUT=30 GITNET_LABEL="refresh fetch" gitnet -C "$main" fetch -q origin main >/dev/null 2>&1 || true
  if ! git -C "$main" show "origin/main:$src" > "$tmp" 2>/dev/null || [[ ! -s "$tmp" ]]; then
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

checkout_warm() {
  if [[ ! -e "$checkout/.git" ]]; then
    gitnet -C "$main" fetch origin || { error "could not fetch origin; check network and git credentials, then retry checkout."; return 1; }
    git -C "$main" worktree add --detach "$checkout" origin/main || { error "could not create warm checkout at $checkout; remove a stale path and retry."; return 1; }
  fi
  if [[ -z "${MAIPAI_LAND_SKIP_INSTALL:-}" ]]; then
    local d
    for d in backend frontend; do
      [[ -d "$checkout/$d" ]] || continue
      bounded_run "${MAIPAI_LAND_INSTALL_SECONDS:-600}" "bun install $d (warm checkout)" bash -c 'cd "$1" && bun install --frozen-lockfile' _ "$checkout/$d" || { error "bun install failed or timed out in $d; repair dependencies in $checkout and retry."; return 1; }
    done
  fi
}

atomic_json_note() {
  local branch="$1" sha="$2" status="$3" reason="$4" main_sha="$5" tail_file="$6" seconds="$7" landing_note="${8:-}"
  local slug="${branch//\//-}" json_tmp md_tmp finished check_tail
  local json="$data/notes/$slug.json" md="$data/notes/$slug.md"
  finished="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  check_tail="$(tail -n 40 "$tail_file" 2>/dev/null || true)"
  json_tmp="$(mktemp "$data/notes/.note.XXXXXX")"
  md_tmp="$(mktemp "$data/notes/.note.XXXXXX")"
python3 - "$json_tmp" "$branch" "$sha" "$status" "$reason" "$main_sha" "$check_tail" "$seconds" "$finished" "$landing_note" <<'PY'
import json, sys
with open(sys.argv[1], 'w') as f:
    json.dump(dict(branch=sys.argv[2], sha=sys.argv[3], status=sys.argv[4], reason=sys.argv[5], main_sha=sys.argv[6], check_tail=sys.argv[7], seconds=int(sys.argv[8]), finished_at=sys.argv[9], note=sys.argv[10]), f)
    f.write('\n')
PY
  {
    printf '# %s: %s\n\n' "$status" "$branch"
    printf -- '- Branch: `%s`\n- SHA: `%s`\n- Main SHA: `%s`\n- Reason: %s\n' "$branch" "$sha" "$main_sha" "$reason"
    [[ -z "$landing_note" ]] || printf -- '- Note: %s\n' "$landing_note"
    printf '\n'
    printf '## Last 40 lines of check output\n\n```text\n%s\n```\n' "$check_tail"
  } > "$md_tmp"
  mv -f "$json_tmp" "$json"
  mv -f "$md_tmp" "$md"
  ring_waiters || true
}

log_line() {
  python3 - "$1" "$2" "$3" "$4" "$5" "$6" "$7" "$8" <<'PY'
import json, sys
with open(sys.argv[1], 'a') as f:
    f.write(json.dumps(dict(ts=sys.argv[2], branch=sys.argv[3], sha=sys.argv[4], main_sha=sys.argv[5], status=sys.argv[6], seconds=int(sys.argv[7]), reason=sys.argv[8])) + '\n')
PY
}

# DISK-WAIT-01: wake every blocked waiter whose condition now holds. Waiters (land.sh wait, pipeline.sh wait) leave <pid>.want and <pid>.fifo in $data/waiters.
# The write opens the FIFO non-blocking, so a waiter that went away never blocks the lander; files of dead pids are removed.
ring_waiters() {
  local wdir="$data/waiters"
  [[ -d "$wdir" ]] || return 0
  ls "$wdir"/*.want >/dev/null 2>&1 || return 0
  python3 - "$wdir" "$data" "${MAIPAI_WATCH_DATA:-$main/data-scratch/watch}" <<'PY' || true
import glob, json, os, sys
wdir, data, watch = sys.argv[1:]
def notes():
    for f in glob.glob(os.path.join(data, 'notes', '*.json')):
        try: yield json.load(open(f))
        except Exception: pass
def rd(p):
    try: return open(p).read().strip()
    except OSError: return ''
def holds(kind, a):
    if kind == 'sha':
        for n in notes():
            if n.get('sha') == a[0] and n.get('status') == 'landed': return 'landed ' + a[0]
        try:
            for line in open(os.path.join(data, 'landings.jsonl')):
                try: r = json.loads(line)
                except Exception: continue
                if r.get('sha') == a[0] and r.get('status') == 'landed': return 'landed ' + a[0]
        except OSError: pass
    elif kind == 'note':
        for n in notes():
            if n.get('branch') == a[0] and n.get('sha') == a[1]: return n.get('status', '')
    elif kind == 'branch':
        for n in notes():
            if n.get('branch') == a[0]: return n.get('status', '')
    elif kind == 'queue-empty':
        if not glob.glob(os.path.join(data, 'queue', '*.json')): return 'queue empty'
    elif kind == 'main-green':
        run = rd(os.path.join(watch, 'last-run'))
        if run and run == rd(os.path.join(watch, 'last-green')): return 'main green at ' + run[:7]
    return ''
for want in glob.glob(os.path.join(wdir, '*.want')):
    base = want[:-5]; fifo = base + '.fifo'
    try: pid = int(os.path.basename(base))
    except ValueError: continue
    alive = True
    try: os.kill(pid, 0)
    except ProcessLookupError: alive = False
    except PermissionError: pass
    if not alive:
        for f in (want, fifo):
            try: os.unlink(f)
            except OSError: pass
        continue
    parts = rd(want).split('\t')
    if not parts[0]: continue
    msg = holds(parts[0], parts[1:])
    if not msg: continue
    try:
        fd = os.open(fifo, os.O_WRONLY | os.O_NONBLOCK)
    except OSError:
        continue
    try: os.write(fd, (msg + '\n').encode())
    except OSError: pass
    finally: os.close(fd)
PY
}

# DISK-REMOVE-01: remove finished worktrees after a landing. Best effort: errors are logged, a landing never fails because of it.
sweep_worktrees() {
  [[ -f "$main/scripts/pipeline.sh" ]] || return 0
  bounded_run "${MAIPAI_LAND_SWEEP_SECONDS:-600}" "worktree sweep" bash -c 'cd "$1" && nice -n 10 bash scripts/pipeline.sh sweep' _ "$main" >>"$data/lander.log" 2>&1 || echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) worktree sweep failed or timed out; see above" >> "$data/lander.log"
  return 0
}

# After the fast-forward, reinstall in backend and frontend when their package files moved, so scripts in the main checkout keep working across a pin bump. Never fails the landing: it is already on main.
reinstall_main_dependencies() {
  local before="$1" changed d done_dirs=()
  [[ -z "${MAIPAI_LAND_SKIP_INSTALL:-}" && -n "$before" ]] || return 0
  changed="$(git -C "$main" diff --name-only "$before" HEAD -- backend/package.json backend/bun.lock frontend/package.json frontend/bun.lock 2>/dev/null || true)"
  [[ -n "$changed" ]] || return 0
  for d in backend frontend; do
    printf '%s\n' "$changed" | grep -Eq "^$d/" || continue
    # --force: a pinned commons package is a file: dependency, and a plain install keeps the old snapshot when only the pin path changed (docs/PINNING.md).
    if bounded_run "${MAIPAI_LAND_INSTALL_SECONDS:-600}" "bun install $d (main checkout)" bash -c 'cd "$1" && bun install --frozen-lockfile --force' _ "$main/$d" >/dev/null 2>&1; then done_dirs+=("$d")
    else echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) main checkout install failed in $d; run bun install there" >> "$data/lander.log"; fi
  done
  [[ ${#done_dirs[@]} -eq 0 ]] || echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) main checkout dependencies reinstalled (${done_dirs[*]})" >> "$data/lander.log"
}

update_main_checkout() {
  [[ "${MAIPAI_LAND_UPDATE_MAIN:-1}" == 0 ]] && return 0
  local branch head origin_main lock_path reason
  branch="$(git -C "$main" symbolic-ref --short -q HEAD 2>/dev/null || true)"
  head="$(git -C "$main" rev-parse HEAD 2>/dev/null || true)"
  if [[ -n "$branch" && "$branch" != main ]]; then reason="diverged (checked out $branch)"
  elif [[ -n "$(git -C "$main" status --porcelain --untracked-files=no 2>/dev/null)" ]]; then reason="dirty tracked tree"
  else
    lock_path="$(git -C "$main" rev-parse --git-path index.lock 2>/dev/null || true)"
    [[ "$lock_path" = /* ]] || lock_path="$main/$lock_path"
    if [[ -e "$lock_path" ]]; then reason="index is locked"
    elif ! GITNET_LABEL="main checkout fetch" gitnet -C "$main" fetch origin main >/dev/null 2>&1; then reason="could not fetch origin/main"
    else
      origin_main="$(git -C "$main" rev-parse origin/main 2>/dev/null || true)"
      if [[ -z "$branch" ]] && { [[ -z "$head" || -z "$origin_main" ]] || ! git -C "$main" merge-base --is-ancestor "$head" "$origin_main"; }; then reason="diverged (detached HEAD is not an ancestor of origin/main)"
      elif git -C "$main" merge --ff-only origin/main >/dev/null 2>&1; then
        echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) main checkout fast-forwarded to $(git -C "$main" rev-parse --short HEAD)" >> "$data/lander.log"
        reinstall_main_dependencies "$head"
        return 0
      else reason="fast-forward failed"; fi
    fi
  fi
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) main checkout update skipped: $reason" >> "$data/lander.log"
}

safety_surface_files() {
  local changed="$1" glob regex file matches=""
  local globs
  globs="$(git -C "$checkout" show origin/main:scripts/wt.sh 2>/dev/null | sed -n 's/^export WT_T2_GLOBS="\(.*\)"$/\1/p' | head -n 1)"
  [[ -n "$globs" ]] || return 0
  for file in $changed; do
    for glob in $globs; do
      regex="$(printf '%s' "$glob" | sed -E 's/[][(){}.+?^$|\\]/\\&/g; s/\*/.*/g')"
      if printf '%s\n' "$file" | grep -Eq "^${regex}$"; then
        matches="${matches:+$matches
}$file"
        break
      fi
    done
  done
  printf '%s' "$matches"
}

# GITNET-01: a long step runs in its own process group under a wall clock. On timeout only that group is signalled, the output
# says so on its last line, and the step fails like any other failure, so the entry bounces with the cause and the queue moves on.
bounded_step() {
  local secs="$1" label="$2" out="$3" rc=0
  shift 3
  bounded_run "$secs" "$label" "$@" >"$out" 2>&1 || rc=$?
  if (( rc == 124 )); then echo "timed out after ${secs}s: $label" >>"$out"; fi
  return "$rc"
}

timeout_note() { tail -n 1 "$1" 2>/dev/null | grep -E '^timed out after ' || true; }

run_t2_tests() {
  local output="$1" command="${MAIPAI_LAND_T2_CMD:-bun scripts/gate/shardTests.ts --dir backend --root tests && bun scripts/gate/shardTests.ts --dir frontend --root .}"
  bounded_step "${MAIPAI_LAND_T2_SECONDS:-2400}" "safety-surface tests" "$output" bash -c 'cd "$1" && eval "$2"' _ "$checkout" "$command"
}

run_static_check() {
  local output="$1" cap="${MAIPAI_LAND_CHECK_SECONDS:-900}" command="${MAIPAI_LAND_CHECK_CMD:-}"
  if [[ -n "$command" ]]; then
    bounded_step "$cap" "static check" "$output" bash -c 'cd "$1" && eval "$2"' _ "$checkout" "$command"
  else
    MAIPAI_COMMONS_DIR="$(cd "$main/.." && pwd -P)/commons" MAIPAI_STANDARDS_DIR="$(cd "$main/.." && pwd -P)/.github" \
      bounded_step "$cap" "static check" "$output" bash -c 'cd "$1" && bash scripts/check.sh --pre && (cd frontend && bunx eslint . --cache --cache-location .eslintcache)' _ "$checkout"
  fi
}

static_check_reason() {
  local output="$1" last_line note
  note="$(timeout_note "$output")"
  if [[ -n "$note" ]]; then printf 'static check %s' "$note"; return; fi
  last_line="$(sed -n '/^== /p' "$output" | tail -n 1 | sed 's/^== //')"
  printf 'static check failed%s' "${last_line:+ at $last_line}"
}

# A network failure (timeout after the bounded retries) does not bounce the entry at once: it goes to the back of the queue for a
# growing pause, so one stalled connection never blocks the entries behind it, and after MAIPAI_LAND_DEFER_MAX tries it bounces with the cause.
defer_dir() { printf '%s/deferred' "$data"; }
net_fail() {
  local request="$1" branch="$2" sha="$3" what="$4" started="$5" output="$6" base n reason
  base="$(basename "$request")"; mkdir -p "$(defer_dir)"
  if (( GITNET_TIMED_OUT )); then reason="git $what timed out; GitHub did not answer in time"; else reason="could not $what origin; check network and git credentials"; fi
  n="$(cat "$(defer_dir)/$base.n" 2>/dev/null || echo 0)"; n=$(( n + 1 ))
  if (( n >= ${MAIPAI_LAND_DEFER_MAX:-3} )); then
    bounce "$request" "$branch" "$sha" "$reason (gave up after $n tries); run land.sh again when the network is back" "$started" "$output"
    return 0
  fi
  printf '%s\n' "$n" >"$(defer_dir)/$base.n"
  printf '%s\n' $(( $(date +%s) + ${MAIPAI_LAND_DEFER_SECONDS:-120} * n )) >"$(defer_dir)/$base.until"
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) deferred $branch (try $n): $reason" >> "$data/lander.log"
  echo "deferred: $branch (try $n): $reason"
}

# The oldest request that is not waiting out a network pause.
next_request() {
  local f now until
  now="$(date +%s)"
  while IFS= read -r f; do
    until="$(cat "$(defer_dir)/$(basename "$f").until" 2>/dev/null || echo 0)"
    [[ "$until" =~ ^[0-9]+$ ]] || until=0
    if (( until <= now )); then printf '%s' "$f"; return 0; fi
  done < <(find "$data/queue" -maxdepth 1 -type f -name '*.json' -print | sort)
}

# One line the status page reads: branch, when the entry started, when the phase last changed, the phase.
phase() { printf '%s\t%s\t%s\t%s\n' "${current_branch:-}" "${entry_started:-0}" "$(date +%s)" "$1" >"$data/current-entry.tmp" && mv -f "$data/current-entry.tmp" "$data/current-entry"; }

bounce() {
  local request="$1" branch="$2" sha="$3" reason="$4" started="$5" output="$6" main_sha seconds slug landing_note
  landing_note="$(python3 - "$request" <<'PY'
import json, sys
try: print(json.load(open(sys.argv[1])).get('note', ''))
except Exception: print('')
PY
)"
  main_sha="$(git -C "$checkout" rev-parse origin/main 2>/dev/null || git -C "$checkout" rev-parse HEAD 2>/dev/null || echo unknown)"
  seconds=$(( $(date +%s) - started )); slug="${branch//\//-}"
  atomic_json_note "$branch" "$sha" bounced "$reason" "$main_sha" "$output" "$seconds" "$landing_note"
  log_line "$data/landings.jsonl" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$branch" "$sha" "$main_sha" bounced "$seconds" "$reason"
  rm -f "$request" "$(defer_dir)/$(basename "$request")".n "$(defer_dir)/$(basename "$request")".until
  echo "bounced: $branch at $sha: $reason"
}

run_one() {
  local request="$1" branch sha started output origin_branch prev_sha conflict reason check_cmd main_sha seconds attempt changed before_rebase after_rebase intersect landing_note last_line changed_files changed_file generated_commit backlog_sha item line found safety_files t2_started t2_seconds
  local -a done_items=() generated_paths=("docs/api/" "frontend/src/dev/elements-adoption.json" "docs/dev/code-map.md")
  started="$(date +%s)"; output="$(mktemp "$data/.check.XXXXXX")"
  if ! python3 - "$request" >"$data/.request-values" <<'PY'
import json, sys
try:
    v=json.load(open(sys.argv[1]))
    assert all(isinstance(v.get(k), str) and v[k] for k in ('branch','sha','worktree','requested_at'))
    assert isinstance(v.get('session'), str)
    assert isinstance(v.get('done', []), list) and all(isinstance(x, str) for x in v.get('done', []))
    assert isinstance(v.get('note', ''), str) and '\n' not in v.get('note', '') and '\r' not in v.get('note', '')
    print(v['branch']); print(v['sha']); print(v.get('note', ''))
    for item in v.get('done', []): print(item)
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
  branch="$(sed -n '1p' "$data/.request-values")"; sha="$(sed -n '2p' "$data/.request-values")"; landing_note="$(sed -n '3p' "$data/.request-values")"
  current_branch="$branch"; entry_started="$started"
  while IFS= read -r item; do done_items+=("$item"); done < <(tail -n +4 "$data/.request-values"); rm -f "$data/.request-values"
  if [[ ! "$branch" == wt/* || ! "$sha" =~ ^[0-9a-fA-F]{40,64}$ ]]; then
    mkdir -p "$data/queue/bad"; mv "$request" "$data/queue/bad/$(basename "$request")"
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) malformed request $(basename "$request") moved to queue/bad; repair or remove it" >> "$data/lander.log"
    echo "lander.sh: malformed branch or sha moved to queue/bad; repair or remove it and inspect $data/lander.log" >&2
    rm -f "$output"; return 0
  fi
  phase "fetching origin"
  if ! GITNET_LABEL="fetch origin" gitnet -C "$checkout" fetch origin; then net_fail "$request" "$branch" "$sha" "fetch" "$started" "$output"; rm -f "$output"; return 0; fi
  if git -C "$checkout" merge-base --is-ancestor "$sha" origin/main; then
    main_sha="$(git -C "$checkout" rev-parse origin/main)"
    seconds=$(( $(date +%s) - started ))
    atomic_json_note "$branch" "$sha" landed "already on origin/main" "$main_sha" "$output" "$seconds" "$landing_note"
    log_line "$data/landings.jsonl" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$branch" "$sha" "$main_sha" landed "$seconds" "already on origin/main"
    rm -f "$request" "$output"
    echo "landed: $branch at $sha (already on main)"
    sweep_worktrees
    return 0
  fi
  origin_branch="$(git -C "$checkout" rev-parse --verify "origin/$branch" 2>/dev/null || true)"
  if [[ "$origin_branch" != "$sha" ]]; then bounce "$request" "$branch" "$sha" "branch not on origin at $sha; run land.sh again" "$started" "$output"; rm -f "$output"; return 0; fi
  prev_sha="$(git -C "$checkout" rev-parse HEAD 2>/dev/null || echo origin/main)"
  if ! git -C "$checkout" checkout --detach "$sha"; then bounce "$request" "$branch" "$sha" "could not check out $sha; inspect the warm checkout, then land.sh again" "$started" "$output"; rm -f "$output"; return 0; fi
  phase "rebasing"
  if ! git -C "$checkout" rebase origin/main; then
    conflict="$(git -C "$checkout" diff --name-only --diff-filter=U || true)"
    git -C "$checkout" rebase --abort || true
    reason="rebase conflict in: ${conflict:-unknown files}; rebase onto origin/main in your worktree, then land.sh again"
    bounce "$request" "$branch" "$sha" "$reason" "$started" "$output"; rm -f "$output"; return 0
  fi
  local rebased_sha package_changed
  rebased_sha="$(git -C "$checkout" rev-parse HEAD)"
  package_changed="$(git -C "$checkout" diff --name-only "$prev_sha" "$rebased_sha" 2>/dev/null | grep -E '^(backend|frontend)/(package\.json|bun\.lock)$' || true)"
  if [[ -n "$package_changed" && -z "${MAIPAI_LAND_SKIP_INSTALL:-}" ]]; then
    local d
    for d in backend frontend; do
      if printf '%s\n' "$package_changed" | grep -Eq "^$d/"; then
        # --force: a pinned commons package is a file: dependency, and a plain install keeps the old snapshot when only the pin path changed (docs/PINNING.md), which made the generated adoption file name the old kit and turned main red.
        phase "installing dependencies"
        bounded_step "${MAIPAI_LAND_INSTALL_SECONDS:-600}" "bun install $d" "$output" bash -c 'cd "$1" && bun install --frozen-lockfile --force' _ "$checkout/$d" || { bounce "$request" "$branch" "$sha" "bun install failed or timed out in $d; repair dependencies and run land.sh again" "$started" "$output"; rm -f "$output"; return 0; }
      fi
    done
  fi
  export MAIPAI_COMMONS_DIR="$(cd "$main/.." && pwd -P)/commons" MAIPAI_STANDARDS_DIR="$(cd "$main/.." && pwd -P)/.github"
  # gen:settings writes ../commons/spec/settings/keys.json (backend/scripts/gen-settings-registry.ts); include it only when that output lives inside this checkout.
  settings_file="${MAIPAI_COMMONS_DIR}/spec/settings/keys.json"
  case "$settings_file" in "$checkout"/*) generated_paths+=("${settings_file#"$checkout"/}");; esac
  if [[ -n "${MAIPAI_LAND_GENERATE_CMD:-}" ]]; then
    phase "generating files"
    if ! bounded_step "${MAIPAI_LAND_GENERATE_SECONDS:-600}" "generate files" "$output" bash -c 'cd "$1" && eval "$2"' _ "$checkout" "$MAIPAI_LAND_GENERATE_CMD"; then
      last_line="$(tail -n 1 "$output" 2>/dev/null || true)"
      bounce "$request" "$branch" "$sha" "generated files failed: ${last_line:-generator exited nonzero}" "$started" "$output"; rm -f "$output"; return 0
    fi
  else
    phase "generating files"
    if ! bounded_step "${MAIPAI_LAND_GENERATE_SECONDS:-600}" "generate files" "$output" bash -c 'cd "$1" && (cd backend && bun run gen:settings) && (cd backend && bun run gen:api-docs) && bun run scripts/elementsAdoption.ts && { [[ ! -f scripts/code-map.py ]] || python3 scripts/code-map.py; }' _ "$checkout"; then
      last_line="$(tail -n 1 "$output" 2>/dev/null || true)"
      bounce "$request" "$branch" "$sha" "generated files failed: ${last_line:-generator exited nonzero}" "$started" "$output"; rm -f "$output"; return 0
    fi
  fi
  changed_files="$(git -C "$checkout" status --porcelain --untracked-files=all -- "${generated_paths[@]}" | sed -E 's/^...//')"
  if [[ -n "$changed_files" ]]; then
    while IFS= read -r changed_file; do
      [[ -z "$changed_file" ]] || git -C "$checkout" add -- "$changed_file" || { bounce "$request" "$branch" "$sha" "generated files failed: could not stage generated files" "$started" "$output"; rm -f "$output"; return 0; }
    done <<EOF_CHANGED_FILES
$changed_files
EOF_CHANGED_FILES
    git -C "$checkout" -c user.name="MaiPai lander" -c user.email="lander@users.noreply.github.com" commit -m "Generated: $(printf '%s' "$changed_files" | paste -sd ', ' -) (lander, for $branch)" >>"$output" 2>&1 || { last_line="$(tail -n 1 "$output" 2>/dev/null || true)"; bounce "$request" "$branch" "$sha" "generated files failed: ${last_line:-could not commit generated files}" "$started" "$output"; rm -f "$output"; return 0; }
  fi
  if ((${#done_items[@]})); then
    backlog_sha="$(git -C "$checkout" rev-parse --short=7 HEAD)"
    item="$(python3 - "$checkout/docs/BACKLOG.md" "$backlog_sha" "$(date -u +%F)" "${done_items[@]}" <<'PY'
import sys
from pathlib import Path
path=Path(sys.argv[1]); sha=sys.argv[2]; date=sys.argv[3]; items=sys.argv[4:]
if not path.exists():
    print(items[0] if items else 'unknown'); sys.exit(1)
lines=path.read_text().splitlines()
for item in items:
    prefix=f'- [ ] **{item}:'
    matches=[i for i, line in enumerate(lines) if line.startswith(prefix)]
    if not matches:
        print(item); sys.exit(1)
    i=matches[0]
    lines[i]=lines[i].replace('- [ ]', '- [x]', 1) + f' Landed {date} ({sha}).'
path.write_text('\n'.join(lines) + '\n')
PY
)" || { item="${item:-${done_items[0]}}"; bounce "$request" "$branch" "$sha" "backlog item $item not found as an open item; check the id or drop --done" "$started" "$output"; rm -f "$output"; return 0; }
    git -C "$checkout" add -- docs/BACKLOG.md
    git -C "$checkout" -c user.name="MaiPai lander" -c user.email="lander@users.noreply.github.com" commit -m "Backlog: ${done_items[*]} done (landed by the lander)" >>"$output" 2>&1 || { last_line="$(tail -n 1 "$output" 2>/dev/null || true)"; bounce "$request" "$branch" "$sha" "backlog item update failed: ${last_line:-could not commit backlog}" "$started" "$output"; rm -f "$output"; return 0; }
  fi
  check_cmd="${MAIPAI_LAND_CHECK_CMD:-}"
  phase "static check"
  run_static_check "$output" || { bounce "$request" "$branch" "$sha" "$(static_check_reason "$output")" "$started" "$output"; rm -f "$output"; return 0; }

  changed_files="$(git -C "$checkout" diff --name-only origin/main...HEAD 2>/dev/null || true)"
  safety_files="$(safety_surface_files "$changed_files")"
  if [[ -n "$safety_files" ]]; then
    t2_started="$(date +%s)"
    phase "safety-surface tests"
    if ! run_t2_tests "$output"; then
      reason="safety-surface tests failed$(timeout_note "$output" | sed 's/^/ (/; s/$/)/'): $(printf '%s' "$safety_files" | paste -sd ', ' -)"
      bounce "$request" "$branch" "$sha" "$reason" "$started" "$output"; rm -f "$output"; return 0
    fi
    t2_seconds=$(( $(date +%s) - t2_started ))
    landing_note="${landing_note:+$landing_note; }tier: T2; safety-surface tests took ${t2_seconds}s"
  fi

  for attempt in 1 2 3; do
    phase "pushing to main"
    if GITNET_TRIES=2 GITNET_LABEL="push main" gitnet -C "$checkout" push origin HEAD:refs/heads/main; then
      main_sha="$(git -C "$checkout" rev-parse HEAD)"
      GITNET_TRIES=1 GITNET_TIMEOUT=45 GITNET_LABEL="delete remote branch" gitnet -C "$checkout" push origin --delete "$branch" >>"$data/lander.log" 2>&1 || echo "lander.sh: could not delete remote $branch; remove it when convenient." >&2
      seconds=$(( $(date +%s) - started ))
      atomic_json_note "$branch" "$sha" landed "landed" "$main_sha" "$output" "$seconds" "$landing_note"
      log_line "$data/landings.jsonl" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$branch" "$sha" "$main_sha" landed "$seconds" "landed"
      rm -f "$request" "$output"
      echo "landed: $branch at $sha"
      bounded_run "${MAIPAI_LAND_MAP_SECONDS:-120}" "worktree map" bash "$main/scripts/worktree-map.sh" build >>"$data/lander.log" 2>&1 || true
      update_main_checkout
      sweep_worktrees
      return 0
    fi
    if (( GITNET_TIMED_OUT )); then net_fail "$request" "$branch" "$sha" "push" "$started" "$output"; rm -f "$output"; return 0; fi
    if (( attempt == 3 )); then break; fi
    before_rebase="$(git -C "$checkout" rev-parse HEAD)"
    changed="$(git -C "$checkout" diff --name-only origin/main...HEAD || true)"
    GITNET_LABEL="fetch origin (retry)" gitnet -C "$checkout" fetch origin || break
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
      phase "static check (after rebase)"
      run_static_check "$output" || { bounce "$request" "$branch" "$sha" "$(static_check_reason "$output")" "$started" "$output"; rm -f "$output"; return 0; }
    fi
  done
  bounce "$request" "$branch" "$sha" "main moved three times during landing; run land.sh again" "$started" "$output"
  rm -f "$output"
}

run_once() {
  local request
  request="$(next_request)"
  if [[ -z "$request" ]]; then ring_waiters || true; return 0; fi
  local oldest_branch oldest_slug newer newer_branch newest
  oldest_branch="$(python3 - "$request" <<'PY'
import json,sys
try: print(json.load(open(sys.argv[1])).get('branch',''))
except Exception: pass
PY
)"
  oldest_slug="${oldest_branch//\//-}"
  newest="$request"
  while IFS= read -r newer; do
    [[ "$newer" == "$request" ]] && continue
    newer_branch="$(python3 - "$newer" <<'PY'
import json,sys
try: print(json.load(open(sys.argv[1])).get('branch',''))
except Exception: pass
PY
)"
    if [[ "$newer_branch" == "$oldest_branch" ]]; then
      newest="$newer"
    fi
  done < <(find "$data/queue" -maxdepth 1 -type f -name '*.json' -print | sort)
  if [[ "$newest" != "$request" ]]; then
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) superseded request $(basename "$request") by $(basename "$newest")" >> "$data/lander.log"
    request="$newest"
  fi
  for newer in "$data/queue"/*-"$oldest_slug".json; do
    [[ -f "$newer" && "$newer" != "$request" ]] || continue
    newer_branch="$(python3 - "$newer" <<'PY'
import json,sys
try: print(json.load(open(sys.argv[1])).get('branch',''))
except Exception: pass
PY
)"
    if [[ "$newer_branch" == "$oldest_branch" ]]; then rm -f "$newer" "$(defer_dir)/$(basename "$newer")".n "$(defer_dir)/$(basename "$newer")".until; fi
  done
  run_one "$request"
  rm -f "$data/current-entry"
  [[ -f "$request" ]] || rm -f "$(defer_dir)/$(basename "$request")".n "$(defer_dir)/$(basename "$request")".until
  ring_waiters || true
}

serve() {
  local pidfile="$data/lander.pid" poll="${MAIPAI_LAND_POLL_SECONDS:-2}" old
  local refresh_seconds="${MAIPAI_PIPELINE_REFRESH_SECONDS:-60}" last_refresh=0 now refresh_result running_hash snapshot_hash
  running_hash="$(git -C "$main" hash-object "$0" 2>/dev/null || true)"
  local lib_hash=""
  [[ -z "$gitnet_lib" ]] || lib_hash="$(git -C "$main" hash-object "$gitnet_lib" 2>/dev/null || true)"
  [[ "$refresh_seconds" =~ ^[0-9]+$ ]] || refresh_seconds=60
  (( refresh_seconds > 0 )) || refresh_seconds=1
  if [[ -f "$pidfile" ]]; then
    old="$(cat "$pidfile" 2>/dev/null || true)"
    if [[ "$old" =~ ^[0-9]+$ && "$old" != "$$" ]] && kill -0 "$old" 2>/dev/null && ps -p "$old" -o command= 2>/dev/null | grep -Eq 'lander\.sh'; then error "already running as pid $old; stop it with bash scripts/pipeline.sh stop."; return 1; fi
  fi
  echo "$$" > "$pidfile"
  local stop_requested=0 sleep_pid=""
  trap 'stop_requested=1; if [[ -n "$sleep_pid" ]]; then kill "$sleep_pid" 2>/dev/null || true; fi' TERM INT HUP
  trap 'rm -f "$data/lander.pid"' EXIT
  if ! checkout_warm; then rm -f "$pidfile"; trap - EXIT; return 1; fi
  set +e
  while :; do
    now="$(date +%s)"
    if (( now - last_refresh >= refresh_seconds )); then
      last_refresh="$now"
      refresh_result="$(refresh_snapshot lander.sh)"
      snapshot_hash="$(git -C "$main" hash-object "$bin/lander.sh" 2>/dev/null || true)"
      if [[ "$refresh_result" == changed || ( -n "$running_hash" && "$snapshot_hash" != "$running_hash" ) ]]; then
        echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) code refreshed from origin/main; restarting lander" >> "$data/lander.log"
        exec bash "$bin/lander.sh" "$@"
      fi
      REFRESH_SKIP_FETCH=1 refresh_snapshot gitnet.sh scripts/lib/gitnet.sh >/dev/null || true
      snapshot_hash="$(git -C "$main" hash-object "$bin/gitnet.sh" 2>/dev/null || true)"
      if [[ -n "$snapshot_hash" && "$snapshot_hash" != "$lib_hash" ]]; then
        echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) network helpers refreshed from origin/main; restarting lander" >> "$data/lander.log"
        exec bash "$bin/lander.sh" "$@"
      fi
    fi
    ring_waiters || true
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
  refresh) refresh_snapshot lander.sh || exit 1 ;;
  checkout) checkout_warm ;;
  run-once) checkout_warm && run_once ;;
  serve) serve "$@" ;;
  *) error "usage: bash scripts/lander.sh refresh | run-once | serve | checkout"; exit 2 ;;
esac
