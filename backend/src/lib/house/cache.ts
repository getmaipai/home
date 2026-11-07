import { DEFAULT_INSTANCE, listInstances } from "@/lib/connectors/instances";
import { houseInstanceLanFetch } from "./connection";
import { emitHouseConnected } from "./connectHooks";
import { fetchHouseRegistry, type HouseRegistryResult } from "./registry";
import type { HouseLanFetchDeps } from "./connection";

type Ok = Extract<HouseRegistryResult, { ok: true }>;
type Entry = { value: Ok | null; loadedAt: number; flight: Promise<void> | null; key: string };

const FRESH_MS = 60_000;
const MAX_AGE_MS = 120_000;
/** One entry per Home Assistant instance, so two servers never share a cached registry. */
const entries = new Map<string, Entry>();
let cacheDeps: HouseLanFetchDeps | undefined;

function entryOf(instance: string): Entry {
  let entry = entries.get(instance);
  if (!entry) { entry = { value: null, loadedAt: 0, flight: null, key: "" }; entries.set(instance, entry); }
  return entry;
}

/** The connection the cached value came from; a changed address or token drops the cache at once. */
function connectionKey(instance: string): string {
  const c = houseInstanceLanFetch(instance, cacheDeps);
  return c.ok ? `${c.host}:${c.port}:${hash(c.token)}` : "";
}
function hash(text: string): string { let h = 5381; for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0; return h.toString(36); }

export function peekHouseRegistry(instance: string = DEFAULT_INSTANCE): Ok | null {
  const entry = entryOf(instance);
  if (entry.value && connectionKey(instance) !== entry.key) { entry.value = null; entry.loadedAt = 0; }
  if (!entry.value || Date.now() - entry.loadedAt >= MAX_AGE_MS) return null;
  if (Date.now() - entry.loadedAt >= FRESH_MS) warmHouseRegistry(instance);
  return entry.value;
}

export function warmHouseRegistry(instance: string = DEFAULT_INSTANCE): void {
  const entry = entryOf(instance);
  if (entry.flight) return;
  entry.flight = (async () => {
    try {
      const connection = houseInstanceLanFetch(instance, cacheDeps);
      if (!connection.ok) return;
      const key = connectionKey(instance);
      const result = await fetchHouseRegistry({ lanFetch: connection.lanFetch, token: connection.token });
      if (result.ok && connectionKey(instance) === key) {
        entry.value = result; entry.loadedAt = Date.now(); entry.key = key;
        // SCHED-02: a fresh registry means Home Assistant answered; the schedule reconciler rechecks (it throttles itself).
        emitHouseConnected(instance);
      }
    } catch { /* background warming never escapes */ }
  })().finally(() => { entry.flight = null; });
}

/** Cold path for a model call which has already chosen the house tool. */
export async function loadHouseRegistry(instance: string = DEFAULT_INSTANCE): Promise<HouseRegistryResult> {
  const cached = peekHouseRegistry(instance);
  if (cached) return cached;
  const entry = entryOf(instance);
  if (!entry.flight) warmHouseRegistry(instance);
  await entry.flight;
  return peekHouseRegistry(instance) ?? { ok: false, kind: "unreachable" };
}

function liveSlugs(): Array<{ instance: string; label: string }> {
  return listInstances("home_assistant", cacheDeps).map(({ instance, label }) => ({ instance, label }));
}

/** Several instances merge into one registry whose entities and areas carry their instance; one instance is returned untouched. */
function merge(parts: Array<{ instance: string; label: string; registry: Ok }>): Ok {
  return {
    ok: true,
    areas: parts.flatMap(({ instance, registry }) => registry.areas.map((area) => ({ ...area, instance }))),
    entities: parts.flatMap(({ instance, label, registry }) => registry.entities.map((entity) => ({ ...entity, instance, instanceLabel: label }))),
  };
}

/** Every enabled instance's cached registry; null until the first instance has one. An instance that has not loaded yet is warmed and left out. */
export function peekHouseRegistries(): Ok | null {
  const slugs = liveSlugs();
  if (slugs.length <= 1) return peekHouseRegistry(slugs[0]?.instance ?? DEFAULT_INSTANCE);
  const parts: Array<{ instance: string; label: string; registry: Ok }> = [];
  for (const slug of slugs) {
    const registry = peekHouseRegistry(slug.instance);
    if (registry) parts.push({ ...slug, registry }); else warmHouseRegistry(slug.instance);
  }
  return parts.length ? merge(parts) : null;
}

export function warmHouseRegistries(): void {
  for (const slug of liveSlugs()) warmHouseRegistry(slug.instance);
}

/** Cold path across instances; one that does not answer is left out (per-instance outage reporting is a later slice). */
export async function loadHouseRegistries(): Promise<HouseRegistryResult> {
  const slugs = liveSlugs();
  if (slugs.length <= 1) return loadHouseRegistry(slugs[0]?.instance ?? DEFAULT_INSTANCE);
  const loaded = await Promise.all(slugs.map(async (slug) => ({ ...slug, result: await loadHouseRegistry(slug.instance) })));
  const parts = loaded.flatMap(({ instance, label, result }) => result.ok ? [{ instance, label, registry: result }] : []);
  return parts.length ? merge(parts) : { ok: false, kind: "unreachable" };
}

export function __setHouseRegistryCacheDepsForTests(deps?: HouseLanFetchDeps): void { cacheDeps = deps; }
export function clearHouseRegistry(): void { entries.clear(); cacheDeps = undefined; }
