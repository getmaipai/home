// CODE-KEYS (slice four, risky surface: credentials and auth): the per-session coding key and what the /code/v1 gateway does with it. Revoked, expired, cross-person
// and lost-access keys are all refused; the key never shows in a list, a transcript or a log; the session's stored, clamped tier selects the slot and nothing the tool
// sends can raise it. The gateway runs for real over a scripted Stack.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { app } from "@/app";
import { db } from "@/db";
import { apiKeys, people } from "@/db/schema";
import { createApiKey, createSessionKey, listApiKeys, listApiKeysForAdmin, resolveApiKeyOutcome, revokeSessionKeys } from "@/lib/apiKeys";
import { createCodingSession, getCodingSession, sessionTierForKey, setSessionTier, TIER_NOT_OFFERED_LINE } from "@/lib/codingSessions";
import { deleteCodingSession, setCodingRuntime, stopCodingSession, submitTurn, turnFinished } from "@/lib/codingTurns";
import { mintSessionKeyFor, sandboxGatewayUrl } from "@/lib/codingRuntime";
import { listCodingMessages } from "@/lib/codingTranscript";
import { setHouseholdSettingValue, writeLayerRow } from "@/lib/settings";
import { invalidateSessionCacheForPerson } from "@/middleware/auth";
import { __resetCodeGateForTests } from "@/lib/codeGate";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { __setStackClientForTests } from "@/lib/stackEngine";
import { startStackFixture, type StackFixture } from "./stackFixture";
import { fakeAgent } from "./codingFakes";
import { input, owner, person, settled, startRig } from "./codingRig";
import type { PersonRow } from "@/types";

let rig: ReturnType<typeof startRig>; let stack: StackFixture | null = null;
let upstream: Array<{ path: string; tier: string | null; auth: string | null }> = [];
beforeEach(() => {
  rig = startRig(); __resetRateLimiterForTests(); __resetCodeGateForTests(2); upstream = [];
  stack = startStackFixture({ "*": async (req) => {
    const path = new URL(req.url).pathname;
    if (req.method === "GET") return Response.json({ object: "list", data: [{ id: "qwen", role: "coding", context_length: 131072, thinking_budget_ceiling: 2000 }] });
    await req.json(); upstream.push({ path, tier: req.headers.get("x-maipai-coding-tier"), auth: req.headers.get("authorization") });
    return Response.json({ id: "msg_1", type: "message", role: "assistant", model: "qwen", content: [{ type: "text", text: "ok" }], usage: { input_tokens: 3, output_tokens: 2 } });
  } });
  __setStackClientForTests(stack.client);
});
afterEach(() => { __setStackClientForTests(null); stack?.stop(); stack = null; rig.restore(); });

const say = (secret: string, extra: Record<string, string> = {}) => app.request(new URL("/code/v1/messages", "https://home.example.com"), {
  method: "POST", headers: { host: "home.example.com", authorization: `Bearer ${secret}`, "content-type": "application/json", ...extra },
  body: JSON.stringify({ model: "claude-sonnet-x", max_tokens: 16, messages: [{ role: "user", content: "hi" }] }),
}, { server: { requestIP: () => ({ address: "10.0.0.20", family: "IPv4", port: 5000 }) } });
const outcome = (secret: string) => resolveApiKeyOutcome(secret, "code");
const asRole = (p: PersonRow, role: string) => { db.update(people).set({ role }).where(eq(people.id, p.id)).run(); invalidateSessionCacheForPerson(p.id); };
const fresh = (id: string) => db.select().from(people).where(eq(people.id, id)).get() as PersonRow;

