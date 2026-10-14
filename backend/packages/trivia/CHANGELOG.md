# Changelog

All notable changes to the Trivia package, in [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format.

## [Unreleased]

- Children use questions stored at home. Teens pass a safety check before
  an internet question is used. Adults and teens get a saved question if
  Open Trivia Database is unavailable.
- Open Trivia Database answers show the CC BY-SA 4.0 credit.
- Package version is 0.2.0.

### Changed

- The one-line description now says what the package does for the
  household, in one imperative sentence: it is the store-card line, the
  tool description the chat model sees, and the confirm prompt's own
  wording (getmaipai/home FAST-03).

## [0.1.0] - 2026-09-05

### Added

- A random trivia question and its answer, via the Open Trivia Database.
