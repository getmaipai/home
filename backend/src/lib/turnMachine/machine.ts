// U2b (docs/plans/turn-machine-state-record-2026-09-22.md, "The
// machine"): XState v5 runs the sequencing (ARCH-BUILD-01's verdict,
// dev.md); every node's own semantics live in nodes/*.ts, never here.
// This file is the state table translated directly: one XState state
// per row, invoke wraps the node call (runNode() below owns the
// deadline and the trace entry, both section 11's own requirements),
// and every transition matches the table's own "Exits" column.
import { setup, fromPromise, assign } from "xstate";
import type { TurnState, NodeName, NodeOutcome, ActionProposal } from "./contract";

type NodeFn<In, Out> = (state: TurnState, input: In, signal: AbortSignal) => Promise<{ outcome: NodeOutcome; output: Out }>;
import { TraceRecorder } from "./trace";
import { nodeSignal } from "./deadline";
import { safetyNode, applySafety, safetyRoute, type SafetyOutput } from "./nodes/safety";
import { commandsNode, type CommandsOutput } from "./nodes/commands";
import { contextNode, applyContext, type ContextOutput } from "./nodes/context";
import { modelNode, ANSWER_FROM_CONTEXT_TOOL_ID, type ModelOutput } from "./nodes/model";
import { policyNode, type PolicyOutput, type PolicyEntry } from "./nodes/policy";
import { toolNode, type ToolOutput } from "./nodes/tool";
import { answerNode, type AnswerInput, type AnswerOutput, type PolicyRefusedReason } from "./nodes/answer";
import { outputGateNode, type OutputGateOutput } from "./nodes/outputGate";

const IMPL_VERSION = "1";

/** Every invoke goes through this: starts the clock, builds this node's
 * own deadline signal chained off the turn's overall abort (deadline.ts),
 * calls the real node function, and always records one NodeExecution -
 * a thrown error becomes an `{ok: false}` outcome, never a silently
 * missing trace row (section 11: "one NodeExecution per node that ran
 * or was skipped"). */
async function runNode<In, Out>(trace: TraceRecorder, node: NodeName, deadlineMs: number, turnState: TurnState, parentSignal: AbortSignal, input: In, fn: NodeFn<In, Out>): Promise<Out> {
  const startMs = Date.now();
  const { signal, clear } = nodeSignal(parentSignal, deadlineMs);
  try {
    const { outcome, output } = await fn(turnState, input, signal);
    trace.record(node, node, IMPL_VERSION, startMs, Date.now(), outcome);
    turnState.nodes = trace.nodes();
    return output;
  } catch (err) {
    trace.record(node, node, IMPL_VERSION, startMs, Date.now(), { ok: false, code: err instanceof Error ? err.name || "error" : "error" });
    turnState.nodes = trace.nodes();
    throw err;
  } finally {
    clear();
  }
}

export interface MachineInput {
  turnState: TurnState;
  abortSignal: AbortSignal;
  /** Set only when turnNext.ts resumed a confirmed pending ask - the
   * continuation still runs `safety` first (the state record's own
   * order) and reaches `commands`/`context`/`model` unless turnNext.ts
   * itself short-circuits to `policy` directly; carried here so
   * `policy`'s own actor can pass it through even on that shorter
   * path without a second machine definition. */
  preConfirmed?: ActionProposal;
}

interface MachineContext {
  turnState: TurnState;
  trace: TraceRecorder;
  abortSignal: AbortSignal;
  preConfirmed?: ActionProposal;
  roundsUsed: number;
  // Set once by `answer_from_context_check`'s own ungrounded-quote
  // branch, read once by the model actor's next invocation, then never
  // again this turn - guarantees the retry it forces cannot itself
  // loop back through the same check (model.ts's own forceSearchOnly
  // never offers answer_from_this_conversation).
  forceSearchOnly: boolean;
  // The last node's raw output, read by that state's own guarded
  // transitions - one shared slot rather than one typed field per
  // node, since only ever one is live at a time (the machine is
  // sequential, never parallel across nodes).
  step: unknown;
}

function proposalsFrom(policy: PolicyOutput): { toRun: ActionProposal[]; parkedAsk: { prompt: string; proposal: ActionProposal } | null } {
  const toRun: ActionProposal[] = [];
  let parkedAsk: { prompt: string; proposal: ActionProposal } | null = null;
  for (const { proposal, decision } of policy.entries) {
    if (decision.allow) toRun.push(proposal);
    else if ((decision.reason === "consent_needed" || decision.reason === "confirm_needed") && decision.ask) parkedAsk = { prompt: decision.ask.prompt, proposal };
  }
  return { toRun, parkedAsk };
}

