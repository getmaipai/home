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
import { nodeSignal, modelNodeDeadlineMs, retryDeadlineMs } from "./deadline";
import { safetyNode, applySafety, safetyRoute, inputSafetyAfterFailure, type SafetyOutput } from "./nodes/safety";
import { carriesCrisisSignal } from "@/lib/safety";
import { commandsNode, type CommandsOutput } from "./nodes/commands";
import { contextNode, applyContext, type ContextOutput } from "./nodes/context";
import { modelNode, rawUtteranceWebsearchCall, type ModelOutput } from "./nodes/model";
import { policyNode, type PolicyOutput, type PolicyEntry } from "./nodes/policy";
import { toolNode, type ToolOutput } from "./nodes/tool";
import { retryEligible } from "./nodes/lookupFallback";
import { START_PROJECT_TOOL_ID } from "@/lib/projects/tool";
import { answerNode, type AnswerInput, type AnswerOutput, type PolicyRefusedReason } from "./nodes/answer";
import { outputGateNode, type OutputGateOutput } from "./nodes/outputGate";
import { planFor } from "@/lib/register";
import { outcomeText } from "@/lib/turnContext";
import { webSearchToolDeadlineMs } from "@/lib/webSearchBudget";

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
  // T5 / THIN-2G: set once, by the `tool` state, when every call of the first
  // tool round failed and the one retry round is about to run; never cleared,
  // so a second failed round can never start another. `roundsUsed` stays 0
  // until the retry round's own tool round ends, which is how the retry round
  // itself is told apart (retryRound() below).
  retryUsed: boolean;
  // QUERY-WRITER-01: set by the `model` state's own onDone action
  // whenever THIS round's tool_calls came from the query-writer
  // generation (nodes/model.ts's `recoveredMissingCall()`), never from
  // the model's own real call or the raw-utterance builder row. Read
  // once by `policy`'s own onDone (the `queryWriterRefused` guard) to
  // tell "policy refused the query-writer's own answer" apart from an
  // ordinary refusal, then cleared by `queryWriterFallback` itself so
  // the one retry it forces can never loop back through the same
  // check a second time.
  queryWriterUsed: boolean;
  // The last node's raw output, read by that state's own guarded
  // transitions - one shared slot rather than one typed field per
  // node, since only ever one is live at a time (the machine is
  // sequential, never parallel across nodes).
  step: unknown;
  // "Reasoning is a second output": the model node's own extracted
  // span, carried past `answer` (which overwrites `step`) so
  // `output_gate` can still gate it - see the `model` state's own
  // onDone actions.
  modelReasoning: string | undefined;
}

/** T5 / THIN-2G: true while the one retry round (its model call, its policy
 * check, its tool run) is the round in progress. */
function retryRound(context: MachineContext): boolean {
  return context.retryUsed && context.roundsUsed === 0;
}

/** A spoken turn's retry round runs under a shorter deadline (T5). */
function deadlineFor(context: MachineContext, baseMs: number): number {
  return retryRound(context) ? retryDeadlineMs(baseMs, context.turnState.spoken || context.turnState.planBasis.surfaceClass === "spoken") : baseMs;
}

