// THIN-0G (rule 12, rule 4): the default path schedules the rolling
// summary refresh the way the old path does (one debounced refresh per
// conversation on the background engine), so a long conversation does not
// lose what fell out of the window. Mirrors conversationHistory.test.ts's
// own refresh test (real timer, sped-up delay) on the default path's entry
// point, and turnNext.test.ts's setup.
import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test";
import { resetDb } from "../reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { useDefaultScriptedStack } from "../stackFixture";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { __resetPortOwnershipForTests } from "@/lib/sidecars";
import { createBenchPeople, startRecordingProxy, type BenchPeople } from "../../scripts/bench/conversationRunner";
import type { ChatCompletionRequest } from "@maipai/spec/llm/ts/types.js";
import { setHouseholdSettingValue } from "@/lib/settings";
import { runTurnNext } from "@/lib/turnMachine/turnNext";
import { __setSummaryRefreshDelayForTests } from "@/lib/summaryRefresh";
import * as history from "@/lib/conversationHistory";
import { getConversation, logTurn, resolveOrCreateConversation } from "@/lib/conversationHistory";
import type { TurnValue } from "@/wire";
import type { PersonRow } from "@/types";
import { db } from "@/db";
import { conversationTurns } from "@/db/schema";
import { eq } from "drizzle-orm";

const SAFE: TurnValue["safety"] = { flagged: false, categories: [], action: "allow", notify_parent: false, matched_signals: [], checked_at: new Date().toISOString() };
const DELAY_MS = 150;

let people: BenchPeople;

beforeEach(() => {
  resetDb();
  useDefaultScriptedStack();
  __resetThrottleForTests();
  __resetLlmSupervisorForTests();
  __resetRateLimiterForTests();
  people = createBenchPeople();
  setHouseholdSettingValue("chat.model_id", "qwen3-8b-instruct-q4-k-m");
  __setSummaryRefreshDelayForTests(DELAY_MS);
});

afterEach(() => {
  __setSummaryRefreshDelayForTests(null);
  __resetLlmSupervisorForTests();
  __resetPortOwnershipForTests();
  delete process.env.MAIPAI_LLAMA_SERVER_URL;
});

/** One scripted engine behind the default scripted Stack (the chat and
 * background roles share it in this suite, as turnNext.test.ts does):
 * answers the turn, and records every summary prompt it is sent. */
async function withEngines<T>(fn: (summaryPrompts: string[]) => Promise<T>): Promise<T> {
  const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
  const summaryPrompts: string[] = [];
  const stub = startStubLlmServer(0, {
    scriptedChatReply: (request: ChatCompletionRequest) => {
      const joined = JSON.stringify(request.messages);
      if (joined.includes("Update the summary of this conversation")) {
        summaryPrompts.push(joined);
        return "They talked about the garden and the dentist.";
      }
      return "Hello! How can I help?";
    },
  });
  const proxy = startRecordingProxy(stub.url);
  process.env.MAIPAI_LLAMA_SERVER_URL = proxy.url;
  __resetLlmSupervisorForTests();
  try {
    return await fn(summaryPrompts);
  } finally {
    proxy.stop();
    await stub.stop();
  }
}

function seedTurns(actor: PersonRow, conversationId: string, count: number, userText: (i: number) => string = (i) => `message number ${i}`): void {
  for (let i = 0; i < count; i++) {
    logTurn(actor, "chat", userText(i), { reply: { text: `reply number ${i}` }, source: "model", safety: SAFE, conversation_id: conversationId, turn_id: `turn-seed-${i}` });
  }
}

function seededConversation(userText?: (i: number) => string) {
  const conv = resolveOrCreateConversation(people.owner, "chat");
  if (!conv.ok) throw new Error(conv.error);
  seedTurns(people.owner, conv.value.id, 8, userText);
  return conv.value;
}

describe("THIN-0G: the default path schedules the rolling summary refresh", () => {
  test("turns that fell out of the window get one debounced refresh on the background engine", async () => {
    const conv = seededConversation();
    const refresh = spyOn(history, "maybeRefreshConversationSummary");
    try {
      await withEngines(async () => {
        const first = await runTurnNext(people.owner, "chat", "one more, still active", { conversationId: conv.id });
        expect(first.ok).toBe(true);
        // Debounced, not inline: nothing has run when the turn resolves.
        expect(refresh).toHaveBeenCalledTimes(0);
        const early = getConversation(people.owner, conv.id);
        if (!early.ok) throw new Error(early.error);
        expect(early.value.summary).toBeNull();
        // A newer turn behind it cancels the first timer: one refresh in total.
        await runTurnNext(people.owner, "chat", "and one right behind it", { conversationId: conv.id });
        await new Promise((r) => setTimeout(r, DELAY_MS * 4));
        expect(refresh).toHaveBeenCalledTimes(1);
        const row = getConversation(people.owner, conv.id);
        if (!row.ok) throw new Error(row.error);
        expect(row.value.summary).not.toBeNull();
      });
    } finally {
      refresh.mockRestore();
    }
  });

  test("a temporary turn schedules no refresh", async () => {
    const refresh = spyOn(history, "maybeRefreshConversationSummary");
    try {
      await withEngines(async () => {
        const result = await runTurnNext(people.owner, "chat", "hello there", { temporary: true });
        expect(result.ok).toBe(true);
        await new Promise((r) => setTimeout(r, DELAY_MS * 3));
        expect(refresh).toHaveBeenCalledTimes(0);
      });
    } finally {
      refresh.mockRestore();
    }
  });

  test("credential text in the older turns never reaches the summary prompt", async () => {
    const value = `Jun${"i".repeat(2)}per${20}26`;
    const conv = seededConversation();
    // Written past logTurn()'s redaction, the way a row from before the policy sits (conversationHistory.test.ts, CHAT-03).
    db.update(conversationTurns).set({ userText: `the wifi password is ${value}`, replyText: `Got it, your wifi password is ${value}.` }).where(eq(conversationTurns.id, "turn-seed-0")).run();
    await withEngines(async (summaryPrompts) => {
      await runTurnNext(people.owner, "chat", "keep going", { conversationId: conv.id });
      await new Promise((r) => setTimeout(r, DELAY_MS * 4));
      expect(summaryPrompts.length).toBeGreaterThan(0);
      expect(summaryPrompts.join("")).not.toContain(value);
    });
  });
});
