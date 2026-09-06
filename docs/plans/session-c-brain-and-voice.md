# Session C: the brain and the voice loop (backend and spec)

A self-contained work order. Read `wave-2.md` first (rules, ownership,
shared-file protocol, contracts), then this file, then code until every
step is merged. Written 2026-09-06.

## Read first

1. `getmaipai/.github/CLAUDE.md` and `docs/ENGINEERING.md` there.
2. `docs/plans/wave-2.md`, all of it.
3. `docs/plans/session-a-intelligence.md` and `docs/dev.md`'s
   `## Session A:` sections: what Wave 1 built in your files, and the
   numbers it chose.
4. `docs/BACKLOG.md`: "Chat, memory and persona" (what is still open),
   "Advanced tool calling", "Voice / robot", "Legacy: copy, re-examine,
   record", and "Wave 2 additions".
5. Platform plan 4.3, 4.4, 4.5, 4.11 and 7.5
   (`~/.claude/plans/purring-chasing-noodle.md`, read only).
6. `backend/src/lib/{turnEngine,conversationHistory,memory,memoryJudge,persona,safety,llm,tts,ttsSupervisor}.ts`,
   `spec/safety/README.md`, `spec/llm/README.md`, `spec/voice/README.md`,
   `spec/voice/ts/normalizeForSpeech.ts`.
7. Legacy references you will copy numbers from (read only):
   `home-legacy.git`: `backend/src/llm/router.ts` (the annotated regex
   classes), `backend/src/lib/voice/sttSession.ts` and `sileroVad.ts`,
   `backend/scripts/eval/**`, `docs/internal/chat-latency.md`;
   `bot-legacy.git`: `guards.py`, `test_prompt_budget.py`, the honesty,
   interaction, latency and conversation benches.

## The goal

At the end of this session the hub routes by meaning, calls tools the
model cannot fake, refuses to invent, speaks like a person, listens as
well as it talks, and the family's old memories are here. Concretely:

- "bedtime story" reaches the storytime skill, not the joke plugin; a
  routing corpus proves it and every miss becomes a row.
- "weather in Boston and what's on my list" is one model response with
  two grammar-valid calls, verified before either runs.
- A reply that invents a fact, repeats "like I said" across
  conversations, or claims an ability the hub lacks is caught after the
  model and before the family hears it.
- Ten scripted exchanges hold a companion's register; a steering-vector
  spike says whether a vector beats a paragraph.
- Push-to-talk works end to end against a real STT engine on the hub.
- Numbers, clock times and units are spoken the way a person says them,
  by a library, in both languages the spec ships.
- The legacy hub's people, memories and conversations are imported into
  spec-shaped records with provenance, once, from the legacy data
  directory.

## Files you own

See `wave-2.md`, "Ownership map", session C. You do not touch
`frontend/`, `spec/ui/`, `backend/packages/` other than `remember` and
`recall`, `lib/plugins.ts`, `lib/packageHost.ts`, or anything under F's
engine and identity files. A need on the other side goes into your dev
file and the backlog, and you move on.

## Steps, in order

### Step 0: setup (S)

Worktree `../home-c`, branch `session-c-brain-and-voice`, `data-c`, port
8801, `bun install`, `scripts/check.sh` green, the stub LLM and stub embed
backends confirmed in tests, and the command to point a bench run at the
real engine recorded in `docs/dev/session-c.md`. If A's step 11 is not on
`main`, ship the per-person token bucket on `POST /api/turn`,
`/api/turn/stream` and `/api/llm/*` now (a turn every couple of seconds,
burst of a few, the catalogue error), tests included.

### Step 1: Tier 1 routing on embeddings, and the routing corpus (M)

- `lib/routing.ts`: at first load of each package, embed every
  `routing.examples` entry through `llm.embed` (the same space memory
  uses; store in a `routing_embeddings` table keyed by package id,
  example hash and space, so a changed example re-embeds and an unchanged
  one does not). At turn time embed the utterance once, score each
  package by max cosine over its examples, fire when the top candidate
  clears a threshold and beats the runner-up by a margin (start at 0.62
  and 0.08; measure on the corpus before trusting either), keyword
  overlap as the fallback when the embed backend is down.
- Tier 0 patterns and household commands keep their precedence.
- The corpus: `spec/llm/routing-corpus.json`, rows `{ utterance,
  expect: <package id> | null, args?, must_not: [ids] }`. Seed it from
  legacy `llm/router.ts`'s annotated misroutes ("I GOT THE JOB" is not a
  remember; "do you know who X is" never hits search), every routing
  example of every bundled package as a positive, and near misses for
  each. A test runs the corpus against the stub embedder with fixed
  vectors for the deterministic suite, and a bench script runs it
  against the real embedder and prints precision and recall per package.
