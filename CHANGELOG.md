# Changelog

All notable changes to MaiPai Home. Format follows
[Keep a Changelog](https://keepachangelog.com); versions follow semver.
Everything stays `0.x` until the product passes its battle-tested
checklist (`docs/dev.md`); no release has been cut yet.

## [Unreleased]

### Added
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
