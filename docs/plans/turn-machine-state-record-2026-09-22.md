# U2: the turn machine, its state record (2026-09-22)

The design record for the new turn pipeline's core (unit U2 of
[simple-turn-pipeline-2026-09-22.md](simple-turn-pipeline-2026-09-22.md)).
It fixes the machine's states, the contract every node keeps, the trace
every turn writes, the budget record that varies per model, and what the
machine never does. ARCH-BUILD-01's verdict (dev.md, 2026-09-22) chose
XState v5 to run it; the definition below is ours and would be the same
under any runtime.

## Why this shape

A turn is a short, bounded conversation between the household and one
model call with tools, wrapped in the rules that must never be judgments:
safety, privacy, consent. Today those rules and about forty word rules
share one 6,400-line function, so nobody can say which layer took the
time or made the mistake, and no layer can be replaced without touching
the others. The machine below makes each layer a node with a typed
contract and a trace entry, so an error, a delay or a wrong answer is
named by its node, and a better node is registered, proven on the replay
set, and swapped in with no caller change.

## The contract (one declaration, `backend/src/lib/turnMachine/contract.ts`)

```ts
type Surface = "chat" | "overlay" | "pod" | "robot" | "tv" | "phone";

interface ContextItem {           // ARCH-POLICY-01's ingress unit
  id: string;
  text: string;
  source: "window" | "memory" | "episode" | "profile" | "clock" | "roster" | "tool_result" | "search_result" | "document" | "notification" | "quoted";
  subjects: string[];             // entity ids the item mentions
  disclosure: "child_ok" | "teen_ok" | "adult_only";
  at?: string;                    // ISO date for dated items ("remembered Sep 15")
}

interface ToolRequest { tool: string; args: Record<string, unknown>; callId: string }
interface ActionProposal { kind: "read_only" | "side_effecting"; request: ToolRequest }
type PolicyDecision =
  | { allow: true }
  | { allow: false; reason: "min_role" | "consent_needed" | "confirm_needed" | "ungrounded_args" | "temporary_mode" | "crisis_state"; ask?: PendingAsk };

interface TurnBudget {            // one record per model, in the catalog
  rounds: 0 | 1 | 2;              // tool rounds the model may take
  tools_offered: string[];        // the fixed, sorted set; never varies per turn
  always_search: boolean;         // the interim rule
  answer_from_context_tool: boolean;
  model_transitions: boolean;     // false on the robot's Pi
  query_writer: "model" | "builder"; // who writes a search: the model's argument, or the engine's builder (also the fallback when the model's argument fails grounding)
  context_tokens: number;
  thinking_budget_tokens: number;
  thinking_for_minors: boolean;   // false by default: a minor's turn runs with thinking off
  deadlines_ms: { model: number; tool: number; total: number };
  measured: { false_call_rate: number; inverse_miss_rate: number; rewrite_pass_rate: number; on: string };
}

interface TurnState {
  turnId: string; conversationId: string; actor: PersonRow; surface: Surface;
  utterance: string; signal: TurnSignal; budget: TurnBudget; plan: ReplyPlan;
  safety: SafetyResult; crisis: boolean;
  context: ContextItem[];         // the filtered list, the only prompt input
  messages: LlmMessage[];         // built from context, never from anything else
  proposals: ActionProposal[]; outcomes: ToolExecutionOutcome[];
  generations: GenerationInput[]; nodes: NodeExecution[];
  reply: { text: string; speech?: string; sources: Source[] } | null;
  ask: PendingAsk | null;         // set when the machine parks
  end: "done" | "refused" | "asked" | "blocked" | "cancelled" | null;
  reasoning: { emit: boolean; withheld_for: null | "minor" | "surface" | "presence" | "gate" };  // decided in `context`, never later
}

type NodeOutcome = { ok: true } | { ok: false; code: string } | { skipped: true; reason: string };
interface NodeExecution { node: NodeName; impl: string; version: string; startMs: number; endMs: number; outcome: NodeOutcome }
type NodeName = "safety" | "commands" | "context" | "model" | "policy" | "tool" | "answer" | "output_gate";
type Node<In, Out> = (state: TurnState, input: In, signal: AbortSignal) => Promise<{ outcome: NodeOutcome; output: Out }>;
```

