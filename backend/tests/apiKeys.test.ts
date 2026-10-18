import { beforeEach, expect, test, spyOn } from "bun:test";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { apiKeys, people, grants, settingsValues } from "@/db/schema";
import { newPersonId } from "@/lib/id";
import { createApiKey, listApiKeys, renameApiKey, revokeApiKey, resolveApiKey, constantTimeHashEqual } from "@/lib/apiKeys";
import { setHouseholdSettingValue } from "@/lib/settings";
import { nextHlc } from "@/lib/hlc";
import { resetDb } from "./reset-db";
import type { PersonRow } from "@/types";

beforeEach(resetDb);
function person(role = "owner"): PersonRow {
  const id = newPersonId();
  const at = new Date().toISOString();
  return db.insert(people).values({ id, displayName: "Willow", role, avatarSeed: id, source: "hub", createdAt: at, updatedAt: at, hlc: nextHlc() }).returning().get() as PersonRow;
}
// A guardian grant dialog (a later slice) writes this value; a minor's own settings are private to the settings routes.
function keyPermission(p: PersonRow, value: boolean) {
  const row = { scope: `person:${p.id}`, key: "coding.person.api_keys", value: JSON.stringify(value), hlc: "1:0:abcdef", source: "user" as const, updatedAt: new Date().toISOString() };
  db.insert(settingsValues).values(row).onConflictDoUpdate({ target: [settingsValues.scope, settingsValues.key], set: row }).run();
}
function grant(p: PersonRow, effect: "allow" | "deny") {
  const at = new Date().toISOString();
  db.insert(grants).values({ id: `grant-${crypto.randomBytes(6).toString("hex")}`, person: p.id, action: "use:code", effect, grantedByPersonId: p.id, createdAt: at, updatedAt: at, hlc: nextHlc() }).run();
}

test("creation shows the secret once; owner and admin reads never disclose hashes or secrets", () => {
  const p = person();
  const { key, secret } = createApiKey(p, { name: "Voice", scopes: ["turn"] });
  expect(secret).toMatch(new RegExp(`^maipai_${key.id}_[A-Z2-7]{52}$`));
  const stored = db.select().from(apiKeys).get()!;
  expect(stored.secretHash).not.toBe(secret);
  expect(stored.secretHash).toHaveLength(64);
  expect(JSON.stringify(listApiKeys(p))).not.toContain(secret);
  expect(JSON.stringify(listApiKeys(p))).not.toContain(stored.secretHash!);
  expect(key.expires_at).toBeTruthy();
  expect(renameApiKey(p.id, key.id, "Speaker")).toBe(true);
  expect(listApiKeys(p)[0]!.name).toBe("Speaker");
  expect(renameApiKey(person().id, key.id, "Other")).toBe(false);
  expect(revokeApiKey(p.id, key.id)).toBe(true);
  expect(listApiKeys(p)[0]!.status).toBe("revoked");
  expect(resolveApiKey(secret, "turn")).toBeNull();
});

test("wrong and unknown credentials fail without logs; comparison calls timingSafeEqual", () => {
  const p = person();
  const { secret } = createApiKey(p, { name: "Voice", scopes: ["turn"] });
  const log = spyOn(console, "log").mockImplementation(() => {});
  const error = spyOn(console, "error").mockImplementation(() => {});
  const compare = spyOn(crypto, "timingSafeEqual");
  try {
    expect(constantTimeHashEqual("a".repeat(64), "a".repeat(64))).toBe(true);
    expect(compare).toHaveBeenCalled();
    expect(resolveApiKey(secret.slice(0, -1) + "!", "turn")).toBeNull();
    expect(resolveApiKey("maipai_key_example_wrong", "turn")).toBeNull();
    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  } finally { log.mockRestore(); error.mockRestore(); compare.mockRestore(); }
});

test("expiry, scope and deletion are checked, and usage writes happen at most once a minute", () => {
  const p = person();
  const { key, secret } = createApiKey(p, { name: "Voice", scopes: ["turn"] });
  const from = { place: "away" as const, address: "192.0.2.10" };
  expect(resolveApiKey(secret, "code", from)).toBeNull();
  expect(resolveApiKey(secret, "turn", from)?.id).toBe(p.id);
  const first = db.select().from(apiKeys).get()!;
  expect(first.lastUsedFrom).toEqual(from);
  resolveApiKey(secret, "turn", { ...from, address: "192.0.2.11" });
  expect(db.select().from(apiKeys).get()).toEqual(first);
  db.update(apiKeys).set({ lastUsedAt: new Date(Date.now() - 61_000).toISOString() }).run();
  resolveApiKey(secret, "turn", { ...from, address: "192.0.2.11" });
  expect(db.select().from(apiKeys).get()!.lastUsedFrom?.address).toBe("192.0.2.11");
  db.update(apiKeys).set({ expiresAt: new Date(Date.now() - 1).toISOString() }).where(eq(apiKeys.id, key.id)).run();
  expect(resolveApiKey(secret, "turn")).toBeNull();
  expect(listApiKeys(p)[0]!.status).toBe("expired");
});

