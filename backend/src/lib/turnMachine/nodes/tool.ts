import { MAKE_BAND_TOOL_ID, runMakeBand } from "@/lib/music/band";
import { isStudioTool, runStudioTool } from "@/lib/music/studioTools";
import { GENERATE_MUSIC_TOOL_ID, EDIT_MUSIC_TOOL_ID, runGenerateMusic, runEditMusic } from "@/lib/music/tool";
import { MAKE_SOUND_TOOL_ID, runMakeSound } from "@/lib/music/soundMaker";
// U2c, the `tool` node (turn-machine-state-record-2026-09-22.md's state
// table): "runPlugin under the tool deadline; the outcome recorded in
// model order." The node's signal reaches runPlugin() so search requests
// stop at cancellation; the race still records a timeout if a package
// ignores the signal.
import { runPlugin } from "@/lib/plugins";
import { RESEARCH_SEARCHES_MAX, newResearchBudget, runWithResearchBudget } from "@/lib/researchBudget";
import { researchQuestion } from "../researchPipeline";
import { NOTES_START_BUDGET_MS, NOTE_CONCURRENCY, currentNoteWriter, makeGate, newNoteStats, writePageNotes } from "../pageNotes";
import { isRepeatQuery, markResearch, memoryDetailsIn, researchCapMs, researchCutAt, researchEvidence, rewordEmptyQuery, withoutMemoryDetails } from "../research";
import { anchorQuery } from "../entityPin";
import { PluginResult } from "@maipai/spec/gen/ts/result.js";
import { ASK_FORM_TTL_MS } from "@/lib/askForm";
import type { TurnAskField } from "@/wire";
import { resolveWeatherPlace } from "@/lib/places";
import { blockEventsFor } from "../blockEvents";
import { HOUSE_TOOL_ID, runHouseTool } from "@/lib/house/tool";
import { isScheduleAction } from "@/lib/house/scheduleTool";
import { UPTIME_TOOL_ID, runUptimeTool } from "@/lib/uptime/tool";
import { outcomeOf, type FailureKind } from "@/lib/turnContext";
import { lookupFailureKind } from "./lookupFallback";
import { pickStatusPhrase } from "@/lib/statusPhrases";
import { READ_ITEM_TOOL_ID, runReadItemTool } from "@/lib/items/tool";
import { WRITING_FORMAT_TOOL_ID, runWritingFormatTool } from "@/lib/writingFormats";
import { VOICEOVER_TOOL_ID, CHANGE_VOICE_TOOL_ID, MAKE_INSPIRED_VOICE_TOOL_ID, runVoiceoverTool, runChangeVoiceTool, runMakeInspiredVoiceTool } from "@/lib/voiceTools";
import { START_PROJECT_TOOL_ID, runStartProjectTool, type StartProjectArgs } from "@/lib/projects/tool";
import { SHOW_IMAGES_TOOL_ID, SHOW_IMAGES_UNAVAILABLE_LINE, answerImageFailureKind, showImagesEmptyResultLine, showImagesMultiResultLine, showImagesNames, showImagesPendingResultLine, showImagesResultLine, startAnswerImages } from "@/lib/answerImages/turn";
import { GENERATE_IMAGE_TOOL_ID, runGenerateImage } from "@/lib/pictures/tool";
import { runMediaOp } from "@/lib/mediaOps/registry";
import { latestPictureId } from "@/lib/pictures/editTool";
import { ImageEditError } from "@/lib/imageEdit";
import { GENERATE_VIDEO_TOOL_ID, runGenerateVideo } from "@/lib/videos/tool";
import { redactLockedVideoOutcome } from "@/lib/videos/lock";
import { LOCKED_MUSIC_RESULT_TEXT, redactLockedMusicOutcome } from "@/lib/music/lock";
import { EDIT_VIDEO_TOOL_ID, runEditVideo } from "@/lib/videos/editTool";
import { MAKE_FILM_TOOL_ID, runMakeFilmTurn } from "@/lib/films/tool";
import { MAKE_REFERENCE_VIDEO_TOOL_ID, runMakeReferenceVideoTurn } from "@/lib/videos/referenceVideo";
import { isProductionCall, runMakeProduction } from "@/lib/longform/tool";
import { speakerIsAnonymous, turnAgeBand } from "../speaker";
import type { Node, ActionProposal, ToolExecutionOutcome } from "../contract";
import { TOOL_RESULT_SITES_MAX, type TurnStreamEvent as ToolStreamEvent } from "@maipai/spec/stack/ts/turn-stream-event.js";

export interface ToolInput {
  proposals: readonly ActionProposal[];
  deadlineAt?: number;
}

export interface ToolOutput {
  outcomes: ToolExecutionOutcome[];
  /** TOOL-EVENTS-01(b): one `tool_call` per proposal, pushed as it's
   * accepted (before the call resolves), then exactly one `tool_result`
   * (succeeded) or `tool_error` (failed or deadline-exceeded) once its
   * outcome lands - the spec's own two-outcome split (schema.json has
   * no third "partial" shape), never emitted for a rejected/pending
   * proposal (policy.ts never sends one here). */
  toolEvents: ToolStreamEvent[];
}

function withDeadline<T>(promise: Promise<T>, signal: AbortSignal): Promise<T | "deadline"> {
  if (signal.aborted) return Promise.resolve("deadline");
  return new Promise((resolve, reject) => {
    const onAbort = () => resolve("deadline");
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (v) => {
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (err) => {
        // runPlugin() itself is Result-typed (never rejects on a normal
        // failure); a genuine reject here is a real bug in a package's
        // own handler, and must surface as one, never silently stall
        // until the deadline timer alone resolves this promise.
        signal.removeEventListener("abort", onAbort);
        reject(err);
      },
    );
  });
}

/** The arguments a call is actually run and recorded with: for a search, the
 * model's own `category` and (outside a bench) `read_page` are never trusted
 * (LIVE-0923-01, READ-PAGE-01 below). Exported so a retry round compares a new
 * call against what the failed one really ran with. */
export function modelFacingArgs(tool: string, args: Record<string, unknown>): Record<string, unknown> {
  // PLACE-WEATHER-01: coordinates are host-only inputs; a model-proposed pair never enters the call, event or record.
  if (tool === "weather") return Object.fromEntries(Object.entries(args).filter(([k]) => k !== "latitude" && k !== "longitude"));
  if (tool !== "websearch") return args;
  const stripKeys = new Set(["category", ...(process.env.MAIPAI_BENCH_KEEP_READ_PAGE === "1" ? [] : ["read_page"])]);
  return Object.fromEntries(Object.entries(args).filter(([k]) => !stripKeys.has(k)));
}

