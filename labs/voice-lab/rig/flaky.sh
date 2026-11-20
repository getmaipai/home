#!/usr/bin/env bash
# Runs the lab test suite N times (default 20) and prints every test that failed even once, then writes data-scratch/flaky-last.json for rig/ready.ts.
# Usage (in labs/voice-lab): bash rig/flaky.sh [N] [--no-ports]    --no-ports sets MAIPAI_TEST_NO_PORTS=1 like a sandboxed run. Exit 1 if any run failed.
cd "$(dirname "$0")/.." || exit 2
N=20; NP=0; for a in "$@"; do case "$a" in --no-ports) NP=1;; *[!0-9]*) ;; *) N="$a";; esac; done
OUT="../../data-scratch"; TMP=$(mktemp -d); fails=0
for i in $(seq 1 "$N"); do
  if [ "$NP" = 1 ]; then MAIPAI_TEST_NO_PORTS=1 bun test > "$TMP/$i.txt" 2>&1; else bun test > "$TMP/$i.txt" 2>&1; fi
  grep -q " 0 fail" "$TMP/$i.txt" || { fails=$((fails+1)); cp "$TMP/$i.txt" "$OUT/flaky-failed-$i.txt"; }
done
python3 -I - "$TMP" "$N" "$OUT/flaky-last.json" <<'PY'
import sys, glob, re, json, time, collections
tmp, n, out = sys.argv[1], int(sys.argv[2]), sys.argv[3]; c = collections.Counter()
for f in glob.glob(tmp + "/*.txt"):
    for m in re.finditer(r"^\(fail\) (.*?)(?: \[[0-9.]+ms\])?$", open(f).read(), re.M): c[m.group(1)] += 1
json.dump({"at_ms": int(time.time() * 1000), "runs": n, "failures": [{"name": k, "count": v} for k, v in c.most_common()]}, open(out, "w"))
print(f"{n} runs; " + ("no test failed" if not c else "FAILED AT LEAST ONCE:"))
for k, v in c.most_common(): print(f"  {v}x  {k}")
PY
rm -rf "$TMP"; [ "$fails" = 0 ]