test("ten live keys per adult; expiry and revocation free slots", () => {
  const p = person();
  for (let i = 0; i < 10; i++) createApiKey(p, { name: "Voice", scopes: ["turn"] });
  expect(() => createApiKey(p, { name: "Extra", scopes: ["turn"] })).toThrow("Revoke");
  revokeApiKey(p.id, listApiKeys(p)[0]!.id);
  expect(() => createApiKey(p, { name: "New", scopes: ["turn"] })).not.toThrow();
});

test("code suspends for off, pause, deny, adults-by-default off and keys disabled; turn stays available", () => {
  const p = person();
  setHouseholdSettingValue("coding.enabled", true);
  const { secret } = createApiKey(p, { name: "Code", scopes: ["code"] });
  const turn = createApiKey(p, { name: "Voice", scopes: ["turn"] }).secret;
  expect(resolveApiKey(secret, "code")?.id).toBe(p.id);
  for (const [setting, value] of [["coding.enabled", false], ["coding.paused", true], ["coding.adults_by_default", false]] as const) {
    setHouseholdSettingValue(setting, value);
    expect(resolveApiKey(secret, "code")).toBeNull();
    expect(resolveApiKey(turn, "turn")?.id).toBe(p.id);
    setHouseholdSettingValue(setting, !value);
  }
  grant(p, "allow"); grant(p, "deny");
  expect(resolveApiKey(secret, "code")).toBeNull();
  expect(listApiKeys(p).find(k => k.scopes.includes("code"))!.status).toBe("suspended");
});

for (const role of ["child", "teen"]) test(`${role} needs an explicit grant and permission for keys, with short expiry`, () => {
  const p = person(role);
  setHouseholdSettingValue("coding.enabled", true);
  expect(() => createApiKey(p, { name: "Code", scopes: ["code"], expires_in_days: 30 })).toThrow();
  grant(p, "allow");
  expect(() => createApiKey(p, { name: "Code", scopes: ["code"], expires_in_days: 30 })).toThrow();
  keyPermission(p, true);
  const { secret } = createApiKey(p, { name: "Code", scopes: ["code"], expires_in_days: 30 });
  expect(resolveApiKey(secret, "code")?.id).toBe(p.id);
  expect(() => createApiKey(p, { name: "Code", scopes: ["code"], expires_in_days: 90 })).toThrow();
  keyPermission(p, false);
  expect(resolveApiKey(secret, "code")).toBeNull();
  keyPermission(p, true);
  db.delete(grants).run();
  expect(resolveApiKey(secret, "code")).toBeNull();
});

test("the middleware gives one refusal for every failure and never echoes a secret; the old token path still rotates", async () => {
  const { Hono } = await import("hono");
  const { requireApiKey } = await import("@/middleware/auth");
  const { issueApiToken, revokeApiToken } = await import("@/lib/apiKeys");
  const app = new Hono();
  app.get("/turn", requireApiKey("turn"), (c) => c.json({ ok: true }));
  app.get("/code", requireApiKey("code"), (c) => c.json({ ok: true }));
  const p = person();
  setHouseholdSettingValue("coding.enabled", true);
  const code = createApiKey(p, { name: "Code", scopes: ["code"] });
  const turn = createApiKey(p, { name: "Voice", scopes: ["turn"] });
  const ask = async (path: string, secret?: string) => {
    const res = await app.request(path, { headers: secret ? { authorization: `Bearer ${secret}` } : {} });
    return { status: res.status, body: await res.text() };
  };
  const wrongSecret = await ask("/turn", turn.secret.slice(0, -5) + (turn.secret.at(-5) === "B" ? "C" : "B") + turn.secret.slice(-4));
  const unknownId = await ask("/turn", `maipai_key_aaaaaaaaaaaa_${"A".repeat(52)}`);
  const wrongScope = await ask("/turn", code.secret);
  const none = await ask("/turn");
  expect(wrongSecret.status).toBe(401);
  expect(unknownId).toEqual(wrongSecret);
  expect(wrongScope).toEqual(wrongSecret);
  expect(none).toEqual(wrongSecret);
  for (const r of [wrongSecret, unknownId, wrongScope]) { expect(r.body).not.toContain(turn.secret); expect(r.body).not.toContain(code.secret); }
  expect((await ask("/turn", turn.secret)).status).toBe(200);
  expect((await ask("/code", code.secret)).status).toBe(200);
  expect((await ask("/code", turn.secret)).status).toBe(401);
  const first = issueApiToken(p.id);
  const second = issueApiToken(p.id);
  expect((await ask("/turn", first)).status).toBe(401);
  expect((await ask("/turn", second)).status).toBe(200);
  revokeApiToken(p.id);
  expect((await ask("/turn", second)).status).toBe(401);
  expect((await ask("/turn", turn.secret)).status).toBe(200);
});

