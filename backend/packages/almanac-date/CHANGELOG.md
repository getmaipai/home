# Changelog

All notable changes to the Today's Date package, in [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format.

## [0.1.0] - 2026-09-06

### Added

- Today's date, spoken naturally (session-d-packages-and-store.md step
  7). One of the almanac's five small lookups - split from a single
  combined package into five, since `lib/turnEngine.ts`'s router only
  ever binds one required argument to one package call, and none of the
  five needed an argument at all. Pure local computation, no network.