Every node is registered under its name with an `impl` id and a version;
the machine calls whichever implementation the budget record or a
declared setting selects. A node reads `TurnState` and returns its output
and outcome; it never reaches into another node's internals, and it
never reads the raw utterance when the context list exists (the list is
the prompt's only input, which is what makes ARCH-POLICY-01's boundary a
pure filter later).

## The machine

XState v5 `setup()` with the actors below; every `invoke` carries the
node's deadline from the budget and the turn's abort signal; every state
entry and exit is an inspection event the trace writer records.

| State | Actor (node) | Reads | Exits |
|---|---|---|---|
| `safety` | `safety` | the utterance, the age band, the conversation's crisis state, temporary mode | `refused` (a refuse category, the fixed refusal line, the crisis overlay when due); `blocked` (the credential line); else `commands` |
| `commands` | `commands` | the utterance against the closed exact-match set (household commands, the bundled closed intents: lights, timers, lists, reminders, "what time is it", "remember that", "forget that", the almanac) | `answer` with the package's reply and outcome; else `context` |
| `context` | `context` | the window (in-process for a temporary chat), the memories as dated and labeled items, the episodes, the profile line, the clock, the roster, the disclosure filter for this reader and the presence on this surface | `model`; sets `reasoning.emit` (false, with `withheld_for`, when the speaker is a minor, the surface is not a typed chat screen, or presence says a child may be in the room) |
| `model` | `model` | `messages` built from the context list, the fixed tool set, `tool_choice` per the interim rule, the plan's `max_tokens` plus the thinking budget | a tool call: `policy`; text: `answer`; no visible text: one regeneration with thinking off, then `answer`; reasoning spans go to the wire only when `reasoning.emit` is true, and only after `output_gate` has passed them; otherwise they are consumed and dropped inside the node |
| `policy` | `policy` | each `ActionProposal`: the manifest's `min_role`, `consequential`, `permissions`; the grounding of the arguments against the context list (term-level, see "Grounding, stated exactly"); the household-subject rule for a search; temporary mode (no `memory:write`); the crisis state (no lookups) | `tool` for an allowed read-only request; `asked` (the machine parks with a pending ask) for a consent or a confirmation; `answer` with the refusal line for `min_role`; for a side-effecting request the executor runs the typed plan and returns its outcome to `tool` |
| `tool` | `tool` | `runPlugin` under the tool deadline; the outcome recorded in model order | `model` while `rounds` remain; else `answer` |
| `answer` | `answer` | the model's final text or the package reply, the outcomes' sources, the surface's projection (`reply.speech`), the plan's budget | `output_gate` |
| `output_gate` | `output_gate` | every streamed sentence through `gateOutputSafety`; the honesty invariant (an action claim needs a succeeded outcome); the malformed repair | `done`; `refused` when the output floor refuses; reasoning spans pass the same safety gate and the disclosure filter as the answer before any `reasoning` event, and a span the gate refuses sets `withheld_for: "gate"` |
| `asked`, `done`, `refused`, `blocked`, `cancelled` | terminal | | the turn row and the trace are written; `asked` stores the pending ask and the next turn's `safety` state consumes it first |

Transitions the model may drive (`model` to `policy`, the second round)
exist only when `budget.model_transitions` is true; with it false the
`model` node runs with `tool_choice: "none"` and the machine goes
straight to `answer`. That is the whole difference between the hub and
the robot's Pi: one machine, one file, a budget field.

The interim rule, in `model`'s actor: when `signal.primary_act` is
`question`, `signal.target` is `world`, and `budget.always_search` is
true, the call runs with `tool_choice: "required"` over the search tool.
**The `answer_from_this_conversation` escape is off initially (Astra's
review, 2026-09-22): a quote check proves a line exists in the
conversation, not that it is true, and the Chile follow-up in the
skeleton run recycled a hallucinated name that way.** Reuse of an
earlier answer returns only around previously retrieved evidence (a
succeeded outcome on this conversation) with a freshness window, which
is a later item; until then the interim rule is plain forced search, and
`budget.answer_from_context_tool` is false everywhere. When the escape
returns it is the second tool of the same forced call (one argument: the quoted line
of the context list it answers from). `policy` verifies the quote is in
the list (a set check); a quote that is not there is an ungrounded
argument and the search runs instead. A household subject in the
utterance keeps the search off (the household-subject rule). The
quiet-window run of 2026-09-22 (rule on and off, ten repeats) records
the cost of the redundant searches and the miss rate, and the rule's
default per model is set from it.

