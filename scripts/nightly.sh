#!/usr/bin/env bash
# NIGHTLY-01 (2026-11-12): the nightly job. It wraps scripts/nightly-stable.sh (one fixed commit, the full suite in ../home-watcher under the
# watcher's checkout lock, `stable` moved only on a full pass) with what the owner asked for:
#   bash scripts/nightly.sh run-now          one run now, for testing (ignores the OFF switch; the schedule is a separate thing)
#   bash scripts/nightly.sh run              what the LaunchAgent calls at 04:00 (honours data-scratch/nightly/OFF)
#   bash scripts/nightly.sh status           stable, the last result, the schedule state
#   bash scripts/nightly.sh install-service [--load]   writes com.maipai.nightly.plist (04:00); NOT loaded unless --load (the owner's word)
#   bash scripts/nightly.sh uninstall-service
# The host guard probe (scripts/lib/hostmem.sh) gates the start: under memory pressure the run is deferred (exit 75 inside the suite wrapper),
# retried every MAIPAI_NIGHTLY_RETRY_SECONDS (600) for up to MAIPAI_NIGHTLY_DEFER_SECONDS (14400, so a 04:00 start still reports by 08:30);
# a night that never got to start is reported as "deferred", never as a pass. Every run, deferred or not, writes the report
# data-scratch/reports/nightly-<date>.md (MAIPAI_REPORTS_DIR moves it). A failed run then calls the fixer (scripts/nightly-fixer.sh, off by default).
# New work keeps landing the whole time: the run tests the one commit it picked at its start.
set -euo pipefail
umask 077
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
common="$(git rev-parse --git-common-dir 2>/dev/null)" || { echo "nightly.sh: run this inside a Home checkout." >&2; exit 1; }
[[ "$common" = /* ]] || common="$(cd "$(dirname "$common")" && pwd -P)/$(basename "$common")"
main="$(cd "$(dirname "$common")" && pwd -P)"
data="${MAIPAI_NIGHTLY_DATA:-$main/data-scratch/nightly}"
reports="${MAIPAI_REPORTS_DIR:-$main/data-scratch/reports}"
stable_sh="${MAIPAI_NIGHTLY_STABLE_SH:-$here/nightly-stable.sh}"
fixer_sh="${MAIPAI_NIGHTLY_FIXER_SH:-$here/nightly-fixer.sh}"
mkdir -p "$data" "$reports"

report() { # report <result> <rc> <log> : write data-scratch/reports/nightly-<date>.md from latest.json and the suite log
  python3 - "$data" "$reports" "$1" "$2" "$3" "$(date +%F)" "$(date -u +%FT%TZ)" <<'PY'
import json, os, re, sys
data, reports, result, rc, log, day, now = sys.argv[1:8]
rec = {}
try: rec = json.load(open(os.path.join(data, 'latest.json')))
except Exception: pass
if result == 'deferred': rec = {}
fails = []
suite = os.path.join(data, day, 'suite.log')
if result == 'failed' and os.path.exists(suite):
    for line in open(suite, errors='replace'):
        if re.search(r'\(fail\)|\bfailed\b.*\.test\.ts', line) and line.strip() not in fails: fails.append(line.strip())
words = {'passed': 'PASSED: the full suite passed, stable moved', 'failed': 'FAILED: stable did not move', 'notstarted': 'NOT STARTED: the run stopped before testing (lock or checkout problem, see the log), stable did not move', 'unfinished': 'UNFINISHED (time cap): not a pass, stable did not move',
         'deferred': 'DEFERRED: the host was under memory pressure all night, nothing was tested, stable did not move', 'off': 'OFF: the switch data-scratch/nightly/OFF is set, nothing ran'}
lines = ['# Nightly run %s' % day, '', 'Written %s.' % now, '', '- Result: %s' % words.get(result, result)]
if rec:
    lines += ['- Commit tested: %s' % rec.get('sha', '')[:12], '- stable before: %s' % (rec.get('stable_before') or 'none')[:12],
              '- stable after: %s' % (rec.get('stable_after') or 'none')[:12], '- Took: %s s' % rec.get('seconds'),
              '- Untested (superseded) commits passed over: %d' % len(rec.get('untested_superseded', []))]
lines += ['- Suite log: %s' % suite]
if fails: lines += ['', '## Failing tests', ''] + ['- `%s`' % f[:200] for f in fails[:40]]
fx = os.path.join(data, day, 'fixer.md')
if os.path.exists(fx): lines += ['', '## Fixer', ''] + open(fx).read().splitlines()
open(os.path.join(reports, 'nightly-%s.md' % day), 'w').write('\n'.join(lines) + '\n')
print('report: %s' % os.path.join(reports, 'nightly-%s.md' % day))
PY
}

run_job() { # run_job <ignore-off:0|1>
  local began rc=0 waited=0 retry="${MAIPAI_NIGHTLY_RETRY_SECONDS:-600}" cap="${MAIPAI_NIGHTLY_DEFER_SECONDS:-14400}" day; day="$(date +%F)"; mkdir -p "$data/$day"; began="$(date +%s)"
  if [[ "$1" != 1 && -f "$data/OFF" ]]; then echo "nightly: off ($data/OFF exists); nothing ran"; report off 0 ""; return 0; fi
  while :; do
    rc=0; MAIPAI_NIGHTLY_IGNORE_OFF=1 bash "$stable_sh" run || rc=$?
    (( rc == 75 )) || break
    (( waited < cap )) || { echo "nightly: deferred for ${waited}s by the host guard; nothing was tested."; report deferred 75 ""; return 75; }
    sleep "$retry"; waited=$(( waited + retry ))
  done
  # rc 0 is a pass. Otherwise the suite wrapper's own record (written by this run: newer than $began) says failed or unfinished; no fresh record
  # means it stopped before testing (lock, checkout), which is reported as "failed to start", and stable did not move either way.
  local result=passed
  if (( rc != 0 )); then
    result="$(python3 - "$data/latest.json" "$began" <<'PY'
import json, os, sys
try:
    if os.path.getmtime(sys.argv[1]) >= float(sys.argv[2]): print(json.load(open(sys.argv[1])).get('result', 'failed')); raise SystemExit
except OSError: pass
print('notstarted')
PY
)"
  fi
  if [[ "$result" == failed && -f "$fixer_sh" ]]; then bash "$fixer_sh" run >>"$data/$day/fixer.out" 2>&1 || echo "nightly: the fixer did not finish (see $data/$day/fixer.out)" >&2; fi
  report "$result" "$rc" ""
  return "$rc"
}

case "${1:-status}" in
  run-now) run_job 1 ;;
  run) run_job 0 ;;
  status) bash "$stable_sh" status
    if launchctl print "gui/$(id -u)/com.maipai.nightly" >/dev/null 2>&1; then echo "schedule: ON (04:00 every day)"; else echo "schedule: off (not loaded; nightly.sh install-service --load turns it on)"; fi ;;
  install-service) shift; bash "$here/pipeline.sh" nightly install-service "$@" ;;
  uninstall-service) launchctl bootout "gui/$(id -u)/com.maipai.nightly" 2>/dev/null || true; rm -f "${MAIPAI_LAUNCH_AGENTS_DIR:-$HOME/Library/LaunchAgents}/com.maipai.nightly.plist"; echo "nightly schedule removed" ;;
  *) echo "usage: bash scripts/nightly.sh run-now | run | status | install-service [--load] | uninstall-service" >&2; exit 2 ;;
esac
