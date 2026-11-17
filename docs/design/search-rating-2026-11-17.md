# A rating design for web search (2026-11-17)

Status: proposed (SEARCH-RATING-01). Design only: search keeps today's floors until the build rows below land, each proven the
same or stricter on FILTER-SUITE-01. Owner rulings this rests on: [content-ratings-and-access-2026-11-16.md](content-ratings-and-access-2026-11-16.md)
(one scale, a ceiling per person, Unrated held below X, nothing rated while a person waits, never told) and RULES.md area "Content
filter and feature access" (C1 to C10), chat rule 0 as the owner changed it on 2026-11-16 (the adult-site host list is a default of the
child and teen roles that only an admin's rating override lifts), and chat rule 6 ("nothing suitable", never "found nothing").

## Supersedes

- [content-ratings-and-access-2026-11-16.md](content-ratings-and-access-2026-11-16.md) section 6a ("Search needs its own rating design"):
  this is that design. Its rule stands: until the rows below land, search keeps today's floors (C9's last sentence).
- [content-policy-2026-10-18.md](content-policy-2026-10-18.md), the search part of its slice 02 (SafeSearch and the search floor read
  the policy snapshot): replaced by the layers below; the rest of that slice is CONTENT-POLICY-02.
- The CONTENT-POLICY-02 backlog row's exit clause "the adult-site host list stays fixed; no rating, admin's rating or ceiling reaches it"
  (written before the owner changed chat rule 0 on 2026-11-16): dropped by this note; the host list is a child and teen role default
  that an admin's rating override lifts (section 4), and the search part of that row is SEARCH-RATING-02 to 04.
- Nothing in chat rule 0, rule 12 (temporary chats) or [knowledge-sources.md](knowledge-sources.md) changes: SearXNG stays the engine,
  the hosted provider stays adult-only, the personal-data query check stays, and the reference library's own `minorOk` mark stays.

## Reuse check

Kept and called, not rebuilt: the engine's safe mode (`search.safe_search`, `lib/safeSearch.ts`, the SearXNG and hosted `safesearch`
parameter), the site lists on the hub (`lib/blocklists/`, the locked adult-site list, the admin's allow and deny lists), the row floor
(`retrieval/minorRowFloor.ts`), the page fetch gate (`urlAllowedFor` on every hop), the reference release (`retrieval/minorFloor.ts`
`releaseToBand`), the query check (`retrieval/minorQueryCheck.ts`), the door and its raters (`lib/filter/`), the pass (`filter/pass.ts`,
`content.ceiling.web`, `content.unrated.web`), and the spec's label map (`vocab/content-ratings.json` maps `safe_search` strict,
moderate and off to G, PG-13 and X; this note departs from it on purpose for `off`, section 2: a row from an unfiltered search is
Unrated, not X, because nothing says it is adult, only that nothing checked it). New: one rule for what level a row or a page gets as it is built, the page's own adult
label read on fetch, and the engine mode and host list following the web ceiling. No new engine, list source, model or classifier.

## 1. What is rated, and when

Search results cannot be stored first (C9), so a row is rated as it is built, by the cheapest signals, and never by a model. The
same one scale applies (G to X, Prohibited, Unrated), the stamp is a `ContentRating` kept with the row for the life of the reply (never
stored, never logged), and a row over the viewer's web ceiling leaves the list on the server (C5). An adult's search runs none of
this (C2): the rows reach the adult as the engine returns them, with only the admin's deny list applied, as today.

Three kinds of thing get a level: a **row** (title, snippet, address), a **page** (text fetched to answer with), and a **reference
article** (the offline library). Each layer below says which signal gives the level and what it maps to.

## 2. The layers

