# The modern Kiwix reader, with Wikipedia as its first app (2026-10-29)

Status: design, with the first slices built on this branch. Owner words (Jesse, 2026-10-29): "build out the modern kiwix reader, the way
we are going to let people interact with kiwix stuff like wikipedia ... with the first app to use it being wikipedia."

## 1. What exists and what is wrong with it

Built and kept ([reference-reader-and-library-settings-2026-10-15](../plans/reference-reader-and-library-settings-2026-10-15.md)):
the sidecar (`kiwixSidecar.ts`), the per-band closed book list and minor floor (`referenceSources.ts`, `minorFloor.ts`), the
closed block extractor (`retrieval/extractArticle.ts`, `extractFullArticle`), `/api/reference/*` (books, suggest, search, article,
media) and `ReferencePage`, which draws the article through the kit's `ArticleView`.

What a person sees today (`docs/assets/screens/reference-article-desktop-light.png`): one narrow text column on a wide screen,
Back and Forward as outlined buttons, a bare search box with a Search button, no lead picture, the infobox flattened into a
two-column table in the text flow, no link previews, no way to land on something (no random article, no history, no saved
articles), and full-text search that fetches and extracts every hit's whole article one after the other before answering.
It is a document viewer, not the Wikipedia app S2 asks for.

## 2. The idea

One reader core that any Kiwix book can use, plus a small per-book **profile** that says how that kind of book is read. Wikipedia is
the first profile and the first app. Wiktionary, Wikivoyage, Gutenberg, Stack Exchange and the rest become more profiles later,
not more readers (principle 1: one definition, one implementation).

- **Core (generic, any ZIM):** search with type-ahead as you type; the article pane; contents with a highlight on the section being
  read; back and forward; history; saved articles; a link preview card on hover or long press; a licence and snapshot line.
- **Profile (per book kind):** what the article front looks like (lead picture, infobox, hatnote, summary), what the home screen
  offers (random, recent, featured), and which sections start folded on a phone. `wikipedia` is the first; `generic` is the
  fallback and is what Reference uses for every other book.
- **Wikipedia app (S2):** a standalone app, `/wikipedia`, in the app library, copying the Wikipedia site and mobile app: search bar
  on top, the article title, the lead picture, the infobox beside the text on a wide screen and above it on a phone, folding
  sections on a phone, a sticky contents column on a wide screen, and the "snapshot of <date>" line. Reference (`/reference`)
  stays as the library of every installed book and opens articles in the same core.

## 3. Research

- kiwix-serve and its own viewer serve the book's raw HTML and ship their own UI. Already rejected as the reader (2026-10-15):
  it cannot enforce the age band or minor floor and cannot take Home's tokens. It stays the content and search source, through
  `/search`, `/suggest`, `/content`, `/raw` and the catalog feed, all of which the sidecar already speaks.
- Kiwix JS and the Kiwix apps read the ZIM themselves in the client and rewrite links to in-page loads. Rejected for the same
  reasons and because Home must filter per person on the server.
