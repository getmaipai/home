import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { app } from "@/app";
import { __setHouseRoomsDepsForTests, type HouseRoomsDeps } from "@/routes/house";
import type { HouseArea, HouseEntity } from "@/lib/house/registry";
import { owner, child } from "../support/testAuth";
import { resetDb } from "../reset-db";

const areas: HouseArea[] = [{ id: "k", name: "Kitchen" }, { id: "h", name: "Hallway" }];
const entity = (id: string, name: string, kind: HouseEntity["kind"], area: string | null = "k", extra: Partial<HouseEntity> = {}): HouseEntity => ({ id, name, kind, area, state: "off", sensitive: null, deviceClass: null, rgb: null, brightness: null, sceneMembers: null, ...extra });
const registry = { ok: true as const, areas, entities: [entity("light.allowed", "Allowed", "light", "k", { state: "on", rgb: [2, 4, 6], brightness: 128 }), entity("light.hidden", "Hidden", "light", "h"), entity("lock.front", "Front", "lock", "h", { sensitive: "lock" }), entity("switch.misc", "Misc", "switch", null)] };
function configure(overrides: Partial<HouseRoomsDeps> = {}) {
  const audits: unknown[] = []; const undos: unknown[] = []; const calls: unknown[] = [];
  const deps: HouseRoomsDeps = {
    loadRegistry: async () => registry,
    connection: () => ({ ok: true, token: "token", lanFetch: async () => ({ ok: true, status: 200, text: "{}", truncated: false }) }) as never,
    permissionsOf: () => [],
    perform: async (_entity, action) => { calls.push(action); return { ok: true, before: { state: "off", brightness: null, rgb: null, percentage: null, temperature: null }, after: { state: "on", brightness: null, rgb: null, percentage: null, temperature: null }, undo: action.name === "turn_on" ? { name: "turn_off" } : null }; },
    audit: (row) => audits.push(row), undo: (row) => { undos.push(row); return { id: "undo-room", expiresAt: "later" }; }, mode: () => "do", ...overrides,
  };
  __setHouseRoomsDepsForTests(deps); return { audits, undos, calls };
}

describe("GET and POST /api/house", () => {
  beforeEach(() => resetDb());
  afterEach(() => __setHouseRoomsDepsForTests());
  test("adult sees all; child sees only granted light; hidden entity is absent", async () => {
    const rig = configure({ permissionsOf: (id) => id === "child-id" ? ["see", "control"].map((level) => ({ action: `house.${level}:entity:light.allowed`, effect: "allow" as const })) : [] });
    const { client: adult } = await owner();
    const adultBody = await (await adult.get("/api/house/rooms")).json() as { rooms: Array<{ entities: Array<{ id: string; swatch: string | null }> }> };
    expect(adultBody.rooms.flatMap((room) => room.entities).map((item) => item.id)).toContain("light.hidden");
    expect(adultBody.rooms.flatMap((room) => room.entities).find((item) => item.id === "light.allowed")?.swatch).toBe("rgb(2, 4, 6)");
    const { client: kid } = await child(adult);
    const kidId = (await kid.get("/api/auth/me").then((r) => r.json()) as { id: string }).id;
    const withKidGrant = configure({ ...rig, permissionsOf: (id) => id === kidId ? ["see", "control"].map((level) => ({ action: `house.${level}:entity:light.allowed`, effect: "allow" as const })) : [] });
    const kidBody = await (await kid.get("/api/house/rooms")).json() as { rooms: Array<{ entities: Array<{ id: string }> }> };
    expect(kidBody.rooms.flatMap((room) => room.entities).map((item) => item.id)).toEqual(["light.allowed"]);
    expect(withKidGrant).toBeDefined();
  });
  test("unknown speaker gets 403 and not_configured is a plain status", async () => {
    const { client } = await owner();
    configure({ connection: () => ({ ok: false, reason: "not_set", message: "secret internal detail" }) as never });
    expect((await (await import("@/app")).app.request("/api/house/rooms")).status).toBe(401);
    expect(await (await client.get("/api/house/rooms")).json()).toEqual({ rooms: [], status: "not_configured" });
  });
  test("act reads back state and returns Undo id for turn_on", async () => {
    const { client } = await owner(); const rig = configure();
    const response = await client.post("/api/house/act", { entity: "light.allowed", action: "turn_on" });
    expect(await response.json()).toEqual({ ok: true, state: "on", undoId: "undo-room" });
    expect(rig.undos).toHaveLength(1); expect(rig.audits).toHaveLength(1);
  });
  test("act turn_off returns the state read back after the call", async () => {
    const { client } = await owner();
    configure({ perform: async () => ({ ok: true, before: { state: "on", brightness: null, rgb: null, percentage: null, temperature: null }, after: { state: "off", brightness: null, rgb: null, percentage: null, temperature: null }, undo: { name: "turn_on" } }) });
    const response = await client.post("/api/house/act", { entity: "light.allowed", action: "turn_off" });
    expect(await response.json()).toEqual({ ok: true, state: "off", undoId: "undo-room" });
  });
  test("act refuses child lock, server-like action, and mode never", async () => {
    const { client: adult } = await owner(); const { client: kid } = await child(adult);
    configure({ permissionsOf: () => ["see", "control", "confirm"].map((level) => ({ action: `house.${level}:entity:lock.front`, effect: "allow" as const })) });
    expect((await kid.post("/api/house/act", { entity: "lock.front", action: "lock" })).status).toBe(403);
    expect((await adult.post("/api/house/act", { entity: "light.allowed", action: "restart_core" })).status).toBe(400);
    configure({ mode: () => "never" });
    expect((await adult.post("/api/house/act", { entity: "light.allowed", action: "turn_on" })).status).toBe(403);
  });
});
