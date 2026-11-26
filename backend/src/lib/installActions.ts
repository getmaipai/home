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
import { installStackComponent, listStackComponents } from "@/lib/stackComponents";
import type { StackInstallPlan } from "@/lib/stack/client";
import { cannotRunJobs, cannotRunWhy, readCapabilities } from "@/lib/memoryRoom";
import { ensureVisionAssets, faceFinderState } from "@/lib/visionAssets";
import { withFeatures } from "@/lib/setupJobsState";
import { FACES_ROW_ID, jobRowIds, type SetupJobId } from "../../../shared/setupJobs";

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
    const wording = wordPlan(plan, volumesFor(plan));
    return { plan, wording };
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

/** A job the request asked for that this computer can never run (the Stack's fits_ever is false for every tier), with the reason. */
export interface LeftOut { job: string; reason: string }

/** MEM-SPACE-05: takes the rows of every job no tier can run out of the selection. Required rows stay; a Stack without the capability table leaves the selection as it is. */
export async function withoutUnfitJobs(diskPlan: DiskPlan, selected: string[]): Promise<{ selected: string[]; leftOut: LeftOut[] }> {
  const view = await readCapabilities();
  const never = cannotRunJobs(view);
  if (never.length === 0) return { selected, leftOut: [] };
  const why = cannotRunWhy(view);
  const required = new Set(diskPlan.rows.filter((row) => row.need === "required").map((row) => row.id));
  const drop = new Set<string>();
  const leftOut: LeftOut[] = [];
  for (const job of never) {
    const rows = jobRowIds(withFeatures(diskPlan), job as SetupJobId).filter((id) => selected.includes(id) && !required.has(id));
    if (rows.length === 0) continue;
    rows.forEach((id) => drop.add(id));
    leftOut.push({ job, reason: why[job] ?? "This computer can never run it, so Home does not download it." });
  }
  return { selected: selected.filter((id) => !drop.has(id)), leftOut };
}

export type BeginInstall = { ok: true; models: number; leftOut?: LeftOut[] } | { ok: false; error: string; next: string };

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
  // A licensed extra (Detailed video) is on by default in the wizard only; Home settings and an upgrade never pull it unasked.
  // The face finder files are the hub's own pinned download, not a Stack part: the wizard's Install (an admin's explicit action) starts them when that row is ticked.
  const facesAsked = components?.includes(FACES_ROW_ID) === true && !faceFinderState().installed;
  const wanted = diskPlan ? sanitizeSelection(diskPlan, components ?? (diskPlan.default_selected)) : undefined;
  // The Stack's fits_ever: a job no tier can ever run on this computer is not downloaded, whatever was asked for.
  const fitted = diskPlan && wanted ? await withoutUnfitJobs(diskPlan, wanted) : { selected: wanted, leftOut: [] as LeftOut[] };
  const selected = fitted.selected;
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
  if (facesAsked) void ensureVisionAssets().catch(() => {});
  // MP-09: ffmpeg is a required row with no model files, so the pulls never carry it; the wizard asks the Stack to install it as a component (it asks only when the Stack lists it and it is not installed, so an installed ffmpeg is never re-requested and a Stack that does not list it yet changes nothing).
  for (const componentId of ["ffmpeg", "fpcalc", "shazam-signature"]) {
    if (diskPlan?.rows.some((row) => row.id === componentId) && (!selected || selected.includes(componentId))) void listStackComponents().then(async (list) => { const part = list.components.find((component) => component.id === componentId); if (part && part.state !== "installed" && part.state !== "installing") await installStackComponent(componentId); }).catch(() => {});
  }
  void startSetupDownloads(getStackClient(), { ...(vramGb ? { vramGb } : {}), ...(selected ? { selected } : {}) }).catch(() => {});
  const pending = plan.models.filter((model) => !model.installed).length + (selected && plan.disk ? (plan.optional_models ?? []).filter((model) => !model.installed && plan.disk!.rows.some((row) => selected.includes(row.id) && row.model_ids.includes(model.id))).length : 0);
  return { ok: true, models: pending + (facesAsked ? 1 : 0), ...(fitted.leftOut.length ? { leftOut: fitted.leftOut } : {}) };
}
