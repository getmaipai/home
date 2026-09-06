# Session D: packages, the store, the catalog

Work order: `docs/plans/session-d-packages-and-store.md`. Rules and
ownership: `docs/plans/wave-2.md`. One `## Step N:` section per shipped
step, in order.

## Step 0: setup and verdicts

Worktree `../home-d`, branch `session-d-packages-and-store`, data dir
`data-d`, port 8802. `bun install` and `scripts/check.sh` both green on
branch-off from `main` (f4056a7).

**A note on sequencing.** `wave-2.md` says D may start once Session A has
merged to `main`. At the time this worktree was cut, A had not merged
(steps 11-12 of `session-a-intelligence.md` still open in its own
worktree). Checked before proceeding: D's owned paths
(`backend/packages/**` except `remember`/`recall`, the `lib`/`routes`
files in the ownership map, `spec/interpreters`, `spec/emulators`,
`spec/vocab`) do not overlap any file A's diff touches. The one shared
file both sessions edit is `spec/schemas/manifest.schema.json`, and A's
change there (a new top-level `companion` object) is purely additive,
sitting beside where D's step 2 additions land - the exact "additive
only, rebase first" shape the shared-file protocol already accounts for.
Proceeding now, and rebasing onto `main` (picking up A's merge when it
lands) before every commit per the standing rule, rather than blocking
on a merge that touches nothing D owns.

**Scope of this review queue.** `docs/BACKLOG.md`'s "Legacy: copy,
re-examine, record" section lists one giant verdict queue spanning every
session's territory (media apps, the Electron desktop, bot firmware, DNS
filtering, and so on, alongside the ~35 orphaned chat tools). Verdicting
UI, platform, and hardware items outside this session's expertise and
file ownership would be the design-resolver's job or another session's,
not a rubber stamp from here. This section verdicts only what maps to
D's lane: legacy chat tools and hub features that are packages, package
categories, or store/catalog-shaped. Everything else in that queue is
left for the session that owns the matching files (E for UI/apps, F for
platform/hardware/desktop, C for voice/bot); noted below by name so nothing
silently falls through, not re-verdicted.

### Verdicts: legacy chat tools -> Wave 2 packages

One line each, per principle 8. "Rebuild" means the package below
reimplements the same user-facing capability from scratch (Tier 0 recipe
or Tier 1 code), never legacy's own code. "Redesign" means several
legacy tools become one differently-shaped package. "Drop" means no
package this wave, with the reason. Source: `legacy-backups/home-legacy.git`
`backend/src/tools/` (read-only, for verdicts and hard-won-logic pointers
only, never for scope - org rule).

