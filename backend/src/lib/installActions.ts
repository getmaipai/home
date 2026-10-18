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
import { licenceCovered } from "@/lib/licenceAcceptance";
import { isLicensedRow, LICENSED_ROWS, type PlanLicence } from "../../../shared/licensedRows";
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

/** The licences of the plan's licensed rows, read from the Stack (the notice text and whether an admin already accepted it). Empty when the Stack cannot say. */
async function licencesFor(rowIds: readonly string[]): Promise<PlanLicence[]> {
  const wanted = rowIds.filter(isLicensedRow);
  if (!wanted.length) return [];
  try {
    const list = (await listStackComponents()).components;
    return wanted.flatMap((rowId) => {
      const part = list.find((component) => component.id === LICENSED_ROWS[rowId]);
      return part?.licence ? [{ row_id: rowId, component: part.id, ...part.licence, covered: licenceCovered(part.licence.id) }] : [];
    });
  } catch { return []; }
}

export async function previewPlan(requestedGb?: number): Promise<{ plan: unknown; wording: PlanWording; licences: PlanLicence[] }> {
  const vramGb = resolveMemoryGb(requestedGb);
  try {
    const plan = await getStackClient().installPlan(vramGb ? { vramGb } : undefined);
    const wording = wordPlan(plan, volumesFor(plan));
    return { plan, wording, licences: await licencesFor(wording.disk?.plan.rows.map((row) => row.id) ?? []) };
  } catch {
    return { plan: null, wording: wordPlan(null), licences: [] };
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
export async function beginInstall(requestedGb: number | undefined, recordInSetup: boolean, components?: readonly string[], acceptedLicences: readonly string[] = []): Promise<BeginInstall> {
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
  const selected = diskPlan ? sanitizeSelection(diskPlan, components ?? (recordInSetup ? diskPlan.default_selected : diskPlan.default_selected.filter((id) => !isLicensedRow(id)))) : undefined;
  if (diskPlan && selected) {
    const verdict = diskVerdict(diskPlan, selected, volumesFor(plan), { missingOnly: Boolean(plan.disk) });
    if (verdict.state === "red") return { ok: false, error: verdict.text, next: "Free some space, or turn off an extra on the list, then press Install again." };
  }
  // Each licensed row the person kept on and does not have yet needs its licence accepted (here or earlier) before any byte comes down.
  const licensed: Array<{ component: string; licence: string }> = [];
  if (diskPlan && selected) {
    const wanted = diskPlan.rows.filter((row) => selected.includes(row.id) && isLicensedRow(row.id) && !row.installed);
    if (wanted.length) {
      const known = await licencesFor(wanted.map((row) => row.id));
      for (const row of wanted) {
        const notice = known.find((candidate) => candidate.row_id === row.id);
        if (!notice) return { ok: false, error: `Home couldn't read the licence for "${row.label}", so it can't install that yet.`, next: "Turn that row off, or press Install again in a minute." };
        if (!notice.accepted_at && !notice.covered && !acceptedLicences.includes(notice.id)) return { ok: false, error: `"${row.label}" comes with its maker's licence (${notice.name}). It needs your accept before it downloads.`, next: "Read and accept the licence on the list, or turn that row off, then press Install again." };
        licensed.push({ component: notice.component, licence: notice.covered && !notice.accepted_at && !acceptedLicences.includes(notice.id) ? "" : notice.id });
      }
    }
  }
  // A licensed part starts here, before the answer: a refusal from the Stack (no room, engine not ready, licence) is the answer to the click, in the Stack's own sentence, not a line in a log nobody reads.
  let startedLicensed = 0;
  for (const part of licensed) {
    try { await installStackComponent(part.component, part.licence ? { acceptedLicence: part.licence } : {}); startedLicensed += 1; }
    catch (error) { return { ok: false, error: error instanceof Error && error.message ? error.message : "The engine did not start that download.", next: "Check that the engine is running, then press the button again, or turn that row off." }; }
  }
  resetInstallStatusCache();
  if (selected) setInstallSelection(selected);
  if (recordInSetup) {
    const roles = [...new Set(plan.models.map((model) => `engines.${model.role}.choice`))];
    replaceSetupStep("plan", { status: "done", plan: { option: "recommended", tier: plan.level, roles } });
  }
  void startSetupDownloads(getStackClient(), { ...(vramGb ? { vramGb } : {}), ...(selected ? { selected } : {}) }).catch(() => {});
  const pending = plan.models.filter((model) => !model.installed).length + (selected && plan.disk ? (plan.optional_models ?? []).filter((model) => !model.installed && plan.disk!.rows.some((row) => selected.includes(row.id) && row.model_ids.includes(model.id))).length : 0);
  return { ok: true, models: pending + startedLicensed };
}
