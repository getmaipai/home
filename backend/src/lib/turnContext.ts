// CHAT-01 (docs/dev/session-a.md): one ephemeral turn context, the
// decision record's "One ephemeral turn context" (docs/dev.md,
// 2026-09-07) made real. Runtime views over existing records, built once
// per turn by turnEngine.ts's prepareTurn() and read by both the prompt
// and the guards, never persisted and never a second record system.
// The point: the prompt's context message and guards.ts's GuardContext
// used to be assembled from the same retrieval results by two separate
// pieces of code that disagreed (the prompt capped memories three ways
// and the guard grounded on every candidate; the prompt showed one half
// of a recalled episode cut at 200 characters and the guard grounded
// both halves uncut; the profile, roster, summary and clock were in the
// prompt and grounded nothing). Here, selection is the render: an
// evidence item is included when the text the prompt shows for it
// survived every cap intact, and the guard input is derived from the
// included items alone.
import type { Surface } from "@/lib/turnEngine";
import type { LlmMessage } from "@/lib/llm";
import type { GuardContext } from "@/lib/guards";
import type { PluginResult } from "@maipai/spec/interpreters/ts/recipe-interpreter.js";
import type { UtteranceShape } from "@/lib/routing";

/** The record's kinds, plus `episode`: JOIN-01's recalled turns postdate
 * the record, ground a reply the way a memory line does, and are held
 * apart by the guard (never an `unrelated_recall` candidate). */
export type EvidenceKind = "user_assertion" | "memory" | "profile" | "summary" | "household" | "clock" | "episode" | "package_result";

export interface TurnEvidence {
  /** Deterministic within the turn (`memory:<record id>`, `clock`, ...),
   * never a source of truth. */
  id: string;
  kind: EvidenceKind;
  /** What the item asserts, the text the guards ground on. */
  text: string;
  /** The exact text the prompt renders for it; inclusion means this
   * survived the render intact. */
  rendered: string;
  sourceId?: string;
  entityIds: string[];
}

export interface ToolExecutionOutcome {
  callId: string;
  packageId: string;
  status: "succeeded" | "failed" | "pending";
  result?: PluginResult;
  errorCode?: string;
  /** Safe for the household; never a developer diagnostic. */
  userMessage?: string;
}

export interface TurnIntent {
  /** Defaults to `chat`; reads ROUTE-01's shape (a question is a lookup,
   * a command an action), never recomputed here. CHAT-13 refines it. */
  kind: "chat" | "lookup" | "action" | "clarify";
  query: string;
  subjectEntityIds: string[];
  /** Only for a case-insensitive "in detail", "detailed explanation" or
   * "step by step" (CHAT-12 reads it for the output reserve). */
  explicitDetailedAnswer: boolean;
}

export interface FrozenPersona {
  id: string;
  displayName: string;
  /** Borrowed for tone by the guards, never evidence. */
  examples: readonly string[];
}

export interface TurnContext {
  turnId: string;
  conversationId: string;
  actorId: string;
  surface: Surface;
  utterance: string;
  /** The conversation window as sent, roles kept: assistant lines are
   * history, not evidence. */
  history: readonly LlmMessage[];
  evidence: TurnEvidence[];
  includedEvidenceIds: string[];
  offeredToolIds: string[];
  outcomes: ToolExecutionOutcome[];
  intent: TurnIntent;
  /** Frozen once per turn, so the prompt, the safety check and the
   * guards agree on who is speaking and when. */
  persona: FrozenPersona;
  ageBand: string;
  now: Date;
  locale: string;
  /** Display names and nicknames of the household, for the guard's
   * household-subject test. */
  roster: string[];
  /** ROUTE-01's shape of the utterance as the router read it (with the
   * installed packages' command openers), so the guards read the same
   * shape and never recompute it with a different opener set (CHAT-04). */
  shape: UtteranceShape;
}

const DETAIL_PHRASES = [/\bin detail\b/i, /\bdetailed explanation\b/i, /\bstep by step\b/i];

export function intentFor(utterance: string, shape: UtteranceShape): TurnIntent {
  return {
    kind: shape === "question" ? "lookup" : shape === "command" ? "action" : "chat",
    query: utterance,
    subjectEntityIds: [],
    explicitDetailedAnswer: DETAIL_PHRASES.some((re) => re.test(utterance)),
  };
}

/** Sets `includedEvidenceIds` to the items whose rendered text appears
 * intact in the context message the model will actually see: the rule
 * prepareTurn()'s `actuallyInjected` already applied to memory bullets
 * (a section cap or the outer budget can drop or cut a line), applied to
 * every kind. The utterance is always included. */
export function markIncluded(ctx: TurnContext, contextMessage: string): void {
  ctx.includedEvidenceIds = ctx.evidence.filter((e) => e.kind === "user_assertion" || contextMessage.includes(e.rendered)).map((e) => e.id);
}

export function includedEvidence(ctx: TurnContext): TurnEvidence[] {
  const included = new Set(ctx.includedEvidenceIds);
  return ctx.evidence.filter((e) => included.has(e.id));
}

/** The guard input, from the included evidence alone. `sources` are the
 * memory lines and package results (the `unrelated_recall` candidates);
 * `episodes` the recalled lines the prompt showed; `grounding` the
 * profile, summary, roster and clock facts the prompt showed; `history`
 * the window's user lines; `outcomes` the turn's tool outcomes, package
 * id and status, so an action claim is matched to the package family its
 * verb names (CHAT-04; a summary is a lossy aid, never proof of an
 * action; an assistant line and a persona example never become one). */
export function guardContextFrom(ctx: TurnContext): Omit<GuardContext, "personId"> {
  const included = includedEvidence(ctx);
  const ofKind = (...kinds: EvidenceKind[]) => included.filter((e) => kinds.includes(e.kind)).map((e) => e.text);
  return {
    utterance: ctx.utterance,
    history: ctx.history.filter((m) => m.role === "user").map((m) => m.content),
    sources: ofKind("memory", "package_result"),
    episodes: ofKind("episode"),
    grounding: ofKind("profile", "summary", "household", "clock"),
    outcomes: ctx.outcomes.map((o) => ({ packageId: o.packageId, status: o.status })),
    personaExamples: ctx.persona.examples,
    roster: ctx.roster,
    shape: ctx.shape,
  };
}
