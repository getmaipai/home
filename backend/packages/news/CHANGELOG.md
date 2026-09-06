# Changelog

All notable changes to the News package, in [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format.

## [0.1.0] - 2026-09-06

### Added

- Top news headlines (session-d-packages-and-store.md step 7), from
  NPR's own public RSS feed (`feeds.npr.org`) - no API key, no per-topic
  personalization. Reads the top three headlines from the feed's `<item>`
  titles, cached 15 minutes via `host.fetch`'s own cache.
