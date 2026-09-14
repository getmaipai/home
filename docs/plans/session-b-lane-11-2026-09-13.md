# Session B: lane 11, what MaiPai is doing, and who it knows (2026-09-13)

Work order from the coordinating session, for a fresh Session B.
Frontend, spec and docs only; Session A is in the chat engine and
memory (the judge, #99, #98, CHAT-15, 3a, CHAT-13, CHAT-16) and owns
everything under `backend/`. Handoff: `docs/dev/session-b.md` (lanes 4
to 10, what is built, what waits on CHAT-16), lanes 9 and 10 plan files
beside this one. Same protocol: reply ready with your model name, start
on my word, report done per item with the hash and the test names,
gate in your own throwaway worktree beside the repo, commit this file
with item 1.

## 1. The chat shows what MaiPai is doing during a turn (S-M)

Why: CHAT-16 makes the engine look things up before it answers (a
typed source, then websearch through the household's SearXNG), and a
lookup takes seconds. A person watching a blank bubble for four seconds
reads it as broken; a person who sees "Checking that for you" reads it
as thinking. The turn stream already has a `spoken_cue` event
(`backend/src/wire.ts`, `TurnStreamEvent`) that the voice path speaks
as filler; `chatModelAdapter.ts` line 246 handles it. Session A will
add an additive `{ type: "status"; text: string; stage: "lookup" |
"thinking" | "tool" }` event when CHAT-16 emits it; you build the
rendering now against a fixture, as lane 10 did for sources.

Do: (1) read how `spoken_cue` reaches the screen today (the comment
near line 236 says a visible indicator matters most for someone
without audio) and decide, in `docs/dev/session-b.md`, whether the
status line and the spoken cue are one thing rendered two ways (one
definition) or two; the default answer is one: a `status` event and a
`spoken_cue` both set the same transient activity line; (2) the
activity line: a small line inside the streaming assistant bubble, the
event's own text, shown from the event until the first `delta` or the
terminal event, then gone; never persisted, never in history; `aria-
live="polite"`; the kit's own muted text style, no spinner icon
invented (the kit's skeleton or its existing pending affordance); (3)
`chatModelAdapter.ts` handles the `status` event through a forward-
compatible narrow cast the way lane 10 handled `sources`, so nothing
about the adapter changes when Session A adds the union member.
Acceptance: a test per promise through the stubbed `/api/turn/stream`
(a status event shows its text; the first delta removes it; a done
with no delta removes it; a stream without status shows nothing;
history reload shows no trace of it); no live screenshot is possible
until the engine emits the event, say so in the status line; the
BACKLOG gains one S line under the chat area, "engine emits `status`
events at lookup start (CHAT-16)", unchecked, pointing at this file.

## 2. People and things: the household's registry, visible and correctable (M)

Why: step 3a of the media-conversation program has the judge create
entities (a person, a pet, a place, an organization, a thing) and
relationships ("my coworker Dean") from conversation, marked
`inferred` until someone confirms them (`spec/schemas/
relationship.schema.json`: an inferred relationship is never spoken as
fact). Nothing in the frontend shows or corrects any of it today: the
routes exist (`/api/entities`, `/api/relationships`, both CRUD,
`backend/src/routes/entities.ts` and `relationships.ts`) and no page
reads them. A household that cannot see what MaiPai thinks it knows
about Snoopy or Dean cannot fix it, and a wrong inferred relationship
is the exact danger the schema names.

Do: a "People and things" section in the Memory app
(`frontend/src/apps/memory/MemoryPage.tsx`, the app that already owns
"what MaiPai knows"; if its information architecture argues for a
sibling route instead, say so in the design note and do that). List
entities grouped by kind, each with its relationships in plain words
("Dean: Sage's coworker", "Snoopy: Bramble's dog"), the `inferred`
ones visibly marked as unconfirmed with a one-tap Confirm (which sets
the relationship's provenance to `stated` through the existing update
route) and a Delete; edit name and kind inline; create a person, pet,
place, organization or thing with a name and, optionally, one
relationship to someone in the household. Household-scoped entities are
visible to everyone; person-scoped ones only to their owner (the list
route already enforces it; the UI shows what the route returns and
labels scope). Kit primitives; batch delete per Jesse's standing rule
(multi-select on every deletable list). Acceptance: a test per promise
(a seeded household lists two kinds with their relationships; an
inferred relationship shows unconfirmed and Confirm flips it; edit and
delete round-trip through the routes; a person-scoped entity is absent
for another person); the flow exercised live against the seeded demo
household; the screenshot script gains the section (desktop and
phone), opened and judged; `docs/user/memory.md` gains a short section
in dad language on "People and things" (what it shows, how to fix a
wrong guess); the BACKLOG item under the memory or entities area
rewritten to what is true, and the line that says the judge creates
these (step 3a) left for Session A.

## Out of scope

Anything under `backend/`; emitting the `status` event (Session A,
CHAT-16); the judge creating entities from conversation (Session A,
step 3a); voice or face confirmation of a person.
