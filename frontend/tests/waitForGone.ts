import { waitFor } from "@testing-library/react";

type WaitForOptions = NonNullable<Parameters<typeof waitFor>[1]>;

// Waits until `query` (a `queryBy*` or `querySelector` call) finds nothing.
//
// Use this instead of `waitFor(() => expect(queryBy...()).toBeNull())`.
// Every retry of that form that still finds the element makes `expect`
// build a failure message, and bun formats the whole DOM node it was
// handed to do it. On a real page that costs seconds per retry, and the
// cost is CPU time, so it grows with machine load: a Dismiss test that
// takes 0.3 s of real work took 4 s quiet and blew its timeout at a load
// of 50 (FLAKE-195). Throwing a plain Error here costs nothing per retry.
export function waitForGone(query: () => unknown, options?: WaitForOptions): Promise<void> {
  return waitFor(() => {
    if (query() !== null) throw new Error("still in the document");
  }, options);
}
