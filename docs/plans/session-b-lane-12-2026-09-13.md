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

## 1b. SPEC-01's second reading: the refusals the shapes still lack (S, before item 4 continues)

An outside review of 29ac71f (read-only, 2026-09-14 03:15) found one
contradiction and a class of missing refusals. Fix in one commit:

1. `fact_confidence`: SPEC-01 says existing memory records migrate to
   1.0 with one `legacy_assertion` evidence entry; the schema declares
   it nullable with default null, the TypeScript validator requires
   non-null for `record_kind: memory`, and one memory fixture carries
   null, which that validator refuses. Resolve it the item's way:
   default 1.0 for memory records with the legacy entry in
   `confidence_evidence`, null only for entity and episode kinds, the
   fixture corrected, the validator and the schema saying the same
   thing.
2. Cross-field rules exist only in `spec/records/ts/validate.ts`
   (person scope needs `person`; companion scope needs
   `companion_id`; `child_disclosure` null on person and self scope;
   `confidence_evidence` empty unless memory). A robot validating by
   JSON Schema or the Python binding can write what the hub refuses,
   the no-data-debt rule's exact failure. Encode each rule in both
   language validators (the Python side has a twin, or gets one), or
   in the schema where `if`/`then` can express it, and add a refusal
   fixture per rule that both suites run.
3. Missing refusals to add the same way: a non-companion scope with a
   non-null `companion_id`; `child_disclosure_set_by` and `_set_at`
   set inconsistently (one without the other); `retrieval_feedback`
   with `last_corrected_at` while `corrections` is 0, or corrections
   positive with no timestamp; `TurnSignal.source: head` with a null
   `classifier_id`, or a non-head source with one; clause ranges
   unordered, overlapping, or past the text length; an `OpenQuestion`
   whose timestamps contradict its status (pending with `asked_at`,
   answered without `resolved_at`); a world `SubjectRef` with
   `source_kind` and `stable_key` not both set or both null.
4. Regenerate both bindings; every existing fixture validates; the
   bot's pin note names the same bump (this is a fix inside SPEC-01's
   release, not a second bump).

Acceptance: a refusal fixture per rule in both suites; the corrected
memory fixture; `bash scripts/check.sh` green; SPEC-01's item gains a
"second reading taken" line with the hash.

## 4. EVAL-07's dataset half: the registry, the loaders, the samples (S-M, now, while item 3 waits)

EVAL-07 (BACKLOG, and the program file's "EVAL-07" section with the
outside review folded in) has two halves: the replay through the
engine (Session A, memory mode, later) and everything before it, which
touches no engine code. Build the second half now in a new directory,
`backend/scripts/bench/datasets/`, nothing else in `bench/` (Session A
is in the scorer and runner for OUT-01): (1) the registry,
`registry.json`, one entry per downloaded dataset in
`home/data-scratch/datasets/` (name, version, URL, sha256 from
SHA256SUMS, license, attribution line, collection method, whether it
holds real identities, allowed uses, which split is held out), and a
`verify` command that checks every file against its checksum and
reports what is missing (never downloads on its own; the download
step is a separate command with the pinned URLs and checksums, used
only when a file is absent); (2) loaders that convert LongMemEval-
cleaned (S and oracle), LoCoMo and DailyDialog into one internal
form (conversation id, source, modality, sessions with timestamps,
turns with speaker, text, the dataset's own labels kept: act, emotion,
question type, evidence turn ids) with a unit test per loader on a
small embedded sample, never on the whole file; (3) the sample
selection the coherence review set for LongMemEval: 40 questions per
question type, seeded and deterministic, written as a manifest of ids
so the replay is reproducible; and the LoCoMo whole. Rules: every
processing step local; the raw files stay in `data-scratch/` and are
never copied under the repo's tracked tree; a loader that meets a
name, address or account-like string in a public dataset passes it
through unchanged (public, consented data), but nothing from these
sets is ever written into a committed fixture. Acceptance: the
loaders' unit tests; `verify` green against the downloaded files;
the manifest of sampled ids committed (ids only); a design note in
`docs/dev/session-b.md` naming the internal form so Session A's
replay consumes it without redesign. Out of scope: running anything
through the engine; the phenomenon-mining tags (a later item).

## Out of scope

Anything under `backend/src/`; SPEC-02 (the companions and manifest
changes, after CHAT-16); COMP-01's schema (deferred with COMP-01);
running seeded acceptance sets (Session A's).
