import { describe, expect, test, beforeEach } from "bun:test";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { parseScope, assertCanAccessScope, resolveForResponse } from "@/lib/settings";
import { nextHlc, compareHlc, seedHlc, __resetHlcForTests } from "@/lib/hlc";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { people } from "@/db/schema";

beforeEach(() => {
  resetDb();
  __resetThrottleForTests();
});

async function ownerAndChild() {
  const owner = new TestClient();
  await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const created = await owner.post("/api/people", { displayName: "Bramble", role: "child" });
  const child = (await created.json()) as { id: string };
  const childClient = new TestClient();
  await childClient.post("/api/auth/select", { personId: child.id });
  return { owner, childClient, childId: child.id };
}

describe("GET /api/settings/registry", () => {
  test("requires auth", async () => {
    const res = await new TestClient().get("/api/settings/registry");
    expect(res.status).toBe(401);
  });

  test("returns the generated registry, including household.locale", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const res = await owner.get("/api/settings/registry");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ key: string }>;
    expect(body.some((k) => k.key === "household.locale")).toBe(true);
  });
});

describe("GET /api/settings (list)", () => {
  test("resolves the registry default when nothing is stored", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const res = await owner.get("/api/settings?scope=household");
    const body = (await res.json()) as Array<{ key: string; value: unknown; source: string }>;
    const locale = body.find((s) => s.key === "household.locale");
    expect(locale?.value).toBe("en-US");
    expect(locale?.source).toBe("default");
  });

  test("an invalid scope string is a clean 400", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const res = await owner.get("/api/settings?scope=not-a-real-scope");
    expect(res.status).toBe(400);
  });
});

