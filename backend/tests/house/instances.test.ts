import { beforeEach, describe, expect, test } from "bun:test";
import { db } from "@/db";
import { grants } from "@/db/schema";
import { houseAccess, type EffectivePermission } from "@/lib/house/access";
import type { HouseArea, HouseEntity } from "@/lib/house/registry";
import { houseToolSpec, planHouseCall, runHouseTool, visibleHouseEntities, type HouseToolDeps } from "@/lib/house/tool";
import { effectivePermissions } from "@/lib/permissions";
import { normalizeGrantTarget, personIsGranted } from "@/lib/grants";
import type { PersonRow } from "@/types";
import { TestClient } from "../client";
import { resetDb } from "../reset-db";

const ent = (id: string, name: string, area: string, extra: Partial<HouseEntity> = {}): HouseEntity => ({ id, name, kind: "light", area, state: "off", sensitive: null, deviceClass: null, rgb: null, brightness: null, sceneMembers: null, ...extra });
const main = { instance: "default", instanceLabel: "Main house" };
const cabin = { instance: "cabin", instanceLabel: "Cabin" };
const areas: HouseArea[] = [{ id: "k", name: "Kitchen", instance: "default" }, { id: "k", name: "Kitchen", instance: "cabin" }];
const entities: HouseEntity[] = [
  ent("light.ceiling", "Ceiling", "k", main), ent("light.ceiling", "Ceiling", "k", cabin), ent("light.porch", "Porch", "k", cabin),
];
const owner = { id: "owner-1", role: "owner" } as PersonRow;

function setup(overrides: Partial<HouseToolDeps> = {}) {
  const performed: HouseEntity[] = [];
  const audits: unknown[] = [];
  const deps: HouseToolDeps = {
    loadRegistry: async () => ({ ok: true, areas, entities }),
    permissionsOf: () => [],
    perform: async (target) => { performed.push(target); return { ok: true, before: { state: "off", brightness: null, rgb: null, percentage: null, temperature: null }, after: { state: "on", brightness: 100, rgb: null, percentage: null, temperature: null }, undo: { name: "turn_off" } }; },
    brakeMode: () => "do", audit: (value) => audits.push(value), undo: () => ({ id: "undo-1", expiresAt: new Date().toISOString() }),
    ...overrides,
  };
  return { deps, performed, audits };
}
const said = (o: { result?: { reply?: { text?: string } }; userMessage?: string }): string => o.result?.reply?.text ?? o.userMessage ?? "";
const run = (args: Record<string, unknown>, deps: HouseToolDeps) => runHouseTool({ actor: owner, band: "adult", args, callId: "call-1", deps });

