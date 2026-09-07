# Changelog

All notable changes to the Convert package, in [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format.

## [0.1.0] - 2026-09-06

### Added

- Converts between physical units (session-d-packages-and-store.md step 7),
  via the `compute` step's restricted evaluator (step 4), the same
  mechanism `math` uses. "5 miles to km" and "5 miles in km" both work;
  mathjs has no currency units, so currency conversion is a separate
  `currency` package with a real exchange-rate lookup, triggered by
  "exchange" rather than "convert" (this package already owns that
  literal pattern, and a pattern-match tie goes to whichever package
  sorts first by id).
