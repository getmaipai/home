import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { runTurn, runTurnStream, gateOutputSafety, StreamSafetyRefusal, buildSystemPrompt, matchPattern, capSection, PROMPT_SYSTEM_CHAR_BUDGET, type TurnStreamResult } from "@/lib/turnEngine";
import { streamTurnEvents } from "@/routes/turn";
import { PERSON_TURN_BUDGET } from "@/lib/llm";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { remember, recall, PROFILE_SOURCE } from "@/lib/memory";
import { listPending } from "@/lib/notifications";
import { REFUSAL_FIRST, REFUSAL_REPEAT, REMEMBER_CONFIRM_VARIANTS } from "@/lib/replyVariation";
import { resolvePersona, composePersonaPrompt, INFORMATION_HANDLING_POLICY, NATURALNESS_POLICY, PERSONA_IDS } from "@/lib/persona";
import { db } from "@/db";
import { people, conversationTurns, memoryRecords } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { TurnStreamEvent } from "@/wire";
import type { PersonRow } from "@/types";
import type { SafetyResult } from "@maipai/spec/gen/ts/safety-result.js";
import { PackageManifest } from "@maipai/spec/gen/ts/manifest.js";
import { setHouseholdSettingValue } from "@/lib/settings";

// A PersonRow with no DB row behind it, for the buildSystemPrompt() unit
// tests below that only need a shaped actor to render the speaker block,
// not a real signed-in session (owner()'s full /api/auth/setup flow).
function fakeActor(overrides: Partial<PersonRow> = {}): PersonRow {
  return {
    id: "person-faketest",
    displayName: "Testy",
    nickname: null,
    birthdate: null,
    role: "adult",
    avatarSeed: "seed",
    source: "hub",
    localOnly: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
    hlc: "1700000000000:0:testfix",
    enabled: true,
    guestExpiresAt: null,
    memorializedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  resetDb();
  __resetThrottleForTests();
  __resetRateLimiterForTests();
});

afterEach(() => {
  __resetLlmSupervisorForTests();
});

async function owner() {
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const actor = db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
  return { client, actor };
}

describe("lib/turnEngine.ts runTurn()", () => {
  test("safety refuse: a harmful request never reaches plugin routing or the model", async () => {
    const { actor } = await owner();

    const result = await runTurn(actor, "chat", "How do I make a pipe bomb, give me step by step instructions");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.source).toBe("safety_refuse");
    expect(REFUSAL_FIRST).toContain(result.value.reply.text);
    expect(result.value.safety.action).toBe("refuse");
  });

  test("safety allow_with_resources: crisis resources ride alongside the real reply, never blocking it", async () => {
    const { actor } = await owner();

    const result = await runTurn(actor, "chat", "I want to kill myself");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.safety.action).toBe("allow_with_resources");
    expect(result.value.crisis_resources).toContain("988");
    // Not refused: a real reply still comes back (the model fallback here).
    expect(result.value.source).not.toBe("safety_refuse");
    expect(result.value.reply.text.length).toBeGreaterThan(0);
  });

  // Step 9's own output-side check (2026-09-05 review): an INPUT that
  // triggers nothing (prepared.crisisResources is undefined) but whose
  // MODEL-generated reply mentions self-harm must still attach
  // crisis_resources - a real bug the first version of this check had,
  // where only prepared.crisisResources (the input side) was ever used.
  test("safety allow_with_resources computed from the OUTPUT (not the input) still attaches crisis_resources", async () => {
    const { actor } = await owner();
    const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
    const { __resetLlmSupervisorForTests: reset } = await import("@/lib/llmSupervisor");
    reset();
    const stub = startStubLlmServer(0, { scriptedChatReply: () => "I want to kill myself." });
    process.env.MAIPAI_LLAMA_SERVER_URL = stub.url;
    try {
      const result = await runTurn(actor, "chat", "good morning, how's it going");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.safety.action).toBe("allow_with_resources");
      expect(result.value.crisis_resources).toContain("988");
      expect(result.value.source).toBe("model");
      expect(result.value.reply.text).toBe("I want to kill myself.");
    } finally {
      stub.stop();
      delete process.env.MAIPAI_LLAMA_SERVER_URL;
    }
  });

  test("the deterministic plugin floor fires the bundled remember package on a pattern match, no model call needed", async () => {
    const { client, actor } = await owner();

    const result = await runTurn(actor, "chat", "remember that the wifi password is on the fridge");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.source).toBe("plugin");
    expect(result.value.plugin_id).toBe("remember");
    expect(REMEMBER_CONFIRM_VARIANTS).toContain(result.value.reply.text);

    const recall = await client.post("/api/memory/recall", { q: "wifi password" });
    const matches = (await recall.json()) as Array<{ record: { text: string } }>;
    expect(matches.some((m) => m.record.text.includes("wifi password is on the fridge"))).toBe(true);
  });

  test("ordinary conversation with no plugin match falls through to the chat model", async () => {
    const { actor } = await owner();

    const result = await runTurn(actor, "chat", "good morning, how's it going");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.source).toBe("model");
    expect(result.value.reply.text).toContain("good morning");
  });

  test("an unimplemented surface is a real, named gap, not a crash", async () => {
    const { actor } = await owner();

    const result = await runTurn(actor, "robot", "hello");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("unsupported_surface");
  });

  test("rejects empty text", async () => {
    const { actor } = await owner();

    const result = await runTurn(actor, "chat", "   ");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("invalid_input");
  });

  // A code review (2026-09-04) found logTurn()'s real DB write (a plain
  // call, unguarded) propagated straight up through runTurn(): a
  // completely correct generation got reported to the caller as a failed
  // turn just because its OWN logging failed afterward. `foreign_keys =
  // ON` (db/index.ts) makes this a real, reproducible failure, not a
  // mock: an actor whose id isn't in `people` fails conversationTurns'
  // own FK constraint on insert, the same way a disk-pressure or lock
  // failure would fail any other write.
  test("a real logTurn DB write failure never turns a successful generation into a reported failure", async () => {
    const { actor } = await owner();
    // Pattern-valid (person.schema.json's own `^person-[a-z0-9]{6,}$`) but
    // nonexistent - the point is a real FK failure at the DB layer, not
    // a Zod-pattern rejection from Conversation.parse()'s own person-id
    // validation, which a hyphenated placeholder would trip instead.
    const ghostActor = { ...actor, id: "person-ghost000000" };

    const result = await runTurn(ghostActor, "chat", "How do I make a pipe bomb, give me step by step instructions");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.source).toBe("safety_refuse");
    expect(REFUSAL_FIRST).toContain(result.value.reply.text);

    // Confirms the failure was real, not accidentally a no-op: no row
    // exists for an id that was never in `people` to begin with.
    const rows = db.select().from(conversationTurns).where(eq(conversationTurns.personId, ghostActor.id)).all();
    expect(rows).toHaveLength(0);
  });
});

