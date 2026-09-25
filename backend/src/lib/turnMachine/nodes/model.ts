// U2c, the `model` node (turn-machine-state-record-2026-09-22.md's
// state table and "The interim rule"): one call, the fixed tool set
// from the budget, tool_choice per the interim rule, streamed so the
// wire's own `reasoning`/`delta` events (section "What every turn
// writes") come from the same call turnNext.ts forwards to the client.
//
// The interim rule (simple-turn-pipeline-2026-09-22.md point 3, folded
// with the state record's own "unless this conversation already holds
// the answer" refinement): when the turn signal reads primary_act
// "question" and target "world", and the budget's always_search is on,
// the call runs tool_choice "required" over exactly two tools - the
// search tool and, when answer_from_context_tool is also on,
// answer_from_this_conversation (one argument: the quoted line of the
// context list it answers from). The household-subject rule (a turn
// naming a family member is never sent to the web) is a context check,
// not a signal field: it looks at whether any "roster"-sourced item's
// text names a subject already in the household-subject stack this
// turn's context carries - here, simply, whether the utterance itself
// contains a roster name, the same literal check subjects.ts's own
// speakerNamedAny() already makes for this exact purpose elsewhere.
import { startCompleteStream, envelopeToolCall } from "@/lib/llm";
import type { LlmMessage, ToolSpec, ToolCall } from "@/lib/llm";
import { loadManifestOnly } from "@/lib/plugins";
import { speakerNamedAny } from "@/lib/subjects";
import { isBarePronoun } from "@/lib/text";
import { visibleText, extractReasoningText, feedThinkSplit, flushThinkSplit, newThinkSplitState } from "@/lib/wellFormed";
import { visibleReplyMaxTokens } from "@/lib/turnEngine";
import { isWrittenAdultTurn, promptSurfaceClassFor, type SurfaceClass } from "@/lib/surfaceClass";
import { toolCallAssistantMessage, toolResultMessages, phrasingInstruction } from "@/lib/composer";
import { planLine } from "@/lib/register";
import { pickStatusPhrase } from "@/lib/statusPhrases";
import { contextToMessages } from "../messages";
import type { Node, TurnState, NodeOutcome } from "../contract";
import type { StreamGate } from "./outputGate";

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
 * mirroring turnEngine.ts's own runTurnStream()'s finalize(), whose
 * "cut with real partial content already streamed stays source: model"
 * branch (turnEngine.ts, the comment beside `refusedWithNothingDelivered`)
 * never resets a stream's already-released text for ANY ending, crash
 * or cancel alike - only an output-safety refusal with nothing
 * delivered yet gets the canned line there, the identical zero-delivered
 * case this function's own `reset()` branch still covers. The
 * generation's own error already reaches the trace unconditionally
 * (runOneGeneration's own catch, above, pushes it onto
 * state.generations before returning `{ ok: false }` at all) - settling
 * the gate one way or the other never touches that. */
function settleFailedGate(gate: StreamGate | undefined): void {
  if (gate && gate.result().text.length > 0) gate.finish();
  else gate?.reset();
}

export const ANSWER_FROM_CONTEXT_TOOL_ID = "answer_from_this_conversation";

const ANSWER_FROM_CONTEXT_TOOL: ToolSpec = {
  id: ANSWER_FROM_CONTEXT_TOOL_ID,
  description: "Answer the question from a line already in this conversation, instead of searching the web. Only use this when the answer is genuinely already here.",
  args: {
    type: "object",
    required: ["quote"],
    properties: {
      quote: { type: "string", description: "The exact line from the conversation this answer comes from." },
    },
  },
};

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
  /** The interim rule's own retry guard (the state record: "a quote
   * that is not there is an ungrounded argument and the search runs
   * instead"): true only on the one re-entry machine.ts's
   * `answer_from_context_check` state makes after policy rejected an
   * ungrounded quote. Forces the search tool alone, `tool_choice`
   * "required" - never offering `answer_from_this_conversation` again,
   * which is what guarantees this retries exactly once instead of the
   * model choosing the same broken answer a second time. */
  forceSearchOnly?: boolean;
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
  | { kind: "tool_calls"; calls: ToolCall[]; reasoning?: string; queryWriterUsed?: boolean }
  | { kind: "answer_from_context"; quote: string; reasoning?: string }
  // DEADLINE-01 (dev.md "U6 rerun ruling" (a)): a generation that never
  // finished at all (the model node's own deadline, a dead engine) -
  // distinct from `text` with an empty string, which `answerInputFrom()`
  // used to receive for this case and pass straight through as a real,
  // silent empty reply. `answer.ts` renders this with a fixed line,
  // never empty text.
  | { kind: "model_failed"; reasoning?: string };

