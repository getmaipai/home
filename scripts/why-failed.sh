#!/usr/bin/env bash
# Why did a picture, video, song or download fail? Prints the Stack's failed jobs from the last day (what, when, the plain reason)
# and the last worker failure lines from its log (the exception type and where it happened; never a prompt).
# Run on the computer that runs the Stack:  bash scripts/why-failed.sh [stack-url] [log-file]
set -euo pipefail
stack="${1:-http://127.0.0.1:8770}"
log="${2:-/usr/local/maipai-home/stack/data/logs/stack.log}"
echo "== Failed Stack jobs, last 24 hours =="
if jobs="$(curl -fsS -m 5 "$stack/stack/v1/jobs")"; then
  printf '%s' "$jobs" | python3 -c "$(cat <<'PY'
import datetime, json, sys
cut = (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=1)).isoformat()
failed = [j for j in json.load(sys.stdin)["jobs"] if j["state"] == "failed" and j["updatedAt"] >= cut]
for j in sorted(failed, key=lambda j: j["updatedAt"], reverse=True)[:15]:
    info = j.get("input") or {}
    what = info.get("model") or info.get("family") or ""
    reason = j.get("reason") or "no reason recorded"
    print(j["updatedAt"], j["kind"], what, "-", reason)
if not failed:
    print("(none)")
PY
)"
else
  echo "The Stack did not answer at $stack. Check that it is running."
fi
echo "== Worker failures in the Stack log (last 5) =="
if [ -r "$log" ]; then grep -h 'worker_failed' "$log" | tail -5 || true; else echo "Cannot read $log."; fi
