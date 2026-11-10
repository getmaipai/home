// The Home "Devices" widget (size "tiles"): the devices this person may already see in the house tool, as small tiles of name and state.
// Read only. It uses the same cached registry, the same per-person access check (`visibleHouseEntities`) and the same household mode as the
// house tool, so a locked, garage, entry-door or camera item still needs a grant on the item itself for a teen or child, and nothing here
// can change a device. Controlling a tile goes through the house tool, which keeps its two-step confirm and age gates.
import { effectivePermissions } from "@/lib/permissions";
import { speakerAgeBand } from "@/lib/ageBand";
import { getHouseholdSettingValue } from "@/lib/settings";
import type { PersonRow } from "@/types";
import { houseAnyConnected } from "./connection";
import { peekHouseRegistries, warmHouseRegistries } from "./cache";
import { visibleHouseEntities } from "./tool";
import type { HouseEntity, HouseKind } from "./registry";
import type { HouseActor } from "./access";

export interface DeviceTile { id: string; name: string; state: string; icon: HouseKind; on: boolean }

/** The most tiles one card shows. */
export const DEVICE_TILE_LIMIT = 8;
/** Kinds a tile can show. Scenes, alarms and cameras are not devices with an on or off state. */
const TILE_ORDER: HouseKind[] = ["lock", "cover", "light", "switch", "fan", "climate"];

function stateWords(entity: HouseEntity): { state: string; on: boolean } {
  const raw = entity.state.toLowerCase();
  if (raw === "unavailable" || raw === "unknown") return { state: "Not responding", on: false };
  switch (entity.kind) {
    case "lock": return { state: raw === "locked" ? "Locked" : raw === "unlocked" ? "Unlocked" : "Check lock", on: raw !== "locked" };
    case "cover": return { state: raw === "open" ? "Open" : raw === "closed" ? "Closed" : raw === "opening" ? "Opening" : raw === "closing" ? "Closing" : "Partly open", on: raw !== "closed" };
    case "climate": return { state: raw === "off" ? "Off" : raw === "heat" ? "Heating" : raw === "cool" ? "Cooling" : "On", on: raw !== "off" };
    default: return { state: raw === "on" ? "On" : "Off", on: raw === "on" };
  }
}

export function deviceTiles(entities: readonly HouseEntity[]): DeviceTile[] {
  const rank = (kind: HouseKind) => TILE_ORDER.indexOf(kind);
  return entities
    .filter((entity) => rank(entity.kind) >= 0)
    .sort((a, b) => rank(a.kind) - rank(b.kind) || a.name.localeCompare(b.name))
    .slice(0, DEVICE_TILE_LIMIT)
    .map((entity) => ({ id: `${entity.instance ?? "default"}/${entity.id}`, name: entity.name, icon: entity.kind, ...stateWords(entity) }));
}

/** The tiles this person may see right now; empty (so Home hides the card) for a guest, when the household turned the house off,
 * when nothing is connected, or until the first registry read finishes. */
export function deviceTilesFor(actor: PersonRow): DeviceTile[] {
  if (actor.role === "guest" || getHouseholdSettingValue("tools.house.mode") === "never" || !houseAnyConnected()) return [];
  const registry = peekHouseRegistries();
  if (!registry) { warmHouseRegistries(); return []; }
  const band = speakerAgeBand(actor, new Date());
  const houseActor: HouseActor = { id: actor.id, role: actor.role as HouseActor["role"], band: band === "child" || band === "teen" ? band : "adult" };
  return deviceTiles(visibleHouseEntities({ actor: houseActor, permissions: effectivePermissions(actor.id), entities: registry.entities }));
}
