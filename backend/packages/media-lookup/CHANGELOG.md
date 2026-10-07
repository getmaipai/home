# Changelog

All notable changes to the Media Lookup package, in [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format.

## [Unreleased]

### Changed

- All eight `routing.patterns` entries are gone (every one opened with a
  question word - "what's the runtime of \*", "who directed \*", "what
  is \* about", "is \* any good", "when did \* come out", "who's in \*",
  "what is \* rated", "tell me about the movie \*"). Each one let the
  hub's own commands node fire on any matching question and hand the
  remainder to this package before the model ever saw the words
  (getmaipai/home OPENER-01, dev.md "The knowledge hijack"). This
  package stays reachable as a model-chosen tool call and through its
  own `examples`, never a blind pattern match on a question's opening
  words.

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

### Added

- A bounded `data` projection for CHAT-16 with only the title, year, kind,
  director, runtime, rating, and source. Cast and Wikipedia synopsis remain
  outside the model-facing data projection.
