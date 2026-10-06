// U2b/c (docs/plans/turn-machine-state-record-2026-09-22.md, "Files"):
// the entry `routes/turn.ts` calls, with the same TurnStreamResult shape
// runTurnStream() already returns (the old engine file, imported here, never
// redefined - "one definition, one place"). the old engine file is not edited
// by U2.
//
// runTurnNext() (U2's own build) always resolves through TurnStreamResult's
// "immediate" variant - `backend/scripts/bench/replay.ts`'s scorer and
// routes/turn.ts's own blocking POST / route both want the whole reply
// at once, never a live stream. STREAM-NEXT-01 (below, this file's own
// runTurnNextStream()) is the "stream" variant a live client actually
// needs: routes/turn.ts's `/stream` route calls it.
import { turnTotalWaitMs } from "./deadline";
import { createActor, waitFor, type ActorRefFrom } from "xstate";
import type { Surface, TurnFailure, SpeakerEvidence, PresentPerson, TurnStreamResult, StreamOutcome, DocumentTurnAttachment } from "@/lib/turnShared";
import type { TurnValue } from "@/wire";
import { attachDocuments } from "./documents";
import { validateTurnInput, validateContinuationInput, BareModeForbidden, loadAllManifests, commandOpeners, computedPatternMatch, StreamSafetyRefusal, StreamUnavailable, CRISIS_RESOURCES_TEXT, deriveCrisisResources, judgeStatusAtInsert, variedConstantReply, speechTextFor } from "@/lib/turnShared";
import { acquireTurnLease, type TurnLease } from "@/lib/turnActivity";
import type { PersonRow } from "@/lib/memoryIngestion";
import { resolveOrCreateConversation, resolveSupersedes, getPendingAsk, setPendingAsk, logTurn, appendTemporaryTurn, isTemporaryConversation, type PendingAsk } from "@/lib/conversationHistory";
import { classifyTurnSignal } from "@/lib/turnSignal";
import { turnAgeBand } from "./speaker";
import { carriesCrisisSignal } from "@/lib/safety";
import { resolvePersona, DEFAULT_PERSONA } from "@/lib/persona";
import { isOwnerOrAdmin } from "@/lib/access";
import { speakerAgeBand } from "@/lib/ageBand";
import { pickStatusPhrase } from "@/lib/statusPhrases";
import { getHouseholdSettingValue, getPersonSettingValue } from "@/lib/settings";
import { planFor } from "@/lib/register";
import { surfaceClassOf } from "@/lib/surfaceClass";
import { AFFIRMATIVE_RE } from "@/lib/consentVocab";
import { newConversationTurnId } from "@/lib/id";
import { buildTurnStats } from "@/lib/turnStats";
import { structuredPartForOutcomes, artifactForOutcomes, projectForOutcomes } from "@/lib/composer";
import { emptyTimings, outcomeOf } from "@/lib/turnContext";
import { getActiveChatEngineIdentity, stackRefusal } from "@/lib/stackEngine";
import { nudgeChatEngineRecovery } from "@/lib/llmSupervisor";
import { roleHealth } from "@/lib/roleHealth";
import { START_PROJECT_TOOL_ID } from "@/lib/projects/tool";
import { postProjectResult } from "@/lib/projects/post";
import { StatusChannel } from "@/lib/statusChannel";
import { scheduleSummaryRefresh } from "@/lib/summaryRefresh";
import { scheduleConversationTitle } from "@/lib/conversationTitle";
import { StreamGate, gateGrainFor } from "./nodes/outputGate";
import { resolveTurnBudgetWithStack } from "./budget";
import { turnMachine } from "./machine";
import type { TraceRecorder } from "./trace";
import type { TurnState, ActionProposal, TurnBudget } from "./contract";
import type { Source } from "@maipai/spec/gen/ts/source.js";

