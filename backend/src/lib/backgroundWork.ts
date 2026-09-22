// A tiny in-flight registry for fire-and-forget background work (a
// crisis notification, an embed job kicked off after a memory write)
// that must never sit on the reply's own critical path in production,
// but that a test run needs to be able to wait for before the next
// test's resetDb() wipes the tables that work reads or writes -
// otherwise a promise still running when the next test starts can
// write against rows that are already gone (getmaipai/home#123: the
// FOREIGN KEY failure inside issueSession() and the undefined
// person.id in updates.test.ts). Same shape as the three earlier
// leaked-state fixes in tests/reset-db.ts (the turnActivity flag, the
// pending summary refresh timer, the package/skill caches): drained
// by the test harness only, never awaited by production code.
const inFlight = new Set<Promise<unknown>>();

/** Registers a fire-and-forget promise so a test can wait for it
 * without the caller having to await it. The caller is still
 * responsible for its own rejection handling (a `.catch()`) - this
 * only tracks the promise's lifetime, it doesn't change its outcome. */
export function trackBackgroundWork<T>(promise: Promise<T>): Promise<T> {
  inFlight.add(promise);
  const untrack = () => {
    inFlight.delete(promise);
  };
  promise.then(untrack, untrack);
  return promise;
}

/** Test-only: waits for every currently-tracked background job to
 * settle. Loops until the set is actually empty, rather than
 * snapshotting it once, so a job that starts another tracked job while
 * draining (an embed retry, say) is covered too. */
export async function __drainBackgroundWorkForTests(): Promise<void> {
  while (inFlight.size > 0) {
    await Promise.allSettled([...inFlight]);
  }
}
