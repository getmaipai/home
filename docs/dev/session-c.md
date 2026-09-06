# Session C: the brain and the voice loop

Work order: `docs/plans/session-c-brain-and-voice.md`, under
`docs/plans/wave-2.md`. Worktree `../home-c`, branch
`session-c-brain-and-voice`, `MAIPAI_DATA_DIR=data-c PORT=8801`.

## Step 0: setup

Worktree, own data dir/port, `bun install`, baseline `check.sh` green.

**A and B's merge, found broken, not assumed clean.** Neither
`session-a-intelligence` nor `session-b-ui` had merged to `main` when this
session started (wave-2.md's own precondition for C). Rather than branch
against stale files this session would own past Wave 1, `main` was merged
with both first: `session-a-intelligence` (through its step 10 - steps
11-12 are still that session's own to finish later, on a fresh worktree),
then `session-b-ui` (through its step 7). Both merges' `check.sh` had been
read as green from a backgrounded shell that had not actually finished;
re-run for real, the merge left three real gaps (stray dead migration
files from the conflict resolution, nine frontend test fixtures missing
the now-required `Person.hlc`, and `turn_meta` - the turn stream's new
first-line contract event - being treated as a fatal stream error
everywhere it wasn't yet explicitly handled, breaking every single chat
turn end to end). Found independently in this worktree while getting a
clean baseline; a concurrent session fixed and committed the canonical
version to `main` (`2956e1f`) before this session's own local copy of the
same fix landed, so `session-c-brain-and-voice` rebased onto it rather
than shipping a duplicate - see this repo's `git log` for the full
before/after, not repeated here.

**Per-person turn/LLM rate limiting, shipped now per the plan's own
fallback.** A's step 11 (the per-person request limiter on `POST
/api/turn`, `/api/turn/stream` and `/api/llm/*`) was confirmed absent from
the merged `main` (no `tryConsume` call anywhere in `routes/turn.ts` or
`routes/llm.ts`). Per `session-c-brain-and-voice.md` step 0's own text
("If A's step 11 is not on main when C starts, C ships the turn and LLM
route half"), shipped here: `lib/llm.ts`'s new `personWithinTurnBudget()`
wraps `lib/rateLimiter.ts`'s existing token bucket (F's file, reused
as-is, not forked) at `capacity: 5, refillPerSecond: 0.5` - a burst of
five, then one every two seconds - keyed `turn:<personId>`, one shared
budget across all four routes since a turn's own reply generation goes
through the identical model call `POST /api/llm/chat` does. Lives in
`lib/llm.ts` rather than either route file: it is the one module both
`routes/turn.ts` (via `lib/turnEngine.ts`) and `routes/llm.ts` already sit
above, so both routers depend on it without a route-to-route import in
either direction. New catalogue code `spec/errors/errors.json`'s
`turn_rate_limited` (a 429), reusing the existing `rate_limited` code's
`ui_message`/`spoken_fallback` wording was considered and rejected: that
entry's `message` field is specific to `host.fetch`'s own bucket, and
repurposing it without correcting the text would leave the catalogue
lying about which limiter fired. F's `lib/telegramChannel.ts`/
`voiceCatalog.ts` fetch-side half of A's step 11 is F's own to ship (its
own dev file already names it deferred to its step 3).

A medium-effort `code-review` on this diff caught the rate-limit check
duplicated near-verbatim across all four route handlers with the error
text already drifted between the two files (`"Too many turns too
quickly."` vs `"Too many requests too quickly."` for the identical code) -
fixed by consolidating into `lib/llm.ts`'s single `personWithinTurnBudget`
plus one shared `RATE_LIMIT_RESPONSE` constant per route file, both
importing the same wording. The review's other two findings (a single
budget shared across all four endpoints rather than scoped per feature;
every route here still a plain Hono handler rather than
`@hono/zod-openapi`, per `CLAUDE.md`'s documentation rule) are real but
pre-existing/deliberate, not fixed: the shared budget is this step's
whole point (see above), and zod-openapi conversion is a codebase-wide gap
on every route today, not something this diff uniquely regresses - noted
here rather than silently skipped.

**Stub LLM and embed backends confirmed in tests**, no action needed:
`lib/llm.ts`'s `complete()`/`embed()` already pick the in-process stub
whenever neither `MAIPAI_LLAMA_SERVER_URL`/`MAIPAI_LLAMA_SERVER_BIN` nor
`MAIPAI_EMBED_URL` is set (true for this worktree and the test suite),
and `backend/tests/llm.test.ts` already asserts the stub's canned-reply
wording directly.

**Bench command, for when a later step needs the real engine** (recorded
here once so later steps just point at it): set `MAIPAI_LLAMA_SERVER_BIN`
to a downloaded `llama-server` binary (`lib/engineCatalog.ts`'s pinned
builds) and `MAIPAI_CHAT_MODEL_PATH` to a local GGUF, or `MAIPAI_LLAMA_SERVER_URL`
to point at one already running; `MAIPAI_EMBED_URL` the same way for a
real embedding server (or it reuses the chat engine binary with
`--embedding` once a chat model has been downloaded at least once).
Neither is set anywhere in this repo today, so every `bun test` run and
every dev-server boot without them is the stub, on purpose.

`scripts/check.sh` is green (one flaky pre-existing test under full-suite
load, `runTurnStream() ordinary conversation streams real
sentence-chunked deltas`, confirmed by re-running in isolation and by a
clean second full run - not a regression from this step, not investigated
further here).
