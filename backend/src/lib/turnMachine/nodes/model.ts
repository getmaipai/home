import { comparePrompt } from "@/lib/promptPrefix";
import { EMPTY_LENGTH_RETRY_EXTRA_TOKENS } from "@/lib/reasoningReserve";
// U2c, the `model` node (turn-machine-state-record-2026-09-22.md's
// state table): one call, the fixed tool set from the budget, offered with
// tool_choice "auto" (docs/design/RULES.md rule 1, THIN-2A: the model
// decides whether a turn needs a search or a tool; no signal field, word
// rule or list does), streamed so the wire's own `reasoning`/`delta` events
// come from the same call turnNext.ts forwards to the client.
import { foldedBlock } from "@/lib/systemFold";
import { notePrefix } from "@/lib/prefixPrewarm";
import { startCompleteStreamPieces, envelopeToolCall, StackStreamError } from "@/lib/llm";
import { roleHealth } from "@/lib/roleHealth";
import type { LlmMessage, ToolSpec, ToolCall } from "@/lib/llm";
import { missingRequired } from "@/lib/capabilities";
import { loadManifestOnly } from "@/lib/plugins";
import { VIRTUAL_TOOL_REGISTRY } from "@/lib/projects/tool";
import { isBarePronoun, ownWordsQuery } from "@/lib/text";
import { detectCsam } from "@maipai/spec/safety/ts/signals.js";
import { asksForMedia, asksForSong, claimsMedia, lyricsInsteadOfSong, MEDIA_NOT_STARTED_LINE, MEDIA_REASK_INSTRUCTION, MUSIC_STARTED_LINE, SONG_LYRICS_ONLY_NOTE, SONG_LYRICS_REASK_INSTRUCTION } from "@/lib/mediaClaims";
import { PICTURE_NOT_HERE_LINE } from "@/lib/pictures/policy";
import { laneOfPerson } from "@/lib/pictures/laneGate";
import type { Lane } from "@/lib/pictures/lane";
import { visibleText, extractReasoningText, feedThinkSplit, flushThinkSplit, newThinkSplitState } from "@/lib/wellFormed";
import { visibleReplyMaxTokens } from "@/lib/turnShared";
import { streamWatchdog, replyIsUncapped } from "../deadline";
import type { StackFailureFacts } from "@/lib/stackEngine";
import { classifyGenerationFailure, engineComputerAwayFromHome, partialReplyNote, RETRY_BACKOFF_MS, stackRefusalKind, type FailureKind } from "@/lib/generationFailure";
import { isWrittenAdultTurn, promptSurfaceClassFor, type SurfaceClass } from "@/lib/surfaceClass";
import { toolCallAssistantMessage, toolResultMessages, phrasingInstruction, picturesOnlyInstruction, searchEvidenceMaxChars, musicForOutcomes } from "@/lib/composer";
import { SHOW_IMAGES_TOOL_ID } from "@/lib/answerImages/turn";
import { planLineForTurnMachine } from "@/lib/register";
import { repeatNotes } from "@/lib/echo";
import { askAppendFor, NO_ASK_APPEND } from "@/lib/askNames";
import { pickStatusPhrase } from "@/lib/statusPhrases";
import { contextToMessages, bareMessages, continuationMessages } from "../messages";
import { promptLimitLine } from "@/lib/failureCopy";
import { thinkingModeFor } from "@/lib/modelCatalog";
import { lookupMissed, lookupFailureKind, lookupMissedClause, lookupMissedInstruction, markRetryMessage, recoveredRetry, retryInstruction, retryTools, isRepeatOfFailed } from "./lookupFallback";
import type { Node, TurnState, NodeOutcome } from "../contract";
import type { StreamGate } from "./outputGate";
import { pictureFailureWords, picturesNotReadNote } from "@/lib/chatImageNote";
import type { ChatImagePart } from "@/wire";
import { turnAgeBand } from "../speaker";
import { searchAssistEligibility, MINOR_RESCUE_ENABLED } from "@/lib/searchAssist/eligible";
import { bumpSearchAssistCounter } from "@/lib/searchAssist/counters";
import { minorSearchGate } from "@/lib/searchAssist/minorGate";
import { weatherAssistEligibility, WEATHER_TOOL } from "@/lib/searchAssist/weatherAssist";

/** STREAM-PARTIAL-01: `!attempt.ok` covers two different failures this
 * function can't tell apart by its own outcome code alone - a pre-stream
 * failure (llm.ts's `started.ok` check, nothing ever pushed to `gate`)
 * and GENFAIL-01's own mid-stream throw (runOneGeneration's own catch,
 * reached only after its loop already pushed real deltas to `gate` as
 * they arrived). The gate itself is what tells them apart: `reset()`
 * (both attempt sites used unconditionally before this) discards
 * whatever it already released, which is correct for the first case
 * (nothing to discard) and wrong for the second - the household already
 * heard those sentences before the engine died or the client cancelled,
 * so erasing them from the gate left `answer`'s own fixed model_failed
 * line (COMPOSE_FAILURE_LINE) as the logged reply while the wire had
 * already carried something else entirely. `finish()` (never reset())
 * once >=1 sentence is already delivered: it repairs whatever tail was
 * still pending (the same dangling-markup repair a clean ending gets)
 * and marks the gate done, so output_gate's own `streamed.done` branch
 * (outputGate.ts, "logged equals streamed by construction") picks up
 * the real delivered text instead of `model_failed`'s fixed line -
 * mirroring the old engine file's own runTurnStream()'s finalize(), whose
 * "cut with real partial content already streamed stays source: model"
 * branch (the old engine file, the comment beside `refusedWithNothingDelivered`)
 * never resets a stream's already-released text for ANY ending, crash
 * or cancel alike - only an output-safety refusal with nothing
 * delivered yet gets the canned line there, the identical zero-delivered
 * case this function's own `reset()` branch still covers. The
 * generation's own error already reaches the trace unconditionally
 * (runOneGeneration's own catch, above, pushes it onto
 * state.generations before returning `{ ok: false }` at all) - settling
 * the gate one way or the other never touches that. */
function settleFailedGate(gate: StreamGate | undefined, state?: TurnState, message?: string, cancelled = false): void {
  if (gate && gate.result().text.length > 0) {
    // THIN-DL-02: the person keeps what was written, and a plain closing
    // note says it stopped (never a retry once text was released).
    if (state && !cancelled) gate.push(`\n\n${partialReplyNote(classifyGenerationFailure(message).kind, state.plan?.age_band !== "adult", engineComputerAwayFromHome())}`);
    gate.finish();
  } else gate?.reset();
}

/** The turn's own signal aborted for a reason other than a deadline: the
 * person cancelled (closed the tab), so no closing note is written. */
function isDeadlineAbort(signal: AbortSignal): boolean {
  return (signal.reason as { name?: string } | undefined)?.name === "TimeoutError";
}

/** The model node's failed output, carrying the failure kind to `answer`. */
function failedOutput(attempt: { message?: string }): ModelOutput {
  return { kind: "model_failed", failure: classifyGenerationFailure(attempt.message).kind };
}

function evidenceRetryLimits(baseChars: number, message: string | undefined): number[] {
  let promptTokens = 0;
  let contextTokens = 0;
  const bodyStart = message?.indexOf("{") ?? -1;
  const bodyEnd = message?.lastIndexOf("}") ?? -1;
  if (bodyStart >= 0 && bodyEnd >= bodyStart) {
    try {
      const body = JSON.parse(message!.slice(bodyStart, bodyEnd + 1)) as { error?: { n_prompt_tokens?: unknown; n_ctx?: unknown } };
      promptTokens = typeof body.error?.n_prompt_tokens === "number" ? body.error.n_prompt_tokens : 0;
      contextTokens = typeof body.error?.n_ctx === "number" ? body.error.n_ctx : 0;
    } catch { /* use the bounded halving fallback when no structured counts are present */ }
  }
  const measuredLimit = Number.isFinite(promptTokens) && Number.isFinite(contextTokens) && promptTokens > contextTokens && contextTokens > 0
    ? Math.floor(baseChars * contextTokens / promptTokens)
    : Math.floor(baseChars / 2);
  const limits: number[] = [];
  let limit = Math.min(baseChars - 1, measuredLimit);
  while (limit > 0) {
    if (!limits.includes(limit)) limits.push(limit);
    limit = Math.floor(limit / 2);
  }
  limits.push(0);
  return limits;
}

export interface ModelInput {
  utterance: string;
  /** machine.ts's own round counter: `budget.model_transitions &&
   * roundsUsed < budget.rounds`, so a `rounds: 0` or
   * `model_transitions: false` budget (the robot's Pi, a model with no
   * measured record) never offers a tool on the first call either, and
   * a `rounds: 1` budget's second entry (after one tool executed) is
   * answer-only - the state table's "tool ... exits: model while
   * rounds remain; else answer" applied at the model node's own
   * boundary, since offering no tools is what makes a text answer
   * certain, never a second, separate cap checked somewhere else. */
  toolsAllowed: boolean;
  /** T5 / THIN-2G: the one retry round after every call of a tool round failed
   * (machine.ts sets it). Offered like the failed round (same tools block,
   * tool_choice auto) plus a plain line naming the failed tool and kind. */
  retry?: boolean;
}

export type ModelOutput =
  | { kind: "text"; text: string; thinking: boolean; reasoning?: string }
  // QUERY-WRITER-01: `queryWriterUsed` is set only when a required-call
  // miss was recovered by the query-writer generation below (never by
  // the model's own real tool call, and never by the raw-utterance
  // builder) - machine.ts's own `model` state reads it back to decide
  // whether a LATER policy refusal of exactly this call should retry
  // via the raw utterance (queryWriterFallback) instead of the generic
  // honesty line every other refusal gets.
  | { kind: "tool_calls"; calls: ToolCall[]; reasoning?: string; queryWriterUsed?: boolean; /** ROUTER-BUILD-01e: the search assist added this call. */ searchAssistRescued?: boolean; /** SEARCH-ANSWER-06: text the model streamed in the same generation as its calls; the gate was reset, so it only survives here, for an all-refused turn to keep. */ draft?: string }
  // DEADLINE-01 (dev.md "U6 rerun ruling" (a)): a generation that never
  // finished at all (the model node's own deadline, a dead engine) -
  // distinct from `text` with an empty string, which `answerInputFrom()`
  // used to receive for this case and pass straight through as a real,
  // silent empty reply. `answer.ts` renders this with a fixed line,
  // never empty text.
  | { kind: "model_failed"; reasoning?: string; failure?: FailureKind };

export function toolSpecFor(id: string, lane: Lane = "adult"): ToolSpec | null {
  // PROJECT-START-01: start_project is a virtual tool (tool.ts's own
  // header) - it never has a backend/packages/start_project manifest.json
  // for loadManifestOnly() to find below.
  const virtual = VIRTUAL_TOOL_REGISTRY.find((tool) => tool.id === id);
  if (virtual) return virtual.spec();
  const loaded = loadManifestOnly(id);
  if (!loaded.ok) return null;
  // CAP-GATE-01: a tool whose package needs a capability that is off is not offered.
  if (missingRequired(loaded.value).length > 0) return null;
  return { id, description: loaded.value.description, args: loaded.value.args };
}

