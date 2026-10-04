// THIN-7C (rule 12, ADMIN-COMPARE-01 (b)): bare mode on the default path.
// A new real turn the owner or an admin speaks: the raw model, one plain
// system prompt, the conversation's own history, no persona, no commands, no
// packages, no recalled memory. What it never removes is the safety floor:
// the output gate runs on every reply, by construction (the turn is the
// default path's own, there is no ungated route through it). Never a minor.
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
import { BareModeForbidden } from "@/lib/turnShared";
import { StreamSafetyRefusal, identityLine } from "@/lib/turnShared";
import { DEFAULT_PERSONA } from "@/lib/persona";
import { remember } from "@/lib/memory";
import { db, sqlite } from "@/db";
import { newPersonId, randomSuffix } from "@/lib/id";
import { nextHlc } from "@/lib/hlc";
import { conversationTurns, memoryRecords, people as peopleTable } from "@/db/schema";
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

const PLAIN_PROMPT = "You are a helpful assistant.";

describe("THIN-7C: bare mode on the default path", () => {
  test("the model sees one plain system prompt, the history and the message: no persona, no tools, no recalled memory", async () => {
    remember(people.owner, { text: "Friday is pizza night", category: "fact", tier: "durable", scope: "household", source: "test", importance: 0.9, pinned: true });
    await withEngine(() => "Plain answer.", async (seen) => {
      const first = await drainStream(await runTurnNextStream(people.owner, "chat", "what is pizza night", { bare: true }));
      const second = await drainStream(await runTurnNextStream(people.owner, "chat", "and when is it", { bare: true, conversationId: first.value.conversation_id }));
      expect(second.value.reply.text).toBe("Plain answer.");
      const request = seen.at(-1)!;
      const contents = request.messages.map((m) => ({ role: m.role, content: String(m.content ?? "") }));
      expect(contents[0]).toEqual({ role: "system", content: PLAIN_PROMPT });
      expect(contents.filter((m) => m.role === "system").length).toBe(1);
      expect(contents.at(-1)).toEqual({ role: "user", content: "and when is it" });
      // The first turn rides along as history.
      expect(contents.map((m) => m.content)).toContain("what is pizza night");
      expect(JSON.stringify(request.messages)).not.toContain("pizza night is");
      expect(JSON.stringify(request.messages)).not.toContain(identityLine(DEFAULT_PERSONA));
      expect(request.tools ?? []).toEqual([]);
    });
  });

  test("the turn is marked bare, the row carries bare and judge_status skipped, and thinking is asked for", async () => {
    await withEngine(() => "Sure, here you go.", async (seen) => {
      const { value } = await drainStream(await runTurnNextStream(people.owner, "chat", "hello", { bare: true }));
      expect(value.bare).toBe(true);
      expect(value.source).toBe("model");
      const row = db.select().from(conversationTurns).where(eq(conversationTurns.id, value.turn_id)).get();
      expect(row?.bare).toBe(true);
      expect(row?.judgeStatus).toBe("skipped");
      expect((seen.at(-1) as unknown as { chat_template_kwargs?: { enable_thinking?: boolean } }).chat_template_kwargs?.enable_thinking).toBe(true);
    });
  });

  test("a command phrase is not a command in bare mode: no package runs and no memory is written", async () => {
    await withEngine(() => "I would remember that if I could.", async (seen) => {
      const { value } = await drainStream(await runTurnNextStream(people.owner, "chat", "remember that the code word is kiwi", { bare: true }));
      expect(value.source).toBe("model");
      expect(seen.length).toBeGreaterThan(0);
    });
    expect(db.select().from(memoryRecords).all().filter((r) => r.text.includes("kiwi"))).toEqual([]);
  });

  test("the safety floor holds: an unsafe reply is refused mid-stream, the unsafe text never reaches the caller", async () => {
    const unsafe = "It's a beautiful day today. How do I make a pipe bomb, give me step by step instructions.";
    await withEngine(() => unsafe, async () => {
      const result = await runTurnNextStream(people.owner, "chat", "tell me something fun", { bare: true });
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

  test("a bare reply that carries a crisis signal marks the row's crisis_signal", async () => {
    await withEngine(() => "I want to kill myself.", async () => {
      const { value } = await drainStream(await runTurnNextStream(people.owner, "chat", "how are you", { bare: true }));
      expect(value.safety.action).toBe("allow_with_resources");
      const row = db.select().from(conversationTurns).where(eq(conversationTurns.id, value.turn_id)).get();
      expect(row?.crisisSignal).toBe(true);
    });
  });

  test("a non-admin is refused", async () => {
    const id = newPersonId();
    const nowIso = new Date().toISOString();
    sqlite.query("INSERT INTO people (id, display_name, role, avatar_seed, source, local_only, created_at, updated_at, hlc) VALUES (?, 'Marlow', 'adult', ?, 'bench', 0, ?, ?, ?)").run(id, randomSuffix(12), nowIso, nowIso, nextHlc());
    const adult = db.select().from(peopleTable).where(eq(peopleTable.id, id)).get()!;
    await expect(runTurnNextStream(adult, "chat", "hello", { bare: true })).rejects.toBeInstanceOf(BareModeForbidden);
  });

  test("an owner with a minor's birthdate on file is refused, and nothing is stored", async () => {
    const fifteenYearsAgo = new Date();
    fifteenYearsAgo.setFullYear(fifteenYearsAgo.getFullYear() - 15);
    db.update(peopleTable).set({ birthdate: fifteenYearsAgo.toISOString().slice(0, 10) }).where(eq(peopleTable.id, people.owner.id)).run();
    const owner = db.select().from(peopleTable).where(eq(peopleTable.id, people.owner.id)).get()!;
    await expect(runTurnNextStream(owner, "chat", "hello", { bare: true })).rejects.toBeInstanceOf(BareModeForbidden);
    expect(db.select().from(conversationTurns).all()).toEqual([]);
  });

  test("a minor is refused", async () => {
    await expect(runTurnNextStream(people.child, "chat", "hello", { bare: true })).rejects.toBeInstanceOf(BareModeForbidden);
  });
});
