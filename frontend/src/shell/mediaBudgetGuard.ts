// MEDIA-KID-01: the player side of the daily media minutes. The hub meters time and refuses new bytes once it is up, but a video
// the browser already buffered would keep playing, so the shell watches the one host element (mediaHost.tsx: every media app's
// player, the docked mini bar and audio-only players use it) and pauses it when the person's budget says time is up. The words come
// from the hub (`line` on GET /api/media/budget, MEDIA_KID_COPY), shown once through the shell's toast.
import type { MediaBudgetResponse } from "@/lib/api";

export type BudgetRead = MediaBudgetResponse & { line?: string | null };

export interface GuardDeps {
  fetchBudget: () => Promise<BudgetRead>;
  notify: (line: string) => void;
  /** Runs `run` on a repeating timer and returns a stop function (an injected clock, so tests drive it). */
  every: (run: () => void) => () => void;
}

export const BUDGET_CHECK_MS = 15_000;

export const intervalEvery = (ms: number) => (run: () => void) => {
  const id = setInterval(run, ms);
  return () => clearInterval(id);
};

/** Watches one element: checks the budget on every play and every 15 s while it plays; once time is up it pauses the element,
 * shows the kid line once, and pauses any later play at once until a check sees more minutes (a grown-up extended today).
 * A failed read changes nothing: it never pauses on its own and never throws. Returns a stop function. */
export function guardMediaBudget(el: HTMLMediaElement, deps: GuardDeps): () => void {
  let exhausted = false;
  let told = false;
  let live = true;
  const check = async () => {
    let budget: BudgetRead;
    try { budget = await deps.fetchBudget(); } catch { return; }
    if (!live) return;
    exhausted = budget.limit_min > 0 && budget.exhausted;
    if (!exhausted) return;
    if (!el.paused) el.pause();
    if (!told && budget.line) { told = true; deps.notify(budget.line); }
  };
  const onPlay = () => {
    if (exhausted) el.pause();
    void check();
  };
  el.addEventListener("play", onPlay);
  const stopTimer = deps.every(() => { if (!el.paused) void check(); });
  return () => {
    live = false;
    el.removeEventListener("play", onPlay);
    stopTimer();
  };
}
