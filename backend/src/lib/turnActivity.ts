// Shared by turnEngine.ts (holds a lease for every real household turn)
// and background LLM work that must never contend with one on the shared
// `chat` engine slot (lib/memoryJudge.ts's per-minute tick) - a latency
// review, 2026-09-06, found the judge's own extraction/embed/dedupe calls
// evicting the household's KV prefix and queuing a live turn behind them
// mid-conversation ("very likely the largest latency variance source in
// family use"), since llama-server runs one slot and serializes every
// request through it regardless of caller. In-memory only, and
// deliberately so: a restart just means the gate opens immediately (no
// activity remembered), which is the correct, safe default - there is
// nothing yet to protect against right after a boot.
//
// CHAT-18: a lease, not a pair of global counters. The old
// markTurnStarted()/markTurnFinished() pair had to be matched by hand on
// every exit path of runTurn()/runTurnStream(), and FAST-04's generator
// paths (the peek, the resolved variant, StreamUnavailable) kept adding
// exit paths; one missed match leaked an in-flight count that only a
// two-minute timer ever cleared, and a stray finish could decrement a
// DIFFERENT turn's count. acquireTurnLease() returns a release() that is
// idempotent and scoped to its own lease: releasing twice is a no-op,
// and no release can ever touch another turn. The timer is gone as a
// correctness mechanism; a lease held past MAX_TURN_DURATION_MS is a
// diagnostic (logged once), never a decrement.
let lastTurnStartedAt = 0;
// getmaipai/home#63: `lastTurnStartedAt` alone only measures from a
// turn's START - a live diagnosis (2026-09-07) measured the judge's own
// extraction call adding 2 to 4.7 seconds to a chat reply that started
// WHILE the judge was mid-batch, because `runJudgeBatch()` checked
// idleness once at the top of a ten-turn batch and never again. Tracking
// completions too lets the gate measure quiet time from when the
// household's own reply actually finished, not just from when it began -
// a voice answer that streams for longer than the window would otherwise
// look "idle" before it is even done.
let lastTurnFinishedAt = 0;
// A lease held this long is reported as stale by turnActiveWithin(), once
// per lease. No real turn takes anywhere near this long; a lease that
// does is a leak to find, not a count to quietly fix.
const MAX_TURN_DURATION_MS = 120_000;

let now: () => number = () => Date.now();

/** The shared "household is mid-conversation" window every background
 * caller gates on - memoryJudge.ts's runJudgeBatch()/runConsolidation()
 * (already using this exact value before it was pulled out here) and
 * conversationHistory.ts's maybeRefreshConversationSummary() (issue #45)
 * both want the identical answer to "did a real turn happen recently
 * enough that background work would contend with it," so one constant,
 * not a value quietly re-typed at each call site risking drift. 20s per
 * the 2026-09-06 latency review's own "no turn in the last ~20s."  */
export const DEFAULT_IDLE_WINDOW_MS = 20_000;

export interface TurnLease {
  /** Marks the moment the turn is about to reach an engine (routing's
   * embed, the chat model): from here the finished timestamp counts as
   * household activity for the idle window. A turn that never engages
   * (a safety refusal, a pending-ask answer, a household command, none
   * of which touch an engine; a 2026-09-06 review found marking those
   * kept the judge gated for a household that mostly uses commands)
   * still holds the in-flight count while it runs, so an overlapping
   * long turn is never mistaken for quiet, but leaves no cooldown
   * behind when it releases. */
  engage(): void;
  /** Idempotent. The second and every later call is a no-op; the
   * finished timestamp is the moment of the FIRST call, the actual
   * release, never a time recorded earlier. */
  release(): void;
  readonly released: boolean;
}

interface LeaseState {
  acquiredAt: number;
  engaged: boolean;
  released: boolean;
  staleReported: boolean;
}

const held = new Set<LeaseState>();

/** Called once per validated turn (runTurn()/runTurnStream(), after the
 * input and conversation checks; an invalid request acquires nothing).
 * The caller owns the release: a blocking turn releases in `finally`, a
 * streaming turn hands the lease to its token generator, which releases
 * when the generator finishes, throws, or is returned from (a client
 * disconnect included). */
export function acquireTurnLease(): TurnLease {
  const state: LeaseState = { acquiredAt: now(), engaged: false, released: false, staleReported: false };
  held.add(state);
  return {
    engage() {
      if (state.released || state.engaged) return;
      state.engaged = true;
      lastTurnStartedAt = now();
    },
    release() {
      if (state.released) return;
      state.released = true;
      held.delete(state);
      if (state.engaged) lastTurnFinishedAt = now();
    },
    get released() {
      return state.released;
    },
  };
}

/** True when a real household turn is still running (holds a lease),
 * or an engaged turn finished within `windowMs`, or (the pre-existing
 * fallback) one started within `windowMs`. A turn in flight blocks
 * background work regardless of `windowMs` - there is no reading of
 * "the house is quiet" under which a reply is still streaming. `false`
 * forever after a restart until the first real turn happens - see this
 * module's own header comment for why that's the safe default. */
export function turnActiveWithin(windowMs: number): boolean {
  const t = now();
  for (const lease of held) {
    if (!lease.staleReported && t - lease.acquiredAt >= MAX_TURN_DURATION_MS) {
      lease.staleReported = true;
      console.warn(`[turn-activity] a turn lease has been held for ${Math.round((t - lease.acquiredAt) / 1000)} s; background work stays gated until it is released (a leaked lease is a bug to find, not a count to clear)`);
    }
  }
  if (held.size > 0) return true;
  if (lastTurnFinishedAt !== 0 && t - lastTurnFinishedAt < windowMs) return true;
  return lastTurnStartedAt !== 0 && t - lastTurnStartedAt < windowMs;
}

/** How many leases are held right now: the acceptance's "exact correct
 * active count" (tests), and the stale diagnostic's subject. */
export function activeTurnCount(): number {
  return held.size;
}

export function __resetTurnActivityForTests(): void {
  lastTurnStartedAt = 0;
  lastTurnFinishedAt = 0;
  held.clear();
  now = () => Date.now();
}

/** The clock seam: tests advance time instead of sleeping through the
 * idle window (a real 20 s wait per case is not a unit test). */
export function __setTurnActivityClockForTests(clock: () => number): void {
  now = clock;
}
