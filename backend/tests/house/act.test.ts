import { describe, expect, test } from "bun:test";
import { performHouseAction, type HouseActionInput } from "../../src/lib/house/act.js";
import type { HouseEntity } from "../../src/lib/house/registry.js";
import type { HouseRegistryLanFetch } from "../../src/lib/house/registry.js";

const token = "synthetic-token";
function entity(kind: HouseEntity["kind"], id = `${kind}.kitchen_item`): HouseEntity {
  return { id, name: "synthetic", kind, area: "kitchen", state: "off", sensitive: null, deviceClass: null, rgb: null, brightness: null, sceneMembers: null };
}
function state(state: string, attributes: Record<string, unknown> = {}) {
  return { ok: true as const, status: 200, text: JSON.stringify({ state, attributes }), truncated: false };
}
function harness(before: ReturnType<typeof state>, after: ReturnType<typeof state>, capture: { calls: Array<{ path: string; init?: Parameters<HouseRegistryLanFetch>[1] }> } = { calls: [] }, failures?: { kind: "unreachable" | "timeout" | "refused" }) {
  let reads = 0;
  const lanFetch: HouseRegistryLanFetch = async (path, init) => {
    capture.calls.push({ path, init });
    if (failures) return { ok: false, kind: failures.kind };
    if (init?.method === "POST") return { ok: true, status: 200, text: "[]", truncated: false };
    reads++;
    return reads === 1 ? before : after;
  };
  return { lanFetch, capture };
}
const noWait = async () => {};

