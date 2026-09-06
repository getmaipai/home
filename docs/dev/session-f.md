# Session F: platform, trust, updates and the first release

Work order: `docs/plans/session-f-platform-and-trust.md`, under
`docs/plans/wave-2.md`. Worktree `../home-f`, branch
`session-f-platform-and-trust`, `MAIPAI_DATA_DIR=data-f PORT=8804`.

## Step 0: setup

Worktree, own data dir/port, `bun install`, baseline `check.sh` green.

Neither Session A nor Session B had merged to `main` at the time this
session started (their worktrees still showed unmerged steps: A's 11-12,
B's 8-10). Checked `main` directly rather than assuming: A's step 11
(per-person request limits, the Telegram and voice-catalog fetches
through the rate limiter) was confirmed absent - `lib/telegramChannel.ts`'s
`sendMessage` and `lib/voiceCatalog.ts`'s `fetchOnePage` both called
`fetch` directly, with no `tryConsume` anywhere in either file. Per
`wave-2.md`'s own fallback for exactly this case ("If A's step 11 ... is
not on main when C starts, C ships the turn and LLM route half and F
ships the fetch half, in their first steps") and this step's own text,
this session's remaining ownership-map paths are fully disjoint from A's
and B's, so work proceeded rather than blocking on their merge - flagged
to Jesse and coordinated with the concurrent Session D (also starting
against an unmerged A) rather than decided silently.

**Deferred, not forgotten:** the `tryConsume` routing for
`telegramChannel.ts`/`voiceCatalog.ts` fetches itself is not yet done -
folding it into step 3 (the runtime guards step already touches
`llmSupervisor.ts` and the download lane) rather than a separate pass,
since it's the same "every integration goes through the limiter at its
one choke point" work.

## Step 1: issues and Repairs

Merged alone, first, per the wave-2 contract ("F to C and D: issues and
sidecars... F ships this in its step 1 and merges that step alone,
early, so the others can import it").

**Shipped:** `spec/schemas/issue.schema.json` (id, source, key, severity,
title, detail, fix, learn_more, created_at, resolved_at, hlc - schema
v10's `issues` table mirrors it), `lib/issues.ts` (`raiseIssue`,
`resolveIssue`, `listIssues`, `fixIssue`, `dismissIssue`,
`registerFixHandler`), `GET/POST /api/repairs` (owner/admin only, the
same gate `backups.ts` uses), the `repairs.new` notification type
(`time_sensitive`, `adults`, configurable) with its Telegram toggle key.
25 new tests.

**One field beyond the plan's own list, and why:** the plan's step 1
text enumerates the schema fields without `dismissed_at`. A medium-effort
code review on this diff (2026-09-06) caught a real bug in the version
that shipped with only `resolved_at`: `dismissIssue()` had reused
`resolveIssue()`'s own field, so a person dismissing a still-broken
`error` issue lasted only until the owning source's own next routine
recheck called `raiseIssue()` again (which happens on every scheduled
health check regardless of whether anything changed) - that re-raise
looked identical to a fresh occurrence, reopening the row and re-firing
`repairs.new`. Fixed by giving dismissal its own field, the same
`resolved_at`/`dismissed_at` split `notification_deliveries` already
established for read/dismiss state on a delivery: `raiseIssue()` now
preserves `dismissed_at` across a refresh of a still-open row (sticky
until the source calls `resolveIssue()` for real, which clears it), and
the "fire `repairs.new`" transition check only counts a brand-new row or
one that had been genuinely resolved, never a merely-still-open or
merely-dismissed one. Resolvable from the existing pattern already in
this codebase, so fixed directly rather than escalated; noted here per
the org's "record the verdict" practice for a judgment call made without
asking.

Also fixed from the same review: the route layer was returning
`lib/issues.ts`'s internal camelCase DB-row shape (`learnMore`,
`createdAt`, `resolvedAt`) instead of the spec's snake_case wire shape,
breaking the convention every other spec-backed route follows
(`lib/personShape.ts`'s `toPerson()` is the pattern: convert AND
validate through the generated Zod schema at the API boundary, so a
response can never silently drift from the spec). `lib/issues.ts` now
returns the spec-shaped, `Issue.parse()`-validated type everywhere,
including from `raiseIssue`/`resolveIssue`'s own return values, not just
at the route.

**What's deferred, named:** no real source calls `raiseIssue` yet (fix
handlers and the actual health checks land with the sidecar contract,
the backup/storage/engine work in later steps) - step 1 ships the
mechanism and the route surface, proven by its own tests, not a wired-up
Health page. `GET /api/health`'s placeholder (`{ status: "ok" }`) is
untouched; step 2 replaces it with the real sidecar-reporting version.

## Step 2: the sidecar contract

