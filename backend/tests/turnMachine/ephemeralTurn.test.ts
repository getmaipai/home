// THIN-7C (rule 12, getmaipai/home#91 and #102): an ephemeral turn on the
// default path. The Home page's weather card asks one fixed question nobody
// typed; it goes through the same model, safety and reply path as a typed
// message but never becomes a chat-history row, a memory, an episode, a
// summary job or a parked ask. (routes/turn.ts honours the flag only for that
// exact question; that check stays at the route.)
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
import { db } from "@/db";
import { conversationTurns } from "@/db/schema";
import { drainStream, withEngine } from "./modeHarness";

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

const QUESTION = "What is the weather like today?";

describe("THIN-7C: an ephemeral turn on the default path", () => {
  test("the reply is given and no turn row is written, streamed or blocking", async () => {
    const refresh = spyOn(history, "maybeRefreshConversationSummary");
    try {
      await withEngine(() => "Sunny and mild.", async () => {
        const streamed = await drainStream(await runTurnNextStream(people.owner, "chat", QUESTION, { ephemeral: true }));
        expect(streamed.value.reply.text).toBe("Sunny and mild.");
        const blocking = await runTurnNext(people.owner, "chat", QUESTION, { ephemeral: true });
        expect(blocking.ok).toBe(true);
        await new Promise((r) => setTimeout(r, 200));
      });
      expect(db.select().from(conversationTurns).all()).toEqual([]);
      expect(refresh).toHaveBeenCalledTimes(0);
    } finally {
      refresh.mockRestore();
    }
  });

  test("the same text without the flag is stored (the control)", async () => {
    await withEngine(() => "Sunny and mild.", async () => {
      await drainStream(await runTurnNextStream(people.owner, "chat", QUESTION, {}));
    });
    expect(db.select().from(conversationTurns).all()).toHaveLength(1);
  });

  test("a document is refused for an ephemeral turn, as for a temporary one", async () => {
    await expect(runTurnNextStream(people.owner, "chat", QUESTION, { ephemeral: true, documentAttachments: [{ name: "a.pdf", mediaType: "application/pdf", data: "data:application/pdf;base64,eA==" }] })).rejects.toThrow("Documents cannot be attached in a temporary chat");
  });
});
