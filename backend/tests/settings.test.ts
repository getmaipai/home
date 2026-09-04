import { describe, expect, test, beforeEach } from "bun:test";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import {
  parseScope,
  assertCanAccessScope,
  resolveForResponse,
  getPersonSettingValue,
  getHouseholdSettingValue,
  setHouseholdSettingValue,
} from "@/lib/settings";
import { nextHlc, compareHlc, seedHlc, __resetHlcForTests } from "@/lib/hlc";
import { eq, and } from "drizzle-orm";
import { db } from "@/db";
import { people, settingsValues } from "@/db/schema";

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
  // getPersonSettingValue() takes the actor's real row (2026-09-04, a
  // code review closing off the id-substitution footgun the old
  // bare-personId signature allowed), not just its id.
  const childPerson = db.select().from(people).where(eq(people.id, child.id)).get()!;
  return { owner, childClient, childId: child.id, childPerson };
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

// tts.voice_id (2026-09-04, "per user selection of voice") is the
// registry's first real person-scope key - settings.ts's parseScope/
// assertCanAccessScope person branches existed but had nothing to
// exercise them through the HTTP layer until this key was declared.
describe("PUT /api/settings for tts.voice_id (the registry's first real person-scope key)", () => {
  test("a person can set their own voice; list reflects it with source=user", async () => {
    const { childClient, childId } = await ownerAndChild();
    const put = await childClient.request("/api/settings", {
      method: "PUT",
      body: { scope: `person:${childId}`, key: "tts.voice_id", value: "vera" },
    });
    expect(put.status).toBe(200);

    const res = await childClient.get(`/api/settings?scope=person:${childId}`);
    const body = (await res.json()) as Array<{ key: string; value: unknown; source: string }>;
    const voice = body.find((s) => s.key === "tts.voice_id");
    expect(voice?.value).toBe("vera");
    expect(voice?.source).toBe("user");
  });

  test("resolves to the registry default (alba) when nothing is stored", async () => {
    const { childClient, childId } = await ownerAndChild();
    const res = await childClient.get(`/api/settings?scope=person:${childId}`);
    const body = (await res.json()) as Array<{ key: string; value: unknown; source: string }>;
    const voice = body.find((s) => s.key === "tts.voice_id");
    expect(voice?.value).toBe("alba");
    expect(voice?.source).toBe("default");
  });

  test("an owner can set a child's voice on the child's behalf", async () => {
    const { owner, childId } = await ownerAndChild();
    const put = await owner.request("/api/settings", {
      method: "PUT",
      body: { scope: `person:${childId}`, key: "tts.voice_id", value: "jean" },
    });
    expect(put.status).toBe(200);
  });

  test("a value outside Pocket TTS's known preset names is refused", async () => {
    const { childClient, childId } = await ownerAndChild();
    const res = await childClient.request("/api/settings", {
      method: "PUT",
      body: { scope: `person:${childId}`, key: "tts.voice_id", value: "not-a-real-voice" },
    });
    expect(res.status).toBe(400);
  });

  test("a person cannot set another person's voice", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const created = await owner.post("/api/people", { displayName: "Bramble", role: "child" });
    const { id: childId } = (await created.json()) as { id: string };
    const created2 = await owner.post("/api/people", { displayName: "Marlow", role: "child" });
    const { id: otherChildId } = (await created2.json()) as { id: string };
    const childClient = new TestClient();
    await childClient.post("/api/auth/select", { personId: childId });

    const res = await childClient.request("/api/settings", {
      method: "PUT",
      body: { scope: `person:${otherChildId}`, key: "tts.voice_id", value: "vera" },
    });
    expect(res.status).toBe(403);
  });
});

