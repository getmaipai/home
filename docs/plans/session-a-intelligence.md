# Session A: intelligence (backend and spec)

A self-contained work order for one coding session. Point a session at
this file and it codes until every step is done and merged. Session B
(`session-b-ui.md`) runs at the same time on the frontend; the two never
edit the same files, and the interface between them is frozen in the
"Contract with Session B" section below. Written 2026-09-05 from the
audit recorded in `docs/BACKLOG.md` ("The 2026-09-05 audit") and
`docs/dev.md`.

## Read first

1. `/Users/jessetorres/Developer/github.com/getmaipai/.github/CLAUDE.md`
   (org standards: git workflow, verification, testing, writing style,
   privacy, safety invariants). All of it applies.
2. `docs/dev.md`: the "Hub v0.1 status" punch list, the "Notes for later
   (companion personas)" section, and every 2026-09-05 entry.
3. `docs/BACKLOG.md`: "The 2026-09-05 audit" and "Chat, memory and
   persona". This plan implements that section plus the memory-owned
   half of "Portability and the link".
4. The platform plan, chapters 4.4 and 4.5:
   `~/.claude/plans/purring-chasing-noodle.md` (outside the repo; read
   only).
5. `spec/README.md`, `backend/src/lib/turnEngine.ts`,
   `backend/src/lib/memory.ts`, `backend/src/lib/conversationHistory.ts`,
   `backend/src/lib/persona.ts`, `backend/src/lib/packageHost.ts`,
   `backend/src/lib/llm.ts`, `backend/src/lib/scheduler.ts`.

## The goal

Turn stateless Q&A into a conversation with someone who knows who is
talking, remembers what matters without being told to, and speaks as a
consistent character. Concretely, at the end of this session:

- "And tomorrow?" after a weather answer gets tomorrow's weather.
- The model knows the speaker's name, role, age band, locale and local
  time, and who else lives in the house.
- A parent's chat never carries a child's person-scoped memories.
- A fact said in passing ("we're going to Boston in July") is stored
  with provenance, dated, deduplicated, and recalled by meaning, not by
  a shared keyword.
- Recall uses the embedding engine that already runs.
- Forget writes a tombstone, and every memory carries a clock stamp.
- A companion has a name and a stable voice, and the prompt uses it.
- Output is safety-checked sentence by sentence, not only the input.

## Rules for this session

- **Worktree, because Session B is editing the same repo.** Create one
  with `EnterWorktree` (or `git worktree add ../home-a main`), work
  there, and merge to `main` and delete it before the session ends. A
  worktree that outlives the session is a bug.
- **Own data directory and port.** Run the backend with
  `MAIPAI_DATA_DIR=<worktree>/data-a PORT=8797 bun run dev` from
  `backend/`. Never point at the shared `data/` directory.
- **Rebase often.** `git fetch && git rebase origin/main` before each
  commit. Session B's commits touch only `frontend/`, `spec/ui/`,
  `backend/src/settings/uiKeys.ts`, `scripts/screenshot.ts` and its own
  `docs/dev.md` section, so conflicts should be none; if one appears,
  keep both sides.
- **`docs/dev.md` is append-only for you.** Add one section per shipped
  step under a heading that starts with `## Session A:`. Never edit
  another section. `docs/BACKLOG.md`: check off only items this plan
  ships, and add new gaps you find under the section they belong to.
- **Spec first.** Any change to a record shape goes in
  `spec/schemas/*.schema.json`, then `bun run gen:ts` and
  `bash scripts/gen-py.sh` in `spec/`, a fixture in
  `spec/fixtures/records/`, and only then the hub. `check.sh` fails on
  ungenerated output.
- **Tests before fixes, in the repo's own shape.** `bun:test`, the
  existing `backend/tests/*.test.ts` helpers (`client.ts`, `preload.ts`,
  `reset-db.ts`), the stub LLM and embed backends. Every bug found live
  becomes a regression test first. No live model in the per-commit
  suite; the model-driven checks are a bench run on demand.
