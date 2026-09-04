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
- [ ] Core, still to build: memory, the turn engine, settings and its
      renderer, the scheduler, the package host, the llama-server router.
- [ ] The shell and kit, Chat and Companions as packages, the wizard,
      backups, self-update - not started.
- [ ] README.md still needs the full org skeleton (logo, screenshot strip,
      status) once there is a running app to screenshot; today's README is
      a placeholder.

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

## Roadmap

See platform plan chapter 13. Order: Hub v0.1 ("the family can chat"),
Hub v0.2 ("media and the store"), Hub v0.3 ("voice, devices, the link"),
then Robot v0.1 once spec v0.1 exists, then Go once three default packages
have schema pages.
