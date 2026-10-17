# Weather card in chat, then the Weather app (2026-10-16)

Owner's ask 2026-10-16: the chat weather answer should be a gradient card with an 8-day strip (like Claude's), and Weather should be a
dedicated app for the current location plus saved places, with animated conditions as the old hub had.

Owner's calls (wizard, 2026-10-16): the app waits for the package `app` kind (no shell page in between); animation is modern CSS plus
tokens, no vendored files; the chat card ships first.

## Slice 1: `weather_card` answer block (in flight)

- commons spec: new additive block kind `weather_card` (place, unit, current with WMO code and is_day, optional hourly, 1 to 8 daily rows, attribution).
- commons ui: one kit Element `weather-card`, drawn by the existing answer-block dispatcher. One WMO-code-to-condition table, gradients from tokens (light and dark), CSS-only rain, snow, cloud, star, fog and storm layers, `prefers-reduced-motion` honoured, a contrast test.
- Home: the `weather` package emits the block from its already-fetched Open-Meteo response (same two hosts, `forecast_days=8`); Home's only change is the pin bump (rule 9, no wrapper).
- Supersedes WEATHER-ICONS-01's amCharts download: the daily strip uses the kit icon set; nothing third-party is vendored.

## Slice 2: Weather app (waits for the `app` kind)

Reuses the Element for its hero, plus a places list: Current location first, the household home, then the person's saved places
(PLACE-HUB-01, PLACE-WEATHER-01, PLACE-ELEMENT-01b own storage, resolver and the settings list; no new place store). Pages are schema
data per the `app` kind decision in dev.md. Old reference only: loki-doki `WeatherPage.tsx`, `useWeatherLocations.ts`.
Privacy is unchanged: Open-Meteo is the one outbound host, coordinates rounded per PLACE-WEATHER-01, no one sees another person's places.

## Order

1. `weather_card` spec and Element (commons), package emits it (Home), pin bump.
2. PLACE-SPEC-01, PLACE-HUB-01, PLACE-WEATHER-01 (already in BACKLOG).
3. `app` kind contract, then the Weather app package.

## Household location on first use (2026-10-17, WEATHER-HOME-ASK-01)

Owner's call: ask once, on first use, with no setup screen. While `household.home` is unset the Home page shows one card. An owner or admin
taps "Use my location" (the browser's own prompt; never read without the tap, never an IP lookup) or types a city. Both resolve in the offline
city-timezones gazetteer, so nothing leaves the home; the person confirms the city and it becomes the household home. Anyone else sees
"Ask a grown-up to set the home location". Coordinates are rounded to 2 decimals and raw device coordinates are not stored. Device location
for one person stays an opt-in under Current location (PLACE-WEATHER-01). A weather question with no place gets a plain "I don't know where
you are yet" result that the model words, pointing at the same fix.
