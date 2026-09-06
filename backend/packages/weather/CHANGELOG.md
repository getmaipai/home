# Changelog

All notable changes to the Weather package, in [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format.

## [0.1.0] - 2026-09-05

### Added

- Current temperature for a named place, via Open-Meteo's free geocoding
  and forecast APIs.
- A cached, warmed answer for a recent place: `cache`/`warm` in the
  manifest, backed by the hub's package cache (session-d-packages-and-
  store.md step 3).
