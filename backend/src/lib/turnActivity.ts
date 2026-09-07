// Shared by turnEngine.ts (marks a real household turn as starting) and
// background LLM work that must never contend with one on the shared
// `chat` engine slot (lib/memoryJudge.ts's per-minute tick) - a latency
// review, 2026-09-06, found the judge's own extraction/embed/dedupe calls
// evicting the household's KV prefix and queuing a live turn behind them
// mid-conversation ("very likely the largest latency variance source in
// family use"), since llama-server runs one slot and serializes every
// request through it regardless of caller. In-memory only, and
// deliberately so: a restart just means the gate opens immediately (no
// activity remembered), which is the correct, safe default - there is
// nothing yet to protect against right after a boot.
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
let inFlightTurns = 0;
// A turn still "in flight" this long after it started is treated as
// abandoned, not as still running forever - an unbounded counter would
// let one leaked increment (an unhandled exception, or a stream aborted
// by a client disconnect before its own finalize() runs) permanently
// starve the judge. No real turn takes anywhere near this long.
const MAX_TURN_DURATION_MS = 120_000;

/** The shared "household is mid-conversation" window every background
 * caller gates on - memoryJudge.ts's runJudgeBatch()/runConsolidation()
 * (already using this exact value before it was pulled out here) and
 * conversationHistory.ts's maybeRefreshConversationSummary() (issue #45)
 * both want the identical answer to "did a real turn happen recently
 * enough that background work would contend with it," so one constant,
 * not a value quietly re-typed at each call site risking drift. 20s per
 * the 2026-09-06 latency review's own "no turn in the last ~20s."  */
export const DEFAULT_IDLE_WINDOW_MS = 20_000;

/** Called once at the top of turnEngine.ts's prepareTurn() - the one
 * point every real turn (chat, and eventually every other surface) passes
 * through before it can ever reach the chat engine. */
export function markTurnStarted(): void {
  lastTurnStartedAt = Date.now();
  inFlightTurns++;
}

/** Called at every real finalize point a turn that called
 * markTurnStarted() can reach (turnEngine.ts's runTurn() return and
 * runTurnStream()'s own finalize() closure, both paths) - getmaipai/home
 * #63's other half: without this, `turnActiveWithin()` had no way to
 * know a turn had ENDED, only that one had started sometime in the last
 * `windowMs`. */
export function markTurnFinished(): void {
  if (inFlightTurns > 0) inFlightTurns--;
  lastTurnFinishedAt = Date.now();
}

/** True when a real household turn is still running, finished within
 * `windowMs`, or (the pre-existing fallback, kept for any path that
 * calls markTurnStarted() without a matching markTurnFinished()) started
 * within `windowMs`. A turn actively in flight blocks background work
 * regardless of `windowMs` - there is no reading of "the house is quiet"
 * under which a reply is still streaming. `false` forever after a
 * restart until the first real turn happens - see this module's own
 * header comment for why that's the safe default. */
export function turnActiveWithin(windowMs: number): boolean {
  const now = Date.now();
  if (inFlightTurns > 0 && now - lastTurnStartedAt < MAX_TURN_DURATION_MS) return true;
  if (lastTurnFinishedAt !== 0 && now - lastTurnFinishedAt < windowMs) return true;
  return lastTurnStartedAt !== 0 && now - lastTurnStartedAt < windowMs;
}

export function __resetTurnActivityForTests(): void {
  lastTurnStartedAt = 0;
  lastTurnFinishedAt = 0;
  inFlightTurns = 0;
}