function proposalsFrom(policy: PolicyOutput): { toRun: ActionProposal[]; parkedAsk: { prompt: string; proposal: ActionProposal; capabilities?: string[]; consequential?: boolean } | null } {
  const toRun: ActionProposal[] = [];
  let parkedAsk: { prompt: string; proposal: ActionProposal; capabilities?: string[]; consequential?: boolean } | null = null;
  for (const { proposal, decision } of policy.entries) {
    if (decision.allow) toRun.push(proposal);
    else if ((decision.reason === "consent_needed" || decision.reason === "confirm_needed") && decision.ask) parkedAsk = { prompt: decision.ask.prompt, proposal, capabilities: decision.ask.capabilities, consequential: decision.ask.consequential };
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
        deadlineFor(input, modelNodeDeadlineMs(input.turnState)),
        input.turnState,
        input.abortSignal,
        { utterance: input.turnState.utterance, toolsAllowed: input.turnState.budget.model_transitions && input.roundsUsed < input.turnState.budget.rounds, retry: retryRound(input) },
        modelNode,
      ),
    ),
    policy: fromPromise<PolicyOutput, MachineContext>(({ input }) => {
      const calls = (input.step as { kind: "tool_calls"; calls: import("./contract").ToolCall[] }).calls;
      return runNode(input.trace, "policy", input.turnState.budget.deadlines_ms.model, input.turnState, input.abortSignal, { calls, preConfirmed: input.preConfirmed }, policyNode);
    }),
    tool: fromPromise<ToolOutput, MachineContext>(({ input }) => {
      const { toRun } = proposalsFrom(input.step as PolicyOutput);
      const hasWebSearch = toRun.some(({ request }) => request.tool === "websearch");
      const baseDeadline = hasWebSearch
        ? webSearchToolDeadlineMs(input.turnState.planBasis.band, input.turnState.planBasis.surfaceClass, input.turnState.budget.deadlines_ms.tool)
        : input.turnState.budget.deadlines_ms.tool;
      const toolDeadline = deadlineFor(input, baseDeadline);
      return runNode(input.trace, "tool", toolDeadline, input.turnState, input.abortSignal, { proposals: toRun, deadlineAt: Date.now() + toolDeadline }, toolNode);
    }),
    answer: fromPromise<AnswerOutput, MachineContext>(({ input }) => runNode(input.trace, "answer", input.turnState.budget.deadlines_ms.model, input.turnState, input.abortSignal, input.step as AnswerInput, answerNode)),
    output_gate: fromPromise<OutputGateOutput, MachineContext>(({ input }) =>
      runNode(
        input.trace,
        "output_gate",
        input.turnState.budget.deadlines_ms.model,
        input.turnState,
        input.abortSignal,
        { reply: input.step as AnswerOutput, reasoningIn: input.modelReasoning, reasoningEmit: input.turnState.reasoning.emit, reasoningWithheldFor: input.turnState.reasoning.withheld_for },
        outputGateNode,
      ),
    ),
  },
  guards: {
    // A guard on an actor's own `onDone` evaluates BEFORE that
    // transition's actions run (XState's own order: guard picks the
    // transition, actions then fire), so `context.step` is still the
    // PREVIOUS state's value here - these guards read `event.output`
    // (this done event's own payload) directly instead.
    safetyRefused: ({ event }) => safetyRoute((event as unknown as { output: SafetyOutput }).output) === "refused",
    safetyBlocked: ({ event }) => safetyRoute((event as unknown as { output: SafetyOutput }).output) === "blocked",
    commandsMatched: ({ event }) => ((event as unknown as { output: CommandsOutput }).output).matched === true,
    modelIsToolCalls: ({ event }) => ((event as unknown as { output: ModelOutput }).output).kind === "tool_calls",
    policyHasParkedAsk: ({ event }) => proposalsFrom((event as unknown as { output: PolicyOutput }).output).parkedAsk !== null,
    policyAllRefused: ({ event }) => {
      const { toRun, parkedAsk } = proposalsFrom((event as unknown as { output: PolicyOutput }).output);
      return toRun.length === 0 && parkedAsk === null;
    },
    // QUERY-WRITER-01: the query-writer's own round is always exactly
    // one proposal (tool_choice "required" over websearch alone), so
    // "every proposal refused" here can only mean that one - the
    // ruling's own "grounding refuses it" case (a bare pronoun the
    // query-writer couldn't resolve either). Checked as its own,
    // earlier guard so it wins over the generic policyAllRefused
    // (XState's own array-order guard evaluation) and routes to the
    // raw-utterance retry instead of the honesty line every other
    // all-refused turn gets.
    queryWriterRefused: ({ context, event }) => {
      const { toRun, parkedAsk } = proposalsFrom((event as unknown as { output: PolicyOutput }).output);
      return toRun.length === 0 && parkedAsk === null && context.queryWriterUsed;
    },
    moreRoundsAvailable: ({ context }) => context.turnState.budget.model_transitions && context.roundsUsed < context.turnState.budget.rounds,
    // THIN-1B (rule 6) removed SEARCH-EMPTY-01's `toolAllFailed` guard
    // here: it sent a round whose every outcome failed straight to
    // `answer` with a deterministic outage line. A failed tool never fails
    // the answer; that round now reaches `model` like any other (see the
    // tool state's transitions below).
    // PROJECT-PHRASE-01 (2026-09-27, dev.md - closes the live incident
    // PROJECT-PKGTYPE-02/03 and PROJECT-REPLY-01 fixed the symptoms
    // of, without reaching this): a succeeded start_project outcome's
    // own `result.reply.text` is already the complete, correct thing
    // to say (projects/tool.ts's runStartProjectTool()'s own header
    // comment names this as the intended design - "the phrasing round
    // every other tool's outcome already goes through ... relays it,
    // never invents its own number"). The phrasing round itself never
    // implements that intent: `composer.ts`'s phrasingInstruction() is
    // written for a lookup's "answer the question from the results"
    // framing, which is the wrong shape entirely for a "yes" that just
    // started a project - confronted with it, the model echoed
    // fragments of its own instructions back instead of relaying the
    // outcome's own text. Checked before `moreRoundsAvailable` in the
    // tool state's transitions, so a
    // successful start_project call never reaches a phrasing round
    // even when the household's own real budget (qwen3-8b:
    // model_transitions true, rounds: 1) would otherwise always offer
    // one. Scoped to this one tool id on purpose - other tools (timer,
    // list-add) also succeed with actions, but their own
    // conversationFixture.ts rows pass through the ordinary phrasing
    // round without this failure mode, so whether this generalizes to
    // a "self-describing outcome" mechanism is a real open design
    // question, not decided here.
    //
    // Reads `output.outcomes.at(-1)` specifically, never `.some(...)`
    // over the whole round (a medium code review, 2026-09-27, caught
    // this: `answerInputFrom()`'s own `from_outcomes` branch builds the
    // reply from `context.turnState.outcomes.at(-1)` alone, so a round
    // whose LAST outcome was something else - a second tool call
    // proposed in the same round as a non-consequential project type,
    // never possible for `start_project` today since every registered
    // type is consequential and a resumed call is always the round's
    // only call, but not something this guard should silently assume
    // stays true - would have this guard fire on an EARLIER
    // start_project outcome while the reply actually built from a
    // different, later one). Checking the round's own last outcome
    // directly keeps this guard's condition identical to what
    // `answerInputFrom()` will actually read, by construction, however
    // many calls the round carried.
    // T5 / THIN-2G: every call of the first tool round failed (a malformed call
    // counts), no failed tool writes, and the round was offered by a budget that
    // lets the model call tools. The retry round needs the failed round's own
    // tools block to stay identical to (a resumed confirmation never had one).
    toolRoundFailed: ({ context, event }) => {
      const output = (event as unknown as { output: ToolOutput }).output;
      // roundsUsed === 0: only the FIRST tool round can be retried, because retryRound()
      // tells the retry round apart by that very count (a failure after an earlier
      // successful round would otherwise run a round with none of the retry floors).
      return !context.retryUsed && context.turnState.budget.model_transitions && context.roundsUsed === 0 && context.turnState.budget.rounds > 0 &&context.turnState.lastTools.length > 0 && retryEligible(output.outcomes);
    },
    // A retry round whose every call policy refused (an ungrounded or
    // unknown tool) is a failed lookup like any other: on to the phrasing round.
    retryRefused: ({ context, event }) => {
      const { toRun, parkedAsk } = proposalsFrom((event as unknown as { output: PolicyOutput }).output);
      return retryRound(context) && toRun.length === 0 && parkedAsk === null;
    },
    toolProvidesOwnReply: ({ event }) => {
      const output = (event as unknown as { output: ToolOutput }).output;
      const last = output.outcomes.at(-1);
      return last?.packageId === START_PROJECT_TOOL_ID && last.status === "succeeded";
    },
    outputRefused: ({ event }) => ((event as unknown as { output: OutputGateOutput }).output).refused === true,
    hasPreConfirmed: ({ context }) => context.preConfirmed !== undefined,
    // THIN-7C: bare mode and a continuation skip the command router; every other node, the
    // safety node and the output gate included, runs as for any turn.
    bareTurn: ({ context }) => context.turnState.bare === true || context.turnState.continuation !== undefined,
  },
  actions: {
    applySafety: ({ context }) => applySafety(context.turnState, context.step as SafetyOutput),
    applyContext: ({ context }) => applyContext(context.turnState, context.step as ContextOutput),
    recordOutcomes: ({ context }) => {
      context.turnState.outcomes.push(...(context.step as ToolOutput).outcomes);
      context.turnState.toolEvents.push(...(context.step as ToolOutput).toolEvents);
    },
    // U4c (docs/BACKLOG.md): the plan `turnNext.ts` computed up front
    // used a static `evidence: { choices: 0, sources: 0, deliverable:
    // false }` because nothing had run yet - correct at that point, but
    // never revisited once a tool round actually returns something,
    // so a written question with a real source never reached the
    // evidence-sized (360 words / 24 sentences) row. Runs immediately
    // after `recordOutcomes` so `turnState.outcomes` already holds this
    // round's real results; re-derives `sources` (the total Source
    // count across every succeeded outcome so far) and `deliverable`
    // (whether any succeeded outcome's result carried a real `actions`
    // entry - a plugin that did something, not only looked something
    // up) from that real evidence, through the exact same `planFor()`
    // call turnNext.ts made, via `turnState.planBasis` - never a
    // second, divergent plan computation. `choices` stays 0: no
    // `ToolExecutionOutcome`/`PluginResult` field today reports "more
    // than one candidate the household must pick between," so there is
    // no real evidence to derive it from yet (named, not guessed).
    // Runs on every tool-round completion, so a budget allowing more
    // than one round keeps the plan current each time; today's 8B
    // budget (`rounds: 1`) means this runs at most once per turn.
    derivePlanFromEvidence: ({ context }) => {
      const succeeded = context.turnState.outcomes.filter((o) => o.status === "succeeded");
      const sources = succeeded.reduce((n, o) => n + (o.sources?.length ?? 0), 0);
      const deliverable = succeeded.some((o) => (o.result?.actions?.length ?? 0) > 0);
      context.turnState.plan = planFor({ ...context.turnState.planBasis, evidence: { choices: 0, sources, deliverable } });
    },
    recordCommandOutcome: ({ context }) => {
      const step = context.step as CommandsOutput;
      if (step.matched && !step.whoAnswer) context.turnState.outcomes.push(step.outcome);
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
        context.turnState.ask = { kind: "confirm", prompt: parkedAsk.prompt, packageId: parkedAsk.proposal.request.tool, args: parkedAsk.proposal.request.args, capabilities: parkedAsk.capabilities, consequential: parkedAsk.consequential };
      }
    },
    // "Reasoning is a second output": output_gate is the one node that
    // knows the turn's FINAL reasoning outcome (context's own emit/
    // withheld_for, possibly downgraded to "gate"), but the model
    // node's own NodeExecution is already written by the time
    // output_gate runs - "so the replay bench and the weekly report
    // can prove a minor's row never carried a reasoning event," the
    // design puts this outcome on the model node's own trace entry
    // rather than a ninth node, so it's patched onto that entry here,
    // the one place both the trace and the final outcome are in hand.
    // THIN-0M: keep the whole-reply check that refused the answer, and the
    // input's own crisis signal when the safety node threw, so the refusal
    // still offers the crisis resources.
    applyOutputRefusal: ({ context }) => {
      const output = context.step as OutputGateOutput;
      if (output.refused && output.safety) context.turnState.outputSafety = output.safety;
    },
    applySafetyFailure: ({ context }) => {
      const input = inputSafetyAfterFailure(context.turnState.utterance);
      if (input) {
        context.turnState.safety = input;
        context.turnState.crisis = carriesCrisisSignal(input);
      }
    },
    applyReasoningTrace: ({ context }) => {
      const output = context.step as OutputGateOutput;
      const modelEntry = [...context.turnState.nodes].reverse().find((n) => n.node === "model");
      if (modelEntry) modelEntry.reasoning = output.reasoning;
    },
  },
}).createMachine({
  id: "turn",
  context: ({ input }) => ({ turnState: input.turnState, trace: new TraceRecorder(), abortSignal: input.abortSignal, preConfirmed: input.preConfirmed, roundsUsed: 0, retryUsed: false, queryWriterUsed: false, step: null, modelReasoning: undefined }),
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
          { guard: "bareTurn", actions: [assign(({ event }) => ({ step: event.output })), "applySafety"], target: "context" },
          { actions: [assign(({ event }) => ({ step: event.output })), "applySafety"], target: "commands" },
        ],
        onError: { target: "refused", actions: [assign({ step: () => ({ safety: { action: "refuse" } }) }), "applySafetyFailure"] },
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
        // Every branch also stashes the model's own reasoning span
        // (undefined when `context` said not to emit, or none came
        // back) on the context's own modelReasoning slot - `answer`'s
        // own output overwrites `step` before `output_gate` ever runs,
        // so this is the one place that can still see it there.
        onDone: [
          // QUERY-WRITER-01: `queryWriterUsed` reads THIS round's own
          // output directly (never carried over from an earlier round -
          // a real model call or a plain builder row both leave it
          // undefined/false, matching ModelOutput's own optional field).
          { guard: "modelIsToolCalls", actions: assign(({ event }) => ({ step: event.output, modelReasoning: event.output.reasoning, queryWriterUsed: (event.output as ModelOutput & { kind: "tool_calls" }).queryWriterUsed === true })), target: "policy" },
          { actions: assign(({ event }) => ({ step: event.output, modelReasoning: event.output.reasoning })), target: "answer" },
        ],
      },
    },
    policy: {
      invoke: {
        src: "policy",
        input: ({ context }) => context,
        onDone: [
          { guard: "policyHasParkedAsk", actions: [assign(({ event }) => ({ step: event.output })), "parkAsk"], target: "asked" },
          // QUERY-WRITER-01: checked before the generic policyAllRefused
          // (see that guard's own comment) - never assigns `step` from
          // the refused policy output, since queryWriterFallback builds
          // its own fresh one.
          { guard: "queryWriterRefused", target: "queryWriterFallback" },
          // T5: nothing the retry round called could run; on to the phrasing round
          // (roundsUsed 1 is what makes the next model call the phrasing one).
          { guard: "retryRefused", actions: assign({ roundsUsed: ({ context }) => context.roundsUsed + 1 }), target: "model" },
          { guard: "policyAllRefused", actions: assign(({ event }) => ({ step: event.output })), target: "answer" },
          { actions: assign(({ event }) => ({ step: event.output })), target: "tool" },
        ],
      },
    },
    // QUERY-WRITER-01: the ruling's own "fall back to the raw utterance
    // as today" - a synchronous `always` transition, back
    // through `policy` (never straight to `tool`) so the raw utterance
    // still clears a real grounding check rather than skipping it - it
    // always does (it IS the utterance's own terms), the same reason
    // this retry can never loop: `queryWriterUsed` is cleared here, so
    // a second miss on the SAME turn (today's `budget.rounds: 1` means
    // there is no second round to reach this from, but the guard is
    // false either way once this fires) takes the ordinary
    // policyAllRefused path instead of retrying forever.
    queryWriterFallback: {
      always: {
        actions: assign({
          step: ({ context }) => ({ kind: "tool_calls" as const, calls: [rawUtteranceWebsearchCall(context.turnState.utterance)] }),
          queryWriterUsed: false,
        }),
        target: "policy",
      },
    },
    tool: {
      invoke: {
        src: "tool",
        input: ({ context }) => context,
        onDone: [
          // Deliberately the same three actions as the no-guard
          // fallback below (both land on `answer` with the tool
          // round's own output recorded) - kept as two literal arrays
          // rather than one shared reference (a review, 2026-09-24,
          // flagged the duplication) because XState's own action-array
          // typing is resolved per onDone entry from `createMachine`'s
          // still-open generic at this point in the file; a future edit
          // to what "record a finished tool round" does must be applied
          // to both.
          // THIN-1B (rule 6): there is no `toolAllFailed` exit any more. A
          // round whose every outcome failed (or found nothing) goes on to
          // the answering round like any other, where model.ts answers from
          // what it knows and ends with the fixed band line; the failed
          // result itself is never handed to the model.
          // PROJECT-PHRASE-01: same three actions as the no-guard fallback
          // below (see the comment above on why this stays two literal
          // arrays, not a shared reference) - checked here, before
          // `moreRoundsAvailable` ever runs, so a successful
          // start_project outcome always lands on `answer` directly,
          // never on a phrasing round `model` invocation.
          {
            guard: "toolProvidesOwnReply",
            actions: [assign(({ event }) => ({ step: event.output })), "recordOutcomes", "derivePlanFromEvidence"],
            target: "answer",
          },
          // T5 / THIN-2G: one more offered round (roundsUsed is not advanced, so
          // the model call is offered, not the phrasing round) when every call of
          // this round failed; then the existing phrasing round.
          {
            guard: "toolRoundFailed",
            actions: [assign(({ event }) => ({ step: event.output, retryUsed: true })), "recordOutcomes", "derivePlanFromEvidence"],
            target: "model",
          },
          {
            guard: "moreRoundsAvailable",
            actions: [assign(({ event }) => ({ step: event.output })), assign({ roundsUsed: ({ context }) => context.roundsUsed + 1 }), "recordOutcomes", "derivePlanFromEvidence"],
            target: "model",
          },
          { actions: [assign(({ event }) => ({ step: event.output })), "recordOutcomes", "derivePlanFromEvidence"], target: "answer" },
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
          { guard: "outputRefused", actions: [assign(({ event }) => ({ step: event.output })), "applyReasoningTrace", "applyOutputRefusal"], target: "refused" },
          { actions: [assign(({ event }) => ({ step: event.output })), "applyReasoningTrace"], target: "done" },
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
    // DEADLINE-01: a generation that never finished at all - kept
    // distinct from "text" with an empty string, which used to reach
    // here and deliver a real, silent empty reply.
    if (s.kind === "model_failed") return { kind: "model_failed", failure: s.failure };
  }
  if (context.turnState.outcomes.length > 0) {
    const outcomes = context.turnState.outcomes;
    // PROJECT-REPLY-01 (2026-09-27, dev.md): this is what a resumed/
    // preConfirmed action's reply is built from whenever no further
    // model round follows this tool round (a failed outcome, or a
    // budget whose model_transitions is off / round already spent -
    // most successful turns instead go on to a phrasing round, see
    // dev.md's own account). outcomeText() (turnContext.ts) reads a
    // succeeded outcome's own `result.reply.text` (and other result
    // data) first, falling back to `userMessage` last - that fallback
    // alone used to be all this read, which is empty on every SUCCESS
    // outcome (`userMessage` is only ever set on a failure branch, e.g.
    // runStartProjectTool()'s own unknown_project_type/invalid_params/
    // project_refused cases), throwing away a confirmed start_project's
    // real "Starting <title> now..." reply whenever this branch was
    // the one actually building the final text.
    const lastText = outcomeText(outcomes.at(-1)!);
    return { kind: "from_outcomes", text: lastText, outcomes };
  }
  return { kind: "model_text", text: "" };
}
