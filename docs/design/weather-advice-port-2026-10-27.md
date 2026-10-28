# Weather advice and the missing weather features (port review, 2026-10-27)

Owner request 2026-10-27: port the weather features Home lacks, for example what to wear, shade and sunscreen, bring an umbrella and
the AI forecast summary. Sources: a read-only audit of the archived pre-rebuild hub (`WeatherPage.tsx` lines 46 to 190,
`lib/weather.ts`, `routes/tools.ts` lines 317 to 520) and Home's Weather package (`backend/packages/weather`, `recipe.json`,
`PackageAppPage.tsx`). Per principle 8 each row has a one-line verdict.

## What Home already has

Current temperature, condition, high and low, rain wording, a 24 hour strip, a 10 day forecast, and feels like, humidity, wind,
pressure, visibility, sunrise and sunset and UV as plain tiles. Data comes from Open-Meteo only (two hosts, place name or rounded
coordinates). There are no advice rules anywhere in Home: the old build computed them in the React page, so chat, the card and a
robot could not reuse them.

## Verdicts

| Pre-rebuild feature | Verdict |
|---|---|
| Advice chips: jacket, heavy coat, hat and gloves by feels-like; umbrella, rain gear, boots by the highest rain chance over the next 12 hours; sunscreen at UV 6 and up; sunglasses at UV 3 and up on a clear day | Rebuild as one server function, `weatherAdvice(...)`, deterministic, unit-tested, with the old thresholds as the starting point and units handled once. It lives in the weather package (catalog first, the bundled copy is hash-pinned) so the robot can reach the same definition. UV boundaries are the kit's own bands (3, 6, 8), no second set: sunscreen at High and above, sunglasses at Moderate and above on a clear day. The app, the weather card, the chat tool result and later the briefing and the robot all call it. No LLM involved in any rule. |
| UV label and a shade tip | The UV label already ships in the kit weather page (`weather-forecast-page.tsx` line 174); only "seek shade" is new, derived from the same bands inside the advice function (the old build had sunscreen and sunglasses only). |
| Minutecast, "rain starts in about 20 minutes" | Rebuild as hour-resolution wording ("rain likely around 3 pm") inside the advice function, from the hourly data already fetched; no minute feed in Open-Meteo's free tier, so no minute claims. |
| AI forecast summary (one or two sentences narrating the advice) | Rebuild on the chat model through the normal turn engine, input is the advice list and the numbers, cached per place per hour through `completeBackground`, not a person's turn; the shared cache passes the child floor, thinking is off, no text is logged, and plain-text fallback when the model is busy so a failed summary never fails the page. Every age band, wording passes the band floor. |
| Moon phase | Already built: `backend/packages/almanac-moon/handler.ts` (astronomy-engine) and the kit weather page has a `moon` prop. Port is only passing that data into the Weather app (WEATHER-PORT-04); no second copy. |
| Feels-like, humidity, wind, pressure, visibility, sunrise and sunset as a hero | Home has the tiles; add them to the weather card and the hero (kit parts only). |
| NWS alerts banner and station observation | Rebuild alerts only, US places only, behind a household switch (default off), sending rounded coordinates, one limiter, five minute cache, a privacy row for `api.weather.gov`. The station observation is dropped (Open-Meteo already gives current conditions). |
| Alert notifications | New, not a port (the old build only had a doc example): an alert for the home place raises a notification through the existing notifications record. After the alerts slice. |
| Wind advice, golden hour, air quality, pollen, radar, activities, commute, pet and kid advice | Not in the old build, so not a port. Wind advice ("breezy, hold your hat") joins the advice function; air quality and pollen are a possible later slice on Open-Meteo's air-quality host (new host, own privacy row, owner's word first). The rest are dropped. |
| Assistant tool examples ("what should I wear") | Add `routing.examples` only (never `patterns`) to the Weather package manifest, catalog first, and a tool result that carries the advice. |
| Briefing line, morning report, podcast and radio weather, robot feed, night dim by sunset | Deferred: each needs a module Home does not have yet. They call `weatherAdvice` when they exist. |
| Amcharts icon download | Dropped (the kit icon set covers it). |

## Supersedes

- `plans/weather-card-and-app-2026-10-16.md` line 23, "Open-Meteo is the one outbound host", and PLACE-WEATHER-01's "outbound to
  Open-Meteo stays the only one": superseded by WEATHER-PORT-05 for US places only, behind a household switch that is off by default.
- Nothing else. WEATHER-KID-01 (answers for every band) is unchanged and the advice function serves every band. The weather head
  and word lists are untouched: the advice function reads numbers, not wording, and adds no rule to the turn pipeline.

## Rules these slices keep

Age and surface gates outrank everything. A failed summary or alert fetch never fails the page or the answer. Kit parts only,
restyled by tokens (rule 9); advice chips use the shipped chip or badge parts. One limiter per outside service, privacy row for
every host. Every error says what went wrong and what to do.
