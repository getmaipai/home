// ADMIN-COMPARE-01 (b): a NEW real turn, sent through the actual
// POST /api/turn/stream request (never a separate endpoint the way
// feature (a)'s one-off compare is), running bareCompletion.ts's
// already-safety-gated bypass instead of the normal persona/routing/
// package pipeline. A sibling to runTurnStream() - built entirely from
// pieces turnEngine.ts and conversationHistory.ts already export for
// reuse, never a branch inside runTurnStream() or inside
// prepareTurn()'s own routing machinery (COORDINATOR, 2026-09-22:
// "every future reader of that file would have to hold two pipelines
// in their head").
//
// Two invariants this file asserts, not just documents:
// - Admin-only: checked here even though routes/turn.ts also checks it
//   before calling in (defense in depth, "whoever flips the switch").
// - Never a minor's turn, full stop: resolveOrCreateConversation()
//   requires the actor to own the conversation they're posting into, so
//   the turn's own speaker is always `actor` - checked once, here.
import { resolveOrCreateConversation, buildConversationWindow } from "@/lib/conversationHistory";
import { logTurn } from "@/lib/conversationHistory";
import { acquireTurnLease } from "@/lib/turnActivity";
import { newConversationTurnId } from "@/lib/id";
import { startBareCompletion } from "@/lib/bareCompletion";
import { speakerAgeBand } from "@/lib/ageBand";
import { fallbackSignal } from "@/lib/turnSignal";
import { isOwnerOrAdmin } from "@/lib/access";
import { StatusChannel } from "@/lib/statusChannel";
import { carriesCrisisSignal } from "@/lib/safety";
import { REFUSAL_FIRST } from "@/lib/replyVariation";
import { StreamSafetyRefusal, deriveCrisisResources, validateTurnInput, type TurnStreamResult, type StreamOutcome } from "@/lib/turnEngine";
import type { PersonRow } from "@/types";
import type { TurnValue } from "@/wire";

// The safety-owned refusal text every turn already uses for a first
// safety_refuse - the same constant, not a hand-copied string, so a
// later reword of the real product's own refusal line can't silently
// drift from bare mode's. Not pickRefusalVariant()'s own per-person
// rotation: that's reply VARIATION, a flavor bare mode does not add.
const BARE_REFUSAL_TEXT = REFUSAL_FIRST[0]!;

// routes/turn.ts checks both of these first and returns a clean 403 -
// TurnFailure's own status union (400 | 503) has no slot for that, by
// design (its own comment: one shared, deliberately narrow vocabulary
// for runTurn()/runTurnStream()'s validation states, not every possible
// failure). This throw is the structural backstop, not the normal
// path: it should be unreachable in practice, and asserts that even if
// some future caller forgets the route-level check, this function
// still refuses to construct a bare turn for a non-admin or a minor.
export class BareModeForbidden extends Error {
  constructor(message: string) {
    super(message);
  }
}

