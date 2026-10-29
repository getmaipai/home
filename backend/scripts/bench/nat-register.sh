#!/bin/bash
# Runs the NAT register bench (register.ts, the NAT-07 opening rows included) against the Stack on 127.0.0.1:8770
# with a fresh empty data dir. Reads only: no repo file and no live data change. The engine is shared with the
# live hub, so run it when the household is quiet. Output also goes to /tmp/nat-register-bench.out.
set -u
REPO="$(cd "$(dirname "$0")/../../.." && pwd)"
echo "1. Checking the Stack answers on 127.0.0.1:8770."
curl -s -m5 -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8770/v1/models | grep -q 200 || { echo "STOP: the Stack is not answering on 8770. Start it, then run this again."; exit 1; }
D=$(mktemp -d -t nat-bench)
trap 'rm -rf "$D"' EXIT
echo "2. Running the register bench with an empty data dir. It takes a few minutes."
cd "$REPO/backend" || exit 1
MAIPAI_DATA_DIR="$D" MAIPAI_LLAMA_SERVER_URL=http://127.0.0.1:8770 MAIPAI_EMBED_URL=http://127.0.0.1:8770 bun run scripts/bench/register.ts 2>&1 | tee /tmp/nat-register-bench.out | tail -60
echo
echo "Done. Tell Claude: bench finished, and paste the last lines above."