/** The reply floor (spec-v0.1.28, U4b-2, turn-machine-state-record-
 * 2026-09-22.md "The reply floor"): a written, non-brevity, adult
 * turn uses the budget's own reply_ceiling_tokens instead of LAT-01's
 * shared visibleReplyMaxTokens formula (the old engine file) - a runaway
 * backstop sized per model, not a max_words-derived number built for
 * the spoken register's short-form defaults, which would clip a long
 * written answer well before it ever ran away. Every other turn
 * (spoken, glance, a child's or teen's turn, a brevity turn) keeps
 * LAT-01's own formula unchanged, the same one the old path uses -
 * one formula outside the written-adult case, not two that can drift.
 * `thinking` adds the toggled-on budget on top so a written turn with
 * thinking on gets room for both the reasoning span and the visible
 * reply that follows it. isWrittenAdultTurn (surfaceClass.ts) is the
 * one shared gate for "written and adult" - a review caught this
 * file's own inline version of the same check (surfaceClass +
 * age_band, no shared helper) drifting from messages.ts's own gate on
 * the persona/plan-line side, which is exactly the kind of duplicated-
 * predicate risk a second, independent copy invites.
 *
 * THIN-1A (docs/design/RULES.md rule 5): this is now the ONE place a
 * non-forced generation's max_tokens comes from, the phrasing round
 * after a tool round included - PHRASE-01 had that round read LAT-01's
 * word-budget formula directly (the evidence-boosted 360 words became
 * 608 tokens), which was a length target on an adult's written chat
 * with the plan's own word count behind it. For a written adult the
 * ceiling is the only cap, every round; a minor's typed turn and every
 * spoken or glance turn still fall through to the formula unchanged
 * (rule 0). */
export function replyMaxTokensFor(state: Pick<TurnState, "planBasis" | "plan" | "budget" | "modelId" | "engineModelId">, thinking: boolean): number {
  const isWrittenAdult = isWrittenAdultTurn(state.planBasis.surfaceClass, state.plan.age_band) && !state.planBasis.brevity;
  if (isWrittenAdult) return state.budget.reply_ceiling_tokens + (thinking ? state.budget.thinking_budget_tokens_toggled : 0);
  // MINOR-CEILING-01 (live, 2026-10-17): a child's and a teen's turn sends
  // thinking off, but a model whose record says it reasons on every turn
  // (thinking_mode "always": Muse's template has no off switch) spends the
  // reply ceiling on reasoning the client then drops, and the person got an
  // empty reply (96 tokens, all reasoning, no text) on "what's the weather?".
  // The engine's reasoning span is reserved on top of the visible ceiling;
  // the reply the person sees keeps the band's own cap (rule 0: the words
  // allowed never grow, only the room for reasoning nobody sees).
  const runningId = state.modelId ?? state.engineModelId;
  const reasonsAnyway = thinkingModeFor(runningId) === "always" || (runningId !== undefined && spendsCeilingInvisibly.has(runningId));
  return visibleReplyMaxTokens(state.plan.max_words, thinking || reasonsAnyway);
}

/** VOICE-REPLY-01 (live, 2026-10-17): a model whose record is missing or
 * wrong cannot be trusted to say it reasons. The engine's own word is the
 * evidence: a generation that stops on `length` with no visible text spent
 * its whole ceiling on something the person never sees. The model's id is
 * remembered for this process, so every later turn on it reserves the
 * reasoning allowance up front instead of failing once per turn. Nothing is
 * persisted and nothing is gated on one id (rule 8). */
const spendsCeilingInvisibly = new Set<string>();
export function rememberCeilingSpentInvisibly(modelId: string | undefined): void {
  if (modelId) spendsCeilingInvisibly.add(modelId);
}
export function __resetLearnedCeilingsForTests(): void {
  spendsCeilingInvisibly.clear();
}
/** The extra room the one empty-reply retry gets after a generation spent its
 * whole ceiling without a visible character: the same ceiling would fail the
 * same way. */
export { EMPTY_LENGTH_RETRY_EXTRA_TOKENS } from "@/lib/reasoningReserve";

interface GenerationAttempt {
  ok: true;
  /** The person-visible portion only (wellFormed.ts's visibleText()) -
   * a code review (2026-09-22, the reasoning-gating amendment) caught
   * this field previously holding neutralizeThinkTags()'s own output:
   * that helper only defangs a literal `<think>`/`</think>` STRING (so
   * it can't be mistaken for a real tag later), it does not remove a
   * think block's CONTENT, so a thinking model's reasoning was landing
   * directly in what callers treated as the visible reply. */
  text: string;
  /** wellFormed.ts's own extractReasoningText(), on the SAME raw text
   * `text` above was derived from - undefined when the generation
   * carried no think block at all. */
  reasoning: string | undefined;
  toolCalls: ToolCall[] | undefined;
  thinking: boolean;
  /** VOICE-REPLY-01: the engine stopped on its ceiling (`length`) with no visible text and no call. */
  lengthEmpty?: boolean;
  /** ROUTER-BUILD-01e: how an armed search-assist hold ended (absent when not armed). */
  hold?: "rescue" | "tool_call" | "text_kept";
  /** The rescue came from the budget running out, not from the round ending. */
  holdAtBudget?: boolean;
  /** The round's text was held back, not released (mediaClaims.ts); the model node releases what stands. */
  heldBack?: boolean;
}
// GENFAIL-01: `message` is the engine's own diagnostic text (llm.ts's
// caught error, or startCompleteStream()'s own `started.error`) -
// carried back to modelNode so it lands on both the generation record
// (already pushed inside runOneGeneration, below) AND the model node's
// own NodeOutcome (contract.ts), the same reason a caller shouldn't
// need to cross-reference two different records to read why a turn
// failed.
type GenerationResult = GenerationAttempt | { ok: false; code: string; message?: string; released?: boolean };

// GENFAIL-01 (a code review, 2026-09-23): the same GROUND-01 caution
// `arg` already carries (contract.ts's own NodeOutcome doc) - the
// engine's own error text is trusted to be about the WIRE (a status, a
// generic "two system messages" or "invalid request" shape), never a
// household member's own words, but a rejected request's body is not
// this codebase's to control, and some OpenAI-compatible servers do
// echo a bad field's value back in a validation message. Bounded
// rather than trusted blindly: the same 2000-character cap
// spec-v0.1.29's own client.ts already applies before it ever reads a
// response body, applied again here since this field is also
// persisted to the household's own DB and served over the wire.
const MAX_GENERATION_ERROR_CHARS = 2000;
function boundedGenerationError(message: string | undefined): string | undefined {
  return message === undefined ? undefined : message.slice(0, MAX_GENERATION_ERROR_CHARS);
}

/** ROUTER-BUILD-01e: the longest an armed round holds whitespace-only content
 * before it flushes and stands down (fail open). */
export const SEARCH_ASSIST_HOLD_LIMIT_MS = 250;
/** ROUTER-BUILD-01e: the rescue budget. Once plain text has started on an armed
 * round, the model gets this long to make its own tool call; the rescue waits
 * for the end of generation or this budget, whichever is first. Set from the
 * p95 (5661 ms, n=73, 9B chat model) of the first-round latency of plain/router
 * arm runs that wrote text and then called websearch, in data-scratch/chat-ab
 * (router-live-06, search-recency-02, -05). That latency includes prefill and
 * reasoning, so it is an upper bound on first-visible-character to call; the
 * traces carry no per-piece times and cap text at 200 characters, so a tighter
 * figure needs a new capture. A call the model would have made after this
 * budget is cancelled (counter rescued_at_budget). */
export const SEARCH_ASSIST_RESCUE_BUDGET_MS = 5700;
let holdClock: () => number = () => Date.now();
export function __setSearchAssistHoldClockForTests(fn: (() => number) | null): void {
  holdClock = fn ?? (() => Date.now());
}

/** One real model call: builds the tools block for this attempt, runs
 * it through the streaming client (COR-7's own signal support), and
 * drains it manually so the generator's return value (the tool calls)
 * survives - `for await...of` would discard it. */
async function runOneGeneration(state: TurnState, messages: LlmMessage[], tools: ToolSpec[], tool_choice: "auto" | "none" | undefined, thinking: boolean, maxTokens: number, reason: string, nodeAbort: AbortSignal, arm: boolean | "media" = false): Promise<GenerationResult> {
  // DEADLINE-02: first-token and stall timers on the whole generation,
  // from the request on (a pre-stream wait is the first-token wait).
  // THIN-DL-02: a transient failure before anything reached the person is
  // retried quietly after a short pause, inside the same window: an
  // adult's written turn twice more, a minor's or spoken turn once.
  const uncapped = replyIsUncapped(state);
  const pauses = uncapped ? RETRY_BACKOFF_MS.adult : RETRY_BACKOFF_MS.minor;
  const windowMs = uncapped ? state.budget.deadlines_ms.first_token_ms : state.budget.deadlines_ms.model;
  const began = Date.now();
  for (let attempt = 0; ; attempt++) {
    // A retry waits only for what is left of the window.
    const firstTokenMs = attempt === 0 ? state.budget.deadlines_ms.first_token_ms : Math.max(1, Math.min(state.budget.deadlines_ms.first_token_ms, windowMs - (Date.now() - began)));
    const watchdog = streamWatchdog(nodeAbort, firstTokenMs, state.budget.deadlines_ms.stall_ms);
    let result: GenerationResult;
    try {
      result = await runWatchedGeneration(state, messages, tools, tool_choice, thinking, maxTokens, reason, watchdog.signal, watchdog.beat, arm);
    } finally {
      watchdog.clear();
    }
    // The client may word an abort its own way; the watchdog's reason is the
    // real cause and goes on the record and into the classifier.
    const timeoutReason = watchdog.signal.aborted && !nodeAbort.aborted ? (watchdog.signal.reason as { name?: string; message?: string } | undefined) : undefined;
    if (!result.ok && timeoutReason?.name === "TimeoutError" && timeoutReason.message && !(result.message ?? "").includes(timeoutReason.message)) {
      result = { ...result, message: boundedGenerationError(`${result.message ?? "chat model unavailable"}: ${timeoutReason.message}`) };
    }
    if (result.ok || result.released || nodeAbort.aborted) return result;
    const pause = pauses[attempt];
    if (pause === undefined || !classifyGenerationFailure(result.message).transient) return result;
    if (Date.now() - began + pause >= windowMs) return result;
    console.error(`[model] generation "${reason}" failed before any text (${result.message ?? result.code}); retrying quietly, attempt ${attempt + 2}`);
    await new Promise<void>((resolve) => {
      const done = () => { clearTimeout(timer); nodeAbort.removeEventListener("abort", done); resolve(); };
      const timer = setTimeout(done, pause);
      nodeAbort.addEventListener("abort", done, { once: true });
    });
    if (nodeAbort.aborted) return result;
  }
}

/** CHAT-CALM-ERRORS-01b: the failure's kind, fixed on the record when it
 * happens, so an admin's details later never read whatever the engine is
 * doing by then. The Stack's own state decides when it gave one. */
function generationFailureKind(facts: StackFailureFacts | null, message: string | undefined): FailureKind {
  return facts?.state ? stackRefusalKind(facts.state, facts.offline_reason) : classifyGenerationFailure(message).kind;
}