/** STATUS-PHRASES-02 (live, 2026-10-17): the waiting line while a tool runs
 * was always a "searching" phrase, so a weather, timer, math or remember
 * call read "Running a search…" or "Checking the web…". Only the web search
 * is a search; every other tool gets the "checking" set. */
export function toolStatusMoment(tool: string): "searching" | "checking" {
  return tool === "websearch" ? "searching" : "checking";
}

/** R2 (rule 6, tools design T5): a failed run's kind, from its fixed code only. */
function failureKindOf(code: string | undefined): FailureKind {
  if (code === "bad_arguments") return "bad_arguments";
  if (code === "search_unavailable") return "unavailable";
  return "errored";
}

const MAX_DETAIL_CHARS = 2000;
/** A form the speaker may not get: the fields go, the package's text prompt stays (as `ask.prompt`, and as the reply when the package sent none). */
function sanitizeAskResult<T extends { ask?: unknown; reply?: { text?: string } }>(value: T): T {
  const ask = (value.ask ?? {}) as { prompt?: string; expects?: string };
  const { ask: _ask, ...safe } = value;
  const kept = { ...(ask.prompt !== undefined ? { prompt: ask.prompt } : {}), ...(ask.expects !== undefined ? { expects: ask.expects } : {}) };
  const reply = !value.reply?.text && ask.prompt ? { reply: { ...(value.reply ?? {}), text: ask.prompt } } : {};
  return { ...safe, ...reply, ...(Object.keys(kept).length ? { ask: kept } : {}) } as T;
}
/** Keep the leading gallery opportunity while leaving headroom under the first-text budget. */
const SHOW_IMAGES_LEAD_WAIT_MS = 600;

async function waitForImageLead(done: Promise<void>): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      done.then(() => true),
      new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), SHOW_IMAGES_LEAD_WAIT_MS); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** RESEARCH-EMPTY-01: at most this many reworded retries per question, each at most EMPTY_RETRY_MAX_MS long, and none once half the research time is gone. */
const EMPTY_RETRIES_MAX = 4;
/** Home paces searches at one new token every six seconds (a research search waits up to eight for one), so a round retries at most two. */
const EMPTY_RETRIES_PER_ROUND = 2;
const EMPTY_RETRY_MAX_MS = 10_000;
const EMPTY_RETRY_TIME_SHARE = 0.5;

/** A planned search that returned no rows (or failed) is run once more, reworded (its rare words dropped, the entity title and plain topic
 * words kept), beside the other empty searches of the round. A retry that finds rows takes the place of the empty outcome, so the source
 * numbers and the notes see it as the planned search. */
async function retryEmptySearches(
  state: Parameters<typeof toolNode>[0],
  researchRun: NonNullable<typeof state.researchBudget>,
  empties: { index: number; callId: string; args: Record<string, unknown>; runArgs: Record<string, unknown> }[],
  outcomes: ToolExecutionOutcome[],
  toolEvents: ToolStreamEvent[],
  toolDeadlineAt: number | undefined,
  signal: AbortSignal,
): Promise<void> {
  const cap = researchCapMs(state.answerStyle);
  const left = researchRun.deadlineAt === undefined ? 0 : researchRun.deadlineAt - Date.now();
  // A round's own tool deadline cuts the later paced searches (the live bench's only "failed" searches); that abort is the node's
  // timer, not the person leaving, so the retry runs on its own limit. Any other abort (the turn stopped) means no retry.
  const nodeTimedOut = signal.aborted && signal.reason instanceof DOMException && signal.reason.name === "TimeoutError";
  if (cap === undefined || left < cap * EMPTY_RETRY_TIME_SHARE || (signal.aborted && !nodeTimedOut)) return;
  const anchor = state.entityAnchor ?? null;
  const anchorText = anchor ? `${anchor.phrase} ${anchor.years.join(" ")}` : null;
  const earlier = [...state.outcomes, ...outcomes].filter((o) => o.packageId === "websearch").map((o) => String((o.args as { expression?: unknown } | undefined)?.expression ?? ""));
  const planned: { empty: (typeof empties)[number]; expression: string }[] = [];
  for (const empty of empties) {
    if ((researchRun.emptyRetries ?? 0) + planned.length >= EMPTY_RETRIES_MAX || planned.length >= EMPTY_RETRIES_PER_ROUND) break;
    const original = String(empty.args.expression ?? "");
    const expression = rewordEmptyQuery(original, anchorText);
    if (expression === null || isRepeatQuery([...earlier.filter((q) => q !== original), ...planned.map((p) => p.expression)], expression)) continue;
    planned.push({ empty, expression });
  }
  if (planned.length === 0) return;
  researchRun.emptyRetries = (researchRun.emptyRetries ?? 0) + planned.length;
  markResearch(state, `retry start (${planned.length} empty searches reworded)`);
  const retrySignal = nodeTimedOut ? AbortSignal.timeout(EMPTY_RETRY_MAX_MS) : AbortSignal.any([signal, AbortSignal.timeout(EMPTY_RETRY_MAX_MS)]);
  const ran = await Promise.all(planned.map(async ({ empty, expression }) => {
    const startedAt = Date.now();
    const raced = await withDeadline(runWithResearchBudget(researchRun, () => runPlugin("websearch", state.actor, { ...empty.runArgs, expression }, { id: state.turnId, conversationId: state.conversationId, userText: state.utterance }, { signal: retrySignal, deadlineAt: nodeTimedOut ? Date.now() + EMPTY_RETRY_MAX_MS : Math.min(toolDeadlineAt ?? Infinity, Date.now() + EMPTY_RETRY_MAX_MS), spoken: (state.planBasis?.surfaceClass ?? "spoken") !== "written", band: turnAgeBand(state.surface, state.actor, state.speakerEvidence, new Date(), state.deviceId) })), retrySignal).catch(() => "deadline" as const);
    return { empty, expression, raced, durationMs: Date.now() - startedAt };
  }));
  let found = 0;
  for (const { empty, expression, raced, durationMs } of ran) {
    if (raced === "deadline" || !raced.ok) continue;
    const outcome = outcomeOf({ callId: empty.callId, packageId: "websearch", status: "succeeded", via: "tool_call", args: { ...empty.args, expression }, queryRewritten: true, result: raced.value, durationMs });
    if ((outcome.sources?.length ?? 0) === 0) continue;
    found += 1;
    outcomes[empty.index] = outcome;
    const at = toolEvents.findIndex((e) => (e as { call_id?: string }).call_id === empty.callId && (e.t === "tool_result" || e.t === "tool_error"));
    const sites = outcome.sources?.slice(0, TOOL_RESULT_SITES_MAX).map((s) => ({ host: s.site, url: s.url }));
    const event: ToolStreamEvent = { t: "tool_result", call_id: empty.callId, package_id: "websearch", outcome: { text: raced.value.reply?.text, ...(sites?.length ? { sites } : {}) } };
    if (at >= 0) toolEvents[at] = event; else toolEvents.push(event);
  }
  markResearch(state, `retry end (${found} of ${planned.length} found rows)`);
}

