// DIAG-KEY-01: a `diagnose` API key lets an assistant session read turn timings, engine state and a cache probe, as numbers only.
import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { apiKeys, conversationTurns, people } from "@/db/schema";
import { newConversationTurnId, newPersonId } from "@/lib/id";
import { nextHlc } from "@/lib/hlc";
import { createApiKey, DIAGNOSE_KEY_MAX_DAYS, listApiKeys, revokeApiKey } from "@/lib/apiKeys";
import { acquireTurnLease, __resetTurnActivityForTests } from "@/lib/turnActivity";
import { __setStackClientForTests } from "@/lib/stackEngine";
import { __resetProbeForTests, engineState } from "@/lib/operatorDiagnose";
import { app } from "@/app";
import { resetDb } from "./reset-db";
import type { PersonRow } from "@/types";
import type { TurnStats } from "@/wire";

beforeEach(() => {
  resetDb();
  __resetProbeForTests();
  __resetTurnActivityForTests();
});

function person(role: string, name = "Sage"): PersonRow {
  const id = newPersonId();
  const at = new Date().toISOString();
  return db.insert(people).values({ id, displayName: name, role, avatarSeed: id, source: "hub", createdAt: at, updatedAt: at, hlc: nextHlc() }).returning().get() as PersonRow;
}
const call = (method: string, path: string, secret: string | null) =>
  app.request(new URL(path, "https://localhost"), { method, headers: { host: "localhost", ...(secret ? { authorization: `Bearer ${secret}` } : {}) } }, { server: { requestIP: () => ({ address: "127.0.0.1", family: "IPv4", port: 1 }) } });
const diagnoseKey = (owner = person("owner")) => createApiKey(owner, { name: "Diagnostics", scopes: ["diagnose"], expires_in_days: 7 });

function insertTurn(personId: string, createdAt: string, stats: Partial<TurnStats>, userText = "hi"): void {
  db.insert(conversationTurns).values({
    id: newConversationTurnId(), personId, surface: "chat", userText, replyText: "reply words", source: "model", safetyAction: "allow",
    minorSpeaker: false, createdAt, hlc: nextHlc(), stats: JSON.stringify(stats),
  }).run();
}

describe("who may hold a diagnose key", () => {
  test("an owner and an admin can make one; everyone else cannot", () => {
    for (const role of ["owner", "admin"]) expect(createApiKey(person(role), { name: "D", scopes: ["diagnose"], expires_in_days: 7 }).secret).toMatch(/^maipai_key_/);
    for (const role of ["adult", "teen", "child", "guest"]) expect(() => createApiKey(person(role), { name: "D", scopes: ["diagnose"], expires_in_days: 7 })).toThrow(/Only an owner or admin/);
  });
  test("it stands alone, lasts at most 30 days and never lists the secret", () => {
    const owner = person("owner");
    expect(DIAGNOSE_KEY_MAX_DAYS).toBe(30);
    expect(() => createApiKey(owner, { name: "Mixed", scopes: ["diagnose", "settings"] })).toThrow();
    expect(() => createApiKey(owner, { name: "Long", scopes: ["diagnose"], expires_in_days: 90 })).toThrow(/at most 30 days/);
    const { key, secret } = diagnoseKey(owner);
    expect(key.scopes).toEqual(["diagnose"]);
    expect(JSON.stringify(listApiKeys(owner))).not.toContain(secret);
  });
});

