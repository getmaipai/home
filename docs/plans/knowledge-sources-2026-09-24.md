# Knowledge sources: offline archives, live sources, and one lookup (2026-09-24)

Status: approved by the owner on 2026-09-24, with the decisions in "The owner's calls" below. Research by the design-resolver pass of 2026-09-24; numbers from Kiwix's public catalog that day.

## Why

When the household's SearXNG was suspended on 2026-09-24, the chat had no second source and answered from the 8B's memory, wrongly. The stopgap (SEARCH-FALLBACK-01, a943f67e) asks Wikipedia online, which sends the question out of the house. The owner wants the family's reference knowledge on its own disk (Kiwix ZIM archives), with live sources still used for what is current, all as catalog packages a household turns on, off and configures. Two constraints shape everything below: the resident 8B chooses between tools badly (home#150; adding one tool broke three rows, dev.md PHRASE-02 and DOC-TOOL-01), and the org rules out word rules for understanding a question.

## The sources

Offline (Kiwix, measured sizes): Wikipedia English all (maxi with images 127.4 GB, 2026-08-25; nopic 52.7 GB, 2026-06-17; mini 14.4 GB, 2026-09-09), Wikipedia top 1M (maxi 49.4 GB), Wiktionary (nopic 9.2 GB), Wikivoyage (maxi 1.1 GB), Wikipedia medicine (maxi 2.2 GB), iFixit (3.6 GB, no full-text index), Stack Exchange DIY, gardening, cooking, parenting and pets (0.1 to 2 GB each), Wikibooks, and Vikidia, a children's encyclopedia (0.08 GB). There is no English wikiHow set today. Gutenberg (221 GB) and video sets belong to apps, not lookup.

Live (already bundled packages): web search (SearXNG), weather, news, MLB scores, currency, definitions, knowledge (Wikipedia online), media lookup (Wikidata), on-this-day. Live Wikipedia is reached from five places today, which breaks one definition, one implementation; it becomes one `wikipedia-live` source.

An archive knows nothing after its snapshot date; live sources are minutes old. Every row a source returns carries its source and date.

## Routing: one lookup, not one tool per source

