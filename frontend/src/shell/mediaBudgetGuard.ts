// MEDIA-KID-01: the player side of the daily media minutes. The hub meters time and refuses new bytes once it is up, but a video
// the browser already buffered would keep playing, so the shell watches the one host element (mediaHost.tsx: every media app's
// player, the docked mini bar and audio-only players use it) and pauses it when the person's budget says time is up. The words come
// from the hub (`line` on GET /api/media/budget, MEDIA_KID_COPY), shown once through the shell's toast (kit ToastProvider).
import type { MediaBudgetResponse } from "@/lib/api";

export type BudgetRead = MediaBudgetResponse & { line?: string | null };

export interface GuardDeps {
  fetchBudget: () => Promise<BudgetRead>;
  notify: (line: string) => void;
  /** Runs `run` on a repeating timer and returns a stop function (an injected clock, so tests drive it). */
  every: (run: () => void) => () => void;
  /** Shared across guards (the host keeps one), so the next song or video does not repeat the line; reset when time is left again. */
  state?: { told: boolean };
}

export const BUDGET_CHECK_MS = 15_000;

export const intervalEvery = (ms: number) => (run: () => void) => {
  const id = setInterval(run, ms);
  return () => clearInterval(id);
};

/** Watches one element: checks the budget when it attaches, on a load error, on every play and every 15 s while it plays; once time is up it pauses the element,
 * shows the kid line once, and pauses any later play at once until a check sees more minutes (a grown-up extended today).
 * A failed read changes nothing: it never pauses on its own and never throws. Returns a stop function. */
export function guardMediaBudget(el: HTMLMediaElement, deps: GuardDeps): () => void {
  const state = deps.state ?? { told: false };
  let exhausted = false;
  let live = true;
  let asked = 0;
  let applied = 0;
  const check = async () => {
    const mine = ++asked;
    let budget: BudgetRead;
    try { budget = await deps.fetchBudget(); } catch { return; }
    // An older answer never overrides a newer one (a slow "time left" after a fresh "time is up").
    if (!live || mine < applied) return;
    applied = mine;
    // The hub sets `line` exactly when it refuses playback (a child or teen whose time is up; an adult's limit is advisory).
    exhausted = budget.limit_min > 0 && budget.exhausted && !!budget.line;
    if (!exhausted) { state.told = false; return; }
    if (!el.paused) el.pause();
    if (!state.told && budget.line) { state.told = true; deps.notify(budget.line); }
  };
  const onPlay = () => {
    if (exhausted) el.pause();
    void check();
  };
  const onError = () => { void check(); };
  el.addEventListener("play", onPlay);
  // A file the hub refuses (time already up) never plays, so check on attach and on a load error too: the child gets the words
  // instead of a player that silently will not start.
  el.addEventListener("error", onError);
  void check();
  const stopTimer = deps.every(() => { if (!el.paused) void check(); });
  return () => {
    live = false;
    el.removeEventListener("play", onPlay);
    el.removeEventListener("error", onError);
    stopTimer();
  };
}
