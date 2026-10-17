# Answer blocks, places and designed documents: the remaining block kinds (2026-10-17)

This note decides the rest of the typed answer-block set that `docs/BACKLOG.md` "Intelligent UI answers (design review
2026-10-08)" accepted: which kinds are still missing, which of them are data a package already holds and which need a tool, how
places get a card, a schematic map and an optional offline map, how a designed document is built from its own block vocabulary,
and how three Home-page cards (Since you were last here, Learned this week, the household character) ride the same contract. The
accepted direction's design file (`data-scratch/design/INTELLIGENT-UI-DESIGN.md`) is missing from the checkout, so this note is
the record of the remaining kinds. Rows covered: KIT-GENUI-01, KIT-GENUI-02, KIT-GENUI-03, KIT-GENUI-04, KIT-GENUI-05, GENUI-06,
GENUI-07, GENUI-08, GENUI-09, GENUI-10, GENUI-11, GENUI-12, PLACE-MAPS-01, PLACE-SHARE-01, DOC-BLOCKS-01, DOC-RENDER-01, SINCE-01,
LEARNED-01, CHAR-01. Design note only; no code.

## 1. What exists today

| Piece | Where | State |
|---|---|---|
| The block contract: envelope (`id`, `kind`, `schema_version`, `producer`, `alt`, `min_band`, `provenance`, `created_at`, `hlc`, `after_paragraph`) and nine kinds (`spec_sheet`, `data_table`, `chart`, `timeline`, `todo_list`, `image_gallery`, `schedule_card`, `comparison`, `weather_card`) | `@maipai/spec` `schemas/answer-block.schema.json` (spec-v0.1.153); the `kind` enum's own text names the later kinds as additive | Built (GENUI-01, 13a) |
| Host validation: spec parse, manifest `returns_blocks` allowlist, hub-only picture sources, age band, output floor per string, drop without failing the reply | `backend/src/lib/answerBlocks.ts` `filterAnswerBlocks()`; `packageBlocks.ts` shapes a recipe package's blocks from its own run | Built (GENUI-02, 05) |
| Placement and wire: the hub stamps `after_paragraph`, streams a `block` event, stores `blocks` on the turn | `backend/src/lib/turnMachine/blockEvents.ts`, `answerImages/turn.ts` (the one placer), `assistantStreamWire.ts` | Built (GENUI-13c) |
| Chat rendering: one `answer_block` data part, the kit dispatcher | `frontend/src/apps/chat/chatAnswerBlocks.tsx`; kit `src/elements/answer-block.tsx` switches on `kind` | Built (GENUI-03a, 03b) |
| Blocks outside chat: `contributes.data[]` routes return `{as_of, blocks, degraded?}`; the `answer_blocks` page node; Home Today cards draw them | `backend/src/lib/apps.ts`, spec `ui/schema.json`, [app-kind-2026-10-16](../plans/app-kind-2026-10-16.md), [home-page-2026-10-17](home-page-2026-10-17.md) section 7 | Built for the app kind; Home cards in flight |
| Kit Elements already shipped for the missing kinds | `map-answer.tsx` (pins at x, y on a schematic), `memory-chips.tsx` (`MemoryChip`: added, updated, existing), `timeline.tsx`, `comparison-card.tsx`, `chart.tsx` (one series), `ui/carousel.tsx`, `ui/tabs.tsx`, `ui/badge.tsx`, `voice.tsx` (`VoiceOrb`), `agent-status.tsx` | `frontend/node_modules/@maipai/ui/src/elements`; `elements-adoption.json` marks `map-answer`, `memory-chips` and `timeline` "wire-after" |
| Places: one resolver, rounding for a child, household home, saved and current places; place search through Open-Meteo's geocoder | `backend/src/lib/places.ts` (`resolvePlace`, `searchPlaces`, `PlaceSurface = "weather" \| "maps"`); Entity `geo` | Built (PLACE-SPEC-01, PLACE-HUB-01) |
| A place tool | `backend/packages/place-lookup` (Nominatim, `min_role: teen`, `data_sources[].opt_in: true`, no `offer`, so never offered to the model) | Built, text reply only |
| Tool budget | manifest `offer` (`base`, `conditional` with `gate` and `bench_row`, `off`); nine `offer: base` packages (almanac-date, almanac-time, convert, math, remember, remind, timer, weather, websearch); one conditional (`show_images`, gate `answerImagesAllowed`, bench row `answer-images`) | `backend/src/lib/turnMachine/budget.ts` |
| Documents | `write_document` package (`artifact:write`, `kind` is `markdown`, `code` or `html`); `artifact.schema.json`; the pane (`CanvasSplit` in `ChatPage.tsx`); `turn-artifact.schema.json` holds `card`, `procedure`, `comparison` sections | Built; no block vocabulary |
| Shares | `share.schema.json` (`file_id` only); `backend/src/lib/shares.ts`; `shares` table | Built for files (STORE-SHARE-01) |
| Deterministic math | `@maipai/spec` `interpreters/ts/compute.ts` and `py/compute.py` (mathjs with `import` and `createUnit` disabled); `math` and `convert` recipes call it | Built |

