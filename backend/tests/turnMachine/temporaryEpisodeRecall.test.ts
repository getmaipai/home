// THIN-INC row 2 (rules 0, 4, 12; INCOGNITO-02): a temporary chat reads no
// episode recall into the model's context. An earlier durable conversation
// holds the very words the temporary turn asks about; the durable control
// proves the recall works on this setup, so the temporary silence is the
// gate and not an empty store. Fakes only: a scripted engine, no network.
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
import { createConversation, logTurn } from "@/lib/conversationHistory";
import * as episodes from "@/lib/episodes";
import type { TurnValue } from "@/wire";
import { changedTables, tableCounts, withEngine } from "./modeHarness";

const SAFE: TurnValue["safety"] = { flagged: false, categories: [], action: "allow", notify_parent: false, matched_signals: [], checked_at: new Date().toISOString() };
const SAID = "my dentist appointment is on the fourteenth at nine";
const ASK = "when is my dentist appointment";

let people: BenchPeople;

beforeEach(() => {
  resetDb();
  useDefaultScriptedStack();
  __resetThrottleForTests();
  __resetLlmSupervisorForTests();
  __resetRateLimiterForTests();
  people = createBenchPeople();
  setHouseholdSettingValue("chat.model_id", "qwen3-8b-instruct-q4-k-m");
  const earlier = createConversation(people.owner, { surface: "chat" });
  if (!earlier.ok) throw new Error(earlier.error);
  logTurn(people.owner, "chat", SAID, { reply: { text: "Noted." }, source: "model", safety: SAFE, conversation_id: earlier.value.id, turn_id: "turn-earlier-1" });
});

afterEach(() => {
  __resetLlmSupervisorForTests();
  __resetPortOwnershipForTests();
  delete process.env.MAIPAI_LLAMA_SERVER_URL;
});

describe("THIN-INC row 2: episode recall and a temporary chat", () => {
  test("durable control: the same ask recalls the earlier episode into the prompt", async () => {
    const recall = spyOn(episodes, "recallEpisodes");
    try {
      await withEngine(() => "On the fourteenth.", async (seen) => {
        const now = createConversation(people.owner, { surface: "chat" });
        if (!now.ok) throw new Error(now.error);
        const result = await runTurnNext(people.owner, "chat", ASK, { conversationId: now.value.id });
        expect(result.ok).toBe(true);
        expect(recall).toHaveBeenCalled();
        expect(JSON.stringify(seen[0]?.messages)).toContain(SAID);
      });
    } finally {
      recall.mockRestore();
    }
  });

  test("temporary chat reads no episode recall", async () => {
    const recall = spyOn(episodes, "recallEpisodes");
    const before = tableCounts();
    try {
      await withEngine(() => "I don't have that in this chat.", async (seen) => {
        const first = await runTurnNext(people.owner, "chat", ASK, { temporary: true });
        expect(first.ok).toBe(true);
        if (!first.ok) return;
        // A second turn in the same temporary chat, which also asks what was said before.
        const second = await runTurnNext(people.owner, "chat", "what did I say about the dentist before", { conversationId: first.value.conversation_id });
        expect(second.ok).toBe(true);
        expect(seen.length).toBeGreaterThanOrEqual(2);
        for (const request of seen) expect(JSON.stringify(request.messages)).not.toContain(SAID);
        await new Promise((r) => setTimeout(r, 200));
      });
      expect(recall).toHaveBeenCalledTimes(0);
    } finally {
      recall.mockRestore();
    }
    // And it writes no episode from the temporary turns.
    expect(changedTables(before, tableCounts())).toEqual([]);
  });
});