async function runWatchedGeneration(state: TurnState, messages: LlmMessage[], tools: ToolSpec[], tool_choice: "auto" | "none" | undefined, thinking: boolean, maxTokens: number, reason: string, signal: AbortSignal, beat: () => void, armMode: boolean | "media" = false): Promise<GenerationResult> {
  // "media": the whole round is held back (mediaClaims.ts) so a claim of a picture or video can be checked before anyone reads it.
  const holdAll = armMode === "media";
  const arm = armMode === true;
  // STREAM-NEXT-01 (b): `state.streamGate` is undefined for every caller
  // but turnNext.ts's own runTurnNextStream(), so this is a no-op
  // everywhere else. reset() clears whatever a PRIOR, now-abandoned
  // attempt (an offered round the model answered with a tool call
  // instead, or an earlier empty attempt this call is retrying) left
  // pending - this turn's real reply is always its LAST generation's
  // own text.
  const gate = state.streamGate;
  gate?.reset();
  // THIN-5A (rule 2): a turn that shows no reasoning (a minor, a spoken or
  // non-chat surface, an unidentified speaker) asks the engine for none and
  // the engine client drops whatever comes back anyway, so it is never held,
  // checked or stored here.
  // ROUTER-BUILD-01e: an armed round gets its own abort, linked to the
  // watchdog's, so a rescue stops this stream without aborting the node.
  const roundAbort = arm ? new AbortController() : undefined;
  if (roundAbort) {
    if (signal.aborted) roundAbort.abort(signal.reason);
    else signal.addEventListener("abort", () => roundAbort.abort(signal.reason), { once: true });
  }
  const prefix = comparePrompt(state.conversationId, messages, tools);
  notePrefix(state.actor.id, state.planBasis.surfaceClass ?? "spoken", messages, tools, state.modelId);
  const started = await startCompleteStreamPieces("chat", messages, { model: state.modelId, tools: tools.length > 0 ? tools : undefined, tool_choice, thinking, max_tokens: maxTokens, dropReasoning: !state.reasoning.emit }, roundAbort?.signal ?? signal);
  if (!started.ok) {
    // GENFAIL-01 (dev.md "generation_failed is never blind again"): a
    // failed attempt used to leave no generation record at all (the
    // push below was the ONLY one, reached only on a real reply) - the
    // model node's own outcome told a caller THAT this generation
    // failed, never why. `started.error` is already the real message
    // (llmSupervisor's "chat model unavailable: ..." or an invalid
    // request), captured here rather than discarded.
    const boundedError = boundedGenerationError(started.error);
    // GENFAIL-01: the running hub's own log stream, not only the
    // persisted stats column - a live outage (Fable's own diagnosis,
    // dev.md) is read from `[sidecars]`/`[engine]` lines beside the
    // turn's own time before anyone queries a DB row, and this failure
    // class had no line here at all.
    console.error(`[model] generation "${reason}" failed before streaming started: ${started.code}${boundedError ? ` - ${boundedError}` : ""}`);
    // CHAT-CALM-ERRORS-01b: the raw facts of the refusal (status, the
    // Stack's error, state and body, the answering engine) ride on the
    // record beside the household line, for an admin's details only.
    const failedAtMs = Date.now();
    // Only this call's own facts: a remembered refusal may describe an
    // earlier failure (an invalid request never reaches the Stack at all).
    // The kind is read now, while the refusal it may name is current.
    const facts = started.facts ?? null;
    state.generations.push({ reason, thinking, maxTokens, requestSentMs: failedAtMs - state.startedAt, firstDeltaMs: null, prefix, stats: null, error: boundedError, offlineReason: facts?.offline_reason ?? null, facts, failureKind: generationFailureKind(facts, boundedError), failedMs: failedAtMs - state.startedAt, failedAt: new Date(failedAtMs).toISOString() });
    return { ok: false, code: started.code, message: boundedError, released: false };
  }

  const requestSentMs = Date.now();
  let firstDeltaMs: number | null = null;
  // THIN-5A: the engine's own two channels, kept apart end to end. `raw`
  // is `content` only.
  let raw = "";
  let nativeReasoning = "";
  let toolCalls: ToolCall[] | undefined;
  // STREAM-NEXT-01 (b), ruling point 5: reasoning is never streamed -
  // split live exactly as routes/turn.ts's own streamTurnEvents() does
  // for the old path, but every span is just discarded except the
  // visible one, which alone reaches the gate; the full raw text (think
  // block included) still accumulates into `raw` below unchanged, so
  // extractReasoningText(raw) at the end of this function is completely
  // unaffected - this split exists only to keep a think block's own
  // content out of what the gate can release mid-stream.
  const thinkSplit = gate ? newThinkSplitState() : undefined;
  const feed = (text: string) => {
    if (gate && thinkSplit) for (const span of feedThinkSplit(thinkSplit, text)) if (!span.reasoning) gate.push(span.text);
  };
  // ROUTER-BUILD-01e (rule 1, search assist rescue): while armed, content
  // pieces only append to `held` (no gate push, no per-piece scan); reasoning
  // is never held (rule 2). The one decision is taken on the first visible
  // character. Whitespace held past the limit is flushed (fail open).
  const hold = arm ? { phase: "armed" as "armed" | "text" | "envelope" | "off", held: "", since: 0 } : undefined;
  let rescued = false;
  let rescuedAtBudget = false;
  try {
    for (;;) {
      const step = await started.pieces.next();
      if (step.done) {
        toolCalls = step.value;
        break;
      }
      beat();
      if (firstDeltaMs === null) firstDeltaMs = Date.now() - requestSentMs;
      if (step.value.channel === "reasoning") {
        nativeReasoning += step.value.text;
        // THIN-5B: released live under the same gate as the answer. The
        // engine client only sends reasoning on a turn that may show it.
        if (state.reasoning.emit) gate?.pushReasoning(step.value.text);
        continue;
      }
      raw += step.value.text;
      if (holdAll) continue;
      if (hold && hold.phase === "text") {
        // Plain text is being held; the model still has until the budget to call a tool.
        hold.held += step.value.text;
        if (holdClock() - hold.since < SEARCH_ASSIST_RESCUE_BUDGET_MS) continue;
        rescued = true;
        rescuedAtBudget = true;
        break;
      }
      if (hold && hold.phase === "armed") {
        hold.held += step.value.text;
        const first = hold.held.trimStart()[0];
        if (first === undefined) {
          const now = holdClock();
          if (hold.since === 0) hold.since = now;
          if (now - hold.since <= SEARCH_ASSIST_HOLD_LIMIT_MS) continue;
          hold.phase = "off";
        } else if (first === "{") {
          // An envelope: the gate's own envelope hold keeps it unreleased; it is a
          // rescue only if it ends as text with no call.
          hold.phase = "envelope";
        } else if (first === "<") {
          // A tag, which may be a think block: left to the normal path.
          hold.phase = "off";
        } else {
          // Plain text: keep holding (no gate push, no scan) until a call, the end, or the budget.
          hold.phase = "text";
          hold.since = holdClock();
          continue;
        }
        feed(hold.held);
        hold.held = "";
        continue;
      }
      feed(step.value.text);
    }
    if (rescued) {
      try {
        roundAbort?.abort();
      } catch {
        // an abort never fails the turn
      }
      void started.pieces.return(undefined).catch(() => undefined);
    }
  } catch (err) {
    // GENFAIL-01: the same gap as the pre-stream branch above, mid-
    // stream - llm.ts's own tokens() generator already wraps whatever
    // broke into a real Error ("chat model unavailable: <cause>"),
    // spec-v0.1.29's client.ts carrying the engine's status and
    // response body inside that cause for a rejected request; this is
    // the one place that used to throw the message away.
    const message = boundedGenerationError(err instanceof Error ? err.message : String(err));
    console.error(`[model] generation "${reason}" failed mid-stream: ${message ?? "(no message)"}`);
    // CHAT-CALM-ERRORS-01b: an engine that died mid-reply carries the
    // engine and model that were answering (llm.ts's StackStreamError).
    const failedAtMs = Date.now();
    const facts = err instanceof StackStreamError ? err.facts : null;
    state.generations.push({ reason, thinking, maxTokens, requestSentMs: requestSentMs - state.startedAt, firstDeltaMs, prefix, stats: started.stats, error: message, offlineReason: facts?.offline_reason ?? null, facts, failureKind: generationFailureKind(facts, message), failedMs: failedAtMs - state.startedAt, failedAt: new Date(failedAtMs).toISOString() });
    return { ok: false, code: "generation_failed", message, released: (!holdAll && raw.length - (hold?.held.length ?? 0) > 0) || (state.reasoning.emit && nativeReasoning.length > 0) };
  }

  if (!rescued && gate && thinkSplit) {
    // The round ended: whatever is still held goes to the gate unless it is a rescue (below).
    if (hold && hold.held && !(hold.phase === "text" && !toolCalls?.length)) feed(hold.held);
    for (const span of flushThinkSplit(thinkSplit)) if (!span.reasoning) gate.push(span.text);
  }
  gate?.endReasoning();

  if (rescued) {
    state.generations.push({ reason, thinking, maxTokens, requestSentMs: requestSentMs - state.startedAt, firstDeltaMs, prefix, stats: started.stats, toolCallRawArgs: null, envelopeParsed: false });
    return { ok: true, text: "", reasoning: nativeReasoning || undefined, toolCalls: undefined, thinking, hold: "rescue", ...(rescuedAtBudget ? { holdAtBudget: true } : {}) };
  }

  const visible = visibleText(raw);
  // ENGINE-CONTRACT-03 (dev.md "U6 rerun ruling" (a)): a generation the
  // wire carried no real tool call for might still have written one as
  // plain text (Qwen3's own <function_call> tag, unrecognized by
  // llama-server's parser, was the live miss). Checked here, before
  // this attempt's text/toolCalls ever leave this function, so the rest
  // of the model node treats it exactly like a real wire call - the
  // required/offered verification a few lines up in modelNode, the
  // builder-row fallback, all of it - rather than a second, parallel
  // envelope-only path.
  let envelopeParsed = false;
  // THIN-7C: a turn that offers no tool takes text that merely looks like a call as text.
  if ((!toolCalls || toolCalls.length === 0) && !noToolsTurn(state)) {
    const envelope = envelopeToolCall(visible);
    if (envelope) {
      toolCalls = [envelope];
      envelopeParsed = true;
    }
  }

  // A code review caught the first cut calling gate.finish() right here,
  // on THIS attempt's own outcome alone: modelNode's own retry (below,
  // "no visible text: one regeneration with thinking off") can follow an
  // attempt that had no tool calls AND no text either - finish() would
  // have already set the gate `done` before the retry's own real answer
  // ever ran, and StreamGate's own reset()/push() are no-ops once done,
  // silently discarding the retry's real text. The gate's fate is
  // modelNode's own call, made once, after every retry has settled - see
  // its own end.

  // ENGINE-CONTRACT-02 ("U6: the flip verdict" regression A): the raw
  // wire string for a websearch call this generation made, forced or
  // offered - kept on the record regardless of whether it turns out to
  // verify, since a parse failure or a literal "{}" is exactly what a
  // later read of the trace needs to tell apart from a real query.
  const websearchRawArgs = toolCalls?.find((c) => c.tool === "websearch")?.rawArgs ?? null;
  state.generations.push({ reason, thinking, maxTokens, requestSentMs: requestSentMs - state.startedAt, firstDeltaMs, prefix, stats: started.stats, toolCallRawArgs: websearchRawArgs, envelopeParsed });
  // ROUTER-BUILD-01e: how the hold ended. The model's own call always wins.
  let heldEnd: GenerationAttempt["hold"];
  if (hold) {
    if (toolCalls && toolCalls.length > 0) heldEnd = "tool_call";
    else if (hold.phase === "text" || (hold.phase === "envelope" && visible.trim().length > 0)) heldEnd = "rescue";
    else heldEnd = "text_kept";
  }
  const lengthEmpty = started.stats.stopReason === "length" && visible.trim().length === 0 && (!toolCalls || toolCalls.length === 0);
  return { ok: true, text: visible, reasoning: nativeReasoning || extractReasoningText(raw), toolCalls, thinking, ...(lengthEmpty ? { lengthEmpty } : {}), ...(heldEnd ? { hold: heldEnd } : {}), ...(holdAll ? { heldBack: true } : {}) };
}

