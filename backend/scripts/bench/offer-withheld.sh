#!/bin/bash
# Runs the offer_withheld judge bench (offer-withheld.ts) against the Stack on 127.0.0.1:8770 with a fresh empty
# data dir. Reads only: no repo file and no live data change. Output also goes to /tmp/offer-withheld-bench.out.
set -u
REPO="$(cd "$(dirname "$0")/../../.." && pwd)"
echo "1. Checking the Stack answers on 127.0.0.1:8770."
curl -s -m5 -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8770/v1/models | grep -q 200 || { echo "STOP: the Stack is not answering on 8770. Start it, then run this again."; exit 1; }
D=$(mktemp -d -t offer-bench)
trap 'rm -rf "$D"' EXIT
echo "2. Running the judge bench with an empty data dir. About a minute."
cd "$REPO/backend" || exit 1
MAIPAI_BENCH_UPSTREAM=stack MAIPAI_DATA_DIR="$D" MAIPAI_LLAMA_SERVER_URL=http://127.0.0.1:8770 MAIPAI_EMBED_URL=http://127.0.0.1:8770 MAIPAI_BACKGROUND_URL=http://127.0.0.1:8770 bun run scripts/bench/offer-withheld.ts 2>&1 | tee /tmp/offer-withheld-bench.out | tail -40
echo
echo "Done. Tell Claude: judge bench finished, and paste the lines above."
