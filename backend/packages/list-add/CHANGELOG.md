# Changelog

All notable changes to the Add to Shopping List package, in [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format.

## [0.1.0] - 2026-09-06

### Added

- Adds an item to the household's own shopping list
  (session-d-packages-and-store.md step 8), via the new `list_add`
  recipe step and `host.lists.add` (`lib/lists.ts`, the frozen D-to-E
  list contract, `docs/plans/wave-2.md`). One standing household
  shopping list, found or created on first use - `list-view` is the
  companion package that reads it back.
