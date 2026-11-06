import { houseLanFetch } from "./connection";
import { fetchHouseRegistry, type HouseRegistryResult } from "./registry";
import type { HouseLanFetchDeps } from "./connection";

const FRESH_MS = 60_000;
const MAX_AGE_MS = 120_000;
let value: Extract<HouseRegistryResult, { ok: true }> | null = null;
let loadedAt = 0;
let flight: Promise<void> | null = null;
let cacheDeps: HouseLanFetchDeps | undefined;
let keyOfValue = "";

/** The connection the cached value came from; a changed address or token drops the cache at once. */
function connectionKey(): string {
  const c = houseLanFetch(cacheDeps);
  return c.ok ? `${c.host}:${c.port}:${hash(c.token)}` : "";
}
function hash(text: string): string { let h = 5381; for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0; return h.toString(36); }

export function peekHouseRegistry(): Extract<HouseRegistryResult, { ok: true }> | null {
  if (value && connectionKey() !== keyOfValue) { value = null; loadedAt = 0; }
  if (!value || Date.now() - loadedAt >= MAX_AGE_MS) return null;
  if (Date.now() - loadedAt >= FRESH_MS) warmHouseRegistry();
  return value;
}

export function warmHouseRegistry(): void {
  if (flight) return;
  flight = (async () => {
    try {
      const connection = houseLanFetch(cacheDeps);
      if (!connection.ok) return;
      const key = connectionKey();
      const result = await fetchHouseRegistry({ lanFetch: connection.lanFetch, token: connection.token });
      if (result.ok && connectionKey() === key) { value = result; loadedAt = Date.now(); keyOfValue = key; }
    } catch { /* background warming never escapes */ }
  })().finally(() => { flight = null; });
}

/** Cold path for a model call which has already chosen the house tool. */
export async function loadHouseRegistry(): Promise<HouseRegistryResult> {
  const cached = peekHouseRegistry();
  if (cached) return cached;
  if (!flight) warmHouseRegistry();
  await flight;
  return peekHouseRegistry() ?? { ok: false, kind: "unreachable" };
}

export function __setHouseRegistryCacheDepsForTests(deps?: HouseLanFetchDeps): void { cacheDeps = deps; }
export function clearHouseRegistry(): void { value = null; loadedAt = 0; flight = null; cacheDeps = undefined; keyOfValue = ""; }
