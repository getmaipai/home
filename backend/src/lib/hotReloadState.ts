// Fix A (docs/dev.md's "Chat reliability: the 2026-09-07 incident and the
// five fixes"): the one shared implementation of "state survives a
// `bun --hot` reload" - wyomingServer.ts's own `__maipaiWyomingBoundPorts`
// set the precedent (a top-level `let` resets to its initializer on every
// reload's fresh module instance, but the same OS process's `globalThis`
// does not), then llmSupervisor.ts/embedSupervisor.ts/ttsSupervisor.ts
// each hand-copied the identical `interface + (globalThis as
// {...}).key ??= {...}` shape for their own engine-backend state. A code
// review on this fix (2026-09-07) caught the duplication against
// getmaipai/.github's own "one definition, one implementation, one
// store" rule: a future fix to the mechanism itself (a generation-guard
// edge case, say) had to be found and reapplied in three separate files.
// One generic helper instead - each caller still owns its own state
// SHAPE (a different backend/generation/manuallyStopped combination per
// role), just not the globalThis plumbing that makes it survive a
// reload.
export function hotReloadState<T>(key: string, init: () => T): T {
  const store = globalThis as unknown as Record<string, T | undefined>;
  const globalKey = `__maipai_${key}`;
  return (store[globalKey] ??= init());
}