export interface RunTurnNextOpts {
  conversationId?: string;
  temporary?: boolean;
  signal?: AbortSignal;
  // APPROVE-CARD-01: a tapped approve/deny card, from POST /api/turn or
  // /api/turn/stream's own additive `ask_answer` field - resumesAsk()'s
  // own doc comment has the full matching rule. Absent for every typed
  // or spoken turn, exactly as today.
  ask_answer?: { turn_id: string; approved: boolean };
  // THIN-0D: the robot body's own speaker_evidence and present list,
  // from POST /api/turn and /api/turn/stream (routes/turn.ts passes them
  // for the robot surface only). Absent means the body said nothing, and
  // a robot turn without evidence naming the signed-in person is anonymous.
  speakerEvidence?: SpeakerEvidence | null;
  present?: readonly PresentPerson[] | null;
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
  model?: string;
  // THIN-7C (ADMIN-COMPARE-01 b): the bare-mode bypass, chat surface only.
  // routes/turn.ts checks owner/admin and adult first (a clean 403); beginTurn()
  // asserts both again and throws BareModeForbidden, the structural backstop.
  bare?: boolean;
  // THIN-7C: the document attachments from POST /api/turn/stream (a typed chat
  // turn). Their text reaches the model and the safety check with the message;
  // the stored message stays what the person typed. A bad document throws
  // DocumentAttachmentError (a clean 400 at the route) before anything is
  // written; a temporary chat takes none.
  documentAttachments?: readonly DocumentTurnAttachment[];
  // THIN-7C (getmaipai/home#60, #88): the id of the turn an edited-and-resent
  // message replaces. An id that is not a turn of this conversation is dropped
  // by resolveSupersedes(), never trusted.
  supersedes?: string;
  // THIN-7C: the continuation of an answer that stopped short (routes/turn.ts's
  // continuation_of and continuation_text). An empty or oversized partial is a
  // 400 before anything runs.
  continuation?: { fromTurnId?: string; assistantText: string };
  // THIN-7C (getmaipai/home#91): routes/turn.ts passes this only for the Home
  // card's exact fixed question (isFixedHomeCardQuery()); it is never trusted
  // for any other text.
  ephemeral?: boolean;
}

function buildTurnValue(state: TurnState, startedAt: number, source: TurnValue["source"], text: string, speech?: string, reasoning?: string, sources?: Source[]): TurnValue {
  const stats = buildTurnStats(state.generations, emptyTimings(), startedAt, Date.now(), getActiveChatEngineIdentity(), state.budget.thinking_budget_tokens > 0);
  // A live acceptance run (U2d) caught this omitting plugin_id/
  // command_id/sources entirely - the old engine file's own equivalent
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
  // as the old engine file's own finalize() does - never dropping a genuine
  // input-side crisis mention just because the output side had nothing
  // to add. `state.streamGate` is undefined for every non-streaming
  // caller, so this is a no-op there.
  // THIN-0E (#85): a refused stream's result is the whole-reply check
  // (it carries an earlier delivered sentence's self_harm category), so
  // it wins over the last sentence's own flag.
  const inputCrisisLine = state.crisis ? CRISIS_RESOURCES_TEXT : undefined;
  const gated = state.streamGate?.result();
  // THIN-0M: a reply refused as a whole (blocking, or a streamed reply
  // held as an envelope) leaves its check on state.outputSafety instead.
  const outputFlag = gated?.refused ?? gated?.lastFlagged ?? state.outputSafety;
  const crisisResources = outputFlag ? (deriveCrisisResources(outputFlag) ?? inputCrisisLine) : inputCrisisLine;
  return {
    reply: { text, speech },
    source,
    ...(state.failedGenerationReply ? { failed_generation: true as const } : {}),
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
    // home#147: the old engine file's own logTurnSafely() (the old path)
    // sets both of these from the identical outcomes list - never
    // called here, so the new path built no structured part (the
    // weather/almanac card) and no artifact (write_document's own
    // outcome) for anything, on any turn. Same functions, same input.
    structured_part: structuredPartForOutcomes(state.outcomes) ?? undefined,
    artifact: artifactForOutcomes(state.outcomes) ?? undefined,
    // PROJECT-PROGRESS-01: a start_project outcome names the project id
    // it just launched, the same unconditional-line, no-new-dispatch
    // hookup the two fields above already use for their own outcomes.
    project: projectForOutcomes(state.outcomes) ?? undefined,
    ...(state.bare ? { bare: true } : {}),
    ...(source === "plugin" && packageId ? { plugin_id: packageId } : {}),
    ...(source === "command" && packageId ? { command_id: packageId } : {}),
    ...(sources && sources.length > 0 ? { sources } : {}),
  } as TurnValue;
}

