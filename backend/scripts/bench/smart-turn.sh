#!/bin/bash
# Run on the Mac Studio, from your Home checkout. Measures the Stack's Smart Turn end-of-turn check on spoken lines.
set -u
REPO="$(cd "$(dirname "$0")/../../.." && pwd)"
OUT=/tmp/smart-turn.out
echo "1. Checking the Stack answers on 127.0.0.1:8770."
curl -s -m5 -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8770/v1/models | grep -q 200 || { echo "STOP: the Stack is not answering on 8770."; exit 1; }
while pgrep -f '[s]cripts/check.sh|[b]un test|[v]ite build' >/dev/null; do echo "   waiting for a gate to end"; sleep 15; done
echo "2. Speaking 44 lines in 6 generated preset voices and asking the end-of-turn check at 3 silence pads (about 16 minutes)."
(cd "$REPO/backend" && bun run scripts/bench/smart-turn.ts) 2>&1 | tee "$OUT"
echo
echo "Done. Tell Claude: Smart Turn bench finished, and paste the lines above (also in $OUT)."