/** ENGINE-CONTRACT-02's builder row, shared by every path that reaches
 * it: a required call the model missed (no call, an invalid one), and
 * now DEADLINE-01's own case (the generation never finished at all on
 * a forced turn) - the design's builder exists for exactly "the model
 * produced no query," and a deadline is one more way that happens.
 * `otherCalls` preserves a legitimate sibling call (weather, say) a
 * successful-but-incomplete generation made alongside a bad websearch
 * one; a failed generation has none to preserve. */
/** A review caught the first cut of DEADLINE-01's own use of this
 * helper marking a genuine generation failure (a deadline, a dead
 * engine - no generation record even pushed) `required_miss: true`,
 * the identical flag `interimRuleMeasure`/the replay bench already
 * read as "a successful generation whose cache state disagreed with
 * required" (contract.ts's own NodeOutcome doc). Folding a real
 * infrastructure failure into that count would corrupt the
 * measurement and silently drop the real failure code. `failureCode`,
 * passed only from DEADLINE-01's own call sites, keeps the outcome
 * honest (`{ ok: false, code }`, the same shape a failed node always
 * reports) while still returning the builder's `tool_calls` output -
 * the machine's own routing (`modelIsToolCalls`) reads `output.kind`
 * only, never `outcome.ok`, so the search still runs either way. */
/** The one definition of "the builder's own row": a websearch call built
 * straight from the utterance, never the model's own words - exported
 * so machine.ts's own `queryWriterFallback` state (a policy refusal of
 * the query-writer's own answer, QUERY-WRITER-01) builds the identical
 * shape rather than a second copy of this literal. */
export function rawUtteranceWebsearchCall(utterance: string): ToolCall {
  return { tool: "websearch", args: { expression: utterance }, id: "builder" };
}

/** CF-SEARCH-02 (owner-approved 2026-10-17, RULES.md rule 6): marks the one search retried with the person's own words. */
export const OWN_WORDS_CALL_ID = "own-words";

/** The search the person's own words make when the model's query was refused as ungrounded: filler stripped, nouns,
 * names and dates kept, capped. Null when nothing is left or the floor's `detectCsam` matches the query, so no retry runs. */
export function ownWordsSearchCall(utterance: string): ToolCall | null {
  const query = ownWordsQuery(utterance);
  if (!query || detectCsam(query).matched.length > 0) return null;
  return { tool: "websearch", args: { expression: query }, id: OWN_WORDS_CALL_ID };
}

function builderFallbackOutput(utterance: string, otherCalls: readonly ToolCall[], reasoning: string | undefined, failureCode?: string, failureMessage?: string): { outcome: NodeOutcome; output: ModelOutput } {
  const outcome: NodeOutcome = failureCode !== undefined ? { ok: false, code: failureCode, message: failureMessage } : { ok: true, required_miss: true };
  return { outcome, output: { kind: "tool_calls", calls: [...otherCalls, rawUtteranceWebsearchCall(utterance)], reasoning } };
}

// QUERY-WRITER-01 (dev.md "QUERY-WRITER-01", getmaipai-26's ruling,
// 2026-09-24): the live miss - "when did [pronoun]'s show end" after a
// turn naming a person - was the builder row above searching the
// UTTERANCE VERBATIM (a bare pronoun) whenever the model's own required
// call came back missing or invalid; 3 of 4 forced turns in the one
// real conversation that found it missed this way, not the 1-in-5
// ENGINE-CONTRACT-02 already measured for a plain miss. Grammar-
// constrained decoding (the prebuilt technique the ruling names, never
// a word rule or pronoun substitution in code) resolves it: one more
// generation, on the SAME messages this round already built (the
// window's own earlier turns are still in context, so the pronoun has
// something real to resolve against), constrained to `{"expression":
// string}` by the engine's own JSON-schema grammar - `response_format:
// {type:"json_schema", json_schema}`, the identical shape and field
// `memoryJudge.ts`'s own four call sites already prove against this
// same installed llama-server build (b10797): OpenAI's own
// `response_format.json_schema.schema` field, not a top-level
// `json_schema` or `--grammar`, which is a server-startup flag, not a
// per-request one. (oMLX is out of scope: the chat role runs on
// llama-server today, never oMLX - docs/plans/hardware-tiers-2026-09-23.md.)
const QUERY_WRITER_SCHEMA = {
  name: "query_writer",
  schema: {
    type: "object",
    properties: { expression: { type: "string" } },
    required: ["expression"],
  },
} as const;

const QUERY_WRITER_INSTRUCTION =
  "The search you were asked to run is missing or invalid. Write the web search query it should have been: a short phrase, with any pronoun (he, she, they, it, that) resolved to the specific person or thing it refers to from the conversation above. Respond with the query alone, as JSON.";

// The ruling's own number: a bare `{"expression": "..."}` object is
// shorter than a real tool call's own envelope (name, expression,
// category, read_page and the wrapper - FORCED_CALL_MAX_TOKENS's own
// 96), so this gets its own, smaller cap rather than reusing that one.
const QUERY_WRITER_MAX_TOKENS = 48;

type QueryWriterResult = { ok: true; expression: string | null } | { ok: false; code: string; message: string | undefined };

/** One grammar-constrained generation recovering a missing/invalid
 * required call's own query - `{ok:true, expression: null}` on a
 * benign non-answer (an empty/malformed response, a bare pronoun/empty
 * string a real query could never be, the caller's own signal to fall
 * back to `builderFallbackOutput()`'s raw-utterance row unchanged),
 * `{ok:false, code, message}` only on a genuine generation failure
 * (a code review, 2026-09-24: the first cut collapsed both into one
 * `null`, so a live engine outage during this call would have been
 * misreported as an ordinary required-call miss in the trace and the
 * replay bench - the exact conflation DEADLINE-01's own comment above
 * already names as a fixed, recurring bug class). Built on
 * `startCompleteStream` directly, never `runOneGeneration` (that
 * function's own `state.streamGate` handling is for a visible reply's
 * own streamed text; this call's result is never shown, so reusing it
 * would reset a stream gate this generation has nothing to do with) -
 * but the same signal-aware draining loop, so the same review's other
 * finding (the first cut called `complete()`, which takes no signal at
 * all, so a slow or wedged call ran past the model node's own deadline
 * uncancelled) is fixed the identical way every other generation in
 * this file already is. `thinking: false`/`max_tokens: 48` (the
 * ruling's own numbers): a short structured answer, not a reasoned
 * one, the same floor FORCED_CALL_MAX_TOKENS already sets for a real
 * forced call, since this is standing in for one. Never combined with
 * `tools`: a real prefix-cache cost, not reused the way PHRASE-01's own
 * mechanism reuses a byte-identical tools block (a code review,
 * 2026-09-24, caught an earlier comment overclaiming this) - accepted
 * here rather than chased, since `response_format` alongside `tools`
 * is untested combination this codebase has no other caller of, and
 * this whole call only ever runs on an already-rare required-call
 * miss to begin with. */
async function runQueryWriter(messages: LlmMessage[], nodeAbort: AbortSignal, modelId: string | undefined, deadlines: TurnState["budget"]["deadlines_ms"]): Promise<QueryWriterResult> {
  const watchdog = streamWatchdog(nodeAbort, deadlines.first_token_ms, deadlines.stall_ms);
  try {
    return await runWatchedQueryWriter(messages, watchdog.signal, watchdog.beat, modelId);
  } finally {
    watchdog.clear();
  }
}

async function runWatchedQueryWriter(messages: LlmMessage[], signal: AbortSignal, beat: () => void, modelId?: string): Promise<QueryWriterResult> {
  const started = await startCompleteStreamPieces(
    "chat",
    [...messages, { role: "user", content: QUERY_WRITER_INSTRUCTION }],
    { model: modelId, response_format: { type: "json_schema", json_schema: QUERY_WRITER_SCHEMA }, thinking: false, dropReasoning: true, max_tokens: QUERY_WRITER_MAX_TOKENS },
    signal,
  );
  if (!started.ok) return { ok: false, code: started.code, message: boundedGenerationError(started.error) };
  let text = "";
  try {
    for (;;) {
      const step = await started.pieces.next();
      if (step.done) break;
      beat();
      if (step.value.channel === "text") text += step.value.text;
    }
  } catch (err) {
    // GENFAIL-01's own code for this exact phase (an established stream
    // that dies mid-generation) - `runOneGeneration`'s identical catch
    // uses the same "generation_failed", never "unavailable" (reserved
    // for `!started.ok` above, a pre-stream/connect-time failure); a
    // re-review (2026-09-24) caught this call's own catch using the
    // wrong one, which would have misclassified a mid-generation outage
    // as a connect failure in the trace and the replay bench.
    return { ok: false, code: "generation_failed", message: boundedGenerationError(err instanceof Error ? err.message : String(err)) };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: true, expression: null };
  }
  if (typeof parsed !== "object" || parsed === null) return { ok: true, expression: null };
  const expression = (parsed as { expression?: unknown }).expression;
  return { ok: true, expression: typeof expression === "string" && expression.trim().length > 0 ? expression : null };
}

/** The requiredButMissing/offeredButInvalid exit's own recovery: try
 * the query-writer first (the SAME messages this round already built),
 * and only fall back to the raw utterance when it fails outright -
 * grounding's own refusal of an ungrounded query-writer answer (a bare
 * pronoun it couldn't resolve either) is handled one layer up, in
 * machine.ts's own `queryWriterFallback` state, never
 * re-implemented here. A genuine generation failure (`written.ok ===
 * false`) carries its own code/message into the builder row exactly
 * like every other generation failure in this file does - never
 * silently folded into an ordinary required_miss. */
async function recoveredMissingCall(state: TurnState, messages: LlmMessage[], utterance: string, otherCalls: readonly ToolCall[], reasoning: string | undefined, signal: AbortSignal): Promise<{ outcome: NodeOutcome; output: ModelOutput }> {
  const written = await runQueryWriter(messages, signal, state.modelId, state.budget.deadlines_ms);
  if (!written.ok) return builderFallbackOutput(utterance, otherCalls, reasoning, written.code, written.message);
  if (written.expression === null) return builderFallbackOutput(utterance, otherCalls, reasoning);
  const queryWriterCall: ToolCall = { tool: "websearch", args: { expression: written.expression }, id: "query-writer" };
  return { outcome: { ok: true, required_miss: true }, output: { kind: "tool_calls", calls: [...otherCalls, queryWriterCall], reasoning, queryWriterUsed: true } };
}

