// THIN-7C (rule 12): a continuation on the default path. The person asks the
// model to carry on an answer that stopped short; the client sends the partial
// text. The model gets the conversation (without the partial turn), the
// message, the partial as the assistant's own words with credentials redacted,
// and one instruction to continue; no tool is offered, no command fires; the
// stored turn records which turn it continued; the output gate runs as ever.
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
import { runTurnNextStream } from "@/lib/turnMachine/turnNext";
import { StreamSafetyRefusal } from "@/lib/turnShared";
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

const PARTIAL = "To repot a fern: first loosen the root ball, then";
const INSTRUCTION = "Continue the incomplete answer above. Do not repeat any text already given. Start at the first missing point and finish the answer clearly.";

/** A turn whose reply stopped short; returns its ids. */
async function stoppedShort(): Promise<{ conversationId: string; turnId: string }> {
  return withEngine(() => PARTIAL, async () => {
    const { value } = await drainStream(await runTurnNextStream(people.owner, "chat", "how do I repot a fern", {}));
    return { conversationId: value.conversation_id, turnId: value.turn_id };
  });
}

describe("THIN-7C: continuation on the default path", () => {
  test("the model sees the history without the partial turn, the message, the partial as its own words, then the instruction; no tool is offered", async () => {
    const { conversationId, turnId } = await stoppedShort();
    await withEngine(() => "tuck in fresh soil and water it well.", async (seen) => {
      const { value } = await drainStream(await runTurnNextStream(people.owner, "chat", "continue", { conversationId, continuation: { fromTurnId: turnId, assistantText: PARTIAL } }));
      expect(value.reply.text).toBe("tuck in fresh soil and water it well.");
      const request = seen.at(-1)!;
      const tail = request.messages.slice(-3).map((m) => ({ role: m.role, content: String(m.content ?? "") }));
      expect(tail[0]?.role).toBe("user");
      expect(tail[0]?.content).toStartWith("Context for this turn (background data first; the person's words follow):");
      expect(tail[0]?.content).toContain("How to answer this one:");
      expect(tail[0]?.content).toEndWith("The person's words:\ncontinue");
      expect(tail.slice(1)).toEqual([
        { role: "assistant", content: PARTIAL },
        { role: "user", content: INSTRUCTION },
      ]);
      // The partial turn is replaced by the assistant message above, never repeated in the window.
      expect(request.messages.filter((m) => String(m.content ?? "").includes("how do I repot a fern")).length).toBe(0);
      expect(request.tools ?? []).toEqual([]);
    });
  });

  test("an ordinary turn in the same conversation does offer tools (the control)", async () => {
    const { conversationId } = await stoppedShort();
    await withEngine(() => "Okay.", async (seen) => {
      await drainStream(await runTurnNextStream(people.owner, "chat", "thanks", { conversationId }));
      expect((seen.at(-1)!.tools ?? []).length).toBeGreaterThan(0);
    });
  });

  test("the stored turn and the reply value record which turn it continued", async () => {
    const { conversationId, turnId } = await stoppedShort();
    await withEngine(() => "tuck in fresh soil.", async () => {
      const { value } = await drainStream(await runTurnNextStream(people.owner, "chat", "continue", { conversationId, continuation: { fromTurnId: turnId, assistantText: PARTIAL } }));
      expect(value.continued_from_turn_id).toBe(turnId);
      expect(db.select().from(conversationTurns).where(eq(conversationTurns.id, value.turn_id)).get()?.status).toBe("done");
    });
  });

  test("a continued turn that is not one of this conversation's is not recorded, and the reply is still given", async () => {
    const { conversationId } = await stoppedShort();
    await withEngine(() => "tuck in fresh soil.", async () => {
      const { value } = await drainStream(await runTurnNextStream(people.owner, "chat", "continue", { conversationId, continuation: { fromTurnId: "turn-does-not-exist", assistantText: PARTIAL } }));
      expect(value.reply.text).toBe("tuck in fresh soil.");
      expect(value.continued_from_turn_id ?? null).toBeNull();
    });
  });

  test("a command phrase does not fire during a continuation", async () => {
    const { conversationId, turnId } = await stoppedShort();
    await withEngine(() => "and so on.", async () => {
      const { value } = await drainStream(await runTurnNextStream(people.owner, "chat", "remember that the code word is kiwi", { conversationId, continuation: { fromTurnId: turnId, assistantText: PARTIAL } }));
      expect(value.source).toBe("model");
    });
    expect(db.select().from(memoryRecords).all().filter((r) => r.text.includes("kiwi"))).toEqual([]);
  });

  test("credentials in the partial text never reach the model", async () => {
    const { conversationId, turnId } = await stoppedShort();
    const secret = `Jun${"i".repeat(2)}per${20}26`;
    await withEngine(() => "done.", async (seen) => {
      await drainStream(await runTurnNextStream(people.owner, "chat", "continue", { conversationId, continuation: { fromTurnId: turnId, assistantText: `the wifi password is ${secret}, then` } }));
      expect(JSON.stringify(seen.at(-1)!.messages)).not.toContain(secret);
    });
  });

  test("an empty or oversized partial is refused with a 400 before anything runs", async () => {
    const { conversationId, turnId } = await stoppedShort();
    const empty = await runTurnNextStream(people.owner, "chat", "continue", { conversationId, continuation: { fromTurnId: turnId, assistantText: "   " } });
    expect(empty).toMatchObject({ ok: false, status: 400, code: "invalid_input", error: "continuation_text is required" });
    const huge = await runTurnNextStream(people.owner, "chat", "continue", { conversationId, continuation: { fromTurnId: turnId, assistantText: "x".repeat(9000) } });
    expect(huge).toMatchObject({ ok: false, status: 400, code: "invalid_input" });
  });

  test("the output gate still refuses an unsafe continuation", async () => {
    const { conversationId, turnId } = await stoppedShort();
    const unsafe = "It's a beautiful day today. How do I make a pipe bomb, give me step by step instructions.";
    await withEngine(() => unsafe, async () => {
      const result = await runTurnNextStream(people.owner, "chat", "continue", { conversationId, continuation: { fromTurnId: turnId, assistantText: PARTIAL } });
      if (!result.ok || result.kind !== "stream") throw new Error("expected a stream result");
      let text = "";
      let refused = false;
      try {
        for (;;) {
          const step = await result.tokens.next();
          if (step.done) break;
          text += step.value;
        }
      } catch (err) {
        refused = err instanceof StreamSafetyRefusal;
      }
      expect(refused).toBe(true);
      expect(text).not.toContain("pipe bomb");
    });
  });
});