describe("the per-session key", () => {
  test("it is a code key for one person and one session, never listed, never counted, and one is live at a time", () => {
    const a = owner(); const s = createCodingSession(a, input());
    const first = createSessionKey(a, s.id, 60 * 60_000);
    expect(first).toMatch(/^maipai_key_[a-z0-9]+_[A-Z2-7]{52}$/);
    const ok = outcome(first); expect(ok.ok && ok.person.id).toBe(a.id); expect(ok.ok && ok.key.sessionId).toBe(s.id);
    expect(listApiKeys(a)).toEqual([]); expect(listApiKeysForAdmin(a)).toEqual([]);
    expect(db.select().from(apiKeys).all()).toHaveLength(1);
    const second = createSessionKey(a, s.id, 60 * 60_000);
    expect(outcome(first).ok).toBe(false); expect(outcome(second).ok).toBe(true);
    expect(db.select().from(apiKeys).all().filter((r) => !r.revokedAt)).toHaveLength(1);
  });
  test("its life is capped, and a short ask is raised to a minute so it cannot be born expired", () => {
    const a = owner(); const s = createCodingSession(a, input());
    createSessionKey(a, s.id, 10 * 24 * 3_600_000);
    const row = db.select().from(apiKeys).get()!; expect(Date.parse(row.expiresAt) - Date.parse(row.createdAt)).toBeLessThanOrEqual(6 * 3_600_000 + 1000);
  });
  test("revoked, expired, wrong-secret and unknown keys are all the same refusal", () => {
    const a = owner(); const s = createCodingSession(a, input()); const secret = createSessionKey(a, s.id, 3_600_000);
    expect(outcome(secret).ok).toBe(true);
    expect(outcome(`${secret.slice(0, -2)}AA`)).toEqual({ ok: false, reason: "invalid" });
    expect(outcome(["maipai", "key", "nothere000", "A".repeat(61)].join("_"))).toEqual({ ok: false, reason: "invalid" });
    db.update(apiKeys).set({ expiresAt: new Date(Date.now() - 1000).toISOString() }).run();
    expect(outcome(secret)).toEqual({ ok: false, reason: "invalid" });
    db.update(apiKeys).set({ expiresAt: new Date(Date.now() + 3_600_000).toISOString() }).run();
    expect(revokeSessionKeys(s.id)).toBe(1); expect(outcome(secret)).toEqual({ ok: false, reason: "invalid" });
  });
  test("another person's session is invalid for the key's owner and for everyone else; a personal key has no session", () => {
    const a = owner(); const b = owner(); const sa = createCodingSession(a, input()); const sb = createCodingSession(b, input({ title: "B" }));
    const keyA = createSessionKey(a, sa.id, 3_600_000);
    const o = outcome(keyA); expect(o.ok && o.person.id).toBe(a.id); // it can only ever act as its own person
    expect(sessionTierForKey(a.id, sb.id, "standard")).toMatchObject({ ok: false, status: 401 }); // not their session
    expect(sessionTierForKey(b.id, sa.id, "standard")).toMatchObject({ ok: false, status: 401 });
    expect(sessionTierForKey(a.id, sa.id, "standard")).toMatchObject({ ok: true, tier: "standard" });
    const personal = createApiKey(b, { name: "Laptop", scopes: ["code"], expires_in_days: 7 }); const p = outcome(personal.secret);
    expect(p.ok && p.key.sessionId).toBeNull();
  });
  test("losing Coding access ends it at once: Coding off, a guest, a disabled person", () => {
    const a = person("adult"); const s = createCodingSession(a, input()); const secret = createSessionKey(a, s.id, 3_600_000);
    expect(outcome(secret).ok).toBe(true);
    setHouseholdSettingValue("coding.enabled", false); expect(outcome(secret)).toEqual({ ok: false, reason: "coding_off" }); setHouseholdSettingValue("coding.enabled", true);
    asRole(a, "guest"); expect(outcome(secret)).toEqual({ ok: false, reason: "not_allowed" }); asRole(a, "adult");
    db.update(people).set({ enabled: false }).where(eq(people.id, a.id)).run(); expect(outcome(secret)).toEqual({ ok: false, reason: "invalid" });
  });
  test("the person's own API-key switch does not block a session key, but it still blocks a personal key", () => {
    const a = person("adult"); const s = createCodingSession(a, input());
    const personal = createApiKey(a, { name: "Laptop", scopes: ["code"], expires_in_days: 7 }).secret; const secret = createSessionKey(a, s.id, 3_600_000);
    writeLayerRow(a.id, "coding.person.api_keys", "false");
    expect(outcome(secret).ok).toBe(true); expect(outcome(personal)).toEqual({ ok: false, reason: "keys_off" });
  });
  test("a person who may not hold keys cannot be minted one", () => {
    const a = person("adult"); const s = createCodingSession(a, input()); setHouseholdSettingValue("coding.enabled", false);
    expect(() => createSessionKey(a, s.id, 3_600_000)).toThrow(); expect(mintSessionKeyFor({ personId: a.id, sessionId: s.id })).toBeNull();
  });
});

