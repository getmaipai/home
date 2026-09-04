# Changelog

All notable changes to MaiPai Home. Format follows
[Keep a Changelog](https://keepachangelog.com); versions follow semver.
Everything stays `0.x` until the product passes its battle-tested
checklist (`docs/dev.md`); no release has been cut yet.

## [Unreleased]

### Added
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
