// The two things a person does with the install plan, shared by the setup
// wizard (before an owner exists) and Home settings (after): look at the
// plan in plain words, and start it.
import { getStackClient, isRemoteStackSelected, isStackConfigured } from "@/lib/stackEngine";
import { engineInstallStatus, startEngineInstall } from "@/lib/stackInstall";
import { wordPlan, type PlanWording } from "@/lib/installPlanWording";
import { resetInstallStatusCache } from "@/lib/installStatus";
import { getSetupState, replaceSetupStep, resolveMemoryGb, setMemoryAnswerGb } from "@/lib/setupState";
import { startSetupDownloads } from "@/setup/checks/setupDownloads";
import { defaultDiskPaths, planVolumes } from "@/lib/diskPlan";
import { shippedDiskPlan } from "@/lib/diskPlan";
import { diskVerdict, type DiskPlan, type DiskVolume } from "../../../shared/diskPlanMath";
import { setInstallSelection } from "@/lib/setupState";
import type { StackInstallPlan } from "@/lib/stack/client";

/** Where the plan's files land and how much room each place has: Home's program and data on this computer, the AI's files on the Stack's disk (read by the Stack, which may be another computer). */
export function volumesFor(plan: StackInstallPlan): DiskVolume[] {
  return planVolumes(defaultDiskPaths(), {}, { aiFreeBytes: plan.free_disk_bytes, aiOnAnotherComputer: isRemoteStackSelected() });
}

/** The rows a request may turn on: required rows are always in, the others only when the plan offers them. Unknown ids are dropped. */
export function sanitizeSelection(plan: DiskPlan, ids: readonly string[]): string[] {
  const known = new Set(plan.rows.filter((row) => row.kind !== "engine").map((row) => row.id));
  return [...new Set([...plan.rows.filter((row) => row.kind !== "engine" && row.need === "required").map((row) => row.id), ...ids.filter((id) => known.has(id))])];
}

export async function previewPlan(requestedGb?: number): Promise<{ plan: unknown; wording: PlanWording }> {
  const vramGb = resolveMemoryGb(requestedGb);
  try {
    const plan = await getStackClient().installPlan(vramGb ? { vramGb } : undefined);
    return { plan, wording: wordPlan(plan, volumesFor(plan)) };
  } catch {
    return { plan: null, wording: wordPlan(null) };
  }
}

/** This computer is meant to run the AI but has no MaiPai Stack yet: the
 * household said "this computer" (or never said otherwise) and nothing is
 * configured. The setup wizard installs the Stack in that case. */
export function engineNeedsInstall(): boolean {
  if (isRemoteStackSelected() || getSetupState().engine.where === "another_computer") return false;
  return !isStackConfigured();
}

/** Starts (or joins) the AI engine install. Always answers in the "not
 * ready yet" shape: the caller's job is to wait and try again. */
export function ensureEngineInstalling(): { ok: false; error: string; next: string; cannotStart?: true } {
  const status = engineInstallStatus();
  if (status.state !== "running") {
    const started = startEngineInstall();
    if (!started.ok) return { ...started, cannotStart: true };
  }
  return { ok: false, error: "The AI engine is still installing on this computer.", next: "Wait for the progress bar to finish, then press Check again." };
}

export type BeginInstall = { ok: true; models: number } | { ok: false; error: string; next: string };

/** Starts the downloads in the background. `recordInSetup` also marks the
 * wizard's plan step done; Home settings leaves the setup record alone. */
export async function beginInstall(requestedGb: number | undefined, recordInSetup: boolean, components?: readonly string[]): Promise<BeginInstall> {
  // A typed memory answer is remembered, so a retry or a re-check later sizes
  // the plan from the same number instead of dropping it.
  if (requestedGb) setMemoryAnswerGb(requestedGb);
  const vramGb = resolveMemoryGb(requestedGb);
  if (engineNeedsInstall()) return ensureEngineInstalling();
  let plan;
  try { plan = await getStackClient().installPlan(vramGb ? { vramGb } : undefined); }
  catch { return { ok: false, error: "The AI engine isn't answering yet.", next: "Wait a minute and press Check again." }; }
  const words = wordPlan(plan, volumesFor(plan));
  if (!plan.level) {
    return { ok: false, error: words.diskLine ?? words.headline, next: words.needsMemoryAnswer ? "Pick your graphics memory first." : "Free some space or choose another computer for the AI." };
  }
  // The disk check, on the rows the person left turned on: the same function the page ran while they chose.
  const diskPlan = plan.disk ?? (plan.tier ? shippedDiskPlan(plan.tier) : null);
  const selected = diskPlan ? sanitizeSelection(diskPlan, components ?? diskPlan.default_selected) : undefined;
  if (diskPlan && selected) {
    const verdict = diskVerdict(diskPlan, selected, volumesFor(plan), { missingOnly: Boolean(plan.disk) });
    if (verdict.state === "red") return { ok: false, error: verdict.text, next: "Free some space, or turn off an extra on the list, then press Install again." };
  }
  resetInstallStatusCache();
  if (selected) setInstallSelection(selected);
  if (recordInSetup) {
    const roles = [...new Set(plan.models.map((model) => `engines.${model.role}.choice`))];
    replaceSetupStep("plan", { status: "done", plan: { option: "recommended", tier: plan.level, roles } });
  }
  void startSetupDownloads(getStackClient(), { ...(vramGb ? { vramGb } : {}), ...(selected ? { selected } : {}) }).catch(() => {});
  const pending = plan.models.filter((model) => !model.installed).length + (selected && plan.disk ? (plan.optional_models ?? []).filter((model) => !model.installed && plan.disk!.rows.some((row) => selected.includes(row.id) && row.model_ids.includes(model.id))).length : 0);
  return { ok: true, models: pending };
}
