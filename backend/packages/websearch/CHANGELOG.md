# Changelog

All notable changes to the Web Search package, in [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format.

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
