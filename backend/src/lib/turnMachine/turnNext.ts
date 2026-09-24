// U2b/c (docs/plans/turn-machine-state-record-2026-09-22.md, "Files"):
// the entry `routes/turn.ts` calls, with the same TurnStreamResult shape
// runTurnStream() already returns (turnEngine.ts, imported here, never
// redefined - "one definition, one place"). turnEngine.ts is not edited
// by U2.
//
// runTurnNext() (U2's own build) always resolves through TurnStreamResult's
// "immediate" variant - `backend/scripts/bench/replay.ts`'s scorer and
// routes/turn.ts's own blocking POST / route both want the whole reply
// at once, never a live stream. STREAM-NEXT-01 (below, this file's own
// runTurnNextStream()) is the "stream" variant a live client actually
// needs: routes/turn.ts's `/stream` route calls it instead, when
// turn.pipeline.next is on.
import { createActor, waitFor, type ActorRefFrom } from "xstate";
import type { Surface, TurnValue, TurnStreamResult, StreamOutcome } from "@/lib/turnEngine";
import { validateTurnInput, loadAllManifests, commandOpeners, computedPatternMatch, StreamSafetyRefusal, StreamUnavailable, deriveCrisisResources } from "@/lib/turnEngine";
import type { PersonRow } from "@/lib/memoryIngestion";
import { resolveOrCreateConversation, getPendingAsk, setPendingAsk, logTurn, appendTemporaryTurn, isTemporaryConversation, type PendingAsk } from "@/lib/conversationHistory";
import { classifyTurnSignal } from "@/lib/turnSignal";
import { speakerAgeBand } from "@/lib/ageBand";
import { resolvePersona } from "@/lib/persona";
import { getHouseholdSettingValue } from "@/lib/settings";
import { planFor } from "@/lib/register";
import { surfaceClassOf } from "@/lib/surfaceClass";
import { AFFIRMATIVE_RE } from "@/lib/consentVocab";
import { newConversationTurnId } from "@/lib/id";
import { buildTurnStats } from "@/lib/turnStats";
import { structuredPartForOutcomes, artifactForOutcomes } from "@/lib/composer";
import { emptyTimings } from "@/lib/turnContext";
import { getActiveChatEngineIdentity } from "@/lib/stackEngine";
import { StatusChannel } from "@/lib/statusChannel";
import { StreamGate } from "./nodes/outputGate";
import { resolveTurnBudget } from "./budget";
import { turnMachine } from "./machine";
import type { TraceRecorder } from "./trace";
import type { TurnState, ActionProposal, TurnBudget } from "./contract";
import type { Source } from "@maipai/spec/gen/ts/source.js";

export interface RunTurnNextOpts {
  conversationId?: string;
  temporary?: boolean;
  signal?: AbortSignal;
  // U4/RESP-01 point 1: additive, forces the spoken register for a
  // dictated chat turn - unwired to any client today (no dictation
  // marker exists yet), plumbed and tested ahead of a real caller.
  spoken?: boolean;
  // THINK-DEFAULT-01 (dev.md "U6 rerun ruling" (b) 1): mirrors the old
  // path's own RunTurnOpts.thinking exactly - the person's per-turn
  // toggle (routes/turn.ts's `dropReasoning ? false : body.thinking`,
  // the same REASONING-03 belt-and-braces for a minor or a non-chat
  // surface). Absent or false keeps the budget's own default
  // (thinking_budget_tokens, 0 on every real budget); true substitutes
  // thinking_budget_tokens_toggled for this turn only.
  thinking?: boolean;
}