import { speculationConfirmed } from "@/lib/speculation";

export const toolNode: Node<ToolInput, ToolOutput> = async (state, input, signal) => {
  // RESEARCH-TIER-01: a Thinking or Max turn's rounds share one page budget (researchBudget.ts).
  const researchRun = state.answerStyle !== undefined && state.answerStyle !== "instant" && state.budget.rounds > 1 ? (state.researchBudget ??= newResearchBudget(state.answerStyle === "max" && state.researchLibraryOnly === true)) : undefined;
  // RESEARCH-CLOCK-01: page reading of this turn stops at the style's cut-off time.
  if (researchRun) researchRun.deadlineAt ??= researchCutAt(state);
  // RESEARCH-NOTES-01: the light model writes notes from each page the run reads.
  if (researchRun && !researchRun.noteJob) {
    const gate = makeGate(NOTE_CONCURRENCY);
    const stats = researchRun.noteStats ??= newNoteStats();
    const question = researchQuestion(state.messages, state.utterance);
    // The passages sent to the light model are the ones that share the most words with the question and its parts.
    const focus = [question, ...(state.researchBrief?.mustContain ?? []), ...(state.researchPlan?.subQuestions ?? [])].join(" ");
    let firstNoteAt: number | undefined;
    researchRun.noteJob = (page) => {
      if (researchRun.notes.has(page.url)) return;
      // Notes are written only while time allows: no new call starts 25 seconds after the first.
      firstNoteAt ??= Date.now();
      if (Date.now() - firstNoteAt > NOTES_START_BUDGET_MS) return;
      researchRun.notes.set(page.url, writePageNotes(currentNoteWriter(), gate, question, page, stats, Date.now, focus, { cutAt: researchRun.deadlineAt }).catch(() => []));
    };
  }
  const outcomes: ToolExecutionOutcome[] = [];
  const toolEvents: ToolStreamEvent[] = [];
  // RESEARCH-EMPTY-01: research searches of this round that returned no rows or failed, with what they ran on.
  const emptySearches: { index: number; callId: string; args: Record<string, unknown>; runArgs: Record<string, unknown> }[] = [];
  // ANSWER-IMG-02: a round's show_images call starts its picture pipeline
  // before any other proposal of the round runs, so the pictures are fetched
  // beside a search rather than after it (section 4.3).
  if (state.answerImagesAllowed) {
    const call = input.proposals.find((p) => p.request.tool === SHOW_IMAGES_TOOL_ID && typeof p.request.args.subject === "string" && p.request.args.subject.trim().length > 0);
    if (call) {
      // An explicit picture call owns this turn's gallery; never add the
      // resolver's automatic lead as a second, redundant image.
      state.pendingAutoLeadImage = undefined;
      state.releaseAutoLeadText?.(false);
      startAnswerImages(state, (call.request.args.subject as string).trim(), typeof call.request.args.kind === "string" ? call.request.args.kind.trim() : "", call.request.callId, call.request.args.subjects);
    }
  }
  for (const proposal of input.proposals) {
    const { tool, callId } = proposal.request;
    // STT-SMARTTURN-01: a held (speculative) run executes nothing, search included, until the final transcript confirms it;
    // a discarded or aborted run ends here with no package run (the abort already ends the turn).
    if (state.speculation && !(await speculationConfirmed(state.speculation.confirmed, signal))) throw new Error("speculative turn discarded before its tool ran");
    if (tool === "edit_picture") {
      const raw = proposal.request.args as { op?: unknown; source?: unknown; args?: unknown };
      const sourceId = typeof raw.source === "string" ? raw.source : "";
      const images = state.images ?? [];
      const id = sourceId === "attached" ? images[0]?.id
        : sourceId === "attached_2" ? images[1]?.id
        : sourceId === "latest" ? latestPictureId(state.actor, state.conversationId, state.temporary || state.ephemeral === true) : sourceId;
      const args = (raw.args ?? {}) as Record<string, unknown>;
      if (typeof args.maskBase64 === "string") { args.mask = new Uint8Array(Buffer.from(args.maskBase64, "base64")); delete args.maskBase64; }
      if (typeof args.maskPngBase64 === "string") { args.maskPng = new Uint8Array(Buffer.from(args.maskPngBase64, "base64")); delete args.maskPngBase64; }
      try {
        const result = await runMediaOp(state.actor, String(raw.op ?? ""), { source: { kind: "picture", via: "chat", id: id ?? "", conversationId: state.conversationId }, args }, signal);
        const resultData = "people" in result || "subjects" in result ? result : null;
        const payload = "job" in result ? result.job : result.file;
        const job = typeof payload === "object" && payload !== null && "job" in payload ? String((payload as { job: string }).job) : null;
        const outcome = outcomeOf({ callId, packageId: tool, status: "succeeded", via: "tool_call", args: proposal.request.args, durationMs: 0, result: { reply: { text: job ? "The picture edit is on its way." : resultData ? "I found the numbered picture subjects." : "The picture edit is ready as a new version." }, data: { ...(job ? { pictureJobId: job } : {}), ...(resultData ?? {}) }, actions: [] } });
        outcomes.push(outcome);
        toolEvents.push({ t: "tool_result", call_id: callId, package_id: tool, outcome: { text: outcome.result?.reply?.text, ...(job ? { pictureJobId: job } : {}) } });
      } catch (error) {
        const known = error instanceof ImageEditError;
        const failure = outcomeOf({ callId, packageId: tool, status: "failed", via: "tool_call", args: proposal.request.args, errorCode: known ? error.code : "edit_failed", failureKind: known && error.status < 500 ? "found_nothing" : known ? "unavailable" : "errored", detail: known ? error.message : undefined, durationMs: 0 });
        outcomes.push(failure);
        toolEvents.push({ t: "tool_error", call_id: callId, package_id: tool, error: lookupFailureKind(failure) });
      }
      continue;
    }
    // LIVE-0923-01 (home/docs/dev.md): the old path's own forced-search
    // call never trusted the model's own `category` argument either
    // (the old engine file's resolveToolCalls() call, noteIgnoredModelWeb
    // searchCategory) - it always computed "images" itself, only when
    // the turn's own intent classifier decided the household wanted a
    // picture, never from what the model proposed. This node passed
    // proposal.request.args straight to runPlugin() with nothing
    // stripping it, so a text question whose model call happened to
    // set category:"images" (observed live, every forced websearch
    // call in one real conversation - policy.ts's own grounding check
    // passes an enum value by design, so nothing else catches this)
    // got SearXNG's image results for a plain question. The new path
    // has no equivalent intent classifier yet (a real gap, not solved
    // here) - stripped unconditionally for now, the same "never trust
    // the model's own category" floor the old path already holds,
    // until a real picture-intent signal exists to set it deliberately.
    //
    // READ-PAGE-01 (home/docs/dev.md, home/docs/BACKLOG.md): the same
    // floor extends to `read_page` - the old path only ever sets it
    // from `pageReadRequested(text)` (the old engine file:3966, "did the
    // person actually ask to read/open the page"), never from the
    // model's own choice; this node passed it through unfiltered too,
    // and it was `true` on every forced call in the same live
    // conversation, the extra page-fetch-and-parse cost landing whether
    // or not the question needed it. Not porting `pageReadRequested`
    // itself (a text-pattern rule, the exact shape the org's own "no
    // hacky rules" standard retires on sight) - stripped the same
    // unconditional way as `category`, measured first
    // (`scripts/bench/read-page-01.ts`) rather than assumed: read_page
    // off must hold reply parity against the bare model on the written
    // set before this becomes the shipped default. `MAIPAI_BENCH_
    // KEEP_READ_PAGE=1` is that bench's own on/off toggle, the same
    // shape `llm.ts`'s `MAIPAI_BENCH_CACHE_PROMPT_FALSE` already uses -
    // never read outside a bench, never a real household setting.
    let args = modelFacingArgs(tool, proposal.request.args);
    // The proposal is accepted the moment this node starts it - before
    // the call actually resolves, so a client's tool timeline shows the
    // step running, not just its eventual outcome.
    // FORM-CHAT-HUB-01 (rule 6a): a package re-run with a form's values bound as inputs puts no args on the stream, and records none.
    const resumedAsk = proposal.redactArgs === true;
    const inspiredVoiceArgs = tool === MAKE_INSPIRED_VOICE_TOOL_ID ? (input.proposals.find((p) => p.request.callId === callId)?.request.args as Record<string, unknown> | undefined) : undefined;
    if ((tool === VOICEOVER_TOOL_ID || tool === CHANGE_VOICE_TOOL_ID) && !proposal.redactArgs) args = { voice: args.voice };
    if (tool === MAKE_INSPIRED_VOICE_TOOL_ID && !proposal.redactArgs) args = { name: args.name, level: args.level };
    // RESEARCH-TIER-01: on a research turn the step row names the search it ran (the model's own query), so the person sees what each round looked into.
    const stepLabel = tool === "websearch" && researchRun !== undefined && typeof (args as { expression?: unknown }).expression === "string" ? (args as { expression: string }).expression.trim().slice(0, 100) : "";
    if (!resumedAsk) toolEvents.push({ t: "tool_call", package_id: tool, call_id: callId, args: tool === MAKE_INSPIRED_VOICE_TOOL_ID ? { name: args.name, level: args.level } : tool === HOUSE_TOOL_ID && isScheduleAction(String(args.action)) ? { action: args.action } : args, ...(stepLabel ? { label: stepLabel } : {}) });
    // ANSWER-IMG-02: show_images acknowledges at once and never runs a package
    // (the picture pipeline was started above, beside the answer).
    if (tool === SHOW_IMAGES_TOOL_ID) {
      const subject = typeof args.subject === "string" ? args.subject.trim() : "";
      const names = showImagesNames(subject, args.subjects);
      const kind = typeof args.kind === "string" ? args.kind.trim().slice(0, 80) : "";
      const permitted = state.answerImagesAllowed && !!state.answerImages;
      let ready = false;
      if (permitted && state.answerImages) ready = await waitForImageLead(state.answerImages.done);
      const pictureEntries = state.answerImages ? [state.answerImages, ...(state.answerImages.extras ?? [])] : [];
      const shownEntries = pictureEntries.filter((entry) => !!entry.block && (entry.result?.visible ?? 0) > 0);
      const missingNames = pictureEntries.filter((entry) => !entry.block || (entry.result?.visible ?? 0) === 0).map((entry) => entry.subject);
      const shown = shownEntries.reduce((count, entry) => count + (entry.result?.visible ?? 0), 0);
      const shownNames = shownEntries.map((entry) => entry.subject);
      const failureKind = !permitted ? "errored" as const : ready && shown === 0 ? answerImageFailureKind(state.answerImages?.trace?.skipped) : undefined;
      const line = !permitted ? SHOW_IMAGES_UNAVAILABLE_LINE
        : !ready ? showImagesPendingResultLine(names.join(", ") || subject)
          : shown === 0 ? names.length > 1 ? showImagesMultiResultLine([], missingNames) : showImagesEmptyResultLine(state.answerImages!.subject, state.answerImages!.trace?.skipped)
            : names.length > 1 ? showImagesMultiResultLine(shownNames, missingNames)
              : showImagesResultLine(state.answerImages!.subject, shown);
      const outcome = outcomeOf({ callId, packageId: tool, status: failureKind ? "failed" : "succeeded", ...(failureKind ? { failureKind, userMessage: line } : {}), via: "tool_call", args: { subject, ...(names.length > 1 ? { subjects: names } : {}), ...(kind ? { kind } : {}) }, result: { reply: { text: line }, actions: [] }, durationMs: 0 });
      outcomes.push(outcome);
      if (failureKind) toolEvents.push({ t: "tool_result", call_id: callId, package_id: tool, outcome: { text: line, error_code: failureKind === "found_nothing" ? "found_nothing" : failureKind } });
      else toolEvents.push({ t: "tool_result", call_id: callId, package_id: tool, outcome: { text: line } });
      continue;
    }

    // STREAM-NEXT-01 (a): the identical "On it." status line
    // the old engine file's own runTurnStream() emits before running a tool
    // (the old engine file:6636) - set only by turnNext.ts's own
    // runTurnNextStream() (state.status is undefined for the immediate/
    // bench callers), so a streamed client sees the tool is running
    // before the search itself starts, not batched into toolEvents until
    // the whole turn is done. The structured tool_call/tool_result/
    // tool_error shape stays the "immediate" result's own field (spec's
    // t-keyed shape, a deliberately separate NDJSON line from wire.ts's
    // TurnStreamEvent) - the old path's own live stream never sent it
    // structured either, only ever this same text line.
    // STATUS-PHRASES-01: a phrase from the active companion's own
    // "searching" set (or the default vocab), never the fixed "On it."
    // - the same conversation-scoped rotation `pickStatusPhrase()`
    // documents (never the same phrase twice running in one
    // conversation). No bundled package declares a `tool_label` yet
    // (a separate, unbuilt gap - the manifest field and its own spec
    // test predate any renderer for it), so this is always a generic
    // phrase today; the seam is here so a real label wins the moment
    // one exists, with no further change at this call site.
    state.status?.emit({ type: "tool_start", package_id: tool });
    state.status?.emit({ type: "status", text: pickStatusPhrase(state.conversationId, toolStatusMoment(tool), state.persona), stage: "tool" });

    // PROJECT-START-01: start_project never goes through runPlugin() -
    // tool.ts's own header explains why (no recipe op for "start a
    // background job and return immediately") - this call itself is
    // synchronous (it only creates the row and launches the runner's own
    // background actor; the project keeps running long after this turn's
    // reply goes out), so there's no deadline race to run it under.
    if (tool === START_PROJECT_TOOL_ID) {
      const outcome = runStartProjectTool({ actor: state.actor, args: args as StartProjectArgs, callId, conversationId: state.conversationId, turnId: state.turnId, temporary: state.temporary, companionId: state.tryDraft ? "default" : state.persona?.id ?? "default" });
      outcomes.push(outcome);
      if (outcome.status === "succeeded") {
        toolEvents.push({ t: "tool_result", call_id: callId, package_id: tool, outcome: { text: outcome.result?.reply?.text } });
      } else {
        toolEvents.push({ t: "tool_error", call_id: callId, package_id: tool, error: lookupFailureKind(outcome) });
      }
      continue;
    }

    // NEWS-DISCUSS-TOOL-2026-10-27: read_item is a virtual tool; the policy node already checked the offer and the reference.
    if (tool === READ_ITEM_TOOL_ID) {
      const outcome = await runReadItemTool({ actor: state.actor, args: args as Record<string, unknown>, callId });
      outcomes.push(outcome);
      if (outcome.status === "succeeded") toolEvents.push({ t: "tool_result", call_id: callId, package_id: tool, outcome: { text: outcome.result?.reply?.text } });
      else toolEvents.push({ t: "tool_error", call_id: callId, package_id: tool, error: lookupFailureKind(outcome) });
      continue;
    }

    // WRITING-FORMATS-03: the format's text for the model; any failure is a plain error string and the turn goes on (rule 6).
    if (tool === WRITING_FORMAT_TOOL_ID) {
      const outcome = runWritingFormatTool({ args: args as Record<string, unknown>, callId });
      outcomes.push(outcome);
      if (outcome.status === "succeeded") toolEvents.push({ t: "tool_result", call_id: callId, package_id: tool, outcome: { text: outcome.result?.reply?.text } });
      else toolEvents.push({ t: "tool_error", call_id: callId, package_id: tool, error: lookupFailureKind(outcome) });
      continue;
    }

    if (tool === VOICEOVER_TOOL_ID || tool === CHANGE_VOICE_TOOL_ID || tool === MAKE_INSPIRED_VOICE_TOOL_ID) {
      const voiceArgs = (proposal.request.args ?? {}) as Record<string, unknown>;
      if (tool === VOICEOVER_TOOL_ID) voiceArgs.script = (input.proposals.find((p) => p.request.callId === callId)?.request.args as Record<string, unknown> | undefined)?.script;
      else if (tool === CHANGE_VOICE_TOOL_ID) voiceArgs.file = (input.proposals.find((p) => p.request.callId === callId)?.request.args as Record<string, unknown> | undefined)?.file;
      if (tool === MAKE_INSPIRED_VOICE_TOOL_ID) Object.assign(voiceArgs, inspiredVoiceArgs ?? {});
      const outcome = tool === VOICEOVER_TOOL_ID
        ? await runVoiceoverTool(state.actor, voiceArgs, callId)
        : tool === CHANGE_VOICE_TOOL_ID ? await runChangeVoiceTool(state.actor, voiceArgs, callId)
          : await runMakeInspiredVoiceTool(state.actor, voiceArgs, callId, state.conversationId, (state.audio ?? []).map(({ id }) => id));
      if (outcome.args && tool !== MAKE_INSPIRED_VOICE_TOOL_ID) outcome.args = { voice: voiceArgs.voice };
      outcomes.push(outcome);
      if (outcome.status === "succeeded") toolEvents.push({ t: "tool_result", call_id: callId, package_id: tool, outcome: { text: outcome.result?.reply?.text } });
      else toolEvents.push({ t: "tool_error", call_id: callId, package_id: tool, error: lookupFailureKind(outcome) });
      continue;
    }

    if (tool === UPTIME_TOOL_ID) {
      const outcome = await runUptimeTool({ actor: state.actor, band: turnAgeBand(state.surface, state.actor, state.speakerEvidence, new Date(), state.deviceId), args: args as Record<string, unknown>, callId });
      outcomes.push(outcome);
      if (outcome.status === "succeeded") toolEvents.push({ t: "tool_result", call_id: callId, package_id: tool, outcome: { text: outcome.result?.reply?.text } });
      else toolEvents.push({ t: "tool_error", call_id: callId, package_id: tool, error: lookupFailureKind(outcome) });
      continue;
    }

    if (tool === HOUSE_TOOL_ID) {
      const tainted = state.context.some((item) => item.source === "search_result" || item.source === "page");
      const outcome = await runHouseTool({ actor: state.actor, band: turnAgeBand(state.surface, state.actor, state.speakerEvidence, new Date(), state.deviceId), args: args as Record<string, unknown>, callId, tainted, approved: callId.startsWith("resumed:") });
      outcomes.push(outcome);
      if (outcome.status === "succeeded") {
        toolEvents.push({ t: "tool_result", call_id: callId, package_id: tool, outcome: { text: outcome.result?.reply?.text } });
        toolEvents.push(...blockEventsFor(state, HOUSE_TOOL_ID, callId, (outcome.result?.data as { blocks?: unknown[] } | undefined)?.blocks, toolEvents));
      } else toolEvents.push({ t: "tool_error", call_id: callId, package_id: tool, error: lookupFailureKind(outcome) });
      continue;
    }

    // MUSIC-LIKE-01: make_band writes the band, then starts its picture and song jobs; the policy node checked the offer and the reference.
    if (tool === MAKE_BAND_TOOL_ID) {
      const outcome = await runMakeBand({ state, args: args as Record<string, unknown>, callId, spoken: (state.planBasis?.surfaceClass ?? "spoken") !== "written" });
      outcomes.push(outcome);
      const data = outcome.result?.data as { musicJobId?: string } | undefined;
      if (outcome.status === "succeeded") {
        toolEvents.push({ t: "tool_result", call_id: callId, package_id: tool, outcome: { text: outcome.result?.reply?.text, ...(data?.musicJobId ? { musicJobId: data.musicJobId } : {}) } });
        // The band card is an answer block like any package's: it passes the same manifest allowlist, age band and floor.
        toolEvents.push(...blockEventsFor(state, tool, callId, (outcome.result as { blocks?: unknown } | undefined)?.blocks, toolEvents));
      } else toolEvents.push({ t: "tool_error", call_id: callId, package_id: tool, error: lookupFailureKind(outcome) });
      continue;
    }

    // MUSIC-STUDIO-EDIT: make_album, make_song_style and the three edit tools; the policy node checked the offer and the object.
    if (isStudioTool(tool)) {
      const outcome = await runStudioTool(tool, { state, args: args as Record<string, unknown>, callId, spoken: (state.planBasis?.surfaceClass ?? "spoken") !== "written" });
      outcomes.push(outcome);
      const data = outcome.result?.data as { musicJobId?: string } | undefined;
      if (outcome.status === "succeeded") {
        toolEvents.push({ t: "tool_result", call_id: callId, package_id: tool, outcome: { text: outcome.result?.reply?.text, ...(data?.musicJobId ? { musicJobId: data.musicJobId } : {}) } });
        toolEvents.push(...blockEventsFor(state, tool, callId, (outcome.result as { blocks?: unknown } | undefined)?.blocks, toolEvents));
      } else toolEvents.push({ t: "tool_error", call_id: callId, package_id: tool, error: lookupFailureKind(outcome) });
      continue;
    }

    // MUSIC-GEN-03: both music tools start a Stack job and return its card id at once.
    if (tool === GENERATE_MUSIC_TOOL_ID || tool === EDIT_MUSIC_TOOL_ID || tool === MAKE_SOUND_TOOL_ID) {
      const outcome = redactLockedMusicOutcome(state.actor, await (tool === EDIT_MUSIC_TOOL_ID ? runEditMusic : tool === MAKE_SOUND_TOOL_ID ? runMakeSound : runGenerateMusic)({ state, args: args as Record<string, unknown>, callId, spoken: (state.planBasis?.surfaceClass ?? "spoken") !== "written" }));
      outcomes.push(outcome);
      const data = outcome.result?.data as { musicJobId?: string } | undefined;
      if (outcome.status === "succeeded") toolEvents.push({ t: "tool_result", call_id: callId, package_id: tool, outcome: { text: outcome.result?.reply?.text ?? LOCKED_MUSIC_RESULT_TEXT, ...(data?.musicJobId ? { musicJobId: data.musicJobId } : {}) } });
      else toolEvents.push({ t: "tool_error", call_id: callId, package_id: tool, error: lookupFailureKind(outcome) });
      continue;
    }

    // VIDEO-GEN-05: the card follows the job after this call returns.
    if (tool === GENERATE_VIDEO_TOOL_ID || tool === EDIT_VIDEO_TOOL_ID) {
      // ADULT-LOCK-02: a locked item's outcome is stored as a placeholder (no prompt, styles or file ids), and so is what the wire carries.
      const outcome = redactLockedVideoOutcome(state.actor, await (tool === EDIT_VIDEO_TOOL_ID ? runEditVideo : runGenerateVideo)({ state, args: args as Record<string, unknown>, callId, spoken: (state.planBasis?.surfaceClass ?? "spoken") !== "written" }));
      outcomes.push(outcome);
      if (outcome.status === "succeeded") toolEvents.push({ t: "tool_result", call_id: callId, package_id: tool, outcome: { text: outcome.result?.reply?.text } });
      else toolEvents.push({ t: "tool_error", call_id: callId, package_id: tool, error: lookupFailureKind(outcome) });
      continue;
    }

    if (tool === MAKE_FILM_TOOL_ID) {
      const filmInput = { state, args: args as Record<string, unknown>, callId, spoken: (state.planBasis?.surfaceClass ?? "spoken") !== "written" };
      const outcome = isProductionCall(filmInput.args) ? await runMakeProduction(filmInput) : await runMakeFilmTurn(filmInput);
      outcomes.push(outcome);
      if (outcome.status === "succeeded") toolEvents.push({ t: "tool_result", call_id: callId, package_id: tool, outcome: { text: outcome.result?.reply?.text } });
      else toolEvents.push({ t: "tool_error", call_id: callId, package_id: tool, error: lookupFailureKind(outcome) });
      continue;
    }

    // REFVIDEO-01: pictures become a reference sheet, the sheet shows on the video card, and the clip is one job.
    if (tool === MAKE_REFERENCE_VIDEO_TOOL_ID) {
      const outcome = await runMakeReferenceVideoTurn({ state, args: args as Record<string, unknown>, callId, spoken: (state.planBasis?.surfaceClass ?? "spoken") !== "written" });
      outcomes.push(outcome);
      if (outcome.status === "succeeded") toolEvents.push({ t: "tool_result", call_id: callId, package_id: tool, outcome: { text: outcome.result?.reply?.text } });
      else toolEvents.push({ t: "tool_error", call_id: callId, package_id: tool, error: lookupFailureKind(outcome) });
      continue;
    }

    // IMGGEN-HOME-01: the picture tool starts a Stack job and answers at once; the card on the thread follows the job.
    // It never goes through runPlugin() (the package holds its description and arguments; this is its one runner).
    if (tool === GENERATE_IMAGE_TOOL_ID) {
      const outcome = await runGenerateImage({ state, args: args as Record<string, unknown>, callId, spoken: (state.planBasis?.surfaceClass ?? "spoken") !== "written", signal });
      outcomes.push(outcome);
      if (outcome.status === "succeeded") toolEvents.push({ t: "tool_result", call_id: callId, package_id: tool, outcome: { text: outcome.result?.reply?.text } });
      else toolEvents.push({ t: "tool_error", call_id: callId, package_id: tool, error: lookupFailureKind(outcome) });
      continue;
    }

    // THIN-4A (rule 7): a search gives the model the result pages, so the
    // node asks for them itself; the model never chooses it (the wire
    // events above keep the model's own filtered args).
    // THIN-4F: a spoken turn reads fewer pages with less text each.
    const spokenSearch = (state.planBasis?.surfaceClass ?? "spoken") === "spoken";
    // SEARCH-DDGS-TEEN-01: the host's `spoken` (a minor's ddgs lock) is true for every surface that is not a plain written one, so the
    // shared glance screen is held to SearXNG only too, and an unplanned turn counts as spoken.
    // RESEARCH-TIER-01 (owner ruling 2026-11-01): one question runs at most 12 searches, however many a round asks for.
    if (tool === "websearch" && researchRun && researchRun.searches >= RESEARCH_SEARCHES_MAX) {
      outcomes.push(outcomeOf({ callId, packageId: tool, status: "failed", via: "tool_call", args, errorCode: "search_budget", durationMs: 0, failureKind: "found_nothing" }));
      toolEvents.push({ t: "tool_error", call_id: callId, package_id: tool, error: "found_nothing" });
      continue;
    }
    // RESEARCH-TIER-01: a search that repeats an earlier one of this turn is not issued; the round records it as found nothing new.
    const priorQueries = tool === "websearch" && researchRun ? [...state.outcomes, ...outcomes].filter((o) => o.packageId === "websearch").map((o) => String((o.args as { expression?: unknown } | undefined)?.expression ?? "")) : [];
    if (tool === "websearch" && researchRun && isRepeatQuery(priorQueries, String((args as { expression?: unknown }).expression ?? ""))) {
      const repeat = outcomeOf({ callId, packageId: tool, status: "failed", via: "tool_call", args, errorCode: "repeat_query", durationMs: 0, failureKind: "found_nothing" });
      outcomes.push(repeat);
      toolEvents.push({ t: "tool_error", call_id: callId, package_id: tool, error: "found_nothing" });
      continue;
    }
    // RESEARCH-QUERY-01: a research search built on a name or year from the model's memory (nothing has shown it yet) runs without it,
    // so the search finds the subject first and the next round builds on what the sources show. The next round is told (errorCode on the
    // outcome is not set: the search itself ran).
    let queryRewritten = false;
    if (tool === "websearch" && researchRun) {
      // RESEARCH-PIN-01: a research search is plain keywords naming the pinned subject (its name and years), at most eight words.
      const anchor = state.entityAnchor ?? null;
      const anchored = anchorQuery(String((args as { expression?: unknown }).expression ?? ""), anchor);
      if (anchored !== "") args = { ...(args as Record<string, unknown>), expression: anchored };
      const asked = String((args as { expression?: unknown }).expression ?? "");
      // The pinned article's title and opening are words a search may carry; only a name or year from the model's own memory is held back.
      const allowed = `${state.utterance}\n${anchor?.text ?? ""}\n${researchEvidence([...state.outcomes, ...outcomes])}`;
      if (memoryDetailsIn(asked, allowed).length > 0) {
        const cleaned = withoutMemoryDetails(asked, allowed);
        if (cleaned.length < 4) {
          outcomes.push(outcomeOf({ callId, packageId: tool, status: "failed", via: "tool_call", args, errorCode: "memory_query", durationMs: 0, failureKind: "found_nothing" }));
          toolEvents.push({ t: "tool_error", call_id: callId, package_id: tool, error: "found_nothing" });
          continue;
        }
        args = { ...(args as Record<string, unknown>), expression: cleaned };
        queryRewritten = true;
      }
    }
    // Max with the admin's web switch off keeps its first search ordinary and searches the offline library after that.
    const libraryOnlyNow = tool === "websearch" && researchRun?.libraryOnly === true && researchRun.searches > 0;
    // Research goes past the offline library's overview: after its first search, a research turn searches the web (a live run
    // showed the model choosing the library every round and getting only an encyclopedia page).
    const webNow = tool === "websearch" && researchRun !== undefined && researchRun.libraryOnly !== true && (researchRun.searches > 0 || state.answerStyle === "max");
    if (tool === "websearch" && researchRun) researchRun.searches += 1;
    const runArgs = tool === "websearch" ? { ...(args as Record<string, unknown>), read_page: true, ...(spokenSearch ? { spoken: true } : {}), ...(libraryOnlyNow ? { scope: "reference" } : webNow ? { scope: "web" } : {}) } : args;
    const startedAt = Date.now();
    // PLACE-WEATHER-01: the host resolves the place and injects coordinates; the
    // model's own args (and so the stored call) carry only the place it named.
    let hostInputs: Record<string, unknown> | undefined;
    let uncached = false;
    let weatherArgs: Record<string, unknown> | undefined;
    if (tool === "weather") {
      // WEATHER-KID-01: an unknown robot speaker is not the signed-in person, so the place is the household home, never that person's own saved place.
      const weatherPlace = await resolveWeatherPlace({ person: speakerIsAnonymous(state) ? null : state.actor, ...(speakerIsAnonymous(state) ? { band: turnAgeBand(state.surface, state.actor, state.speakerEvidence, new Date(), state.deviceId) } : {}), named: (args as Record<string, unknown>).place, current: state.currentLocation });
      if (weatherPlace) {
        weatherArgs = { ...(args as Record<string, unknown>), place: weatherPlace.place };
        hostInputs = weatherPlace.hostInputs;
        uncached = weatherPlace.uncached;
      }
    }
    if (researchRun && tool === "websearch") markResearch(state, `search ${researchRun.searches} start`);
    const raced = await withDeadline(researchRun ? runWithResearchBudget(researchRun, () => runPlugin(tool, state.actor, weatherArgs ?? runArgs, { id: state.turnId, conversationId: state.conversationId, userText: state.utterance }, { signal, deadlineAt: input.deadlineAt, spoken: (state.planBasis?.surfaceClass ?? "spoken") !== "written", band: turnAgeBand(state.surface, state.actor, state.speakerEvidence, new Date(), state.deviceId), ...(hostInputs ? { hostInputs, uncached } : {}) })) : runPlugin(tool, state.actor, weatherArgs ?? runArgs, { id: state.turnId, conversationId: state.conversationId, userText: state.utterance }, { signal, deadlineAt: input.deadlineAt, spoken: (state.planBasis?.surfaceClass ?? "spoken") !== "written", band: turnAgeBand(state.surface, state.actor, state.speakerEvidence, new Date(), state.deviceId), ...(hostInputs ? { hostInputs, uncached } : {}) }), signal);
    const durationMs = Date.now() - startedAt;
    if (researchRun && tool === "websearch") markResearch(state, `search ${researchRun.searches} end (${raced === "deadline" ? "deadline" : "done"}, ${durationMs} ms)`);
    if (raced === "deadline") {
      const outcome = outcomeOf({ callId, packageId: tool, status: "failed", via: resumedAsk ? "ask" : "tool_call", ...(resumedAsk ? {} : { args }), errorCode: "deadline_exceeded", durationMs, failureKind: "timed_out", detail: "the tool deadline passed before the call returned" });
      outcomes.push(outcome);
      toolEvents.push({ t: "tool_error", call_id: callId, package_id: tool, error: outcome.failureKind! });
      if (researchRun && tool === "websearch" && !resumedAsk) emptySearches.push({ index: outcomes.length - 1, callId, args: args as Record<string, unknown>, runArgs });
      continue;
    }
    const result = raced;
    // FORM-CHAT-HUB-01: a typed ask is drawn as a form for an adult speaker on their own written chat only. Anyone else (a
    // minor, an unknown speaker, a temporary or ephemeral chat, a malformed ask) gets the package's text prompt: the fields
    // are dropped and the result goes on as an ordinary one. An ask without fields is never touched.
    let finalValue = result.ok ? result.value : undefined;
    if (result.ok && (result.value as { ask?: { fields?: unknown } }).ask?.fields !== undefined) {
      const validated = PluginResult.safeParse(result.value);
      const ask = validated.success ? validated.data.ask : undefined;
      const formAllowed = ask?.fields !== undefined && ask.min_band !== undefined
        && turnAgeBand(state.surface, state.actor, state.speakerEvidence, new Date(), state.deviceId) === "adult"
        && state.surface === "chat" && state.planBasis?.surfaceClass !== "spoken" && !state.temporary && !state.ephemeral && !speakerIsAnonymous(state);
      if (ask?.fields && formAllowed) {
        // The parked ask holds the model's own arguments (as a confirm does) so the package can run again; the person's values
        // are never stored. No outcome is recorded for the pause (rule 6a), and the turn ends here with the prompt.
        state.ask = { kind: "ask", prompt: ask.prompt ?? "Please fill in these details.", packageId: tool, args, fields: ask.fields as TurnAskField[], minBand: ask.min_band, actorId: state.actor.id, expiresAt: new Date(Date.now() + ASK_FORM_TTL_MS).toISOString() };
        continue;
      }
      finalValue = sanitizeAskResult(result.value);
    }
    const outcome = outcomeOf({
      callId,
      packageId: tool,
      status: result.ok ? "succeeded" : "failed",
      via: resumedAsk ? "ask" : "tool_call",
      ...(resumedAsk ? {} : { args }),
      ...(queryRewritten ? { queryRewritten: true } : {}),
      result: finalValue,
      // SEARCH-EMPTY-01: this carried only the numeric HTTP-style
      // status, never the semantic HostError code a real caller (a
      // replay bench filtering on `search_unavailable`, e.g.) actually
      // wants. Fixed to `the old engine file`'s own established pattern
      // (`(result as {code?:string}).code ?? String(result.status)`,
      // six call sites there) rather than `commands.ts`'s simpler
      // `result.code` alone (a review, 2026-09-24, caught that the
      // simpler form silently loses the guarantee of a defined
      // `errorCode` for the non-HostError failure branches of
      // `runPlugin()` - arg validation, role checks - that never set
      // `.code` at all; `commands.ts` carrying the same gap is a
      // pre-existing, separate finding, not fixed here).
      errorCode: result.ok ? undefined : (result.code ?? String(result.status)),
      durationMs,
      // R2: the raw error text is the admin-only `detail`, never a `userMessage`.
      failureKind: result.ok ? undefined : failureKindOf(result.code),
      detail: result.ok ? undefined : resumedAsk ? "package failed after a form submission" : result.error.slice(0, MAX_DETAIL_CHARS),
    });
    outcomes.push(outcome);
    if (researchRun && tool === "websearch" && !resumedAsk && (result.ok ? (outcome.sources?.length ?? 0) === 0 : outcome.failureKind !== "timed_out")) emptySearches.push({ index: outcomes.length - 1, callId, args: args as Record<string, unknown>, runArgs });
    if (result.ok) {
      // TOOL-EVENTS-02: the same sites `outcome.sources` already carries
      // (sourcesFromRows, turnContext.ts) for the reply's own citation
      // list - reused here, not recomputed. Sliced to the wire schema's
      // own hard cap (`TOOL_RESULT_SITES_MAX`, spec's turn-stream-event.
      // ts - the schema itself refuses a longer array), which is tighter
      // than `sourcesFromRows`' own cap of 8: a search whose SearXNG
      // response has 6-8 rows shows fewer chips under the step than the
      // reply's own Sources card lists below it - a code review
      // (2026-09-24) caught an earlier version of this comment claiming
      // the two "can never disagree," which only holds up to five rows.
      const sites = outcome.sources?.slice(0, TOOL_RESULT_SITES_MAX).map((s) => ({ host: s.site, url: s.url }));
      if (!resumedAsk) toolEvents.push({ t: "tool_result", call_id: callId, package_id: tool, outcome: { text: result.value.reply?.text, ...(sites?.length ? { sites } : {}) } });
      // GENUI-02: blocks are independently validated and filtered after
      // the package result lands. They follow their tool_result in call
      // order and precede the phrasing round's first streamed prose delta.
      const packageBlocks = (result.value as typeof result.value & { blocks?: unknown }).blocks;
      toolEvents.push(...blockEventsFor(state, tool, callId, packageBlocks, toolEvents));
    } else {
      toolEvents.push({ t: "tool_error", call_id: callId, package_id: tool, error: outcome.failureKind! });
    }
  }
  if (researchRun && emptySearches.length > 0) await retryEmptySearches(state, researchRun, emptySearches, outcomes, toolEvents, input.deadlineAt, signal);
  // THIN-4C: how many fetched rows and pages the minor floor dropped this
  // turn, counted on the trace (never their text).
  const droppedByFloor = outcomes.reduce((sum, o) => sum + (o.status === "succeeded" ? Number((o.result?.data as { floor_dropped?: unknown } | undefined)?.floor_dropped) || 0 : 0), 0);
  return { outcome: droppedByFloor > 0 ? { ok: true, dropped_by_floor: droppedByFloor } : { ok: true }, output: { outcomes, toolEvents } };
};
