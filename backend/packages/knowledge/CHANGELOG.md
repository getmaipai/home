# Changelog

All notable changes to the Knowledge package, in [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format.

## [Unreleased]

### Changed

- A page with no extract, a disambiguation page, or a summary the
  encyclopedia does not have (HTTP 404) is reported as the typed
  `not_found` error instead of being spoken as "I couldn't find a clear
  answer about X", and the host's own error code from `host/fetch` is
  passed through rather than relabeled `network_unreachable`. The hub
  treats a Tier 0 pattern winner's `not_found` as "no package answered"
  and lets its model answer from its own knowledge or the household's
  memory (getmaipai/home#92: "what is two plus two" and "what is Pippa
  allergic to" used to end in an apology).

- The one-line description now says what the package does for the
  household, in one imperative sentence: it is the store-card line, the
  tool description the chat model sees, and the confirm prompt's own
  wording (getmaipai/home FAST-03).

## [0.1.0] - 2026-09-06

### Added

- A general-knowledge answer for a named topic, via Wikipedia's free
  public REST summary API. The first Tier 1 package: runs in its own
  sandboxed Deno process (session-d-packages-and-store.md step 5), not
  the shared Tier 0 recipe interpreter. Offline Wikipedia through a
  local Kiwix ZIM is planned but not shipped this wave; every lookup
  needs the internet for now.
