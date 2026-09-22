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

/** ARCH-POLICY-01's ingress unit: what the model actually sees, filtered
 * before the prompt (disclosure, band, temporary mode) and typed by
 * where it came from - never the raw utterance or a raw DB row. */
export interface ContextItem {
  id: string;
  text: string;
  source: "window" | "memory" | "episode" | "profile" | "clock" | "roster" | "tool_result" | "search_result" | "document" | "notification" | "quoted";
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

export type PolicyDecision =
  | { allow: true }
  | { allow: false; reason: "min_role" | "consent_needed" | "confirm_needed" | "ungrounded_args" | "temporary_mode" | "crisis_state"; ask?: PendingAskInfo };

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
  thinking_budget_tokens: number;
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
  plan: ReplyPlan;
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
}

export type NodeOutcome = { ok: true } | { ok: false; code: string } | { skipped: true; reason: string };

export type NodeName = "safety" | "commands" | "context" | "model" | "policy" | "tool" | "answer" | "output_gate";

export interface NodeExecution {
  node: NodeName;
  impl: string;
  version: string;
  startMs: number;
  endMs: number;
  outcome: NodeOutcome;
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