- kiwix-js-pwa (GPL-3.0, suggested by Jesse 2026-10-29) is the same client-side model as Kiwix JS, packaged as a PWA, Electron and
  store apps. Not a base for Home: it parses the ZIM in the browser, so the server could not apply the age band or minor floor, and
  its code would be vendored GPL into an AGPL hub (PLATFORM: download, don't vendor). Taken from it: history is per session unless
  the person saves it (READER-05 keeps recent history short and per person), and it separates Zimit archives (a crawled website, not
  a Wikipedia dump) as their own mode. Home's extractor assumes mwoffliner Wikipedia markup, so Zimit books fall to the `generic`
  profile and are an open question (section 8).
- Wikipedia's own apps and Minerva show what "modern" means here: lead picture and infobox first, folded sections on a phone,
  a summary card on a link, random article, saved lists. These are the parts this design builds, from the book's own HTML.
- ZIM metadata is already read for the books list (`Date`, `Language`, article count). A book's `Illustration_48x48` icon is
  read from `/raw` for the book tile (slice R5).

## 4. Rules and principles kept

Age and surface gates and the minor floor on every route, including the new ones (rule 0, KS-01). A child's article keeps zero
outbound links; links to a book that is not installed or not on the person's list render as text. Figures only when
`reference.images` allows them for that person, and only from the same-origin media route. Rule 6a: no query text in logs.
S2 (copy the native app), S6 (a missing library or a stopped sidecar shows the existing status surface, never a raw error),
rule 9 (kit as shipped; nothing restyled by class; a look the kit cannot reach becomes a `commons` kit change, its own worktree,
and only Jesse says yes to the tag). Nothing leaves the home; every request is to the loopback sidecar.

## 5. API (additive; no existing field changes)

All under `/api/reference`, same auth and band gate as today.

| Route | Does |
|---|---|
| `GET /article/{book}/{path}` | Gains `lead_image` (`src`, `alt`, same-origin, only when images are allowed), `summary` (first paragraph as text), `infobox` (title plus rows, lifted out of `blocks`), `hatnote` (the "For other uses" line), and `profile` (`wikipedia` or `generic`). `blocks` stays as today minus the lifted infobox, so `ReferencePage` keeps working. |
| `GET /preview/{book}/{path}` | `{ title, summary, thumbnail }`, from the same extractor, for the link preview card. Same gate as article. |
| `GET /random/{book}` | One article path from the book, through the same gate; kiwix-serve `/random`. |
| `GET /search` | A hit is the sidecar's title, snippet and path. An adult's hits skip the per-hit article fetch (an adult's article is checked by nothing the snippet could add). A child's or teen's hits keep today's full-text minor floor: the same article extraction and `tripsMinorFloor` check as now, run with a bounded parallel fetch (four at a time, at most 20 hits, the same 2.5 s per-request timeout) instead of one after another. Nothing here loosens a protection for a child or teen (rule 0). |

Every sidecar call in the new and changed routes goes through the one existing kiwix client (`kiwixSidecar.ts` base URL plus the
`libraryRequest` helper, moved into one `lib/kiwixClient.ts` in READER-01), so KS-STACK-REF-01 moving kiwix to the Stack changes one place.

## 6. Slices

| Id | What | Where |
|---|---|---|
| READER-00 | Kit first (rule 9c). `ArticleView` gains an infobox slot (title plus rows, beside the text on a wide screen, above it on a phone), a hatnote line, an optional contents column with the section being read highlighted, folding sections on a phone, and a link preview through the kit's `hover-card` (long press on a phone). It reuses PHONE-02's phone controls. Proposed in `commons` in its own worktree; Home pins it only when Jesse says yes to the tag. | commons |
| READER-01 | `lib/kiwixClient.ts` (one client); extractor lifts `infobox`, `lead_image`, `summary`, `hatnote`; article route returns them; figure and lead sources rewrite to the media route; Wikipedia-shaped fixture tests. | backend |
| READER-02 | `preview` and `random` routes; search as in section 5. | backend |
| READER-03 | After READER-00 and its pin: `ReferencePage` moves onto the extended `ArticleView` through the Reference adapter it already has, plus search with type-ahead, history stack and the profile table (`wikipedia`, `generic`). Home draws no infobox, contents or preview itself; it passes data to the kit. | frontend |
| READER-04 | The Wikipedia app: `/wikipedia` route, `appCatalog` entry, home screen (search, random, recent, saved), hidden when no Wikipedia book is readable for the person. When the sidecar is down it shows the existing muted line and disables search, fed by the Whole-system health row (S6: `statusBoard.ts` already carries the kiwix entry); no new surface. | frontend |
| READER-05 | Saved articles as a spec record, `ReferenceSave` (person scope, like News's `NewsSave`: `id`, `person_id`, `book`, `path`, `title`, provenance and clock stamp), spec first in `commons/spec`, then hub routes, then the reader's Save action. Recent history stays in the browser session (nothing stored). Book icons on library tiles. | spec, backend, frontend |
| READER-06 | Docs: `docs/user/` Wikipedia page, `docs/dev/` reader note, screenshots generated from the seeded household, opened and judged. | docs |

READER-01 and 02 do not depend on READER-00 and can land first; the response fields are additive.

## 7. Reuse check (principle 6)

| Option | Verdict |
|---|---|
| kiwix-serve viewer, Kiwix JS | Rejected, section 3. |
| Kit `ArticleView`, `SplitView`, `Sheet`, `List`, `Command` | Used for everything drawn. |
| `extractFullArticle` | Extended in place; no second extractor. |
| A Wikipedia REST or mobile-html feed | Rejected: the product is offline and loopback-only (PRIVACY.md); everything is read from the installed book. |

## 8. Supersedes

- [reference-reader-and-library-settings-2026-10-15](../plans/reference-reader-and-library-settings-2026-10-15.md), "The reader": its
  one-column article page and bare search box are replaced by this design. Its rule that every route uses the closed per-band
  list and minor floor stands unchanged; the new routes follow it and search keeps the full-text floor for a child or teen (section 5).
- Nothing in `RULES.md`, no earlier backlog row.

## 9. Open

- Zimit books (crawled websites): `generic` profile reads them through the same extractor, which may drop most of their content.
  Check against one real Zimit ZIM before any Zimit book is offered in the library; no slice owns it yet.

## 10. Owner's mockup (Jesse, 2026-10-29): the look target

Jesse sent a mockup of the modern reader the same day ([owner-mockup.webp](assets/kiwix-reader-2026-10-29/owner-mockup.webp), his words:
"here's my mockup for a modern reader"). It is the look for the reader and the Wikipedia app and outranks section 2's
"copy the Wikipedia site" (S2: the owner's own picture of the app is the native app being copied). Everything above stays; this
section says how the mockup maps onto it. The mockup's name "lore" is a placeholder: the app is called Wikipedia.

| In the mockup | Built as |
|---|---|
| App sidebar: Home, Explore, Saved, Offline | The app's own sidebar (S1: app sections live in the app, not the main rail), kit `SectionSidebar`. Home: search, random, recent. Explore: random picks and the book's main-page links. Saved: READER-05. Offline: the existing "Keep on this device" action (KEEP-OFFLINE-01) listing what is kept; READER-04 registers a `reference` provider in `backend/src/lib/offline/` (today only `media.ts` exists there) that serves a kept article's blocks and pictures. |
| Centred search bar, bookmark at the right | The app's header row (S2): the search box with type-ahead in the middle, the Saved bookmark and the ambient companion avatar at the right. The brand is the app name. |
| Kicker (NATURE · EARTH), huge title, dek, "Wikipedia · 12 min read" | `ArticleView` kicker, title, dek and the existing source line. Kicker is the article's first category when the book carries one, else omitted (never invented). Reading time is counted from the article's words by the hub. |
| Wide hero picture with a small label chip | `ArticleView` `image`, plus a new `image.badge` text drawn as a chip on the picture. Only when `reference.images` allows. The chip text is the picture's own caption from the book, shortened to 30 characters; no caption, no chip (never invented). |
| Save, Listen, Share row under the hero | A labelled action row on a wide screen (new `actionRow` layout in the kit); the phone keeps PHONE-02's floating pill. Listen reads the article through the existing read-aloud. |
| Bold lead sentence, then body | New `ArticleViewData.lead`: the article's own first sentence, drawn as the standfirst. It is the book's text, never model-written. |
| Quick fact card, Related list with thumbnails (right rail) | `quick_fact` (one fact from the infobox's first row pair, as plain text) and `related` (up to 5 linked articles from the article's own links, each with `preview` thumbnail and title) in the rail, above the infobox and contents. `related` uses READER-02's preview route. `related` follows the article route's own link rule (`allowLinks: band === "adult"`, `backend/src/routes/reference.ts`): a child and a teen get none, as they get no links today. An adult's `related` is not floor-checked, the same as an adult's article (the adult rule blocks only CSAM). The rail is part of `ArticleView`'s own article layout (like the infobox and Key points), not a second pane beside the app. |
| Dark look | Theme tokens only (no fixed colours); it is the dark theme when the person's theme is dark. |

New slices: **READER-07** (kit: `image.badge`, `lead`, `actionRow`, `quick_fact`, `related`; before the tag, so one tag carries
READER-00 and 00b) and **READER-08** (backend: `lead`, `reading_minutes`, `kicker` from the book's category when present,
`quick_fact`, `related` on the article response, additive). READER-03 and 04 draw the mockup; READER-04 gains Explore and Offline.
