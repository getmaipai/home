# Changelog

All notable changes to the Web Search package, in [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format.

## [0.3.0] - 2026-10-09

### Added

- The optional `scope` argument (`reference` or `web`; leave it out for both),
  set by the model (KS-02). `reference` searches the household's offline
  library only and sends nothing off the machine. `web` searches the live
  web, limited to the last month when the words name no year, with the
  library's article as a lead when it matches. Library rows are labelled
  with their source, licence and snapshot date.

### Changed

- The tool description names the kinds of need each scope is for.
- The `wikipedia` privacy row is now `wikimedia-live`: the live Wikipedia
  call happens only for an adult's search that the web and the offline
  library both failed to answer. The household setting
  `search.wikipedia_fallback` stays as its off switch: a household that turned
  it off still never has the live call made (KS-02-PRIV).

## [0.2.6] - 2026-10-06

### Removed

- The `category` argument. The chat turn never used it (it was stripped
  before the search ran since LIVE-0923-01), so it only cost tool tokens and
  invited a wrong value. Pictures in answers now come from the separate
  `show_images` tool (ANSWER-IMG-02), which reads SearXNG's image rows with
  the same row fields.

## [0.2.5] - 2026-10-03

### Changed

- The description the model reads now says to search for release dates,
  casts, prices and news instead of answering from memory, and the
  search-words argument says a follow-up like "is he in it" is about the
  previous message's subject. Measured live on the 8B chat model: a follow-up after a search
  turn went from 0 of 5 searches to 5 of 5.

## [0.2.4] - 2026-10-03

### Changed

- THIN-4C: for a child or teen, the result rows and the page text pass
  the deterministic safety floor before the model sees them (the
  prompt-injection detector included). Anything that trips a detector is
  dropped and counted as `floor_dropped`.

## [0.2.3] - 2026-10-03

### Changed

- THIN-4A: a search reads up to three of the result pages and hands the
  model their text as numbered sources (`pages` beside `rows`), falling
  back to the snippet for a page that will not load. The tool and
  argument descriptions now say a search is a general web search by
  default (pictures only on request) and that Home reads the pages
  itself. The `page` data source row now names the result pages.

## [0.2.2] - 2026-09-24

### Added

- A second front door when your SearXNG instance is down or a search
  finds nothing: Wikipedia's own official API, the same search words
  and nothing else, on by default and controlled by a setting under
  web search (`search.wikipedia_fallback`) - `data_sources` gains its
  own "wikipedia" row for the privacy page.

## [0.2.1] - 2026-09-23

### Changed

- `args.properties.expression` gains `search_text: true` (GROUND-01,
  home/docs/plans/turn-machine-state-record-2026-09-22.md): the policy
  node's grounding check now reads this mark to know which fields are a
  household member's own free-text query, so `category` (the manifest's
  own fixed `"images"` enum value) and `read_page` (a boolean) stop
  being checked for term overlap against the utterance - they never
  could pass that check on their own, since neither is something a
  person actually said. This is what a live run caught refusing every
  real search whose call included `category`.

## [0.2.0] - 2026-09-15

### Changed

- The recipe no longer builds the answer itself: it returns the search
  rows and a `synthesis_hint`, and the hub's composer (CHAT-16) phrases
  the answer in the same completion it uses for every other tool result,
  so a search costs one composition and never a third model call in the
  turn. The rows still carry the sources shown under the reply.

## [0.1.0] - 2026-09-06

### Added

- Searches the web (session-d-packages-and-store.md step 7), via a
  household-run SearXNG instance (`search.searxng_url`,
  `host.integration.call("searxng", "search", ...)`) and the household's
  own local chat model (`llm_complete`) to turn raw results into a real
  answer. Bring-your-own-instance, not a bundled sidecar: research into a
  cross-platform, zero-dependency bundled SearXNG (the way `llama-server`
  is downloaded and pinned per-platform) found no clean path - SearXNG
  has no official prebuilt binary for any OS, only Docker or a
  from-source install with real per-OS build dependencies, notably worse
  on Windows. See `backend/src/settings/searchKeys.ts`'s own header.

### Considered and rejected: a scraping fallback

- Explored adding `duck-duck-scrape` (npm) as an automatic fallback for
  when SearXNG isn't configured or unreachable (offline robot, hub's
  instance down) - the TypeScript/Deno-compatible equivalent of Python's
  `ddgs`, since Tier 1 packages on the hub only run Deno. Tested for
  real: both a direct request to DuckDuckGo's own HTML endpoint and the
  real `duck-duck-scrape` library's own request logic were bot-blocked on
  the very first call, cold, from a fresh IP - a CAPTCHA challenge and
  "DDG detected an anomaly... you are likely making requests too
  quickly," respectively. A "fallback" that fails on first contact isn't
  a safety net, so this was dropped rather than shipped. Revisit only if
  a genuinely reliable, ToS-compliant option turns up (a real free-tier
  search API, not scraping) - not a re-litigation of the same technique.
  websearch stays SearXNG-only: unreachable or unconfigured says so
  plainly, the same honest "isn't set up yet" shape every other
  integration in this codebase already gives.

### Fixed

- A real, confirmed routing collision code review found:
  `routing.patterns` originally included `"look up * online"`, which
  also matches `music`'s own `"look up the artist *"` (e.g. "look up the
  artist Radiohead online") - `music` wins the tie (sorts first by id)
  and captures "Radiohead online" as a polluted artist name, so the
  utterance never reaches `websearch` at all. Dropped; a routing-corpus
  row guards against re-adding it.
- A real prompt-injection surface: raw SearXNG result text (a title or
  snippet from an arbitrary, household-uncontrolled web page) was
  spliced directly into the `llm_complete` prompt with no delimiter and
  no "treat as data" framing, reachable by `min_role: child` with no
  safety-classifier pass on `llm_complete`'s own output today (a
  cross-cutting gap this step's own `llm_complete` step surfaces for the
  first time, not something this one package can close - see
  `docs/dev/session-d.md`'s step 7 entry). Hardened the prompt with
  explicit begin/end markers and an instruction to treat everything
  between them as untrusted reference data, never as a command, and
  capped each result field's length before it reaches the prompt at all
  (`formatSearxngResults`'s own `SEARXNG_FIELD_MAX_CHARS`) - real
  mitigation, not a guarantee, absent a safety-classifier pass on this
  step's own output.
- `searxngSearch` retried its single GET the same way
  `getHomeAssistantState` does, doubling its own worst case to ~20s on
  top of `llm_complete`'s own inference time in the same recipe. A slow
  SearXNG round trip (it fans a query out to several real engines and
  waits on the slowest) is a real answer taking a while, not the
  transient blip a retry is meant to paper over - retrying it just waits
  twice as long for the identical result. No retry now.
