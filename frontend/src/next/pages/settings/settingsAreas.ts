// APP-SET-02: the settings areas as data. `areas.json` in the pinned
// @maipai/spec is the one definition of every area, section and card
// (RULES S4); Home reads it and writes no layout of its own.
import areasFile from "@maipai/spec/settings/areas.json";
import type { SettingsAreaDef } from "@maipai/ui/src/settings/settingsAudience";

export const SETTINGS_AREAS = areasFile.areas as unknown as SettingsAreaDef[];

/** The area a route segment names, if it is one of the spec's. */
export function settingsArea(id: string | undefined): SettingsAreaDef | undefined {
  return SETTINGS_AREAS.find((area) => area.id === id);
}

/** `/settings/<area>[/<section>][#<key>]`. */
export function settingsPath(area: string, section?: string, key?: string): string {
  return `/settings/${area}${section ? `/${section}` : ""}${key ? `#${key}` : ""}`;
}

/** The area and section whose card draws this registry group at this scope. */
export function placeForGroup(group: string, scope: "household" | "person" | "device"): { area: string; section: string } | undefined {
  for (const area of SETTINGS_AREAS) {
    for (const section of area.sections) {
      if ((section.cards ?? []).some((card) => card.group === group && card.scope === scope && !card.levels)) return { area: area.id, section: section.id };
    }
  }
  return undefined;
}
