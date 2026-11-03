// TIER-HOME-02: the Quick and Detailed picture settings move into the tier slot records (docs/design/resource-tiers-2026-10-27.md
// section 11). `generation.picture_quick_model` becomes the picture Standard slot's model, `generation.picture_detailed.enabled` the picture
// Boost slot's on/off (`off`). VIDEO-SETTINGS-04: the AI card and the setup wizard now write the slots directly (lib/tiers.ts `writeSlotModel`),
// so the old copy on every write is gone; this one start-up step only copies a value a person set under the old keys, once, for a home that
// has not run it yet. An explicit slot value always wins over the migration. The old keys stay readable until VIDEO-SETTINGS-09 drops them.
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { settingsValues } from "@/db/schema";
import { nextHlc } from "@/lib/hlc";
import { getHouseholdSettingSource, getHouseholdSettingValue } from "@/lib/settings";
import { slotKey, writeSlotModel } from "@/lib/tiers";
import { QUICK_MODEL } from "@/lib/pictures/quality";

const MARKER_KEY = "__migration.tier_slots_home_02";
export const QUICK_MODEL_KEY = "generation.picture_quick_model";
export const DETAILED_ENABLED_KEY = "generation.picture_detailed.enabled";
export const MODEL_OF_CHOICE: Record<string, string> = { ernie: "ernie-image-turbo", klein: QUICK_MODEL };

/** Copy one old key's stored value into its slot. */
export function copyLegacyIntoSlot(key: string, value: unknown): void {
  if (key === QUICK_MODEL_KEY && typeof value === "string" && MODEL_OF_CHOICE[value]) writeSlotModel("image", "standard", MODEL_OF_CHOICE[value]!);
  if (key === DETAILED_ENABLED_KEY && typeof value === "boolean") writeSlotModel("image", "boost", value ? "recommended" : "off");
}

/** One time, at boot: copy the values a person set into the slots. Returns what it did. */
export function migrateTierSlots(): "already_ran" | "migrated" {
  const marker = db.select({ key: settingsValues.key }).from(settingsValues)
    .where(and(eq(settingsValues.scope, "system"), eq(settingsValues.key, MARKER_KEY))).get();
  if (marker) return "already_ran";
  for (const key of [QUICK_MODEL_KEY, DETAILED_ENABLED_KEY]) {
    const slotTier = key === QUICK_MODEL_KEY ? "standard" : "boost";
    if (getHouseholdSettingSource(key) !== undefined && getHouseholdSettingSource(slotKey("image", slotTier)) === undefined) copyLegacyIntoSlot(key, getHouseholdSettingValue(key));
  }
  db.insert(settingsValues).values({ scope: "system", key: MARKER_KEY, value: "true", hlc: nextHlc(), source: "migration", setBy: null, updatedAt: new Date().toISOString() }).run();
  return "migrated";
}
