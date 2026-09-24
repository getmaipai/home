// U2c, the `tool` node (turn-machine-state-record-2026-09-22.md's state
// table): "runPlugin under the tool deadline; the outcome recorded in
// model order." runPlugin() itself takes no signal (a real gap, same
// class as LLM-TIMEOUT-01's chatComplete gap - noted, not solved here);
// this node enforces its own deadline at its own boundary with
// Promise.race against the node's signal, so a wedged package still
// returns a "tool" outcome and the machine moves on, even though the
// underlying call keeps running unobserved until it finishes or the
// process exits.
import { runPlugin } from "@/lib/plugins";
import { outcomeOf } from "@/lib/turnContext";
import { pickStatusPhrase } from "@/lib/statusPhrases";
import type { Node, ActionProposal, ToolExecutionOutcome } from "../contract";
import { TOOL_RESULT_SITES_MAX, type TurnStreamEvent as ToolStreamEvent } from "@maipai/spec/stack/ts/turn-stream-event.js";

export interface ToolInput {
  proposals: readonly ActionProposal[];
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

export const toolNode: Node<ToolInput, ToolOutput> = async (state, input, signal) => {
  const outcomes: ToolExecutionOutcome[] = [];
  const toolEvents: ToolStreamEvent[] = [];
  for (const proposal of input.proposals) {
    const { tool, callId } = proposal.request;
    // LIVE-0923-01 (home/docs/dev.md): the old path's own forced-search
    // call never trusted the model's own `category` argument either
    // (turnEngine.ts's resolveToolCalls() call, noteIgnoredModelWeb
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
    // from `pageReadRequested(text)` (turnEngine.ts:3966, "did the
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
    const stripKeys = new Set(["category", ...(process.env.MAIPAI_BENCH_KEEP_READ_PAGE === "1" ? [] : ["read_page"])]);
    const args = tool === "websearch" ? Object.fromEntries(Object.entries(proposal.request.args).filter(([k]) => !stripKeys.has(k))) : proposal.request.args;
    // The proposal is accepted the moment this node starts it - before
    // the call actually resolves, so a client's tool timeline shows the
    // step running, not just its eventual outcome.
    toolEvents.push({ t: "tool_call", package_id: tool, call_id: callId, args });
    // STREAM-NEXT-01 (a): the identical "On it." status line
    // turnEngine.ts's own runTurnStream() emits before running a tool
    // (turnEngine.ts:6636) - set only by turnNext.ts's own
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
    state.status?.emit({ type: "status", text: pickStatusPhrase(state.conversationId, "searching", state.persona), stage: "tool" });
    const raced = await withDeadline(runPlugin(tool, state.actor, args, { id: state.turnId, conversationId: state.conversationId }), signal);
    if (raced === "deadline") {
      const outcome = outcomeOf({ callId, packageId: tool, status: "failed", via: "tool_call", args, errorCode: "deadline_exceeded", userMessage: "That took too long, sorry." });
      outcomes.push(outcome);
      toolEvents.push({ t: "tool_error", call_id: callId, package_id: tool, error: outcome.userMessage! });
      continue;
    }
    const result = raced;
    const outcome = outcomeOf({
      callId,
      packageId: tool,
      status: result.ok ? "succeeded" : "failed",
      via: "tool_call",
      args,
      result: result.ok ? result.value : undefined,
      // SEARCH-EMPTY-01: this carried only the numeric HTTP-style
      // status, never the semantic HostError code a real caller (a
      // replay bench filtering on `search_unavailable`, e.g.) actually
      // wants. Fixed to `turnEngine.ts`'s own established pattern
      // (`(result as {code?:string}).code ?? String(result.status)`,
      // six call sites there) rather than `commands.ts`'s simpler
      // `result.code` alone (a review, 2026-09-24, caught that the
      // simpler form silently loses the guarantee of a defined
      // `errorCode` for the non-HostError failure branches of
      // `runPlugin()` - arg validation, role checks - that never set
      // `.code` at all; `commands.ts` carrying the same gap is a
      // pre-existing, separate finding, not fixed here).
      errorCode: result.ok ? undefined : (result.code ?? String(result.status)),
      userMessage: result.ok ? undefined : result.error,
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
      toolEvents.push({ t: "tool_result", call_id: callId, package_id: tool, outcome: { text: result.value.reply?.text, ...(sites?.length ? { sites } : {}) } });
    } else {
      toolEvents.push({ t: "tool_error", call_id: callId, package_id: tool, error: outcome.userMessage! });
    }
  }
  return { outcome: { ok: true }, output: { outcomes, toolEvents } };
};
