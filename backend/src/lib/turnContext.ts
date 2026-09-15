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
import type { TurnSignal } from "@maipai/spec/gen/ts/turn-signal.js";
import { shapeOf } from "@/lib/turnSignal";
import { pronounFamiliesIn, type SubjectRef } from "@/lib/unknownNames";
import { bannedPhrasesFor } from "@/lib/replyConstraints";

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

/** CHAT-15: why a proposed call was never run. `not_offered`: a tool
 * the model was not shown; `over_cap`: beyond the two-call cap, in
 * model order; `duplicate`: the same wire call id twice; `malformed`:
 * arguments that are not an object; `invalid_args`: the package's own
 * schema refused them (checked for the whole batch before anything
 * runs or asks); `blocked_by_confirmation`: a companion of a
 * consequential proposal, which asks once and executes none of the
 * batch; `unconfirmed`: a confirmation dropped after two unclear
 * answers; `trailing`: a tool call a streamed reply proposed after it
 * had already spoken, which nothing runs (CHAT-17 owns the retry);
 * `not_asked`: a call withheld for an unsaid argument (4a) whose
 * question was never put, because the turn fell through to the model
 * or another ask stood, so the row never shows it parked forever. */
export type RejectedReason = "not_offered" | "over_cap" | "duplicate" | "malformed" | "invalid_args" | "blocked_by_confirmation" | "unconfirmed" | "trailing" | "not_asked";

/** What a spec Source record needs from a package result, kept on the
 * outcome so CHAT-16 emits `sources` straight from retained outcomes:
 * one store, no second table for citations. Filled when the result
 * carries a title (its `data` or `article`); a lookup with no page
 * (the weather) has none and cites its package by id. */
export interface OutcomeSource {
  title: string;
  url?: string;
  site?: string;
  snippet?: string | null;
}

/** CHAT-15: one record per package call a turn proposed, ran, parked
 * or rejected, whichever path produced it (the model's tool calls, a
 * literal or fuzzy winner, an answered confirmation or ask, a
 * household command). Retained on the turn row (`conversation_turns.
 * outcomes`) and read back per conversation; never a memory record. */
export interface ToolExecutionOutcome {
  callId: string;
  packageId: string;
  status: "succeeded" | "failed" | "pending" | "rejected";
  /** Only with status `rejected`. */
  reason?: RejectedReason;
  /** The exact arguments the call was bound to (a rejected call's as
   * proposed), so a confirmation binds to these and nothing else. */
  args?: Record<string, unknown>;
  /** Which path produced it: the model's tool call, the deterministic
   * floor (a pattern or a fuzzy match), an answered confirmation or
   * ask, a household command, or LOOKUP-02's forced lookup (the
   * engine's choice, never the model's, so a log can tell them apart). */
  via?: "tool_call" | "pattern" | "confirm" | "ask" | "command" | "forced";
  /** When the outcome was resolved (ISO 8601), the fetched time a
   * citation shows. */
  at?: string;
  result?: PluginResult;
  errorCode?: string;
  /** Safe for the household; never a developer diagnostic. */
  userMessage?: string;
  source?: OutcomeSource;
}

/** Stamps the time and, from a succeeded result, the citation fields,
 * so every producer records the same shape. */
export function outcomeOf(partial: Omit<ToolExecutionOutcome, "at" | "source"> & { at?: string }): ToolExecutionOutcome {
  const source = partial.status === "succeeded" && partial.result ? sourceFromResult(partial.result) : undefined;
  return { ...partial, at: partial.at ?? new Date().toISOString(), ...(source ? { source } : {}) };
}

function sourceFromResult(result: PluginResult): OutcomeSource | undefined {
  const candidates = [result.data, (result as { article?: unknown }).article].filter((c): c is Record<string, unknown> => !!c && typeof c === "object");
  for (const c of candidates) {
    const title = typeof c.title === "string" && c.title.trim() ? c.title.trim() : null;
    if (!title) continue;
    const url = typeof c.url === "string" && /^https?:\/\//.test(c.url) ? c.url : undefined;
    let site = typeof c.site === "string" && c.site.trim() ? c.site.trim() : undefined;
    if (!site && url) {
      try {
        site = new URL(url).hostname.replace(/^www\./, "");
      } catch {
        site = undefined;
      }
    }
    const snippet = typeof c.snippet === "string" ? c.snippet : typeof c.extract === "string" ? c.extract : null;
    return { title, ...(url ? { url } : {}), ...(site ? { site } : {}), snippet };
  }
  return undefined;
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
  /** ACT-01: the turn's frozen signal (the act, the emotion, the
   * clauses), computed before routing and never recomputed; the
   * router's and the guards' `UtteranceShape` is a projection of it
   * (turnSignal.ts's shapeOf()), so no consumer reads a second shape. */
  signal: TurnSignal;
  /** ASK-01 (SPEC-01's SubjectRef): what the turn is about, resolved
   * before the model runs by unknownNames.ts's resolver: a household
   * ref per name the hub knows (the entity), an unresolved ref per name
   * it does not, the previous turn's carried when this one names
   * nobody. An unresolved ref at confidence 0.8 was framed as household
   * by the person's own words (the engine asks); 0.4 is a bare proper
   * noun (no ask). CHAT-13's stack grows from here. */
  subjects: SubjectRef[];
  /** LOOKUP-02's set: the subjects were carried from the last turn (the
   * utterance named nobody), so a household one stands a lookup down
   * only when the utterance refers back with a pronoun. */
  subjectsCarried?: boolean;
  /** ASK-01: the pronoun family each subject takes, from the entity's
   * stored pronouns or the pronoun the person used for the name this
   * turn, for the guards' pronoun check. */
  subjectPronouns: { name: string; pronouns: string }[];
}

