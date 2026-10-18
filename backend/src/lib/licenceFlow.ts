// LICENCE-ACK-01: what the licence acknowledgement looks like to the screens (the list, the one admin prompt for installs
// that never saw the wizard item) and the two actions: accept once, and install the recommended extras.
import { listStackComponents } from "@/lib/stackComponents";
import { getStackClient } from "@/lib/stackEngine";
import { beginInstall, type BeginInstall } from "@/lib/installActions";
import { ackCovers, currentLicenceAck, recordLicenceAck, type LicenceAck } from "@/lib/licenceAcceptance";
import { getHouseholdSettingValue } from "@/lib/settings";
import { LICENCE_TERMS_VERSION } from "../../../shared/licenceTerms";
import { GIB, sizeGb, type DiskPlan } from "../../../shared/diskPlanMath";
import { shippedDiskPlan } from "@/lib/diskPlan";

export interface LicenceEntry { component: string; label: string; id: string; name: string; url: string; summary: string[]; accepted_at: string | null; covered: boolean }
export interface LicenceOverview {
  stack: "ok" | "unreachable"; terms_version: string; acknowledged: LicenceAck | null;
  /** True for the one admin prompt: no current acknowledgement and the Stack has at least one licensed part. */
  needs_prompt: boolean; licences: LicenceEntry[];
  /** The recommended extras not on this computer yet (the licensed Detailed video among them): offered once the acknowledgement exists. */
  extras: { ids: string[]; labels: string[]; bytes: number; size: string } | null;
}

async function recommendedExtras(): Promise<LicenceOverview["extras"]> {
  try {
    const plan = await getStackClient().installPlan();
    const disk: DiskPlan | null = plan.disk ?? (plan.tier ? shippedDiskPlan(plan.tier) : null);
    if (!disk) return null;
    const rows = disk.rows.filter((row) => row.kind === "model" && row.need !== "required" && disk.default_selected.includes(row.id) && !row.installed);
    if (!rows.length) return null;
    const bytes = rows.reduce((sum, row) => sum + row.download_bytes, 0);
    return { ids: rows.map((row) => row.id), labels: rows.map((row) => row.label), bytes, size: sizeGb(Math.max(bytes, GIB / 10)) };
  } catch { return null; }
}

export async function licenceOverview(): Promise<LicenceOverview> {
  const acknowledged = currentLicenceAck();
  try {
    const list = await listStackComponents();
    const licences = list.components.flatMap((part): LicenceEntry[] => part.licence ? [{ component: part.id, label: part.label, ...part.licence, covered: ackCovers(acknowledged, part.licence.id) }] : []);
    return { stack: "ok", terms_version: LICENCE_TERMS_VERSION, acknowledged, needs_prompt: !acknowledged && licences.length > 0, licences, extras: acknowledged ? await recommendedExtras() : null };
  } catch {
    return { stack: "unreachable", terms_version: LICENCE_TERMS_VERSION, acknowledged, needs_prompt: false, licences: [], extras: null };
  }
}

/** Accept once: the record covers every licensed part the Stack lists now. Before an owner exists (`by` "setup") an empty list is fine: the plan's Install widens it. */
export async function acceptLicences(by: string): Promise<{ ok: true; ack: LicenceAck } | { ok: false; error: string; next: string }> {
  try {
    const list = await listStackComponents();
    const ack = recordLicenceAck(by, list.components.flatMap((part) => part.licence ? [{ component: part.id, id: part.licence.id }] : []));
    return { ok: true, ack };
  } catch {
    if (by === "setup") return { ok: true, ack: recordLicenceAck(by, []) };
    return { ok: false, error: "Home couldn't read the licence list from the AI engine.", next: "Check that the engine is running, then press Accept again." };
  }
}

/** Widen the first-run record to the parts the plan page just showed (called when Install starts in the wizard). */
export async function widenLicenceAck(by: string): Promise<void> {
  if (!currentLicenceAck()) return;
  await acceptLicences(by);
}

/** One admin button on the prompt: install the recommended extras. Never silent: needs the acknowledgement and an explicit call. */
export async function installRecommendedExtras(): Promise<BeginInstall> {
  if (!currentLicenceAck()) return { ok: false, error: "Accept the licences first.", next: "Press Accept on the licence prompt, then install the extras." };
  const extras = await recommendedExtras();
  if (!extras) return { ok: true, models: 0 };
  return beginInstall(undefined, false, extras.ids);
}

/** Policy flag install.recommended_auto_on_upgrade (default false): true installs the extras right after the acceptance. */
export const autoInstallOnUpgrade = (): boolean => getHouseholdSettingValue("install.recommended_auto_on_upgrade") === true;
