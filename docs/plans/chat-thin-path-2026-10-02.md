# The thin chat path (2026-10-02)

Status: accepted by the owner on 2026-10-02. The first draft's 13
rules were approved on one condition, that they account for memory,
filtering and companion voice; a check against those three found gaps,
and the accepted rules carry the amendments. This record is the
accepted design for the chat turn and overrides every older design
that conflicts with it.

Working files, git-ignored: `data-scratch/chat-ab/` holds the bench
output, the reconciliation inventory (what older documents these rules
override) and the requirements check (memory, filtering, voice).

## Why

A written chat message to Home gets a shorter, slower, plainer reply
than the same model gives when asked directly. The cause is not missing
features. It is what Home puts between the person and the model: a rule
that forces a search, a reply cap, a small history window, one sampling
set for every model, and hand-built copies of things the engine and
assistant-ui already do.

## Evidence

### CHAT-AB-01, partial (22 of 186 runs, 4 explanation questions)

Same model file (Qwen3-8B Q4_K_M), same engine build (b10797), Apple
M4 Pro with 24 GB, thinking off. Arm A sends plain messages to the
engine with no system prompt and no sampling fields. Arm A2 adds
Home's `CHAT_SAMPLING`. Arm B is Home's default turn path. This bench
measures reply text and time.

| Arm | Reply length | First text | Shape |
|---|---|---|---|
| A, bare | 394 to 819 words | 0.13 to 0.22 s | headings, lists, a comparison table |
| A2, bare plus our sampling | 445 to 931 words | 0.09 to 0.12 s | same |
| B, Home's pipeline | 68 to 162 words when it answered | 2.3 to 7.9 s | plain paragraphs |

- B forced a web search on 7 of its 8 explanation runs, questions the
  model answers well alone.
- When search was unavailable (4 of 8 runs), B answered "Sorry, I
  couldn't do that." The bare model answered the same question in 450
  to 930 words.
- The sampling set showed no clear effect on these four items. That
  arm is too small to conclude from.
