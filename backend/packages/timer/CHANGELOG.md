# Changelog

All notable changes to the Timers package, in [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format.

## [0.1.0] - 2026-09-06

### Added

- Sets a timer for a length of time (session-d-packages-and-store.md
  step 8), via the new `timer` recipe step and `host.timers.set`
  (`lib/reminderParsing.ts`'s own small deterministic duration parser -
  no chrono-node, no model, since a timer's whole point is exact
  minute-level accuracy). Schedules a "core" job the same way `remind`
  does; firing later raises the declared `timer.done` notification
  directly, a `passive` level per the plan's own text. No network, no
  model - `offline: full`.

## [Unreleased]

### Added

- ASSIST-REMIND-01: the alarm phrases (set, cancel, list) now run through
  this package; the separate `alarm` package is removed. The `alarm.due`
  notification type keeps its id and is declared here, and the package gains
  the `reminders:write` permission the alarm engine needs.
