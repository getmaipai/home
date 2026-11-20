#!/usr/bin/env bash
# Shell twin of wait_if_talking.py (no python needed): wait_if_talking.sh [--file PATH] [--max-wait SECONDS] [--poll SECONDS] [--log PATH]
# Returns at once when no turn is in flight, else waits until the lease clears or the max wait passes; prints "waited_ms=N reason=none|clear|timeout". Always exits 0.
F="${TURN_LEASE_FILE:-$(cd "$(dirname "$0")" && pwd)/../../../../data-scratch/turn-in-flight.json}"; MAX=8; POLL=0.1; LOG=""
while [ $# -gt 0 ]; do case "$1" in --file) F="$2"; shift 2;; --max-wait) MAX="$2"; shift 2;; --poll) POLL="$2"; shift 2;; --log) LOG="$2"; shift 2;; *) shift;; esac; done
now_ms() { perl -MTime::HiRes=time -e 'printf "%d\n", time()*1000' 2>/dev/null || echo $(( $(date +%s) * 1000 )); }
holds() { [ -r "$F" ] || return 1; local j exp; j=$(cat "$F" 2>/dev/null); case "$j" in *'"inFlight":true'*) ;; *) return 1;; esac
  exp=$(printf '%s' "$j" | sed -n 's/.*"expires_at_ms":\([0-9]*\).*/\1/p'); [ -n "$exp" ] && [ "$exp" -gt "$(now_ms)" ]; }
t0=$(now_ms); reason=none
if holds; then reason=timeout; [ -n "$HELPER_STARTED_FILE" ] && echo 1 > "$HELPER_STARTED_FILE"; deadline=$(( t0 + $(printf '%.0f' "$(echo "$MAX * 1000" | bc -l)") ))
  while [ "$(now_ms)" -lt "$deadline" ]; do sleep "$POLL"; if ! holds; then reason=clear; break; fi; done; fi
ms=$(( $(now_ms) - t0 )); echo "waited_ms=$ms reason=$reason"
[ -n "$LOG" ] && [ "$reason" != none ] && echo "{\"at_ms\":$(now_ms),\"waited_ms\":$ms,\"reason\":\"$reason\"}" >> "$LOG"
exit 0
