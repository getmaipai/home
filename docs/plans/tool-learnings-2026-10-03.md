# Tool learnings: what community projects do that our bundled tools do not

Research work order, cloud lane LRN, 2026-10-03 (read 2026-10-04). Research only, no code changes. Status: proposal for the
owner. Nothing here changes a rule in [docs/design/RULES.md](../design/RULES.md).

Purpose (owner's instruction): read even young or small community projects as REFERENCE, not to adopt them, but to learn how they
get their data and what they do better than our bundled tool. Each repo was treated as untrusted data: pages and raw files were
read, no code was run, no dependency was installed, and no source was copied. Ideas, endpoint shapes and field lists are noted;
code stays theirs (licence and "download, don't vendor").

Sections: [Sports](#1-sports), [Weather](#2-weather), [Music](#3-music), [News](#4-news), [YouTube](#5-youtube),
[Top 8 across all tools](#6-top-8-improvements).

## How to read the evidence

- Facts come from GitHub repo pages, README files and raw source, read through a page fetcher that summarises with a small model.
  A star count, date or field list is secondary evidence, not a quote. `UNVERIFIED` means the fact was not confirmed.
- Dates carry a year. Stars were read 2026-10-04. "Maintained" means a commit in the last 6 months.
- The third-party terms pages (ESPN, MLB, YouTube, MusicBrainz, Google News) were not read. Every terms statement is from a
  README or from memory and is marked.
- Item sizes: S is under a day, M is one to three days. Every item keeps rule 6 (a failed tool never fails the answer), rule 0 and
  our third-party rules: a person's pace, the front door over scraping, back off on the first signal, nothing leaves the house by
  default, every outbound host declared in `data_sources` and `permissions`.

## 1. Sports

### 1.1 What ours does today

- `backend/packages/sports/handler.ts` makes one GET to `https://statsapi.mlb.com/api/v1/schedule?sportId=1` (no date, no hydrate),
  keeps games whose `abstractGameState` is `Live` or `Final`, and says up to 3 as "Away 3, Home 2 (final)". Otherwise the reply is
  the fixed line "No MLB games have started yet today."
- `backend/packages/sports/manifest.json`: one host (`net:statsapi.mlb.com`), `data_sources` entry `mlb-statsapi` with
  `opt_in: true`, cache key `sports:mlb:today` for 300 s (stale ok 900 s). The tool takes no input: no team, date or league.

### 1.2 Community implementations

| Project | Licence | Last commit | Stars | Maintained | Sources |
|---|---|---|---|---|---|
| [cyanheads/sports-mcp-server](https://github.com/cyanheads/sports-mcp-server) | Apache-2.0 | 2026-09-30 | 2 | yes, very young | ESPN site API, MLB StatsAPI, TheSportsDB |
| [pseudo-r/Public-ESPN-API](https://github.com/pseudo-r/Public-ESPN-API) (docs, not a tool) | MIT | 2026-09-30 | 748 | yes | maps ESPN's undocumented hosts |
| [toddrob99/MLB-StatsAPI](https://github.com/toddrob99/MLB-StatsAPI) (Python) | GPL-3.0 (reference only) | 2025-04-04 | 849 | slow, 7 open issues | statsapi.mlb.com |
| [retr0h/mlb-mcp](https://github.com/retr0h/mlb-mcp) (Go) | MIT | 2026-09-14 | 0 | dependency bumps only | statsapi.mlb.com via a typed SDK |

Also seen, not read in depth: guillochon/mlb-api-mcp (MIT, 59 stars, 2026 date UNVERIFIED), WalrusQuant/sports-leader-mcp (MIT,
5 stars, 139 ESPN leagues), Left-Coast-Tech/espn-mcp (MIT, 1 star, NFL, NHL, NBA). Not researched: nba_api, balldontlie,
football-data.org, openf1, sportsdataverse.

### 1.3 How each gets its data and shapes it

| Aspect | cyanheads/sports-mcp-server | Public-ESPN-API (docs) | MLB-StatsAPI (Python) | retr0h/mlb-mcp |
|---|---|---|---|---|
| Endpoints | ESPN `site.api.espn.com/apis/site/v2/sports/{sport}/{league}/scoreboard` plus `/teams`, `/teams/{id}/schedule`; standings at `/apis/v2/sports/{sport}/{league}/standings`; MLB `schedule?sportId=1&hydrate=team,linescore,decisions&date=YYYY-MM-DD`; TheSportsDB for gaps | `site.api.espn.com`, `sports.core.api.espn.com`, `cdn.espn.com`; scoreboard params `dates=YYYYMMDD`, `limit`, `week`, `season`, `groups` | table-driven map over `statsapi.mlb.com/api/v1`; `schedule()` hydrates `decisions,probablePitcher(note),linescore,broadcasts` | 11 composed intent tools (scores, standings, game detail) plus 54 raw passthrough tools |
| Kind of source | ESPN undocumented, MLB undocumented but widely used, TheSportsDB documented | undocumented; README says unaffiliated and "reachable does not mean redistributable" | undocumented, MLB copyright notice restricts use (from README) | same as MLB |
| Auth | none; TheSportsDB test key `3` | none | none | none |
| Rate limit, cache | no cache; per attempt 10 s timeout, 30 s total, up to 4 attempts on transient errors only, 1 s base delay | not covered (ESPN limits UNVERIFIED) | none | none seen (UNVERIFIED beyond README) |
| Result shape | `NormalizedGame`: id, shortName, home and away (id, name, abbreviation, score), status, period, clock, `startTimeUtc`, venue, `source` | raw ESPN JSON | raw plus helper fields | composed summaries |
| Status handling | enum `scheduled`, `in-progress`, `final`, `postponed`, `cancelled`; MLB reads `detailedState` for Postponed and Cancelled | ESPN `pre`, `in`, `post` | reads `detailedState`; winner and loser only for "Final" or "Game Over" | n/a |
| Edge cases | league parameter; fuzzy `sports_find_team`; off-season returns `games: []` plus a `reason`; typed errors `no_match`, `team_not_found`, `season_not_found`; date defaults to today | single-day `dates` only: v2 MLB and NFL scoreboards return HTTP 400 on a `YYYYMMDD-YYYYMMDD` range (README, verified Sep 2026); Core links may say `.pvt`, replace with `.com` | `lookup_team` is case-insensitive substring over all team fields; `latest_season()` returns the upcoming season in the off-season | composed tools over raw ones |
| Not handled | time zones (UTC passthrough), score corrections, caching | n/a | caching, rate limits | n/a |

### 1.4 Learn, and what not to copy

Learn:

- **Hydrate the schedule call.** `hydrate=team,linescore` adds inning, outs and team abbreviations in the same request. No extra
  host, no extra call.
- **A status enum, not a two-value filter.** `scheduled`, `in-progress`, `final`, `postponed`, `cancelled`, read from
  `abstractGameState` plus `detailedState`. Per the agent's reading of the source, an MLB postponed game can arrive as
  `abstractGameState: Final` (UNVERIFIED by us against a live payload). Our score-must-be-a-number check probably keeps those out
  today, but nothing tests it.
- **An empty result carries a reason.** `games: []` plus "no games scheduled today", "off-season" or "none started yet". Ours says
  "No MLB games have started yet today" in the middle of January.
- **A date and a team.** "Did the Mariners win last night" needs `date=YYYY-MM-DD` and a team match against name, abbreviation and
  club code (`GET /api/v1/teams?sportId=1`, small and stable, cacheable for a day).
- **One endpoint family per league via the same call shape.** ESPN's `site/v2/sports/{sport}/{league}/scoreboard` covers NFL, NBA,
  NHL, MLS and college with `dates=YYYYMMDD` (single day only).
- **Attribution per row** (`source`), and a bounded retry budget (10 s per attempt, 30 s total, transient errors only).
- **Composed intent tools over raw passthrough** (retr0h): few, plain tools for the model, not 65.

Fragile or against our rules:

- ESPN endpoints are undocumented and unaffiliated with the sports body. Using them is a decision about "the front door": the
  owner decides (see item LRN-SP-4). MLB's own StatsAPI is already our front door and is also undocumented, so the same caveat
  applies to what we ship today. UNVERIFIED: either terms page.
- TheSportsDB's shared test key `3` is rate-limited and shared with every user. A keyed tier is a hosted account: off by default.
- MLB-StatsAPI is GPL-3.0: ideas only.
- No project handles score corrections or time zones. We fetch live each time (5 minute cache) and convert in our own layer.

Do not copy: any source file, the fuzzy-match code, the provider router, TheSportsDB key.

### 1.5 Improvement items (ordered by value for a family)

- [ ] **LRN-SP-1: a game the family asks about is reported honestly, and an empty day says why** (S). Objective: postponed, cancelled,
  suspended and delayed games are named as such, not dropped or shown as finals; "no result" says which of: no games scheduled today,
  none started yet (and the first start time), off-season. Files: `backend/packages/sports/handler.ts` (`isReportable`,
  `summarizeScores`), `handler_test.ts`, `README.md`, `CHANGELOG.md`. Acceptance: fixtures for `detailedState` Postponed, Suspended,
  Delayed, a scheduled-only day and an empty `dates` array each produce their own line; the January fixture never says "have not
  started yet". Regression test: a postponed game with `abstractGameState: Final` and no score is not read as "0 to 0 final".
  Out of scope: other leagues, dates. Exit: `bash scripts/check.sh` plus the fixture tests seen failing first. Reuse check: status
  mapping idea from cyanheads/sports-mcp-server (Apache-2.0, idea only), no new dependency.
- [ ] **LRN-SP-2: "did the Mariners win last night" works (a team and a date)** (M). Objective: optional `team` and `date` inputs; the
  date is read in the household's time zone, not the hub's UTC or MLB's Eastern day; the team is matched against the cached
  `/teams?sportId=1` list by name, nickname and abbreviation. Files: `handler.ts` (input schema), `manifest.json` (inputs, cache key
  `sports:mlb:{date}:{team}`, a second `permissions` entry only if a new host is needed: it is not), a one-day cached teams call,
  tests. Acceptance: "Mariners" and "SEA" and "the M's" resolve to one team; yesterday's date asks `schedule?sportId=1&date=`;
  an unknown team gets "I don't know a team called X" with no guess; a late game after midnight UTC lands on the right date.
  Regression test: the date rollover at 23:30 local with a UTC offset of -8. Out of scope: favorites setting. Exit:
  `bash scripts/check.sh`. Reuse check: MLB's own `/teams` list, no library.
- [ ] **LRN-SP-3: a score line a person can follow (inning, start times, who is pitching)** (M). Objective: add
  `hydrate=team,linescore` (and `probablePitcher` for games not started); live games say "bottom of the 7th, 2 outs"; a scheduled
  game says "7:05 PM" in the household time zone instead of being left out. Files: `handler.ts`, `manifest.json` (cache stays 300 s
  for finished days, 60 s when any game is live), tests. Acceptance: fixtures per state; speech and text lines differ only in
  wording of time; response stays under `max_bytes` 100000. Out of scope: box scores, standings. Exit: `bash scripts/check.sh`.
  Reuse check: same host and endpoint family, one added query parameter.
- [ ] **LRN-SP-4: a second league (NFL, NBA, NHL) behind its own opt-in** (M, needs an owner decision first). Objective: scoreboard
  for one more league through ESPN's `site/v2/sports/{sport}/{league}/scoreboard?dates=YYYYMMDD`, one day per call (ranges return
  400), with a `source` per row. Files: `sports/manifest.json` (a new `data_sources` entry and `net:site.api.espn.com`, `opt_in`
  true, off by default, never for a child until the household turns it on), `handler.ts`, tests, README. Acceptance: with the
  entry off, no request leaves; with it on, an NFL Sunday fixture shows three games; a 400 or 429 backs off and answers with the
  rule 6 note. Out of scope: standings, rosters, play by play. Exit: `bash scripts/check.sh`. Reuse check: the Public-ESPN-API docs
  are the reference for the URL shape (idea only); the alternative is waiting for a documented API, UNVERIFIED that one exists
  without a key. Blocked until the owner rules on undocumented endpoints.

## 2. Weather

### 2.1 What ours does today

- `backend/packages/weather/recipe.json` (a declarative recipe, no handler): Open-Meteo geocoding with `count=1` and the first hit
  only, then one forecast call (`current=temperature_2m,weather_code`, daily high, low and rain chance, `forecast_days=1`,
  `timezone=auto`, `temperature_unit=fahrenheit`). A WMO code table turns the code into one word. Reply: "It's 61 degrees and
  overcast in Seattle. Today: high 64, low 52, 20% chance of rain."
- `backend/packages/weather/manifest.json`: hosts `geocoding-api.open-meteo.com` and `api.open-meteo.com`, cache key
  `weather:{place}` 1800 s (stale ok 3600 s), a warm job every hour for Seattle, a dashboard widget. No wind, no days ahead, no
  alerts, no unit setting, no country or state in the reply.

### 2.2 Community implementations

| Project | Licence | Last commit | Stars | Maintained | Sources |
|---|---|---|---|---|---|
| [weather-mcp/weather-mcp](https://github.com/weather-mcp/weather-mcp) | MIT | 2026-10-03 | 48 | yes | NOAA/NWS, Open-Meteo, MET Norway, Census and Nominatim geocoding, regional alert feeds |
| [cyanheads/nws-weather-mcp-server](https://github.com/cyanheads/nws-weather-mcp-server) | Apache-2.0 | 2026-09-30 | 1 | yes, young | `api.weather.gov` only (US) |
| [cmer81/open-meteo-mcp](https://github.com/cmer81/open-meteo-mcp) | MIT | 2026-10-03 | 69 | yes | nine Open-Meteo hosts (forecast, archive, air quality, marine, flood and others) |

Not read: chubin/wttr.in, Pirate Weather, Home Assistant's met.no and open_meteo integrations (UNVERIFIED, fetch blocked or not
pursued).

### 2.3 How each gets its data and shapes it

| Aspect | weather-mcp | nws-weather-mcp-server | open-meteo-mcp |
|---|---|---|---|
| Geocoding | Open-Meteo `v1/search` (`name`, `count`, `language=en`), then Census `onelineaddress`, then Nominatim (`addressdetails=1`, User-Agent set). Asks upstream for at least 5 results because rank at `limit=1` is unreliable. Provider order by query type (US state or country words). First non-empty provider wins; "all providers down" is told apart from "no match" | none: takes coordinates | `geocoding-api` tool, params UNVERIFIED |
| Weather | US: `api.weather.gov/points/{lat},{lon}`, then `/gridpoints/{office}/{x},{y}/forecast`. Elsewhere Open-Meteo `v1/forecast` (1 to 16 days, `timezone=auto`), fallback MET Norway (about 9 days, daily only) on transient failure | same NWS chain, `Accept: application/geo+json`, 10 s timeout, User-Agent from `NWS_USER_AGENT` | `api.open-meteo.com` plus per-model hosts; `past_days` to 92; times GMT unless `timezone` is set |
| Fields | current: temp, feels-like, humidity, dewpoint, wind, gusts, pressure, cloud, precipitation. daily adds sunrise, sunset, UV max, precipitation sum, wind max, dominant direction. hourly capped by a `detail` level (24, 48 or unlimited hours) | periods plus alerts with severity, urgency, certainty | raw Open-Meteo JSON |
| Alerts | NOAA, ECCC (Canada), MeteoAlarm (38 European countries) and others, sorted by severity, life-threatening ones prepended as a banner above the forecast, fetched without blocking | `/alerts/active` by point, area, zone, event, severity | none |
| Units | `WEATHER_UNITS` or per request: imperial default, metric, knots, hPa. Unit parameters are sent to Open-Meteo, not converted after. Locale default UNVERIFIED | dual units per README (fields UNVERIFIED) | passes Open-Meteo unit parameters |
| Cache, limits | LRU: alerts 5 min, current 15 min, forecast 2 h, NWS grid lookup forever, stations 24 h. Retries 3 with jitter on 429, 503, network; timeouts not retried. Open-Meteo free quota quoted as 10,000 requests a day. ETag UNVERIFIED | only the points lookup (1 h, key from lat and lon truncated to 4 decimals); 2 attempts, 2 to 4 s apart | TTLs: forecast 15 min, air quality 30 min, geocoding 7 days, elevation 30 days; array trimming over 25,000 characters with `truncated: true`; 60 requests a minute per client IP on its HTTP transport |
| Shape for a model | markdown: header with coordinates, elevation, timezone and source; one block per period; 16-point compass for wind; WMO text; a note when the request is past the source's horizon or capped | typed errors; clear message outside the US and for marine points | none: raw JSON, no WMO text |
| Ambiguity | takes `results[0]`; the only help is an error hint "try Bend, Oregon" | n/a | none |

### 2.4 Learn, and what not to copy

Learn:

- **Ask for 5, rank, and name what you matched.** Our `count=1` returns one place with no state or country in the reply. Open-Meteo's
  geocoding rows carry `admin1`, `country` and `population` (UNVERIFIED by us for every row, standard in its documented response).
  No surveyed tool resolves "Portland" or "Springfield" well, so we can go beyond them: say the match ("Portland, Oregon") and offer
  the next candidate when the top two are close in population.
- **Send units to the API** (`temperature_unit`, `wind_speed_unit`, `precipitation_unit`), do not convert, and take the default from
  the household, not from a hardcoded string.
- **Ask for days.** `forecast_days` to 16 and a handful of daily fields (`apparent_temperature_max`, `precipitation_sum`,
  `wind_speed_10m_max`, `sunrise`, `sunset`, `uv_index_max`) answer "will it rain tomorrow", "do I need a coat" and "when is sunset".
- **Alerts above the forecast.** `api.weather.gov/alerts/active?point=lat,lon` with a contact User-Agent and
  `Accept: application/geo+json`, shown first, fetched alongside, never blocking the forecast.
- **Cache by what changes**: current 15 min, forecast 15 min to 2 h, geocoding 7 days (a town does not move), NWS grid lookup long.
- **A note when the ask is past the horizon**, and typed "no match" versus "service down".

Fragile or against our rules:

- Nominatim and Census geocoders take a typed address: that is a household address leaving the house, not a town name. Do not add
  either. Keep Open-Meteo geocoding (a place name, already declared).
- NWS needs a User-Agent with contact details: our manifest would name the project, never a household member's email.
- MET Norway as a fallback is a third host for the same data. Worth it only if Open-Meteo's free tier is hit (it is for non-commercial
  use per the survey, UNVERIFIED). Defer.
- The per-model Open-Meteo hosts (ICON, GFS, ECMWF), marine, flood and CMIP6 are wider than a household needs.

Do not copy: the multi-provider geocoder, the 17-tool surface, raw JSON passthrough.

### 2.5 Improvement items

- [ ] **LRN-WX-1: "weather in Portland" names the Portland it chose and offers the other one** (S). Objective: geocode with `count=5`,
  pick the top by population, say "Portland, Oregon" (name, `admin1`, country when not the household's), and when the second
  candidate has at least half the top one's population, add a short "or did you mean Portland, Maine" for the model to offer.
  Files: `weather/recipe.json` (a recipe has fetch, pick, lookup and format ops only, so branching and ranking probably need a Tier 1
  `handler.ts` like sports, UNVERIFIED: read `backend/src/lib/recipes*` before choosing), `manifest.json`, `tests/`. Acceptance:
  a Springfield fixture (5 hits) returns the most populous plus an alternate; a unique name returns no alternate; no hit says "I
  couldn't find a place called X" with no guess. Regression test: `count=1` fixture and `count=5` fixture give different replies for
  Portland. Out of scope: reverse geocoding, saved home place. Exit: `bash scripts/check.sh`. Reuse check: same Open-Meteo geocoding
  endpoint (documented), no library.
- [ ] **LRN-WX-2: tomorrow, this weekend and "do I need a coat"** (M). Objective: optional `day` input (today, tomorrow, a weekday,
  next 3 to 7 days) and extra daily fields: feels-like high, precipitation total, wind max, sunrise, sunset, UV max; current wind and
  feels-like. Files: `weather/recipe.json` or handler, `manifest.json` (cache key `weather:{place}:{day}`; the 1800 s TTL stays),
  tests, README. Acceptance: "tomorrow" reads index 1 of the daily arrays in the place's own time zone (`timezone=auto`); a request
  past 16 days says so; the reply stays under `max_bytes` 4096. Regression test: a fixture where "today" and "tomorrow" differ.
  Out of scope: hourly, air quality, history. Exit: `bash scripts/check.sh`. Reuse check: same host, added query parameters.
- [ ] **LRN-WX-3: units follow the household, not a hardcoded Fahrenheit** (S). Objective: pass `temperature_unit`,
  `wind_speed_unit` and `precipitation_unit` from the person's or household's unit setting; a Canadian or UK household hears Celsius
  and km/h or mph. Files: `weather/recipe.json` (the `unit` data field is already set), the settings source (UNVERIFIED which
  setting exists: `grep` found no household units setting; check `backend/src/lib/persona.ts` and `routes/plugins.ts` first, and add
  one only if none exists). Acceptance: two fixtures, Celsius and Fahrenheit, each speak their own unit word. Out of scope: wind
  direction words. Exit: `bash scripts/check.sh`. Reuse check: Open-Meteo converts server side.
- [ ] **LRN-WX-4: a severe-weather alert comes first** (M, new host, opt-in). Objective: for a US place, fetch
  `api.weather.gov/alerts/active?point=lat,lon` beside the forecast and lead with the highest-severity active alert (event, area,
  expires). Files: `weather/manifest.json` (a `data_sources` entry for `api.weather.gov`, `net:api.weather.gov`, `opt_in` true; what
  leaves: the rounded coordinates of a named town, nothing else), a handler, tests. Acceptance: with the entry off no request leaves;
  a tornado-warning fixture is the first sentence; a 404 outside the US or an NWS error never blocks the forecast (rule 6).
  Regression test: NWS down, forecast still answers. Out of scope: Canada and Europe feeds, push notifications (see the
  notifications item in `docs/BACKLOG.md`). Exit: `bash scripts/check.sh`. Reuse check: NWS is a US government service; the
  cyanheads server is a pattern reference only (Apache-2.0, 1 star).

## 3. Music

### 3.1 What ours does today

- `backend/packages/music/handler.ts`: one GET to `musicbrainz.org/ws/2/artist/?query=artist:<name>&fmt=json&limit=1`, with a
  `MaiPaiHome/0.1.0 (repo URL)` User-Agent. Reply from the first hit only: "Radiohead is a band from United Kingdom, formed in 1985."
  No score check, no `disambiguation`, no songs, albums or lyrics.
- `backend/packages/music/manifest.json`: `net:musicbrainz.org`, cache `music:artist:{query}` 86400 s (stale ok 604800 s). The host
  already applies a per-host pace (`backend/src/lib/packageHost.ts`, around line 103, value not read).

### 3.2 Community implementations

| Project | Licence | Last commit | Stars | Maintained | Sources |
|---|---|---|---|---|---|
| [cyanheads/musicbrainz-mcp-server](https://github.com/cyanheads/musicbrainz-mcp-server) | Apache-2.0 | 2026-09-22 | 1 | yes, young | MusicBrainz WS/2, Cover Art Archive |
| [chrischall/musicbrainz-mcp](https://github.com/chrischall/musicbrainz-mcp) | MIT | 2026-10-03 | 0 | yes, written by an AI per its README | MusicBrainz WS/2, Cover Art Archive |
| [zas/mcp-musicbrainz](https://github.com/zas/mcp-musicbrainz) | GPL-3.0-or-later (reference only) | 2026-04-05 | 13 | about 6 months quiet | MusicBrainz, ISRC and ISWC translation |
| [Blakeem/Navidrome-MCP](https://github.com/Blakeem/Navidrome-MCP) | AGPL-3.0 | 2026-08-26 | 90 | yes | your Navidrome library, optional Last.fm and LRCLIB |

### 3.3 How each gets its data and shapes it

| Aspect | cyanheads | chrischall | zas | Navidrome-MCP |
|---|---|---|---|---|
| Endpoints | WS/2 search (Lucene), lookup by MBID with `inc`, browse, ISRC and ISWC endpoints, barcode via search; Cover Art Archive. `inc` strings UNVERIFIED | Lucene search, MBID lookup with linked data, browse, Cover Art Archive, resolves musicbrainz.org URLs | search over 10 entity types, discography, tracklists with performer credits, ISRC and ISWC | Navidrome API; Last.fm for similar artists and bios (key); LRCLIB for synced lyrics (public, no key, from memory UNVERIFIED) |
| Auth, User-Agent | none; User-Agent `musicbrainz-mcp-server/<version> (<contact>)`, contact required by env | none; write tools OAuth-gated | none | Navidrome login |
| Rate, cache | process-wide token bucket about 1 request a second; cache keyed on the whole request including `inc`, 24 h; backoff on 503 and on HTML replies under load; 400 and 404 are permanent | 1 request a second or slower | diskcache 24 h | UNVERIFIED |
| Shape for a model | search rows with MBID, name and the raw 0 to 100 `score`; zero-hit notice with the query and upstream total; truncation note pointing to browse; pages capped at 25; typed errors `invalid_mbid`, `entity_not_found`; model chains search to `get_*` by MBID | `compact` view (URLs stripped) or `full` | tracklists and credits | 70+ tools, wide |
| Ambiguity | raw score shown, no threshold; `disambiguation` surfaced: UNVERIFIED | UNVERIFIED | UNVERIFIED | n/a |
| Songs, albums | yes: recording, release-group, release, work, label search | yes | yes | in your own library only |

### 3.4 Learn, and what not to copy

Learn:

- **More than one hit, with the score.** MusicBrainz search returns a 0 to 100 `score`, a `disambiguation` string ("UK rock
  band", "American singer") and `type`, `country`, `life-span`. Return the top 3 and flag ambiguity when the top two scores are
  close or the top is under about 90 (our own rule; neither server sets one, UNVERIFIED for the rest). This fixes "who is Prince"
  and "Adele" with same-name artists.
- **Search other entities, not only artists.** `recording:"x" AND artist:"y"` answers "who sings Hello", `release-group` answers
  "what albums did Adele make" (`/ws/2/release-group?artist={mbid}&type=album`), `work` for songwriters.
- **A cache key that includes the whole request**, and retry only on 503 and HTML bodies; a 400 or 404 is final.
- **Chain by MBID**: search returns ids, a second small call looks one up with `inc=release-groups+url-rels+tags`. Keeps each
  result small.
- **Cover art** from the Cover Art Archive by release MBID is a front-door image (adds a host).
- **A compact view** that drops URL relations by default.

Fragile or against our rules:

- Lyrics: LRCLIB is a community site and lyrics are copyrighted text; reading them to a child is also a rule 0 question. Do not
  add. A link to where lyrics are is enough.
- Last.fm needs a household-held API key and every lookup tells Last.fm what you listen to: off by default if ever.
- MusicBrainz asks for about 1 request a second and a contact User-Agent. Ours has a project URL, which is within the etiquette
  (terms page not read, UNVERIFIED). Chained calls (search then lookup) must stay inside the host's pace.
- GPL (zas) and AGPL (Navidrome) are idea-only. The two MIT and Apache servers are 0 to 1 star, so read them for field lists, not
  as dependencies.

Do not copy: any source, the 10-entity surface, write tools.

### 3.5 Improvement items

- [ ] **LRN-MU-1: "who is Prince" gets the right Prince or asks which** (S). Objective: `limit=5`, report the top hit with its
  `disambiguation`, and when the second hit's score is within 10 points or the top is under 90, add one line naming the other
  ("There is also Prince Royce, a bachata singer"). Files: `music/handler.ts` (`summarizeArtist`, query URL), `handler_test.ts`,
  `README.md`, `CHANGELOG.md`. Acceptance: fixtures with a clear winner (one sentence), a close pair (two names), a score of 62
  (hedged "I'm not sure this is the one"). Regression test: today's code answers a close pair with one name as certain. Out of scope:
  songs, albums. Exit: `bash scripts/check.sh`. Reuse check: same endpoint, `score` and `disambiguation` are in the documented
  response (UNVERIFIED by us against a live payload).
- [ ] **LRN-MU-2: "who sings Hello" and "what albums did Adele make"** (M). Objective: an optional `kind` input (artist, song,
  album) with `recording` and `release-group` search, and a browse of an artist's albums by MBID (one chained call, inside the host
  pace). Files: `music/handler.ts`, `manifest.json` (cache keys per kind, same host, no new `data_sources`), tests, README ("artists
  only" line). Acceptance: a recording fixture names the artist of the top hit with its disambiguation; an album list is the 5
  newest studio albums with years; a lookup failure on the second call still answers from the first (rule 6). Out of scope: lyrics,
  playback, cover art. Exit: `bash scripts/check.sh`. Reuse check: cyanheads' query shapes (idea only); same host.
- [ ] **LRN-MU-3: be a polite MusicBrainz client** (S). Objective: retry once on 503 or an HTML body after the host's pace, never on
  400 or 404; the contact in the User-Agent stays the project URL. Files: `music/handler.ts`, tests. Acceptance: a 503 fixture then
  a 200 fixture answers; a 404 fixture answers "couldn't find" without a retry; two chained calls stay under the host's pace in a
  timing test. Exit: `bash scripts/check.sh`. Reuse check: `host.fetch` already paces per host, so this item only adds the retry
  classification; confirm the pace value in `packageHost.ts` first (UNVERIFIED).

## 4. News

### 4.1 What ours does today

- `backend/packages/news/handler.ts`: one GET to `https://feeds.npr.org/1001/rss.xml`, regex over `<item>` blocks, first 3
  `<title>` values (CDATA stripped, five entities decoded). Reply: "Top headlines: A. B. C." No source name, no time, no summary, no
  topic or region, no Atom, no dedupe.
- `backend/packages/news/manifest.json`: `net:feeds.npr.org`, cache `news:top` 900 s (stale ok 3600 s), `max_bytes` 200000.

### 4.2 Community implementations

| Project | Licence | Last commit | Stars | Maintained | Source |
|---|---|---|---|---|---|
| [ma2za/google-news-api](https://github.com/ma2za/google-news-api) (Python plus MCP) | MIT | Sep 2026 (day UNVERIFIED) | 19 | yes | Google News RSS |
| [cyanheads/gdelt-mcp-server](https://github.com/cyanheads/gdelt-mcp-server) | Apache-2.0 | v0.6.0, 2026-09-24 | 6 | yes | GDELT v2 API |
| [jmanek/google-news-trends-mcp](https://github.com/jmanek/google-news-trends-mcp) | MIT | UNVERIFIED | 88 | UNVERIFIED | Google News and Trends RSS via `gnews` |
| [moltrus/google-news-mcp](https://github.com/moltrus/google-news-mcp) | MIT | 2026-04-23 | 2 | 5 months quiet | Google News RSS |
| [lionkiii/rss-feeds-mcp](https://github.com/lionkiii/rss-feeds-mcp) | MIT | 2026-07-28 | 4 | yes, poor fit (marketing blogs) | any feed list, `rss-parser` |

### 4.3 How each gets its data and shapes it

| Aspect | ma2za | gdelt-mcp-server | moltrus | lionkiii |
|---|---|---|---|---|
| Endpoint | `news.google.com/rss/search?q=&hl=&gl=&ceid=`, top stories; two paid SearchAPI modes (key) | `api.gdeltproject.org/api/v2` doc search (3 months, 65+ languages, up to 250 articles a call), timelines, tone; exact paths UNVERIFIED | Google News RSS feeds: top, category, search, geo, topic | whatever the feed list holds |
| Auth | none for RSS | none | none; optional Jina Reader and Groq keys | none |
| Rate, cache | 60 requests a minute default, 300 s cache, retry controls; ETag UNVERIFIED | one request in flight, 1 per 5 s, a cooldown gate closes for every queued caller on a rate-limit reply; pluggable cache | LRU 1024 for decoded URLs | 15 s timeout, no cache, no ETag |
| Filters | `when` (24h), `after`, `before`, include and exclude domains, language and country | query, timespan, language | `site:`, `when:`, `intitle:`, `after:`, `before:` | `pubDate` cutoff (7d, this week) |
| Shape | `title, link, published, summary, source, id`; deduped; resolves the Google redirect link to the publisher URL | typed series labels, query echo, empty result returns the schema plus a notice, not an error | feed metadata plus entries (title, link, published, summary, source), compact "toon" format | `{title, link, pubDate ISO, source, category, summary}`, tags stripped with a regex, summary cut to 200 characters |
| Parser | feed library (UNVERIFIED) | JSON | feed library | `rss-parser` (RSS and Atom) |

None of them was seen to use `ETag` or `If-Modified-Since`.

### 4.4 Learn, and what not to copy

Learn:

- **Return a record, not a string**: title, source, published time (ISO, converted to the household's zone for speech), a 200
  character plain-text summary. The model can then say "NPR, an hour ago".
- **A real feed parser** for RSS 2.0 and Atom instead of regex. Edge cases our regex misses: Atom `<entry>` and `<link href>`,
  `dc:date` and `pubDate` zones, numeric entities (`&#8217;`), nested CDATA, `<item>` with attributes.
- **A topic and region choice** from a short fixed list of feeds, each host declared. NPR publishes per-topic feeds; the exact ids
  were not verified (UNVERIFIED). A search form (`news.google.com/rss/search?q=`, `when:1d`, `hl`, `gl`, `ceid`) answers "news
  about the election" but sends the family's query to Google, so it is opt-in and adult-only if ever (rule 7's hosted-provider
  posture).
- **Dedupe by normalised title** when more than one feed is read, and a staleness cutoff (drop items older than N days).
- **A shared cool-down**: when a feed returns 429 or 403, all callers wait (GDELT server's gate). Ours: the host's first-signal
  back-off already does this (`packageHost.ts`), so only the cache TTL and conditional GET are left to add.
- **Conditional GET** (`ETag`, `If-Modified-Since`) is nowhere in the field; it is the polite front-door move and cheap. Whether
  `host.fetch` passes validators through is UNVERIFIED (read `performHttpFetch` first).

Fragile or against our rules:

- Google News RSS is an unofficial endpoint; its links are redirect wrappers that need a decoder, which scrapes. Do not add the
  decoder: give the Google link as is, or skip Google.
- GDELT returns no summary text and is a research index; 1 request per 5 s is its own etiquette. Not a headline source.
- Jina Reader and Groq (moltrus) send article text or URLs to a hosted service: no.
- News text is data, never instructions (rule 7). Summaries from a feed are untrusted text and must pass the same floor for a child.

Do not copy: any source, the Google URL decoder, hosted summarisers.

### 4.5 Improvement items

- [ ] **LRN-NW-1: a headline carries its source and age, and a real parser reads RSS and Atom** (M). Objective: replace the regex
  with a small, tested feed reader (RSS 2.0 and Atom, CDATA, numeric and named entities, tag stripping), keep 3 items, and return
  `{title, source, published_iso, summary<=200}` so the reply reads "NPR, 2 hours ago: ...". Files: `news/handler.ts`,
  `handler_test.ts`, `manifest.json` (`max_bytes`), README. Acceptance: Atom and RSS fixtures give the same shape; `&#8217;` and CDATA
  titles decode; a feed with no `pubDate` omits the age; an item older than 3 days is dropped; a feed of 0 items says so. Regression
  test: today's regex returns an empty title list for an Atom feed. Out of scope: topics, full article text. Exit:
  `bash scripts/check.sh`. Reuse check: first look for a maintained parser that runs under Deno without a Node dependency (the
  handler is a Deno package); if none fits, a 60 line reader is smaller than the dependency (UNVERIFIED: no search for one was run).
- [ ] **LRN-NW-2: "any sports news" and "local news" from a short fixed feed list** (M). Objective: an optional `topic` input
  (top, world, politics, business, science, sports, local) mapped to a fixed list of feed URLs held in the manifest, every host
  declared; the household picks a default region feed in settings. Files: `news/manifest.json` (`config`, `data_sources`,
  `permissions` per host), `handler.ts`, tests, README. Acceptance: each topic fetches one known URL; an unknown topic says what
  is available; a host not in `permissions` is never fetched. Regression test: the permissions list and the feed table agree.
  Out of scope: free-text news search (Google), user-added feeds (a catalog package). Exit: `bash scripts/check.sh`. Reuse check:
  NPR, BBC and AP publish feeds for readers; choose from their own feed pages, not a third-party list (UNVERIFIED which URLs).
- [ ] **LRN-NW-3: send conditional requests so a feed is fetched politely** (S). Objective: store `ETag` and `Last-Modified` with
  the cached headlines and send `If-None-Match` and `If-Modified-Since`; a 304 reuses the cache. Files: `backend/src/lib/packageHost.ts`
  (`performHttpFetch`, only if it can pass validators; UNVERIFIED), `news/manifest.json`. Acceptance: a fixture returning 304 serves
  the cached items and refreshes the TTL. Out of scope: other packages (weather and sports APIs do not offer validators, UNVERIFIED).
  Exit: `bash scripts/check.sh`. Reuse check: HTTP standard, no library.

## 5. YouTube

### 5.1 What ours does today

We have no YouTube tool. `docs/plans/mcp-connectors-survey-2026-10-03.md` section 2 lists three servers and
`docs/plans/tools-ecosystem-design-2026-10-03.md` decision C1 plans transcripts as the second connector, with the terms question
open (O2). This section is what the community tools do, so the first slice can copy the good parts of the design.

### 5.2 Community implementations

| Project | Licence | Last commit | Stars | Maintained | Source |
|---|---|---|---|---|---|
| [jdepoix/youtube-transcript-api](https://github.com/jdepoix/youtube-transcript-api) (Python) | MIT | 2026-09-09 (README edits) | 8.4k | yes, quiet | undocumented innertube web endpoint |
| [kevinwatt/yt-dlp-mcp](https://github.com/kevinwatt/yt-dlp-mcp) | MIT | 2026-08-11 | 286 | yes | the `yt-dlp` binary |
| [BK927/youtube-research-mcp](https://github.com/BK927/youtube-research-mcp) | MIT | 2026-10-03 | 0 | yes, one person, new | Data API v3 (key) plus yt-dlp and YouTube.js |
| [kimtaeyoon83/mcp-server-youtube-transcript](https://github.com/kimtaeyoon83/mcp-server-youtube-transcript) | MIT | 2026-07-21 | 598 | lumpy | innertube `/youtubei/v1/get_transcript` with an ANDROID client |

### 5.3 How each gets its data and shapes it

| Aspect | youtube-transcript-api | yt-dlp-mcp | youtube-research-mcp | kimtaeyoon83 |
|---|---|---|---|---|
| Kind of source | undocumented, no key, no browser | scrapes through yt-dlp (fastest fix cadence upstream); Node 18+ plus binary | hybrid: official Data API (search, comments, channels, playlists) or unofficial for transcripts; modes hybrid, official, unofficial | undocumented; ANDROID client version 19.29.37 pinned (code comment: avoids web-client token enforcement); watch page HTML regex-scraped for metadata |
| Languages | priority list `languages=['de','en']`; `list()` shows tracks; `translate()`; manual captions preferred over auto-generated; `is_generated` flag | list subtitle languages, VTT or clean text | by mode | `lang` default en, optional fallback to English then the first available; available tracks listed with an auto flag |
| IP blocks | README: most cloud IPs blocked; raises `RequestBlocked` and `IpBlocked`; fixes are rotating residential proxies | same; cookies and config file optional | warnings plus official fallback; no proxies | none handled |
| Cache, budget | none | character limits against context overflow (values UNVERIFIED) | in-process cache (256 metadata, 128 posts, 64 continuations), 900 s; quota self-limit 9,000 units a day (search about 90 to 100 units of a 10,000 default, UNVERIFIED); response budget 12,288 bytes, hard max 32,768; signed opaque cursors | none; long videos returned whole |
| Shape for a model | snippets `{text, start, duration}` plus video id, language, `is_generated`; formatters JSON, text, VTT, SRT | tools: search, subtitles, `download_transcript` (plain text), metadata and summary, comments (threaded) | bounded envelope with provenance, quota cost, freshness, warnings and markers for untrusted fields | `{text, start, dur}` lines; `include_timestamps` ("[0:05]"), `strip_ads`, metadata (title, author, subscribers, views, date), ad chapters |
| Edge cases | age-restricted fails (cookie auth broken per README); no caching or rate limit | cookies for age-restricted; audio download gives a Whisper path | unofficial path can fail on parser changes, proof-of-origin tokens, IP reputation, bot challenges | URL, Shorts URL or bare id accepted; live and private: UNVERIFIED |

From memory, UNVERIFIED (not fetched): Data API `search.list` costs 100 units of a 10,000 default, `videos.list` 1 unit,
`captions.list` 50, and `captions.download` needs the video owner's OAuth, so it cannot fetch someone else's transcript. oEmbed
(`youtube.com/oembed?url=...&format=json`) is keyless and returns title, author and thumbnail only.

### 5.4 Learn, and what not to copy

Learn:

- **Accept a URL, a Shorts URL or a bare id**, then one video per call.
- **Return segments with timestamps, and a joined plain-text view**; mark manual versus auto-generated; pick the language by a
  priority list, then fall back.
- **A byte budget per answer** (12 KB default, 32 KB cap in youtube-research-mcp) and a "this was cut, ask for a part" note,
  instead of returning a 2-hour transcript whole. This also serves our small-model context (rule 4).
- **Mark every fetched field as untrusted** in the envelope. A transcript can carry an injection (rule 7: data, never
  instructions); the same floor as search pages for a child or teen.
- **Name the failure kind**: no captions, blocked, private, age-restricted, network. Maps to rule 6's "down, timed out, found
  nothing".
- **Cache per video id** (a transcript does not change; days, not minutes).
- **Metadata through the documented route** (oEmbed or Data API `videos.list`) separate from the transcript, so "what is this
  video" does not depend on the fragile path.

Fragile or against our rules:

- Every keyless transcript path is an undocumented endpoint and breaks when YouTube changes it; some pin a client version that goes
  stale. From a home IP it mostly avoids the cloud-IP ban (README of jdepoix says cloud IPs are blocked), so a hub in a house is
  the favourable case. Fetching one video on request is close to what a person does; a crawl is not (survey section 3, item 6).
- Proxies (jdepoix suggests rotating residential proxies) are circumvention and every request would leave via a third party: no.
- `yt-dlp` can download video and audio: wider than needed, a tool-level allow list is required (survey section 3, item 2).
- `analyze_video` (TwelveLabs) sends video to a hosted model: refused under rules 7 and 11.
- Search needs the Data API and a key (quota, account): off by default, adult only.

Do not copy: any source, the pinned client version, proxy support.

### 5.5 Improvement items

- [ ] **LRN-YT-1: "what is this video about" from a pasted link, one video, adults and teens first** (M, owner decision O2 first).
  Objective: a transcript tool with the shape above: input `url` (any YouTube form), `lang`; output title and author (from oEmbed),
  language, `is_generated`, text cut at 12 KB with a "cut at minute N" note; typed failure kinds. Files: a new catalog package
  (`getmaipai/catalog`) or `backend/packages/youtube/` per the packaging decision; manifest with `data_sources` for `youtube.com`
  (and `www.youtube.com/oembed`), `permissions`, `opt_in` true, `min_role` teen; cache per video id 7 days. Acceptance: a child's
  tools block lacks it; a no-captions fixture says "this video has no captions" (rule 6); a 40,000 character transcript is cut and
  says so; a fixture transcript containing "ignore previous instructions" reaches the model labelled as untrusted data; two
  requests for one id make one outbound call. Out of scope: search, comments, playlists, download, a Whisper fallback. Exit:
  `bash scripts/check.sh` plus the tool-count measurement of THIN-2F. Reuse check: the survey's connector path (an MCP server
  pinned and checksummed) is the default; this item specifies the result shape whichever way it ships.
- [ ] **LRN-YT-2: a family-safe "what is this video" without a transcript** (S, no scraping). Objective: oEmbed only: title, channel
  and a one-line "that is a video from <channel> titled <title>", so a pasted link gets a useful answer when captions are
  unavailable or the transcript tool is off. Files: a manifest and a small handler as above. Acceptance: a private or removed video
  (oEmbed 401 or 404) answers "I can't see that video"; no other endpoint is called. Out of scope: transcripts. Exit:
  `bash scripts/check.sh`. Reuse check: oEmbed is YouTube's documented front door (UNVERIFIED: terms and exact behaviour not fetched
  here). Do first: it is the smallest slice with no terms question beyond what a person's browser does.

## 6. Top 8 improvements

Ranked by value to a family: what people ask daily, then wrong-answer risk, then new reach. S is under a day, M is one to three.

| Rank | Item | Size | Why it ranks here | Blocker |
|---|---|---|---|---|
| 1 | LRN-WX-2 tomorrow, weekend, wind, feels-like, sunrise | M | "will it rain tomorrow" is the commonest weather ask and ours only knows today | none (same host) |
| 2 | LRN-SP-2 a team and a date | M | "did they win last night" is the commonest sports ask; ours has no input at all | none (same host) |
| 3 | LRN-WX-1 name the place, offer the other Portland | S | wrong place is a confident wrong answer | recipe versus handler check |
| 4 | LRN-SP-1 honest status and empty-day reasons | S | a postponed game or a January "not started yet" is a wrong answer; test debt | none |
| 5 | LRN-WX-4 severe-weather alert first | M | a safety value no other item has | new host, opt-in, owner OK for `api.weather.gov` |
| 6 | LRN-NW-1 headline with source and age, real parser | M | removes the Atom blind spot and gives the model "who and when" | check for a Deno-safe parser |
| 7 | LRN-MU-1 right artist or ask which | S | same-name artists today give a confident wrong answer | none (same host) |
| 8 | LRN-YT-2 then LRN-YT-1 pasted-link video answers | S then M | the only new reach, families paste links daily; start with oEmbed | owner decision O2 for the transcript half |

Next after these: LRN-WX-3 (units), LRN-MU-2 (songs and albums), LRN-NW-2 (topics), LRN-SP-3 (innings and start times),
LRN-NW-3 (conditional GET), LRN-MU-3 (retry), LRN-SP-4 (second league, owner decision on undocumented ESPN).

## 7. Cross-tool patterns worth one shared rule

- **An empty or failed result carries a kind**, not a bare empty: found nothing, off-season, down, blocked. All five tools do this
  better in the field (sports `reason`, GDELT notice, youtube blocked errors) and it is rule 6's input.
- **Name what was matched** (place, team, artist, feed) so the model can confirm or offer the next one.
- **Cache by what changes** and put the full request in the key (music 24 h, weather 15 to 30 min, transcript per id).
- **Bound the answer in bytes** and say when it was cut.
- **Mark third-party text as untrusted data** in every result a child could reach (rule 7).
- **Send units, language and zone to the source** rather than converting afterward.

## 8. Could not verify

- Every upstream terms page: ESPN, MLB, MusicBrainz, Open-Meteo, NWS, Google News, YouTube, oEmbed, GDELT.
- Stars and dates are from repo pages read through a summarising fetcher. Exact day for ma2za (Sep 2026), jmanek and the
  last-commit year for guillochon/mlb-api-mcp were not seen.
- Whether MLB returns a postponed game as `abstractGameState: Final` and whether `score` is then absent (from the agent's reading
  of cyanheads' source, not a live call).
- Whether any Open-Meteo geocoding row always carries `admin1` and `population`; the `inc` strings for MusicBrainz lookups; the
  current MusicBrainz `score` and `disambiguation` shapes from a live payload.
- Whether `recipe.json` can branch or rank (WX-1), whether `host.fetch` passes `ETag` validators (NW-3), the per-host pace value in
  `packageHost.ts`, and whether a household unit setting exists.
- NPR per-topic feed URLs; any Deno-compatible feed parser; chubin/wttr.in, Pirate Weather, Home Assistant integrations, nba_api,
  balldontlie, football-data.org, openf1, sportsdataverse, Discogs, TheAudioDB, ListenBrainz and Last.fm wrappers (not read).
- Nothing was run or installed; no repo's code was executed.
