import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { db } from "@/db";
import { settingsValues, toolAudit } from "@/db/schema";
import { __setInstanceAdminDepsForTests } from "@/routes/houseInstances";
import { applyExposure } from "@/lib/house/exposure";
import type { HouseEntity } from "@/lib/house/registry";
import { owner, teen } from "../support/testAuth";
import { app } from "@/app";
import { resetDb } from "../reset-db";

const ok = (text: string) => ({ ok: true as const, status: 200, text, truncated: false, headers: {} });
const entityRow = (id: string, area = "", dc = "") => ({ id, name: id, state: "off", area, dc, rgb: [], bri: 0, ents: [] });
function fakeHa(entities: ReturnType<typeof entityRow>[], areas = [{ id: "k", name: "Kitchen" }]) {
  return async (_url: string, init: { body?: unknown }) => {
    const template = JSON.parse(String(init.body)).template as string;
    return new Response(template.includes("areas()") ? JSON.stringify(areas) : JSON.stringify(entities), { status: 200 });
  };
}
const ent = (id: string, area: string | null): HouseEntity => ({ id, name: id, kind: "light", area, state: "off", sensitive: null, deviceClass: null, rgb: null, brightness: null, sceneMembers: null });

beforeEach(() => resetDb());
afterEach(() => __setInstanceAdminDepsForTests());

