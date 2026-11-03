// The inputs the job cards are built from, read the same way for Settings (routes/aiChoices.ts) and the setup wizard's plan
// step (routes/setup.ts): the four household settings the cards depend on, and the cards for a disk plan.
import { buildAiCards, type AiChoicesInput, type AiChoicesResult } from "../../../shared/aiChoices";
import type { DiskPlan } from "../../../shared/diskPlanMath";
import { aiCopy } from "@/lib/aiCopy";
import { getHouseholdSettingValue, setHouseholdSettingValue } from "@/lib/settings";
import { householdDetailedEnabled, householdQuickModel } from "@/lib/pictures/policy";
import { householdVideoQuality, VIDEO_TIER_KEY } from "@/lib/videos/policy";
import { slotKey, writeSlotModel } from "@/lib/tiers";
import { MODEL_OF_CHOICE } from "@/lib/tierSlotMigration";
import { listStackComponents } from "@/lib/stackComponents";

export function readAiSettings(): AiChoicesInput["settings"] {
  const music = getHouseholdSettingValue("generation.music.enabled");
  return {
    // The picture slots are the one place the picture models live (VIDEO-SETTINGS-04): the card reads and writes them directly.
    pictureQuickModel: householdQuickModel(),
    pictureDetailedEnabled: householdDetailedEnabled(),
    videoQuality: householdVideoQuality(),
    musicEnabled: typeof music === "boolean" ? music : true,
  };
}

/** The settings keys a setup choice may write, one per job that has a setting (the same keys the cards carry). */
export const SETUP_CHOICE_KEYS: ReadonlySet<string> = new Set([
  slotKey("image", "standard"), slotKey("image", "boost"), VIDEO_TIER_KEY, "generation.music.enabled",
]);

/** Write one card or setup setting. A picture slot key takes the model as text (a catalog id), or true and false for the Boost switch (`recommended` and `off`), and keeps the slot's options; every other key is an ordinary household write. */
export function writeChoiceSetting(key: string, value: unknown): { ok: true } | { ok: false; status: 400 | 403; error: string } {
  if (key === slotKey("image", "standard") && typeof value === "string") return writeSlotModel("image", "standard", MODEL_OF_CHOICE[value] ?? value);
  if (key === slotKey("image", "boost") && (typeof value === "boolean" || typeof value === "string")) return writeSlotModel("image", "boost", value === true ? "recommended" : value === false ? "off" : value);
  const written = setHouseholdSettingValue(key, value);
  return written.ok ? { ok: true } : { ok: false, status: written.status, error: written.error };
}

/** The cards for the setup wizard's plan step. The engine may not exist yet, so a Stack that does not answer leaves the list null and the plan's own installed flags rule. */
export async function setupCards(plan: DiskPlan): Promise<AiChoicesResult> {
  let components: AiChoicesInput["components"] = null;
  let freeBytes: number | null = null;
  try { const list = await listStackComponents(); components = list.components; freeBytes = list.free_disk_bytes; } catch { /* plan only */ }
  return buildAiCards({ copy: aiCopy, plan, components, settings: readAiSettings(), freeBytes });
}