function logResult(state: TurnState, actor: PersonRow, surface: Surface, text: string, value: TurnValue): void {
  // THIN-7C: an ephemeral turn (a Home card's fixed question) is never stored.
  if (state.ephemeral) return;
  // THIN-0L: the row marks a self-harm signal on this turn's input or on
  // its reply, whatever the reply's own action, so the conversation stays
  // in the crisis state for the next CRISIS_STATE_TURNS turns. The same
  // expression the old path's logTurnSafely() uses; state.crisis is not
  // used because it also carries the earlier turns' state, which would
  // keep the window open forever.
  const crisisSignal = carriesCrisisSignal(state.safety) || carriesCrisisSignal(value.safety);
  const opts = { signal: state.signal, plan: state.plan, outcomes: state.outcomes, temporary: state.temporary, crisisSignal, ...(state.subjects && state.subjects.length > 0 ? { subjects: state.subjects } : {}), ...(state.bare ? { bare: true } : {}), ...(state.supersedes ? { supersedes: state.supersedes } : {}), ...(state.continuation?.fromTurnId ? { branchFrom: state.continuation.fromTurnId } : {}) };
  if (state.temporary) {
    // THIN-0C: the old path's own status for a temporary turn (never a
    // judge candidate; the row is process memory only).
    appendTemporaryTurn(actor, surface, text, value, { ...opts, judgeStatus: "skipped" });
    // THIN-7E: a temporary chat asks about an unknown name and stores nothing (the commit is a no-op there).
    state.askCommit?.(value.reply.text);
    return;
  }
  // THIN-0C: the judge's queue is keyed on the stored signal; a safety
  // refusal and a credential turn are never the judge's
  // (the old engine file's judgeStatusAtInsert, the function the old path calls).
  // THIN-7C: a bare turn is never the judge's (ADMIN-COMPARE-01 b).
  logTurn(actor, surface, text, value, { ...opts, judgeStatus: state.bare ? "skipped" : judgeStatusAtInsert(value, state.signal) });
  // THIN-7E (ASK-01): the question the reply ended with stands as the conversation's pending ask only
  // now that the delivered text is known to carry it (a refusal that lost it commits nothing).
  state.askCommit?.(value.reply.text);
  // PROJECT-START-01 (lib/projects/post.ts's own header): this turn's
  // own conversation_turns row is only ever written here, at the very
  // end - unlike the legacy the old engine file's prepareTurn(), nothing on
  // this path writes a provisional row up front. A project that finishes
  // fast enough (every scripted test; a real one-step project on a fast
  // engine) can reach its terminal state, and try to attach its result to
  // this row, before this line ever runs - runner.ts's own terminal hook
  // finds no row yet and skips; this is the second, idempotent call that
  // catches exactly that race, now that the row certainly exists.
  for (const outcome of state.outcomes) {
    if (outcome.packageId !== START_PROJECT_TOOL_ID || outcome.status !== "succeeded") continue;
    const projectId = (outcome.result?.data as { projectId?: string } | undefined)?.projectId;
    if (projectId) postProjectResult(projectId);
  }
  // THIN-0G (rule 12): the rolling summary's post-turn refresh, the same
  // debounced, fire-and-forget scheduler the old path calls after its own
  // logTurn() (a temporary turn returned above, so schedules none).
  scheduleSummaryRefresh(value.conversation_id);
  // CHAT-TITLE-01: a topic title after the first exchange, off the reply's path; a no-op once titled.
  scheduleConversationTitle(value.conversation_id);
}

