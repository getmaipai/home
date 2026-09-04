# Changelog

All notable changes to MaiPai Home. Format follows
[Keep a Changelog](https://keepachangelog.com); versions follow semver.
Everything stays `0.x` until the product passes its battle-tested
checklist (`docs/dev.md`); no release has been cut yet.

## [Unreleased]

### Fixed
- A `code-review` pass (2026-09-04) across the identity, safety, and
  memory slices found and fixed real bugs, the most severe being a
  safety-invariant violation: `self_harm` co-occurring with another
  flagged category (e.g. a jailbreak framing wrapped around a genuine
  self-harm statement) silently withheld crisis resources instead of
  offering them. Also fixed: `csam` and `credible_threat` false-positives
  on ordinary text ("MCP", "Essex", gaming talk); a soft-deleted person's
  session and credentials still working; `X-Forwarded-Host`/`-Proto`
  trusted unconditionally (CSRF and cookie-security gaps matching a fix
  already applied to `X-Forwarded-For`); an owner/admin able to export or
  erase an adult's private memories despite being unable to browse them; a
  lost-update race in the sign-in lockout counter; a macOS Keychain
  failure mode that could silently corrupt every stored PIN/password. A
  second review pass on the fix diff itself, before committing, caught
  two regressions the first pass introduced (an over-broad CSAM
  false-positive fix, a dropped obfuscation-resistance check) plus four
  smaller gaps; all fixed in the same commit. Full list with fix-site
  details in `docs/dev.md`'s "Code review pass, 2026-09-04" section.

### Added
- Memory (platform plan 4.4), the third slice of hub core: the store
  (`backend/src/lib/memory.ts`), built directly on the `MemoryRecord`
  shape spec v0.1 already defined, no spec changes needed. `remember`
  validates against the generated Zod schema before writing; `list`
  browses without touching usage; `recall` scores by entity-first-then-
  keyword-overlap (a documented deterministic stand-in for real
  embedding-based "scored vectors", which need the embed role, 4.11) and
  does touch usage; `supersede` and `archive` are the routine tombstoning
  lifecycle (a real status transition, never a row delete); `forget` and
  `exportPerson` are the per-person privacy pair (2.2), and `forget` is
  the one real DELETE in the file, a deliberate exception to "never
  hard-deletes" for the deliberate erasure right. `runMaintenance`'s decay
  scoring is adapted from the legacy hub's tuned exponential-decay
  formula (principle 8); durable memories are protected from decay, a
  `state`-category memory always expires after 7 days, and unlike the
  legacy source this pass never hard-deletes a tombstone, since platform
  plan 4.4 says the store never does outside `forget()`. Visibility rules:
  household memories to any signed-in person (sensitive ones admin/owner-
  only), a person's own `scope: person` memories, plus a child's (not a
  teen's or an adult's) to owner/admin; `scope: self` is never returned to
  anyone, per the schema's own description. Deferred: the sleep-time judge
  itself, profile paragraphs, and real embedding-based recall (all need an
  LLM and/or embedder that don't exist yet), mood/unfinished-business
  reads (robot-specific), and real scheduled maintenance (4.7).
- The safety layer (platform plan 4.3), the second slice of hub core: a
  deterministic multi-signal classifier for the eight floor categories
  (self-harm, harmful requests, credible threats, CSAM, grooming, PII
  extraction, prompt injection, jailbreak framing), text only. Design and
  code live in `spec/safety/` so a Python port can mirror it later the way
  `spec/interpreters/` does; TS only for now, no `bot` content exists yet
  to pin it. New shared shape `SafetyResult` (dual-codegen'd), a labelled
  corpus (`spec/safety/corpus/corpus.json`, synthetic and persona-roster
  only), and `spec/safety/README.md` as the full design record including
  known limitations. The CSAM detector is adapted from the legacy hub's
  hardened, obfuscation-resistant blocklist (principle 8); the legacy
  hub's model-trusting "text floor" is explicitly not reused, since 4.3
  replaces exactly that architecture with a pre-model refusal. Hub-side:
  `backend/src/lib/safety.ts` applies the per-band policy (self-harm never
  refuses, only offers resources; every other category refuses; a minor
  speaker always sets `notify_parent`), `POST /api/safety/check` is the
  real caller until the turn engine (4.5) exists to call it internally.
- Hub backend skeleton (`backend/`, Bun and Hono, per `STACK.md`): a Bun
  workspace root joins it to `spec/`, so both share one lockfile and the
  backend imports `home/spec/`'s generated Person schema directly.
- Identity and sign-in (platform plan 4.1) and people (4.2), the first
  slice of hub core (chapter 4): profiles with a PIN or password
  (Argon2id via `Bun.password`, HMAC-peppered, the pepper held outside the
  database by a keystore that uses the macOS Keychain, Windows DPAPI, or a
  0600 key file), per-profile lockout with exponential backoff plus a
  per-IP throttle, `HttpOnly`/`SameSite=Strict` session cookies with a CSRF
  origin check, the role ladder (owner, admin, adult, teen, child, guest)
  enforced on every mutating route, and first-run setup that creates the
  household owner. SQLite storage via Drizzle ORM, with the schema-version
  guard `docs/ENGINEERING.md` requires (a database stamped newer than the
  running build refuses to open). Deferred to a later hub release:
  passkeys, TOTP, Quick Connect, device tokens, capability grants and
  content ceilings, the approval queue (all noted in `docs/dev.md`).
- `home/spec/` v0.1: the household's shared record shapes (Person,
  Setting, Memory/Entity/Episode, the package manifest, recipe, and
  result shapes), as JSON Schema with generated Zod and Pydantic v2
  bindings, both proven against fixtures. Both Tier 0 recipe interpreters
  and both host emulators, with recipe conformance fixtures proving the
  TS and Python interpreters agree. UI schema v0 for the Chat page.
- `scripts/check.sh` regenerates and drift-checks the spec codegen, runs
  its tests, then the backend's typecheck and tests, before the pinned
  `@maipai/standards` core.

### Changed
- This repo's history was reset to start fresh on the platform rebuild
  design (`docs/dev.md`); the prior version's history and 21 releases are
  preserved locally, outside GitHub, never migrated.