/** Whether the utterance is what the interim rule calls "a question
 * about the world" - the signal's own closed-set fields, no new rule. */
function isWorldQuestion(state: TurnState): boolean {
  return state.signal.primary_act === "question" && state.signal.target === "world";
}

/** The roster names this turn's own context list already carries
 * (nodes/context.ts's "roster" item), read back rather than re-fetched -
 * one source of the household's names, whichever node asks. */
function rosterNames(state: TurnState): string[] {
  return state.context.filter((c) => c.source === "roster").map((c) => c.text);
}

function householdSubjectNamed(state: TurnState): boolean {
  const roster = rosterNames(state);
  return roster.length > 0 && speakerNamedAny(state.utterance, roster);
}

function toolSpecFor(id: string): ToolSpec | null {
  if (id === ANSWER_FROM_CONTEXT_TOOL_ID) return ANSWER_FROM_CONTEXT_TOOL;
  const loaded = loadManifestOnly(id);
  if (!loaded.ok) return null;
  return { id, description: loaded.value.description, args: loaded.value.args };
}

// FORCED-CALL-01 (dev.md "The owner's three live turns", (1)): a
// required call's own reply IS a tool_calls fragment stream, never
// text - a websearch call is 30 to 45 tokens (the name, `expression`,
// `category`, `read_page` and the wrapper), so 96 leaves real room for
// a long expression and can never pay for a 440-token knowledge answer
// the way the ordinary/phrasing call's own cap did. The cap is the
// backstop for the non-streaming Stack twin and for a runaway call;
// the early-abort below (the first text delta on a forced call) is
// what actually keeps a miss cheap in the common, streaming case.
const FORCED_CALL_MAX_TOKENS = 96;

/** The reply floor (spec-v0.1.28, U4b-2, turn-machine-state-record-
 * 2026-09-22.md "The reply floor"): a written, non-brevity, adult
 * turn uses the budget's own reply_ceiling_tokens instead of LAT-01's
 * shared visibleReplyMaxTokens formula (turnEngine.ts) - a runaway
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
 * predicate risk a second, independent copy invites. */
function replyMaxTokensFor(state: TurnState, thinking: boolean): number {
  const isWrittenAdult = isWrittenAdultTurn(state.planBasis.surfaceClass, state.plan.age_band) && !state.planBasis.brevity;
  if (isWrittenAdult) return state.budget.reply_ceiling_tokens + (thinking ? state.budget.thinking_budget_tokens_toggled : 0);
  return visibleReplyMaxTokens(state.plan.max_words, thinking);
}

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
}
// GENFAIL-01: `message` is the engine's own diagnostic text (llm.ts's
// caught error, or startCompleteStream()'s own `started.error`) -
// carried back to modelNode so it lands on both the generation record
// (already pushed inside runOneGeneration, below) AND the model node's
// own NodeOutcome (contract.ts), the same reason a caller shouldn't
// need to cross-reference two different records to read why a turn
// failed.
type GenerationResult = GenerationAttempt | { ok: false; code: string; message?: string };

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

/** One real model call: builds the tools block for this attempt, runs
 * it through the streaming client (COR-7's own signal support), and
 * drains it manually so the generator's return value (the tool calls)
 * survives - `for await...of` would discard it. */
