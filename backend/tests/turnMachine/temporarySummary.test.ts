// THIN-INC row 3 as amended by THIN-3F (rules 4 and 12): a temporary chat
// folds like any other (one window builder, a conversation never fails
// because it is long), but in its session only: no table changes and no
// log line names it. The durable control proves the scheduler is wired on
// this setup. Fakes only: a scripted engine, a sped-up debounce.
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

  test("a long temporary chat folds in its session only: the summary is in memory, no table changes, no log names it", async () => {
    const logged: string[] = [];
    const log = spyOn(console, "log").mockImplementation((...args: unknown[]) => { logged.push(args.map(String).join(" ")); });
    const warn = spyOn(console, "warn").mockImplementation((...args: unknown[]) => { logged.push(args.map(String).join(" ")); });
    const before = tableCounts();
    let conversationId: string | undefined;
    try {
      await withEngine((request) => (JSON.stringify(request.messages).includes("You keep notes on a conversation") ? "People and facts:\nThe person is planning a garden.\nDecisions:\nnone\nOpen questions:\nnone\nCommitments:\nnone\nTone:\nfriendly" : "Okay."), async (seen) => {
        for (let i = 0; i < TURNS; i++) {
          const result = await runTurnNext(people.owner, "chat", `message number ${i} about the garden`, { ...(conversationId ? { conversationId } : { temporary: true }) });
          expect(result.ok).toBe(true);
          if (result.ok) conversationId = result.value.conversation_id;
          await new Promise((r) => setTimeout(r, DELAY_MS * 3));
        }
        expect(seen.some((request) => JSON.stringify(request.messages).includes("You keep notes on a conversation"))).toBe(true);
      });
    } finally {
      log.mockRestore();
      warn.mockRestore();
    }
    const record = history.getConversation(people.owner, conversationId!);
    if (!record.ok) throw new Error(record.error);
    expect(record.value.mode).toBe("temporary");
    expect(record.value.summary).toContain("planning a garden");
    expect(record.value.summary_through_turn).not.toBeNull();
    expect(changedTables(before, tableCounts())).toEqual([]);
    expect(logged.filter((line) => line.includes(conversationId!))).toEqual([]);
  });
});