/** THIN-7C: a bare turn and a continuation never offer a tool. A turn in the
 * crisis state offers none either (the old path's SAFETY-01 rule; the policy
 * node's crisis_state refusal stays as the second lock). */
function noToolsTurn(state: TurnState): boolean {
  // THIN-3G: a turn answering from the core alone has no room for a tools block.
  return state.bare === true || state.continuation !== undefined || state.crisis === true || state.promptLimit !== undefined;
}

/** T5 / THIN-2G: the retry round's own floors around what the model chose: a
 * call to a tool the retry block does not offer (a write tool among them) or
 * byte-identical to a call that already failed is dropped, and when nothing is
 * left the round becomes the phrasing round. The model still decides what to
 * try (rule 1); no word rule picks the tool. */
export const modelNode: Node<ModelInput, ModelOutput> = async (state, input, signal) => {
  const result = await modelRound(state, input, signal);
  if (!input.retry || result.output.kind !== "tool_calls") return result;
  const offered = new Set(state.lastTools.map((t) => t.id));
  const calls = result.output.calls.filter((c) => offered.has(c.tool) && !isRepeatOfFailed(c, state.outcomes));
  if (calls.length === 0) return modelRound(state, { ...input, toolsAllowed: false, retry: false }, signal);
  return { ...result, output: { ...result.output, calls } };
};

