# Session D: packages, the store and the catalog (backend, spec, catalog repo)

A self-contained work order. Read `wave-2.md` first (rules, ownership,
shared-file protocol, contracts), then this file, then code until every
step is merged. Written 2026-09-06.

## Read first

1. `getmaipai/.github/CLAUDE.md`, `docs/PACKAGES.md`, `docs/UPDATES.md`,
   `docs/NOTIFICATIONS.md` and `STACK.md` there, and
   `plugin/skills/new-package/SKILL.md`.
2. `docs/plans/wave-2.md`, all of it.
3. `docs/BACKLOG.md`: "Skill standards", "Skills (Tier 0 catalog)",
   "Integrations", "Advanced tool calling", "Proactive / ambient
   intelligence", "Skills as home-screen widgets" under UI / shell,
   "Legacy: copy, re-examine, record", "The other three products", and
   "Wave 2 additions".
4. Platform plan 4.7, 4.9, 4.10, 5.1 to 5.8 (read only).
5. `docs/dev.md`: "Naming: skill, plugin, command, connector", "The real
   `skill` kind, shipped", "The `command` primitive, shipped", "The
   privacy page", and the Home Assistant integration entry.
6. `backend/src/lib/{plugins,skills,packageHost,scheduler,commands,privacy}.ts`,
   `backend/packages/*/manifest.json`, `spec/schemas/{manifest,recipe,result}.schema.json`,
   `spec/interpreters/**`, `spec/emulators/**`, `spec/README.md`.
7. The `catalog` repo as it stands (scaffolding only), and the legacy
   mirror's `backend/src/tools/` and `backend/src/lib/skills/` (read
   only, for verdicts and hard-won logic; never for UI or scope).

## The goal

At the end of this session a package is a real unit of the product:
installed from a signed index, proven by a smoke test, cached and warmed
by declaration, able to run code when a recipe is not enough, and there
are enough of them that the family's everyday questions get answers.
Concretely:

- Every bundled package clears bronze for real: `quality_scale.yaml`, a
  smoke entry that runs at install and on a schedule, a README store
  card and a changelog, five or more routing examples, a privacy row per
  data source.
- The `catalog` repo has lint, pack, sign, index and scorecard tools and
  a signed index; the hub installs from it, verifies twice, prompts for
  permissions, and can roll back.
- A Tier 1 package runs under Deno, deny-by-default, and speaks MCP to
  the host; a Deno package reading `/etc/passwd` fails.
- Web search, conversions, math, news, sports, translation, music and
  media lookup, reminders and timers, shopping and to-do lists, and one
  real Home Assistant action all work in chat.
- A package declares a widget and the data behind it is cached and
  warmed on a schedule; E draws it on Home.

## Files you own

See `wave-2.md`, "Ownership map", session D. You do not touch
`turnEngine.ts`, `routing.ts`, `memory*.ts`, `frontend/`, `spec/ui/`, or
F's files. Routing behaviour is C's; you keep manifests accurate and
build against C's contract.

## Steps, in order

### Step 0: setup and verdicts (S)

Worktree `../home-d`, branch `session-d-packages-and-store`, `data-d`,
port 8802, `bun install`, `scripts/check.sh` green. Then the review
queue: every legacy chat tool and hub feature the backlog lists under
"Verdicts for the features absent" gets its one-line verdict (rebuild
as designed, redesign, merge, drop, with the reason) in
`docs/dev/session-d.md` before anything is built. This is principle 8
and it is not optional; the packages below are the ones whose verdict
is "rebuild" or "redesign".

### Step 1: bronze for real: quality, smoke, cards (M)

- `quality_scale.yaml` per bundled package in the `PACKAGES.md` shape;
  the manifest's string field becomes derived from it.
- `lib/smoke.ts`: a `smoke` entry in the manifest (a recipe fixture with
  expected output, or for Tier 1 a `deno test` target) run at install, at
  every update, and daily through `ensureCoreJob("packages.smoke")`; a
  failure leaves the package installed but `status: disabled` and calls
  F's `raiseIssue` (`lib/issues.ts`; a local stub with the same
  signature until F's step 1 merges, swapped the day it lands).
- A user-tier `README.md` (the store card) and `CHANGELOG.md` per
  bundled package.
- The speech lint from C's step 6 runs on every `speech` string (until
  it lands, a test that fails on an em dash or an exclamation point in a
  `speech` template).
- `GET /api/plugins` gains the fields in the contract.

Tests: smoke pass, smoke fail disables and raises; the scale file
validates; every bundled package passes a bronze check in
`spec/tests/`. Acceptance: the release skill's "refuse below bronze"
check has something to read.

### Step 2: the manifest catches up with the plan (S-M)