| Legacy tool(s) | Verdict | Reason |
|---|---|---|
| `search.ts` | **Rebuild** | Web search, step 7. Legacy's own scraper ladder (`webSearch.ts`) is the counterexample the org's "we are the user" rule names by file; the new package goes through SearXNG as a sidecar, never keyless scraping. |
| `unit_conversion.ts` | **Rebuild** | Unit/currency conversion, step 7, as a `compute` step (mathjs) plus frankfurter.app for live rates - the unit table itself is worth reusing as reference, the fetch-a-scraped-page shape is not. |
| `calculator.ts` | **Rebuild** | Math, step 7, as a `compute` step over a restricted `mathjs` evaluator - a maintained library replaces the hand-rolled parser (org principle 6). |
| `news.ts` | **Rebuild** | News headlines, step 7, RSS from a household-chosen list, cached and warmed. Legacy's Google News RSS + category map is a reasonable reference for the RSS-parsing shape; no keyed API, per the plan. |
| `localNews.ts` | **Drop** | Depends on a US "Patch" hyperlocal slug resolver with no equivalent data source decided; folding a location-specific feed into the plain `news` package needs a design decision (a location setting, a source with global coverage) not made this wave. Filed as a backlog gap for the household-location work, not built. |
| `sports.ts` | **Rebuild** | Sports scores, step 7, a free key-free scoreboard API or RSS (the plan defers the exact source to the build step); legacy's league-keyword matching is worth reusing as reference. |
| `musicInsights.ts` | **Drop** | Answers questions about *the household's own local listening history* (`music_history` table) - a different feature from step 7's music/media metadata lookup, and depends on a listening-history feature this wave doesn't build. Not the same package; no verdict needed until listening history exists. |
| `videoAbout.ts`, `onTv.ts`, `showtimes.ts`, `whereToWatch.ts`, `tvshows.ts` | **Drop** | Priority 3 (control/playback-adjacent media) by the backlog's own lookup-before-control rule; blocked on the media player runtime (plan 4.8, Hub v0.2) this wave doesn't touch. `music_and_media` (step 7) covers only the metadata-lookup half (MusicBrainz/TMDB-style), explicitly never playback. |
| `datetime.ts`, `holidays.ts`, `moonphase.ts`, `onThisDay.ts` | **Redesign** | Merge into one `almanac` package (step 7's own name for this: "legacy had five tools for this"). `time.ts`'s date-parsing half (`chrono-node`) is genuinely reusable hard-won logic; its alarm/timer-row half moves to `lists` below instead, since alarms need no separate app surface here, just `host.schedule`. |
| `time.ts` | **Redesign** | Split: natural-language time parsing feeds `almanac`'s date/time answers; the alarm/timer *creation* half is superseded by `lists`' reminders/timers (step 8), which uses `host.schedule` directly rather than a dedicated `clock_timer_runs` table - no live-countdown UI exists in this wave to poll one. |
| `shopping.ts` | **Redesign** | Legacy's version is price-tracking (a URL, tracked listings, price drops) - a different feature from step 8's household shopping list. Step 8's `lists` package is the rebuild target for "add milk to the shopping list"; legacy's price-tracking shape is dropped (no design decision on a price-tracking data source this wave). |
| `homeAssistant.ts` | **Rebuild** | Already partially shipped in Wave 1 (`packageHost.ts`'s `home.call_service`, the security-domain gate, `lib/commands.ts`). Step 9's `lights` package is the first real recipe-driven consumer. Legacy's own NLP-against-a-live-catalog approach is superseded entirely by the manifest/permission model; nothing of its code carries over. |
| `knowledge.ts` | **Rebuild** | The Tier 1 knowledge-lookup package, step 5's proving package for the Deno sandbox: offline Wikipedia via a local Kiwix ZIM when present, web search otherwise. Legacy's ZIM-search-then-web-fallback order is the one piece of hard-won logic worth carrying the *shape* of, not the code (new host, new sandbox, new RPC). |
| `fetchUrl.ts` | **Drop** | Superseded by `host.fetch` as a general capability every package already has; a dedicated "open this link" package adds nothing `host.fetch` plus a `format` step doesn't already cover once a package wants it. No standalone package. |
| `maps.ts` | **Drop** | Not in step 7's package list; needs a decision on an offline map/routing data source (GraphHopper regions, MapLibre tiles) this wave doesn't make. Filed as a backlog gap, not built. |
| `localEvents.ts` | **Drop** | Same hyperlocal-data-source gap as `localNews.ts`; no verdict until a location/local-data decision is made. |
| `peopleLookup.ts`, `propertyLookup.ts` | **Drop** | Reverse-lookup of *other people's* address/phone/property records has no articulated family use case in the platform plan or backlog, and sits uneasily against the product's own privacy promise (a private family hub looking up strangers). Not built; flagged for Jesse if the feature is actually wanted, rather than built on assumption. |
| `medical.ts` | **Drop** | Liability-sensitive (medical reference/advice) with no design review of disclaimers or scope; same posture as image/video generation's "needs real design attention before any code." Not built this wave. |
| `recipes.ts` (meal database) | **Drop** | Not in the backlog's Priority 1/2 lists; no household ask recorded for it. Left for a future wave if requested. |
| `homeInventory.ts` | **Drop** | Not in step 7-9 scope; no spec record type exists for tracked household items and no ask recorded. Future wave. |
| `confirmPending.ts` | **Not D** | Runtime confirmation of a consequential action is the turn engine's job (backlog: "Consequential packages need a confirmation at run time", owned by C). D's part is already done: `consequential: true` plus the security-domain gate in `packageHost.ts`. |
| `createRoutine.ts` | **Drop, superseded** | The `command` primitive (`lib/commands.ts`, shipped Wave 1) already covers "when I say X, do Y" with a lighter authoring path than a legacy routine ever had. |
| `recallConversations.ts`, `memory.ts` (tool) | **Not D** | Superseded by C's real memory/conversation system (`lib/memory.ts`, `lib/conversationHistory.ts`), already shipped. |
| `narrate.ts` | **Not D** | Superseded by the `storytime-style` skill (already bundled, `kind: "skill"`) plus the persona/TTS system - C and E's territory, not a plugin. |
| `playMusic.ts`, `curatePlaylist.ts`, `plex.ts`, `youtube.ts`, `requestMedia.ts` | **Drop** | Priority 3 playback control, explicitly deferred by the backlog's own rule until the Priority-1 lookups and the media player runtime exist. Not this wave. |
| `imageGen.ts`, `videoGen.ts` | **Not D** | Generation features; the org's non-removable child-safety invariants mean these need dedicated design attention before any code (backlog: "deliberately not started"). Not a packages-lane question. |
| `calendar.ts` | **Not D (needs a decision)** | Local-only vs. real CalDAV/OAuth is an open design question per the backlog; belongs with whichever session picks it up after a `design-resolver` pass, not built speculatively here. |
| `documentEdit.ts`, `canvas.ts`, `coding.ts` | **Drop** | Advanced tool-calling / Tier 2 territory (backlog: "explicitly NOT an open agentic loop by design"), sequenced behind `embed`-based routing and more real Tier 0/1 skills. Not this wave. |
| `bookmarksLibrary.ts`, `saveToBookmarks.ts` | **Drop** | Needs a bookmarks library/reader app surface (E's domain) this wave doesn't build; a bare "save a link" package with nowhere to view it back is not a complete feature. Future wave, paired with the app. |
| `displayAlert.ts`, `setStatus.ts`, `sleep.ts`, `machineStatus.ts`, `serviceStatus.ts`, `downloadStatus.ts`, `dockFiles.ts` | **Not D** | Platform health/status/robot-state surfaces - F's (`health`, `repairs`) or C's (bot sleep state) lane, not packages. |

### Verdicts: legacy hub features outside D's lane (named, not re-verdicted here)

Per the scope note above, these stay with the session that owns the
files: MaiPai TV linear channels, Music Studio/karaoke/stems, Podcasts,
Books/readers/OPDS/KOSync, Reference (Kiwix ZIM as an *app*, distinct
from the `knowledge` package's own ZIM use above), Remote (SSH/VNC/RDP),
Notes and voice memos, Photo Frame, Cameras (Frigate), Drop (file
relay), File Converter, Spotlight search, Writing Tools, Watch/Listen
Together, Cast, in-app docs, the Display/HUD pod pages, the DNS filter,
family audio guardrails, storage locations, monitoring, uninstall,
consent records, remote engine pairing, SABnzbd/aria2, ESPHome flashing,
the Electron desktop, Atom Echo/Tab5 firmware, the tvOS Top Shelf
endpoint, Speed Test, "MCP in" (the hub acting as an MCP *server* to an
external client such as Claude Desktop - distinct from step 5's "MCP
out," the hub as MCP *client* to its own Tier 1 packages, which is this
session's to build).

### What step 7-9 build (the "rebuild"/"redesign" verdicts above, concretely)

- `almanac` (redesign, merges `datetime`/`holidays`/`moonphase`/`onThisDay`)
- `web_search` (rebuild, via SearXNG sidecar)
- `convert` (rebuild, compute step)
- `math` (rebuild, compute step)
- `news` (rebuild, RSS)
- `sports` (rebuild)
- `translate` (new; no legacy tool of this name existed)
- `music_media_lookup` (new shape; legacy's closest tools were playback-
  adjacent and dropped above)
- `lists` (redesign, reminders/timers/shopping-and-todo, replacing
  legacy's price-tracking `shopping.ts` and the alarm-creation half of
  `time.ts`)
- `lights` (rebuild, first real `home.call_service` consumer)
- `knowledge` (rebuild, Tier 1, the Deno/MCP sandbox's proving package)

Package ids above are working names, set for real at scaffold time in
each step's own section below.

## Step 1: bronze for real - quality, smoke, cards

Scope: the 5 packages D owns (`define`, `joke`, `trivia`, `weather`,
`storytime-style`). `remember`/`recall` are C's own packages
(ownership map); they still need this same treatment from C.

- **`quality_scale.yaml`**, one per package, in the bronze/silver/gold
  shape docs/PACKAGES.md describes (no prescribed file schema existed
  anywhere in the repo; this is the shape chosen, checked by the new
  spec-level test below): `bronze`/`silver`/`gold` each a map of named
  criteria to `{ met: boolean, note?, date? }`. All 5 packages meet
  every bronze line today; none claim silver (no auth to diagnose, all
  keyless public APIs) or full gold except the four fetch-based ones,
  which record the exact date they were built and manually verified
  against a real third-party response (2026-09-05, already documented
  in each package's own manifest description).
- **`lib/smoke.ts`**: the smoke mechanism, keyed off a manifest's
  `smoke` field:
  - `{ "kind": "static" }` - confirms `loadSkill()`/`loadPackage()`
    succeeds. Used by `storytime-style` (a `skill`: no host, nothing
    else to prove).
  - `{ "kind": "recipe_fixture", "fixture": "<path>" }` - runs the
    package's own `recipe.json` through the production interpreter
    (`spec/interpreters/ts/recipe-interpreter.ts`) against a
    `HostEmulator` seeded from the fixture, and diffs the result
    against `expected`. Deliberately never the real host
    (`packageHost.ts`): a smoke test must be deterministic and offline,
    so it proves the recipe's own logic, not that a third-party API
    happens to be up right now. Used by `define`/`joke`/`trivia`/
    `weather`, each with its own `tests/smoke.json` (the same response
    shapes already captured in `spec/fixtures/recipes/*.json`, copied
    into the package's own `tests/` per the `new-package` skill's
    layout rather than pointed at the spec fixture, since a package's
    tests should be self-contained).
  - `{ "kind": "deno_test" }` - reserved for step 5's Tier 1 host;
    recorded as an explicit failure today so a Tier 1 package can never
    read smoke-clean before the mechanism that would prove it exists.
  - A package with **no** `smoke` field at all is treated as "not yet
    bronze-complete," not a runtime failure - it is neither disabled
    nor does it raise an issue. This matters concretely today:
    `remember`/`recall` have no `smoke` field yet, and the daily/boot
    smoke pass walks every bundled package regardless of owner. Making
    an undeclared smoke check a hard failure would have this session's
    own infrastructure disable another session's packages the moment it
    boots - the bronze *completeness* gate (every package must
    eventually declare one) is enforced separately, at build time, by
    `spec/tests/ts/package-bronze.test.ts`, not at runtime.
  - Persistence: a new `package_status` table (schema v12,
    `db/migrations/0012_woozy_midnight.sql`) - `status` ("enabled" |
    "disabled"), `last_smoke_at`, `smoke_ok`, `smoke_message`. A
    package with no row yet reads as enabled with no history (the
    same "absence isn't failure" default). On failure, `raiseIssue`
    fires (source `"packages"`, key = package id); a later pass that
    passes re-enables the package and calls `resolveIssue`.
  - Runs: once at boot (index.ts - the stand-in for "at install" until
    step 6's real install flow exists), daily via
    `ensureCoreJob("packages.smoke", "every:1d")`, and on demand via
    `POST /api/plugins/:id/smoke` (owner/admin). `POST /api/plugins/:id/run`
    now refuses (403) a disabled package - checked at the route layer,
    not inside `lib/plugins.ts`'s `runPlugin()`, to avoid a real
    circular import (`lib/smoke.ts` -> `lib/plugins.ts` ->
    `lib/packageHost.ts` -> `lib/scheduler.ts`; importing `lib/smoke.ts`
    from `lib/scheduler.ts` directly would have closed that loop the
    same way this file's own header already warns against for
    `runPlugin`). `lib/scheduler.ts`'s `CORE_JOBS` handlers are now
    `() => void | Promise<void>`, awaited; an extra core job (like
    `packages.smoke`) is injected by the caller (`index.ts`) via a new
    `extraCoreJobs` parameter on `runDueJobs`, the same
    dependency-injection shape `runPluginFn` already used, for the
    identical reason.
- **`lib/issues.ts`**: F's step 1 (wave-2.md > "F to C and D: issues and
  sidecars") merged to `main` before this step finished, so `lib/smoke.ts`
  and `backend/tests/smoke.test.ts` import the real `raiseIssue`/
  `resolveIssue`/`listIssues` directly - the planned temporary stub was
  never needed.
- **`GET /api/plugins`** gains the contract's fields:
  `installed_version`, `latest_version` (both just `manifest.version`
  today - no store exists yet to say otherwise, step 6), `channel`
  (`"stable"`, same reason), `status`, and `smoke: { last_run_at, ok,
  message }`.
- **The speech lint placeholder**
  (`backend/tests/speechLint.test.ts`): scans every bundled package's
  `recipe.json` `format` step templates and every `skill` package's
  `SKILL.md` body for an em dash or an exclamation point
  (getmaipai/.github/CLAUDE.md's AI writing standard). Runs against
  every package, not just D's, since a violation is a real defect
  regardless of owner. C's step 6 replaces this with the real lint;
  this file is deleted then.
- **`spec/tests/ts/package-bronze.test.ts`**: the release skill's
  "refuse below bronze" check now has something to read. Walks every
  package under `backend/packages/` except `remember`/`recall` (C's,
  not yet built to this bar) and asserts: 5+ routing examples, a stated
  `offline` value, a `data_sources[]` row for every `net:` permission, a
  declared `smoke` entry, a `README.md`, a `CHANGELOG.md`, and every
  criterion in `quality_scale.yaml`'s `bronze` block reading `met: true`.

Tests: `backend/tests/smoke.test.ts` (9 cases: a real fixture passing
and passing through as enabled, `define`/`joke`/`trivia` each passing
their own fixture, `storytime-style`'s static check, a nonexistent
package failing and disabling itself with a raised issue, a later
passing run resolving that issue, the untested-package default status,
and a full `runAllSmokeTests()` pass counting only real failures),
`backend/tests/speechLint.test.ts` (7 cases, one per bundled package),
`spec/tests/ts/package-bronze.test.ts` (36 cases, 6 per D-owned
package). Every `spec`/`backend` backend-side stage of `scripts/check.sh`
is green.

**A note on `scripts/check.sh`'s frontend stage.** As of this commit,
`main`'s own `frontend: build (includes typecheck)` stage fails - 12
pre-existing `tsc` errors, none in a file this session touches or owns
(`frontend/**` is E's, per `wave-2.md`'s ownership map): `Person` gained
a required `hlc` field in Session A's step 10 that several of E's test
fixtures (`BackupsPage.test.tsx`, `SignIn.test.tsx`, and others) never
picked up, and the turn-stream event union gained a `turn_meta` variant
that `chatModelAdapter.ts`/`runFixedTurn.ts` narrow past without a type
guard. Confirmed by running `tsc --noEmit` against plain `main` before
this branch's own changes touch anything - the failure predates and is
unrelated to this commit. Flagged to Session E twice (2026-09-06) with
no fix landed yet at commit time; not blocking this step on someone
else's file.

What's left for whom: `remember`/`recall` need the identical
`quality_scale.yaml`/`README.md`/`CHANGELOG.md`/`tests/smoke.json`/
manifest `smoke` field treatment from C. The Tier 1 `deno_test` smoke
kind is step 5's to implement.

## Step 2: the manifest catches up with the plan

Spec first, `spec/schemas/manifest.schema.json`, regenerated
(`bun run gen:ts`, `bash scripts/gen-py.sh`), fixture updated
(`spec/fixtures/records/manifest.example.json`), a new
`spec/tests/ts/manifest-fields.test.ts` proving each new shape
round-trips (and rejects an invalid one) since no bundled package
exercises most of these yet:

- **`cache`**: real properties now (`key_template`, `ttl_s`,
  `stale_ok_s`, `max_bytes`), replacing the fully-open placeholder
  object Wave 1 left. `additionalProperties: true` stays - a call site
  can still attach its own extra hints - but `lib/packageCache.ts`
  (step 3) has a real contract to read.
- **`warm`**: `schedule` (the scheduler's own `every:<n><m|h|d>`
  grammar, `lib/scheduler.ts`) and `keys` (recipe inputs to warm with,
  resolved at warm time against household state, never literal values
  in the manifest).
- **`warm_on`** (new): setting-key ids whose change should trigger an
  immediate warm outside `warm.schedule` - e.g. `weather` re-warming
  the moment `household.home_place` changes, instead of waiting for
  the next scheduled tick. Not in `wave-2.md`'s own contract text in
  full detail; this shape (an array of `spec/settings/keys.json` ids)
  is the smallest one that answers "warm on what" without inventing a
  new event-bus concept step 3 doesn't need yet.
- **`contributes`**: changed from an array to an object
  (`additionalProperties: true`, so nav/pages/panels/etc. from plan
  6.1 can still land later without another schema change) with one
  real sub-shape today: **`contributes.widgets[]`**
  (`{ id, title, size: "card" | "row", refresh_s, inputs }`), the
  contract `wave-2.md`'s "D to E: the store, widgets, lists" section
  names. Every bundled package's `"contributes": []` became `{}` (11
  manifests, D-owned and not: `contributes` was an unconsumed
  placeholder everywhere - `grep` found zero real readers beyond a
  `nav.ts` comment describing a future reader - so this is a type
  correction with no behavior to preserve, not a breaking change to
  anything live).
- **`exposes.queries[]`** (C's contract): `{ id, description, args,
  returns }`, typed read queries a package offers beyond its own
  recipe for C's Tier 2 tool-calling router. No package populates this
  yet; C's own step wires the router side.
- **`smoke`**: tightened from a fully-open object to
  `{ kind: "static" | "recipe_fixture" | "deno_test", fixture? }`
  matching what `lib/smoke.ts` (step 1) actually reads, `kind`
  required once `smoke` is present at all.
- **`channel`**: `"stable" | "beta"`, default `"stable"` - the
  publisher's declaration of what a manifest *version* is, not a
  household's own per-package channel choice (that's store-side state,
  step 6).
- **`notifications[]`**: was a bare array of id strings with nowhere
  real to register them; now the same shape as F's own
  `NotificationType` (`id`, `level`, `audience`, `template`,
  `configurable`, `default_channels`), snake_cased per the spec's own
  convention. `id` is namespaced by convention
  (`weather.severe_alert`) so two packages' ids can never collide.
- **`platforms`**: `weather`, `define`, `joke`, `trivia` now declare
  `["home", "bot"]` (previously `home`-only) per the plan's own
  instruction - these four Tier 0 recipes have nothing hub-specific in
  them, so the robot can run them once it has its own interpreter and
  packages directory (not this wave's build, just the manifest fact).

**`registerPackageNotificationTypes`** lands in F's
`backend/src/lib/notificationTypes.ts` as one additive export, per
`wave-2.md`'s own instruction ("the function lands as an additive
export you add in one commit that touches only that export, rebased
first"): a `Map` alongside the existing `NOTIFICATION_TYPES` const
(never mutating that array - it's core's own hand-written literal),
`getNotificationType()` checks both, a package can never shadow a core
id. `lib/plugins.ts` gets the one caller,
`registerAllPackageNotificationTypes()`, run once at boot
(`index.ts`, right before the smoke pass) over every bundled package's
manifest. No bundled package declares a real one yet, so this is
wiring proven by `backend/tests/notificationTypes.test.ts` (a
synthetic package registering, colliding with a core id and losing,
double-registering idempotently) and one boot-safety assertion in
`plugins.test.ts`, not yet by anything visible in the running app.

A code review before this commit caught a real type mismatch here: the
manifest's own `notifications[]` is snake_cased (`default_channels`,
matching every other manifest field's convention) but `NotificationType`
is camelCase (`defaultChannels`) - the first version imported
`NotificationType` for the manifest side too, which passed `bun test`
(no type-checking at runtime) but failed `bunx tsc --noEmit`, and would
have thrown inside `lib/notifications.ts`'s `trigger()` the moment any
package populated this for real (`type.defaultChannels` reading
`undefined` off an object that only ever had `default_channels`). Fixed
with a dedicated `ManifestNotificationType` interface and an explicit
field rename at the one registration point, not by changing either
existing convention.

Tests: `spec/tests/ts/manifest-fields.test.ts` (9 cases),
`backend/tests/notificationTypes.test.ts` (4 cases),
`backend/tests/plugins.test.ts` (1 new boot-safety case). Every
`spec`/`backend` stage of `scripts/check.sh` is green (the pre-existing
frontend gap noted in step 1 is unchanged - still Session E's, still
unrelated to this diff).

What's left for whom: C populates `exposes.queries[]` on the packages
it routes to as a Tier 2 tool; step 3 is the first real reader of
`cache`/`warm`/`warm_on`; step 9 is the first real writer of
`contributes.widgets[]`.

## Step 3: the package cache and warming

`backend/src/lib/packageCache.ts`, one cache per household under
`data/cache/<package>/` (a new `cacheDir` export in `lib/paths.ts`,
same pattern as `modelsDir`/`enginesDir`). Opt-in: a package with no
`cache` field in its manifest is never cached, `host.fetch` calls
straight through exactly as before this step.

**Keying, a real decision, not the manifest's `key_template` literally.**
The schema's own `cache.key_template` (step 2) is a human-readable
naming convention for a package author ("one entry per distinct call"),
but `host.fetch` only ever sees the already-interpolated URL, never the
recipe's own input names (`place`, etc.) that a `{arg}` template would
need resolved against. The actual on-disk key is `sha256(method + "\n" +
url + "\n" + JSON.stringify(body))` - exactly the same "one entry per
distinct call" property, with no second templating engine needed. This
turns out to be the reason the acceptance test below works for free: a
warm run (synthetic inputs) and a live turn that resolve to the
identical URL land on the identical cache entry, no coordination
required. Only `GET` is ever cached - a `POST` through `host.fetch` is
presumed to have a side effect on the third-party service, so caching
one risks serving a stale result for what looks like a fresh action.

**Policy, read from the manifest at request time**: `ttl_s` (fresh,
served with no fetch), `stale_ok_s` (stale-while-revalidate: serves the
old value immediately, kicks a background refetch), `max_bytes` (an
oversized response is never written, not truncated). Sits in front of
the rate limiter and the SSRF check in `packageHost.ts`'s `fetch()`, on
purpose: a cache hit is not a network call, so it should cost neither a
rate-limit token nor a DNS lookup - only a real miss (or an expired
entry) ever reaches either.

**Eviction**: one shared budget across every package's cache combined
(`min(512 MB, 5% of free disk)`, `node:fs`'s own `statfsSync` - no
`df` shell-out, no third-party package, the native capability the
runtime already has, per the org's "prebuilt over hand-built"
principle), oldest-`mtime`-first. LRU rides the filesystem's own mtime
(bumped on every hit) instead of a separate index this module would
have to keep consistent with the files themselves. Deliberately global,
not per-package: the budget is a shared household resource, the same
way disk itself is - one package's own history shouldn't protect its
cold entries from a different package's legitimate growth.
`getCacheStats()` (entry count, size, oldest/newest, hits/misses per
package, from a directory scan plus in-memory hit/miss counters) is
exported for F's `GET /api/storage` to read; not wired into a route by
this session, per the ownership map.

**Warming** lives in `lib/plugins.ts`, not `packageCache.ts`: a
package's `warm.schedule`/`warm.keys` just runs the recipe with
realistic inputs the ordinary way (`runPlugin`), and the already-wired
cache-aware `host.fetch` does the actual caching - warming needed no
cache-specific code of its own. `runDueWarmJobs()` (the body of a new
`packages.warm` core job, `every:15m`, `index.ts`) checks every bundled
package's own `warm.schedule` against an in-memory `lastWarmedAt` clock
(not a DB column - a restart resetting it means a package might warm
sooner than its ideal schedule once after a reboot, never a correctness
problem, the same operational-not-synced posture `lib/engineStats.ts`'s
ring buffer already has) and warms whichever are due, each on its own
independent interval over one shared poll rather than a
`scheduled_jobs` row per package. The actor a warm run executes as is
the household's own owner (falling back down the role ladder, `null` -
warming skipped entirely - on a fresh install with no household set up
yet): warming is a trusted background operation with no real chat
requester to attribute to, and the highest-privileged real person
guarantees `meetsMinRole()` never blocks a warm run a live request from
that same household would also be allowed to make.

**`weather` is the first real package to declare `cache`/`warm`**:
`ttl_s: 1800`, `stale_ok_s: 3600`, `warm.schedule: "every:1h"`,
`warm.keys: [{ "place": "Seattle" }]`. That last value is an honest
placeholder, not the acceptance criterion's literal "household's own
home place" - no household-location setting exists anywhere in this
codebase yet (`grep` confirms it; `warm_on`'s own step-2 example,
`household.home_place`, was itself speculative). Adding one is a real
feature (a settings key, a first-run prompt, a places picker) outside
this step's scope; filed below as a gap for whichever session picks up
household location. The mechanism itself doesn't care what the key is -
the moment that setting exists, `warm.keys` becomes
`[{ "place": "<the household's real setting>" }]` and works exactly the
same way.

**Verified for real** (org standard: "verified also means exercised for
real"), against a running dev server on `data/cache`'s real
`data/`-relative path, real Open-Meteo calls (4 total across two
sessions, well inside a free public API's tolerance for manual
verification): `POST /api/plugins/weather/run` for Seattle, a fresh
`data/cache/weather/` with two entries (the geocode and forecast calls,
each its own cache entry) on the first call, the second call answering
in 17ms (a live network round trip to Open-Meteo takes noticeably
longer) with `getCacheStats()` showing the hit. Separately, calling
`warmPackage("weather")` directly against a bare fresh install
populated the cache from a real fetch with no prior live call, and a
following `POST /api/plugins/weather/run` answered in 31ms - the exact
acceptance test this step names.

A code review before this landed caught three real gaps, all fixed:
`cacheKey()` hashed only method + url + body, ignoring headers
entirely - harmless for today's four fetch-based packages (none vary a
header per call) but a future package whose recipe set e.g.
`Accept-Language` per input would have silently served one input's
cached answer to another's; now headers are sorted by name and folded
into the hash, so order never matters but content always does.
`warmPackage()`'s own docstring promised a warm failure is "logged and
skipped, not surfaced as this function's own failure," but `runPlugin()`
reports most real failures (rate-limited, SSRF-blocked, a bad
`warm.keys` entry failing args validation) as a returned `{ ok: false
}`, never a throw - the `try`/`catch` around it caught nothing, so the
one promise this function makes was silently broken from the start;
now both the `ok: false` and thrown-error paths log. `warmActor()` had
its own hand-written role-priority array duplicating `ROLE_LADDER`
(already imported for `meetsMinRole()`); now it reuses the same one, so
a future role change can't update one call site and silently miss the
other. Also deduplicated `evictIfOverBudget()`'s and `getCacheStats()`'s
own independent reimplementations of the same cacheDir directory walk
into one `walkAllEntries()` (review: "two already drifting in shape").
`warmPackage()` also now takes its manifest from the caller
(`runDueWarmJobs()`, which already loaded it) instead of reading and
re-validating `manifest.json` a second time for the same tick.

Tests: `backend/tests/packageCache.test.ts` (12 cases: pass-through
with no cache policy, a miss then a hit, independent keys per URL, a
POST never cached, an expired-with-no-stale-window miss, stale-while-
revalidate serving immediately then refreshing in the background, an
over-`max_bytes` entry never written, two header cases (a different
header value is a different entry; the same headers in a different key
order are the same entry), hits/misses in `getCacheStats()`, eviction
firing under a pinned test budget and not firing under a real one),
two new cases in `backend/tests/packageHost.test.ts` (a cache hit skips
rate-limit and SSRF entirely - proven by seeding the cache for a
target, `127.0.0.1:9`, that would fail both checks on a real attempt;
no-cache-declared is unaffected), two new cases in
`backend/tests/plugins.test.ts` (a `runPlugin` validation failure - a
warm key missing weather's own required `place`, never touching the
network - is logged, not swallowed; no `warm` field declared is a
clean no-op). `getCacheStats()`'s own eviction-test budget override is
process-wide module state (`__setTestCacheBudgetBytes`), reset in both
`beforeEach` and `afterEach` so a tight test budget can never leak into
a different test file's own cache-writing tests later in the same
`bun test` run.

**Not automated, by the same standard every fetch-based package's own
tests already apply** (no live model or third-party call in the
per-commit suite): the full warm-then-cache-hit path against the real
Open-Meteo API above is manually verified, not asserted in
`bun test`.

What's left for whom: a real household-location setting (gap, above,
unowned this wave); step 6's store install flow is `packages.smoke`'s
own "at install" stand-in's actual replacement, and could reasonably
trigger an immediate warm too, once it exists; step 9's widgets read
straight from whatever `runPlugin` already populated via this cache,
no separate widget-specific cache path needed.

## Step 4: recipes reach further

Spec first (`spec/schemas/recipe.schema.json`, regenerated), three new
recipe steps and one `packageHost.ts` read path:

- **`integration.call`**: `{ as, id, method, args? }`, goes through
  `host.integration.call` - a typed read or action against a household-
  configured third-party integration beyond `home.call_service`'s own
  dedicated, domain-gated write path. Home Assistant's `get_state`
  (`GET /api/states/<entity_id>`) is the first real method behind it,
  reusing `home.base_url`/`home.access_token` settings and the shared
  Home Assistant rate limiter (`requireHomeAssistantSettings()`, pulled
  out of `homeCallService` so both callers share one settings-lookup-
  and-rate-limit path instead of two). Every other `id`/`method` still
  reports `capability_missing`, checked against `integration:<id>`
  first - this is one real method, not a registry pattern built ahead
  of a second consumer. `args`' string values (at any depth) are
  `{variable}`-interpolated before the call, unlike `fetch`'s own
  `body` - found writing this step's own conformance fixture: a recipe
  reading "the porch light" needs the real entity id, not a literal
  `"{entity_id}"`, the way no bundled package's `fetch` body has ever
  needed to vary.
- **`compute`**: `{ as, expression }`, a restricted math/unit evaluator,
  no network call, no host access - backs `math`/`convert` (step 7)
  without either package needing its own fetch-based service for plain
  arithmetic or a unit table. TS: `mathjs` (Apache-2.0, license checked
  before adding) via `create(all, {})` with `import`/`createUnit`
  explicitly disabled - mathjs's own security docs name both as unsafe
  against untrusted expression strings, and a `{variable}` interpolated
  into an expression before evaluation is exactly that class of input
  even though the expression template itself is household-authored.
  Python: no single maintained package does both halves the way mathjs
  does, so `pint` (BSD, unit conversion) plus `simpleeval` (MIT,
  restricted arithmetic - the same "no attribute/name access, no
  import" posture as mathjs's disabled functions) - `pint`'s own string
  parser refuses an offset unit like fahrenheit/celsius ambiguously
  (`OffsetUnitCalculusError`), so the Python side parses the numeric
  value and unit name apart with a regex rather than a single string
  parse. Both sides round to 6 significant digits (unit conversion
  routinely produces a long repeating decimal - `37.77777777777783` for
  100°F to °C - unreadable in a chat reply or spoken aloud) and were
  checked byte-for-byte identical against the same expressions by hand
  before writing the conformance fixtures.
- **`ask`**: `{ prompt, expects? }`, sets the result's existing `ask`
  field (`result.schema.json`, already shaped `{ prompt, expects }`
  from Wave 1, unbuilt until now) so a recipe that can't disambiguate on
  its own ("which Springfield") can ask a deterministic follow-up
  instead of guessing or failing outright - wave-2.md's D-to-C
  contract: "C stores it on the conversation and matches the next
  utterance against it before the floor." Always the recipe's last
  step; the conformance harness (both languages) now asserts `ask`
  alongside `reply`/`actions`, defaulting to `null` for every existing
  fixture that doesn't set one.

**The host.\* audit** (plan 4.9's own list, against what a Tier 0 recipe
can actually reach): `host.log`, `host.config.get` and `host.data.forget`
were already real, just never audited as such - no recipe step had ever
called them, and the plan's own phrasing ("implement the missing
methods that a Tier 0 recipe can reach") reads as "close the gap for
whichever METHODS are still missing," not "add a step for everything a
method exists for." `host.diagnostics()` was the one method genuinely
still `capability_missing`; now real (a package's own id/version/tier/
declared-permissions snapshot - not a live health check per permission,
which is F's Health/Repairs surface's job, not this method's). No new
recipe step calls it, since no bundled package or plan text asks a
recipe to self-report its own diagnostics today; the method itself
being real is what the audit asked for. `files.*`, `speak.sentence`,
`camera.still`, `ocr.read`, `action.emit` and `llm.complete` stay
`capability_missing` - none is reachable from any of the 8 (now 11)
recipe steps that exist, so none was in this audit's scope.

Tests: `spec/tests/ts/recipe-conformance.test.ts` +
`spec/tests/py/test_recipe_conformance.py` (4 new fixtures:
`compute-arithmetic`, `compute-unit-conversion`,
`integration-call-home-assistant`, `ask-disambiguate`, plus `ask`
asserted on every existing fixture), `backend/tests/packageHost.test.ts`
(7 new cases: permission-denied before any network attempt,
`get_state`'s real GET with the right path/auth, a missing `entity_id`
caught before the network, "isn't set up yet" reusing
`home.call_service`'s own message, a 404 mapping to `not_found`, an
unimplemented id/method staying `capability_missing`, `diagnostics()`'s
real shape). `bun test`/`uv run pytest` both green in `spec/`,
`bunx tsc --noEmit` clean in both `spec/` and `backend/` (a real cross-
tsconfig quirk found here: `mathjs`'s own generated `.d.ts` infers `all`
as possibly `undefined` under backend's bundler-resolution tsconfig but
not spec's, despite identical `strict`/`skipLibCheck` settings - a cast
at the one call site, not a tsconfig change, since spec's own
`tsc --noEmit` doesn't even include `interpreters/` in its `include`
array, a separate pre-existing gap not in this step's scope to fix).

A code review before this landed caught five real gaps, all fixed:
the Python interpreter's `integration.call` case never awaited
`host.integration.call` (unlike the TS side, and unlike this same
file's own `fetch`/`home.call_service` handling of real I/O) - it only
passed because the emulator's own `call()` was synchronous; now the
emulator is `async def` too (matching `call_service`'s own precedent),
awaited for real. `getHomeAssistantState`'s doc comment claimed a retry
`withOneRetry` never actually ran; now it genuinely reuses
`attemptHttpFetch`/`withOneRetry` (a new optional `timeoutMs` parameter
and a `status` field on `AttemptResult` so the 404-to-`not_found`
remap still works) instead of a second hand-rolled fetch/timeout/abort
sequence. A comment on `Host.integration.call`'s TS interface claimed a
type-system effect ("widened to allow a Promise") that a union with
`unknown` can't actually have - fixed to state what's really true
instead. `compute.py`'s quantity regex rejected scientific notation
("1e3 meters to km") that `compute.ts`'s own mathjs grammar already
accepts on any number literal - fixed.

What's left for whom: step 7's `math`/`convert` packages are the first
real consumers of `compute`; step 9's `lights` package (and any future
"is X on" style package) is the first real consumer of
`integration.call`; C consumes `ask` from the turn engine side, per the
wave-2 contract.

## Step 5: the Tier 1 host under Deno, and the MCP spike

`lib/denoHost.ts`: one warm Deno process per Tier 1 package, lazy-
started on that package's first real call (nothing spawns at boot).
`--allow-read=<sourceDir>,<dataDir>` and `--allow-write=<dataDir>` only
(no env, no subprocess, no net) - `sourceDir` is the package's own
checked-in `backend/packages/<id>/`, `dataDir` a new
`tier1PackageDataDir()` under `data/packages/<id>/` (`lib/paths.ts`) for
whatever `node:sqlite` state the package keeps, foreshadowing step 6's
real install layout (`data/packages/<id>/<version>/`) without needing
that step's versioning yet. `PACKAGES_DIR` moved from `lib/plugins.ts`
to `lib/paths.ts` so this file can read it without a `plugins.ts` <->
`denoHost.ts` import cycle (`runPlugin()` now calls into `denoHost.ts`
for a Tier 1 package the same way it always called `runRecipe()` for a
Tier 0 one).

**RPC is MCP over stdio, the official TypeScript SDK** (`@modelcontext
protocol/sdk`, MIT): the package is the MCP server (`McpServer`,
`handle` registered as its one tool), the hub is the client. `host.*`
methods are genuinely server-to-client requests - proven with a real,
throwaway spike script before writing any production code (a package-
side tool handler calling `extra.sendRequest({method:"host/fetch",...})`,
answered by the hub's own `client.setRequestHandler()`), confirmed
working over real stdio with the sandbox's exact real permission flags
before this file existed at all. `host/fetch` is the one method this
spike proves end to end (this step's own acceptance test): it reuses
`packageHost.ts`'s `createHost(actor, manifest).fetch()` verbatim, so a
Tier 1 package's fetch gets the identical permission/rate-limit/SSRF/
cache treatment (step 3) a Tier 0 recipe's already does - one
definition, one place, never a second copy of that logic for the
sandboxed case. `vscode-jsonrpc` (the plan's own recorded fallback) was
never needed - the SDK's bidirectional `Protocol` base class (both
`Client` and `Server` can `request()` the other side and
`setRequestHandler()` for a custom method) made the whole thing work on
the first real attempt.

**Faults**: a crash (the process closes on its own, not via this file's
own `killProcess()`) or a `callTool()` timeout (the manifest's own
`timeout_ms`, defaulting to 8000, passed straight to the SDK's own
per-request `timeout` option) counts a strike and answers with the
manifest's new `fallback_reply` field (`{ text, speech? }`, spec first)
instead of an error. A timed-out process is killed, never left running
stuck - the next call starts fresh. Three strikes disables the package
for the rest of this boot (in-memory, reset on restart - a session
fault, not `lib/smoke.ts`'s own persistent `package_status` verdict) and
raises a Repairs item through F's real `lib/issues.ts`. An idle process
(ten minutes, `IDLE_TIMEOUT_MS`) is closed by a sweep started once at
boot; a graceful-exit hook (mirroring `lib/sidecars.ts`'s own
`registerGracefulExit()`, not reusing that registry directly - a fixed,
named, health-polled sidecar and an open-ended set of per-package
Tier 1 processes with their own lazy-start/idle-kill/fault lifecycle are
a real mismatch to force into one abstraction) kills every live sandbox
process on hub shutdown so none leaks past a restart.

**`knowledge`, the first Tier 1 package** (the plan's own choice: "the
sandbox is proven by something the family uses"): a general-knowledge
answer via Wikipedia's free public REST summary API, `host.fetch`'d
from inside the sandbox. Offline Wikipedia through a local Kiwix ZIM is
the plan's own "when present" path; no ZIM ships this wave (a real,
multi-hundred-megabyte asset with no household-facing way to add one
yet), so this package always takes the "otherwise" branch. Declares
`cache`/`warm` (step 3) like any Tier 0 fetch-based package would - the
cache lives on the hub side (`packageCache.ts`), entirely transparent
to the sandboxed process, which never knows or cares whether its
`host/fetch` request was served from cache or a live call.

**A real Deno resolver limitation, found wiring up `deno test` for
`lib/smoke.ts`'s own `deno_test` smoke kind** (until now recorded as an
explicit failure, "not implemented until step 5" - real now,
`runDenoTestSmoke()`): `deno check`/`deno test` fail to resolve a
versioned npm subpath specifier
(`npm:@modelcontextprotocol/sdk@1.30.0/server/mcp.js`) during their
type-checking pass, even fully cached, even though `deno run` (this
file's own real spawn) resolves and runs the identical import fine -
`deno run` never type-checks by default, only `deno check`/`deno test`
do. Fixed with `--no-check` on the smoke run specifically: matching
what production already does (untyped execution) rather than holding
smoke to a stricter bar `denoHost.ts`'s own real spawn doesn't clear
either. Also found live: `--no-remote` (originally added to the smoke
run and the real spawn "to be extra safe") is stricter than the actual
goal - it refuses a cached remote module outright, not just a live
network fetch, and broke on `knowledge`'s own `jsr:@std/assert` test
dependency; `--cached-only` alone is the real "no live network, cached
is fine" guarantee, so `--no-remote` was dropped from both.

**`bun test`'s own default file discovery picked up
`knowledge/handler_test.ts`** (a real Deno-native test file, `jsr:`/
`npm:` imports bun was never meant to resolve) the moment it existed,
failing `scripts/check.sh`'s `bun test` step on an import error, not a
real test failure - found live, the first time a Tier 1 package's own
test file existed anywhere in the tree. Fixed with `root = "tests"` in
`backend/bunfig.toml`, scoping bun's own discovery to where every one
of *its* test files already lives; a Tier 1 package's own `deno test`
stays `lib/smoke.ts`'s gate, never bun's.

A code review before this landed caught three real gaps, all fixed:
`callTier1Handle()` had no lock around starting a not-yet-running
process - two concurrent calls for the same cold package (two family
members asking at once, a client retry) each saw nothing in `processes`
and each spawned their own real `deno run` child; whichever finished
connecting last won the map slot, orphaning the other - unreachable to
`startIdleSweep()` or `registerDenoHostGracefulExit()` (both only ever
walk `processes`), a permanently leaked process per race. Fixed with a
`startingProcesses` map so every concurrent caller for the same id
awaits the identical in-flight start. `speechLint.test.ts`'s placeholder
only ever checked `recipe.json`/`SKILL.md`, so a Tier 1 package's own
spoken text - `manifest.json`'s new `fallback_reply` - shipped
completely unchecked; now covered for every bundled package that
declares one. `lib/skills.ts` had its own independently-declared copy
of `PACKAGES_DIR`, surviving the exact "one definition, one place"
consolidation this step's own `lib/paths.ts` move claimed to make -
fixed to import the real one.

Tests: `backend/tests/denoHost.test.ts` (7 cases - a full round trip
against the real Deno sandbox from a cache-seeded response, no live
network needed (`__setTestFetchDelayMsForTests`, a test-only seam that
delays every `host/fetch` request equally, standing in for "the package
is slow to answer" without needing a real slow service); two concurrent
calls for the same cold package sharing one real process, not two
(`pgrep -f`, counting the actual live child); a timeout faulting to
`fallback_reply`; three strikes disabling the package and raising a
real Repairs issue, and staying disabled on a 4th call even once the
delay is lifted; three real, live `deno run` invocations against
disposable temp directories - never a bundled package, so the bronze-
completeness suite can never mistake them for one - proving Deno's own
permission model directly: reading outside the allowed directory
fails, a direct `fetch()` bypass fails with no `--allow-net` anywhere,
and reading/writing inside the allowed directory succeeds),
`backend/packages/knowledge/handler_test.ts` (3 cases, `deno test`:
formats a real Wikipedia summary shape, a disambiguation page reads as
not-found rather than a wrong answer, no extract at all reads the
same). `spec/tests/ts/package-bronze.test.ts` picked up `knowledge`
automatically and it clears bronze. `scripts/check.sh` fully green,
all 812 backend tests passing.

**Verified for real**, against a running dev server, real Wikipedia
calls: `POST /api/plugins/knowledge/run` for "Seattle" through the real
sandboxed process answered with a real, correctly-formatted summary; a
second call for the same topic answered in 12ms (cache hit, no live
fetch); a fresh topic ("Marie Curie") answered correctly on its own
first real call; no leaked `deno` process after killing the hub.

What's left for whom: step 6's install flow is what actually versions
and signs a Tier 1 package (today's `backend/packages/knowledge/` is
bundled, the same as every Tier 0 package); step 7-9's own Tier 1 or
Tier 0 packages can declare `exposes.queries[]` (already schema-real
since step 2) for C's Tier 2 router once C wires that side; a second
Tier 1 package would be the first real test of whether `host/fetch`'s
one-method RPC surface needs a second method (`host/memory.recall`,
etc.) added the identical way.

## Step 6: the store host and the catalog tooling

**The `catalog` repo's own tooling** (`getmaipai/catalog@454e945`):
`tools/src/{lint,pack,sign,index-builder,scorecard,check,build-index}.ts`,
`@maipai/catalog-tools`. `lint.ts` validates a package's manifest (and,
for Tier 0 plugins, its recipe.json) against `schema/` (mirrored from
`home/spec/`) plus the rest of bronze - five-plus routing examples, a
privacy row per `net:` permission, banned trademark vocabulary, README/
CHANGELOG/quality_scale.yaml. `pack.ts` packs a package directory into a
deterministic gzipped tarball (`node-tar`, BlueOak-1.0.0) and refuses a
symlink outright (found by review: a symlink would otherwise pass
`packPackage()`'s own file check via `statSync`, which follows it, and
node-tar preserves the symlink itself - target string and all - in the
signed tarball; `catalog` takes community PRs, so this is a real
attacker-reachable path). `sign.ts` is Ed25519 via native `node:crypto`.
`index-builder.ts` builds the TUF-shaped `root`/`targets`/`timestamp`,
each carrying a monotonic `version` (added after `build-index.ts`
landed and a rollback-detection gap became obvious: an expiry check
alone can't catch a validly-signed, not-yet-expired, but WITHDRAWN
older file). `build-index.ts` ties all of it together for a real set of
packages, generating a local dev signing keypair outside the repo
(`~/.config/maipai/catalog-dev-signing/`, never the real maintainer
release key, which stays offline and is Jesse's own future call).
`check.ts` is the CLI: `bun run check` finds every package in the repo
(a directory with its own manifest.json, one level under `plugins/` and
`skills/`, direct under everything else) and runs lint+scorecard on
each. `scripts/check.sh` runs the whole suite before the standards core.
59 tests across 7 files.

**The bundled packages move to `catalog` as their canonical source**
(`getmaipai/catalog@60788f1`): `define`, `joke`, `trivia`, `weather`,
`knowledge`, and `storytime-style` (D's own six, all bronze-complete)
migrated to their real catalog home (`plugins/<category>/<id>/` or
`skills/<category>/<id>/`). `recall`, `remember`, and the companion
packages (`buddy`, `default`, `pal`, `tutor`) stay in `home` - not
D's packages (this file's own step-0 ownership note, and Session A's
own companion work), and not yet at bronze (no README/CHANGELOG/
quality_scale.yaml/smoke declaration), so they don't belong in the
public catalog yet either: bronze is the actual publish gate, not a
courtesy. `home` keeps its own checked-in copy under `backend/packages/`
(`scripts/refresh-bundled-packages.ts`, `home-d@fc44642`) so the
running hub never needs a network fetch or a sibling catalog checkout
at runtime - `lib/bundledPackages.ts`'s `hashPackageDir()` (a plain
sha256 over sorted relative-path + content, refusing a symlink the same
way `pack.ts` does) is what makes "the copy matches" checkable without
`home` depending on `catalog`'s own tar-based tooling (a real cross-repo
dependency neither repo's build supports - the same reason `schema/` is
a copy, not a live import). `backend/packages/bundled-provenance.json`
records each id's hash/source-commit/catalog-path;
`tests/bundledPackages.test.ts` recomputes the hash from whatever's on
disk right now and fails loudly the moment someone hand-edits the
checked-in copy instead of running the refresh script. 13 tests.

**`lib/storeIndex.ts` verifies the signed index** - a deliberate,
field-for-field TWIN of `catalog`'s own `index-builder.ts` (same reason
as the bundled-copy hash above: no cross-repo dependency, different
trust boundary, the same reasoning MCP's own independent client/server
implementations already carry through this file). Checks, in order:
root's signature against the pinned trust config (a CLIENT-side
threshold, deliberately independent of whatever root.json's own
self-reported threshold claims - trusting a root's self-declared
threshold to verify ITSELF would let a malicious root simultaneously
declare and satisfy threshold 1), root's expiry and rollback version;
targets' signature against root's OWN declared keys/threshold for that
role, expiry, rollback version; timestamp's signature the same way,
expiry, rollback version; and finally targets.json's actual fetched
bytes against timestamp's own hash pointer (the freshness anchor - even
an independently well-signed targets.json must be the SAME BYTES the
freshest timestamp vouches for). `lib/store.ts` builds install/rollback/
uninstall/setChannel on top: downloads and hash-verifies a package's
tarball against its targets entry, unpacks to a staging directory,
checks the unpacked manifest's own `id` AND `version` match what was
asked for (version validated against a safe semver pattern before it
ever reaches a filesystem path), makes it the active install, and runs
its smoke test - a failure leaves it installed but disabled
(docs/PACKAGES.md's own words), never undone. `lib/packageResolve.ts`
is the one place a package's active directory is computed (an
installed override or the bundled default under `PACKAGES_DIR`),
consumed by `lib/plugins.ts`, `lib/denoHost.ts`, `lib/smoke.ts`, and
`lib/skills.ts`.

**A high-effort code review before this landed caught real security
gaps, all fixed**: (1) `lib/paths.ts`'s `tier1PackageDataDir` used to be
`data/packages/<id>/` directly, and the new `installedPackageVersionDir`
nested `versions/<version>/` INSIDE that same directory - a store-
installed Tier 1 package's own SOURCE was a subdirectory of its own
`--allow-write` grant, silently defeating `lib/denoHost.ts`'s "can never
write into its own source tree" the moment a Tier 1 package was store-
installed rather than bundled. Fixed by giving `tier1PackageDataDir` its
own `state/` subdirectory, a true sibling of `versions/`; a real `deno
run` regression test (two genuinely separate directories, not the same
temp dir twice like every other test in that file) now proves it.
(2) `verifyEnvelopeSignature` only checked "did SOME authorized key
sign this" - a threshold-1 check regardless of what root.json's own
`roles.*.threshold` actually declares, so compromising ONE signer among
several would have been enough to forge an update. Fixed with a real
`countSatisfiedKeys()` that counts DISTINCT keys satisfied, enforced
against each role's own threshold. (3) `manifest.version`, read out of
an unpacked tarball, went straight into a filesystem path with no
validation - a manifest declaring `"../../../etc/cron.d"` would have
flowed through `path.resolve`'s own `..` collapsing into a write outside
`data/packages/` entirely, gated only on a malicious catalog entry
passing hash verification, no signature break needed. Fixed with a
semver-shaped pattern check plus a cross-check against the target
path's own version segment. (4) An update that WIDENS a package's
permissions installed silently - no comparison against what was already
granted, contradicting this step's own acceptance line ("a permission-
changing update demoted to notify"). Fixed: `install()` diffs the new
permission set against the active install's own BEFORE downloading
anything, and refuses with `requiresConfirmation` until the caller
passes `confirmed: true` - the two-call permission-prompt flow, at the
library level (a UI-level prompt is E's own consuming work once
`routes/store.ts` exists). (5) Reinstalling the SAME version overwrote
`previousVersion` with itself, silently destroying the real rollback
target - a retry after a network blip would have looked like a
successful rollback that was actually a no-op. Fixed: `previousVersion`
only advances when the version actually changes. (6) Two concurrent
installs of the same id raced on the same staging directory and both
read pre-install state before either wrote it. Fixed with a per-package-
id lock (`withPackageLock`, the identical shared-promise shape
`lib/denoHost.ts`'s own `startingProcesses` map already uses for a Tier
1 package's cold start) around install/rollback/uninstall. (7)
`lib/skills.ts` was never migrated to `packageResolve.ts` - a store-
installed or store-updated skill package was invisible to
`loadAllSkills()`, the one place a skill reaches a chat turn's system
prompt. Fixed. (8) `uninstall()` deleted the WHOLE
`data/packages/<id>/` parent, wiping a Tier 1 package's own persistent
state even when a bundled fallback kept running right afterward. Fixed
to remove only the store's own `versions/`/`.staging/` subdirectories.
Three independent hand-copies of the same TUF fixture-signing logic
across two test files were also consolidated into
`tests/support/tufFixtures.ts`.

Tests: the full tamper suite (bad hash, swapped manifest, expired
timestamp, rolled-back index, unknown signer, and now threshold
bypass) in `storeIndex.test.ts`; install/rollback/uninstall/channel,
the acceptance case (installing over an already-bundled package), and
the concurrency/permission-escalation/path-traversal/Tier-1-state
regressions above in `store.test.ts`. `scripts/check.sh` fully green,
921 backend tests passing.

**Verified for real**, against a real signed index built by `catalog`'s
own `bun run build-index` (not a test fixture) and a real household-
free dev data dir: `install()` against
`plugins/utilities/weather/0.1.0` with `catalog`'s real dev signing key
as the pinned trust returned `{ok: true, version: "0.1.0",
previousVersion: null, smokeOk: true}`; `resolvePackageDir("weather")`
then resolved to the store-installed version directory, not the
bundled copy; `runPlugin("weather", ...)` - the exact same call a real
`POST /api/plugins/weather/run` makes - answered "It's 54.7 degrees in
Seattle" through the real recipe, the real host, and a real live
Open-Meteo call, all served from the just-installed copy.

**`routes/store.ts`** closes out this step's own remaining pieces:
`@hono/zod-openapi`, owner/admin only (`routes/repairs.ts`'s own gate),
`GET/POST /api/store/installs/{id}` plus `/rollback`, `/uninstall`, and
`/channel` - the two-call permission-prompt flow's UI-facing half (a
409 with `requiresConfirmation` when an update adds permissions, until
re-sent with `confirmed: true`). A medium-effort review before this
landed caught two more real gaps: every `StoreResult` failure collapsed
to 400 at the route layer, even "no active install for this id" (`routes/
repairs.ts`'s own convention says 404) - fixed by giving `StoreResult`
a real `status` field, the same shape `lib/commands.ts`'s
`CommandOpResult` already carries. And install/uninstall/rollback had
no coordination with a Tier 1 package's own live sandbox process -
`lib/denoHost.ts` resolves and pins `sourceDir` once, at spawn time,
and never re-reads it, so a live process would keep running against
files a mutation had just deleted or replaced. Fixed with a new
`killLiveProcessForInstallChange()` call after each mutation (a no-op
for a package with no live process, the common case), so the next real
call always respawns fresh against whatever `lib/packageResolve.ts`
resolves to now.

**`catalog`'s public CI workflow** (`.github/workflows/check.yml`,
`getmaipai/catalog@2d1d37c`) closes out `catalog`'s own remaining piece:
tag- and PR-triggered (never on every push - the org's own security
standard, and the one carve-out for a public repo), checks out the
pinned `std-v0.2.0` standards ref as a sibling directory (the identical
layout `scripts/check.sh` already expects locally) and installs
gitleaks explicitly (`check-core.sh`'s own gitleaks step only warns,
never fails, when the binary isn't on PATH), then runs the same
`scripts/check.sh` a contributor runs before opening a PR.

Step 6 is complete. What's left for whom: the daily `catalog.check`
core job and the full auto-update/notify flow (comparing an installed
version against the index on a schedule, not just at an explicit
install call) are real, deferred scope - `fetchVerifiedIndex()` is
already exported standalone for exactly that future caller to build
on, but the scheduled job itself, and the notification it would raise,
don't exist yet. The fuller CI feature set docs/PACKAGES.md eventually
wants (a permission-diff PR comment, a vendoring scan, screenshot
generation with vision review, the CLA check) is likewise deferred - a
maintainer-review-plus-CLA merge gate is manual until then.