/** Whether the utterance is a plain "yes" to a stored confirm/lookup ask
 * (consentVocab.ts's own deterministic word, never a model's reading -
 * RULES-AND-LEARNED-COMPONENTS.md's "a yes is a yes by rule").
 *
 * APPROVE-CARD-01: `askAnswer`, when present, is a button tap
 * (POST /api/turn{,/stream}'s own `ask_answer` field) and REPLACES the
 * AFFIRMATIVE_RE text match for this call - it never runs both. A tap
 * only resumes when its `turn_id` matches the turn that parked THIS ask
 * (`ask.turnId`, set by finishTurn()'s "asked" branch). In practice
 * `beginTurn()` already intercepts a mismatched or answer-less-pending
 * `ask_answer` before this function is ever called with one (an
 * explicit 409 `ask_stale`, so the frontend can show "no longer waiting
 * for an answer" instead of a bare "Yes"/"No" bubble landing as an
 * ordinary chat message) - so the mismatch branch below is
 * defense-in-depth for a call site that doesn't yet exist, never the
 * primary gate; if one is ever added without going through
 * `beginTurn()`'s check, it still can't resume the wrong ask. Deny
 * (`approved: false`) still falls through to ordinary routing when the
 * ids DO match: the ask is cleared and nothing resumes, exactly like a
 * typed "no". When `askAnswer` is absent (a typed or spoken reply, no
 * button), the AFFIRMATIVE_RE path is unchanged. */
function resumesAsk(ask: PendingAsk, utterance: string, askAnswer?: { turn_id: string; approved: boolean }): ActionProposal | null {
  if (ask.kind !== "confirm") return null;
  if (askAnswer) {
    if (ask.turnId !== askAnswer.turn_id || !askAnswer.approved) return null;
  } else if (!AFFIRMATIVE_RE.test(utterance)) {
    return null;
  }
  return { kind: "side_effecting", request: { tool: ask.packageId, args: ask.args, callId: `resumed:${ask.packageId}` } };
}

/** finishTurn()'s own, narrow failure: the machine itself timed out or
 * was aborted (waitFor()'s own rejection) - never thrown for a bug
 * anywhere else in finishTurn()'s own body, which propagates uncaught
 * instead. The one thing each caller's own catch checks for by name. */
class TurnMachineTimeout extends Error {}

interface BegunTurn {
  // THIN-0C: the turn lease (lib/turnActivity.ts), held from here until
  // the turn is logged so the memory judge never runs beside a live turn.
  // Whoever receives the BegunTurn releases it exactly once.
  lease: TurnLease;
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
  // THIN-7C: "a child's turn can never run bare, whoever flips the switch".
  // speakerAgeBand() !== "adult" covers both minor bands (child and teen).
  if (opts.bare === true) {
    if (!isOwnerOrAdmin(actor)) throw new BareModeForbidden("bare mode is owner/admin only");
    if (speakerAgeBand(actor, new Date()) !== "adult") throw new BareModeForbidden("bare mode is not available to a minor");
  }
  const invalid = validateTurnInput(surface, text) ?? validateContinuationInput(opts.continuation);
  if (invalid) return { ok: false, result: invalid };

  // THIN-1C: `live` - the precheck asks the Stack itself, never a
  // remembered refusal (roleHealth.ts), so "try again in a moment" is a
  // real retry; the line still names the Stack's reason when the live
  // answer is no and a refusal is on record.
  if ((await roleHealth("chat", { live: true })).availability === "unavailable") {
    nudgeChatEngineRecovery();
    return { ok: false, result: { ok: false, status: 503, code: "engine_unavailable", error: engineUnavailableLine({ spoken: opts.spoken === true, surface }) } };
  }

  const resolved = resolveOrCreateConversation(actor, surface, opts.conversationId, { temporary: opts.temporary });
  if (!resolved.ok) return { ok: false, result: { ok: false, status: resolved.status as 400 | 503, code: resolved.code ?? "invalid_input", error: resolved.error } };
  const conversation = resolved.value;
  const temporary = isTemporaryConversation(conversation.id) || conversation.mode === "temporary";

