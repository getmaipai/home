// APP-SET-01: the spec's settings areas (settings/areas.json, SPEC-SETAREA-01)
// read on the server, so global search can link a setting to the page that
// really draws it and hide what the viewer's page would hide. The areas file
// is the one definition of where a registry key lives (principle 4): this
// module only reads it. The audience rules mirror the kit's
// settingsAudience.ts (role ladder, bands, needs); the kit is a React
// package the backend does not import, so the few lines are repeated here
// and the search tests hold the two to the same answers.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";
import type { AreasFile, AreaCard, AreaSection, SettingsArea, Role, Band } from "@maipai/spec/settings/areas-check.js";
import { SPEC_DIR } from "./specDir.js";
import { speakerAgeBand } from "./ageBand";
import { minorVisibleSettingKeys } from "./settingsMinorSnapshot";
import { listActivePeople } from "./access";
import { listDevicesByKind } from "./devices";
import { areWakewordAssetsInstalled } from "./wakewordAssets";
import type { PersonRow } from "@/types";

const ROLE_LADDER: readonly Role[] = ["owner", "admin", "adult", "teen", "child", "guest"];

let cached: AreasFile | null = null;
export function getSettingsAreas(): AreasFile {
  if (!cached) cached = JSON.parse(readFileSync(join(SPEC_DIR, "settings", "areas.json"), "utf-8")) as AreasFile;
  return cached;
}

export interface SettingsViewer {
  role: Role;
  band: Band;
  capabilities: ReadonlySet<string>;
}

/** The viewer as the settings areas see them: role, age band (the stricter of
 * role and birthdate) and the capabilities a `needs` list can name. */
export function settingsViewerFor(actor: PersonRow): SettingsViewer {
  const capabilities = new Set<string>();
  if (areWakewordAssetsInstalled()) capabilities.add("wakeword.assets");
  if (listDevicesByKind("robot").length > 0) capabilities.add("robot.paired");
  if (listActivePeople().some((p) => p.role === "child")) capabilities.add("household.has_child");
  return { role: actor.role as Role, band: speakerAgeBand(actor, new Date()), capabilities };
}

interface Gate { min_role?: Role; bands?: readonly Band[]; needs?: readonly string[] }

function allows(viewer: SettingsViewer, gate: Gate): boolean {
  if (gate.min_role && ROLE_LADDER.indexOf(viewer.role) > ROLE_LADDER.indexOf(gate.min_role)) return false;
  if (gate.bands && gate.bands.length > 0 && !gate.bands.includes(viewer.band)) return false;
  if (gate.needs && gate.needs.some((need) => !viewer.capabilities.has(need))) return false;
  return true;
}

export interface SettingPlace { area: string; section: string; card: string }

/** Where the viewer finds a registry key: the area, section and card whose
 * card draws its group at its scope, at the key's level, with every gate on
 * the path open to the viewer. Undefined when the viewer has no page that
 * shows it (hidden is hidden: it is not a search result either). Expert keys
 * are never placed here, matching search's own disclosure rule. */
export function placeSetting(key: SettingsKey, viewer: SettingsViewer): SettingPlace | undefined {
  if (key.level === "expert") return undefined;
  // A child or teen is never shown more than the old Settings page showed them.
  const minorKeys = minorVisibleSettingKeys(viewer.band);
  if (minorKeys && !minorKeys.has(key.key)) return undefined;
  for (const area of getSettingsAreas().areas as SettingsArea[]) {
    if (!allows(viewer, area.audience)) continue;
    for (const section of area.sections as AreaSection[]) {
      if (section.kind !== "keys" || !allows(viewer, section)) continue;
      for (const card of (section.cards ?? []) as AreaCard[]) {
        if (card.group !== key.lives_in || card.scope !== key.scope || !allows(viewer, card)) continue;
        if (card.levels && !card.levels.includes(key.level as never)) continue;
        return { area: area.id, section: section.id, card: card.label };
      }
    }
  }
  return undefined;
}

export function settingHref(place: SettingPlace, key: string): string {
  return `/settings/${place.area}/${place.section}#${key}`;
}