const modelRound: Node<ModelInput, ModelOutput> = async (state, input, signal) => {
  // THIN-3G (rule 4, written chat only, set by the context node): the
  // prompt cannot fit, so the reply is the plain offer of a new chat that
  // carries the summary forward, or says the message is too big to read.
  // Never a spoken turn (the context node sets neither for one).
  if (state.promptLimit === "carry_offer" || state.promptLimit === "too_big") {
    state.streamGate?.reset();
    return { outcome: { ok: true }, output: { kind: "text", text: promptLimitLine(state.promptLimit, state.plan.age_band !== "adult"), thinking: false } };
  }
  // PHRASE-01 (dev.md "The written prompt on tier 1, decided"'s own
  // follow-up): a phrasing round is the model round that runs after at
  // least one tool round already completed this turn (`state.outcomes`
  // populated by `machine.ts`'s own `recordOutcomes`, before this node
  // ever sees them) AND no further tool round is still available
  // (`input.toolsAllowed`, machine.ts's own `roundsUsed < budget.rounds`
  // check, already computed there rather than re-derived here). A
  // review (2026-09-23) caught the first cut using `outcomes.length > 0`
  // alone: today's one catalog entry caps `budget.rounds` at 1, so that
  // was equivalent, but `TurnState.budget.rounds` is typed `0 | 1 | 2`
  // and a future `rounds: 2` entry would have misrouted the real second
  // tool-offering round into a `tool_choice: "none"` phrasing round,
  // silently forbidding the second search that round exists to allow.
  // `toolsAllowed` already carries the right answer.
  const isPhrasingRound = state.outcomes.length > 0 && !input.toolsAllowed;
  // STATUS-PHRASES-01: the "checking" moment - the tool round already
  // finished (state.outcomes is populated) and this round only phrases
  // the answer, never calls another tool. Same conversation-scoped
  // rotation as every other status line; `state.status` is undefined
  // for the immediate/bench callers, same guard nodes/tool.ts's own
  // emission already uses.
  if (isPhrasingRound) state.status?.emit({ type: "status", text: pickStatusPhrase(state.conversationId, "checking", state.persona), stage: "composing" });

  // THIN-7C: a bare turn and a continuation offer no tool, ever.
  const toolsAllowed = input.toolsAllowed && !noToolsTurn(state);
  let messages: LlmMessage[] = state.bare ? bareMessages(state.context, input.utterance) : contextToMessages(state.context, input.utterance, state.persona, state.plan, state.signal, state.planBasis.surfaceClass ?? "spoken", state.pictureParts ?? [], false, state.topicBlock, state.robotName);
  if (state.continuation) messages = [...messages, ...continuationMessages(state.continuation.assistantText)];
  let tools: ToolSpec[];
  let tool_choice: "auto" | "none" | undefined;
  // THIN-GROUND-01: the phrasing round's messages again with the evidence block
  // cut to half, for the one retry after the engine says the prompt did not fit.
  let withEvidenceLimit: ((maxChars: number) => LlmMessage[]) | null = null;

  if (isPhrasingRound) {
    // PHRASE-01's own continuation: the forced call's own messages,
    // byte for byte (state.messages, stored below on every non-phrasing
    // round - never a fresh contextToMessages() call, which discarded
    // the cached prefix and produced a fresh 45-to-52-token prompt that
    // never hit the prompt cache), then the assistant's own tool_calls
    // message and the tool result messages (composer.ts's own builders,
    // the identical shape the old path's composition call already
    // sends), then one user-role instruction: composer.ts's own
    // phrasingInstruction (never compositionInstruction, which is the
    // old path's own frozen text, pinned by its own tests), with the
    // plan line ahead of it on the spoken class only.
    //
    // TRUEUP-01 (docs/plans/chat-trueup-2026-09-23.md, the coordinator's
    // own ruling; a review's own follow-up moved the resolution itself
    // into surfaceClass.ts's promptSurfaceClassFor(), the one definition
    // contextToMessages() and this node both call now, not two copies
    // of the same ternary): a written adult turn drops the plan line
    // entirely (messages.ts's own rule: the plan line's "a question
    // about themselves" label re-injects exactly the reanchor-adjacent
    // content the written class already dropped); spoken keeps it.
    // phrasingInstruction() itself now carries the question's own
    // referent as its first sentence - its first cut didn't, so "answer
    // completely from what you know" bound to the nearest content the
    // model could talk about (the identity line, a few messages up),
    // producing a self-description instead of an answer.
    const surfaceClass = state.planBasis.surfaceClass ?? "spoken";
    const promptSurfaceClass: SurfaceClass = promptSurfaceClassFor(surfaceClass, state.plan.age_band);
    // SEARCH-MIXED-01: a round that mixed a failed call with a succeeded
    // one (a weather lookup that worked beside a search that didn't)
    // never hands the phrasing round the failed one to explain, work
    // around, or silently answer from its own training data instead -
    // the FULL pair (its own tool_calls announcement AND its own tool
    // result) is left out of this round's prompt entirely, never just
    // the result alone (an assistant message announcing a call the
    // prompt then has no matching tool response for is an invalid
    // transcript). THIN-1D (rule 6): the model is told only the failure KIND
    // (from the ORIGINAL unfiltered state.outcomes, by code and status, never
    // the error text) and writes the note itself; nothing is appended.
    //
    // THIN-1B/1D: the same goes for a lookup that succeeded with zero rows,
    // and when NO outcome survives (search down, an error, a timeout,
    // nothing found) the round is a plain answer from what the model knows
    // (lookupMissedInstruction). The model is never handed an empty or failed
    // result.
    const phrasedOutcomes = state.outcomes.filter((o) => !lookupMissed(o));
    const assistantMessage = toolCallAssistantMessage(phrasedOutcomes);
    // NAT-03: the listener's band and the turn's safety verdict gate which certainty bands the model sees.
    // NAT-05: the same subject asked again inside the window adds a typed `repeat` note beside the fact (echo.ts).
    const certaintyGate = {
      ageBand: state.planBasis.band,
      safetyFlagged: state.safety.flagged,
      hedging: state.persona.hedging,
      repeats: repeatNotes(phrasedOutcomes, { conversationId: state.conversationId, turnId: state.turnId, surfaceClass: surfaceClass === "spoken" ? "spoken" : "written", ageBand: state.planBasis.band, safetyFlagged: state.safety.flagged, nowMs: Date.now() }),
    };
    // THIN-4F: a spoken surface's answering round re-reads only the top rows' short text.
    const resultMessages = toolResultMessages(phrasedOutcomes, searchEvidenceMaxChars(state.budget.context_tokens), surfaceClass === "spoken", certaintyGate);
    // SEARCH-ROWS-01 (#169): `allSnippetsEmpty` rides the same reduce as
    // `searchResultCount` - a falsy `snippet` (missing or empty string,
    // the exact shape turn-dbyu1niupc actually stored) on EVERY counted
    // row means the phrasing round has nothing to summarize from but
    // titles, and needs telling so plainly rather than left to notice
    // on its own. Stays true (and irrelevant - guarded below) when no
    // websearch outcome ever contributes a row at all.
    const searchRows = phrasedOutcomes.reduce(
      (acc, outcome) => {
        if (outcome.status !== "succeeded" || outcome.packageId !== "websearch") return acc;
        const rows = (outcome.result?.data as { rows?: { snippet?: unknown }[] } | undefined)?.rows;
        if (!Array.isArray(rows)) return acc;
        return { count: acc.count + rows.length, allEmpty: acc.allEmpty && rows.every((row) => !row?.snippet) };
      },
      { count: 0, allEmpty: true },
    );
    const searchResultCount = searchRows.count;
    const replayedSearchCount = state.messages.reduce((count, message) => count + (message.role === "tool" && message.tool_call_id ? 1 : 0), 0);
    // ANSWER-IMG-05b: a round whose only call showed pictures has no results to
    // phrase; its answering round gets the short instruction.
    const picturesOnly = phrasedOutcomes.length > 0 && phrasedOutcomes.every((o) => o.packageId === SHOW_IMAGES_TOOL_ID);
    const phrasing = picturesOnly
      ? picturesOnlyInstruction(promptSurfaceClass, input.utterance, replayedSearchCount)
      : phrasingInstruction(promptSurfaceClass, input.utterance, searchResultCount, searchResultCount > 0 && searchRows.allEmpty, replayedSearchCount);
    // SEARCH-ANSWER-01: when the one retry round produced results, the retry's
    // own instruction and the first round's misses are history, not news.
    const recovered = phrasedOutcomes.length > 0 ? recoveredRetry(state.messages) : null;
    const missedKinds = state.outcomes.slice(recovered?.outcomesBefore ?? 0).filter(lookupMissed).map(lookupFailureKind);
    const answering =
      phrasedOutcomes.length === 0
        ? lookupMissedInstruction(promptSurfaceClass, input.utterance, missedKinds)
        : missedKinds.length > 0
          ? `${phrasing}${lookupMissedClause(missedKinds)}`
          : phrasing;
    const instruction: LlmMessage = { role: "user", content: promptSurfaceClass === "written" ? answering : `${planLineForTurnMachine(state.plan, state.signal, promptSurfaceClass)} ${answering}` };
    const history = recovered?.history ?? state.messages;
    messages = phrasedOutcomes.length === 0 ? [...history, instruction] : [...history, assistantMessage, ...resultMessages, instruction];
    if (phrasedOutcomes.length > 0 && searchResultCount > 0) {
      const baseEvidenceChars = searchEvidenceMaxChars(state.budget.context_tokens);
      withEvidenceLimit = (maxChars) => {
        const resultMessages = maxChars > 0
          ? toolResultMessages(phrasedOutcomes, maxChars, surfaceClass === "spoken", certaintyGate)
          : phrasedOutcomes.flatMap((outcome) => outcome.status === "succeeded" && outcome.packageId === "websearch"
            ? [{ role: "tool" as const, tool_call_id: outcome.callId, content: JSON.stringify({ status: "succeeded", package: "websearch", instruction: "The search results could not be read because they did not fit in the available context. Do not claim to have read them." }) }]
            : toolResultMessages([outcome], undefined, false, certaintyGate));
        const retryInstruction = maxChars === 0
          ? { ...instruction, content: `${instruction.content} The search results could not be read because they did not fit in the available context. Say that in your own words, and do not claim facts from those results.` }
          : instruction;
        return [...history, assistantMessage, ...resultMessages, retryInstruction];
      };
    }
    // The same tools block the forced/offered round itself sent -
    // reused verbatim (see contract.ts's own `lastTools` doc comment:
    // the Qwen3 template renders the tools block into the prompt's own
    // stable prefix, so anything but a byte-identical array re-renders
    // it and costs the cache hit this item exists to restore).
    tools = state.lastTools;
    tool_choice = "none";
  } else if (input.retry) {
    // T5 / THIN-2G: the failed round's own messages byte for byte, then one
    // instruction (the plan line ahead of it on the spoken class, as the
    // phrasing round does); the failed call and its error are not replayed, only
    // the tool id and the kind are named.
    const promptSurfaceClass: SurfaceClass = promptSurfaceClassFor(state.planBasis.surfaceClass ?? "spoken", state.plan.age_band);
    const failures = state.outcomes.filter(lookupMissed).map((o) => ({ tool: o.packageId, kind: lookupFailureKind(o) }));
    const retrying = retryInstruction(promptSurfaceClass, input.utterance, failures);
    messages = [...state.messages, markRetryMessage({ role: "user", content: promptSurfaceClass === "written" ? retrying : `${planLineForTurnMachine(state.plan, state.signal, promptSurfaceClass)} ${retrying}` }, state.outcomes.length)];
    tools = retryTools(state.lastTools, state.temporary);
    tool_choice = "auto";
  } else if (!toolsAllowed) {
    tools = [];
    tool_choice = undefined;
  } else {
    tools = state.budget.tools_offered
      .slice()
      .sort()
      .map((id) => toolSpecFor(id, laneOfPerson(state.actor)))
      .filter((t): t is ToolSpec => t !== null);
    tool_choice = "auto";
  }

  state.messages = messages;
  if (!isPhrasingRound) state.lastTools = tools;

  // STREAM-NEXT-01 (b): the gate settles at exactly one of this
  // function's own exit points, decided by THAT exit's own final
  // outcome, never by an intermediate attempt a retry might still
  // replace (a code review's own finding: finish()ing on an empty first
  // attempt locked the gate before its own retry's real text could ever
  // reach it).
  const gate = state.streamGate;

  // GROUND-01: `context`'s own decideReasoning() already decided
  // `reasoning.withheld_for === "minor"` from the age band, reused here
  // rather than a second age check - a minor's turn sends `thinking:
  // false` to the engine by default (budget.thinking_for_minors), a
  // cost control since the reasoning span would be consumed and
  // dropped below regardless (see `reasoning` a few lines down).
  const minorThinkingOff = state.reasoning.withheld_for === "minor" && !state.budget.thinking_for_minors;
  // THIN-5A: a turn that shows no reasoning never asks the engine to think
  // (llm.ts forces it off with dropReasoning), so the reply ceiling, the
  // record and the empty-reply retry all see the effective flag.
  const thinkingOn = state.budget.thinking_budget_tokens > 0 && !minorThinkingOff && state.reasoning.emit;
  const maxTokens = replyMaxTokensFor(state, thinkingOn);
  // Hold a plain media request until its tool call is known; also hold the follow-up after a successful music start,
  // even when the person's wording did not plainly name a song.
  const mediaOffered = tools.some((t) => t.id === "generate_image" || t.id === "generate_video" || t.id === "generate_music" || t.id === "edit_music");
  const successfulMusicStart = musicForOutcomes(state.outcomes) !== null;
  const holdMedia = !input.retry && !noToolsTurn(state) && (successfulMusicStart || (!isPhrasingRound && asksForMedia(input.utterance)));
  let attempt = await runOneGeneration(state, messages, tools, tool_choice, thinkingOn, maxTokens, isPhrasingRound ? "phrasing" : input.retry ? "tool_retry" : "model", signal, holdMedia ? "media" : !isPhrasingRound && !input.retry && toolsAllowed && (searchAssistMayHold(state, tools) || weatherAssistMayHold(state, tools)));
  // THIN-GROUND-01: llama-server reports the rendered prompt size in its
  // 400 body. Use that measurement to choose the first evidence cut, then
  // keep cutting until the request fits or the prompt carries no search
  // evidence and explicitly tells the model to say it could not read it.
  if (!attempt.ok && withEvidenceLimit && !signal.aborted && classifyGenerationFailure(attempt.message).kind === "context_too_large") {
    const limits = evidenceRetryLimits(searchEvidenceMaxChars(state.budget.context_tokens), attempt.message);
    for (const maxChars of limits) {
      if (signal.aborted) break;
      console.error(`[model] the engine refused the prompt as too large (${attempt.message ?? attempt.code}); retrying with ${maxChars} search-evidence characters`);
      messages = withEvidenceLimit(maxChars);
      state.messages = messages;
      attempt = await runOneGeneration(state, messages, tools, tool_choice, thinkingOn, maxTokens, "phrasing", signal);
      if (attempt.ok || classifyGenerationFailure(attempt.message).kind !== "context_too_large") break;
    }
  }
  // VISION-02c (rule 6): a picture the engine would not take (refused,
  // too large, the projector failing) never fails the answer. The turn
  // runs once more with the pictures left out and the model told only that
  // they could not be read and the kind of failure; the first attempt's
  // raw error stays on the turn's generation record for an admin.
  // Never once text reached the person (STREAM-PARTIAL-01: no retry
  // after a release), so a reply is never replaced under them.
  if (!attempt.ok && pictureRetryAllowed(attempt, signal.aborted, messages)) {
    const kind = classifyGenerationFailure(attempt.message).kind;
    console.error(`[model] the engine did not take this turn's pictures (${attempt.message ?? attempt.code}); answering without them`);
    messages = withoutPictures(messages, state.images ?? [], kind);
    // A later round of this turn (a tool round) never sends them again (a review).
    state.pictureParts = undefined;
    state.messages = messages;
    attempt = await runOneGeneration(state, messages, tools, tool_choice, thinkingOn, maxTokens, isPhrasingRound ? "phrasing" : "model", signal);
  }
  // DEADLINE-01: a generation that never finished (the model node's own
  // deadline, a dead engine) gets a real, fixed model_failed line, never
  // the empty string this used to deliver silently through `answer` as if
  // the model had genuinely said nothing.
  // TURN-TTL-01 (rule 6): an adult's written turn whose engine was lost before any text reached the person
  // waits up to ENGINE_HEAL_WAIT_MS for the engine to come back, then runs the generation once more; the
  // person sees the ordinary thinking line meanwhile, never a "cancelled".
  if (engineHealRetryAllowed(attempt, signal.aborted, replyIsUncapped(state)) && connectionLost(attempt)) {
    console.error(`[model] the engine was lost before the first token; waiting for it, then retrying once`);
    if (await waitForEngineHeal(signal, ENGINE_HEAL_WAIT_MS, ENGINE_HEAL_POLL_MS)) {
      attempt = await runOneGeneration(state, messages, tools, tool_choice, thinkingOn, maxTokens, isPhrasingRound ? "phrasing" : "model", signal);
    }
  }
  // (a retry may have succeeded; the narrowing below re-reads `attempt`)
  if (!attempt.ok) {
    settleFailedGate(gate, state, attempt.message, signal.aborted && !isDeadlineAbort(signal));
    if (await engineLost(attempt)) {
      state.engineUnavailable = true;
      return { outcome: { ok: false, code: "engine_unavailable", message: "MaiPai's AI isn't running right now." }, output: { kind: "model_failed" } };
    }
    return { outcome: { ok: false, code: attempt.code, message: attempt.message }, output: failedOutput(attempt) };
  }
  if (messagesCarryPictures(messages)) state.images = markPicturesShown(state.images, messages);

  // ENVELOPE-NONE-01 (a code review, 2026-09-23): `tool_choice: "none"`
  // stops the engine's own grammar from emitting a native tool call,
  // but `runOneGeneration`'s own `envelopeToolCall()` check also
  // recognizes a tool call the model wrote as plain text - the
  // model's own choice, not the engine's grammar, and "none" doesn't
  // forbid it. The phrasing round is this turn's committed final
  // round (its own prompt already carries the tool result
  // `composer.ts` built); a stray tool call here is discarded before
  // it can count as "visible" below or be fed back into policy/tool
  // as an unplanned second round. Discarding it can leave a phrasing
  // attempt with no text at all (the model spent its whole generation
  // writing the call instead of an answer) - `phrasingToolCallDiscarded`
  // carries that into the retry condition below, since a plain empty
  // reply is genuinely new here, never possible before this round
  // could be handed a tool call to discard.
  let phrasingToolCallDiscarded = false;
  if (isPhrasingRound && attempt.toolCalls && attempt.toolCalls.length > 0) {
    attempt = { ...attempt, toolCalls: undefined };
    phrasingToolCallDiscarded = true;
  }

  // ROUTER-BUILD-01e: an armed round ended; record it on the turn's stats.
  // RECENCY-02: a weather question the detector is sure of is rescued with the weather tool, ahead of a search.
  if (attempt.hold === "rescue") return weatherAssistMayHold(state, state.lastTools) ? rescueWeather(state, messages, state.reasoning.emit ? attempt.reasoning : undefined, signal, attempt.holdAtBudget === true) : rescueSearch(state, messages, input.utterance, state.reasoning.emit ? attempt.reasoning : undefined, signal, attempt.holdAtBudget === true);
  if (attempt.hold === "tool_call" || attempt.hold === "text_kept") {
    const action = attempt.hold === "tool_call" ? "declined_tool_call" as const : "declined_text_kept" as const;
    if (state.searchAssist) state.searchAssist = { ...state.searchAssist, action };
    if (state.weatherAssist?.mode === "rescue" && state.weatherAssist.bucket === "over") state.weatherAssist = { ...state.weatherAssist, action };
  }

  // State table, `model`'s own exits: "no visible text: one
  // regeneration with thinking off, then answer." A tool call always
  // counts as "visible" (it is the turn's real output); only a call
  // that came back with neither text nor a tool call retries. Forced
  // calls never reach here with thinkingOn true (forced above), so
  // this retry is only ever an ordinary/offered call's own - except a
  // phrasing round whose only "call" was just discarded above, which
  // retries even with thinking already off (ENVELOPE-NONE-01): the
  // first attempt produced no usable text at all, so the retry is the
  // one recourse left before this round ships an empty reply.
  // SEARCH-DOWN-EMPTY-01: a round that follows a missed lookup (the retry round, the phrasing round)
  // with no visible text gets the same one regeneration even when thinking was already off, so the
  // person hears the model's own words before any fixed line stands in for them.
  const afterMissedLookup = isPhrasingRound || input.retry === true;
  if ((!attempt.toolCalls || attempt.toolCalls.length === 0) && attempt.text.trim().length === 0) {
    // Rule 6: an empty reply (seen live on a plain written turn with thinking already off) is retried once, never shown as-is.
    // VOICE-REPLY-01: a first attempt that hit its ceiling with nothing visible is
    // remembered for this model, and its retry gets more room than the ceiling that failed.
    if (attempt.lengthEmpty) rememberCeilingSpentInvisibly(state.modelId ?? state.engineModelId);
    attempt = await runOneGeneration(state, messages, tools, tool_choice, false, replyMaxTokensFor(state, false) + (attempt.lengthEmpty ? EMPTY_LENGTH_RETRY_EXTRA_TOKENS : 0), "model_retry_no_thinking", signal, holdMedia ? "media" : false);
    if (!attempt.ok) {
      settleFailedGate(gate, state, attempt.message, signal.aborted && !isDeadlineAbort(signal));
      const failureMessage = attempt.message ?? "";
      if ((await roleHealth("chat")).availability === "unavailable" || failureMessage.includes("could not reach") || failureMessage.includes("connection refused") || failureMessage.includes("ForeignPortHolderError")) {
        state.engineUnavailable = true;
        return { outcome: { ok: false, code: "engine_unavailable", message: "MaiPai's AI isn't running right now." }, output: { kind: "model_failed" } };
      }
      return { outcome: { ok: false, code: attempt.code, message: attempt.message }, output: failedOutput(attempt) };
    }
    if (isPhrasingRound && attempt.toolCalls && attempt.toolCalls.length > 0) attempt = { ...attempt, toolCalls: undefined };
  }

  // A held media reply without a tool call gets ONE guarded re-ask when it claims a result. After a successful music
  // start, the person gets only the started line, however the model phrases its follow-up.
  if (attempt.heldBack && (!attempt.toolCalls || attempt.toolCalls.length === 0)) {
    if (musicForOutcomes(state.outcomes)) {
      attempt = { ...attempt, text: MUSIC_STARTED_LINE };
    } else if (claimsMedia(attempt.text)) {
      let second: GenerationResult | undefined;
      if (mediaOffered && !signal.aborted) {
        console.error("[model] the reply claimed a picture, video or song with no tool call; asking once more");
        second = await runOneGeneration(state, [...messages, { role: "assistant", content: attempt.text }, { role: "user", content: MEDIA_REASK_INSTRUCTION }], tools, "auto", false, replyMaxTokensFor(state, false), "media_reask", signal, "media");
      }
      if (second?.ok && (second.toolCalls?.length ?? 0) > 0) attempt = second;
      else if (second?.ok && !claimsMedia(second.text) && second.text.trim().length > 0) attempt = second;
      else attempt = { ...attempt, text: mediaOffered ? MEDIA_NOT_STARTED_LINE : PICTURE_NOT_HERE_LINE };
    } else if (tools.some((t) => t.id === "generate_music") && asksForSong(input.utterance) && lyricsInsteadOfSong(attempt.text)) {
      // A song was asked for and the model wrote the lyrics as text: one re-ask to call the tool with them; if it still does not,
      // the lyrics stand as written with a line on how to start the music (no claim was made, so nothing is replaced).
      let second: GenerationResult | undefined;
      if (!signal.aborted) {
        console.error("[model] a song was asked for and the reply is lyrics with no tool call; asking once more");
        second = await runOneGeneration(state, [...messages, { role: "assistant", content: attempt.text }, { role: "user", content: SONG_LYRICS_REASK_INSTRUCTION }], tools, "auto", false, replyMaxTokensFor(state, false), "media_reask", signal, "media");
      }
      if (second?.ok && (second.toolCalls?.length ?? 0) > 0) attempt = second;
      else attempt = { ...attempt, text: `${attempt.text.trimEnd()}\n\n${SONG_LYRICS_ONLY_NOTE}` };
    }
  }

  // "Reasoning is a second output" (the owner's ruling): `context`
  // already decided whether this turn may emit one at all;
  // `state.reasoning.emit === false` means "the model node consumes
  // the spans and emits nothing" - so a withheld turn's reasoning
  // never even reaches ModelOutput, let alone the trace or the wire.
  const reasoning = state.reasoning.emit ? attempt.reasoning : undefined;

  // ENGINE-CONTRACT-02 (dev.md 2026-09-23, "U6: the flip verdict"): the
  // model node verifies a websearch call carries a non-empty string
  // expression, offered - never only "did a tool_choice
  // required call come back with a call at all." Regression A found
  // llama-server b10797 half-committing on an OFFERED call too: a
  // parse-failed or empty arguments string, toolCallFromWire's own
  // args: undefined, normalized to {} by policy.ts, grounds vacuously
  // (nothing in an empty object to refuse), then fails tool.ts's own
  // schema validation and feeds a knowledge answer back on the next
  // round - the same near-tie as ENGINE-CONTRACT-01, one level down.
  // A miss here - no websearch call at all when one was required, or a
  // websearch call with no valid expression either way - never runs,
  // is never fed back as a failed outcome, and takes the state
  // record's own builder row instead (the engine builds the query, not
  // the model), never a second call with cache_prompt: false (a second
  // full prefill, and A3 shows partial cache reuse misses the same way
  // A2's full hit does).
  const websearchCall = attempt.toolCalls?.find((c) => c.tool === "websearch");
  const websearchExpression = websearchCall && typeof websearchCall.args === "object" && websearchCall.args !== null && "expression" in websearchCall.args ? (websearchCall.args as { expression: unknown }).expression : undefined;
  // CONFIRM-01: a non-empty expression that is nothing but a bare
  // pronoun ("he", "it") is exactly as unusable as an empty one - the
  // model chose to call the tool but had nothing real to put in it.
  // Before this, that case passed this check trivially (a non-empty
  // string), so policy.ts's own checkGrounding() refused it downstream
  // via the identical isBarePronoun() test, with reason
  // "ungrounded_args" - a branch that parks no ask (only
  // consent_needed/confirm_needed do), so a follow-up "yes" had nothing
  // to resume and the search never ran. Folding it into
  // offeredButInvalid instead sends it through the SAME recovery
  // requiredButMissing already has (recoveredMissingCall(), the query-
  // writer's one grammar-constrained retry against the window) rather
  // than inventing a second, parked-ask path for a case the household
  // never needs to confirm anything about.
  const websearchValid = typeof websearchExpression === "string" && websearchExpression.trim().length > 0 && !isBarePronoun(websearchExpression);
  const offeredButInvalid = websearchCall !== undefined && !websearchValid;
  if (offeredButInvalid) {
    // A review caught the first cut here discarding every tool call the
    // model made, not only the bad websearch one - policy.ts runs every
    // proposal in `input.calls` (nodes/policy.ts's own `for` loop), so a
    // reply that legitimately called another tool (weather, say)
    // alongside an invalid websearch call would have silently lost that
    // other call too. Only the websearch call is replaced; every other
    // call the model made this round still runs.
    gate?.reset();
    const otherCalls = (attempt.toolCalls ?? []).filter((c) => c.tool !== "websearch");
    return recoveredMissingCall(state, messages, input.utterance, otherCalls, reasoning, signal);
  }

  if (attempt.toolCalls && attempt.toolCalls.length > 0) {
    gate?.reset();
    // SEARCH-ANSWER-06: a draft written beside the calls is kept on the output (and flagged in
    // stats), so a turn whose every call policy refuses can still answer with it.
    const draft = attempt.text.trim().length > 0 ? attempt.text : undefined;
    return { outcome: draft ? { ok: true, draft_discarded: true } : { ok: true }, output: { kind: "tool_calls", calls: attempt.toolCalls, reasoning, ...(draft ? { draft } : {}) } };
  }

  // The one exit that ever ships real, streamable text - settle the
  // gate here, once, on the FINAL attempt (post-retry) alone.
  //
  // THIN-7E (ASK-01): a plain model reply (no tool ran this turn) may end with the question
  // about an unknown name, or the judge's next open question. It is pushed through the same
  // gate as the reply, so the person hears nothing the gate did not check; the ask is stored
  // by logResult() only if the delivered text carries it. Never for a bare turn, a
  // continuation or a widget's fixed question (no subjects were resolved for those).
  const ask =
    state.subjects !== undefined && !isPhrasingRound && state.outcomes.length === 0 && !state.bare && !state.ephemeral && !state.continuation && !state.crisis
      ? askAppendFor({ actor: state.actor, conversationId: state.conversationId, turnId: state.turnId, replyText: attempt.text, utterance: input.utterance, subjects: state.subjects, unknownAsk: state.unknownAsk ?? null, recentUserTexts: state.context.filter((c) => c.source === "window" && c.id.startsWith("window-user")).map((c) => c.text), temporary: state.temporary })
      : NO_ASK_APPEND;
  state.askCommit = ask.commit;
  if (attempt.heldBack && attempt.text) gate?.push(attempt.text);
  if (ask.append) gate?.push(ask.append);
  gate?.finish();
  return { outcome: { ok: true }, output: { kind: "text", text: attempt.text + ask.append, thinking: attempt.thinking, reasoning } };
};

