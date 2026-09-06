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
