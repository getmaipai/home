// OVERRIDES-01: the in-memory pass cache and its invalidation, in a module with no imports so the settings, grants, people and
// package code can drop a pass without importing the resolver (which imports them). The resolver is filter/pass.ts.
import type { Pass } from "./pass";

type Entry = { pass: Pass; role: string; controls: string | null };
const cache = new Map<string, Entry>();
let rebuilds = 0;

/** A pass whose `expires_at` (the next time one of the person's timed grants starts or ends) has passed is dropped, so a timed grant never outlives its time. */
export function getCachedPass(key: string): Entry | undefined {
  const hit = cache.get(key);
  if (hit && hit.pass.expires_at !== null && Date.now() >= hit.pass.expires_at) { cache.delete(key); return undefined; }
  return hit;
}
export function putCachedPass(key: string, entry: Entry): void { cache.set(key, entry); }
export function nextPassVersion(): number { return ++rebuilds; }

/** Drops one person's passes (their own and every surface variant of it), or every pass with no argument. Rebuild is lazy: the next
 * read builds a new one, which is the same write cycle for the next request (design 5a). */
export function invalidatePass(personId?: string): void {
  if (!personId) { cache.clear(); return; }
  for (const key of cache.keys()) if (key === personId || key.startsWith(`${personId}@`)) cache.delete(key);
}

/** For a settings write at `scope` of `key`: every pass for a household write or an override key, else the one person's. */
export function invalidatePassForSetting(scope: string, key: string): void {
  if (scope === "household" || key.startsWith("content.") || key.startsWith("access.")) { invalidatePass(); return; }
  const personId = /^person:(.+)$/.exec(scope)?.[1];
  if (personId) invalidatePass(personId);
}
