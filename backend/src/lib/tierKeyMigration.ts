// FEATURE-ROWS-TIERS-01: the tier setting keys and the Boost and Max access lists follow the Stack's feature ids. `engines.image.*` becomes
// `engines.pictures.*`, `engines.tts.*` becomes `engines.voice.*` (the choice and the tier slots, whatever the scope), and the work name `image`
// in a stored `access.tier.boost` or `access.tier.max` list becomes `pictures`. Runs once, at boot, before anything reads a slot. A value already
// stored under a new key wins and its old row is dropped. The marker is written in the same transaction, so a failure leaves nothing half moved.
import { and, eq, like, or } from "drizzle-orm";
import { db } from "@/db";
import { settingsValues } from "@/db/schema";
import { nextHlc } from "@/lib/hlc";

const MARKER_KEY = "__migration.tier_keys_to_feature_ids";
const KEY_PREFIXES: ReadonlyArray<readonly [string, string]> = [["engines.image.", "engines.pictures."], ["engines.tts.", "engines.voice."]];
const LIST_KEYS = ["access.tier.boost", "access.tier.max"] as const;

/** Every string `image` inside a stored list value (a plain list or a delta object) becomes `pictures`. */
export const renameWork = (value: unknown): unknown => (typeof value === "string" ? (value === "image" ? "pictures" : value)
  : Array.isArray(value) ? value.map(renameWork)
  : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, renameWork(v)])) : value);

export function migrateTierKeysToFeatureIds(): "already_ran" | "migrated" {
  return db.transaction((tx) => {
    const marker = tx.select({ key: settingsValues.key }).from(settingsValues).where(and(eq(settingsValues.scope, "system"), eq(settingsValues.key, MARKER_KEY))).get();
    if (marker) return "already_ran";
    for (const [from, to] of KEY_PREFIXES) {
      for (const row of tx.select().from(settingsValues).where(like(settingsValues.key, `${from}%`)).all()) {
        const newKey = to + row.key.slice(from.length);
        const taken = tx.select({ key: settingsValues.key }).from(settingsValues).where(and(eq(settingsValues.scope, row.scope), eq(settingsValues.key, newKey))).get();
        if (!taken) tx.insert(settingsValues).values({ ...row, key: newKey, hlc: nextHlc() }).run();
        tx.delete(settingsValues).where(and(eq(settingsValues.scope, row.scope), eq(settingsValues.key, row.key))).run();
      }
    }
    for (const row of tx.select().from(settingsValues).where(or(...LIST_KEYS.map((key) => eq(settingsValues.key, key)))).all()) {
      let next: string;
      try { next = JSON.stringify(renameWork(JSON.parse(row.value))); } catch { continue; }
      if (next !== row.value) tx.update(settingsValues).set({ value: next, hlc: nextHlc() }).where(and(eq(settingsValues.scope, row.scope), eq(settingsValues.key, row.key))).run();
    }
    tx.insert(settingsValues).values({ scope: "system", key: MARKER_KEY, value: "true", hlc: nextHlc(), source: "migration", setBy: null, updatedAt: new Date().toISOString() }).run();
    return "migrated";
  });
}