async function runOneGeneration(state: TurnState, messages: LlmMessage[], tools: ToolSpec[], tool_choice: "auto" | "required" | "none" | undefined, thinking: boolean, maxTokens: number, reason: string, signal: AbortSignal): Promise<GenerationResult> {
  const forced = tool_choice === "required";
  // STREAM-NEXT-01 (b), ruling point 6: only a non-forced generation can
  // legitimately end in text (a `required` call either calls the tool or
  // is discarded by the builder row - FORCED-CALL-01's own abort-on-any-
  // text below never lets one stream real prose), so the gate is never
  // even touched for one. `state.streamGate` is undefined for every
  // caller but turnNext.ts's own runTurnNextStream(), so this is a no-op
  // everywhere else. reset() clears whatever a PRIOR, now-abandoned
  // attempt (an offered round the model answered with a tool call
  // instead, or an earlier empty attempt this call is retrying) left
  // pending - this turn's real reply is always its LAST eligible
  // generation's own text.
  const gate = forced ? undefined : state.streamGate;
  gate?.reset();
  // FORCED-CALL-01: a child AbortController chained off the node's own
  // signal (deadline.ts's nodeSignal shape, without its timer half -
  // this one fires on content, not a clock), so a forced call's own
  // early-abort never reaches past THIS generation's own request.
  const controller = forced ? new AbortController() : null;
  if (controller) {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
  }
  const started = await startCompleteStream("chat", messages, { tools: tools.length > 0 ? tools : undefined, tool_choice, thinking, max_tokens: maxTokens }, controller?.signal ?? signal);
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
    state.generations.push({ reason, thinking, maxTokens, requestSentMs: Date.now() - state.startedAt, firstDeltaMs: null, stats: null, error: boundedError });
    return { ok: false, code: started.code, message: boundedError };
  }

  const requestSentMs = Date.now();
  let firstDeltaMs: number | null = null;
  let raw = "";
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
  try {
    for (;;) {
      const step = await started.tokens.next();
      if (step.done) {
        toolCalls = step.value;
        break;
      }
      if (firstDeltaMs === null) firstDeltaMs = Date.now() - requestSentMs;
      // FORCED-CALL-01: llm.ts streams a tool call as tool_calls
      // fragments, never as text, and a forced call always runs
      // thinking off (modelNode, below), so ANY text delta at all here
      // already means the model wrote prose instead of a call - the
      // miss itself. Abort now rather than pay for the rest of a
      // doomed generation; breaking (not throwing) lets this fall
      // through below exactly like an ordinary "no tool call" attempt,
      // which the existing requiredButMissing/builder-row logic in
      // modelNode already handles correctly.
      if (forced && controller && step.value.length > 0) {
        controller.abort(new DOMException("forced call wrote text, not a tool call", "AbortError"));
        await started.tokens.return?.(undefined as never).catch(() => {});
        break;
      }
      raw += step.value;
      if (gate && thinkSplit) {
        for (const span of feedThinkSplit(thinkSplit, step.value)) if (!span.reasoning) gate.push(span.text);
      }
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
    state.generations.push({ reason, thinking, maxTokens, requestSentMs: requestSentMs - state.startedAt, firstDeltaMs, stats: started.stats, error: message });
    return { ok: false, code: "generation_failed", message };
  }

  if (gate && thinkSplit) {
    for (const span of flushThinkSplit(thinkSplit)) if (!span.reasoning) gate.push(span.text);
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
  if (!toolCalls || toolCalls.length === 0) {
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
  state.generations.push({ reason, thinking, maxTokens, requestSentMs: requestSentMs - state.startedAt, firstDeltaMs, stats: started.stats, toolCallRawArgs: websearchRawArgs, envelopeParsed });
  return { ok: true, text: visible, reasoning: extractReasoningText(raw), toolCalls, thinking };
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
async function runQueryWriter(messages: LlmMessage[], signal: AbortSignal): Promise<QueryWriterResult> {
  const started = await startCompleteStream(
    "chat",
    [...messages, { role: "user", content: QUERY_WRITER_INSTRUCTION }],
    { response_format: { type: "json_schema", json_schema: QUERY_WRITER_SCHEMA }, thinking: false, max_tokens: QUERY_WRITER_MAX_TOKENS },
    signal,
  );
  if (!started.ok) return { ok: false, code: started.code, message: boundedGenerationError(started.error) };
  let text = "";
  try {
    for (;;) {
      const step = await started.tokens.next();
      if (step.done) break;
      text += step.value;
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
 * machine.ts's own `queryWriterFallback` state, the same shape
 * `answer_from_context_check`'s existing retry already uses, never
 * re-implemented here. A genuine generation failure (`written.ok ===
 * false`) carries its own code/message into the builder row exactly
 * like every other generation failure in this file does - never
 * silently folded into an ordinary required_miss. */
async function recoveredMissingCall(messages: LlmMessage[], utterance: string, otherCalls: readonly ToolCall[], reasoning: string | undefined, signal: AbortSignal): Promise<{ outcome: NodeOutcome; output: ModelOutput }> {
  const written = await runQueryWriter(messages, signal);
  if (!written.ok) return builderFallbackOutput(utterance, otherCalls, reasoning, written.code, written.message);
  if (written.expression === null) return builderFallbackOutput(utterance, otherCalls, reasoning);
  const queryWriterCall: ToolCall = { tool: "websearch", args: { expression: written.expression }, id: "query-writer" };
  return { outcome: { ok: true, required_miss: true }, output: { kind: "tool_calls", calls: [...otherCalls, queryWriterCall], reasoning, queryWriterUsed: true } };
}

export const modelNode: Node<ModelInput, ModelOutput> = async (state, input, signal) => {
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

  const interimRuleApplies = input.toolsAllowed && state.budget.always_search && isWorldQuestion(state) && !householdSubjectNamed(state);

  let messages: LlmMessage[] = contextToMessages(state.context, input.utterance, state.persona, state.plan, state.signal, state.planBasis.surfaceClass ?? "spoken");
  let tools: ToolSpec[];
  let tool_choice: "auto" | "required" | "none" | undefined;

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
    // transcript). `answer.ts`'s own "model_text" case appends the
    // failed outcome's own toolOutageLine afterward, deterministically,
    // from the ORIGINAL unfiltered state.outcomes - the model is never
    // the one deciding whether to mention it.
    const phrasedOutcomes = state.outcomes.filter((o) => o.status !== "failed");
    const assistantMessage = toolCallAssistantMessage(phrasedOutcomes);
    const resultMessages = toolResultMessages(phrasedOutcomes);
    const searchResultCount = phrasedOutcomes.reduce((count, outcome) => {
      if (outcome.status !== "succeeded" || outcome.packageId !== "websearch") return count;
      const rows = (outcome.result?.data as { rows?: unknown[] } | undefined)?.rows;
      return count + (Array.isArray(rows) ? rows.length : 0);
    }, 0);
    const phrasing = phrasingInstruction(promptSurfaceClass, input.utterance, searchResultCount);
    const instruction: LlmMessage = { role: "user", content: promptSurfaceClass === "written" ? phrasing : `${planLine(state.plan, state.signal, promptSurfaceClass)} ${phrasing}` };
    messages = [...state.messages, assistantMessage, ...resultMessages, instruction];
    // The same tools block the forced/offered round itself sent -
    // reused verbatim (see contract.ts's own `lastTools` doc comment:
    // the Qwen3 template renders the tools block into the prompt's own
    // stable prefix, so anything but a byte-identical array re-renders
    // it and costs the cache hit this item exists to restore).
    tools = state.lastTools;
    tool_choice = "none";
  } else if (input.forceSearchOnly) {
    tools = [toolSpecFor("websearch")].filter((t): t is ToolSpec => t !== null);
    tool_choice = "required";
  } else if (!input.toolsAllowed) {
    tools = [];
    tool_choice = undefined;
  } else if (interimRuleApplies) {
    const ids = state.budget.answer_from_context_tool ? ["websearch", ANSWER_FROM_CONTEXT_TOOL_ID] : ["websearch"];
    tools = ids.map(toolSpecFor).filter((t): t is ToolSpec => t !== null);
    tool_choice = "required";
  } else {
    tools = state.budget.tools_offered
      .slice()
      .sort()
      .map(toolSpecFor)
      .filter((t): t is ToolSpec => t !== null);
  }

  state.messages = messages;
  if (!isPhrasingRound) state.lastTools = tools;

  // STREAM-NEXT-01 (b), ruling point 6: only a non-forced round can ever
  // legitimately end in text (FORCED_CALL_MAX_TOKENS/the abort-on-any-
  // text guard mean a forced round never has real prose to stream).
  // Computed once, here, since `tool_choice` never changes across this
  // node's own retry (below) - the SAME gate instance settles at
  // exactly one of this function's own exit points, decided by THAT
  // exit's own final outcome, never by an intermediate attempt a retry
  // might still replace (a code review's own finding: finish()ing on an
  // empty first attempt locked the gate before its own retry's real
  // text could ever reach it).
  const gate = tool_choice === "required" ? undefined : state.streamGate;

  // GROUND-01: `context`'s own decideReasoning() already decided
  // `reasoning.withheld_for === "minor"` from the age band, reused here
  // rather than a second age check - a minor's turn sends `thinking:
  // false` to the engine by default (budget.thinking_for_minors), a
  // cost control since the reasoning span would be consumed and
  // dropped below regardless (see `reasoning` a few lines down).
  const minorThinkingOff = state.reasoning.withheld_for === "minor" && !state.budget.thinking_for_minors;
  // FORCED-CALL-01 (dev.md "The owner's three live turns", (1)):
  // thinking off on every required call, whatever the person's own
  // toggle - a call is not a reply, and re-check C's own miss-rate
  // measurement was taken with thinking off. Only a `required` call is
  // forced this way; an ordinary/offered call still follows the
  // household's own toggle (THINK-DEFAULT-01) unchanged. A phrasing
  // round's own tool_choice is "none", never "required", so it reads
  // the household's own toggle too, same as an ordinary call.
  const thinkingOn = tool_choice !== "required" && state.budget.thinking_budget_tokens > 0 && !minorThinkingOff;
  // FORCED-CALL-01: the forced call's own cap is fixed (FORCED_CALL_
  // MAX_TOKENS). PHRASE-01: the phrasing round's own cap is LAT-01's
  // visibleReplyMaxTokens formula directly, never replyMaxTokensFor's
  // written-adult ceiling override - that override exists for the
  // stable-prefix-only written turn PREFIX-CLASS-01 measured, not for a
  // continuation already carrying tool results and its own instruction.
  const maxTokens = tool_choice === "required" ? FORCED_CALL_MAX_TOKENS : isPhrasingRound ? visibleReplyMaxTokens(state.plan.max_words, thinkingOn) : replyMaxTokensFor(state, thinkingOn);
  let attempt = await runOneGeneration(state, messages, tools, tool_choice, thinkingOn, maxTokens, isPhrasingRound ? "phrasing" : interimRuleApplies ? "interim_rule" : "model", signal);
  // DEADLINE-01: a generation that never finished (the model node's
  // own deadline, a dead engine) is one more way "the model produced
  // no query" happens - on a forced turn (tool_choice required), the
  // builder row runs exactly as it does for a missed or invalid call
  // below; otherwise the turn gets a real, fixed model_failed line,
  // never the empty string this used to deliver silently through
  // `answer` as if the model had genuinely said nothing.
  if (!attempt.ok) {
    settleFailedGate(gate);
    return tool_choice === "required" ? builderFallbackOutput(input.utterance, [], undefined, attempt.code, attempt.message) : { outcome: { ok: false, code: attempt.code, message: attempt.message }, output: { kind: "model_failed" } };
  }

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
  if ((!attempt.toolCalls || attempt.toolCalls.length === 0) && attempt.text.trim().length === 0 && (thinkingOn || phrasingToolCallDiscarded)) {
    const retryMaxTokens = isPhrasingRound ? visibleReplyMaxTokens(state.plan.max_words, false) : replyMaxTokensFor(state, false);
    attempt = await runOneGeneration(state, messages, tools, tool_choice, false, retryMaxTokens, "model_retry_no_thinking", signal);
    if (!attempt.ok) {
      settleFailedGate(gate);
      return tool_choice === "required" ? builderFallbackOutput(input.utterance, [], undefined, attempt.code, attempt.message) : { outcome: { ok: false, code: attempt.code, message: attempt.message }, output: { kind: "model_failed" } };
    }
    if (isPhrasingRound && attempt.toolCalls && attempt.toolCalls.length > 0) attempt = { ...attempt, toolCalls: undefined };
  }

  // "Reasoning is a second output" (the owner's ruling): `context`
  // already decided whether this turn may emit one at all;
  // `state.reasoning.emit === false` means "the model node consumes
  // the spans and emits nothing" - so a withheld turn's reasoning
  // never even reaches ModelOutput, let alone the trace or the wire.
  const reasoning = state.reasoning.emit ? attempt.reasoning : undefined;

  if (attempt.toolCalls && attempt.toolCalls.length > 0) {
    const contextAnswer = attempt.toolCalls.find((c) => c.tool === ANSWER_FROM_CONTEXT_TOOL_ID);
    if (contextAnswer) {
      // Only ever reachable on a forced (interim-rule) round, so `gate`
      // is already undefined here - reset() is a defensive no-op, never
      // load-bearing, kept only so every exit point settles the gate the
      // same explicit way.
      gate?.reset();
      const quote = typeof contextAnswer.args === "object" && contextAnswer.args && "quote" in contextAnswer.args ? String((contextAnswer.args as { quote: unknown }).quote) : "";
      return { outcome: { ok: true }, output: { kind: "answer_from_context", quote, reasoning } };
    }
  }

  // ENGINE-CONTRACT-02 (dev.md 2026-09-23, "U6: the flip verdict"): the
  // model node verifies a websearch call carries a non-empty string
  // expression, forced or offered alike - never only "did a tool_choice
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
  // QUERY-WRITER-01b (bench-only, getmaipai-26's ruling, 2026-09-24): a
  // real required-call miss is genuinely rare and engine-dependent
  // (ENGINE-CONTRACT-02 measured 0/5 to 8/10 by temp/cache state alone)
  // - too unreliable to exercise recoveredMissingCall()/the query-writer
  // itself from a live bench. This env var forces every forced turn
  // into the miss branch below regardless of what the model actually
  // returned, so a bench can drive that path deterministically. Read
  // only by its own exact value, unset in every real deployment - a
  // production request has no way to set it.
  const benchForceRequiredMiss = process.env.MAIPAI_BENCH_FORCE_REQUIRED_MISS === "1";
  const requiredButMissing = tool_choice === "required" && (!websearchCall || benchForceRequiredMiss);
  const offeredButInvalid = websearchCall !== undefined && !websearchValid;
  if (requiredButMissing || offeredButInvalid) {
    // A review caught the first cut here discarding every tool call the
    // model made, not only the bad websearch one - policy.ts runs every
    // proposal in `input.calls` (nodes/policy.ts's own `for` loop), so a
    // reply that legitimately called another tool (weather, say)
    // alongside an invalid websearch call would have silently lost that
    // other call too. Only the websearch call is replaced; every other
    // call the model made this round still runs.
    gate?.reset();
    const otherCalls = (attempt.toolCalls ?? []).filter((c) => c.tool !== "websearch");
    return recoveredMissingCall(messages, input.utterance, otherCalls, reasoning, signal);
  }

  if (attempt.toolCalls && attempt.toolCalls.length > 0) {
    gate?.reset();
    return { outcome: { ok: true }, output: { kind: "tool_calls", calls: attempt.toolCalls, reasoning } };
  }

  // The one exit that ever ships real, streamable text - settle the
  // gate here, once, on the FINAL attempt (post-retry) alone.
  gate?.finish();
  return { outcome: { ok: true }, output: { kind: "text", text: attempt.text, thinking: attempt.thinking, reasoning } };
};
