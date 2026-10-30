# Search palette: the Web tab (2026-10-30)

Why this exists: the owner's mockup of 2026-10-30 has a Web tab beside All, Chats, Files and Wikipedia. The palette note
([palette-search-2026-10-29.md](palette-search-2026-10-29.md), "Mockup addendum") left it out because an open-web search from
the palette needs the search rules checked. This note is that check and the design. It adds no new outbound endpoint and no new
search engine: the tab is one more way for a person to ask for the web search Home already has.

## Supersedes

- palette-search-2026-10-29: its "Web is not in this slice" and its "Out of scope: web search (the turn engine's)". The turn
  engine keeps its own web search; the palette gains an explicit one that runs the same code. Nothing else in that note changes.
- The backlog remainder "web fall-through" of "Unified search: one palette over everything": closed by WEB-TAB-01 to 04 in the
  explicit form below. A silent fall-through (web results appended when local results are few) is rejected in decision 1.

Unchanged: RULES.md in full. Rule 0 (age and surface gates), rule 1 (the model decides when a chat turn searches; this tab is
the explicit-request path, not a chat turn), rule 7 (page text is data; the tab shows engine snippets and fetches no page),
the household's `search.web_sources` pick, the adult-site host list, and the privacy page's rows.

## What exists today (measured 2026-10-30)

- **One web path.** `webSourcesFor(band, temporary, spoken)` (`lib/retrieval/webSources.ts`) names the sources that may answer a
  band: the household's `search.web_sources` pick (SearXNG by default, ddgs optional), minus sources closed or offline for the
  band. `runWebSources` runs them with an 8 s per-source timeout and `blendWebRows` merges the rows.
- **Minor protections already in code.** `minorQueryHit` (`lib/retrieval/minorQueryCheck.ts`) refuses a child's or teen's query
  that carries the home address, phone numbers, email addresses or household names. `minorRowAllowed`
  (`lib/retrieval/minorRowFloor.ts`) drops rows that fail the minor floor, and the adult-site host list is locked on for every
  child and teen. `resolveSafeSearchLevel` gives the person's SafeSearch level. `minorSearchGate` says whether the web search
  package is allowed and a source is on for a band.
- **Health.** `searxngHealth` and `searchHealthState` already say whether the household's SearXNG answers; the settings
  screen shows them as health rows (RULES.md S6).

## Decisions

1. **Explicit only.** The Web tab sends nothing until the person picks it and presses Enter (or the "Search the web" row).
   Typing in All, Chats, Files, Wikipedia or Home never reaches the web, and the tab never runs per keystroke. Web results are
   never mixed into All or appended when local results are few. This keeps "nothing leaves the house" true for every default
   path and makes each outside query one the person asked for (PRIVACY.md, "Outbound connections are user-serving").
2. **One definition, reused.** A new `GET /api/search/web?q=` calls `webSourcesFor`, `runWebSources` and `blendWebRows`, then
   returns `SearchResult` rows (kind `web`). It is not a provider in `SEARCH_PROVIDERS`, so `GET /api/search` stays fully local.
   No second search client, no second source list, no new setting. The per-source closures `runWebSources` takes are built only
   inside `packageHost.ts` (`webSide`: SearXNG options, `minorBand` for `floorSearchResult`, the guest ddgs filter). WEB-TAB-01
   lifts that into one shared function that the websearch tool and this route both call; the route does not rebuild it, and does
   not call `blendWebRows` again (`runWebSources` already does). The route passes `read_page: false` and
   `allowWikipediaFallback: false`, so it fetches no page (decision 5) and never sends an adult's words to Wikipedia when
   SearXNG fails (decision 7).
3. **Who may use it (rule 0).** An adult with a source on. A child or teen only when the household has web search on for their
   controls (`minorSearchGate`: `gateAllows` and `webOn`), with `minorQueryHit` applied to the query before anything is sent,
   `minorRowAllowed` and the adult-site host list applied to every row, and their SafeSearch level passed to the source.
   A refused query shows the same plain line chat uses, not an error. A guest or unidentified speaker gets no Web tab. The ddgs
   rule is unchanged: for a minor it is only ever a second source beside SearXNG and never on a spoken surface (the palette is
   a screen surface).
4. **What a row shows.** Source label is the result's host; title; the engine's snippet (two lines); an Open action. No thumbnail:
   a picture loaded from a result's host would send the person's address to that site before they chose to visit it. The
   hosted search provider (Brave key, `hostedSearch.ts`) is not used by the tab in this slice; it stays a chat-only optional key.
5. **Open leaves the house by the person's click only.** A row opens in a new tab with `rel="noopener noreferrer"`. The tab
   fetches no page and renders no remote HTML.
6. **Leaves nothing behind.** The query is not stored, not in recents, not in a log line (the registry's typed events carry
   counts and timings, never text; RULES.md rule on logs), and the response is not cached beyond the request. The existing
   `searxng` rate-limit key and per-host pace apply, so a held Enter cannot flood the household's SearXNG.
7. **Status, not errors (RULES.md S6, rule 6).** When the household picked Library only, no source is built, or SearXNG does not
   answer, the tab is shown with a one-line reason and a link to the Search settings page for an admin; it never shows a raw
   error after a click. The reason is a typed field in the route's own response (Library only, no source, not answering), with
   its wording in `lib/failureCopy.ts`; the client never works it out from settings and starts no new polling loop of
   `searxngHealth`. A failed search says web search is not answering and what to do, the same line chat uses.
8. **The look (rule 9).** The tab is a `PaletteTab` on the shipped `command-palette` Element. The Element needs one additive
   prop: a tab that submits on Enter instead of filtering as you type (`PaletteTab.submit`, with the footer reading "Press Enter
   to search the web"). That prop is added in `commons` first, in its own worktree, with a `ui-v0.5.x` tag; only Jesse says yes
   to the tag (PINNING.md). No `className`, no Home wrapper.
9. **Privacy page.** No new outbound endpoint, so the "what leaves the house" table keeps its rows. Its Web search row gains the
   words "and the Search box's Web tab, only when you press Enter on it", in the same commit as the route (PRIVACY.md).

## Rows

- WEB-TAB-01 (backend): `GET /api/search/web` over the existing web path with decision 3's gates; tests for adult, teen with web
  on, teen with web off, child household-name refusal, guest refusal, Library-only, source down, and that `GET /api/search`
  never calls it.
- WEB-TAB-02 (commons): `PaletteTab.submit` on the Element and the Web tab in `HeaderSearch`; tag `ui-v0.5.x` after Jesse's yes.
- WEB-TAB-03 (frontend): Home pins the tag, wires the tab to the route, and shows the S6 reason when off.
- WEB-TAB-04 (docs): the privacy page row, the user doc for Search, `docs/dev` search section. Org `PRIVACY.md` justifies ddgs as a
  search "the person asked for and the model decided to run"; the tab sends it a query no model ran, so that sentence is
  updated in `getmaipai/.github` (Jesse's call on the wording, flagged when the row lands).

## Out of scope

Image or video web results; the hosted Brave provider in the palette; web results in All; query history or "recent searches";
a new search engine or source; fetching result pages.
