import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { db } from "@/db";
import { people } from "@/db/schema";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { __setResumeTtlForTests, RESUME_TTL_MS } from "@/routes/turn";
import { engineHealRetryAllowed, waitForEngineHeal } from "@/lib/turnMachine/nodes/model";
import { __setRoleHealthForTests } from "@/lib/roleHealth";

// TURN-TTL-01: the resume TTL starts when a turn ENDS. It never aborts a running turn, so a slow engine is
// not "cancelled" at the TTL (RULES.md rule 5, DEADLINE-02). The TTL is shortened to 150 ms here and the
// engine's first token is 600 ms away, which is the same ordering as 60 s against a 75 s first token.

beforeEach(() => {
  resetDb();
  __resetThrottleForTests();
  __resetRateLimiterForTests();
});

afterEach(() => {
  __setResumeTtlForTests(null);
  __setRoleHealthForTests({});
  __resetLlmSupervisorForTests();
  delete process.env.MAIPAI_LLAMA_SERVER_URL;
});

async function owner(): Promise<TestClient> {
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  expect(db.select().from(people).where(eq(people.displayName, "Sage")).get()).toBeTruthy();
  return client;
}

async function withSlowEngine<T>(firstTokenMs: number, reply: string, fn: () => Promise<T>): Promise<T> {
  __resetLlmSupervisorForTests();
  const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
  const stub = startStubLlmServer(0, { scriptedChatReply: async () => { await new Promise((r) => setTimeout(r, firstTokenMs)); return reply; } });
  process.env.MAIPAI_LLAMA_SERVER_URL = stub.url;
  try {
    return await fn();
  } finally {
    await stub.stop();
  }
}

async function ndjson(res: Response): Promise<Array<Record<string, unknown>>> {
  return (await res.text()).split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
}

describe("TURN-TTL-01: the resume TTL does not cap a running turn", () => {
  test("the shipped TTL is 60 seconds", () => {
    expect(RESUME_TTL_MS).toBe(60_000);
  });

  test("an adult's turn whose first token is later than the TTL is not cancelled and completes", async () => {
    __setResumeTtlForTests(150);
    const client = await owner();
    await withSlowEngine(600, "Here is the slow answer.", async () => {
      const res = await client.post("/api/turn/stream", { text: "a slow question, take your time" });
      const events = await ndjson(res);
      expect(events.some((e) => e.type === "error")).toBe(false);
      expect(events.filter((e) => e.type === "done")).toHaveLength(1);
    });
  }, 15_000);

  test("a finished turn stays resumable inside the TTL", async () => {
    __setResumeTtlForTests(150);
    const client = await owner();
    await withSlowEngine(0, "Quick answer. Second sentence.", async () => {
      const res = await client.post("/api/turn/stream", { text: "a quick question" });
      const reader = res.body!.getReader();
      const first = JSON.parse(new TextDecoder().decode((await reader.read()).value).split("\n")[0]!) as Record<string, unknown>;
      expect(first.type).toBe("turn_meta");
      // Leave without reading the end, as a dropped client does; the turn finishes in the background.
      await reader.cancel();
      await new Promise((r) => setTimeout(r, 100));
      const early = await client.post("/api/turn/stream", { conversation_id: first.conversation_id, turn_id: first.turn_id, resume_token: first.resume_token, resume_from: 0 });
      expect(early.status).toBe(200);
      await early.text();
    });
  }, 15_000);

  test("a finished, undelivered turn expires after the TTL", async () => {
    __setResumeTtlForTests(150);
    const client = await owner();
    await withSlowEngine(0, "Quick answer.", async () => {
      const res = await client.post("/api/turn/stream", { text: "a quick question" });
      const reader = res.body!.getReader();
      const first = JSON.parse(new TextDecoder().decode((await reader.read()).value).split("\n")[0]!) as Record<string, unknown>;
      await reader.cancel();
      await new Promise((r) => setTimeout(r, 600));
      const late = await client.post("/api/turn/stream", { conversation_id: first.conversation_id, turn_id: first.turn_id, resume_token: first.resume_token, resume_from: 0 });
      expect(late.status).toBe(503);
      expect(await late.json()).toMatchObject({ code: "turn_resume_unavailable" });
    });
  }, 15_000);

  test("a client Stop still cancels a slow turn", async () => {
    __setResumeTtlForTests(150);
    const client = await owner();
    await withSlowEngine(5_000, "never seen", async () => {
      const res = await client.post("/api/turn/stream", { text: "a slow question I will stop" });
      const reader = res.body!.getReader();
      const first = JSON.parse(new TextDecoder().decode((await reader.read()).value).split("\n")[0]!) as Record<string, unknown>;
      await new Promise((r) => setTimeout(r, 400));
      const cancel = await client.post(`/api/turn/${first.turn_id}/cancel`, {});
      expect(await cancel.json()).toEqual({ cancelled: true });
      let tail = "";
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        tail += new TextDecoder().decode(next.value);
      }
      const events = tail.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as Record<string, unknown>);
      expect(events.at(-1)).toMatchObject({ type: "error", code: "turn_cancelled" });
    });
  }, 15_000);
});

describe("TURN-TTL-01: a lost engine that heals is retried once", () => {
  test("only an uncapped reply with nothing shown and no Stop retries", () => {
    expect(engineHealRetryAllowed({ ok: false }, false, true)).toBe(true);
    expect(engineHealRetryAllowed({ ok: false, released: true }, false, true)).toBe(false);
    expect(engineHealRetryAllowed({ ok: false }, true, true)).toBe(false);
    expect(engineHealRetryAllowed({ ok: false }, false, false)).toBe(false);
    expect(engineHealRetryAllowed({ ok: true }, false, true)).toBe(false);
  });

  test("the wait ends true when the chat role comes back, false when the wait runs out or the turn stops", async () => {
    __setRoleHealthForTests({ chat: { availability: "unavailable", reason: "stack_unreachable" } as never });
    setTimeout(() => __setRoleHealthForTests({ chat: { availability: "ready" } as never }), 120);
    expect(await waitForEngineHeal(new AbortController().signal, 2_000, 30)).toBe(true);
    __setRoleHealthForTests({ chat: { availability: "unavailable", reason: "stack_unreachable" } as never });
    expect(await waitForEngineHeal(new AbortController().signal, 150, 30)).toBe(false);
    const stop = new AbortController();
    setTimeout(() => stop.abort(), 50);
    expect(await waitForEngineHeal(stop.signal, 2_000, 30)).toBe(false);
  });
});
