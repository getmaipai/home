# Feeds, the Internet Archive, and one reader for every page (2026-09-24)

Status: approved by the owner on 2026-09-24, with the calls decided at the end. Companion to `knowledge-sources-2026-09-24.md` (the one lookup, Kiwix, the Reference app), whose rules this follows. Research by the design-resolver passes of 2026-09-24; "measured" means fetched that day at a person's pace, everything else is an estimate.

## Why

The family wants news and current information the same way it will have Wikipedia: on its own disk, searchable offline, read in a clean view without ads or tracking. The old hub scraped for this and got blocked; this design only uses what publishers publish, at a person's pace. The owner also wants the Internet Archive's whole library reachable (films, music, books, software), with downloads gated per person.

## Feeds become a local archive

Home pulls the feeds a household subscribes to on a schedule and keeps them in a local archive, so a question about the news can be answered without anything leaving the house (fully so when a person or household is set to offline sources; otherwise web search still runs beside it).

Sources, measured: NPR, BBC, PBS, the Guardian, NASA, arXiv, Hacker News, ESPN, MLB, CDC, FDA and CPSC recalls, National Weather Service alerts for the household's location, USGS earthquakes, Science News Explores for children, podcast feeds and YouTube's per-channel feeds all answered. NPR, NASA, Daily Voice and Science News Explores carry the full article in the feed; the rest carry summaries. AP, FEMA and the USDA recall feed refused automated readers and Reuters has no public feed; FEMA and USDA offer official data services instead. Google News forbids automated pulls in its robots rules and Bing News's feed is undocumented, so neither is pulled. Local sources (a local paper, public radio, a town news site) are added by pasting the site's address; Home finds its published feed with one fetch.

The pull: one job per feed, on the feed's own interval with a 15-minute floor (news hourly, arXiv daily, weather alerts every 5 minutes while a warning is active), asking "has it changed" first (ETag, If-Modified-Since), with random spacing, one request at a time per site through the per-host limiter, honouring Retry-After, and going quiet at the first block, as THIRD-PARTY-SERVICES.md requires. A maintained feed parser reads RSS, Atom and JSON Feed. The same story from several outlets is stored once, with every outlet kept as a source.

## One reader for every page

Feed items, web pages the chat reads, Wikipedia articles from Kiwix and archived pages all go through one reader:
1. The publisher's own full text when it is there (the feed's content, or the page's structured data).
2. Otherwise one fetch of the page and Mozilla Readability, which Home already uses; measured on three news pages at 11 to 31 ms each.
3. Cleaning with sanitize-html: no scripts, ads, trackers or outside frames.
4. Pictures loaded through Home's image proxy only when someone opens the item.
5. Shown by the Reference app's article view with our own styling.

A paywalled page keeps its summary, marked as a subscriber article; nothing is worked around. A dead or blocked page falls back to the Internet Archive's saved copy (below). Every banned practice stays banned: pretending to be a browser to get past bot checks, rotating identities, solving CAPTCHAs, pretending to be a search engine's crawler, paywall tricks, and the old hub's extractor that did several of these. Outside reader services (which would send every link out of the house) are not offered.

Fetching each summary-only item's page in the background is roughly 200 to 400 page fetches a day, capped at one every 30 seconds and 150 a day per site. THIRD-PARTY-SERVICES.md forbids per-item fan-out, so this needs the owner's written exception; without it, a page is fetched only when someone opens the item.

## The Internet Archive

