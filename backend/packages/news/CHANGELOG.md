# Changelog

All notable changes to the News package, in [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format.

## [0.1.0] - 2026-09-06

### Added

- Top news headlines (session-d-packages-and-store.md step 7), from
  NPR's own public RSS feed (`feeds.npr.org`) - no API key, no per-topic
  personalization. Reads the top three headlines from the feed's `<item>`
  titles, cached 15 minutes via `host.fetch`'s own cache.

### Known gap

- The plan calls for "RSS from a household-chosen list" - this ships
  one fixed feed instead. A real per-household feed choice needs a
  settings key a Tier 1 package's sandboxed process can actually read
  (no such host method exists yet on any package), which is more
  platform work than this lookup's own bronze scope justifies inventing
  un-exercised. Deferred honestly rather than built speculatively.
