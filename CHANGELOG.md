# Changelog

All notable changes to MaiPai Home. Format follows
[Keep a Changelog](https://keepachangelog.com); versions follow semver.
Everything stays `0.x` until the product passes its battle-tested
checklist (`docs/dev.md`); no release has been cut yet.

## [Unreleased]

### Added
- `home/spec/` v0.1: the household's shared record shapes (Person,
  Setting, Memory/Entity/Episode, the package manifest, recipe, and
  result shapes), as JSON Schema with generated Zod and Pydantic v2
  bindings, both proven against fixtures. Both Tier 0 recipe interpreters
  and both host emulators, with recipe conformance fixtures proving the
  TS and Python interpreters agree. UI schema v0 for the Chat page.
- `scripts/check.sh` regenerates and drift-checks the spec codegen, then
  runs its tests, before the pinned `@maipai/standards` core.

### Changed
- This repo's history was reset to start fresh on the platform rebuild
  design (`docs/dev.md`); the prior version's history and 21 releases are
  preserved locally, outside GitHub, never migrated.
