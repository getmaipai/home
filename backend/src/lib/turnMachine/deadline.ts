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
  const timer = setTimeout(() => controller.abort(new DOMException("node deadline exceeded", "TimeoutError")), deadlineMs);
  return {
    signal: controller.signal,
    clear: () => {
      clearTimeout(timer);
      parent.removeEventListener("abort", onParentAbort);
    },
  };
}
