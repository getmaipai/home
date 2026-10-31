# Max chat lease: build addendum (TIER-HOME-05)

Status: slices 1 to 3 and the retirement built 2026-10-31; chat bench numbers and the composer picker still open. Extends [resource-tiers-2026-10-27.md](resource-tiers-2026-10-27.md) sections 7 (T6, T7) and
[resource-profiles-2026-10-30.md](resource-profiles-2026-10-30.md). Decided by Jesse (2026-10-30, 2026-10-31): chat is never paused, only lowered to
Reduced; no household switch; decide and build without asking.

## What slice 1 is (built)

- `backend/src/lib/chatLease.ts`: the lease as a state machine (`off`, `starting`, `held`, `releasing`) with an injected clock and an injected swap.
  The swap is the Stack's coding-mode transaction (unload residents, load the big model, post-load check, return on failure), so there is one
  implementation. Holder rule: owner and admin hold it by role; an adult needs the `tier.max` or `tier.max:chat` grant (`holdsMax`); a teen,
  child and guest never do (RULES.md rules 0 and 8). Readiness (coding mode's eight items) gates offering it at all.
- T7 as written: (a) a request in flight keeps the lease; (c) idle release after 30 minutes counted from the last token, between requests;
  (d) an admin may pin it, and a pinned lease still ends after 4 hours of quiet; (e) a watchdog eviction drops the lease (`evicted()`), and
  generators are no longer held. A failed swap leaves the lease off, the Stack has already put the residents back.
- `chatLeaseRuntime.ts`: the one running lease, a one-minute timer that calls `tick()`, and the queue reading `holdsGenerators()`.
- Queue: `admit` gains the hold `max_chat`. While the lease is up, Boost and Max generator jobs wait with it; Standard jobs that fit still run
  (T6; the Chat Max row of the profile table, which also queues Standard pictures, video and music, stays with the profile ladder's own rows).
  Card copy `max_chat` is in `jobQueueCopy.ts`.

## Built after slice 1 (same day)

- Routes: `GET`, `POST` (optional `pinned`, owner and admin only) and `DELETE /api/ai/chat-lease`, with plain refusal lines (not a holder, not set up,
  swap failed, someone else holds it, a Max job is running). A request while a generator Max window is open is refused (`max_window`).
- Request accounting: `trackChatLease` tells the lease when a chat turn starts and ends (`setChatTurnObserver`), so a turn in flight keeps the lease
  and the idle timer restarts at its end.
- `coding.home_mode` retired: Settings row and wording removed, the PUT refused, startup migration, readers (robot looks, canary pictures, the
  large-model-alone piece check) now ask `chatLeaseHeld()`.
- TIER-PRIO-03 (same branch): `decideDownshift` now gates every admission that lowers chat. A second person chatting at second 50 delays it, at
  second 61 it goes; the job shows `quiet_wait` or `cooldown_wait`. Settings: `resources.quiet_seconds`, `quiet_max_wait`, `quiet_timeout`, `cooldown_seconds`.

## Not built yet

1. The composer's Standard/Boost/Max picker and the Max marker on the model chip (TIER-UI rows); the routes are ready for it.
2. Bench numbers (llama-server vs Splash chat) from the Stack session: they set the default big model and the swap estimate on the confirm line.
3. S4 chaining (consecutive jobs keep chat Reduced inside one window) is passed as not chained; the cooldown covers the flap case.
4. Removing the `coding.home_mode` key itself needs a commons spec tag.

## Gaps found re-reading resource-profiles-2026-10-30.md against the code

Present: quiet window and `quiet_max_wait` (`decideDownshift`), cooldown, `profile_lowered`, `fair_share`, "lower without asking" and "never lower"
pins in the profile source, `mode_change`.
Missing, each its own small row:
- **R4 per-level policy:** no `max_concurrent_per_person` or `daily_cap` setting in Home code (child daily cap exists as `childDailyCapReached`
  on jobs; the per-person heavy limit is enforced by the running-people check, not a setting).
- **R6 simulator:** no replay test proving "chat never waits, nobody starves"; the pure `order`/`admit` functions allow it.
- **S6 per-category quiet windows** for pictures and music are not separate from chat's.
- **Pins as settings:** `resources.pins` as named in section 7 does not exist; "never lower" lives under `resources.close_apps.never` and
  the profile rows. Confirm the spec name before building the Priorities panel.

TIER-PRIO-03 landed with the lease slices: `decideDownshift` runs at every admission that lowers chat (acceptance test in `householdQueue.test.ts`).
