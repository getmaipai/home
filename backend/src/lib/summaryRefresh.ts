// THIN-0G (rule 12, rule 4): the post-turn, debounced refresh of a
// conversation's rolling summary, moved out of the retired turn engine unchanged so
// the default path (turnMachine/turnNext.ts) schedules it through the same
// code as the old path. Debounce, delay and background engine are the old
// path's; redaction of credentials happens inside
// maybeRefreshConversationSummary() itself.
import { maybeRefreshConversationSummary } from "@/lib/conversationHistory";
import { DEFAULT_IDLE_WINDOW_MS } from "@/lib/turnActivity";

// One pending timer per conversation, not one per turn - see
// the retired turn engine's logTurnSafely() comment for the bug this fixes. Exported only for
// __clearPendingSummaryRefreshesForTests() below.
const pendingSummaryRefreshes = new Map<string, ReturnType<typeof setTimeout>>();

export function scheduleSummaryRefresh(conversationId: string): void {
  const existing = pendingSummaryRefreshes.get(conversationId);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    pendingSummaryRefreshes.delete(conversationId);
    // A fold that stopped for a live turn (the idle gate) is asked again
    // after the next idle window, since that turn may be another
    // conversation's and would not schedule this one.
    maybeRefreshConversationSummary(conversationId)
      .then((yielded) => { if (yielded && !pendingSummaryRefreshes.has(conversationId)) scheduleSummaryRefresh(conversationId); })
      .catch((err: unknown) => console.error(`[turn] conversation summary refresh failed: ${(err as Error).message}`));
  }, summaryRefreshDelayMs);
  pendingSummaryRefreshes.set(conversationId, timer);
}

// Test-only override for the debounce delay above - a real setTimeout()
// proves the actual cascade (a newer turn cancels an older turn's own
// pending timer) deterministically and fast, the same "real timer, sped
// way up" shape lib/sidecars.ts's __setSidecarTimingForTestsOnly()
// already uses, rather than mocking setTimeout itself or waiting out the
// real 20s.
let summaryRefreshDelayMs: number = DEFAULT_IDLE_WINDOW_MS;
export function __setSummaryRefreshDelayForTests(ms: number | null): void {
  summaryRefreshDelayMs = ms ?? DEFAULT_IDLE_WINDOW_MS;
}

/** Test-only: cancels every pending debounced summary-refresh timer
 * without letting it fire. A code review found every test file calling
 * runTurn() (memoryJudge.test.ts, notifications.test.ts, safety.test.ts,
 * tier2.test.ts, chatTurn.test.ts itself, and more) leaves one of these
 * timers outstanding at DEFAULT_IDLE_WINDOW_MS (20s) - most test files
 * finish well before that, so the timer fires later, against whatever the
 * NEXT test's resetDb() has already replaced the database with (a
 * different conversationId - maybeRefreshConversationSummary()'s own
 * not-found guard makes this harmless today, but it is still real
 * background work racing against unrelated tests for no reason). Wired
 * into resetDb() (tests/reset-db.ts) rather than into every individual
 * test file, so every file already calling resetDb() in its own
 * beforeEach gets this for free. */
export function __clearPendingSummaryRefreshesForTests(): void {
  for (const timer of pendingSummaryRefreshes.values()) clearTimeout(timer);
  pendingSummaryRefreshes.clear();
}