describe("admission", () => {
  test("a settings key cannot call diagnose and a diagnose key cannot call settings", async () => {
    const owner = person("owner");
    const settings = createApiKey(owner, { name: "S", scopes: ["settings"] }).secret;
    const diagnose = diagnoseKey(owner).secret;
    expect((await call("GET", "/api/operator/diagnose/turns", settings)).status).toBe(401);
    expect((await call("GET", "/api/operator/settings", diagnose)).status).toBe(401);
    expect((await call("GET", "/api/operator/diagnose/turns", diagnose)).status).toBe(200);
  });
  test("no key, a wrong key and a cookie-less call are refused alike", async () => {
    expect((await call("GET", "/api/operator/diagnose/turns", null)).status).toBe(401);
    expect((await call("GET", "/api/operator/diagnose/turns", "maipai_key_zzzzzz_NOTAKEY")).status).toBe(401);
    expect((await call("POST", "/api/operator/diagnose/cache-probe", null)).status).toBe(401);
  });
  test("a revoked, expired or demoted holder loses the key at once", async () => {
    const owner = person("owner");
    const revoked = diagnoseKey(owner);
    expect(revokeApiKey(owner.id, revoked.key.id)).toBe(true);
    expect((await call("GET", "/api/operator/diagnose/summary", revoked.secret)).status).toBe(401);
    const expired = diagnoseKey(owner);
    db.update(apiKeys).set({ expiresAt: new Date(Date.now() - 1000).toISOString() }).where(eq(apiKeys.id, expired.key.id)).run();
    expect((await call("GET", "/api/operator/diagnose/summary", expired.secret)).status).toBe(401);
    const admin = person("admin", "Marlow");
    const demoted = diagnoseKey(admin);
    expect((await call("GET", "/api/operator/diagnose/summary", demoted.secret)).status).toBe(200);
    db.update(people).set({ role: "adult" }).where(eq(people.id, admin.id)).run();
    expect((await call("GET", "/api/operator/diagnose/summary", demoted.secret)).status).toBe(401);
  });
  test("a key is slowed after 20 calls a minute", async () => {
    const { secret } = diagnoseKey();
    let last = 200;
    for (let i = 0; i < 25; i++) last = (await call("GET", "/api/operator/diagnose/turns", secret)).status;
    expect(last).toBe(429);
  });
});

describe("turns and summary", () => {
  const stats = (cache_n: number, ttft: number): Partial<TurnStats> => ({
    time_to_first_token_ms: ttft, total_time_ms: ttft + 1000, tokens_per_second: 20,
    generations: [{ reason: "first", prompt_n: 4800, cache_n, prompt_ms: 3000, predicted_n: 40, request_sent_ms: 5, first_delta_ms: ttft }] as never,
    nodes: [{ node: "model", startMs: 0, endMs: ttft }] as never,
  });
  // MEM-AUDIT-05: the turn row's memory trace (profile card line ids and injected memory ids with scores) is for the turn row
  // alone. A diagnose view never carries a stable record id beside an activity (rule 6a), so neither view selects it.
  test("the memory trace on a turn's stats never reaches the turns or summary view", async () => {
    const sage = person("owner");
    insertTurn(sage.id, "2026-10-01T10:00:00.000Z", { ...stats(0, 5000), memory: { profile: ["mem-0000001-abcdef"], injected: [{ id: "mem-0000002-abcdef", score: 0.731 }] } });
    const { secret } = diagnoseKey(sage);
    for (const path of ["/api/operator/diagnose/turns?limit=5", "/api/operator/diagnose/summary?limit=5"]) {
      const res = await call("GET", path, secret);
      const text = await res.text();
      expect([path, res.status]).toEqual([path, 200]);
      expect(text).not.toContain("mem-0000001-abcdef");
      expect(text).not.toContain("mem-0000002-abcdef");
      expect(text).not.toContain("\"memory\"");
      expect(text).not.toContain("\"profile\"");
      expect(text).not.toContain("\"injected\"");
    }
  });
  test("returns timings and counts only: the message and reply text never appear", async () => {
    const sage = person("owner");
    insertTurn(sage.id, "2026-10-01T10:00:00.000Z", stats(0, 5000), "my secret grocery list for Nova");
    const { secret } = diagnoseKey(sage);
    const res = await call("GET", "/api/operator/diagnose/turns?limit=5", secret);
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).not.toContain("grocery");
    expect(text).not.toContain("reply words");
    expect(text).not.toContain("Nova");
    expect(text).not.toContain(sage.id);
    expect(text).not.toContain("2026-10-01");
    expect(text).not.toContain("\"id\"");
    expect(text).not.toContain("\"node\"");
    const body = JSON.parse(text) as { turns: Array<{ time_to_first_token_ms: number; generations: Array<{ cache_n: number }> }> };
    expect(body.turns[0]!.time_to_first_token_ms).toBe(5000);
    expect(body.turns[0]!.generations[0]!.cache_n).toBe(0);
  });
  test("the summary counts big first calls that missed the cache", async () => {
    const sage = person("owner");
    insertTurn(sage.id, "2026-10-01T10:00:00.000Z", stats(0, 5000));
    insertTurn(sage.id, "2026-10-01T10:01:00.000Z", stats(0, 7000));
    insertTurn(sage.id, "2026-10-01T10:02:00.000Z", stats(4700, 600));
    const { secret } = diagnoseKey(sage);
    const body = await (await call("GET", "/api/operator/diagnose/summary", secret)).json() as Record<string, number>;
    expect(body.turns_examined).toBe(3);
    expect(body.first_call_big_prompt_turns).toBe(3);
    expect(body.first_call_cache_miss_share).toBeCloseTo(2 / 3);
    expect(body.median_first_token_ms).toBe(5000);
    expect((body as never as { node_total_ms: Record<string, number> }).node_total_ms.model).toBe(5000 + 7000 + 600);
  });
  test("a bad limit says what to send", async () => {
    const { secret } = diagnoseKey();
    for (const q of ["limit=0", "limit=abc", "limit=1.5"]) {
      const res = await call("GET", `/api/operator/diagnose/turns?${q}`, secret);
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toContain("whole number from 1 to 50");
    }
    expect((await call("GET", "/api/operator/diagnose/turns?limit=999", secret)).status).toBe(200);
  });
});

