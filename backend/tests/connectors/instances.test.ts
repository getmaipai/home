import { beforeEach, describe, expect, test } from "bun:test";
import { db } from "@/db";
import { integrations } from "@/db/schema";
import { instanceLanFetch, listInstances, resolveInstance } from "@/lib/connectors/instances";
import { houseLanFetch } from "@/lib/house/connection";
import { resetDb } from "../reset-db";

beforeEach(() => resetDb());

const stamp = "2026-11-06T00:00:00.000Z";
function addInstance(instance: string, label: string, address: string, extra: Partial<typeof integrations.$inferInsert> = {}, type = "home_assistant"): void {
  db.insert(integrations).values({ id: `integ-${type}-${instance}`, type, instance, label, address, credentialRef: `cred.${instance}`, enabled: true, deletedAt: null, provenance: "admin", createdAt: stamp, updatedAt: stamp, hlc: "1:0:testnode", ...extra }).run();
}
const settings = (values: Record<string, unknown>) => (key: string) => values[key];

describe("connector instances", () => {
  test("with no record, the settings keys read through as the default instance", () => {
    const read = settings({ "home.base_url": "http://192.168.1.20:8123", "home.access_token": "tok-default" });
    expect(listInstances("home_assistant", { read })).toEqual([{ type: "home_assistant", instance: "default", label: "Home", address: "http://192.168.1.20:8123", credentialRef: "home.access_token", virtual: true }]);
    const connection = houseLanFetch({ read });
    expect(connection).toMatchObject({ ok: true, host: "192.168.1.20", port: 8123, token: "tok-default" });
  });

  test("a type other than Home Assistant has no virtual default", () => {
    expect(listInstances("uptime_kuma", { read: settings({}) })).toEqual([]);
  });

  test("two instances list sorted by label and skip disabled and removed ones", () => {
    addInstance("main", "Main house", "http://192.168.1.20:8123");
    addInstance("cabin", "Cabin", "http://192.168.2.30:8123");
    addInstance("old", "Barn", "http://192.168.3.40:8123", { deletedAt: stamp });
    addInstance("off", "Attic", "http://192.168.4.50:8123", { enabled: false });
    expect(listInstances("home_assistant").map((item) => [item.instance, item.label])).toEqual([["cabin", "Cabin"], ["main", "Main house"]]);
  });

  test("a removed slug stays taken: the default is not offered again once any record exists", () => {
    addInstance("old", "Barn", "http://192.168.3.40:8123", { deletedAt: stamp });
    expect(listInstances("home_assistant", { read: settings({ "home.base_url": "http://192.168.1.20:8123" }) })).toEqual([]);
  });

  test("resolve by slug, and the default when no slug is given", () => {
    addInstance("default", "Home", "http://192.168.1.20:8123");
    addInstance("cabin", "Cabin", "http://192.168.2.30:8123");
    expect(resolveInstance("home_assistant", "cabin")?.label).toBe("Cabin");
    expect(resolveInstance("home_assistant")?.instance).toBe("default");
    expect(resolveInstance("home_assistant", "nope")).toBeNull();
  });

  test("each instance fetches only its own host and port, with its own token", async () => {
    addInstance("main", "Main house", "http://192.168.1.20:8123");
    addInstance("cabin", "Cabin", "http://192.168.2.30:8200");
    const seen: Array<{ url: string }> = [];
    const fetch = async (input: string) => { seen.push({ url: input }); return new Response("[]"); };
    const read = settings({ "cred.main": "tok-main", "cred.cabin": "tok-cabin" });
    const cabin = instanceLanFetch(resolveInstance("home_assistant", "cabin")!, { read, fetch });
    expect(cabin).toMatchObject({ ok: true, host: "192.168.2.30", port: 8200, token: "tok-cabin" });
    if (cabin.ok) await cabin.lanFetch("/api/states");
    expect(seen[0]!.url.startsWith("http://192.168.2.30:8200/")).toBe(true);
    const main = instanceLanFetch(resolveInstance("home_assistant", "main")!, { read, fetch });
    expect(main).toMatchObject({ ok: true, host: "192.168.1.20", port: 8123, token: "tok-main" });
  });

  test("failures are plain and never carry the token", () => {
    addInstance("cabin", "Cabin", "http://8.8.8.8:8123");
    addInstance("bare", "Bare", "");
    const read = settings({ "cred.cabin": "tok-secret" });
    const bad = instanceLanFetch(resolveInstance("home_assistant", "cabin")!, { read });
    expect(bad).toMatchObject({ ok: false, reason: "bad_address" });
    expect(instanceLanFetch(resolveInstance("home_assistant", "bare")!, { read })).toMatchObject({ ok: false, reason: "not_set" });
    expect(JSON.stringify(bad)).not.toContain("tok-secret");
    addInstance("notoken", "No token", "http://192.168.5.5:8123");
    expect(instanceLanFetch(resolveInstance("home_assistant", "notoken")!, { read })).toMatchObject({ ok: false, reason: "no_token" });
  });
});
