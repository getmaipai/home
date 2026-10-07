# Changelog

All notable changes to the Define package, in [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format.

## [Unreleased]

### Changed

- The one-line description now says what the package does for the
  household, in one imperative sentence: it is the store-card line, the
  tool description the chat model sees, and the confirm prompt's own
  wording (getmaipai/home FAST-03).

- Two of three `routing.patterns` entries are gone: "what does \* mean"
  and "what's the definition of \*" (both open with a question word, so
  the hub's own commands node fired on any matching question and handed
  the remainder to this package before the model ever saw the words -
  getmaipai/home OPENER-01, dev.md "The knowledge hijack"). "define \*"
  stays: an imperative opener, the fixed part instructs the hub and the
  remainder is the word to define by definition, fired only on a
  directive turn. The two removed forms stay reachable as a model-chosen
  tool call and through this package's own `examples`.

## [0.1.0] - 2026-09-05

### Added

- A real dictionary definition for a word, via dictionaryapi.dev.
