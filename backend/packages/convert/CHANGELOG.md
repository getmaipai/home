# Changelog

All notable changes to the Convert package, in [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format.

## [0.1.0] - 2026-09-06

### Added

- Converts between physical units (session-d-packages-and-store.md step 7),
  via the `compute` step's restricted evaluator (step 4), the same
  mechanism `math` uses. "5 miles to km" and "5 miles in km" both work;
  mathjs has no currency units, so currency conversion is a separate,
  not-yet-built package with a real exchange-rate lookup.
