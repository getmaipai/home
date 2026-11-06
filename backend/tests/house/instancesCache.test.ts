import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { db } from "@/db";
import { integrations } from "@/db/schema";
import { __setHouseRegistryCacheDepsForTests, clearHouseRegistry, loadHouseRegistries, loadHouseRegistry } from "@/lib/house/cache";
import { resetDb } from "../reset-db";

const stamp = "2026-11-06T00:00:00.000Z";
function add(instance: string, label: string, address: string): void {
  db.insert(integrations).values({ id: `integ-${instance}`, type: "home_assistant", instance, label, address, credentialRef: `cred.${instance}`, enabled: true, provenance: "admin", createdAt: stamp, updatedAt: stamp, hlc: "1:0:testnode" }).run();
}
const row = (id: string) => [{ id, name: id, state: "off", area: "", dc: "", rgb: [], bri: 0, ents: [] }];

describe("per-instance registry cache with two fake servers", () => {
  beforeEach(() => resetDb());
  afterEach(() => clearHouseRegistry());

  test("each instance is cached on its own and the merge marks every entity with its instance", async () => {
    add("main", "Main house", "http://192.168.1.20:8123");
    add("cabin", "Cabin", "http://192.168.2.30:8123");
    const hosts: string[] = [];
    __setHouseRegistryCacheDepsForTests({
      read: (key) => key.startsWith("cred.") ? "tok" : undefined,
      fetch: async (url, init) => {
        hosts.push(new URL(url).hostname);
        const template = JSON.parse(String(init.body)).template as string;
        if (!template.includes("states")) return new Response("[]");
        return new Response(JSON.stringify(row(url.includes("192.168.2.30") ? "light.cabin_lamp" : "light.main_lamp")));
      },
    });
    const one = await loadHouseRegistry("cabin");
    expect(one.ok && one.entities.map((e) => e.id)).toEqual(["light.cabin_lamp"]);
    expect(new Set(hosts)).toEqual(new Set(["192.168.2.30"]));
    const both = await loadHouseRegistries();
    expect(both.ok && both.entities.map((e) => [e.id, e.instance, e.instanceLabel])).toEqual([["light.cabin_lamp", "cabin", "Cabin"], ["light.main_lamp", "main", "Main house"]]);
  });
});
