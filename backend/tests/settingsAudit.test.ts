import { beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { db } from "@/db";
import { settingsChanges } from "@/db/schema";
import { getRegistry } from "@/lib/settingsRegistry";
import { directionFor, isSafetyRelevantKey, SAFETY_RELEVANT_KEYS, SAFETY_RELEVANT_PREFIXES } from "@/settings/safetyRelevantKeys";

beforeEach(() => {
  resetDb();
  __resetThrottleForTests();
});

const rows = () => db.select().from(settingsChanges).all();

async function household() {
  const owner = new TestClient();
  await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const mk = async (displayName: string, role: string, secret?: string) =>
    (await (await owner.post("/api/people", { displayName, role, ...(secret ? { secret } : {}) })).json()) as { id: string };
  const admin = await mk("Alfred", "admin", "adminsecret");
  const adminClient = new TestClient();
  await adminClient.post("/api/auth/verify-secret", { personId: admin.id, secret: "adminsecret" });
  const child = await mk("Bramble", "child");
  const teen = await mk("Marlow", "teen");
  const teenClient = new TestClient();
  await teenClient.post("/api/auth/select", { personId: teen.id });
  return { owner, adminClient, teenClient, child, teen };
}

describe("safety-relevant keys", () => {
  test("every registry key with a band layer is safety-relevant", () => {
    const banded = getRegistry().filter((k) => k.layers?.includes("band"));
    expect(banded.length).toBeGreaterThan(0);
    for (const k of banded) expect(isSafetyRelevantKey(k.key, k)).toBe(true);
  });

  test("every listed key resolves in the registry, or is ahead of the spec, or sits under a listed prefix", () => {
    const declared = new Set(getRegistry().map((k) => k.key));
    const ahead = new Set<string>(JSON.parse(readFileSync(join(import.meta.dir, "../../scripts/settings-ahead-of-spec.json"), "utf8")));
    for (const key of SAFETY_RELEVANT_KEYS) {
      const ok = declared.has(key) || ahead.has(key) || SAFETY_RELEVANT_PREFIXES.some((p) => key.startsWith(p));
      expect({ key, ok }).toEqual({ key, ok: true });
    }
  });

  test("an unrelated key is not safety-relevant", () => {
    expect(isSafetyRelevantKey("status.internet_probe.dns_name", getRegistry().find((k) => k.key === "status.internet_probe.dns_name"))).toBe(false);
  });

  test("direction table", () => {
    for (const key of ["search.web.child_mode", "search.web.teen_mode", "generation.kids", "generation.kid_enabled", "generation.video.enabled", "generation.music.enabled", "companions.allowed", "talent.minors.make", "search.ddgs.minors"]) {
      expect([key, directionFor(key, false, true)]).toEqual([key, "widens"]);
      expect([key, directionFor(key, true, false)]).toEqual([key, "narrows"]);
    }
    expect(directionFor("search.web.child_mode", "off", "on")).toBe("widens");
    expect(directionFor("search.web.teen_mode", "on", "off")).toBe("narrows");
    expect(directionFor("search.ddgs.minors", "off", "teens")).toBe("widens");
    expect(directionFor("search.ddgs.minors", "teens_and_children", "teens")).toBe("narrows");
    for (const key of ["media.allowlist_only", "search.page_text_cleaning"]) {
      expect(directionFor(key, false, true)).toBe("narrows");
      expect(directionFor(key, true, false)).toBe("widens");
    }
    expect(directionFor("search.safe_search", "strict", "moderate")).toBe("widens");
    expect(directionFor("search.safe_search", "moderate", "off")).toBe("widens");
    expect(directionFor("search.safe_search", "off", "strict")).toBe("narrows");
    for (const key of ["search.blocklists", "search.blocklists.child", "search.hosts.deny", "content.filters"]) {
      expect(directionFor(key, ["a", "b"], ["a"])).toBe("widens");
      expect(directionFor(key, ["a"], ["a", "b"])).toBe("narrows");
    }
    for (const key of ["search.hosts.allow"]) {
      expect(directionFor(key, ["a", "b"], ["a"])).toBe("narrows");
      expect(directionFor(key, ["a"], ["a", "b"])).toBe("widens");
    }
    expect(directionFor("search.blocklists", null, { add: ["x"], remove: [] })).toBe("narrows");
    expect(directionFor("status.internet_probe.dns_name", "a", "b")).toBe("changes");
  });
});

describe("settings change record", () => {
  test("an owner write of search.web.child_mode records one widening household row", async () => {
    const { owner } = await household();
    const put = await owner.request("/api/settings", { method: "PUT", body: { scope: "household", key: "search.web.child_mode", value: "on" } });
    expect(put.status).toBe(200);
    const all = rows();
    expect(all.length).toBe(1);
    expect(all[0]).toMatchObject({ key: "search.web.child_mode", scope: "household", actorRole: "owner", direction: "widens" });
    expect(JSON.parse(all[0]!.value)).toBe("on");
  });

  test("an admin write of a child's safe search records a person row that names no one", async () => {
    const { adminClient, child } = await household();
    // An admin may only keep a child at strict (a looser level is refused), so the order is unknown here: "changes".
    const put = await adminClient.request("/api/settings", { method: "PUT", body: { scope: `person:${child.id}`, key: "search.safe_search", value: "strict" } });
    expect(put.status).toBe(200);
    const all = rows();
    expect(all.length).toBe(1);
    expect(all[0]).toMatchObject({ scope: "person", actorRole: "admin", direction: "changes" });
    expect(JSON.stringify(all[0])).not.toContain(child.id);
    expect(Object.keys(all[0]!).some((k) => /person|name/i.test(k))).toBe(false);
  });

  test("an owner loosening safe search for their own person layer records a widening person row", async () => {
    const { owner } = await household();
    const me = (await (await owner.get("/api/auth/me")).json()) as { id: string };
    await owner.request("/api/settings", { method: "PUT", body: { scope: `person:${me.id}`, key: "search.safe_search", value: "strict" } });
    const put = await owner.request("/api/settings", { method: "PUT", body: { scope: `person:${me.id}`, key: "search.safe_search", value: "moderate" } });
    expect(put.status).toBe(200);
    const last = rows().find((r) => r.value === '"moderate"')!;
    expect(last).toMatchObject({ scope: "person", actorRole: "owner", direction: "widens", previous: '"strict"' });
    expect(JSON.stringify(last)).not.toContain(me.id);
  });

  test("refused writes and a teen's own allowed write record nothing", async () => {
    const { owner, teenClient, child, teen } = await household();
    const other = await teenClient.request("/api/settings", { method: "PUT", body: { scope: `person:${child.id}`, key: "search.safe_search", value: "strict" } });
    expect(other.status).toBe(403);
    const invalid = await owner.request("/api/settings", { method: "PUT", body: { scope: "household", key: "search.web.child_mode", value: "nonsense" } });
    expect(invalid.status).toBe(400);
    const own = await teenClient.request("/api/settings", { method: "PUT", body: { scope: `person:${teen.id}`, key: "search.safe_search", value: "strict" } });
    expect(own.status).toBe(200);
    expect(rows().length).toBe(0);
  });

  test("a reset records a null value with the previous value", async () => {
    const { owner } = await household();
    await owner.request("/api/settings", { method: "PUT", body: { scope: "household", key: "search.web.child_mode", value: "on" } });
    const reset = await owner.post("/api/settings/reset", { scope: "household", key: "search.web.child_mode" });
    expect(reset.status).toBe(200);
    const all = rows();
    expect(all.length).toBe(2);
    const last = all.find((r) => r.value === "null")!;
    expect(last).toBeDefined();
    expect(last.previous).toBe("\"on\"");
  });

  test("back to defaults for a child's site blocks records a person row with a null value and no person", async () => {
    const { owner, child } = await household();
    const { changeOverrides, backToUserDefaults } = await import("@/lib/settingsLayers");
    const { db: database } = await import("@/db");
    const { people } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const actor = database.select().from(people).where(eq(people.role, "owner")).get()!;
    const added = changeOverrides(actor as never, child.id, "search.hosts.deny", { add: ["example.com"] });
    expect(added.ok).toBe(true);
    expect(rows().length).toBe(1);
    const cleared = backToUserDefaults(actor as never, child.id, ["search.hosts.deny"]);
    expect(cleared.ok).toBe(true);
    const all = rows();
    expect(all.length).toBe(2);
    const reset = all.find((r) => r.value === "null")!;
    expect(reset).toMatchObject({ key: "search.hosts.deny", scope: "person", actorRole: "owner", previous: null });
    expect(JSON.stringify(all)).not.toContain(child.id);
  });

  test("an unrelated key records nothing", async () => {
    const { owner } = await household();
    const put = await owner.request("/api/settings", { method: "PUT", body: { scope: "household", key: "status.internet_probe.dns_name", value: "example.org" } });
    expect(put.status).toBe(200);
    expect(rows().length).toBe(0);
  });

  test("the list is closed to a teen and newest first for an admin", async () => {
    const { owner, adminClient, teenClient } = await household();
    await owner.request("/api/settings", { method: "PUT", body: { scope: "household", key: "search.web.child_mode", value: "on" } });
    await new Promise((r) => setTimeout(r, 5));
    await owner.request("/api/settings", { method: "PUT", body: { scope: "household", key: "search.web.teen_mode", value: "on" } });
    expect((await teenClient.get("/api/settings/changes")).status).toBe(403);
    const res = await adminClient.get("/api/settings/changes?limit=10");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { changes: { key: string }[] };
    expect(body.changes.map((c) => c.key)).toEqual(["search.web.teen_mode", "search.web.child_mode"]);
  });
});
