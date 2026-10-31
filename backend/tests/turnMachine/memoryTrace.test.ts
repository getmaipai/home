// MEM-AUDIT-05 (docs/design/memory-audit-and-redesign-2026-10-31.md,
// decision 8): every non-temporary turn records in its stats JSON which
// profile card lines and which recalled memories reached the prompt, by
// id and score, so "why did it say that" is answered from the turn row.
// The same scripted-engine harness the mode tests use (modeHarness.ts).
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { conversationTurns } from "@/db/schema";
import { resetDb } from "../reset-db";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { __resetPortOwnershipForTests } from "@/lib/sidecars";
import { useDefaultScriptedStack } from "../stackFixture";
import { createBenchPeople, type BenchPeople } from "../../scripts/bench/conversationRunner";
import { setHouseholdSettingValue } from "@/lib/settings";
import { runTurnNext } from "@/lib/turnMachine/turnNext";
import { remember, embedMemoryRecordSafely } from "@/lib/memory";
import type { TurnStats } from "@/wire";
import { withEngine } from "./modeHarness";

let people: BenchPeople;

beforeEach(() => {
  resetDb();
  useDefaultScriptedStack();
  __resetThrottleForTests();
  __resetLlmSupervisorForTests();
  __resetRateLimiterForTests();
  people = createBenchPeople();
  setHouseholdSettingValue("chat.model_id", "qwen3-8b-instruct-q4-k-m");
});

afterEach(() => {
  __resetLlmSupervisorForTests();
  __resetPortOwnershipForTests();
  delete process.env.MAIPAI_LLAMA_SERVER_URL;
});

function statsOf(turnId: string): TurnStats {
  const row = db.select({ stats: conversationTurns.stats }).from(conversationTurns).where(eq(conversationTurns.id, turnId)).get();
  if (!row?.stats) throw new Error(`turn ${turnId} has no stats row`);
  return JSON.parse(row.stats) as TurnStats;
}

describe("MEM-AUDIT-05: the turn row names what memory reached the prompt", () => {
  test("a turn with a profile card line and a recalled fact records both ids, the fact with its score", async () => {
    const identityText = "Sage is a software engineer who works from home";
    const factText = "Sage keeps the spare house key in the lockbox by the garage";
    const identity = remember(people.owner, { text: identityText, category: "identity", tier: "durable", scope: "person", person: people.owner.id, source: "test", importance: 0.9 });
    const fact = remember(people.owner, { text: factText, category: "fact", tier: "durable", scope: "person", person: people.owner.id, source: "test", importance: 0.5 });
    if (!identity.ok || !fact.ok) throw new Error("setup failed");
    await embedMemoryRecordSafely(identity.value.id, identityText);
    await embedMemoryRecordSafely(fact.value.id, factText);

    const result = await withEngine(() => "It is in the lockbox by the garage.", () => runTurnNext(people.owner, "chat", "where is the spare house key for the lockbox"));
    expect(result.ok).toBe(true);
    if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate result");
    const stats = statsOf(result.value.turn_id);
    expect(stats.memory?.profile).toEqual([identity.value.id]);
    const injected = stats.memory?.injected ?? [];
    expect(injected.map((m) => m.id)).toContain(fact.value.id);
    for (const m of injected) expect(typeof m.score).toBe("number");
    // Ids and scores only: the trace never carries the fact's words.
    expect(JSON.stringify(stats.memory)).not.toContain("lockbox");
    expect(JSON.stringify(stats.memory)).not.toContain("engineer");
  });

  test("a turn that injected nothing records empty arrays, never a missing field", async () => {
    const result = await withEngine(() => "Hello! How can I help?", () => runTurnNext(people.owner, "chat", "hi"));
    expect(result.ok).toBe(true);
    if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate result");
    expect(statsOf(result.value.turn_id).memory).toEqual({ profile: [], injected: [] });
  });
});
