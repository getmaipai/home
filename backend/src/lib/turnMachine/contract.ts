// U2 (docs/plans/turn-machine-state-record-2026-09-22.md, "The contract"):
// the one declaration every node reads and writes. A node reads TurnState
// and returns its output and outcome; it never reaches into another
// node's internals, and it never reads the raw utterance when `context`
// exists (the list is the prompt's only input - ARCH-POLICY-01's future
// ingress boundary is a pure filter over exactly this list).
//
// This file declares only shapes, no logic and no literal strings a
// household member's words could match - the rule-budget lint's zero
// baseline for turnMachine/ holds trivially here.
import type { PersonRow } from "@/lib/memoryIngestion";
import type { Surface, SpeakerEvidence, PresentPerson } from "@/lib/turnShared";
import type { SafetyResult } from "@maipai/spec/gen/ts/safety-result.js";
import type { TurnSignal } from "@maipai/spec/gen/ts/turn-signal.js";
import type { ReplyPlan } from "@maipai/spec/gen/ts/reply-plan.js";
import type { Source } from "@maipai/spec/gen/ts/source.js";
import type { LlmMessage, ToolCall, ToolSpec } from "@/lib/llm";
import type { ToolExecutionOutcome } from "@/lib/turnContext";
import type { GenerationInput } from "@/lib/turnStats";
import type { PendingAsk } from "@/lib/conversationHistory";
import type { SubjectRef } from "@/lib/unknownNames";
import type { PlanInput } from "@/lib/register";
import type { Persona } from "@/lib/persona";
import type { TurnStreamEvent as ToolStreamEvent } from "@maipai/spec/stack/ts/turn-stream-event.js";
import type { StatusChannel } from "@/lib/statusChannel";
import type { StreamGate } from "./nodes/outputGate";

/** ARCH-POLICY-01's ingress unit: what the model actually sees, filtered
 * before the prompt (disclosure, band, temporary mode) and typed by
 * where it came from - never the raw utterance or a raw DB row. */
export interface ContextItem {
  id: string;
  text: string;
  /** Native assistant tool-call metadata carried by prior window turns. */
  toolCalls?: import("@maipai/spec/llm/ts/types.js").ToolCallWire[];
  toolCallId?: string;
  /** GROUND-01 (state record, "The live grounding refusals..."): the
   * current utterance joins this list too, source "utterance" - a
   * grounding source for a search (policy's own term-overlap check),
   * but never quotable as answer evidence (machine.ts's
   * contextQuoteGrounded excludes it, and messages.ts never re-prints
   * it into the prompt's context block, since it is already the final
   * user message contextToMessages() appends). */
  source: "window" | "memory" | "episode" | "profile" | "clock" | "roster" | "subjects" | "tool_result" | "search_result" | "document" | "notification" | "quoted" | "utterance";
  /** Entity ids the item mentions (household-subject rule, grounding). */
  subjects: string[];
  disclosure: "child_ok" | "teen_ok" | "adult_only";
  /** ISO date for dated items ("remembered Sep 15"). */
  at?: string;
}

export interface ToolRequest {
  tool: string;
  args: Record<string, unknown>;
  callId: string;
}

export interface ActionProposal {
  kind: "read_only" | "side_effecting";
  request: ToolRequest;
}

export interface PendingAskInfo {
  prompt: string;
}

/** GROUND-01 (state record, "1. Split the reason"): the live diagnosis
 * found `ungrounded_args` produced by three different branches with
 * nothing in the trace to tell them apart - `unknown_tool` (the
 * manifest failed to load) now carries its own name; `ungrounded_args` keeps only `argsGrounded()`'s own false.
 * The refusal line stays one sentence either way (nodes/answer.ts's
 * policyRefusalLine()); only the trace changes.
 *
 * MANIFEST-REFUSAL-01 (fixes getmaipai/home#166): `unknown_tool` used
 * to also cover a manifest that exists but fails Zod validation (the
 * loader's own 400) - the live incident (2026-09-26) had every bundled
 * manifest gain an `incognito` key the running process's older schema
 * didn't know, and the trace showed nothing but `unknown_tool` for
 * every tool, indistinguishable from a model simply inventing a tool
 * name. `manifest_invalid` is that 400 case split out on its own;
 * `unknown_tool` now means only "no such package" (a 404, or an
 * invalid id) - the honest "the model made this up" case GROUND-01's
 * ruling already covers. */
