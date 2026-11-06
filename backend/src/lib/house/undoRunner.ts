import type { PersonRow } from "@/types";
import { effectivePermissions } from "@/lib/permissions";
import { houseLanFetch } from "./connection";
import type { HouseLanFetchResult } from "./connection";
import { loadHouseRegistry } from "./cache";
import { houseAccess, type HouseActor } from "./access";
import type { HouseEntity } from "./registry";

const DOMAINS = new Set(["light", "switch", "scene", "fan", "cover", "lock", "climate"]);
const SERVICES = new Set(["turn_on", "turn_off", "set_percentage", "open_cover", "close_cover", "lock", "unlock", "set_temperature"]);
const SAFE_ID = /^[a-z_]+\.[a-z0-9_]+$/;
const actionEntity: Record<string, string> = { light: "light", switch: "switch", scene: "scene", fan: "fan", cover: "cover", lock: "lock", climate: "climate" };

const isInt = (v: unknown, lo: number, hi: number): boolean => typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;
/** The only extra fields a stored inverse may carry, each range-checked. */
export function undoDataIsSafe(data: Record<string, unknown>): boolean {
  for (const [key, value] of Object.entries(data)) {
    if (key === "entity_id") continue;
    if (key === "temperature" && typeof value === "number" && value >= 5 && value <= 35) continue;
    if (key === "percentage" && isInt(value, 0, 100)) continue;
    if (key === "brightness_pct" && isInt(value, 1, 100)) continue;
    if (key === "rgb_color" && Array.isArray(value) && value.length === 3 && value.every((c) => isInt(c, 0, 255))) continue;
    return false;
  }
  return true;
}

export function houseUndoRunner(actor: PersonRow, deps: { connection?: () => HouseLanFetchResult } = {}): (domain: string, service: string, data: Record<string, unknown>) => Promise<boolean> {
  return async (domain, service, data) => {
    try {
      if (!DOMAINS.has(domain) || !SERVICES.has(service) || typeof data.entity_id !== "string" || !SAFE_ID.test(data.entity_id)) return false;
      if (data.entity_id.split(".")[0] !== domain || !undoDataIsSafe(data)) return false;
      const registry = await loadHouseRegistry();
      if (!registry.ok) return false;
      const entity = registry.entities.find((item) => item.id === data.entity_id);
      if (!entity || actionEntity[entity.kind] !== domain) return false;
      const band: HouseActor["band"] = actor.role === "child" ? "child" : actor.role === "teen" ? "teen" : "adult";
      const houseActor: HouseActor = { id: actor.id, role: actor.role as HouseActor["role"], band };
      const permissions = effectivePermissions(actor.id);
      const control = houseAccess({ actor: houseActor, permissions, entity, level: "control" });
      if (!control.allowed) return false;
      if ((service === "unlock" || service === "open_cover") && houseAccess({ actor: houseActor, permissions, entity, level: "confirm" }).confirm) return false;
      const connection = (deps.connection ?? houseLanFetch)();
      if (!connection.ok) return false;
      const response = await connection.lanFetch(`/api/services/${domain}/${service}`, { method: "POST", headers: { Authorization: `Bearer ${connection.token}`, "Content-Type": "application/json" }, body: JSON.stringify(data) });
      return response.ok && response.status >= 200 && response.status < 300 && !response.truncated;
    } catch { return false; }
  };
}
