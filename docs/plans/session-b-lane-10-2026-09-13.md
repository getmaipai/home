# Session B: lane 10, sources on a reply and the shell chunk (2026-09-13)

Work order from the coordinating session. Spec, frontend and docs only;
Session A is in the chat engine and memory (4b, 4c, #99, #98, CHAT-15,
3a, CHAT-13, CHAT-16) and owns everything under `backend/`. Same
protocol as lane 9. Commit this file with item 1.

## Why item 1 comes now

The media-conversation program (`media-conversation-program-2026-09-13.md`,
step 4) makes CHAT-16 phrase every factual answer from evidence: a typed
source first, then websearch through the household's SearXNG, then model
knowledge. A reply built from evidence has sources, and the chat has to
show them, or the household cannot tell a looked-up fact from a guess.
The backlog item "Inline citation markers on sourced answers" records
the design already validated once (numbered source list, `[N]` markers,
accumulate the whole text before parsing because a marker can split
across streaming chunks) and the decision to build that pattern, not the
structural-citation one. This lane builds the shared shape and the
frontend half now, against fixtures, so that when Session A's composer
emits sources the chat renders them with no redesign. The spec goes
first because the shape is shared with the robot (org rule).

## 1. Sources on a reply: the shape in the spec, the rendering in the chat (M)

Spec: add `spec/schemas/source.schema.json`, a `Source` record: `id`,
`kind` (`web`, `wikidata`, `wikipedia`, `weather`, `package`), `title`,
`url`, `site` (the hostname, what a chip shows), optional `snippet`,
and the provenance and clock stamp every spec record carries (mirror
`memory-record.schema.json` for the envelope fields and naming). Add an
optional `sources: Source[]` to the assistant turn in
`conversation.schema.json`. Regenerate `spec/gen`, add the round-trip
fixture the other records have, and one sentence in `spec/README.md`.
Do not add the field to `backend/src/wire.ts` or any backend file:
Session A adds `sources?: Source[]` to `TurnValue` and the turns
endpoint when CHAT-16 emits them; the coordinator has told it the shape
lands here.

Frontend, mirroring `chatSourceCaption.tsx` (read the rendered
message's own metadata, attached by `chatHistoryAdapter.ts` on reload
and `chatModelAdapter.ts` live, tolerant of the field being absent):
(a) both adapters carry `sources` from the turn when present; (b) a
`SourcesCard` under a settled assistant reply lists the sources
numbered, title plus site, each a link that opens in a new tab with
`rel="noopener noreferrer"` and `referrerpolicy="no-referrer"` (the
privacy page's promise: a cited site learns nothing from the click but
the click); (c) inline `[N]` markers become a small chip that names the
source and links out, parsed from the complete text buffer only, never
per streaming delta, and a marker with no matching source stays plain
text; (d) no favicons and no third-party image loads: the favicon proxy
is its own backlog item and waits for the citation work to have
something to cache, exactly as that item says. Kit primitives first
(`frontend/src/kit`); the chat's existing chip styling for the marker.

Acceptance: a frontend test per promise (a turn with three sources
renders a card with three numbered links and the right attributes; a
`[2]` inside streamed text split as `[` then `2]` across two chunks
renders one chip after the stream settles; a `[7]` with two sources
stays text; a turn without sources renders no card and no chip; reload
through the history adapter shows the same card as live); the spec
round-trip fixture; `bun test` in `spec/` and `frontend/`; the BACKLOG
item "Inline citation markers on sourced answers" rewritten to what is
true (shape and frontend built, waits on CHAT-16 to emit `sources`,
favicon proxy still its own item) and left unchecked; the user chat
page gains one short paragraph on what a source chip is and that
tapping it opens the site, written for when it ships (no "not yet"
wording, the page describes the product). No live screenshot is
possible until the composer emits sources; say so in the status line
instead of staging one.

## 2. Real code-splitting for the frontend shell chunk (M)

BACKLOG.md "Real code-splitting for the frontend shell chunk" (UI /
shell): the main chunk crossed the PWA precache ceiling and the ceiling
was raised to 5 MiB as a workaround. Do the real fix: route-level
`dynamic import()` for the apps under `frontend/src/apps/` (each app is
a natural boundary; the shell, the kit and the chat stay in the entry
chunk since chat is the first screen), and whatever `vite build`'s own
splitting options add on top. Measure before and after: the entry
chunk size and the number of chunks from `vite build`'s output, and
the app-shell precache manifest size. Lower the workbox ceiling back to
the default if the entry chunk fits, or to the smallest value that
holds, and say which. Acceptance: the before and after numbers in
`docs/dev/session-b.md`; the full suite green; the screenshot pass
regenerated and opened for Home, Chat and one lazily loaded app (the
loading state between chunks must be the kit's own skeleton, never a
blank screen: take one shot mid-load if the script can, otherwise say
it could not); the BACKLOG item ticked with the numbers.

## Out of scope

Anything under `backend/`; the favicon proxy and cache (its own item);
emitting sources from the engine (CHAT-16, Session A); structural
citations.