- `RoutingStatsSection` on the frontend reads a routing stats route
  today; keep its shape, add `tier` and `score` per decision.

Tests: the corpus test; the fallback; changed example re-embeds;
precedence order. Acceptance: bench numbers recorded in your dev file
with the thresholds chosen.

### Step 2: Tier 2, grammar-constrained tool calls (M)

- `LlmCompleteOptions` gains `tools` and `tool_choice`; the llama-server
  client sends them with `response_format`/grammar so arguments are
  schema-valid by construction (llama-server supports both; note
  upstream issue 24807 on lazy grammars and verify every call with the
  package's `args` schema before acting; an unparseable call is "ask
  again", never a silent drop).
- Offer only the top few Tier 1 candidates as tools (the pre-filter),
  capped at two calls per turn; two independent calls run in parallel;
  a result that feeds another is a recipe, never a loop. A
  `consequential: true` package raises the bar: the model may propose
  it, the turn engine asks the person to confirm before it runs, and the
  recipe result's `confirm` field drives the same path.
- `exposes.queries` from D's manifest change (see the contract) appear
  as typed read tools; until D lands it, the test uses a fixture
  manifest.
- `ask` continuation: a result carrying `ask` is stored on the
  conversation (`pending_ask`), and the next utterance is matched
  against it before the floor.
- Routing corpus rows for multi-call utterances.

Tests: a scripted tool-call reply runs the package with validated args;
an invalid call asks again; the cap; a consequential package waits for
confirmation; `ask` continuation. Bench: Qwen3-4B-Instruct-2507 and
Gemma 4 E4B on the corpus, numbers recorded.

### Step 3: the guards after the model (M)

`lib/guards.ts`, a post-model pass on the full reply and, where a rule
can be applied per sentence, on the stream: invention (a proper noun,
number or date in the reply that appears in neither the prompt's facts,
the tool results, nor the conversation, is flagged and the sentence
rephrased or dropped), unrelated recall (a memory injected but not
relevant to the question is not restated), near-echo (the reply repeats
the question), medication doses (never stated as a number), capability
claims (no "I set a reminder" unless a package ran), the "like I said"
rule (never across conversations), and the attractor rule for prompt
examples. Port each from `bot-legacy`'s `guards.py` with its original
failing reply as the test input. Guards never block the safety floor and
never rewrite a package's own `speech` string.

Tests: one per guard, from the real broken replies. Acceptance: the
bot's 34-case conversation bench ported to `backend/scripts/bench/` and
run once against the real model, raw versus guarded, recorded.

### Step 4: the persona floor: consistency test and the steering spike (M)

- The persona consistency test (ten scripted exchanges scored by string
  checks: address form, length cap, forbidden phrases) in the
  deterministic suite, plus a model-judged version on demand.
- The naturalness pairs: a small corpus of robotic versus natural
  phrasings (`spec/llm/naturalness-corpus.json`) in the shape of the
  safety corpus, with the before/after framing examples (time as a
  fragment, yes/no as a fragment, a list spoken as a sentence) joining
  the stable prefix. A bench scores a model and prompt on it.
- The activation-steering spike: llama-server takes `--control-vector`;
  train one with `cvector-generator` from paired prompts for one
  companion, run the consistency test over thirty turns with the vector
  versus the paragraph, and record which holds register, at what cost
  per token. This is a measurement, not a feature; the outcome decides
  whether the nine sliders are prose or vectors and goes into the
  backlog as a decision.

### Step 5: speech to text on the hub, and push-to-talk's server half (M)

- A voice program for STT under `spec/voice/` (the contract) and
  `lib/stt.ts`: sherpa-onnx with Moonshine for English (the robot's
  choice, one runtime for both), downloaded pinned by sha256 like the
  TTS program, supervised through F's `sidecars.ts` once it lands (your
  own supervisor until then, same shape as `ttsSupervisor.ts`).
- `lib/sttSession.ts` with the numbers legacy tuned: Silero VAD with
  0.5 open and 0.35 close hysteresis, a 0.32 s pre-roll, an RMS
  pre-check so typing and fans never open an utterance, the decode
  kicked at the voiced-to-silence edge and reused when the final
  arrives, a 30 s force flush, `[BLANK_AUDIO]`-style annotations dropped.
  Keep the Moonshine silent-head rule: a short pre-roll and a retry from
  onset when the model returns empty.
- The routes in the contract (`WS /api/stt/stream`,
  `POST /api/stt/transcribe`, status). Wyoming is step 8.

