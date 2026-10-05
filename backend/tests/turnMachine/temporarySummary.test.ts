// THIN-INC row 3 (rules 4 and 12; THIN-0G): no rolling-summary job is ever
// scheduled for a temporary chat, however long it runs. A long temporary
// chat is the case that would trigger a refresh on a durable one (turns
// falling out of the window); the durable control proves the scheduler is
// wired on this setup. Fakes only: a scripted engine, a sped-up debounce.
import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test";
import { resetDb } from "../reset-db";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { __resetPortOwnershipForTests } from "@/lib/sidecars";
import { useDefaultScriptedStack } from "../stackFixture";
import { createBenchPeople, type BenchPeople } from "../../scripts/bench/conversationRunner";
import { setHouseholdSettingValue } from "@/lib/settings";
import { runTurnNext } from "@/lib/turnMachine/turnNext";
import * as summaryRefresh from "@/lib/summaryRefresh";
import * as history from "@/lib/conversationHistory";
import { changedTables, tableCounts, withEngine } from "./modeHarness";

const DELAY_MS = 40;
const TURNS = 12;

let people: BenchPeople;

beforeEach(() => {
  resetDb();
  useDefaultScriptedStack();
  __resetThrottleForTests();
  __resetLlmSupervisorForTests();
  __resetRateLimiterForTests();
  people = createBenchPeople();
  setHouseholdSettingValue("chat.model_id", "qwen3-8b-instruct-q4-k-m");
  summaryRefresh.__setSummaryRefreshDelayForTests(DELAY_MS);
});

afterEach(() => {
  summaryRefresh.__setSummaryRefreshDelayForTests(null);
  __resetLlmSupervisorForTests();
  __resetPortOwnershipForTests();
  delete process.env.MAIPAI_LLAMA_SERVER_URL;
});

describe("THIN-INC row 3: summary refresh and a temporary chat", () => {
  test("durable control: a turn schedules a summary refresh", async () => {
    const schedule = spyOn(summaryRefresh, "scheduleSummaryRefresh");
    try {
      await withEngine(() => "Okay.", async () => {
        const result = await runTurnNext(people.owner, "chat", "hello there");
        expect(result.ok).toBe(true);
      });
      expect(schedule).toHaveBeenCalledTimes(1);
    } finally {
      schedule.mockRestore();
    }
  });

  test("temporary chat schedules no summary job", async () => {
    const schedule = spyOn(summaryRefresh, "scheduleSummaryRefresh");
    const refresh = spyOn(history, "maybeRefreshConversationSummary");
    const before = tableCounts();
    try {
      await withEngine(() => "Okay.", async (seen) => {
        let conversationId: string | undefined;
        for (let i = 0; i < TURNS; i++) {
          const result = await runTurnNext(people.owner, "chat", `message number ${i} about the garden`, { ...(conversationId ? { conversationId } : { temporary: true }) });
          expect(result.ok).toBe(true);
          if (result.ok) conversationId = result.value.conversation_id;
        }
        await new Promise((r) => setTimeout(r, DELAY_MS * 4));
        // No request carried the summary instruction: the background engine was never asked.
        expect(seen.some((request) => JSON.stringify(request.messages).includes("Update the summary of this conversation"))).toBe(false);
      });
      expect(schedule).toHaveBeenCalledTimes(0);
      expect(refresh).toHaveBeenCalledTimes(0);
    } finally {
      schedule.mockRestore();
      refresh.mockRestore();
    }
    expect(changedTables(before, tableCounts())).toEqual([]);
  });
});