## Grounding, stated exactly (2026-09-22, after U2d's first live run)

The policy node's grounding check is term-level, never a substring
match. A tool call's string argument passes when it shares at least one
content term with the grounding set: the utterance, the window's user
turns, and the names the hub itself said (`hubNames`); content terms are
case-folded, stop words dropped, compared on the same prefix the repeat
guard already uses, and a number, a year or a date the model adds ("president
of Chile 2026") never counts against it. The check refuses exactly two
things: a bare pronoun as the whole argument, and zero overlap (an
invented topic). A rephrase is the model's job and passes by design; a
literal-substring rule refuses real queries and control rows alike,
which is what U2d's first live run showed (new path 0 of 7 failed rows
and 8 of 13 controls, old path 2 of 6 and 12 of 13), so that reading is
wrong and this paragraph is the contract. One argument is a substring
check on purpose: `answer_from_this_conversation`'s quote must be a line
of the context list, compared after whitespace and case folding, because
its whole meaning is "this line answers it".

## The live grounding refusals of 2026-09-22 late: diagnosis and work order

After the term-level fix (c09ac25b, d0cd09bb) the live replay still ended
nearly every world question, control rows included, on the policy
refusal line "I don't actually have that in this conversation, so I won't
guess." (new path 0 of 7 failed rows and 8 of 13 controls; old path 2 of
6 and 12 of 13), while the three unit cases pass. No live trace was
available to this diagnosis: `hub.log` carries no new-path turn lines,
the replay's raw output was not found under `data-scratch`, and
`u2-notes.md` is empty, so what follows is read from the code with the
causes ranked, and the first item of the work order is the trace that
makes the cause certain on the next run.

**Where the line comes from.** `nodes/answer.ts` `policyRefusalLine()`
prints that sentence for every `ungrounded_args` decision, and
`nodes/policy.ts` produces `ungrounded_args` from four different
branches: the answer-from-context tool reaching policy (line 133 area), a
tool whose manifest does not load (the `loadManifestOnly` failure), the
`argsGrounded()` false, and nothing else distinguishes them in the trace.
The unit test (`tests/turnMachine/policy.test.ts`) exercises only
`argsGrounded()` with `{ expression }`.

**Cause 1, most likely: every string argument must pass on its own.**
`argsGrounded()` (`nodes/policy.ts` line 80) loops over every string
value in `args` and returns false on the first one with no shared term.
The websearch manifest declares three arguments: `expression`,
`category` (an enum, `images`) and `read_page`. Under `--jinja`
tool calling the engine constrains the call to that schema, and the old
path had to add `noteIgnoredModelWebsearchCategory()` because the 8B
does send `category`; a call `{ expression: "president of Chile 2026",
category: "images" }` grounds its expression and is refused on
`category`, since "images" is never in the utterance. The same holds for
any second string field a package declares. The test
`argsGrounded({ expression: "president of Chile 2026" }, [...])` cannot
see it. This explains a refusal on Dune and Chile alike whenever the
model fills the second field.

**Cause 2, a cost not a refusal: the utterance is not in the context list
the quote check reads.** `nodes/context.ts` builds the list from the
window's prior messages, memories, profile, clock and roster; the
current utterance is `state.utterance` and is not an item. The guard
`contextQuoteGrounded` (`machine.ts` line 150) checks the quote against
`context` only, so a model that answers from context by quoting the
question itself is sent to the forced search retry (`forceSearchOnly`),
which then meets cause 1 again. Not the refusal, but it doubles the
model calls on exactly these rows.