- Not measured: reasoning problems, formatting tasks, long-form
  writing, world questions with real search, the two 9-turn memory
  scripts, any child turn and any spoken turn. The run was stopped
  because its side engine starved the live chat engine of memory
  (issue #203).
- Arm B's engine ran with a 32,768-token context. The Stack launches
  the live chat engine with 4,096.

### Code facts (read 2026-10-02)

- The default path is `backend/src/lib/turnMachine/` (`turn.pipeline.next`
  defaults to true). The old path is `turnEngine.ts`, 5,389 lines, which
  the default path still imports from, and which three callers still
  run on alone: the OpenAI-style route, the Wyoming satellite server,
  and parts of `routes/turn.ts` (bare mode, attachments, continuation).
- History window: 4 newest turns plus 1,200 estimated tokens
  (`conversationHistory.ts:1857`).
- Searched answers are told "completely from what you know ... under
  140 words" (`composer.ts:952-959`); results are snippets cut to 300
  and 600 characters.
- One global sampling set with XTC and DRY (`llm.ts:334`).
- The engine returns reasoning separately; Home wraps it back into
  `<think>` tags and splits it again by regex (`llm.ts:417`,
  `wellFormed.ts`), and the default path shows it only at the end.
- A model without a measured budget record loses tools, search and
  thinking (`turnMachine/budget.ts:14`).
- A custom NDJSON protocol and an 822-line frontend adapter stand where
  `assistant-stream` (installed) ships encoders, decoders and resume.
- The canvas renders plain lines, not the chat's markdown renderer.
- The input checks and the output gate are deterministic rules with no
  model call. No benchmark isolates the gate's cost; by design it holds
  text until a sentence or clause boundary.
- Four protections exist only on the old path and do not run for an
  ordinary chat today (issue #204): the forget command, the
  withheld-from-a-child signal and relay to an adult, the judge-skip
  status for refused and credential turns, and unknown-speaker handling
  on the robot.

### What Open WebUI and LM Studio do

Both send plain messages and let the engine apply the model's template.
Open WebUI sends no system prompt by default and omits any sampling
value the user did not set. Its default search lets the model call
`search_web` and `fetch_url` itself and read full pages. LM Studio keeps
per-model defaults in a `model.yaml`, toggles thinking through the
template, and streams reasoning as its own events. Bionic's search is a
hosted LM Studio service, not SearXNG.

## Hard rules

The rules live in one place, [docs/design/RULES.md](../design/RULES.md),
under "Chat turn" (rule 0 and rules 1 to 14). This record is the
evidence and reasoning behind them.

## Replacements

| Custom code today | Replaced by | Size |
|---|---|---|
| Canvas plain-line renderer | the kit's `MarkdownText` | S |
| Sources toggle | the kit's sources and inline-citation parts, plus an `[n]` mapper | S |
| Snippet-only search and its caps | fetch result pages with the installed Readability and linkedom; optional self-hosted Firecrawl or a hosted provider behind an optional key | M |
| `<think>` re-wrap and regex split | the engine's `reasoning_content`, carried as its own field and stream part | M |
| Web chat's NDJSON adapter | `assistant-stream` encoders, decoders and resumable streams | M |
| 4-characters-per-token estimate | the engine's `/tokenize` and reported context length | M |
| Global `CHAT_SAMPLING` | per-model catalog fields | S to M |
| Forced-search classifier | the model's own tool call | S to M |

Kept as ours, no maintained replacement: the output gate, the Stack's
memory governor and health, the prose tool-call fallback (to be
re-tested against engine-side grammar).

## Standards these rules amend

Each needs its sentence changed in the same commit that puts the rules
in force.

- `SAFETY.md`: add the gate's grain (rule 10), including the teen
  setting, which the "no admin setting may weaken" sentence forbids as
  written.
- `PRIVACY.md` and the user privacy page: an owner-keyed search
  provider is owner-chosen and not MaiPai-operated; queries then leave
  the house; adults only.
- `THIRD-PARTY-SERVICES.md`: page reading per search with its stated
  budget; keyless search as the default.
- `RULES-AND-LEARNED-COMPONENTS.md` and `STACK.md`: the learned lookup
  head goes; the rule-budget baseline drops; this record is the
  accepted design for the freeze rule, so stages 0 to 6 may change the
  default path.
- `DECISIONS.md`: superseded-in-part pointers on the 2026-09-16,
  2026-09-21 and 2026-09-22 entries.

## Decided on 2026-10-02

- Adult reasoning streams live under the check-as-it-arrives gate;
  `SAFETY.md` is amended to say so. A minor never receives reasoning.
- Model runners are the Stack's own only; supporting services are
  Stack-installed by default and may be an owner's existing instance.
- An architect gate (org design, shared plugin) rules on every proposed
  change against `docs/design/RULES.md`.

## Open decisions for the owner

- Whether the Stack's supervisor moves onto llama-server's router mode
  or llama-swap for load and unload. Rated large and low value.

## Order of work

0. The port list in rule 12, starting with the four live gaps in issue
   #204.
1. Rules 5 and 6: remove the adult written word cap and make a failed
   search fall back to the model.
2. Rule 1: tools on `auto`, forced search retired.
3. Rule 4: real context length in the Stack and a token-counted window,
   with the summary and episode recall on the new boundary.
4. Rule 7: page-reading search with numbered sources and citations, the
   minor floor on page text, the privacy page and the spoken first-word
   bar.
5. Rules 2 and 9: native reasoning, `assistant-stream` for the web
   chat, canvas renderer.
6. Rules 3 and 8: per-model settings and the model gate removed.
7. Rule 12: rewire the Wyoming and OpenAI-style callers, then delete
   the old path.

Each stage is chunked into `docs/BACKLOG.md` items and ends with a
CHAT-AB-01 rerun.

## Supersedes

Each passage below carries a marker line pointing at the rule that
overrides it. Paths are under `home/docs/` unless they start with
`stack/` or `commons/`. The backlog files, the org standards and the
code are handled separately. A passage that several rules override is
listed under each.

Rule 1:
- `docs/dev.md`: QUERY-WRITER-01: a pronoun follow-up after a required-call miss resolves before it...
- `docs/dev.md`: STREAM-NEXT-01: real progressive streaming for the new path (2026-09-24)
- `docs/dev.md`: The fixes (paragraph)
- `docs/dev.md`: Automatic web lookups instead of declining (2026-09-07, getmaipai/home#67)
- `docs/dev.md`: Scope and precedence (paragraph)
- `docs/dev.md`: Decisions (2026-09-12) (paragraph)
- `docs/dev.md`: Decision 10, revised: a bounded investigation mode (2026-09-12)
- `docs/dev.md`: After the 2026-09-12 block (paragraph)
- `docs/dev.md`: 4. Promises, offers, currency and corrections (findings 2, 3, 7, and 6 in part)
- `docs/dev.md`: 12. The act and the emotion of a turn, and the register they drive (2026-09-14)
- `docs/dev.md`: 16. The 2026-09-14 evening chat (findings 26 to 46, 2026-09-14)
- `docs/dev.md`: PAGE-01: reading a page the person asked about
- `docs/dev.md`: ARCH-BUILD-01: the buy-or-build verdict (2026-09-22) (paragraph)
- `docs/dev.md`: Track 3: the local decider verdict (2026-09-22)
- `docs/dev.md`: ARCH-MEASURE-01: the per-model budget verdict (2026-09-22)
- `docs/dev.md`: ENGINE-CONTRACT-01: the first recorded failure, `tool_choice: "required"` on a war...
- `docs/dev.md`: (b) The slowdown is the new path's design, in three places, not the box (paragraph)
- `docs/dev.md`: SIGNAL-02: the computed target, spec half written (2026-09-23)
- `docs/dev.md`: DEADLINE-01: a failed generation never delivers an empty reply (2026-09-23)
- `docs/dev.md`: (1) A forced call that misses must cost under a second, not eleven
- `docs/dev.md`: (3) SIGNAL-02 covers Tokyo end to end
- `docs/dev.md`: The interim rule's trigger, decided (2026-09-23)
- `docs/dev.md`: PHRASE-01: the phrasing round continues the forced call's prompt (2026-09-23)
- `docs/dev.md`: home#147: the new path never set structured_part or artifact (2026-09-24, Session B)
- `docs/dev.md`: (1) websearch's own `category` argument, fixed this block
- `docs/dev.md`: READ-PAGE-01: measured, shipped (2026-09-24)
- `docs/dev.md`: PHRASE-02: gated closed on today's own numbers (2026-09-24)
- `docs/dev.md`: Design pass over the reserved items (Fable, 2026-09-26)
- `docs/dev/session-a.md`: ACT-01: the turn signal, the producer's first layers, and the rows (2026-09-14)
- `docs/dev/session-a.md`: LOOKUP-01: a promise is the lookup, an offer is a pending ask (2026-09-14)
- `docs/dev/session-a.md`: LOOKUP-02: the hedge is a promise, the offer binds its question, the forced lookup...
- `docs/plans/chat-architecture-review-2026-09-16.md`: whole document
- `docs/plans/chat-architecture-review-2026-09-16.md`: 3. Verdict per layer
- `docs/plans/chat-architecture-review-2026-09-16.md`: 5. Corrections, in order
- `docs/plans/hardware-tiers-2026-09-23.md`: The tiers at a glance
- `docs/plans/simple-turn-pipeline-2026-09-22.md`: The short version (paragraph)
- `docs/plans/simple-turn-pipeline-2026-09-22.md`: 3. Deciding "is this a question about the world" without regex
- `docs/plans/simple-turn-pipeline-2026-09-22.md`: 7. The build units
- `docs/plans/simple-turn-pipeline-2026-09-22.md`: 10. End-state inventory
- `docs/plans/turn-machine-state-record-2026-09-22.md`: The machine
- `docs/plans/turn-machine-state-record-2026-09-22.md`: The transition table, once
- `docs/plans/turn-machine-state-record-2026-09-22.md`: The budget record
- `docs/plans/turn-machine-state-record-2026-09-22.md`: Acceptance (from the plan, made exact)

Rule 2:
- `docs/dev.md`: Voice output disfluency design, 2026-09-17
- `docs/dev.md`: Session A: step 3, conversations, the window, the rolling summary (2026-09-05)
- `docs/dev.md`: Decision (paragraph)
- `docs/dev.md`: The one representation every function already agrees on
- `docs/dev.md`: REASONING-01, landed (2026-09-21)
- `docs/dev.md`: The engine already separates it - checked live, confirmed, wired in
- `docs/dev.md`: Slice 5(d): Details, the stats reveal - two Elements ship, three real gaps named (... (paragraph)
- `docs/plans/session-a-intelligence.md`: Step 3: conversations, the window, the rolling summary (M)
- `docs/plans/simple-turn-pipeline-2026-09-22.md`: 1. What stays in code
- `docs/plans/simple-turn-pipeline-2026-09-22.md`: 10. End-state inventory
- `docs/plans/turn-machine-state-record-2026-09-22.md`: The machine
- `commons/docs/dev/session-b.md`: Then REASONING-01 (after ARTIFACT-02, not before)

Rule 3:
- `docs/dev.md`: Decisions (2026-09-12) (paragraph)
- `docs/dev.md`: FAST-06: variation from samplers, not from a prompt sentence (2026-09-12)
- `docs/dev.md`: The fidelity experiment, specified so it needs no further judgment (paragraph)
- `docs/plans/chat-architecture-review-2026-09-16.md`: whole document
- `docs/plans/chat-architecture-review-2026-09-16.md`: 3. Verdict per layer
- `docs/plans/conversation-competencies-2026-09-13.md`: D. Sounding like someone
- `docs/plans/turn-machine-state-record-2026-09-22.md`: The budget record

Rule 4:
- `docs/dev.md`: Session A: step 3, conversations, the window, the rolling summary (2026-09-05)
- `docs/dev.md`: Decision (paragraph)
- `docs/dev.md`: Slice 5(d): Details, the stats reveal - two Elements ship, three real gaps named (... (paragraph)
- `docs/dev.md`: ARCH-MEASURE-01: the per-model budget verdict (2026-09-22)
- `docs/plans/session-a-intelligence.md`: Step 3: conversations, the window, the rolling summary (M)
- `docs/plans/simple-turn-pipeline-2026-09-22.md`: The short version (paragraph)
- `docs/plans/turn-machine-state-record-2026-09-22.md`: The budget record
- `stack/docs/dev.md`: Settings
- `stack/docs/integrations.md`: The settings declaration
- `stack/docs/plans/studio-bench-protocol-2026-09-20.md`: What is fixed

Rule 5:
- `docs/dev.md`: 12. The act and the emotion of a turn, and the register they drive (2026-09-14)
- `docs/dev.md`: U4: the answer register by surface, landed on the new path (2026-09-23, `f17dcc1b`)
- `docs/dev.md`: U4c: the plan recomputes from real tool-round evidence (2026-09-23)
- `docs/dev.md`: (1) A forced call that misses must cost under a second, not eleven
- `docs/dev.md`: U4b-2: the reply floor's fixes, measured, held (2026-09-23)
- `docs/dev.md`: The written prompt on tier 1, decided (2026-09-23)
- `docs/dev.md`: PHRASE-01: the phrasing round continues the forced call's prompt (2026-09-23)
- `docs/dev.md`: #156: the measured search-list budget
- `docs/dev.md`: SEARCH-SHAPE-01 landed: bound the searched reply, do not format it (2026-09-26)
- `docs/plans/chat-architecture-review-2026-09-16.md`: whole document
- `docs/plans/conversation-competencies-2026-09-13.md`: D. Sounding like someone
- `docs/plans/issue-168-search-shape-2026-09-26.md`: whole document
- `docs/plans/simple-turn-pipeline-2026-09-22.md`: 1. What stays in code
- `docs/plans/simple-turn-pipeline-2026-09-22.md`: 7. The build units
- `docs/plans/simple-turn-pipeline-2026-09-22.md`: 10. End-state inventory
- `docs/plans/turn-machine-state-record-2026-09-22.md`: The reply floor (owner's rule, 2026-09-23)

Rule 6:
- `docs/dev.md`: SEARCH-EMPTY-01: search down and search found nothing are never the same reply (20...
- `docs/dev.md`: SEARCH-EMPTY-01: search down and search found nothing are never the same reply (20... (paragraph)
- `docs/dev.md`: DEADLINE-01: a failed generation never delivers an empty reply (2026-09-23)
- `docs/dev.md`: SEARCH-MIXED-01: a round that mixes a failed search with a succeeded call never le...
- `docs/dev/session-a.md`: LOOKUP-01: a promise is the lookup, an offer is a pending ask (2026-09-14)
- `docs/plans/search-resilience-2026-09-24.md`: What this adds (paragraph)
- `docs/plans/simple-turn-pipeline-2026-09-22.md`: 3. Deciding "is this a question about the world" without regex
- `docs/plans/turn-machine-state-record-2026-09-22.md`: The live grounding refusals of 2026-09-22 late: diagnosis and work order (paragraph)
- `docs/plans/turn-machine-state-record-2026-09-22.md`: Deployment limits narrow the budget

Rule 7:
- `docs/dev.md`: SEARCH-FALLBACK-01: a second front door, Wikipedia's own official API (2026-09-24) (paragraph)
- `docs/dev.md`: Structured execution and bounded composition (paragraph)
- `docs/dev.md`: 4. A lookup reply carrying its source; a URL, a picture or a video on the chat sur...
- `docs/dev.md`: PAGE-01: reading a page the person asked about
- `docs/dev.md`: Slice 5(a): sources, no inline markers yet - two shipped-component gaps named firs...
- `docs/dev.md`: The interim rule's trigger, decided (2026-09-23)
- `docs/dev.md`: READ-PAGE-01: measured, shipped (2026-09-24)
- `docs/dev.md`: SEARCH-ROWS-01 landed: infobox answers reach the model, and an empty-snippet searc...
- `docs/dev/session-d.md`: Step 7: the lookups
- `docs/plans/issue-168-search-shape-2026-09-26.md`: whole document

Rule 8:
- `docs/dev.md`: ARCH-MEASURE-01: the per-model budget verdict (2026-09-22)
- `docs/dev.md`: Regression B: `recall` instead of nothing on a negative control
- `docs/dev.md`: THINK-DEFAULT-01: thinking is the person's toggle, not the budget's default (2026-...
- `docs/dev.md`: U4b-2: the reply floor's fixes, measured, held (2026-09-23) (paragraph)
- `docs/dev.md`: PROJECT-REPLY-01: a confirmed start_project's own reply text, and a real complicat...
- `docs/plans/arch-review-2026-09-22.md`: The three most consequential findings
- `docs/plans/hardware-tiers-2026-09-23.md`: The tiers at a glance
- `docs/plans/simple-turn-pipeline-2026-09-22.md`: 3. Deciding "is this a question about the world" without regex
- `docs/plans/simple-turn-pipeline-2026-09-22.md`: 7. The build units
- `docs/plans/turn-machine-state-record-2026-09-22.md`: The transition table, once
- `docs/plans/turn-machine-state-record-2026-09-22.md`: Deployment limits narrow the budget
- `docs/plans/turn-machine-state-record-2026-09-22.md`: The budget record

Rule 9:
- `docs/dev.md`: STREAM-NEXT-01: real progressive streaming for the new path (2026-09-24)
- `docs/dev.md`: Voice output disfluency design, 2026-09-17
- `docs/dev.md`: Session B: step 4, chat on assistant-ui (2026-09-05)
- `docs/dev.md`: The engine already separates it - checked live, confirmed, wired in
- `docs/dev.md`: Slice 5(a): sources, no inline markers yet - two shipped-component gaps named firs...
- `docs/dev.md`: ADMIN-COMPARE-01 (b): the compare switch, and the seam that kept the safety floor...
- `docs/dev/reference-screens-review-2026-10-01.md`: The canvas, and the document in it
- `docs/dev/reference-screens-review-2026-10-01.md`: BACKLOG items (filed in docs/BACKLOG.md on 2026-10-01)
- `docs/plans/artifacts-evaluation-2026-09-21.md`: 5. Recommended architecture
- `docs/plans/chat-parity-2026-09-16.md`: Verdicts
- `docs/plans/session-a-intelligence.md`: Contract with Session B (frozen; additive only)
- `docs/plans/session-b-ui.md`: Framework decisions (verified 2026-09-05 against npm, GitHub and the official docs...
- `docs/plans/session-b-ui.md`: Step 4: chat on assistant-ui (M)
- `docs/plans/shell-09-deletion-list-2026-09-27.md`: Phase 2 . old chat
- `commons/docs/dev.md`: Workspace status
- `commons/docs/dev/session-b.md`: What landed this session (all pushed, all reported, all accepted)

Rule 10:
- `docs/dev.md`: STREAM-NEXT-01: real progressive streaming for the new path (2026-09-24)
- `docs/dev.md`: 2. Broken output (findings 13 and 17): the well-formed reply gate
- `docs/dev/session-a.md`: OUT-01: one validated reply boundary after every producer (2026-09-14)

Rule 11:
- `docs/dev/ods-review-2026-10-01.md`: The assembled stack: Open WebUI, Qdrant, Tika, SearXNG, Infinity, Open Terminal, O...
- `docs/dev/ods-review-2026-10-01.md`: BACKLOG items (filed in docs/BACKLOG.md on 2026-10-01)

Rule 12:
- `docs/dev.md`: The reply floor: the layers that remove substance today (2026-09-23)
- `docs/dev.md`: OPENER-01: landed as a runtime gate, the manifest edit found to conflict with the...
- `docs/dev.md`: U6: the flip, decided (2026-09-24, Fable's ruling on rerun 3)
- `docs/plans/chat-trueup-2026-09-23.md`: The work order: TRUEUP-01 (Session B, after PHRASE-01, before WRITTEN-PARITY-01) (paragraph)
- `docs/plans/simple-turn-pipeline-2026-09-22.md`: 6. Migration order, so the hub never gets worse
- `docs/plans/turn-machine-state-record-2026-09-22.md`: The setting

Rule 13:
- `docs/dev.md`: RERUN-PROTOCOL-01: Fable's own acceptance protocol, built into the bench (2026-09-23) (paragraph)
- `docs/dev.md`: The bar, verbatim
- `docs/dev.md`: PARITY-BISECT-04: arms e and f, and the ruling (2026-09-23)
- `docs/dev.md`: The written prompt on tier 1, decided (2026-09-23)
- `docs/dev.md`: TRUEUP-01: the new path sends the model only designed prose (2026-09-23) (paragraph)
- `docs/dev.md`: WRITTEN-PARITY-01: the written set measures the reply floor against the bare model...
- `docs/dev.md`: U6: the flip, decided (2026-09-24, Fable's ruling on rerun 3)
- `docs/plans/simple-turn-pipeline-2026-09-22.md`: The short version (paragraph)
- `docs/plans/turn-machine-state-record-2026-09-22.md`: The reply floor (owner's rule, 2026-09-23)
