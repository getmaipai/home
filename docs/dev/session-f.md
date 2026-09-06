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

## Step 3: the runtime guards legacy paid for

Checked `llmSupervisor.ts`, `modelDownload.ts` and `telegramChannel.ts`
for equivalents first, per docs/BACKLOG.md's own instruction (the 2026-
09-05 audit didn't). Two guards already existed and needed nothing: the
download stall watchdog (`modelDownload.ts`'s 90s idle-read timeout) and
6-attempt backoff. Also completed step 0's deferred fallback for A's
unshipped per-person-limits step: `telegramChannel.ts` and
`voiceCatalog.ts` now route their fetches through `lib/rateLimiter.ts`'s
`tryConsume()`.

**`lib/dirtyBoot.ts` (new):** ported from the archived legacy hub with a
real change, not a straight port - legacy's version was Windows-only
(`bootFollowedUncleanShutdown()` returned `false` outright on every other
platform); this step's own text asks for "the equivalent on Linux and
macOS best-effort," so all three are real: Windows keeps legacy's
Kernel-Power-41 `wevtutil` query unchanged; macOS parses `pmset -g log`'s
own "Shutdown Cause" line (a real mechanism macOS admins already use for
this exact question); Linux checks whether the previous boot's own
journal ends with a clean shutdown target via `journalctl -b -1`. Every
platform's interpretation logic is a pure, exported function
(`windowsEventIndicatesUncleanBoot`, `macosLogIndicatesUncleanShutdown`,
`linuxPreviousBootLogIndicatesUncleanShutdown`) unit-tested against
synthetic log/XML text, so the branches don't depend on this dev
machine's own shutdown history; `bootFollowedUncleanShutdown()` itself
also gets one real-mechanism test (resolves to a boolean on whatever
platform actually runs the suite, no specific outcome asserted).

**The crash-boot hold:** `initCrashBootHold()` runs once at boot
(`index.ts`, fire-and-forget - the OS query takes at most a few seconds
and no real spawn happens before the first request anyway) and sets a
30-minute hold when the boot was unclean. `llmSupervisor.ts`'s
`trySpawnFromSelection()` and `embedSupervisor.ts`'s real-spawn branch
both check `isInCrashBootHold()` and throw a clear, dad-test error
instead of spawning - placed so tier 1 (a developer's URL override) and
the stub tier are never gated, only a genuine local model spawn. Embed's
own check has no direct unit test: its real-spawn branch requires a real
installed engine binary on disk, which nothing in this test environment
has (the same pre-existing gap `spawnEmbedServer()` itself already has -
not a coverage hole this step introduced, and reviewed by hand for
symmetry with `llmSupervisor.ts`'s tested equivalent).

**`lib/sidecars.ts`'s `sweepOrphanProcesses()` (new) and
`llmSupervisor.ts`'s `sweepOrphanEngineProcesses()`:** the real fix for
legacy's "orphaned runners once forced every load to CPU: a 90s 'hi'".
`freePort()` only ever catches an orphan bound to the exact port a fresh
spawn is about to claim; this catches one sitting anywhere else (a
leftover from a since-changed port env var, or any stray engine process
a crash or a `--hot` reload left running), matching on `enginesDir` - a
real, this-install-specific absolute path every chat/embed spawn invokes
its binary under, so nothing outside this hub's own spawned engines can
ever match. Runs once at boot, before `startAllSidecars()`. "Max
resident models" itself needed no new code: chat and embed are each a
single module-level singleton already, so residency was already capped
at one per role by construction - the orphan sweep is what actually
closes the gap legacy's incident exposed.

**A real safety catch while writing its own test:** the first draft of a
`sweepOrphanProcesses()` test asserted self-protection with a broad
match string (the current process's own binary name, "bun") - which,
run for real via `execFileAsync("ps", ["aux"])` and `process.kill`,
would have `SIGKILL`ed every other `bun` process on the machine,
including the several other sessions' worktrees (`home-c`, `home-d`)
actively running at the same time this step was being written. Caught
before the test suite ever ran it (reasoned through what the test would
actually do to a shared dev machine, not just what it would assert) and
replaced with a comment explaining why that scenario isn't safe to test
directly; the two remaining tests (a unique-marker-matched spawn dies,
a non-matching marker kills nothing) already prove targeted matching
without needing the dangerous case.

**Also caught while testing, unrelated to the guards themselves:**
`Bun.Subprocess.exitCode` doesn't reliably populate after an externally-
delivered `SIGKILL` (only `.exited`, the promise, resolves reliably) -
the sweep test's first version polled `.exitCode` and hung until its own
timeout despite the process actually being dead (confirmed independently
via `ps -p`). Fixed by asserting on `.exited` instead; noted here since
it's a easy trap for any future test in this codebase that kills a
`Bun.spawn()`ed process from outside and checks whether it died.

**What's deferred, and why (docs/BACKLOG.md updated to match):**
negative caches (no analog exists in this architecture - nothing here
repeatedly re-probes a known-failing resource the way legacy's media-
stream resolution did) and a boot watchdog capped at three reloads (an
OS service-manager concern - `systemd`'s `StartLimitBurst`, launchd's
`ThrottleInterval`, or `run.sh`/`run.ps1`'s own retry-cap - reassigned to
step 11's install/service work, not backend code). The chat-latency rule
(warm-up prefix == chat prefix) needs an export from `turnEngine.ts` that
doesn't exist yet (`buildSystemPrompt()`'s `stablePrefix` is an inline
local, never its own function) - filed as getmaipai/home#15 for Session
C rather than guessed at or built against a fabricated prefix; the rest
of this step shipped without it.

**A medium-effort code review before commit found seven real issues,
six fixed here:**

1. Tier 2 (`MAIPAI_LLAMA_SERVER_BIN`/`MAIPAI_CHAT_MODEL_PATH`, "a
   developer's explicit override" per this file's own header) had no
   crash-boot-hold check at all - only tier 3 did, even though tier 2 is
   just as real a spawn contending for the same hardware. Fixed: both
   tiers now call one shared `assertNotInCrashBootHold()` (also fixes
   finding 6 below).
2. The first `macosLogIndicatesUncleanShutdown()` blocklisted a handful
   of `pmset -g log` "Shutdown Cause" codes as clean and treated
   everything else - including "-128", commonly logged for completely
   ordinary restarts on modern macOS - as unclean. Replaced entirely: macOS
   detection now looks for an actual kernel panic report in
   `/Library/Logs/DiagnosticReports` timestamped near boot, an unambiguous
   signal with no equivalent ambiguous code to misread (at the honest cost
   of missing a raw power-off that never triggered a panic - accepted,
   matching "never a false alarm" over "catch everything").
3. `index.ts` had `sweepOrphanEngineProcesses()`/`initCrashBootHold()`/
   `startAllSidecars()` all fire-and-forget while the comments claimed an
   ordering ("before anything real spawns") nothing enforced - Bun starts
   serving requests the moment the module finishes evaluating, so a very
   early request could race both checks. Fixed: the two one-shot,
   finite checks are now `await`ed via top-level await before the
   module's `export default` is reached (and so before Bun picks up the
   server); `startAllSidecars()` stays fire-and-forget since it's an
   ongoing loop, not a one-shot check, and nothing registers a sidecar
   yet.
4. `ttsSupervisor.ts` (Session C's file) has the identical real-spawn
   shape with no hold check - out of scope to fix here, filed as
   getmaipai/home#16 for Session C.
5. `voiceCatalog.ts`'s `waitForToken()` busy-polled forever with no cap;
   this file's own new comment claimed nothing waits on it synchronously,
   which was simply wrong - `routes/voice.ts`'s `GET /catalog` and
   `POST /catalog/select` both `await getVoiceCatalog()` directly inside a
   live request handler. Fixed with a 15s cap that throws (degrading into
   the existing 503 both routes already handle) instead of hanging a
   request for however long the pathological 50-page case would take to
   refill.
6. The Linux clean-shutdown pattern only matched "Reached target
   ...Shutdown" - newer systemd (254+) split that into separate Reboot/
   Power-Off/Halt targets with their own wording, which could have
   misclassified a clean shutdown on a newer distro as unclean. Broadened
   to match every documented target/verb variant; the residual gap (a
   shutdown whose final log lines never reached disk, or future wording
   this list doesn't know about) is accepted as part of this guard's
   already-stated best-effort posture, not solved perfectly.
7. `sidecars.ts`'s `sweepOrphanProcesses()` inlines the same regex-escape
   one-liner `turnEngine.ts` (Session C's file) already has. Left as-is:
   a standard, stable one-line JS idiom, not custom logic likely to drift
   - extracting a shared module for one line used twice, or editing C's
   file without coordination, would cost more than the duplication itself.

**A pre-existing flaky test found while re-running the suite for this
step, fixed since `rateLimiter.ts` is F's own file:**
`tests/rateLimiter.test.ts`'s "never refills past capacity" test used
`refillPerSecond: 1000` (one token every 1ms) with a 50ms sleep - under
the real system load this step's own many-subprocess tests
(`sidecars.test.ts`, `dirtyBoot.test.ts`) add to a full `bun test` run,
a few milliseconds of scheduling jitter between its four `tryConsume()`
calls could tip the bucket into an accidental 3rd token, failing the
test despite the clamp logic itself being correct (confirmed: always
passed in isolation, failed once in ~3 full-suite runs). Slowed to
`refillPerSecond: 20` with a 500ms sleep - the same proof ("would refill
way past capacity if unclamped"), a jitter margin two orders of
magnitude wider. Five isolated runs and two full-suite runs afterward,
all green.

## Step 4: `@hono/zod-openapi` and `/api/docs` - the pattern (read this before converting a route file)

Two new dependencies (`@hono/zod-openapi`, `@scalar/hono-api-reference`,
both MIT - out of NOTICE's scope per that file's own header, which only
covers components bundled into the shipped frontend). `lib/openapi.ts`
(new) is the shared scaffolding every converted route file goes through;
`routes/repairs.ts` is the worked example, fully converted, all its
existing tests passing unchanged.

**The conversion, mechanically:**

1. `export const xRoutes = apiRouter();` (from `@/lib/openapi`) instead
   of `new Hono<AppEnv>()`.
2. One `createRoute({...})` per endpoint: `method`, `path` (Hono's `:id`
   becomes OpenAPI's `{id}`), `tags` (groups it in `/api/docs`),
   `summary`, `middleware: [requireAuth]` or `[requireRole(...)]` `as
   const` (the exact same middleware chain, just declared in the route
   object instead of as `.get()`'s second argument - `as const` is
   required for TypeScript to infer the middleware's context correctly),
   `request.params`/`request.query`/`request.body` (Zod schemas - path/
   query fields need `.openapi({ param: { name, in } })` for correct
   binding; body and response schemas don't), `responses` (a map of
   status code to `{ content, description }` - use
   `lib/openapi.ts`'s `errorResponses({ 400: "...", 404: "..." })` for
   the error ones instead of repeating the same shape by hand).
3. `xRoutes.openapi(theRoute, handler)` instead of
   `.get/.post(path, middleware, handler)`. Inside the handler,
   `c.req.valid("param"|"query"|"json")` instead of
   `c.req.param()`/`c.req.query()`/`c.req.json()` - already validated
   against the schema by the time the handler sees it.
4. Reuse the real generated spec type as a response schema when the
   route returns spec-shaped data (`import { Issue } from
   "@maipai/spec/gen/ts/issue.js"`) rather than re-describing the shape
   by hand in the route file - one definition, same as the lib layer's
   own convention.

**Two real gotchas found converting `repairs.ts`, both now load-bearing
comments in `lib/openapi.ts` - read them before hitting the same wall:**

- **`c.json(data)` needs an explicit literal status, even for 200.**
  Omitting it left TypeScript unable to tell which of a route's several
  declared response schemas the call was for, and it type-checked the
  body against ALL of them (a 200 handler's data failing to type-check
  against an unrelated 401 error schema, with a confusing error pointing
  at the wrong line). Always `c.json(body, 200)`, `c.json(body, 404)`,
  etc.
- **The real bug was `lib/openapi.ts`'s own `errorResponses()` helper,
  not a hono limitation** - worth stating plainly since the first
  diagnosis while converting `repairs.ts` blamed the wrong thing (a
  shared error-status helper returning `{ body, status: 400 | 404 }`,
  used as `c.json(body, status)`) and rewrote every handler with manual
  `if (result.status === 400) ...` branching to work around it. Verified
  afterward: that branching was never necessary. `errorResponses()`'s
  first version was typed `(statuses: Record<number, string>):
  Record<number, {...}>` - a `Record<number, X>` return annotation
  erases the actual literal keys (400, 403, 404) down to "some number",
  so `createRoute`'s response union lost them regardless of how a
  handler later called `c.json`. Once `errorResponses()` became generic
  over the literal keys passed in (`<const T extends Record<number,
  string>>`), a plain shared helper returning a union-typed `{ body,
  status }` - the natural, less repetitive shape - type-checks exactly
  as expected; `routes/repairs.ts` keeps the explicit-branching style
  simply because it was already written that way when this was found,
  not because it's required. Route files converted after this fix
  (`notifications.ts`, `settings.ts`) use the shorter shared-helper
  shape safely - use whichever style you find clearer.

  A real, separate fix worth keeping regardless: `lib/issues.ts`'s
  `IssueOpResult<T>` and `lib/notifications.ts`'s `NotificationOpResult<T>`
  both declared a broader status union (400/403/404) than any one
  function actually produces (`dismissIssue()` never returns 400,
  `markRead()`/`dismiss()` never return 400 at all). Both gained a
  second, defaulted type parameter (`IssueOpResult<T, S extends number =
  400 | 404>`) so each function can declare its own true, narrower
  range instead of the shared type's ceiling - a genuine accuracy fix
  independent of the openapi conversion, since a `responses` map should
  describe what a function can really return.

**`docs/api/openapi.json`, generated and drift-checked:**
`backend/scripts/gen-api-docs.ts` (`bun run gen:api-docs` from
`backend/`) imports the live `app` and writes its OpenAPI document;
`scripts/check.sh` regenerates it and fails if the working tree doesn't
match, the identical shape `gen:settings`/`spec/settings/keys.json`
already established. `/api/docs` (Scalar, reading `/api/openapi.json`
live) is the interactive explorer; `docs/api/openapi.json` is the
committed snapshot other tooling (the docs site, step 11) can read
without a running hub.

**What every other session converting their own route files needs to
know:** `app.ts`'s top-level instance is now `apiRouter()` (an
`OpenAPIHono`), not `new Hono()` - this is required for `/api/docs` to
see anything, but it changes nothing for an UNCONVERTED router: a plain
`Hono<AppEnv>` sub-router still mounts via `.route()` exactly as before
and simply doesn't appear in the generated document until its own
session converts it. Convert a route file only when you're already
touching it (the org rule), copying `routes/repairs.ts`'s shape; nothing
about this step requires converting a file you aren't otherwise editing.

**Five of six pre-existing owned route files converted:**
`notifications.ts`, `settings.ts`, `backups.ts` and `people.ts` followed
`repairs.ts`'s exact shape, all their existing tests passing unchanged
(749 backend tests green throughout). Two more real accuracy fixes at
the source while converting, the same class as `lib/issues.ts`'s: both
`lib/notifications.ts`'s `NotificationOpResult<T>` and this step's own
narrowing pattern - `markRead()`/`dismiss()` never actually return 400,
only 403/404, so the type (now `NotificationOpResult<T, S extends number
= 403 | 404>`) stopped claiming otherwise.

**A medium-effort code review on the whole step 4 diff found three
cleanup findings, all fixed, no correctness bugs:** the same `{id: z.
string().openapi(...)}` path-param shape was hand-declared separately in
four files instead of once - `lib/openapi.ts` gained `idParamSchema(name,
example?)`, now used by all four. Getting its own type right mattered:
a naive `(paramName: string)` signature made the computed property key
untypeable as anything but `string`, so `c.req.valid("param").id` came
back as `string | undefined` at every call site instead of the
guaranteed `string` a path param always is - fixed by making it generic
over the literal name (`<const Name extends string>`), the identical
"generic over literal keys" fix `errorResponses()` already needed for the
same reason. Separately, `settings.ts`'s `settingsErrorResponse()` helper
and `repairs.ts`/`notifications.ts`'s manual `if (result.status ===
400) ... else ...` branching were both pure indirection around a plain
ternary (`result.status === 400 ? c.json(...) : c.json(...)`) that
type-checks identically and reads shorter - simplified to that shape
everywhere.

**`auth.ts` deliberately left unconverted.** Its `verifyAgainstRecord()`
helper builds and returns a `Response` directly (via a generically-typed
`Context<AppEnv>`, not a route-specific one) from inside a function
shared by `/verify-secret` and `/change-secret` - two routes with
different declared response shapes. Converting it properly means
restructuring that helper to return a discriminated result each route's
own typed handler turns into its own `c.json(...)` call, not a
mechanical translation like the other five files - real, but genuinely
different risk for session/credential-verification code specifically,
the exact case docs/dev.md's own "API routes and @hono/zod-openapi"
note already warned about ("converting the framework mid-feature-work
risks introducing bugs in already-correct, already-tested code"). Left
for a dedicated pass rather than rushed; `docs/BACKLOG.md` tracks it as
the one remaining file.

## Step 5: trust on the LAN

**A real gap, resolved by asking rather than guessing:** this step's own
text asks for mDNS TXT fields "from plan 7.1," but the platform plan
itself isn't checked into this repo (or its sibling `.github` checkout) -
only its DERIVED artifacts are (`docs/dev.md`, `docs/BACKLOG.md`, the
spec, this session's own plan files). The `design-resolver` agent
(Read/Grep/Glob/Bash only) couldn't have resolved this either - it's not
an ambiguity a closer reading fixes, the source document is genuinely
absent. Asked Jesse directly rather than guess at a trust/discovery
mechanism's exact shape; his answer: design it. `lib/mdns.ts`'s own
header documents the four fields chosen (`id`, `name`, `tls`, `v`) and
why.

**`lib/hubIdentity.ts`:** ported from the archived legacy hub, adapted to
this repo's synchronous SQLite pattern (legacy's version was async, going
through the household `getAppSetting`/`setAppSetting` store). Deliberately
NOT the household settings store despite that being the obvious-looking
place: `instance_id` must never be user-editable through a generic `PUT
/api/settings` the way a household's own preferences are - rotating it
would sign out every device that has it cached, and the settings
registry's own schema (`spec/schemas/settings-key.schema.json`) has no
"read-only" concept to prevent that. A new single-row `hub_identity`
table instead (`db/schema.ts`'s own comment has the full reasoning),
hub-internal like `scheduledJobs`/`commands`/`notificationDeliveries`.

**`lib/hubEndpoints.ts`:** also ported from legacy (detected LAN/Tailscale
addresses merged with admin-managed rows, deduped by URL, sorted by
priority), adapted the same way - synchronous SQLite, a new
`hub_endpoints` table. `detectLanIps()` is exported specifically so
`lib/householdCa.ts`'s leaf certificate covers the same addresses this
file offers clients, without a second, independent detection pass that
could quietly drift from the first.

**`lib/tailscale.ts` (new):** "detects an existing daemon and never
installs one silently," per this step's own text - `getTailscaleStatus()`
shells out to `tailscale status --json` and reports `not_installed` on
any failure (missing binary, timeout, malformed output), never throwing.
The JSON interpretation is a pure, exported function
(`interpretTailscaleStatusJson`) unit-tested against synthetic output,
the same split `lib/dirtyBoot.ts` established for its own OS-signal
parsing.

**`lib/householdCa.ts` (new), the household CA and leaf certificate:**
`node-forge` (dual BSD-3-Clause/GPL-2.0 - used here under the BSD-3-
Clause option, which is AGPL-compatible) mints a self-signed root CA on
first use and a leaf certificate for `maipai.local` plus every detected
LAN IP, signed by that CA. Node's own `node:crypto` can verify and parse
X.509 but has no high-level "mint a CA, sign a leaf with it" API - the
hand-built alternative (raw ASN.1/X.509 encoding) is exactly what
principle 6 says to avoid. Both key files are 0600 under `data/keys/`,
the same trust boundary `lib/keystore.ts`'s own keys already use, never
in the database and never returned by any route - `GET /api/setup/ca`
serves only the CA certificate, checked by a real test that asserts the
response body never contains the words "PRIVATE KEY". `ensureHouseholdLeaf()`
regenerates the leaf when it's within 30 days of expiry OR no longer
covers every currently-detected address (a DHCP change, a new
interface) - both checked by real tests using `node-forge` to construct
a synthetic already-expired leaf under the real CA, proving the
regeneration path actually triggers rather than trusting whatever's
already on disk.

**A real bug caught by this file's own test, not a review pass:**
`registerFixHandler("renew_household_leaf", ...)` was originally called
once at module import time - which worked in isolation, but broke the
moment ANY OTHER test file in the same `bun test` process (every file
shares one process, and a module's top level runs exactly once) called
`__resetFixHandlersForTests()` in ITS OWN `beforeEach`. That wipes the
shared `fixHandlers` map for the rest of the run, permanently losing an
import-time registration nothing ever redoes. Fixed by moving the
registration into a small idempotent `registerRenewFixHandler()` called
from both `ensureHouseholdLeaf()` and `checkLeafExpiry()` - the same
"register inside the function real callers actually invoke, not at
import time" shape `lib/sidecars.ts`'s `registerSidecar()` already
established for the identical reason, just not one this file followed
the first time. Worth a general note for any future module that
registers a fix handler: import-time registration is incompatible with
this test suite's existing reset pattern the moment more than one test
file touches the shared map, which is every `bun test` run.

**Wiring into the boot path (`index.ts`):** TLS is a boot-time decision,
not per-request - `hasHouseholdLeaf()` is checked once, before the
server binds, and the exported default gains a `tls: { cert, key }` key
only when a leaf already exists on THIS install's own data directory.
Nothing auto-mints one: every other session's dev server (and every test
run, which never calls `GET /api/setup/ca`) keeps serving plain HTTP
exactly as before this step. `lib/mdns.ts`'s advertisement is
fire-and-forget at boot, reporting whether TLS is active in its own TXT
`tls` field. A new daily core job (`householdCa.check_leaf_expiry`,
registered in `lib/scheduler.ts` - D's file, one additive entry with the
same "each session's block, clearly commented" shape `db/schema.ts`
already uses) runs `checkLeafExpiry()`.

**Verified live, not just in the test suite:** hit the running
`home-f` dev server's `GET /api/setup/ca` directly - a real CA and leaf
minted on disk with correct permissions (0600 on both keys, 0644 on both
certs), a real parseable certificate came back over the wire. Cleaned up
the resulting key files immediately afterward: minting a leaf on a
running dev server that OTHER tooling (the Vite proxy, hardcoded to
`http://localhost:8804`) expects to keep speaking plain HTTP would have
broken that proxy on the server's next restart, since this step's TLS
decision is boot-time-fixed. A real, easy-to-miss operational trap for
whoever exercises this endpoint against a live dev instance rather than
the isolated test suite.

**What's deferred:** the frontend "trust this hub" page (a device
downloading the CA cert and following `installHint`, rendering
`qrPayload` as an actual QR image) is E's kit work, not built here -
`GET /api/setup/ca` ships the data, not the UI. The rest of the setup
wizard's routes (`GET /api/setup/state`, `POST /api/setup/:step` for
household/owner/acknowledgment/hardware/packages/remote/emergency_kit/
backup/done) land with the steps that build what each one configures.
A Windows firewall rule for mDNS (this step's own text: "a firewall rule
added by the installer on Windows") is step 11's install-script work,
not backend code.

**A code review (2026-09-06) before this step's commit found eight real
issues, all fixed:**

1. **The running server never picked up a renewed leaf.** The original
   boot code used `export default { port, fetch, tls }`, which Bun reads
   once at the initial `Bun.serve()` call - a certificate renewed later
   (the Repairs "Renew now" fix, or the daily expiry job catching a stale
   one) rewrote the files on disk while the live process kept presenting
   the OLD certificate until a full restart. Fixed by switching to an
   explicit `Bun.serve()` call that keeps the returned `server` handle,
   plus a new `onLeafRenewed()` hook in `lib/householdCa.ts` that fires
   only when `ensureHouseholdLeaf()` actually mints a new leaf (never on
   a cache-hit) so `index.ts` can call `server.reload({ tls: ... })` in
   place.
2. **`GET /api/setup/ca` was unauthenticated and unthrottled** despite
   spawning a `tailscale status` subprocess on every call
   (`getTailscaleStatus()`, via `listHubEndpoints()`) - an attacker on the
   LAN could otherwise hammer the hub into spawning subprocesses as fast
   as it could accept connections. Fixed with `lib/rateLimiter.ts`'s
   existing token bucket, keyed per client IP (10 burst, 0.5/s sustained -
   "a person's pace" for a step someone hits a handful of times while
   working through the wizard).
3. **`lib/hubEndpoints.ts`'s `guessEndpointKind()` had reimplemented
   `ssrfGuard.ts`'s private/loopback classification** with its own
   narrower regex, missing `169.254.0.0/16` (link-local, including the
   cloud-metadata address `169.254.169.254`) and `0.0.0.0/8` entirely -
   both misclassified as `public`. Fixed by exporting and reusing
   `ssrfGuard.ts`'s own `isPrivateOrLoopbackIpv4()` instead of a second,
   narrower copy - the exact "one definition, one place" bug class that
   file's own header already calls out for `host.fetch`.
4. **`checkLeafExpiry()` only ever checked expiry**, never whether the
   leaf still covers the machine's current addresses - a LAN address
   change (a new DHCP lease) between two `GET /api/setup/ca` calls would
   go unnoticed by the scheduled job forever. Fixed by adding the same
   `certCoversAllNames()` check `ensureHouseholdLeaf()` already used,
   raising it under its own `leaf_stale` issue key so a household can
   tell "expiring soon" and "no longer covers this address" apart.
5. **The mDNS advertisement's `tls` TXT field never refreshed** after a
   leaf was renewed - a hub that went HTTP -> HTTPS mid-uptime (or the
   reverse, though that shouldn't happen) kept advertising the value from
   boot forever. Fixed by the same `onLeafRenewed()` hook as (1): it also
   re-calls `advertiseMdns({ tls: true })`.
6. **`nextEndpointPriority()` started at 10** - identical to
   `DETECTED_LAN_PRIORITY` - so a fresh install's first managed row tied
   with the detected LAN entry instead of sorting after it as this file's
   own stated design intends. Fixed to start past
   `DETECTED_LAN_PRIORITY`.
7. **`qrPayload` fell back to `c.req.url`** when no endpoint was
   detected - the request's own Host header, which on a loopback or
   reverse-proxied request encodes an address a second device could never
   reach, defeating the entire point of a QR code meant to be scanned by
   that other device. Fixed by making `qrPayload` nullable and returning
   `null` when nothing reachable was detected, rather than a
   guaranteed-wrong URL.
8. **`lib/issues.ts`'s own header comment recommended the exact pattern
   that caused the `registerFixHandler` bug** described above ("a source
   registers once at import time"). Fixed by rewriting that comment to
   warn against import-time registration and point at
   `registerSidecar()`/`registerRenewFixHandler()` as the pattern to copy,
   so the next module that registers a fix handler doesn't rediscover
   this the hard way.

Findings 4 and 6 each needed a real test fix, not just a code fix: the
existing `checkLeafExpiry()` "expiring soon" test hand-crafted a
certificate with no `subjectAltName` at all, which after (4) also tripped
the new coverage check, turning one issue into two and failing
`toHaveLength(1)`. Fixed by giving that test's certificate a full,
matching SAN, and adding a separate test that isolates the `leaf_stale`
path with a far-from-expiry certificate covering the wrong address
entirely.

**A second review pass (2026-09-06), run fresh over the diff after the
first round of fixes above, found finding 1 was still wrong and turned up
four new issues - all fixed:**

1. **`server.reload({ tls })` (fix 1 above) doesn't actually work.**
   Verified empirically (not just from reading Bun's docs, which only
   name `port`/`hostname` as having no effect): a minimal `Bun.serve()` +
   `reload({ tls: newCert })` kept presenting the original certificate's
   CN. The real fix, also verified empirically -
   `tests/tlsHotSwap.test.ts` proves both halves - is a graceful
   `server.stop(true)` (finishes in-flight requests) followed by a fresh
   `Bun.serve()` on the same port, which does pick up the new cert
   immediately. `index.ts`'s `onLeafRenewed()` handler now does that
   instead. There's no process supervisor yet to hand a full restart to
   (that's step 11's install/service work), so this brief in-process
   rebind - once every ~11 months in the ordinary case, or the moment
   "Renew now" runs - is the honest option available today.
2. **`registerRenewFixHandler()` was never called at boot.** It was
   still only reachable from inside `ensureHouseholdLeaf()`/
   `checkLeafExpiry()`, neither of which the boot path calls (it only
   checks `hasHouseholdLeaf()`, a pure existence check) - so a
   `leaf_expiring`/`leaf_stale` issue surviving a restart from a previous
   process run had no working "Renew now" fix until the daily job or a
   setup-page hit happened to register one. Fixed by exporting the
   function and calling it unconditionally in `index.ts` at boot.
3. **The CA and leaf private keys were written as raw plaintext PEM.**
   CLAUDE.md's Credentials and secrets section is explicit: "any
   reversible secret the app stores... is encrypted with the keystore...
   never plaintext in a table or JSON file." Fixed by routing both key
   files through `lib/secrets.ts`'s existing `encryptSecret()`/
   `decryptSecret()` (AES-256-GCM, key from the same keystore
   `lib/keystore.ts` already uses) - the file on disk is never the
   plaintext key.
4. **`detectLanIps()` (hubEndpoints.ts) only excluded loopback
   addresses, never actually-public ones.** A hub with a NIC bound
   directly to a public IPv4 address (a cloud VM, an unfiltered WAN port)
   would have that address baked into the household CA leaf's SAN and
   offered to clients as a candidate endpoint, silently expanding "trust
   on the LAN" past the LAN. Fixed by reusing `guessEndpointKind()`'s own
   classification to skip anything it calls `"public"` - and while in
   there, `isPrivate()` (which had reimplemented the same
   parse-then-classify steps as `guessEndpointKind()` a few lines above,
   in the same file) was simplified to just call it.

Two more, lower severity, fixed in the same pass:

- **`ensureHouseholdLeaf()` ran synchronous RSA-2048 keygen
  (node-forge, pure JS) directly on `GET /api/setup/ca`'s request
  handler**, blocking Bun's single event loop - every other household
  member's request stalls for however long keygen takes, which can be
  well over a second on Pi-class hardware (a realistic hub target).
  Fixed by generating the key pair with `node:crypto`'s async
  `generateKeyPair()` (genuinely offloaded to libuv's threadpool, unlike
  forge's own synchronous generator) and importing the resulting PEM
  into forge only to build and sign the X.509 structure, which is cheap.
  `ensureHouseholdCa()`/`ensureHouseholdLeaf()`/`getHouseholdCaCertificate()`
  are async now for this reason; the disk-read fast path (the common
  case, nothing needs regenerating) stays synchronous underneath.
- **Certificates had no clock-skew backdating.** `notBefore` was the
  exact instant of generation, so a client whose clock lags the hub's
  (common on phones and embedded devices) could see a freshly-minted
  certificate as "not yet valid" and refuse it - the same reason mkcert
  (this file's own comparison) backdates. Fixed with a 5-minute backdate
  on both the CA and leaf.
- **The QR payload fallback (fix 7 above) still wasn't quite right.**
  `endpoints.find(e => e.kind === "lan") ?? endpoints[0]` could still
  pick a non-LAN `endpoints[0]` (a Tailscale or admin-added public row)
  when no LAN endpoint existed. Fixed by dropping the `?? endpoints[0]`
  fallback entirely - no LAN endpoint means `qrPayload` is `null`, never
  a URL a device on the physical LAN but off the tailnet could never
  reach.

Both review passes ran as an actual `/code-review medium` subagent, not
an inline read-through - the second one specifically re-ran fresh over
the diff after the first round's fixes, which is exactly what caught
that fix 1 hadn't worked. One process note from that run: one of its own
finder subagents (general-purpose, full tool access) went beyond its
"report only" brief and applied working-tree edits, then reverted them
(`git checkout --` plus deleting a new test file) before finalizing
findings - reported here because it happened, not because it changed the
findings above (they were re-verified against the code as actually
committed).

## Step 6: passkeys, device tokens, Quick Connect, sessions

**The Device record (`spec/schemas/device.schema.json`):** a physical
device the household has paired - kind (`robot | pod | tv | phone |
desktop | browser`), name, area, capabilities (drawn from
`spec/vocab/capabilities.json`, same convention `manifest.schema.json`'s
`requires`/`optional` use), `person_id` (whoever paired it), `watermarks`
(always `{}` until Wave 3's link exists - laid now purely so the shape
doesn't need a migration when it does), `hlc`. A Device row is created
the moment a device token is minted for it (`lib/deviceTokens.ts`'s
`issueDeviceToken()`, always alongside `lib/devices.ts`'s
`createDevice()`) - there is no standalone "register a device" step;
pairing and token issuance are the same moment.

**`lib/deviceTokens.ts`:** ported from the archived legacy hub's
`deviceToken.ts` (principle 8), adapted to this repo's synchronous
drizzle pattern and to the new Device row (legacy stored label/platform
inline on the token; here they live on Device, since a token and its
Device are the same pairing moment). 365-day expiry, 20 per person with
oldest-first eviction, sha256 stored, the raw value returned exactly
once. `POST /api/auth/devices/redeem` (`routes/deviceAuth.ts`) is the
other half legacy's own header names: "trades it for a session cookie on
whichever address answered" - public by design, since redeeming IS the
authentication, not a step after it.

**`lib/quickConnect.ts`:** also ported from legacy, with one real
security fix and one addition legacy didn't have:

- **`code` and `poll_token` are two different secrets**, not one -
  legacy's version let anyone who saw the code (shoulder-surfed off a TV
  screen) poll for the result themselves and steal the session meant for
  the TV, before the TV's own poll ever ran. The device gets both back
  from `POST /api/auth/quick-connect/code`; only `poll_token` can ever
  redeem an approval, `code` is only ever typed by the approving phone.
- **Rate limited from the start** (`lib/rateLimiter.ts`'s token bucket) -
  BACKLOG.md's own audit had flagged legacy's `/pair` as unlimited.

**`lib/passkeys.ts` (new), `@simplewebauthn/server`:** registration is
self-service on an already-signed-in profile (add a passkey to my own
account) - there is no passkey-only account-creation flow this wave;
`POST /api/auth/setup` still mints the owner with a PIN/password, and a
passkey is offered as an enhancement afterward. WebAuthn ceremony
challenges are in-memory, one per person, one-shot (the same "worthless
after a restart, expires in minutes anyway" reasoning `lib/quickConnect.ts`
already established for its own pending requests). rpID is fixed at
`maipai.local` (the household CA leaf's own primary SAN entry, step 5) -
WebAuthn requires rpID to be a valid domain string, and browser support
for IP-address rpIDs is inconsistent - while every detected LAN IP is
still accepted as a valid *origin* for the ceremony.

**`lib/totp.ts` (new), `otpauth`:** optional second factor for owner and
admin only (4.1). The shared secret is AES-256-GCM-encrypted via
`lib/secrets.ts` before it ever touches disk, the same treatment
`householdCa.ts`'s private keys got after step 5's own review found them
plaintext. Enrollment isn't complete until a real generated code
confirms it (`enabled` stays `false` otherwise) - a person who never
finished scanning the QR must not get locked out of their own next
sign-in.

**Sessions per device (`routes/authSessions.ts`):** `GET/DELETE
/api/auth/sessions`, scoped to the signed-in person's own browser
sessions (device-token-backed native clients show up under
`GET/DELETE /api/devices` instead - a native client's persistent
identity is its device token, not a short-lived cookie).
`sessions.userAgent` is captured once at issue time
(`lib/session.ts`'s `issueSession()`) so the list has something
recognizable to show ("Chrome on macOS") without re-parsing anything
live.

**`personCredentials.secretHash` became nullable:** a passkey-only
person (4.1: "the owner with a passkey or password") has no PIN/password
row content at all, but the shared lockout counter
(`lib/credentialLockout.ts`, split out of `lib/secret.ts` so passkey
failures share the identical exponential-backoff curve a PIN/password
does) still needs a row to live on. `lib/personAuthMethods.ts`'s
`getAuthMethods()`/`requiresCredential()` are the one place "does this
profile need more than a bare tap" gets answered, spanning both
`personCredentials.secretHash` and `passkeyCredentials` - `/profiles`,
`/me`, and `/select` all went through this file to use it consistently
rather than three slightly different inline checks.

**A code review (2026-09-06) found seven issues on the first pass, all
fixed:**

1. **`/api/auth/totp/challenge` was callable standalone**, cold, with no
   PIN/password/passkey ever verified first - `personId` is discoverable
   via the public `GET /api/auth/profiles`, so only per-IP throttling
   protected the 6-digit guess. Fixed by applying the same shared
   per-person lockout (`lib/credentialLockout.ts`) every primary-factor
   ceremony uses, keyed on `personId` directly.
2. **Quick Connect's poll route minted a full session and a 365-day
   device token with no TOTP check anywhere**, even for an owner/admin
   with TOTP enabled - unlike `/verify-secret` and `/authenticate/verify`,
   both of which gate session issuance on it. Fixed at the *approval*
   step instead (`POST /api/auth/quick-connect/approve` now requires a
   current TOTP code when the approver has it enabled) - approving a
   device is exactly the privileged, long-lived-credential-granting
   action TOTP exists to protect. `POST /api/auth/devices/redeem`
   deliberately still never re-checks TOTP: that is the standard
   "remembered device" shape every mainstream implementation uses
   (redeeming is silent by design, so a native client isn't re-prompted
   for 2FA on every reconnect); the security control belongs at the
   moment the device was paired, not at every later use of what pairing
   produced.
3. **`hasSecret()` (`lib/personLifecycle.ts`)**, the check behind
   `routes/people.ts`'s "an owner/admin needs a PIN or password before
   promotion" guard, **returned `true` for any `person_credentials` row**,
   including one that exists only to hold a passkey-only person's shared
   lockout counter (`secretHash: null`) - silently letting that profile
   be promoted to admin/owner with no real PIN/password ever set. Fixed
   the bug (checks `secretHash != null` now) and, since 4.1 says a
   passkey is an equally strong credential for this exact guard, changed
   the caller to `requiresCredential()` (PIN/password OR passkey)
   instead of the narrower `hasSecret()`.
4. **`routes/passkeys.ts`'s authenticate/verify failure path called
   `ensureCredentialRowExists(personId)` before ever checking `personId`
   was real** - `person_credentials.person_id` references `people.id`
   under an enforced foreign key, so a routine "unknown profile" probe
   threw an unhandled `SqliteError` (a 500) instead of a clean 404. Fixed
   by checking the person exists first, before any lockout bookkeeping.
5. **`verifyTotp()`/`verifyEnrollment()` were stateless** - a code stays
   valid for its whole ~90-second window and could be resubmitted any
   number of times within it. Fixed per RFC 6238 section 5.2's own
   recommendation: a `last_used_step` column, refusing anything at or
   before the last step actually accepted.
6. **`POST /api/auth/passkeys/authenticate/options` was unthrottled** -
   it stores a fresh ceremony challenge keyed only by `personId`,
   one-shot and *overwriting* whatever was pending, so an attacker who
   knows a victim's `personId` could hammer this to keep clobbering
   their pending challenge, denying that person's own concurrent
   sign-in. `secretThrottle`'s throttleCheck/throttleFail pair was the
   wrong tool (it only ever blocks after a wrong-answer failure records
   one, and generating options never fails that way) - fixed with
   `lib/rateLimiter.ts`'s token bucket instead, keyed on the *target*
   `personId` rather than the caller's IP, which also closes the
   rotating-IP evasion a per-IP limiter would have left open.
7. **`routes/auth.ts` stayed a plain `Hono()` router** despite being
   heavily rewritten in this same diff (new `hasPasskeys`/`totpRequired`
   fields, rewritten `/select`, `/verify-secret`, `/me`,
   `/change-secret`) - every other new route file in this step already
   used the required `@hono/zod-openapi` style. Converted in full;
   `verifyAgainstRecord()` (the shared PIN-check helper `/verify-secret`
   and `/change-secret` both call) now returns a plain
   `{ status, body }` result instead of calling `c.json()` itself, since
   a shared helper's `Response` couldn't typecheck against each
   converted route's own distinct declared response union.

**Verified real, not just asserted:** the TOTP tests use `otpauth`'s own
`TOTP`/`Secret` classes to generate real, currently-valid codes against
the actual secret `beginEnrollment()` minted (parsing the returned
`otpauth://` URI, not a hand-extracted regex) - proving the QR a person
would actually scan produces codes this hub actually accepts, and that
the anti-replay fix genuinely rejects a reused code rather than merely
asserting a mocked function was called correctly.