function buildTurnValue(state: TurnState, startedAt: number, source: TurnValue["source"], text: string, speech?: string, reasoning?: string, sources?: Source[]): TurnValue {
  const stats = buildTurnStats(state.generations, emptyTimings(), startedAt, Date.now(), getActiveChatEngineIdentity(), state.budget.thinking_budget_tokens > 0);
  // A live acceptance run (U2d) caught this omitting plugin_id/
  // command_id/sources entirely - turnEngine.ts's own equivalent
  // builder always carries the package id that ran (plugin_id for a
  // model-proposed tool, command_id for a household command) and any
  // sources, and the bench's own scorer reads exactly these two
  // fields (driven.value?.plugin_id, driven.value?.sources) before it
  // ever falls back to a stored row. Without them every tool/command/
  // source-bearing check failed on the new path, live, even for a
  // turn that ran the right package - a real bug, not a scoring gap.
  const lastOutcome = state.outcomes.at(-1);
  const packageId = source === "plugin" || source === "command" ? lastOutcome?.packageId : undefined;
  // A code review caught this always deriving crisis_resources from
  // state.crisis alone - the INPUT-side check computed before generation
  // ever runs. A streamed turn's own StreamGate can carry a flagged-but-
  // never-refused OUTPUT-side result (a self_harm mention in the
  // model's own words, CHAT-02's "offer, never block": it flags and
  // notifies but never refuses), the identical gap a review once found
  // on the old path's own runTurnStream() ("always used prepared.
  // crisisResources even when outputSafety was the one actually
  // flagged"). `?? ` keeps the input-side line as the fallback, exactly
  // as turnEngine.ts's own finalize() does - never dropping a genuine
  // input-side crisis mention just because the output side had nothing
  // to add. `state.streamGate` is undefined for every non-streaming
  // caller, so this is a no-op there.
  const inputCrisisLine = state.crisis ? "If you or someone you know is in crisis, help is available. Call or text 988 (US) any time." : undefined;
  const outputFlag = state.streamGate?.result().lastFlagged;
  const crisisResources = outputFlag ? (deriveCrisisResources(outputFlag) ?? inputCrisisLine) : inputCrisisLine;
  return {
    reply: { text, speech },
    source,
    safety: outputFlag ?? state.safety,
    conversation_id: state.conversationId,
    turn_id: state.turnId,
    crisis_resources: crisisResources,
    // "One trace, not a second log" (section 11): every node this turn
    // ran or skipped, beside the generations buildTurnStats() already
    // projects above.
    stats: { ...stats, nodes: state.nodes },
    // REASONING-02's own field, populated only when `context` allowed
    // emitting this turn AND output_gate's own safety pass over the
    // span didn't refuse it - the gated span itself, never the raw one.
    reasoning,
    // home#147: turnEngine.ts's own logTurnSafely() (the old path)
    // sets both of these from the identical outcomes list - never
    // called here, so the new path built no structured part (the
    // weather/almanac card) and no artifact (write_document's own
    // outcome) for anything, on any turn. Same functions, same input.
    structured_part: structuredPartForOutcomes(state.outcomes) ?? undefined,
    artifact: artifactForOutcomes(state.outcomes) ?? undefined,
    ...(source === "plugin" && packageId ? { plugin_id: packageId } : {}),
    ...(source === "command" && packageId ? { command_id: packageId } : {}),
    ...(sources && sources.length > 0 ? { sources } : {}),
  } as TurnValue;
}

function logResult(state: TurnState, actor: PersonRow, surface: Surface, text: string, value: TurnValue): void {
  const opts = { signal: state.signal, plan: state.plan, outcomes: state.outcomes, temporary: state.temporary };
  if (state.temporary) appendTemporaryTurn(actor, surface, text, value, opts);
  else logTurn(actor, surface, text, value, opts);
}

/** Whether the utterance is a plain "yes" to a stored confirm/lookup ask
 * (consentVocab.ts's own deterministic word, never a model's reading -
 * RULES-AND-LEARNED-COMPONENTS.md's "a yes is a yes by rule"). */
function resumesAsk(ask: PendingAsk, utterance: string): ActionProposal | null {
  if (ask.kind !== "confirm" || !AFFIRMATIVE_RE.test(utterance)) return null;
  return { kind: "side_effecting", request: { tool: ask.packageId, args: ask.args, callId: `resumed:${ask.packageId}` } };
}

/** finishTurn()'s own, narrow failure: the machine itself timed out or
 * was aborted (waitFor()'s own rejection) - never thrown for a bug
 * anywhere else in finishTurn()'s own body, which propagates uncaught
 * instead. The one thing each caller's own catch checks for by name. */
class TurnMachineTimeout extends Error {}