export async function runBareTurnStream(actor: PersonRow, text: string, conversationId?: string, signal?: AbortSignal): Promise<TurnStreamResult> {
  if (!isOwnerOrAdmin(actor)) throw new BareModeForbidden("bare mode is owner/admin only");
  // "A child's turn can never run bare, whoever flips the switch"
  // (COORDINATOR, 2026-09-22) - the codebase's own minor-detection
  // convention (conversation_turns.minorSpeaker, evaluateSafety()) is
  // speakerAgeBand() !== "adult", so this blocks both bands the role
  // ladder calls minor (child and teen), not "child" read narrowly.
  // Computed once, here, and reused below (fallbackSignal()'s own
  // age_band) - the actor's role/birthdate can't change mid-request.
  const ageBand = speakerAgeBand(actor, new Date());
  if (ageBand !== "adult") throw new BareModeForbidden("bare mode is not available to a minor");

  const invalid = validateTurnInput("chat", text);
  if (invalid) return invalid;

  const conversationResult = resolveOrCreateConversation(actor, "chat", conversationId);
  if (!conversationResult.ok) {
    return { ok: false, status: 400, code: "invalid_input", error: conversationResult.error };
  }
  const conversation = conversationResult.value;

  const lease = acquireTurnLease();
  const turnId = newConversationTurnId();
  const startedAt = Date.now();
  // A review caught this: try/catch only releases the lease on a THROW,
  // but the very next line below can also `return` a plain failure
  // value (engine unavailable) with no exception at all - that path
  // skipped the catch entirely and leaked the lease, permanently
  // blocking turnActiveWithin()'s own gate (memoryJudge.ts's batch/
  // consolidation runs, conversationHistory.ts's summary refresh) the
  // moment the engine hiccuped once with bare mode on. finally runs on
  // every exit - return, throw, or the normal fall-through - which is
  // exactly why runTurnStream() itself uses one (its own comment:
  // "everything up to the handoff runs under one finally... so a future
  // throw anywhere... cannot leak").
  let handedOff = false;
  try {
    const window = buildConversationWindow(conversation);
    const started = await startBareCompletion(window.messages, text, actor, turnId, signal);
    // "unsupported_role" is unreachable in practice (the "chat" role
    // passed to startCompleteStream is always valid) but isn't part of
    // TurnFailure's own vocabulary - mapped to "unavailable" rather than
    // widening that shared type for a code that can never actually fire
    // here.
    if (!started.ok) return { ok: false, status: started.status, code: started.code === "invalid_input" ? "invalid_input" : "unavailable", error: started.error };

    const status = new StatusChannel();
    let finalized: TurnValue | null = null;

    async function* holdLease(inner: AsyncGenerator<string, StreamOutcome, void>): AsyncGenerator<string, StreamOutcome, void> {
      try {
        return yield* inner;
      } finally {
        status.close();
        lease.release();
      }
    }

    handedOff = true;
    return {
      ok: true,
      kind: "stream",
      conversationId: conversation.id,
      turnId,
      // No routing ever ran, so there is no real TurnSignal to freeze -
      // the same "nothing to report" shape fallbackSignal() already
      // gives a non-routed turn elsewhere.
      signal: fallbackSignal(text, ageBand),
      startedAt,
      cueSuppressed: true,
      bannedPhrases: [],
      tokens: holdLease(started.tokens),
      status,
      finalize: (replyText: string, outcome?: StreamOutcome): TurnValue => {
        status.close();
        if (finalized) return finalized;
        lease.release();
        const safety = outcome && !("resolved" in outcome) ? outcome : undefined;
        const refusedWithNothingDelivered = safety?.action === "refuse" && replyText.trim() === "";
        const value: TurnValue = {
          reply: { text: refusedWithNothingDelivered ? BARE_REFUSAL_TEXT : replyText },
          source: refusedWithNothingDelivered ? "safety_refuse" : "model",
          safety: safety ?? { flagged: false, categories: [], action: "allow", notify_parent: false, matched_signals: [], checked_at: new Date().toISOString() },
          crisis_resources: safety ? deriveCrisisResources(safety) : undefined,
          conversation_id: conversation.id,
          turn_id: turnId,
          bare: true,
        };
        finalized = value;
        // SAFETY-01: the self-harm category marks the row whatever the
        // reply's own action (turnEngine.ts's logTurnSafely() does the
        // identical thing for a real turn) - conversationInCrisis()
        // reads the last 10 turns' own crisis_signal in the
        // conversation to decide whether the household stays in the
        // crisis-overlay state; an un-set bare turn would silently
        // break that continuity for the ordinary turns around it.
        const crisisSignal = carriesCrisisSignal(value.safety);
        // Matches logTurnSafely()'s own try/catch (turnEngine.ts): a
        // transient DB failure here must not surface as a failed turn
        // to the admin when the bare reply already generated and
        // streamed successfully - the reply is already on screen by
        // the time finalize() runs.
        try {
          logTurn(actor, "chat", text, value, { judgeStatus: "skipped", bare: true, crisisSignal });
        } catch (err) {
          console.error(`[turn/bare-stream] logTurn failed for an otherwise-successful bare turn: ${(err as Error).message}`);
        }
        return value;
      },
    };
  } finally {
    if (!handedOff) lease.release();
  }
}

export { StreamSafetyRefusal };
