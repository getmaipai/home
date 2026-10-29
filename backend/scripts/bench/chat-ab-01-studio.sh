#!/bin/bash
# Runs the CHAT-AB-01 pieces rule 13 asks for against the Stack on 127.0.0.1:8770, on the Mac Studio:
# the two 9-turn memory scripts (adult arms A, A2, B) and the spoken row's first-word timing (arm S).
# Search is the bench's own fixture, so no real SearXNG is touched. A fresh empty data dir; results go to
# a temp folder (and /tmp/chat-ab-01-studio.out), so no repo file or live data changes. The engine is shared
# with the live hub: run it when the household is quiet and no gate or test run is going.
set -u
REPO="$(cd "$(dirname "$0")/../../.." && pwd)"
echo "1. Checking the Stack answers on 127.0.0.1:8770."
curl -s -m5 -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8770/v1/models | grep -q 200 || { echo "STOP: the Stack is not answering on 8770. Start it, then run this again."; exit 1; }
O=$(mktemp -d -t chat-ab-out)
D1=$(mktemp -d -t chat-ab-data)
D2=$(mktemp -d -t chat-ab-data)
trap 'rm -rf "$D1" "$D2"' EXIT
cd "$REPO/backend" || exit 1
export MAIPAI_BENCH_SEARCH=fixture
export MAIPAI_LLAMA_SERVER_URL=http://127.0.0.1:8770 MAIPAI_EMBED_URL=http://127.0.0.1:8770
: > /tmp/chat-ab-01-studio.out
echo "2. Memory scripts (mt1-party, mt2-move), arms A, A2, B. About 10 to 20 minutes."
MAIPAI_DATA_DIR="$D1" MAIPAI_AB_OUT="$O/scripts" bun run scripts/bench/chat-ab-01.ts --scripts --only mt1-party,mt2-move 2>&1 | tee -a /tmp/chat-ab-01-studio.out | tail -5
echo "3. Spoken row (arm S), two search-free questions, 3 runs each."
MAIPAI_DATA_DIR="$D2" MAIPAI_AB_OUT="$O/spoken" bun run scripts/bench/chat-ab-01.ts --group spoken --only k4-seasons,r2-quarters 2>&1 | tee -a /tmp/chat-ab-01-studio.out | tail -5
echo
echo "Results: $O/scripts and $O/spoken (side-by-side.md, results.json)."
for f in "$O/scripts/side-by-side.md" "$O/spoken/side-by-side.md"; do echo "== $f"; sed -n '/^## Summary by category/,$p' "$f" 2>/dev/null; done
echo
echo "Done. Tell Claude: CHAT-AB-01 finished, and paste the lines above."
