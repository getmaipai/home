import { z } from "zod";
import type { LanFetchResult } from "../lanFetch.js";
import type { HouseEntity, HouseKind } from "./registry.js";

export type HouseActionName = "turn_on" | "turn_off" | "set_brightness" | "set_color" | "set_speed" | "open" | "close" | "lock" | "unlock" | "activate" | "set_temperature";
export type HouseActionInput = { name: HouseActionName; value?: number; rgb?: [number, number, number] };
export type StateSnapshot = { state: string; brightness: number | null; rgb: [number, number, number] | null; percentage: number | null; temperature: number | null };
export type HouseActionResult =
  | { ok: true; before: StateSnapshot; after: StateSnapshot; undo: HouseActionInput | null }
  | { ok: false; kind: "refused" | "unreachable" | "timeout" | "not_confirmed" };

type Fetch = (path: string, init?: { method?: "GET" | "POST"; headers?: Record<string, string> | [string, string][]; body?: string | Uint8Array | null }) => Promise<LanFetchResult>;
const rgbSchema = z.tuple([z.number().int().min(0).max(255), z.number().int().min(0).max(255), z.number().int().min(0).max(255)]);
const stateSchema = z.object({
  state: z.string(),
  attributes: z.object({
    brightness: z.number().int().min(0).max(255).nullable().optional(),
    rgb_color: rgbSchema.nullable().optional(),
    percentage: z.number().min(0).max(100).nullable().optional(),
    temperature: z.number().finite().nullable().optional(),
  }).passthrough(),
}).passthrough();

const byKind: Record<HouseKind, HouseActionName[]> = {
  light: ["turn_on", "turn_off", "set_brightness", "set_color"], switch: ["turn_on", "turn_off"], scene: ["activate"],
  fan: ["turn_on", "turn_off", "set_speed"], cover: ["open", "close"], lock: ["lock", "unlock"], climate: ["set_temperature"], alarm: [], camera: [],
};
export function supportedActions(entity: HouseEntity): HouseActionName[] { return [...byKind[entity.kind]]; }

const bad: HouseActionResult = { ok: false, kind: "refused" };
function validAction(entity: HouseEntity, action: HouseActionInput): boolean {
  if (!supportedActions(entity).includes(action.name)) return false;
  if (action.name === "set_brightness" || action.name === "set_speed") return Number.isFinite(action.value) && action.value! >= 1 && action.value! <= 100;
  if (action.name === "set_temperature") return Number.isFinite(action.value) && action.value! >= 5 && action.value! <= 35;
  if (action.name === "set_color") return !!action.rgb && rgbSchema.safeParse(action.rgb).success;
  return action.value === undefined && action.rgb === undefined;
}
function snapshot(text: string): StateSnapshot | null {
  try {
    const parsed = stateSchema.safeParse(JSON.parse(text));
    if (!parsed.success) return null;
    const attrs = parsed.data.attributes;
    return { state: parsed.data.state, brightness: attrs.brightness ?? null, rgb: attrs.rgb_color ?? null, percentage: attrs.percentage ?? null, temperature: attrs.temperature ?? null };
  } catch { return null; }
}