Tests: the session state machine with scripted PCM (silence, speech,
silence); the pre-roll; the transcribe route with a fixture WAV against
a stub program. Acceptance: a real utterance through the socket returns
the right text on the running backend.

### Step 6: spoken numbers, dates and units by library (S-M)

`spec/voice/ts/normalizeForSpeech.ts` hand-rolls `numberToWords`. Replace
it with `to-words` (licence checked first; record it in `NOTICE`), keep
the hand-written ruleset for clock time ("seven forty-six"), ordinals in
dates, currency and units beside it, and add the Python twin with
`num2words` (LGPL-2.1: a dependency, never vendored) under
`spec/voice/py/` with one fixture set both must pass. The speech lint
(`PACKAGES.md`: every package `speech` string) is a test in
`spec/tests/` that D's packages run against.

### Step 7: the content ceiling record and the age band in context (M)

Spec first: `spec/schemas/content-ceiling.schema.json` (per band: the
dials, the floor that no setting lowers, `hlc`), a fixture, generated
bindings. The safety layer reads the ceiling through the band instead of
the role proxy; `age_range` is in the package `ctx` and the prompt's
speaker block; the one-time adult acknowledgment for unrestricted mode is
a signed record (F's Grant carries it; you consume it). The crisis
overlay is verified to be non-configurable: a test flips every setting
and the resources still appear. Nothing here weakens a floor; the
review treats any such change as the highest-severity bug.

### Step 8: the hub as a brain for other clients (M)

- `POST /v1/chat/completions` (OpenAI-compatible, streaming) on
  `routes/openai.ts`, authenticated by a device token (F's
  `deviceTokens.ts`; a per-person API token setting until it lands),
  mapping to `runTurnStream` with `surface` from a header. Listed on the
  privacy page as inbound only.
- Wyoming on a TCP port (`wyoming` protocol, the `wyoming` npm package if
  its licence allows, else the small JSONL framing hand-written and
  tested): `describe`, `transcribe` through step 5, `synthesize` through
  TTS, `intent`/`handle` through the turn engine. Authenticated: a
  satellite pairs with a device token, never open on the LAN as admin
  (the legacy Wyoming socket ran unauthenticated; not that).

Tests: a scripted client for each; auth refused without a token.
Acceptance: a Home Assistant Assist pipeline pointed at the hub gets an
answer (record the command; if no HA instance is reachable, the
scripted client is the acceptance and the HA check is noted for Jesse).

### Step 9: the memory bench and the judge's entity records (M)

- A LongMemEval-shaped household fixture on the persona roster
  (`backend/scripts/bench/memory/`): knowledge updates, abstention,
  temporal questions, multi-session recall; run against the real model
  and embedder on demand; first numbers recorded.
- The judge writes Entity records (F's `entities` table and spec shape;
  until it lands, the judge writes `record_kind: entity` memory records
  as today and the switch is a one-line change recorded in your dev
  file).
- Decide and implement what an emptied conversation becomes (the
  backlog's open decision from A's step 3): auto-close, tombstoned by
  retention, with a test.

### Step 10: import from the legacy hub (M)

`lib/legacyImport.ts` and `POST /api/memory/import/legacy` (owner only,
runs once, idempotent by legacy id): reads the legacy `app.db`
(schema in `home-legacy.git`'s `docs/.../dev/database.md` and
`backend/src/db/`), imports people (matched by display name to existing
people, never auto-created for children without a parent's pick),
memories (legacy `memories`, scopes mapped to `person`/`household`,
`source: import:legacy:<id>`, `valid_from` from `created_at`, embedded
on write), and conversations (legacy `messages` into `conversations` and
`conversation_turns`, per person). Every imported row carries `hlc` and
provenance; nothing is translated later. A dry run reports counts first.
A fixture legacy database built from the persona roster is the test; the
real run is Jesse's, on the hub, with a backup taken first (the route
refuses without one).

### Step 11: wrap up

`docs/dev/session-c.md` complete; one line in `docs/dev.md`'s "Wave 2"
index; the backlog checked off and corrected; `scripts/check.sh` green;
`code-review` on the final diff; merge into `main`; delete the worktree;
do not push unless Jesse says ship.

## If you get stuck

- A design question the plan, spec or standards can answer: the
  `design-resolver` agent, decision recorded in your dev file.
- A frontend need: write it in your dev file under "For Session E" and
  keep the API additive.
- A step that needs the real model: ship the deterministic part with
  tests, record the bench command.
- Something only Jesse can decide: finish every other step, then stop
  with a status block naming exactly what is blocked and why.
