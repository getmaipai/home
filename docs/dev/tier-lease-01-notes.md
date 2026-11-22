# TIER-LEASE-01 notes

The shared sticky-tier lease policy. Design: `docs/design/tier-lease-2026-11-22.md` (sections 2, 3, 6).

## Files changed

- `backend/src/lib/tierLease/policy.ts` (new): pure policy. Lease key registry (`chat` 3 min grace, `coding` 10 min grace, both with the 4 h pin cap), `decide`, `releasesInSeconds`, `mayRenew`, `mayTake`, `ENGAGED_PROTECTION_MS` (10 s). Signals are counts and kinds only (`LeaseQueueSignals`).
- `backend/src/lib/chatLease.ts`: the engine-swap driver. `tick()` asks `decide`; holder-only renewal (`requestStarted`, `noteToken`, `requestEnded` take an optional person id; another person's turn counts as in flight but does not renew); new `touch(personId)` and `decision()`; a take refuses with `stack_busy` while another person's Boost or Max job runs (never preempts). `snapshot()` gains `key`, `waiters`, `holderJobs` (additive).
- `backend/src/lib/chatLeaseRuntime.ts`: wires `leaseQueueSignals` into the lease, passes the person id from the turn observer, ticks every 5 s (was 15 s) so a waiter is served at once.
- `backend/src/lib/jobs/householdQueue.ts`: `leaseQueueSignals(forPersonId)` (holder jobs, `max_chat` waiters by kind, heavy job running elsewhere); the chat turn observer now receives the person id.
- `backend/src/lib/codingTurns.ts`: the turn's start and end name the person; `submitTurn` calls `touch` for a Max turn. The take itself stays the queue job in `startTurn`, with category `coding` selecting the coding key.
- Tests: `backend/tests/tierLeasePolicy.test.ts`.

## Hooks for the next rows

- TIER-LEASE-02: `LeaseQueueSignals.waiters.kinds` and `heavyRunningElsewhere` are the place to add `remainingSeconds` and the `held_coding` and `paused` job states; `leaseQueueSignals` reads `currentEntries` only.
- TIER-LEASE-03: routes call `getChatLease().touch(personId)` (holder only, returns false otherwise), `snapshot()` for the view, `release()` for release; Pause and yield need a unit-boundary hook beside `requestEnded`. Registry lookup by `isLeaseKey`.
- TIER-LEASE-07: replace `LEASE_REGISTRY` values from a setting; `createChatLease` already accepts an override through `deps.config`.
