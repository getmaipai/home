import { describe, expect, test } from "bun:test";
import { clearHouseRegistry, peekHouseRegistry, warmHouseRegistry, __setHouseRegistryCacheDepsForTests } from "@/lib/house/cache";

describe("house registry cache", () => {
  test("cold peek is empty and warm refreshes in the background", async () => {
    clearHouseRegistry();
    const calls: string[] = [];
    __setHouseRegistryCacheDepsForTests({ read: (key) => key === "home.base_url" ? "http://192.168.1.20:8123" : "token", fetch: async (_url, init) => { calls.push(String(init.body)); const template = JSON.parse(String(init.body)).template; return new Response(template.includes("states") ? JSON.stringify([{ id: "light.a", name: "A", state: "off", area: "", dc: "", rgb: [], bri: 0, ents: [] }]) : "[]"); } });
    expect(peekHouseRegistry()).toBeNull();
    warmHouseRegistry();
    for (let i = 0; i < 20 && !peekHouseRegistry(); i++) await new Promise((resolve) => setTimeout(resolve, 5));
    expect(peekHouseRegistry()?.entities.map((entity) => entity.id)).toEqual(["light.a"]);
    expect(calls).toHaveLength(2);
    clearHouseRegistry();
  });
});
