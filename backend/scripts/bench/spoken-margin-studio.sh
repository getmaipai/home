#!/bin/bash
# Run on the Mac Studio. Compares the spoken first-word time before warmth-over-time (07b) and now, on the Mac Studio.
# It adds a throwaway checkout of the commit before 07b beside your Home checkout, runs the two spoken
# questions there and in your checkout in turn (two rounds, so drift cancels), then removes the throwaway.
set -u
REPO="$(cd "$(dirname "$0")/../../.." && pwd)"
OLD_SHA=cab11b025
OLD="$(dirname "$REPO")/home-spoken-margin-old"
OUT=/tmp/spoken-margin.out
: > "$OUT"
echo "1. Checking the Stack answers on 127.0.0.1:8770."
curl -s -m5 -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8770/v1/models | grep -q 200 || { echo "STOP: the Stack is not answering on 8770."; exit 1; }
[ -d "$REPO/backend" ] || { echo "STOP: no Home checkout at $REPO. Run: run it from a Home checkout"; exit 1; }
echo "2. Making the throwaway checkout of $OLD_SHA at $OLD."
git -C "$REPO" fetch -q origin
[ -d "$OLD" ] || git -C "$REPO" worktree add -q --detach "$OLD" "$OLD_SHA" || exit 1
(cd "$OLD/backend" && bun install --silent) || { echo "STOP: bun install failed in $OLD/backend"; exit 1; }
cleanup() { git -C "$REPO" worktree remove --force "$OLD" 2>/dev/null; rm -rf "$OLD"; git -C "$REPO" worktree prune; }
trap cleanup EXIT
export MAIPAI_BENCH_SEARCH=fixture MAIPAI_LLAMA_SERVER_URL=http://127.0.0.1:8770 MAIPAI_EMBED_URL=http://127.0.0.1:8770
run() { # label dir
  local D O; D=$(mktemp -d -t spoken-data); O=$(mktemp -d -t spoken-out)
  echo "== $1" | tee -a "$OUT"
  (cd "$2/backend" && MAIPAI_DATA_DIR="$D" MAIPAI_AB_OUT="$O" bun run scripts/bench/chat-ab-01.ts --group spoken --only k4-seasons,r2-quarters 2>&1 | grep -E "first word|ERROR" | tee -a "$OUT")
  rm -rf "$D" "$O"
}
while pgrep -f '[s]cripts/check.sh|[b]un test|[v]ite build' >/dev/null; do echo "   waiting for a gate to end"; sleep 15; done
for round in 1 2; do
  echo "3. Round $round."
  run "round $round: before 07b ($OLD_SHA)" "$OLD"
  run "round $round: current" "$REPO"
done
echo
echo "Done. Tell Claude: spoken margin finished, and paste the lines above (also in $OUT)."