Spec first, one schema change, generated, fixtures: `cache: { key_template,
ttl_s, stale_ok_s, max_bytes }`, `warm: { schedule, keys }`, `warm_on`,
`contributes.widgets[]` (the contract), `exposes.queries[]` (C's
contract), `smoke`, `channel`. Mark `weather`, `define`, `joke`, `trivia`
`platforms: ["home", "bot"]`. Package-declared `notifications[]` become
real declared types through F's `notificationTypes.ts` registry (a
`registerPackageNotificationTypes(manifest)` call at load; the registry
is F's file, so the function lands as an additive export you add in one
commit that touches only that export, rebased first).

### Step 3: the package cache and warming (M)

`lib/packageCache.ts`: one cache per household in `data/cache/<package>/`
keyed by the manifest's `key_template`, TTL and stale-while-revalidate
per declaration, a node budget with LRU eviction scaled to free disk,
warming jobs from `warm.schedule` through the scheduler, cache entries
never in any record table. `host.fetch` reads through it. A Storage
row per package (size, age, hit rate) through `GET /api/storage` (F's
route; you expose `getCacheStats()` and F reads it). The widget data
route in the contract serves from here.

Tests: hit, miss, stale, eviction, a warm job populates. Acceptance:
weather warmed for the household's home place is answered without a
fetch.

### Step 4: recipes reach further (M)

- `integration.call` recipe step and the `host.integration.call` wiring
  through it; Home Assistant is the first integration reachable from a
  recipe.
- The `ask` result field produced by a recipe (`ask: { prompt, options?
  }`) so a lookup can ask "which Springfield" deterministically; C
  consumes it.
- Audit the `host.*` surface against plan 4.9's list; implement the
  missing methods that a Tier 0 recipe can reach (`host.log`,
  `host.config.get`, `host.data.forget`, `host.diagnostics`) with the
  emulator twin in both languages and a conformance fixture each.
- A `compute` step: a safe expression evaluator (`mathjs` with the
  restricted evaluator, licence checked) for math and unit conversion
  without a network call; the Python interpreter gets the same step on
  the same fixture set (the `bot` will run it).

### Step 5: the Tier 1 host under Deno, and the MCP spike (M-L)

`lib/denoHost.ts`: one warm Deno process per Tier 1 package, lazy start,
ten-minute idle kill, `--allow-read`/`--allow-write` on exactly its
directory, no env, no subprocess, no net; `node:sqlite` inside its
directory; `handle` bounded by `timeout_ms` (8000 on the hub); crash or
timeout faults the package for the session with its `fallback_reply`,
three strikes disables it until reboot with a Repairs item. RPC is MCP
over stdio with the official TypeScript SDK: the package is the MCP
server, `handle` is a tool, the `host.*` methods are server-to-client
requests. The spike proves `host.fetch` (through the limiter and the
cache) and streaming; if MCP is awkward for either, `vscode-jsonrpc` is
the recorded fallback. The first Tier 1 package is the knowledge lookup
(offline Wikipedia through a local Kiwix ZIM when present, web search
otherwise) so the sandbox is proven by something the family uses.

Tests: a package reading outside its directory fails; net without
`host.fetch` fails; the timeout faults; three strikes disable; the
host-emulator conformance fixture runs against the real host.
Acceptance: the Deno package answers in chat on the running backend.

### Step 6: the store host and the catalog tooling (M-L)

- `catalog` repo: `tools/` with lint (manifest against the spec, five
  examples, privacy rows, banned vocabulary, trademark names in ids),
  pack (deterministic tarball, sha256), sign (Ed25519, offline key file
  outside the repo, second signer slot from day one), index (TUF-shaped
  `root`, `targets`, `timestamp` with a thirty-day expiry), scorecard,
  and a `check` CLI that runs them; the bundled packages move to the
  catalog as their source of truth, and `home` keeps a signed copy of
  the default set under `backend/packages/` produced by `pack` (a script
  refreshes it; a test proves the copy matches the index).
- `lib/storeIndex.ts` and `lib/store.ts` on the hub: fetch the index
  from the one pinned URL, refuse an expired or rolled-back index,
  verify each package twice, unpack to `data/packages/<id>/<version>/`,
  run the smoke test before enabling, per-package channel, rollback to
  the previous version, uninstall; the permission prompt as the two-call
  flow in the contract; a `catalog.check` core job once a day (listed on
  the privacy page as the periodic outbound call it is). The tamper
  suite: bad hash, swapped manifest, expired timestamp, rolled-back
  index, unknown signer, each refused with a catalogue error and no
  partial unpack.
- The public catalog CI workflow (tag-triggered and PR-triggered only;
  the catalog is public so minutes are free) running the same `check`.

Tests: the tamper suite; install, rollback, channel change; the copy
matches the index. Acceptance: `weather` installed from the local index
on the running backend, a permission-changing update demoted to notify.

### Step 7: the lookups (M total)

