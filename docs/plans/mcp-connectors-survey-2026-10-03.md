# MCP connectors survey: can maintained tools replace ours?

Research work order, cloud lane R, 2026-10-03. Research only, no code changes. Status: proposal for the owner. Nothing here
changes a rule in [docs/design/RULES.md](../design/RULES.md).

Question from the owner: can existing, maintained tools from the internet (a sports tool, a music tool, a YouTube tool) be
downloaded and used instead of writing our own?

Short answer: yes for tools where we have no code today (YouTube transcripts, calendar, Home Assistant, offline encyclopedia).
No for the tools we already have: weather, sports, music, news and websearch are one plain GET each against the same hosts the
maintained servers call, and ours already carry the household gates.

## How to read the evidence

- Every row cites a URL. `UNVERIFIED` means the fact could not be confirmed. The fetch proxy blocked modelcontextprotocol.io,
  npmjs.com, Glama, PulseMCP, Smithery, home-assistant.io, open-meteo.com, developer.spotify.com, musicbrainz.org and
  newsapi.org, and returned 403 on the GitHub REST API. Terms-of-service rows therefore rest on READMEs and third-party summaries.
- A date marked "year UNVERIFIED" came back from a repo page without a year. Several of those repos need Node 22+ or MCP SDK v2,
  which suggests 2026, but re-check the releases page before relying on one.
- The page fetcher summarises with a small model, so a star count or version is secondary evidence, not a quote.
- `getmaipai/.github` (org CLAUDE.md, STACK.md, PACKAGES.md) is outside this session's allowed repositories and was not read. The
  org rules (rule 6 "prebuilt over hand-built", copyright sole ownership, "download don't vendor", "we behave as the user would")
  are taken from the work order, not checked against their source.

## 1. The MCP ecosystem

### What Home already has

- `backend/package.json:22` depends on `@modelcontextprotocol/sdk ^1.30.0`.
- `backend/src/lib/denoHost.ts` already runs the SDK `Client` over `StdioClientTransport` under Bun, one warm Deno process per
  Tier 1 package, with `--allow-read` and `--allow-write` on the package's own folder, no env, no net (`buildDenoRunArgs`,
  line 118). The package is the MCP server, its `handle` tool is what the hub calls, and `host.fetch` comes back to the hub as a
  server-to-client request, so network permission, rate limit, SSRF and cache rules sit in `packageHost.ts`.
- `backend/src/lib/sidecars.ts` supervises background processes (spawn, health poll, restart with backoff, Repairs issue), and
  `kiwixSidecar.ts` shows the pinned, checksummed download pattern.
- docs/dev.md lists "Tier 1 (Deno sandbox, MCP)" as deferred in the package-host slice, but the Tier 1 host under Deno with real
  MCP shipped in Session D (docs/dev.md around line 10506). What is missing is Home as a client to third-party MCP servers.
- Home's packages have no MCP client for outside servers today, and docs/BACKLOG.md has an open item "Speak MCP for local tools
  inside the hub" (docs/dev.md line 7502, decision first).
- THIN-2F (docs/BACKLOG.md line 82) already plans "offer the tools of every installed, enabled and permitted package", with a
  measurement of how many tools Qwen3-8B chooses well among (10, 20, 30). A connector's tools would arrive through that path.

### Client library