| Layer | Signal | Level it gives | Kind of rater (spec shape) |
|---|---|---|---|
| Engine safe mode | The mode the query ran with (`strict`, `moderate`, `off`) | A declared level for every clean row of that search: strict G, moderate PG-13, off Unrated. The mode is a ceiling on what arrives, not a label on a row, so it only sets the level of a row nothing else rated. | `declared` |
| Site lists on the hub | The locked adult-site list; the admin's deny list; the admin's allow list | A host on the adult-site list is X. A host on the admin's deny list is blocked (a host rule, not a rating: it is applied to everyone as today). The allow list never lifts a locked hit, as today. | `given` |
| A page's own adult label | The RTA label and the `rating` meta tag (`adult`, `mature`, `RTA-5042-1996-1400-1577-RTA`) on a fetched page, and an engine result marked adult by the engine | X | `given` |
| The rules check on words | The standing minor floor (`checkSafety` with `isMinor`) and the content policy kinds on the title and snippet, or on the fetched text | A floor hit for the Prohibited categories is Prohibited; any other floor hit is X; the policy's `sexual` is X, `gore` and strong `swearing` R, `drugs`, `gambling` and mild `swearing` PG-13; a clean text keeps the level the layer above gave it. | `worked_out` |
| The reference library's own mark | A source's `minorOk` mark (the curated children's books and encyclopedias) | G for a row from such a source whose words are clean; a source without the mark gives PG-13 when clean | `given` |

Order: the host list first (free), then the page label where a page is in hand (free), then the rules check, then the engine mode
as the fallback level. The first signal that gives X or Prohibited wins and the rest do not run; otherwise the strictest level found
stands. Prohibited is never lowered (C6).

## 3. What Unrated means here

A row is Unrated when nobody labeled it and the rules check could not read it: a search run with safe mode off, a row with no title
and no snippet, a page whose text could not be fetched or read, or a row whose words are in a script the rules check does not fold.
Unrated is over the ceiling for a child or a teen (C4), so such a row leaves their list unless an admin allowed unrated for the web
for that person or the household (`content.unrated.web`). A clean row from a strict or moderate search is not Unrated: the engine mode
gives it G or PG-13, which is what a child or teen sees today. This keeps a child's search useful without trusting an engine's mode as
a rating of any single row that the rules check flagged.

## 4. How an override changes each layer

- **The web ceiling** (`content.ceiling.web`, or the person's own lower `content.own_ceiling.web`): the one number every layer compares
  with. Raising a teen's to R shows rows the rules check rated R while the engine still runs in moderate mode (so clean rows keep
  their PG-13 level and are shown); raising a person's to X turns search off for the filter entirely (C2), and that is the "admin's
  rating override" that lifts the adult-site host list in chat rule 0: the list applies to every person whose web ceiling is below X,
  and nothing else lifts it.
- **The engine mode** follows the web ceiling: G strict, PG, PG-13 and R moderate, X off (off only at X, so a raised ceiling never makes
  clean rows Unrated and hides them). `search.safe_search` stays as the person's
  own tightening (a person may run stricter than their ceiling's mode, never looser), which is what the key already enforces for a
  child and a teen today. Its "Default" option means "the mode my level gives".
- **Unrated for the web** (`content.unrated.web`, or the household's `content.unrated`): lets Unrated rows through for that person.
  It never lets an X or Prohibited row through, and it never changes the host list.
- **News unrated** (`content.unrated.news`) covers shelf and news rows (RATE-INGEST-01 stamps them); it does not reach web search.
- The admin's deny and allow lists and the personal-data query check are not ratings and no override changes them (section 6b of the
  record).

## 5. Never told (C10)

A list that lost every row to the filter tells the model "nothing suitable" and the model redirects in its own words; the fixed "No web
search results were found." line stays only for a search that truly returned nothing. No row, badge or line names a filter, a level or
a rule. A blocked page fetch keeps today's "That page isn't available."

## 6. Build rows

Added to `docs/BACKLOG.md` under "Content filter by rating and feature access", after CONTENT-POLICY-02 and before CONTENT-POLICY-03
in the order; each is risky surface (full check, independent minor-safety review, architect verdict, real runs), gated by
FILTER-SUITE-01, and removes nothing until its own suite cases prove the same or stricter result:

1. **SEARCH-RATING-02: rows and pages rated as they are built.** The door gains the search surface: a `search-row` rater (the host list
   and the rules check on title and snippet) and a `page-label` rater (the RTA and `rating` meta tags on fetched text), the engine
   mode as the declared fallback level, and `filterList` for the row list; `floorSearchResult` and `minorRowAllowed` call the door; a
   viewer at X runs nothing (an adult who lowered their own ceiling gets the filter, C2).
2. **SEARCH-RATING-03: the engine mode and the host list follow the web ceiling.** `resolveSafeSearchLevel` takes the mode from the
   ceiling (G strict, PG to R moderate, X off) with `search.safe_search` as the person's own tightening; `urlAllowedFor` applies the
   locked adult-site list to a ceiling below X; the SafeSearch settings copy says "Default" means the mode the level gives.
3. **SEARCH-RATING-04: the reference library's mark as a given level.** `releaseToBand` reads `minorOk` as G, the rules check as today,
   and Unrated for what it cannot read.