interface BegunTurn {
  state: TurnState;
  machineActor: ActorRefFrom<typeof turnMachine>;
  abortSignal: AbortSignal;
  startedAt: number;
  // A code review caught finishTurn() reading state.temporary/
  // state.conversationId directly (post-machine) for the "asked" branch's
  // own setPendingAsk() call - nodes/context.ts independently re-resolves
  // the conversation every turn and machine.ts's own applyContext action
  // overwrites state.temporary from THAT result (hardcoding false on its
  // own failure path), so a transient re-resolution failure could flip
  // what finishTurn() sees after the machine ran. Captured once, here,
  // before the machine ever starts - immune to anything a node does to
  // `state` later, the same immunity the pre-refactor single-function
  // runTurnNext() had by construction (its own local `conversation`/
  // `temporary` variables, never read back off `state`).
  temporary: boolean;
  conversationId: string;
}

/** The prelude every caller shares (runTurnNext(), runTurnNextStream()):
 * validate, resolve the conversation, classify the signal, build the
 * turn's own state and start the machine actor. Never awaits the
 * machine itself - see finishTurn() - so a streaming caller can hand
 * back a live status/tokens pair before the turn is anywhere near
 * done. */
async function beginTurn(actor: PersonRow, surface: Surface, text: string, opts: RunTurnNextOpts): Promise<{ ok: true; value: BegunTurn } | { ok: false; result: Extract<TurnStreamResult, { ok: false }> }> {
  const startedAt = Date.now();
  const invalid = validateTurnInput(surface, text);
  if (invalid) return { ok: false, result: invalid };

  const resolved = resolveOrCreateConversation(actor, surface, opts.conversationId, { temporary: opts.temporary });
  if (!resolved.ok) return { ok: false, result: { ok: false, status: resolved.status as 400 | 503, code: "invalid_input", error: resolved.error } };
  const conversation = resolved.value;
  const temporary = isTemporaryConversation(conversation.id) || conversation.mode === "temporary";

  const band = speakerAgeBand(actor, new Date());
  // OPENER-01: the same shape opener commandOpenersFrom() reads for the
  // old path (turnEngine.ts's own commandOpeners(effectiveLoaded)) - a
  // clause opening with a bundled package's own command verb ("look",
  // "convert", "define") reads as a directive by shape, the cue the
  // commands node's imperative wildcards (below) depend on to fire at
  // all. Every loaded manifest, not narrowed for temporary mode: this
  // is a shape cue for the signal only, never a routing decision -
  // the commands node's own temporary-mode guard still keeps a
  // memory:write package from actually firing in a temporary chat.
  // SIGNAL-02: the same loaded-manifests read commandOpeners() just
  // took, never a second load - computedPatternMatch() (turnEngine.ts)
  // is the injected predicate turnSignal.ts's own clauseSubject() reads
  // to classify "what time is it in Tokyo" as target: computed instead
  // of world, so the interim rule stops forcing a search for it.
  const loaded = loadAllManifests();
  const signal = classifyTurnSignal({ text, ageBand: band, commandOpeners: commandOpeners(loaded), computedPatternMatch: (t) => computedPatternMatch(loaded, t) });
  const persona = resolvePersona(getHouseholdSettingValue("persona.active_id"));
  // U4/RESP-01: computed once, the register's only length authority -
  // never recomputed by a later node, the same "decided once" shape
  // `reasoning.emit` already follows in `context`. U4c: everything
  // here except `evidence` is the turn's fixed plan basis, kept on
  // `state.planBasis` so the machine's own post-tool-round recompute
  // reuses these exact inputs rather than re-resolving persona/signal
  // a second time.
  const surfaceClass = surfaceClassOf(surface, opts.spoken === true);
  const planBasis = {
    signal,
    surface,
    surfaceClass,
    brevity: false,
    companion: { directness: "direct" as const, engagement: persona.engagement, complexity: persona.complexity },
    band,
    deferred: false,
    disclosureWithheld: false,
  };
  const plan = planFor({ ...planBasis, evidence: { choices: 0, sources: 0, deliverable: false } });

  // THINK-DEFAULT-01: the catalog's own turn_budget object is shared
  // (resolveTurnBudget() returns CATALOG's entry by reference, never a
  // copy - the same object every other household's turn reads), so the
  // per-turn toggle builds a new object rather than mutating it in
  // place. `opts.thinking` is trusted as already the caller's own
  // final decision (routes/turn.ts's `dropReasoning ? false : body.
  // thinking`, the identical gate the old path's RunTurnOpts.thinking
  // already trusts) - the minor gate is still enforced independently,
  // belt and braces, by model.ts's own minorThinkingOff regardless of
  // what this resolves to.
  const resolvedBudget = resolveTurnBudget();
  const budget: TurnBudget = opts.thinking === true ? { ...resolvedBudget, thinking_budget_tokens: resolvedBudget.thinking_budget_tokens_toggled } : resolvedBudget;

  const state: TurnState = {
    turnId: newConversationTurnId(),
    conversationId: conversation.id,
    actor,
    surface,
    utterance: text,
    signal,
    budget,
    persona,
    plan,
    planBasis,
    safety: { flagged: false, categories: [], action: "allow", notify_parent: false, matched_signals: [], checked_at: new Date().toISOString() },
    crisis: false,
    context: [],
    messages: [],
    proposals: [],
    outcomes: [],
    toolEvents: [],
    lastTools: [],
    generations: [],
    nodes: [],
    reply: null,
    ask: null,
    end: null,
    temporary,
    spoken: opts.spoken === true,
    startedAt,
    // Overwritten by the context node's own decideReasoning() whenever
    // `context` runs (machine.ts's own applyContext action). A code
    // review caught the previous comment here claiming nothing reads
    // this starting value outside `refused`/`blocked` - untrue: a
    // `commands`-matched turn (machine.ts's own `commandsMatched`
    // guard) goes straight from `commands` to `answer` to
    // `output_gate`, skipping `context` entirely, so `output_gate`
    // reads exactly this default live for that path. `emit: false`
    // is correct there regardless (a matched command never ran the
    // model, so there is no reasoning span to gate either way), but it
    // is load-bearing, not dead.
    reasoning: { emit: false, withheld_for: null },
  };

  const abortSignal = opts.signal ?? new AbortController().signal;

  // A code review (2026-09-22) caught this file running `safety` twice
  // on every ordinary turn - once here, untraced, to decide whether to
  // check for a resumable ask, and again as the machine's own first
  // state. Fixed by resolving ONLY the pending-ask lookup here (a DB
  // read plus a deterministic word match, not a safety evaluation) and
  // letting the machine's own `safety` state (its `hasPreConfirmed`
  // guard) decide everything from refuse/block through the resumed
  // continuation - the state record's own order ("the next turn's
  // safety state runs first, then the pending ask is consumed before
  // commands") still holds, now with one safety evaluation, traced
  // once, for every turn including a resumed one.
  const pendingAsk = temporary ? null : getPendingAsk(conversation.id);
  const preConfirmed = pendingAsk ? (resumesAsk(pendingAsk, text) ?? undefined) : undefined;
  // Cleared either way a pending ask existed: resumed (so it can't be
  // resumed twice, the stuck-question failure REPLY-FIND-01 already
  // named), declined (NEGATIVE_RE), or an unrelated new statement - the
  // state record's own "a negative or a new statement clears it."
  if (pendingAsk) setPendingAsk(conversation.id, null);

  const machineActor = createActor(turnMachine, { input: { turnState: state, abortSignal, preConfirmed } });
  machineActor.start();
  return { ok: true, value: { state, machineActor, abortSignal, startedAt, temporary, conversationId: conversation.id } };
}