describe("House instance admin routes", () => {
  test("owner or admin only", async () => {
    const { client } = await owner();
    expect((await client.get("/api/house/connectors/home_assistant")).status).toBe(200);
    expect((await (await teen(client)).get("/api/house/connectors/home_assistant")).status).toBe(403);
    expect((await app.request("/api/house/connectors/home_assistant")).status).toBe(401);
  });

  test("a fresh household lists the virtual default and never returns a token", async () => {
    const { client } = await owner();
    const body = await (await client.get("/api/house/connectors/home_assistant")).json() as { instances: Array<Record<string, unknown>> };
    expect(body.instances).toHaveLength(1);
    expect(body.instances[0]).toMatchObject({ instance: "default", virtual: true, enabled: true, hasToken: false });
    expect(JSON.stringify(body)).not.toContain("token\":\"");
  });

  test("add, rename, disable, remove; the token is stored encrypted and slugs are never reused", async () => {
    const { client } = await owner();
    expect((await client.post("/api/house/connectors/home_assistant", { label: "Main house", address: "http://192.168.2.20:8123", token: "t0" })).status).toBe(201);
    const add = await client.post("/api/house/connectors/home_assistant", { label: "Cabin", address: "http://192.168.2.30:8123", token: "SECRET-TOKEN-1" });
    expect(add.status).toBe(201);
    const created = await add.json() as { instance: string };
    expect(created.instance).toBe("cabin");
    expect(db.select().from(settingsValues).all().some((row) => row.value.includes("SECRET-TOKEN-1"))).toBe(false);
    const listed = await (await client.get("/api/house/connectors/home_assistant")).json() as { instances: Array<{ instance: string; label: string; hasToken: boolean; enabled: boolean }> };
    expect(listed.instances.find((i) => i.instance === "cabin")).toMatchObject({ label: "Cabin", hasToken: true, enabled: true });
    expect(JSON.stringify(listed)).not.toContain("SECRET-TOKEN-1");

    expect((await client.put("/api/house/connectors/home_assistant/cabin", { label: "Lake cabin", enabled: false })).status).toBe(200);
    const after = await (await client.get("/api/house/connectors/home_assistant")).json() as { instances: Array<{ instance: string; label: string; enabled: boolean }> };
    expect(after.instances.find((i) => i.instance === "cabin")).toMatchObject({ label: "Lake cabin", enabled: false });

    expect((await client.delete("/api/house/connectors/home_assistant/cabin")).status).toBe(200);
    const gone = await (await client.get("/api/house/connectors/home_assistant")).json() as { instances: Array<{ instance: string }> };
    expect(gone.instances.some((i) => i.instance === "cabin")).toBe(false);
    const again = await (await client.post("/api/house/connectors/home_assistant", { label: "Cabin", address: "http://192.168.2.31:8123", token: "t" })).json() as { instance: string };
    expect(again.instance).toBe("cabin-2");
  });

  test("a bad address says what to type; a ninth instance is refused", async () => {
    const { client } = await owner();
    const bad = await client.post("/api/house/connectors/home_assistant", { label: "Cabin", address: "http://homeassistant.local:8123", token: "t" });
    expect(bad.status).toBe(400);
    expect(JSON.stringify(await bad.json())).toContain("numeric address");
    for (let i = 0; i < 8; i++) expect((await client.post("/api/house/connectors/home_assistant", { label: `House ${i}`, address: `http://192.168.2.${10 + i}:8123`, token: "t" })).status).toBe(201);
    const ninth = await client.post("/api/house/connectors/home_assistant", { label: "One more", address: "http://192.168.2.99:8123", token: "t" });
    expect(ninth.status).toBe(400);
    expect(JSON.stringify(await ninth.json())).toContain("8");
  });

  test("Test reaches only that instance and reports rooms and devices", async () => {
    const { client } = await owner();
    await client.post("/api/house/connectors/home_assistant", { label: "Main house", address: "http://192.168.2.20:8123", token: "t" });
    await client.post("/api/house/connectors/home_assistant", { label: "Cabin", address: "http://192.168.2.30:8123", token: "t" });
    const hosts: string[] = [];
    const server = fakeHa([entityRow("light.a", "k"), entityRow("light.b")]);
    __setInstanceAdminDepsForTests({ fetch: (async (url: string, init: { body?: unknown }) => { hosts.push(new URL(url).hostname); return server(url, init); }) as never });
    const result = await (await client.post("/api/house/connectors/home_assistant/cabin/test")).json();
    expect(result).toMatchObject({ ok: true, rooms: 1, devices: 2 });
    expect(hosts.every((h) => h === "192.168.2.30")).toBe(true);
  });

  test("exposure: the editor lists everything, saving limits what the rest of Home sees", async () => {
    const { client } = await owner();
    await client.post("/api/house/connectors/home_assistant", { label: "Main house", address: "http://192.168.2.20:8123", token: "t" });
    await client.post("/api/house/connectors/home_assistant", { label: "Cabin", address: "http://192.168.2.30:8123", token: "t" });
    __setInstanceAdminDepsForTests({ fetch: fakeHa([entityRow("light.a", "k"), entityRow("light.b"), entityRow("lock.front", "", "")]) as never });
    const editor = await (await client.get("/api/house/connectors/home_assistant/cabin/exposure")).json() as { configured: boolean; areas: Array<{ id: string }>; entities: Array<{ id: string; sensitive: string | null }> };
    expect(editor.configured).toBe(false);
    expect(editor.entities.map((e) => e.id).sort()).toEqual(["light.a", "light.b", "lock.front"]);
    expect(editor.entities.find((e) => e.id === "lock.front")?.sensitive).toBe("lock");
    expect((await client.put("/api/house/connectors/home_assistant/cabin/exposure", { areas: ["k"], entities: ["light.b"] })).status).toBe(200);
    const saved = await (await client.get("/api/house/connectors/home_assistant/cabin/exposure")).json() as { configured: boolean; exposedAreas: string[]; exposedEntities: string[] };
    expect(saved).toMatchObject({ configured: true, exposedAreas: ["k"], exposedEntities: ["light.b"] });
  });

  test("applyExposure keeps only exposed areas and entities; no list means everything", () => {
    const registry = { ok: true as const, areas: [{ id: "k", name: "Kitchen" }, { id: "g", name: "Garage" }], entities: [ent("light.a", "k"), ent("light.b", "g"), ent("light.c", null), ent("light.d", "g")] };
    expect(applyExposure("cabin", registry, null)).toEqual(registry);
    const out = applyExposure("cabin", registry, { areas: ["k"], entities: ["light.c"] });
    expect(out.entities.map((e) => e.id)).toEqual(["light.a", "light.c"]);
    expect(out.areas.map((a) => a.id)).toEqual(["k"]);
    expect(applyExposure("cabin", registry, { areas: [], entities: [] }).entities).toEqual([]);
  });

  test("nothing is written to the tool audit", async () => {
    const { client } = await owner();
    await client.post("/api/house/connectors/home_assistant", { label: "Main house", address: "http://192.168.2.20:8123", token: "t" });
    await client.post("/api/house/connectors/home_assistant", { label: "Cabin", address: "http://192.168.2.30:8123", token: "t" });
    await client.put("/api/house/connectors/home_assistant/cabin", { enabled: false });
    await client.delete("/api/house/connectors/home_assistant/cabin");
    expect(db.select().from(toolAudit).all()).toHaveLength(0);
  });
});