describe("house action executor", () => {
  test("maps every controllable kind to its Home Assistant service and body", async () => {
    const cases: Array<{ entity: HouseEntity; action: HouseActionInput; path: string; body: unknown; before: ReturnType<typeof state>; after: ReturnType<typeof state> }> = [
      { entity: entity("light"), action: { name: "turn_on" }, path: "/api/services/light/turn_on", body: { entity_id: "light.kitchen_item" }, before: state("off"), after: state("on") },
      { entity: entity("light"), action: { name: "turn_off" }, path: "/api/services/light/turn_off", body: { entity_id: "light.kitchen_item" }, before: state("on"), after: state("off") },
      { entity: entity("light"), action: { name: "set_brightness", value: 60 }, path: "/api/services/light/turn_on", body: { entity_id: "light.kitchen_item", brightness_pct: 60 }, before: state("on", { brightness: 30 }), after: state("on", { brightness: 153 }) },
      { entity: entity("light"), action: { name: "set_color", rgb: [1, 2, 3] }, path: "/api/services/light/turn_on", body: { entity_id: "light.kitchen_item", rgb_color: [1, 2, 3] }, before: state("on"), after: state("on", { rgb_color: [1, 2, 3] }) },
      { entity: entity("switch"), action: { name: "turn_on" }, path: "/api/services/switch/turn_on", body: { entity_id: "switch.kitchen_item" }, before: state("off"), after: state("on") },
      { entity: entity("scene"), action: { name: "activate" }, path: "/api/services/scene/turn_on", body: { entity_id: "scene.kitchen_item" }, before: state("scening"), after: state("scening") },
      { entity: entity("fan"), action: { name: "turn_off" }, path: "/api/services/fan/turn_off", body: { entity_id: "fan.kitchen_item" }, before: state("on"), after: state("off") },
      { entity: entity("fan"), action: { name: "set_speed", value: 42 }, path: "/api/services/fan/set_percentage", body: { entity_id: "fan.kitchen_item", percentage: 42 }, before: state("on", { percentage: 30 }), after: state("on", { percentage: 42 }) },
      { entity: entity("cover"), action: { name: "open" }, path: "/api/services/cover/open_cover", body: { entity_id: "cover.kitchen_item" }, before: state("closed"), after: state("opening") },
      { entity: entity("cover"), action: { name: "close" }, path: "/api/services/cover/close_cover", body: { entity_id: "cover.kitchen_item" }, before: state("open"), after: state("closing") },
      { entity: entity("lock", "lock.front_door"), action: { name: "lock" }, path: "/api/services/lock/lock", body: { entity_id: "lock.front_door" }, before: state("unlocked"), after: state("locked") },
      { entity: entity("climate"), action: { name: "set_temperature", value: 21 }, path: "/api/services/climate/set_temperature", body: { entity_id: "climate.kitchen_item", temperature: 21 }, before: state("heat", { temperature: 19 }), after: state("heat", { temperature: 21 }) },
    ];
    for (const item of cases) {
      const h = harness(item.before, item.after);
      const result = await performHouseAction({ ...h, token, entity: item.entity, action: item.action, sleep: noWait });
      expect(result.ok).toBe(true);
      const post = h.capture.calls.find(call => call.init?.method === "POST")!;
      expect(post.path).toBe(item.path);
      expect(JSON.parse(post.init?.body as string)).toEqual(item.body);
      expect(JSON.stringify(result)).not.toContain(token);
    }
  });

  test("refuses unsupported kinds, invalid ids, and invalid values without calling the network", async () => {
    const cases: Array<[HouseEntity, HouseActionInput]> = [
      [entity("light"), { name: "set_brightness", value: 101 }], [entity("fan"), { name: "set_speed", value: 0 }],
      [entity("climate"), { name: "set_temperature", value: 36 }], [entity("light"), { name: "set_color", rgb: [0, 2, 256] }],
      [entity("alarm"), { name: "turn_on" }], [entity("camera"), { name: "turn_on" }],
      [entity("light", "light.Bad-id"), { name: "turn_on" }],
    ];
    for (const [target, action] of cases) {
      let calls = 0;
      const lanFetch: HouseRegistryLanFetch = async () => { calls++; return state("on"); };
      expect(await performHouseAction({ lanFetch, token, entity: target, action, sleep: noWait })).toEqual({ ok: false, kind: "refused" });
      expect(calls).toBe(0);
    }
  });

  test("returns before, after and correct undo values", async () => {
    const checks: Array<{ target: HouseEntity; action: HouseActionInput; before: ReturnType<typeof state>; after: ReturnType<typeof state>; undo: HouseActionInput | null }> = [
      { target: entity("light"), action: { name: "turn_on" }, before: state("off", { brightness: 102 }), after: state("on", { brightness: 102 }), undo: { name: "turn_off" } },
      { target: entity("light"), action: { name: "turn_off" }, before: state("on", { brightness: 128 }), after: state("off"), undo: { name: "turn_on" } },
      { target: entity("light"), action: { name: "set_brightness", value: 80 }, before: state("on", { brightness: 128 }), after: state("on", { brightness: 204 }), undo: { name: "set_brightness", value: 50 } },
      { target: entity("light"), action: { name: "set_color", rgb: [3, 4, 5] }, before: state("on", { rgb_color: [6, 7, 8] }), after: state("on", { rgb_color: [3, 4, 5] }), undo: { name: "set_color", rgb: [6, 7, 8] } },
      { target: entity("lock"), action: { name: "lock" }, before: state("unlocked"), after: state("locked"), undo: { name: "unlock" } },
      { target: entity("lock"), action: { name: "unlock" }, before: state("locked"), after: state("unlocked"), undo: { name: "lock" } },
      { target: entity("cover"), action: { name: "open" }, before: state("closed"), after: state("open"), undo: { name: "close" } },
      { target: entity("fan"), action: { name: "set_speed", value: 42 }, before: state("on", { percentage: 20 }), after: state("on", { percentage: 42 }), undo: { name: "set_speed", value: 20 } },
      { target: entity("climate"), action: { name: "set_temperature", value: 22 }, before: state("heat", { temperature: 19 }), after: state("heat", { temperature: 22 }), undo: { name: "set_temperature", value: 19 } },
      { target: entity("scene"), action: { name: "activate" }, before: state("unknown"), after: state("unknown"), undo: null },
    ];
    for (const check of checks) {
      const h = harness(check.before, check.after);
      const result = await performHouseAction({ ...h, token, entity: check.target, action: check.action, sleep: noWait });
      expect(result.ok).toBe(true);
      if (result.ok) { expect(result.before.state).toBe(JSON.parse(check.before.text).state); expect(result.after.state).toBe(JSON.parse(check.after.text).state); expect(result.undo).toEqual(check.undo); }
    }
  });

  test("tries four verification reads, passes through transport failures, and leaks no response text", async () => {
    let reads = 0;
    const never: HouseRegistryLanFetch = async (_path, init) => {
      if (init?.method === "POST") return { ok: true, status: 200, text: "secret response", truncated: false };
      reads++;
      return state("off");
    };
    expect(await performHouseAction({ lanFetch: never, token, entity: entity("light"), action: { name: "turn_on" }, sleep: noWait })).toEqual({ ok: false, kind: "not_confirmed" });
    expect(reads).toBe(5);
    for (const kind of ["unreachable", "timeout", "refused"] as const) {
      const h = harness(state("off"), state("on"), { calls: [] }, { kind });
      const result = await performHouseAction({ ...h, token, entity: entity("light"), action: { name: "turn_on" }, sleep: noWait });
      expect(result).toEqual({ ok: false, kind });
      expect(JSON.stringify(result)).not.toContain(token);
    }
  });

  test("undoing a brightness, colour or speed change on something that was off turns it off", async () => {
    const light = await performHouseAction({ ...harness(state("off"), state("on", { brightness: 128 })), token, entity: entity("light"), action: { name: "set_brightness", value: 50 }, sleep: noWait });
    expect(light.ok && light.undo).toEqual({ name: "turn_off" });
    const color = await performHouseAction({ ...harness(state("off"), state("on", { rgb_color: [1, 2, 3] })), token, entity: entity("light"), action: { name: "set_color", rgb: [1, 2, 3] }, sleep: noWait });
    expect(color.ok && color.undo).toEqual({ name: "turn_off" });
    const fan = await performHouseAction({ ...harness(state("off"), state("on", { percentage: 40 })), token, entity: entity("fan"), action: { name: "set_speed", value: 40 }, sleep: noWait });
    expect(fan.ok && fan.undo).toEqual({ name: "turn_off" });
  });
});