export type PolicyDecision =
  | { allow: true }
  | {
      allow: false;
      // PROJECT-START-01: `unknown_project_type` is start_project's own
      // refusal (nodes/policy.ts) when its `type` argument names no
      // registered ProjectType - answer.ts's own default line ("I don't
      // actually have that in this conversation") covers it, the same
      // closed set of named-then-defaulted reasons `ungrounded_args`/
      // `unknown_tool` already are.
      reason: "min_role" | "consent_needed" | "confirm_needed" | "ungrounded_args" | "unknown_tool" | "manifest_invalid" | "temporary_mode" | "crisis_state" | "anonymous_speaker" | "unknown_project_type";
      ask?: PendingAskInfo;
    };

/** The per-model tool-calling budget (commons spec:
 * ModelCapabilities.turn_budget, U2a). Mirrors the spec shape exactly;
 * see backend/src/lib/turnMachine/budget.ts for how a model's record
 * resolves to this at runtime, and the fallback for a model with none. */
export interface TurnBudget {
  rounds: 0 | 1 | 2;
  tools_offered: string[];
  model_transitions: boolean;
  context_tokens: number;
  /** Reported per-slot engine context, distinct from the safe window
   * minimum used when Stack health has no measurement. */
  context_window_tokens?: number | null;
  /** THINK-DEFAULT-01 (spec-v0.1.27): the turn's default when the
   * person hasn't toggled thinking on - 0 on every real budget, since
   * reasoning is a second output the person chooses, never the
   * budget's own default. turnNext.ts resolves the effective per-turn
   * value once, up front, from this and thinking_budget_tokens_toggled
   * together (RunTurnNextOpts.thinking); every later read of this
   * field (model.ts's thinkingOn, buildTurnStats) sees that resolved
   * value, never the raw catalog default. */
  thinking_budget_tokens: number;
  /** THINK-DEFAULT-01: the value turnNext.ts substitutes in for a turn
   * where the person explicitly toggled thinking on. Per model, not a
   * single hardcoded constant, since a different chat model may reason
   * usefully at a different token count. */
  thinking_budget_tokens_toggled: number;
  /** GROUND-01 ("Reasoning is a second output"): whether the model node
   * even asks the engine to think on a minor's turn - false by default.
   * A cost control only, never the safety gate: `context.ts`'s
   * decideReasoning() already forces `reasoning.emit` false for a minor
   * from the age band alone, so a minor's turn never emits or persists
   * reasoning whichever way this is set. */
  thinking_for_minors: boolean;
  /** The reply floor (spec-v0.1.28, turn-machine-state-record-2026-09-22.md
   * "The reply floor", owner's rule 2026-09-23): the most visible tokens
   * one written adult reply may take - a runaway-guard backstop, never a
   * length target. THIN-1A (docs/design/RULES.md rule 5): for a written
   * adult turn this is the ONLY cap on every non-forced generation, the
   * phrasing round after a search included; the plan's word numbers no
   * longer reach that turn's request at all. A child's or teen's typed
   * turn and every spoken or glance turn keep their max_words-derived
   * cap (rule 0). */
  reply_ceiling_tokens: number;
  /** model and total are wall-clock for a child's, a teen's and every
   * spoken turn; an adult's written reply is bounded by first_token_ms
   * (request to the first piece, an engine may be loading) and stall_ms
   * (silence between pieces) instead (DEADLINE-02, rule 5). */
  deadlines_ms: { model: number; tool: number; total: number; first_token_ms: number; stall_ms: number };
  measured: { false_call_rate: number; inverse_miss_rate: number; rewrite_pass_rate: number; on: string };
}