describe("lib/settings.ts getPersonSettingValue()", () => {
  test("resolves the registry default when nothing is stored", async () => {
    const { childPerson } = await ownerAndChild();
    expect(getPersonSettingValue(childPerson, "tts.voice_id")).toBe("alba");
  });

  test("resolves a stored value once one exists", async () => {
    const { childClient, childId, childPerson } = await ownerAndChild();
    await childClient.request("/api/settings", {
      method: "PUT",
      body: { scope: `person:${childId}`, key: "tts.voice_id", value: "estelle" },
    });
    expect(getPersonSettingValue(childPerson, "tts.voice_id")).toBe("estelle");
  });

  test("returns undefined for an unknown key", async () => {
    const { childPerson } = await ownerAndChild();
    expect(getPersonSettingValue(childPerson, "not.a.real_key")).toBeUndefined();
  });

  test("returns undefined for a household-scope key (wrong scope for this getter)", async () => {
    const { childPerson } = await ownerAndChild();
    expect(getPersonSettingValue(childPerson, "household.locale")).toBeUndefined();
  });

  // The whole point of the actor-shaped signature (2026-09-04): there is
  // no personId parameter left to mis-supply. This isn't really testable
  // as a runtime "wrong behavior" case the old signature would have
  // gotten wrong - it's a type-level guarantee - but this at least proves
  // two different actors resolve two different, correctly-isolated rows.
  test("two different people's own values never cross-contaminate", async () => {
    const { owner, childClient, childId, childPerson } = await ownerAndChild();
    const ownerPerson = db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
    await owner.request("/api/settings", {
      method: "PUT",
      body: { scope: `person:${ownerPerson.id}`, key: "tts.voice_id", value: "jean" },
    });
    await childClient.request("/api/settings", {
      method: "PUT",
      body: { scope: `person:${childId}`, key: "tts.voice_id", value: "estelle" },
    });
    expect(getPersonSettingValue(ownerPerson, "tts.voice_id")).toBe("jean");
    expect(getPersonSettingValue(childPerson, "tts.voice_id")).toBe("estelle");
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
    // A code review (2026-09-04) found this returned only {success: true},
    // forcing every caller into a second round trip just to learn the
    // value it already knew was the registry default; now symmetric with
    // PUT's ResolvedSetting response, with `success` kept alongside (a
    // second review found dropping it outright repurposed a field under
    // CLAUDE.md > Compatibility's additive-only rule).
    const resetBody = (await reset.json()) as { key: string; value: unknown; source: string; success: boolean };
    expect(resetBody.value).toBe("en-US");
    expect(resetBody.source).toBe("default");
    expect(resetBody.success).toBe(true);

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

// voice.hf_token (2026-09-04) is the registry's first real `secret: true`
// key - `.github/CLAUDE.md` > Credentials and secrets' hard rule that a
// reversible secret is "never plaintext in a table" had nothing to
// exercise it through the real settings store until now.
describe("secret: true settings keys are encrypted at rest", () => {
  test("the real database row is never the plaintext value", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const plain = "hf_aVeryRealLookingToken1234567890";
    const put = await owner.request("/api/settings", {
      method: "PUT",
      body: { scope: "household", key: "voice.hf_token", value: plain },
    });
    expect(put.status).toBe(200);

    const row = db
      .select()
      .from(settingsValues)
      .where(and(eq(settingsValues.scope, "household"), eq(settingsValues.key, "voice.hf_token")))
      .get();
    expect(row).toBeDefined();
    expect(row!.value).not.toContain(plain);
  });

  test("the generic settings list route never returns the real value", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    await owner.request("/api/settings", {
      method: "PUT",
      body: { scope: "household", key: "voice.hf_token", value: "hf_realtoken" },
    });
    const res = await owner.get("/api/settings?scope=household");
    const body = (await res.json()) as Array<{ key: string; value: unknown; isSet?: boolean }>;
    const token = body.find((s) => s.key === "voice.hf_token");
    expect(token?.value).toBeNull();
    expect(token?.isSet).toBe(true);
  });

  test("getHouseholdSettingValue decrypts the real value for internal use", () => {
    setHouseholdSettingValue("voice.hf_token", "hf_realtoken_for_internal_use");
    expect(getHouseholdSettingValue("voice.hf_token")).toBe("hf_realtoken_for_internal_use");
  });

  test("the unset default (an empty string, never encrypted) round-trips cleanly", () => {
    expect(getHouseholdSettingValue("voice.hf_token")).toBe("");
  });
});
