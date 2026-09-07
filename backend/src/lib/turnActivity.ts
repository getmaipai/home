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
}

/** True when a real household turn started within `windowMs` of now.
 * `false` forever after a restart until the first real turn happens - see
 * this module's own header comment for why that's the safe default. */
export function turnActiveWithin(windowMs: number): boolean {
  return lastTurnStartedAt !== 0 && Date.now() - lastTurnStartedAt < windowMs;
}

export function __resetTurnActivityForTests(): void {
  lastTurnStartedAt = 0;
}
