import { GENERATE_MUSIC_TOOL_ID, EDIT_MUSIC_TOOL_ID, runGenerateMusic, runEditMusic } from "@/lib/music/tool";
// U2c, the `tool` node (turn-machine-state-record-2026-09-22.md's state
// table): "runPlugin under the tool deadline; the outcome recorded in
// model order." The node's signal reaches runPlugin() so search requests
// stop at cancellation; the race still records a timeout if a package
// ignores the signal.
import { runPlugin } from "@/lib/plugins";
import { PluginResult } from "@maipai/spec/gen/ts/result.js";
import { ASK_FORM_TTL_MS } from "@/lib/askForm";
import type { TurnAskField } from "@/wire";
import { resolveWeatherPlace } from "@/lib/places";
import { blockEventsFor } from "../blockEvents";
import { outcomeOf, type FailureKind } from "@/lib/turnContext";
import { lookupFailureKind } from "./lookupFallback";
import { pickStatusPhrase } from "@/lib/statusPhrases";
import { READ_ITEM_TOOL_ID, runReadItemTool } from "@/lib/items/tool";
import { START_PROJECT_TOOL_ID, runStartProjectTool, type StartProjectArgs } from "@/lib/projects/tool";
import { SHOW_IMAGES_TOOL_ID, SHOW_IMAGES_UNAVAILABLE_LINE, answerImageFailureKind, showImagesEmptyResultLine, showImagesMultiResultLine, showImagesNames, showImagesPendingResultLine, showImagesResultLine, startAnswerImages } from "@/lib/answerImages/turn";
import { GENERATE_IMAGE_TOOL_ID, runGenerateImage } from "@/lib/pictures/tool";
import { GENERATE_VIDEO_TOOL_ID, runGenerateVideo } from "@/lib/videos/tool";
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

export const toolNode: Node<ToolInput, ToolOutput> = async (state, input, signal) => {
  const outcomes: ToolExecutionOutcome[] = [];
  const toolEvents: ToolStreamEvent[] = [];
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
    const args = modelFacingArgs(tool, proposal.request.args);
    // The proposal is accepted the moment this node starts it - before
    // the call actually resolves, so a client's tool timeline shows the
    // step running, not just its eventual outcome.
    // FORM-CHAT-HUB-01 (rule 6a): a package re-run with a form's values bound as inputs puts no args on the stream, and records none.
    const resumedAsk = proposal.redactArgs === true;
    if (!resumedAsk) toolEvents.push({ t: "tool_call", package_id: tool, call_id: callId, args });
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

    // MUSIC-GEN-03: both music tools start a Stack job and return its card id at once.
    if (tool === GENERATE_MUSIC_TOOL_ID || tool === EDIT_MUSIC_TOOL_ID) {
      const outcome = await (tool === EDIT_MUSIC_TOOL_ID ? runEditMusic : runGenerateMusic)({ state, args: args as Record<string, unknown>, callId, spoken: (state.planBasis?.surfaceClass ?? "spoken") !== "written" });
      outcomes.push(outcome);
      const data = outcome.result?.data as { musicJobId?: string } | undefined;
      if (outcome.status === "succeeded") toolEvents.push({ t: "tool_result", call_id: callId, package_id: tool, outcome: { text: outcome.result?.reply?.text, ...(data?.musicJobId ? { musicJobId: data.musicJobId } : {}) } });
      else toolEvents.push({ t: "tool_error", call_id: callId, package_id: tool, error: lookupFailureKind(outcome) });
      continue;
    }

    // VIDEO-GEN-05: the card follows the job after this call returns.
    if (tool === GENERATE_VIDEO_TOOL_ID) {
      const outcome = await runGenerateVideo({ state, args: args as Record<string, unknown>, callId, spoken: (state.planBasis?.surfaceClass ?? "spoken") !== "written" });
      outcomes.push(outcome);
      if (outcome.status === "succeeded") toolEvents.push({ t: "tool_result", call_id: callId, package_id: tool, outcome: { text: outcome.result?.reply?.text } });
      else toolEvents.push({ t: "tool_error", call_id: callId, package_id: tool, error: lookupFailureKind(outcome) });
      continue;
    }

    // IMGGEN-HOME-01: the picture tool starts a Stack job and answers at once; the card on the thread follows the job.
    // It never goes through runPlugin() (the package holds its description and arguments; this is its one runner).
    if (tool === GENERATE_IMAGE_TOOL_ID) {
      const outcome = await runGenerateImage({ state, args: args as Record<string, unknown>, callId, spoken: (state.planBasis?.surfaceClass ?? "spoken") !== "written" });
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
    const runArgs = tool === "websearch" ? { ...(args as Record<string, unknown>), read_page: true, ...(spokenSearch ? { spoken: true } : {}) } : args;
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
    const raced = await withDeadline(runPlugin(tool, state.actor, weatherArgs ?? runArgs, { id: state.turnId, conversationId: state.conversationId, userText: state.utterance }, { signal, deadlineAt: input.deadlineAt, spoken: (state.planBasis?.surfaceClass ?? "spoken") !== "written", band: turnAgeBand(state.surface, state.actor, state.speakerEvidence, new Date(), state.deviceId), ...(hostInputs ? { hostInputs, uncached } : {}) }), signal);
    const durationMs = Date.now() - startedAt;
    if (raced === "deadline") {
      const outcome = outcomeOf({ callId, packageId: tool, status: "failed", via: resumedAsk ? "ask" : "tool_call", ...(resumedAsk ? {} : { args }), errorCode: "deadline_exceeded", durationMs, failureKind: "timed_out", detail: "the tool deadline passed before the call returned" });
      outcomes.push(outcome);
      toolEvents.push({ t: "tool_error", call_id: callId, package_id: tool, error: outcome.failureKind! });
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
  // THIN-4C: how many fetched rows and pages the minor floor dropped this
  // turn, counted on the trace (never their text).
  const droppedByFloor = outcomes.reduce((sum, o) => sum + (o.status === "succeeded" ? Number((o.result?.data as { floor_dropped?: unknown } | undefined)?.floor_dropped) || 0 : 0), 0);
  return { outcome: droppedByFloor > 0 ? { ok: true, dropped_by_floor: droppedByFloor } : { ok: true }, output: { outcomes, toolEvents } };
};
