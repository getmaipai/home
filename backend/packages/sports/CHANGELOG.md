# Changelog

All notable changes to the Sports Scores package, in [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format.

## [0.1.0] - 2026-09-06

### Added

- Today's MLB scores (session-d-packages-and-store.md step 7), via
  `statsapi.mlb.com` - no API key. MLB only for now: no household
  sport/team preference setting exists yet, so this is honestly scoped
  to one league rather than guessing at a "your team" default. Reports
  only games that have started (`Live`/`Final`); a not-yet-started game
  is left out rather than shown as a false 0-0.