  // THIN-0N: the speaker's effective band (an unidentified robot speaker
  // is the child band), for the signal, the plan and the stream gate,
  // as the old path's prepareTurn() derives it.
  const turnId = newConversationTurnId();
  const supersedes = resolveSupersedes(opts.supersedes, conversation.id) ?? undefined;
  // Old path: a continued turn that does not resolve keeps the id the client
  // sent (it only ever excludes a row from the window); the stored row's own
  // resolveSupersedes() in logTurn() is what drops it from the record.
  const continuation = opts.continuation;
  // THIN-7C: the pending ask and the stale-tap 409 come before a document is
  // stored, so a refused request leaves no provisional row or file behind.
  // THIN-7C: an edit never resumes an ask (the old path cleared it first).
  const pendingAsk = temporary || opts.bare === true || supersedes || continuation || opts.ephemeral === true ? null : getPendingAsk(conversation.id);
  // APPROVE-CARD-01: a tapped card's own `ask_answer` must match the
  // conversation's CURRENT pending ask by turn id, or it's stale (a
  // second ask parked since the card was shown, the ask was already
  // answered, or there was never one) - reported as a real 409, never
  // silently run through ordinary text processing (resumesAsk()'s own
  // turn-id check is belt-and-braces, not the primary gate: without
  // this early return a mismatch would just fall through to routing
  // whatever "Yes"/"No" text rode along with it, exactly like an
  // unrelated new statement, with no way for the caller to tell a real
  // answer from a stale one). The existing pending ask, if any, is for
  // a DIFFERENT turn than this stale tap named - left untouched, not
  // cleared: this request doesn't get to answer someone else's live
  // question by accident.
  if (opts.ask_answer && (!pendingAsk || pendingAsk.turnId !== opts.ask_answer.turn_id)) {
    return { ok: false, result: { ok: false, status: 409, code: "ask_stale", error: "This confirmation is no longer waiting for an answer." } };
  }
  // THIN-7C: the model, the safety check and the signal read the message with
  // its documents; logResult() is given the typed text, as the old path did.
  text = await attachDocuments(actor, surface, conversation.id, turnId, text, opts.documentAttachments ?? [], temporary || opts.ephemeral === true);
  const band = turnAgeBand(surface, actor, opts.speakerEvidence, new Date());
  // OPENER-01: the same shape opener commandOpenersFrom() reads for the
  // old path (the old engine file's own commandOpeners(effectiveLoaded)) - a
  // clause opening with a bundled package's own command verb ("look",
  // "convert", "define") reads as a directive by shape, the cue the
  // commands node's imperative wildcards (below) depend on to fire at
  // all. Every loaded manifest, not narrowed for temporary mode: this
  // is a shape cue for the signal only, never a routing decision -
  // the commands node's own temporary-mode guard still keeps a
  // memory:write package from actually firing in a temporary chat.
  // SIGNAL-02: the same loaded-manifests read commandOpeners() just
  // took, never a second load - computedPatternMatch() (the old engine file)
  // is the injected predicate turnSignal.ts's own clauseSubject() reads
  // to classify "what time is it in Tokyo" as target: computed instead
  // of world, so the interim rule stops forcing a search for it.
  const loaded = loadAllManifests();
  const signal = classifyTurnSignal({ text, ageBand: band, commandOpeners: commandOpeners(loaded), computedPatternMatch: (t) => computedPatternMatch(loaded, t) });
  const bare = opts.bare === true;
  const persona = temporary || bare ? DEFAULT_PERSONA : resolvePersona(getPersonSettingValue(actor, "persona.active_id"));
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
  const resolvedBudget = await resolveTurnBudgetWithStack(opts.model, band);
  const budget: TurnBudget = opts.thinking === true || bare ? { ...resolvedBudget, thinking_budget_tokens: resolvedBudget.thinking_budget_tokens_toggled } : resolvedBudget;