/** Awaits the machine to "done" and builds the turn's own TurnValue -
 * shared by runTurnNext() (awaited inline, as today) and
 * runTurnNextStream()'s own background run (awaited by its `tokens`
 * generator before it can complete, and raced against a live per-
 * sentence refusal that resolves faster - see below). Never logs the
 * turn itself: a streaming caller may already have logged a faster,
 * synchronously-built refusal by the time this settles, so logging is
 * each caller's own job, once. */
async function finishTurn(begun: BegunTurn): Promise<TurnValue> {
  const { state, machineActor, abortSignal, startedAt, temporary, conversationId } = begun;
  // A code review caught the first cut of this split letting a bug
  // anywhere below (buildTurnValue, the trace bookkeeping) fall into the
  // SAME catch runTurnNext() uses for this one - masking a real
  // application defect as a generic 503 "unavailable" instead of letting
  // it surface distinctly, unlike the pre-refactor single-function
  // runTurnNext(), whose own try/catch only ever wrapped this waitFor()
  // call. TurnMachineTimeout is the one thing this function itself ever
  // throws for a caught error; every caller checks for it specifically
  // rather than swallowing anything else this function might throw.
  const finalSnapshot = await waitFor(machineActor, (s) => s.status === "done", { timeout: state.budget.deadlines_ms.total + 5000, signal: abortSignal }).catch((err: unknown) => {
    throw new TurnMachineTimeout(`turn machine failed: ${(err as Error).message}`);
  });
  const finalState = finalSnapshot.value as string;

  // A code review (2026-09-22) caught TraceRecorder.skip() never
  // called anywhere - a turn that never reaches, say, `tool` (no tool
  // call this turn) left stats.nodes[] with only the nodes that
  // actually ran, short of the acceptance criterion's "all eight nodes
  // present (ran or skipped)". Checked one at a time, never an array
  // (the rule-budget lint's word-list check is syntactic: a 3+-string
  // array trips it whatever it holds, the same reason messages.ts's
  // windowRoleFromId() and nodes/answer.ts's policyRefusalLine() are
  // written this way too).
  const trace = (finalSnapshot.context as { trace: TraceRecorder }).trace;
  const ranNodes = new Set(state.nodes.map((n) => n.node));
  if (!ranNodes.has("safety")) trace.skip("safety", "not reached this turn");
  if (!ranNodes.has("commands")) trace.skip("commands", "not reached this turn");
  if (!ranNodes.has("context")) trace.skip("context", "not reached this turn");
  if (!ranNodes.has("model")) trace.skip("model", "not reached this turn");
  if (!ranNodes.has("policy")) trace.skip("policy", "not reached this turn");
  if (!ranNodes.has("tool")) trace.skip("tool", "not reached this turn");
  if (!ranNodes.has("answer")) trace.skip("answer", "not reached this turn");
  if (!ranNodes.has("output_gate")) trace.skip("output_gate", "not reached this turn");
  state.nodes = trace.nodes();

  let value: TurnValue;
  if (finalState === "asked") {
    const ask = state.ask;
    const promptText = ask?.prompt ?? "Want me to go ahead?";
    // The state record's own "stores the pending ask on the
    // conversation as today": the machine only set it on TurnState
    // (machine.ts's own parkAsk action); persisting it is turnNext.ts's
    // job, the same place the old path's own equivalent write happens.
    // `temporary`/`conversationId` here are the values beginTurn()
    // captured before the machine ever ran, never `state.temporary`/
    // `state.conversationId` (a code review: nodes/context.ts re-
    // resolves the conversation every turn and can overwrite
    // `state.temporary` from that second resolution's own result).
    if (ask && !temporary) setPendingAsk(conversationId, ask);
    value = buildTurnValue(state, startedAt, "confirm", promptText);
  } else if (finalState === "refused") {
    // A review caught this reading `step` (SafetyOutput there, not
    // OutputGateOutput - a safety refusal parks in `refused` straight
    // from `safety`'s own onDone, before `output_gate` ever runs) for a
    // `.text` field it can never have: the fixed refusal line is the
    // only text this path produces, written here directly instead of a
    // fallback that implied a different source that doesn't exist.
    value = buildTurnValue(state, startedAt, "safety_refuse", "I can't help with that.");
  } else if (finalState === "blocked") {
    value = buildTurnValue(state, startedAt, "policy", "Keep passwords and keys in Credentials, not in chat.");
  } else {
    const gateOutput = (finalSnapshot.context as { step: unknown }).step as { refused?: boolean; text?: string; speech?: string; reasoningOut?: string; sources?: Source[] };
    // The last outcome's own `via` (commands.ts/tool.ts both tag it)
    // names which node actually produced the reply - a review caught
    // the previous version guessing "plugin" vs "model" from
    // outcomes.length alone, which stayed 0 for a matched command
    // (recordCommandOutcome, machine.ts, now pushes its outcome too).
    // A second review caught this ALSO forcing source to "confirm"
    // whenever preConfirmed was set: turnEngine.ts's own reference
    // builder reports "plugin" (with plugin_id) for a confirmed
    // action that actually ran, "confirm" only for the bare
    // acknowledgment lines that never touch a package - lastVia
    // already reads "tool_call" for a preConfirmed action the SAME
    // way it does for any other, so no separate case is needed here;
    // forcing "confirm" only hid the package id buildTurnValue()
    // (below) needs to attach plugin_id at all.
    // A live run caught this treating "pattern" (a bundled package's
    // own literal-pattern match, e.g. "remember that X") the same as
    // "command" (a household's own custom command, matchCommand): the
    // old path's own convention is source "plugin"/plugin_id for a
    // bundled package match, whatever matched it (literal pattern,
    // Tier 2, or a tool call - turnEngine.ts's own source: "plugin"
    // sites all report plugin_id, never command_id, for any of
    // these), and "command"/command_id only for a genuine
    // household-defined command (commands.ts's own custom.id branch).
    // Both commands.ts vias reach `answer` the identical way, so only
    // the source label here needed correcting, not the machine.
    const lastVia = state.outcomes.at(-1)?.via;
    const source: TurnValue["source"] = lastVia === "command" ? "command" : lastVia === "pattern" || lastVia === "tool_call" || lastVia === "forced" ? "plugin" : "model";
    value = buildTurnValue(state, startedAt, source, gateOutput?.text ?? "", gateOutput?.speech, gateOutput?.reasoningOut, gateOutput?.sources);
  }
  return value;
}

