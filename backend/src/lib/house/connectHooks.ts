// SCHED-02: a tiny listener list so the places that learn Home Assistant is reachable (the events socket opening, the
// registry cache loading) can tell the schedule reconciler without importing it (the reconciler imports the cache).
export type HouseConnectHook = (instance: string, opts: { force: boolean }) => void | Promise<void>;

const hooks = new Set<HouseConnectHook>();

export function onHouseConnected(hook: HouseConnectHook): () => void {
  hooks.add(hook);
  return () => { hooks.delete(hook); };
}

/** Fire and forget: a hook that throws or rejects never reaches the connection code. `force` skips the reconciler's throttle. */
export function emitHouseConnected(instance: string, opts: { force?: boolean } = {}): void {
  for (const hook of hooks) {
    void Promise.resolve().then(() => hook(instance, { force: opts.force === true })).catch(() => {});
  }
}

export function __clearHouseConnectHooksForTests(): void { hooks.clear(); }
