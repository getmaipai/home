import type { Role, SettingsAreaDef, SettingsViewer } from "@maipai/ui/src/settings/settingsAudience";
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
export function visibleRegistry(registry: readonly SettingsKey[], band: Band, includeExpertKeys: readonly string[] = [], packageAreaKeys: ReadonlySet<string> = NO_KEYS): KitSettingsKey[] {
  const allowed = minorVisibleSettingKeys(band);
  // The household home is the one central location key drawn here (Settings >
  // General). A person's place lists belong in an app's own settings area
  // (PLACE-ELEMENT-01b): a location key is drawn only when a package area's
  // card draws its group (`packageAreaKeys`), never in a generic card. Those
  // keys are the person's own, so a child or teen sees them too.
  const expertKeys = new Set(includeExpertKeys);
  return registry.filter((key) => {
    const ofPackageArea = packageAreaKeys.has(key.key);
    if (key.selector === "location" && key.key !== "household.home" && !ofPackageArea) return false;
    if (key.level === "expert" && !expertKeys.has(key.key)) return false;
    return ofPackageArea || !allowed || allowed.has(key.key);
  }) as KitSettingsKey[];
}

const NO_KEYS: ReadonlySet<string> = new Set();

/** The registry keys a package settings area's cards draw: each card's group at its scope. */
export function packageAreaKeySet(areas: readonly SettingsAreaDef[], registry: readonly SettingsKey[]): ReadonlySet<string> {
  const drawn = new Set<string>();
  for (const area of areas) for (const section of area.sections) for (const card of section.cards ?? []) if (card.group && card.scope) drawn.add(`${card.scope}:${card.group}`);
  return new Set(registry.filter((key) => drawn.has(`${key.scope}:${key.lives_in}`)).map((key) => key.key));
}

/** The runtime scope string the settings API expects for a card's scope. */
export function scopeValueFor(scope: "household" | "person" | "device", personId: string): string {
  if (scope === "household") return "household";
  if (scope === "device") return getDeviceSettingsScope();
  return `person:${personId}`;
}
