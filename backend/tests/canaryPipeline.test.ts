// CANARY-01: the real chat pipeline as the health actor, on a scripted engine. Proves the probe sees tool calls and that a
// run leaves no residue in the database.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { resetDb } from "./reset-db";
import { db } from "@/db";
import { useDefaultScriptedStack } from "./stackFixture";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { chatProbe } from "@/lib/canary/probes";
import { isTemporaryConversation } from "@/lib/conversationHistory";
import { failWeather, replies, script, withStub } from "./turnMachine/toolHarness";

beforeEach(() => {
  resetDb();
  useDefaultScriptedStack();
  __resetThrottleForTests();
  __resetLlmSupervisorForTests();
  __resetRateLimiterForTests();
});
afterEach(() => { __resetLlmSupervisorForTests(); delete process.env.MAIPAI_LLAMA_SERVER_URL; });

function rowCounts(): Record<string, number> {
  const client = (db as unknown as { $client: { query(sql: string): { all(): Array<Record<string, unknown>> } } }).$client;
  const tables = client.query("select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name not like '%_fts%'").all().map((r) => String(r.name));
  const out: Record<string, number> = {};
  for (const name of tables) {
    try { out[name] = Number(client.query(`select count(*) as n from "${name}"`).all()[0]!.n); } catch { /* a virtual table */ }
  }
  return out;
}

test("hello through the real pipeline answers, and the run leaves no residue", async () => {
  const before = rowCounts();
  await withStub({ calls: () => undefined, reply: () => "Hello! How can I help?" }, async () => {
    const probe = await chatProbe({ text: "hi", timeoutMs: 30_000 });
    expect(probe.ok).toBe(true);
    expect(probe.text.length).toBeGreaterThan(0);
    expect(probe.firstTokenMs).not.toBeNull();
    expect(probe.toolCalls).toEqual([]);
  });
  await new Promise((r) => setTimeout(r, 50));
  expect(rowCounts()).toEqual(before);
});

test("a weather tool call is seen by the probe, and a failed tool is reported as an error, not a crash", async () => {
  const weather = failWeather();
  try {
    await withStub({ calls: script(), reply: replies }, async () => {
      const before = rowCounts();
      const probe = await chatProbe({ text: "What's the weather in Oslo right now?", timeoutMs: 30_000 });
      expect(probe.toolCalls).toContain("weather");
      expect(probe.toolErrors).toContain("weather");
      expect(probe.text.length).toBeGreaterThan(0);
      await new Promise((r) => setTimeout(r, 50));
      expect(rowCounts()).toEqual(before);
    });
  } finally { weather.spy.mockRestore(); }
});

test("a picture turn reads the built-in picture from process memory and leaves nothing behind", async () => {
  const before = rowCounts();
  await withStub({ calls: () => undefined, reply: () => "Red." }, async () => {
    const probe = await chatProbe({ text: "What colour is this picture? Answer in one word.", picture: true, timeoutMs: 30_000 });
    expect(probe.ok).toBe(true);
  });
  await new Promise((r) => setTimeout(r, 50));
  expect(rowCounts()).toEqual(before);
  expect(isTemporaryConversation("none")).toBe(false);
});
