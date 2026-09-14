# Session B: lane 12, the spec migration, the Confirm control, the fixture's expectations (2026-09-14)

Work order from the coordinating session, rewritten after the
coherence review (dev.md "Coherence review, 2026-09-14"). Spec,
frontend, bench-fixture and docs only. Session A is in the chat
engine (RECALL-02's follow-up, then OUT-01, then the engine items that
read SPEC-01's fields) and owns `backend/src/`. Same protocol as lane
11; gate in your own throwaway worktree; atomic stage-and-commit in
the shared checkout; nothing from the live household in any file.
Commit this file with item 1.

## 1. SPEC-01: the design pass's spec migration, one bump (S-M, spec only)

BACKLOG "SPEC-01" is the item, complete as written: every record the
design pass changes, declared once with a default in one spec
release, so Session A's engine items (ACT-01 onward) read fields that
already exist and the robot pins one version. The list of schemas,
vocabularies and fixtures is in the item; the definitions are in
dev.md sections 12 to 14 and the coherence review's question 1 (the
names that won: `TurnSignal`, `ReplyPlan`, `SubjectRef`,
`OpenQuestion`, `child_disclosure`, `fact_confidence`). Where the note
and the item disagree, the coherence review wins; where both are
silent, ask me rather than invent. `spec/` is not being edited by
Session A now, so work in the shared checkout; regenerate both
bindings; every existing fixture must validate unchanged (additive
only). Acceptance is the item's: round-trip fixtures for every new
field and record, the three validator refusals, the spec suite green,
`bash scripts/check.sh` green, the bot's pin note naming the one
version. This item unblocks Session A's whole queue, so it goes first
and its done report goes to me the moment it lands.

## 2. The Confirm control in People and things (S)

BACKLOG "Confirming an inferred entity or relationship": the route
exists on `main` (263670e): `PATCH /api/relationships/:id` and
`PATCH /api/entities/:id` with body `{ "confirm": true }`, adult only
(403 otherwise), inferred and unconfirmed only (409 otherwise), strict
body (400 on any other key); a relationship stays source `inferred`
and gains `confirmed_by_person_id` and `confirmed_at` on both
directions, an entity becomes source `local`. Add the Confirm control
beside the "unconfirmed" mark from lane 11, for adults only (hidden,
not disabled, for a child), one tap, the row updating in place; a 409
or 403 shows the kit's own error line. Tests: an inferred relationship
shows Confirm for an adult and not for a child; a tap sends exactly
that body and the mark clears; a 409 leaves the mark and shows the
line. Screenshot of the row before and after, opened. Docs: one
sentence on `docs/user/memory.md`. Tick the item.

## 3. The bench fixture's missing expectation kinds (S-M, after Session A's RECALL-02 follow-up lands)

The coherence review's question 5 found the fixture cannot express
eleven expectation kinds the design pass's rows need (signal, plan,
moves, subjects, pendingAsk who and lookup, openQuestion, memoryRows,
outcomeArgs, evidenceDisposition, notificationBody, seedRecords and
seedReply); the list is on ACT-01's item and the review section.
Extend `backend/scripts/bench/conversationFixture.ts` and the scorer
so a row can state each of them as an effect, typed against SPEC-01's
shapes where one exists, with one example row per kind in the fixture
marked as the design pass's rows are (failing today, expected to). Do
not touch the runner's live path or anything under `backend/src/`.
Coordinate the file with Session A through me: start only after I say
its RECALL-02 follow-up is on `main`, and tell me before you commit so
A is not mid-edit in the scorer. Acceptance: the fixture and scorer
tests cover each kind; the existing 47 conversations score exactly as
before (the same pass set on the household bench, no live run needed
for that: the scorer's unit tests against recorded replies); the
example rows are listed in the item's status line.

## Out of scope

Anything under `backend/src/`; SPEC-02 (the companions and manifest
changes, after CHAT-16); COMP-01's schema (deferred with COMP-01);
running seeded acceptance sets (Session A's).
