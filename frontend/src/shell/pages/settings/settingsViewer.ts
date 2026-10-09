import type { Role, SettingsViewer } from "@maipai/ui/src/settings/settingsAudience";
import type { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";
import { minorVisibleSettingKeys } from "@maipai/home-backend/src/wire";
import { getDeviceSettingsScope } from "@/lib/deviceSettingsScope";
import type { Roster } from "@/lib/api";

type Band = SettingsViewer["band"];
export type KitSettingsKey = Omit<SettingsKey, "selector"> & { selector: Exclude<SettingsKey["selector"], "location"> };

/** The viewer's age band: the signed-in person's own, or the one their role
 * carries (a child or teen role is that band; everyone else is an adult). */
export function viewerBand(person: Pick<Roster, "role" | "age_band">): Band {
  if (person.age_band) return person.age_band;
  return person.role === "child" ? "child" : person.role === "teen" ? "teen" : "adult";
}

/** The viewer before any capability is known: enough to decide, with no
 * request made, whether an area is theirs at all. */
export function baseViewer(person: Pick<Roster, "id" | "role" | "age_band">): SettingsViewer {
  return { role: person.role as Role, band: viewerBand(person), selfId: person.id };
}

/** The registry as this viewer's pages may draw it: no expert keys (the
 * shell draws no developer controls yet) and, for a child or teen, only the
 * keys the old Settings page showed them. One filter feeds the shell, its
 * search and every card, so none of them can show a minor more. */
export function visibleRegistry(registry: readonly SettingsKey[], band: Band): KitSettingsKey[] {
  const allowed = minorVisibleSettingKeys(band);
  // The installed settings kit does not render the location selector yet.
  // Keep the existing household.home_place editor visible until the kit
  // ships that control; the canonical key is used by backend resolvers now.
  return registry.filter((key) => key.selector !== "location" && key.level !== "expert" && (!allowed || allowed.has(key.key))) as KitSettingsKey[];
}

/** The runtime scope string the settings API expects for a card's scope. */
export function scopeValueFor(scope: "household" | "person" | "device", personId: string): string {
  if (scope === "household") return "household";
  if (scope === "device") return getDeviceSettingsScope();
  return `person:${personId}`;
}