describe("engines", () => {
  test("reports the Stack's typed role and engine state and none of its free text or paths", async () => {
    __setStackClientForTests({
      roles: async () => ({ roles: [{ id: "chat", wire: "chat", residency: "resident", state: { state: "ready", since: "t" }, reason: "free text /Users/sage/x", model: { id: "qwen-27b", measuredContextLength: 32768 }, identity: { ok: true, expected: "/p/a.gguf", actual: "/p/a.gguf", reason: null } }] }),
      engines: async () => ({ engines: [{ name: "llama-server", installed: true, running: "b1", currentTag: "b1", newestTag: "b2", needsRestart: false, state: "current", directory: "/Users/sage/engines" }] }),
      health: async () => ({ health: [{ code: "engine.slow", severity: "warning", title: "Sage's thing", text: "free text", since: "t" }] }),
    } as never);
    const state = await engineState();
    expect(state.roles[0]).toMatchObject({ id: "chat", state: "ready", model: "qwen-27b", measured_context_length: 32768 });
    expect(state.engines[0]).toMatchObject({ name: "llama-server", running_tag: "b1", newest_tag: "b2" });
    expect(state.health).toEqual([{ code: "engine.slow", severity: "warning" }]);
    const text = JSON.stringify(state);
    for (const leak of ["/Users", "free text", "Sage", "a.gguf"]) expect(text).not.toContain(leak);
  });
  test("the route answers 503 with a plain next step when the Stack is down", async () => {
    __setStackClientForTests({ roles: async () => { throw new Error("down"); }, engines: async () => ({ engines: [] }), health: async () => ({ health: [] }) } as never);
    const res = await call("GET", "/api/operator/diagnose/engines", diagnoseKey().secret);
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toContain("try again");
  });
});

describe("cache probe", () => {
  test("refuses while a chat turn is running, and says to wait", async () => {
    const { secret } = diagnoseKey();
    const lease = acquireTurnLease();
    try {
      const res = await call("POST", "/api/operator/diagnose/cache-probe", secret);
      expect(res.status).toBe(409);
      expect(((await res.json()) as { error: string }).error).toContain("Wait");
    } finally { lease.release(); }
  });
  test("a probe with no working engine says so, then the next one in the same minute is slowed", async () => {
    __setStackClientForTests(null);
    const { secret } = diagnoseKey();
    const first = await call("POST", "/api/operator/diagnose/cache-probe", secret);
    expect([503, 200]).toContain(first.status);
    expect((await call("POST", "/api/operator/diagnose/cache-probe", secret)).status).toBe(429);
  });
  test("a GET does not run it", async () => {
    const { secret } = diagnoseKey();
    expect((await call("GET", "/api/operator/diagnose/cache-probe", secret)).status).toBe(404);
  });
});

describe("news", () => {
  test("reports News counters and the picture cache as fixed names and numbers only", async () => {
    const { bumpNewsCounter, __resetNewsCountersForTests } = await import("@/lib/news/newsCounters");
    __resetNewsCountersForTests();
    bumpNewsCounter("picture_failed", 2);
    const res = await call("GET", "/api/operator/diagnose/news", diagnoseKey().secret);
    expect(res.status).toBe(200);
    const body = await res.json() as { pictures_on: boolean; pictures_cached: number; counters: Record<string, number> };
    expect(body.counters.picture_failed).toBe(2);
    expect(body.counters.enrichment_none).toBe(0);
    expect(typeof body.pictures_on).toBe("boolean");
    expect(typeof body.pictures_cached).toBe("number");
    for (const value of Object.values(body.counters)) expect(typeof value).toBe("number");
    expect((await call("GET", "/api/operator/diagnose/news", null)).status).toBe(401);
  });
});