export interface TurnState {
  turnId: string;
  /** Date.now() when this turn began (turnNext.ts's own `startedAt`,
   * before the first node ran) - LAT-00's `GenerationInput.requestSentMs`
   * is documented as "from turn start," so the model node needs this to
   * compute it as an elapsed value rather than an absolute one. */
  startedAt: number;
  conversationId: string;
  actor: PersonRow;
  surface: Surface;
  /** THIN-0D: the robot body's own speaker_evidence and present list,
   * honored on the robot surface only (routes/turn.ts); absent for every
   * other surface. An unidentified robot speaker is anonymous
   * (speaker.ts's speakerIsAnonymous()). */
  speakerEvidence?: SpeakerEvidence | null;
  present?: readonly PresentPerson[] | null;
  utterance: string;
  modelId?: string;
  signal: TurnSignal;
  budget: TurnBudget;
  /** U4b: resolved once in `turnNext.ts` (the same call already feeding
   * `planBasis.companion`'s engagement/complexity), never re-resolved
   * later - the model node's own `messages.ts` call reads this instead
   * of a second `resolvePersona()` lookup, the same "decided once"
   * shape `plan`/`planBasis` already follow. */
  persona: Persona;
  plan: ReplyPlan;
  /** U4c: the exact non-evidence `planFor()` inputs `turnNext.ts`
   * resolved once, up front (signal, surface, surfaceClass, companion,
   * band, brevity, deferred, disclosureWithheld) - kept so the
   * machine's own post-tool-round recompute (`derivePlanFromEvidence`
   * in `machine.ts`) reuses the identical inputs and only `evidence`
   * changes: the same `planFor()` shape, never a second, divergent
   * one. */
  planBasis: Omit<PlanInput, "evidence">;
  safety: SafetyResult;
  crisis: boolean;
  engineUnavailable: boolean;
  /** True only when answer.ts delivered the fixed model-failure line. */
  failedGenerationReply?: boolean;
  /** The filtered list; the only prompt input. */
  context: ContextItem[];
  /** Set by the `context` node (ContextOutput.temporary). Not in the
   * design record's own TurnState listing, which otherwise fixes this
   * contract exactly; added because `policy`'s own "temporary mode (no
   * memory:write)" reads and "the crisis state" reads both need a flag
   * the state must actually carry to be checkable, not re-derived per
   * node from the conversation id's own DB row. */
  temporary: boolean;
  /** RESP-01's flag (U4/VOICE-LIVE-02): forces the spoken register
   * regardless of `surface` (a dictated or spoken chat turn is read, not
   * seen) and, per the state record's own "no non-chat surface shows
   * reasoning" - a voice session has nowhere to put a Reasoning Element
   * whatever `surface` says - withholds reasoning the same as a
   * non-chat surface does (`decideReasoning`, `nodes/context.ts`). */
  spoken: boolean;
  /** THIN-7C (ADMIN-COMPARE-01 b): the bare-mode bypass, an owner or admin
   * adult's own turn. No commands, no persona, no recalled memory, no tools:
   * one plain system prompt, the conversation's history and the message,
   * thinking on. The safety node and the output gate still run, as for every
   * turn; nothing here can skip them. */
  bare?: boolean;
  /** THIN-7C (getmaipai/home#60, #88): the turn this one replaces (an edited
   * and resent message), already checked to be a turn of this conversation
   * (resolveSupersedes()); absent otherwise. The replaced turn leaves the
   * window, its memories are not recalled, and the stored row records it. */
  supersedes?: string;
  /** THIN-7C (getmaipai/home#91): a Home card's own fixed question, never a
   * household member's words. Same model, safety and reply path, but nothing
   * is stored (no turn row, no summary refresh, no parked ask). */
  ephemeral?: boolean;
  /** THIN-7C: a continuation of an answer that stopped short: the client's
   * partial text, replayed to the model as its own words with one instruction
   * to continue. No command fires and no tool is offered for the turn;
   * `fromTurnId` (a turn of this conversation, resolved) leaves the window
   * and is what the stored turn records it continued. */
  continuation?: { fromTurnId?: string; assistantText: string };
  /** Built from context, never from anything else. */
  messages: LlmMessage[];
  proposals: ActionProposal[];
  outcomes: ToolExecutionOutcome[];
  /** TOOL-EVENTS-01(b): the spec's own tool_call/tool_result/tool_error
   * shape (spec/schemas/turn-stream-event.schema.json, keyed by `t`, not
   * `type` - a deliberately separate event shape from wire.ts's own
   * TurnStreamEvent union, the same split the frontend consumer
   * (chatModelAdapter.ts, landed first) already treats it as), pushed by
   * the `tool` node as each proposal is accepted and its outcome lands
   * (machine.ts's `recordOutcomes` action, alongside `outcomes` above).
   * Surfaced on turnNext.ts's "immediate" result so routes/turn.ts can
   * include them in the response, ahead of "done" - never populated by
   * the old path. */
  toolEvents: ToolStreamEvent[];
  /** PHRASE-01 (dev.md "The written prompt on tier 1, decided"'s own
   * follow-up): the most recent real (non-phrasing) model round's own
   * resolved tools array, persisted so the phrasing round that follows
   * a forced or offered tool call can send the identical tools block -
   * not merely an equivalent one - since the Qwen3 chat template
   * renders the tools block into the prompt's own stable prefix;
   * anything but a byte-identical array re-renders that prefix and
   * costs the very prompt-cache hit this item exists to restore. Set
   * once per non-phrasing round in `nodes/model.ts`, read once on the
   * phrasing round that follows it - never touched by any other node. */
  lastTools: ToolSpec[];
  generations: GenerationInput[];
  nodes: NodeExecution[];
  reply: { text: string; speech?: string; sources: Source[] } | null;
  /** Set when the machine parks. */
  ask: PendingAsk | null;
  end: "done" | "refused" | "asked" | "blocked" | "cancelled" | null;
  /** "Reasoning is a second output" (turn-machine-state-record-2026-09-22.md,
   * owner's ruling): decided once in `context`, from the age band and
   * the surface, never recomputed later. `output_gate` may still
   * downgrade an "emit: true" turn's actual span to `withheld_for:
   * "gate"` after seeing its real content - that outcome lands on the
   * model node's own trace entry (below), not here; this field is the
   * context node's own decision, the ceiling `output_gate` can only
   * lower. `"presence"` is named by the design (a shared screen a
   * child may be in the room for) but no presence signal exists on the
   * hub yet (the old engine file's own "Presence unknown for now"), so
   * nothing sets it today - included in the type because the record
   * names it, never produced until a presence source is built. */
  reasoning: { emit: boolean; withheld_for: "minor" | "surface" | "presence" | "gate" | null };
  /** STREAM-NEXT-01: set only by turnNext.ts's own runTurnNextStream(),
   * undefined for every other caller (runTurnNext(), the bench harness) -
   * the identical StatusChannel the old engine file's own old-path stream kind
   * already uses, reused rather than a second one; nodes/tool.ts pushes
   * the same "On it." status line onto it as each proposal starts, so it
   * reaches a live client before the search itself runs. */
  status?: StatusChannel;
  /** STREAM-NEXT-01 (b): set only by runTurnNextStream(), undefined
   * otherwise. nodes/model.ts's own runOneGeneration() pushes each raw
   * delta of a non-forced generation into it as the engine streams;
   * nodes/output_gate reads its already-computed verdict back instead of
   * re-evaluating the whole reply - see outputGate.ts's own StreamGate
   * for why this lives there, not here or in model.ts. */
  streamGate?: StreamGate;
  /** THIN-0M: the whole-reply check that made output_gate refuse a reply
   * (set by the machine's applyOutputRefusal), so the refusal can carry
   * the crisis resources when the refused text mentioned self-harm. */
  outputSafety?: SafetyResult;
  /** THIN-7E (ASK-01): the `who` question this conversation had standing when the turn
   * began (beginTurn clears every pending ask before the machine runs). The commands node
   * reads it as the answer; undefined when none stood or the conversation is temporary. */
  pendingWho?: PendingAsk;
  /** THIN-7E: the turn's subjects (context's resolution, or the entity a who-answer made),
   * logged on the row so a pronoun-only turn keeps its subject. */
  subjects?: SubjectRef[];
  /** THIN-7E: the unknown name the reply asks about (context's resolution). */
  unknownAsk?: string | null;
  /** THIN-7E: this turn was the answer (or cancel) of a who question, read by the parser;
   * no model ran. finishTurn() reports it as source "confirm", as the old engine did. */
  whoAnswer?: boolean;
  /** THIN-7E: set by the model node with the question it appended; logResult() calls it
   * with the text that was delivered, and the ask stands only if the question reached the person. */
  askCommit?: (deliveredText: string) => void;
}

