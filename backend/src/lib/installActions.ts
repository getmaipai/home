// The two things a person does with the install plan, shared by the setup
// wizard (before an owner exists) and Home settings (after): look at the
// plan in plain words, and start it.
import { getStackClient } from "@/lib/stackEngine";
import { wordPlan, type PlanWording } from "@/lib/installPlanWording";
import { resetInstallStatusCache } from "@/lib/installStatus";
import { replaceSetupStep } from "@/lib/setupState";
import { startSetupDownloads } from "@/setup/checks/setupDownloads";

export async function previewPlan(vramGb?: number): Promise<{ plan: unknown; wording: PlanWording }> {
  try {
    const plan = await getStackClient().installPlan(vramGb ? { vramGb } : undefined);
    return { plan, wording: wordPlan(plan) };
  } catch {
    return { plan: null, wording: wordPlan(null) };
  }
}

export type BeginInstall = { ok: true; models: number } | { ok: false; error: string; next: string };

/** Starts the downloads in the background. `recordInSetup` also marks the
 * wizard's plan step done; Home settings leaves the setup record alone. */
export async function beginInstall(vramGb: number | undefined, recordInSetup: boolean): Promise<BeginInstall> {
  let plan;
  try { plan = await getStackClient().installPlan(vramGb ? { vramGb } : undefined); }
  catch { return { ok: false, error: "The AI engine isn't answering yet.", next: "Wait a minute and press Check again." }; }
  const words = wordPlan(plan);
  if (!plan.level || plan.fits_disk === false) {
    return { ok: false, error: words.diskLine ?? words.headline, next: words.needsMemoryAnswer ? "Pick your graphics memory first." : "Free some space or choose another computer for the AI." };
  }
  resetInstallStatusCache();
  if (recordInSetup) {
    const roles = [...new Set(plan.models.map((model) => `engines.${model.role}.choice`))];
    replaceSetupStep("plan", { status: "done", plan: { option: "recommended", tier: plan.level, roles } });
  }
  void startSetupDownloads(getStackClient(), vramGb ? { vramGb } : {}).catch(() => {});
  return { ok: true, models: plan.models.filter((model) => !model.installed).length };
}
