# Changelog

All notable changes to the Currency package, in [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format.

## [0.1.0] - 2026-09-06

### Added

- Converts between currencies (session-d-packages-and-store.md step 7),
  via `api.frankfurter.dev`'s free exchange-rate API (European Central
  Bank reference rates) - no API key. `convert` (step 7, physical units)
  already owns the literal "convert *" pattern, and a pattern-match tie
  goes to whichever package sorts first by id, so this package answers
  to "exchange *" instead - documented in its own README rather than
  silently failing on "convert 5 dollars to euros".
