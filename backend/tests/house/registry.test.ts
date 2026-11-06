import { describe, expect, test } from "bun:test";
import { classify, fetchHouseRegistry, type HouseRegistryLanFetch } from "../../src/lib/house/registry.js";

const token = "synthetic-test-token";
const entity = (id: string, overrides: Record<string, unknown> = {}) => ({
  id, name: "alfred", state: "on", area: "kitchen", dc: "", rgb: [], bri: 0, ents: [], ...overrides,
});
const areaRows = [{ id: "kitchen", name: "kitchen" }, { id: "hallway", name: "astro" }];
const successFetch = (rows: unknown[], areas: unknown[] = areaRows, capture?: { calls: Array<{ path: string; init: Parameters<HouseRegistryLanFetch>[1] }> }): HouseRegistryLanFetch => {
  let call = 0;
  return async (path, init) => {
    capture?.calls.push({ path, init });
    const result = call++ === 0 ? rows : areas;
    return { ok: true, status: 200, text: JSON.stringify(result), truncated: false };
  };
};

describe("house registry classification", () => {
  test("classifies sensitive domains and cover device classes", () => {
    expect(classify("lock", "")).toEqual({ kind: "lock", sensitive: "lock" });
    expect(classify("alarm_control_panel", "")).toEqual({ kind: "alarm", sensitive: "alarm" });
    expect(classify("camera", "")).toEqual({ kind: "camera", sensitive: "camera" });
    expect(classify("cover", "garage")).toEqual({ kind: "cover", sensitive: "garage" });
    expect(classify("cover", "door")).toEqual({ kind: "cover", sensitive: "entry_cover" });
    expect(classify("cover", "gate")).toEqual({ kind: "cover", sensitive: "entry_cover" });
    expect(classify("cover", "blind")).toEqual({ kind: "cover", sensitive: null });
    expect(classify("light", "")).toEqual({ kind: "light", sensitive: null });
  });

  test("never infers sensitivity from an entity name", async () => {
    const result = await fetchHouseRegistry({ lanFetch: successFetch([entity("light.kitchen_ceiling", { name: "Front door lock" })]), token });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.entities[0]?.sensitive).toBeNull();
  });

  test("normalizes areas and empty scene members", async () => {
    const result = await fetchHouseRegistry({ lanFetch: successFetch([
      entity("light.kitchen_ceiling", { area: "" }),
      entity("scene.kitchen_evening", { ents: [] }),
      entity("scene.hallway_welcome", { ents: ["light.kitchen_ceiling", "switch.hallway_lamp"] }),
    ]), token });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.entities[0]?.area).toBeNull();
      expect(result.entities[1]?.sceneMembers).toBeNull();
      expect(result.entities[2]?.sceneMembers).toEqual(["light.kitchen_ceiling", "switch.hallway_lamp"]);
    }
  });

  test("validates rgb and brightness", async () => {
    const result = await fetchHouseRegistry({ lanFetch: successFetch([
      entity("light.kitchen_ceiling", { rgb: [0, 128, 255], bri: 255 }),
      entity("light.hallway_lamp", { rgb: [0, 256, 1], bri: 256 }),
      entity("light.kitchen_strip", { rgb: [1, 2], bri: 1.5 }),
    ]), token });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.entities.map(item => item.rgb)).toEqual([[0, 128, 255], null, null]);
      expect(result.entities.map(item => item.brightness)).toEqual([255, null, null]);
    }
  });
});

describe("house registry transport", () => {
  test("posts both templates with the bearer token in the authorization header only", async () => {
    const capture = { calls: [] as Array<{ path: string; init: Parameters<HouseRegistryLanFetch>[1] }> };
    const result = await fetchHouseRegistry({ lanFetch: successFetch([entity("light.kitchen_ceiling")], areaRows, capture), token });
    expect(result.ok).toBe(true);
    expect(capture.calls).toHaveLength(2);
    for (const call of capture.calls) {
      expect(call.path).toBe("/api/template");
      expect(call.init?.method).toBe("POST");
      const headers = call.init?.headers as Record<string, string>;
      expect(headers.Authorization).toBe(`Bearer ${token}`);
      expect(headers["Content-Type"]).toBe("application/json");
      expect(call.init?.body).not.toContain(token);
    }
    expect(JSON.stringify(result)).not.toContain(token);
  });

  test("refuses truncated or malformed template responses", async () => {
    const truncated: HouseRegistryLanFetch = async () => ({ ok: true, status: 200, text: "[]", truncated: true });
    expect(await fetchHouseRegistry({ lanFetch: truncated, token })).toEqual({ ok: false, kind: "refused" });
    const malformed: HouseRegistryLanFetch = async () => ({ ok: true, status: 200, text: "not json", truncated: false });
    expect(await fetchHouseRegistry({ lanFetch: malformed, token })).toEqual({ ok: false, kind: "refused" });
  });

  test("passes through lanFetch failure kinds", async () => {
    const failure: HouseRegistryLanFetch = async () => ({ ok: false, kind: "timeout" });
    expect(await fetchHouseRegistry({ lanFetch: failure, token })).toEqual({ ok: false, kind: "timeout" });
  });
});