| Item | Finding | Source |
|---|---|---|
| Package | `@modelcontextprotocol/sdk` v1 line, latest 1.32.0 (published 2026-10-02) | [npm registry](https://registry.npmjs.org/@modelcontextprotocol/sdk/latest) |
| v2 | Split into `@modelcontextprotocol/client`, `server`, `node`; v2.3.0 released 2026-10-02; implements spec 2026-07-28; needs Node 20+ | [releases](https://github.com/modelcontextprotocol/typescript-sdk/releases), [client package](https://registry.npmjs.org/@modelcontextprotocol/client) |
| v1 support | Repo says v1 gets fixes for at least 6 months after the v2 release | [repo](https://github.com/modelcontextprotocol/typescript-sdk) |
| Licence | v1.32.0 on npm is MIT. v2 declares Apache-2.0, with MIT text kept for earlier contributions. Both permit linking into an AGPL program | [npm](https://registry.npmjs.org/@modelcontextprotocol/sdk/latest), [releases](https://github.com/modelcontextprotocol/typescript-sdk/releases) |
| Maintainer, stars | `modelcontextprotocol` GitHub organisation, 13.5k stars | [repo](https://github.com/modelcontextprotocol/typescript-sdk) |
| Transports | stdio and Streamable HTTP in the README. Legacy SSE in v2: UNVERIFIED | [repo](https://github.com/modelcontextprotocol/typescript-sdk) |
| Bun | README says Node, Bun and Deno. One report of a 15 s transport start on Bun against 130 ms on Node (open or closed: UNVERIFIED). Home already runs the stdio client under Bun in `denoHost.ts`; this session did not run it | [repo](https://github.com/modelcontextprotocol/typescript-sdk), [bun#22396](https://github.com/oven-sh/bun/issues/22396) |
| Known stdio bugs | `close()` leaves orphaned grandchild processes; an unread stderr pipe can deadlock; transport errors surface only as "Connection closed" | [#2023](https://github.com/modelcontextprotocol/typescript-sdk/issues/2023), [PR #2921](https://github.com/modelcontextprotocol/typescript-sdk/pull/2921), [#2775](https://github.com/modelcontextprotocol/typescript-sdk/issues/2775) |

Recommendation: stay on v1 (bump the pin from 1.30.0 to 1.32.0 when the first connector lands). Move to v2 as its own slice after a
Bun test of the stdio client. Home pins a tag, so the v2 move is a deliberate pin bump, not a drift.

### Registry and directories

- **Official MCP Registry**: `https://registry.modelcontextprotocol.io`, API frozen at v0.1 since October 2025, labelled preview;
  whether it is GA now is UNVERIFIED. `GET /v0.1/servers?search=&version=latest` lists servers. Publishing needs GitHub OAuth,
  OIDC, DNS or HTTP proof, so it proves namespace ownership only. No code signing or review is evidenced.
  [repo](https://github.com/modelcontextprotocol/registry),
  [API doc](https://github.com/modelcontextprotocol/registry/blob/main/docs/reference/api/official-registry-api.md).
- **modelcontextprotocol/servers**: 7 active reference servers (Everything, Fetch, Filesystem, Git, Memory, Sequential Thinking,
  Time). 12 are archived in `servers-archived` (Brave Search, GitHub, Google Maps, Google Drive, GitLab, PostgreSQL, Slack,
  SQLite and others). The README calls them educational, not production-ready.
  [repo](https://github.com/modelcontextprotocol/servers).
- **awesome-mcp-servers**: [punkpeye/awesome-mcp-servers](https://github.com/punkpeye/awesome-mcp-servers), 95.8k stars, MIT.
  A curated list, no code review. Whether it is the largest list: UNVERIFIED.
- **Glama, PulseMCP, Smithery**: blocked, so what each offers and any security scanning is UNVERIFIED.

None of these is a trust source. Home would pin a specific version and checksum itself (section 3).

### Mapping MCP tools to llama-server

- An MCP `tools/list` entry has `name`, `description`, `inputSchema` (JSON Schema, 2020-12 by default), optional `title`,
  `outputSchema` and `annotations`. Names are 1 to 128 characters of `A-Za-z0-9_-.`, and clients should prefix with a server
  identifier because names are not unique across servers.
  [spec tools page](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/server/tools.mdx).
- llama-server takes OpenAI-style tools: `{type:"function", function:{name, description, parameters}}`. The mapping is
  `inputSchema` into `parameters`, `name` prefixed (for example `youtube__get_transcript`), `description` copied. No document
  states this mapping as a standard, it is client work. It needs `--jinja`.
  [llama-server README](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md).
- OpenAI's 64-character, `^[a-zA-Z0-9_-]+$` name limit: UNVERIFIED (not fetched). Home should enforce the stricter of the two
  (replace `.`, cap at 64) and keep a table from the wire name back to server and tool.
- **Schema sanitising is required.** llama.cpp converts the schema to a grammar and has open bugs: `patternProperties`
  unsupported, nested `$ref` broken, `\d \w \s` in `pattern` fail, typeless nodes fail, and a failed grammar parse can fall
  through to unconstrained output. A real MCP filesystem server broke on this.
  [#22314](https://github.com/ggml-org/llama.cpp/issues/22314), [#19716](https://github.com/ggml-org/llama.cpp/issues/19716),
  [#19051](https://github.com/ggml-org/llama.cpp/issues/19051), [#17574](https://github.com/ggml-org/llama.cpp/issues/17574).
  Home should flatten each schema to a small subset (object, string, number, integer, boolean, enum, required) and drop the rest.
- llama.cpp has its own MCP support: experimental stdio via `--mcp-servers-config`, and `--ui-mcp-proxy` only proxies the browser
  to a remote server. This is not usable for Home: rule 2 makes the engine the implementation for what it returns, but Home must
  own which tools a person sees, so Home stays the MCP client. Source: same README. Not cross-checked with a second source.
- **Annotations are untrusted.** The spec says clients MUST treat annotations (`readOnlyHint`, `destructiveHint`, `openWorldHint`)
  as untrusted unless the server is trusted, and should show tool inputs before calling. Same tools page. The separate security
  best-practices page returned 404, so its prompt-injection guidance is UNVERIFIED.
- Authorization for remote servers (OAuth) in spec 2026-07-28: UNVERIFIED, page not fetched.

## 2. Candidate servers

Columns: repo, licence, last release, stars, runtime, key, what leaves the house, terms concern. Stars and dates are from the repo
and releases pages named in each row's link.

### Weather, sports, music, news

| Need | Candidate | Licence | Last release | Stars | Runtime | Key | Leaves the house | Terms concern |
|---|---|---|---|---|---|---|---|---|
| Weather | [cmer81/open-meteo-mcp](https://github.com/cmer81/open-meteo-mcp) | MIT | v2.5.2, Oct 3 (year UNVERIFIED) | 69 | Node 22+ | none | place and coordinates to `*.open-meteo.com` | README says free for non-commercial use; terms page blocked, UNVERIFIED |
| Weather | [weather-mcp/weather-mcp](https://github.com/weather-mcp/weather-mcp) | MIT | npm 1.33.0 (snippet, repo date UNVERIFIED) | 48 | Node 18+ | none | NOAA, Open-Meteo, MET Norway and others | README cites 10,000 requests a day |
| Weather (US) | [cyanheads/nws-weather-mcp-server](https://github.com/cyanheads/nws-weather-mcp-server) | Apache-2.0 | v0.10.0, date UNVERIFIED | 1 | Node 24+ or Bun | none | coordinates to `api.weather.gov`, needs a User-Agent | US government service, US only |
| Sports | [cyanheads/sports-mcp-server](https://github.com/cyanheads/sports-mcp-server) | Apache-2.0 | v0.2.3, Sep 30 (year UNVERIFIED) | 2 | Bun or Node 24+ | none | ESPN site API, MLB StatsAPI, TheSportsDB | ESPN endpoints are undocumented and reverse-engineered; ToS text not fetched, UNVERIFIED |
| Sports (MLB) | [retr0h/mlb-mcp](https://github.com/retr0h/mlb-mcp), [guillochon/mlb-api-mcp](https://github.com/guillochon/mlb-api-mcp) | MIT, MIT | no releases | 0, 59 | Go, Python 3.10+ | none | `statsapi.mlb.com` | MLB notice not fetched, UNVERIFIED; widely cited as individual non-commercial use |
| Music, local | [Blakeem/Navidrome-MCP](https://github.com/Blakeem/Navidrome-MCP) | AGPL-3.0 | v2.3.0, Aug 26 (year UNVERIFIED) | 90 | Node 20+ | Navidrome login | your Navidrome; optional Last.fm, LRCLIB, Radio Browser | AGPL, see section 3 |
| Music, local | [gamoutatsumi/mpd-mcp-server](https://github.com/gamoutatsumi/mpd-mcp-server) | MIT | none | 1 | Go 1.24+ | none | local MPD only | none seen |
| Music, local | [jaredtrent/jellyfin-mcp](https://github.com/jaredtrent/jellyfin-mcp) | MIT | release date UNVERIFIED | 36 | Go binary | Jellyfin key | your Jellyfin | none seen; no Plex server found |
| Music, Spotify | [marcelmarais/spotify-mcp-server](https://github.com/marcelmarais/spotify-mcp-server) | UNVERIFIED | none | 472 | Node | Spotify OAuth app; README says Premium | Spotify Web API | no licence shown (blocks bundling); 2026 API restrictions UNVERIFIED |
| Music, metadata | [cyanheads/musicbrainz-mcp-server](https://github.com/cyanheads/musicbrainz-mcp-server) | Apache-2.0 | v0.1.8, Sep 22 (year UNVERIFIED) | 1 | Bun or Node 24+ | none | `musicbrainz.org`, `coverartarchive.org` | self-limits to about 1 request a second; terms page blocked, UNVERIFIED |
| News | [lionkiii/rss-feeds-mcp](https://github.com/lionkiii/rss-feeds-mcp) | MIT | UNVERIFIED | 4 | Node | none | only feeds you list | none; tiny repo |
| News | [moltrus/google-news-mcp](https://github.com/moltrus/google-news-mcp) | MIT | none | 2 | Python | none | Google News RSS, article sites | unofficial endpoint, UNVERIFIED |

### YouTube

| Candidate | Licence | Last release | Stars | Runtime | Key | Leaves the house | Terms concern |
|---|---|---|---|---|---|---|---|
| [kimtaeyoon83/mcp-server-youtube-transcript](https://github.com/kimtaeyoon83/mcp-server-youtube-transcript) | MIT | UNVERIFIED | 598 | Node 18+ | none for transcripts | the video id to YouTube from the home IP; `analyze_video` calls TwelveLabs and must stay off | scraping, not the official API; YouTube terms not fetched, UNVERIFIED |
| [kevinwatt/yt-dlp-mcp](https://github.com/kevinwatt/yt-dlp-mcp) | MIT | v0.9.0, May 20 (year UNVERIFIED) | 286 | Node 18+ plus yt-dlp | none | YouTube, direct | same; also downloads video, a wider tool than needed |
| [BK927/youtube-research-mcp](https://github.com/BK927/youtube-research-mcp) | MIT | no tags | 0 | Node 24+ | optional Google Data API key | YouTube, Google if keyed | official API route, no transcripts of other people's videos |

### Search, fetch, calendar, maps, home, recipes, knowledge

| Need | Candidate | Licence | Last release | Stars | Runtime | Key | Leaves the house | Terms concern |
|---|---|---|---|---|---|---|---|---|
| Fetch | [servers/src/fetch](https://github.com/modelcontextprotocol/servers/tree/main/src/fetch) | MIT | monorepo 2026.8.31 | 91k (monorepo) | Python | none | target pages only; can reach private IPs | reference code, not production |
| Search | [ihor-sokoliuk/mcp-searxng](https://github.com/ihor-sokoliuk/mcp-searxng) | MIT | v2.5.0, Sep 29 (year UNVERIFIED) | 1.3k | Node 22+ | none | your SearXNG, which queries engines | engines may block SearXNG |
| Search | [brave/brave-search-mcp-server](https://github.com/brave/brave-search-mcp-server) | MIT | v2.1.4, Sep 17 (year UNVERIFIED) | 1.5k | Node 22+ | Brave key | every query to Brave | remote; terms not fetched |
| Search | [tavily-ai/tavily-mcp](https://github.com/tavily-ai/tavily-mcp), [exa-labs/exa-mcp-server](https://github.com/exa-labs/exa-mcp-server) | MIT, MIT | UNVERIFIED | 2.4k, 5.1k | Node or remote | key or OAuth | every query to the vendor | remote; terms not fetched |
| Browser | [microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp) | Apache-2.0 | v0.0.83, Sep 28 (year UNVERIFIED) | 37.8k | Node 18+ | none | sites browsed | anti-bot blocks; wide tool surface |
| Calendar | [ni-c/caldav-mcp](https://github.com/ni-c/caldav-mcp) | MIT | UNVERIFIED | 0 | Node 22+ | CalDAV login | your CalDAV server only; read only, treats events as untrusted | young repo |
| Calendar | [gelse/caldav-mcp](https://github.com/gelse/caldav-mcp) | MIT | v0.1.0, date UNVERIFIED | 5 | Python 3.13 | optional key plus CalDAV login | your CalDAV server; 14 tools including delete | write tools |
| Calendar | [nspady/google-calendar-mcp](https://github.com/nspady/google-calendar-mcp) | MIT | v2.7.0, Sep 28 (year UNVERIFIED) | 1.2k | Node 20+ | Google OAuth | Google Calendar API | remote account |
| Maps | [cyanheads/openstreetmap-mcp-server](https://github.com/cyanheads/openstreetmap-mcp-server) | Apache-2.0 | 0.6.0, date UNVERIFIED | 5 | Bun or Node 24+ | none | Nominatim and Overpass | spaces calls 1,050 ms, sets `OSM_USER_AGENT`; policy page not fetched |
| Maps | Google Maps Grounding Lite ([docs](https://developers.google.com/maps/ai/grounding-lite)) | UNVERIFIED | hosted | n/a | remote | API key or OAuth | queries to Google | the reference google-maps server is archived |
| Home | Home Assistant built-in MCP server ([code](https://github.com/home-assistant/core/tree/dev/homeassistant/components/mcp_server)) | Apache-2.0 (from memory, UNVERIFIED) | since HA 2025.2 (snippet, UNVERIFIED) | n/a | runs in HA | OAuth via HA auth; token support UNVERIFIED | nothing leaves the LAN | only entities exposed to Assist are reachable (snippet, docs page blocked) |
| Home | [homeassistant-ai/ha-mcp](https://github.com/homeassistant-ai/ha-mcp) | MIT | v7.3.0, date UNVERIFIED | 4.9k | Python 3.11+ | webhook secret, OAuth or HA auth | LAN only; about 87 tools including config edits | far wider than a household needs |
| Home | [voska/hass-mcp](https://github.com/voska/hass-mcp) | MIT | UNVERIFIED | 344 | Python 3.13 | long-lived HA token | LAN only | token has full HA rights |
| Recipes | [Traves-Theberge/mealdb-mcp](https://github.com/Traves-Theberge/mealdb-mcp) | MIT | UNVERIFIED | 1 | Node 18+ | none | TheMealDB | free tier is for development; terms not fetched |
| Knowledge | [cameronrye/openzim-mcp](https://github.com/cameronrye/openzim-mcp) | MIT | v3.3.4, 2026-09-18 | 144 | Python | none | nothing (stdio, local ZIM files) | none seen |
| Knowledge | [roanpy/kiwix-mcp](https://github.com/roanpy/kiwix-mcp) | GPL-3.0-or-later | none | 1 | Python 3.12+ | none | nothing at query time | GPL, links libzim |
| Knowledge | [Rudra-ravi/wikipedia-mcp](https://github.com/Rudra-ravi/wikipedia-mcp), [wmde/WikidataMCP](https://github.com/philippesaade-wmde/WikidataMCP) | MIT, BSD-3-Clause | UNVERIFIED | 297, 34 | Python | none | `*.wikipedia.org`, or Wikimedia Cloud for the hosted Wikidata server | none seen |

Not researched: Spoonacular (any MCP server, terms), NewsAPI terms, Plex. OpenAPI-described tools were not surveyed beyond noting
that the documented direct APIs (NWS, Open-Meteo, MusicBrainz, MLB StatsAPI) are what our bundled packages already call.

## 3. Conflicts for the owner to decide

These are reported, not decided.

1. **Privacy, remote servers.** A hosted MCP server (Tavily, Exa, Google Maps Grounding Lite, the hosted Wikidata server) receives
   every query the model makes. Brave, Tavily and Exa are keyed remote services. This breaks "nothing leaves the house by
   default" unless each is opt-in with a `data_sources` entry, as `sports/manifest.json` already does for MLB, and off for a
   child or teen (the same rule 7 applies to a hosted search provider). A local stdio server is not a local-only server: most
   candidates above call a public API from the home IP. The manifest's `permissions` (`net:<host>`) is the honest statement of
   what leaves.
2. **Safety, child access.** Rule 0 outranks everything: a child must never reach a tool the household did not allow. MCP
   `annotations` are server-supplied and untrusted (spec), so they cannot decide who may call a tool. The household's per-person
   allow list must be the only gate, applied when the tools block is built (THIN-2F), not when a call arrives. A model with no
   measured record keeps the no-tools fail-safe for minors (rule 8). Servers with wide surfaces (Playwright, ha-mcp's config edits,
   yt-dlp downloads, gelse's delete) need a tool-level allow list, not a server-level one.
3. **Safety, untrusted results.** A tool result is data, and a web page, calendar entry, video transcript or recipe can carry a
   prompt injection. Rule 7 already states "page text is data, never instructions" and runs a deterministic floor before text
   reaches the model for a minor. MCP results must take the same path. ni-c/caldav-mcp treats calendar text as untrusted and
   has no write tools, which is the posture to prefer. A read tool and a write tool in one conversation is the exfiltration
   shape the spec warns about, so the offered set should not mix them without a consequential-action confirm.
4. **Supply chain.** Our rule is download, don't vendor, signed, pinned and checksummed. The registry proves namespace ownership
   only, and stars are not review. Candidates are mostly small repos (0 to 90 stars) of a single maintainer, several with no
   release tag, so there is nothing to pin except a commit. Home would need to pin a version plus the package manager's content
   hash, check it before each launch, and run offline after install (as `--cached-only` does for Deno today), so a server cannot
   update itself. Whether Home signs a connector's manifest itself, or the catalog (`getmaipai/catalog`) does, is a decision.
5. **Licence.** AGPL (Navidrome-MCP) and GPL (kiwix-mcp) servers run as separate processes and talk to Home over stdio, so they
   are separate works communicating over a protocol, not linked code. The SDK (MIT or Apache-2.0) would be linked. That reading
   needs the owner's or counsel's sign-off against the copyright-sole-ownership rule. No licence shown (Spotify server) means no
   right to run it in a product.
6. **Terms of service.** "We behave as the user would." YouTube transcript and yt-dlp servers scrape unofficial endpoints, and
   the ESPN endpoints are undocumented. A person watching YouTube does not fetch captions for thousands of videos; a one-video
   fetch on request is close to what the user would do, a crawl is not. Both need the owner's call, and none of the upstream terms
   pages were readable here.
7. **Rule 11, model runners.** A tool is not a model runner, so a connector that holds no model is allowed under the same
   reasoning that allows SearXNG. Two edges need a ruling: an MCP server that calls an LLM itself (some search and summary
   servers do, and the MCP "sampling" feature lets a server ask the client's model), and Home advertising the `sampling`
   capability. Recommendation for the owner to confirm: Home never advertises sampling, and any server whose tool calls a hosted
   model is refused under rule 11 as well as rule 7.
8. **Rule 1 and tool count.** Tools are offered with `tool_choice: "auto"`. Each connector adds tools to the cached prompt prefix,
   and the Qwen3-8B cap (10, 20 or 30, THIN-2F's measurement) is not known yet. One server may expose tens of tools, so tool
   filtering to a chosen few per server is part of the design, and the set must stay byte-identical across a conversation.
9. **Operating cost.** Node 22 or 24 (several candidates), Python 3.12 and 3.13 and Go binaries are three more runtimes on the
   household machine, where Home today runs Bun and Deno. The Stack would have to install and own them.

## 4. Recommendation

### Replace nothing we have that works

Keep our weather, sports, music, news, websearch, define, currency, trivia, timer, math, convert, almanac, remind and remember
packages. Each is one documented call, already declares `data_sources` and `net:` permissions, and is tested. A maintained server
for these (open-meteo-mcp, sports-mcp-server, musicbrainz-mcp-server) adds a Node runtime and an unreleased 1 to 69 star repo to
do the same GET. The one real gain is multi-league sports (our `sports` reads MLB only), and that route rests on undocumented ESPN
endpoints. Defer it.

### Adopt first (4 connectors, in order)

1. **YouTube transcripts** (kimtaeyoon83/mcp-server-youtube-transcript). New capability, no code of ours to retire. Adults and
   teens only, transcript tool only (`analyze_video` removed), one video per request. Owner decision on terms (section 3, item 6).
2. **Home Assistant's own MCP server** (built-in, LAN only). Replaces `lights-on`, `lights-off` and `lock-doors` when a household
   runs Home Assistant. Reach is limited by Assist's exposed-entities list, which matches rule 0. Locks stay consequential.
   Confirm the auth mode against the HA docs first (blocked here).
3. **Offline encyclopedia** (openzim-mcp, newest release of the knowledge servers, nothing leaves the house). Overlap: Home
   already serves ZIM files through its own `kiwix-serve` sidecar and a `knowledge` package. Adopt only if the model gains
   something (article search and section reads) that our sidecar API does not give. Otherwise skip, and this becomes the
   cheapest item to drop.
4. **Calendar, read only** (ni-c/caldav-mcp against Radicale or Nextcloud). No code of ours today. Young repo (0 stars), so treat
   it as a pattern, and be ready to write a small CalDAV package instead.

Not adopted: Spotify (no licence shown, Premium needed), Brave, Tavily, Exa, Maps Grounding Lite (queries leave the house),
Playwright, ha-mcp (surface too wide), mcp-searxng and the fetch server (our websearch already does both with the rule 7 gates).

### How Home hosts them

- **Child processes of Home, supervised by the existing sidecar machinery** (`sidecars.ts`), started on first use and killed after
  idle, as `denoHost.ts` does. Not child processes of the Stack: these are tools, not models or engines, and per-person
  permission lives in Home.
- **One MCP client manager** generalising `denoHost.ts`'s `Client` plus `StdioClientTransport`, over SDK v1.32.0, with a `connector`
  package kind: manifest names server command, pinned version and checksum, the `net:` hosts it may reach, `data_sources`, and the
  tool allow list.
- **Sandbox**: untested here, so a proposal. Run Node servers under Deno (`deno run --allow-net=<declared hosts>
  --allow-read=<own dir> npm:<pkg>`), so the manifest's `net:` list becomes the real egress rule. Whether each candidate runs under
  Deno's npm compatibility is UNVERIFIED. The fallback is a plain child process with env stripped and loopback-only listening,
  which does not enforce egress, so the allow list becomes a policy and not a wall.
- **Per-person permission**: a connector's tools enter THIN-2F's offered set only if the package is installed, enabled, allowed
  for the person's role and age band, and the surface permits it. Schemas are sanitised to the small subset before they reach
  llama-server. Results go through the same data-not-instruction wrapper and floor as search pages.
- **Failure**: a failed or slow connector is a failed tool, so rule 6 applies and the answer still comes.

### Smallest first slice

One connector end to end: YouTube transcripts, adult-only, on a test household. It exercises everything a later connector reuses:
download, checksum, launch, handshake, `tools/list`, schema sanitising, name mapping, per-person filtering, the `data_sources` and
privacy page entry, the result gate, and a failure reply. If the owner prefers a connector with no terms question, the same
slice with Home Assistant's server needs a Home Assistant instance and has no scraping issue.

Acceptance sketch, for a later work order: a child's tools block lacks the tool; an adult's contains `youtube__get_transcript`;
the same adult asking about a video gets a transcript summary with the source named; killing the server mid-call produces an
honest "the lookup did not happen" reply (rule 6); the tools block is byte-identical across two turns.

### Effort

- Connector kind, client manager, schema sanitiser, name map, supervision, privacy entry: **M** (the first slice, mostly
  generalising `denoHost.ts` and landing THIN-2F's offered-set work, which it depends on).
- Each further connector after that: **S** (manifest, pin, allow list, a test).
- Egress sandbox that truly enforces the `net:` list for non-Deno servers, and a signed connector catalog entry: **L** and a
  separate decision.

### Replaces of our bundled tools

- `lights-on`, `lights-off`, `lock-doors`: replaced by Home Assistant's MCP server, only for households running Home Assistant.
- `knowledge`: possibly, by openzim-mcp, only if it adds reach beyond the kiwix sidecar (item 3).
- Nothing else. `sports`, `music`, `weather`, `news`, `websearch`, `media-lookup` stay.

## 5. Open decisions for the owner

1. Is a connector allowed to reach a public site from the home IP when the household opts in (YouTube, ESPN), given "we behave as
   the user would"?
2. May Home run an AGPL or GPL server as a separate process over stdio (section 3, item 5)?
3. Does rule 11 forbid an MCP server that calls a hosted LLM, and does Home refuse the `sampling` capability?
4. Who signs a connector manifest, Home or the catalog, and how is a version plus checksum pinned for a server that has no release?
5. Stay on SDK v1 until a Bun test passes for v2?
6. Hosted MCP servers (Tavily, Exa, Maps) allowed at all, even opt-in and adult-only?

## Not verified

The upstream terms pages (Open-Meteo, MLB, ESPN, MusicBrainz, Spotify, YouTube, Nominatim, TheMealDB); the Home Assistant MCP
documentation (auth modes, exposure rules, licence, start release); the MCP security best-practices and authorization pages; the
OpenAI 64-character tool-name limit; whether the MCP registry is GA and whether v2 keeps a legacy SSE client; the Bun issue's
current state and the stdio client's startup time on this machine; last-release years for every date marked UNVERIFIED; whether
each Node server runs under Deno with a net allow list; weekly npm downloads; `getmaipai/.github` standards (CLAUDE.md,
STACK.md, PACKAGES.md), which this session could not read.
