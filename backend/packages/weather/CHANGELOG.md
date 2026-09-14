# Changelog

All notable changes to the Weather package, in [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format.

## [Unreleased]

### Added

- Conditions ("rainy", "partly cloudy"), today's high and low, and the
  chance of rain, in the reply and as typed data beside it (`place`,
  `temperature`, `conditions`, `high`, `low`, `precipitation_chance`,
  `unit`), so "is it going to rain today" has an answer. Same
  Open-Meteo endpoint, so the privacy row is unchanged.

### Changed

- The one-line description now says what the package does for the
  household, in one imperative sentence: it is the store-card line, the
  tool description the chat model sees, and the confirm prompt's own
  wording (getmaipai/home FAST-03).

## [0.1.0] - 2026-09-05

### Added

- Current temperature for a named place, via Open-Meteo's free geocoding
  and forecast APIs.
- A cached, warmed answer for a recent place: `cache`/`warm` in the
  manifest, backed by the hub's package cache (session-d-packages-and-
  store.md step 3).
