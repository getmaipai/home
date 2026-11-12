#!/usr/bin/env bash
# NIGHTLY-FIXER-01 (2026-11-12): after a FAILED nightly run, an unattended Claude run in its own worktree proposes a fix on a branch, the
# failing tests are re-run, and the outcome is written to the nightly report. OFF by default.
#   bash scripts/nightly-fixer.sh init     write the config file (enabled=0) if it does not exist
#   bash scripts/nightly-fixer.sh status   config, today's spend
#   bash scripts/nightly-fixer.sh run      what nightly.sh calls after a failed run (does nothing unless enabled=1)
# Config: data-scratch/nightly/fixer.conf (MAIPAI_FIXER_CONF moves it), KEY=VALUE lines:
#   enabled=0|1            default 0
#   max_run_usd=5          passed to claude as --max-budget-usd for one run
#   max_total_usd=40       the ledger (nightly/fixer-spend.jsonl) refuses a run once the spend so far plus max_run_usd would pass this
#   timeout_seconds=2400   wall clock for the claude run (the report is due by 08:30)
#   model=                 optional --model value
# Hard rules, enforced HERE after the model finished, not trusted to the prompt:
#   - the branch is never landed, shipped or pushed (this script runs no land.sh, ship.sh or git push; the proposal stays a local branch);
#   - a proposal that edits docs/design/RULES.md, any safety, auth or credential file (the T2 globs of scripts/wt.sh at the tested commit),
#     the check and gate scripts, or modifies/deletes an existing test is REJECTED and its branch deleted: tests are never weakened;
#     new test files are allowed (a regression test is welcome);
#   - the failing tests are re-run in the worktree; a proposal whose tests still fail is reported "did not fix" (branch kept to read).
set -euo pipefail
umask 077
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
common="$(git rev-parse --git-common-dir 2>/dev/null)" || { echo "nightly-fixer.sh: run this inside a Home checkout." >&2; exit 1; }
[[ "$common" = /* ]] || common="$(cd "$(dirname "$common")" && pwd -P)/$(basename "$common")"
main="$(cd "$(dirname "$common")" && pwd -P)"
data="${MAIPAI_NIGHTLY_DATA:-$main/data-scratch/nightly}"
conf="${MAIPAI_FIXER_CONF:-$data/fixer.conf}"
claude_bin="${MAIPAI_FIXER_CLAUDE:-claude}"
worktrees="${MAIPAI_FIXER_WORKTREES:-$main/.claude/worktrees}"
day="$(date +%F)"; dir="$data/$day"; mkdir -p "$data" "$dir"
[[ ! -f "$here/lib/gitnet.sh" ]] || { source "$here/lib/gitnet.sh"; }
declare -F bounded_run >/dev/null || bounded_run() { shift 2; "$@"; }
[[ ! -f "$here/lib/deps.sh" ]] || source "$here/lib/deps.sh"

cfg() { local v; v="$(sed -n "s/^$1=\\(.*\\)$/\\1/p" "$conf" 2>/dev/null | tail -n 1 | tr -d '[:space:]')"; echo "${v:-$2}"; }
say() { printf '%s\n' "$*" >>"$dir/fixer.md"; echo "fixer: $*"; }
spent_total() { python3 - "$data/fixer-spend.jsonl" <<'PY'
import json, sys
t = 0.0
try:
    for line in open(sys.argv[1]):
        try: t += float(json.loads(line).get('usd', 0))
        except Exception: pass
except OSError: pass
print('%.4f' % t)
PY
}

init() {
  [[ -f "$conf" ]] || printf 'enabled=0\nmax_run_usd=5\nmax_total_usd=40\ntimeout_seconds=2400\nmodel=\n' >"$conf"
  echo "$conf"
}

status() {
  echo "fixer config: $conf$([[ -f "$conf" ]] || echo ' (missing: the fixer is off)')"
  echo "enabled: $(cfg enabled 0); per run \$$(cfg max_run_usd 5); total cap \$$(cfg max_total_usd 40); spent so far \$$(spent_total)"
}

# Is this path one the fixer may not change? $1 = path, $2 = the T2 globs ("" when unknown).
protected_path() {
  python3 - "$1" "$2" <<'PY'
import fnmatch, re, sys
p, globs = sys.argv[1], sys.argv[2].split()
extra = ['docs/design/RULES.md', 'scripts/check.sh', 'scripts/gate/*', 'scripts/hooks/*', '.claude/*', 'scripts/nightly-fixer.sh', 'scripts/land.sh', 'scripts/lander.sh', 'scripts/ship.sh', 'scripts/rush-ship.sh']
if any(fnmatch.fnmatch(p, g) for g in globs + extra): print('protected'); sys.exit()
print('')
PY
}
is_test_path() { [[ "$1" =~ \.(test|spec)\.[a-z]+$ || "$1" =~ (^|/)(tests?|__tests__)/ ]]; }

run() {
  : >"$dir/fixer.md"
  if [[ "$(cfg enabled 0)" != 1 ]]; then say "off (enabled is not 1 in $conf); nothing was tried"; return 0; fi
  local run_usd total_usd timeout model sha failing files wt branch globs prompt out rc=0 spent cost
  run_usd="$(cfg max_run_usd 5)"; total_usd="$(cfg max_total_usd 40)"; timeout="$(cfg timeout_seconds 2400)"; model="$(cfg model "")"
  spent="$(spent_total)"
  if ! python3 -c 'import sys; s,r,t=map(float,sys.argv[1:4]); sys.exit(0 if s+r<=t else 1)' "$spent" "$run_usd" "$total_usd"; then
    say "budget: \$$spent spent so far plus \$$run_usd for this run passes the cap of \$$total_usd; nothing was tried (raise max_total_usd in $conf)"; return 0
  fi
  sha="$(python3 -c 'import json,sys; x=json.load(open(sys.argv[1])); print(x["sha"] if x.get("result")=="failed" else "")' "$data/latest.json" 2>/dev/null || true)"
  [[ -n "$sha" ]] || { say "the last nightly run did not fail; nothing to fix"; return 0; }
  # The failing test files, read from the suite log of the run (bun prints "(fail) <file> > <name>" and "<file>:" headers).
  failing="$(grep -hE '\(fail\)|\.test\.[a-z]+' "$data/$day/suite.log" 2>/dev/null | grep -oE '[A-Za-z0-9_./-]+\.test\.[a-z]+' | sort -u | head -20 | tr '\n' ' ' || true)"
  [[ -n "${failing// /}" ]] || { say "the failing run names no test file in its log; nothing was tried (read $data/$day/suite.log)"; return 0; }
  branch="wt/nightly-fix-$day"; wt="$worktrees/nightly-fix-$day"
  if [[ -e "$wt" ]] || git -C "$main" rev-parse --verify -q "refs/heads/$branch" >/dev/null; then say "a fix worktree or branch for $day already exists ($branch); nothing was tried again"; return 0; fi
  mkdir -p "$worktrees"
  git -C "$main" worktree add -q -b "$branch" "$wt" "$sha" || { say "could not create the worktree $wt"; return 1; }
  globs="$(git -C "$wt" show "$sha:scripts/wt.sh" 2>/dev/null | sed -n 's/^export WT_T2_GLOBS="\(.*\)"$/\1/p' | head -n 1)"
  prompt="You are the unattended nightly fixer for MaiPai Home. The full test suite failed on commit ${sha:0:12}. Failing test files: $failing
Fix the cause in the SOURCE code, in this worktree only, with the smallest change. Read AGENTS.md first. Hard rules: never edit docs/design/RULES.md, any safety, auth, credential or child-protection file, the check or gate scripts, or an existing test (a test is never weakened, skipped or deleted; you may add a new regression test). Never run git push, land.sh, ship.sh or anything that touches the live hub. Re-run the failing tests yourself (bun test <file>) before you stop, and commit your change on this branch. If the failure is a flaky test, an environment problem or needs one of the forbidden edits, change nothing and say why in your last message."
  local -a args=(-p "$prompt" --output-format json --max-budget-usd "$run_usd" --permission-mode acceptEdits --no-session-persistence
    --allowedTools "Read" "Edit" "Write" "Grep" "Glob" "Bash(bun test:*)" "Bash(git status:*)" "Bash(git diff:*)" "Bash(git add:*)" "Bash(git commit:*)" "Bash(git log:*)" "Bash(ls:*)" "Bash(cat:*)"
    --disallowedTools "Bash(git push:*)" "Bash(bash scripts/land.sh:*)" "Bash(bash scripts/ship.sh:*)" "Bash(bash scripts/rush-ship.sh:*)")
  [[ -z "$model" ]] || args+=(--model "$model")
  out="$dir/fixer-claude.json"
  (cd "$wt" && bounded_run "$timeout" "nightly fixer" "$claude_bin" "${args[@]}" >"$out" 2>"$dir/fixer-claude.err") || rc=$?
  cost="$(python3 -c 'import json,sys; print(float(json.load(open(sys.argv[1])).get("total_cost_usd", 0)))' "$out" 2>/dev/null || echo 0)"
  python3 - "$data/fixer-spend.jsonl" "$cost" "$day" "$sha" <<'PY'
import json, sys; open(sys.argv[1], 'a').write(json.dumps(dict(day=sys.argv[3], sha=sys.argv[4], usd=float(sys.argv[2]))) + '\n')
PY
  (( rc == 0 )) || say "the Claude run ended with exit $rc (124 is the time cap); judging what it left"
  # Anything it left uncommitted goes onto the branch by file name, so the guard below sees one diff.
  local f
  while IFS= read -r f; do [[ -n "$f" ]] && git -C "$wt" add -- "$f"; done < <(git -C "$wt" status --porcelain | sed -E 's/^.{3}//')
  git -C "$wt" diff --cached --quiet || git -C "$wt" -c user.name="nightly fixer" -c user.email="noreply@anthropic.com" commit -q -m "Nightly fixer proposal for ${sha:0:7}

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
  local changed bad="" status_of
  changed="$(git -C "$wt" diff --name-status "$sha" HEAD)"
  if [[ -z "$changed" ]]; then
    say "no change proposed (cost \$$cost). Branch removed. The model's last message is in $out"
    git -C "$main" worktree remove --force "$wt" >/dev/null 2>&1 || true; git -C "$main" branch -D "$branch" >/dev/null 2>&1 || true; return 0
  fi
  while IFS=$'\t' read -r status_of f rest; do
    [[ -n "$f" ]] || continue
    [[ -z "$(protected_path "$f" "$globs")" ]] || bad="${bad:+$bad, }$f (protected)"
    if is_test_path "$f" && [[ "$status_of" != A ]]; then bad="${bad:+$bad, }$f (existing test changed or deleted)"; fi
    [[ -z "${rest:-}" ]] || bad="${bad:+$bad, }$rest (renamed over)"
  done <<<"$changed"
  [[ -n "$globs" ]] || bad="${bad:+$bad, }(the protected-file list was not found at ${sha:0:7}; nothing can be judged)"
  if [[ -n "$bad" ]]; then
    say "REJECTED, branch deleted: the proposal touches $bad. Cost \$$cost. Nothing was kept; the first look is $out"
    git -C "$main" worktree remove --force "$wt" >/dev/null 2>&1 || true; git -C "$main" branch -D "$branch" >/dev/null 2>&1 || true; return 0
  fi
  # Re-run the failing tests in the worktree (the same tests, the changed source).
  local rerun_rc=0 cmd="${MAIPAI_FIXER_TEST_CMD:-}"
  if [[ -z "${MAIPAI_FIXER_SKIP_INSTALL:-}" ]] && declare -F deps_ensure >/dev/null; then
    for d in backend frontend; do [[ -d "$wt/$d" ]] && { deps_current "$wt/$d" || DEPS_INSTALL_SECONDS=900 deps_ensure "$wt/$d" >>"$dir/fixer-rerun.log" 2>&1 || true; }; done
  fi
  [[ -n "$cmd" ]] || cmd='bun test $FAILING_TESTS'
  (cd "$wt" && FAILING_TESTS="$failing" bounded_run 900 "nightly fixer re-run" bash -c "$cmd") >"$dir/fixer-rerun.log" 2>&1 || rerun_rc=$?
  local files_line; files_line="$(printf '%s\n' "$changed" | awk -F'\t' '{print $2}' | paste -sd ', ' -)"
  if (( rerun_rc == 0 )); then
    say "PROPOSED FIX on branch $branch ($(git -C "$wt" rev-parse --short HEAD)) in $wt: changes $files_line. The failing tests ($failing) pass again. Cost \$$cost. NOT landed, NOT shipped: read the diff (git -C $wt diff ${sha:0:7}..HEAD), then bash scripts/land.sh from that worktree."
  else
    say "DID NOT FIX: branch $branch ($(git -C "$wt" rev-parse --short HEAD)) changes $files_line but the failing tests still fail (log: $dir/fixer-rerun.log). Cost \$$cost. Not landed, not shipped."
  fi
}

case "${1:-status}" in
  init) init ;;
  status) status ;;
  run) run ;;
  *) echo "usage: bash scripts/nightly-fixer.sh init | status | run" >&2; exit 2 ;;
esac