/** GROUND-01: `arg` is the refusing argument's NAME only, never its
 * value (the state record's own "Grounding is a diagnostic" ruling: "A
 * refusal's trace records the branch and the argument NAME, never the
 * terms - terms are the person's data"). `code` already carries the
 * branch (a PolicyDecision reason, a safety refuse category, or any
 * other node's own failure code). ENGINE-CONTRACT-02: `required_miss`
 * marks the model node's own outcome when a `tool_choice: "required"`
 * call came back with no tool call at all - llama-server b10797 treats
 * `required` as advisory once the slot's KV cache holds the prefix
 * (ENGINE-CONTRACT-01), so `interimRuleMeasure` and the replay bench
 * can count this by cache state without re-deriving it from the
 * generation record. GENFAIL-01 (dev.md 2026-09-23, "generation_failed
 * is never blind again"): `message`, on the `ok: false` variant only,
 * is the ENGINE's own diagnostic text (a status, llama-server's own
 * generic JSON error body, "could not reach ...") - the same GROUND-01
 * limit above applies to it the way it applies to `arg`: this is never
 * a household member's own words, and `nodes/model.ts` bounds its
 * length before it ever reaches this field, the same caution a
 * response body earns anywhere it might echo request content back.
 * Optional: every other node's own failure still reports with `code`
 * alone when it has nothing more to say. */
