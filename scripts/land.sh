#!/usr/bin/env bash
set -euo pipefail
umask 077

usage() { echo "usage: bash scripts/land.sh [--detach] [--queue-anyway] [--timeout <seconds>] [--done <ITEM-ID>]... [--note <one line>] | wait" >&2; }
die() { echo "land.sh: $1" >&2; exit "${2:-1}"; }

mode=queue
timeout_seconds=3600
done_items=()
done_arg=""
landing_note=""
queue_anyway=0
while (($#)); do
  case "$1" in
    --detach) mode=detach; shift ;;
    --queue-anyway) queue_anyway=1; shift ;;
    --timeout) (($# >= 2)) || { usage; exit 2; }; timeout_seconds="$2"; shift 2 ;;
    --done) (($# >= 2)) || { usage; exit 2; }; [[ "$2" =~ ^[A-Z0-9-]+-[0-9]+$ ]] || die "invalid backlog item id '$2'; expected ^[A-Z0-9-]+-[0-9]+$" 2; done_items+=("$2"); done_arg="${done_arg:+$done_arg }$2"; shift 2 ;;
    --note) (($# >= 2)) || { usage; exit 2; }; [[ "$2" != *$'\n'* && "$2" != *$'\r'* ]] || die "--note must be one line" 2; landing_note="$2"; shift 2 ;;
    wait) mode=wait; shift ;;
    *) usage; exit 2 ;;
  esac
done
[[ "$timeout_seconds" =~ ^[0-9]+$ ]] || { usage; exit 2; }

common="$(git rev-parse --git-common-dir 2>/dev/null)" || die "not inside a git checkout; run this from your worktree."
[[ "$common" = /* ]] || common="$(cd "$(dirname "$common")" && pwd -P)/$(basename "$common")"
main="$(cd "$(dirname "$common")" && pwd -P)"
data="${MAIPAI_LAND_DATA:-$main/data-scratch/land}"
mkdir -p "$data/queue" "$data/notes"
branch="$(git branch --show-current)"
[[ -n "$branch" ]] || die "HEAD is detached; switch to your wt/* branch and run land.sh again."
slug="${branch//\//-}"
note="$data/notes/$slug.json"
note_md="$data/notes/$slug.md"
git_env="${MAIPAI_LAND_GIT_ENV-$main/data-scratch/bin/https-git.env}"
if [[ -n "$git_env" && -f "$git_env" ]]; then source "$git_env"; fi

wait_note() {
  local expected="$1" start now status last_fetch=0 last_progress=0 position total f queue_file="" result
  queue_file="$(find "$data/queue" -maxdepth 1 -type f -name "*-$slug.json" -print | sort | tail -n 1)"
  start="$(date +%s)"
  while :; do
    if [[ -f "$note" ]]; then
      local result
      result="$(python3 - "$note" "$branch" "$expected" <<'PY'
import json, sys
try:
    n=json.load(open(sys.argv[1]))
    if n.get('branch') == sys.argv[2] and n.get('sha') == sys.argv[3]: print(n.get('status',''))
except Exception: pass
PY
)"
      if [[ -n "$result" ]]; then
        [[ -f "$note_md" ]] && cat "$note_md"
        if [[ "$result" == landed ]]; then return 0; fi
        # A stale bounce can overwrite a landed note (a second request for the same branch); the commit itself decides.
        if git fetch -q origin main && git merge-base --is-ancestor "$expected" origin/main; then
          echo "landed: ${expected:0:7} is on origin/main"
          return 0
        fi
        return 1
      fi
    fi
    now="$(date +%s)"
    if (( now - last_fetch >= 60 )); then
      last_fetch="$now"
      if git fetch -q origin main && git merge-base --is-ancestor "$expected" origin/main; then
        echo "landed: ${expected:0:7} is on origin/main"
        return 0
      fi
    fi
    if (( now - start >= timeout_seconds )); then
      echo "land.sh: timed out waiting; the note will appear at $note_md. Check the lander with: bash scripts/pipeline.sh status" >&2
      return 2
    fi
    position=1; total=0
    for f in "$data"/queue/*.json; do
      [[ -f "$f" ]] || continue
      ((total+=1))
      [[ "$f" < "$queue_file" ]] && ((position+=1)) || true
    done
    if (( now - last_progress >= 60 )); then
      echo "waiting: position $position of $total in the queue, $((now - start))s so far"
      last_progress="$now"
    fi
    sleep 1
  done
}

if [[ "$mode" == wait ]]; then
  [[ "$branch" == wt/* ]] || die "branch '$branch' is not wt/*; switch to your worktree branch and retry."
  sha="$(git rev-parse HEAD)"
  wait_note "$sha"; exit $?
fi

[[ "$branch" == wt/* ]] || die "branch '$branch' is not wt/*; switch to a wt/* branch and run land.sh again."
if (( ! queue_anyway )); then
  pidfile="$data/lander.pid"
  lander_pid="$(cat "$pidfile" 2>/dev/null || true)"
  if [[ ! "$lander_pid" =~ ^[0-9]+$ ]] || ! kill -0 "$lander_pid" 2>/dev/null || ! ps -p "$lander_pid" -o command= 2>/dev/null | grep -Eq 'lander\.sh'; then
    die "the lander is not running: start it with bash scripts/pipeline.sh start (or install-service)" 3
  fi
fi
dirty="$(git status --porcelain --untracked-files=no)"
[[ -z "$dirty" ]] || die "tracked changes are uncommitted; commit by file name or discard, then run land.sh again."
git fetch origin || die "could not fetch origin; check network and git credentials, then run land.sh again."
ahead="$(git rev-list --count origin/main..HEAD)" || die "could not compare your branch with origin/main; fetch and repair the checkout, then retry."
(( ahead > 0 )) || die "branch has no commit over origin/main; make and commit a change, then run land.sh again."
watch_data="${MAIPAI_WATCH_DATA:-$main/data-scratch/watch}"
if [[ -f "$watch_data/last-run" ]]; then
  watch_sha="$(cat "$watch_data/last-run" 2>/dev/null || true)"
  watch_record="$(python3 - "$watch_data/runs.jsonl" "$watch_sha" <<'PY'
import json, sys
path, sha = sys.argv[1:]
records=[]
try:
    with open(path) as f:
        for line in f:
            try: record=json.loads(line)
            except Exception: continue
            if record.get('sha') == sha: records.append(record)
except OSError: pass
if records:
    record=records[-1]
    print(record.get('result',''))
    print(' '.join(record.get('failing',[])))
    print(record.get('culprit') or '')
PY
)"
  if [[ -n "$watch_sha" && -n "$watch_record" ]]; then
    watch_result="$(printf '%s\n' "$watch_record" | sed -n '1p')"
    watch_files="$(printf '%s\n' "$watch_record" | sed -n '2p')"
    watch_culprit="$(printf '%s\n' "$watch_record" | sed -n '3p')"
    watch_culprit="${watch_culprit:-unknown}"
    case "$watch_result" in
      green) echo "main: green at ${watch_sha:0:7}" ;;
      flaky) echo "main: flaky at ${watch_sha:0:7}: ${watch_files:-unknown}" ;;
      red)
        echo "main: red at ${watch_sha:0:7}: ${watch_files:-unknown} (culprit ${watch_culprit:0:7})"
        changed_files="$(git diff --name-only origin/main...HEAD 2>/dev/null || true)"
        for failing_file in $watch_files; do
          failing_dir="${failing_file%/*}"
          for changed_file in $changed_files; do
            changed_dir="${changed_file%/*}"
            if [[ "$changed_file" == "$failing_file" || "$changed_dir" == "$failing_dir" ]]; then
              echo "warning: main is red in $failing_file; your branch changes $changed_file"
              break
            fi
          done
        done
        ;;
    esac
  fi
fi
git push --force-with-lease -u origin "HEAD:refs/heads/$branch" || die "could not push $branch to origin; resolve the push error, then run land.sh again."
sha="$(git rev-parse HEAD)"
requested_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
# Milliseconds, so two requests in one second never share a name (macOS date has no %N).
queue_file="$data/queue/$(python3 -c 'import time; print(int(time.time() * 1000))')-$slug.json"
tmp="$(mktemp "$data/queue/.request.XXXXXX")"
if [[ -n "$done_arg" ]]; then echo "done: ${done_items[*]}"; fi
python3 - "$tmp" "$branch" "$sha" "$(git rev-parse --show-toplevel)" "${MAIPAI_WT_SESSION:-}" "$requested_at" "$landing_note" "$done_arg" <<'PY'
import json, sys
with open(sys.argv[1], 'w') as f:
    json.dump(dict(branch=sys.argv[2], sha=sys.argv[3], worktree=sys.argv[4], session=sys.argv[5], requested_at=sys.argv[6], note=sys.argv[7], done=sys.argv[8].split()), f)
    f.write('\n')
PY
mv -f "$tmp" "$queue_file"
for f in "$data"/queue/*-"$slug".json; do
  [[ -f "$f" && "$f" != "$queue_file" ]] || continue
  rm -f "$f"
  echo "replaced earlier request for $branch"
done
position=1
for f in "$data"/queue/*.json; do [[ -e "$f" && "$f" < "$queue_file" ]] && ((position+=1)) || true; done
echo "queued: $branch at $sha, position $position"
if [[ "$mode" == detach ]]; then echo "next: bash scripts/land.sh wait"; exit 0; fi
wait_note "$sha"; exit $?
