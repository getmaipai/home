# Chat cards for every app: one standard (2026-10-18)

Status: design and audit only. Nothing here is built. Owner prompt (Jesse, 2026-10-18): "We probably should add a card with
formatted and interactive results for every app and that should be a standard going forward. Think about it: we have it for
weather, images, etc: why not news and other." Architect gate: this note, the BACKLOG rows and the draft org text need the
`architect` agent's ruling before any slice starts (verdict in section 9). The org-standard edit and any new UI-DECISIONS row
need `Owner-approved`.

Read for this note: `RULES.md` rules 6, 9, 9b and S6; `AGENTS.md` rule 9 (Kit Elements as they ship); org `docs/PACKAGES.md`
("Writing an app package") and `docs/UI.md`; `UI-DECISIONS.md`; `news-app-2026-10-17.md` (sections 5, 12 and the `actions` map);
`frontend/src/apps/chat/elementBindings.ts` (`TOOL_BINDINGS`, `DATA_BINDINGS`), `chatToolUis.tsx`, `chatAnswerBlocks.tsx`,
`chatModelAdapter.ts`; `backend/src/lib/{packageBlocks,answerBlocks,composer,structuredPartIds}.ts`,
`backend/src/lib/turnMachine/blockEvents.ts`; the 44 `backend/packages/*/manifest.json`; `commons` at `ui-v0.5.268` and
`spec-v0.1.179` (`answer-block.schema.json`, `result.schema.json`, `manifest.schema.json`, `ui/schema.json`, `elements/answer-block.tsx`).
Evidence below is from origin/main at `66664310` (v0.2.21).

## Supersedes

- NEWS-06's plan for a `TOOL_BINDINGS` entry for `news` (BACKLOG line 4291); CHAT-CARDS-01 uses the answer-block path.
- The `composer.ts` structured-part switch and `SPEC_SHEET_BOUND`, and the `packageBlocks.ts` `blocksForRecipeRun` switch, retired by this note's rows. Stored rows keep their binding through the migration window (section 5.2).
- The `news` prop on `AnswerBlockView`, replaced by the generic `actions` slot (section 2.3).
- Trivia choice and any answer chips are left to QR-01/QR-02 and the open Fix trivia item; this note adds no choice kind. The `countdown` kind in CHAT-CARDS-05 is the one countdown definition; the Coming up page in [household-lists-reminders-2026-10-17.md](household-lists-reminders-2026-10-17.md) uses it.

## 1. Audit: what each tool draws in chat today

### 1.1 How a chat result reaches the screen (three paths, only one is generic)

1. **Answer blocks (the generic path).** A package result carries `blocks`; `acceptPackageBlocks` (`turnMachine/blockEvents.ts`)
   runs `filterAnswerBlocks` (spec check, manifest `returns_blocks` allowlist, age band `min_band`, output floor on every string,
   crisis overlay, hub-cache image check); the web puts each into an `answer_block` data part (`chatAnswerBlocks.tsx`) and the kit
   `AnswerBlockView` picks the Element by `kind`. The frontend half is already data-driven: one binding (`DATA_BINDINGS`), zero
   per-package code. Eleven kinds exist: `spec_sheet`, `data_table`, `chart`, `timeline`, `todo_list`, `image_gallery`,
   `schedule_card`, `comparison`, `weather_card`, `story_feed`, `article`.
2. **Structured part (legacy, Home code).** `composer.ts` `structuredPartForOutcomes` / `specSheetCandidateForOutcome` maps a
   hard-coded list of package ids (`structuredPartIds.ts`: `SPEC_SHEET_BOUND`) onto one `spec_sheet`, which `TOOL_BINDINGS`
   draws through `SpecSheetToolRender`. Adding a package here means editing two Home files.
3. **Named tool-call parts (Home wrappers).** `chatModelAdapter.ts` builds a `ToolCallMessagePart` for `write_document`,
   `confirm`, `project`, `picture_progress`, `picture`, `video`, `song`, `tool_timeline` from dedicated fields on the done
   event; `TOOL_BINDINGS` maps each to a renderer in `chatToolUis.tsx` that polls the job and composes the kit Element.

Two facts that change the framing of NEWS-06:

- **A package tool with no card does not even reach `ToolFallback`.** `ToolFallback` draws only for a real tool-call part, and
  the adapter builds none for ordinary packages (Home resolves them server side). Such a result is the reply's prose and
  nothing else. The NEWS-06 sentence "draws as plain text with `ToolFallback`" is imprecise: there is no disclosure at all.
- **The producing half is not generic either.** For Tier 0 recipe packages the hub builds blocks in a `switch (manifest.id)`
  (`packageBlocks.ts` `blocksForRecipeRun`: `remind`, `timer`, `list-view`, `weather`) because the recipe interpreter has no
  `blocks` output. A Tier 1 handler may return `blocks` directly (`result.schema.json`), but no bundled handler does. So today
  zero of 37 tools get a card from data alone.