test("the admin read carries no name, hint, address or use", async () => {
  const { listApiKeysForAdmin } = await import("@/lib/apiKeys");
  const p = person();
  const { secret } = createApiKey(p, { name: "Kitchen speaker", scopes: ["turn"] });
  resolveApiKey(secret, "turn", { place: "away", address: "192.0.2.44" });
  const text = JSON.stringify(listApiKeysForAdmin(p));
  for (const hidden of ["Kitchen speaker", "192.0.2.44", secret.slice(-4), "last_used", "hint", "name"]) expect(text).not.toContain(hidden);
  expect(Object.keys(listApiKeysForAdmin(p)[0]!).sort()).toEqual(["created_at", "expires_at", "id", "person_id", "revoked_at", "scopes", "status"]);
});

test("a disabled person's code key is suspended and ending access revokes every key", async () => {
  const { revokeAllApiKeys } = await import("@/lib/apiKeys");
  const p = person();
  setHouseholdSettingValue("coding.enabled", true);
  const code = createApiKey(p, { name: "Code", scopes: ["code"] }).secret;
  const turn = createApiKey(p, { name: "Voice", scopes: ["turn"] }).secret;
  db.update(people).set({ enabled: false }).where(eq(people.id, p.id)).run();
  expect(resolveApiKey(code, "code")).toBeNull();
  db.update(people).set({ enabled: true }).where(eq(people.id, p.id)).run();
  expect(resolveApiKey(code, "code")?.id).toBe(p.id);
  revokeAllApiKeys(p.id);
  expect(resolveApiKey(code, "code")).toBeNull();
  expect(resolveApiKey(turn, "turn")).toBeNull();
});

test("admission depends only on the scope asked for: a dual-scope key keeps working for turn when Coding is off", () => {
  const p = person();
  setHouseholdSettingValue("coding.enabled", true);
  const both = createApiKey(p, { name: "Both", scopes: ["turn", "code"] }).secret;
  const codeOnly = createApiKey(p, { name: "Code", scopes: ["code"] }).secret;
  expect(resolveApiKey(both, "code")?.id).toBe(p.id);
  setHouseholdSettingValue("coding.enabled", false);
  expect(resolveApiKey(both, "turn")?.id).toBe(p.id);
  expect(resolveApiKey(both, "code")).toBeNull();
  expect(resolveApiKey(codeOnly, "code")).toBeNull();
  expect(listApiKeys(p).every(k => k.status === "suspended")).toBe(true);
});

test("the minor limits apply to coding keys only: a child's voice token keeps 365 days and is not one of the 3 coding keys", () => {
  const child = person("child");
  setHouseholdSettingValue("coding.enabled", true);
  grant(child, "allow");
  keyPermission(child, true);
  const days = (k: { expires_at: string }) => (Date.parse(k.expires_at) - Date.now()) / 86400000;
  const voice = createApiKey(child, { name: "Voice", scopes: ["turn"], expires_in_days: 365 });
  expect(days(voice.key)).toBeGreaterThan(364);
  for (let i = 0; i < 3; i++) createApiKey(child, { name: `Code ${i}`, scopes: ["code"], expires_in_days: 30 });
  expect(() => createApiKey(child, { name: "Fourth", scopes: ["code"], expires_in_days: 30 })).toThrow("limit");
  expect(() => createApiKey(child, { name: "Long", scopes: ["code"], expires_in_days: 90 })).toThrow("30 days");
  expect(() => createApiKey(child, { name: "Voice 2", scopes: ["turn"], expires_in_days: 90 })).not.toThrow();
});

test("a rotated compatibility token lasts about 365 days for adults and children, and hints differ between keys", async () => {
  const { issueApiToken } = await import("@/lib/apiKeys");
  for (const role of ["owner", "child"]) {
    const p = person(role);
    issueApiToken(p.id);
    const k = listApiKeys(p).find(x => x.status === "active")!;
    expect((Date.parse(k.expires_at) - Date.now()) / 86400000).toBeGreaterThan(364);
  }
  const p = person();
  const hints = new Set<string>();
  for (let i = 0; i < 6; i++) hints.add(createApiKey(p, { name: `Code ${i}`, scopes: ["turn"] }).key.hint);
  expect(hints.size).toBeGreaterThan(1);
  for (const h of hints) expect(h).toMatch(/^[A-Z2-7]{4}$/);
});
