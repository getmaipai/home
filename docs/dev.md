# MaiPai Home: design record

Seeded 2026-09-03 from the platform plan (`purring-chasing-noodle.md`).
This repo is a fresh start on that design: chapter 0 explains why (build
fresh, do not migrate; decision 11), chapters 3 and 4 are the hub's
architecture, chapter 13 is the release roadmap. This file is the dev-tier
design doc; it grows as the hub is built.

## What happened to the old repo

The pre-rebuild hub's full history (244 commits of the Bun/Hono monolith,
~250 SQLite tables, 61 code tools, Ollama-based models) is preserved
outside GitHub: a full git mirror at `legacy-backups/home-legacy.git` next
to this repo on the dev machine, plus its 21 releases' metadata (tags,
notes, asset lists with sha256) in
`legacy-backups/home-releases-metadata/`. Nothing was migrated into this
repo. (This is a separate lineage from the older, already-archived
`loki-doki` repo, which predates the `getmaipai` org migration entirely
and is not part of this rebuild's reference set.) Per platform plan
principle 8, legacy code is a read-only reference for hard-won logic only
(resolvers, sync, limiters, drivers, measurements), never for feature
scope or UI; every legacy feature gets a one-line review verdict here
before anything is rebuilt (section 5.8).

The live legacy hub (on the MSI) keeps running until this repo's v0.1 is
ready to take over; nothing about this repo's rebuild has stopped it.

## What this repo is

The self-hosted family AI hub: the platform and the household's master
(identity, people, memory, the turn engine, settings, the package host,
the credentials center, backups, updates, the shell). Every feature ships
as a catalog package from `getmaipai/catalog`; this repo ships the default
set. Full architecture: platform plan chapters 1, 3, and 4.

## Step 0 status

- [x] Repo reset to a clean history, with LICENSE (AGPL-3.0), NOTICE, this
      design record, and `scripts/check.sh` pinned to `@maipai/standards`
      std-v0.1.0.

## Hub v0.1 status

- [x] `home/spec/` v0.1: JSON Schema for Person, Setting, Memory/Entity/
      Episode, the package manifest/recipe/result shapes; the settings
      registry (empty, ready for the first declaration) and the
      capability/permissions vocabularies; UI schema v0 for Chat only;
      both recipe interpreters (TS and Python, kept behaviorally
      identical) and both host emulators; generated Zod and Pydantic v2
      bindings for every schema, committed; fixtures that round-trip
      through both, plus recipe conformance fixtures proving both
      interpreters agree. See `spec/README.md`.
- [x] `@maipai/standards` std-v0.2.0 (`.github`): the five cross-cutting
      schemas (logging line, trace span, error entry, budget, privacy
      row), each generated to both bindings and fixture-tested there too.
      `home/spec/`'s error catalogue and the manifest's `data_sources[]`
      import `ErrorEntry`/`PrivacyRow` from it by cross-repo `$ref`; see
      spec/README.md's "Cross-repo schemas" section for exactly how,
      including a real codegen gotcha (recipe.schema.json's internal
      oneOf breaks if the cross-repo resolution is done too bluntly).
- [ ] Not yet done: cutting the `spec-v0.1.0` tag (nothing pins it yet,
      since `bot` doesn't exist as real content in this session).
- [x] Hub backend skeleton: `backend/` (Bun, Hono, Drizzle ORM on SQLite),
      joined to `spec/` by a root `package.json` workspace so both share one
      lockfile and the backend imports `spec/gen/ts/` directly. Boots with
      `bun run --hot src/index.ts` (or `bun run src/index.ts`), listens on
      `PORT` (default 8787), data lives in `data/` at the repo root
      (already gitignored). See `backend/src/app.ts` for the route list.
- [x] Identity and sign-in (4.1) and people (4.2), the first slice of core:
      - Profiles on a picker, with or without a PIN/password. Argon2id via
        `Bun.password` (memoryCost 65536, timeCost 3), HMAC-peppered before
        hashing so the pepper (not just a salt) sits outside the database;
        the pepper is held by `backend/src/lib/keystore.ts` (macOS Keychain,
        Windows DPAPI, or a 0600 key file, never in `hub.db`).
      - Per-profile lockout (5 failed attempts, then 30s/2m/10m/1h
        exponential backoff) plus a global per-IP throttle, so one host
        can't brute-force every profile in parallel.
      - Sessions: `HttpOnly`/`SameSite=Strict` cookies, `Secure` set
        automatically when the request arrived over HTTPS, a 10s in-memory
        resolution cache keyed by token hash (never a raw token), and a
        CSRF origin check on every mutating route on top of `SameSite`.
      - The role ladder (`owner, admin, adult, teen, child, guest`, 4.2)
        gates every mutating route; `requireRole` checks exact membership,
        not a rank comparison (grants are per-capability, a later release).
      - First-run setup (`POST /api/auth/setup`) creates the household
        owner once, then refuses; `POST /api/people` is the ongoing way to
        add people, `requireRole("owner", "admin")`-gated.
      - Every API response goes through `backend/src/lib/personShape.ts`,
        which converts Drizzle's camelCase row to the spec's snake_case
        `Person` shape *and* validates it by parsing through the generated
        Zod schema, so the API can't silently drift from `spec/schemas/
        person.schema.json`. This caught a real bug during this pass (the
        first cut returned camelCase field names straight from Drizzle);
        the fix and the regression test are in the same commit.
      - `docs/ENGINEERING.md`'s schema-version rule is live:
        `backend/src/db/schema-version.ts` stamps `PRAGMA user_version` and
        refuses to open a database stamped newer than the running build
        understands. Bump `CURRENT_SCHEMA_VERSION` in the same commit as
        any add/remove/rename of a persisted table or column.
      - Exercised for real, not just by tests: booted the server, drove
        setup, profile creation and role enforcement, login, lockout,
        session logout, and the CSRF rejection with `curl` against the
        running process (see the `bun test` suite in `backend/tests/` for
        the same flows as regression tests, 28 tests, all green).
      - **Judgment calls made without asking** (platform plan 4.2 doesn't
        spell these out; capability grants for "manage people" are a later
        release, so this session had to pick something to enforce meanwhile):
        only the owner may create another owner or an admin profile; an
        admin may create adult, teen, child or guest profiles but not a
        peer admin or an owner. An owner or admin profile always requires a
        secret at creation (a secret-free admin account would be a
        one-request takeover). Revisit both when capability grants land.
      - **Deliberately deferred**, to keep this slice honest and fully
        verified rather than half-built: WebAuthn passkeys, TOTP for
        owner/admin, device tokens and Quick Connect, the approval queue
        (Ask to Install/Browse), capability grants and content ceilings
        (the spec doesn't have these record types yet either, see
        `spec/README.md`), age-band derivation from birthdate (so no route
        yet computes or exposes `age_range`), and any People-management UI
        (this pass is backend/API only; no shell or kit work has started).
- [x] The safety layer (4.3): a deterministic multi-signal classifier for
      the eight floor categories (self_harm, harmful_request,
      credible_threat, csam, grooming, pii_extraction, prompt_injection,
      jailbreak). Design and code live in `spec/safety/` (not
      `backend/`), written to stay language-portable even though only the
      TS side exists today, matching the recipe interpreters' precedent;
      `spec/safety/README.md` is the full design record, including
      documented false-positive/false-negative limitations, read it before
      extending any detector. New spec shape: `SafetyResult`
      (`spec/schemas/safety-result.schema.json`), dual-codegen'd,
      deliberately carries only category/action/matched-signal-ids, never
      the checked text (4.3: "logged with the fact, never the
      transcript"). A labelled corpus (`spec/safety/corpus/corpus.json`,
      synthetic and persona-roster only, ~50 entries covering every
      category plus idiom/framing/context-gating edge cases and a small
      bypass-suite subset) is proven against the classifier in
      `spec/tests/ts/safety.test.ts`. Hub-side: `backend/src/lib/safety.ts`
      wraps it with the per-band policy (role teen/child treated as
      "minor speaker" pending real age-band derivation) and a fact-only
      log line; `POST /api/safety/check` (any signed-in person, checks
      their own text) is today's real caller since the turn engine (4.5)
      doesn't exist yet to call it internally. Exercised for real: booted
      the server and drove benign text, self-harm (confirmed
      `allow_with_resources`, never `refuse`), a harmful actionable
      request, a jailbreak attempt, and a child-speaker grooming pattern
      (confirmed `notify_parent: true`) with `curl`, plus 50 spec-level
      corpus tests and 5 backend integration tests, all green.
      **Deliberately deferred:** image/video guards (4.11 doesn't exist),
      the Python port (Robot v0.1), a small local model "second opinion"
      for adults (4.3 allows one, not built), real notification delivery
      through the notification system (2.6, stubbed as a log line), and
      turn-engine wiring (4.5 doesn't exist, so nothing calls this on a
      real conversation turn yet).
- [x] Memory (4.4): the store, core, backed by the `MemoryRecord` shape
      spec v0.1 already defined (memory/entity/episode as one table, one
      field set, `record_kind` the discriminator; no spec changes needed
      this pass). `backend/src/lib/memory.ts` is the core memory port:
      `remember` (validates against the generated `MemoryRecord` Zod
      schema via `safeParse` before writing, so an invalid record can
      never reach the table), `list` (browsing, doesn't touch usage),
      `recall` (a real query, does), `supersede` and `archive` (the
      routine lifecycle: retire and replace, tombstone; both a real
      status transition, never a row delete), `forget` and `exportPerson`
      (the per-person privacy pair, 2.2), `runMaintenance` (decay and
      archival). Ids follow the spec's `{prefix}{seq}-{device6}` pattern
      for real (`lib/memoryId.ts`, an atomic per-kind counter plus a
      persisted per-install 6-char tag in `lib/deviceId.ts`, a stand-in
      for the real Device record, 3.1, deferred). `lib/memoryShape.ts`
      applies the same discipline `lib/personShape.ts` learned the hard
      way: every response is parsed through the generated Zod schema
      before it goes out, from the start this time.
    - **Entity-first recall then scored vectors (4.4):** entity-first is
      real: a query whose words fully cover a known entity's name (the
      words before the first colon/period/comma in its `text`, since the
      spec's entity shape has no separate `name`/`aliases` field to index)
      boosts every record whose own words cover that same name, word-set
      containment rather than a raw substring check (`tests/memory.test.ts`
      has a case proving a short name like "Ann" doesn't false-match
      inside "annual"). "Scored vectors" needs an embedder (4.11, not
      built); the deterministic stand-in is a keyword-overlap score,
      documented in the code as a placeholder, not semantic search.
    - **Visibility and sensitivity:** any signed-in person sees household
      memories (sensitive ones admin/owner-only); a person always sees
      their own `scope: person` memories; owner/admin additionally see a
      **child's** `scope: person` memories in full, nothing of a teen's or
      adult's. This is narrower than 4.14's stated rule ("a summary and
      safety flags for a teen's"), a deliberate judgment call: there's no
      summarization mechanism to safely implement partial teen visibility
      yet, so teens get full privacy instead of a half-built compromise.
      `scope: self` is never returned by any read path, to any role,
      full stop: the schema's own field description calls it "not shared
      with anyone" and this pass takes that literally.
    - **`forget` is a real DELETE**, not a tombstone, unlike the routine
      judge lifecycle: 2.2's privacy architecture makes `host.data.forget
      (person)` a mandatory erasure right, distinct from the "never
      hard-deletes" rule 4.4 states for normal memory maintenance. Scoped
      to that person's `scope: person` records only; household memories
      that happen to mention them are out of scope (redaction from shared
      text is a much harder problem, not attempted).
    - **Decay and archival** (`runMaintenance`) is adapted from the legacy
      hub's `lib/memory/maintenance.ts` (principle 8: a real, tuned
      Generative-Agents-style exponential decay formula from production
      use, `0.995^hours-since-used` blended with importance and a gentle
      usage boost, not invented from scratch). `durable`-tier memories are
      never touched by decay or the per-scope cap, matching legacy exactly
      ("never touches durable memories"); this pass additionally treats
      the spec's `observation` tier (which legacy didn't have) the same as
      `episodic` for decay, a documented judgment call. A `state`-category
      memory always expires after 7 days regardless of tier or score,
      ported ahead of the judge that will eventually keep that promise for
      real. **One deliberate departure:** legacy's file also hard-deletes
      ("purges") archived/superseded rows after 90 days, despite its own
      header comment claiming nothing is hard-deleted, a real
      inconsistency in the legacy source. This pass does not carry that
      forward: platform plan 4.4 says the store "never hard-deletes"
      outside `forget()`'s deliberate erasure right, so every tombstone
      stays in place indefinitely here. Revisit if unbounded archive
      growth becomes a real problem on actual households. No scheduler
      exists yet (4.7) to run this on a timer; `POST /api/memory/
      maintenance/run` (owner/admin) is a manual trigger for now.
    - Exercised for real: booted the server and drove remember (household
      fact, an entity, a memory mentioning it), recall (confirmed the
      entity boost separates a mentioning record from an unrelated one,
      and that a short name doesn't false-match a longer word), supersede,
      archive, the full child-profile forget/export/visibility path, and
      maintenance (backdated a durable low-importance fact and an 8-day-
      old `state` memory directly in `hub.db`, confirmed the durable one
      survived and the state one archived) with `curl`, in addition to 26
      backend tests (47 assertions), all green.
    - **Deliberately deferred, all needing pieces that don't exist yet:**
      the sleep-time judge itself (deciding *what* to remember from a
      conversation needs an LLM, 4.11, and the turn engine, 4.5); profile
      paragraphs (LLM-synthesized, same dependency); mood and unfinished-
      business reads, the robot's reflect jobs (robot-specific, Robot
      v0.1); real embedding-based recall (4.11's embed role); a real
      scheduler running `runMaintenance` on a timer instead of the manual
      `POST /api/memory/maintenance/run` trigger (4.7); the decay
      thresholds are hardcoded constants pending a real settings key
      (4.6). All noted at the point they matter in `lib/memory.ts`.
- [x] Settings (4.6): the store, core. Chose this over the turn engine
      (4.5) as the next slice on a deliberate judgment call: the turn
      engine's core job ("the model phrases, it does not judge") needs an
      LLM (4.11) and packages to route to (4.9), neither built, so it
      would be mostly scaffolding with no real payoff yet; the settings
      registry and value shapes already existed from spec v0.1, so the
      store was fully buildable now, the same reasoning that picked
      memory before the turn engine earlier.
    - `spec/settings/keys.json` is explicitly "not a placeholder to fill
      in by hand" (`spec/settings/README.md`): it's generated from
      declarations. `backend/src/settings/coreKeys.ts` is core's
      declaration source (each entry parsed through the generated
      `SettingsKey` schema at load, so a bad declaration fails fast);
      `backend/scripts/gen-settings-registry.ts` writes it out, wired
      into `scripts/check.sh` with the same regenerate-and-diff pattern
      `spec/gen/` already uses. One real key so far,
      `household.locale`, chosen because the rule it backs
      (`docs/ENGINEERING.md`'s "dates, units, currency from household
      locale, never hard-coded") already shipped, not invented for this
      pass; more keys land with whichever core feature or package needs
      them next, not front-loaded speculatively now.
    - `backend/src/lib/hlc.ts`: a real hybrid logical clock
      (`wall_ms:counter:node`, 7.3), generated on every local write and
      compared (not assumed) before applying, even though there's only
      one writer today (no link/sync until Hub v0.3): the shape is right
      from the first write, so a future remote write compares correctly
      with no schema change.
    - `backend/src/lib/access.ts`: `isOwnerOrAdmin`/`rolesById`/
      `canAccessPerson` extracted out of `lib/memory.ts` the moment a
      second consumer (settings' person-scope authorization) needed the
      identical rule, applying the "one definition, one place" lesson
      from the 2026-09-04 review pass immediately instead of waiting for
      a reviewer to catch a second copy.
    - Household-scope settings: read by any signed-in person, written by
      owner/admin only. Person-scope settings: the same `canAccessPerson`
      rule memory uses (self, or owner/admin only for a child target).
      Device-scope: owner/admin only, provisional, since 3.1's Device
      record type doesn't exist yet to check real ownership against.
    - Per-selector value validation covers boolean/number/text/select/
      duration/time for real, plus `person` (checked against the real,
      non-deleted `people` table). `entity`/`area`/`media` selectors get
      loose string-only validation, a documented gap: Home Assistant
      entities/areas and a media library are both later features with
      nothing to validate against yet.
    - Exercised for real: booted the server and drove the registry
      listing, a default-value read, a write, a rejected out-of-range
      value, a reset back to default, and a non-owner's write correctly
      refused, all with `curl`, in addition to 24 backend tests (41
      assertions), all green.
    - **A `code-review` pass (medium effort, same day) on this slice
      before committing** found and fixed three real issues: `secret:
      true` registry keys had no redaction anywhere (`listValues`/
      `setValue` returned the raw value straight through), a real
      violation of CLAUDE.md's hard "never the value" rule that was
      untested only because today's one key isn't secret; fixed with
      `resolveForResponse` (returns `value: null` plus an `isSet` flag
      for a secret key, the same "present/not present, never the value"
      shape the credentials rule asks for everywhere else). `lib/hlc.ts`'s
      counter reset to zero on every process restart with nothing
      recovering from what was already persisted, so a wall-clock
      regression after a restart (no RTC, NTP not yet synced, a manual
      clock change) could generate an hlc smaller than one already
      stored and permanently refuse further writes to that key with a
      misleading error; fixed with `seedHlc()`, called once at
      `lib/settings.ts`'s module load from every hlc already on disk.
      `lib/access.ts`'s extraction had settings call the batch
      `rolesById()` (a full table scan) to resolve a single person's
      role; added a targeted `getPersonRole()` and made `canAccessPerson`
      use it when no pre-built map is supplied, keeping the batch path
      for memory's per-record filtering loop. All three verified with new
      tests and (for the first two) live `curl`/direct exercise, not just
      re-run through the suite.
    - **Deliberately deferred:** the generic settings renderer and every
      UI rule in 6.5/6.6 (shell/kit work, chapter 6, not started); the
      settings index/search (6.6 Rule 5, needs the palette); robot-only
      keys sent on `hello` (needs the link, Hub v0.3); package manifest
      `config[]` as a second registry source (needs the package host,
      4.9); real oplog-based sync consuming the hlc field (needs 7.3).
- [x] The package host (4.9), Tier 0 only, the fifth slice of hub core.
      Picked next (not the turn engine) for the same reason settings was:
      Tier 0 recipes are explicitly "no process" (5.2), and the
      interpreter and host emulator already existed from spec v0.1, so a
      real host was buildable today without Deno/MCP or an LLM.
    - `spec/emulators/ts/host-emulator.ts` gained an exported `Host`
      interface (the emulator's existing method shapes, extracted) so
      `spec/interpreters/ts/recipe-interpreter.ts`'s `runRecipe()` types
      against the interface, not the concrete `HostEmulator` class,
      letting a real implementation exist without inheriting the
      emulator's test-only state. Python's interpreter already took
      `host: Any` (pure duck typing), so no parity change was needed
      there. Fixing this also surfaced a real, separate bug: `Recipe`'s
      generated `steps` field types as `any` (`json-schema-to-zod` can't
      emit a discriminated union for `oneOf`), which had silently
      defeated the interpreter's exhaustiveness check and left every
      `step.xxx` access untyped throughout the switch, invisible only
      because `spec/` had never run a standalone `tsc --noEmit` before
      `backend/` started importing this file. Fixed with a hand-written
      `RecipeStep` union mirroring the schema's 7 step defs.
    - `backend/src/lib/packageHost.ts`: a real `Host` for one package
      invocation, scoped to the acting person and that package's
      manifest. `memory.recall`/`memory.remember` and `data.forget` are
      real, backed by `lib/memory.ts`; `config.get` resolves against the
      real household settings store (`lib/settings.ts`); `log()` really
      redacts, sharing one `redactSecrets()` with the emulator
      (`spec/emulators/ts/host-emulator.ts`) rather than a second copy.
      Every method that maps to an entry in `spec/vocab/permissions.json`
      checks the manifest's declared `permissions` first and throws
      `permission_denied` (a catalogue code, `spec/errors/errors.json`)
      if it wasn't declared, before doing anything else.
    - Everything else (`fetch`, `home.call_service`, `integration.call`,
      `speak.sentence`, `llm.complete`, `camera.still`, `ocr.read`,
      `schedule`, `files.*`, `action.emit`, `diagnostics`) has no backing
      service yet (no rate limiter, no Home Assistant link, no LLM role,
      no turn engine to route actions to, no scheduler, no package file
      storage) and throws `capability_missing`. That code's catalogue
      description ("a required capability... is not present on this
      node") doesn't quite fit "the host hasn't built this RPC on any
      node yet"; `errors.json` has no code for that distinction. Left as
      the closest existing fit rather than inventing an out-of-catalogue
      code, flagged here as a real, open gap for a future `errors.json`
      revision. Zero live blast radius today: no turn engine routes to
      any of these, and the one bundled package doesn't call them.
    - `backend/src/lib/skills.ts`: loads a bundled package's
      `manifest.json`/`recipe.json` from `backend/packages/<id>/`,
      validates both against spec's generated Zod schemas, rejects a
      tier-1 manifest (no Deno sandbox yet), checks `min_role` against
      the real role ladder before running, validates the call's inputs
      against the manifest's own `args` JSON Schema with `ajv` (matching
      `spec/tests/ts/ui-schema.test.ts`'s existing choice of engine and
      2020-12 dialect) before ever handing them to the interpreter, then
      runs the recipe through spec's real `runRecipe()`.
    - `backend/packages/remember/`: the first bundled Tier 0 package,
      the plan's own named example ("remember and forget as ways of
      asking will be a default skill package calling the core memory
      port," 4.4). One `remember` step plus a `format` reply. No
      `forget` recipe step exists in `recipe.schema.json` (`forget` isn't
      a Tier 0 primitive), so this package covers "remember" only;
      erasure stays `host.data.forget`, reachable from a Tier 1 package
      or an admin flow, not from any recipe.
    - `GET /api/skills` (lists bundled manifests) and
      `POST /api/skills/:id/run` (runs one).
    - Exercised for real: booted the server and drove the full path with
      `curl` (setup, list, run, the fact landing in a real recall,
      unauthenticated and unknown-package rejections), in addition to 25
      backend tests, all green.
    - **A `code-review` pass (medium effort) on this slice before
      committing** found and fixed four real issues: a missing required
      input reached the interpreter, left its `{fact}` placeholder
      un-interpolated by `interpolate()`, and was written to the real
      memory store as literal text with a 200 back: the `ajv`
      args-validation step above is the fix, with a regression test and
      a live `curl` check that confirms nothing gets written. `host.fetch`
      called `new URL()` before any error handling, so a malformed url
      raised a raw `TypeError` instead of a `HostError`, breaking "the
      host wraps errors so a package cannot throw an unmapped one past
      the boundary": fixed with a try/catch mapping to `invalid_input`.
      The redaction logic in `packageHost.ts`'s `log()` duplicated the
      emulator's inline version, and the two had already drifted (the
      emulator's didn't recurse into arrays) before either shipped:
      extracted to the shared `redactSecrets()` both now call. The
      `capability_missing` semantic mismatch above was also raised by
      this review; documented rather than papered over with a code the
      catalogue doesn't actually support.
    - **Deliberately deferred:** Tier 1 (Deno sandbox, MCP), the rate
      limiter behind `host.fetch` (4.9/"we are the user"), package file
      storage, real `home.call_service`/`integration.call`/`speak`/
      `llm`/`camera`/`ocr` backing (each needs its own not-yet-built
      subsystem), the catalog and install flow (packages are read
      straight off disk from `backend/packages/`), package signing, and
      the `errors.json` code gap noted above. `host.schedule` itself is
      real as of the next slice below.
- [x] The scheduler (4.7), the sixth slice of hub core. Picked next for
      the same reason the package host was: genuinely buildable today
      (pure logic, a timer, and SQLite; no LLM, no Deno, no Home
      Assistant link), and it directly unblocks two deferrals already on
      record: `host.schedule` (packageHost.ts, previously
      `capability_missing`) and memory maintenance's manual-only trigger
      (`lib/memory.ts`'s own comment: "no scheduler exists yet... a
      manually-triggered pass for now").
    - **Not a spec record.** Chapter 3.1's record type table has no Job
      entry, and 4.7 doesn't ask for one, so `scheduledJobs` is
      hub-internal storage (`backend/src/db/schema.ts`), the same way
      `sessions` and `id_sequences` are, not a new `spec/schemas/*`
      shape. This may need to become a real spec shape later for robot
      parity (the robot needs its own scheduler too, per "the robot is
      complete without a hub"), deferred until `bot` exists as real
      content to need it.
    - **Scope, narrower than 4.7's full description, same discipline as
      every slice this session:** no device target (3.1's Device record
      doesn't exist), no quiet-hours policy (no settings key declared
      for one), no notification-system integration (4.13 isn't built; a
      fired job runs and logs, the way `safety.ts`'s HTTP route stands
      in for the turn engine). `when`'s "recurrence expression" (the
      recipe schema's own words) is a deliberately minimal `every:<n>
      <m|h|d>` grammar (`lib/scheduler.ts`'s `parseWhen`), not RRULE; a
      one-shot `when` is a plain ISO datetime, and a past one is
      rejected, not silently treated as "fire immediately."
    - `lib/scheduler.ts`: `scheduleJob` (persists a "skill" job: re-run
      a package for a person with saved inputs when `when` fires),
      `ensureCoreJob` (idempotent, called at every boot to seed the
      `memory.maintenance` core job), `listJobs`/`cancelJob` (owner/admin
      see every job, anyone else only their own; cancelling only ever
      applies to a still-pending job), and `runDueJobs` (fires every
      pending job whose `nextRunAt` has passed; a recurring job
      reschedules from its *own* due time, not from when it actually
      fired, landing on the next slot at or after `now` in one step so a
      long outage doesn't mean firing once per missed interval to catch
      up, and never drifts a daily job's time-of-day later just because
      a tick was late). `index.ts` is the one real entrypoint that seeds
      the core job and starts a 60s poll calling `runDueJobs`; `app.ts`/
      routes stay import-only so a test booting the app via Hono's
      `.request()` never starts a live timer.
    - A known, documented gap, not silently worked around: neither the
      `Host` interface's `schedule(when, job)` nor the interpreter's own
      schedule-step handling carries the recipe's input scope through, so
      a job scheduled from *within* a recipe re-fires its package with an
      empty input scope, not the inputs the original call had. Fixing
      this needs an interpreter-level change (both TS and Python, kept
      behaviorally identical) out of scope here; a job scheduled directly
      via `scheduleJob()` (not through a recipe step) doesn't have this
      limitation, since its caller passes inputs explicitly.
    - `GET /api/scheduler/jobs`, `POST /api/scheduler/jobs/:id/cancel`,
      `POST /api/scheduler/run-due` (owner/admin, the same
      "manual-trigger stand-in" `POST /api/memory/maintenance/run`
      already established).
    - Exercised for real: booted the server, confirmed the
      `memory.maintenance` core job seeds itself on boot, forced it due
      with a direct SQL update, fired it through the real HTTP route, and
      confirmed it rescheduled to a real future slot rather than getting
      stuck near a stale timestamp, in addition to 18 backend tests, all
      green.
    - **A `code-review` pass (medium effort) on this slice before
      committing** found and fixed three real issues, one serious enough
      that fixing it properly required redesigning the catch-up math, not
      just patching the reported line: `parseWhen` silently accepted a
      one-shot time already in the past (scheduling it as immediately
      due) despite its own docstring and `scheduleJob`'s own error
      message both claiming rejection: fixed by actually enforcing it.
      A recurring job's reschedule advanced from `now` (when it actually
      fired) instead of from its own scheduled `nextRunAt`, which would
      have permanently pushed a daily job's time-of-day later by however
      late each tick was: the first fix (advance from `nextRunAt` by one
      interval) turned out to be incomplete once tested against a very
      overdue job (the test suite's own "force it due" pattern sets
      `nextRunAt` to the Unix epoch): advancing one interval at a time
      from 1970 would take on the order of ten days of continuous 60s
      polling to catch up to the present. Redesigned to compute the next
      aligned slot directly (`originalNextRunAt + N * intervalMs` for the
      smallest `N` landing at or after `now`), which preserves the
      original time-of-day exactly regardless of how large the gap is.
      `cancelJob` didn't check a job was still pending, so an
      already-"done" job could be flipped to "cancelled" after the fact,
      corrupting the one field an operator or future UI reads to answer
      "did this actually run." All three have regression tests pinning
      the fixed behavior, including one that fires a job 3 hours late and
      asserts the reschedule lands exactly one interval past the
      *original* due time, not past the moment it fired.
    - **Deliberately deferred:** device targets, quiet-hours, the
      notification system (all above), a spec-shaped Job record (until
      `bot` needs one), the interpreter input-carrying gap (above), and
      real RRULE-style recurrence (the `every:<n><unit>` grammar is a
      placeholder).
- [x] The `chat` model role and a llama-server router skeleton (4.11,
      **split, not full**), the seventh slice of hub core. 4.11 describes
      ten model roles, a multi-role residency policy with GPU placement
      and KV cache tuning, real GGUF downloads pinned by sha256 for three
      platforms, and a `ModelCapabilities` catalog record: too large for
      one slice (flagged as a real risk before starting; confirmed true
      after re-reading 4.11 in full). Split into a router skeleton against
      a stub/mock model this pass, real downloads and the rest of the
      roles later, per the judgment call this session was explicitly
      asked to make rather than guess at the whole thing.
    - `spec/llm/` (mirroring `spec/safety/`'s precedent: language-portable
      design, not a spec-schema record): `ts/types.ts` is a hand-written
      OpenAI-compatible chat-completions subset (non-streaming; no tools,
      JSON schema, grammar, or `chat_template_kwargs` yet), deliberately
      not run through the schema+codegen pipeline since it mirrors an
      external wire contract rather than a MaiPai-defined stored record.
      `ts/client.ts`'s `LlamaServerClient` is real: it makes real HTTP
      requests to whatever base URL it's given, so it works unmodified
      against either a real llama-server or `ts/stubServer.ts`'s
      in-process stand-in (both speak `/health`, `/v1/models`,
      `/v1/chat/completions`). Every stub reply is prefixed `[stub model:
      no real model loaded, this is a canned reply]`, mirroring
      `host-emulator.ts`'s existing `llm.complete` wording, so a canned
      answer can never be mistaken for a real one downstream.
      `spec/llm/README.md` is the design record: full scope, what's
      deferred, and why.
    - `backend/src/lib/llmSupervisor.ts`: picks the `chat` backend lazily
      on first use, in order: `MAIPAI_LLAMA_SERVER_URL` (point at an
      already-running server), `MAIPAI_LLAMA_SERVER_BIN` +
      `MAIPAI_CHAT_MODEL_PATH` (spawn a real `llama-server` process via
      `Bun.spawn`, poll `/health` until ready), or the in-process stub
      when neither is set, which is every dev machine and the test suite
      today since neither env var is configured anywhere in this repo.
      `backend/src/lib/llm.ts` is the role port: `LlmRole` names all ten
      4.11 roles, but only `chat` is in `IMPLEMENTED_ROLES`; every other
      role returns a real `unsupported_role` result, not a crash or a
      silent stub. `complete()` validates the messages array (non-empty,
      each message's role in system/user/assistant) before ever touching
      the supervisor.
    - New route: `POST /api/llm/chat` (any signed-in person, no role
      gate, matching `/api/safety/check`'s posture for a person's own
      request), the real (if provisional) caller ahead of the turn engine
      (4.5), which doesn't exist yet to call this role internally.
    - **`host.llm.complete` in `packageHost.ts` deliberately still throws
      `capability_missing`, for a different and more precise reason than
      before.** It used to be "no LLM role exists"; now the role is real
      but the `Host` interface (`spec/emulators/ts/host-emulator.ts`) is
      entirely synchronous and `runRecipe()` never awaits a host call
      (`spec/interpreters/ts/recipe-interpreter.ts`), while a real chat
      completion is inherently async network I/O. There is no correct way
      to make that synchronous; wiring this through for real needs the
      interpreter itself to support async host calls, in both TS and
      Python kept behaviorally identical, out of scope here, the same
      category of deferral as the scheduler's recipe-input-carrying gap.
      Zero live blast radius: no recipe step type calls `llm.complete`
      today (`recipe.schema.json` has no "llm" step).
    - Exercised for real: booted the server (stub-backed, since no real
      llama-server binary or GGUF exists on this dev machine or anywhere
      in this repo) and drove an authenticated chat completion, an
      unauthenticated rejection, an unsupported-role rejection, and a
      missing-messages rejection with `curl`, in addition to 7 spec-level
      tests (the client against the stub, over a real loopback socket)
      and 12 backend tests (the role port, the supervisor's retry
      behavior, the route, and `packageHost.ts`'s `llm.complete` gap),
      all green.
    - **A `code-review` pass (medium effort) on this slice before
      committing** found one confirmed bug and one real, deferred gap.
      **Confirmed and fixed:** `llmSupervisor.ts`'s `getChatClient()`
      never cleared `startingPromise` on a failed start, so any transient
      spawn failure (a briefly-wrong model path, a taken port, a slow
      first load past the health timeout) permanently wedged the `chat`
      role for the rest of the process's life, replaying the same stale
      rejection on every later call instead of retrying, until a full
      restart. Fixed by clearing `startingPromise` in a `.catch` before
      rethrowing; proven with a regression test
      (`backend/tests/llmSupervisor.test.ts`) that first confirms the
      buggy version fails it (a bad `MAIPAI_LLAMA_SERVER_BIN`, then a
      second call after clearing the env var, without ever calling the
      test-reset helper) before confirming the fix passes it.
      **Real, deferred, not fixed here:** `POST /api/llm/chat` has no
      rate limit or role gate, so any signed-in person (including a
      `guest` or `child`) can fire unlimited concurrent requests against
      the one supervised `chat` process. Matches `/api/safety/check`'s
      existing posture, and a real fix needs information this pass
      doesn't have (the real engine's concurrency behavior, `-np`, once
      Jesse picks one); documented as tracked debt in
      `spec/llm/README.md` rather than guessed at.
    - **Deliberately deferred, real 4.11 scope not attempted:** every
      role but `chat`; the real engine (no GGUF, no engine binary, no
      platform-pinned downloads); the multi-role residency policy
      (`/models/load`/`unload`, GPU placement, KV cache tuning, only
      meaningful with more than one resident model); streaming, tools,
      JSON schema, and grammar on the chat contract; a `ModelCapabilities`
      spec record (nothing to populate it yet, no catalog, no install
      flow); `host.llm.complete` wiring (above). Full reasoning in
      `spec/llm/README.md`.
    - **A decision left to Jesse, not guessed:** which GGUF is the
      default `chat` model, and what hardware the real household hub runs
      on (this dev machine has Apple Silicon/Metal; the deployed hub's
      hardware is unknown to this session). Nothing in this pass blocks
      on that: the stub keeps the whole router path provable without it,
      and the three env vars are ready to point at a real answer the
      moment Jesse picks one.

- [x] The turn engine (4.5, **split, not full**), the eighth slice of hub
      core. 4.5 describes one turn engine for six surfaces, stable-first
      prompt assembly for prefix caching, safety-first routing through a
      two-tier deterministic skill floor, remote candidates, and `ask`
      lets a deterministic follow-up match without a model: too large for
      one slice on the same reasoning 4.11 needed splitting (confirmed
      after re-reading 4.5 in full). Split into one surface, a real
      deterministic floor, and a real stable-first prompt this pass; tier
      2 tool calling, remote candidates, and the other five surfaces
      later, the judgment call this session was explicitly asked to make.
    - `backend/src/lib/turnEngine.ts`: `runTurn(actor, surface, text)`.
      Pipeline, safety first per 4.5: `evaluateSafety()` runs before
      anything else; a `refuse` verdict returns a deterministic refusal
      (`"I can't help with that."`) with no skill routing and no model
      call, matching 4.3's "no model in the loop for the floor."
      `allow_with_resources` (self-harm's floor behavior) does not divert
      the turn: it proceeds through routing/model normally, and a
      `crisis_resources` string rides alongside the real reply on the
      `TurnValue`, kept as a separate field rather than concatenated into
      the reply text, a deliberate judgment call so a surface can present
      it "alongside... never blocking" (4.3's own words) instead of having
      it silently reshape the model's own phrasing.
    - **The deterministic skill floor (4.5's "tier 1 example-embedding
      match"), real but without an embedder:** no embed role exists
      (4.11), so `routing.examples` is matched by keyword-overlap coverage
      against the utterance instead, the same documented-placeholder move
      `lib/memory.ts`'s recall() already made for "scored vectors";
      `lib/text.ts` (new) extracts the shared tokenizer both now use, one
      definition instead of two, the same discipline `lib/access.ts`
      applied to `canAccessPerson`. `routing.patterns` is matched for
      real: a pattern with exactly one `*` wildcard is a real regex
      capture. **Neither `routing.patterns`' wildcard semantics nor how a
      capture binds to a manifest's `args` schema is spelled out anywhere
      in the plan or spec** (grepped for any existing consumer: none):
      this pass is the first real consumer, so the binding rule is this
      session's own documented judgment call: a captured wildcard binds
      only when the package needs zero or exactly one required string
      argument (`deterministicArgs()`); anything richer has no capture to
      bind to and falls through toward the model. A `consequential`
      package (4.9's manifest field) only fires on a real pattern match,
      never a fuzzy example score, however high, matching 4.5's "a
      consequential package raises the bar" literally.
    - **Stable-first prompt assembly, for real:** `buildSystemPrompt()`
      builds persona/rules (a fixed default: no Persona/style record
      exists yet, 3.1 lists the type but nothing implements it), a content
      policy line, standing instructions, and the bundled skills list as
      one stable prefix (unchanged from turn to turn on a given install,
      so genuinely prefix-cacheable once a real engine sits behind
      `llmSupervisor.ts`), then the volatile zone 4.5 names: recalled
      memories (via the real `memory.recall()`), then the current time,
      last. 4.5 also names notes, methods, summary and context in the
      volatile zone: notes/methods need persona/companion state (not
      built), summary needs conversation history (4.14, not built), and
      context needs hub-side ambient-context wiring the robot side already
      has but the hub doesn't; all three are real, named gaps.
      **`PROMPT_SYSTEM_CHAR_BUDGET` (4000 chars) is a real, tested budget**
      (4.5: "a prompt budget as a test"), not just a comment: the memory
      section is truncated to fit its own carve-out, and the whole prompt
      is hard-capped, proven by a test that seeds 50 long memory records
      and asserts the assembled prompt still fits.
    - **A real, load-bearing interpreter gap found and documented, not
      worked around:** `SkillResult.ask` (`result.schema.json`, "lets a
      deterministic follow-up match without a model") is a real spec
      shape, but `spec/interpreters/ts/recipe-interpreter.ts`'s
      `runRecipe()` never produces one (it always sets `reply`, from any
      `format` step regardless of the step's own `as` value); grepped
      confirmed no code anywhere constructs an `ask` result today. Same
      category of gap as the scheduler's recipe-input-carrying limitation
      and `host.llm.complete`'s sync/async wall: fixing it needs an
      interpreter-level change (both TS and Python, kept behaviorally
      identical), out of scope here. Nothing in this pass builds a fake
      version; `ask`-continuation is a clean, named deferral.
    - New route: `POST /api/turn` (any signed-in person, no role gate,
      matching `/api/safety/check` and `/api/llm/chat`'s posture: a
      person's own conversation turn isn't a privileged action). Those two
      routes stay as-is, useful in their own right (direct diagnostics),
      now that this is the real caller they were both standing in for.
    - Exercised for real: booted the server and drove, with `curl`, the
      safety-refuse path (a harmful-request corpus phrase, confirmed no
      skill or model call fired), the allow_with-resources path (a
      self-harm corpus phrase, confirmed `crisis_resources` carries "988"
      alongside a real reply), the deterministic skill floor (`"remember
      that trash day is Tuesday"` fired `remember` with `source: "skill"`,
      no model call, and the fact landed in a real recall), the model
      fallback for ordinary conversation, and the unimplemented-surface
      rejection, in addition to 11 new backend tests (30 assertions), all
      green.
    - **Deliberately deferred, real 4.5 scope not attempted:** every
      surface but `chat`; tier 2 native tool calling (the model choosing
      and calling a skill when the deterministic floor doesn't clear,
      needs tool support on the chat contract, itself deferred in
      `spec/llm/README.md`); remote candidates (no remote backend
      configured anywhere); `ask`-continuation (above); a real
      Persona/style record; summary and cross-surface context (4.14's
      other pieces, see the next slice for conversation history itself).
- [x] Conversation history (4.14, **split, not full**), the ninth slice of
      hub core. Picked next on the same "genuinely buildable now, directly
      unblocks the last slice's own documented gap" reasoning as every
      other pick this build: the turn engine's biggest deferred item was
      "every turn is stateless"; `lib/access.ts`'s `canAccessPerson`
      already carried a comment naming 4.14's visibility rule as the
      reason it was extracted, before this file existed, a strong signal
      this was the intended next consumer.
    - `backend/src/lib/conversationHistory.ts`: `logTurn()` (called once
      from `turnEngine.runTurn()` for every real completed path, refusals
      included: a parent should be able to see that a request was made
      and refused, the same oversight motive `notify_parent` serves),
      `list()` (a person's own turns, or owner/admin for a child's, empty
      list on denial, matching `memory.ts`'s browsing precedent), and
      `exportPerson()` (the full per-person archive; a real 403 on denial,
      matching `memory.ts`'s `exportPerson()` precedent instead, since
      export is a privileged single-target action, not filtered browsing).
      New table `conversation_turns` (schema version bumped to 5): not a
      spec 3.1 record type (chapter 3's table has no Conversation entry
      either), the same "hub-internal, revisit for robot parity later"
      call `lib/scheduler.ts`'s Job made.
    - **Visibility is the exact rule `memory.ts` and `settings.ts` already
      share**, reused directly via `lib/access.ts`'s `canAccessPerson`:
      self, or owner/admin only for a **child** target. 4.14's own text
      asks for "a summary and safety flags for a teen's," but there's no
      summarization mechanism to safely implement that yet; this pass
      applies the identical narrowing judgment call `memory.ts`'s
      scope:person visibility already made and documented (nothing of a
      teen's or an adult's, full privacy instead of a half-built
      compromise), which `canAccessPerson`'s own comment had already named
      as this exact 4.14 rule.
    - **Retention, a real household setting wired through for real:**
      `household.conversation_retention_days` (`backend/src/settings/
      coreKeys.ts`, selector `number`, range 7-365, default 90) is the
      first core settings key besides `household.locale` to actually get
      read by anything (`lib/settings.ts` gained `getHouseholdSettingValue()`,
      a no-actor-gate internal read for core maintenance jobs, never
      exposed through a route). `runRetention()` hard-deletes turns past
      the window. **No summarize-then-purge:** 4.14 describes turning old
      conversations into a summary, but that needs an LLM (4.11's other
      roles) that doesn't exist, so this pass is a real hard delete,
      stricter than the plan's design but the privacy-safer default
      (nothing kept indefinitely past its stated window) until
      summarization lands, a deliberate, documented departure the same
      shape as `memory.ts`'s decision not to carry forward legacy's purge.
    - **The kid-safety floor, a real judgment call with no number given in
      the plan:** 4.14 says retention is "a household setting with a
      floor for kid safety logs" but names no floor value. This pass picks
      90 days (matching the retention default itself, so a household that
      never touches the setting sees no floor effect at all) and applies
      it only to turns that are both safety-flagged **and** from a minor
      speaker (captured at write time as `minorSpeaker`, not re-derived by
      joining to `people` later, since a person's role can change and the
      floor should reflect who they were when they spoke). The floor only
      ever *extends* the effective window: a household that sets retention
      longer than 90 days is unaffected, since the general rule already
      keeps those turns longer.
    - **Wired as a real daily scheduled job from the start**
      (`conversation.retention` in `lib/scheduler.ts`'s `CORE_JOBS`,
      seeded at boot in `index.ts`), not a manual-only trigger: unlike
      `memory.ts`'s `runMaintenance()` when it first shipped, the
      scheduler (4.7) already existed by the time this was built, so there
      was no reason to defer real wiring. New routes: `GET
      /api/conversations` (own, or `?person=<id>` for owner/admin),
      `GET /api/conversations/export` (same, 403 on denial).
    - Exercised for real: booted the server and drove, with `curl`, a real
      turn writing a real row, a refused turn logging with its safety
      metadata (never leaking the refused text into a separate audit
      channel, it's just the conversation itself), a child's turn visible
      to the owner via `?person=`, the `household.conversation_retention_days`
      key appearing in the real registry at its default, and the full
      scheduled path end to end: forced the seeded `conversation.retention`
      job due, backdated a normal turn to 2020, fired it through the real
      `POST /api/scheduler/run-due` route, and confirmed the old normal
      turn was deleted while a recent safety-flagged turn survived, in
      addition to 17 new backend tests (33 assertions), all green.
    - **Deliberately deferred, real 4.14 scope not attempted:** household
      search across content types (needs the shell palette, chapter 6, and
      content types like notes/media that don't exist); 90-day
      summarization instead of hard delete (above); an audit of who viewed
      what; a synced spec-shaped record for robot parity (needs the link,
      7.3, and `bot` to exist as real content); feeding recalled history
      back into the turn engine's own prompt as prior conversational
      context (today's turn engine is still stateless in its *reasoning*,
      even though the history now exists for real).
- [x] Backups (2.5, **split, not full**), the tenth slice of hub core.
      Picked next: the hub has stored real family data (people, memories,
      conversations) for several sessions with zero backup story, a real
      product gap, and everything it needs (the keystore, the scheduler)
      already existed, the same "genuinely buildable now" bar as every
      other pick this build. Full 2.5 has real product surface (a Storage
      page, an emergency kit at setup printing the backup key, restore as
      onboarding's second screen, `hub`/`smb` targets for robots and a
      NAS, a restore drill wired into the release skill): none of that
      exists yet (shell hasn't started; no release has ever been cut), so
      this is the real backend mechanism underneath, split the same way
      as every model-role and turn-engine slice.
    - `backend/src/lib/backup.ts`: `runBackup()` takes a real, consistent
      snapshot via SQLite's own `VACUUM INTO` (not a raw file copy, which
      could catch a WAL-mode database mid-checkpoint), encrypts it
      AES-256-GCM with a dedicated `backup` key from the existing keystore
      (`lib/keystore.ts`, the same macOS Keychain/Windows DPAPI/0600-file
      mechanism the PIN pepper already uses, a new named key so a rotated
      pepper can never also invalidate every backup), and writes it to
      the `local` target (`lib/paths.ts`'s new `backupDir`, a sibling of
      `data/`, `MAIPAI_BACKUP_DIR` overridable the same way
      `MAIPAI_DATA_DIR` is). `hub`/`smb` targets don't exist (no robot or
      NAS integration built). `listBackups()` and `pruneBackups()`
      (below) round out the store; `restoreBackup()` is real and tested
      but deliberately not wired to any HTTP route (its own comment
      explains why, see below).
    - **Retention, a real grandfather-father-son scheme bounded by actual
      time windows, not just bucket counts:** 2.5 says "seven daily, four
      weekly, three monthly, oldest pruned first." `pruneBackups()`
      partitions every backup into exactly one of three non-overlapping
      age windows (the last 7 days, the 4 weeks after that, the 3 30-day
      months after that) by its own age, then keeps at most one per
      distinct day/week/month within its window; anything outside all
      three windows, or that loses its bucket to a newer backup, is
      deleted. **A real bug caught by writing the test for it, not by a
      review:** the first cut let a backup that lost its daily-bucket slot
      "fall back" to try the weekly tier too, since the weekly window's
      span also covers "today." That meant two same-day backups (a manual
      "run now" on top of the scheduled one) both survived instead of one
      being pruned, defeating the same-day dedup entirely. Fixed by
      replacing the fallback with strict, non-overlapping windows (a
      backup's age places it in exactly one tier, never more than one),
      caught by `tests/backup.test.ts`'s "multiple backups on the same
      day only ever keep one" test failing against the buggy version
      first. No size cap per target yet (2.5 asks for one): no settings
      key exists to declare it, the same provisional gap
      `lib/memory.ts`'s decay thresholds already have.
    - **Scheduled from the start, no manual-only phase:** `backup.run` is
      a real `CORE_JOBS` entry (`lib/scheduler.ts`) seeded at boot
      (`index.ts`, `every:1d`), the same "the scheduler already exists,
      no reason to defer real wiring" call the conversation history slice
      already made for `conversation.retention`. 2.5's "at a household-set
      time in the nightly window" isn't honored: the scheduler's `when`
      grammar has no time-of-day concept, a pre-existing, already-
      documented gap (`lib/scheduler.ts`'s own header comment), reused
      here rather than re-solved.
    - **`restoreBackup()` is real and proven, deliberately not an HTTP
      route:** decrypts one archive into a fresh, valid SQLite file at any
      path, verified by `tests/backup.test.ts` actually opening the
      restored file and querying real rows (a person, a memory, a
      conversation turn), not by trusting the encryption round-trips.
      GCM's own auth tag rejects a tampered or corrupted archive before
      any plaintext is written (proven with a real bit-flip test), which
      is 2.5's "archives are signed and a tampered one is refused." Not
      wired to any route or to the live `data/hub.db`: safely swapping a
      running process's live database needs the staged verify/backup/
      migrate/swap/health-check machinery 2.4's updates describe, which
      doesn't exist (no release has ever been cut, so there's no
      update/rollback path to reuse for a restore either).
    - New routes, owner/admin only (a backup isn't scoped to one person,
      it's the whole household's): `GET /api/backups`,
      `POST /api/backups/run`.
    - Exercised for real: booted the server, drove a real backup through
      `POST /api/backups/run`, confirmed the encrypted `.db.enc` file on
      disk with `0600` permissions, confirmed the seeded `backup.run`
      scheduled job, confirmed a child is 403'd, and (outside the HTTP
      layer, since restore has no route) ran `restoreBackup()` directly
      against that real backup file and queried the restored database for
      the real person, memory, and conversation turn it had just written,
      in addition to 9 new backend tests (25 assertions: real backup +
      restore, a tampered-archive rejection, an unknown-backup rejection,
      listing order, and the retention window/dedup cases), all green.
    - **Deliberately deferred, real 2.5 scope not attempted:** "built from
      declarations" (a real multi-store registry: only one store exists
      today, hub.db, so there's nothing yet to prove a registry needs);
      `hub`/`smb` targets; the emergency kit and any Storage page UI
      (chapter 6); a per-target size cap (no settings key); the restore
      drill wired into the release skill (no release has been cut); an
      HTTP restore route (above).

- [x] The shell, kit, and Chat package (chapter 6, **split, not full**), the
      eleventh slice of hub core. Chapter 6 describes a full cross-platform
      shell (SwiftUI targets too), a complete pattern catalog, a generic
      `UiNode` interpreter, Module Federation, TV/kids adaptation, i18n
      catalog infrastructure, and PWA polish: too large for one slice, the
      same reasoning 4.5 and 4.11 needed splitting (confirmed after
      re-reading chapter 6 in full). Split into a real web shell, the kit
      primitives Chat actually needs, and a real hand-built Chat page
      against the live backend this pass; the generic interpreter and
      everything cross-platform later, a judgment call made overnight
      without Jesse (asleep, "keep building, make the decisions for me").
    - `frontend/` (new workspace member): Vite + React 19 + TypeScript,
      Tailwind v4 via `@tailwindcss/vite`, per `STACK.md`. `src/kit/` is
      `@maipai/ui`-to-be, kept in-repo for now rather than its own
      workspace package or catalog entry - extraction is real work that
      only pays off once a second consumer (Companions, Videos) exists:
      `tokens.css` (light/dark via `prefers-color-scheme` plus a
      `data-theme` override nothing sets yet; Home's real cyan accent
      from `.github/brand/README.md`'s per-product table, not a guessed
      color), `icons.ts` (the lucide name -> component registry
      `docs/UI.md` requires - "icons: lucide only, by name"), `components/`
      (hand-written `Button`/`Input`/`Avatar` matching shadcn/ui's usual
      API rather than the shadcn CLI's network fetch mid-session - a
      drop-in swap later, not an API change), `primitives/` (`Page`,
      `Section`, `EmptyState`, `Progress`, `MessageThread`, `Form`: the six
      v0 `spec/ui/schema.json` node kinds Chat needs).
    - **`MessageThread` carries the one real hard-won technique reused
      from the legacy hub tonight (principle 8):** follow new messages to
      the bottom only while the person hasn't scrolled up to read
      something earlier, so a reply arriving mid-scrollback doesn't yank
      them back down. The legacy resumable-SSE-reconnect technique was
      **not** reused: this backend's turn engine is single-shot JSON, not
      streaming, so there is nothing yet to resume.
    - **Real sign-in** (`src/shell/SignIn.tsx`), hand-built (not yet a
      declared page - v0 of `spec/ui` only covers Chat): the
      `GET /api/auth/profiles` picker, first-run `POST /api/auth/setup`,
      and `POST /api/auth/select`/`POST /api/auth/verify-secret` for
      everyone else, including the lockout/back path.
    - **Real Chat page** (`src/apps/chat/ChatPage.tsx`): loads
      `GET /api/conversations` on mount, maps each row to two thread
      entries (`mapRows.ts`, tested - `ConversationTurnRow` is one row per
      turn, `message_thread` wants one sender+text per entry), submits via
      `POST /api/turn`, appends the real `TurnValue` reply, and surfaces
      `crisis_resources` alongside the reply, never in place of it,
      matching 4.3's "offer, never block" (`turnEngine.ts`'s own field
      comment).
    - **Fixed `spec/ui/pages/chat.json`'s routes to match the real
      backend:** it was written against `/api/chat/turns`,
      `/api/chat/send`, `/api/chat/status`, `/api/chat/suggestions`, none
      of which the backend serves. Now binds to the real
      `/api/conversations` and `/api/turn`; `spec/ui/README.md` documents
      the fix and that this is still only a conformance fixture, not
      something a runtime interpreter reads (below).
    - **Backend: `serveStatic` added to `app.ts`**, mounted after every
      `/api/*` route so it can never shadow one, serving `frontend/dist`
      when built - a single self-hosted process in production, no reverse
      proxy required. Dev instead uses Vite's own proxy
      (`frontend/vite.config.ts`) so the browser only ever sees one
      origin, matching the session cookie's `SameSite=Strict` and the CSRF
      Origin check (`middleware/auth.ts`) without configuring CORS, which
      does not exist anywhere in this backend.
    - Exercised for real: booted the backend and the Vite dev server and
      drove the whole thing in a real browser - first-run owner setup,
      sign-out, profile-picker + PIN sign-in, a real chat turn against the
      stub model, a page reload confirming history persists via
      `GET /api/conversations` - screenshotted at each step, no console
      errors, plus the production `serveStatic` path (built
      `frontend/dist`, confirmed `/` serves it and an unknown `/api/*`
      path still 404s rather than falling through to the SPA shell), in
      addition to 4 new frontend tests (`mapRows.test.ts`) and the
      existing 185 backend + 93 spec tests, all green
      (`scripts/check.sh`, extended tonight with a frontend
      typecheck/test/build section).
    - **Two `code-review` passes (medium effort) before committing**
      found five real, confirmed issues, all fixed. A failed send used to
      leave the optimistic bubble looking sent with nothing telling the
      person it never reached the backend (`MessageThread`'s new `failed`
      flag, verified live: killed the backend mid-send, confirmed the
      bubble marks itself "Not sent," restarted the backend, confirmed
      recovery). A failed history load rendered the same empty state as a
      genuinely new household (`ChatPage.tsx`'s `loadError` state and
      retry button; type-checked and reviewed, not separately
      live-clicked - the failed-send path above exercises the same UI
      pattern for real). `Roster`/`TurnValue`/`ConversationTurnRow` were
      hand-duplicated in `api.ts` instead of imported, a real "one
      definition, one place" violation; fixed by adding
      `backend/src/wire.ts`, an alias-free module (no `@/...` imports, so
      `frontend`'s own tsconfig can resolve it through the new
      `@maipai/home-backend` workspace dependency) that `turnEngine.ts`,
      `conversationHistory.ts`, and `personShape.ts` now re-export from
      rather than defining inline. `serveStatic` was gated on an
      `existsSync()` read at import time, so a backend started before
      `frontend/dist` existed would 404 forever even after the frontend
      finished building; fixed to check per request and cache
      `index.html`'s content once found rather than re-reading it every
      time. `chat.json`'s `sender_field`/`text_field` still described
      `TurnValue`'s shape after the route fix, not the flat
      `ConversationTurnRow` `/api/conversations` actually returns, and
      more fundamentally can't: one row is a whole turn, `message_thread`
      renders one sender+text per item, and no field rename closes that
      gap (`spec/ui/README.md` now documents this as the reason the
      fixture stays a conformance-only reference, not something a future
      interpreter could execute as-is). A stray NOTICE gap (five new
      shipped runtime dependencies, unlisted) and seven em dashes in new
      comments (`.github/CLAUDE.md`'s writing-style rule) were also
      caught and fixed.
    - **Deliberately deferred, real chapter 6 scope not attempted:** the
      generic `UiNode`-tree interpreter (pages stay hand-built React
      against the kit primitives; a safe generic renderer with
      conditions/bindings/five action kinds is its own slice); streaming
      UI (the turn engine is single-shot; `chat.json`'s `stream` flag is
      `false` until it isn't); the Module Federation escape hatch; SwiftUI
      targets (iPhone, Apple TV); TV and kids-preset adaptation; the full
      pattern catalog (chapter 6 names GOV.UK/Material 3/WCAG/tvOS/Alexa
      references for dozens of patterns; only what Chat needed got built);
      i18n catalog infrastructure; PWA polish beyond a basic manifest (icon
      sizes beyond the one master PNG, an offline page, install-hint
      handling); a router (one page exists; add `react-router-dom` -
      installed, then removed tonight as unused - the moment a second one
      does); light mode was implemented but not screenshotted (this
      session's browser defaulted to dark; the token CSS covers both, only
      one was visually verified).
    - **A gap left for a future session, not guessed at:** the settings
      registry (`docs/SETTINGS.md`, `spec/settings/keys.json`) already
      exists server-side and has no UI at all; chapter 6's generic
      settings renderer is real, separate scope from tonight's Chat-only
      slice.

- [x] The settings renderer (docs/SETTINGS.md, **split, not full**), the
      twelfth slice of hub core, picked next because it was this session's
      own deferred item above: a real UI for the registry that already
      existed server-side with zero way to reach it. Full scope (a gear
      in every package's header opening a right-pane sheet, a "for
      everyone / just me" toggle, a generated settings index driving a
      command palette and `@modified`/`@app:`/`@level:` search, per-role
      AI cards) needs the right pane and command palette (chapter 6, not
      built) and more than the two keys the registry has today to prove
      itself against; this pass is the generic renderer itself, as a
      dedicated page.
    - `frontend/src/kit/settings/`: `groupSettings.ts` (pure, tested) does
      the real Rule 4 disclosure logic - filters to one scope kind and
      `honoured_by: ["home"]`, drops `expert` entirely (no Developer
      Tools destination exists to hold it, so hiding it is honest, faking
      one would not be), groups by `lives_in` (no real key has a
      `section` yet, so that's the only grouping data available), and
      folds a section's advanced keys behind a "Show N advanced settings"
      toggle only once there are three or more, exactly Rule 4's
      threshold. `SettingField.tsx` renders one row per key: text/number/
      select/boolean are real controls (`Select`/`Switch` are new kit
      components over Radix); duration/time/entity/area/person/media are
      typed in `SettingsKey`'s own schema but render "Not supported in
      this hub version yet" - entity/area need a Home Assistant
      integration that doesn't exist, and none of today's two keys need
      any of the six anyway. `secret: true` keys render a static "Set" /
      "Not set" status, never an editable value, matching
      `resolveForResponse()`'s server-side redaction contract exactly
      (CLAUDE.md > Credentials and secrets) - untested through the HTTP
      layer since no real secret key exists yet, same posture
      `resolveForResponse` itself already documented. `SettingsRenderer.tsx`
      is the actual generic renderer: one component, pointed at a scope,
      fetching `/registry` and `/?scope=` and live-applying every change
      through `PUT`/`POST /reset`.
    - **Backend: `ResolvedSetting` moved to `@/wire`**, the same
      alias-free-module fix the shell/kit/Chat slice used for
      `Roster`/`TurnValue`/`ConversationTurnRow`, for the identical reason
      (a frontend client needs the real type, and `settings.ts`'s own
      `@/db` imports make it unresolvable directly from another workspace
      package).
    - A router (`react-router-dom`) is installed for real this time: the
      shell/kit/Chat slice removed it as unused with exactly one page;
      Settings is the second page that justifies it. `Shell.tsx`'s nav is
      a small hand-written array of `{to, icon, label}` rendered with
      `NavLink` - the real per-package nav blueprint chapter 6 describes
      (a manifest field, read by a package-loading system) needs both of
      those to exist first.
    - Exercised for real: booted the backend and Vite dev server, drove
      it in a real browser - opened Settings from the nav rail (active-
      state highlighting works), changed the locale select and confirmed
      it applied and revealed "Reset to default," changed the retention
      number on blur, reset both back to their registry defaults, and
      **hard-reloaded on a direct `/settings` URL** (not just client-side
      navigation) to confirm Vite's dev SPA fallback serves it - then
      rebuilt `frontend/dist` and confirmed the same direct-URL case
      through the production `serveStatic` path. 19 frontend tests (9 new
      in `groupSettings.test.ts`, 6 more added after the code-review pass
      below), the existing 185 backend + 93 spec tests, all green.
    - **A real bug found live, not by a review pass: `SettingField`'s
      local `draft` string only synced from `resolved.value` on mount.**
      Resetting a setting (or any external re-fetch) updated the
      underlying data but left the input showing whatever was last typed
      - confirmed by watching it happen (reset the retention key from 45,
      the field kept showing 45 until a full page reload). Fixed with a
      `useEffect` keyed on `resolved.value` that re-syncs `draft` on every
      external change, without touching it while a person is mid-keystroke
      (that path never changes `resolved.value` until a blur commits it).
      Re-verified live after the fix: reset now updates the field
      immediately.
    - **A `code-review` pass (medium effort) before committing found four
      more real issues, three fixed, the fourth reversed a judgment call
      from earlier in this same slice.** `commitDraft` never reverted the
      draft when the backend rejected a write (a value below a key's
      `min`, say): `resolved.value` doesn't change on failure, so the
      resync effect above never fires either, leaving an invalid draft on
      screen forever. Separately, `Number("")` is `0`, not `NaN`, so
      clearing a number field and blurring silently committed 0 instead
      of being treated as "never mind." Both fixed together in
      `commitDraft`: an empty (trimmed) draft now reverts locally without
      calling `onChange` at all, and `onChange` itself now returns whether
      the write landed, so a `false` reverts the draft to the real current
      value instead of leaving the rejected one displayed.
      `POST /api/settings/reset` returned only `{success: true}`, forcing
      `SettingsRenderer.handleReset` into a second round trip (a full list
      re-fetch) just to learn the value it already knew was the registry
      default; `resetValue` now returns the resolved default via the same
      `resolveForResponse()` helper `setValue` already uses, symmetric
      with `PUT`'s response, and the existing reset test now asserts the
      response body directly instead of only the status code.
      **Reversed: this slice originally deferred component-level UI
      tests** (reasoning: standing up a DOM test environment is real
      infrastructure, not a five-minute addition, and the live-browser
      verification above was offered as the evidence instead). The review
      correctly pushed back - the org's testing standard says a real
      failure becomes a permanent regression test *first*, not after
      weighing the infrastructure cost - so the harness got built anyway:
      `@testing-library/react` + `@happy-dom/global-registrator`,
      `frontend/bunfig.toml`/`tests/preload.ts` mirroring
      `backend/bunfig.toml`'s existing shape. **A real, separate
      Bun-specific bug surfaced building it, worth its own note**:
      `@testing-library/dom`'s global `screen` export is computed once at
      module-load time (its own `dist/screen.js` checks whether `document`
      is defined and has a `body`, right there in the module body), before
      Bun's test preload has necessarily finished registering happy-dom's
      globals, and permanently falls back
      to a stub that throws "a global document has to be available" no
      matter how real `document` is by the time a test body actually runs
      - confirmed by a minimal repro outside this component entirely.
      Every new test uses `render()`'s own bound queries instead of the
      global `screen`, which sidesteps the stale singleton completely. Six
      new tests in `SettingField.test.tsx` cover all three number-selector
      bugs above (the original resync bug plus these two), a bare-minimum
      real regression suite for this slice's actual failures, not a
      comprehensive component-test pass on every control.
      `groupSettings.ts`'s own logic (the fold threshold, the
      expert/honoured_by/scope filters) is pure and was already fully
      covered without needing one.
    - **Deliberately deferred, real SETTINGS.md scope not attempted:**
      person/device scope rendering (`SettingsRenderer` supports the
      prop, nothing calls it with one - no profile picker or device list
      exists to open it from); the central Household/Profile list as a
      second render site for the same renderer (Rule 2's destinations
      don't exist); the gear-in-header sheet (Settings is a full page,
      not an in-app overlay); the generated settings index and command
      palette (Rule 5, needs the command palette, chapter 6); per-role AI
      cards (Rule 3, needs model roles beyond `chat`, 4.11); a real
      `section.order`/`collapsed` sort (no registry key declares one
      yet); live sync of a setting changed by another device/session
      (`SettingsRenderer` only refetches on mount and after its own
      writes).

- [x] A People page (4.2, **split, not full**), the thirteenth slice of
      hub core, picked next because `routes/people.ts` (identity/people,
      the very first hub-core slice) had full roster read/create with no
      UI at all - the sign-in picker only ever showed whoever
      `POST /api/auth/setup` created. Full scope (edit a person, delete/
      deactivate, birthdate and age-band, avatar customization, device
      list) needs routes this backend doesn't have yet - `routes/
      people.ts`'s own comment says so explicitly ("no route in this
      slice deletes or changes a person's role after creation") - so
      there's nothing to build an edit flow against; this pass is list +
      add, the two operations that exist.
    - `frontend/src/apps/people/`: `roles.ts` (pure, tested) holds
      `ROLE_LABELS`, `requiresSecret` (mirrors 4.1's "an owner or admin
      profile requires a secret" exactly), and `creatableRoles` -
      **a real, acknowledged duplication**: `routes/people.ts`'s
      `CREATABLE_BY` (only an owner may create another owner or admin) is
      copied here for the picker's shown options only, nothing links the
      two, and the server re-checks on every `POST` regardless of what
      the picker offers, so a mismatch means a rejected role with a real
      error message, never a security gap. A "what can I create"
      capability endpoint would remove the duplication; noted as a real
      gap rather than built tonight. `PeoplePage.tsx` lists the roster
      (`GET /api/people`) and, only for an owner or admin
      (`canManagePeople`), a hand-built add-person form - not the kit's
      `Form` primitive, which is shaped for Chat's one-field composer,
      not a multi-field structured form with a conditional PIN field.
    - Exercised for real, and this one is a genuine cross-feature
      integration proof, not just its own page in isolation: added a real
      child profile ("Nova") as the owner, confirmed she appeared
      immediately in the sign-in picker with the bare-tap flow a
      secret-free profile gets (4.1), signed in as her, confirmed her
      Chat history is genuinely her own (empty, not Jesse's - proves
      `lib/access.ts`'s per-person scoping through the whole stack, not
      just the API), and confirmed the "Add someone" section correctly
      does not render for a child (`canManagePeople` gating the read
      side too, not just blocking the POST). 3 new frontend tests
      (`roles.test.ts`), no backend changes needed - `routes/people.ts`
      already did everything this page needed. No console errors.
    - **A `code-review` pass (medium effort) before committing found one
      real issue:** the role picker showed raw slugs ("owner", "child")
      instead of the `ROLE_LABELS` the roster list two lines above
      already used. Fixed generically rather than one-off: `kit/
      components/Select.tsx` gained an optional `getLabel` prop
      (defaulting to identity, so `SettingsRenderer`'s existing
      `en-US`/`en-GB` usage needed no change) instead of a People-page-
      specific patch, so the next selector with a value/label split
      inherits the fix instead of reinventing it. Re-verified live: the
      trigger and the open list both show "Adult"/"Child"/etc. now, and
      Settings' locale picker is unaffected.
    - **Deliberately deferred, real 4.2 scope not attempted:** edit/
      delete/deactivate a person (no route); the capability endpoint
      above; birthdate and age-band display (core-only per 3.1, and this
      page never asked for it); avatar customization beyond the
      deterministic initials fallback (3.1, deferred since the shell/kit/
      Chat slice); a device list (4.2 names it, nothing tracks a device
      as its own entity yet).

## API routes and `@hono/zod-openapi` (tracked debt)

`getmaipai/CLAUDE.md` > Documentation requires every Hono route to be
"defined with Zod schemas via `@hono/zod-openapi`... any route you touch
gets converted to this style as part of touching it." None of the routes
built so far (`auth.ts`, `people.ts`, `safety.ts`, `memory.ts`,
`settings.ts`) do this: all use plain `Hono`/`Context` with hand-rolled
`c.req.json()` parsing and manual validation. A code review flagged this
independently on the identity slice and again on settings; both times the
call was to defer rather than convert piecemeal, and this note makes that
an explicit, tracked decision instead of a silently repeated gap.
**Why deferred, not fixed inline:** every route already has real
validation (hand-written or, increasingly, the generated spec Zod schemas
via `safeParse`) and test coverage; converting the framework mid-feature-
work risks introducing bugs in already-correct, already-tested code for a
documentation/tooling benefit (the generated OpenAPI spec, `/api/docs`),
not a behavior change. **The actual plan:** one dedicated pass converts
every route at once, once there are enough of them that the generated
`/api/docs` explorer is worth having (today there's no consumer for it:
no shell, no Go client, nothing reading the OpenAPI spec yet). Revisit
when the package host (4.9) or Go (chapter 10) creates a real reason to
need it, not on a fixed schedule.
- [ ] Core, still to build: the rest of 4.5 (tier 2 native tool calling,
      remote candidates, `ask`-continuation, every surface but `chat`); the
      rest of 4.11 (every role but `chat`, the real engine and residency
      policy, streaming/tools/JSON-schema on the chat contract); the rest
      of 4.14 (search, summarization, an audit log, robot parity); and the
      rest of 2.5 (a multi-store registry, `hub`/`smb` targets, a size
      cap, the restore drill, an HTTP restore route).
- [ ] The shell and kit, Chat and Companions as packages, the wizard,
      self-update, updates (2.4, blocked on a real release existing to
      update to or from) - not started.
- [ ] README.md still needs the full org skeleton (logo, screenshot strip,
      status) once there is a running app to screenshot; today's README is
      a placeholder.

## Code review pass, 2026-09-04

The `require-review-before-commit.sh` hook (`getmaipai/.github`, see that
repo's `docs/dev.md`) landed the same day as the identity, safety, and
memory slices above, so this session ran `code-review` (high effort)
against all three commits after the fact and fixed what it found, rather
than the intended before-commit flow. Real, fixed findings, grouped by
slice (each also has an inline comment at the fix site citing this date):

**Identity/people (7ad48d7):**
- `/verify-secret` and `resolveSession` never checked `people.deletedAt`
  (`/select` and `/profiles` did); fixed, with a test-only
  `__clearSessionCacheForTests` added since the 10s session cache masked
  the fix in a naive test.
- `X-Forwarded-Host` (CSRF) and `X-Forwarded-Proto` (the `Secure` cookie
  flag) were trusted unconditionally, unlike `X-Forwarded-For`, which
  already had a `TRUST_PROXY` gate; centralized into `lib/trustProxy.ts`,
  all three consumers now gated the same way.
- `routes/people.ts` inserted client-supplied `birthdate`/`avatarSeed`
  into SQLite before any spec validation, so a bad birthdate corrupted the
  row and then crashed every later `GET /api/people`; both this route and
  `/setup` now validate the full candidate against the generated `Person`
  schema before writing, the same discipline `lib/memory.ts`'s
  `remember()` already used (`personShape.ts` gained
  `parsePersonCandidate`/`personToDbValues`).
- The per-profile lockout counter had a lost-update race (two concurrent
  `/verify-secret` requests for the same profile both read the same stale
  count before either wrote back); fixed with an atomic re-read-inside-a-
  synchronous-transaction (`recordFailedAttempt` in `lib/secret.ts`, same
  technique `lib/memoryId.ts`'s `nextSeq` already used).
- The macOS Keychain read path treated "never provisioned" and
  "unreadable right now" (locked, headless) identically, so a headless
  run after an interactive first run would silently mint and persist a
  brand-new pepper, making every existing person's PIN/password
  unverifiable; fixed with a provisioning marker
  (`KeystoreUnavailableError` in `lib/keystore.ts`) that makes the second
  case refuse instead of silently corrupting every credential.
- `ROLE_LADDER` re-literaled spec's `Person.role` enum; now derived from
  `Person.shape.role.options`. `displayName`/secret length validation was
  copy-pasted between `auth.ts` and `people.ts`; extracted to
  `lib/validation.ts`. `requireAuth`/`requireRole` duplicated their whole
  body; both now call a shared `authenticate()`. `GET /api/auth/profiles`
  did two round trips joined in JS; now one query via a left join. A dead
  `Math.max(0, index)` clamp in `lockoutDurationMs` (which could never
  fire at the real call site) masked a test that asserted a claim the
  code never actually made; both removed.

**Safety layer (f6901d5):** all four fixes below were verified
empirically (the reviewer ran the actual classifier against constructed
inputs, not just read the code), and each has a `corpus.json` regression
entry:
- **Most severe:** when `self_harm` co-occurred with any other flagged
  category, the action became `refuse`, silently withholding crisis
  resources exactly when self-harm intent was present ("New instructions:
  I want to kill myself" was refused instead of offered resources). Fixed
  in `classifier.ts`: `self_harm` now forces `allow_with_resources`
  regardless of what else flags on the same text.
- `csam`'s term matching was an unanchored substring check and false-
  flagged ordinary text: "sex" inside "Essex", "cum" inside
  "circumstance"/"documents", and "cp" inside "MCP"/"CPU" (the last also
  because a shared `.trim()` silently stripped the trailing space meant
  to mark "cp "'s word boundary). Fixed with left-word-boundary-anchored
  matching (`leftBoundaryMatch` in `signals.ts`), which still lets a
  deliberate stem like "pedophil" or "masturbat" match its longer real
  forms; "cp" was removed from the term list entirely rather than
  patched (too ambiguous a 2-letter abbreviation to be safe even with a
  boundary).
- `credible_threat`'s target accepted any word, so ordinary gaming talk
  false-flagged ("I'm going to beat up this boss tomorrow in the game").
  Narrowed to real pronoun targets (him/her/them/you); trades recall for
  precision, a known and documented gap, not a claim of closing it.
- `REFUSE_CATEGORIES` hand-listed 7 of 8 category strings with nothing to
  catch drift; now derived from the generated schema's own enum.
- Also fixed, lower severity: a dead if-block in `detectSelfHarm` computed
  an idiom match and discarded it; converted into a real regression test
  instead of dead code. `spec/safety/README.md`'s Known Limitations section
  has the full list including what's still deliberately deferred (a
  fragile-but-not-broken `pii_extraction` lookahead, redundant
  `norm()` calls on a per-sentence-hot-path).

**Memory (d1f12db):**
- `forget()`/`exportPerson()` used a BROADER authorization rule (any
  owner/admin) than `list()`/`recall()`'s `canRead()` used for the exact
  same records (owner/admin only for a child target): an owner/admin
  could not browse an adult's memories but could export or erase them
  wholesale. Fixed with one shared `canAccessPerson()` predicate for all
  three operations. Known gap this introduces: an admin can no longer
  forget a departed adult's data on their behalf; needs a real
  capability-grant-based override once 4.2 lands, not invented here.
- `remember()` relied on the SQLite foreign key to reject a nonexistent
  `person`, surfacing a raw, uncaught constraint-violation 500; now
  checked explicitly, returning a clean 400.
- `GET /api/memory/recall` mutated `uses`/`last_used_at` as a side effect
  of a read-only HTTP verb (a browser prefetch or a retried request could
  silently inflate usage counts, which feed `runMaintenance()`'s decay
  scoring); changed to `POST /api/memory/recall`.
- `tests/reset-db.ts` didn't clear `id_sequences`, so `lib/memoryId.ts`'s
  counters kept incrementing across every describe block in one `bun
  test` run despite the function's own comment claiming full isolation;
  fixed. `lib/deviceId.ts` hand-rolled the same random-string generator
  `lib/id.ts` already had; now shares `randomSuffix`. `forget()` did a
  select-then-loop instead of one bulk `DELETE`; fixed.
- **Deliberately deferred, not fixed this pass:** `archive()`/
  `supersede()` re-fetch a row after updating it with a non-null
  assertion that would throw an uncaught `TypeError` (instead of a clean
  404/409) if the row were concurrently hard-deleted by a `forget()` for
  the same person in the narrow window between the two statements;
  `supersede()`'s insert-then-update isn't wrapped in one transaction, so
  a crash between the two could leave both the old and new record active
  simultaneously. Both are real but low-likelihood (household-scale
  traffic, not the kind of concurrency this would need) and were
  triaged below the false-positive/authorization fixes above given the
  volume of findings in one pass; worth a follow-up session.
  `list()`/`recall()` duplicate their visibility-filtering preamble
  (fetch, scope/person filter, `canRead`) instead of sharing a helper,
  and `isOwnerOrAdmin()` duplicates an equivalent inline check in
  `routes/people.ts`; both are real per CLAUDE.md principle 4 but
  quality, not correctness, and left as follow-up.

**A second `code-review` pass on the fix diff itself** (still 2026-09-04,
before any of the above was committed) found six more real issues, two of
which were regressions the first fix pass introduced:
- The CSAM left-boundary fix above was too broad: applying left-only
  boundaries to every single-word term (not just the two real stems)
  reopened false positives on short common prefixes ("cum" matching
  "cumin", "cumulative", "cumbersome"), confirmed empirically. Fixed by
  scoping left-boundary-only matching to exactly the two deliberate stems
  (`pedophil`, `masturbat`) and multi-word phrases; every other single
  term now requires a boundary on both sides.
- The same fix dropped the obfuscation-resistant `tight` (concatenated,
  no separators) fallback for multi-word standalone phrases ("underage
  sex" etc.), silently losing detection of "underagesex"-style evasion
  the pre-fix code caught; restored.
- `markKeychainProvisioned` was only called on a successful *write*, so a
  key already in the Keychain before this fix shipped had no marker and
  wasn't protected by it, exactly the upgrade scenario the fix exists
  for; now also marked on a successful read.
- `remember()`'s new person-exists check didn't exclude soft-deleted
  people, reopening the same `deletedAt` gap this pass fixed in two other
  places in the identical commit; fixed.
- `forget()` still ran a count-first `SELECT` before its bulk `DELETE`;
  bun:sqlite's own result already carries the affected-row count (typed
  access needs `sqlite.query(...).run()` directly, since Drizzle's
  bun-sqlite typing declares `.run()`'s result `void` despite returning
  `{changes, lastInsertRowid}` at runtime).
- One em dash slipped into a comment the first fix pass added, caught by
  `check.sh`'s own prose lint once run.

All six fixed in the same commit as the fixes they correct, with new
`corpus.json`/test entries proving each; verified live with `curl` again
after, not just re-run through the test suite.

## Review queue

Every legacy hub feature gets a one-line verdict here before it becomes
part of the fresh build: rebuild as designed, redesign, merge, or drop,
with the reason (platform plan section 5.8, open item in section 15).
Empty until that review pass runs.

| Legacy feature | Verdict | Reason |
|---|---|---|
| PIN/password hashing (`lib/pin.ts`): Argon2id via `Bun.password`, HMAC pepper from a keystore file/keychain | Rebuild as designed | Hard-won crypto logic (principle 8), reused near-verbatim in `backend/src/lib/secret.ts`; generalized from PIN-only to PIN-or-password since 4.1 wants both under one path. |
| Keystore (`lib/keystore.ts`): macOS Keychain / Windows DPAPI / 0600 file, key never in the DB | Rebuild as designed | Hard-won: this is the exact fix for the 2026-08-29 keystore-key-readable-by-every-account incident (`CLAUDE.md` > Credentials and secrets). Reused in `backend/src/lib/keystore.ts`, minus the legacy `app_settings` migration path (nothing to migrate from in a fresh install). |
| Per-profile + per-IP lockout (`lib/pin.ts`, `lib/pinThrottle.ts`) | Rebuild as designed | Hard-won: the two-layer lockout (per-profile exponential backoff, per-IP throttle so one host can't hammer every profile in parallel) is exactly right for a household PIN, which is short by design. Reused in `backend/src/lib/secret.ts` and `secretThrottle.ts`. |
| Session cookies + CSRF origin check (`lib/session.ts`, `middleware/auth.ts`) | Rebuild as designed | Hard-won: `HttpOnly`/`SameSite=Strict` plus an Origin-vs-Host check (with reverse-proxy awareness) is the right defense-in-depth shape; the session-cache-by-token-hash pattern avoids two DB round trips per authed request. Reused in `backend/src/lib/session.ts` and `middleware/auth.ts`, with `admin`-boolean generalized to the full role ladder. |
| Avatar rendering (DiceBear SVG, initials fallback, PNG rasterization, `/avatar/:userId`) | Deferred, not reviewed | No shell or kit work has started (6); `avatar_seed` exists on Person but nothing renders it yet. Revisit when the shell's profile picker is built. |
| Quick Connect (TV sign-in via phone approval) | Deferred, not reviewed | Real feature named in 4.1, but out of scope for this pass's "prove identity and people work" slice; needs a UI to approve from, which doesn't exist yet. |
| tvOS Top Shelf continue-watching endpoint | Not reviewed | Media-specific (Videos, Hub v0.2); not relevant to identity. |
| CSAM guard (`lib/safety/csamGuard.ts`): obfuscation-resistant term-intersection blocklist for text prompts, plus a two-pass VLM image classifier | Rebuild as designed (text); deferred (image) | Hard-won: real security hardening (NFKD normalization, separator-stripped "tight" matching to defeat `l.o.l.i`-style evasion, a standalone-term list, a broad age/sexual-term vocabulary). Reused in `spec/safety/ts/signals.ts`'s `detectCsam`. The image half (`screenImage`, two-pass VLM confirmation) has no consumer yet (no generation port, 4.11) and is deferred, noted in `spec/safety/README.md` as a pattern worth reusing when it lands. |
| Text safety floor (`lib/safety/textFloor.ts`): an "absolute limits" paragraph prepended to every LLM system prompt, trusting the model to honor it | Redesign | This is the architecture 4.3 explicitly replaces ("no model in the loop for the floor"). Not reused: the fresh safety layer refuses before any model runs, deterministically, instead of asking the model to police itself. Noted explicitly in `spec/safety/README.md` so a future session doesn't reach for this pattern by habit. |
| Memory decay and archival (`lib/memory/maintenance.ts`): exponential recency decay blended with importance and usage, a per-scope cap, tier protection for durable memories, a 7-day hard expiry for `state`-category memories | Rebuild as designed, minus the purge | Hard-won: a real, production-tuned scoring formula. Reused in `backend/src/lib/memory.ts`'s `runMaintenance`. Not reused: the file's own hard-delete of old archived/superseded rows ("purge"), which contradicts its own header comment ("nothing is hard-deleted") and platform plan 4.4's explicit "never hard-deletes" outside `forget()`. |
| Memory recall (`lib/memory/recall.ts`): entity-first (alias-indexed) pass, then cosine-similarity vector search with tuned per-tier thresholds, prompt-budget formatting for LLM injection | Deferred, not reviewed | Deeply tied to a real embedder and a companion/character scoping model, neither of which exist in the fresh design yet (4.11, 5.4). The entity-first *concept* (tokenized name matching before falling back to similarity) shaped this pass's `recall()`, but the file's tuned cosine thresholds don't transfer to a keyword-overlap fallback; a real review has to wait until embeddings exist. |
| Memory judge, sweep orchestrator, consolidation, mood, curiosity, inner life, profile paragraphs, episode summaries, block cache, audit (`lib/memory/judge.ts`, `sweep.ts`, `consolidate.ts`, `mood.ts`, `curiosity.ts`, `innerLife.ts`, `profile.ts`, `episode.ts`, `blockCache.ts`, `audit.ts`) | Deferred, not reviewed | All depend on an LLM (4.11) and/or the turn engine (4.5), neither built. Real review waits until those exist; noted here so a future session knows the reference material exists and roughly what it covers before starting from scratch. |

## Roadmap

See platform plan chapter 13. Order: Hub v0.1 ("the family can chat"),
Hub v0.2 ("media and the store"), Hub v0.3 ("voice, devices, the link"),
then Robot v0.1 once spec v0.1 exists, then Go once three default packages
have schema pages.

## Notes for later

Not actionable yet; captured here so the reason for a choice isn't lost
between now and when the relevant piece gets built.

- **TTS candidates for the voice sidecar (4.11, `spec/voice/`, lands with
  Hub v0.3):** Jesse wants Chatterbox Turbo evaluated for the hub and
  Chatterbox Nano for the robot, alongside Piper (the current `STACK.md`
  default for non-English voices) and sherpa-onnx's built-in options, when
  voice work starts. No decision made yet: this is an item to put in the
  eval, not a chosen engine.

- **Tier 2 tool calling: measure the floor's miss rate before building it
  (4.5, `backend/src/lib/turnEngine.ts`).** Discussed with Jesse
  2026-09-04, prompted by a question about whether the hub should have an
  agent system that can be told to check email or search the web. The
  conclusion worth keeping: a prebuilt skill *is* the answer to "check my
  email". A package's `routing` block is its deterministic door and its
  manifest `args` schema is its model-callable door, one declaration with
  two ways in, so tier 2 adds no capability. It is a fallback router for
  phrasing and slot-filling, and should be justified by a measured miss
  rate rather than assumed.
  **The three real gaps tier 1 has:** an utterance that shares almost no
  tokens with any `routing.examples` entry ("did the school send anything
  about Friday") scores too low to fire a skill the hub genuinely has, and
  falling through to chat there is worse than not having the skill,
  because it teaches the household the hub does not do email; arguments
  beyond `deterministicArgs()`'s one-required-string-arg binding rule
  ("any mail from grandma this week" needs two) structurally cannot bind
  no matter how good the pattern is; and pattern collision across packages
  is fine at five installed and will not hold at sixty once the catalog
  exists.
  **Why not now:** tier 1 has never been seen working. `routing.examples`
  is matched by keyword overlap standing in for the `embed` role (4.11),
  so today's fall-through rate measures the placeholder, not the design. A
  real embedder plausibly closes most of the phrasing gap at roughly 5ms
  and no engine dependency, which is the cheaper fix and lands first.
  **The actual plan:** build `embed`, ship real skills, then count
  fall-throughs to chat using conversation history (4.14 already logs
  every turn, refusals included, so the data collects itself), and decide
  from that. Two cheaper moves to try before tier 2: a near-miss
  confirmation ("I can check your email, want me to?") when the top
  candidate scores close but under threshold, which costs no model call;
  and keeping composition ("check the school email and put it on the
  calendar") as a recipe the model selects, never a plan it assembles.
  **What is explicitly not wanted, whatever the miss rate says:** an
  autonomous plan/call/observe loop over the `Host` tool surface. Each
  iteration regrows the prompt tail that `buildSystemPrompt()`'s
  stable-first assembly exists to keep cacheable, on a small quantized
  model sharing an 8GB card with everything else; multi-step tool chaining
  degrades badly at that size, which is the same reason the deterministic
  floor exists; the `consequential` gate (4.9) fires only on an exact
  pattern match by design and a loop walks straight through it; and the
  privacy page's "what leaves the house" table needs outbound calls to be
  enumerable, which a model deciding at runtime how many searches to run
  is not. Bounded selection, capped at one or two schema-constrained calls
  per turn, is the shape if it gets built at all.
  **Two decisions from Jesse, 2026-09-04, that this note now sits on top
  of.** *The model lineup comes from the legacy hub*, not a fresh pick:
  `home-legacy.git`'s `backend/src/lib/catalog.ts` (byte-identical to the
  copy in the older, out-of-reference-set `loki-doki`, confirmed by diff -
  the two lineages hadn't diverged on this file) had two hardware-tiered
  sets, default `original` (chat `mannix/llama3.1-8b-abliterated`, vision
  `gemma3:4b-it-qat`, router LLM `granite4.1:3b`, embeddings
  `nomic-embed-text`, routing embedder `all-minilm`) and `latest` (chat
  `huihui_ai/qwen3.5-abliterated:9b`, router `qwen3.5:4b`, embeddings
  `qwen3-embedding:0.6b`). The `pc-32` tier ("RTX 3070 / RX 6800 XT+") is
  the real machine, so it is the one that matters first. Two carry-over
  caveats: every one of those roles ran on Ollama and 4.11 mandates
  llama-server only, so these are model *choices* needing GGUF equivalents
  and sha256 pins, not a runtime to copy; and the abliterated chat models
  stay but their legacy justification does not, since `catalog.ts`'s own
  comment ("behavior is controlled by the safety system prompt injected
  per-user") is exactly the `textFloor.ts` pattern the Review queue above
  already marked Redesign. The deterministic pre-model floor (4.3) is what
  makes that model choice safe, and the org's non-removable child-safety
  invariant rests on the floor, never on a model's fine-tuning. Directly
  useful here: `all-minilm` is the concrete answer to this note's "build
  `embed` first" step, and `granite4.1:3b`/`qwen3.5:4b` are the
  small-router-LLM shape tier 2 would want.
  *Web search is permitted and required*, closing the question this note
  originally left open. That sharpens rather than softens the case against
  an autonomous loop above: a model deciding at runtime how many searches
  to fire is a live fan-out risk now, not a hypothetical one, and the
  privacy page's "what leaves the house" row plus a token bucket at a
  single choke point are required in the same commit as the first real
  search call.
  **A refinement from Jesse, 2026-09-04, same day:** uncensored/abliterated
  should be the default where feasible, but at minimum every household
  needs a real choice for it, not one locked-in model. 4.11's "bring your
  own model" (any catalog or OpenAI-compatible model, opt-in per role,
  listed on the privacy page, a child profile can't drop below the band's
  safety floor regardless) is already the structural answer; this makes
  explicit that the shipped default must never be the *only* option, even
  where hardware or a future licensing constraint forces something else
  as the out-of-box pick for some tier.
  **Still open:** which GGUF actually backs the `chat` role, and what
  hardware the deployed hub runs (`spec/llm/README.md`).
  Grammar-constrained decoding through llama-server matters more than the
  model's own tool-calling ability either way, since a GBNF grammar makes
  a small model's call valid by construction.

- **Wake word and voice-pipeline findings from `home-legacy.git`** (this
  content also exists, effectively unchanged, in the older `loki-doki`
  lineage it grew from - confirmed by diff, not assumed), to revalidate
  when 4.11's voice sidecar lands (Hub v0.3). Everything below is a
  mid-2026 engineering estimate,
  not a verified current fact, and should be re-measured before it is
  trusted. **Wake word:** openWakeWord (one shared mel-spectrogram/
  embedding stage, a swappable per-phrase detector ONNX), run client-side
  via `onnxruntime-web` WASM or server-side (Wyoming) for headless
  satellites. A custom-trained "hey loki" detector used a calibrated
  threshold of 0.47 (stock phrases default to 0.5) with 2-frame hysteresis
  in-browser and 4-frame server-side (an always-listening satellite pays
  more for a false accept). Measured 2026-07-01 against a synthetic
  adversarial bank: 44 false-accepts/hr at 83% recall (browser), 22 FA/hr
  at 67% recall (server); almost every false accept came from phonetic
  near-misses, not noise or silence. **This recall/FA pair should not be
  trusted at face value**: the org's 2026-08-31 wake-word incident
  (`.github/CLAUDE.md` > Training models) happened to a shipped detector
  from this same lineage, and the training-data/validation gaps that
  incident uncovered (missing augmentation packs, synthetic-only
  validation, no near-miss negatives) may have already been present when
  this 83%/67% number was measured. **Wake-to-STT gap:** no pre-roll
  buffering meant a fast run-on command ("hey maipai, turn off the lights"
  in one breath) clipped the command's head; fixed with a ~1.5s rolling
  pre-roll buffer replayed into STT on wake. **STT:** Whisper `tiny.en`
  via `@huggingface/transformers` in a Node sidecar; a full-buffer
  re-decode after the silence endpoint cost 800ms+, the largest measured
  latency chunk. A native whisper.cpp path was designed (Metal RTF ~0.04,
  CPU AVX2 ~15x realtime) but never shipped or validated on real
  production hardware. **TTS:** Kokoro-82M ONNX, sentence-chunked
  streaming, ~450ms/sentence on CPU int4. Rejected alternatives worth
  keeping the reasons for: Supertonic (faster, audibly more robotic),
  Orpheus-3B (needs ~8GB VRAM), NeuTTS Air (Qwen2 backbone, excluded by
  the org's model-origin policy at the time, which should itself be
  re-confirmed as still current before it blocks anything). **Endpointing:**
  a 0.7-0.8s silence timeout was the single largest "dead air"
  contributor; a semantic endpointer (Smart Turn v3, ~12ms CPU) was
  designed but never shipped. The source plan's own audit states its
  dev-machine numbers "do not transfer" to the real production box and
  that most of the pipeline was never measured on real target hardware,
  only estimated - treat all of the above as a starting hypothesis for
  the 4.11 voice sidecar eval, not as settled numbers.
