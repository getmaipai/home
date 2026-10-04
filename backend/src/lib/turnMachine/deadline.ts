import type { TurnState } from "./contract";
import { isWrittenAdultTurn } from "@/lib/surfaceClass";

// U2b (simple-turn-pipeline-2026-09-22.md section 11): "every node has
// a deadline, and it can be cut." One small helper, not XState's own
// `after` transition machinery: a node's deadline is enforced at its
// own call boundary (machine.ts's runNode()) by racing the node's
// promise against a timeout chained to the turn's own abort signal, so
// a node that finishes first never pays for a timer that never fired,
// and a node that overruns is cut exactly once, from exactly one place.
export function nodeSignal(parent: AbortSignal, deadlineMs: number): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  if (parent.aborted) {
    controller.abort(parent.reason);
    return { signal: controller.signal, clear: () => {} };
  }
  const onParentAbort = () => controller.abort(parent.reason);
  parent.addEventListener("abort", onParentAbort, { once: true });
  // DEADLINE-02: an infinite deadline sets no timer (an adult's written
  // model node, bounded by streamWatchdog() instead).
  const timer = Number.isFinite(deadlineMs) ? setTimeout(() => controller.abort(new DOMException("node deadline exceeded", "TimeoutError")), deadlineMs) : undefined;
  return {
    signal: controller.signal,
    clear: () => {
      clearTimeout(timer);
      parent.removeEventListener("abort", onParentAbort);
    },
  };
}

/** DEADLINE-02 (RULES.md rule 5): an adult's written reply has no
 * wall-clock cap, so its model node and its turn total are not timed as a
 * whole; the stream watchdog below ends a hung engine instead. The same
 * predicate as nodes/model.ts's replyMaxTokensFor(). A child's, a teen's
 * and every spoken turn keep deadlines_ms.model and .total as they were. */
export function replyIsUncapped(state: TurnState): boolean {
  return isWrittenAdultTurn(state.planBasis.surfaceClass, state.plan.age_band) && !state.planBasis.brevity;
}

/** The model node's wall-clock deadline: none for an uncapped reply. */
export function modelNodeDeadlineMs(state: TurnState): number {
  return replyIsUncapped(state) ? Infinity : state.budget.deadlines_ms.model;
}

/** The turn's overall wait (turnNext.ts): none for an uncapped reply,
 * whose parts are each bounded (node deadlines, the stream watchdog). */
export function turnTotalWaitMs(state: TurnState): number {
  return replyIsUncapped(state) ? Infinity : state.budget.deadlines_ms.total + 5000;
}

/** Two timers on one generation: first_token_ms from the request to the
 * first piece of any kind (an engine may be loading), then stall_ms of
 * silence, re-armed by every piece. Call beat() on each piece. */
export function streamWatchdog(parent: AbortSignal, firstTokenMs: number, stallMs: number): { signal: AbortSignal; beat: () => void; clear: () => void } {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = (ms: number, message: string) => {
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort(new DOMException(message, "TimeoutError")), ms);
  };
  const onParentAbort = () => controller.abort(parent.reason);
  if (parent.aborted) controller.abort(parent.reason);
  else {
    parent.addEventListener("abort", onParentAbort, { once: true });
    arm(firstTokenMs, "first token deadline exceeded");
  }
  return {
    signal: controller.signal,
    beat: () => {
      if (!controller.signal.aborted) arm(stallMs, "stream stalled");
    },
    clear: () => {
      clearTimeout(timer);
      parent.removeEventListener("abort", onParentAbort);
    },
  };
}

/** T5 / THIN-2G: the retry round of a spoken turn gets half the deadline, so a
 * failed lookup never pushes the first word past the spoken turn's budget. */
export function retryDeadlineMs(deadlineMs: number, spoken: boolean): number {
  return spoken ? Math.floor(deadlineMs / 2) : deadlineMs;
}
