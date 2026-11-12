#!/usr/bin/env bash
# STABLE-01 (2026-11-12): move `stable` to the last version to pass the required checks. Not "known-good": it means the full suite passed on
# that exact commit, nothing more.
#   bash scripts/nightly-stable.sh run      one run now (the schedule is OFF by default; pipeline.sh nightly install-service writes it, unloaded)
#   bash scripts/nightly-stable.sh status   stable, the last result, the superseded commits it skipped
# A run picks ONE fixed commit at its start: the newest integrated commit (the pipeline's main). Landings go on during the run and are not
# included; the commits between the last tested one and this one are recorded as "untested (superseded)". It tests that commit in the
# watcher's warm checkout (../home-watcher), holding the watcher's checkout lock so the two never share the tree, under a wall clock.
# Only a full pass fast-forwards `stable` (local ref, then GitHub's `stable` branch, never forced; main is never touched). A failure or an
# "unfinished" run (the wall clock ran out) leaves `stable` where it was and writes the report. Off switch: data-scratch/nightly/OFF.
# Gated promotion later ships `stable`, or an explicit owner override that is recorded with its own status, never as a pass.
set -euo pipefail
umask 077
error() { echo "nightly-stable.sh: $1" >&2; }
common="$(git rev-parse --git-common-dir 2>/dev/null)" || { error "run this inside a Home checkout."; exit 1; }
[[ "$common" = /* ]] || common="$(cd "$(dirname "$common")" && pwd -P)/$(basename "$common")"
main="$(cd "$(dirname "$common")" && pwd -P)"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
data="${MAIPAI_NIGHTLY_DATA:-$main/data-scratch/nightly}"
watch="${MAIPAI_WATCH_DATA:-$main/data-scratch/watch}"
checkout="${MAIPAI_NIGHTLY_CHECKOUT:-${MAIPAI_WATCH_CHECKOUT:-$(cd "$main/.." && pwd -P)/home-watcher}}"
lock="$watch/checkout.lock.d"
mkdir -p "$data" "$watch"
if [[ -f "$here/lib/gitnet.sh" ]]; then source "$here/lib/gitnet.sh"; gitnet_env "$main"
else gitnet() { git "$@"; }; bounded_run() { shift 2; "$@"; }; pipeline_main_sha() { git -C "${1:-.}" rev-parse --verify -q 'origin/main^{commit}'; }; fi
[[ ! -f "$here/lib/deps.sh" ]] || source "$here/lib/deps.sh"

status() {
  local s; s="$(git -C "$main" rev-parse --verify -q refs/heads/stable 2>/dev/null || true)"
  echo "stable (last version to pass the required checks): ${s:-none yet}"
  [[ -f "$data/latest.md" ]] && cat "$data/latest.md" || echo "nightly: never run"
}

take_lock() {
  local waited=0 holder max="${MAIPAI_NIGHTLY_LOCK_WAIT:-1200}"
  until mkdir "$lock" 2>/dev/null; do
    holder="$(cat "$lock/pid" 2>/dev/null || true)"
    if [[ ! "$holder" =~ ^[0-9]+$ ]] || ! kill -0 "$holder" 2>/dev/null; then rm -rf "$lock"; continue; fi
    (( waited < max )) || { error "the watcher still holds $checkout after ${max}s; nothing was tested, stable is unchanged."; return 1; }
    sleep 5; waited=$(( waited + 5 ))
  done
  echo "$$" >"$lock/pid"; echo nightly >"$lock/who"
}

run() {
  [[ ! -f "$data/OFF" || -n "${MAIPAI_NIGHTLY_IGNORE_OFF:-}" ]] || { echo "nightly: off ($data/OFF exists); nothing ran"; return 0; }
  # HOST-GUARD-09: the host guard's memory probe gates the run. Exit 75 means "not started, nothing changed" (the caller defers and retries).
  if [[ -f "$here/lib/hostmem.sh" ]]; then source "$here/lib/hostmem.sh"; hostmem_gate "The nightly run" || return 75; fi
  local started sha before after result rc=0 day dir out seconds last superseded=()
  started="$(date +%s)"; day="$(date +%F)"; dir="$data/$day"; mkdir -p "$dir"; out="$dir/suite.log"
  GITNET_TRIES=1 GITNET_TIMEOUT=30 gitnet -C "$main" fetch -q origin main >/dev/null 2>&1 || true
  sha="$(pipeline_main_sha "$main")"; [[ -n "$sha" ]] || { error "no main to test."; return 1; }
  before="$(git -C "$main" rev-parse --verify -q refs/heads/stable 2>/dev/null || true)"
  # What this run passes over: every integrated commit after the last one a nightly tested (or stable), up to but not including $sha.
  last="$(cat "$data/last-tested" 2>/dev/null || echo "$before")"
  if [[ -n "$last" ]] && git -C "$main" merge-base --is-ancestor "$last" "$sha" 2>/dev/null; then
    while IFS= read -r c; do [[ -n "$c" && "$c" != "$sha" ]] && superseded+=("$c"); done < <(git -C "$main" rev-list "$last..$sha^" 2>/dev/null || true)
  fi
  take_lock || return 1
  trap 'rm -rf "$lock"' EXIT
  if [[ ! -e "$checkout/.git" ]]; then git -C "$main" worktree add --detach "$checkout" "$sha" >/dev/null 2>&1 || { error "no checkout at $checkout"; return 1; }; fi
  git -C "$checkout" checkout -q --detach "$sha" && [[ "$(git -C "$checkout" rev-parse HEAD)" == "$sha" ]] || { error "could not check out ${sha:0:7}; nothing was tested, stable is unchanged."; return 1; }
  if [[ -z "${MAIPAI_NIGHTLY_SKIP_INSTALL:-}" ]] && declare -F deps_ensure >/dev/null; then
    for d in backend frontend; do [[ -d "$checkout/$d" ]] || continue; deps_current "$checkout/$d" || DEPS_INSTALL_SECONDS=900 deps_ensure "$checkout/$d" >>"$out" 2>&1 || rc=1; done
  fi
  local suite="${MAIPAI_NIGHTLY_SUITE_CMD:-bun scripts/gate/shardTests.ts --dir scripts --root . --shards 4 && bun scripts/gate/shardTests.ts --dir backend --root tests --shards 6 && bun scripts/gate/shardTests.ts --dir frontend --root . --shards 8}"
  if (( rc == 0 )); then
    GITNET_OPS_DIR="$data" GITNET_STUCK_LOG="$data/stuck.log" bounded_run "${MAIPAI_NIGHTLY_SECONDS:-5400}" "nightly suite" bash -c 'cd "$1" && nice -n 15 bash -c "$2"' _ "$checkout" "$suite" >>"$out" 2>&1 || rc=$?
  fi
  case "$rc" in 0) result=passed ;; 124) result=unfinished ;; *) result=failed ;; esac
  after="$before"
  if [[ "$result" == passed ]]; then
    if [[ -z "$before" ]] || git -C "$main" merge-base --is-ancestor "$before" "$sha"; then
      git -C "$main" update-ref refs/heads/stable "$sha" "${before:-0000000000000000000000000000000000000000}" && after="$sha"
      [[ -n "${MAIPAI_NIGHTLY_NO_PUSH:-}" ]] || GITNET_TRIES=2 GITNET_LABEL="push stable" gitnet -C "$main" push origin "$sha:refs/heads/stable" >>"$out" 2>&1 || echo "stable moved here; the GitHub push of stable failed and is retried by the next run" >>"$out"
    else echo "stable ${before:0:7} is not an ancestor of ${sha:0:7}; not moved (never forced)" >>"$out"; fi
  fi
  printf '%s\n' "$sha" >"$data/last-tested"
  seconds=$(( $(date +%s) - started ))
  python3 - "$data" "$dir" "$sha" "$result" "$before" "$after" "$seconds" "$(date -u +%FT%TZ)" "${superseded[@]+"${superseded[@]}"}" <<'PY'
import json, os, sys
data, d, sha, result, before, after, seconds, finished = sys.argv[1:9]; skipped = sys.argv[9:]
words = {'passed': 'full suite passed', 'failed': 'full suite FAILED; stable stays', 'unfinished': 'UNFINISHED (time cap); stable stays, this is not a pass'}
rec = dict(sha=sha, result=result, stable_before=before or None, stable_after=after or None, seconds=int(seconds), finished_at=finished,
           untested_superseded=skipped)
for p in (os.path.join(data, 'runs.jsonl'),):
    with open(p, 'a') as f: f.write(json.dumps(rec) + '\n')
with open(os.path.join(data, 'untested.jsonl'), 'a') as f:
    for s in skipped: f.write(json.dumps(dict(sha=s, label='untested (superseded)', superseded_by=sha, at=finished)) + '\n')
json.dump(rec, open(os.path.join(data, 'latest.json'), 'w'))
lines = ['nightly %s: %s at %s in %ss' % (finished, words[result], sha[:7], seconds),
         'stable (last version to pass the required checks): %s' % ((after or 'none')[:7]),
         'untested (superseded): %d commits' % len(skipped), 'log: %s' % os.path.join(d, 'suite.log')]
open(os.path.join(d, 'report.md'), 'w').write('\n'.join(lines) + '\n')
open(os.path.join(data, 'latest.md'), 'w').write('\n'.join(lines) + '\n')
print('\n'.join(lines))
PY
  [[ "$result" == passed ]]
}

case "${1:-status}" in
  run) run ;;
  status) status ;;
  *) error "usage: bash scripts/nightly-stable.sh run | status"; exit 2 ;;
esac