describe("PUT /api/settings (write)", () => {
  test("owner can set a household value; list reflects it with source=user", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const put = await owner.request("/api/settings", {
      method: "PUT",
      body: { scope: "household", key: "household.locale", value: "en-GB" },
    });
    expect(put.status).toBe(200);

    const res = await owner.get("/api/settings?scope=household");
    const body = (await res.json()) as Array<{ key: string; value: unknown; source: string }>;
    const locale = body.find((s) => s.key === "household.locale");
    expect(locale?.value).toBe("en-GB");
    expect(locale?.source).toBe("user");
  });

  test("a non-owner/admin cannot set a household value", async () => {
    const { childClient } = await ownerAndChild();
    const res = await childClient.request("/api/settings", {
      method: "PUT",
      body: { scope: "household", key: "household.locale", value: "en-GB" },
    });
    expect(res.status).toBe(403);
  });

  test("an unknown key is refused", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const res = await owner.request("/api/settings", {
      method: "PUT",
      body: { scope: "household", key: "household.not_a_real_key", value: "x" },
    });
    expect(res.status).toBe(400);
  });

  test("a value outside the select's options is refused", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const res = await owner.request("/api/settings", {
      method: "PUT",
      body: { scope: "household", key: "household.locale", value: "fr-FR" },
    });
    expect(res.status).toBe(400);
  });

  test("a scope/key mismatch (household key written under a person scope) is refused", async () => {
    const owner = new TestClient();
    const { person } = (await (
      await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" })
    ).json()) as { person: { id: string } };
    const res = await owner.request("/api/settings", {
      method: "PUT",
      body: { scope: `person:${person.id}`, key: "household.locale", value: "en-GB" },
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/settings/reset", () => {
  test("resets a value back to the registry default", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    await owner.request("/api/settings", {
      method: "PUT",
      body: { scope: "household", key: "household.locale", value: "en-GB" },
    });

    const reset = await owner.post("/api/settings/reset", { scope: "household", key: "household.locale" });
    expect(reset.status).toBe(200);

    const res = await owner.get("/api/settings?scope=household");
    const body = (await res.json()) as Array<{ key: string; value: unknown; source: string }>;
    const locale = body.find((s) => s.key === "household.locale");
    expect(locale?.value).toBe("en-US");
    expect(locale?.source).toBe("default");
  });
});

describe("parseScope", () => {
  test("parses household, person, and device scopes", () => {
    expect(parseScope("household")).toEqual({ kind: "household", id: null });
    expect(parseScope("person:person-abc123")).toEqual({ kind: "person", id: "person-abc123" });
    expect(parseScope("device:device-xyz")).toEqual({ kind: "device", id: "device-xyz" });
  });

  test("rejects a malformed scope", () => {
    expect(parseScope("nonsense")).toBeNull();
    expect(parseScope("person:")).toBeNull();
    expect(parseScope("PERSON:abc")).toBeNull();
  });
});

describe("assertCanAccessScope (person and device scope authorization)", () => {
  test("a person can always access their own person-scope settings", async () => {
    const now = new Date().toISOString();
    const id = "person-selftest1";
    db.insert(people)
      .values({ id, displayName: "X", role: "adult", avatarSeed: id, source: "hub", createdAt: now, updatedAt: now })
      .run();
    const actor = db.select().from(people).where(eq(people.id, id)).get()!;
    const result = assertCanAccessScope(actor, { kind: "person", id }, "write");
    expect(result.ok).toBe(true);
  });

  test("owner/admin cannot read or write an adult's person-scope settings", async () => {
    const now = new Date().toISOString();
    const ownerId = "person-ownertest1";
    const adultId = "person-adulttest1";
    db.insert(people)
      .values([
        { id: ownerId, displayName: "Owner", role: "owner", avatarSeed: ownerId, source: "hub", createdAt: now, updatedAt: now },
        { id: adultId, displayName: "Adult", role: "adult", avatarSeed: adultId, source: "hub", createdAt: now, updatedAt: now },
      ])
      .run();
    const owner = db.select().from(people).where(eq(people.id, ownerId)).get()!;
    const write = assertCanAccessScope(owner, { kind: "person", id: adultId }, "write");
    const read = assertCanAccessScope(owner, { kind: "person", id: adultId }, "read");
    expect(write.ok).toBe(false);
    expect(read.ok).toBe(false);
  });

  test("owner/admin CAN access a child's person-scope settings", async () => {
    const now = new Date().toISOString();
    const ownerId = "person-ownertest2";
    const childId = "person-childtest1";
    db.insert(people)
      .values([
        { id: ownerId, displayName: "Owner", role: "owner", avatarSeed: ownerId, source: "hub", createdAt: now, updatedAt: now },
        { id: childId, displayName: "Child", role: "child", avatarSeed: childId, source: "hub", createdAt: now, updatedAt: now },
      ])
      .run();
    const owner = db.select().from(people).where(eq(people.id, ownerId)).get()!;
    const result = assertCanAccessScope(owner, { kind: "person", id: childId }, "write");
    expect(result.ok).toBe(true);
  });

  test("device scope is owner/admin only, provisionally", async () => {
    const now = new Date().toISOString();
    const adultId = "person-devicetest1";
    db.insert(people)
      .values({ id: adultId, displayName: "Adult", role: "adult", avatarSeed: adultId, source: "hub", createdAt: now, updatedAt: now })
      .run();
    const adult = db.select().from(people).where(eq(people.id, adultId)).get()!;
    const result = assertCanAccessScope(adult, { kind: "device", id: "device-1" }, "read");
    expect(result.ok).toBe(false);
  });
});

describe("HLC (hybrid logical clock)", () => {
  beforeEach(() => __resetHlcForTests());

  test("matches the spec's hlc pattern", () => {
    expect(nextHlc()).toMatch(/^[0-9]+:[0-9]+:[a-z0-9]{6,}$/);
  });

  test("consecutive calls are strictly increasing per compareHlc", () => {
    const a = nextHlc();
    const b = nextHlc();
    const c = nextHlc();
    expect(compareHlc(b, a)).toBeGreaterThan(0);
    expect(compareHlc(c, b)).toBeGreaterThan(0);
  });

  test("compareHlc is consistent (equal, greater, less)", () => {
    const a = nextHlc();
    expect(compareHlc(a, a)).toBe(0);
    const b = nextHlc();
    expect(compareHlc(a, b)).toBeLessThan(0);
    expect(compareHlc(b, a)).toBeGreaterThan(0);
  });
});

describe("resolveForResponse (secret redaction)", () => {
  const secretKey = {
    key: "test.api_key",
    scope: "household" as const,
    selector: "text" as const,
    default: null,
    label: "Test API key",
    level: "advanced" as const,
    secret: true,
    lives_in: "test",
    honoured_by: ["home"] as ("home" | "bot")[],
  };
  const normalKey = { ...secretKey, key: "test.plain", secret: false };

  test("a secret key's real value never appears in the response", () => {
    const resolved = resolveForResponse(secretKey, "sk-super-secret-value", "user");
    expect(resolved.value).toBeNull();
    expect(JSON.stringify(resolved)).not.toContain("sk-super-secret-value");
  });

  test("a secret key reports isSet without revealing the value", () => {
    const unset = resolveForResponse(secretKey, null, "default");
    const set = resolveForResponse(secretKey, "sk-super-secret-value", "user");
    expect(unset.isSet).toBe(false);
    expect(set.isSet).toBe(true);
  });

  test("a non-secret key's value passes through untouched", () => {
    const resolved = resolveForResponse(normalKey, "en-US", "default");
    expect(resolved.value).toBe("en-US");
    expect(resolved.isSet).toBeUndefined();
  });
});

describe("HLC recovery across a restart", () => {
  beforeEach(() => __resetHlcForTests());

  test("seedHlc prevents a freshly generated hlc from regressing behind a known one", () => {
    // Simulate: a prior process wrote hlc "9999999999999:5:abc123", then
    // this process starts fresh (reset to 0) with, say, a regressed
    // system clock. Without seeding, nextHlc() would generate something
    // smaller than the already-persisted value.
    const knownHlc = "9999999999999:5:abc123";
    seedHlc(knownHlc);
    const fresh = nextHlc();
    expect(compareHlc(fresh, knownHlc)).toBeGreaterThan(0);
  });

  test("seedHlc with an older value never regresses the clock backward", () => {
    const a = nextHlc();
    seedHlc("1:0:zzzzzz"); // deliberately tiny
    const b = nextHlc();
    expect(compareHlc(b, a)).toBeGreaterThan(0);
  });
});