export const turnMachine = setup({
  types: {} as {
    context: MachineContext;
    input: MachineInput;
  },
  actors: {
    safety: fromPromise<SafetyOutput, MachineContext>(({ input }) => runNode(input.trace, "safety", input.turnState.budget.deadlines_ms.model, input.turnState, input.abortSignal, { utterance: input.turnState.utterance }, safetyNode)),
    commands: fromPromise<CommandsOutput, MachineContext>(({ input }) => runNode(input.trace, "commands", input.turnState.budget.deadlines_ms.model, input.turnState, input.abortSignal, { utterance: input.turnState.utterance }, commandsNode)),
    context: fromPromise<ContextOutput, MachineContext & { temporary?: boolean }>(({ input }) => runNode(input.trace, "context", input.turnState.budget.deadlines_ms.model, input.turnState, input.abortSignal, { utterance: input.turnState.utterance, temporary: input.temporary }, contextNode)),
    model: fromPromise<ModelOutput, MachineContext>(({ input }) =>
      runNode(
        input.trace,
        "model",
        input.turnState.budget.deadlines_ms.model,
        input.turnState,
        input.abortSignal,
        { utterance: input.turnState.utterance, toolsAllowed: input.turnState.budget.model_transitions && input.roundsUsed < input.turnState.budget.rounds, forceSearchOnly: input.forceSearchOnly },
        modelNode,
      ),
    ),
    policy: fromPromise<PolicyOutput, MachineContext>(({ input }) => {
      const calls = (input.step as { kind: "tool_calls"; calls: import("./contract").ToolCall[] }).calls;
      return runNode(input.trace, "policy", input.turnState.budget.deadlines_ms.model, input.turnState, input.abortSignal, { calls, preConfirmed: input.preConfirmed }, policyNode);
    }),
    tool: fromPromise<ToolOutput, MachineContext>(({ input }) => {
      const { toRun } = proposalsFrom(input.step as PolicyOutput);
      return runNode(input.trace, "tool", input.turnState.budget.deadlines_ms.tool, input.turnState, input.abortSignal, { proposals: toRun }, toolNode);
    }),
    answer: fromPromise<AnswerOutput, MachineContext>(({ input }) => runNode(input.trace, "answer", input.turnState.budget.deadlines_ms.model, input.turnState, input.abortSignal, input.step as AnswerInput, answerNode)),
    output_gate: fromPromise<OutputGateOutput, MachineContext>(({ input }) => runNode(input.trace, "output_gate", input.turnState.budget.deadlines_ms.model, input.turnState, input.abortSignal, { reply: input.step as AnswerOutput }, outputGateNode)),
  },
  guards: {
    // A guard on an actor's own `onDone` evaluates BEFORE that
    // transition's actions run (XState's own order: guard picks the
    // transition, actions then fire), so `context.step` is still the
    // PREVIOUS state's value here - these guards read `event.output`
    // (this done event's own payload) directly instead. A guard used
    // where `context.step` really was already set by an earlier,
    // already-completed transition (contextQuoteGrounded, in the
    // `always` state entered after `model`'s onDone action ran) keeps
    // reading `context.step`, correctly.
    safetyRefused: ({ event }) => safetyRoute((event as unknown as { output: SafetyOutput }).output) === "refused",
    safetyBlocked: ({ event }) => safetyRoute((event as unknown as { output: SafetyOutput }).output) === "blocked",
    commandsMatched: ({ event }) => ((event as unknown as { output: CommandsOutput }).output).matched === true,
    modelIsToolCalls: ({ event }) => ((event as unknown as { output: ModelOutput }).output).kind === "tool_calls",
    modelIsAnswerFromContext: ({ event }) => ((event as unknown as { output: ModelOutput }).output).kind === "answer_from_context",
    contextQuoteGrounded: ({ context }) => {
      const quote = (context.step as { kind: "answer_from_context"; quote: string }).quote;
      // Case-insensitive, matching policy.ts's own argsGrounded() - the
      // same "set check, not a judgment" rule for the identical kind of
      // question ("is this string really in the conversation"), a code
      // review caught reading these two differently.
      return quote.length > 0 && context.turnState.context.some((c) => c.text.toLowerCase().includes(quote.toLowerCase()));
    },
    policyHasParkedAsk: ({ event }) => proposalsFrom((event as unknown as { output: PolicyOutput }).output).parkedAsk !== null,
    policyAllRefused: ({ event }) => {
      const { toRun, parkedAsk } = proposalsFrom((event as unknown as { output: PolicyOutput }).output);
      return toRun.length === 0 && parkedAsk === null;
    },
    moreRoundsAvailable: ({ context }) => context.turnState.budget.model_transitions && context.roundsUsed < context.turnState.budget.rounds,
    outputRefused: ({ event }) => ((event as unknown as { output: OutputGateOutput }).output).refused === true,
    hasPreConfirmed: ({ context }) => context.preConfirmed !== undefined,
  },
  actions: {
    applySafety: ({ context }) => applySafety(context.turnState, context.step as SafetyOutput),
    applyContext: ({ context }) => applyContext(context.turnState, context.step as ContextOutput),
    recordOutcomes: ({ context }) => {
      context.turnState.outcomes.push(...(context.step as ToolOutput).outcomes);
    },
    recordCommandOutcome: ({ context }) => {
      const step = context.step as CommandsOutput;
      if (step.matched) context.turnState.outcomes.push(step.outcome);
    },
    // `policy`'s own actor reads `context.step` for the calls to
    // evaluate (the model node's own shape, "tool_calls"); a resumed
    // continuation never ran the model this turn, so this builds that
    // same shape from the one proposal turnNext.ts already resolved.
    stepFromPreConfirmed: assign(({ context }) => ({
      step: { kind: "tool_calls", calls: [{ tool: context.preConfirmed!.request.tool, args: context.preConfirmed!.request.args, id: context.preConfirmed!.request.callId }] },
    })),
    // The policy state's own "asked" exit: stores the parked proposal
    // on TurnState.ask (the contract's own field) so turnNext.ts can
    // persist it (setPendingAsk) and word it into the turn's reply -
    // the state record's "stores the pending ask on the conversation
    // as today."
    parkAsk: ({ context }) => {
      const { parkedAsk } = proposalsFrom(context.step as PolicyOutput);
      if (parkedAsk) {
        context.turnState.ask = { kind: "confirm", prompt: parkedAsk.prompt, packageId: parkedAsk.proposal.request.tool, args: parkedAsk.proposal.request.args };
      }
    },
  },
}).createMachine({
  id: "turn",
  context: ({ input }) => ({ turnState: input.turnState, trace: new TraceRecorder(), abortSignal: input.abortSignal, preConfirmed: input.preConfirmed, roundsUsed: 0, forceSearchOnly: false, step: null }),
  initial: "safety",
  states: {
    safety: {
      invoke: {
        src: "safety",
        input: ({ context }) => context,
        onDone: [
          { guard: "safetyRefused", actions: [assign(({ event }) => ({ step: event.output })), "applySafety"], target: "refused" },
          { guard: "safetyBlocked", actions: [assign(({ event }) => ({ step: event.output })), "applySafety"], target: "blocked" },
          // Continuations (turn-machine-state-record's own "the next
          // turn's safety state runs first, then the pending ask is
          // consumed before commands"): turnNext.ts sets
          // context.preConfirmed only when it already matched this
          // turn's utterance to an affirmative and read the stored
          // proposal, so safety having run is what makes this jump
          // sound, never a shortcut that skips it.
          {
            guard: "hasPreConfirmed",
            actions: [assign(({ event }) => ({ step: event.output })), "applySafety", "stepFromPreConfirmed"],
            target: "policy",
          },
          { actions: [assign(({ event }) => ({ step: event.output })), "applySafety"], target: "commands" },
        ],
        onError: { target: "refused", actions: assign({ step: () => ({ safety: { action: "refuse" } }) }) },
      },
    },
    commands: {
      invoke: {
        src: "commands",
        input: ({ context }) => context,
        onDone: [
          // recordCommandOutcome (a review): a matched command's own
          // outcome joins state.outcomes the same way a tool call's
          // does, so turnNext.ts can tell "command" from "model" by the
          // last outcome's `via` instead of guessing from outcomes.length
          // alone (which a command match previously left at 0).
          { guard: "commandsMatched", actions: [assign(({ event }) => ({ step: event.output })), "recordCommandOutcome"], target: "answer" },
          { target: "context" },
        ],
      },
    },
    context: {
      invoke: {
        src: "context",
        input: ({ context }) => context,
        onDone: { actions: [assign(({ event }) => ({ step: event.output })), "applyContext"], target: "model" },
      },
    },
    model: {
      invoke: {
        src: "model",
        input: ({ context }) => context,
        onDone: [
          { guard: "modelIsToolCalls", actions: assign(({ event }) => ({ step: event.output })), target: "policy" },
          { guard: "modelIsAnswerFromContext", actions: assign(({ event }) => ({ step: event.output })), target: "answer_from_context_check" },
          { actions: assign(({ event }) => ({ step: event.output })), target: "answer" },
        ],
      },
    },
    // The interim rule's own policy check (turn-machine-state-record's
    // "policy verifies the quote is in the list ... a quote that is not
    // there is an ungrounded argument and the search runs instead"):
    // a real state, not folded into `model`, so the trace can show it
    // as its own decision rather than hiding it inside the model node.
    answer_from_context_check: {
      always: [
        { guard: "contextQuoteGrounded", target: "answer" },
        // An ungrounded quote means "run the search instead" - back to
        // `model`, forced to the search tool alone this one time
        // (forceSearchOnly) so a model that keeps choosing the broken
        // answer cannot loop here a second time.
        { actions: assign({ forceSearchOnly: true }), target: "model" },
      ],
    },
    policy: {
      invoke: {
        src: "policy",
        input: ({ context }) => context,
        onDone: [
          { guard: "policyHasParkedAsk", actions: [assign(({ event }) => ({ step: event.output })), "parkAsk"], target: "asked" },
          { guard: "policyAllRefused", actions: assign(({ event }) => ({ step: event.output })), target: "answer" },
          { actions: assign(({ event }) => ({ step: event.output })), target: "tool" },
        ],
      },
    },
    tool: {
      invoke: {
        src: "tool",
        input: ({ context }) => context,
        onDone: [
          {
            guard: "moreRoundsAvailable",
            actions: [assign(({ event }) => ({ step: event.output })), assign({ roundsUsed: ({ context }) => context.roundsUsed + 1 }), "recordOutcomes"],
            target: "model",
          },
          { actions: [assign(({ event }) => ({ step: event.output })), "recordOutcomes"], target: "answer" },
        ],
      },
    },
    answer: {
      invoke: {
        src: "answer",
        input: ({ context }) => ({ ...context, step: answerInputFrom(context) }),
        onDone: { actions: assign(({ event }) => ({ step: event.output })), target: "output_gate" },
      },
    },
    output_gate: {
      invoke: {
        src: "output_gate",
        input: ({ context }) => context,
        onDone: [
          { guard: "outputRefused", actions: assign(({ event }) => ({ step: event.output })), target: "refused" },
          { actions: assign(({ event }) => ({ step: event.output })), target: "done" },
        ],
      },
    },
    asked: { type: "final" },
    done: { type: "final" },
    refused: { type: "final" },
    blocked: { type: "final" },
    cancelled: { type: "final" },
  },
});

