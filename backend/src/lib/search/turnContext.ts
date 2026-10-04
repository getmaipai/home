// SRCH: what a search needs to know about the turn that asked for it, without
// threading two arguments through runPlugin, the recipe runner and the host:
// the turn's abort signal (a pause is cancelable) and whether the turn is
// spoken (a spoken turn never waits). The tool node sets it around runPlugin;
// a search with no turn around it (the health canary) sees none.
import { AsyncLocalStorage } from "node:async_hooks";

export interface SearchTurnContext {
  signal: AbortSignal;
  spoken: boolean;
}

export const searchTurnContext = new AsyncLocalStorage<SearchTurnContext>();

/** A person's pace before trying again: one to three seconds, randomized. */
export function searchRetryPauseMs(random: () => number = Math.random): number {
  return 1_000 + Math.round(random() * 2_000);
}

let pauseForTests: (() => number) | null = null;

export function __setSearchRetryPauseForTests(pause: (() => number) | null): void {
  pauseForTests = pause;
}

/** Waits the retry pause; false when the turn's signal ended it early. */
export function pauseBeforeRetry(signal: AbortSignal | undefined): Promise<boolean> {
  if (signal?.aborted) return Promise.resolve(false);
  const ms = pauseForTests ? pauseForTests() : searchRetryPauseMs();
  return new Promise((resolve) => {
    const done = (ok: boolean) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve(ok);
    };
    const onAbort = () => done(false);
    const timer = setTimeout(() => done(true), ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
