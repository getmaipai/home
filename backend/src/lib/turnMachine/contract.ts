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
import type { Surface } from "@/lib/turnEngine";
import type { SafetyResult } from "@maipai/spec/gen/ts/safety-result.js";
import type { TurnSignal } from "@maipai/spec/gen/ts/turn-signal.js";
import type { ReplyPlan } from "@maipai/spec/gen/ts/reply-plan.js";
import type { Source } from "@maipai/spec/gen/ts/source.js";
import type { LlmMessage, ToolCall } from "@/lib/llm";
import type { ToolExecutionOutcome } from "@/lib/turnContext";
import type { GenerationInput } from "@/lib/turnStats";
import type { PendingAsk } from "@/lib/conversationHistory";
import type { PlanInput } from "@/lib/register";
import type { Persona } from "@/lib/persona";

/** ARCH-POLICY-01's ingress unit: what the model actually sees, filtered
 * before the prompt (disclosure, band, temporary mode) and typed by
 * where it came from - never the raw utterance or a raw DB row. */
export interface ContextItem {
  id: string;
  text: string;
  /** GROUND-01 (state record, "The live grounding refusals..."): the
   * current utterance joins this list too, source "utterance" - a
   * grounding source for a search (policy's own term-overlap check),
   * but never quotable as answer evidence (machine.ts's
   * contextQuoteGrounded excludes it, and messages.ts never re-prints
   * it into the prompt's context block, since it is already the final
   * user message contextToMessages() appends). */
  source: "window" | "memory" | "episode" | "profile" | "clock" | "roster" | "tool_result" | "search_result" | "document" | "notification" | "quoted" | "utterance";
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
 * manifest failed to load) and `context_tool_in_policy` (the
 * answer-from-context tool reaching policy, which should never happen -
 * the model node's own quote check catches it first) now carry their
 * own names; `ungrounded_args` keeps only `argsGrounded()`'s own false.
 * The refusal line stays one sentence either way (nodes/answer.ts's
 * policyRefusalLine()); only the trace changes. */
export type PolicyDecision =
  | { allow: true }
  | { allow: false; reason: "min_role" | "consent_needed" | "confirm_needed" | "ungrounded_args" | "unknown_tool" | "context_tool_in_policy" | "temporary_mode" | "crisis_state"; ask?: PendingAskInfo };

/** The per-model tool-calling budget (commons spec:
 * ModelCapabilities.turn_budget, U2a). Mirrors the spec shape exactly;
 * see backend/src/lib/turnMachine/budget.ts for how a model's record
 * resolves to this at runtime, and the fallback for a model with none. */
export interface TurnBudget {
  rounds: 0 | 1 | 2;
  tools_offered: string[];
  always_search: boolean;
  answer_from_context_tool: boolean;
  model_transitions: boolean;
  context_tokens: number;
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
   * length target (the written plan's own length numbers, register.ts's
   * writtenBudgetFor, stay room the model's own end-of-reply decides
   * inside). nodes/model.ts's max_tokens derivation uses this only for a
   * written, non-brevity, adult turn; every other turn keeps its existing
   * max_words-derived cap. */
  reply_ceiling_tokens: number;
  deadlines_ms: { model: number; tool: number; total: number };
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
  utterance: string;
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
  /** Built from context, never from anything else. */
  messages: LlmMessage[];
  proposals: ActionProposal[];
  outcomes: ToolExecutionOutcome[];
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
   * hub yet (turnEngine.ts's own "Presence unknown for now"), so
   * nothing sets it today - included in the type because the record
   * names it, never produced until a presence source is built. */
  reasoning: { emit: boolean; withheld_for: "minor" | "surface" | "presence" | "gate" | null };
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
export type NodeOutcome = { ok: true; required_miss?: boolean } | { ok: false; code: string; arg?: string; message?: string } | { skipped: true; reason: string };

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
