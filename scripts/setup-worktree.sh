#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
cd "$REPO_ROOT"
GIT_COMMON_DIR="$(git rev-parse --git-common-dir)"
case "$GIT_COMMON_DIR" in
  /*) ;;
  *) GIT_COMMON_DIR="$(cd "$GIT_COMMON_DIR" && pwd -P)" ;;
esac
HOME_ROOT="$(dirname "$GIT_COMMON_DIR")"
START_SECONDS="$(python3 -c 'import time; print(time.time())')"
set +e
bun install --frozen-lockfile
INSTALL_EXIT=$?
set -e
END_SECONDS="$(python3 -c 'import time; print(time.time())')"
INSTALL_STARTED_AT="$(python3 -c 'import sys,datetime; print(datetime.datetime.fromtimestamp(float(sys.argv[1]),datetime.timezone.utc).isoformat().replace("+00:00","Z"))' "$START_SECONDS")"
INSTALL_SECONDS="$(python3 -c 'import sys; print(round(float(sys.argv[2])-float(sys.argv[1]),3))' "$START_SECONDS" "$END_SECONDS")"
mkdir -p "$HOME_ROOT/data-scratch/gate-stats"
GATE_INSTALL_STATS="$HOME_ROOT/data-scratch/gate-stats/install-runs.jsonl" \
GATE_INSTALL_STARTED_AT="$INSTALL_STARTED_AT" GATE_INSTALL_SECONDS="$INSTALL_SECONDS" \
GATE_INSTALL_EXIT="$INSTALL_EXIT" GATE_INSTALL_WORKTREE="$REPO_ROOT" \
  python3 -c 'import json,os; row={"started_at":os.environ["GATE_INSTALL_STARTED_AT"],"worktree":os.environ["GATE_INSTALL_WORKTREE"],"command":"bun install --frozen-lockfile","seconds":float(os.environ["GATE_INSTALL_SECONDS"]),"exit":int(os.environ["GATE_INSTALL_EXIT"])}; f=open(os.environ["GATE_INSTALL_STATS"],"a"); f.write(json.dumps(row,separators=(",",":"))+"\n"); f.close()'
echo "worktree install: ${INSTALL_SECONDS}s (recorded in $HOME_ROOT/data-scratch/gate-stats/install-runs.jsonl)"
exit "$INSTALL_EXIT"