**Cause 3, checked and not it:** the arguments reach policy as parsed
objects (`startCompleteStream`'s generator returns
`toolCallFromWire` results; `runOneGeneration` keeps `step.value`), the
tokenizer (`lib/text.ts` `tokenize`) folds case and drops only a short
stop list that contains none of the query words in the failing rows,
and `groundingSourceTexts()` does include the utterance.

**Work order, GROUND-01 (S, Sonnet: a live verification loop; after the
weekly reset).** Step 0, before any change: capture on a real failing
call the refusal branch, the loaded manifest and the rejected argument
(name and shape), so the cause below is confirmed rather than assumed;
the regression test then uses the real manifest and the full argument
object the model produced. Files: `backend/src/lib/turnMachine/nodes/policy.ts`,
`contract.ts`, `machine.ts`, `nodes/answer.ts`, `trace.ts`,
`backend/scripts/bench/interimRuleMeasure.ts`,
`backend/tests/turnMachine/policy.test.ts`.
1. Split the reason: `PolicyDecision.reason` gains `unknown_tool` and
   `context_tool_in_policy`; `ungrounded_args` keeps only the
   `argsGrounded` false, and the policy node's trace entry records
   `{ arg, terms, source_term_count }` for the refusing argument (terms,
   never the raw values). The refusal line stays one sentence; the trace
   is what changes.
2. Ground the query, not every field: `argsGrounded()` checks only the
   manifest's declared search-text fields (a `search_text: true` mark on
   the argument schema, `expression` on websearch), never "any free
   string"; identifiers, recipients, quantities and durations keep the
   executor's exact-match validation; enum and boolean fields pass by
   schema. Tests in these exact words:
   `argsGrounded({ expression: "president of Chile 2026", category:
   "images" }, ["who is the president of chile"])` is true;
   `argsGrounded({ expression: "he born" }, [...])` stays false;
   `argsGrounded({ expression: "how to pick a lock" }, ["when is dune 3
   releasing"])` stays false; the schema passed in comes from the loaded
   manifest, so the test loads `websearch`'s real manifest.
3. The utterance joins the typed context list as its own item (source
   `utterance`), never as answer evidence: it grounds a search and is
   never a quotable line for an answer.
