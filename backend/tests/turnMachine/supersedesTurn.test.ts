// THIN-7C (rule 12, getmaipai/home#60 and #88): an edited-and-resent message
// on the default path. The turn it replaces leaves the model's window, the
// memories extracted from it are not recalled (and are archived once the
// replacement is stored), a pending ask is cleared, and the new row records
// what it supersedes. An id that is not a turn of this conversation is
// dropped, never trusted: the reply is still given, as an ordinary turn.
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { eq } from "drizzle-orm";
import { resetDb } from "../reset-db";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { __resetPortOwnershipForTests } from "@/lib/sidecars";
import { useDefaultScriptedStack } from "../stackFixture";
import { createBenchPeople, type BenchPeople } from "../../scripts/bench/conversationRunner";
import { setHouseholdSettingValue } from "@/lib/settings";
import { runTurnNext, runTurnNextStream } from "@/lib/turnMachine/turnNext";
import { getPendingAsk, setPendingAsk } from "@/lib/conversationHistory";
import { remember } from "@/lib/memory";
import { db } from "@/db";
import { conversationTurns, memoryRecords } from "@/db/schema";
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

/** Two ordinary turns in one conversation; returns the ids. */
async function twoTurns(): Promise<{ conversationId: string; firstId: string; secondId: string }> {
  return withEngine(() => "Noted.", async () => {
    const first = await drainStream(await runTurnNextStream(people.owner, "chat", "we are painting the fence on Saturday", {}));
    const second = await drainStream(await runTurnNextStream(people.owner, "chat", "my favourite colour is green", { conversationId: first.value.conversation_id }));
    return { conversationId: first.value.conversation_id, firstId: first.value.turn_id, secondId: second.value.turn_id };
  });
}

function windowText(request: { messages: { content?: unknown }[] }): string {
  return request.messages.map((m) => String(m.content ?? "")).join("\n");
}

describe("THIN-7C: supersedes on the default path", () => {
  test("the turn being replaced is not in the model's window, the others are", async () => {
    const { conversationId, secondId } = await twoTurns();
    await withEngine(() => "Blue it is.", async (seen) => {
      const { value } = await drainStream(await runTurnNextStream(people.owner, "chat", "my favourite colour is blue", { conversationId, supersedes: secondId }));
      expect(value.reply.text).toBe("Blue it is.");
      const prompt = windowText(seen.at(-1)!);
      expect(prompt).not.toContain("my favourite colour is green");
      expect(prompt).toContain("we are painting the fence on Saturday");
      expect(prompt).toContain("my favourite colour is blue");
    });
  });

  test("without supersedes the same message sees the earlier turn (the control)", async () => {
    const { conversationId } = await twoTurns();
    await withEngine(() => "Blue it is.", async (seen) => {
      await drainStream(await runTurnNextStream(people.owner, "chat", "my favourite colour is blue", { conversationId }));
      expect(windowText(seen.at(-1)!)).toContain("my favourite colour is green");
    });
  });

  test("the stored row records the turn it replaces, and the blocking entry does the same", async () => {
    const { conversationId, firstId, secondId } = await twoTurns();
    await withEngine(() => "Blue it is.", async () => {
      const { value } = await drainStream(await runTurnNextStream(people.owner, "chat", "my favourite colour is blue", { conversationId, supersedes: secondId }));
      expect(db.select().from(conversationTurns).where(eq(conversationTurns.id, value.turn_id)).get()?.supersedes).toBe(secondId);
      const blocking = await runTurnNext(people.owner, "chat", "we are painting the fence on Sunday", { conversationId, supersedes: firstId });
      if (!blocking.ok || blocking.kind !== "immediate") throw new Error("expected an immediate result");
      expect(db.select().from(conversationTurns).where(eq(conversationTurns.id, blocking.value.turn_id)).get()?.supersedes).toBe(firstId);
    });
  });

  test("an id that is not a turn of this conversation is dropped, and the reply is still given", async () => {
    const { conversationId } = await twoTurns();
    const other = await withEngine(() => "Hi.", async () => drainStream(await runTurnNextStream(people.child, "chat", "a different conversation", {})));
    expect(other.value.conversation_id).not.toBe(conversationId);
    await withEngine(() => "Blue it is.", async (seen) => {
      for (const supersedes of ["turn-does-not-exist", other.value.turn_id]) {
        const { value } = await drainStream(await runTurnNextStream(people.owner, "chat", "my favourite colour is blue", { conversationId, supersedes }));
        expect(value.reply.text).toBe("Blue it is.");
        expect(db.select().from(conversationTurns).where(eq(conversationTurns.id, value.turn_id)).get()?.supersedes).toBeNull();
        expect(windowText(seen.at(-1)!)).toContain("my favourite colour is green");
      }
    });
  });

  test("a pending ask is cleared by an edit", async () => {
    const { conversationId, secondId } = await twoTurns();
    setPendingAsk(conversationId, { kind: "confirm", prompt: "Want me to go ahead?", packageId: "remember", args: {}, turnId: secondId });
    expect(getPendingAsk(conversationId)).not.toBeNull();
    await withEngine(() => "Blue it is.", async () => {
      await drainStream(await runTurnNextStream(people.owner, "chat", "my favourite colour is blue", { conversationId, supersedes: secondId }));
    });
    expect(getPendingAsk(conversationId)).toBeNull();
  });

  test("a memory taken from the replaced turn is not recalled for the edit, and is archived once the edit is stored", async () => {
    const { conversationId, secondId } = await twoTurns();
    const stale = remember(people.owner, { text: "Sage's favourite colour is green", category: "fact", tier: "durable", scope: "person", person: people.owner.id, source: secondId, importance: 0.9 });
    if (!stale.ok) throw new Error("seed failed");
    await withEngine(() => "Blue it is.", async (seen) => {
      await drainStream(await runTurnNextStream(people.owner, "chat", "what is my favourite colour", { conversationId }));
      expect(windowText(seen.at(-1)!)).toContain("Sage's favourite colour is green");
      await drainStream(await runTurnNextStream(people.owner, "chat", "what is my favourite colour", { conversationId, supersedes: secondId }));
      expect(windowText(seen.at(-1)!)).not.toContain("Sage's favourite colour is green");
    });
    expect(db.select().from(memoryRecords).where(eq(memoryRecords.id, stale.value.id)).get()?.status).toBe("archived");
  });
});