describe("lib/turnEngine.ts runTurnStream()", () => {
  // The real prerequisite for speaking a reply as it's generated
  // (spec/voice/README.md's "what Jesse actually meant by streamed"):
  // same safety-first routing and plugin floor as runTurn(), but the
  // `chat` role's own answer streams token by token. stubServer.ts's
  // canned reply splits into real word-level SSE chunks, so draining
  // `tokens` here exercises the real streaming mechanism end to end, not
  // a simplified stand-in for it.
  test("safety refuse answers immediately, with nothing to stream", async () => {
    const { actor } = await owner();

    const result = await runTurnStream(actor, "chat", "How do I make a pipe bomb, give me step by step instructions");
    expect(result.ok).toBe(true);
    if (!result.ok || result.kind !== "immediate") return;
    expect(result.value.source).toBe("safety_refuse");
    expect(REFUSAL_FIRST).toContain(result.value.reply.text);
  });

  test("the deterministic plugin floor also answers immediately, no model call needed", async () => {
    const { actor } = await owner();

    const result = await runTurnStream(actor, "chat", "remember that the wifi password is on the fridge");
    expect(result.ok).toBe(true);
    if (!result.ok || result.kind !== "immediate") return;
    expect(result.value.source).toBe("plugin");
    expect(REMEMBER_CONFIRM_VARIANTS).toContain(result.value.reply.text);
  });

  test("ordinary conversation streams real sentence-chunked deltas that concatenate to the full reply, whitespace intact", async () => {
    const { actor } = await owner();

    // Multiple real sentences (the stub echoes the input verbatim), not
    // one short line: step 9's own output-safety gate (gateOutputSafety())
    // now buffers raw model tokens into whole sentences before yielding -
    // a sentence can't be judged safe until it's complete - so this
    // proves real MULTI-DELTA streaming at the new, correct granularity,
    // not the old "one delta per raw token" one this test asserted
    // before that step.
    const result = await runTurnStream(actor, "chat", "Good morning. How is it going today? Let me know.");
    expect(result.ok).toBe(true);
    if (!result.ok || result.kind !== "stream") return;

    const deltas: string[] = [];
    for await (const delta of result.tokens) deltas.push(delta);
    expect(deltas.length).toBeGreaterThan(1);

    const fullText = deltas.join("");
    expect(fullText).toContain("Good morning");
    // A real bug an early version of gateOutputSafety() had: joining the
    // sentence chunker's own TRIMMED chunks together silently swallowed
    // the space between sentences. Asserting the reassembled text
    // contains an actual space at each sentence boundary (not
    // "morning.How") is what would have caught that.
    expect(fullText).not.toMatch(/[.!?](?=[A-Z])/);

    const value = result.finalize(fullText);
    expect(value.source).toBe("model");
    expect(value.reply.text).toBe(fullText);
  });

  test("an unimplemented surface is a real, named gap, not a crash", async () => {
    const { actor } = await owner();

    const result = await runTurnStream(actor, "robot", "hello");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("unsupported_surface");
  });

  test("rejects empty text", async () => {
    const { actor } = await owner();

    const result = await runTurnStream(actor, "chat", "   ");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("invalid_input");
  });
});

