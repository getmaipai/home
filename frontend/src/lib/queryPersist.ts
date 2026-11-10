// RELOAD-RESTORE-01: iOS drops a Safari tab from memory when the person switches to another app, so coming back is a full reload. This keeps the last
// answers the page had in the tab's own sessionStorage (gone when the tab closes) and puts them back at boot, so the page paints what it showed and
// then refreshes in place. Only the same person's, only recent, only small answers, never anything adult-only, and sign-out removes it.
import { dehydrate, hydrate, type QueryClient } from "@tanstack/react-query";

export const QUERY_PERSIST_KEY = "maipai:query-cache";
export const QUERY_PERSIST_MAX_AGE_MS = 30 * 60_000;
const MAX_QUERY_BYTES = 60_000;
const MAX_TOTAL_BYTES = 400_000;

interface Saved { t: number; personId: string; state: ReturnType<typeof dehydrate> }

export function clearQueryCache(storage: Storage | undefined = safeStorage()): void {
  try { storage?.removeItem(QUERY_PERSIST_KEY); } catch { /* storage blocked: nothing to clear */ }
}

function safeStorage(): Storage | undefined {
  try { return typeof sessionStorage === "undefined" ? undefined : sessionStorage; } catch { return undefined; }
}

/** Save the small, successful answers now (call when the page is hidden). */
export function saveQueryCache(client: QueryClient, personId: string, now = Date.now(), storage: Storage | undefined = safeStorage()): void {
  if (!storage) return;
  let total = 0;
  const state = dehydrate(client, {
    shouldDehydrateQuery: (query) => {
      if (query.state.status !== "success") return false;
      const key = JSON.stringify(query.queryKey);
      if (/adult|unlock|secret|credential|token/i.test(key)) return false;
      const size = JSON.stringify(query.state.data ?? null).length;
      if (size > MAX_QUERY_BYTES || total + size > MAX_TOTAL_BYTES) return false;
      total += size;
      return true;
    },
  });
  try { storage.setItem(QUERY_PERSIST_KEY, JSON.stringify({ t: now, personId, state } satisfies Saved)); } catch { clearQueryCache(storage); }
}

/** Put saved answers back for this person if they are recent; anything else is dropped. Returns whether it restored. */
export function restoreQueryCache(client: QueryClient, personId: string, now = Date.now(), storage: Storage | undefined = safeStorage()): boolean {
  if (!storage) return false;
  try {
    const raw = storage.getItem(QUERY_PERSIST_KEY);
    if (!raw) return false;
    const saved = JSON.parse(raw) as Saved;
    if (saved.personId !== personId || now - saved.t > QUERY_PERSIST_MAX_AGE_MS) { clearQueryCache(storage); return false; }
    hydrate(client, saved.state);
    return true;
  } catch { clearQueryCache(storage); return false; }
}

/** Save when the page is hidden or leaves; returns the remover. */
export function installQueryCacheSaver(client: QueryClient, personId: string, doc: Document = document, win: Window = window): () => void {
  const save = () => { if (doc.visibilityState === "hidden") saveQueryCache(client, personId); };
  const leave = () => saveQueryCache(client, personId);
  doc.addEventListener("visibilitychange", save);
  win.addEventListener("pagehide", leave);
  return () => { doc.removeEventListener("visibilitychange", save); win.removeEventListener("pagehide", leave); };
}