  const state: TurnState = {
    turnId,
    conversationId: conversation.id,
    actor,
    surface,
    ...(surface === "robot" ? { speakerEvidence: opts.speakerEvidence ?? null, present: opts.present ?? null } : {}),
    utterance: text,
    modelId: opts.model,
    signal,
    budget,
    persona,
    plan,
    planBasis,
    safety: { flagged: false, categories: [], action: "allow", notify_parent: false, matched_signals: [], checked_at: new Date().toISOString() },
    crisis: false,
    engineUnavailable: false,
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
    ...(bare ? { bare: true } : {}),
    ...(supersedes ? { supersedes } : {}),
    ...(continuation ? { continuation } : {}),
    ...(opts.ephemeral === true ? { ephemeral: true } : {}),
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
  const preConfirmed = pendingAsk ? (resumesAsk(pendingAsk, text, opts.ask_answer) ?? undefined) : undefined;
  // THIN-7E (ASK-01): a standing `who` question is read as an answer by the commands node
  // (askNames.ts), so it is kept on the state although the stored ask is cleared just below.
  if (pendingAsk?.kind === "who") state.pendingWho = pendingAsk;
  // Cleared either way a pending ask existed: resumed (so it can't be
  // resumed twice, the stuck-question failure REPLY-FIND-01 already
  // named), declined (NEGATIVE_RE), or an unrelated new statement - the
  // state record's own "a negative or a new statement clears it."
  if (pendingAsk || supersedes) setPendingAsk(conversation.id, null);

  // THIN-0C: acquired only after every early return above (an invalid
  // request or a stale tap acquires nothing), as the old path does.
  const lease = acquireTurnLease();
  try {
    const machineActor = createActor(turnMachine, { input: { turnState: state, abortSignal, preConfirmed } });
    machineActor.start();
    return { ok: true, value: { lease, state, machineActor, abortSignal, startedAt, temporary, conversationId: conversation.id } };
  } catch (err) {
    lease.release();
    throw err;
  }
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
  // THIN-0C: the old path engages the lease before routing, so a turn
  // that fails after the engine was reached still counts as household
  // activity (the old engine file's lease.engage()). Same here on the failure
  // paths: engage when the context or model node had run.
  const engageIfEngineReached = () => {
    if (state.nodes.some((n) => n.node === "context" || n.node === "model")) begun.lease.engage();
  };
  const finalSnapshot = await waitFor(machineActor, (s) => s.status === "done", { timeout: turnTotalWaitMs(state), signal: abortSignal }).catch((err: unknown) => {
    engageIfEngineReached();
    throw new TurnMachineTimeout(`turn machine failed: ${(err as Error).message}`);
  });
  const finalState = finalSnapshot.value as string;
  if (state.engineUnavailable) {
    engageIfEngineReached();
    throw new EngineUnavailableTurnError(engineUnavailableLine(state));
  }

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
  // THIN-0C: a turn that reached the context or model node used the
  // engine; engaging makes the release count as household activity (the
  // judge's idle window), as the old path's lease.engage() does.
  if (ranNodes.has("context") || ranNodes.has("model")) begun.lease.engage();

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
    //
    // APPROVE-CARD-01: `turnId` is stamped onto the persisted ask here,
    // this turn's own `state.turnId` - the id resumesAsk() matches a
    // button tap's `ask_answer.turn_id` against, so a stale card (a
    // second ask parked since this one was shown) can never approve the
    // wrong action. Not set when temporary: setPendingAsk()/
    // getPendingAsk() are no-ops for a temporary conversation, so
    // nothing is ever actually resumable there - a card promising one
    // would lie (a pre-existing gap, filed separately, not fixed here).
    // A "pending" outcome is recorded too, `via: "confirm"` (this path
    // had none at all before - a real gap, unlike the old path's own
    // equivalent park which already retains one): it's what a reload's
    // grounding/composer read of this turn's outcomes sees, the same
    // "the trace should say what actually happened" reasoning as every
    // other outcome this file already retains.
    if (ask) {
      state.outcomes.push(outcomeOf({ callId: `${state.turnId}:confirm`, packageId: ask.packageId, status: "pending", args: ask.args, via: "confirm", userMessage: promptText }));
    }
    if (ask && !temporary && !state.ephemeral) setPendingAsk(conversationId, { ...ask, turnId: state.turnId });
    value = buildTurnValue(state, startedAt, "confirm", promptText);
    if (ask && !temporary && !state.ephemeral) value.confirm = { package_id: ask.packageId, open: true };
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
    // whenever preConfirmed was set: the old engine file's own reference
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
    // Tier 2, or a tool call - the old engine file's own source: "plugin"
    // sites all report plugin_id, never command_id, for any of
    // these), and "command"/command_id only for a genuine
    // household-defined command (commands.ts's own custom.id branch).
    // Both commands.ts vias reach `answer` the identical way, so only
    // the source label here needed correcting, not the machine.
    const lastVia = state.outcomes.at(-1)?.via;
    const failedPattern = state.outcomes.some((outcome) => outcome.via === "pattern" && outcome.status === "failed");
    // THIN-7E: the answer to a who question is a "confirm", as the old engine reported it.
    const source: TurnValue["source"] = state.whoAnswer ? "confirm" : failedPattern ? "model" : lastVia === "command" ? "command" : lastVia === "pattern" || lastVia === "tool_call" || lastVia === "forced" ? "plugin" : "model";
    value = buildTurnValue(state, startedAt, source, gateOutput?.text ?? "", gateOutput?.speech, gateOutput?.reasoningOut, gateOutput?.sources);
    // 2026-10-03: after a successful tool call the reply is the model's
    // own composition, not a package's canned line. The stats stay on
    // source "plugin" (per-package counts), and routing tier "tool"
    // marks the row so the history window gives the reply back as the
    // assistant's own words instead of a bracketed note the model
    // imitated as its next reply ("[Web Search answered: ...]").
    const lastGeneration = state.generations.at(-1);
    if (source === "plugin" && lastVia === "tool_call" && state.outcomes.at(-1)?.status === "succeeded" && lastGeneration?.reason === "phrasing" && !lastGeneration.error) value.routing = { tier: "tool", score: 1 };
  }
  return finalizeNextReply(state, value);
}

