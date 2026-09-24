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
import type { Node, ActionProposal, ToolExecutionOutcome } from "../contract";
import type { TurnStreamEvent as ToolStreamEvent } from "@maipai/spec/stack/ts/turn-stream-event.js";

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
      errorCode: result.ok ? undefined : String(result.status),
      userMessage: result.ok ? undefined : result.error,
    });
    outcomes.push(outcome);
    if (result.ok) {
      toolEvents.push({ t: "tool_result", call_id: callId, package_id: tool, outcome: { text: result.value.reply?.text } });
    } else {
      toolEvents.push({ t: "tool_error", call_id: callId, package_id: tool, error: outcome.userMessage! });
    }
  }
  return { outcome: { ok: true }, output: { outcomes, toolEvents } };
};
