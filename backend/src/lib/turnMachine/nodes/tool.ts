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

export interface ToolInput {
  proposals: readonly ActionProposal[];
}

export interface ToolOutput {
  outcomes: ToolExecutionOutcome[];
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
  for (const proposal of input.proposals) {
    const { tool, args, callId } = proposal.request;
    const raced = await withDeadline(runPlugin(tool, state.actor, args, { id: state.turnId, conversationId: state.conversationId }), signal);
    if (raced === "deadline") {
      outcomes.push(outcomeOf({ callId, packageId: tool, status: "failed", via: "tool_call", args, errorCode: "deadline_exceeded", userMessage: "That took too long, sorry." }));
      continue;
    }
    const result = raced;
    outcomes.push(
      outcomeOf({
        callId,
        packageId: tool,
        status: result.ok ? "succeeded" : "failed",
        via: "tool_call",
        args,
        result: result.ok ? result.value : undefined,
        errorCode: result.ok ? undefined : String(result.status),
        userMessage: result.ok ? undefined : result.error,
      }),
    );
  }
  return { outcome: { ok: true }, output: { outcomes } };
};