/** THIN-0I (rules 12 and 14): the tail of the old path's finalizeReply()
 * on the default path - a known constant reply (the remember
 * confirmation, a safety refusal) comes from the active companion's own
 * pool or the shared one, through the same variedConstantReply()
 * the old engine file itself uses, never a second copy of the pools. Runs
 * after the output gate, exactly where the old path varies its own text:
 * every variant is a fixed, hand-written line from replyVariation.ts,
 * never model text, so nothing here loosens the gate for anyone.
 * `state.persona` is the persona beginTurn() resolved for this turn
 * (DEFAULT_PERSONA in a temporary chat), so the pool matches the
 * companion the system prompt was built under even when the person
 * switches companion mid-turn. The model's own text passes through
 * untouched (the old path's sentence-case opener is not ported: an
 * adult's written reply stays exactly as generated). An authored speech
 * text that differs from the visible text is kept as authored, the old
 * path's own rule.
 *
 * THIN-0J (rule 12): a spoken-class turn (robot, pod, phone, or a chat
 * turn the client flags as spoken) also gets the old path's server-side
 * speech text, through the same speechTextFor() the old engine file uses: the
 * varied text normalized for speaking, or the robot's first-sentence
 * projection. A written or glance turn keeps whatever speech its own
 * node authored (none for the model's text), so a written adult reply
 * is exactly what it was before this port. */
function finalizeNextReply(state: TurnState, value: TurnValue): TurnValue {
  const { text, speech } = value.reply;
  if (speech !== undefined && speech !== text) return value;
  const variedText = variedConstantReply(state.actor.id, value.source, text, state.persona.id);
  if (surfaceClassOf(state.surface, state.spoken) === "spoken") {
    return { ...value, reply: { ...value.reply, text: variedText, speech: speechTextFor(state.surface, variedText, speech) } };
  }
  if (variedText === text) return value;
  return { ...value, reply: { ...value.reply, text: variedText, ...(speech === undefined ? {} : { speech: variedText }) } };
}

class EngineUnavailableTurnError extends Error {
  constructor(message: string) { super(message); }
}

/** The one line for "the AI isn't running", for the precheck in
 * beginTurn() and for a model node that found the engine gone mid-turn.
 * THIN-1C (docs/design/RULES.md rule 6; fixes part of getmaipai/home#203):
 * when the Stack itself refused the chat role just now (a 503 with its
 * reason - the machine was low on memory), a written chat turn says so
 * in the household's wording and asks for a retry in a moment, instead
 * of a line that reads as if nothing is running at all; the health row
 * carries the identical line (roleHealth.ts). A spoken turn and every
 * non-chat surface keep their fixed line exactly (rule 0: nothing here
 * changes how a spoken turn is shaped). */
function engineUnavailableLine(state: Pick<TurnState, "spoken" | "surface">): string {
  if (state.spoken || state.surface !== "chat") return "I can't think right now. I've told the grown-ups.";
  return stackRefusal("chat")?.household ?? "MaiPai's AI isn't running right now.";
}

/** runTurnNext() always resolves the whole reply: a failure or an "immediate" value, never a stream. */
export type TurnImmediateResult = TurnFailure | Extract<TurnStreamResult, { kind: "immediate" }>;