export async function runTurnNext(actor: PersonRow, surface: Surface, text: string, opts: RunTurnNextOpts = {}): Promise<TurnStreamResult> {
  const begun = await beginTurn(actor, surface, text, opts);
  if (!begun.ok) return begun.result;
  const { state } = begun.value;
  let value: TurnValue;
  try {
    value = await finishTurn(begun.value);
  } catch (err) {
    // Only the machine's own timeout/abort becomes a 503 "unavailable" -
    // anything else finishTurn() might throw (a real bug in buildTurnValue,
    // the trace bookkeeping) propagates uncaught, exactly as it did
    // before this file's beginTurn()/finishTurn() split, rather than
    // being silently reported as an engine outage.
    if (err instanceof TurnMachineTimeout) return { ok: false, status: 503, code: "unavailable", error: err.message };
    throw err;
  }
  logResult(state, actor, surface, text, value);
  // TOOL-EVENTS-01(b): omitted entirely (not an empty array) when this
  // turn ran no tool - routes/turn.ts spreads it in only when present,
  // so a turn with nothing to report costs nothing on the wire.
  return { ok: true, kind: "immediate", value, signal: state.signal, ...(state.toolEvents.length > 0 ? { toolEvents: state.toolEvents } : {}) };
}

/** The async-generator side of a text delivery queue (a `StatusChannel<
 * string>`, StreamGate's own `release`/`onDone` callbacks feeding it
 * eagerly, independent of whether anything is pulling yet - a code
 * review caught an earlier cut hand-rolling a second, near-identical
 * push/pull queue here instead of reusing StatusChannel's own generic
 * one, the "one definition, one place" org standard exists for exactly
 * this). Drains one item at a time via the channel's own `next()`
 * rather than its `drain()` (statusChannel.ts's own comment: `drain()`
 * exists so a status ahead of a delta lands ahead of it on the wire, an
 * ordering concern this text-only queue has no equivalent of). */