/** ASK-01: the household-framed unknown names on the turn, for the
 * context line, the ask and the guards: the unresolved refs the
 * resolver marked framed (confidence 0.8) with no noun settling their
 * kind ("my friend Nadia" is not unknown to the guards either; the
 * guards' and the context line's notion of unknown is one, a review). */
export function framedUnknownNames(ctx: { subjects: readonly SubjectRef[] }): string[] {
  return ctx.subjects.filter((s): s is Extract<SubjectRef, { type: "unresolved" }> => s.type === "unresolved" && s.confidence >= 0.8 && s.candidate_kinds.length === 0).map((s) => s.surface_form);
}

/** ACT-01: per-stage timings for the `[turn]` line and the bench
 * header, so a first-text budget is a measured row. `signal_us` is the
 * classifier's own cost in microseconds (the design's claim, printed);
 * `subjects_ms` is CHAT-13's slot, null until it fills it. */
export interface TurnTimings {
  signal_us: number;
  routing_ms: number;
  recall_ms: number;
  prompt_ms: number;
  first_token_ms: number | null;
  finalize_ms: number;
  retries: number;
  subjects_ms: number | null;
}

export function emptyTimings(): TurnTimings {
  return { signal_us: 0, routing_ms: 0, recall_ms: 0, prompt_ms: 0, first_token_ms: null, finalize_ms: 0, retries: 0, subjects_ms: null };
}

const DETAIL_PHRASES = [/\bin detail\b/i, /\bdetailed explanation\b/i, /\bstep by step\b/i];

export function intentFor(utterance: string, signal: TurnSignal): TurnIntent {
  const shape = shapeOf(signal, utterance);
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
    outcomes: ctx.outcomes.map((o) => ({ packageId: o.packageId, status: o.status, ...(o.reason ? { reason: o.reason } : {}) })),
    personaExamples: ctx.persona.examples,
    roster: ctx.roster,
    shape: shapeOf(ctx.signal, ctx.utterance),
    // REG-01: the act for the statement rule, and the hub's previous
    // reply for the repeated-question check.
    act: ctx.signal.primary_act,
    target: ctx.signal.target,
    repair: ctx.signal.repair,
    previousReply: [...ctx.history].reverse().find((m) => m.role === "assistant")?.content,
    // ASK-01: the unknown names, the subjects' pronouns, and the
    // pronoun families the person used this turn and the last two.
    // LOOKUP-02: a request the turn's lookup tools serve (a world
    // question with the search offered and no household frame) is
    // answerable, so a failed answer is the failed-lookup line, never
    // cannot-do.
    lookupServed: ctx.offeredToolIds.includes("websearch") && !householdFrame(ctx) && lookupRequest(ctx),
    unknownNames: framedUnknownNames(ctx),
    unresolvedNames: ctx.subjects.filter((s): s is Extract<SubjectRef, { type: "unresolved" }> => s.type === "unresolved").map((s) => s.surface_form),
    subjectPronouns: ctx.subjectPronouns,
    pronounsInPlay: [...pronounFamiliesIn([ctx.utterance, ...ctx.history.filter((m) => m.role === "user").slice(-2).map((m) => m.content)].join(" "))],
    subjects: ctx.subjects,
    bannedPhrases: bannedPhrasesFor(ctx.conversationId),
  };
}

/** LOOKUP-02: a request the search can serve: a question, or a "find
 * me", "get me", "look up", "show me" about the world; never an action
 * request ("text Nadia", "add eggs"), which stays the capability
 * guard's. */
const LOOKUP_REQUEST_RE = /\b(?:find|look up|look for|search|show me|pull up|get me|fetch|link|what(?:'s| is| are| was| were)|who(?:'s| is| was)|where(?:'s| is)|when(?:'s| is| does| did)|how (?:much|many|long|old|far)|which)\b/i;
const ACTION_REQUEST_RE = /\b(?:text|message|call|email|send|remind|add|set|turn (?:on|off)|lock|unlock|play|order|book|schedule|cancel|delete|remove)\b/i;
function lookupRequest(ctx: TurnContext): boolean {
  // An action request stays the capability guard's even when it
  // carries a question inside ("send the plumber a message asking
  // what's wrong", a review).
  if (ACTION_REQUEST_RE.test(ctx.utterance)) return false;
  return shapeOf(ctx.signal, ctx.utterance) === "question" || LOOKUP_REQUEST_RE.test(ctx.utterance);
}

/** LOOKUP-02: whether the utterance is about the household (a roster
 * or registry name, or a first-person possessive with no world
 * subject), the same reading asksAboutHousehold() gives the lookup
 * paths; a world question is anything else. */
function householdFrame(ctx: TurnContext): boolean {
  const roster = ctx.roster.filter((n) => n.length > 1);
  return roster.some((name) => new RegExp(`(?<![\\p{L}\\p{N}])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "iu").test(ctx.utterance)) || ctx.subjects.some((s) => s.type === "household");
}
