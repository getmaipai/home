// The inputs the job cards are built from, read the same way for Settings (routes/aiChoices.ts) and the setup wizard's plan
// step (routes/setup.ts): the four household settings the cards depend on, and the cards for a disk plan.
import { buildAiCards, type AiChoicesInput, type AiChoicesResult } from "../../../shared/aiChoices";
import type { DiskPlan } from "../../../shared/diskPlanMath";
import { aiCopy } from "@/lib/aiCopy";
import { getHouseholdSettingValue } from "@/lib/settings";
import { listStackComponents } from "@/lib/stackComponents";

export function readAiSettings(): AiChoicesInput["settings"] {
  const quickModel = getHouseholdSettingValue("generation.picture_quick_model");
  const detailed = getHouseholdSettingValue("generation.picture_detailed.enabled");
  const video = getHouseholdSettingValue("generation.video_quality");
  const music = getHouseholdSettingValue("generation.music.enabled");
  return {
    pictureQuickModel: quickModel === "klein" ? "klein" : "ernie",
    pictureDetailedEnabled: typeof detailed === "boolean" ? detailed : true,
    videoQuality: video === "detailed" ? "detailed" : "quick",
    musicEnabled: typeof music === "boolean" ? music : true,
  };
}

/** The settings keys a setup choice may write, one per job that has a setting (the same keys the cards carry). */
export const SETUP_CHOICE_KEYS: ReadonlySet<string> = new Set([
  "generation.picture_quick_model", "generation.picture_detailed.enabled", "generation.video_quality", "generation.music.enabled",
]);

/** The cards for the setup wizard's plan step. The engine may not exist yet, so a Stack that does not answer leaves the list null and the plan's own installed flags rule. */
export async function setupCards(plan: DiskPlan): Promise<AiChoicesResult> {
  let components: AiChoicesInput["components"] = null;
  let freeBytes: number | null = null;
  try { const list = await listStackComponents(); components = list.components; freeBytes = list.free_disk_bytes; } catch { /* plan only */ }
  return buildAiCards({ copy: aiCopy, plan, components, settings: readAiSettings(), freeBytes });
}
