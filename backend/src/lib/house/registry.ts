import { z } from "zod";
import type { LanFetchResult } from "../lanFetch.js";

export type HouseKind = "light" | "switch" | "scene" | "cover" | "lock" | "alarm" | "camera" | "climate" | "fan";
export type SensitiveClass = "lock" | "alarm" | "garage" | "entry_cover" | "camera";

export type HouseEntity = {
  id: string;
  name: string;
  kind: HouseKind;
  area: string | null;
  state: string;
  sensitive: SensitiveClass | null;
  deviceClass: string | null;
  rgb: [number, number, number] | null;
  brightness: number | null;
  sceneMembers: string[] | null;
};

export type HouseArea = { id: string; name: string };
export type HouseRegistryResult =
  | { ok: true; areas: HouseArea[]; entities: HouseEntity[] }
  | { ok: false; kind: "unreachable" | "refused" | "timeout" };

type HouseDomain = "light" | "switch" | "scene" | "cover" | "lock" | "alarm_control_panel" | "camera" | "climate" | "fan";

export function classify(domain: string, deviceClass: string): { kind: HouseKind; sensitive: SensitiveClass | null } | null {
  if (domain === "lock") return { kind: "lock", sensitive: "lock" };
  if (domain === "alarm_control_panel") return { kind: "alarm", sensitive: "alarm" };
  if (domain === "camera") return { kind: "camera", sensitive: "camera" };
  if (domain === "cover") {
    if (deviceClass === "garage") return { kind: "cover", sensitive: "garage" };
    if (deviceClass === "door" || deviceClass === "gate") return { kind: "cover", sensitive: "entry_cover" };
    return { kind: "cover", sensitive: null };
  }
  if (domain === "light" || domain === "switch" || domain === "scene" || domain === "climate" || domain === "fan") {
    return { kind: domain, sensitive: null };
  }
  return null;
}

const EntityWireSchema = z.object({
  id: z.string(), name: z.string(), state: z.string(), area: z.string(), dc: z.string(),
  rgb: z.array(z.number()), bri: z.number(), ents: z.array(z.string()),
});
const AreaWireSchema = z.object({ id: z.string(), name: z.string() });
const EntityListSchema = z.array(EntityWireSchema);
const AreaListSchema = z.array(AreaWireSchema);

const ENTITIES_TEMPLATE = "{% set ns = namespace(r=[]) %}{% for s in states | selectattr('domain','in',['light','switch','scene','cover','lock','alarm_control_panel','camera','climate','fan']) %}{% set ns.r = ns.r + [{'id': s.entity_id, 'name': s.name, 'state': s.state, 'area': area_id(s.entity_id) or '', 'dc': s.attributes.get('device_class') or '', 'rgb': s.attributes.get('rgb_color') or [], 'bri': s.attributes.get('brightness') or 0, 'ents': (s.attributes.get('entity_id') or []) if s.domain == 'scene' else []}] %}{% endfor %}{{ ns.r | tojson }}";
const AREAS_TEMPLATE = "{% set ns = namespace(r=[]) %}{% for a in areas() %}{% set ns.r = ns.r + [{'id': a, 'name': area_name(a)}] %}{% endfor %}{{ ns.r | tojson }}";

export type HouseRegistryLanFetch = (path: string, init?: {
  method?: "GET" | "POST";
  headers?: Record<string, string> | [string, string][];
  body?: string | Uint8Array | null;
}) => Promise<LanFetchResult>;

function validRgb(rgb: number[]): [number, number, number] | null {
  if (rgb.length !== 3 || rgb.some(value => !Number.isInteger(value) || value < 0 || value > 255)) return null;
  return [rgb[0]!, rgb[1]!, rgb[2]!];
}

function toEntity(row: z.infer<typeof EntityWireSchema>): HouseEntity | null {
  const domain = row.id.split(".", 1)[0] ?? "";
  if (!(domain === "light" || domain === "switch" || domain === "scene" || domain === "cover" || domain === "lock" || domain === "alarm_control_panel" || domain === "camera" || domain === "climate" || domain === "fan")) return null;
  const classification = classify(domain, row.dc);
  if (!classification) return null;
  return {
    id: row.id,
    name: row.name,
    kind: classification.kind,
    area: row.area === "" ? null : row.area,
    state: row.state,
    sensitive: classification.sensitive,
    deviceClass: row.dc === "" ? null : row.dc,
    rgb: validRgb(row.rgb),
    brightness: Number.isInteger(row.bri) && row.bri >= 1 && row.bri <= 255 ? row.bri : null,
    sceneMembers: domain === "scene" && row.ents.length > 0 ? row.ents : null,
  };
}

function parseArray<T>(text: string, schema: z.ZodType<T[]>): T[] | null {
  try {
    const json: unknown = JSON.parse(text);
    const parsed = schema.safeParse(json);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function fetchHouseRegistry({ lanFetch, token }: { lanFetch: HouseRegistryLanFetch; token: string }): Promise<HouseRegistryResult> {
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const [entityResponse, areaResponse] = await Promise.all([
    lanFetch("/api/template", { method: "POST", headers, body: JSON.stringify({ template: ENTITIES_TEMPLATE }) }),
    lanFetch("/api/template", { method: "POST", headers, body: JSON.stringify({ template: AREAS_TEMPLATE }) }),
  ]);
  if (!entityResponse.ok) return entityResponse;
  if (!areaResponse.ok) return areaResponse;
  if (entityResponse.truncated || areaResponse.truncated || entityResponse.status < 200 || entityResponse.status >= 300 || areaResponse.status < 200 || areaResponse.status >= 300) {
    return { ok: false, kind: "refused" };
  }
  const entityRows = parseArray(entityResponse.text, EntityListSchema);
  const areas = parseArray(areaResponse.text, AreaListSchema);
  if (!entityRows || !areas) return { ok: false, kind: "refused" };
  const entities = entityRows.map(toEntity);
  if (entities.some(entity => entity === null)) return { ok: false, kind: "refused" };
  return { ok: true, areas, entities: entities as HouseEntity[] };
}