async function* drainDeltaQueue(channel: StatusChannel<string>): AsyncGenerator<string, void, void> {
  for (;;) {
    const item = await channel.next();
    if (item === null) return;
    yield item;
  }
}

/** STREAM-NEXT-01: the streaming twin of runTurnNext() - the same
 * prelude (beginTurn()) and the same machine (finishTurn()), but
 * returns a "stream" kind TurnStreamResult before the machine is
 * anywhere near done, so routes/turn.ts's existing stream branch
 * (ResumeSession, streamResponse, streamTurnEvents()) can relay a live
 * status line and gated sentences, the same contract runTurnStream()
 * (turnEngine.ts) already fulfills for the old path - no second
 * transport. state.status is the identical StatusChannel/"status" wire
 * event the old path already streams; nodes/tool.ts pushes the same
 * "On it." line onto it turnEngine.ts's own runTurnStream() does,
 * before the search itself starts. state.streamGate (outputGate.ts) is
 * what nodes/model.ts's own runOneGeneration() pushes raw deltas into
 * and what nodes/output_gate itself reads back instead of re-evaluating
 * the whole reply - see both files' own headers for why.
 *
 * A refused sentence is read back from the gate and thrown here
 * (`StreamSafetyRefusal`, the identical class and wire behavior the old
 * path's own gateOutputSafety() already uses) the moment the delivery
 * queue closes on it - never waiting for the rest of that generation or
 * the machine to finish, since the household has already stopped
 * seeing more text by then (StreamGate.push() itself stops releasing
 * the instant it refuses) and letting the model keep grinding in the
 * background is no reason to also delay the wire's own error event.
 * finalize() mirrors this: a refusal is built and logged synchronously,
 * right there, from the same fixed line finishTurn()'s own "refused"
 * branch would eventually produce (state.crisis/state.safety are set
 * long before generation even starts, so nothing later can change it) -
 * the machine keeps running in the background regardless (nothing here
 * cancels it), but its own eventual finishTurn() completion checks
 * `finalizedValue` first and never logs a second time. */
