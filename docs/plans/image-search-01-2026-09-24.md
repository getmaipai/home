# IMAGE-SEARCH-01: a distinct image-search tool (design note, 2026-09-24)

Session B, per the coordinator's own instruction (`docs/BACKLOG.md`'s
IMAGE-SEARCH-01 row): a design note before code, sent for a ruling.
Not built yet - no line of implementation exists for this item.

**Held for the routing design (coordinator's own ruling, 2026-09-24):**
option (A) below is decided (a `media` `StructuredPart` composing the
shipped `Image` Element and a kit `Button`, the gap named in section 3
kept as the record of why), `websearch`'s own one-line description
addition is accepted for the same commit, and poster-only scope is
accepted - but the build itself waits on Jesse's own research pass on
knowledge sources and routing (offline Kiwix archives, live web search,
and how a turn reaches the right one). One option on that table is a
single federated lookup tool in place of one tool per source, which
would decide whether a picture request is even its own tool at all.
This note's own design stands as the record for when that routing
question resolves, not as a green light to build now.

## The problem, in one line

`structuredPartForOutcomes()` (`backend/src/lib/composer.ts`) only ever
recognizes `weather`/`almanac-date` outcomes, so a poster/trailer request
("show me the poster for the new Spiderman movie") lands as a paragraph
of markdown links, never a card. LIVE-0923-01 (dev.md, 2026-09-24)
independently found the model setting `category: "images"` on `websearch`
itself on real conversation turns, which `tool.ts` now strips
unconditionally (never trusting the model's own enum choice, the same
floor the old path held) - so today there is no path to an image result
at all, card or otherwise. The row's own design: a second, distinct tool
offered beside `websearch`, and the model *choosing it* is the picture
signal, never an argument on the one tool.

## 1. Tool name and schema

`image-search`, a new bundled package (`backend/packages/image-search/`),
mirroring `websearch`'s own shape:

```json
{
  "id": "image-search",
  "args": {
    "type": "object",
    "required": ["expression"],
    "properties": {
      "expression": { "type": "string", "minLength": 1, "search_text": true }
    }
  }
}
```

One required string argument, nothing else - no `category` (the tool
itself IS the category, fixed to images internally, never a model-set
enum the way `websearch`'s stripped `category` argument was), no
`read_page` (a page-read makes no sense for an image result). The
description needs the same disambiguating work DOC-TOOL-01 just did for
`write_document`: state plainly that this returns a picture or a
thumbnail for something visual (a movie poster, an actor's photo, a
trailer's thumbnail), never text search results, and that plain
`websearch` still owns every text question - `websearch`'s own
description gets a one-line addition ("never for a poster, photo, or
video thumbnail - image-search does that") the same direction DOC-TOOL-01
went, so the two tools' own descriptions do the disambiguating work
instead of the model guessing from two similar-sounding names.

## 2. What it returns

Reuses SearXNG's existing image-category path, already implemented and
exercised in production for `websearch`'s own now-stripped `category:
"images"` argument (`packageHost.ts:772-820`): the same query function,
`category` fixed to `"images"` internally rather than read from args, the
same safe-URL handling already there (`img_src`/`thumbnail_src` from
SearXNG, protocol-checked, credentials stripped). Result shape per hit:
`{ title: string, url: string, image: string | null, thumbnail: string
| null }` - `image`/`thumbnail` already come back `null` when SearXNG's
own row omits them (the existing code path), so the tool's result can be
"no picture found" without being an error. Takes the first result with a
non-null `image`/`thumbnail` as the outcome's `result.data`, the same
"one clean answer, not a result list" shape `weather`/`almanac-date`
already return - a search that finds ten images returns one card, not
ten, matching the product's own existing pattern rather than inventing a
list view.

## 3. The card's part shape

**Not a spec change.** Checked first, per the platform's own "shared
record changes go through the spec first" rule: `StructuredPart`
(`backend/src/wire.ts:56`) is a **local** Home wire type, not a
`@maipai/spec` shape - grepped, it does not exist anywhere under
`commons`'s `spec/` workspace. Nothing outside this repo reads it
(`bot` has no chat UI consuming `structured_part` today). So this is a
Home-only wire addition, not a spec-first item.

**The real fork, and the reason this note exists rather than a one-line
BACKLOG close:** no shipped kit Element composes a thumbnail image with
a title and a source link (checked every file under
`commons-tags/ui-ui-v0.5.53/ui/src/elements/` - `web-search.tsx` is
text-only, `document-reference.tsx` has no image field,
`inline-citation.tsx` is a hover popup with no image field). Per
"No hand-built UI," the gap gets named here rather than a bespoke card
getting written. Two ways to close it without hand-building one:

- **(A) Extend `StructuredPart`** with a new `kind: "media"` variant
  (`{ kind: "media", tool_id, title, image, thumbnail, url }`) alongside
  `spec_sheet`, rendered by composing two shipped primitives: the
  assistant-ui `Image` Element (`elements/image.tsx`, used exactly as
  shipped - `image`/`filename` props, its own zoom/download/copy
  built in) for the thumbnail, plus a kit `Button` primitive
  (`variant="link"`) under it for "Open" when `url` is present. Same
  `useAssistantToolUI({ toolName: "image-search", render: ..., display:
  "standalone" })` wiring `weather`/`almanac-date`/`write_document`
  already use, so the mechanism is identical to every existing card -
  only the render composes two shipped pieces instead of one.
- **(B) A native assistant-ui `image` content part.** `Image`'s own
  type (`ImageMessagePartComponent`) is built for a message-level image
  content part, not a tool-call result part - using it this way means
  `chatModelAdapter.ts` synthesizes an `image` part from the
  `image-search` outcome instead of a `tool-call` part, a different
  composition path than every other tool result takes (weather,
  almanac-date, write_document, sources are all tool-call parts).
  Cheaper today (no new `StructuredPart` variant, no new reload-path
  wiring in `chatHistoryAdapter.ts`) but a real mechanism split: one
  tool's result renders through a different pipe than every other
  tool's, for a UI reason rather than a technical one, and there is no
  affordance in `Image` for a source link (only `filename` as a plain
  caption) - a trailer's "open the trailer" link would have nowhere to
  go without adding one anyway.

**Recommendation: (A).** It keeps one mechanism for every tool-result
card (the thing `write_document`'s own artifact wiring and
`weather`/`almanac-date`'s spec sheets already establish as the
pattern), the composition is still two shipped, unedited parts, and it
does not foreclose a later `trailer` variant needing a real "open" link
- (B) would need to grow that affordance into `Image` itself later
anyway, which is a kit change for a Home-only need. Open to the
coordinator's own call if (B)'s smaller footprint outweighs that.

**Video ("trailer") is out of scope for this pass either way.** SearXNG
image search returns pictures, not video files; a "trailer" request
gets its poster/thumbnail image today (which the row's own text already
frames as the acceptance: "restoring the poster/trailer card," a poster
for both, not a playable trailer) - actually opening a trailer is a
`websearch`-plus-link job, unchanged by this item.

## 4. The measurement that gates it

Per the row's own acceptance text and `#150`'s precedent (the 8B's tool
choice was already found unreliable between two *currently offered*
tools - `weather` never called over `websearch` though offered,
whatever the reason) and `READ-PAGE-01`'s own method (a small,
roster-safe row set against the resident engine, run live, numbers
read honestly): a new bench pass, same shape as `budgetOfferedPass()` in
`backend/scripts/bench/tool-calling.ts` (the exact mechanism DOC-TOOL-01
just reused for `write_document`), with `image-search` added to
`modelCatalog.ts`'s `tools_offered` for the run:

- **Its own rows** (mirroring `WRITE_DOCUMENT_ROWS`): a clear positive
  ("show me a picture of the Eiffel Tower", expect `[image-search]`),
  a plain-text world question that must NOT pick it over `websearch`
  ("what's the capital of France", expect `[websearch]` - this is the
  `#150`-shaped check, two offered tools where only one fits), and at
  least one negative with neither tool firing ("what's your favorite
  color").
- **The full existing corpus rides along**, the same way
  `budgetOfferedPass()` already does for `write_document` - a
  regression on an existing row is what DOC-TOOL-01 found, and this
  item needs the same check before landing, not just its own three
  rows passing.
- Gate: land only if `image-search`'s own rows score cleanly (no worse
  than `write_document`'s own 5/5 + 5/5 clean bar) AND no existing
  corpus row regresses from its current clean score - the same bar
  DOC-TOOL-01 just measured itself against, so the two follow the same
  standard rather than each inventing its own.

## Open questions for the ruling

1. (A) vs (B) above for the card's part shape.
2. Whether `websearch`'s own description needs its one-line addition
   in the same commit as `image-search`'s manifest, or as a follow-up -
   leaning same commit, since DOC-TOOL-01 just showed a lone
   disambiguating rewrite is not always enough on its own to hold every
   existing row (three rows still regressed there even after real
   wording work), and two competing tools' own descriptions are the
   only signal the model gets to split "picture of X" from "search for
   X."