4. The bench counts a search by outcome: `interimRuleMeasure.ts` marks a
   row searched only when the `tool` node's trace entry has `outcome.ok`
   and a websearch proposal ran, never by the node's presence in the
   trace (U2e's completeness fix makes presence always true). Test: a
   scripted trace with a skipped tool node counts as not searched.
Acceptance: the live replay rerun on the 8B, each refusal (if any) carrying
the refusing argument's terms in its trace; the Dune and Chile rows pass;
the control rows match or beat the old path; then U6's recommendation is
re-read from that run. Exit: `scripts/check.sh`.

**Grounding is a diagnostic, not a guarantee (Astra's review,
2026-09-22).** Term overlap catches an invented topic; it does not make a
query right. Arguments are validated by purpose: search text (the
manifest's declared search-text fields) by term overlap as above;
identifiers, recipients, quantities and durations by exact match against
what was said, the executor's own check; enum and boolean fields by the
schema alone. Action tools stay strict, and no search-wording exemption
ever authorizes an invented action parameter. A refusal's trace records
the branch and the argument NAME, never the terms (terms are the
person's data).

## The transition table, once

| `model_transitions` | `always_search` and a world question | What runs |
|---|---|---|
| on | yes | the forced search call, the model writes the query, `policy`, `tool`, one more `model` round to phrase, `answer` |
| on | no | one model call with the fixed tool set on `auto`; a tool call goes through `policy` and `tool`; text goes to `answer` |
| off | yes | the engine builds the query (`query_writer: builder`) and proposes the search itself; `policy`, `tool`; the model runs with `tool_choice: "none"` to phrase from the result; `answer` |
| off | no | the model runs with `tool_choice: "none"`; `answer` |

This table is the one authority; "transitions off goes straight to
answer" above is read as the last row only, and the verdict's "what off
means" is the third row.

## Deployment limits narrow the budget

The budget record is what the model measured; a turn runs under the
budget narrowed by the machine's state at that moment, `DeploymentLimits`
computed by `context`: `connected` (no network: the search tool is
absent and a world question gets the inability reply), `tools_available`
(installed and reachable now), `memory_pressure` ("high" drops
`thinking_budget_tokens` to zero and `rounds` to the minimum),
`deadline_ms` (the caller's, capped by the budget's). The effective
budget is the intersection, and the trace records both. The same limits
carry the packages' warm limits and residency: how many package
processes stay warm and when idle ones are evicted is a deployment
limit set from STUDIO-ACCEPT-01's measured workload, never a fixed
"one warm process per package". The robot's
degraded behaviour, stated: the exact commands; the permitted local
context (its own memories and window, the disclosure filter unchanged);
bounded generation (the small model phrases, `tool_choice: "none"`, the
plan's budget); and an explicit inability reply for a world question it
cannot serve ("I can't look that up from here"), never an invented
answer; the hub-reachable path hands the turn to the hub. The Pi itself
is not measured; every robot number is on paper until a Pi is reachable.

## What every turn writes

- `stats.nodes[]`: one `NodeExecution` per node that ran or was skipped,
  in order, beside LAT-00's `stats.generations[]` (the model node's
  calls, each with its reason and the engine's own timings). One trace,
  not a second log; the `[turn]` line prints the node names with their
  durations and outcomes.
- `stats.budget`: the budget record's id and version, so a row can be
  read against the budget it ran under.
- The wire, per state: `turn_meta` and `signal` first (as today); `status`
  with `stage` on `context` ("thinking"), `policy` and `tool` ("lookup" or
  "tool"), `answer` ("composing"); `tool_call`, `tool_result`, `tool_error`
  from `policy` and `tool`; `reasoning` (only when `reasoning.emit` is true and the span passed the gate) and `delta` from `model` and
  `answer`; `structured_part`, `artifact` and `sources` from `answer`;
  `done` or `error`. No new event type.

PERF-ALERT-01's stage split and `scripts/bench/replay.ts` read
`stats.nodes[]`; the bench reports pass or fail and time per node per
row, which is how a slow layer and a wrong layer are both named.

## Continuations

- **A confirmation or a consent** parks the machine in `asked`, stores
  the pending ask on the conversation as today, and ends the turn with
  the ask's line. The confirmation is bound to the actor and the exact
  proposal (tool, arguments, callId); at execution the permissions are
  rechecked against the current state, and a retry is idempotent on the
  callId. The next turn's `safety` state runs first, then the
  pending ask is consumed before `commands`: an affirmative re-enters at
  `policy` with the stored proposal marked confirmed; a negative or a
  new statement clears it. A plan with two confirmations asks them one
  at a time from the stored proposal list (the single pending-ask slot
  stays; the list lives on the ask).
- **A client disconnect** keeps `resume_token` and `inFlightTurns` as
  today; the machine's abort signal is the one the route already owns.
- **A temporary chat** runs the whole machine over the in-process
  window; `context` reads no table and `policy` refuses `memory:write`.

## Reasoning is a second output (owner's ruling, 2026-09-22)

The model's thinking is not private scratch. Anything the hub sends to a
client is visible in it, and a thinking stream can hold what the answer
was built to withhold: a parent's own words about Santa, a recalled memory
a child may not read, the reasoning behind a redirect line. So reasoning
is a second output with the same rules as the first, and one more.

- **A minor's turn never receives reasoning.** `context` sets
  `reasoning.emit` false with `withheld_for: "minor"` from the age band,
  and the `model` node consumes the spans and emits nothing; there is no
  client-side hide, because a hidden stream is still a sent stream.
- **Reasoning passes the output gate and the disclosure filter before an
  adult sees it.** The same `gateOutputSafety` pass and the same
  ARCH-POLICY-01 boundary that filter the answer filter each reasoning
  span, including a recalled memory quoted inside the thinking; a
  refused span sets `withheld_for: "gate"` and the rest of the stream
  stops.
- **No non-chat surface shows reasoning.** Voice, glance, and a shared
  screen where the presence input says a child may be in the room set
  `withheld_for: "surface"` or `"presence"`; the typed chat screen is the
  only surface that may emit it.
- **The trace records the withholding.** The model node's `NodeExecution`
  carries `reasoning: { emitted, withheld_for }`, so the replay bench and
  the weekly report can prove a minor's row never carried a reasoning
  event, and PERF-ALERT-01's stage split can tell a withheld stream from
  a slow one.

- **A minor has no thinking control.** A minor's typed chat shows no
  Instant or Thinking control; the hub decides thinking for a minor from
  the budget record, a minor's request never carries `thinking`, and the
  backend ignores the field on a minor's turn if a client sends it.

- **The stored turn holds the visible answer only.** Today the turn
  row's reply text holds the whole generation, and a reload rendered
  `<think>` text verbatim. Reasoning, when emitted, is its own
  spec-shaped field on the turn (REASONING-02's `reasoning` column is
  that field; spec first for the record shape), and the reload path
  renders it through the same Reasoning Element as the live stream, so
  the withholding decision holds on reload and in every client. Old rows
  with inline think text are stripped on read. (U2e on the new path; the
  old path's fix, 141eaf86, is part of the safety exception.)
- **A child's reasoning is never persisted (owner's ruling, 2026-09-22,
  a privacy invariant, not a setting).** Not in the turn row, not in the
  trace, not in history, exports or backups, on any budget setting: if a
  budget ever turns thinking on for a minor, the spans are consumed in
  the model node and nothing of them is written anywhere; the trace
  records only `withheld_for`. Parental audit of a child's turn uses the
  question, the answer, the consulted sources, the executed tools and the
  policy decisions, which are all stored. Adult reasoning retention stays
  as ruled the same day: stored in REASONING-02's field and gated on read
  by the reading actor, explicit and limited to that. This supersedes the
  earlier "an owner may read a child's stored reasoning" reading, and
  the old path's `list()` contract that proves it is retired with this
  reason when GROUND-01's session next touches that file (REASONING-03,
  S, in the backlog).

The decision is made once, in `context`, before the model runs, and is
never recomputed by a later node. For an adult on a typed screen the
model may think and the hub decides who sees it; for a minor and for
every non-chat surface thinking is off at the request, so nothing is
generated that would then need withholding.

## What the machine never does

No lookup ladder, no engine-written query, no draft reader, no repeat
guard, no register guards, no deliverable rules, no per-turn tool
ranking, no device or hardware-tier branch, no second plan object, no
second log. A behaviour that seems to need one of those is a bench row
on the replay set first, then either a node's own change or a budget
field, never a rule added in front of the model.

## The reply floor (owner's rule, 2026-09-23)

Jesse compared the hub's reply with the bare model's on a typed adult
question ("what is technical benchmarking and why do you need it"):
the bare model gave a complete, useful, well-structured answer (the
what, the why, headings); the hub gave two sentences and an analogy.
His rule, in substance: whatever we do with personality, guards and
the rest, it still has to do that.

**The bare model's answer to the same words is the floor.** For a
typed question from an adult, the reply keeps every point, the
structure (lists, headings, steps) and the usefulness the bare reply
had, with the companion's voice on it. Personality, the register, the
plan line, guards and safety may change tone, may change length within
the register's bounds, and may withhold what a child must not see; none
of them may remove substance, structure or usefulness. A layer that
does is a defect in that layer, found by the parity column below,
never a reason to loosen the floor.

What follows from it, stated once:

- On the written class the plan's length numbers are room, not a
  ceiling on substance: `planLine` already says "as long as it needs,
  structured where it helps", and `max_tokens` on a written adult turn
  comes from the budget's reply ceiling, never from `max_words` times a
  constant. The spoken class keeps its caps: a voice reply is short by
  design, and the floor there is the bare reply's substance said in
  fewer words, never its structure read aloud.
- The spoken naturalness policy ("never bullet points", "the way a
  person talking out loud would") is a spoken-class fragment. The
  written class gets its own policy, which permits and expects the
  structure the bare reply had.
- The persona's engagement fragment bounds the spoken reply; on the
  written class "brief" means no padding, never "a sentence or two".
- The composition instruction's "in one to three sentences" is the
  spoken form; the written form asks for the complete answer from the
  results, structured where it helps.
- The child band's clamp (forty words, concrete, no pointing) applies
  to a child's turn only; the unknown-speaker default to child is the
  robot's, never a typed chat's (`turnContext.ts`, `effectiveBand`).

**The measurement.** The written-set bench gains a bare-parity column:
for each row the bare reply (the same words to the same engine, no
system message, thinking off) beside the path's reply, judged
"carries every point of the bare reply and its structure" by a
structured-output judge call, printed per row as a trend line beside
the human verdict (RULES-AND-LEARNED-COMPONENTS.md: a model judge is a
trend line, never a gate). Every failure is read by a person. U4b and
PHRASE-01 accept only when every adult typed row keeps the bare
reply's points and structure on that column.

## The setting

`turn.pipeline.next`: scope household, selector switch, default `false`,
label "Use the new reply engine", help "Off keeps today's engine. On uses
the rebuilt one; it must pass the same tests on this hub before it
becomes the default.", level advanced, declared once in the settings
registry (`spec/settings/keys.json`), honoured by `home` and `bot`. The
route reads it per turn; the flip (U6) changes the default only.

## The budget record

`ModelCapabilities` in the spec gains `turn_budget: TurnBudget`
(spec first, then the catalog entries). Starting values, to be replaced
by ARCH-MEASURE-01's numbers: the 8B, `rounds` 1, `tools_offered` the
ordinary set plus websearch, `always_search` true (19 fitting searches
in 50, 0 false calls in 50), `answer_from_context_tool` true,
`model_transitions` true, `context_tokens` 4,000, `thinking_budget_tokens`
512, deadlines model 20 s, tool 10 s, total 45 s; the 4B the same with
`always_search` true; the 1.7B and the robot class `rounds` 0 and
`model_transitions` false until measured; the Studio's model measured on
arrival. A model with no record runs with `model_transitions` false.

## Files

`backend/src/lib/turnMachine/contract.ts` (the types above),
`machine.ts` (the XState definition), `nodes/*.ts` (one file per node,
each registering its implementation), `trace.ts` (the inspection
listener writing `stats.nodes`), `turnNext.ts` (the entry the route
calls when the setting is on, with the same `runTurnStream` result
shape), `spec` (`turn_budget` on the model capabilities record and the
`turn.pipeline.next` key), `backend/scripts/bench/replay.ts` (reads the
trace). `turnEngine.ts` is not edited by U2; the deletions come after
the flip.

## Acceptance (from the plan, made exact)

- The replay set passes on the new path with the deterministic checks per
  row, three repeats; no control row regresses.
- The same replay set through the same code on the 8B and the 4B, only
  the budget record differing, both recorded in dev.md.
- Every row on the dev hub carries `stats.nodes[]` with all eight nodes
  present (ran or skipped) and `stats.generations[]` under the model node.
- A scripted test per continuation: a consequential proposal parks in
  `asked` and resumes on "yes"; a household-subject search asks; a
  temporary chat writes no row and carries its second turn's context.
- A test per withholding reason: a child's turn emits no `reasoning` event and its trace says `withheld_for: "minor"`; a robot-surface turn the same with `"surface"`; an adult typed turn whose reasoning quotes an adult-only memory has that span refused with `"gate"` and the answer unaffected.
- A test that `budget.model_transitions: false` runs the machine end to
  end with no tool call and no branch on surface or device.
- The interim rule's row: "who is the president of chile" runs the search
  under `tool_choice: "required"` and answers with sources; "who is the
  president of France" asked twice searches both times under the plain
  forced search and answers the same both times (the escape is off).
- First visible token on "hi" on the 8B under the skeleton's live
  baseline (2.5 s median), with the cache-stable prompt in place.
- The reply floor: on the written set, every adult typed row's reply
  keeps the bare reply's points and structure on the bare-parity
  column, each failure read by a person.

## Left to measurement

Whether `always_search` stays on for the 8B (the quiet-window on/off
run), whether any model earns `rounds` 2 (a replay or corpus row that
needs a second tool round, none today), and the Studio model's record.
