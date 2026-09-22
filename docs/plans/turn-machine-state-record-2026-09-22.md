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
  context_tokens: number;
  thinking_budget_tokens: number;
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
| `context` | `context` | the window (in-process for a temporary chat), the memories as dated and labeled items, the episodes, the profile line, the clock, the roster, the disclosure filter for this reader and the presence on this surface | `model` |
| `model` | `model` | `messages` built from the context list, the fixed tool set, `tool_choice` per the interim rule, the plan's `max_tokens` plus the thinking budget | a tool call: `policy`; text: `answer`; no visible text: one regeneration with thinking off, then `answer` |
| `policy` | `policy` | each `ActionProposal`: the manifest's `min_role`, `consequential`, `permissions`; the grounding of the arguments against the context list (a set check); the household-subject rule for a search; temporary mode (no `memory:write`); the crisis state (no lookups) | `tool` for an allowed read-only request; `asked` (the machine parks with a pending ask) for a consent or a confirmation; `answer` with the refusal line for `min_role`; for a side-effecting request the executor runs the typed plan and returns its outcome to `tool` |
| `tool` | `tool` | `runPlugin` under the tool deadline; the outcome recorded in model order | `model` while `rounds` remain; else `answer` |
| `answer` | `answer` | the model's final text or the package reply, the outcomes' sources, the surface's projection (`reply.speech`), the plan's budget | `output_gate` |
| `output_gate` | `output_gate` | every streamed sentence through `gateOutputSafety`; the honesty invariant (an action claim needs a succeeded outcome); the malformed repair | `done`; `refused` when the output floor refuses |
| `asked`, `done`, `refused`, `blocked`, `cancelled` | terminal | | the turn row and the trace are written; `asked` stores the pending ask and the next turn's `safety` state consumes it first |

Transitions the model may drive (`model` to `policy`, the second round)
exist only when `budget.model_transitions` is true; with it false the
`model` node runs with `tool_choice: "none"` and the machine goes
straight to `answer`. That is the whole difference between the hub and
the robot's Pi: one machine, one file, a budget field.

The interim rule, in `model`'s actor: when `signal.primary_act` is
`question`, `signal.target` is `world`, and `budget.always_search` is
true, the call runs with `tool_choice: "required"` over two tools, the
search and `answer_from_this_conversation` (one argument: the quoted line
of the context list it answers from). `policy` verifies the quote is in
the list (a set check); a quote that is not there is an ungrounded
argument and the search runs instead. A household subject in the
utterance keeps the search off (the household-subject rule). The
quiet-window run of 2026-09-22 (rule on and off, ten repeats) records
the cost of the redundant searches and the miss rate, and the rule's
default per model is set from it.

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
  from `policy` and `tool`; `reasoning` and `delta` from `model` and
  `answer`; `structured_part`, `artifact` and `sources` from `answer`;
  `done` or `error`. No new event type.

PERF-ALERT-01's stage split and `scripts/bench/replay.ts` read
`stats.nodes[]`; the bench reports pass or fail and time per node per
row, which is how a slow layer and a wrong layer are both named.

## Continuations

- **A confirmation or a consent** parks the machine in `asked`, stores
  the pending ask on the conversation as today, and ends the turn with
  the ask's line. The next turn's `safety` state runs first, then the
  pending ask is consumed before `commands`: an affirmative re-enters at
  `policy` with the stored proposal marked confirmed; a negative or a
  new statement clears it. A plan with two confirmations asks them one
  at a time from the stored proposal list (the single pending-ask slot
  stays; the list lives on the ask).
- **A client disconnect** keeps `resume_token` and `inFlightTurns` as
  today; the machine's abort signal is the one the route already owns.
- **A temporary chat** runs the whole machine over the in-process
  window; `context` reads no table and `policy` refuses `memory:write`.

## What the machine never does

No lookup ladder, no engine-written query, no draft reader, no repeat
guard, no register guards, no deliverable rules, no per-turn tool
ranking, no device or hardware-tier branch, no second plan object, no
second log. A behaviour that seems to need one of those is a bench row
on the replay set first, then either a node's own change or a budget
field, never a rule added in front of the model.

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
- A test that `budget.model_transitions: false` runs the machine end to
  end with no tool call and no branch on surface or device.
- The interim rule's row: "who is the president of chile" runs the search
  under `tool_choice: "required"` and answers with sources; "who is the
  president of France" asked twice answers the second time from the
  conversation through the `answer_from_this_conversation` choice with no
  search.
- First visible token on "hi" on the 8B under the skeleton's live
  baseline (2.5 s median), with the cache-stable prompt in place.

## Left to measurement

Whether `always_search` stays on for the 8B (the quiet-window on/off
run), whether any model earns `rounds` 2 (a replay or corpus row that
needs a second tool round, none today), and the Studio model's record.
