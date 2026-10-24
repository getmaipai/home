#!/usr/bin/env bash
set -euo pipefail
umask 077

usage() { echo "usage: bash scripts/land.sh [--detach] [--timeout <seconds>] [--done <ITEM-ID>]... [--note <one line>] | wait" >&2; }
die() { echo "land.sh: $1" >&2; exit "${2:-1}"; }

mode=queue
timeout_seconds=900
done_items=()
done_arg=""
landing_note=""
while (($#)); do
  case "$1" in
    --detach) mode=detach; shift ;;
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
  local expected="$1" start now status
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
        [[ "$result" == landed ]] && return 0
        return 1
      fi
    fi
    now="$(date +%s)"
    if (( now - start >= timeout_seconds )); then
      echo "land.sh: timed out waiting; the note will appear at $note_md. Check the lander with: bash scripts/pipeline.sh status" >&2
      return 2
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
dirty="$(git status --porcelain --untracked-files=no)"
[[ -z "$dirty" ]] || die "tracked changes are uncommitted; commit by file name or discard, then run land.sh again."
git fetch origin || die "could not fetch origin; check network and git credentials, then run land.sh again."
ahead="$(git rev-list --count origin/main..HEAD)" || die "could not compare your branch with origin/main; fetch and repair the checkout, then retry."
(( ahead > 0 )) || die "branch has no commit over origin/main; make and commit a change, then run land.sh again."
git push --force-with-lease -u origin "HEAD:refs/heads/$branch" || die "could not push $branch to origin; resolve the push error, then run land.sh again."
sha="$(git rev-parse HEAD)"
requested_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
queue_file="$data/queue/$(date +%s)-$slug.json"
tmp="$(mktemp "$data/queue/.request.XXXXXX")"
if [[ -n "$done_arg" ]]; then echo "done: ${done_items[*]}"; fi
python3 - "$tmp" "$branch" "$sha" "$(git rev-parse --show-toplevel)" "${MAIPAI_WT_SESSION:-}" "$requested_at" "$landing_note" "$done_arg" <<'PY'
import json, sys
with open(sys.argv[1], 'w') as f:
    json.dump(dict(branch=sys.argv[2], sha=sys.argv[3], worktree=sys.argv[4], session=sys.argv[5], requested_at=sys.argv[6], note=sys.argv[7], done=sys.argv[8].split()), f)
    f.write('\n')
PY
mv -f "$tmp" "$queue_file"
position=1
for f in "$data"/queue/*.json; do [[ -e "$f" && "$f" < "$queue_file" ]] && ((position+=1)) || true; done
echo "queued: $branch at $sha, position $position"
if [[ "$mode" == detach ]]; then echo "next: bash scripts/land.sh wait"; exit 0; fi
wait_note "$sha"; exit $?
