// SETTINGS-LAYERS-01c: who the site-block checks are for. A search, a page read or a picture pick runs
// inside `runAsBlockViewer(personId, ...)`, so every host check under it (enabledListIds, customHostRules,
// checkHost, urlAllowedFor, the search cache key) reads that person's own overrides on top of their age
// group's defaults, without a person id threaded through each call. A check outside it, or one that is
// handed no person, reads the age group's settings alone, which is the same floor as before.
import { AsyncLocalStorage } from "node:async_hooks";

const viewer = new AsyncLocalStorage<string>();

export function runAsBlockViewer<T>(personId: string, fn: () => T): T {
  return viewer.run(personId, fn);
}

export function currentBlockViewer(): string | undefined {
  return viewer.getStore();
}