Merged alone, second, per the wave-2 contract ("F to C and D... F ships
this in its step 2, merged alone the same way" as step 1).

**Shipped:** `lib/sidecars.ts` - `registerSidecar`/`getSidecar` (the
contract's own signature: `{ id, command, args→command[], cwd, port,
healthUrl, startupOrder, backupMode, excludePatterns }`), `listSidecars`
for `GET /api/health`, `startSidecar`/`stopSidecar`/`startAllSidecars`/
`stopAllSidecars` (ascending/descending `startupOrder`), a bounded log
ring, health-poll-driven crash detection with backoff restart, and
`registerGracefulExit()` wired once at boot (`index.ts`) so a hub exit
kills every sidecar's child process first - the actual fix for the class
of bug `freePort()` (moved here from `llmSupervisor.ts`, same file) only
ever mitigated after the fact. `GET /api/health` now returns `{ sidecars:
[...] }` for real, `requireAuth` (informational, not gated to owner/admin
the way Repairs' remedial actions are). 16 new tests (`tests/
sidecars.test.ts`), all against real spawned `bun -e` processes and real
HTTP health checks, no mocked process layer - matching this repo's
existing "prove the real mechanism" standard for `freePort()`'s own
tests, which moved here with it.

**A crashed sidecar is real Repairs content from day one:** `startSidecar`
and the health loop call `lib/issues.ts`'s `raiseIssue`/`resolveIssue`
directly (source `sidecar:<id>`, key `crashed`), and `registerSidecar`
wires a `restart_sidecar:<id>` fix handler through
`registerFixHandler` - so a household clicking "Fix" on a crashed sidecar
in Repairs genuinely restarts it, not a mechanism waiting for a first
real registrant. No real sidecar registers yet (D's SearXNG and C's voice
programs are the first, per the wave-2 contract), so `startAllSidecars()`
at boot runs over an empty registry today - proven by the tests, not by a
bundled example.

**A real bug caught while writing the tests, not by review:** the first
version's default health check for a sidecar declared with no `healthUrl`
was `async () => true` - always true, checked on the very first loop
tick, microseconds after `Bun.spawn` returns. A command about to fail
immediately (a bad binary, a script that exits on bad input) would still
report "running" before the OS had even scheduled it, because
`spawnAndWaitHealthy`'s own "fail fast on early exit" check
(`proc.exitCode !== null`) and the always-true health check both ran in
the same tick, before the process had any chance to actually exit. Fixed
with `minUptimeMs` (default 0, 500ms for the no-`healthUrl` case): the
loop now requires the process to have stayed alive for that long,
re-checking `exitCode` on every 300ms tick along the way, before trusting
a health check that carries no real signal of its own. Callers with a
genuine health check (`client.health()`, a sidecar's own `healthUrl`)
are unaffected - a check that only passes once the server is actually
serving requests already proves aliveness, `minUptimeMs` stays 0 for
them.

**`llmSupervisor.ts` and `embedSupervisor.ts`, "same behaviour, one
implementation":** both hand-rolled a near-identical
freePort-then-spawn-then-poll-health sequence (the plan's own step 2 text
names this exact duplication). The mechanics - `freePort()` and the
spawn-and-poll loop, now `spawnAndWaitHealthy()` - moved to
`lib/sidecars.ts` and both files call it; the role-specific behaviour
(the tiered URL/override/selection/stub fallback, the household model
selection, the post-load check, the `generation`-guarded restart race)
stayed exactly where it was, since none of that is shared across the two
files.

**A genuine mismatch with the two lazy engine supervisors, resolved
rather than papered over:** the contract's `registerSidecar` is
declarative (`command`, `port`, `startupOrder` all known upfront, started
eagerly at boot). `llmSupervisor.ts`/`embedSupervisor.ts` are the
opposite on purpose: which command to run is chosen per-role from
multiple tiers (a URL override, a household's own model selection, a
stub) resolved lazily on first use, not at boot - forcing them through
the declarative registry would mean either registering a placeholder
config that gets rewritten before every start (defeating the point of a
declared config) or teaching the registry to accept a command resolved
at start-time instead of registration-time (a bigger, riskier change for
two callers whose lazy/tiered shape the plan doesn't ask to change).
Resolved by keeping the registry for eagerly-started, statically-declared
sidecars, and only sharing the low-level spawn/health/freePort mechanics
with the two lazy supervisors - the "one implementation" the plan asks
for is real, just at the mechanics layer, not the registry layer. A
judgment call made without asking (resolvable from the two files'
existing, literal code duplication), recorded here per the org's
"record the verdict" practice.

**What's deferred, named:** no restart cap (a sidecar that keeps crashing
retries forever at the backoff ceiling rather than giving up after N
attempts) - real, but not yet a problem with zero real registrants; a gap
to close before D's or C's first sidecar ships, not before this step
merges. The `backupMode`/`excludePatterns` fields are declared and typed
but read by nothing yet - step 8's backup work is the real consumer.
