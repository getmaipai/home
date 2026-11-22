# TIER-LEASE-02 notes

Waiters and remaining time on every job. Design: `docs/design/tier-lease-2026-11-22.md` (sections 2, 3, 6).

## What changed

- `lib/codingTurns.ts`: a running turn carries `remainingSeconds` (typical 120 s minus elapsed, floor 30 s) through `codingRemainingSeconds`; `startedAt` is set when the turn goes running. A paused session is a queue record in the state `paused` (holds nothing, never started by the queue, never the holder's job). New `pauseSession`, `resumeSession`, `expirePausedSessions`, `pauseMaxMs` (the routes for them are TIER-LEASE-03). Pause never cuts a turn off: it takes effect when the turn ends; messages typed meanwhile are written into the transcript, so a restart loses none.
- `lib/jobs/householdQueue.ts`: new reason `held_coding` (set by `admit` behind a running Max or Boost coding turn, instead of `max_window` or `heavy_slot`; persisted like the other holds). `estimate()` now starts with the time left of a running Boost or Max coding turn (the longest, falling back to the typical time), so a queued picture gets a number. `leaseQueueSignals` counts `held_coding` waiters (kinds only) and `pausedJobs`.
- `lib/jobQueueCopy.ts`: the `held_coding` line, adult with the number, child without; no person, title or id (rule 6a).
- `lib/tierLease/policy.ts`: `LeaseQueueSignals.pausedJobs` (optional, additive).
- Tests: `backend/tests/tierLeaseQueue.test.ts`.

## Notes for the next rows

- The pause limit reads `coding.pause_max_minutes` (default 60). The key is not in the spec registry yet: register it in `commons/spec` with TIER-LEASE-07 so Settings can set it; until then the default applies.
- `jobQueueCopy.test.ts` has two failures on main that are not from this row (`phaseLabel` reads `job.request` of a test fixture without it).