export type NodeOutcome = { ok: true; required_miss?: boolean; dropped_by_floor?: number } | { ok: false; code: string; arg?: string; message?: string } | { skipped: true; reason: string };

export type NodeName = "safety" | "commands" | "context" | "model" | "policy" | "tool" | "answer" | "output_gate";

export interface NodeExecution {
  node: NodeName;
  impl: string;
  version: string;
  startMs: number;
  endMs: number;
  outcome: NodeOutcome;
  /** Set only on the `model` node's own entry, after `output_gate`
   * resolves the turn's actual reasoning span (turnNext.ts's
   * applyReasoningOutcome(), machine.ts's own `output_gate` onDone) -
   * "so the replay bench and the weekly report can prove a minor's row
   * never carried a reasoning event." Absent on every other node. */
  reasoning?: { emitted: boolean; withheld_for: TurnState["reasoning"]["withheld_for"] };
}

/** A node reads TurnState and its own typed input, and returns its typed
 * output plus outcome under the given deadline signal - the machine's
 * own abort, re-armed per node from the budget (machine.ts). A node
 * that finishes before the signal fires never has to check it; one
 * that does real I/O (the model call, a tool) passes it straight
 * through to whatever primitive already accepts one. */
export type Node<In, Out> = (state: TurnState, input: In, signal: AbortSignal) => Promise<{ outcome: NodeOutcome; output: Out }>;

/** ToolCall and ToolExecutionOutcome re-exported so a node only ever
 * imports its types from "../contract", never reaching past it into
 * llm.ts/turnContext.ts directly for the same two shapes under two
 * different names. */
export type { ToolCall, ToolExecutionOutcome };