Tier 0 unless stated, each with five-plus examples, patterns, privacy
rows, `offline` behaviour, `speech` strings passing the lint, a smoke
entry, README and changelog, a routing-corpus row set handed to C (write
them into `spec/llm/routing-corpus.json` under your package ids; C owns
the file's structure, you append rows):

- Web search: SearXNG, bring-your-own-instance rather than F's
  `sidecars.ts` (Jesse's own call, 2026-09-06, after research found no
  cross-platform, zero-dependency way to bundle SearXNG the way
  `llama-server` is downloaded and pinned per-platform - see
  `docs/dev/session-d.md`'s step 7 entry). The plugin reads
  `search.searxng_url`; no keyless scraping of a search engine from the
  hub's address as the DEFAULT or only path, ever (the org's "we are the
  user" rule; legacy `webSearch.ts`'s scraper ladder is the
  counterexample) - a scraping fallback was investigated for real
  (offline robot, no SearXNG configured) and rejected after live testing
  showed it bot-blocked on the first call, not on policy grounds alone.
- Unit and currency conversion (`compute`, frankfurter.app for rates).
- Math (`compute`).
- News headlines (RSS from a household-chosen list, cached and warmed;
  no keyed API).
- Sports scores (a free scoreboard API with a key-free tier, or RSS;
  record the choice).
- Translation (a local model through `host.llm.complete` first; a
  network service only as opt-in).
- Music and media lookup (MusicBrainz and TMDB-style metadata with the
  user's own key where required; a lookup only, never playback).
- Date, time, holidays, moon phase and on-this-day as one small
  `almanac` package (legacy had five tools for this).

### Step 8: lists, reminders and timers (M)

Spec first: `spec/schemas/list.schema.json` (the contract's shape, with
`hlc` and provenance), fixtures, bindings. `lib/lists.ts` and the routes;
a `lists` package with `remember`-style recipes ("add milk to the
shopping list", "what's on my list", "remind me at 6 to call Nadia",
"set a timer for ten minutes") over `host.schedule` and the new list
store; a timer fires a `passive` notification through the declared type
and, on the robot later, speech. E draws the list and the running timer.

Built as four packages, not one - `list-add`, `list-view`, `remind`,
`timer` (2026-09-06, `docs/dev/session-d.md`'s step 8 entry has the full
reasoning): `deterministicArgs()`'s own one-arg-per-route limit is the
same reason `remember`/`recall` are already two packages, not one, and
`spec/vocab/capabilities.json` already listed `shopping_list`,
`reminders`, `timers` as three separate grantable capabilities before
this step touched anything. Firing a reminder/timer schedules a
`"core"`-kind job (`lib/scheduler.ts`'s new `scheduleCoreJob`), never a
replay of the recipe that set it - the real fix for "one recipe can't
branch on set-vs-fire," not a workaround.

### Step 9: one real Home Assistant action, and the widgets (S-M)

- A `lights` package that calls `home.call_service` (`light.turn_on`,
  `light.turn_off`, brightness) through the permission model shipped in
  Wave 1; a `consequential: true` example (`lock.lock`) proving C's
  confirm path from the package side.
- Widgets: `weather`, `news`, `lists` and `almanac-date` declare
  `contributes.widgets`; `GET /api/widgets` and the data route from the
  contract, served from the cache. (Step 7's own design note: "one small
  `almanac` package" became five - `almanac-date`, `almanac-time`,
  `almanac-moon`, `almanac-holiday`, `almanac-onthisday` - once building
  it revealed the router can only ever bind a package's ONE required arg
  from a `routing.patterns` wildcard capture, with no way for a fired
  package to learn which of several sub-questions it was actually asked;
  see docs/dev/session-d.md's own step 7 entry for the full reasoning.
  `almanac-date` is the one namesake widget makes the most sense for.)
- `contributes.pages` from a manifest feeds the nav registry E built in
  Wave 1 (`GET /api/plugins` already lists packages; add the pages
  array, E reads it).

### Step 10: wrap up

`docs/dev/session-d.md` complete (every verdict, every package's
request budget, the numbers chosen); one line in `docs/dev.md`'s "Wave
2" index; `docs/BACKLOG.md` checked off and corrected;
`getmaipai/.github/docs/PACKAGES.md` drift noted for Jesse (you do not
edit `.github` from here); `scripts/check.sh` green; `code-review` on the
final diff; merge into `main`; delete the worktree; do not push unless
Jesse says ship.

## If you get stuck

- A design question: the `design-resolver` agent, decision recorded.
- A turn-engine or frontend need: your dev file, the contract, move on.
- A service that blocks or rate-limits during testing: stop that class
  of traffic, record it, never retry through it.
- Something only Jesse can decide (a key, a real account, a release):
  finish every other step, then stop with a status block.
