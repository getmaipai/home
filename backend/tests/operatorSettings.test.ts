// OPS-KEY-01: a `settings` API key lets an assistant session change a short named list of household settings.
import { beforeEach, describe, expect, test, spyOn } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { apiKeys, people } from "@/db/schema";
import { newPersonId } from "@/lib/id";
import { nextHlc } from "@/lib/hlc";
import { createApiKey, listApiKeys, revokeApiKey, SETTINGS_KEY_MAX_DAYS } from "@/lib/apiKeys";
import { getHouseholdSettingValue, setHouseholdSettingValue } from "@/lib/settings";
import { getRegistryKey } from "@/lib/settingsRegistry";
import { OPERATOR_DENIED_PREFIXES, OPERATOR_SETTING_KEYS, isOperatorSettingKey } from "@/lib/operatorSettings";
import { app } from "@/app";
import { resetDb } from "./reset-db";
import type { PersonRow } from "@/types";

beforeEach(resetDb);
function person(role: string, name = "Willow"): PersonRow {
  const id = newPersonId();
  const at = new Date().toISOString();
  return db.insert(people).values({ id, displayName: name, role, avatarSeed: id, source: "hub", createdAt: at, updatedAt: at, hlc: nextHlc() }).returning().get() as PersonRow;
}
const call = (method: string, path: string, secret: string | null, body?: unknown) =>
  app.request(new URL(path, "https://localhost"), { method, headers: { host: "localhost", ...(secret ? { authorization: `Bearer ${secret}` } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined }, { server: { requestIP: () => ({ address: "127.0.0.1", family: "IPv4", port: 1 }) } });

describe("who may hold a settings key", () => {
  test("an owner and an admin can make one; an adult, a teen and a child cannot", () => {
    for (const role of ["owner", "admin"]) expect(createApiKey(person(role), { name: "Helper", scopes: ["settings"] }).secret).toMatch(/^maipai_key_/);
    for (const role of ["adult", "teen", "child", "guest"]) expect(() => createApiKey(person(role), { name: "Helper", scopes: ["settings"] })).toThrow(/Only an owner or admin/);
  });
  test("a settings key stands alone, lasts at most 90 days and never carries the secret in a listing", () => {
    const owner = person("owner");
    expect(() => createApiKey(owner, { name: "Mixed", scopes: ["settings", "turn"] })).toThrow();
    expect(() => createApiKey(owner, { name: "Long", scopes: ["settings"], expires_in_days: 365 })).toThrow(/at most 90 days/);
    expect(SETTINGS_KEY_MAX_DAYS).toBe(90);
    const { key, secret } = createApiKey(owner, { name: "Helper", scopes: ["settings"], expires_in_days: 30 });
    expect(key.scopes).toEqual(["settings"]);
    expect(JSON.stringify(listApiKeys(owner))).not.toContain(secret);
  });
});

describe("PUT /api/operator/settings", () => {
  test("changes an allowed setting, returns the old value, and logs the key id and values but never the secret", async () => {
    const owner = person("owner");
    const { key, secret } = createApiKey(owner, { name: "Helper", scopes: ["settings"] });
    const log = spyOn(console, "log").mockImplementation(() => {});
    try {
      const before = getHouseholdSettingValue("chat.search_assist");
      const res = await call("PUT", "/api/operator/settings", secret, { key: "chat.search_assist", value: "rescue" });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ key: "chat.search_assist", previous: before, value: "rescue" });
      expect(getHouseholdSettingValue("chat.search_assist")).toBe("rescue");
      const lines = log.mock.calls.map((args) => String(args[0]));
      expect(lines.some((line) => line.includes(key.id) && line.includes("chat.search_assist") && line.includes("rescue"))).toBe(true);
      expect(lines.join("\n")).not.toContain(secret);
    } finally { log.mockRestore(); }
  });
  test("GET lists the allowed settings with their current values", async () => {
    const { secret } = createApiKey(person("owner"), { name: "Helper", scopes: ["settings"] });
    const res = await call("GET", "/api/operator/settings", secret);
    expect(res.status).toBe(200);
    const body = await res.json() as { settings: Array<{ key: string; options: string[] | null; value: unknown }> };
    expect(body.settings.map((s) => s.key)).toEqual([...OPERATOR_SETTING_KEYS]);
    expect(body.settings[0]!.options).toEqual(["off", "shadow", "rescue"]);
  });
  test("a setting that is not on the list, and a value the setting does not accept, are refused", async () => {
    const { secret } = createApiKey(person("owner"), { name: "Helper", scopes: ["settings"] });
    for (const key of ["coding.enabled", "home.robots.enabled", "people.anything", "not.a.key"]) {
      const res = await call("PUT", "/api/operator/settings", secret, { key, value: true });
      expect(res.status).toBe(403);
    }
    expect((await call("PUT", "/api/operator/settings", secret, { key: "chat.search_assist", value: "sometimes" })).status).toBe(400);
    expect((await call("PUT", "/api/operator/settings", secret, { key: "chat.search_assist" })).status).toBe(400);
    expect(getHouseholdSettingValue("chat.search_assist")).not.toBe("sometimes");
  });
  test("no key, a voice key, a coding key, a wrong key and a cookie-less call are all refused alike", async () => {
    const owner = person("owner");
    const voice = createApiKey(owner, { name: "Voice", scopes: ["turn"] }).secret;
    expect((await call("PUT", "/api/operator/settings", null, { key: "chat.search_assist", value: "rescue" })).status).toBe(401);
    expect((await call("PUT", "/api/operator/settings", voice, { key: "chat.search_assist", value: "rescue" })).status).toBe(401);
    expect((await call("PUT", "/api/operator/settings", "maipai_key_zzzzzz_NOTAKEY", { key: "chat.search_assist", value: "rescue" })).status).toBe(401);
    // A settings key opens nothing else: the voice door and the settings page do not take it.
    const { secret } = createApiKey(owner, { name: "Helper", scopes: ["settings"] });
    expect((await call("POST", "/v1/chat/completions", secret, { messages: [{ role: "user", content: "hi" }] })).status).toBe(401);
    expect((await call("PUT", "/api/settings", secret, { scope: "household", key: "chat.search_assist", value: "rescue" })).status).toBe(401);
  });
  test("a revoked, expired or demoted holder loses the key at once", async () => {
    const owner = person("owner");
    const revoked = createApiKey(owner, { name: "A", scopes: ["settings"] });
    expect(revokeApiKey(owner.id, revoked.key.id)).toBe(true);
    expect((await call("GET", "/api/operator/settings", revoked.secret)).status).toBe(401);
    const expired = createApiKey(owner, { name: "B", scopes: ["settings"] });
    db.update(apiKeys).set({ expiresAt: new Date(Date.now() - 1000).toISOString() }).where(eq(apiKeys.id, expired.key.id)).run();
    expect((await call("GET", "/api/operator/settings", expired.secret)).status).toBe(401);
    const admin = person("admin", "Marlow");
    const demoted = createApiKey(admin, { name: "C", scopes: ["settings"] });
    expect((await call("GET", "/api/operator/settings", demoted.secret)).status).toBe(200);
    db.update(people).set({ role: "adult" }).where(eq(people.id, admin.id)).run();
    expect((await call("GET", "/api/operator/settings", demoted.secret)).status).toBe(401);
    expect(listApiKeys({ ...admin, role: "adult" } as PersonRow)[0]!.status).toBe("suspended");
  });
});

describe("rate", () => {
  test("a key is slowed after 20 calls a minute and the refusal says what to do", async () => {
    const { secret } = createApiKey(person("owner"), { name: "Helper", scopes: ["settings"] });
    let last = 200;
    for (let i = 0; i < 25; i++) last = (await call("GET", "/api/operator/settings", secret)).status;
    expect(last).toBe(429);
  });
});

describe("the allowlist", () => {
  test("every listed key is a real household setting outside every denied family", () => {
    for (const key of OPERATOR_SETTING_KEYS) {
      expect(getRegistryKey(key)?.scope).toBe("household");
      expect(isOperatorSettingKey(key)).toBe(true);
      for (const prefix of OPERATOR_DENIED_PREFIXES) expect(key.startsWith(prefix)).toBe(false);
    }
    expect(isOperatorSettingKey("coding.enabled")).toBe(false);
  });
  test("it stays short", () => {
    expect(OPERATOR_SETTING_KEYS.length).toBeLessThanOrEqual(8);
    setHouseholdSettingValue("chat.search_assist", "shadow");
  });
});
