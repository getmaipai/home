// NAT-07a: the runner seams the opening rows use (a dated person-scope record archived by the hub's own
// maintenance, a backdated earlier conversation, a temporary conversation, the child as speaker), proven
// against the stub so the bench's own logic is checked before a model is involved.
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { resetDb } from "./reset-db";
import { db } from "@/db";
import { conversations, memoryRecords } from "@/db/schema";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { runConversation, createBenchPeople, cleanupBenchPeople, backdateBenchRows, captureTurnLog, startRecordingProxy } from "../scripts/bench/conversationRunner";
import type { RegisterRow } from "../scripts/bench/registerScore";

const rows = JSON.parse(readFileSync(join(import.meta.dir, "../scripts/bench/datasets/register-corpus.json"), "utf8")) as RegisterRow[];

beforeEach(() => {
  resetDb();
  __resetThrottleForTests();
  __resetLlmSupervisorForTests();
  __resetRateLimiterForTests();
});
afterEach(() => {
  __resetLlmSupervisorForTests();
  delete process.env.MAIPAI_LLAMA_SERVER_URL;
});

async function runRow(id: string) {
  const row = rows.find((r) => r.id === id)!;
  const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
  const stub = startStubLlmServer(0, {});
  const proxy = startRecordingProxy(stub.url);
  process.env.MAIPAI_LLAMA_SERVER_URL = proxy.url;
  const log = captureTurnLog();
  const people = createBenchPeople();
  try {
    const run = await runConversation({
      id: `register-${row.id}`,
      category: "knowledge",
      seedRecords: row.datedSeed!.map((d) => ({ text: d.text, category: d.category, scope: "person" as const, validToDaysAgo: d.validToDaysAgo, forChild: d.forChild })),
      turns: row.utterances.map((say, i) => ({ say, ...(row.turns?.[i] ?? {}), expect: {} })),
    }, { people, proxy, log, drainJudge: async () => {}, backdate: (days, ids) => backdateBenchRows(people, days, ids), homeAssistant: null });
    return { row, run, people };
  } finally {
    log.stop();
    proxy.stop();
    await stub.stop();
  }
}

describe("NAT-07a runner seams", () => {
  test("the dated record is archived with its end date in the past, for the owner", async () => {
    const { people } = await runRow("opening_thread_greeting");
    try {
      const rec = db.select().from(memoryRecords).where(eq(memoryRecords.person, people.owner.id)).all().find((r) => r.text.includes("interview"))!;
      expect(rec.status).toBe("archived");
      expect(new Date(rec.validTo!).getTime()).toBeLessThan(Date.now());
    } finally {
      cleanupBenchPeople(people);
    }
  });
  test("the second conversation is a new one after the backdated gap", async () => {
    const { run, people } = await runRow("opening_thread_greeting");
    try {
      expect(run.scores.length).toBe(2);
      const convs = db.select().from(conversations).where(eq(conversations.personId, people.owner.id)).all();
      expect(convs.length).toBe(2);
      const times = convs.map((c) => new Date(c.createdAt).getTime()).sort();
      expect(Date.now() - times[0]!).toBeGreaterThanOrEqual(3 * 86_400_000 - 60_000);
    } finally {
      cleanupBenchPeople(people);
    }
  });
  test("the child row seeds the record for the child, never the owner", async () => {
    const { people } = await runRow("opening_thread_child_never");
    try {
      const mine = (id: string) => db.select().from(memoryRecords).where(eq(memoryRecords.person, id)).all().filter((r) => r.text.includes("spelling test"));
      expect(mine(people.child.id).length).toBe(1);
      expect(mine(people.owner.id).length).toBe(0);
    } finally {
      cleanupBenchPeople(people);
    }
  });
  test("the Incognito row's second conversation is temporary and leaves no stored turn", async () => {
    const { run, people } = await runRow("opening_thread_incognito_never");
    try {
      expect(run.scores.length).toBe(2);
      const convs = db.select().from(conversations).where(eq(conversations.personId, people.owner.id)).all();
      expect(convs.length).toBe(1);
    } finally {
      cleanupBenchPeople(people);
    }
  });
});
