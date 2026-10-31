# Max chat lease: build addendum (TIER-HOME-05)

Status: slice 1 built 2026-10-31; later slices not built. Extends [resource-tiers-2026-10-27.md](resource-tiers-2026-10-27.md) sections 7 (T6, T7) and
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

## Not built yet, in order

1. **Routes and composer.** Take and release: `POST /api/ai/chat-lease` (acquire, pin) and `DELETE` (release), admin and holder only; the
   composer chip's Max marker reads `snapshot()`. Needs the model chip's Standard/Boost/Max picker (TIER-UI rows).
2. **Request accounting.** `requestStarted`, `noteToken`, `requestEnded` called around each chat turn on the big model, so the in-flight guard
   and the idle timer see real traffic. Until this lands nothing marks a request in flight, so the routes must not ship before it: wire the hooks first.
3. **Other threads on the big model.** While held, other people's threads answer on the big model (T6); the Stack's chat role mapping for
   `coding` mode already does this. A minor's thread keeps its floors (thinking off, no tools) whatever model answers.
4. **Retire `coding.home_mode`.** Migration that maps a stored `coding` to no lease, removes the Settings card switch, `reconcileCodingModeAtStartup`
   and the `/settings` mode routes; MODE-* rows are already marked superseded. Only after 1 to 3 are live.
5. **Bench numbers** (llama-server vs Splash chat) from the Stack session: they decide the default big model for Max chat and the 20 to 60 s
   swap estimate shown on the confirm line. Nothing in slice 1 depends on them.
6. **Window interaction.** Acquire refused while a generator Max window is open (the job's card says so); a lease request during a window
   queues behind it with `max_window`. Not yet in `acquire`.

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