/** ROUTER-BUILD-01e: whether this round may hold for a rescue. Everything the
 * 01c eligibility decides (adult band, written, not spoken, not anonymous,
 * websearch offered, round 1), plus the shadow step's own over-threshold
 * result in rescue mode. Fails closed: any throw means no hold. */
export function searchAssistMayHold(state: TurnState, tools: readonly ToolSpec[]): boolean {
  try {
    // MINOR-SEARCH-01i: a child or teen never reaches the rescue branch (checked here, before the shadow record is read).
    const minor = turnAgeBand(state.surface, state.actor, state.speakerEvidence, new Date(), state.deviceId) !== "adult";
    if (minor && !MINOR_RESCUE_ENABLED) return false;
    const sa = state.searchAssist;
    if (!sa || sa.mode !== "rescue" || sa.bucket !== "over" || !sa.eligible) return false;
    if (!tools.some((t) => t.id === "websearch")) return false;
    // MINOR-SEARCH-01k: behind the constant above, a minor's hold re-checks what the shadow step
    // checked (gate dry run and web on for the band, fresh now) and takes the recall vector flag from the
    // record (a score exists only when a vector was embedded). Unreachable while false.
    const ctx = minor ? { modelToolCalls: 0, minor: { ...minorSearchGate(state, state.temporary === true), recallVector: sa.p_rounded !== null } } : { modelToolCalls: 0 };
    return searchAssistEligibility(state, "rescue", ctx).rescuable;
  } catch {
    return false;
  }
}

/** ROUTER-BUILD-01e: round 1 answered in plain text on a turn the assist is
 * sure needs a search and nothing reached the person: the engine's query
 * writer writes the query and the call goes to the policy node like any call. */
async function rescueSearch(state: TurnState, messages: LlmMessage[], utterance: string, reasoning: string | undefined, signal: AbortSignal, atBudget = false): Promise<{ outcome: NodeOutcome; output: ModelOutput }> {
  state.streamGate?.reset();
  const recovered = await recoveredMissingCall(state, messages, utterance, [], reasoning, signal);
  // A failed or empty query writer is not a rescue: its outcome passes through unchanged.
  if (recovered.output.kind !== "tool_calls" || !recovered.output.queryWriterUsed) return recovered;
  try {
    bumpSearchAssistCounter("rescued");
    if (atBudget) bumpSearchAssistCounter("rescued_at_budget");
  } catch {
    // counters never fail a turn
  }
  if (state.searchAssist) state.searchAssist = { ...state.searchAssist, action: "rescued" };
  return { outcome: signal.aborted ? recovered.outcome : { ok: true }, output: { ...recovered.output, searchAssistRescued: true } };
}

