// KS-MODE-01: the one-time move from the retired `search.wikipedia_fallback`
// boolean to the search source mode (sourceMode.ts). A stored `false` becomes
// `search.source_mode.wikimedia = offline` (never the household mode, so web
// search is unaffected). A stored `true` becomes `inherit`, which is the
// default, so nothing is written. The old stored row is then deleted, which
// makes a second run a no-op. It reads the row directly, so it keeps working
// once the retired key leaves the pinned spec registry.
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { settingsValues } from "@/db/schema";
import { clearMatchingValues, getHouseholdSettingValue, setHouseholdSettingValue } from "@/lib/settings";
import { SOURCE_MODE_OVERRIDE_KEYS } from "@/lib/retrieval/sourceMode";

export const RETIRED_WIKIPEDIA_FALLBACK_KEY = "search.wikipedia_fallback";

export type WikipediaFallbackMigration = "none" | "migrated_off" | "dropped_on";

export function migrateWikipediaFallbackToSourceMode(): WikipediaFallbackMigration {
  const row = db.select().from(settingsValues)
    .where(and(eq(settingsValues.scope, "household"), eq(settingsValues.key, RETIRED_WIKIPEDIA_FALLBACK_KEY))).get();
  if (!row) return "none";
  let stored: unknown;
  try {
    stored = JSON.parse(row.value);
  } catch {
    stored = undefined;
  }
  let outcome: WikipediaFallbackMigration = "dropped_on";
  if (stored === false) {
    // A household that already chose an override keeps its choice; the old `false` was only ever the Wikimedia switch.
    // A stored "inherit" is not a choice (it reads as no override), so it does not block the move.
    const current = getHouseholdSettingValue(SOURCE_MODE_OVERRIDE_KEYS.wikimedia);
    if (current === undefined || current === "inherit") {
      const written = setHouseholdSettingValue(SOURCE_MODE_OVERRIDE_KEYS.wikimedia, "offline");
      // If the write cannot land, keep the old row so the next start tries again and the choice is never lost.
      if (!written.ok) return "none";
    }
    outcome = "migrated_off";
  }
  clearMatchingValues(RETIRED_WIKIPEDIA_FALLBACK_KEY, "");
  return outcome;
}
