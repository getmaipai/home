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