/** RECENCY-02: whether this round may hold for a weather rescue. The detector's record is over its threshold in rescue
 * mode, the weather tool is offered, a household home is set and nothing has been called yet. No band or surface
 * condition (weatherAssist.ts says why). Fails closed. */
export function weatherAssistMayHold(state: TurnState, tools: readonly ToolSpec[]): boolean {
  try {
    const wa = state.weatherAssist;
    if (!wa || wa.mode !== "rescue" || wa.bucket !== "over" || !wa.eligible) return false;
    if (!tools.some((t) => t.id === WEATHER_TOOL)) return false;
    return weatherAssistEligibility(state, "rescue", { modelToolCalls: 0 }).rescuable;
  } catch {
    return false;
  }
}

const PLACE_WRITER_SCHEMA = {
  name: "place_writer",
  schema: { type: "object", properties: { place: { type: ["string", "null"] } }, required: ["place"] },
} as const;
const PLACE_WRITER_INSTRUCTION = "The person asked about the weather. If their message names a place, give that place exactly as they wrote it; if it names none, give null. Never guess or add a place they did not write.";
const PLACE_WRITER_MAX_TOKENS = 32;

/** One grammar-constrained generation reading the place a weather question names (null: none, so the tool uses the
 * household home). A failed or malformed answer is no place named. */
async function runPlaceWriter(messages: LlmMessage[], nodeAbort: AbortSignal, modelId: string | undefined, deadlines: TurnState["budget"]["deadlines_ms"]): Promise<{ ok: true; place: string | null } | { ok: false; code: string; message: string | undefined }> {
  const watchdog = streamWatchdog(nodeAbort, deadlines.first_token_ms, deadlines.stall_ms);
  try {
    const started = await startCompleteStreamPieces(
      "chat",
      [...messages, { role: "user", content: PLACE_WRITER_INSTRUCTION }],
      { model: modelId, response_format: { type: "json_schema", json_schema: PLACE_WRITER_SCHEMA }, thinking: false, dropReasoning: true, max_tokens: PLACE_WRITER_MAX_TOKENS },
      watchdog.signal,
    );
    if (!started.ok) return { ok: false, code: started.code, message: boundedGenerationError(started.error) };
    let text = "";
    try {
      for (;;) {
        const step = await started.pieces.next();
        if (step.done) break;
        watchdog.beat();
        if (step.value.channel === "text") text += step.value.text;
      }
    } catch (err) {
      return { ok: false, code: "generation_failed", message: boundedGenerationError(err instanceof Error ? err.message : String(err)) };
    }
    try {
      const place = (JSON.parse(text) as { place?: unknown }).place;
      return { ok: true, place: typeof place === "string" && place.trim().length > 0 ? place.trim() : null };
    } catch {
      return { ok: true, place: null };
    }
  } finally {
    watchdog.clear();
  }
}

/** RECENCY-02: round 1 answered in plain text on a turn the weather detector is sure is a weather question and nothing
 * reached the person: the place writer reads the place (if any), the weather tool is called, the model phrases the result. */
async function rescueWeather(state: TurnState, messages: LlmMessage[], reasoning: string | undefined, signal: AbortSignal, atBudget = false): Promise<{ outcome: NodeOutcome; output: ModelOutput }> {
  state.streamGate?.reset();
  const written = await runPlaceWriter(messages, signal, state.modelId, state.budget.deadlines_ms);
  // A failed writer still rescues: the place is then unknown, which is the household home.
  const place = written.ok ? written.place : null;
  const call: ToolCall = { tool: WEATHER_TOOL, args: place ? { place } : {}, id: "weather-assist" };
  try {
    bumpSearchAssistCounter("weather_rescued", turnAgeBand(state.surface, state.actor, state.speakerEvidence, new Date(), state.deviceId));
    if (atBudget) bumpSearchAssistCounter("weather_rescued_at_budget");
  } catch {
    // counters never fail a turn
  }
  if (state.weatherAssist) state.weatherAssist = { ...state.weatherAssist, action: "rescued" };
  return { outcome: { ok: true }, output: { kind: "tool_calls", calls: [call], reasoning } };
}

/** VISION-02c: whether a failure may be the picture's: not an engine
 * that is down, stopped, out of memory or busy (the same request without
 * the picture would fail the same way). */
export function pictureMayHaveFailed(kind: string): boolean {
  return kind === "other" || kind === "context_too_large" || kind === "slow";
}

/** TURN-TTL-01: how long an adult's written turn waits for a lost engine to come back, and how often it looks. */
export const ENGINE_HEAL_WAIT_MS = 60_000;
export const ENGINE_HEAL_POLL_MS = 2_000;

/** TURN-TTL-01: the engine, not the request, is why a generation failed. */
export async function engineLost(attempt: { ok: boolean; message?: string }): Promise<boolean> {
  if (attempt.ok) return false;
  return connectionLost(attempt) || (await roleHealth("chat")).availability === "unavailable";
}

/** TURN-TTL-01: the failure text says the connection to the engine dropped (not a refusal for memory or a bad request).
 * Only this kind is waited out and retried; a role that is unavailable for another reason keeps its fixed line at once. */
export function connectionLost(attempt: { ok: boolean; message?: string }): boolean {
  const message = attempt.message ?? "";
  return !attempt.ok && (message.includes("could not reach") || message.includes("connection refused") || message.includes("ForeignPortHolderError"));
}

/** TURN-TTL-01: one heal retry, only for an uncapped (adult written) reply, with nothing yet shown and the turn not stopped. */
export function engineHealRetryAllowed(attempt: { ok: boolean; released?: boolean }, aborted: boolean, uncapped: boolean): boolean {
  return !attempt.ok && !attempt.released && !aborted && uncapped;
}

/** TURN-TTL-01: polls the chat role until it is no longer unavailable; false when the wait ran out or the turn was stopped. */
export async function waitForEngineHeal(signal: AbortSignal, maxMs: number, pollMs: number): Promise<boolean> {
  const until = Date.now() + maxMs;
  while (!signal.aborted && Date.now() < until) {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, pollMs);
      signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
    });
    if (signal.aborted) return false;
    if ((await roleHealth("chat")).availability !== "unavailable") return true;
  }
  return false;
}

/** VISION-02c (rule 6): the one retry without the pictures runs only on
 * a failure that may be the picture's, with nothing yet shown to the
 * person and the turn not cancelled. */
export function pictureRetryAllowed(attempt: { ok: boolean; released?: boolean; message?: string }, aborted: boolean, messages: readonly LlmMessage[]): boolean {
  return !attempt.ok && !attempt.released && !aborted && messagesCarryPictures(messages) && pictureMayHaveFailed(classifyGenerationFailure(attempt.message).kind);
}

/** VISION-02c: whether a request carries picture parts. */
export function messagesCarryPictures(messages: readonly LlmMessage[]): boolean {
  return messages.some((message) => (message.images?.length ?? 0) > 0);
}

/** VISION-02c (rule 6): the same messages with their pictures left out
 * and a note, just ahead of the message they were on, that names the
 * pictures that were on it and the kind of failure only. */
export function withoutPictures(messages: readonly LlmMessage[], images: readonly ChatImagePart[], kind: string): LlmMessage[] {
  const out: LlmMessage[] = [];
  for (const message of messages) {
    if (!message.images?.length) { out.push(message); continue; }
    const { images: sent, ...rest } = message;
    const ids = new Set(sent.map((part) => part.id));
    const named = images.filter((image) => ids.has(image.id));
    // CHAT-LATE-SYSTEM-01: the note rides on the message the pictures were on
    // (the chat template accepts a system message only first).
    out.push({ ...rest, content: `${foldedBlock(`[attached] ${picturesNotReadNote(named.length > 0 ? named : sent.map((part) => ({ id: part.id, name: part.name, width: 1, height: 1, media_type: "image/jpeg" })), pictureFailureWords(kind))}`)}\n\n${rest.content}` });
  }
  return out;
}

/** VISION-02c: the pictures that went to the model on a successful
 * answer are marked on the turn, so a later window says they were shown
 * then. Only the hub sets the mark. */
export function markPicturesShown(images: readonly ChatImagePart[] | undefined, messages: readonly LlmMessage[]): ChatImagePart[] | undefined {
  if (!images) return images;
  const shown = new Set(messages.flatMap((message) => (message.images ?? []).map((part) => part.id)));
  return images.map((image) => shown.has(image.id) ? { ...image, shown_to_model: true as const } : image);
}

/** IMGQ-09 (b): the instruction of the after-the-answer re-ask. The reply is already on the person's screen, so the
 * model is told to leave it alone and only to call the tool when the message was about a thing worth a picture. */
export const SHOW_IMAGES_REASK_INSTRUCTION = "Your reply above is final and already shown; do not repeat or change it. Only if the person's message was about a specific famous person, place, film, show, game, animal, car or product (who or what it is, what it looks like, or chat about it), call show_images for it. Otherwise answer with nothing at all.";

/** The longest the re-ask may hold a finished turn open. */
export const SHOW_IMAGES_REASK_MAX_MS = 8000;

export interface ShowImagesReAsk {
  subject: string;
  kind: string;
  subjects?: unknown;
  callId: string;
  ms: number;
}

/** IMGQ-09 (b), rule 1 and rule 0: when the first pass offered `show_images` and answered in text with no tool call,
 * the model is asked once more, after the reply has streamed, with `tool_choice: "auto"` only (never forced). It can
 * only add a gallery under the finished reply; its own text is never shown (the stream gate is cut off for this call)
 * and a failure of any kind is no gallery, never a failed turn (rule 6). The caller has already checked
 * `answerImagesAllowed`, so a teen, a child, a spoken or a temporary turn never reaches here. */
export async function reAskForShowImages(state: TurnState, replyText: string, signal: AbortSignal): Promise<ShowImagesReAsk | null> {
  const began = Date.now();
  const gate = state.streamGate;
  const savedMessages = state.messages;
  state.streamGate = undefined;
  try {
    const messages: LlmMessage[] = [...state.messages, { role: "assistant", content: replyText }, { role: "user", content: SHOW_IMAGES_REASK_INSTRUCTION }];
    if (!state.lastTools.some((t) => t.id === SHOW_IMAGES_TOOL_ID)) return null;
    // The first pass's full tool list, not show_images alone: the tools sit ahead of the messages in the prompt, so a
    // different list changes the first tokens and the engine reprocesses all of it (~5k tokens, 7 s) on the next turn
    // too. Any call other than show_images is ignored below.
    const only = state.lastTools;
    // A short cap of its own: the reply is already shown, so a slow or failing model must not hold the turn open.
    const attempt = await runOneGeneration(state, messages, only, "auto", false, 200, "show_images_reask", AbortSignal.any([signal, AbortSignal.timeout(SHOW_IMAGES_REASK_MAX_MS)]));
    if (!attempt.ok) return null;
    const call = attempt.toolCalls?.find((c) => c.tool === SHOW_IMAGES_TOOL_ID);
    const args = (call?.args ?? {}) as Record<string, unknown>;
    if (!call || typeof args.subject !== "string" || args.subject.trim().length === 0) return null;
    return { subject: args.subject.trim(), kind: typeof args.kind === "string" ? args.kind.trim() : "", subjects: args.subjects, callId: call.id ?? `${state.turnId}:reask`, ms: Date.now() - began };
  } catch {
    return null;
  } finally {
    state.streamGate = gate;
    state.messages = savedMessages;
  }
}
