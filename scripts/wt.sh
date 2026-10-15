#!/usr/bin/env bash
# One-worktree-per-session workflow. See workflow-redesign/DESIGN.md 3.1, 3.2, 3.5.
set -euo pipefail

WT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || { echo "wt: not inside a Git worktree; run this command from a repository checkout." >&2; exit 2; }
WT_COMMON="$(git rev-parse --git-common-dir)"
case "$WT_COMMON" in /*) ;; *) WT_COMMON="$(cd "$WT_COMMON" && pwd)" ;; esac
WT_MAIN="$(cd "$WT_COMMON/.." && pwd)"
WT_REPO="$(basename "$WT_MAIN")"
WT_PARENT="$(dirname "$WT_MAIN")"
WT_DATA="${MAIPAI_WT_DATA:-$WT_MAIN/data-scratch}"
WT_SESSION_DIR="$WT_DATA/sessions"
WT_PORT_DIR="$WT_DATA/ports"
WT_STAMP_DIR="$WT_DATA/gate-stamps"
WT_ADJECTIVES=(amber brisk calm clever eager fair gentle happy keen lucky mild nimble quiet swift)
WT_ANIMALS=(badger falcon heron otter panda robin tiger yak)

err() { echo "wt: $1" >&2; exit "${2:-1}"; }
need_cmd() { command -v "$1" >/dev/null 2>&1 || err "$1 is required; install it and retry."; }
valid_name() { [[ "$1" =~ ^[a-zA-Z0-9][a-zA-Z0-9-]*$ ]]; }
rand_index() { od -An -N4 -tu4 /dev/urandom | awk -v n="$1" 'NR == 1 {print $1 % n; exit}'; }
make_name() { echo "${WT_ADJECTIVES[$(rand_index "${#WT_ADJECTIVES[@]}")]}-${WT_ANIMALS[$(rand_index "${#WT_ANIMALS[@]}")]}-$1"; }

session_file() { printf '%s/%s.json' "$WT_SESSION_DIR" "$1"; }
read_json() { node -e 'const fs=require("fs");let j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(String(j[process.argv[2]]??""))' "$1" "$2"; }
write_session() {
  local name="$1" branch="$2" path="$3" tmux="${4:-}"
  mkdir -p "$WT_SESSION_DIR"
  node - "$name" "$branch" "$path" "$tmux" "${MAIPAI_WT_PID:-$PPID}" <<'NODE' > "$(session_file "$name")"
const [name, branch, path, tmux, pid] = process.argv.slice(2);
const owner = process.env.CLAUDE_SESSION_ID || process.env.CODEX_SESSION_ID || "codex";
console.log(JSON.stringify({owner, pid: Number(pid), tmux: tmux || null, created: new Date().toISOString(), branch, path}, null, 2));
NODE
}
tmux_cmd() { if [[ -n "${MAIPAI_WT_TMUX_SOCKET:-}" ]]; then tmux -L "$MAIPAI_WT_TMUX_SOCKET" "$@"; else tmux "$@"; fi; }
current_session_name() {
  local branch name
  branch="$(git -C "$WT_ROOT" branch --show-current)"
  if [[ "$branch" == wt/* ]]; then echo "${branch#wt/}"
  else name="$(basename "$WT_ROOT")"; name="${name#"$WT_REPO"-}"; echo "$name"; fi
}

cmd_start() {
  [[ $# == 1 ]] || err "start needs one slug; use: wt.sh start <slug>." 2
  local slug="$1"; valid_name "$slug" || err "slug '$slug' has unsupported characters; use letters, digits, and hyphens."
  cmd_reap
  need_cmd git
  git -C "$WT_ROOT" fetch origin || err "could not fetch origin; check network access and retry."
  local name branch path
  name="$(make_name "$slug")"; branch="wt/${name%-$slug}-$slug"; path="$WT_PARENT/wt/$WT_REPO-$name"
  [[ ! -e "$path" ]] || err "worktree path already exists: $path; choose another slug or clean up that worktree."
  ! git -C "$WT_MAIN" show-ref --verify --quiet "refs/heads/$branch" || err "branch already exists: $branch; choose another slug or remove the stale branch."
  mkdir -p "$(dirname "$path")"
  git -C "$WT_MAIN" worktree add -b "$branch" "$path" origin/main >&2 || err "could not create worktree from origin/main; inspect Git output and retry."
  # Pinned file dependencies are relative to the repository's parent. The
  # workflow keeps worktrees one level deeper, so expose the existing pin
  # cache at that level without changing shared pin state.
  if [[ -d "$WT_PARENT/commons-tags" && ! -e "$WT_PARENT/wt/commons-tags" ]]; then
    ln -s "$WT_PARENT/commons-tags" "$WT_PARENT/wt/commons-tags"
  fi
  if [[ -d "$WT_PARENT/commons" && ! -e "$WT_PARENT/wt/commons" ]]; then
    ln -s "$WT_PARENT/commons" "$WT_PARENT/wt/commons"
  fi
  if [[ -d "$WT_PARENT/.github" && ! -e "$WT_PARENT/wt/.github" ]]; then
    ln -s "$WT_PARENT/.github" "$WT_PARENT/wt/.github"
  fi
  local d
  for d in backend frontend; do
    if [[ -d "$path/$d" ]]; then
      if ! (cd "$path/$d" && bun install --frozen-lockfile); then
        git -C "$WT_MAIN" worktree remove --force "$path" >/dev/null 2>&1 || true
        git -C "$WT_MAIN" branch -D "$branch" >/dev/null 2>&1 || true
        err "bun install failed in $d; fix the install error, then rerun wt.sh start $slug."
      fi
    fi
  done
  write_session "$name" "$branch" "$path"
  printf '%s\n' "$path"
}

cmd_tmux() {
  [[ $# == 1 ]] || err "tmux needs one purpose name; use: wt.sh tmux <purpose>." 2
  local purpose="$1" name f branch path actual worktree_name candidate candidate_pid matches=()
  valid_name "$purpose" || err "purpose '$purpose' has unsupported characters; use letters, digits, and hyphens."
  name="${MAIPAI_WT_SESSION:-$(current_session_name)}"; f="$(session_file "$name")"
  if [[ ! -f "$f" ]]; then
    for candidate in "$WT_SESSION_DIR"/*.json; do
      [[ -f "$candidate" ]] || continue
      candidate_pid="$(read_json "$candidate" pid)"
      [[ "$candidate_pid" == "${MAIPAI_WT_PID:-$PPID}" ]] && matches+=("$candidate")
    done
    if (( ${#matches[@]} == 1 )); then f="${matches[0]}"; name="$(basename "$f" .json)"; fi
  fi
  [[ -f "$f" ]] || err "no session file for this worktree; run wt.sh start <slug> and enter its worktree first."
  need_cmd tmux
  branch="$(read_json "$f" branch)"; path="$(read_json "$f" path)"
  worktree_name="$(basename "$path")"; worktree_name="${worktree_name#"$WT_REPO"-}"
  actual="$WT_REPO-$worktree_name-$purpose"
  if tmux_cmd has-session -t "$actual" >/dev/null 2>&1; then err "tmux session '$actual' already exists; use its existing session or choose another purpose name."; fi
  tmux_cmd new-session -d -s "$actual" -c "$path" || err "could not create tmux session '$actual'; check tmux and retry."
  write_session "$name" "$branch" "$path" "$actual"
  printf '%s\n' "$actual"
}

cmd_port() {
  mkdir -p "$WT_PORT_DIR"
  local p file
  for p in $(seq 8800 8899); do
    file="$WT_PORT_DIR/$p.lease"
    if [[ -e "$file" ]]; then
      local oldpid; oldpid="$(awk 'NR==1 {print $1}' "$file" 2>/dev/null || true)"
      if [[ -n "$oldpid" ]] && kill -0 "$oldpid" 2>/dev/null; then continue; fi
      rm -f "$file"
    fi
    if ! (echo >/dev/tcp/127.0.0.1/$p) >/dev/null 2>&1; then
      if (set -o noclobber; printf '%s %s\n' "${MAIPAI_WT_PID:-$PPID}" "${MAIPAI_WT_SESSION:-$(current_session_name)}" > "$file") 2>/dev/null; then
        printf '%s\n' "$p"; return 0
      fi
    fi
  done
  err "no free port in 8800-8899; stop an unused server or release a stale lease."
}

changed_files() {
  local base="$1"
  git -C "$WT_ROOT" diff --name-only "$base"...HEAD
  git -C "$WT_ROOT" diff --name-only
  git -C "$WT_ROOT" ls-files --others --exclude-standard
}

classify_tier() {
  local files=() f t2=0 all_docs=1
  if (( $# )); then files=("$@")
  else
    local base
    base="$(git -C "$WT_ROOT" merge-base HEAD origin/main 2>/dev/null)" || err "cannot find merge-base with origin/main; fetch origin/main and retry."
    while IFS= read -r f; do [[ -n "$f" ]] && files+=("$f"); done < <({ git -C "$WT_ROOT" diff --cached --name-only; changed_files "$base"; } | sort -u)
  fi
  for f in "${files[@]}"; do
    case "$f" in *.md|docs/*|screenshots/*|*.png|*.jpg|*.jpeg|*.webp|*.avif|*.gif) :;; *) all_docs=0;; esac
    case "$f" in docs/design/RULES.md|docs/plans/*|backend/src/auth/*|backend/src/credentials*|backend/src/consent*|backend/src/people/*child*|backend/src/people/*teen*|backend/src/db/migrations/*|scripts/check.sh|package.json|bun.lock|backend/package.json|frontend/package.json|backend/src/wire.ts|backend/src/turn*|backend/src/llm/*|backend/src/composer/*|backend/src/websearch/*|backend/src/shell/*|backend/src/settings/*|frontend/src/*chat*|spec/*) t2=1;; esac
  done
  if (( t2 )); then echo T2; elif (( all_docs )) && (( ${#files[@]} )); then echo T0; else echo T1; fi
}

cmd_tier() { printf '%s\n' "$(classify_tier "$@")"; }

cmd_check() {
  local requested="${1:-}" base name tier auto_tier rc=0 sha
  [[ $# -le 1 ]] || err "check accepts at most one tier; use: wt.sh check [T0|T1|T2]." 2
  base="$(git -C "$WT_ROOT" merge-base HEAD origin/main 2>/dev/null)" || err "cannot find merge-base with origin/main; fetch origin/main and retry."
  name="${MAIPAI_WT_SESSION:-$(current_session_name)}"; [[ -n "$name" ]] || name="$(git -C "$WT_ROOT" branch --show-current | sed 's#^wt/##')"
  local files=() f
  while IFS= read -r f; do [[ -n "$f" ]] && files+=("$f"); done < <(changed_files "$base" | sort -u)
  auto_tier="$(classify_tier "${files[@]}")"
  tier="$auto_tier"
  if [[ -n "$requested" ]]; then
    requested="$(printf '%s' "$requested" | tr '[:lower:]' '[:upper:]')"
    [[ "$requested" =~ ^T[012]$ ]] || err "unknown tier '$requested'; use T0, T1, or T2."
    local auto_rank=1 requested_rank=1
    [[ "$auto_tier" == T0 ]] && auto_rank=0
    [[ "$auto_tier" == T2 ]] && auto_rank=2
    [[ "$requested" == T0 ]] && requested_rank=0
    [[ "$requested" == T2 ]] && requested_rank=2
    if (( requested_rank > auto_rank )); then tier="$requested"
    elif (( requested_rank < auto_rank )); then echo "wt: requested $requested is below diff-required $auto_tier; running $auto_tier."
    fi
  fi
  local script="$WT_ROOT/scripts/check.sh"
  local check_env=("MAIPAI_COMMONS_DIR=$WT_PARENT/commons" "MAIPAI_STANDARDS_DIR=$WT_PARENT/.github")
  if [[ "$tier" == T0 ]]; then env "${check_env[@]}" bash "$script" --docs || rc=$?
  elif [[ "$tier" == T1 ]]; then
    env "${check_env[@]}" bash "$script" --pre || rc=$?
    if (( rc == 0 )); then
      local tests=() dir testfile base_name
      for f in "${files[@]}"; do
        dir="$(dirname "$f")"
        base_name="$(basename "$f")"; base_name="${base_name%.*}"
        for testfile in "$dir"/*.test.ts "$dir"/*.test.tsx; do [[ -f "$testfile" ]] && tests+=("$testfile"); done
        while IFS= read -r testfile; do [[ -n "$testfile" ]] && tests+=("$testfile"); done < <(cd "$WT_ROOT" && rg -l -F -- "$base_name" backend frontend scripts --glob '*.test.ts' --glob '*.test.tsx' 2>/dev/null || true)
      done
      if (( ${#tests[@]} )); then (cd "$WT_ROOT" && bun test "${tests[@]}") || rc=$?; fi
    fi
  else env "${check_env[@]}" bash "$script" || rc=$?; fi
  sha="$(git -C "$WT_ROOT" rev-parse HEAD)"
  mkdir -p "$WT_STAMP_DIR"
  node - "$tier" "$sha" "$rc" "$WT_ROOT" "${files[@]}" <<'NODE' > "$WT_STAMP_DIR/$name.json"
const cp=require("child_process");
const [tier, head, code, root, ...files] = process.argv.slice(2);
const manifest=Object.fromEntries(files.map(p=>{try{return [p,cp.execFileSync("git",["-C",root,"hash-object","--",p],{encoding:"utf8"}).trim()]}catch{return [p,"0000000000000000000000000000000000000000"]}}));
console.log(JSON.stringify({tier, head, exitCode:Number(code), created:new Date().toISOString(), manifest}, null, 2));
NODE
  return "$rc"
}

cmd_done() {
  [[ $# == 0 ]] || err "done takes no arguments; use the current worktree's session file." 2
  local branch path name f tmuxname
  name="${MAIPAI_WT_SESSION:-$(current_session_name)}"; f="$(session_file "$name")"
  if [[ ! -f "$f" ]]; then
    local candidate candidate_pid matches=()
    for candidate in "$WT_SESSION_DIR"/*.json; do
      [[ -f "$candidate" ]] || continue
      candidate_pid="$(read_json "$candidate" pid)"
      [[ "$candidate_pid" == "${MAIPAI_WT_PID:-$PPID}" ]] && matches+=("$candidate")
    done
    if (( ${#matches[@]} == 1 )); then f="${matches[0]}"; name="$(basename "$f" .json)"; fi
  fi
  if [[ -f "$f" ]]; then
    branch="$(read_json "$f" branch)"; path="$(read_json "$f" path)"; tmuxname="$(read_json "$f" tmux)"
  else branch="$(git -C "$WT_ROOT" branch --show-current)"; path="$WT_ROOT"; tmuxname=""; fi
  if [[ -n "$tmuxname" ]] && command -v tmux >/dev/null 2>&1; then tmux_cmd kill-session -t "$tmuxname" >/dev/null 2>&1 || true; fi
  if [[ "$path" != "$WT_MAIN" ]] && git -C "$WT_MAIN" worktree list --porcelain | grep -Fqx "worktree $path"; then git -C "$WT_MAIN" worktree remove --force "$path" || err "could not remove worktree '$path'; resolve its Git state and retry wt.sh done."; fi
  if [[ "$branch" == wt/* ]] && git -C "$WT_MAIN" show-ref --verify --quiet "refs/heads/$branch"; then git -C "$WT_MAIN" branch -D "$branch" >/dev/null || err "could not delete branch '$branch'; remove it manually after checking its work is landed."; fi
  rm -f "$f"
  find "$WT_PORT_DIR" -type f -name '*.lease' -exec grep -lF "$name" {} \; -delete 2>/dev/null || true
}

cmd_reap() {
  mkdir -p "$WT_SESSION_DIR" "$WT_PORT_DIR"
  local f name pid tmuxname path branch alive dirty created age
  shopt -s nullglob
  for f in "$WT_SESSION_DIR"/*.json; do
    name="$(basename "$f" .json)"; pid="$(read_json "$f" pid)"; tmuxname="$(read_json "$f" tmux)"; path="$(read_json "$f" path)"; branch="$(read_json "$f" branch)"
    alive=0; [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null && alive=1
    if [[ -n "$tmuxname" ]] && command -v tmux >/dev/null 2>&1 && tmux_cmd has-session -t "$tmuxname" >/dev/null 2>&1; then alive=1; fi
    (( alive )) && continue
    # A session's pid is the caller's shell, which can exit while the session lives on,
    # so only sessions older than the grace period (default 4 h) are ever reaped.
    created="$(read_json "$f" created)"
    age=$(( $(date +%s) - $(date -u -j -f '%Y-%m-%dT%H:%M:%S' "${created%.*}" +%s 2>/dev/null || date -u -d "$created" +%s 2>/dev/null || echo 0) ))
    (( age >= ${MAIPAI_WT_REAP_AGE:-14400} )) || continue
    if [[ ! -e "$path/.git" ]]; then rm -f "$f"; continue; fi
    dirty="$(git -C "$path" status --porcelain)"
    if [[ -z "$dirty" ]] && git -C "$WT_MAIN" merge-base --is-ancestor "$branch" origin/main 2>/dev/null; then
      git -C "$WT_MAIN" worktree remove "$path" && git -C "$WT_MAIN" branch -D "$branch" >/dev/null 2>&1 || true
      rm -f "$f"
    else
      git -C "$path" add -A
      if ! git -C "$path" diff --cached --quiet; then git -C "$path" -c user.name='MaiPai Reaper' -c user.email='reaper@localhost' commit -m "WIP: recover $name" >/dev/null || true; fi
      git -C "$path" branch -f "wip/$name" HEAD >/dev/null 2>&1 || true
      mkdir -p "$WT_DATA"
      printf '%s | %s | %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$name" "$path" >> "$WT_DATA/reaped.md"
      # Leave dirty/recovered worktree and session record for explicit recovery.
    fi
  done
  for f in "$WT_PORT_DIR"/*.lease; do
    pid="$(awk 'NR==1 {print $1}' "$f" 2>/dev/null || true)"
    [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null || rm -f "$f"
  done
}

cmd_land() {
  [[ $# == 0 ]] || err "land takes no arguments; run it from the active worktree." 2
  need_cmd git
  git -C "$WT_ROOT" fetch origin || err "could not fetch origin; check network access and retry landing."
  local before after attempt changed_pin changed_pkg name
  before="$(git -C "$WT_ROOT" rev-parse HEAD)"
  for attempt in 1 2 3; do
    git -C "$WT_ROOT" rebase origin/main || { git -C "$WT_ROOT" rebase --abort >/dev/null 2>&1 || true; err "rebase onto origin/main failed; resolve the conflict and rerun wt.sh land."; }
    after="$(git -C "$WT_ROOT" rev-parse HEAD)"
    if [[ "$after" != "$before" ]]; then cmd_check || err "checks failed after rebase; fix the failures before landing."; fi
    changed_pkg="$(git -C "$WT_ROOT" diff --name-only origin/main...HEAD | grep -E '(^|/)(package\.json|bun\.lock)$' || true)"
    changed_pin="$(git -C "$WT_ROOT" diff origin/main...HEAD -- scripts/check.sh backend/package.json frontend/package.json | grep -E '^[+-].*(core-v|ui-v|spec-v|std-v)' || true)"
    if git -C "$WT_ROOT" push origin HEAD:main; then
      if [[ -n "$changed_pkg" ]]; then bun install --force || err "bun install --force failed after landing package metadata or a lockfile change; fix installation before restarting."; fi
      [[ -z "$changed_pin" ]] || echo "Reminder: a pin changed; run bun restart in the main checkout to make it live."
      cmd_done
      return 0
    fi
    if (( attempt < 3 )); then git -C "$WT_ROOT" fetch origin || err "push was rejected and fetch failed; retry wt.sh land after network access returns."; before="$(git -C "$WT_ROOT" rev-parse HEAD)"; fi
  done
  err "push to origin/main was rejected three times; inspect origin/main and rerun wt.sh land."
}

case "${1:-}" in
  start) shift; cmd_start "$@";;
  tmux) shift; cmd_tmux "$@";;
  port) shift; [[ $# == 0 ]] || err "port takes no arguments; use: wt.sh port." 2; cmd_port;;
  check) shift; cmd_check "$@";;
  tier) shift; cmd_tier "$@";;
  land) shift; cmd_land "$@";;
  done) shift; cmd_done "$@";;
  reap) shift; [[ $# == 0 ]] || err "reap takes no arguments; use: wt.sh reap." 2; cmd_reap;;
  *) err "unknown or missing command '${1:-}'; use start, tmux, port, check, land, done, or reap." 2;;
esac
