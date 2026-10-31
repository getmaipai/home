#!/bin/bash
# ASSIST-BENCH-01 on the Mac Studio: the assistant-tools bench against the Stack on 127.0.0.1:8770.
# Search is the bench's own fixture. A fresh empty data dir under the temp root; results go to
# data-scratch/assist-bench/<model>/results.json. The engine is shared with the live hub: run it when the household
# is quiet and no gate or test run is going. About 120 rows x 3 repeats x 2 arms = 720 turns; with --regression it
# also runs the chat-ab-01 fresh, child and spoken rows twice more.
#
#   bash /Users/jessetorres/Developer/github.com/getmaipai/wt/<worktree>/backend/scripts/bench/assist-tools-studio.sh --regression
#
# Extra arguments pass to assist-tools-bench.ts (--reps N, --only id,id, --split heldout, --arms on,off, --regression).
set -u
REPO="$(cd "$(dirname "$0")/../../.." && pwd)"
echo "1. Checking the Stack answers on 127.0.0.1:8770."
curl -s -m5 -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8770/v1/models | grep -q 200 || { echo "STOP: the Stack is not answering on 8770. Start it, then run this again."; exit 1; }
D=$(mktemp -d -t assist-bench-data)
trap 'rm -rf "$D"' EXIT
cd "$REPO/backend" || exit 1
export MAIPAI_BENCH_SEARCH=fixture
export MAIPAI_LLAMA_SERVER_URL=http://127.0.0.1:8770 MAIPAI_EMBED_URL=http://127.0.0.1:8770
# The bench refuses to start beside any gate (check.sh, bun test, vite build) on this machine. Wait up to 15 minutes
# for them to end, naming what is running, then give up with a clear message.
wait_quiet() {
  local n=0
  while pgrep -f '[s]cripts/check.sh|[b]un test|[v]ite build' >/dev/null; do
    if [ $n -ge 90 ]; then echo "STOP: a gate has been running for 15 minutes. Tell Claude what this shows:"; ps -o pid,etime,command -p "$(pgrep -f '[s]cripts/check.sh|[b]un test|[v]ite build' | paste -sd, -)"; exit 1; fi
    [ $((n % 6)) -eq 0 ] && { echo "   waiting for a gate to end:"; ps -o pid,etime,command -p "$(pgrep -f '[s]cripts/check.sh|[b]un test|[v]ite build' | paste -sd, -)" | cut -c1-160; }
    sleep 10; n=$((n+1))
  done
}
: > /tmp/assist-tools-studio.out
wait_quiet
echo "2. Assistant-tools bench, widened schema on and off, same rows."
MAIPAI_DATA_DIR="$D/data" bun run scripts/bench/assist-tools-bench.ts "$@" 2>&1 | tee -a /tmp/assist-tools-studio.out | tail -60
echo
echo "Done. Tell Claude: ASSIST-BENCH-01 finished, and paste the report lines above (full log: /tmp/assist-tools-studio.out)."
