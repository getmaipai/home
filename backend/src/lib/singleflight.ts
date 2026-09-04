// A code review (2026-09-04) found the same "share one in-flight promise
// among every concurrent caller instead of starting a redundant second
// attempt" shape hand-copied three times: llmSupervisor.ts's
// getChatClient(), wakewordAssets.ts's ensureWakewordAssets(), and
// voiceCatalog.ts's getVoiceCatalog() - each with its own comment
// cross-referencing the others instead of a shared implementation, a
// real "one definition, one place" violation. This is that shared
// implementation, for the two call sites whose shape actually matches it
// exactly (a plain "run this once, share the result with concurrent
// callers, clear on completion either way so the next call starts
// fresh"): wakewordAssets.ts and voiceCatalog.ts.
//
// llmSupervisor.ts's getChatClient() deliberately keeps its own
// hand-rolled version rather than adopting this: its in-flight promise
// is also inspected directly from outside (getEngineStatus()'s
// `if (startingPromise) return {kind: "starting", ...}`) and cleared
// manually from two other functions (restartChatBackend(),
// stopChatBackend()) - real requirements this generic helper doesn't
// serve, and forcing them in would only re-add the complexity this
// extraction exists to remove.
export interface Singleflight<T> {
  (): Promise<T>;
  /** Test-only: clears any in-flight promise, so the next call starts a
   * genuinely fresh attempt instead of awaiting a stale one left over
   * from an earlier test. */
  __resetForTests(): void;
}

export function singleflight<T>(fn: () => Promise<T>): Singleflight<T> {
  let inFlight: Promise<T> | null = null;
  const wrapped = (() => {
    if (!inFlight) {
      inFlight = fn().finally(() => {
        inFlight = null;
      });
    }
    return inFlight;
  }) as Singleflight<T>;
  wrapped.__resetForTests = () => {
    inFlight = null;
  };
  return wrapped;
}