describe("the key's life with the session", () => {
  test("a turn gets a key that works during the turn, never shows in the transcript, and is revoked when the turn ends", async () => {
    let secret = "";
    const agent = fakeAgent({ script: async (host) => { secret = mintSessionKeyFor({ personId: a.id, sessionId: s.id })!; host.emit({ kind: "text", text: `my key is ${secret}` }); expect(outcome(secret).ok).toBe(true); } });
    setCodingRuntime({ agent: agent.agent, sandbox: rig.sandbox.sandbox, lease: () => rig.lease });
    const a = owner(); const s = createCodingSession(a, input());
    const t = submitTurn(a, s.id, "go"); await settled(); agent.finishAll(); await turnFinished(t.turn_id);
    expect(secret).toMatch(/^maipai_key_/); expect(outcome(secret)).toEqual({ ok: false, reason: "invalid" });
    expect(JSON.stringify(listCodingMessages(a.id, s.id))).not.toContain(secret);
  });
  test("Stop and delete revoke the session's key", async () => {
    const a = owner(); const s = createCodingSession(a, input()); const k1 = createSessionKey(a, s.id, 3_600_000);
    stopCodingSession(a, s.id); expect(outcome(k1).ok).toBe(false);
    const k2 = createSessionKey(a, s.id, 3_600_000); await deleteCodingSession(a, s.id); expect(outcome(k2).ok).toBe(false);
  });
  test("the sandbox address is the sandbox network's gateway host on Home's port, with two overrides", () => {
    expect(sandboxGatewayUrl({ MAIPAI_PORT: "3000" } as never)).toMatch(/^http:\/\/192\.168\.128\.1:\d+\/code\/v1$/);
    expect(sandboxGatewayUrl({ MAIPAI_SANDBOX_GATEWAY_HOST: "192.0.2.9" } as never)).toMatch(/^http:\/\/192\.0\.2\.9:\d+\/code\/v1$/);
    expect(sandboxGatewayUrl({ MAIPAI_SANDBOX_GATEWAY_URL: "http://192.0.2.5:9/code/v1/" } as never)).toBe("http://192.0.2.5:9/code/v1");
  });
});

describe("the gateway honours the session's tier", () => {
  test("a session key's requests reach the Stack with the stored tier, and the tool cannot raise it", async () => {
    const boss = owner(); const s = createCodingSession(boss, input({ tier: "max" })); const secret = createSessionKey(boss, s.id, 3_600_000, "max");
    expect((await say(secret)).status).toBe(200); expect(upstream.at(-1)!.tier).toBe("max");
    const low = createCodingSession(person("adult"), input({ title: "Low" })); const lowOwner = fresh(low.person_id); const lowKey = createSessionKey(lowOwner, low.id, 3_600_000);
    expect((await say(lowKey, { "x-maipai-coding-tier": "max", "x-maipai-tier": "max" })).status).toBe(200);
    expect(upstream.at(-1)!.tier).toBe("standard"); // the header the tool sent is never read
    expect(upstream.at(-1)!.auth).toBeNull(); // the session key never goes on to the Stack
  });
  test("a removed grant lowers the request and corrects the stored tier", async () => {
    const boss = owner(); const s = createCodingSession(boss, input({ tier: "max" })); const secret = createSessionKey(boss, s.id, 3_600_000, "max");
    asRole(boss, "adult");
    expect((await say(secret)).status).toBe(200);
    expect(upstream.at(-1)!.tier).not.toBe("max"); // the key said Max, the grant is gone: it is clamped again, lower only
  });
  test("a level whose slot is off is refused with the not-offered copy, and nothing reaches the Stack", async () => {
    const a = person("adult"); const s = createCodingSession(a, input()); const secret = createSessionKey(a, s.id, 3_600_000);
    setHouseholdSettingValue("engines.coding.tier.standard", { model: "off", options: {} });
    const res = await say(secret); expect(res.status).toBe(403);
    expect(JSON.stringify(await res.json())).toContain(TIER_NOT_OFFERED_LINE.slice(0, 40)); expect(upstream).toEqual([]);
  });
  test("a revoked, expired, deleted-session or wrong-person key is the same 401 and reaches nothing", async () => {
    const a = owner(); const s = createCodingSession(a, input());
    const revoked = createSessionKey(a, s.id, 3_600_000); revokeSessionKeys(s.id); expect((await say(revoked)).status).toBe(401);
    const live = createSessionKey(a, s.id, 3_600_000); db.update(apiKeys).set({ expiresAt: new Date(Date.now() - 1000).toISOString() }).run(); expect((await say(live)).status).toBe(401);
    const k = createSessionKey(a, s.id, 3_600_000); await deleteCodingSession(a, s.id); expect((await say(k)).status).toBe(401);
    const bob = owner(); const sb = createCodingSession(bob, input({ title: "Bob" }));
    const bobKey = createSessionKey(bob, sb.id, 3_600_000); db.update(apiKeys).set({ sessionId: s.id }).where(eq(apiKeys.personId, bob.id)).run(); // a key pointed at someone else's session
    expect((await say(bobKey)).status).toBe(401); expect(upstream).toEqual([]);
  });
  test("a personal key is unchanged: no tier header is added", async () => {
    const a = person("adult"); const { secret } = createApiKey(a, { name: "Laptop", scopes: ["code"], expires_in_days: 7 });
    expect((await say(secret, { "x-maipai-coding-tier": "max" })).status).toBe(200); expect(upstream.at(-1)!.tier).toBeNull();
  });
});