- Dead pages: the Archive's documented availability service finds the nearest saved copy, which goes through the same reader, marked "archived copy" with its date. Only for pages the household subscribed to or opened that are gone (404, 410, or the host no longer answers), never for a page that blocks us or sits behind a paywall, through the Archive's own limiter.
- Search only when needed (owner's ruling): the Archive is never asked on an ordinary question. Three triggers, none a word rule: (1) when the ordinary web search already returns archive.org items, Home reads just those items' metadata to offer their downloads, a decision made by the results themselves; (2) a find tool offered only to a person whose Archive gate is on, which the model calls for a request like "the best downloadable version of X", an old film, a concert or an audiobook, switched on only after it passes the tool-choice replay gate with no regression on existing rows (the test the document tool failed); (3) only if the model cannot choose it reliably, a small learned intent head trained on labelled rows and measured before use (RULES-AND-LEARNED-COMPONENTS.md's replacement for a word rule). A match offers the item's download sheet for a yes. The Archive source has its own privacy row, its own on/off in the household's sources, the Archive's limiter and the five-minute search cache. Other people's usernames in the Archive's collection lists (the fav- collections) are stripped before anything is stored, shown or sent to the model.
- Only openly downloadable items appear (owner's ruling). The query excludes restricted items (measured: adding -access-restricted-item:true cut a book search from 1,031 to 333 results with no restricted item left), the item's metadata is checked again, files marked private are dropped, and an item with no downloadable file left disappears. Nothing filtered is shown or noted.
- The best version: each item lists its files with format, original or copy, size, length and height. Home ranks them from those fields only. Video: the original in a playable format, highest resolution first, then the Archive's MP4 copy; disc images last. Audio: lossless (FLAC) before MP3. Books: EPUB, then PDF, then DjVu. The person chooses "best quality" or "smallest good" and sees the size before downloading.
- Downloading: Home's own download jobs (resume, verified against the SHA-1 the Archive publishes per file, which needs the download job to accept an algorithm beside SHA-256) into a media folder on the library drive the person chose, one download at a time; or "open on this device" for a one-off. Downloads are started from the item's sheet, never by a chat tool call.
- The gate: a per-person setting, on for adults and off for teens and children by default; only an adult changes it, and a child can never turn it on. The owner has consciously deferred copyright filtering for now; each result still shows its licence.
- Save Page Now (asking the Archive to save a page the household keeps) is opt-in, off by default, because it tells the Archive what the family reads.
- Open Library (books), the Live Music Archive, LibriVox audiobooks, old films and radio, and software collections are reachable through the same search. Open Library's own rule is one request a second, three with a contact in the User-Agent, and no bulk harvesting.

## Storing it small and fast

Measured on the dev Mac with 100,000 synthetic articles: each article's text is compressed with zstd (46 to 59 percent smaller on real articles), the search index holds no second copy of the text (SQLite FTS5, contentless), and a two-word search ranked by relevance plus recency took 2.5 ms at the median and 19 ms at the 95th percentile. No second search engine is needed. About 6 KB per article in total, so a year of a starter feed set (about 500 new items a day after removing duplicates) is roughly 1.1 GB. Search by meaning reuses Home's embed model, stored the way memory stores vectors today, at 256 dimensions in int8 (about a quarter of a gigabyte per million articles), to re-rank the text search's top hits. Near-duplicate stories are caught by a short fingerprint compared over the last 7 days. Each archive kind is one SQLite file under the library path the person chose, written only by its pull job.

Retention reuses what exists: a daily job like conversation retention, and oldest-first pruning under a size cap like the package cache. Proposed defaults: items 90 days, full text 30 days, 5 GB. A person's read and saved marks follow the person-forget rule. Removing a feed removes its items.

## Alerts

Severe weather for the household's location notifies at once (the alert's own severity fields decide, not words), nearby earthquakes above a set magnitude and distance notify quietly, and recalls arrive as one daily summary; each capped at three a day.

## Home stays lean: capabilities live in the catalog (owner's rule, 2026-09-24)

Every source and ability here is a catalog package the community can improve on its own, released on its own, without a change to Home. Home holds only the generic machinery that packages cannot hold themselves, because it runs a process, touches the disk or enforces a rule: the kiwix-serve sidecar, the scheduler and storage for archives, the one lookup and its per-person policy, the one reader pipeline, the download jobs, the per-host limiters, the image proxy, and the notification and privacy plumbing. Everything specific to a source is declared or coded in its package:

- Each feed set is a declarative package: its feed addresses, intervals, reader mode, audience, alert rules (which alert fields map to which notification level), and privacy rows. Adding a new feed or fixing one is a catalog change.
- Each Kiwix set is a declarative `reference` package.
- The Internet Archive is a plugin package: its search, metadata reading, filtering of restricted items, and the "best version" ranking table (declared in the package, read by Home's generic download sheet).
- Live sources (web search, live Wikimedia, weather, news topics, video search) are plugin packages behind the one lookup.
- Home exposes the capabilities these need through the package host (a lookup-source contract, a feed-set contract, a download request, a notification type), each declared in the spec first, so a package never reaches around them.

A capability that needs Home code to exist is built once as a generic host capability, never as source-specific code in Home. The build items below are split the same way: host items in Home, source items in the catalog.

## Build order (after LOOKUP-FED-01)

FEED-SPEC-01 (S, spec), ARCHIVE-STORE-01 (M, the storage shape), READER-PIPE-01 (M, the one reader and the Archive fallback), FEED-PULL-01 (M, the pull), FEED-FULLTEXT-01 (M, needs the exception), FEED-LOOKUP-01 (S), FEED-PKGS-01 (M, catalog feed packages and local setup), FEED-ALERTS-01 (S), NEWS-APP-01 (M), IA-SOURCE-01 (M), IA-DOWNLOAD-01 (M, the gate and ranking), IA-SPN-01 (S, opt-in).

## The owner's calls (decided 2026-09-24)

1. Background full-page fetches for subscribed items are allowed as a written exception to the no-fan-out rule, bounded: one fetch per subscribed item ever, spread out, per-site caps (one every 30 seconds, 150 a day), robots.txt respected. The exception is recorded in THIRD-PARTY-SERVICES.md with this item.
2. Retention: items 90 days, full text 30 days, a 5 GB cap, changeable per household.
3. The feed archive is excluded from backups.
4. Patch is included as a local-news feed package.
5. No outside reader services.
6. The Internet Archive's pace: a burst of three, then one every five seconds, until it publishes its own numbers.
7. Teens do not get Archive downloads by default.
8. Save Page Now is off by default.
9. The owner has read the terms of every service in this design (2026-09-24).