describe("one grant-target form", () => {
  test("an unprefixed target means the default instance; a prefix is split at the first slash only when it is a slug", () => {
    expect(normalizeGrantTarget("house.control:area:kitchen")).toBe("house.control:default/area:kitchen");
    expect(normalizeGrantTarget("house.control:default/area:kitchen")).toBe("house.control:default/area:kitchen");
    expect(normalizeGrantTarget("house.see:cabin/entity:light.a")).toBe("house.see:cabin/entity:light.a");
    expect(normalizeGrantTarget("house.see:Cabin/entity:light.a")).toBe("house.see:default/Cabin/entity:light.a");
    expect(normalizeGrantTarget("house.see:cabin/")).toBe("house.see:default/cabin/");
    expect(normalizeGrantTarget("house.server")).toBe("house.server");
    expect(normalizeGrantTarget("backups.run")).toBe("backups.run");
  });

  test("a prefixed deny beats an unprefixed allow, and the reverse", () => {
    const actor = { id: "p-1", role: "adult" as const, band: "adult" as const };
    const entity = ent("light.a", "A", "k");
    const allow = (action: string): EffectivePermission => ({ action, effect: "allow" });
    const deny = (action: string): EffectivePermission => ({ action, effect: "deny" });
    const level = "control" as const;
    expect(houseAccess({ actor, permissions: [allow("house.control:area:k"), deny("house.control:default/area:k")], entity, level }).allowed).toBe(false);
    expect(houseAccess({ actor, permissions: [allow("house.control:default/area:k"), deny("house.control:area:k")], entity, level }).allowed).toBe(false);
    expect(houseAccess({ actor, permissions: [allow("house.control:default/area:k")], entity, level }).allowed).toBe(true);
    expect(houseAccess({ actor, permissions: [allow("house.control:area:k")], entity, level }).allowed).toBe(true);
    // a grant on the default instance does not reach the same area id in another instance
    expect(houseAccess({ actor, permissions: [allow("house.control:area:k")], entity: { ...entity, instance: "cabin" }, level }).allowed).toBe(false);
    expect(houseAccess({ actor, permissions: [allow("house.control:cabin/area:k")], entity: { ...entity, instance: "cabin" }, level }).allowed).toBe(true);
  });

  describe("stored grants", () => {
    beforeEach(() => resetDb());
    async function person(): Promise<string> {
      const client = new TestClient();
      expect((await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" })).status).toBe(201);
      const res = await client.get("/api/people");
      return ((await res.json()) as Array<{ id: string }>)[0]!.id;
    }
    function put(id: string, person: string, action: string, effect: string): void {
      const now = "2026-11-06T00:00:00.000Z";
      db.insert(grants).values({ id, person, action, effect, grantedByPersonId: person, createdAt: now, updatedAt: now, hlc: "1:0:testnode" }).run();
    }
    test("personIsGranted and effectivePermissions treat both forms as one grant", async () => {
      const id = await person();
      put("grant-aaaaaa", id, "house.control:area:kitchen", "allow");
      put("grant-bbbbbb", id, "house.control:default/area:kitchen", "deny");
      expect(personIsGranted(id, "house.control:area:kitchen")).toBe(false);
      expect(personIsGranted(id, "house.control:default/area:kitchen")).toBe(false);
      expect(effectivePermissions(id)).toEqual([{ action: "house.control:default/area:kitchen", effect: "deny" }]);
      resetDb();
      const id2 = await person();
      put("grant-cccccc", id2, "house.see:default/area:kitchen", "allow");
      put("grant-dddddd", id2, "house.see:area:kitchen", "deny");
      expect(personIsGranted(id2, "house.see:area:kitchen")).toBe(false);
      expect(effectivePermissions(id2)).toEqual([{ action: "house.see:default/area:kitchen", effect: "deny" }]);
    });
  });
});

describe("the instance argument", () => {
  test("a one-instance household sees no instance argument", () => {
    const one = entities.filter((e) => e.instance === "cabin" ? false : true);
    const spec = houseToolSpec({ visible: one, areas });
    expect(JSON.stringify(spec)).not.toContain("instance");
    const plain = houseToolSpec({ visible: [ent("light.a", "A", "k")], areas });
    expect(JSON.stringify(plain)).not.toContain("instance");
  });

  test("a two-instance household sees it with a closed enum", () => {
    const spec = houseToolSpec({ visible: entities, areas });
    const props = (spec.args as { properties: Record<string, { enum?: string[] }> }).properties;
    expect(props.instance?.enum).toEqual(["cabin", "default"]);
  });

  test("an instance this speaker cannot see is not offered", () => {
    const only = visibleHouseEntities({ actor: { id: "p", role: "adult", band: "adult" }, permissions: [{ action: "house.see:default/area:k", effect: "allow" }], entities });
    expect(houseToolSpec({ visible: only, areas }).args).not.toHaveProperty("properties.instance");
  });

  test("the same name in two instances is refused, naming both labels", async () => {
    const s = setup();
    const out = await run({ action: "turn_on", targets: [{ name: "Ceiling" }] }, s.deps);
    expect(s.performed).toHaveLength(0);
    expect(said(out)).toContain("the Cabin one or the Main house one");
  });

  test("passing the instance resolves it, and the control goes to that instance's entity", async () => {
    const s = setup();
    await run({ action: "turn_on", instance: "cabin", targets: [{ name: "Ceiling" }] }, s.deps);
    expect(s.performed.map((e) => e.instance)).toEqual(["cabin"]);
  });

  test("a name that matches in one instance only resolves there without the argument", async () => {
    const s = setup();
    await run({ action: "turn_on", targets: [{ name: "Porch" }] }, s.deps);
    expect(s.performed.map((e) => e.instance)).toEqual(["cabin"]);
  });

  test("an unknown instance finds nothing", async () => {
    const s = setup();
    const out = await run({ action: "turn_on", instance: "garage", targets: [{ name: "Ceiling" }] }, s.deps);
    expect(s.performed).toHaveLength(0);
    expect(said(out)).toContain("could not find");
  });

  test("find without an instance searches all and rows carry the label; with an instance it narrows", async () => {
    const all = said(await run({ action: "find", targets: [{ area: "Kitchen" }] }, setup().deps));
    expect(all).toContain("Cabin");
    expect(all).toContain("Main house");
    const narrowed = said(await run({ action: "find", instance: "cabin", targets: [{ area: "Kitchen" }] }, setup().deps));
    expect(narrowed).toContain("Porch");
    expect(narrowed).not.toContain("Main house");
  });

  test("planHouseCall refuses the cross-instance name as ambiguous", () => {
    const plan = planHouseCall({ actor: owner, band: "adult", args: { action: "turn_on", targets: [{ name: "Ceiling" }] }, registry: { ok: true, areas, entities }, permissions: [], mode: "do" });
    expect(plan).toMatchObject({ kind: "refuse", reason: "ambiguous" });
  });

  test("audit calls from a two-instance run carry no slug, label or namespaced id", async () => {
    const s = setup();
    await run({ action: "turn_on", instance: "cabin", targets: [{ name: "Ceiling" }] }, s.deps);
    await run({ action: "find", targets: [{ area: "Kitchen" }] }, s.deps);
    expect(s.audits.length).toBeGreaterThan(0);
    const text = JSON.stringify(s.audits);
    for (const forbidden of ["cabin", "Cabin", "Main house", "default/", "light.ceiling"]) expect(text).not.toContain(forbidden);
  });
});

describe("server actions with several homes", () => {
  test("a restart without an instance is refused as ambiguous naming both homes; with one it asks and names it", async () => {
    const s = setup({ addons: async () => [], serverAction: async () => ({ ok: true }) } as never);
    const unnamed = await run({ action: "restart_core", targets: [] }, s.deps);
    expect(unnamed.status).not.toBe("succeeded");
    expect(said(unnamed)).toContain("Cabin");
    expect(said(unnamed)).toContain("Main house");
    const named = await run({ action: "restart_core", targets: [], instance: "cabin" }, s.deps);
    expect(said(named)).toContain("Cabin");
    expect(said(named)).toContain("cannot be undone");
  });

  test("the cooldown is per instance", async () => {
    const calls: unknown[] = [];
    const s = setup({ addons: async () => [], serverAction: async (...a: unknown[]) => { calls.push(a); return { ok: true }; } } as never);
    const go = (instance: string, id: string) => runHouseTool({ actor: owner, band: "adult", args: { action: "restart_core", targets: [], instance }, callId: id, approved: true, deps: s.deps });
    expect((await go("cabin", "resumed:a")).status).toBe("succeeded");
    expect((await go("cabin", "resumed:b")).failureKind).toBe("unavailable");
    expect((await go("lake", "resumed:c")).status).toBe("succeeded");
    expect(calls).toHaveLength(2);
  });
});
