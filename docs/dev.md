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

- [x] A real README and its screenshot pipeline (`STYLE.md`'s README
      skeleton and platform screenshot pipeline), the fourteenth slice,
      picked next because the README's own `dev.md` line said so
      explicitly: "needs the full org skeleton... once there is a running
      app to screenshot" - and by tonight there was one.
    - `scripts/screenshot.ts` (new root script, `bun run screenshots`):
      builds the frontend, boots a throwaway backend on a temp port
      pointed at a temp `MAIPAI_DATA_DIR` (never Jesse's real dev data,
      confirmed untouched afterward), seeds a small demo household
      through the real API (persona-roster names only - Sage/owner,
      Marlow/teen, Nova/child - `.github/CLAUDE.md` > Privacy), drives a
      real headless Chromium to the People page, and writes
      `docs/assets/hero.png`. Opened and reviewed the actual image before
      using it anywhere, per the org's mandatory screenshot rule.
    - **Scope for tonight, not the full pipeline**: `STYLE.md` describes
      fixed viewports for phone/tablet/desktop/TV/Apple sizes, three
      themes (light/dark/high contrast), and a vision-model pass that
      reviews every shot and writes a verdict into a per-shot manifest -
      building all of that is its own slice. This is one viewport
      (1280x800), one theme (dark, the only one this session ever
      verified live), one shot, reviewed by a person (this session)
      reading the image, not a vision-model pass.
    - **The hero shot is People, not Chat, and that was a deliberate
      call:** this dev machine has no real GGUF configured (`docs/dev.md`
      > the chat model role slice), so a Chat screenshot today would show
      the stub model's `[stub model: no real model loaded...]` reply -
      honest, but not representative of the product's actual promise.
      People needs no model to look and be completely real.
    - **Two real bugs found getting the script working, both genuine
      Bun-specific findings, not app bugs:** Playwright's own
      `context.request` (its built-in HTTP client, meant to share a
      cookie jar with the browser) throws `"/api/auth/setup" cannot be
      parsed as a URL` inside `playwright-core`'s own `Set-Cookie`
      parsing when run under Bun instead of Node - worked around by
      seeding through Bun's native `fetch` instead and handing the
      resulting session cookie to the browser context by hand via
      `context.addCookies`. Separately, `page.getByText("Household")` is
      ambiguous by Playwright's own case-insensitive substring matching
      (it also matches "Loading household" and the "Add to household"
      button); switched to `getByRole("heading", {name: "Household"})`,
      the one element that only exists once real data has actually loaded
      - the fix that matters for "never screenshot a loading state," not
      just a selector nit.
    - README.md rewritten to the real skeleton: the logo (unchanged), a
      features list (three real ones - Chat, People, Settings - not
      padded to the skeleton's 10-15 ceiling), an honest "no packaged
      installer yet" getting-started with the real from-source commands,
      the hero screenshot, and a status line that says plainly this runs
      in dev, verified live, but isn't deployed to a real household yet.
      Documentation links point at `docs/dev.md` only: no user-tier docs
      site or generated API explorer exists for this fresh repo yet (the
      tracked `@hono/zod-openapi` debt above is exactly why the API tier
      has nothing to link to).
    - Exercised for real: ran `bun run screenshots` clean end to end
      after both fixes, confirmed the real dev backend on port 8787
      (Jesse's actual data) was never touched, `scripts/check.sh` green
      including the prose lint - which caught a real, non-obvious gotcha
      of its own: markdown's image syntax (a leading bang before the
      bracketed alt text) trips the literal-exclamation-point rule, which
      is almost certainly why every
      other repo's README already uses an HTML `<img>` tag for its logo
      instead of markdown image syntax; the hero screenshot now does the
      same.
    - **A `code-review` pass (medium effort) before committing found one
      real issue:** `chromium.launch()`'s browser was only closed on the
      success path; any error after launch (a slow render, a selector
      that never appears) skipped `browser.close()` while the backend
      still got killed in `finally`, leaving an orphaned headless
      Chromium process on a failed run. Fixed by declaring `browser`
      before the `try` and closing it in `finally` too. Re-ran the whole
      script clean afterward and confirmed no leftover Chromium process.
    - **Deliberately deferred:** the rest of the platform screenshot
      pipeline (other viewports, other themes, the vision-model review
      pass, per-shot manifests); user-tier and API-tier docs (nothing
      exists to link to yet); re-running screenshots automatically as
      part of a release (the release skill's drift check, not built).

- [x] A Backups view, the fifteenth slice, picked next after ruling out
      the obvious candidate: `routes/backups.ts`'s own comment explains
      exactly why there's no restore route yet - swapping a live database
      safely needs the staged update/rollback machinery 2.4 describes,
      which doesn't exist since no release has ever been cut. Building a
      restore button without that machinery would be the unsafe thing to
      ship, not the missing thing, so this slice is the half that's
      actually safe: list what exists (`GET /api/backups`) and trigger
      one on demand (`POST /api/backups/run`), both owner/admin-only
      routes that were already real and tested, with zero UI before
      tonight.
    - `frontend/src/apps/settings/BackupsSection.tsx`: a new section on
      the Settings page, gated to owner/admin
      (`person.role === "owner" || "admin"`, matching the routes' own
      gate) - a child correctly sees no trace of it. `formatBytes.ts`
      (pure, tested) formats a backup's size in binary units (1024, not
      1000), matching what `du`/`ls -h`/every OS file browser already
      shows, so the number on screen matches the number a person would
      see looking at the file directly.
    - **Backend: `BackupInfo` moved to `@/wire`**, the same alias-free-
      module fix the shell/kit/Chat and settings-renderer slices used for
      `Roster`/`TurnValue`/`ConversationTurnRow`/`ResolvedSetting`, for
      the identical reason (`lib/backup.ts`'s own `@/lib/paths` and `@/db`
      imports make it unresolvable directly from another workspace
      package).
    - Exercised for real, on Jesse's actual dev household, not just a
      demo one: clicked "Back up now," got a real encrypted backup file
      and watched it appear in the list with a real timestamp and a
      correctly-formatted size (84 KB), confirmed the section is
      completely absent for a child profile (Nova), and confirmed signing
      back in as the owner still shows the same backup - real persistence,
      not a session-local list. 5 new frontend tests (`formatBytes.test.ts`),
      no backend test changes needed since the two routes already had
      coverage. No console errors.
    - **A `code-review` pass (medium effort) before committing found two
      real issues, both fixed.** `formatBytes` rounded before checking
      whether the rounded value crosses a unit boundary: 1048575 bytes
      (one byte under 1 MB) is 1023.999... KB, which fails the `>= 1024`
      loop check but rounds to 1024 - "1024 KB" instead of "1 MB." Fixed
      by re-checking after rounding and promoting once more; a regression
      test covers the exact boundary. Separately, `SettingsPage.tsx`'s
      `role === "owner" || role === "admin"` was a third independent copy
      of a check that already existed twice - `lib/access.ts`'s
      `isOwnerOrAdmin` (extracted there specifically for this reason
      after an earlier duplication) and `apps/people/roles.ts`'s
      `requiresSecret`. Fixed properly, not just within the frontend: the
      string-level check moved to `@/wire` as `isOwnerOrAdminRole`
      (`access.ts`'s `isOwnerOrAdmin` is now a thin `PersonRow` wrapper
      around it), and both `requiresSecret` and `SettingsPage`'s gate call
      the same shared function a frontend client can actually import -
      one real definition across the whole stack, not just consolidated
      on one side of it.
    - **Deliberately deferred, real 2.5 scope not attempted:** restore,
      for the safety reason above; a "what's inside a backup" detail view;
      the emergency kit printing the backup key at setup; `hub`/`smb`
      remote targets (one local store exists); a restore drill wired into
      a release (no release has been cut); the retention-tier label
      (daily/weekly/monthly) on each row - `listBackups()` doesn't surface
      which tier kept a given file, only that it's still there.

- [x] A Memory page, the sixteenth slice: `lib/memory.ts`'s real store
      (entity-first recall, decay, tiers, per-person scoping) has had no
      way for a family to see what's actually remembered about them since
      it shipped. This is the read half plus the one safe write: list
      what the signed-in person can already see (`list()`'s own
      `canRead` rule does the real scoping, unchanged) and Archive (a
      status change, not a delete).
    - `frontend/src/apps/memory/`: `memoryLabels.ts` (pure, tested) maps
      a record's `category` to a real label and resolves `scope: "person"`
      records against the roster (`GET /api/people`, fetched alongside
      the memory list) so a family member reads "Nova," never a raw
      `person-xxxxxx` id - falling back to "A household member" rather
      than a raw id if that person is ever unresolvable, matching the
      dad-test standard the rest of the UI already holds to.
      `MemoryPage.tsx` is the fourth nav entry.
    - **`forget()` deliberately not wired up, and that was a real,
      considered call, not an oversight:** `lib/memory.ts`'s `forget()`
      is a genuine permanent bulk `DELETE` of every person-scope record
      about someone - the one sanctioned hard-delete this whole subsystem
      allows. A destructive action at that scale needs a real confirm
      dialog, and chapter 6's dialog pattern doesn't exist yet; reaching
      for a bare browser `confirm()` instead would also make the button
      untestable through this session's own browser automation, which is
      barred from triggering native dialogs. Both are real reasons to
      wait for the real primitive, not just tonight's time budget.
    - Exercised for real, and this one closes a real loop across three
      slices built tonight: sent "remember that trash day is Tuesday" in
      Chat, watched the deterministic skill floor fire ("Got it, I'll
      remember that," no model call, matching the turn engine's own
      `source: "skill"` path), confirmed the real record appeared on the
      Memory page labeled "Household · Fact," archived it, confirmed it
      disappeared, and confirmed a hard reload still shows it gone - a
      real status change, not a client-side filter. No console errors.
      6 new frontend tests (`memoryLabels.test.ts`), no backend changes
      needed - `routes/memory.ts` already did everything this page
      needed.
    - **Deliberately deferred, real 4.4 scope not attempted:** `forget()`
      (above); a recall/search box (`POST /api/memory/recall` exists and
      is real, has a side effect on `uses`/`last_used_at` per its own
      route comment, and has no UI reason to fire yet without one);
      supersede (`POST /api/memory/:id/supersede`, editing a fact rather
      than retiring it); sensitive-record redaction in this UI (`sensitive`
      is a real field on every record; this page shows every field it
      gets back verbatim, so a sensitive record's text is visible here to
      whoever can already read the record at all - matches `list()`'s own
      access rule, but a dedicated masked-by-default treatment for
      `sensitive: true` records is real, separate UI work not attempted);
      per-person memory export (`GET /api/memory/export`, a different
      surface than this browsing page).

- [x] Self-service PIN/password change, the seventeenth slice: 4.1 has had
      no way for a person to change their own PIN since it shipped - only
      creation (`POST /api/people`, owner/admin only) and verification.
      Picked next after building four straight read-then-write pages
      because it's a real, plain security gap: today, once set, a PIN
      is permanent for that person's whole lifetime on the hub.
    - `backend/src/routes/auth.ts`: new `POST /api/auth/change-secret`,
      self-service only (`requireAuth`'s actor is always the target - no
      "change someone else's PIN" here, matching `routes/people.ts` having
      no edit-person route at all yet). Reuses `/verify-secret`'s exact
      throttle/lockout shape (per-profile exponential backoff and per-IP
      throttle) for the current-secret check: a stolen session cookie
      alone must not be enough to silently lock a family member out of
      their own profile by racing guesses at their current PIN. A
      PIN-free profile (a child, 4.1's bare-tap case) can set one for the
      first time with no `currentSecret` at all.
    - `frontend/src/apps/settings/ChangeSecretSection.tsx`: a new section
      on the Settings page, visible to *everyone* (not gated to owner/
      admin like `BackupsSection` - changing your own PIN is a personal
      action any role can take). Branches its own copy and required
      fields on `person.hasSecret` (real, current/new/confirm vs. a
      first-time "choose one," not two versions of the form).
    - Exercised for real, on Jesse's and Nova's actual profiles - **this
      changed real credentials on the running dev household**: changed
      Jesse's PIN from `482913` to `759124` (signed out, confirmed the
      new one works and the old one no longer does), then set a first
      PIN (`1234`) for Nova, confirmed the sign-in picker immediately
      required it where it previously allowed a bare tap, and confirmed
      it too. 6 new backend tests
      (`auth.test.ts`'s new `describe("change-secret...")`, including a
      lockout test using one authenticated client throughout rather than
      a fresh one per attempt - unlike `/verify-secret`'s own lockout
      test, this route requires `requireAuth`, so the realistic threat it
      defends is a stolen already-signed-in session repeatedly guessing
      the real PIN, not an anonymous unauthenticated attacker).
    - **Closed later the same night:** the Settings page used to keep
      showing "doesn't have one yet" immediately after successfully
      setting a first PIN, until the next full page load - `person` was
      loaded once by `App.tsx` with no way for a page to ask for a fresh
      copy. `App.tsx` now has two distinct refetch functions, not one
      reused for both jobs (a code-review pass on this exact fix found
      the first version's single `refreshPerson` answering two different
      questions): `loadPerson` (fail-closed - used for the first load and
      right after sign-in, where "who's signed in" genuinely being
      unknown on failure means treat it as signed out) and
      `revalidatePerson` (used for `SettingsPage`'s `onPersonChange` -
      someone who just changed their own PIN is definitely still signed
      in, so a transient failure here only leaves the existing `person`
      alone instead of forcing them back to the sign-in screen). The
      review also flagged `SignIn`'s `onSignedIn` hand-copying
      `loadPerson`'s body instead of calling it; now does. 2 new
      component tests (`ChangeSecretSection.test.tsx`, stubbing
      `globalThis.fetch` rather than `mock.module()`-ing `@/lib/api`:
      this file's static import of the component under test means Bun's
      module cache would not reliably re-bind a module mock registered
      inside a test body). Verified live again after the split: created a
      fresh PIN-free adult, watched the section switch from "choose one"
      to "current/new" copy instantly on save, no reload.
    - **A known, accepted edge case in the fix itself, not a new bug:**
      a second review pass on this exact change flagged its own tradeoff
      - `revalidatePerson`'s deliberate fail-open (above) means a
      *transient* failure on the post-change `api.me()` call leaves the
      stale "doesn't have one yet" copy showing a little longer, on the
      rare request that genuinely fails right after a genuinely
      successful change. The PIN change itself is never affected either
      way; only this one label can lag until the next reload. A retry or
      a visible "couldn't confirm, refresh to check" state would close
      it fully; not built tonight; the review's own verdict was
      "plausible-severity awareness," not a bug to fix now.
    - **A `code-review` pass (medium effort) before committing found two
      real issues in security-sensitive code, both fixed.** A genuine
      race: the write was a SELECT-then-branch (update if a record
      exists, insert if not), and `personId` is that table's primary
      key - two concurrent requests for the same PIN-free profile
      (a double-submit, or a retry after a slow response) could both see
      no record and both attempt an INSERT, the second throwing a
      primary-key violation instead of the intended idempotent "set the
      PIN" outcome. Fixed with a single atomic `onConflictDoUpdate`
      upsert; a new regression test fires two real concurrent requests
      and asserts both succeed, with exactly one of the two secrets
      ending up valid afterward. Separately, the throttle/lockout/verify/
      failure-bookkeeping sequence was copied near-verbatim from
      `/verify-secret` instead of shared - extracted into one
      `verifyAgainstRecord` helper both routes call, parameterized only
      by the wrong-secret message each wants to show; `/verify-secret`'s
      own IP-throttle-before-existence-checks ordering was preserved
      exactly (the throttle call stays in each route, not folded into the
      shared helper, specifically so this behavior couldn't drift while
      extracting it). All 191 pre-existing backend tests plus the new one
      still pass unchanged, confirming the refactor is behavior-preserving
      for the untouched route.

- [x] **Hardware detection and the model-selection wizard's informational
      half (2026-09-04, self-picked after the PIN-change slice, session
      continued interactively with Jesse rather than overnight-autonomous
      this time).** Platform plan 4.11's deferred decision ("which GGUF is
      the default `chat` model, and what hardware the real household hub
      runs on" - `spec/llm/README.md`) had a real answer to build toward:
      Jesse's actual hardware is this Mac (M4 Pro, 24GB unified) plus an
      MSI laptop (RTX 2070 Super 8GB built-in, RTX 3070 8GB always-docked
      eGPU). Built:
    - `backend/src/lib/hardware.ts`: real detection, ported from the
      archived legacy hub's `lib/hwfit.ts` (hard-won logic, principle 8) -
      `nvidia-smi` for CUDA VRAM/utilization, `os.totalmem()` for Apple
      Silicon's unified-memory ceiling (no separate VRAM concept on
      Metal, same simplification the legacy code made). Live-verified: it
      correctly detects this actual machine as 24GB Apple Silicon.
    - `spec/schemas/model-capabilities.schema.json`: 4.11's own named
      `ModelCapabilities` record, deferred by `spec/llm/README.md` until
      "a real producer and consumer" existed - they do now (hardware.ts,
      and this session's settings-page wizard). Populated fields only
      (id, role, license, engine, sizing, pros/cons, implemented); the
      plan's fuller field list (tools, JSON schema, grammar, sampling)
      stays a named gap, not guessed at. Two sizing shapes via `oneOf`:
      `transformer_gguf` (param count, bits/weight, GQA-correct
      num_kv_heads/head_dim for the KV cache formula) and `diffusion`
      (a flat measured-VRAM figure); round-trips through both the TS/Zod
      and Python/Pydantic generators, fixtures added to both
      `fixtures.test.ts` and `test_fixtures.py` per platform plan 3's
      dual round-trip proof.
    - `backend/src/lib/modelCatalog.ts`: the fit calculator. Two research
      passes (this session, 2026-09-04) validated the formula against
      real prior art before writing it: weights ≈ params x bits/8 x
      (1 + GGUF overhead), KV cache = 2 x layers x **kv_heads** (not total
      attention heads - a GQA model like Qwen3 has far fewer, and using
      the wrong count overestimates the cache 4-8x) x head_dim x context
      x bytes/element. Diffusion entries compare a flat working-VRAM
      figure against raw budget with no chat-model overhead subtraction
      (that overhead is calibrated for an always-resident server sharing
      a card with the OS compositor, which doesn't apply to a dedicated
      image/video card). Catalog seeded with the researched, decided
      picks: Qwen3 8B Instruct (chat, `implemented: true`, the one role
      with a real engine), Juggernaut XL Ragnarok and FLUX.2 [klein] 4B
      (image, both `implemented: false` - recorded as a real LoRA-
      ecosystem tradeoff for the wizard to show, not one this session
      picked for the household), Wan 2.2 TI2V-5B FP8 (video, same
      status). `GET /api/host/hardware` and `GET /api/host/models?role=`
      (owner/admin only, matching backups.ts's posture: host-level data,
      not a personal preference) expose it.
    - `frontend/src/apps/settings/ModelsSection.tsx`: shows detected
      hardware in plain language, then every catalog entry per role with
      its fit, pros, and cons - **deliberately no "choose this" control**.
      There is no download queue or engine-launch wiring yet (nothing
      Jesse's earlier "the wizard can present options with pros/cons"
      design has to act on), so a selection button would look actionable
      and silently do nothing, worse than the honest read-only view this
      session shipped instead. Live-verified against this real Mac
      (a throwaway backend instance on a scratch data dir, never Jesse's
      real household database): correct hardware line, correct fit
      figures, correct "not runnable yet" labeling on the image/video
      entries, screenshotted via Claude in Chrome before calling it done.
    - **Judgment calls made without asking, confirmed compatible with
      what Jesse said afterward rather than guessed blind:** (1) a static
      "dedicate X% of this box" allocation slider was considered and
      rejected after research (real precedent - Windows Game Mode's
      dynamic foreground-priority throttling, Docker Desktop's move away
      from manual sliders toward auto-scaling, Kubernetes' request/limit/
      Burstable pattern - all point away from a static split, which wastes
      whatever percentage sits idle) in favor of the fit calculator's
      existing behavior: recommend against a modest assumed baseline,
      let the real engine use whatever's actually free, degrade to
      queue-and-wait (the legacy hub's own pattern for chat-vs-image-gen
      contention) once a second real workload exists to contend with
      chat. (2) The legacy safety architecture (`csamGuard.ts`'s
      always-on, non-bypassable-by-consent floor; `contentPolicy.ts`'s
      per-profile dials with an `IRREDUCIBLE_CORE` that's never
      removable) was confirmed, not redesigned, against the new org's
      neutrality and non-removable-child-safety rules - it already
      matches; porting it forward is the next step when an image/video
      backend exists to protect.
    - **Deliberately deferred, all real gaps, not silently skipped:** no
      GGUF is downloaded, no `llama-server` binary is fetched, no
      download-job queue exists (a multi-GB action onto Jesse's real
      machines, flagged rather than auto-triggered) - the wizard's
      "choose and provision" half needs that queue built first. No
      auto-tuned engine launch flags (flash attention, quantized KV
      cache, `-ngl auto`) either: `llmSupervisor.ts`'s spawn path has
      nothing to pass flags to without a real model file, and building
      that now would be exercising nothing, the same discipline
      `spec/llm/README.md` already applied to `ModelCapabilities` itself.
      No image/video generation package (ComfyUI-equivalent sidecar,
      routes, safety wiring) exists; the catalog entries for those roles
      are real, researched data with nothing to run them yet.
    - Download URLs/sha256 checksums are intentionally absent from every
      catalog entry this pass: fabricating a checksum would be actively
      wrong (every future integrity check would either silently accept
      tampered bytes or permanently fail), and the real values weren't
      looked up. A real gap for whoever builds the download queue, not a
      guess.

- [x] **The model-provisioning slice: a real download queue, a real
      engine, engine control, thinking mode, and a friendlier down-state
      (2026-09-04, overnight, Jesse explicitly authorized working
      autonomously without waiting for check-ins).** Closes the "deferred,
      all real gaps" list the previous entry and `spec/llm/README.md` both
      named: no GGUF downloaded, no `llama-server` binary fetched, no
      download-job queue, no auto-tuned launch flags. See
      `spec/llm/README.md`'s own rewritten "real engine, live end to end"
      section for the technical detail; this entry is the narrative and
      the judgment calls.
    - **Real pins, looked up for real, not guessed.** Qwen3 8B Instruct
      Q4_K_M's GGUF: Qwen's own official HF repo (not a third-party
      requant), pinned to one git revision so the sha256 can never drift
      out from under it (`d98cdcbd...`, 5,027,783,488 bytes). The
      llama-server engine: ggml-org/llama.cpp build b10797, one pin per
      platform/arch/GPU-vendor (`engineCatalog.ts`). The macOS arm64
      (Metal) pin was downloaded, extracted, and run for real this
      session - `verified: true`. The Windows CUDA x64 pin (plus its
      separate cudart runtime package) was downloaded and hashed for
      real too, but never run: no Windows/CUDA box exists in this
      session, so it's honestly marked `verified: false` rather than
      assumed to work from the code alone.
    - **Verified live, end to end, on this real Mac**, not just unit
      tested: a real ~5GB download (resumable, checksum-verified) through
      the real "choose this" button, a real llama-server spawn with
      auto-tuned flags, a real post-load check (one real chat completion
      plus real memory measurement - 11-12% drift against the formula,
      logged as routine info, first real data point on whether
      `modelCatalog.ts`'s weights/KV-cache formula needs revisiting), and
      a real reply ("The capital of France is Paris.") through the actual
      Chat UI. Caught and fixed a real bug this way: the first launch
      used `--chat-template-kwargs` to default thinking mode off, and
      llama-server logged it as deprecated in favor of `--reasoning off`
      - exactly the class of thing a live spawn catches that a mocked
      unit test never would. Also verified live: the "think longer"
      per-message toggle (a real reasoning trace - 201 generated tokens
      against a ~20-word visible reply - stripped from display rather
      than shown raw), and engine Stop/Start/Restart from the AI models
      page (a stopped engine correctly refused to silently auto-respawn,
      and surfaced a friendly "check Household → AI models" message in
      Chat instead of a raw error string).
    - **Verification used a throwaway household, never Jesse's real
      one.** His actual dev data dir already had a real household (Jesse/
      Nova/Marlow) signed in with a PIN this session doesn't know and
      had no business resetting. Instead: his real backend process was
      stopped, a second backend was started against a scratch
      `MAIPAI_DATA_DIR` with a throwaway "Verify" household, the whole
      flow ran there, and his real backend was restarted identically
      afterward - his real database was never opened by the verification
      run at all. The one deliberate write to his real environment: the
      verified GGUF and engine binary were copied into his real `data/
      models`/`data/engines` afterward (pre-warming the cache so his own
      first "Use this" click is instant instead of a fresh 5GB download),
      but `chat.model_id` itself was left unset in his real household -
      that selection stays his to make.
    - **Also shipped:** engine resource stats (`engineStats.ts`, an
      in-memory 60s/2h ring buffer of memory + CPU% for the running
      engine process - never persisted, this is closer to `ps` than to
      household data) answering "how busy has the machine been"; the AI
      models page was redesigned around Jesse's live feedback mid-session
      ("ugly and too technical for a dad... take up a lot of space") into
      `docs/SETTINGS.md` Rule 3's actual shape (one card per role, the
      chosen model, "change," advanced details folded) instead of the
      flat pros/cons dump the previous entry shipped.
    - **The catalog-repo request, answered honestly rather than faked.**
      Jesse asked for the AI-models page to "pull options from our
      catalog repo" with a cached-copy fallback if it's down. Checked
      `getmaipai/catalog` for real: it's pre-code (its own README says
      so) - no package manifests, no signed TUF index, none of the
      lint/pack/sign/index tooling `docs/PACKAGES.md`'s supply-chain
      section describes. Building a "fetch from the catalog" against a
      catalog with nothing real to serve would mean either faking the
      fetch or half-building real signing/verification infrastructure as
      a side effect of a chat-model slice - neither is honest. Answer
      given instead: `modelCatalog.ts`'s bundled, compiled-in `CATALOG`
      already has zero outage risk by construction (it never depends on
      a network at all), which is a stronger version of "still works
      when the catalog repo is down" than any fetch-with-fallback layer
      would be. The real catalog-repo integration is a named, deferred
      gap blocked on the TUF signing infrastructure not existing yet -
      flagged to Jesse rather than quietly built around.
    - **TTS (Chatterbox Turbo/Nano) researched, not adopted**, per
      Jesse's note asking for an evaluation, not an implementation. Both
      models are real (MIT, Resemble AI) but PyTorch-only with zero
      independent CPU/edge benchmarks found anywhere; every published
      number is vendor-claimed, almost certainly measured on Resemble's
      own hosted GPU service. The legacy Kokoro-82M ONNX pick has a real
      independent CPU benchmark (RTX-free 4-core Xeon, sub-1.0 RTF, best
      measured quality in that comparison) and a genuine CPU-only/ARM
      runtime story via ONNX Runtime - a materially better-evidenced fit
      for both Home (re-verify Kokoro locally before deciding) and Bot
      (Chatterbox Nano has no Hailo-10H path and no Pi-class benchmark;
      Piper turned up as a candidate worth a look for the robot's
      edge constraints, not part of Jesse's original note). Recorded here
      rather than acted on: no TTS backend exists yet to run any of this
      against (same `implemented: false`, catalog-data-only precedent as
      the image/video entries).
    - **Two things Jesse flagged that this entry answers rather than
      builds:** (1) using Home for coding - not built (the `coding` role
      still throws `capability_missing`, no consumer exists anywhere in
      this repo, same as `spec/llm/README.md` always said); flagged back
      to Jesse as a real design question rather than silently scoped in,
      since a "bonus, not my main use case" role deserves its own
      decision on model choice and system-prompt shape, not a rushed
      add-on to a chat-model-download slice. (2) The hub/bot standalone-
      with-sync architecture (heartbeats, check-ins, syncing rules/users/
      memories) - not touched, and correctly so on inspection: this
      slice's new state (`chat.model_id` and the three launch-flag
      overrides in `settings/aiKeys.ts`) is `honoured_by: ["home"]` only,
      the same hub-internal-vs-spec-shared line `scheduledJobs`/
      `conversationTurns` already draw, since the bot's own hardware
      (Hailo-10H, not llama-server the same way) makes this exact chat-
      engine machinery hub-specific by nature. The real link/sync design
      itself is still unbuilt anywhere in the codebase, hub or bot
      (`lib/settings.ts`'s own comment: "the link and sync design in
      home/spec/dev.md once it exists") - a real, separate, foundational
      platform feature, not something this slice should have shoehorned
      in.
    - **A real operational note, not a bug:** the standards' gitleaks
      scan took ~15 minutes on this run (previously seconds) because it
      walks the working tree regardless of `.gitignore`, and `data/` now
      holds the cached 5GB model. Not fixed (deleting Jesse's pre-warmed
      cache to make `check.sh` faster would be a bad trade), just flagged
      so a slow `check.sh` on this machine going forward isn't mistaken
      for something broken.

- [x] **TTS model decision: Kyutai Pocket TTS, live-tested and picked over
      Kokoro-82M, Chatterbox Turbo/Nano, Dia-1.6B, and CSM-1B (2026-09-04,
      same overnight/live session as the model-provisioning slice above).**
      `spec/llm/README.md`'s TTS section and the earlier legacy-hub notes
      both flagged the `tts` role's model choice as unverified; this
      closes that with a real, live-tested pick rather than a literature
      survey.
    - **Why Kokoro was rejected**: Jesse's own ear, on the legacy hub's
      shipped voice - "no feel, doesn't sound lifelike." Real, not
      guessed: this session's earlier research had it as the best
      *independently benchmarked* CPU option (RTF 0.57, MOS 4.45), but a
      benchmark score isn't the same question as "does a person want to
      listen to it."
    - **Chatterbox Turbo, live-tested on this Mac (MPS)**: RTF 1.4-1.6x
      (slower than real-time), no streaming API at all (`generate()` only
      returns after the full utterance finishes) - a 66-character reply
      took 5+ silent seconds before any audio existed. Real independent
      quality evidence exists (TTS Arena beats ElevenLabs, 63.75%
      preference) but the latency disqualifies it outright for a live
      voice assistant as tested. A real bug was found and fixed getting
      this far: Resemble's `perth` watermarking dependency silently
      failed to import because newer `setuptools` dropped `pkg_resources`
      it still needs; pinning `setuptools<81` fixed it.
    - **Orpheus-TTS (3B, GGUF via llama.cpp), live-tested on this Mac**:
      architecturally the most interesting candidate - it speaks GGUF,
      meaning it could have reused the exact llama-server engine this
      session already built for chat, not a second heavy Python ML stack.
      CPU: RTF 1.6-2.2x, ~2.4-3.1s to first audio chunk. A real bug found
      along the way: the `orpheus-cpp` wrapper defaults to `n_ctx=0`
      ("auto" = the model's full trained context), which chokes Metal's
      KV cache allocation with `llama_decode returned -3`; an isolated
      test proved Metal itself works fine on this model (a bare
      `llama_cpp.Llama` call with `n_gpu_layers=-1, n_ctx=2048` ran in
      0.39s for 8 tokens) - patching the wrapper's default to `n_ctx=4096`
      fixed it. Metal result: RTF 1.26-1.53x, ~2.0s to first chunk - real
      streaming (10-156 chunks depending on length, audio genuinely
      arrives progressively), but still short of the "faster than Alexa"
      bar Jesse set, and the ~2s floor traces to something past the LLM
      itself (isolated token generation alone was fast, 67 tok/s) -
      likely the SNAC audio-token decode step or wrapper overhead, never
      profiled further once Pocket TTS won on both speed and quality.
    - **Dia-1.6B and CSM-1B**: researched, not live-tested, both ruled
      out on real evidence. Dia: real reputation for non-verbal cues
      (laughs, coughs) in dialogue, but confirmed batch-only, no
      streaming, community guidance is "use a cloud GPU." CSM-1B: the
      viral "indistinguishable from human" reputation belongs to Sesame's
      hosted Maya product demo, not the open-sourced checkpoint, which is
      a base model with reported artifacts on longer text and has been
      unmaintained ~16 months - the reputation does not transfer to what
      MaiPai would actually self-host.
    - **Kyutai Pocket TTS (100M, CPU-only) - the winner.** A second-
      opinion research pass (from Fable, a different Claude session)
      proposed it; verified independently against the real repo (9,350
      stars, MIT, pushed the day before this session) and the real GitHub
      issue thread it cited (`pocket-tts#115`, "Prosody and audio quality
      worse than Kokoro"), including a real comment from a Kyutai
      maintainer confirming the shipped default voices are weak and
      voice-cloned quality is real and strong - checked, not trusted
      blind, same standard applied to every other claim tonight. Live
      numbers on this Mac, CPU only, **beat the vendor's own claimed
      numbers**: RTF ~0.09-0.10 (9.4-12.5x faster than real-time),
      consistent across every voice and text length tested - dramatically
      faster than Kokoro's 0.57 and the only candidate that cleared "as
      fast as Kokoro" at all.
    - **Real listening tests, not just numbers** (Jesse judged all of
      these by ear, not from a report): the default English voice
      ("alba" in Kyutai's naming, but the non-cloning model's baked-in
      voice turned out to read as male by ear, not the female voice the
      name implied - corrected after Jesse actually listened, a good
      example of why this session's whole approach was "generate and
      listen," never trust the label). Six distinct cloned voices tested
      (anna, jane, mary - female; george, michael - male, plus the
      default), all good. A same-speaker, same-text, different-reference-
      clip emotion test (Kyutai's own EARS dataset ships `emo_*_freeform`
      clips per speaker specifically for this) across amusement/anger/
      contentment, one female speaker and one male speaker: judged as
      genuinely different-sounding per emotion, not samey. A same-voice,
      different-*text*-only emotion test (excited/angry/content wording,
      same neutral reference clip) also judged as sounding good. A
      written-cue test (`*clears throat*`, `*cough*` literally in the
      text) failed - those don't render as real non-verbal sounds, only
      spoken-word fillers/stutters ("um," "uh," "s-sorry") came through
      naturally. No emotive-tag syntax like Chatterbox's `<cough>`/
      `<laugh>` exists in Pocket TTS; whatever "feel" comes from the
      cloned reference clip's own delivery style and natural text
      phrasing, not from inline markup.
    - **Two real, unresolved gaps before this can actually ship:**
      (1) **The voice-cloning-capable checkpoint is gated on Hugging
      Face** (an acceptable-use click-through, not a commercial
      restriction, but still requires an authenticated HF account to
      accept it and a token to download it programmatically) - tonight's
      test used Jesse's own personal read token, fine for evaluation, not
      a real distribution story: a shipped product cannot require every
      household to create an HF account. Needs either a pre-accepted,
      MaiPai-controlled mirror/re-host (checking the license permits
      that) or some other resolution before this becomes a real
      `modelDownloadJobs.ts`-style pinned download. (2) **The Pi/Bot
      side is completely unbenchmarked** - Fable's proposal was Pocket
      TTS on both hub and Pi, but per the org's own "a hypothesis until
      measured through the real speaker" rule, nobody has run this on
      Pi 5 hardware yet; the bot's old project code can reportedly wire a
      quick bench once Jesse powers it on, not done this session.
      **Licensing note for whatever ships as the default voice**: the
      VCTK-sourced voices tested (anna/george/jane/mary) are CC BY 4.0,
      fine even if MaiPai is ever sold; the EARS emotion-set voices are
      CC BY-NC (non-commercial only) - fine for a household's own use,
      wrong choice for a shipped default.
    - **Not built this session**: no `tts` role backend, no catalog
      entries, no engine supervisor, no routes, no turn-engine wiring to
      actually speak a reply. This entry is the decision and the
      evidence behind it, the same "researched and recorded, not yet
      implemented" precedent `modelCatalog.ts`'s image/video entries
      already set - building the real `tts` role is a separate, real
      slice of work, deliberately not started tonight given how much
      this session had already covered.
- [x] **The `tts` role, real end to end: "I don't think chat works with
      voice on the web for me to test" (2026-09-04, same session as the
      decision above).** `spec/voice/` (new, mirrors `spec/llm/`'s wire-
      contract-plus-stub shape): `PocketTtsClient` (real HTTP against
      `pocket-tts serve`'s two endpoints, `/health` and `/tts`) and
      `stubServer.ts` for tests. `backend/src/lib/ttsSupervisor.ts`
      mirrors `llmSupervisor.ts`'s lazy-start-once shape scaled down to
      one backend (no catalog entry or download job yet - see
      `spec/voice/README.md` for why): `MAIPAI_TTS_URL` override, else a
      real `uvx pocket-tts serve` spawn when `uv` is on `PATH`, else the
      stub. `backend/src/lib/tts.ts` + `POST /api/tts`
      (`backend/src/routes/tts.ts`) mirror `llm.ts`/`POST /api/llm/chat`'s
      validate-then-typed-result shape. `ChatPage.tsx` gets a manual
      "Listen" button per reply (`MessageThread.tsx`'s `onPlay` prop,
      opt-in so other consumers of that shared primitive are unaffected) -
      manual, not autoplay, so a household member chooses to hear each
      one rather than every reply talking on its own.
    - **A real stack deviation, flagged rather than absorbed
      (`spec/voice/README.md`):** every other `chat`-role dependency is a
      plain downloaded file Bun spawns directly; this is the first hub
      feature whose real backend needs `uv`/Python present on the host at
      *run* time. `ttsSupervisor.ts` detects `uv`'s absence and falls back
      to the stub instead of crashing, so a fresh install without `uv`
      still boots, just without real voice replies until `uv` is
      installed.
    - **First cut shipped buffered (whole WAV, then an `<audio>` element),
      then rewritten to real chunked streaming the same session** once
      Jesse actually tried it ("make sure you are streaming responses as
      you get [them] instead of generating the entire wav and then just
      playing that" - his own older, non-streaming version of this
      pipeline was slow and word-by-word streaming was the specific gap he
      wanted fixed). `spec/voice/ts/client.ts`'s `synthesizeStream()`
      returns the raw, unbuffered response stream; `POST /api/tts`
      (`routes/tts.ts`) pipes it straight through rather than buffering
      server-side; `frontend/src/lib/streamingWavPlayer.ts` (new) decodes
      and schedules each PCM chunk via the Web Audio API as it arrives,
      the same technique Pocket TTS's own demo page uses. Verified live
      with `curl`: `Transfer-Encoding: chunked`, time-to-first-byte 17ms
      vs. 715ms total for a real reply - genuinely streaming, not just
      claimed to be. This also resolved a real, load-bearing quirk rather
      than working around it: Pocket TTS's response ships a bogus
      placeholder WAV header size (~2,000,000,000 bytes, confirmed live) -
      the buffered version had to detect and rewrite it before handing a
      file to `<audio>`; the streaming player never trusts the header's
      declared size at all (only the format fields), so the quirk stopped
      being a problem to work around rather than getting fixed differently.
      Per-chunk scheduling (rather than one opaque element) is also the
      real mechanism a future barge-in feature needs (Jesse, same
      session: the old project "didn't allow for barge in... because of
      no gaps") - `StreamingWavPlayer.stop()` already cuts every
      currently-scheduled chunk immediately, not built on yet.
    - **Real bugs found live across both passes, each fixed and
      regression-tested, not just reasoned about:** (1) the WAV
      placeholder-header bug above (buffered-version-only, moot once
      streaming replaced it, but real while it lasted - a short reply's
      "Listen" button stuck forever on "Playing…"); (2) a shared-resource
      race, first seen as a stale `<audio>.play()` rejection landing on
      the wrong message, then reproduced again in the streaming rewrite
      as a stale late failure doing the same thing - fixed with a
      per-call request-token guard in `ChatPage.tsx`'s `handlePlay` that
      every async continuation checks before touching state
      (`ChatPage.test.tsx`, new: reproduces the real interleaving - click
      first, click second before the first settles, THEN let the first
      fail - confirmed to actually fail without the guard, not just pass
      trivially); (3) a second-order gap the review that caught (2) also
      found: a superseded message's stale `playingId` was never cleared
      up front, so if the *new* message's audio ended up with zero
      playable frames (`onFirstAudio` never fires), the *old* message
      could stay stuck showing "Playing…", permanently disabled - fixed
      by resetting `playingId` unconditionally at the start of every
      `handlePlay` call rather than relying on the new call's own
      callbacks to overwrite the old value; (4) `ttsSupervisor.ts`'s
      `waitForHealth` polled `client.health()` for the *entire* 180s
      timeout even when the spawned process had already exited (missing
      package, broken venv, a taken port) - fixed to check
      `Bun.Subprocess.exitCode` on every poll and fail within seconds
      instead of three minutes (`ttsSupervisor.test.ts`: a real child
      process that really exits, not a mocked one, proves the fast path).
    - **Verified live, not just unit-tested, on both passes**: a real
      `uvx pocket-tts serve` spawn from a real, running hub backend,
      `curl`'d directly (`POST /api/tts`, real signed-in session, real WAV
      bytes back) and played through this Mac's real speakers with
      `afplay`; the "Listen" button driven for real in the browser against
      the running hub (Jesse's own household, PIN-signed-in) for both a
      single click and the rapid-second-click race, confirmed via
      screenshots to reach a clean "Listen" state on its own once playback
      finished, no stuck states, no console errors. The buffered-version
      pass had one thing it could not confirm through the automation
      tooling (whether `<audio>.play()` ever actually completed in the
      CDP-driven browser tab this session's tooling uses - both a
      detached `Audio()` and a DOM-attached `<audio controls>` stalled at
      `readyState 0` indefinitely); the streaming rewrite's Web Audio API
      approach does not hit that same wall and was confirmed working
      end-to-end in the same tooling, though whether the original stall
      was that CDP tab's own audio pipeline or the WebKit-style
      user-activation-window risk a review flagged (creating the player
      only after an awaited fetch) was never isolated - moot now that the
      real fix (a synchronously-created `AudioContext`, before any
      `await`) addresses the activation risk regardless of which one it
      was.
    - **Auto-play: tried, then explicitly reverted, same session.** Jesse
      first asked for it ("I still have to click listen though - it
      doesnt auto speak replies"), it shipped (`handleSend` calling
      `handlePlay` automatically), then two things happened worth keeping
      the reasons for. First, a real cross-browser gotcha Jesse caught by
      testing in his own two browsers: audible in the Chrome tab this
      session's browser tooling drives, silent in Safari - consistent
      with Safari's autoplay policy strictly requiring a *fresh* user
      gesture, which the `AudioContext` created after `await
      api.sendTurn(...)`'s network round trip no longer has (Chrome is
      more lenient about the gap). Second and overriding: Jesse decided
      he doesn't want auto-play at all ("again, I dont want auto play"),
      independent of the Safari bug. Fully reverted - `handleSend` no
      longer calls `handlePlay`, the "Listen" button is the only way to
      hear a reply, same as the first cut. Worth a code review pass
      anyway before the revert landed: it found a real unmount-safety gap
      (navigating away from Chat mid-synthesis left audio playing with no
      owner and no way to stop it) that would have mattered for any
      future feature that plays audio outside a direct click handler -
      recorded here rather than fixed, since the feature it applied to no
      longer exists. One more real bug survived that review and the two
      before it, on the manual "Listen" button itself: `onEnded` cleared
      `playingId` but never `loadingId`, so a reply whose synthesized
      audio has zero playable frames (`StreamingWavPlayer.finish()`
      calling `onEnded` directly, since `onFirstAudio` never got the
      chance to fire) left that message's button stuck on "Loading…",
      disabled, with no way to retry short of a reload - fixed by
      clearing both, `ChatPage.test.tsx` covers the exact zero-frame WAV
      shape that reproduces it.
    - **What Jesse actually meant by "streamed"**: the legacy hub
      (`home-legacy.git`) never had a manual button or a post-hoc
      autoplay decision at all - `useCompanionVoice.ts` watched the
      LLM's reply *stream in* token by token, fired TTS the instant each
      completed sentence boundary appeared in the growing text (a real,
      tuned sentence/clause-boundary chunker,
      `useCompanionVoice.ts`'s own header comment: "flush on the first
      sentence terminator... or the first clause boundary once it's long
      enough, whichever comes first, to minimize time-to-first-audio"),
      and
      `TTSPlaybackScheduler`/`VoicePlayback` played each sentence's PCM
      back-to-back via the Web Audio API as later sentences were still
      being synthesized - sound starts while the model is still writing.
      This session's `/api/turn` has no text streaming to hook that into
      yet (`spec/llm/README.md`: "non-streaming only this pass," `stream:
      false` always sent to llama-server) - that is the real, larger
      prerequisite this pattern needs, not a frontend change. Recorded
      here as the concrete target once LLM streaming lands: reuse
      `useCompanionVoice.ts`'s sentence-boundary chunker (hard-won,
      already tuned against real jarring-mid-phrase-chop failures) and
      `TTSPlaybackScheduler`'s gapless-scheduling approach (which
      `streamingWavPlayer.ts` already independently arrived at the same
      Web Audio API shape for, one call's byte chunks rather than
      multiple sentence calls) rather than re-deriving either from
      scratch.
    - **Still not built**: voice selection or cloning (every reply uses
      Pocket TTS's own default voice - the cloning-capable checkpoint's
      HF-gating gap from the decision entry above is still unresolved),
      speech normalization (numbers/units/dates spoken naturally),
      barge-in (the per-chunk scheduling that would make it possible now
      exists; nothing calls `stop()` on a new user utterance yet), the
      chat-mode switcher (wakeword, continual chat, voice reply, text
      only) Jesse asked for the same session - voice reply and text only
      are real extensions of what exists here; wakeword and continual
      chat need voice *input* (microphone capture, speech-to-text), which
      does not exist anywhere in this codebase yet and is real, separate,
      Hub v0.3-sized scope, not a quick addition to this slice (confirmed
      with Jesse: ship the two real modes now, list the other two as
      visibly not-yet-built rather than leaving them out or faking them),
      and real streaming LLM text through `POST /api/turn` - the actual
      prerequisite for "what Jesse actually meant by streamed," above.
- [x] **Real end-to-end streaming: the LLM's text and the reply's speech
      both arrive as they're generated, same session as the entry
      above.** Closes the prerequisite that entry named: "start on it
      now" (Jesse), after pointing at the legacy hub's real
      `useCompanionVoice.ts`/`voice-playback.ts`/
      `tts-playback-scheduler.ts` as the pattern to port rather than
      re-derive.
    - **The LLM wire contract streams for real.** `spec/llm/ts/client.ts`'s
      `chatCompleteStream()` sends `stream: true` and parses llama-server's
      real SSE (`data: {...}` lines, `data: [DONE]` - confirmed live
      against a real spawn, not assumed from docs). `stubServer.ts`'s
      canned reply now streams too, word by word, so the test suite
      exercises the real mechanism rather than a fake one-shot stand-in.
      `backend/src/lib/llm.ts`'s `startCompleteStream()` mirrors
      `complete()`'s validate-then-resolve-a-backend shape exactly, so a
      bad request or a down engine still gets a proper HTTP status before
      any byte streams - only actual token generation is where a failure
      can no longer change the response status.
    - **`turnEngine.ts` gained `runTurnStream()` alongside `runTurn()`**,
      sharing a new `prepareTurn()` helper for the identical safety-first
      routing and deterministic skill floor both need. A safety refusal or
      a skill reply answers as a single "immediate" event (both are
      already complete, deterministic text with nothing to gain from a
      fake trickle); only the `chat` role's own fallback answer streams.
      `POST /api/turn/stream` (`routes/turn.ts`) is newline-delimited
      JSON, not SSE - one real response body, no `text/event-stream`
      framing needed for a wire shape this simple (`wire.ts`'s
      `TurnStreamEvent`: `delta`, `done`, `error`). The old, non-streaming
      `POST /api/turn` stays exactly as it was - not every caller needs
      streaming, and it costs nothing to keep both.
    - **The frontend speaks sentence by sentence as the reply is
      typed**, ported in spirit (not verbatim - Pocket TTS and this
      hub's own wire shapes differ from the legacy stack) from
      `home-legacy.git`'s real, tuned pattern. `frontend/src/lib/
      sentenceChunker.ts` is the ported sentence/clause-boundary
      detector (`useCompanionVoice.ts`'s own regexes and the reasoning
      behind them, including the "don't clause-split a short sentence"
      lesson that file's header comment already recorded).
      `frontend/src/lib/sentenceSpeechScheduler.ts` fetches and speaks
      each completed sentence with bounded parallelism (2 in flight,
      matching the legacy hub's own `MAX_PARALLEL_SENTENCE_FETCHES`) but
      schedules playback strictly in issue order via the Web Audio API,
      gapless, the same `nextStartTime` bookkeeping
      `streamingWavPlayer.ts` already uses for one call's byte chunks -
      unlike that file, each sentence is buffered whole and decoded with
      the browser's native `decodeAudioData` rather than hand-rolled PCM
      math, since the real latency win here is sentence-level pipelining,
      not sub-sentence streaming (the legacy backend made the identical
      trade). `ChatPage.tsx`'s `handleSend` creates the scheduler
      *synchronously*, before any `await` - the fix for the Safari
      autoplay-policy gotcha the reverted auto-play attempt hit, this
      time built into the architecture instead of bolted on after the
      fact. A `<think>` block (the `thinking` toggle) is buffered and
      never shown or spoken until its closing tag arrives; `stripThinking()`
      still runs on the final `done` event as the authoritative fallback
      for any edge case (a reasoning-only reply, a stream that never
      closes its think block) the incremental version can't resolve on
      its own.
    - **Verified live, not just unit-tested**: a raw `curl -N` against
      `POST /api/turn/stream` streaming real token deltas from the real
      spawned Qwen3 engine, ending in a `done` event whose reply text
      exactly matches every delta concatenated; the safety-refusal path
      confirmed as a single immediate event. In the browser, three real
      sends (two, four, and eight-sentence replies) each produced exactly
      one `/api/turn/stream` request and one `/api/tts` request per
      sentence (2, 4, and 13 - the last including one extra flushed
      fragment), all 200s, zero console errors, confirmed via the
      network panel rather than assumed from the code.
    - **Real bugs found and fixed before commit, each with a test that
      fails without the fix**: a naive test asserting only "was
      `enqueueSentence` called" would have passed against broken code, so
      every regression test here was verified to actually fail first
      (the same discipline the tts-role entry's own tests already
      established) - `ChatPage.test.tsx`'s streaming-send tests, proven
      against a deliberately neutered `scheduler.enqueueSentence` call.
      Two more found by a code review pass before this landed: (1) the
      `<think>`-block detector decided "is this a think block" from a
      single delta, so real token-level streaming splitting `<think>`
      itself across several deltas (a tokenizer's own boundaries rarely
      align with a tag's characters) locked in "not a think block" the
      moment the first delta alone didn't match the full tag, leaking raw
      reasoning into the thread and out loud - fixed to wait until enough
      characters have arrived to know for certain either way
      (`ChatPage.test.tsx`'s "split across many small deltas" test feeds
      the tag one character at a time, worse than any real tokenizer
      would produce, and was confirmed to fail against the original
      check). (2) Both streaming readers (`api.ts`'s `readTurnStream()`
      and `client.ts`'s `chatCompleteStream()`) never gave `TextDecoder`
      a final, non-streaming flush call once their source exhausted -
      real `TextDecoder` behavior, not speculative: a multi-byte UTF-8
      character (an emoji, an accented letter) split across the last two
      network chunks would have its trailing bytes silently buffered and
      dropped. Both now flush and drain any remaining buffered line after
      their read loop ends. A further review pass on those two fixes
      found four more, real ones: (3) a mid-stream "error" ndjson event
      was thrown in `ChatPage.tsx` as a plain `Error`, which the catch
      block's `e instanceof ApiError && e.code === "unavailable"` check
      can never match, so an engine crash mid-generation always fell
      through to the generic "Could not reach the hub" message instead of
      the intended, more actionable one - fixed to throw a real `ApiError`
      with that code. (4) The `<think>` detector was still a one-shot
      flag even after fix (1) above: it could resolve the *first* block
      but had no way to re-arm for a second one appearing later in the
      same stream, so a second block's raw text leaked into the live
      preview even though `stripThinking()`'s global regex would have
      caught it in the final saved text - the preview and the saved reply
      silently disagreeing. Rewritten as a real small state machine
      (`insideThink` toggles per block rather than latching) that handles
      any number of blocks, not just guards against a second one
      (`ChatPage.test.tsx`'s "two separate think blocks" test). (5) A
      stream that ended without ever sending a "done" or "error" event
      (an abnormal connection drop between deltas) left the frontend's
      read loop exiting silently - no exception, so the reply bubble just
      stopped growing with no banner and no way to tell it failed rather
      than finished; `handleSend` now throws its own "unavailable" error
      when the loop ends without a terminal event
      (`ChatPage.test.tsx`'s "ends without a done or error event" test).
      (6) `routes/turn.ts`'s catch block emitted the "error" event but
      never called `result.finalize()`, so a reply that had already
      streamed several real sentences into the household's own thread -
      shown and spoken before the engine crashed - was never written to
      conversation history at all, as if the exchange had never happened;
      fixed to still finalize (and so still log) whatever text streamed
      before the failure. Bun's own `ReadableStream` masks a mid-stream
      server-side error as a clean close from the client's side
      (confirmed live while writing the regression test - neither
      `controller.error()` nor a thrown `pull()` ever reaches the reader
      as a rejection, only as a silently truncated body), so this
      couldn't be reproduced end to end through a real fixture engine;
      the fix is proven instead by extracting the route's stream-building
      logic into `streamTurnEvents()`, a directly-testable generator
      driven with a real, hand-built failing token generator
      (`turnEngine.test.ts`'s two new tests). A further, smaller review
      pass over *those* fixes found two more: (7) folding `streamSpeech`
      into the new shared `rawStreamPost` helper had silently dropped its
      specific "Timed out waiting for voice" message in favor of a
      generic one - fixed by giving the helper an optional per-caller
      message. (8) `chatCompleteStream`'s early exit on `data: [DONE]`
      never released the reader lock, a real connection-pool leak under
      sustained chat traffic if llama-server keeps the TCP connection
      open briefly after the last chunk - fixed with a best-effort
      `reader.cancel()`. One more, non-bug finding acted on: the
      line-buffering/decode/final-flush mechanics behind fix (2) were
      duplicated near-verbatim between `api.ts` and `client.ts`, which is
      exactly how that bug needed fixing twice in the first place -
      centralized into `spec/streaming/ts/lineReader.ts`'s
      `readTextLines()`, a new small shared module both now call,
      keeping only their own per-line meaning (ndjson vs. SSE `data:`
      framing) to themselves. `api.sendTurn` (the frontend wrapper for
      the now-unused-by-ChatPage non-streaming `POST /api/turn` call)
      was also removed as genuine dead code the same review flagged; the
      backend route itself stays, the same "provisional real caller"
      posture `/api/llm/chat` already has. A fourth review pass, run
      wide (line-by-line, removed-behavior, and cross-file angles)
      before commit, found five more real ones: (9) `resolveRaw()`
      (the `<think>` detector, again) still only ever searched for the
      opening tag at the very *start* of the unresolved remainder, not
      anywhere within it - real text arriving ahead of a tag inside the
      same delta (a network chunk batching a lead-in phrase together
      with the start of a reasoning block) got the tag, and everything
      after it, dumped straight into the visible preview unresolved.
      Rewritten to search the whole remainder (`indexOf`, not
      `startsWith`), with a `searchFrom` cursor added at the same time
      so a long think block isn't rescanned from `scanPos` on every
      single delta (`ChatPage.test.tsx`'s "real text arriving before a
      `<think>` tag in the same delta" test, confirmed to fail against
      the `startsWith`-only version). (10) `sending` cleared on the
      *first* token rather than the whole turn, re-enabling Send while a
      reply was still streaming; a second concurrent `handleSend` shares
      `setBanner`/`setThinking` state with the first, with no way to
      tell whose update is whose - one call's error banner could be
      silently wiped by the other's success. Split into two flags:
      `sending` now stays true for the entire turn (gates Send),
      `awaitingFirstToken` is the separate, narrower one that only hides
      the thinking spinner. (11) `logTurn()`'s real DB write (a plain
      call, unguarded) propagated straight up through every caller in
      `turnEngine.ts`: a completely correct generation got reported as a
      *failed* turn just because its own logging failed afterward -
      `runTurn()` rejected an otherwise-successful reply outright, and
      `runTurnStream()`'s `finalize` closure made `streamTurnEvents()`
      report a mid-stream "error" for a reply that had already fully,
      correctly rendered to the household. Wrapped in a new
      `logTurnSafely()` at all three call sites, swallowing the failure
      to `console.error` instead - there's nothing useful left to
      retract once the reply already rendered; the failure is real but
      belongs in the server log, not the household's chat thread
      (`turnEngine.test.ts`'s new test forces a *real* SQLite
      `FOREIGN KEY constraint failed` by writing with an actor id that
      was never in `people`, not a mock, and confirms both that
      `runTurn()` still returns the correct successful reply and that no
      row was written - proving the failure was genuine, not a silent
      no-op). (12) `client.ts`'s `chatCompleteStream()` guarded against
      an empty `choices` array but not a chunk that omitted the field
      entirely (a valid-JSON, non-standard SSE frame some backends emit,
      e.g. an inline usage/error frame): `chunk.choices[0]` threw before
      the `?.` ever applied, killing the whole generation on one stray
      frame instead of skipping it, unlike the malformed-JSON case two
      lines up which already degraded gracefully - fixed to
      `chunk.choices?.[0]?.delta?.content` (`llm.test.ts`'s new test
      spins up a raw server emitting a well-formed choices-less frame
      ahead of a real one, confirming it's skipped rather than fatal).
      (13) `TurnStreamResult`'s error arm duplicated `TurnOpResult`'s
      failure union by hand - extracted a shared `TurnFailure` type both
      now reference, so the two can't drift into reporting different
      codes for what should be the identical failure. Two lower-priority
      findings from the same pass were left as-is: a timeout-message
      branch that's unreachable in practice, and a suggestion to move
      the `<think>`-detection logic server-side, a real architectural
      improvement but a larger change than this slice, noted here rather
      than built. A fifth, final review pass before commit found two
      more: (14) the "done" handler's trailing-fragment flush
      (`finalText.slice(spokenLength)`) assumed `spokenLength` (tracked
      against `visible`, resolveRaw()'s incremental preview) lined up
      character-for-character with `finalText` (stripThinking()'s
      separately-computed authoritative text) - they didn't whenever a
      `<think>` block was followed by whitespace: stripThinking()'s own
      `<\/think>\s*` regex consumes that whitespace, but resolveRaw() only
      ever advanced past the tag itself, keeping the whitespace in
      `visible` verbatim. The two coordinate spaces drifted apart by
      exactly that whitespace the moment any sentence after the think
      block got spoken mid-stream, corrupting the trailing fragment (its
      leading characters silently dropped). Fixed by making resolveRaw()
      skip trailing whitespace after a closing tag the same way
      stripThinking() does, keeping the two in sync
      (`ChatPage.test.tsx`'s "trailing fragment after a `<think>` block"
      test, built around exactly this shape - one space before the tag,
      two after - confirmed to fail without the fix). (15)
      `awaitingFirstToken` (the thinking spinner) is only ever cleared
      once a stream event arrives, but the `finally` block only reset
      `sending`, never `awaitingFirstToken` - a failure before any event
      (the fetch itself rejecting, e.g. a real network error) left the
      spinner showing forever even though the error banner correctly
      appeared right next to it. Fixed by resetting it in the same
      `finally` block (`ChatPage.test.tsx`'s "clears the thinking
      spinner" test).
    - **Still not built**: barge-in itself (the scheduler's `stop()`
      already supports cutting in cleanly; nothing calls it on a new
      user utterance while a reply is still speaking, only on a brand
      new *send*), tier 2 native tool calling over the streamed
      contract (4.5's own deferred scope, unchanged), and rate limiting
      on either turn route (the same tracked gap `spec/llm/README.md`
      already names, now applying to two routes instead of one).

- [x] **Per-person voice selection: `tts.voice_id`, the registry's first
      real person-scope key.** Closes the "per user selection of voice"
      half of the same ask that opened the streaming work above, and item
      3 of the Pocket TTS follow-ups note below (partially - see that
      note's update). `backend/src/settings/voiceKeys.ts` declares the
      key against Pocket TTS's own complete, hardcoded set of 26 named
      presets (`pocket_tts.utils.utils._ORIGINS_OF_PREDEFINED_VOICES`,
      read from the installed package's source - there is no listing
      endpoint) rather than an arbitrary URL field: `select`'s own
      validation (`lib/settings.ts`) rejects anything outside that list at
      write time, which is what keeps this from becoming an SSRF vector -
      Pocket TTS's real `/tts` endpoint accepts any `http://`/`https://`/
      `hf://` URL for `voice_url`, and the local `pocket-tts serve`
      process would fetch whatever it's given. `default: "alba"` (Pocket
      TTS's own built-in fallback) rather than an empty sentinel: every
      value this key can ever hold is a real, valid preset name, so
      nothing downstream needs to special-case "unset."
    - **This is the registry's first real `person`-scope key.**
      `lib/settings.ts`'s `parseScope`/`assertCanAccessScope` person
      branches existed from 4.6 but had nothing to exercise them through
      the HTTP layer until now (that file's own comment said so). A new
      `getPersonSettingValue(personId, key)` mirrors the existing
      `getHouseholdSettingValue()` for the one caller that needs a
      resolved value without a separate authorization check:
      `routes/tts.ts`, reading the signed-in actor's *own* id.
      `SettingsPage.tsx` gained a second `<SettingsRenderer scope="person"
      scopeValue={person:<id>} />` alongside the household one - the
      generic renderer's own header comment named this exact gap ("only
      the scope prop changes once there's a UI surface to open them
      from"); this is that surface's first real use.
    - **A small, generically useful side fix**: every `select`-selector
      value rendered as its raw machine token before this (`"quantized"`,
      `"bill_boerst"`) with no label transform at all.
      `SettingField.tsx`'s new `titleCaseOption()` (word-split, capitalize,
      join with spaces) fixes this for `tts.voice_id`'s names *and* every
      existing select key for free (`"quantized"` -> `"Quantized"`), not a
      per-key label table - nothing about the transform is voice-specific.
    - **Verified live, not just unit-tested**: `voice_url=vera` against
      the real running `pocket-tts serve` synthesized real, distinct audio
      in ~1.5s including that name's first-use download/cache (confirmed
      by direct `curl`, both before writing the client change and again
      after). In the browser: opening the new "Voice" section showed all
      26 preset names correctly title-cased, selecting "Vera" persisted
      immediately (a "Reset to default" control appeared, confirming
      `source: "user"`), and the household's real sqlite database shows
      the resulting row directly (`person:<jesse's id> | tts.voice_id |
      "vera" | user`) - not asserted from the UI alone.
    - **Real bugs a code review found and fixed, each with a test proven
      to fail without the fix**: none surfaced in the first pass; every
      new code path (the client's `voice_url` passthrough, the
      person-scope write/read authorization, the route resolving the
      actor's own setting, the label transform) had a dedicated
      regression test confirmed to fail against the pre-fix code first.
      A second review pass found three real hardening/dedup items, none
      active bugs: (1) `getPersonSettingValue()` originally took a bare
      `personId` string - safe only because its one real caller
      (`routes/tts.ts`) happened to always pass the signed-in actor's own
      id, a documented convention rather than an enforced one, so a
      future caller passing someone ELSE's id would compile, pass every
      existing test, and silently read their setting with no 403. Fixed
      by changing the signature to take the actor itself
      (`getPersonSettingValue(actor, key)`) - there is no longer a
      parameter a caller could mis-supply to read anyone but themselves,
      closing the gap at the type level rather than by convention
      (`settings.test.ts`'s new "two different people's own values never
      cross-contaminate" test, plus every existing test updated to the
      new shape). (2) `getPersonSettingValue()` and
      `getHouseholdSettingValue()` had drifted into near-identical copies
      of the same row-lookup/default-resolution logic - extracted a
      shared private `resolveStoredValue(scope, keyDef)` both now call, so
      a future fix to that logic (a `JSON.parse` failure, HLC-aware
      resolution) only has to land once. (3) `SettingsPage.tsx`'s two
      `SettingsRenderer` instances (household, person) each independently
      fetched `/api/settings/registry` - identical response either way,
      since the registry doesn't vary by scope - firing two requests on
      every Settings page visit, a duplication that only compounds as
      more instances are added (the still-missing Household/Profile
      picker). Fixed with a small page-session cache
      (`SettingsRenderer.tsx`'s `fetchRegistryCached()`, cleared on a
      failed fetch so the next instance can retry) - confirmed live via
      the network panel: exactly one `/api/settings/registry` request for
      both instances combined, and `SettingsPage.test.tsx`'s new test
      (confirmed to fail against the pre-fix direct-fetch code, catching
      2 requests instead of 1) proves it. That same test file's own
      missing `afterEach(cleanup)` was a real, independent bug the fix
      surfaced (two tests' rendered trees never unmounting between each
      other caused a flaky failure only visible running the FULL suite,
      never the file alone) - fixed alongside it.
    - **Still not built (the rest of the Pocket TTS follow-ups note)**:
      the full community voice *browser* (any file in `kyutai/tts-voices`
      by URL, not just the 26 bundled presets), voice cloning/training
      from a household's own recorded voice, and the non-Python engine
      ports - all still queued below, unchanged by this slice.

- [x] **Wake word, phase 1: infrastructure proof, real mic capture and
      real WASM inference, no custom model yet (2026-09-04).** The first
      real slice of the wake-word plan (this file's "Wake word, pulled
      forward from Hub v0.3" note) that doesn't need Jesse's own
      recordings: nothing anywhere in `home` had ever captured a
      microphone before this. Fires on openWakeWord's stock "hey jarvis"
      phrase, on purpose - proves the mechanism (mic -> onnxruntime-web
      WASM -> a real wake event) with zero training-data risk, since
      nothing is trained yet.
    - **Ported, not re-derived, from `home-legacy.git`'s own working
      implementation** (`.github/CLAUDE.md`'s "copy from legacy" rule for
      hard-won logic, applied for real this time): `mic-capture.ts` (16kHz
      AudioWorklet capture + resampling), `wake-word-runtime.ts` (lazy
      ONNX session loading, injectable for tests), `wake-word-pipeline.ts`
      (the mel/embedding/detector chain's exact constants - kept
      byte-for-byte, since the legacy repo's own comments record a real,
      previously-diagnosed bug from computing mel per-chunk instead of
      over a rolling window: "features only ~0.71 cosine-similar to
      openWakeWord... detectors fire on any speech"), and
      `wake-word-loop.ts` (hysteresis, score smoothing, post-wake
      suppression, buffer-reset-on-enable - each one a real false-fire
      fix in the codebase this was ported from). Discovered by searching
      the legacy git mirror's full history for wake-word/ONNX-related
      files rather than re-deriving the DSP pipeline from a blog post's
      simplified description, which would have missed the per-chunk-mel
      bug entirely.
    - **A real Chrome-only addition the legacy code never had**:
      `voiceIsolation: true` in `mic-capture.ts`'s `getUserMedia` constraints
      (Jesse, 2026-09-04) - confirmed absent from the full git history of
      `home-legacy`, `bot-legacy`, and `loki-doki` alike before adding it,
      so this is a genuine improvement, not a restored feature. Safe
      cross-browser since an unrecognized constraint name is ignored per
      spec, the same graceful-degradation posture the other three
      constraints already have.
    - **Every model asset is pinned and checksum-verified**
      (`backend/src/lib/wakewordAssets.ts`): `melspectrogram.onnx`,
      `embedding_model.onnx`, and the stock `hey_jarvis_v0.1.onnx`
      detector, all from openWakeWord's real `v0.5.1` GitHub release -
      URLs found in the legacy repo's own `download.ts`, but every SHA-256
      was computed fresh this session against files downloaded live, not
      copied from that listing. Served at `GET /api/voice/wakeword/:file`
      against a fixed allow-list (never a path built from the request) and
      `GET /api/voice/wakewords` for discovery, reusing the repo's existing
      generic `downloadUrl()` (modelDownload.ts) rather than building a
      second download mechanism.
    - **A real concurrency bug caught and fixed before it shipped**: the
      frontend pipeline loads mel, embedding, and the detector as three
      concurrent requests (`wake-word-pipeline.ts`'s `loadPipeline()`),
      which would have raced multiple `downloadUrl()` calls against the
      same destination file on first use - `downloadUrl()` has no locking
      of its own. Fixed with one shared in-flight promise
      (`ensureWakewordAssets()`), the identical shape
      `llmSupervisor.ts`'s `getChatClient()` already carries for the
      identical reason.
    - **Real tests for the ported logic**, not just "it compiles":
      `wake-word-loop.test.ts` drives the loop with a fake ONNX session
      factory (real DSP math, fake scores) and proves hysteresis, score
      smoothing, threshold fallback, post-wake suppression, and the
      warmup window all behave correctly - every assertion confirmed to
      fail against a deliberately broken version first, catching one real
      self-inflicted bug along the way: an early "post-wake suppression"
      test never actually exercised suppression at all (it ran out of
      queued high scores for unrelated reasons and passed for the wrong
      reason), found by disabling the real suppression code and watching
      the test still pass. `wakewordAssets.test.ts` and `WakeWordToggle.test.tsx`
      stay fully offline (pre-placed placeholder files, a stubbed
      `getUserMedia` rejection) rather than exercising the real GitHub
      download or a real microphone, matching this repo's own "no live
      network/hardware calls in the automated suite" testing standard.
    - **A code review before commit found two more real issues, both
      fixed with a regression test proven to fail first**: (1)
      `WakeWordToggle.tsx`'s unmount cleanup never bumped its own
      `requestIdRef`, unlike its `stop()` function - clicking the toggle
      then navigating away from Chat before the mic-permission prompt or
      the model registry fetch resolved let that stale, in-flight
      `start()` install a live microphone stream on an already-unmounted
      component, with nothing left mounted to ever stop it. Fixed by
      bumping the same ref on unmount that `stop()` already bumps on a
      second click - the identical stale-continuation guard, just
      triggered by navigation instead of a click
      (`WakeWordToggle.test.tsx`'s new test fakes just enough of the Web
      Audio surface - `AudioContext`, `AudioWorkletNode` - to let
      `startMicCapture()` actually reach its success path in a test,
      resolves a controlled `getUserMedia` promise *after* unmounting,
      and confirms the mic track's `stop()` still gets called). (2)
      `wake-word-models.ts`'s `registerWakeWordModels()` - ported
      verbatim from legacy - kept a parallel `ENTRIES` array beside the
      `REGISTRY` map that only ever grew, never updated in place:
      re-registering an id already present updated the map but left
      `listWakeWordModels()` returning the old, stale object for that id
      forever. Fixed by deleting the second copy of the state entirely -
      the map is now the only source of truth, `listWakeWordModels()`
      just reads `[...REGISTRY.values()]`
      (`wake-word-models.test.ts`'s two new tests, confirmed to fail
      against the original dual-state version).
    - **Live-verified up to a real, expected boundary**: clicking the new
      "Wake word (experimental)" toggle in a real running browser
      correctly reaches `navigator.mediaDevices.getUserMedia` and
      triggers a genuine native microphone-permission prompt
      (`navigator.permissions.query({name:"microphone"})` confirmed state
      `"prompt"`, not an error) - proving the wiring is real, not stubbed.
      Automated browser tooling has no way to click a native OS-level
      permission dialog (nor should it - that gate is deliberately
      human-controlled), so the actual "inference runs on real captured
      audio" step needs a person to click Allow once in a real browser;
      untested past that specific point in this session.
    - **Still not built**: everything past phase 1 in the wake-word plan
      above - a MaiPai-trained "hey maipai" detector (needs the ported
      training-pipeline logic from `bot-legacy.git`, phase 2), and the
      hard real-microphone validation gate before any custom model ships
      (phase 3, blocked on real household recordings). The toggle also
      does nothing with a detection yet beyond a demo banner - no STT
      exists anywhere in this codebase to act on what was heard.

- [x] **The full community voice catalog: item 3 of the Pocket TTS
      follow-ups, closed (2026-09-04).** Every real file in
      `kyutai/tts-voices`, not just the 26 built-in presets `tts.voice_id`
      already offered - confirmed live via HF's own cursor-paginated tree
      API: 2,069 real voice files (`.wav`/`.mp3`/`.safetensors`) across 3
      pages, grouped into 6 collections (vctk, expresso, ears,
      alba-mackenna, cml-tts, unmute-prod-website). Never downloads any
      audio itself - only the file listing, cached in memory for an hour
      (`lib/voiceCatalog.ts`); Pocket TTS's own server resolves and
      caches the real `hf://` file the same way it already does for the
      26 bundled presets.
    - **A deliberate, narrow escape hatch around `tts.voice_id`'s own
      `select` validation, not a widening of it.** The setting stays a
      normal, fully-validated `basic` key for the common case (the
      generic settings dropdown still only ever offers the 26 curated
      names) - `writeValue()` gained an internal `skipValidation` option,
      used by exactly one new function
      (`setPersonTtsVoiceUnchecked()`), whose only caller
      (`POST /api/voice/catalog/select`) validates the picked path
      against the REAL, live-fetched catalog before ever calling it. The
      same generic PUT route still rejects the identical value outright -
      proven by a dedicated test, so the bypass can't silently widen into
      a general one by accident later.
    - **Real security consideration, not an afterthought**: Pocket TTS's
      actual `/tts` endpoint accepts any `http://`/`https://`/`hf://` URL
      for `voice_url` and would fetch whatever it's given - exactly why
      `tts.voice_id`'s own registry entry stays restricted to the 26
      names for the generic route. The catalog select endpoint closes
      the same gap a different way: never trusting a client-supplied
      path directly, always checking it against the real catalog first
      (`isVoiceCatalogPath()`) - confirmed live to reject a fabricated
      path (a code review-style test proven to fail if that check is
      ever removed).
    - **A real UX tradeoff, made deliberately**: picking a catalog voice
      doesn't show up in the generic "Speaking voice" dropdown afterward
      (Radix Select shows its placeholder for a value outside its known
      options, not a crash) - the new "More voices" section shows the
      current value itself instead ("Currently using a catalog voice:
      ..."), so a pick never looks like it silently did nothing. No audio
      preview: 2,069 files makes browse-by-listening impractical for a
      v1, so a household picks by filename/collection and hears the
      result once they next get a reply spoken.
    - **Verified live against the real network, not just the test
      fixture**: the settings page's "Browse the full community voice
      catalog" section, searching "expresso," and "Use this voice"
      against the actual running `kyutai/tts-voices` catalog - real
      filenames returned (`ex01-ex02_default_001_channel1_168s.wav` and
      its sibling `.safetensors` embedding), the pick persisted to the
      real household database
      (`person:<jesse's id> | tts.voice_id |
      "hf://kyutai/tts-voices/expresso/ex01-ex02_default_001_channel1_168s.wav"
      | user`), zero console errors.
    - **Still not built**: audio preview before picking. The other
      remaining Pocket TTS follow-up (voice cloning/training) needed a
      real credential first - see the entry right below, and the actual
      cloning feature (spawning `pocket-tts export-voice`, recording/
      uploading a sample) is still separately not built past that.

- [x] **Reversible secret storage, for real: `lib/secrets.ts`
      (AES-256-GCM), and the household's first real credential
      (2026-09-04).** `.github/CLAUDE.md`'s own named module
      ("`lib/secrets`: AES-256-GCM, key in `data/keys` or `SECRETS_KEY`")
      didn't exist anywhere in this rebuild until now - only `lib/secret.ts`,
      the one-way PIN/password hasher, did. Ported from `home-legacy.git`'s
      own `lib/secrets.ts` (hard-won crypto logic, reused). Unblocks the
      last open Pocket TTS follow-up: voice cloning needs the gated
      `kyutai/pocket-tts` checkpoint, which the default model this hub
      actually runs never grew - the gate turned out to be auto-approved
      on accepting Kyutai's terms (confirmed live: `gated: "auto"`, not a
      manual review queue), so a household can unblock it themselves with
      their own free HF account. This slice is that credential, not the
      cloning feature itself (still not built - a separate, later piece
      of work: spawning `pocket-tts export-voice`, recording or uploading
      a sample, managing the resulting cloned voices).
    - **A real, previously undetected gap closed at the same time**: the
      settings registry's `secret: true` flag already redacted a value
      from every API response (`resolveForResponse()`, an earlier
      session), but nothing actually encrypted it at rest - a
      `secret: true` key's real value went straight into
      `settings_values` as plain JSON, an unenforced half of
      `.github/CLAUDE.md`'s own rule ("never plaintext in a table").
      `writeValue()`/`resolveStoredValue()`/`listValues()` now route
      every read and write through `encodeForStorage()`/
      `decodeStoredRow()`, which encrypt/decrypt the SERIALIZED JSON text
      (not just string values) whenever `keyDef.secret` is true - so any
      value type round-trips identically whether or not a key is secret,
      and `getHouseholdSettingValue()`/`getPersonSettingValue()`
      transparently decrypt for the internal callers that genuinely need
      the real value.
    - **The new key**: `voice.hf_token` (household scope, `secret: true`,
      `level: "advanced"`) - the registry's first real secret key,
      finally exercising the redaction path something actually needed
      rather than an untested guard. A dedicated paste-and-confirm UI
      (`HuggingFaceTokenSection.tsx`) - `SettingField.tsx`'s own comment
      already named this as the real way to change a secret key ("needs
      its own flow... that no key exercises yet"); the generic dropdown/
      status row was never going to grow a raw-text input for a bearer
      token.
    - **Verified live against the real household database, not just the
      test suite**: pasted a real-shaped fake token through the actual
      running Settings page, confirmed the real `hub.db` row is genuine
      ciphertext (`WUd8zTjWWsNfpaRH:eFtTp6Ensml5wo/w4L/8Ag==:...`, no
      trace of the plaintext), confirmed the generic
      `GET /api/settings?scope=household` response still returns
      `value: null, isSet: true` for it, and confirmed "Remove" deletes
      the row outright. A dedicated regression test
      (`the real database row is never the plaintext value`) was
      confirmed to fail against the pre-fix plain-JSON code before this
      landed.
    - **Still not built**: the voice-cloning feature itself (this is only
      the credential), and anything that would actually use this token
      today - nothing reads `voice.hf_token` yet beyond the settings
      store round-trip.
    - **Follow-up, same night: the token now actually reaches Pocket
      TTS.** Reading the installed `pocket-tts` package's own source
      (`tts_model.py`) found `has_voice_cloning` starts `True` and is
      only set `False` in the `except` branch of a failed weights
      download - the model always attempts the real, cloning-capable
      checkpoint first, and a household's own HF token (once they've
      accepted Kyutai's terms) is the only thing standing between the
      fallback and real cloning. `ttsSupervisor.ts`'s `spawnPocketTts()`
      now reads `voice.hf_token` and passes it as `HF_TOKEN` to the
      child process only, never persisted to a file or logged.
    - **A dedicated write/remove flow, not the generic settings route**:
      `POST /api/voice/hf-token` and `/api/voice/hf-token/remove`
      (`requireAuth`, owner/admin enforced by `setValue`/`resetValue`'s
      own `assertCanAccessScope` the same way the generic route already
      does) call the new `restartTtsBackend()` after a successful write -
      the same `chat.model_id`-bypasses-the-generic-route precedent
      (`routes/host.ts`'s `startSelectJob`), for the identical reason: an
      already-running `pocket-tts serve` process read this setting once,
      at spawn time, and a saved-but-unapplied token would otherwise do
      nothing until the process happened to restart some other way.
      `HuggingFaceTokenSection.tsx` now calls these instead of
      `setSetting`/`resetSetting`.
    - **A real bug caught live, not by the test suite first**: clicking
      Remove right after Save left a stale "Saved." message on screen
      (`handleRemove` never cleared the `success` flag `handleSubmit` had
      set). Found by driving the actual page, fixed, and a regression
      test (`removing right after a save clears the stale 'Saved.'
      message`) confirmed to fail against the pre-fix code before it
      landed.
    - Verified live end to end against the real household database: saved
      a real-shaped fake token, confirmed the `hub.db` row is genuine
      ciphertext, clicked Remove, confirmed the row is gone and the UI
      shows no stale state.
    - **Code review found a real race in the new `restartTtsBackend()`**:
      it cleared the cache but did nothing about a `startTtsBackend()`
      call already in flight (e.g. the household's first-ever TTS call
      spawning without a token, while a token save races in) - that
      spawn's own `.then()` would later re-install itself into
      `ttsBackend`, silently undoing the restart. Fixed with a
      `generation` counter: each spawn attempt captures the generation it
      started under and stops itself instead of caching if a restart
      bumped it first. Proven deterministically (`ttsSupervisor.test.ts`,
      "a spawn already in flight when a restart lands never re-populates
      the cache") via microtask ordering, no sleep needed - confirmed to
      fail against the pre-fix code. The identical race pre-exists in
      `llmSupervisor.ts`'s `restartChatBackend()` (same shape, copied from
      it); not fixed here (wider blast radius, out of scope for this
      slice) - filed as
      [getmaipai/home#11](https://github.com/getmaipai/home/issues/11).
    - The review also flagged a whitespace-only token passing validation
      (a truthy but blank string skips the empty check) - fixed by
      trimming first. And that the generic `PUT /api/settings` route can
      still technically write `voice.hf_token` directly, skipping
      `restartTtsBackend()` - left as a documented, accepted risk on the
      same terms `chat.model_id` already carries for the identical shape
      (`voiceKeys.ts`'s own comment): unreachable from the frontend
      (`SettingField.tsx` never renders an editable control for
      `secret: true`), and closing it generally needs a settings-key-level
      side-effect hook that doesn't exist yet.

- [x] Voice cloning itself, the feature `voice.hf_token` was built for:
      upload a real audio sample and use it as `tts.voice_id` the same
      way a preset or community-catalog voice works. No
      `pocket-tts export-voice` subprocess for v1: Pocket TTS's own
      model-level `@lru_cache` on `_cached_get_state_for_audio_prompt`
      already caches the computed audio-conditioning state per URL after
      first use, so storing the file and serving it at a stable local
      URL is sufficient - precomputing is a later optimization (faster
      reload), not a correctness requirement. File upload only, not live
      browser recording (explicitly scoped down for v1).
    - **Backend**: `db/schema.ts`'s new `cloned_voices` table (schema
      version 6, migration `0006_eager_sumo.sql`) - household-wide
      visibility, the same "anyone can select any voice regardless of
      who found it" shape the community catalog already has, not a
      per-person library. `lib/clonedVoices.ts` owns save/list/delete/
      lookup; `lib/id.ts`'s new `newClonedVoiceId()` is longer than this
      file's other ids (16 chars, ~83 bits) since it doubles as a bearer
      capability for the new unauthenticated `GET /api/voice/cloned/
      :id/file` route - `pocket-tts serve`, a separate unauthenticated
      process, has to fetch a voice by plain URL, so unguessable-but-
      checked-against-the-real-table is the whole safety story there,
      the same posture session tokens take for the identical problem.
      `lib/selfUrl.ts` is new too: the URL written into `tts.voice_id`
      on select has to point back at wherever THIS process is actually
      listening (`PORT`), not an assumed constant.
    - **Not backed up**: `paths.ts`'s new `clonedVoicesDir` is real,
      irreplaceable family data (unlike the wake-word models sharing its
      storage shape, which are re-downloadable), but `lib/backup.ts`'s
      `VACUUM INTO` only ever covered `hub.db` - a real, documented gap,
      not silently accepted.
    - **Frontend**: `ClonedVoicesSection.tsx` (upload form, household-
      wide list, "Use this voice"/"Delete"), ungated (any signed-in
      person can already choose their own `tts.voice_id`) - delete is
      gated per-item (creator or owner/admin) by the backend, not the
      section itself.
    - **A real bug caught live, not by the test suite first**: deleting
      a voice someone currently had selected left their `tts.voice_id`
      pointing at a URL that now 404s, with no obvious symptom until the
      next TTS call quietly failed. Found by driving the actual upload →
      select → delete flow in the browser and checking the real
      `settings_values` row afterward. Fixed in `deleteClonedVoice()`
      (a real delete of the matching `tts.voice_id` row, mirroring
      `resetValue()`'s own "no history to preserve" reasoning) and
      proven with two regression tests: one confirming the selecting
      person's setting resets, one confirming an unrelated person's own
      selection is untouched - both confirmed to fail against the
      pre-fix code.
    - Verified live end to end: uploaded a real WAV through the actual
      running Settings page, confirmed the real file and DB row, selected
      it and fetched the stored `tts.voice_id` URL directly with `curl`
      (no cookie, matching how `pocket-tts` would) to confirm it serves
      the identical bytes, confirmed a made-up id 404s, then deleted it
      and confirmed the file, the DB row, and the dangling setting are
      all really gone.
    - **Deliberately deferred**: `pocket-tts export-voice` precomputation
      (an optimization once real households have cloned voices to
      measure reload time against), live browser recording (upload-only
      for v1), and backing up `clonedVoicesDir`'s files (needs the
      broader "back up files under `data/`, not just `hub.db`" work
      already scoped for wake-word models too).
    - **A second code review pass, before the first commit, found seven
      more real issues**, all fixed:
      - The route buffered a whole upload into memory (`parseBody()` +
        `file.arrayBuffer()`) before `saveClonedVoice()`'s 20MB check
        ever ran, on a route with no role gate. Fixed with Hono's
        `bodyLimit` middleware (rejects from a `Content-Length` header
        up front, or counts a streamed body chunk by chunk otherwise -
        never buffers past the cap either way), proven with a real
        21MB upload that a mocked test could not have caught.
      - The dangling-`tts.voice_id`-cleanup this slice added compared
        the FULL stored URL against a freshly-computed one - silently
        stops matching if the hub restarts on a different `PORT`
        between select and delete. Fixed by matching on the id's own
        path segment (`/cloned/<id>/file`) instead of the whole URL,
        via a new `lib/settings.ts` export, `clearMatchingValues()`
        (a `LIKE` match, key + substring, no actor gate since the
        caller is cleaning up potentially many OTHER people's settings,
        not its own) - proven by selecting on one `PORT` and deleting
        on another.
      - `getClonedVoiceFile()` had no `existsSync` check, unlike
        `deleteClonedVoice()`'s own guard a few lines away: a row
        surviving without its file (a crash between the write and the
        insert, or manual cleanup) would pass a nonexistent path
        straight to `Bun.file()` instead of a clean 404.
      - `saveClonedVoice()`'s file write and DB insert were two
        independent steps with no cleanup on failure - a failed insert
        orphaned the file forever. Fixed: the file is deleted if the
        insert throws.
      - `deleteClonedVoice()` unlinked the file before deleting the DB
        row, with no `try`/`catch` - a locked or permission-denied file
        threw and left the voice fully listed and selectable even
        though the delete appeared to fail outright. Fixed by reordering
        (DB row first) and wrapping the unlink: the worst case is now a
        harmless orphan file (this directory already isn't backed up),
        never a voice stuck unable to be removed.
      - `ensureDir()` reimplemented `lib/backup.ts`'s own
        `ensureBackupDir()` pattern verbatim. Extracted to
        `lib/paths.ts`'s new `ensureDataDir()`, used by both now.
      - The raw `settingsValues` delete duplicated ownership of a table
        `lib/settings.ts` otherwise fully owns - closed by the
        `clearMatchingValues()` export above, which also fixed the
        `PORT` bug at the same time.

- [x] Backups' own real gap, closed: `pruneBackups()`'s own comment named
      "no size cap per target yet (2.5 asks for one): no settings key
      exists to declare it" - now one does. `backupKeys.ts`'s new
      `backup.max_total_gb` (household, `0` = no extra limit beyond the
      seven-daily/four-weekly/three-monthly tiers) is enforced AFTER
      those tiers, not instead of them: the tiers decide which backups
      are worth keeping at all (a spread across time), the cap then
      trims that set further, oldest first, if it's still too much disk.
      Binary GB (1024³), matching `formatBytes.ts`'s own reasoning. No
      frontend work needed - it's just another household-scope key, so
      the generic `SettingsRenderer` already renders it (confirmed live:
      saved `5` through the real running Settings page, watched the real
      `settings_values` row, ran a real backup to confirm nothing broke
      with the key present, then reset it back to `0`). Two regression
      tests (one confirming `0` changes nothing, one confirming a real
      cap trims oldest-first with real backup byte sizes) prove the
      mechanism, the second confirmed to fail against the pre-fix code.
    - **A second review pass found a real, dangerous edge case**: the
      cap had no floor - a value smaller than even the single newest
      backup (a typo'd GB-for-MB, or just a number under the current
      snapshot's size) would evict every kept backup, leaving zero
      restorable backups, and staying that way on every future scheduled
      run too. Fixed by never letting the cap prune the last remaining
      backup regardless of how far over the limit it is; a third
      regression test (a 1-byte cap against real backups) confirms at
      least one always survives, confirmed to fail against the pre-fix
      code.

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
      rest of 2.5 (a multi-store registry, `hub`/`smb` targets, the
      restore drill, an HTTP restore route - the size cap landed
      2026-09-04, see the Backups entry above).
- [ ] The shell and kit, Chat and Companions as packages, the wizard,
      self-update, updates (2.4, blocked on a real release existing to
      update to or from) - not started.
- [x] ~~README.md still needs the full org skeleton~~ - stale: the real
      README (logo, hero screenshot via `scripts/screenshot.ts`, features,
      getting started, status, the disclaimer block, license line) landed
      2026-09-04 (`f28145e`). This session's own features list was out of
      date with everything shipped since (Memory, Voice, Backups); updated
      in the same pass as this note. Still genuinely missing, not stale:
      the three-tier doc split (`user`/`dev`/`api`) - only `dev/` exists,
      so the README's doc link stays singular and honest about that until
      the others do.

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
| Chat catalog (`lib/catalog.ts`'s "abliterated" Llama 3.1 8B / Gemma 4 12B defaults, `lib/contentPolicy.ts`'s dial system) | Redesign (model choice); rebuild as designed (dial architecture) | The legacy catalog defaulted to refusal-stripped fine-tunes shipped as the recommendation. Conflicts with the new org's neutrality rule (ships neutral, unrestricted mode is a one-time adult opt-in, never the shipped default). Redesigned: `modelCatalog.ts`'s chat entry is a plain instruct model (Qwen3 8B); the dial system's actual architecture (per-profile clamped dials, an `IRREDUCIBLE_CORE` floor never removable even at "unrestricted") is sound and matches the new safety layer already built - reuse the architecture, not the model recommendation. |
| Image/video model stack (`docs/models.md`'s Juggernaut XL Ragnarok, IP-Adapter FaceID Plus v2, AnimateDiff XL, Stable Video Diffusion XT) | Redesign (checkpoints); rebuild as designed (pipeline shape) | Researched against 2026 alternatives (2026-09-04, two research passes) rather than carried forward on the "it worked before" assumption Jesse explicitly asked to check. Base image checkpoint and video model are superseded for 8GB-class cards: FLUX.2 [klein] 4B (sharper, purpose-built for 8GB, real and growing LoRA ecosystem) and Wan 2.2 TI2V-5B FP8 (720p on 8GB, active LoRA community) are the current picks, recorded in `modelCatalog.ts` alongside Juggernaut XL (kept as the largest-LoRA-library alternative, a real tradeoff put to the wizard rather than decided for the household). IP-Adapter FaceID and ComfyUI itself: no supersession found, kept as-is. `csamGuard.ts`'s hard floor (screenPrompt/screenImage, non-bypassable by the uncensored-consent flag): kept exactly, matches the new org's non-removable child-safety rule already. |

## Roadmap

See platform plan chapter 13. Order: Hub v0.1 ("the family can chat"),
Hub v0.2 ("media and the store"), Hub v0.3 ("voice, devices, the link"),
then Robot v0.1 once spec v0.1 exists, then Go once three default packages
have schema pages.

## Notes for later

Not actionable yet; captured here so the reason for a choice isn't lost
between now and when the relevant piece gets built.

- **TTS candidates for the voice sidecar - superseded.** This note
  originally said no decision was made yet; one was, the same night
  (`docs/dev.md`'s TTS model decision entry: Kyutai Pocket TTS, live
  tested and picked over Kokoro-82M, Chatterbox Turbo/Nano, Dia-1.6B, and
  CSM-1B), and the `tts` role is now real end to end (the entry right
  after it). Kept here only so a future reader doesn't wonder whether an
  eval ever ran.

- **Three real Pocket TTS follow-ups, found by Jesse reading its actual
  capabilities more closely than this session's original research did
  (2026-09-04), each verified live before being queued here rather than
  assumed:**
  1. **Community, non-Python ports evaluated (2026-09-04) - keeping the
     `uvx pocket-tts serve` Python sidecar, not switching.** Real research
     against each of the 8 candidates the official repo lists (repo
     metadata, READMEs, contributor/commit history - not guessed):
     `pocket-tts-csharp` is disqualified outright (no license file at
     all - default all-rights-reserved, not AGPL-compatible or usable).
     The four browser/WASM ports (`LaurentMazare/xn`,
     `KevinAHM/pocket-tts-onnx-export`, the Candle fork, `jax-js`) are the
     wrong shape entirely for this decision - they run *inside a
     browser tab*, not as a backend sidecar our server spawns; relevant to
     the wake-word plan's own in-browser pattern above, not to this.
     `pocket-tts-mlx` doesn't solve the actual problem - still a Python
     package underneath, just swapping `torch` for `mlx`, no
     runtime-dependency win. `sherpa-onnx` (14.6k stars, 30+ contributors,
     genuinely the most mature option here) has no ready-made TTS HTTP
     server at all - its own `http_server.py` is for its speech
     *recognition* demo; adopting it means writing and maintaining a
     wrapper ourselves. `PocketTTS.cpp` is the most compelling candidate
     on paper (real cited numbers: 9.2x realtime, 30ms time-to-first-audio
     on a Ryzen 7 3800X, beating the official server's own ~200ms TTFB /
     ~6x RTF) but is a single-maintainer, five-commit-total repo - too
     thin a track record to bet a shipped feature's backend on, and its
     API isn't a drop-in either (JSON body vs. our multipart form, raw
     PCM vs. a WAV header, local `.wav` files vs. HF-name-resolved
     voices - our 26-preset catalog would need pre-downloading and
     re-hosting). **Verdict: no candidate is clearly better than the
     status quo today.** Revisit triggered by either `PocketTTS.cpp`
     gaining real community traction, or the Python/`uv` runtime
     dependency causing an actual field failure (not a hypothetical one) -
     a documented, deliberate "not yet," not a silent gap.
  2. **Voice cloning already works today, verified live** (not
     hypothetical): `uvx pocket-tts export-voice <audio> <out>.safetensors`
     converts a reference clip into a reusable voice - tested against a
     real sample of Jesse's own voice, real success, ~3 seconds. The
     catch, also verified rather than assumed: cloning needs the
     `kyutai/pocket-tts` checkpoint, which really is HF-gated
     (`gated: "auto"`, confirmed via a clean unauthenticated call to HF's
     own API) - the default `kyutai/pocket-tts-without-voice-cloning`
     model `ttsSupervisor.ts` actually runs is not gated, and never grew
     cloning ability. **The distribution gap this named is now half
     closed (2026-09-04)**: `gated: "auto"` means auto-approval on
     accepting terms, not a manual review queue, so a household can
     unblock it with their own free HF account - `voice.hf_token`
     (this file's own shipped entry above) is that credential, real,
     encrypted at rest, settable through a real UI today. What's still
     missing is the cloning FEATURE itself: nothing yet spawns
     `export-voice`, records or accepts an uploaded sample, or manages
     the resulting cloned voices. The official repo also carries a real
     `training/` directory (actual fine-tuning, not just cloning), with
     community-trained non-English variants (Czech, Hindi, Korean) as
     existing examples - a further, larger follow-up past cloning if
     MaiPai ever wants its own trained voice rather than a cloned one.
  3. **A real, ungated community voice catalog exists - fully closed
     (2026-09-04).** `kyutai/tts-voices` on Hugging Face (confirmed via
     the API: `gated: false`) is a public repository of community and
     official voices, separate from the gated cloning checkpoint. The
     26-name subset Pocket TTS bundles as built-in presets (its own
     `_ORIGINS_OF_PREDEFINED_VOICES`, every one of them a file from this
     same repo) shipped first as a real, per-person choice
     (`tts.voice_id`); the full browser against all 2,069 real files in
     the repo shipped the same night (the entry below), so this item is
     done, not just started.
  A real credential-hygiene gap surfaced while verifying item 2: Jesse's
  own HF read token (shared in chat earlier this session for the gated
  checkpoint download, `docs/dev.md`'s TTS decision entry) is still
  cached at `~/.cache/huggingface/token` on this Mac - not a scratch file
  this session created and cleaned up, but a persistent credential store
  the `huggingface_hub` library wrote to on its own the first time the
  token was used. Left in place since the household is actively working
  with gated Kyutai resources (items 1-2 above need it again); flagged
  here rather than silently left for the same reason every other
  credential note in this session was: the org's own hard rule (`.github/
  CLAUDE.md` > Credentials and secrets) treats an unflagged lingering
  credential as the failure mode, not just an unrotated one.

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
  **Three plan amendments, Jesse, 2026-09-04, now written into 4.5 and
  4.11 and standing on top of everything above.** Prompted by "what
  router are we planning, and is it the best option, since a regex router
  is fragile." The answer: the plan was never a regex router; tier 0
  patterns are a fast path for exact commands, and the piece that answers
  a multi-skill utterance is tier 2. The amendments: (1) tier 1's
  embedding match is also the *tool pre-filter* for tier 2, so the model
  is offered only the top few candidate packages by similarity, which is
  what keeps the prompt small and pattern collision bounded once the
  catalog exists; (2) the `router` model role is optional per device: the
  hub routes with the `chat` model in non-thinking mode in the same
  cached process by default, and a dedicated small tool-calling model
  (the legacy `granite4.1:3b`/`qwen3.5:4b` shape above, re-picked from
  the Berkeley Function Calling Leaderboard when needed) loads only where
  measurement says the chat model is too slow, the robot's likely case;
  (3) a routing eval set becomes a permanent test in the shape of
  `spec/safety/corpus/`: utterance, expected skill or none, expected
  arguments, multi-skill combinations, and near-misses that must not
  fire, with every routing miss seen in the house added as a row before
  it is fixed. Two independent skills in one utterance ("weather and
  showtimes") are one model response with two parallel calls, inside the
  one-or-two-calls cap above; chained composition stays a recipe. Nothing
  here changes the order: `embed` first, real skills, count
  fall-throughs, then decide on tier 2 from the eval number.

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

- **Wake word, pulled forward from Hub v0.3 - the concrete plan
  (2026-09-04).** Jesse: "we need to build out wake word with training.
  We need to research best into use and review training learnings and
  implantation of old project. Our custom wake word accuracy of the old
  project was poor." Same pattern as the `tts` role above (built ahead of
  Hub v0.3's own sequencing because Jesse asked, not because the plan's
  order arrived) - only the *plan* is written here; the build itself
  hasn't started. This is HOME's own browser-side wakeword chat mode (the
  entry above already named it: "wakeword and continual chat need voice
  *input*... which does not exist anywhere in this codebase yet"), not
  the robot's on-device system - `bot` already has a bench-proven wake
  word pipeline of its own (a separate product, separate hardware, out of
  scope here).
  - **Engine: openWakeWord, not microWakeWord or Porcupine - already the
    right call, just reconfirmed.** The wake-word findings note right
    above already recorded this as the pre-rebuild robot's shipped
    choice, deployable client-side via `onnxruntime-web` WASM - exactly
    the browser-only runtime this feature needs, no server round trip.
    microWakeWord targets TFLite-micro on constrained embedded hardware
    (Home Assistant's own pick for that reason), which isn't the target
    here: a browser tab has no TFLite-micro runtime and orders of
    magnitude more compute than an embedded satellite. Porcupine is
    commercial (ruled out, `.github/CLAUDE.md`'s licensing stance).
  - **The old recall/false-accept numbers (83%/67%, 44/22 FA per hour)
    are explicitly not to be trusted or reused** - the note above already
    flags that the training-data and validation gaps the 2026-08-31
    incident uncovered (missing augmentation packs, synthetic-only
    validation, no near-miss negatives) may have already been present
    when those numbers were measured. Nothing from that eval carries over
    except the mechanism (openWakeWord + WASM) and the calibration
    starting points (0.47 threshold, 2-frame hysteresis) as hypotheses to
    re-measure, never as settled values.
  - **Every rule in `.github/CLAUDE.md` > "Training models (wake words,
    and anything like them)" is a hard gate on this work, not guidance**
    - that section exists *because of* a shipped "Hey MaiPai" detector
    from this exact lineage failing in exactly this way (0.955 on its own
    phrase, 0.979 on "hey my bike"). Concretely: verify every training
    data pack actually landed before a run starts (no best-effort silent
    skip); validate the shipped model against real human speech through a
    real microphone, never only synthetic; train negatives against actual
    near-miss confusions, not just unrelated phrases; harvest real
    household false-triggers as the highest-value negative data there is;
    never let unverified/unconfirmed audio become training data; retrain
    everything trained the same way if a data-level fault is found in one
    model.
  - **The one real gap the legacy pipeline never closed, and the one this
    plan exists to close**: every validation pass was 100% synthetic TTS
    voices, never a real microphone. Pocket TTS's own range (26 voices,
    multiple languages, real emotional presets) makes the *training* set
    broad and cheap - covered in the Pocket TTS follow-ups note below,
    genuinely useful there - but does not close this gap on its own
    (Jesse asked directly this session why varied TTS training, plus
    negatives, wasn't good enough - the answer given, summarized here for
    the same reason every other decision in this file is): synthetic
    audio, however varied, is a closed loop with training (evaluating on
    the same class of generator that made the training set measures
    fitting that generator, not generalization), has its own acoustic
    fingerprint no real microphone/room/device introduces, and cannot
    surface confusions nobody scripted. The validation set - the number
    that decides whether a model ships - has
    to be real recorded speech, held out, never synthesized.
  - **What this needs from Jesse that cannot be fabricated in a session**:
    real recorded "Hey MaiPai" utterances from actual household voices
    (adults and kids both - kids specifically are a gap no voice-cloning
    catalog covers), through a real browser microphone, in real rooms,
    for both training augmentation and the held-out validation set; and,
    once anything real is deployed even informally, a path to harvest
    real false triggers from real usage for the retrain loop. Nothing
    past the infrastructure phase below can respect the hard gates above
    without this.
  - **Concrete phases, narrowest first:**
    1. **Infrastructure proof, no custom model yet.** Browser microphone
       capture (`getUserMedia`) feeding `onnxruntime-web` running an
       EXISTING, already-trained openWakeWord stock model (e.g. one of
       its published "hey jarvis"/"hey mycroft"-style detectors) end to
       end: mic -> mel-spectrogram/embedding -> detector -> a real wake
       event that flips the chat page into listening. Proves the
       mechanism this codebase has never had at all (no mic-capture code
       exists anywhere in `home` today), with zero training-data risk
       since nothing is trained yet - the wrong wake phrase, on purpose,
       is an acceptable placeholder the same way the `tts` role's
       "voice_id" default was a real, working thing before per-person
       choice existed.
    2. **Port the training pipeline, not rebuild it.** `bot-legacy.git`'s
       already-fixed pipeline (post-2026-08-31: pack verification,
       real-noise augmentation, a near-miss phrase bank, the harvest-and-
       retrain loop) is hard-won logic - `.github/CLAUDE.md`'s own rule
       for "copy from legacy" applies directly. Adapted, not copied
       verbatim: this pass's synthetic half can lean on Pocket TTS's
       voice/language/emotion range (queued in the Pocket TTS follow-ups
       note) for broader, cheaper training coverage than whatever the
       legacy pipeline used, provided the near-miss bank and real-noise
       packs still get generated with equal or greater care - broader
       voices does not substitute for either.
    3. **The hard gate: real-microphone validation, before any custom
       model ships**, per the rule above - this is where Jesse's real
       recordings are required, not optional. No detector reaches even an
       opt-in "try it" state in the UI without a validation pass against
       real audio a household member actually spoke.
    4. **Calibrate for THIS runtime specifically.** The legacy 0.47
       threshold / 2-frame hysteresis was tuned for a different pipeline
       version on different hardware; re-measure fresh against this
       browser runtime's real mic input and real household audio, not
       copied forward as a default.
  - **Explicitly out of scope for this plan**: server-side/Wyoming
    deployment (satellite/headless use - robot-adjacent, `bot`'s own
    territory), the rest of the voice sidecar this note's neighbor above
    covers (STT, the wake-to-STT pre-roll gap, endpointing - Hub v0.3
    scope, unchanged), and continual-chat mode (the other still-stubbed
    chat mode, which needs always-on STT rather than a wake detector and
    is a separate, later piece of work).

- **Speech, slot filling and the vector store: three decisions taken
  2026-09-04**, after reviewing a suggested library list (a third-party
  shopping list of roughly a hundred Python packages for a home hub and
  a robot) against what is actually built here. None of it is actionable
  yet: the voice sidecar is Hub v0.3 (4.11) and the `embed` role does not
  exist.
  Recorded so a future session does not re-derive the same three answers,
  and does not re-shop the same list.
  The list's own thesis, that deterministic text work belongs in a library
  rather than in a prompt asking a small model to spell out numbers
  reliably, is already `.github/CLAUDE.md` principle 6 word for word.
  Nothing below is a new principle; it is where that principle lands in
  this codebase. The framing the list proposes, a new `normalization/`
  layer before and after the model, is the one thing to reject: this
  architecture already has both seams, the deterministic skill floor
  before (`lib/turnEngine.ts`) and `reply.speech` after
  (`spec/schemas/result.schema.json`), and adding a third layer beside two
  that exist is the second copy principle 1 rejects.
  **The structural constraint the list ignores, and the reason each answer
  below is what it is:** the hub is Bun and TypeScript, the robot is
  Python (`STACK.md`), and the package runtime is Deno on the hub with the
  Python SDK on the robot. So almost every Python-only library on that list
  has to answer which of three runtimes it lives in, and the answer sets
  its real price. In the voice sidecar it costs one implementation shared
  by both products. In the turn engine it costs two implementations plus
  the conformance discipline `spec/interpreters/{ts,py}` already carries.
  Backing a catalog package it costs correctness outright: a Python-only
  library structurally cannot back a package declaring
  `platforms: ["home", "bot"]`, which is worth writing into
  `docs/PACKAGES.md` before an outside contributor discovers it the hard
  way.

  **1. Speech normalization lives in the voice sidecar and fills
  `reply.speech` centrally, never per recipe.** Today
  `spec/interpreters/ts/recipe-interpreter.ts`'s `format` step defaults
  `speech` to the screen string verbatim, so a package author who wants
  "CPU usage is eighty-three percent" instead of "CPU is at 83%" has to
  hand-write a second template, in every package, forever. That is one
  definition in two places multiplied by the whole catalog, exactly what
  principle 4 exists to prevent. The normalizer belongs at the TTS
  boundary in `spec/voice/` (Python, one implementation, and the robot's
  speech stack is Python already), doing numbers, ordinals, plurals,
  units, dates, currency, abbreviations, emoji and sentence splitting
  before streaming. Three rules go with it. It runs last, on the way to
  TTS only: it never touches `reply.text`, never touches what
  `lib/conversationHistory.ts` logs, and never runs before
  `evaluateSafety`. It is a renderer, so a package opts out by supplying
  its own `speech` string, never by asking the model to format. And the
  pronunciation problem is narrower than the list suggests: Piper and
  Kokoro phonemize internally, so what is actually needed is a small
  lexicon of overrides for names the models get wrong, starting with
  "MaiPai" itself, not a phonemization stage duplicating theirs.
  This is also where issue #6's "round before injection" item belongs
  (unrounded values parroted into speech as "68.9F"): same class of
  problem, same layer, and the spoken-register style policy it sits under
  cannot fix what the data hands it.

  **2. Slot types are declared in the manifest, extracted by shared code,
  and land below tier 2.** The tier 2 note above names the gap precisely:
  `deterministicArgs()` binds exactly two shapes, no required args or one
  required string arg, so "any mail from grandma this week" structurally
  cannot bind no matter how good the pattern is. Deterministic slot
  filling closes that without a model and without the autonomous loop
  chapter 4.5 does not want: a datetime, duration, quantity, number,
  person or device parsed out of the utterance and bound to a declared
  arg. The design constraint is that slots are **declared, not coded**: a
  `routing.slots` block in the manifest mapping an arg name to a slot
  type, the same shape `routing.patterns` and the settings registry
  already have, with one shared extractor drawing from the declaration. A
  hand-written extractor per package is the anti-pattern this note exists
  to prevent. Library-wise the robot side is the list's `dateparser`,
  `word2number`, `quantulum3`, `pint` and `RapidFuzz`; the hub side is
  `chrono-node` and `uFuzzy` or `fuse.js`. Every one of those licences
  gets confirmed AGPL-compatible at adoption, not assumed here. This is
  the two-implementation case, so it is spec-first with a normative
  fixture corpus and a conformance test, priced that way before anyone
  starts. Sequencing is unchanged: build `embed` first, ship real skills,
  count fall-throughs from `lib/conversationHistory.ts`, and let the
  measured miss rate decide how much of this is worth building.
  Separately and much cheaper, fuzzy matching belongs in `recall()`'s
  entity pass (`lib/memory.ts`), which already does tokenized name
  matching through `lib/text.ts`. Typos and mishearings ("living rom lite")
  are a real household failure mode, and this improves the entity-first
  half that survives embeddings landing rather than competing with it.

  **3. The vector store is `sqlite-vec` or brute force, never a second
  index.** When the `embed` role lands, vectors go in `hub.db` beside the
  memory records: one store to back up (`lib/backup.ts`), one to sync to
  the robot, one transaction boundary. FAISS or hnswlib is a second index
  that has to be kept consistent with SQLite by hand, which is the second
  copy principle 1 rejects, and neither earns its keep at household scale.
  Measure before adding the dependency at all: brute-force cosine over a
  few thousand memory rows is single-digit milliseconds, and 4.4's own
  recall path is already scoped and filtered before ranking. If
  `sqlite-vec` does land, it is a loadable extension binary, so the
  pinned-URL-and-checksum rule applies and it stays core-only: packages
  use `node:sqlite` with no FFI per `STACK.md`, so nothing in the sandbox
  can reach it.

  **What that review found already covered, so nobody re-shops it.** The
  voice stack (openWakeWord, Moonshine, Piper, speaker ID via sherpa
  CAM++) is the pre-rebuild robot's shipped choice, recorded above.
  Software echo cancellation and noise suppression are answered by the
  XVF3800 doing it in hardware, which is also why the 3.5mm-analog speaker
  requirement above is not negotiable. OCR is RapidOCR rather than
  PaddleOCR deliberately, because its models ship inside the wheel so the
  lockfile delivers them and nothing fetches at runtime; the same reasoning
  picked zxing-cpp for barcodes. Scheduling is `lib/scheduler.ts`, already
  durable and already spec-shaped so its records can sync, which an
  in-process job runner would not be. Device discovery and control is
  answered by Home Assistant being the integration path, which is a better
  answer than a dozen device libraries in core. `lib/hardware.ts` already
  covers machine stats.
  Two things worth taking from the vision half, neither of them a model:
  AprilTag is the standout for docking and location markers because it
  runs on CPU through OpenCV and costs the Hailo nothing, which matters
  given the one-model-exclusive-per-HAT constraint recorded in `bot`'s dev
  doc. And `parseWhen`'s `every:<n><m|h|d>` grammar, which its own comment
  already calls a placeholder, should become RRULE through `rrule.js` and
  `dateutil.rrule` rather than a grammar we invent, the moment routines
  need "every weekday at 7".
  One item from that review was real enough to file rather than record:
  Unicode confusables and zero-width characters walk past every detector
  in the safety floor, reproduced against the real code and written up as
  issue #10.

  **Two open items, both Jesse's call, neither blocking anything today.**
  Whether the two-implementation cost of pre-model slot filling is worth
  paying at all, or whether the near-miss confirmation prompt already named
  in the tier 2 note above gets most of the value for a fraction of the
  work. And whether face recognition is in scope: InsightFace is the
  obvious library and its released model weights carry a non-commercial
  research restriction, which quietly forecloses the commercial licensing
  and sale that sole copyright ownership exists to keep open. Verify the
  actual model card before anyone builds on it. MediaPipe and OpenCV are
  clean either way.
