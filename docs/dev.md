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
- [ ] Core, still to build: the turn engine, settings and its renderer,
      the scheduler, the package host, the llama-server router.
- [ ] The shell and kit, Chat and Companions as packages, the wizard,
      backups, self-update - not started.
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
