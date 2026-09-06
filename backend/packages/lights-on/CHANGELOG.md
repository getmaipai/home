# Changelog

All notable changes to the Lights On package, in [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format.

## [0.1.0] - 2026-09-06

### Added

- Turns on a light through the household's own Home Assistant instance
  (session-d-packages-and-store.md step 9), via `home.call_service`
  (`light.turn_on`). The captured room name reaches `target.area`
  dynamically - `recipe.schema.json`'s `home_call_service_step` gained
  real `{variable}` interpolation on `target`/`data` in this same
  commit (previously literal-only, like `goodnight-routine.json`'s own
  fixture); this package is the first real caller.
