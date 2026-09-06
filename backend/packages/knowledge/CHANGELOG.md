# Changelog

All notable changes to the Knowledge package, in [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format.

## [0.1.0] - 2026-09-06

### Added

- A general-knowledge answer for a named topic, via Wikipedia's free
  public REST summary API. The first Tier 1 package: runs in its own
  sandboxed Deno process (session-d-packages-and-store.md step 5), not
  the shared Tier 0 recipe interpreter. Offline Wikipedia through a
  local Kiwix ZIM is planned but not shipped this wave; every lookup
  needs the internet for now.