## 2. Purpose and audience

The job: when a package has structured data, the person sees it drawn, not described, on every surface, with no model writing
display code and no new way for a child to reach something an adult turned off.

| Viewer | Sees | Does not see |
|---|---|---|
| Owner or admin | Every kind; the places tool and the offline map when their settings allow; documents in the pane; Since, Learned and the character for themselves only | Another person's Since rows, memories, places or documents |
| Adult member | The same, minus the admin-only settings (map region, package switches) | As above |
| Teen | Every kind at teen band; `place-lookup` and the places tool (`min_role: teen`); the map at full zoom; documents; own Since and Learned | Model-laid-out blocks (GENUI-11 is adults first); nothing admin |
| Child | Data-only kinds that pass `min_band` and the floor; the map at town zoom with no exact pin, no Current location, no directions; `calculate`; own Learned chips; the character never `concerned` | The places tool (`min_role: teen`), place sharing outside the household, any block a package sends above the child band, pictures that fail the gate |
| Guest | Blocks from packages with `min_role: guest`; no places, documents, Since, Learned or saves | Everything per person |
| Robot, TV | The robot speaks `alt` for every kind and stores the block; a TV draws the kinds Go implements and says `alt` for the rest; both show household data only | Per-person cards (Since, Learned, the character's asks) |

Rule 0 holds throughout: a new kind adds a renderer, never a path around `filterAnswerBlocks`, `min_role`, `min_band`, the
output floor or the child coarsening in `resolvePlace`. Nothing here loosens a child or teen protection.

## 3. Screens and flow

**Chat (S2, the chat column).** A block sits where the placer put it, as today. New kinds change nothing in the stream, the
history adapter or the dispatcher's contract; the kit dispatcher gains a `case` per kind. States: a kind the client cannot draw
shows its `alt` sentence (already so); a block that fails validation is dropped and the reply stands (rule 6); Incognito on
changes nothing for data-only kinds, and the places tool runs but saves nothing and offers no "Save as a place".

**The calculator (`calculate`).** Drawn in chat as a `calculator` block: named inputs with the values the tool used, the result
line, and live recomputation in the kit Element through the spec's own formula interpreter (no model call on a change). Copy:
"Change a number to recalculate." A formula the interpreter does not know is not a block; the tool answers in prose.

**Places.** A places answer is one `place_cards` block (a kit carousel of cards: name, area, what it is, distance when a place
was resolved, "Open in Maps" when the maps app is installed) followed by one `map` block (schematic pins, no tiles, no
network). Empty or failed: the tool reports `found nothing` or `down`, no `place_cards` or `map` block is drawn, and the model
says so in its own words (rule 6). With no network: the tool reports `down`; nothing is fabricated. Child: never offered (`min_role: teen`).

**The maps app (`/apps/maps`, the app kind).** Index page: the `picker` (Current location first, the fixed household Home, then
`maps.places`) above one `answer_blocks` node of kind `map` in its `tiles` variant; a `places` page lists the person's saved
places with Share and Stop sharing. States: no region downloaded shows "Maps work offline once an admin downloads a region"
with "Open Home settings" for admins and "Ask a grown-up" for everyone else; downloading shows the kit `Progress` from the
existing job route; no `household.home` and no permission shows "Pick a place to start". Incognito: no save, no share.

**Designed documents (the pane).** `write_document` with `kind: "document"` opens the pane as a markdown document does; the body
is the block list drawn top to bottom; the header menu gains "Download PDF" beside Download. A block the schema refuses
refuses the whole artifact: the pane does not open, the tool reports the failure kind to the model, and the model says in its
own words that the document was not made (rule 6), never a half page. Phone: one
column, the existing sheet.

**Home page cards (S2, the Home app).** "Since you were last here" is a Today-row card drawing a `timeline` block ("Nothing
happened" when empty, "More" to `/status` after 20 rows). "Learned this week" draws a `memory_chips` block ("Nothing new this
week"; a chip opens the record in Memory). The character sits in the greeting as the `companion-presence` kit block, one state at
a time; a child session shows `asking` as "Asked a parent" and never `concerned`. All three hide through `ui.home_hidden`
(ids `since`, `learned`; the character is part of the greeting and has no hide).

Every error names the problem and the next step; none names a host, a port or an error code to a non-admin (rule 6).

## 4. Records and settings (spec first)

All changes are additive in `commons/spec`, each kind appended to the `kind` enum with its own `$def` and fixtures, then the
kit, then Home, then the robot and Go.

| Name | Type | Default | Scope | Meaning |
|---|---|---|---|---|
| `series_chart` kind | `props: {label, series[{id, name, points[]}], x_labels[]?, variant: area \| line, unit?}` | | block | Up to 6 series, 500 points each; one legend; axes labelled from `x_labels` and `unit` (KIT-GENUI-01) |
| `stat` kind | `props: {label, value, delta?, tone: good \| bad \| neutral, note?}` | | block | One headline number (KIT-GENUI-02) |
| `split_bar` kind | `props: {label, parts[{id, label, value, tone?}]}` | | block | One bar split into parts that sum to 100 or to a stated total (KIT-GENUI-02) |
| `media_list` kind | `props: {items[{id, title, text?, meta?, src?, alt?}], numbered: boolean}` | | block | Rows with an optional picture; `src` passes `hubImageSources` like a gallery (KIT-GENUI-03, GENUI-07) |
| `tabs` kind | `props: {tabs[{id, label, blocks[]}]}` | | block | One level; a child block is any kind but `tabs`; children are validated and floored by the same filter and carry no `after_paragraph` of their own (KIT-GENUI-04) |
| `swatches` kind | `props: {swatches[{id, label, hex, note?}]}` | | block | Colour chips; `hex` validated by pattern (KIT-GENUI-04) |
| `filter_chips` kind | `props: {chips[{id, label}], target_block_id, field}` | | block | Chips that filter one `data_table` or `media_list` in the same reply by one field, client side (GENUI-10) |
| `labelled_picture` kind | `props: {src, alt, hotspots[{id, x, y, label, text?}]}` | | block | `x` and `y` in percent; `src` hub-proxied; the drawing itself is not produced here (GENUI-10) |
| `calculator` kind | `props: {formula_id, inputs[{id, label, value, unit?, min?, max?}], result: {label, value, unit?}}` | | block | `formula_id` names a formula in `spec/interpreters/*/formulas.*`; the Element recomputes with the same interpreter (GENUI-06) |
| `place_cards` kind | `props: {places[{id, name, area, kind?, detail?, distance_km?, lat, lon, entity_id?}]}` | | block | Up to 10; coordinates rounded by the hub to the person's band before storage (KIT-GENUI-05) |
| `map` kind | `props: {variant: schematic \| tiles, pins[{id, label, detail?, lat, lon}], route?: boolean, zoom_cap?: "town"}` | `schematic` | block | `schematic` draws on `map-answer` with the kit's own projection; `tiles` draws MapLibre over the hub tile route and is refused by the hub unless a region is installed; `zoom_cap: "town"` is stamped for a child (KIT-GENUI-05, GENUI-09) |
| `memory_chips` kind | `props: {chips[{id, text, change: added \| updated \| existing}]}` | | block | Drawn by `memory-chips` (LEARNED-01) |
| `timeline` event `to` | string, relative route, optional | none | block | Additive prop on the existing `timeline` kind and kit `TimelineEvent`, so a Since row links where the thing lives (SINCE-01) |
| `presence` device event | `{state: PresenceState, since, detail?}` where `PresenceState` is the existing `presence-state.schema.json` enum (11 states, unchanged) | `idle` | device event | Resolved by `resolvePresence()` in `@maipai/core`; the existing record is reused, not redefined; any new field is an additive event field, never a second state list (CHAR-01) |
| `document` artifact kind | `artifact.kind` gains `document`; `blocks[]` of `title`, `label_line`, `tags`, `text`, `picture_grid`, `summary_box`, `fact_table`, `steps`, `sources` | | artifact | A closed vocabulary; `fact_table` reuses `spec_sheet` props, `steps` reuses `turn-artifact` `procedure`, `sources` reuses `source.schema.json`; a block outside the list refuses the artifact (DOC-BLOCKS-01) |
| `write_document` args `blocks` | the document block schema, optional | none | tool | Filled through the engine's JSON-schema output (rule 2); the hub validates with the one checker and floors every string; pictures only through the existing proxy (DOC-RENDER-01; offered per D2) |
| `Share.place_id`, `Share.place_list` | string, optional | none | record | Exactly one of `file_id`, `place_id`, `place_list` (`validate.ts`); for places `to` is one person, no re-share (PLACE-SHARE-01) |
| `maps.places`, `maps.default_place` | `location` selector, `range.multiple` on the list | `[]`, `"current"` | person, declared in the maps manifest `config[]` | Mirror of `weather.places` and `weather.default_place` (PLACE-MAPS-01) |
| `maps.region` | `select` over the catalog's region list | unset | household, admin | Which offline region file is installed; unset means no tiles and no map app data (GENUI-09) |
| `maps.live_lookup` | `boolean` | `true` | household, admin | Whether the places tool may ask Nominatim; `search.source_mode = offline` forces it off (GENUI-08) |
| `place-lookup` manifest `offer` | `{mode: conditional, gate: placesAllowed, bench_row: places}` | none today | manifest | Makes the one existing place package the places tool (GENUI-08) |
| `GET /api/since`, `GET /api/memories?since=` | routes returning `{as_of, blocks}` | | hub | The two Home cards use the app-kind data shape, not a second one (SINCE-01, LEARNED-01) |
| Hub tile route `GET /api/maps/tiles/:z/:x/:y` plus a range read of the region file | route | | hub | Serves the installed PMTiles file; no outbound (GENUI-09) |

Which kinds are tools and which are data only (rule 1's budget):

| Data only (a package or route already holding the data emits them; the offered tool count does not move) | Tools |
|---|---|
| `series_chart`, `stat`, `split_bar`, `media_list`, `tabs`, `swatches`, `filter_chips`, `labelled_picture`, `place_cards`, `map`, `memory_chips`, `timeline`, the document blocks | `calculate`: folded into `math` (same package, `offer: base`), so the base set stays at its nine manifests. The places tool: `place-lookup` becomes `conditional` (gate `placesAllowed`: teen or adult, package enabled, `maps.live_lookup` on, source mode not `offline`), one bench row `places`. `present` (GENUI-11): `conditional`, adults, only after its bench clears, and only if D2 allows. Worst case on one turn: nine base, `show_images`, `places`, `present`: twelve, under the sixteen cap. |

## 5. Privacy and offline

Nothing leaves the home by default. Every outbound connection, in the order a household meets it:

| Connection | Sends | When | Setting | Privacy page row |
|---|---|---|---|---|
| Nominatim (`nominatim.openstreetmap.org`), the places tool | the place words the person said, and for "near me" the resolved coordinates rounded to two decimals (host-injected, never a model argument) | the model calls the tool, teen or adult only | the package's enabled switch, `maps.live_lookup`, `search.source_mode` | the existing `place-lookup` `data_sources` row, `what` updated to name the rounded coordinates |
| The region download for the offline map | the region file name and the home's internet address, once | an admin picks `maps.region` | `maps.region` (unset is off) | one new row, "Maps region download", host named by D1, shown only while a region is chosen |
| Wikimedia pictures for `media_list` (GENUI-07) | the subject name, through the existing picture path and its `wikimediaGate(band)` | only on a turn that earned pictures | the existing `search.source_mode.wikimedia` | no new row; the existing wikimedia-live row |

No other connection: `series_chart`, `stat`, `split_bar`, `tabs`, `swatches`, `filter_chips`, `labelled_picture`, `calculator`
(the interpreter runs on the hub and in the kit), the schematic `map`, `memory_chips`, Since, the character and documents are
local. The PDF is made on the hub from the same page (no print service). Tiles are served by the hub from the region file; the
`tiles` variant makes no request off the hub, and the kit Element's MapLibre is configured with no style, glyph or sprite URL
off the hub (a test asserts it, like `vendored-no-remote.test.ts`).

Offline: data-only kinds draw from stored blocks; the places tool reports `down` and the model says so; the map app works in
full from the region file (search through the FTS5 index built from the region's place names at install time); documents open
from the artifact store.

What an admin can and cannot see (rule 6a): an admin sees component health and counts (`places_call`, `map_tiles_served`,
`document_refused`) with no person; never a place name, a document title, a memory text, a Since row or a presence state of
anyone else. Since and Learned read only the viewer's own rows; a teen's never appear for an admin. The character shows the
signed-in person's state. A child's share of a place never leaves the household and carries the child's one-decimal rounding.

A backup carries: stored turn blocks (already), `document` artifacts, places and shares (entities and `shares`), the three
settings keys. It excludes the region file (re-downloadable, hundreds of megabytes) and the tile cache; `maps.region` is kept so a
restore offers the download again.

## 6. Kit Elements and parts

Chat kinds are kit Elements under `src/elements`, each a new file beside `weather-card.tsx`, dispatched by `answer-block.tsx`,
with a showcase fixture per kind: `series-chart` over the kit `ui/chart.tsx` primitive; `stat` and `split-bar`; `media-list`;
`tabs` over `ui/tabs.tsx`; `swatches`; `filter-chips` over `ui/toggle-group.tsx`; `labelled-picture` over `image.tsx`;
`calculator` over `ui/input.tsx` and `ui/slider.tsx`; `place-cards` over `ui/carousel.tsx` and `ui/card.tsx`; `map` on
`map-answer.tsx` (additive `pins[].lat/lon` prop and the projection) with a `tiles` variant that mounts MapLibre GL; `memory-chips`
and `timeline` as shipped (plus the `to` prop). The character is a kit block `companion-presence` composed of `VoiceOrb`,
`ui/avatar.tsx` with `AvatarBadge` and `agent-status.tsx`. Documents draw through one new kit Element, `src/elements/designed-document.tsx` in `commons`, which takes the `document`
block list and composes `ui/card.tsx`, `ui/badge.tsx`, `image.tsx`, `spec-sheet.tsx` and `sources.tsx` itself; Home renders it
as it ships inside `CanvasSplitDocument` and passes only the blocks, handlers and copy (rule 9: the canvas uses the chat's
renderer). Home passes data, handlers and copy; no `className` that changes shape, no wrapper (rule 9, 9b). Each new kit part
(the answer-block Elements, `companion-presence`, `designed-document`, and the `map` `tiles` variant with MapLibre GL and
PMTiles) gets its row in `docs/design/UI-DECISIONS.md` before its slice writes a line; the MapLibre row names the library and
version and records that the shadcn registry and Kibo UI were checked and have no map part (rule 9b). The maps app page is schema data drawn by the interpreter's `picker` and
`answer_blocks` nodes.

**Reuse check.** Looked at first: assistant-ui Tool UI's chart (KIT-GENUI-01 asks; it is a Recharts wrapper, and rule 9b bars a
direct `recharts` import in Home, so the kit's own `ui/chart.tsx` primitive is composed instead); the spec `compute`
interpreter (mathjs, already sandboxed) for the calculator, so no second evaluator; the existing `place-lookup` package and
`resolvePlace` for the places tool, so no new package or geocoder; Nominatim's own `viewbox` and `bounded` search for "near me",
so no Overpass host; the Wikimedia picture path for `media_list`; MapLibre GL and PMTiles (the two libraries the row names, both
downloaded as dependencies, never vendored); the existing job and download routes for the region file (as the reference library
does for a ZIM); the existing Share record and `shares` table; `turn-artifact`'s `procedure` and `comparison` for document
steps; Download PDF reuses the one PDF path CHAT-PARITY-03 plans: the hub prints the same kit-rendered page with headless Chromium
(`playwright`, already a dependency), so the PDF matches the page on every client; no second PDF renderer is written.
Hand-built code is limited to: the kit projection function for the schematic map, the formula table, the Since and Learned
routes and `resolvePresence()`, because no shipped part does any of these.

## 7. Rule check

- **Rule 0**: every kind passes `filterAnswerBlocks` (band, floor); the places tool keeps `min_role: teen`; a child's map is
  town zoom, no exact pin, no Current location; GENUI-11 is adults first. No conflict.
- **Rule 1**: no word rule decides a tool; `calculate` folds into `math`; `place-lookup` becomes one conditional tool with a gate
  and a bench row; `present` is conditional and benched first; twelve tools worst case. No conflict.
- **Rule 2**: the document `blocks` argument and `present` use the engine's JSON-schema output; Home never re-parses. No conflict.
- **Rule 5**: no length cap added; a child's and a spoken turn's limits apply to `alt`. No conflict.
- **Rule 6**: a failed or empty places lookup, a refused block or a refused document never fails the reply, and each is told
  to the person by the model in its own words, with no fixed copy. No conflict.
- **Rule 6a**: Since, Learned, presence and the counters carry no person or text next to an activity. No conflict.
- **Rule 7**: unchanged; the places tool gives the model place rows, not snippets, and page text rules do not apply. No conflict.
- **Rule 9 and 9b**: every kind is a kit Element or a kit block; a designed document is the one kit Element
  `designed-document`, rendered as it ships inside the pane (no composition in `ChatPage.tsx`); MapLibre and the chart primitive
  live in the kit, not Home; no `recharts` import in Home; the one small checker validates; the kit's additive props
  (`pins[].lat/lon`, `TimelineEvent.to`, the `tiles` variant) land in `commons` first; every new kit part has its
  `docs/design/UI-DECISIONS.md` row before its slice starts; the PDF is CHAT-PARITY-03's headless Chromium print, not a second
  renderer. No conflict.
- **Rule 11**: no outside runner; the formula interpreter is the spec's. No conflict.
- **Rule 13**: `places` and `present` get CHAT-AB-01 rows before they are offered. No conflict.
- **S2, S4, S5**: the maps app is a package app with its own settings area; `maps.*` keys carry spec copy. No conflict.
- **Platform principle 4**: one block contract on chat, Home cards, app pages, the robot and Go; one place store; one share
  record; one math evaluator; one presence state list (the existing `presence-state.schema.json`). The `tabs` kind nests its children inline rather than "referencing child block ids" as
  KIT-GENUI-04's row words it: one list, nothing for four clients to cross-reference. Backlog wording, not a rule.
- No NEEDS-RULE-CHANGE.

## 8. Slices

Sizes: S a session or less, M days. Commons slices cut a tag and bump Home's pin; Home slices exit on `bash scripts/check.sh`
and the tests beside the files; captures at 1440 and 390 in both themes, opened and judged, for every kind.

| Order | Id | Size | Depends on | Exit check |
|---|---|---|---|---|
| 1 | KIT-GENUI-02 (`stat`, `split_bar`) | S | nothing | spec fixtures valid and invalid; kit showcase; a Home `uiFixtures` scenario draws both; UI-DECISIONS.md row landed |
| 2 | KIT-GENUI-01 (`series_chart`) | M | nothing | 6 series by 500 points draws under 50 ms in the kit test; legend and axes in both themes; UI-DECISIONS.md row landed |
| 3 | KIT-GENUI-03 (`media_list`) | S | nothing | `src` outside the hub proxy is dropped by `filterAnswerBlocks` (test); UI-DECISIONS.md row landed |
| 4 | KIT-GENUI-04 (`tabs`, `swatches`) | S | 1 to 3 | a `tabs` inside `tabs` is refused; a child block failing the floor drops alone; UI-DECISIONS.md row landed |
| 5 | GENUI-10 (`filter_chips`, `labelled_picture`) | S | 3 | chips filter a `data_table` fixture client side; hotspots keyboard-reachable; UI-DECISIONS.md row landed |
| 6 | GENUI-06 (`calculator`, formulas, folded into `math`) | M | nothing | TS and Python interpreters agree on every formula fixture; offered tool count unchanged (budget test); UI-DECISIONS.md row landed |
| 7 | GENUI-07 (recipes and plans as `media_list` with pictures) | M | 3 | pictures only through `/api/answer-image`; child band gets the gated set; UI-DECISIONS.md row landed |
| 8 | KIT-GENUI-05 (`place_cards`, `map` schematic) | S | nothing | projection test; a child fixture carries one-decimal pins and `zoom_cap: "town"`; UI-DECISIONS.md row landed |
| 9 | GENUI-08 (the places tool on `place-lookup`) | M | 8, bench row | gate test per band and setting; coordinates absent from the turn record, trace and log; CHAT-AB-01 row `places` recorded |
| 10 | GENUI-09 (offline regional map), after D1 | M | 8, D1 | a region installs through the job route; tiles serve with no outbound (network-off test); the kit test proves no off-hub URL; UI-DECISIONS.md row landed |
| 11 | PLACE-MAPS-01 (the maps app) | M | 10, APP-KIND-04 | per band tests; a place in both lists is one entity; Incognito offers no save |
| 12 | PLACE-SHARE-01 | M | PLACE-ELEMENT-01b | exactly one subject enforced; a child's share outside the household refused; Stop sharing removes the pointer |
| 13 | DOC-BLOCKS-01 | M | nothing | fixtures with roster names only; an unknown block refuses the document |
| 14 | DOC-RENDER-01 | M | 13, CANVAS-READ-01, D2 for the model-filled `blocks` | the PDF matches the page (pixel test on the demo document); one column on a phone; every picture through the proxy; UI-DECISIONS.md row landed |
| 15 | SINCE-01 | S | nothing (the `to` prop lands in commons first) | empty state; cap 20; a teen's rows absent for an admin (test) |
| 16 | LEARNED-01 | S | MEM-EDIT-01 | a child sees own chips; a chip opens the record |
| 17 | CHAR-01 | M | PRESENCE-STATES-01, ASSIST-NAME-01 | every state renders through tokens; stale `thinking` returns to `idle` within 120 s; child never `concerned`; UI-DECISIONS.md row landed |
| 18 | GENUI-11 (`present`), only if D2 | M | 1 to 5, bench | valid-on-first-try, right-tool and prose rows on CHAT-AB-01, 3 repeats, before any offer |
| 19 | GENUI-12 (robot and Go) | S each | each kind above | robot stores and speaks `alt`; Go draws the kinds it implements and says `alt` for the rest |

1 to 8 and 13 can run in parallel in `commons`; 9 waits on 8; 10 and 11 wait on D1; 14 and 18 wait on D2.

## 9. Legacy verdicts

The legacy mirror (`legacy-backups/home-legacy.git`) is not present in this worktree, so nothing was read from it here. The
weather note already records `WeatherPage.tsx` and `useWeatherLocations.ts` as reference only (redesigned, places on the Entity
record). For the kinds, the map, documents, Since, Learned and the character: nothing borrowed from legacy.

## 10. Supersedes

- KIT-GENUI-04's "tabs container referencing child block ids": children nest inline (section 7).
- GENUI-08's "OpenStreetMap or Wikidata lookup paths": Nominatim through the existing `place-lookup` package only; Wikidata is not
  used for places.
- GENUI-06's "fold it into or replace `math`": folded in; `math` keeps its id and its `offer: base`.
- `elements-adoption.json` verdict text for `map-answer`, `memory-chips` and `timeline` ("wire-after"): wired by slices 8, 16
  and 15.
- Nothing in RULES.md, the app-kind note or the Home page note; both are extended.

## 11. Decisions for Jesse

1. **D1, the offline regional map (GENUI-09, PLACE-MAPS-01).** Recommend yes, as an optional catalog package with one admin
   setting `maps.region`, off until a region is chosen, downloaded from one named host that the privacy page lists; the
   alternative is the schematic map only, with no maps app. His call because it is a release-sized download per household and
   a new named host.
2. **D2, a model-laid-out block tool (GENUI-11, and the model-filled `blocks` argument of DOC-RENDER-01).** Recommend allow the
   measurement, adults only, with nothing offered until the CHAT-AB-01 rows clear; the alternative is data-only kinds forever
   and documents that stay markdown. His call because the accepted direction says the model never lays out display, and this
   is the one bounded exception.
3. **The `present` and `places` bench bars.** Recommend the picture tool's own bar (85 percent recall, owner ruling 2026-10-10)
   for `places`, and a valid-on-first-try rate of 95 percent with no prose regression for `present`. His call because the bar
   is an owner-set number.
