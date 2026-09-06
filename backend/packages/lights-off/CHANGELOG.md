# Changelog

All notable changes to the Lights Off package, in [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format.

## [0.1.0] - 2026-09-06

### Added

- Turns off a light through the household's own Home Assistant instance
  (session-d-packages-and-store.md step 9), via `home.call_service`
  (`light.turn_off`). `lights-on`'s own companion package; see its
  CHANGELOG for the `home_call_service_step` interpolation work both
  packages share.
