// TIER-HOME-02: the Quick and Detailed picture settings move into the tier slot records (docs/design/resource-tiers-2026-10-27.md
// section 11). `generation.picture_quick_model` becomes the picture Standard slot's model, `generation.picture_detailed.enabled` the picture
// Boost slot's on/off (`off`). `generation.picture_quality` and `generation.video_quality` stay: they are the household default tier
// (standard or boost), not a slot. Until the AI and models dialogs write slots directly (TIER-HOME-04) a write to a legacy key is mirrored
// into its slot, so the slot is the one place readers look and the two never disagree. An explicit user value always wins over the migration.
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { settingsValues } from "@/db/schema";
import { nextHlc } from "@/lib/hlc";
import { getHouseholdSettingSource, getHouseholdSettingValue, onHouseholdWrite, setHouseholdSettingValue } from "@/lib/settings";
import { readSlot, slotKey } from "@/lib/tiers";
import { QUICK_MODEL } from "@/lib/pictures/quality";

const MARKER_KEY = "__migration.tier_slots_home_02";
export const QUICK_MODEL_KEY = "generation.picture_quick_model";
export const DETAILED_ENABLED_KEY = "generation.picture_detailed.enabled";
const MODEL_OF_CHOICE: Record<string, string> = { ernie: "ernie-image-turbo", klein: QUICK_MODEL };

function writeModel(tier: "standard" | "boost", model: string): void {
  const slot = readSlot("image", tier);
  if (slot.model === model) return;
  setHouseholdSettingValue(slotKey("image", tier), { model, options: slot.options, ...(getHouseholdSettingSource(slotKey("image", tier)) ? { who: slot.who } : {}) });
}

/** A write to a legacy key keeps its slot in step. */
export function mirrorLegacyIntoSlot(key: string, value: unknown): void {
  if (key === QUICK_MODEL_KEY && typeof value === "string" && MODEL_OF_CHOICE[value]) writeModel("standard", MODEL_OF_CHOICE[value]!);
  if (key === DETAILED_ENABLED_KEY && typeof value === "boolean") writeModel("boost", value ? "recommended" : "off");
}
onHouseholdWrite(mirrorLegacyIntoSlot);

/** One time, at boot: copy the values a person set into the slots. Returns what it did. */
export function migrateTierSlots(): "already_ran" | "migrated" {
  const marker = db.select({ key: settingsValues.key }).from(settingsValues)
    .where(and(eq(settingsValues.scope, "system"), eq(settingsValues.key, MARKER_KEY))).get();
  if (marker) return "already_ran";
  for (const key of [QUICK_MODEL_KEY, DETAILED_ENABLED_KEY]) {
    const slotTier = key === QUICK_MODEL_KEY ? "standard" : "boost";
    if (getHouseholdSettingSource(key) !== undefined && getHouseholdSettingSource(slotKey("image", slotTier)) === undefined) mirrorLegacyIntoSlot(key, getHouseholdSettingValue(key));
  }
  db.insert(settingsValues).values({ scope: "system", key: MARKER_KEY, value: "true", hlc: nextHlc(), source: "migration", setBy: null, updatedAt: new Date().toISOString() }).run();
  return "migrated";
}