export async function runTurnNext(actor: PersonRow, surface: Surface, text: string, opts: RunTurnNextOpts = {}): Promise<TurnImmediateResult> {
  const begun = await beginTurn(actor, surface, text, opts);
  if (!begun.ok) return begun.result;
  const { state, lease } = begun.value;
  let value: TurnValue;
  try {
    value = await finishTurn(begun.value);
  } catch (err) {
    lease.release();
    // Only the machine's own timeout/abort becomes a 503 "unavailable" -
    // anything else finishTurn() might throw (a real bug in buildTurnValue,
    // the trace bookkeeping) propagates uncaught, exactly as it did
    // before this file's beginTurn()/finishTurn() split, rather than
    // being silently reported as an engine outage.
    if (err instanceof EngineUnavailableTurnError) return { ok: false, status: 503, code: "engine_unavailable", error: err.message };
    if (err instanceof TurnMachineTimeout) return { ok: false, status: 503, code: "unavailable", error: err.message };
    throw err;
  }
  try {
    logResult(state, actor, surface, text, value);
  } finally {
    lease.release();
  }
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
 * (the old engine file) already fulfills for the old path - no second
 * transport. state.status is the identical StatusChannel/"status" wire
 * event the old path already streams; nodes/tool.ts pushes the same
 * "On it." line onto it the old engine file's own runTurnStream() does,
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
  // THIN-0C: anything below that throws before machineDone exists (its
  // .finally is the normal release) must not leak the lease; release()
  // is idempotent, so the normal path is unaffected.
  try {
    return startStream(actor, surface, text, begun.value);
  } catch (err) {
    begun.value.lease.release();
    throw err;
  }
}

function startStream(actor: PersonRow, surface: Surface, text: string, begunValue: BegunTurn): TurnStreamResult {
  const begun = { ok: true as const, value: begunValue };
  const { state, startedAt } = begun.value;

  const status = new StatusChannel();
  state.status = status;
  // STATUS-PHRASES-01: the very first thing a live client sees, before
  // any node has even run - the frontend's own "Thinking…" fallback
  // (chatTurnActivity.ts, shown only when no status event has arrived
  // yet) never looked missing precisely because nothing emitted this
  // moment before. Read back the instant it streams, same as every
  // other status line here.
  status.emit({ type: "status", text: pickStatusPhrase(state.conversationId, "thinking", state.persona), stage: "thinking" });

  const queue = new StatusChannel<string>();
  const band = turnAgeBand(surface, actor, state.speakerEvidence, new Date()); // THIN-0N
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
    // THIN-5B: reasoning released by the gate goes out as its own event.
    { releaseReasoning: (text) => status.emit({ type: "reasoning", text }), grain: gateGrainFor(band, surface, state.spoken) },
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
      begun.value.lease.release(); // THIN-0C: after the turn is logged (or failed), never before
      gate.finish(); // safety net - idempotent; closes the queue via onDone when model.ts's own successful-round finish() never ran (a generation failure before any drained, or an engine timeout)
      status.close();
      queue.close(); // idempotent
    });

  async function* tokens(): AsyncGenerator<string, StreamOutcome, void> {
    for await (const chunk of drainDeltaQueue(queue)) yield chunk;
    const result = gate.result();
    if (result.refused) throw new StreamSafetyRefusal(result.refused);
    await machineDone;
    if (state.engineUnavailable) throw new StreamUnavailable(engineUnavailableLine(state), "engine_unavailable");
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
    // TOOL-EVENTS-02: the live array `nodes/tool.ts` pushes onto as the
    // machine's own tool round runs - a reference, not a snapshot, so
    // streamTurnEvents() (routes/turn.ts) reads it already populated by
    // the time it looks, right after that round's one synchronous
    // transition and strictly before the phrasing round's first delta.
    // Found live: TOOL-EVENTS-01(b) only ever wired this into the
    // "immediate" kind above, never "stream" - STREAM-NEXT-01 later made
    // every live turn return "stream", so a real search on a live chat
    // never carried a tool_call/tool_result at all until this.
    toolEvents: state.toolEvents,
    // ENGINEERING gap, named rather than silently worked around: the new
    // path has no equivalent of the old engine file's own bannedPhrasesFor()
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
