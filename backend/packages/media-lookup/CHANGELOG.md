# Changelog

All notable changes to the Media Lookup package, in [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format.

## [Unreleased]

## [0.1.0] - 2026-09-13

### Added

- A film or TV show's director, cast (top three), runtime, rating, release
  year, and a plain-language synopsis, for a named title. Step 1 of the
  conversation program (getmaipai/home's `docs/plans/media-conversation-
  program-2026-09-13.md`): a typed evidence source for exact public
  facts, keyless, via Wikidata's own public API for the typed fields and
  Wikipedia's public REST summary API for the story. Title search filters
  Wikidata's results to the ones described as a film or a TV series
  (labels collide across every kind of thing on Wikidata) and prefers a
  result whose description names a given release year when one was
  spoken. A miss is reported as the typed `not_found` error (getmaipai/
  home#92's shape), not a spoken apology, the same as the knowledge
  package.