The model keeps the single search tool it has today. Behind it, `lookup()` (today's `searxngSearch` choke point in packageHost.ts) asks every enabled source the speaker may use, in parallel: the local Kiwix full-text search (loopback, no outbound traffic) and SearXNG, as now. Rows are labelled ("offline copy, 2026-08-25", "web, live"), and the phrasing round prefers the freshest grounded row. Live Wikipedia is asked only when the archive has no title match and SearXNG is down or found nothing, so a question is not sent out twice.

Rejected: one tool per source (the 8B's tool choice fails exactly there), and archive-first (needs a time-sensitivity signal the turn signal does not have; a word rule is not allowed, a learned head is future work and gets measured against this design).

## Packages and Home

Packages run one sandboxed call at a time and cannot run a server, so the line is:

- Home holds the machinery: one shared kiwix-serve sidecar (pinned and checksummed like the engine binaries, watched by the sidecar supervisor, loopback only, excluded from backups), the library manager (find the newest file for a chosen flavour, download with resume, verify against Kiwix's published SHA-256, update with the old copy kept until the new one verifies), `lookup()` and the per-person source policy, a proxy route so a cited local page opens on any device, and the privacy page.
- The catalog holds one package per source. A Kiwix set is a new declarative `reference` kind (no code, like `model` and `voice`), declaring the book, languages, flavours and its settings (on or off, flavour, who may use it). A live source stays a plugin. Each declares its privacy rows and freshness.

Spec additions, first, in commons: the `reference` kind, a `knowledge_source` block (archive or live, book, flavours, freshness), `archive` as a source kind, and a `reference.library_dir` storage key.

Privacy: a ZIM download or update check sends the file name and the home's address to Kiwix and a third-party mirror; web search sends the search words to SearXNG; live Wikipedia sends them only as above; kiwix-serve sends nothing. A household or person set to offline only sends nothing. A child profile's sources follow the package's `min_role` and a per-person setting; the default for a child is Vikidia and no image pages.

## Build order

1. SOURCE-SPEC-01 (S, commons): the spec additions, with round-trip fixtures.
2. KIWIX-SIDECAR-01 (M): kiwix-serve installed, running, watched; a fixture ZIM searchable on loopback.
3. REFERENCE-LIBRARY-01 (M): install a reference package end to end, with resume, hash failure, Updates rows, disk impact in the wizard and the privacy rows.
4. LOOKUP-FED-01 (M, review medium): the federated `lookup()`, `wikipedia-live` replacing the five callers and the fallback key, the per-person policy, the proxy route.
5. LOOKUP-MEASURE-01 (M): a replay set in three groups (evergreen facts, events after the snapshot, how-to) across four arms (today, federated, archive only, SearXNG down): correct and grounded, stale answers on recent rows, latency, outbound requests per turn. The baseline arm runs before item 4 lands.

IMAGE-SEARCH-01 waits for this design. Whether a picture request is a second tool or something the one lookup returns (a picture row beside text rows) is decided when LOOKUP-FED-01 is built, measured on its replay rows.

**Home stays lean (owner's rule, 2026-09-24):** every source and ability here - each Kiwix set, `wikimedia-live`, later the feeds and the Internet Archive - is a catalog package, never source-specific code in Home; `SOURCE-SPEC-01` declares the contracts (the `reference` kind, the `knowledge_source` block, a lookup-source contract a plugin package implements) and `KIWIX-SIDECAR-01` is host machinery, the two exceptions that stay in Home. Full statement in `docs/plans/feeds-and-archive-2026-09-24.md`, "Home stays lean: capabilities live in the catalog."

## What else Kiwix offers, by subject

Measured from Kiwix's catalog (1,301 English entries) on 2026-09-24. "No index" means title lookup only.

- Science: Wikipedia subject sets (physics, chemistry, astronomy, cell biology, 0.5 to 1.8 GB each), Wikispecies 3.4 GB, NASA Astronomy Picture of the Day 16.7 GB, PhET simulations 0.1 GB (no index), LibreTexts (no index).
- Maths: Wikipedia mathematics 1.0 GB, PlanetMath, ProofWiki.
- History: Wikipedia history 2.4 GB, Wikisource 8.6 GB, CIA World Factbook 0.4 GB.
- Cooking and gardening: Stack Exchange cooking and gardening, open recipe sets, Gardenology (each under 1 GB).
- Home repair: iFixit 3.6 GB (no index), Stack Exchange DIY 2.1 GB, Appropedia.
- Health (adult by default): Wikipedia medicine, MedlinePlus 1.9 GB, NHS medicines, CDC travel.
- Programming (teens and up): Python docs 4.0 GB, Stack Overflow 114.9 GB, Super User 4.0 GB.
- Languages: Wiktionary 9.2 GB, Simple Wiktionary, Wikiquote.
- Children: Vikidia, Simple English Wikipedia (0.5 to 3.5 GB), LibreTexts K12, Books Dash picture books 11.7 GB.
- Reference and learning: Wikibooks, Wikiversity, Wikipedia top articles.
- Maps: OpenStreetMap-based maps, USA 16.6 GB, North America 22.7 GB, world 77.7 GB (no index).
- Preparedness: ready.gov 2.4 GB and small survival guides.
- Books (a Books app, not lookup): Gutenberg 221 GB, or by subject.

Left out: Khan Academy (180 GB, last updated 2023), TED (video, not searchable), wikiHow (no English set).

Pictures: there is no Wikimedia Commons set. Offline picture search means searching articles and showing each hit's lead and gallery images with captions (maxi sets carry reduced images; NASA APOD is a captioned picture set). Searching pictures by what they show would need an image index over the Stack's embed and vision roles: a later, separate design. Kiwix's search also takes a location and distance, which gives "near me" lookups for free.

Two bundles: a starter of 34.6 GB (Wikipedia mini, Wiktionary, iFixit, the Stack Exchange home sets, MedlinePlus, Simple English Wikipedia, Wikipedia medicine, Wikivoyage, Vikidia) and a complete set of 231.9 GB (Wikipedia maxi, North American maps, NASA APOD, the Wikimedia sister projects, Python docs, LibreTexts, ready.gov and the starter's sets in full). Gutenberg is a separate choice.

## The Reference app

A modern, private reader so the family has its own offline Wikipedia, iFixit and the rest, replacing Kiwix's dated reader.

- Where it lives: a catalog app package (`reference`) with schema pages, backed by Home routes, since every feature ships as a catalog package and the dev record already names a Reference app. The UI schema needs one addition, spec first: an `article` node (clean HTML, contents, source, date) and a suggest-as-you-type search binding. The owner may prefer a Home page built from shadcndashboard; that is quicker but breaks the package rule.
- Library: installed sets as cards with Kiwix's cover illustrations, flavour, date and size; add a set in a sheet showing the disk impact; multi-select delete.
- Search: the kit's command palette for suggestions as you type, full-text results grouped by set, all sets or one; sets without an index say so.
- Reader: Home fetches the article through Kiwix's public raw endpoint, cleans it on the server with sanitize-html (scripts, styles and foreign classes removed, internal links kept inside the app, images through Home's proxy), and the kit renders it with our own tokens and typography, a contents rail that becomes a drawer on the phone, and images that open large. The one gap no shipped component covers is long-form text styling; the smallest fix is the maintained Tailwind typography plugin mapped to our tokens, named in the design record before any code.
- Special layouts: iFixit guides as step cards and Wiktionary as tabs per language, only where the real ZIM markup allows it (checked first).
- Children: enforced on the server per person. By default a child sees Vikidia, Simple English Wikipedia, Wiktionary, Wikivoyage, PhET, LibreTexts K12 and Books Dash; Stack Exchange and medical sets are adult only; images are hidden for a child unless an adult turns them on.
- Chat: a citation from an offline set opens the reader.

Kiwix endpoints used (kiwix-serve 3.8.2 docs): `/raw` (public), `/search` (public, same-language sets per call), `/catalog/v2` (public), `/suggest` (private: pinned version plus a conformance test).

App build order, after LOOKUP-FED-01: UI-ARTICLE-SPEC-01 (S, the `article` node), REFERENCE-API-01 (M, routes, cleaning, per-person rules), KIT-ARTICLE-01 (M, the reader renderer), REFERENCE-APP-01 (M, the catalog app), REFERENCE-CITE-01 (S, citations open the reader), REFERENCE-LAYOUTS-01 (M, iFixit and Wiktionary layouts, markup checked first).

## The owner's calls (decided 2026-09-24)

1. Sizing is proposed, never fixed: Home measures the chosen drive's free space and the hardware tier, recommends a flavour and bundle with the size impact shown, and the person can pick another. This household takes Wikipedia mini (14.4 GB) and the starter bundle; full Wikipedia is not installed here.
2. Location: the person sets the drive or folder (a local path, an external drive or a NAS mount) in the library settings and in the wizard. Home's data folder is only the default. Moving the library later is supported: files move, and the library records update.
3. Live Wikimedia search is part of the design as a live source package (`wikimedia-live`, covering Wikipedia's and Wikimedia Commons' official APIs). It is used as needed: when the archive has no match, for anything newer than the archive's snapshot, and for pictures, which no Kiwix set covers well. It follows the same privacy rows, limiter and per-person rules as every live source. The online Wikipedia fallback from SEARCH-FALLBACK-01 stays on until LOOKUP-FED-01 replaces it with this package.
4. The Reference app is a catalog app, as recommended.
5. Children: the recommended defaults (child-suitable sets only, pictures off unless an adult turns them on), until the owner says otherwise.
6. Trusting Kiwix's published SHA-256 per file: accepted with the design.
7. Picture search by what a picture shows: later, its own design.

## From the legacy code

The pre-rebuild hub (legacy-backups/home-legacy.git at dbb335f, the same tree as loki-doki, newer) had Kiwix, SearXNG, scrapers, an image proxy and YouTube search. Paths below are in that mirror. What carries over:

Kiwix:
- kiwix-serve names a book after its file name (ifixit_en_all_2024-06), not the ZIM's Name metadata. Use one naming rule everywhere (the old hub's two servers disagreed and every archive returned 404). kiwix-manage 3.8.2 stopped writing name= into library.xml.
- Search is one root endpoint, /search?books.name=<book>&pattern=. /suggest returns value (plain) and label (HTML-escaped): use value.
- The OPDS catalog's q= matches titles, not file names. Wikipedia's entry is wikipedia_en_all and the flavour is only in the file name, so resolve by name and match the link against <name>_YYYY-MM.zim.meta4 (kiwixCatalog.ts). Hardcoded sizes drift; always read the size from the catalog.
- Kiwix purges old kiwix-tools builds, so a pinned binary URL eventually returns 404. The release process re-pins, and a missing pin is a clear repair message, never a silent failure.
- A corrupt ZIM crashes libzim with an uncatchable native error: validate a new file in a separate process before it joins the library (archives.ts).
- Restart kiwix-serve once per batch of installs, never once per file (concurrent restarts killed each other), and stop it by the PID listening on its port.
- The .meta4 file lists every mirror and per-piece hashes. A segmented multi-mirror download was 10 to 40 times faster than one stream (archives.ts, via aria2c). REFERENCE-LIBRARY-01 measures whether to add that.
- Articles: follow in-archive redirects on the server; for the chat's extract, drop References, See also and External links and cap the length (knowledge.ts).

Search, and not getting blocked:
- A 5-minute cache of search results keyed by query, page and safe-search level, never caching an empty result, plus in-flight dedupe. One user action used to fire the same query three times and got engines suspended (webSearch.ts, commit ca1c861c). This belongs with SEARCH-PACE-01 as SEARCH-CACHE-01.
- Safe search by age: child strict, teen moderate, adult off (images at least moderate at every age), and engines without a safe-search setting are skipped for a child or teen. Today's hub sends no safe-search level at all: SEARCH-SAFE-01, a safety item, goes first.
- The page extractor's lessons: a 400-character usefulness floor, lazy images from srcset, an entity-decoding allow-list sanitizer, and the SSRF guard that re-checks every redirect.
- Skipped: scraping Google, Bing and DuckDuckGo (blocked from a home address, and against the third-party rules), and every paywall workaround.

Images: an image proxy (image content only, a size cap, a disk cache, the SSRF check). Cache only permanent misses: a cached Wikimedia 429 hid every photo for a week. Engine thumbnail hosts block hotlinking, so thumbnails go through the proxy. Commons was only ever used by file path; Commons search is new work in wikimedia-live.

Video: the YouTube address wall of 2026-08-28 and its rules (no anonymous traffic while walled, a probe every 6 hours, daily budgets) are already org rules. For knowledge lookups, video links come from SearXNG's video category under the same limiter, with no streaming stack.

Routing: the old two-tier router's documented misroutes (53 fixture cases) seed the LOOKUP-MEASURE-01 replay set. Its lessons stand as "search is always a candidate" and "resolve pronouns from the conversation before searching" (QUERY-WRITER-01).

## Video search (approved 2026-09-24)

`MEDIA-SEARCH-01` merges `IMAGE-SEARCH-01` and video into one item.
Results come from SearXNG's videos category through the one `lookup()`,
its limiter and its cache - the hub never downloads a video. The card
is a thumbnail (through Home's own image proxy), title, site, length
and date; tapping plays on the viewer's own device (the site's
privacy-enhanced embed, or its page), so playback never routes through
the hub. A child or teen only ever gets safe-search-capable engines
(`SEARCH-SAFE-01`'s own filter), so no YouTube in their results unless
an adult allows it for that person specifically.

How a turn asks for media - the lookup returning media rows with the
card shown when the question is about seeing or watching, versus one
dedicated "find media" tool - is decided by measurement, not assumed:
replay rows such as "show me the trailer" against "who directed it"
tell the two apart, the same discipline `#150` and `READ-PAGE-01`
already established for tool choice on this 8B.

`YOUTUBE-API-01` (optional, off by default, the household's own API
key) comes after, once `MEDIA-SEARCH-01`'s own SearXNG-only path is
measured and shipped.