- **Definition of done per step:** `scripts/check.sh` green, the
  behaviour exercised against the running backend (curl or the test
  client), the `code-review` skill at medium effort on the diff, docs in
  the same commit, one commit per step. Never `git add -A`.
- **Never** log or return a memory's text where a secret could sit, put
  real family data in a fixture (persona roster only), or add a network
  call outside the limiter.

## Files you own

`backend/src/lib/{turnEngine,memory,memoryShape,memoryId,conversationHistory,persona,packageHost,plugins,llm,llmSupervisor,embedSupervisor,scheduler,safety,text,rateLimiter,replyVariation,hlc}.ts`,
`backend/src/routes/{turn,memory,conversations,host,llm}.ts`,
`backend/src/db/schema.ts` and `backend/src/db/migrations/`,
`backend/src/wire.ts`, `backend/src/settings/*` except `uiKeys.ts`,
`backend/packages/*`, `spec/schemas/*`, `spec/fixtures/*`, `spec/gen/*`,
`spec/records/*`, `spec/safety/*`, `spec/llm/*`, `spec/tests/*`,
`backend/tests/*`, and your own sections of `docs/dev.md` and
`docs/BACKLOG.md`.

You do not touch `frontend/`, `spec/ui/`, `scripts/screenshot.ts`, or
`backend/src/settings/uiKeys.ts`. If a step needs a frontend change,
note it in your dev.md section for Session B and move on.

## Contract with Session B (frozen; additive only)

Session B builds the chat, home, search and memory surfaces against
these shapes. Everything here is additive to what exists on `main`
today; nothing existing is renamed or removed.

**Turn stream** (`POST /api/turn/stream`, NDJSON, one object per line).
Existing events stay: `spoken_cue`, `delta`, `done`, `error`. New:

- The request body accepts optional `conversation_id`. Absent means the
  actor's open conversation for that surface (created if none).
- The first line is `{ "type": "turn_meta", "conversation_id",
  "turn_id" }`.
- `done.value` gains `conversation_id` and `turn_id`.

**Conversations** (`/api/conversations`):

