// SPLASH-KEY-01: an `engine` API key can choose the chat engine and apply it, and can do nothing else.
import { beforeEach, describe, expect, test } from "bun:test";
import { db } from "@/db";
import { people } from "@/db/schema";
import { newPersonId } from "@/lib/id";
import { nextHlc } from "@/lib/hlc";
import { createApiKey, ENGINE_KEY_MAX_DAYS } from "@/lib/apiKeys";
import { acquireTurnLease, __resetTurnActivityForTests } from "@/lib/turnActivity";
import { __setStackClientForTests } from "@/lib/stackEngine";
import { ENGINE_CHANGES_PER_DAY, ENGINE_SETTING_KEY, __resetOperatorEngineForTests } from "@/lib/operatorEngine";
import { app } from "@/app";
import { resetDb } from "./reset-db";
import type { PersonRow } from "@/types";

let inEffect = "llama-server";
let applied: Array<Record<string, unknown>> = [];
let stackDown = false;
const setting = () => ({ key: ENGINE_SETTING_KEY, label: "Chat engine", in_effect: inEffect, pending: null });
const fakeStack = () => ({
  settings: async () => { if (stackDown) throw new Error("down"); return { sections: [], settings: [setting()] }; },
  applySettings: async (values: Record<string, unknown>) => { applied.push(values); inEffect = String(values[ENGINE_SETTING_KEY]); return { sections: [], settings: [setting()] }; },
});

beforeEach(() => {
  resetDb();
  __resetTurnActivityForTests();
  __resetOperatorEngineForTests();
  inEffect = "llama-server"; applied = []; stackDown = false;
  __setStackClientForTests(fakeStack() as never);
});

function person(role: string): PersonRow {
  const id = newPersonId();
  const at = new Date().toISOString();
  return db.insert(people).values({ id, displayName: "Sage", role, avatarSeed: id, source: "hub", createdAt: at, updatedAt: at, hlc: nextHlc() }).returning().get() as PersonRow;
}
const call = (method: string, path: string, secret: string | null, body?: unknown) =>
  app.request(new URL(path, "https://localhost"), { method, headers: { host: "localhost", "content-type": "application/json", ...(secret ? { authorization: `Bearer ${secret}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }, { server: { requestIP: () => ({ address: "127.0.0.1", family: "IPv4", port: 1 }) } });
const engineKey = (owner = person("owner")) => createApiKey(owner, { name: "Engine", scopes: ["engine"], expires_in_days: 7 });

describe("who may hold an engine key", () => {
  test("owner and admin only, alone on the key, at most 30 days", () => {
    for (const role of ["owner", "admin"]) expect(createApiKey(person(role), { name: "E", scopes: ["engine"], expires_in_days: 7 }).secret).toMatch(/^maipai_key_/);
    for (const role of ["adult", "teen", "child", "guest"]) expect(() => createApiKey(person(role), { name: "E", scopes: ["engine"], expires_in_days: 7 })).toThrow(/Only an owner or admin/);
    expect(ENGINE_KEY_MAX_DAYS).toBe(30);
    const owner = person("owner");
    expect(() => createApiKey(owner, { name: "Mixed", scopes: ["engine", "settings"] })).toThrow();
    expect(() => createApiKey(owner, { name: "Long", scopes: ["engine"], expires_in_days: 90 })).toThrow(/at most 30 days/);
  });
});

describe("admission: an engine key reaches the engine door and no other", () => {
  test("it cannot read or change settings, read diagnostics or reach other APIs", async () => {
    const owner = person("owner");
    const { secret } = engineKey(owner);
    expect((await call("GET", "/api/operator/settings", secret)).status).toBe(401);
    expect((await call("PUT", "/api/operator/settings", secret, { key: "chat.search_assist", value: "rescue" })).status).toBe(401);
    expect((await call("GET", "/api/operator/diagnose/turns", secret)).status).toBe(401);
    expect((await call("GET", "/api/operator/engine", secret)).status).toBe(200);
  });
  test("settings and diagnose keys cannot reach the engine door; no key is refused", async () => {
    const owner = person("owner");
    const settings = createApiKey(owner, { name: "S", scopes: ["settings"] }).secret;
    const diagnose = createApiKey(owner, { name: "D", scopes: ["diagnose"], expires_in_days: 7 }).secret;
    for (const s of [settings, diagnose, null, "maipai_key_zzzzzz_NOTAKEY"]) expect((await call("PUT", "/api/operator/engine", s, { engine: "splash" })).status).toBe(401);
    expect(applied).toEqual([]);
  });
});

describe("changing the engine", () => {
  test("splash, then back to llama-server, each applied through the Stack with the one key only", async () => {
    const { secret } = engineKey();
    const on = await call("PUT", "/api/operator/engine", secret, { engine: "splash" });
    expect(on.status).toBe(200);
    expect(await on.json()).toEqual({ key: ENGINE_SETTING_KEY, previous: "llama-server", value: "splash" });
    const off = await call("PUT", "/api/operator/engine", secret, { engine: "llama-server" });
    expect((await off.json() as { value: string }).value).toBe("llama-server");
    expect(applied).toEqual([{ [ENGINE_SETTING_KEY]: "splash" }, { [ENGINE_SETTING_KEY]: "llama-server" }]);
  });
  test("a value outside the list is refused and nothing is sent to the Stack", async () => {
    const { secret } = engineKey();
    for (const engine of ["omlx", "", 3, null, "splash; rm -rf /"]) expect((await call("PUT", "/api/operator/engine", secret, { engine })).status).toBe(400);
    expect((await call("PUT", "/api/operator/engine", secret, "nope")).status).toBe(400);
    expect(applied).toEqual([]);
  });
  test("it waits while a chat turn is running", async () => {
    const { secret } = engineKey();
    const lease = acquireTurnLease();
    expect((await call("PUT", "/api/operator/engine", secret, { engine: "splash" })).status).toBe(409);
    lease.release();
    expect((await call("PUT", "/api/operator/engine", secret, { engine: "splash" })).status).toBe(200);
  });
  test("a key can change the engine only a few times a day", async () => {
    const { secret } = engineKey();
    for (let i = 0; i < ENGINE_CHANGES_PER_DAY; i++) expect((await call("PUT", "/api/operator/engine", secret, { engine: i % 2 === 0 ? "splash" : "llama-server" })).status).toBe(200);
    const blocked = await call("PUT", "/api/operator/engine", secret, { engine: "auto" });
    expect(blocked.status).toBe(429);
    expect(((await blocked.json()) as { error: string }).error).toMatch(/Settings in the browser/);
  });
  test("an unchanged value is a no-op that costs no change and sends nothing", async () => {
    const { secret } = engineKey();
    expect((await call("PUT", "/api/operator/engine", secret, { engine: "llama-server" })).status).toBe(200);
    expect(applied).toEqual([]);
  });
  test("a Stack that is down gives a plain 503", async () => {
    const { secret } = engineKey();
    stackDown = true;
    const r = await call("PUT", "/api/operator/engine", secret, { engine: "splash" });
    expect(r.status).toBe(503);
    expect(((await r.json()) as { error: string }).error).toMatch(/status page/);
  });
  test("the read shows the current engine and what is left today", async () => {
    const { secret } = engineKey();
    const r = await (await call("GET", "/api/operator/engine", secret)).json() as { in_effect: string; choices: string[]; changes_left_today: number };
    expect(r.in_effect).toBe("llama-server");
    expect(r.choices).toEqual(["auto", "llama-server", "splash"]);
    expect(r.changes_left_today).toBe(ENGINE_CHANGES_PER_DAY);
  });
});
