// ROBOT-COMPANION-01 (owner's ruling, 2026-10-21, docs/design/robot-companions-2026-10-21.md): an admin assigns each robot a
// controls level (child, teen or adult) and a companion; the companion's type sets the band of that robot's turns. This file is
// the one definition of the pairing rule. A robot with no companion, or one whose companion no longer fits its controls, reads as
// "none": the strictest (child) result, exactly as before.
import type { AgeBand } from "@/lib/ageBand";
import { getDeviceSettingValue } from "@/lib/settings";
import { listPackageIds, loadManifestOnly } from "@/lib/plugins";

export const ROBOT_CONTROLS_KEY = "robot.controls";
export const ROBOT_COMPANION_KEY = "robot.companion.id";

const RANK: Record<AgeBand, number> = { child: 0, teen: 1, adult: 2 };
const COMPANION_WORD: Record<AgeBand, string> = { child: "child", teen: "child or teen", adult: "child, teen or adult" };

/** One bundled companion as this file needs it. Read from the package manifests directly (not from persona.ts) so this file stays
 * importable from the turn's band code without pulling the persona catalog into the package host's import cycle. */
export interface CompanionInfo { id: string; name: string; controls: AgeBand }

/** The companion's type from its manifest `min_role`: child or guest is a child companion, teen a teen companion, anything higher adult. */
export function companionTypeOf(minRole: string | undefined): AgeBand {
  return minRole === "child" || minRole === "guest" ? "child" : minRole === "teen" ? "teen" : "adult";
}

export function companionInfo(id: string): CompanionInfo | null {
  const loaded = loadManifestOnly(id);
  if (!loaded.ok || loaded.value.kind !== "companion" || !loaded.value.companion) return null;
  return { id, name: loaded.value.companion.display_name, controls: companionTypeOf(loaded.value.min_role) };
}

export function allCompanions(): CompanionInfo[] {
  return [...listPackageIds()].sort().flatMap((id) => companionInfo(id) ?? []);
}

export function stricterBand(a: AgeBand, b: AgeBand): AgeBand {
  return RANK[a] <= RANK[b] ? a : b;
}

/** Whether a robot set to `controls` may use a companion of type `type`. */
export function companionFits(controls: AgeBand, type: AgeBand): boolean {
  return RANK[type] <= RANK[controls];
}

/** The companions a robot at this level may choose, in catalog order. */
export function companionsForControls(controls: AgeBand): CompanionInfo[] {
  return allCompanions().filter((persona) => companionFits(controls, persona.controls));
}

export function robotControlsOf(deviceId: string): AgeBand {
  const value = getDeviceSettingValue(deviceId, ROBOT_CONTROLS_KEY);
  return value === "teen" || value === "adult" ? value : "child";
}

/** The robot's assigned companion, or null when none is assigned, the id is unknown, or its type no longer fits the robot's controls. */
export function robotCompanionOf(deviceId: string): CompanionInfo | null {
  const id = getDeviceSettingValue(deviceId, ROBOT_COMPANION_KEY);
  if (typeof id !== "string" || !id) return null;
  const persona = companionInfo(id);
  return persona && companionFits(robotControlsOf(deviceId), persona.controls) ? persona : null;
}

/** The band an unknown speaker gets on this robot: its companion's type, else child. */
export function robotCompanionBand(deviceId: string | undefined): AgeBand | null {
  return deviceId ? robotCompanionOf(deviceId)?.controls ?? null : null;
}

/** A plain refusal for a write that breaks the pairing rule, or null when it is fine. `controls` and `companionId` are the values
 * the robot would hold after the write. */
export function robotAssignmentProblem(controls: AgeBand, companionId: string): string | null {
  if (!companionId) return null;
  const persona = companionInfo(companionId);
  if (!persona) return "That companion is not installed on this Home. Pick one from the list.";
  if (companionFits(controls, persona.controls)) return null;
  return `${persona.name} is a ${persona.controls} companion. A robot set to ${controls} controls can use only ${COMPANION_WORD[controls]} companions. Pick another companion, or raise this robot's controls first.`;
}

/** The refusal for a settings write (or a reset, `value` = the key's default) that would leave a robot's controls and companion out of
 * step, or null. Called by the settings routes after the writer is known to be an admin. */
export function robotAssignmentRefusal(deviceId: string, key: string, value: unknown): string | null {
  if (key === ROBOT_COMPANION_KEY) return robotAssignmentProblem(robotControlsOf(deviceId), typeof value === "string" ? value : "");
  if (key === ROBOT_CONTROLS_KEY) {
    const next: AgeBand = value === "teen" || value === "adult" ? value : "child";
    const current = getDeviceSettingValue(deviceId, ROBOT_COMPANION_KEY);
    const problem = robotAssignmentProblem(next, typeof current === "string" ? current : "");
    return problem ? `${problem.replace(/ Pick another companion, or raise this robot's controls first\.$/, "")} Change or clear this robot's companion first.` : null;
  }
  return null;
}
