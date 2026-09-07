# Changelog

All notable changes to the View Shopping List package, in [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format.

## [0.1.0] - 2026-09-06

### Added

- Reads back the household's own shopping list
  (session-d-packages-and-store.md step 8), via the new `list_view`
  recipe step and `host.lists.view` (`lib/lists.ts`). Reports only
  items not yet checked off; a plain "your shopping list is empty"
  when there's nothing left. `list-add` is the companion package that
  writes to it.

### Fixed

- A real false positive found while adding this step's own
  routing-corpus rows: "what's on my list" (bare, no "shopping") scored
  close enough to an existing must-not-collide row ("what's my address")
  under the deterministic stub-embedder test suite to route a completely
  unrelated question here. Dropped from `routing.patterns`/
  `routing.examples` in favor of the "shopping"-qualified phrasings, the
  same "revise the examples, add a permanent regression row" move
  `almanac-date`'s own routing examples took in step 7 for an identical
  class of collision.
