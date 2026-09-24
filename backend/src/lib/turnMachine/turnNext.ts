// U2b/c (docs/plans/turn-machine-state-record-2026-09-22.md, "Files"):
// the entry `routes/turn.ts` will call once turn.pipeline.next is on
// (that wiring is a later unit - see this file's own header note
// below), with the same TurnStreamResult shape runTurnStream() already
// returns (turnEngine.ts, imported here, never redefined - "one
// definition, one place"). turnEngine.ts is not edited by U2.
//
// Scope note for this session's build: this function always resolves
// through TurnStreamResult's "immediate" variant. The "stream" variant
// (StatusChannel, cueSuppressed, banned-phrase list, the finalize()
// closure) is routes/turn.ts's own streaming/UI contract, built for
// runTurnStream()'s token-by-token delivery to a live client; nothing
// in the design record's own "Files" list names routes/turn.ts as a
// U2 file, and wiring the new path into the live HTTP route (so a
// household actually gets streamed tokens from it) is later work, not
// this unit's. `backend/scripts/bench/replay.ts`'s scorer and a caller
// that awaits the full reply (the acceptance bench, a future route
// once it exists) both work correctly against "immediate" today; a
// caller wanting live deltas mid-turn is the real gap this leaves,
// named here rather than silently worked around.
import { createActor, waitFor } from "xstate";
import type { Surface, TurnValue, TurnStreamResult } from "@/lib/turnEngine";
import { validateTurnInput, loadAllManifests, commandOpeners, computedPatternMatch } from "@/lib/turnEngine";
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
import { emptyTimings } from "@/lib/turnContext";
import { getActiveChatEngineIdentity } from "@/lib/stackEngine";
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
  return {
    reply: { text, speech },
    source,
    safety: state.safety,
    conversation_id: state.conversationId,
    turn_id: state.turnId,
    crisis_resources: state.crisis ? "If you or someone you know is in crisis, help is available. Call or text 988 (US) any time." : undefined,
    // "One trace, not a second log" (section 11): every node this turn
    // ran or skipped, beside the generations buildTurnStats() already
    // projects above.
    stats: { ...stats, nodes: state.nodes },
    // REASONING-02's own field, populated only when `context` allowed
    // emitting this turn AND output_gate's own safety pass over the
    // span didn't refuse it - the gated span itself, never the raw one.
    reasoning,
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

export async function runTurnNext(actor: PersonRow, surface: Surface, text: string, opts: RunTurnNextOpts = {}): Promise<TurnStreamResult> {
  const startedAt = Date.now();
  const invalid = validateTurnInput(surface, text);
  if (invalid) return invalid;

  const resolved = resolveOrCreateConversation(actor, surface, opts.conversationId, { temporary: opts.temporary });
  if (!resolved.ok) return { ok: false, status: resolved.status as 400 | 503, code: "invalid_input", error: resolved.error };
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
  let finalSnapshot;
  try {
    finalSnapshot = await waitFor(machineActor, (s) => s.status === "done", { timeout: state.budget.deadlines_ms.total + 5000, signal: abortSignal });
  } catch (err) {
    return { ok: false, status: 503, code: "unavailable", error: `turn machine failed: ${(err as Error).message}` };
  }
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
    if (ask && !temporary) setPendingAsk(conversation.id, ask);
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

  logResult(state, actor, surface, text, value);
  // TOOL-EVENTS-01(b): omitted entirely (not an empty array) when this
  // turn ran no tool - routes/turn.ts spreads it in only when present,
  // so a turn with nothing to report costs nothing on the wire.
  return { ok: true, kind: "immediate", value, signal, ...(state.toolEvents.length > 0 ? { toolEvents: state.toolEvents } : {}) };
}
