// THIN-7C (rule 12) and THIN-INC row 1: a temporary turn on the default path
// writes nothing durable. No turn row, no generation record (it rides on the
// turn row's stats), no memory, no episode, no summary job, no pending ask:
// the whole database is the same after the turn as before it. Incognito's
// guarantees (INCOGNITO-01/11, docs/plans/privacy-mode-2026-09-24.md).
import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test";
import { resetDb } from "../reset-db";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { __resetPortOwnershipForTests } from "@/lib/sidecars";
import { useDefaultScriptedStack } from "../stackFixture";
import { createBenchPeople, type BenchPeople } from "../../scripts/bench/conversationRunner";
import { setHouseholdSettingValue } from "@/lib/settings";
import { runTurnNext, runTurnNextStream } from "@/lib/turnMachine/turnNext";
import * as history from "@/lib/conversationHistory";
import { changedTables, tableCounts, withEngine } from "./modeHarness";

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

describe("THIN-7C: a temporary turn on the default path writes nothing durable", () => {
  test("a blocking temporary turn leaves every table as it found it", async () => {
    const before = tableCounts();
    const refresh = spyOn(history, "maybeRefreshConversationSummary");
    try {
      await withEngine(() => "Sure, here is a short answer.", async () => {
        const result = await runTurnNext(people.owner, "chat", "what should we cook on Friday", { temporary: true });
        expect(result.ok).toBe(true);
        await new Promise((r) => setTimeout(r, 200));
      });
      expect(refresh).toHaveBeenCalledTimes(0);
    } finally {
      refresh.mockRestore();
    }
    expect(changedTables(before, tableCounts())).toEqual([]);
  });

  test("a streamed temporary turn, a second turn in the same chat and a remember request leave every table as they found it", async () => {
    const before = tableCounts();
    await withEngine(() => "Okay, noted for this chat only.", async () => {
      const first = await runTurnNextStream(people.owner, "chat", "my favourite colour is green", { temporary: true });
      if (!first.ok || first.kind !== "stream") throw new Error("expected a stream result");
      let text = "";
      const tokens = first.tokens;
      for (;;) {
        const step = await tokens.next();
        if (step.done) { first.finalize(text.trim(), step.value); break; }
        text += step.value;
      }
      const second = await runTurnNext(people.owner, "chat", "remember that my favourite colour is green", { conversationId: first.conversationId });
      expect(second.ok).toBe(true);
      await new Promise((r) => setTimeout(r, 200));
    });
    expect(changedTables(before, tableCounts())).toEqual([]);
  });
});