- `GET /` lists the actor's conversations: `{ id, surface,
  companion_id, title, turn_count, last_turn_at, created_at }`, newest
  first. The pre-existing `GET /` behaviour (flat turn list) moves to
  `GET /turns` unchanged, so nothing breaks while B migrates.
- `POST /` creates one: body `{ surface?, companion_id? }`, returns the
  record.
- `GET /:id` returns the record; `GET /:id/turns?since=<turn_id>`
  returns its turns oldest first, each with `memory_ids: string[]`
  (empty until the judge runs).
- `PATCH /:id` sets `title`. `DELETE /:id` deletes one. `POST
  /batch-delete` with `{ ids }`. `POST /clear` deletes all of the
  actor's conversations (the batch-actions rule).
- A deleted conversation deletes its turns; memories written from them
  stay (they carry the turn id as provenance and outlive the chat).

**Memory** (`/api/memory`): existing routes stay. `GET /` gains
`?since=<iso>` for "what changed since I last looked". `POST /` accepts
an optional `source` (a turn id) so "remember this" from a message can
attribute correctly. `POST /:id/archive` is "forget this" from a
message. Each record already carries `person`, `scope`, `source`,
`created_at`.

**Notifications**: a new declared type `memory.updated`, level
`passive`, channel `in_app` only, one per judge run that wrote at least
one record, payload `{ conversation_id, turn_id, memory_ids }`. B's bell
already polls; this is how the "memory updated" chip learns something
happened without a second stream.

**Companions**: `GET /api/plugins` already lists installed packages;
companions appear there with `kind: "companion"` and the fields in step
8. The per-person setting `persona.active_id` keeps its key and becomes
the companion id. A conversation's `companion_id` is set at creation
from that setting.

## Steps, in order

Each step names the tests it adds and the acceptance check. Sizes are
the backlog's: S is a session or less, M is days.

### Step 0: setup (S)

Worktree, data dir, port, `bun install`, `scripts/check.sh` green at
the baseline, the backend running with the stub LLM
(`spec/llm/ts/stubServer.ts`) so tests and manual checks need no model.
Confirm the embed backend kind reports `stub` in tests
(`embedSupervisor.ts`) and note how to point it at the real engine for
a bench run.

### Step 1: the speaker and household blocks, and local time (S)

`buildSystemPrompt` in `turnEngine.ts` takes the actor. Add, in the
volatile zone after persona and policy: the speaker (display name,
nickname if any, role, age band derived from birthdate when present,
locale from `core.locale`), the household (each active person's display
name and role, presence unknown for now), and a local-time line
formatted for the locale ("Friday 3:40 pm" style, never raw ISO UTC).
Keep the 4,000-char budget test passing; if it cannot, the blocks
shrink, not the budget.

Tests: prompt contains the speaker's name and role; a child speaker
yields the child band; locale-formatted time; the budget test.
Acceptance: "what's my name" and "who lives here" answer from the
prompt with the stub model echoing its context.

### Step 2: scoped recall, person-scoped remember, provenance (S)

- `recall()` in the turn runs with `{ person: actor.id }` semantics: the
  actor's own person-scoped records plus household scope, never another
  person's person scope, regardless of role. The list route's parental
  view is unchanged.
- The `remember` recipe writes `scope: person` and `person: actor.id`
  for first-person statements ("I", "my", "me") and `household`
  otherwise; the interpreter gets the actor id it already has.
- `createHost()` receives the turn id when called from a turn, and
  `Host.memory.remember` writes `source: <turn id>` (the spec's
  canonical provenance) with the package id kept in a second field only
  if the schema has one; otherwise `source` is the turn id and the
  package is logged.
- `uses`/`last_used_at` bump only on records that reached the prompt.

Tests (regression first): an owner's turn prompt does not contain a
child's person-scoped memory text; "remember I'm allergic to peanuts"
writes scope person with the actor; provenance equals the turn id;
usage counts equal injected count.

### Step 3: conversations, the window, the rolling summary (M)

Spec first: `spec/schemas/conversation.schema.json` with `id`,
`person`, `surface`, `companion_id`, `title`, `status`
(`open|closed|deleted`), `summary`, `summary_through_turn`, `source`,
`hlc`, `created_at`, `updated_at`, plus fixture and generated bindings.
Hub: a `conversations` table; `conversation_turns.conversation_id`
(migration backfills existing rows into one conversation per person and
surface); the routes in the contract; `runTurn`/`runTurnStream` resolve
or create the conversation and emit `turn_meta`.

The window, built in `prepareTurn`: the newest 4 turns of this
conversation verbatim as user/assistant messages, older turns added
oldest-dropped-first until a 1,200-token estimate (chars / 4) is
reached, and above that the conversation's `summary` as one system-side
line. The summary is refreshed by a post-turn core job when at least 4
turns have fallen out of the window since `summary_through_turn`, using
the chat role with a fixed prompt that carries the old summary and the
dropped turns; it never runs in the request path. Copy the numbers from
legacy `routes/chat.ts` (`trimHistory`, `refreshConversationSummary`)
and record them in dev.md with the reason: 800 tokens dropped 4-turn
back-references; a stale summary "is real amnesia".

Tests: the follow-up turn's messages contain the prior exchange; the
window respects the estimate; the summary job runs when due and not
before; conversation CRUD, batch delete and clear; a deleted
conversation keeps its memories. Acceptance against the running
backend: weather, then "and tomorrow?", with the stub model showing it
received the prior turn.

### Step 4: prompt order and budgets (S)

Stable-first for prefix caching: identity and companion, information
policy, standing skills, then the volatile zone (household, speaker,
memory, summary, time last). Re-anchor the companion's one-line
identity after the memory block (legacy measured drift in about eight
turns). Memory lines carry an "as of <date>, <n> days ago" suffix and
the block ends with a one-line reminder to prefer these facts over
guesses. Add a per-section budget test in the shape of the bot's
`test_prompt_budget.py`: rules, memory, companion, summary each have a
cap and a test that fails when any one exceeds it.

Tests: order assertion, per-section caps, the dated suffix.

### Step 5: embedding recall and scheduled maintenance (M)

- `memory_embeddings` table: `memory_id`, `space` (the model name,
  today `nomic-embed-text`), `dims`, `vector` (Float32 blob), `hlc`.
- Embed on write through `llm.embed`; when the embed backend is down,
  queue the id in a `pending_embeddings` list (a core job retries every
  minute) and fall back to keyword scoring for that record.
- `recall()`: entity-first pass as today, then cosine over the actor's
  readable records (brute force in JS; at household scale this is
  hundreds of rows), score `0.7 cos + 0.2 importance + 0.1 recency`,
  floors 0.55 episodic and 0.37 durable (legacy's tuned values, same
  embedding family; record that they must be re-measured on the bench
  before v0.1), keyword as the fallback when no vector exists. Keep the
  entity-name boost. Top 5 to the prompt.
- Re-run the legacy recall probes (`backend/scripts/eval/` in the
  legacy mirror; port the 11 memory probes as a bench script under
  `backend/scripts/bench/`) against the real embedder once, and record
  the numbers.
- `runMaintenance` runs daily via `ensureCoreJob`.

Tests: with the stub embed backend returning fixed vectors, a
paraphrase recalls the right record and a keyword-sharing decoy does
not; the fallback path when the backend is `none`; the pending queue
drains; maintenance is scheduled at boot.

### Step 6: the memory judge (M-L)

A post-turn core job `memory.judge` for every `source: model` turn:

- One chat-role call with a fixed extraction prompt and a
  grammar-constrained response. Add `response_format` / `json_schema`
  support to `LlmCompleteOptions` and the llama-server client if it is
  not there (llama-server supports it). The schema is tiny on purpose:
  `{ facts: [{ text, category, scope: "person"|"household", importance,
  valid_from?, valid_to? }] }`, at most 12 facts. A small model copies
  examples, so the prompt's examples use names that never recur
  (legacy's extractor rule).
- Rules from legacy `memory/judge.ts`, each as a test: only facts the
  speaker asserted (a question is not a fact); possessives resolved
  from the speaker's view ("my wife" is the speaker's wife, never
  "likely your daughter"); relative dates made absolute from the turn's
  timestamp; trips and states stored as dated `state` with `valid_to`
  when known (the hub once "kept treating the user as abroad after they
  came home").
- Dedupe: embed each candidate, compare with the actor's readable
  records at cosine 0.5, look at the top 5 (the true duplicate once sat
  sixth), and `supersede` on a match rather than insert; a
  contradiction supersedes and closes `valid_to` on the old record.
- Write the new ids onto the turn (`memory_ids`), and one
  `memory.updated` notification per run that wrote something.
- Poison guard: at most 3 attempts per turn, then mark the turn
  `judge_failed` and move on.
- An idle-time `memory.consolidate` job weekly: merge point facts into
  durative ones, re-tense expired states, demote durable records that
  have never been recalled (legacy: "mis-tiered junk is immortal").

Tests: a scripted stub-model reply produces the expected records with
provenance; the possessive, question and relative-date rules; dedupe by
supersede; the poison guard; the notification. Bench (on demand): a
household fixture on the persona roster, LongMemEval-shaped, testing a
knowledge update and an abstention; record the first numbers in dev.md.

### Step 7: the profile paragraph (S-M)

One pinned, person-scoped record per person, `category: identity`,
`tier: durable`, `pinned: true`, text no longer than 600 chars: who they
are, what they like, what is going on this week. Written and rewritten
only by the consolidate job from the person's own records; never by
the extractor directly. Injected whole at the top of the memory block
before recalled items, counted inside the memory section budget.

Tests: the profile is injected first; it never exceeds its cap; a
rewrite supersedes the old row.

### Step 8: companions with an identity (M)

Companions are packages (`kind: companion` already exists in the
manifest enum). Extend the manifest schema with a `companion` block:
`display_name`, `pronouns`, `tagline`, `backstory` (short), `interests`,
`examples` (3 to 5 lines in the character's own voice), `voice_id`, and
the four style dials `persona.ts` already has (`formality`,
`complexity`, `engagement`, `filler_density`). Bundle the four existing
presets as companion packages under `backend/packages/` (one directory
each, `manifest.json` plus `README.md`), keep `persona.active_id` as the
setting key with the companion ids as options, and make `persona.ts`
compose from the manifest: identity line using `display_name` ("You are
Nova, ..."), the dials as today, the examples as a short few-shot block
(legacy's review: "the single biggest lever for small-model voice
fidelity"). Keep the prose under about 150 tokens; the plan's nine
sliders and steering vectors are recorded as later work, not built
here. `replyVariation.ts` gets a per-companion confirmation pool with
the shared pool as the default.

Tests: the prompt uses the companion name; examples appear; a missing
companion falls back to the default; a persona consistency test with
ten scripted exchanges scored by string checks (address form, length
cap, forbidden phrases). Acceptance: switching `persona.active_id` in
Settings changes the identity line on the next turn.

### Step 9: output-side safety on the stream (S-M)

`spec/safety/ts/classifier.ts` promises "again on every streamed
sentence". In `runTurnStream`, run it per sentence (the sentence
chunker exists in `frontend/src/lib/sentenceChunker.ts`; move the
chunker to `spec/` so both sides use one definition, TS now, Python
later) with the speaker's role, and on a `refuse` category cut the
stream, emit `error` with the catalogue code, log a flagged turn, and
notify as the input path does. Never weaken the input check.

Tests: a scripted stream containing a refusable sentence is cut at that
sentence; earlier sentences were delivered; the notification fires.

### Step 10: tombstones and clock stamps on the records you own (M)

The portability half that lives in your files:

- Spec: add `hlc` to `memory-record` and `person` (Grant already
  should have one per plan 3.1; add it there too), regenerate, fixtures.
- Hub: `memory_records.hlc` and `people.hlc` set from `lib/hlc.ts` on
  every write; `hlc.ts` gets its missing seed/compare tests.
- `memory.forget()` and the person-delete cascade stop hard-deleting
  memory rows: status becomes `archived` with text and embedding wiped
  and a `deleted_at`, the row kept as a tombstone so a later sync
  cannot resurrect it. `exportPerson` skips tombstones. Person delete
  keeps its existing person tombstone behaviour.
- `conversation_turns` and `conversations` carry `hlc` too (step 3
  already added it to the conversation shape).

Tests: forget leaves tombstones with empty text; export omits them;
every write sets a monotonic hlc; the seed/compare tests.

### Step 11: request limits (S)

`POST /api/turn`, `/api/turn/stream` and `/api/llm/*` get a per-person
token bucket through `rateLimiter.ts` (a person's pace: a turn every
couple of seconds, burst of a few). `telegramChannel.ts` and
`voiceCatalog.ts` fetches go through `tryConsume` like `host.fetch`.

Tests: the bucket refuses the burst with the catalogue error; the two
fetch sites consume from a bucket.

### Step 12: wrap up

- `docs/dev.md`: one `## Session A:` section per step with what shipped,
  the numbers chosen and why, and anything left for Session B or a later
  session.
- `docs/BACKLOG.md`: check off what shipped, correct anything you found
  wrong, add gaps you found.
- `scripts/check.sh` green; `code-review` on the final diff; merge the
  worktree into `main`; delete the worktree; do not push unless Jesse
  says ship.

## If you get stuck

- A design question the plan, spec or standards can answer: dispatch
  the `design-resolver` agent (org CLAUDE.md, "Resolve design ambiguity
  before asking") and record its decision in dev.md.
- A step that needs a frontend change: write the need into your dev.md
  section, keep the API additive, and continue with the next step.
- A step that cannot be verified without the real model: ship the
  deterministic part with tests, and record the bench command to run
  in dev.md.
- Something only Jesse can decide (a release, a real-world fact, a
  product call): finish every other step, then stop with a status block
  naming exactly what is blocked and why.
