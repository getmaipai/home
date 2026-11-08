// HOUSE-02: the exposure list, the ceiling on what the model and the House screens may see of one Home Assistant instance.
// Nothing saved means no limit beyond grants (what works today keeps working); once an admin saves a list it is an allowlist.
// Stored in settings_values under its own scope: the `integration` record's options hold short strings only.
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { settingsValues } from "@/db/schema";
import { nextHlc } from "@/lib/hlc";
import type { HouseRegistryResult } from "./registry";

const SCOPE = "connector-exposure";
export type Exposure = { areas: string[]; entities: string[] };
type Ok = Extract<HouseRegistryResult, { ok: true }>;
const keyOf = (type: string, instance: string): string => `${type}/${instance}`;

export function getExposure(instance: string, type = "home_assistant"): Exposure | null {
  const row = db.select().from(settingsValues).where(and(eq(settingsValues.scope, SCOPE), eq(settingsValues.key, keyOf(type, instance)))).get();
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.value) as Partial<Exposure>;
    const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
    return { areas: strings(parsed.areas), entities: strings(parsed.entities) };
  } catch { return { areas: [], entities: [] }; }
}

export function setExposure(instance: string, exposure: Exposure, type = "home_assistant"): void {
  const value = JSON.stringify({ areas: [...new Set(exposure.areas)].sort(), entities: [...new Set(exposure.entities)].sort() });
  const key = keyOf(type, instance);
  const now = new Date().toISOString();
  const existing = db.select().from(settingsValues).where(and(eq(settingsValues.scope, SCOPE), eq(settingsValues.key, key))).get();
  if (existing) db.update(settingsValues).set({ value, hlc: nextHlc(), updatedAt: now }).where(and(eq(settingsValues.scope, SCOPE), eq(settingsValues.key, key))).run();
  else db.insert(settingsValues).values({ scope: SCOPE, key, value, hlc: nextHlc(), source: "user", updatedAt: now }).run();
}

export function deleteExposure(type: string, instance: string): void {
  db.delete(settingsValues).where(and(eq(settingsValues.scope, SCOPE), eq(settingsValues.key, keyOf(type, instance)))).run();
}

/** The registry reduced to what the list allows. An entity is exposed when its id is listed or its area is; areas stay when listed or when an exposed entity sits in them. */
export function applyExposure(_instance: string, registry: Ok, exposure: Exposure | null = getExposure(_instance)): Ok {
  if (exposure === null) return registry;
  const areas = new Set(exposure.areas); const ids = new Set(exposure.entities);
  const entities = registry.entities.filter((entity) => ids.has(entity.id) || (entity.area !== null && areas.has(entity.area)));
  const keep = new Set([...areas, ...entities.flatMap((entity) => entity.area === null ? [] : [entity.area])]);
  return { ok: true, areas: registry.areas.filter((area) => keep.has(area.id)), entities };
}