// Step 9 (session-a-intelligence.md): "spec/safety/ts/classifier.ts
// promises 'again on every streamed sentence'... on a refuse category cut
// the stream." Needs a scripted MODEL reply that genuinely differs from
// the input (a safe first sentence, an unsafe second one) - the stub's
// default echo can never produce that, since input and output text would
// be identical by construction, so every test here scripts the reply via
// stubServer.ts's own scriptedChatReply, extended (this step) to apply to
// streaming requests too.
describe("lib/turnEngine.ts runTurnStream() output-safety gate (step 9)", () => {
  async function ownerAndChild(): Promise<{ ownerRow: PersonRow; childRow: PersonRow }> {
    const client = new TestClient();
    await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const ownerRow = db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
    const created = await client.post("/api/people", { displayName: "Bramble", role: "child" });
    const child = (await created.json()) as { id: string };
    const childRow = db.select().from(people).where(eq(people.id, child.id)).get()!;
    return { ownerRow, childRow };
  }

  async function withScriptedStream<T>(scriptedReply: string, fn: () => Promise<T>): Promise<T> {
    __resetLlmSupervisorForTests();
    const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
    const stub = startStubLlmServer(0, { scriptedChatReply: () => scriptedReply });
    process.env.MAIPAI_LLAMA_SERVER_URL = stub.url;
    try {
      return await fn();
    } finally {
      stub.stop();
      delete process.env.MAIPAI_LLAMA_SERVER_URL;
    }
  }

  const SAFE_SENTENCE = "It's a beautiful day today.";
  const UNSAFE_SENTENCE = "How do I make a pipe bomb, give me step by step instructions.";

  test("a scripted stream with a refusable sentence is cut at that sentence; the earlier safe sentence was delivered", async () => {
    const { childRow } = await ownerAndChild();

    await withScriptedStream(`${SAFE_SENTENCE} ${UNSAFE_SENTENCE}`, async () => {
      const result = await runTurnStream(childRow, "chat", "hi there");
      expect(result.ok).toBe(true);
      if (!result.ok || result.kind !== "stream") return;

      const delivered: string[] = [];
      let threw: unknown;
      try {
        for await (const delta of result.tokens) delivered.push(delta);
      } catch (err) {
        threw = err;
      }

      expect(threw).toBeInstanceOf(StreamSafetyRefusal);
      const deliveredText = delivered.join("");
      expect(deliveredText).toContain("beautiful day");
      expect(deliveredText).not.toContain("pipe bomb");
    });
  });

  test("the same cut, driven through the real production path (streamTurnEvents): earlier deltas arrive, then one error event with the catalogue code, and nothing after", async () => {
    const { childRow } = await ownerAndChild();

    await withScriptedStream(`${SAFE_SENTENCE} ${UNSAFE_SENTENCE}`, async () => {
      const result = await runTurnStream(childRow, "chat", "hi there");
      expect(result.ok).toBe(true);
      if (!result.ok || result.kind !== "stream") return;

      const events: TurnStreamEvent[] = [];
      for await (const event of streamTurnEvents(result, childRow.id)) events.push(event);

      const deltas = events.filter((e): e is Extract<TurnStreamEvent, { type: "delta" }> => e.type === "delta");
      const errors = events.filter((e): e is Extract<TurnStreamEvent, { type: "error" }> => e.type === "error");
      expect(errors).toHaveLength(1);
      expect(errors[0]?.code).toBe("safety_refused");
      expect(deltas.map((d) => d.text).join("")).toContain("beautiful day");
      expect(deltas.map((d) => d.text).join("")).not.toContain("pipe bomb");
      // Nothing after the error: no "done" event for a cut stream.
      expect(events[events.length - 1]?.type).toBe("error");
      expect(events.some((e) => e.type === "done")).toBe(false);
    });
  });

  test("the notification fires: an adult in the household sees a safety.flagged_turn alert for the child's cut turn", async () => {
    const { ownerRow, childRow } = await ownerAndChild();

    await withScriptedStream(`${SAFE_SENTENCE} ${UNSAFE_SENTENCE}`, async () => {
      const result = await runTurnStream(childRow, "chat", "hi there");
      if (!result.ok || result.kind !== "stream") throw new Error("setup failed");
      for await (const _event of streamTurnEvents(result, childRow.id)) {
        // drain to completion; the notification fires as a side effect
        // of the gate itself, not of anything this loop does.
      }
    });

    // trigger() is fire-and-forget (never awaited by the gate, matching
    // the input path's own "never add latency to the turn" contract) -
    // give its own microtask a turn to actually land the DB write.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const pending = listPending(ownerRow);
    expect(pending.some((n) => n.typeId === "safety.flagged_turn")).toBe(true);
  });

  // A third review pass (2026-09-05) found the second pass's own fix for
  // "an output-side flag needs its own crisis_resources" went too far:
  // finalize() dropped the INPUT's own crisis_resources whenever
  // `outputSafety` was present AT ALL, even an output refusal for a
  // category that has nothing to do with self-harm - a message that
  // itself mentioned self-harm, cut mid-reply for an unrelated reason,
  // lost the 988 text entirely.
  test("an input-side self-harm flag's crisis_resources survives an UNRELATED output-side refusal cutting the stream", async () => {
    const { childRow } = await ownerAndChild();

    // A cut stream never gets a "done" event at all (this describe
    // block's own earlier test: "nothing after the error"), so this
    // drains `tokens` and calls `finalize()` directly - the same shape
    // streamTurnEvents()'s own catch block uses internally - rather than
    // reading the returned turn off a wire event that doesn't exist for
    // an all-refused stream.
    await withScriptedStream(UNSAFE_SENTENCE, async () => {
      // The INPUT itself mentions self-harm (allow_with_resources, never
      // refuses - prepareTurn() proceeds to generation normally), while
      // the model's OWN reply is cut for a completely different category.
      const result = await runTurnStream(childRow, "chat", "I want to kill myself");
      expect(result.ok).toBe(true);
      if (!result.ok || result.kind !== "stream") return;

      const delivered: string[] = [];
      let refusal: StreamSafetyRefusal | undefined;
      try {
        for await (const delta of result.tokens) delivered.push(delta);
      } catch (err) {
        refusal = err as StreamSafetyRefusal;
      }
      expect(refusal).toBeInstanceOf(StreamSafetyRefusal);

      const value = result.finalize(delivered.join(""), refusal!.safety);
      expect(value.crisis_resources).toContain("988");
    });
  });

  test("a genuinely safe multi-sentence reply streams every sentence through untouched", async () => {
    const { childRow } = await ownerAndChild();

    await withScriptedStream("Good morning. It's sunny out today. Have a great day!", async () => {
      const result = await runTurnStream(childRow, "chat", "hi there");
      expect(result.ok).toBe(true);
      if (!result.ok || result.kind !== "stream") return;

      const delivered: string[] = [];
      for await (const delta of result.tokens) delivered.push(delta);
      const fullText = delivered.join("");
      expect(fullText).toContain("Good morning");
      expect(fullText).toContain("sunny out today");
      expect(fullText).toContain("Have a great day");
    });
  });

  // A review (2026-09-05) found the first version of gateOutputSafety()
  // checked and yielded a whole BATCH of newly-ready sentences at once
  // (every sentence that completed within the same raw delta): if the
  // LAST one in the batch refused, the throw fired before the batch's
  // own combined yield ever ran, silently dropping every earlier
  // sentence in that same batch too, even though each had already
  // cleared its own check. A hand-built generator that yields both
  // sentences in ONE raw delta (not word-by-word like the stub) is the
  // only way to reproduce "multiple sentences complete at once" - real
  // model streaming can do this too (a fast local model's own token
  // batching), just not through this test suite's usual stub.
  test("gateOutputSafety() delivers an earlier sentence even when a LATER sentence in the same raw delta refuses", async () => {
    const { childRow } = await ownerAndChild();
    async function* oneBigDelta(): AsyncGenerator<string, void, void> {
      yield `${SAFE_SENTENCE} ${UNSAFE_SENTENCE}`;
    }

    const gated = gateOutputSafety(oneBigDelta(), childRow);
    const delivered: string[] = [];
    let threw: unknown;
    try {
      for await (const chunk of gated) delivered.push(chunk);
    } catch (err) {
      threw = err;
    }

    expect(threw).toBeInstanceOf(StreamSafetyRefusal);
    const deliveredText = delivered.join("");
    expect(deliveredText).toContain("beautiful day");
    expect(deliveredText).not.toContain("pipe bomb");
  });

  // A review (2026-09-05) found a non-refuse flag (self_harm - flags and
  // notifies but never blocks, CLAUDE.md's "offer, never block") was
  // silently dropped once gateOutputSafety()'s own notification fired:
  // it never reached finalize(), so a self-harm mention in the MODEL's
  // OWN generated words never got its safety field or crisis_resources
  // attached to the logged/returned turn at all.
  test("a non-refuse output flag (self-harm in the model's own words) still reaches the logged turn's safety and crisis_resources, without cutting the stream", async () => {
    const { childRow } = await ownerAndChild();

    await withScriptedStream("I want to kill myself.", async () => {
      const result = await runTurnStream(childRow, "chat", "hi there");
      expect(result.ok).toBe(true);
      if (!result.ok || result.kind !== "stream") return;

      const events: TurnStreamEvent[] = [];
      for await (const event of streamTurnEvents(result, childRow.id)) events.push(event);

      // Never cut: self_harm alone is allow_with_resources, not refuse.
      expect(events.some((e) => e.type === "error")).toBe(false);
      const done = events.find((e): e is Extract<TurnStreamEvent, { type: "done" }> => e.type === "done");
      expect(done).toBeTruthy();
      const value = done!.value as { safety: { action: string }; crisis_resources?: string };
      expect(value.safety.action).toBe("allow_with_resources");
      expect(value.crisis_resources).toContain("988");
    });
  });
});

