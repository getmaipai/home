import { describe, expect, test } from "bun:test";
import { houseUndoRunner, undoDataIsSafe } from "@/lib/house/undoRunner";
import { clearHouseRegistry, __setHouseRegistryCacheDepsForTests, warmHouseRegistry } from "@/lib/house/cache";
import { createBenchPeople } from "../../scripts/bench/conversationRunner";
import { setHouseholdSettingValue } from "@/lib/settings";
import { resetDb } from "../reset-db";
import type { PersonRow } from "@/types";

function setRegistry() {
  __setHouseRegistryCacheDepsForTests({ read: (key) => key === "home.base_url" ? "http://192.168.1.20:8123" : "token", fetch: async (_url, init) => new Response(JSON.stringify(JSON.parse(String(init.body)).template.includes("states") ? [{ id: "light.kitchen", name: "Kitchen", state: "off", area: "k", dc: "", rgb: [], bri: 0, ents: [] }] : [{ id: "k", name: "Kitchen" }])) });
  warmHouseRegistry();
}

describe("house undo runner", () => {
  test("is exported", () => expect(typeof houseUndoRunner).toBe("function"));
  test("posts only a closed and currently accessible registered service", async () => {
    resetDb();
    const people = createBenchPeople();
    const calls: string[] = [];
    clearHouseRegistry(); setRegistry();
    setHouseholdSettingValue("home.base_url", "http://192.168.1.20:8123");
    setHouseholdSettingValue("home.access_token", "token");
    // Replace fetch after registry warming: calls are captured by the scoped LAN fetch.
    __setHouseRegistryCacheDepsForTests({ read: (key) => key === "home.base_url" ? "http://192.168.1.20:8123" : "token", fetch: async (url, init) => { calls.push(url); return new Response(JSON.stringify(JSON.parse(String(init.body)).template.includes("states") ? [{ id: "light.kitchen", name: "Kitchen", state: "off", area: "k", dc: "", rgb: [], bri: 0, ents: [] }] : [{ id: "k", name: "Kitchen" }])); } });
    clearHouseRegistry(); setRegistry();
    for (let i = 0; i < 20; i++) { await new Promise((r) => setTimeout(r, 2)); if (calls.length >= 2) break; }
    const runner = houseUndoRunner(people.owner, { connection: () => ({ ok: true, token: "token", host: "192.168.1.20", port: 8123, lanFetch: async (url) => { calls.push(url); return { ok: true, status: 200, text: "", truncated: false }; } }) });
    expect(await runner("light", "turn_off", { entity_id: "light.kitchen" })).toBe(true);
    expect(await runner("light", "delete", { entity_id: "light.kitchen" })).toBe(false);
    expect(calls.at(-1)).toContain("/api/services/light/turn_off");
  });
  test("refuses an actor without control access", async () => {
    resetDb(); const people = createBenchPeople(); clearHouseRegistry(); setRegistry();
    setHouseholdSettingValue("home.base_url", "http://192.168.1.20:8123"); setHouseholdSettingValue("home.access_token", "token");
    await new Promise((r) => setTimeout(r, 10));
    expect(await houseUndoRunner({ id: "outsider", role: "adult" } as PersonRow)("light", "turn_off", { entity_id: "light.kitchen" })).toBe(false);
  });

  test("stored brightness and colour inverses are accepted, anything else is not", () => {
    expect(undoDataIsSafe({ entity_id: "light.kitchen", brightness_pct: 40 })).toBe(true);
    expect(undoDataIsSafe({ entity_id: "light.kitchen", rgb_color: [1, 2, 3] })).toBe(true);
    expect(undoDataIsSafe({ entity_id: "light.kitchen", brightness_pct: 0 })).toBe(false);
    expect(undoDataIsSafe({ entity_id: "light.kitchen", brightness_pct: 101 })).toBe(false);
    expect(undoDataIsSafe({ entity_id: "light.kitchen", rgb_color: [1, 2, 256] })).toBe(false);
    expect(undoDataIsSafe({ entity_id: "light.kitchen", rgb_color: [1, 2] })).toBe(false);
    expect(undoDataIsSafe({ entity_id: "light.kitchen", brightness_pct: 40, extra: "x" })).toBe(false);
    expect(undoDataIsSafe({ entity_id: "light.kitchen", temperature: 99 })).toBe(false);
  });
});