export function houseServiceCall(entity: HouseEntity, action: HouseActionInput): { domain: string; service: string; data: Record<string, unknown> } {
  const basic = { entity_id: entity.id };
  switch (action.name) {
    case "turn_on": case "turn_off": return { domain: entity.kind, service: action.name, data: basic };
    case "set_brightness": return { domain: "light", service: "turn_on", data: { ...basic, brightness_pct: action.value } };
    case "set_color": return { domain: "light", service: "turn_on", data: { ...basic, rgb_color: action.rgb } };
    case "set_speed": return { domain: "fan", service: "set_percentage", data: { ...basic, percentage: action.value } };
    case "open": return { domain: "cover", service: "open_cover", data: basic };
    case "close": return { domain: "cover", service: "close_cover", data: basic };
    case "lock": case "unlock": return { domain: "lock", service: action.name, data: basic };
    case "activate": return { domain: "scene", service: "turn_on", data: basic };
    case "set_temperature": return { domain: "climate", service: "set_temperature", data: { ...basic, temperature: action.value } };
  }
}
function expected(entity: HouseEntity, action: HouseActionInput, current: StateSnapshot): boolean {
  switch (action.name) {
    case "turn_on": return current.state === "on";
    case "turn_off": return current.state === "off";
    case "lock": return current.state === "locked";
    case "unlock": return current.state === "unlocked";
    case "open": return current.state === "open" || current.state === "opening";
    case "close": return current.state === "closed" || current.state === "closing";
    case "activate": return true;
    case "set_temperature": return current.temperature === action.value;
    case "set_brightness": return current.brightness !== null && Math.round(current.brightness / 255 * 100) === action.value;
    case "set_color": return !!current.rgb && current.rgb.every((v, i) => v === action.rgb?.[i]);
    case "set_speed": return current.percentage === action.value;
  }
}
function undoFor(action: HouseActionInput, before: StateSnapshot): HouseActionInput | null {
  switch (action.name) {
    case "turn_on": return before.state === "on" && before.brightness === null && !before.rgb ? null : before.state === "off" ? { name: "turn_off" } : before.brightness !== null ? { name: "set_brightness", value: Math.max(1, Math.round(before.brightness / 255 * 100)) } : before.rgb ? { name: "set_color", rgb: before.rgb } : null;
    case "turn_off": return before.state === "off" ? null : { name: "turn_on" };
    case "set_brightness": return before.state === "off" ? { name: "turn_off" } : before.brightness === null ? null : { name: "set_brightness", value: Math.max(1, Math.round(before.brightness / 255 * 100)) };
    case "set_color": return before.state === "off" ? { name: "turn_off" } : before.rgb ? { name: "set_color", rgb: before.rgb } : null;
    case "lock": return before.state === "locked" ? null : { name: "unlock" };
    case "unlock": return before.state === "unlocked" ? null : { name: "lock" };
    case "open": return before.state === "open" || before.state === "opening" ? null : { name: "close" };
    case "close": return before.state === "closed" || before.state === "closing" ? null : { name: "open" };
    case "set_speed": return before.state === "off" ? { name: "turn_off" } : before.percentage === null ? null : { name: "set_speed", value: Math.max(1, before.percentage) };
    case "set_temperature": return before.temperature === null ? null : { name: "set_temperature", value: before.temperature };
    case "activate": return null;
  }
}

export async function performHouseAction({ lanFetch, token, entity, action, sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)) }: {
  lanFetch: Fetch; token: string; entity: HouseEntity; action: HouseActionInput; sleep?: (ms: number) => Promise<void>;
}): Promise<HouseActionResult> {
  if (!/^[a-z_]+\.[a-z0-9_]+$/.test(entity.id) || !validAction(entity, action)) return bad;
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const read = async (): Promise<StateSnapshot | HouseActionResult> => {
    const response = await lanFetch(`/api/states/${entity.id}`, { headers });
    if (!response.ok) return response;
    if (response.status < 200 || response.status >= 300 || response.truncated) return bad;
    return snapshot(response.text) ?? bad;
  };
  const first = await read();
  if ("ok" in first && first.ok === false) return first;
  if ("ok" in first) return bad;
  const before = first;
  const call = houseServiceCall(entity, action);
  const sent = await lanFetch(`/api/services/${call.domain}/${call.service}`, { method: "POST", headers, body: JSON.stringify(call.data) });
  if (!sent.ok) return sent;
  if (sent.status < 200 || sent.status >= 300 || sent.truncated) return bad;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await sleep(400);
    const result = await read();
    if ("ok" in result && result.ok === false) return result;
    if (!("ok" in result) && expected(entity, action, result)) return { ok: true, before, after: result, undo: undoFor(action, before) };
  }
  return { ok: false, kind: "not_confirmed" };
}