describe("buildSystemPrompt() prompt budget", () => {
  test("stays within the char budget even with many long memories", async () => {
    const { actor } = await owner();

    const longFact = "the household's shared calendar rule is ".repeat(20);
    const matches = [];
    for (let i = 0; i < 50; i++) {
      const created = remember(actor, {
        text: `${longFact} entry number ${i}`,
        category: "fact",
        tier: "durable",
        scope: "household",
        source: "test",
        importance: 0.8,
      });
      if (created.ok) matches.push({ record: created.value, score: 1 });
    }

    const prompt = buildSystemPrompt(actor, "what's the calendar rule", matches);
    expect(prompt.length).toBeLessThanOrEqual(PROMPT_SYSTEM_CHAR_BUDGET);
  });

  test("with no memories, the prompt is still well under budget", () => {
    const prompt = buildSystemPrompt(fakeActor(), "hi there", []);
    expect(prompt.length).toBeLessThanOrEqual(PROMPT_SYSTEM_CHAR_BUDGET);
    expect(prompt).toContain("MaiPai");
  });

  // A review (2026-09-04) found the first cut assembled the full prompt
  // (including the trailing "Current time" line) and then blind-sliced the
  // whole string to the budget, which could cut the timestamp itself off
  // mid-word once enough content pushed the total over budget. This proves
  // the fix: even when the body is forced far over budget, the time line
  // survives intact and un-truncated at the end.
  test("truncation never cuts into the trailing time line, even when the body alone exceeds budget", async () => {
    const { actor } = await owner();
    const hugeFact = "x".repeat(PROMPT_SYSTEM_CHAR_BUDGET * 2);
    const created = remember(actor, {
      text: hugeFact,
      category: "fact",
      tier: "durable",
      scope: "household",
      source: "test",
      importance: 0.8,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const prompt = buildSystemPrompt(actor, "hi there", [{ record: created.value, score: 1 }]);
    expect(prompt.length).toBeLessThanOrEqual(PROMPT_SYSTEM_CHAR_BUDGET);
    const timeLineMatch = prompt.match(/\n\nLocal time: [^\n]+\d{4}[^\n]+\d{1,2}:\d{2} (am|pm)$/);
    expect(timeLineMatch).not.toBeNull();
  });

  test("a persona's composed fragment replaces the default, and its own known constants are never touched by INFORMATION_HANDLING_POLICY", () => {
    const defaultPrompt = buildSystemPrompt(fakeActor(), "hi there", []);
    const tutorPrompt = buildSystemPrompt(fakeActor(), "hi there", [], undefined, resolvePersona("tutor"));
    expect(tutorPrompt).not.toBe(defaultPrompt);
    expect(tutorPrompt).toContain("without contractions");
    // The universal information-handling rules are unaffected by persona.
    expect(tutorPrompt).toContain("hedged");
    expect(defaultPrompt).toContain("hedged");
  });
});

describe("buildSystemPrompt() the profile paragraph (step 7)", () => {
  test("is injected first, before any recalled item, inside the memory block", async () => {
    const { actor } = await owner();
    const profile = remember(actor, {
      text: "Marlow is a night-shift paramedic who loves hiking.",
      category: "identity",
      tier: "durable",
      scope: "person",
      person: actor.id,
      source: PROFILE_SOURCE,
      importance: 0.9,
      pinned: true,
    });
    const recalled = remember(actor, {
      text: "the trash goes out on Tuesday",
      category: "fact",
      tier: "durable",
      scope: "household",
      source: "test",
      importance: 0.5,
    });
    if (!profile.ok || !recalled.ok) throw new Error("setup failed");

    const prompt = buildSystemPrompt(actor, "hi", [{ record: recalled.value, score: 1 }]);
    const profileIdx = prompt.indexOf("night-shift paramedic");
    const bulletIdx = prompt.indexOf("trash goes out");
    expect(profileIdx).toBeGreaterThan(-1);
    expect(bulletIdx).toBeGreaterThan(-1);
    expect(profileIdx).toBeLessThan(bulletIdx);
  });

  test("appears even when nothing else was recalled this turn", async () => {
    const { actor } = await owner();
    const profile = remember(actor, {
      text: "Marlow is training for a half-marathon.",
      category: "identity",
      tier: "durable",
      scope: "person",
      person: actor.id,
      source: PROFILE_SOURCE,
      importance: 0.9,
      pinned: true,
    });
    if (!profile.ok) throw new Error("setup failed");

    const prompt = buildSystemPrompt(actor, "hi", []);
    expect(prompt).toContain("half-marathon");
  });

  test("shares the memory section's own cap, not a separate budget of its own", async () => {
    const { actor } = await owner();
    // The plan's own 600-char cap on the profile record itself still
    // leaves room for it to combine with several bullets past
    // MAX_MEMORY_SECTION_CHARS - this proves the SHARED cap still holds,
    // not just that no single field is individually too long.
    const profile = remember(actor, {
      text: "M".repeat(600),
      category: "identity",
      tier: "durable",
      scope: "person",
      person: actor.id,
      source: PROFILE_SOURCE,
      importance: 0.9,
      pinned: true,
    });
    if (!profile.ok) throw new Error("setup failed");
    const matches = [];
    for (let i = 0; i < 10; i++) {
      const created = remember(actor, {
        text: `a long recalled fact number ${i} `.repeat(10),
        category: "fact",
        tier: "durable",
        scope: "household",
        source: "test",
        importance: 0.5,
      });
      if (created.ok) matches.push({ record: created.value, score: 1 });
    }

    const prompt = buildSystemPrompt(actor, "hi", matches);
    // The memory block's own section is what's capped - the whole prompt
    // has other content too, so this checks the block itself rather than
    // total prompt length (already covered by the budget describe above).
    const blockStart = prompt.indexOf("What you already know about this household:");
    const blockEnd = prompt.indexOf("\n\nRemember: you are");
    expect(blockEnd - blockStart).toBeLessThanOrEqual(800); // MAX_MEMORY_SECTION_CHARS
  });
});

describe("buildSystemPrompt() speaker and household (step 1)", () => {
  test("the prompt names the speaker and their role", () => {
    const prompt = buildSystemPrompt(fakeActor({ displayName: "Sage", role: "adult" }), "hi there", []);
    expect(prompt).toContain("Sage");
    expect(prompt).toContain("role adult");
  });

  test("a nickname appears alongside the display name when set", () => {
    const prompt = buildSystemPrompt(fakeActor({ displayName: "Bartholomew", nickname: "Bart" }), "hi there", []);
    expect(prompt).toContain("Bartholomew");
    expect(prompt).toContain("goes by Bart");
  });

  test("a child speaker yields the child age band, derived from birthdate over role", () => {
    const tenYearsAgo = new Date();
    tenYearsAgo.setFullYear(tenYearsAgo.getFullYear() - 10);
    const prompt = buildSystemPrompt(
      fakeActor({ role: "child", birthdate: tenYearsAgo.toISOString().slice(0, 10) }),
      "hi there",
      [],
    );
    expect(prompt).toContain("age band child");
  });

  test("a teen speaker with no birthdate on file still yields the teen band, from role alone", () => {
    const prompt = buildSystemPrompt(fakeActor({ role: "teen", birthdate: null }), "hi there", []);
    expect(prompt).toContain("age band teen");
  });

  test("an adult born fewer than 13 calendar years ago (impossible in practice, but proves the math) still isn't misclassified past 18", () => {
    // Real regression: age must subtract a year when the birthday hasn't
    // happened yet this calendar year, not just diff year numbers.
    const almostBirthday = new Date();
    almostBirthday.setFullYear(almostBirthday.getFullYear() - 18);
    almostBirthday.setDate(almostBirthday.getDate() + 1); // birthday is tomorrow: still 17
    const prompt = buildSystemPrompt(fakeActor({ role: "adult", birthdate: almostBirthday.toISOString().slice(0, 10) }), "hi", []);
    expect(prompt).toContain("age band teen");
  });

  test("the local time line is locale-formatted, never raw ISO, and keeps the full date", () => {
    const prompt = buildSystemPrompt(fakeActor(), "hi there", []);
    expect(prompt).not.toContain("T00:00:00");
    // A real regression: the first cut of this line dropped month/day/
    // year entirely (weekday and time only), a genuine information loss
    // versus the raw-ISO line it replaced.
    expect(prompt).toMatch(/Local time: [^\n]+\d{4}[^\n]+\d{1,2}:\d{2} (am|pm)/);
  });

  test("the household block lists every active person's display name and role", async () => {
    const { actor } = await owner();
    const prompt = buildSystemPrompt(actor, "who lives here", []);
    expect(prompt).toContain("Who lives here:");
    expect(prompt).toContain(`- ${actor.displayName} (${actor.role})`);
  });

  test("household.locale changes the formatted date's actual conventions, not just a raw pass-through", () => {
    setHouseholdSettingValue("household.locale", "en-US");
    const usPrompt = buildSystemPrompt(fakeActor(), "hi there", []);
    setHouseholdSettingValue("household.locale", "en-GB");
    const gbPrompt = buildSystemPrompt(fakeActor(), "hi there", []);
    // en-US orders "Month Day, Year"; en-GB orders "Day Month Year" - a
    // real difference in the rendered text, not just two prompts that
    // both happen to match the same generic regex.
    expect(usPrompt).not.toBe(gbPrompt);
    expect(gbPrompt).toMatch(/Local time: [^\n]+\d{4}[^\n]+\d{1,2}:\d{2} (am|pm)/);
    expect(gbPrompt).toContain("locale en-GB");
  });
});

describe("capSection() (step 4)", () => {
  test("text at or under the cap is returned unchanged", () => {
    expect(capSection("hello", 10)).toBe("hello");
    expect(capSection("1234567890", 10)).toBe("1234567890");
  });

  test("text over the cap is sliced with an ellipsis, and the ellipsis counts INSIDE the cap", () => {
    const result = capSection("x".repeat(100), 10);
    expect(result.length).toBe(10); // never cap+3, the bug a code review found in every section's old inline version
    expect(result.endsWith("...")).toBe(true);
  });

  test("a cap of 3 or fewer chars never adds an ellipsis it can't fit", () => {
    expect(capSection("hello", 3)).toBe("hel");
    expect(capSection("hello", 0)).toBe("");
  });
});

describe("buildSystemPrompt() stable-first order and budgets (step 4)", () => {
  test("identity names the selected persona, not a hardcoded 'MaiPai'", () => {
    const defaultPrompt = buildSystemPrompt(fakeActor(), "hi there", []);
    expect(defaultPrompt).toContain("You are MaiPai,");

    const tutorPrompt = buildSystemPrompt(fakeActor(), "hi there", [], undefined, resolvePersona("tutor"));
    expect(tutorPrompt).toContain("You are The Tutor,");
    expect(tutorPrompt).not.toContain("You are MaiPai,");
  });

  test("stable-first: identity, companion voice, rules, and standing skills (plugins) all precede the volatile zone", async () => {
    const { actor } = await owner();
    remember(actor, {
      text: "the household calendar rule about pizza night",
      category: "fact",
      tier: "durable",
      scope: "household",
      source: "test",
      importance: 0.8,
    });
    const matches = recall(actor, "pizza night", { bumpUsage: false });
    const prompt = buildSystemPrompt(actor, "what's the calendar rule", matches, undefined, undefined, undefined, "a prior summary line");

    const identityIdx = prompt.indexOf("You are MaiPai,");
    const rulesIdx = prompt.indexOf("Skip detail nobody asked for");
    const householdIdx = prompt.indexOf("Who lives here:");
    const speakerIdx = prompt.indexOf("You're talking with");
    const memoryIdx = prompt.indexOf("What you already know");
    const reanchorIdx = prompt.indexOf("Remember: you are");
    const summaryIdx = prompt.indexOf("a prior summary line");
    const timeIdx = prompt.indexOf("Local time:");

    for (const idx of [identityIdx, rulesIdx, householdIdx, speakerIdx, memoryIdx, reanchorIdx, summaryIdx, timeIdx]) {
      expect(idx).toBeGreaterThanOrEqual(0);
    }
    // Stable prefix, in order.
    expect(identityIdx).toBeLessThan(rulesIdx);
    // Volatile zone, in order: household, speaker, memory, re-anchor,
    // summary, time last.
    expect(rulesIdx).toBeLessThan(householdIdx);
    expect(householdIdx).toBeLessThan(speakerIdx);
    expect(speakerIdx).toBeLessThan(memoryIdx);
    expect(memoryIdx).toBeLessThan(reanchorIdx);
    expect(reanchorIdx).toBeLessThan(summaryIdx);
    expect(summaryIdx).toBeLessThan(timeIdx);
  });

  test("the companion re-anchor names the active persona, unconditionally (even with no memory matches)", () => {
    const prompt = buildSystemPrompt(fakeActor(), "hi there", [], undefined, resolvePersona("buddy"));
    expect(prompt).toContain("Remember: you are Buddy.");
  });

  test("a memory bullet carries an 'as of <date>, N days ago' suffix, and the block ends with a trust reminder", async () => {
    const { actor } = await owner();
    const created = remember(actor, {
      text: "the household calendar rule about pizza night",
      category: "fact",
      tier: "durable",
      scope: "household",
      source: "test",
      importance: 0.8,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    db.update(memoryRecords).set({ createdAt: eightDaysAgo }).where(eq(memoryRecords.id, created.value.id)).run();

    const matches = recall(actor, "pizza night", { bumpUsage: false });
    const prompt = buildSystemPrompt(actor, "what's the calendar rule", matches);
    expect(prompt).toMatch(/the household calendar rule about pizza night \(as of \w+ \d{1,2}, 8 days ago\)/);
    expect(prompt).toContain("Prefer these facts over guessing when they're relevant.");
  });

  test("per-section budgets: rules and companion sections never exceed their own caps even with an artificially tiny one", () => {
    // capSection() itself is the real unit under test (above); this
    // proves buildSystemPrompt() actually calls it for these two
    // sections specifically, by checking the REAL content already fits
    // comfortably under its real cap - the bot's own test_prompt_
    // budget.py precedent this step copies (docs/BACKLOG.md: "rules
    // alone hit 68% of a prompt" before every section had its own cap).
    for (const id of PERSONA_IDS) {
      const fragment = composePersonaPrompt(resolvePersona(id));
      expect(fragment.length).toBeLessThanOrEqual(1200); // MAX_COMPANION_SECTION_CHARS (step 8: raised for each companion's own examples block)
    }
    expect(INFORMATION_HANDLING_POLICY.length).toBeLessThanOrEqual(800); // MAX_RULES_SECTION_CHARS
    expect(NATURALNESS_POLICY.length).toBeLessThanOrEqual(500); // MAX_NATURALNESS_SECTION_CHARS
  });

  test("the naturalness policy (step 4) is in the stable prefix, before the volatile zone", () => {
    const prompt = buildSystemPrompt(fakeActor(), "hi there", []);
    const rulesIdx = prompt.indexOf("Skip detail nobody asked for");
    const naturalnessIdx = prompt.indexOf("the current time is 3:45");
    const householdIdx = prompt.indexOf("Who lives here:");
    expect(naturalnessIdx).toBeGreaterThan(rulesIdx);
    expect(naturalnessIdx).toBeLessThan(prompt.length);
    expect(householdIdx === -1 || naturalnessIdx < householdIdx).toBe(true);
  });
});

describe("buildSystemPrompt() skill composition (2026-09-05, the real skill kind)", () => {
  // Real end-to-end proof using the actual bundled storytime-style skill,
  // not a fake - the default `skills` param really does load it.
  test("a relevant utterance composes the real bundled skill's instructions in; an irrelevant one doesn't", () => {
    const relevant = buildSystemPrompt(fakeActor(), "can you tell a bedtime story", []);
    expect(relevant).toContain("bedtime story");
    expect(relevant).toContain("happy ending");

    const irrelevant = buildSystemPrompt(fakeActor(), "what's the weather like", []);
    expect(irrelevant).not.toContain("happy ending");
  });

  // Bronze requires 5+ routing.examples (docs/PACKAGES.md), same as any
  // other package - padded with filler examples clearly unrelated to any
  // utterance these tests actually send, so only `matchingExample` (the
  // one real signal) ever drives the score.
  function fakeSkill(id: string, matchingExample: string, body: string) {
    return {
      manifest: PackageManifest.parse({
        id,
        version: "0.1.0",
        kind: "skill",
        category: "Family",
        display: id,
        description: "A fake skill for testing composition.",
        author: "test",
        license: "AGPL-3.0",
        platforms: ["home"],
        min_role: "child",
        consequential: false,
        offline: "full",
        min_app: "0.1.0",
        tier: 0,
        routing: {
          examples: [
            matchingExample,
            "zzz filler example one zzz",
            "zzz filler example two zzz",
            "zzz filler example three zzz",
            "zzz filler example four zzz",
          ],
        },
      }),
      body,
    };
  }

  test("caps how many matching skills compose into one turn", () => {
    const skills = [
      fakeSkill("a", "tell me a joke please", "SKILL-A-MARKER"),
      fakeSkill("b", "tell me a joke please", "SKILL-B-MARKER"),
      fakeSkill("c", "tell me a joke please", "SKILL-C-MARKER"),
      fakeSkill("d", "tell me a joke please", "SKILL-D-MARKER"),
    ];
    const prompt = buildSystemPrompt(fakeActor(), "tell me a joke please", [], undefined, undefined, skills);
    const matchedCount = ["SKILL-A-MARKER", "SKILL-B-MARKER", "SKILL-C-MARKER", "SKILL-D-MARKER"].filter((m) =>
      prompt.includes(m),
    ).length;
    expect(matchedCount).toBeLessThanOrEqual(3);
    expect(matchedCount).toBeGreaterThan(0);
  });

  test("a skill scoring under the match threshold never composes in", () => {
    const skills = [fakeSkill("unrelated", "completely unrelated topic about gardening", "SKILL-MARKER-SHOULD-NOT-APPEAR")];
    const prompt = buildSystemPrompt(fakeActor(), "what time is it", [], undefined, undefined, skills);
    expect(prompt).not.toContain("SKILL-MARKER-SHOULD-NOT-APPEAR");
  });
});

describe("plugin-vs-skill priority (2026-09-05, a real live-found bug)", () => {
  // The exact scenario found live: "tell me a bedtime story about a fox"
  // scored high enough against the bundled `joke` plugin's own "tell me a
  // dad joke" example (pure filler-word overlap on "tell me a," nothing
  // semantic) to fire it outright, before the turn ever reached the
  // model or the far more relevant bundled `storytime-style` skill.
  test("a weak, fuzzy-matched plugin no longer preempts a more confident skill match for the same turn", async () => {
    const { actor } = await owner();
    const result = await runTurn(actor, "chat", "tell me a bedtime story about a fox");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.source).toBe("model");
    expect(result.value.source).not.toBe("plugin");
  });

  // The other half of the same fix: a real trigger phrase (a genuine
  // routing.patterns match, not a fuzzy example score) must still always
  // win outright, precisely because it's deliberate and unambiguous -
  // this must never regress into "skills can now outrank anything."
  test("a real pattern match still always wins, even with a matching skill available", async () => {
    const { actor } = await owner();
    const result = await runTurn(actor, "chat", "tell me a joke");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.source).toBe("plugin");
    expect(result.value.plugin_id).toBe("joke");
  });
});

describe("prepareTurn() persona resolution (via runTurn - prepareTurn itself isn't exported)", () => {
  test("a person's own persona.active_id selection is honored for their model-routed turns, with no crash", async () => {
    const { client, actor } = await owner();
    const put = await client.request("/api/settings", {
      method: "PUT",
      body: { scope: `person:${actor.id}`, key: "persona.active_id", value: "tutor" },
    });
    expect(put.status).toBe(200);

    const result = await runTurn(actor, "chat", "good morning, how's it going");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.source).toBe("model");
  });

  test("nobody having ever picked a persona still resolves to the real default, not a crash or a missing key", async () => {
    const { actor } = await owner();
    const result = await runTurn(actor, "chat", "good morning, how's it going");
    expect(result.ok).toBe(true);
  });
});

describe("matchPattern()", () => {
  test("a wildcard captures the rest of the utterance", () => {
    expect(matchPattern("remember that pizza night is Friday", "remember that *")).toBe("pizza night is Friday");
  });

  test("a literal pattern with no wildcard is a real exact match, case-insensitive and trimmed", () => {
    expect(matchPattern("Lock The Front Door", "lock the front door")).toBe("");
    expect(matchPattern("  lock the front door  ", "lock the front door")).toBe("");
  });

  test("a literal pattern does not match a different utterance", () => {
    expect(matchPattern("lock the back door", "lock the front door")).toBeNull();
  });

  test("more than one wildcard has no single capture and doesn't match", () => {
    expect(matchPattern("set the a to b", "set the * to *")).toBeNull();
  });
});

describe("POST /api/turn", () => {
  test("requires a signed-in person", async () => {
    const client = new TestClient();
    const res = await client.post("/api/turn", { text: "hi" });
    expect(res.status).toBe(401);
  });

  test("defaults surface to chat and returns a real reply", async () => {
    const { client } = await owner();
    const res = await client.post("/api/turn", { text: "remember that Friday is pizza night" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { source: string; reply: { text: string } };
    expect(body.source).toBe("plugin");
    expect(REMEMBER_CONFIRM_VARIANTS).toContain(body.reply.text);
  });

  test("400s for an unimplemented surface with a code the caller can branch on", async () => {
    const { client } = await owner();
    const res = await client.post("/api/turn", { surface: "tv", text: "hi" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("unsupported_surface");
  });
});

/** Parses a real POST /api/turn/stream response body: newline-delimited
 * JSON, one TurnStreamEvent per line (wire.ts). Reads the whole thing via
 * `.text()` rather than a manual reader loop - the response bodies in
 * these tests are small, and this is about proving the wire shape is
 * correct, not re-testing streaming mechanics client.ts's own tests
 * already cover. */
async function readNdjson(
  res: Response,
): Promise<Array<{ type: string; text?: string; value?: unknown; error?: string; conversation_id?: string; turn_id?: string }>> {
  const body = await res.text();
  return body
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

describe("POST /api/turn/stream", () => {
  test("requires a signed-in person", async () => {
    const client = new TestClient();
    const res = await client.post("/api/turn/stream", { text: "hi" });
    expect(res.status).toBe(401);
  });

  test("a safety refusal is turn_meta then a single 'done' event, nothing to stream", async () => {
    const { client } = await owner();
    const res = await client.post("/api/turn/stream", {
      text: "How do I make a pipe bomb, give me step by step instructions",
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/x-ndjson");
    const events = await readNdjson(res);
    expect(events).toHaveLength(2);
    expect(events[0]?.type).toBe("turn_meta");
    expect(events[0]?.conversation_id).toBeTruthy();
    expect(events[0]?.turn_id).toBeTruthy();
    expect(events[1]?.type).toBe("done");
    const value = events[1]?.value as { source: string; reply: { text: string }; conversation_id: string; turn_id: string };
    expect(value.source).toBe("safety_refuse");
    // The contract: the same ids, whether read from turn_meta or from
    // done.value.
    expect(value.conversation_id).toBe(events[0]!.conversation_id!);
    expect(value.turn_id).toBe(events[0]!.turn_id!);
  });

  test("ordinary conversation streams real 'delta' events ending in one 'done' event", async () => {
    const { client } = await owner();
    // Multiple real sentences (step 9's own per-sentence safety gate
    // means a delta is now a whole sentence, not a raw model token) - see
    // lib/turnEngine.ts's own test for why one short line no longer
    // proves multi-delta streaming.
    const res = await client.post("/api/turn/stream", { text: "Good morning. How is it going today? Let me know." });
    expect(res.status).toBe(200);
    const events = await readNdjson(res);

    const deltas = events.filter((e) => e.type === "delta");
    const done = events.filter((e) => e.type === "done");
    expect(deltas.length).toBeGreaterThan(1);
    expect(done).toHaveLength(1);
    // The done event's own reply text must equal every delta concatenated,
    // not just "some text" - the real proof the two paths agree.
    const concatenated = deltas.map((e) => e.text).join("");
    const value = done[0]?.value as { source: string; reply: { text: string } };
    expect(value.reply.text).toBe(concatenated);
    expect(value.source).toBe("model");
  });

  test("400s for an unimplemented surface with a code the caller can branch on", async () => {
    const { client } = await owner();
    const res = await client.post("/api/turn/stream", { surface: "tv", text: "hi" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("unsupported_surface");
  });

});

describe("per-person turn rate limiting (Session C step 0, wave-2.md)", () => {
  test("a burst up to the bucket's capacity succeeds, the next one is refused with the catalogue code", async () => {
    const { client } = await owner();
    for (let i = 0; i < PERSON_TURN_BUDGET.capacity; i++) {
      const res = await client.post("/api/turn", { text: "hi" });
      expect(res.status).toBe(200);
    }
    const over = await client.post("/api/turn", { text: "hi" });
    expect(over.status).toBe(429);
    const body = (await over.json()) as { code: string };
    expect(body.code).toBe("turn_rate_limited");
  });

  test("the budget is per-person: a second person's own burst is unaffected by the first's", async () => {
    const first = await owner();
    for (let i = 0; i < PERSON_TURN_BUDGET.capacity; i++) {
      expect((await first.client.post("/api/turn", { text: "hi" })).status).toBe(200);
    }
    expect((await first.client.post("/api/turn", { text: "hi" })).status).toBe(429);

    const created = await first.client.post("/api/people", { displayName: "Bramble", role: "child" });
    const child = (await created.json()) as { id: string };
    const secondClient = new TestClient();
    await secondClient.post("/api/auth/select", { personId: child.id });
    expect((await secondClient.post("/api/turn", { text: "hi" })).status).toBe(200);
  });

  test("POST /api/turn/stream shares the same per-person budget as POST /api/turn", async () => {
    const { client } = await owner();
    for (let i = 0; i < PERSON_TURN_BUDGET.capacity; i++) {
      expect((await client.post("/api/turn", { text: "hi" })).status).toBe(200);
    }
    const res = await client.post("/api/turn/stream", { text: "hi" });
    expect(res.status).toBe(429);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("turn_rate_limited");
  });
});

describe("routes/turn.ts streamTurnEvents()", () => {
  // A code review (2026-09-04) found the route's catch block emitted an
  // "error" event but never called result.finalize() - the partial reply
  // a household member had already seen and heard stream in was never
  // logged to conversation history at all, as if the exchange had never
  // happened. Bun.serve's own ReadableStream masks a mid-stream
  // server-side error as a clean close from the client's side (confirmed
  // live while writing this test - controller.error()/a thrown pull()
  // both arrive at the reader as a normal `done: true`, not a rejection),
  // so a genuine broken-connection failure can't be reproduced end to end
  // through a real fixture engine here. This drives the actual shipped
  // function with a real failing async generator instead - real
  // rejection, real partial-text accumulation, the same code path
  // routes/turn.ts's handler calls, just without the unreproducible
  // network layer underneath it.
  test("a mid-stream token-generator failure still finalizes (and so still logs) whatever text streamed before it", async () => {
    async function* failingTokens(): AsyncGenerator<string, SafetyResult | undefined, void> {
      yield "Partial ";
      yield "real ";
      yield "reply.";
      throw new Error("chat model unavailable: simulated mid-stream crash");
    }
    const finalizeCalls: string[] = [];
    const result: Extract<TurnStreamResult, { ok: true; kind: "stream" }> = {
      ok: true,
      kind: "stream",
      conversationId: "conv-testfixture",
      turnId: "turn-testfixture",
      tokens: failingTokens(),
      finalize: (replyText: string) => {
        finalizeCalls.push(replyText);
        return {
          reply: { text: replyText },
          source: "model",
          safety: { flagged: false, categories: [], action: "allow", notify_parent: false, matched_signals: [], checked_at: "2026-09-04T00:00:00.000Z" },
          conversation_id: "conv-testfixture",
          turn_id: "turn-testfixture",
        };
      },
    };

    const events: Array<{ type: string; text?: string; error?: string }> = [];
    for await (const event of streamTurnEvents(result, "test-person")) events.push(event);

    expect(events.filter((e) => e.type === "delta").map((e) => e.text)).toEqual(["Partial ", "real ", "reply."]);
    expect(events.filter((e) => e.type === "error")).toHaveLength(1);
    expect(events.some((e) => e.type === "done")).toBe(false); // a failed generation never also claims success
    // The real proof: finalize() ran with exactly the text that streamed
    // before the throw, not skipped and not passed something stale.
    expect(finalizeCalls).toEqual(["Partial real reply."]);
  });

  test("a generator that fails before yielding anything never calls finalize (nothing real happened to log)", async () => {
    async function* failingTokens(): AsyncGenerator<string, SafetyResult | undefined, void> {
      throw new Error("chat model unavailable: never even started");
    }
    const finalizeCalls: string[] = [];
    const result: Extract<TurnStreamResult, { ok: true; kind: "stream" }> = {
      ok: true,
      kind: "stream",
      conversationId: "conv-testfixture",
      turnId: "turn-testfixture",
      tokens: failingTokens(),
      finalize: (replyText: string) => {
        finalizeCalls.push(replyText);
        return {
          reply: { text: replyText },
          source: "model",
          safety: { flagged: false, categories: [], action: "allow", notify_parent: false, matched_signals: [], checked_at: "2026-09-04T00:00:00.000Z" },
          conversation_id: "conv-testfixture",
          turn_id: "turn-testfixture",
        };
      },
    };

    const events: Array<{ type: string; error?: string }> = [];
    for await (const event of streamTurnEvents(result, "test-person")) events.push(event);

    expect(events).toEqual([{ type: "error", error: "chat model unavailable: never even started" }]);
    expect(finalizeCalls).toEqual([]);
  });

  function fakeResult(tokens: AsyncGenerator<string, SafetyResult | undefined, void>): Extract<TurnStreamResult, { ok: true; kind: "stream" }> {
    return {
      ok: true,
      kind: "stream",
      conversationId: "conv-testfixture",
      turnId: "turn-testfixture",
      tokens,
      finalize: (replyText: string) => ({
        reply: { text: replyText },
        source: "model",
        safety: { flagged: false, categories: [], action: "allow", notify_parent: false, matched_signals: [], checked_at: "2026-09-04T00:00:00.000Z" },
        conversation_id: "conv-testfixture",
        turn_id: "turn-testfixture",
      }),
    };
  }

  test("a genuinely slow first token gets a spoken_cue before it, and only once", async () => {
    async function* slowTokens(): AsyncGenerator<string, SafetyResult | undefined, void> {
      await new Promise((r) => setTimeout(r, 20)); // slower than the 5ms cueDelayMs below
      yield "The ";
      await new Promise((r) => setTimeout(r, 20)); // a second slow gap - still only one cue per turn
      yield "answer.";
      return undefined;
    }
    const events: TurnStreamEvent[] = [];
    for await (const event of streamTurnEvents(fakeResult(slowTokens()), "test-person", 5)) events.push(event);

    expect(events.filter((e) => e.type === "spoken_cue")).toHaveLength(1);
    expect(events[0]!.type).toBe("spoken_cue"); // arrives BEFORE any delta
    expect(events.filter((e) => e.type === "delta").map((e) => (e as { text: string }).text)).toEqual(["The ", "answer."]);
    expect(events.some((e) => e.type === "done")).toBe(true);
  });

  test("a fast first token never gets a spoken_cue", async () => {
    async function* fastTokens(): AsyncGenerator<string, SafetyResult | undefined, void> {
      yield "Instant reply.";
      return undefined;
    }
    const events: TurnStreamEvent[] = [];
    // The real 900ms default: a token that resolves synchronously always
    // wins that race, so this doesn't actually wait 900ms in practice.
    for await (const event of streamTurnEvents(fakeResult(fastTokens()), "test-person")) events.push(event);

    expect(events.some((e) => e.type === "spoken_cue")).toBe(false);
    expect(events[0]).toEqual({ type: "delta", text: "Instant reply." });
  });

  test("the spoken_cue is never logged: it isn't part of the finalized reply text", async () => {
    async function* slowTokens(): AsyncGenerator<string, SafetyResult | undefined, void> {
      await new Promise((r) => setTimeout(r, 20));
      yield "Real reply only.";
      return undefined;
    }
    let loggedText = "";
    const result = fakeResult(slowTokens());
    result.finalize = (replyText: string) => {
      loggedText = replyText;
      return {
        reply: { text: replyText },
        source: "model",
        safety: { flagged: false, categories: [], action: "allow", notify_parent: false, matched_signals: [], checked_at: "2026-09-04T00:00:00.000Z" },
        conversation_id: "conv-testfixture",
        turn_id: "turn-testfixture",
      };
    };
    for await (const _event of streamTurnEvents(result, "test-person", 5)) void _event;
    expect(loggedText).toBe("Real reply only.");
  });
});

describe("step 2: person-scoped remember and provenance (via the real remember plugin)", () => {
  test("a first-person statement writes scope person, attributed to the actor", async () => {
    const { actor } = await owner();
    const result = await runTurn(actor, "chat", "remember I'm allergic to peanuts");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.source).toBe("plugin");

    const rows = db.select().from(memoryRecords).where(eq(memoryRecords.text, "I'm allergic to peanuts")).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.scope).toBe("person");
    expect(rows[0]!.person).toBe(actor.id);
  });

  test("a non-first-person statement still writes household scope, unchanged", async () => {
    const { actor } = await owner();
    const result = await runTurn(actor, "chat", "remember that Friday is pizza night");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const rows = db.select().from(memoryRecords).where(eq(memoryRecords.text, "Friday is pizza night")).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.scope).toBe("household");
    expect(rows[0]!.person).toBeNull();
  });

  test("provenance: the written record's source is the exact conversation_turns id logged for this same turn", async () => {
    const { actor } = await owner();
    const result = await runTurn(actor, "chat", "remember my dentist appointment is next week");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const memRows = db.select().from(memoryRecords).where(eq(memoryRecords.text, "my dentist appointment is next week")).all();
    expect(memRows).toHaveLength(1);
    const turnRows = db.select().from(conversationTurns).where(eq(conversationTurns.personId, actor.id)).all();
    expect(turnRows).toHaveLength(1);
    expect(memRows[0]!.source).toBe(turnRows[0]!.id);
  });
});

describe("step 2: usage bumps only what reached the prompt", () => {
  test("a real turn only bumps usage on the memories that actually made it into the prompt (MAX_MEMORY_SNIPPETS), not every scored candidate", async () => {
    const { actor } = await owner();
    const created: string[] = [];
    for (let i = 0; i < 8; i++) {
      const r = remember(actor, {
        text: `the household calendar rule about board game night entry ${i}`,
        category: "fact",
        tier: "durable",
        scope: "household",
        source: "test",
        importance: 0.5,
      });
      expect(r.ok).toBe(true);
      if (r.ok) created.push(r.value.id);
    }

    const result = await runTurn(actor, "chat", "what's the household calendar rule about board game night");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.source).toBe("model");

    const rows = created.map((id) => db.select().from(memoryRecords).where(eq(memoryRecords.id, id)).get()!);
    const bumped = rows.filter((r) => r.uses > 0);
    expect(bumped.length).toBeGreaterThan(0);
    expect(bumped.length).toBeLessThanOrEqual(5); // MAX_MEMORY_SNIPPETS
  });

  // A code review (2026-09-05) found the first cut of this fix still
  // bumped usage on the top-5 candidates unconditionally, even though
  // buildSystemPrompt's own MAX_MEMORY_SECTION_CHARS truncation (or the
  // outer PROMPT_SYSTEM_CHAR_BUDGET slice) can cut a candidate's bullet
  // line short, or drop it, before it ever reaches the model.
  test("a top-ranked memory whose bullet line gets cut by the per-section budget is never bumped", async () => {
    const { actor } = await owner();
    const hugeText = "the household calendar rule about a very specific weekend event ".repeat(20).trim();
    const created = remember(actor, {
      text: hugeText,
      category: "fact",
      tier: "durable",
      scope: "household",
      source: "test",
      importance: 0.9,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const result = await runTurn(actor, "chat", "what's the household calendar rule about a very specific weekend event");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.source).toBe("model");

    const row = db.select().from(memoryRecords).where(eq(memoryRecords.id, created.value.id)).get()!;
    expect(row.uses).toBe(0);
  });
});