/** Builds the `answer` node's own input from whichever upstream state
 * reached it - the one place that has to know all five producers
 * (nodes/answer.ts's own doc comment), so no other state does. A code
 * review (2026-09-22) caught the fifth, `policy`'s own all-refused exit
 * (PolicyOutput, "entries"), missing entirely - it has neither
 * CommandsOutput's "matched" nor ModelOutput's "kind", so it fell
 * through to the empty-text fallback at the bottom. Checked first here
 * since `policyAllRefused` is the only state that can ever reach
 * `answer` with a PolicyOutput step. */
function answerInputFrom(context: MachineContext): AnswerInput {
  const step = context.step;
  if (step && typeof step === "object" && "entries" in step) {
    const p = step as PolicyOutput;
    const refused: PolicyEntry | undefined = p.entries.find((e) => !e.decision.allow);
    const reason = refused && !refused.decision.allow ? refused.decision.reason : "min_role";
    return { kind: "policy_refused", reason: reason as PolicyRefusedReason };
  }
  if (step && typeof step === "object" && "matched" in step && (step as CommandsOutput).matched) {
    const c = step as Extract<CommandsOutput, { matched: true }>;
    return { kind: "immediate", text: c.text, speech: c.speech, outcome: c.outcome };
  }
  if (step && typeof step === "object" && "kind" in step) {
    const s = step as ModelOutput;
    if (s.kind === "text") return { kind: "model_text", text: s.text };
    if (s.kind === "answer_from_context") return { kind: "context_quote", quote: s.quote };
  }
  if (context.turnState.outcomes.length > 0) {
    const lastText = context.turnState.outcomes.at(-1)?.userMessage ?? "";
    return { kind: "from_outcomes", text: lastText, outcomes: context.turnState.outcomes };
  }
  return { kind: "model_text", text: "" };
}
