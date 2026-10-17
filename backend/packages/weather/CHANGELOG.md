# Changelog

All notable changes to the Weather package, in [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format.

## [0.3.1] - 2026-10-17

- The Weather app says why it has nothing to show. With no place chosen it asks you to add a place or use your location (and explains how to allow location in Safari). If the weather source cannot be reached it says so and offers Try again, instead of one generic error. A saved place is used when Current location is the default and the browser shares no position.

## [0.1.2] - 2026-10-14

- Restores the weather answer blocks and records hourly background fetches in the privacy details.

## [Unreleased]

### Fixed

- A follow-up such as "will it rain tomorrow?" no longer fails when the place was named in the last reply (the place argument is grounded on the conversation).
- The daily forecast (dates, highs, lows, chance of rain) reaches the model, so "and tomorrow?" and "this weekend" are answered from data.

### Changed

- Asking for the weather with no place named, no default and no household home no longer fails. The answer says it does not know where you are and how to fix that.
- The hourly warm uses only the household home place, and its privacy row
  describes the background refresh.
- The manifest placeholder is replaced by Home before the hourly warm runs.

### Added

- The app asks to be pinned in Home's left rail for everyone who has not chosen their own pins (`pinned_by_default`, `pin_order` 10 in the
  index page entry). A person can unpin it from the All apps launcher.
- A person setting `weather.unit` (Fahrenheit by default, or Celsius). The recipe takes an optional `unit` input that Home injects
  for the signed-in person (never a model argument); chat answers and the Weather app both follow it. The hourly background refresh
  has no person and stays Fahrenheit.

- The package is now the Weather app (`contributes.pages`, `contributes.data`, `settings_area`): it opens at `/apps/weather` with the
  animated `weather_card` for the chosen place (hourly strip and 8-day outlook included) and a place picker that lists Current
  location first (asked of the browser only on that choice), then the household home, then the person's own saved places. The chat
  tool and the app are one package and one recipe; Open-Meteo stays the only outbound host.

- The package builds a single weather card (`weather_card`: current
  conditions with an icon code, the next 24 hours, an 8-day outlook,
  Open-Meteo attribution) from the forecast call. The call also asks
  for `is_day`, the hourly chance of rain, each day's condition code
  and 8 days, on the same two Open-Meteo hosts, so the privacy row is
  unchanged. The card is returned alone, in place of the conditions
  sheet, 24-hour chart and daily table; those three come back only when
  the card cannot be built (no current reading or no valid day row), so
  the two are never shown together.

- Answers now come with a card for the current conditions, a chart of
  the next 24 hours and a table of the next 7 days (GENUI-04). The same
  Open-Meteo forecast call carries the extra hours and days, so the
  privacy row is unchanged.

- Conditions ("rainy", "partly cloudy"), today's high and low, and the
  chance of rain, in the reply and as typed data beside it (`place`,
  `temperature`, `conditions`, `high`, `low`, `precipitation_chance`,
  `unit`), so "is it going to rain today" has an answer. Same
  Open-Meteo endpoint, so the privacy row is unchanged.

### Changed

- Weather uses the host's coordinates when it has them and looks up a place
  only when someone names one. This restores the optional place and coordinate
  inputs, saved weather places, current-place default and routing example that
  catalog sync `22830bd` had dropped.

- The one-line description now says what the package does for the
  household, in one imperative sentence: it is the store-card line, the
  tool description the chat model sees, and the confirm prompt's own
  wording (getmaipai/home FAST-03).

- All six `routing.patterns` entries are gone ("what's the weather in
  \*", "weather in \*", "how's the weather in \*", "what's the weather
  like in \*", "is it going to rain in \*", "will it rain in \*") - each
  opened with a question word, so the hub's own commands node fired on
  any matching question and handed the remainder to this package before
  the model ever saw the words (getmaipai/home OPENER-01, dev.md "The
  knowledge hijack"). This package stays reachable as a model-chosen
  tool call and through its own `examples`, never a blind pattern match
  on a question's opening words.

## [0.1.0] - 2026-09-05

### Added

- Current temperature for a named place, via Open-Meteo's free geocoding
  and forecast APIs.
- A cached, warmed answer for a recent place: `cache`/`warm` in the
  manifest, backed by the hub's package cache (session-d-packages-and-
  store.md step 3).