export async function runTurnNextStream(actor: PersonRow, surface: Surface, text: string, opts: RunTurnNextOpts = {}): Promise<TurnStreamResult> {
  const begun = await beginTurn(actor, surface, text, opts);
  if (!begun.ok) return begun.result;
  const { state, startedAt } = begun.value;

  const status = new StatusChannel();
  state.status = status;

  const queue = new StatusChannel<string>();
  const band = speakerAgeBand(actor, new Date());
  const gate = new StreamGate(
    band,
    actor,
    state.turnId,
    (sentence) => queue.emit(sentence),
    // onRefuse fires the instant a sentence refuses, DURING the model's
    // own generation - closing the queue here (not only from onDone,
    // below) is what lets tokens() stop waiting and throw right away,
    // rather than only once runOneGeneration()'s own draining loop
    // eventually reaches the end of a generation nothing told it to cut
    // short. Idempotent alongside onDone: whichever fires first wins.
    () => queue.close(),
    () => queue.close(),
  );
  state.streamGate = gate;

  let finishedValue: TurnValue | undefined;
  let finalizedValue: TurnValue | undefined;
  let backgroundError: Error | undefined;

  const machineDone: Promise<void> = finishTurn(begun.value)
    .then((value) => {
      finishedValue = value;
      if (!finalizedValue) {
        finalizedValue = value;
        logResult(state, actor, surface, text, value);
      }
    })
    .catch((err) => {
      backgroundError = err instanceof Error ? err : new Error(String(err));
    })
    .finally(() => {
      gate.finish(); // safety net - idempotent; closes the queue via onDone when model.ts's own successful-round finish() never ran (a generation failure before any drained, or an engine timeout)
      status.close();
      queue.close(); // idempotent
    });

  async function* tokens(): AsyncGenerator<string, StreamOutcome, void> {
    for await (const chunk of drainDeltaQueue(queue)) yield chunk;
    const result = gate.result();
    if (result.refused) throw new StreamSafetyRefusal(result.refused);
    await machineDone;
    if (backgroundError) throw new StreamUnavailable(backgroundError.message);
    return result.lastFlagged;
  }

  return {
    ok: true,
    kind: "stream",
    conversationId: state.conversationId,
    turnId: state.turnId,
    signal: state.signal,
    startedAt,
    cueSuppressed: state.signal.target === "hub" && state.signal.repair !== "none",
    // ENGINEERING gap, named rather than silently worked around: the new
    // path has no equivalent of turnEngine.ts's own bannedPhrasesFor()
    // yet, so the thinking-cue filler (streamTurnEvents()'s own
    // pickThinkingCue()) can repeat a phrase a recent old-path turn
    // already used. Cosmetic only (a filler line, never the reply
    // itself), not this item's own acceptance.
    bannedPhrases: [],
    status,
    tokens: tokens(),
    finalize: (replyText: string): TurnValue => {
      if (finalizedValue) return finalizedValue;
      status.close();
      const result = gate.result();
      if (result.refused) {
        // The exact literal finishTurn()'s own "refused" branch would
        // eventually produce (see this function's own header) - built
        // here, synchronously, so the logged turn is available the
        // instant the wire's own error event is, not seconds later once
        // the model's own remaining generation and the rest of the
        // machine finally finish.
        const value = buildTurnValue(state, startedAt, "safety_refuse", "I can't help with that.");
        finalizedValue = value;
        logResult(state, actor, surface, text, value);
        return value;
      }
      if (finishedValue) {
        finalizedValue = finishedValue;
        return finishedValue;
      }
      // Defensive fallback only: tokens() always awaits machineDone
      // before completing on every path but the refusal one (handled
      // above), so finalize() should never reach here in practice.
      const fallback = buildTurnValue(state, startedAt, "model", replyText);
      finalizedValue = fallback;
      logResult(state, actor, surface, text, fallback);
      return fallback;
    },
  };
}