### 1.2 Inventory

44 bundled package directories. 37 are callable from chat (34 `plugin`, 1 `project`, 2 `app`); 7 never produce a tool
result (4 `companion`: buddy, pal, tutor, default; 1 `skill`: storytime-style; 2 `module`: feeds-children, feeds-household).
The catalog (`getmaipai/catalog`) lists the same `joke`, `trivia`, `book-lookup`, `media-lookup`, `place-lookup`, `weather`,
`podcasts`, `videos`, plus `knowledge` and `define` (retired in Home by KS-02B, kept for old stored rows). The table covers them: every
catalog entry that has a bundled twin draws as that twin does, and `knowledge` and `define` draw plain text.

Binding column: **F** = frontend `TOOL_BINDINGS` (Home code), **D** = answer-block data part (no frontend code), **H** = hub
code keyed on the package id (`composer.ts` or `packageBlocks.ts`), **-** = none.

| Package (tool) | Tier | Chat result today | Interactive | Binding lives in |
|---|---|---|---|---|
| weather | 0 | `weather_card` block, plus daily `spec_sheet`/`chart`/`data_table` | No (read only) | D drawn; H produced (`weatherBlocks`) |
| news | 1 | Plain reply text (headlines) | No | - (`returns_blocks` lists `story_feed`/`article` for the app pages only) |
| sports | 1 | Plain reply text | No | - |
| almanac-date | 1 | `spec_sheet` | No | F (`SPEC_SHEET_BOUND`) + H (`composer.ts`) |
| almanac-time | 1 | `spec_sheet` | No | F + H |
| almanac-moon | 1 | `spec_sheet` | No | F + H |
| almanac-holiday | 1 | `spec_sheet` | No | F + H |
| almanac-onthisday | 1 | `spec_sheet` (one "Year" row) | No | F + H |
| place-lookup | 1 | Plain reply text | No | - |
| book-lookup | 1 | Plain reply text | No | - |
| media-lookup | 1 | `spec_sheet` (year, director, runtime, rating) | No | F + H |
| music (artist lookup) | 1 | `spec_sheet`; the Music app exists but no link to it | No | F + H |
| generate_music, edit_music | 0 | Song card (`MusicTrack`) with progress | Yes: versions, use, stop, retry, download, share | F (`song`, `MusicToolRender`, polls the job) |
| generate_video | 0 | Video card (`VideoPlayer`) with progress | Yes: stop, retry, download, share, make another | F (`video`) |
| generate_image | 0 | Progress card then `ImageGallery` | Yes: open, edit | F (`picture_progress`, `picture`) |
| show_images | 0 | `image_gallery` block (hub-cached web pictures) | Yes: open (edit only for the person's own pictures) | D drawn; H produced (`answerImages/`) |
| timer | 0 | `schedule_card` ("Once", the time text) | No: the toggle is not wired in chat, no countdown | D drawn; H produced (`blocksForRecipeRun`) |
| remind | 0 | `schedule_card` | No | D; H |
| list-view | 0 | `todo_list` block | No | D; H |
| list-add | 0 | Plain reply text | No | - |
| translate | 0 | Plain reply text | No | - |
| math | 0 | **Plain reply text.** `SPEC_SHEET_BOUND` lists it but `composer.ts` has no `math` case, so it returns null | No | F listed, H missing (defect) |
| convert | 0 | **Plain reply text**, same defect | No | F listed, H missing (defect) |
| currency | 1 | `spec_sheet` (from, to) | No | F + H |
| joke | 0 | Plain reply text | No | - |
| trivia | 0 | Plain reply text (question and answer in prose) | No | - |
| lights-on, lights-off | 0 | Plain reply text, fire and forget | No | - |
| lock-doors | 0 | Approval card (`confirm`) before it runs; result is plain text | Yes (approve, deny) | F (`confirm`) |
| websearch | 0 | Kit sources and inline citations plus the tool timeline row; no result card | Yes (citation links) | F (`tool_timeline`) and native source parts |
| write_document | 0 | `ArtifactCard` | Yes: open, download, show in Library | F (`write_document`) |
| bedtime-storybook (project) | 0 | `JobProgress`, then the finished document card | Yes: cancel, resume, retry | F (`project`) |
| recall | 0 | Plain reply text | No | - |
| remember | 0 | Plain reply text | No | - |
| podcasts, videos (apps) | 0 | Plain reply text ("open my videos"); no link into the app | No | - |

### 1.3 Counts

| Class | Tools | Which |
|---|---|---|
| Kit result card, interactive | 7 | generate_image, show_images, generate_video, generate_music, edit_music, write_document, bedtime-storybook |
| Kit result card, read only | 12 | weather, almanac x5, media-lookup, music, currency, timer, remind, list-view |
| Related card but no result card | 2 | websearch (sources), lock-doors (approval) |
| Plain reply text only | 16 | news, sports, place-lookup, book-lookup, podcasts, videos, list-add, translate, math, convert, joke, trivia, lights-on, lights-off, recall, remember |

So **19 of 37 have a result card, 7 of those are interactive, and 16 have none.** Of the 19, 12 are produced by hub code keyed on the
package id (8 spec-sheet tools through `SPEC_SHEET_BOUND`, 4 through the `blocksForRecipeRun` switch: weather, timer, remind,
list-view), `show_images` by the `answerImages` path, and 6 are polling wrappers in `chatToolUis.tsx` (generate_image,
generate_video, generate_music, edit_music, write_document, bedtime-storybook). No card has an "Open in <App>" action, although weather, news, music, videos and podcasts
are apps. Two defects fall out: `math` and `convert` are declared bound and never draw.

### 1.4 What is already right (keep it)

- `answer_block` as the one data part; `AnswerBlockView` falls back to the block's `alt` and never throws.
- `filterAnswerBlocks`: producer must equal the package, kind must be in `returns_blocks`, `after_paragraph` is stripped (hub
  stamps it), band and output floor per string, crisis overlay, duplicates dropped. A bad block never fails the answer (rule 6).
- The `actions` vocabulary and the single-handler pattern already in the kit: `AnswerBlockView` takes
  `news: { available, onAction(action, ids) }`; a block fires an action with the item's own ids and never names a route
  (`ui/schema.json` `answer_blocks.actions`, app-check keeps routes under the package's own prefixes).

## 2. The standard

**One sentence.** A package's chat result is drawn by answer blocks: the tool result carries `blocks`, the manifest declares
`chat_card`, the kit dispatcher draws them as shipped (rule 9), and a standard set of actions rides one Home handler. Home
frontend code for a new package is zero lines.

### 2.1 What the package declares

New optional-by-kind manifest field `chat_card` (required for `plugin`, `app` and `project` packages; not for `companion`,
`module`, `skill`, `engine`). Exactly one of three forms:

```json
"chat_card": { "block": "story_feed", "actions": ["open_app", "save"], "open_page": "index", "fallback": "alt" }
"chat_card": { "native": "job_media" }
"chat_card": { "none": "Turns a light on or off; the spoken confirmation is the whole answer." }
```

- `block`: a kind from the answer-block list; must also appear in `returns_blocks` (the allowlist `filterAnswerBlocks` already
  enforces). `returns_blocks` may list more (the app pages' kinds); `chat_card.block` is the one the chat answer carries.
- `actions`: names from the standard set (2.3). `open_app` needs `contributes.pages`; `open_page` (default `index`) names
  which page it opens. A custom action is a name the package defines in its own `actions` map with the same `navigate`, `call`,
  `play`, `confirm` or `ask` records the page schema already allows (own prefix only; app-check rules).
- `fallback`: `alt` (the block's one-sentence `alt`, which is what a robot says and a screen reader reads) or `reply` (the
  reply text is the whole fallback). The reply text is always present and complete; a card never carries information the
  prose lacks (rule 6, and the robot has no screen).
- `native`: deprecated from the start and removed by CHAT-CARDS-11. Until that slice, a closed list for the job and sources cards Home draws with polling wrappers today (`job_media` for picture,
  video and song; `project`; `artifact`; `confirm`; `sources`). A package cannot add a value. Section 5 slice CC-11 folds them
  into blocks later.
- `none`: a one-line reason, 20 to 120 characters, not a placeholder. Allowed only for fire-and-forget or pure-prose tools
  (joke). **Refused** when the manifest has `contributes.pages` (an app must at least open its app) or a non-empty
  `returns_blocks`.

How the block is produced:

- Tier 1 handler: returns `blocks` on its result (already in `result.schema.json`). No hub change.
- Tier 0 recipe: today needs hub code (`blocksForRecipeRun`). The standard adds one declarative step to the recipe's `format`
  op: `"card": { "kind": "schedule_card", "alt": "Timer set: {label}", "props": { "name": "{label}", "nextRun": "{when_text}" } }`,
  placeholders resolved by the interpreter from step outputs, the result then goes through the same `filterAnswerBlocks`. The
  id-keyed switch and the `composer.ts` structured-part switch are retired (port before delete, rule 12: stored rows keep their
  binding, see section 5.2).

### 2.2 Block types per kind of tool

Existing kinds cover most tools (section 4 has the new ones).

| Tool shape | Block kind | Tools |
|---|---|---|
| Ranked list or rows with a picture | `story_feed` (`rows` layout) today; `media_list` (KIT-GENUI-03) for non-news | news, podcasts, videos (recent), book-lookup results |
| One media thing (book, movie, artist, track, episode) | `media_card` (new) | book-lookup, media-lookup, music lookup |
| Weather | `weather_card` | weather |
| Place and map | `place_cards` + `map` (KIT-GENUI-05, GENUI-08) | place-lookup |
| Facts as label and value | `spec_sheet` | almanac x5, currency, translate; `convert` when it returns label/value facts (if `calculator` is its `chat_card.block`, `spec_sheet` is only an extra `returns_blocks` kind) |
| Formula and inputs | `calculator` (GENUI-06) | math |
| Table | `data_table` | sports scores (game, state, score) |
| Timer or countdown | `countdown` (new), the single countdown kind also used by Coming up; `confirmation` for reminders (`schedule_card` may remain an extra `returns_blocks` kind) | timer, remind |
| Confirmation of an action done | `confirmation` (new) | list-add, remind, lights, locks, podcasts/videos "open" |
| Pictures | `image_gallery` | show_images, generate_image |
| List of tasks | `todo_list` | list-view |
| Long read | `article` | news (Read it), write_document summaries |
| Headline number | `stat` (KIT-GENUI-02) | `convert` and `currency` when they return a headline number; if `convert` uses `stat` as its `chat_card.block`, `spec_sheet` is only an extra `returns_blocks` kind |

Clarifying questions use QR-01 follow-up chips. `remember` is not an answer-block kind: Home draws the shipped `MemoryChips` Element from each turn’s `memoryIds`, sourced by `memoryIdsByTurn` in `conversationHistory.ts` and read by `chatMemoryChips.ts` and `chatMemoryState.ts`; `remember` declares `chat_card: { "none": "The memory chips under the reply show what was saved." }`.

Trivia and `choice` are deferred because a tapped label can match `AFFIRMATIVE_RE` in `backend/src/lib/consentVocab.ts` as consent, so a choice card needs the QR-01 style guard. Trivia also needs a Tier 1 handler and reviewed options; see the open “Fix trivia: it reveals the question and the answer in the same reply” item.

### 2.3 Standard actions

One vocabulary, the page schema's `actions` names plus the chat ones. A block only shows the buttons the package declared AND
the person may use (role, band, app visible), computed by the hub into an `available` list on the streamed block.

| Action | Label | Does | Needs |
|---|---|---|---|
| `open_app` | Open in <App> | Navigates to `/apps/<id>/<open_page>` with the item's ids in state | the package has pages and `appVisibleTo` the person |
| `open` / `open_channel` | Open | Navigates to a story or channel inside the app | same |
| `save` | Save | `POST /api/plugins/<id>/actions/save` with the item ids | package-defined call |
| `play` | Play | Hands the media id to the shell player (`play` record) | media id |
| `add_to_list` | Add to list | Calls the Lists route with the item text | Lists enabled |
| `undo` | Undo | `POST .../actions/undo` with the record id the result created; hidden after 60 seconds or once the record changed; a gone record shows "Already done" | the tool made a record |
| `copy` | Copy | Copies the card's text to the clipboard | none |
| `listen`, `follow`, `feedback`, `summarize` | as in the News note | as in `news-app-2026-10-17.md` | News only for now |

Undo failure uses S6's existing row: the kit destructive `Alert` in that form, with the next step from `lib/failureCopy.ts`.

The single Home handler (`chatAnswerBlocks.tsx`) maps `name + ids` to the package's declared action and runs it. It replaces the
`news` handler slot on `AnswerBlockView` with a generic `actions` slot (commons first, rule 9c); the old `news` prop stays as
an alias for one release. Nothing in Home names a package.

### 2.4 Accessibility and phone layout

- Every block already has a required `alt` (1 to 300 characters). The wrapper region is named by it; the visible text and the
  `alt` must not contradict (conformance test, 5.4).
- Actions are real buttons named "<verb> <object>" ("Open in News", "Save story"), 44 px touch targets, reachable by keyboard
  in reading order, focus ring from tokens; no action is hover-only.
- Phone: at 375 px every kind renders without horizontal page scroll; body text at least 16 px (the News note); a card is full
  width of the message column, never wider; tables scroll inside their own box (the kit `DataTable` already does). Reduced
  motion turns off the weather hero and any ticker (tokens, not a prop per card).
- The existing `mobileSmoke` and `panelOverflow` scripts get a chat-cards fixture; no new harness.

### 2.5 States

Reuse the kit and the existing status mechanisms (S6); no card draws its own banner, spinner or toast.

| State | Where it comes from | Draws |
|---|---|---|
| Loading | A slow tool: `tool_timeline` row already shows the running step. A job: the job card's own progress (`job_media`) | no placeholder card for a synchronous tool; the timeline row is the loading state |
| Empty | The tool ran and found nothing (no scores today) | the kind's own empty text (`data_table.emptyLabel`, `EmptyState`), plus the reply sentence |
| Error | The tool failed or the block failed validation | no card; the answer continues in prose (rule 6); a drawn error is the kit `ErrorState` only when the card itself failed after it appeared |
| Degraded (offline, stale) | `offline: "degraded"` plus the cache's `stale_ok_s` | the card from cache with a quiet "As of 6:40 AM" line from a hub-stamped `as_of`; never a silent stale card |

`offline: "unavailable"` tools show no card and the reply says it needs the internet (today's `fallback_reply`).
`offline: "full"` tools always draw.

### 2.6 Bands (child, teen, adult)

- The envelope's `min_band` already hides a block below a band. A package ships a child-safe block and an adult block as two
  blocks with different `min_band`, never one block with hidden fields.
- The output floor runs on every human string of every kind; `stripLinksDeep` removes links for a child; a child never gets an
  `open_on_site` action (the News note's rule 1b stays News's decision).
- An action's availability follows the page `min_role` of the page it opens (`appVisibleTo`); a child never sees "Open in
  <App>" for an app they cannot open, and the existence of the app does not leak.
- Shared screens and the robot: a block with `min_band: "adult"` or a person-scoped action (Save, Follow) is never shown where the
  speaker is unknown or a child is present; the hub already derives the turn band from speaker evidence (`turnAgeBand`).
- Floors only move toward safer: a package cannot lower a band through `chat_card`.

### 2.7 Offline and the Go/robot clients

Offline follows 2.5. The robot stores blocks and speaks `alt`; Go renders per kind and falls back to `alt` (GENUI-12 and
APP-KIND-06 own that work; this standard adds no client-only field). `open_app` on the robot opens the DSI page.

## 3. Untrusted content and privacy (catalog authors included)

A catalog package is outside code returning strings and URLs into a family's chat. The existing checks stay and three are added.

Already enforced (keep): strict kind schemas with length caps; `producer` equals the installed package; kind must be in
`returns_blocks`; hub strips `after_paragraph`; output floor and crisis overlay on every human string; `stripLinksDeep` for a
child; kit renders text as text (no HTML from a block), `href.ts` filters unsafe link schemes.

Added by this standard:

1. **Every image field of every kind must be a hub cache reference.** Today `hubImageSources` in `answerBlocks.ts` checks only
   `image_gallery` (`/api/answer-image/ai_<hex>`). `story_feed`, `article`, and the new `media_card` and `place_cards` carry
   pictures too. Generalize to a walker over the keys `src`, `image`, `thumb`, `cover`, `poster` that accepts only
   `/api/answer-image/ai_*` and `/api/plugins/<producer>/images/*` (the News route, which fetches on first request on the hub).
   A block with any other image is dropped whole. The browser therefore makes no outbound image fetch; check the app's CSP for
   `img-src 'self'` (plus `data:` only where the kit needs it; not verified in this audit) and add a test that no block fixture renders a foreign host.
2. **Actions stay inside the package.** `navigate` only to `/apps/<id>/...`, `call` only to `/api/plugins/<id>/...`; reuse
   `spec/ui/app-check.ts`, now run on `chat_card.actions` too. `play` takes a media id, never a URL. `open_url` fields (the
   article's "Open on site") open with `rel="noopener noreferrer"`, adults and teens only, after the existing link filter.
3. **Budget.** At most 4 blocks and 64 KB of block JSON per tool result, 12 KB per block; larger is truncated by dropping the
   last blocks, not clipped mid-block. (Propose; confirm no existing limit before building.) A card never grows the privacy
   surface: no new outbound connection, so `docs/PRIVACY.md` rows do not change; the privacy test for News images (a
   fetch-on-first-request, hub cache) is the template.

Prompt injection: a block's strings come from a tool (a feed headline, a web page). They are drawn as text and never reach the
model as instructions; the model sees the reply text the tool produced, not the card. An action fires only on a click by the
person, and `confirm` precedes any `call` that changes data (the News `reset_mix` pattern).

## 4. Kit gaps (commons first, rule 9c)

Most tools are covered by Elements and kinds that ship. New work, in this order of value:

| Gap | Covers | Built on (shipped) | Size | Notes |
|---|---|---|---|---|
| `actions` slot on `AnswerBlockView` (generalizes the `news` prop) and `available` on the block envelope | every card | `answer-block.tsx` | S | Additive; `news` stays an alias one release. Spec: envelope gets optional `actions` (string list) and `as_of` |
| `story_feed` `rows` layout in chat width | news | `StoryFeed` (exists, NEWS-01) | S | Needs a phone-width check at the chat column, not a new Element |
| `media_card` | book-lookup, media-lookup, music, episode | `Card`, `Image`, `Button` primitives | M | `media_list` is for multiple ranked rows and cannot express one item's cover, title, subtitle, facts and actions as one result; `spec_sheet` is label/value facts and has no media identity or cover. Cover, title, subtitle, 3 facts, actions row. Needs a UI-DECISIONS row (Jesse) |
| `confirmation` | list-add, remind, lights, locks, open-app replies | `Alert`/task-card style row | S | Icon, one sentence, optional Undo. `remember` is not an answer block; the shipped `MemoryChips` Element (`memory-chips.tsx`) is drawn from each turn’s `memoryIds` (`memoryIdsByTurn` in `conversationHistory.ts`, read by `chatMemoryChips.ts` and `chatMemoryState.ts`). UI-DECISIONS row |
| `countdown` | timer | `schedule-card`, `number-ticker` | M | CHAT-CARDS-05 defines the one `countdown` kind; the Coming up page uses it. HOUSEHOLD-03 has not built a countdown. Counts down from `endsAt` on the client with no polling loop. "Time is up" is the card's own state; timer firing stays a notification. UI-DECISIONS row |
| `place_cards`, `map` | place-lookup | `map-answer` | S+S | Already KIT-GENUI-05; no network (schematic) |
| `stat`, `media_list` | `convert` and `currency` when they return a headline number; recents | kit `number-ticker`, `List` | S each | Already KIT-GENUI-02, -03; these are additional `returns_blocks` kinds when another kind is the manifest `chat_card.block`. |
| `calculator` | math | GENUI-06 calculator | M | GENUI-06 ships the calculator Element and formula interpreter; this note uses its calculator for whichever package GENUI-06 leaves, `math` or `calculate`. GENUI-06 retains its own scope to whichever package its backlog row assigns. |
| `job` block | picture, video, song, project, artifact | `job-progress`, players | L | CHAT-CARDS-11 is a placeholder row pending its own design pass and architect verdict. Reuse the MEMMGMT-2026-10-25 job-card copy table; add no polling beyond the job record's. Until then `native` is deprecated. |

`remember` declares `chat_card: { "none": "The memory chips under the reply show what was saved." }`; the shipped `MemoryChips` Element (`memory-chips.tsx`) is drawn from each turn’s `memoryIds` (`memoryIdsByTurn` in `conversationHistory.ts`, read by `chatMemoryChips.ts` and `chatMemoryState.ts`), not an answer block. Locks get no Undo: undoing a lock unlocks a door; the lock-doors approval card and the age and surface gates in rule 0 keep that action controlled.

No new Element is a Home wrapper; Home only supplies data and the action handler.

## 5. Slice plan

Priority: SETTINGS-IA-01 to -05 and the music verification rows (MUSIC-GEN-07, -08) come first (owner's current order);
**CHAT-CARDS-01 (the NEWS-06 pilot) is the first cards slice after them.**

| Slice | Size | Where | Scope | After |
|---|---|---|---|---|
| CC-01 pilot: News answer | S | commons, then home | Generalize the `actions` slot and `available` (commons); the `news` Tier 1 handler returns one `story_feed` (`rows`) block with `Open in News` (teen and adult), rides the answer-block path, no `TOOL_BINDINGS` entry, no Home wrapper | NEWS-03 |
| CC-02 spec | M | commons spec | `chat_card` manifest field, `actions`/`as_of` envelope fields, recipe `card` binding with interpreter tests in TS and Python, fixtures | CC-01 |
| CC-03 declarations and lint | M | commons, catalog, home | `chatCardCheck(manifest)` in `spec/ui/chat-card-check.ts` (one definition) called by catalog `tools/src/lint.ts`, Home `backend/tests/bundledPackages.test.ts` and the install path; declare all 37 bundled and 10 catalog manifests; patch-bump each, refresh bundled hashes (`scripts/refresh-bundled-packages.ts`), re-sign the catalog | CC-02 |
| CC-04 one action handler, image rule | S | home | `chatAnswerBlocks.tsx` runs `open_app`, `call`, `play`, `undo` from the manifest; generalize `hubImageSources`; CSP `img-src` | CC-01 |
| CC-05 kinds A | M | commons | `media_card`, `confirmation`, and `countdown` with tests and the UI-DECISIONS rows (Jesse approves the rows) | CC-02 |
| CC-06 retire the structured-part switch | M | home | Almanac x5, media-lookup, music and currency return `spec_sheet` blocks themselves; `convert` selects exactly one declared block (`spec_sheet`, `stat`, or `calculator`) as `chat_card.block`, with other returned kinds only in `returns_blocks`; `math` declares `chat_card.block: calculator` using the calculator Element and formula interpreter that GENUI-06 ships; delete the `composer.ts` switch and `SPEC_SHEET_BOUND` once the 90-day stored-row window and the history adapter keep rendering old rows. Each manifest declares one `chat_card.block`. | CC-02, GENUI-06 |
| CC-07 weather, sports, almanac actions | S | home, catalog | weather gets `Open in Weather`; sports returns a `data_table`; almanac gets `Copy` | CC-04 |
| CC-08 lookups | M | home, catalog | place-lookup `place_cards`+`map` (after KIT-GENUI-05, GENUI-08); book-lookup, media-lookup, music `media_card` with `Open in Music` | CC-05 |
| CC-09 timers and confirmations | M | home | timer returns the CC-05 `countdown`; remind and list-add return `confirmation` with `Undo` (remind may list `schedule_card` only as an extra `returns_blocks` kind); lights and locks return `confirmation` without Undo; `remember` declares `chat_card: { "none": "The memory chips under the reply show what was saved." }` and uses the shipped `MemoryChips` Element sourced from each turn’s `memoryIds` | CC-05 |
| CC-10 translate | S | home | Translate returns a `spec_sheet` with Copy. Home-only. | CC-02 |
| CC-11 fold the job cards | L | commons, home | Placeholder; own design pass and own architect verdict. One `job` block for picture, video, song, project, artifact; reuse the MEMMGMT-2026-10-25 job-card copy table; add no polling beyond the job record's; retire the six polling wrappers in `chatToolUis.tsx`. | CC-04 |
| CC-12 conformance gate flips on | S | home, catalog | Shrink-only baseline of tools with a declaration but no producing fixture goes to zero; the conformance test becomes a hard fail | CC-06 to CC-10 |

### 5.1 Tests

- **Render snapshot per block kind**, in the chat column width and at 375 px, light and dark, for each kind with all its states
  (full, empty, degraded). Lives in `commons` beside each Element; Home carries one thread-level test per kind through
  `AnswerBlockDataRender` (fixtures in `uiFixtures.ts`, the playground scenario list).
- **The lint** (`chatCardCheck`): fails on a missing `chat_card`; on `none` with a short or placeholder reason; on `none` with
  pages or `returns_blocks`; on `block` not in `returns_blocks`; on `open_app` without pages; on an unknown action name; on a
  `call` or `navigate` outside the package prefix; on `native` outside the closed list. Table-driven test with one bad
  manifest per failure.
- **Conformance** (the bar that makes the declaration true): for every package that declares `block`, a fixture run produces
  at least one block of that kind that survives `filterAnswerBlocks` for adult, and for child either survives or is absent by
  `min_band`; the block's `alt` is non-empty and appears in or agrees with the reply text.
- **Hostile fixtures:** foreign image host, `javascript:` URL, oversized block, 5 blocks, an action to another package's route,
  a producer mismatch: all dropped, answer intact.
- **Bands:** each kind through child, teen and adult; a child never gets an adult-only action.
- **Offline:** each `offline` value for one tool: draws, draws with "As of", draws no card.

### 5.2 Migration impact

- 37 bundled and 10 catalog manifests change (one `chat_card` line, patch bump); catalog index re-signed; bundled hashes
  refreshed. Installed community packages without `chat_card` keep running until the lint is switched on for install at the
  next `min_app`; they show a "no chat card" line in the store card, not an error.
- Stored turns keep rendering: `SPEC_SHEET_BOUND` and the structured-part binding stay for old rows (no data debt, rule 12).
- No database migration: blocks are already stored on the turn (`blocks`). The envelope's two optional fields are additive.
- `CHANGELOG.md` and each package's `README.md` gain one line; `docs/user` guides gain nothing until a card changes what a
  person sees (CC-01 onward).

### 5.3 Risks

| Risk | Mitigation |
|---|---|
| Outside authors ship hostile or ugly cards | Closed kinds, strict schemas, the hub filters, image rule, budget, store listing shows the declared card |
| The card repeats the reply text | Keep the existing `synthesis_hint`; the model writes one sentence beyond the card; conformance test compares alt and reply |
| Kit kinds multiply | The list is additive and each new kind needs a UI-DECISIONS row; `stat`, `media_list`, `place_cards` are already queued |
| Tier 0 recipe `card` step grows into a template language | Placeholders only (`{name}`), no loops or conditionals; a recipe needing more is a Tier 1 handler |
| Home wrappers stay (job cards) | Named as debt with a slice (CC-11); `native` is deprecated from the start and removed by CC-11 |
| Pin churn: three `commons` tags (kit, spec, tools) | CC-01 and CC-02 ship in one spec tag and one ui tag; PINNING.md applies |
| Two sources of truth (page `actions` vs `chat_card.actions`) | Same vocabulary, same checker, same handler; `chat_card.actions` names only entries the package's own `actions` map or the standard set defines |

## 6. Where the standard lives

- **Org docs** (`getmaipai/.github`, `docs/PACKAGES.md`): the contract. Draft below. The edit needs `Owner-approved`.
- **`docs/UI.md`** (org): add one line under the answer-block text: "A tool's chat result is a block; see PACKAGES.md".
- **Home:** this note is the design record; `docs/dev/` gets the how-to when CC-01 lands; the Elements adoption JSON
  (`frontend/src/dev/elements-adoption.json`) lists the new kinds.
- **`RULES.md`: no new rule is required.** Rule 9 already says all drawing is shipped Elements and that blocks are validated
  before the kit draws them; rule 6 already says a failed tool never fails the answer; this standard adds a manifest
  declaration and a lint, which are packaging policy, not chat-turn design. If Jesse wants the lint to be a hard design rule,
  the only candidate is one sentence added to rule 9: "A bundled or catalog tool's chat result is a block of its declared
  `chat_card`, or the manifest says in one line why not." That is a `RULES.md` edit, so it would be **NEEDS-RULE-CHANGE**:
  only Jesse approves, with an `Owner-approved: <date>` commit.

### Decision for Jesse

1. Should this be a hard rule in `RULES.md` or packaging policy in org `PACKAGES.md`? Recommended: packaging policy in org `PACKAGES.md`.
2. If it is a rule, should the wording allow the `native` closed list until CHAT-CARDS-11 removes it? Recommended: yes, explicitly allow that temporary closed list.

This note does not change `RULES.md`. A commit that changes a rule carries `Owner-approved: <date>`.

### 6.1 Draft text for `getmaipai/.github` `docs/PACKAGES.md` (draft only; not applied)

> ## Chat cards
>
> Every package a person can call from chat shows its result as a card, or says in one line why it does not. A card is an
> answer block (`spec/schemas/answer-block.schema.json`) drawn by the kit as shipped; a package never ships React and Home has
> no per-package chat code.
>
> **Declare it.** A `plugin`, `app` or `project` manifest carries `chat_card`, one of:
>
> - `{ "block": "<kind>", "actions": [...], "open_page": "<page id>", "fallback": "alt" | "reply" }`, where the kind is also in
>   `returns_blocks`;
> - `{ "native": "<name>" }`, deprecated and removed by CHAT-CARDS-11; until then it names a value from the closed list Home draws itself (picture, video and song jobs, project, artifact, confirm, sources); a package cannot add a name;
> - `{ "none": "<20 to 120 characters, why the reply text alone is right>" }`, for fire-and-forget or prose-only tools. Refused
>   when the package has pages or lists `returns_blocks`.
>
> **Produce it.** A Tier 1 handler returns `blocks`. A Tier 0 recipe uses the `format` step's `card` binding. The hub validates
> the block, applies the person's age band and the output floor, and drops what fails; the reply text is always complete.
>
> **Actions.** Use the standard names (`open_app`, `open`, `save`, `play`, `add_to_list`, `undo`, `copy`). `open_app` is
> "Open in <App>" and needs pages. An action reaches only the package's own `/api/plugins/<id>/` routes and
> `/apps/<id>/` pages. A block never names a route.
>
> **Images** in a block must be hub cache references; the browser never fetches an image from another host.
>
> **States.** Empty uses the kind's empty text; failure draws no card and the answer continues; an offline-degraded package
> draws from cache with an "As of" line.
>
> **Checks.** `chatCardCheck` (in `commons` `spec/ui`) runs in catalog lint, in Home's bundled-package test and at install. A
> package with neither a card nor a one-line `none` reason cannot ship in the bundled or catalog set. Carry one render
> fixture per declared kind and a child/teen/adult run.

## 7. Open questions for Jesse (go through the wizard when the slices start)

1. Approve the standard as written, and the optional one-sentence addition to rule 9 (section 6)?
2. Approve UI-DECISIONS rows for `media_card`, `confirmation` and `countdown` (section 4)?
3. Is a card shown to a teen on the shared kitchen screen allowed to carry `Save`? Recommended: no, person-scoped actions need a
   known speaker.

## 8. Evidence index

- Frontend bindings: `frontend/src/apps/chat/elementBindings.ts` (`TOOL_BINDINGS` registers 20 tool ids: 12 spec-sheet ids from
  `SPEC_SHEET_BOUND` plus 8 named parts; `DATA_BINDINGS` has 1).
- Structured-part producer and the `math`/`convert` gap: `backend/src/lib/composer.ts` (`specSheetCandidateForOutcome`, no
  `math` or `convert` case) against `backend/src/lib/structuredPartIds.ts` (`SPEC_SHEET_READY`).
- Id-keyed block switch: `backend/src/lib/packageBlocks.ts` `blocksForRecipeRun`.
- Filter and image rule: `backend/src/lib/answerBlocks.ts` (`filterAnswerBlocks`, `hubImageSources` checks only `image_gallery`).
- Read-only timer card: `chatAnswerBlocks.tsx` passes no `onScheduleToggle`.
- Manifests: `returns_blocks` set on weather, list-view, remind, timer, show_images, news only.

## 9. Architect verdict

The first architect verdict was REJECTED. Re-run after this revision. The architect must rule on this note and the rows before CC-01 starts; the org `PACKAGES.md` edit needs `Owner-approved`, and the new kit kinds need UI-DECISIONS rows from Jesse.