describe("the key carries the turn's tier, not the stored one", () => {
  const keyFromExec = (env: Record<string, string> | undefined) => JSON.parse(env!.OPENCODE_CONFIG_CONTENT!).provider.maipai.options.apiKey as string;
  async function* ran(chunks: Array<{ exit: number }>) { for (const c of chunks) yield c; }
  test("Use Standard for this message: the turn's key says Standard, Max is never sent unleased, and the stored tier stays Max", async () => {
    const { createOpenCodeAgent } = await import("@/lib/codingOpencode"); const { chatLeaseHeldBy } = await import("@/lib/chatLease");
    const { useStandardForThisMessage } = await import("@/lib/codingTurns");
    const boss = owner(); const other = owner(); expect((await rig.lease.acquire(other)).ok).toBe(true); // someone else holds the Max lease
    let key = ""; let status = 0;
    const sandbox = { ...rig.sandbox.sandbox, snapshot: undefined, exec: (i: { env?: Record<string, string> }) => (async function* () { key = keyFromExec(i.env); status = (await say(key)).status; yield { exit: 0 } as const; })() } as never;
    setCodingRuntime({ agent: createOpenCodeAgent({ sandbox, gatewayUrl: () => "http://192.0.2.1:3000/code/v1", canMintKeys: () => true, sessionKey: async (w) => mintSessionKeyFor(w) }), sandbox, lease: () => rig.lease });
    const s = createCodingSession(boss, input({ tier: "max", mode: "auto_edit" }));
    const t = submitTurn(boss, s.id, "go"); await settled();
    expect(upstream).toEqual([]); // the Max turn is waiting; nothing reached the engine
    expect(useStandardForThisMessage(boss, t.turn_id)).toBe(true); await turnFinished(t.turn_id);
    expect(status).toBe(200); expect(upstream.at(-1)!.tier).toBe("standard");
    expect(chatLeaseHeldBy(boss.id)).toBe(false); expect(getCodingSession(fresh(boss.id), s.id)!.tier).toBe("max");
    expect(outcome(key)).toEqual({ ok: false, reason: "invalid" }); // revoked with the turn
  });
  test("a tier switched to Max in the middle of a Standard turn does not raise the turn's key", () => {
    const boss = owner(); const s = createCodingSession(boss, input());
    const key = createSessionKey(boss, s.id, 3_600_000, "standard");
    setSessionTier(boss, s.id, "max");
    const o = outcome(key); expect(o.ok && o.key.tier).toBe("standard");
    expect(sessionTierForKey(boss.id, s.id, "standard")).toMatchObject({ ok: true, tier: "standard" });
  });
  test("a key is dead after its session is deleted, and stays dead when the record is restored", async () => {
    const a = owner(); const s = createCodingSession(a, input()); const secret = createSessionKey(a, s.id, 3_600_000);
    expect((await say(secret)).status).toBe(200);
    await deleteCodingSession(a, s.id); expect((await say(secret)).status).toBe(401);
    const { codingSessions } = await import("@/db/schema");
    db.update(codingSessions).set({ deletedAt: null, trashUntil: null, state: "idle" }).where(eq(codingSessions.id, s.id)).run(); // the record comes back
    expect((await say(secret)).status).toBe(401); expect(outcome(secret)).toEqual({ ok: false, reason: "invalid" });
  });
});
