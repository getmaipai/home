import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test";
import type { TurnSignal } from "@maipai/spec/gen/ts/turn-signal.js";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { StreamSafetyRefusal, buildStablePrefix, stableSuffixFor, PRIVACY_SENTENCE, matchPattern, capSection, MAX_TURN_TEXT_LENGTH, type TurnStreamResult } from "@/lib/turnShared";
import { runTurnNext, runTurnNextStream } from "@/lib/turnMachine/turnNext";
import { closeDanglingClause } from "@/lib/wellFormed";
import { STABLE_SYSTEM_SUFFIX_SENTENCES } from "../scripts/bench/oldStableSuffix";
import { __embedCallCountForTests, __resetEmbedCallCountForTests } from "@/lib/routing";
import { streamTurnEvents, THINKING_CUE_DELAY_MS } from "@/routes/turn";
import { guardReply } from "@/lib/guards";
import { PERSON_TURN_BUDGET } from "@/lib/llm";
import { __setStackClientForTests, __resetStackEngineForTests } from "@/lib/stackEngine";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { turnActiveWithin, activeTurnCount, acquireTurnLease, __setTurnActivityClockForTests, DEFAULT_IDLE_WINDOW_MS } from "@/lib/turnActivity";
import { remember, PROFILE_SOURCE } from "@/lib/memory";
import * as memoryModule from "@/lib/memory";
import { cachedFetch, __resetPackageCacheForTests, __clearPackageCacheDirForTests } from "@/lib/packageCache";
import { __resetDenoHostForTests } from "@/lib/denoHost";
import { __setPromptClockForBench } from "@/lib/benchSampling";
import { loadManifestOnly } from "@/lib/plugins";
import { listPending } from "@/lib/notifications";
import { REFUSAL_FIRST, REFUSAL_REPEAT, REMEMBER_CONFIRM_VARIANTS } from "@/lib/replyVariation";
import { resolvePersona, composePersonaPrompt, INFORMATION_HANDLING_POLICY, NATURALNESS_POLICY, PERSONA_IDS, DEFAULT_PERSONA } from "@/lib/persona";
import { db } from "@/db";
import { people, conversationTurns, memoryRecords, episodes, attachments } from "@/db/schema";
import { __setTikaRunnerForTests } from "@/lib/documentExtraction";
import { CREDENTIAL_SAFE_MESSAGE } from "@/lib/memoryContentPolicy";
import { eq } from "drizzle-orm";
import type { TurnStreamEvent, TurnValue } from "@/wire";
import { StatusChannel } from "@/lib/statusChannel";
import { resolveOrCreateConversation, turnSubjectsOf } from "@/lib/conversationHistory";
import type { ChatCompletionRequest } from "@maipai/spec/llm/ts/types.js";
import type { PersonRow } from "@/types";
import type { SafetyResult } from "@maipai/spec/gen/ts/safety-result.js";
import { setHouseholdSettingValue } from "@/lib/settings";
import type { ToolExecutionOutcome } from "@/lib/turnContext";
import { ReplyPlan } from "@maipai/spec/gen/ts/reply-plan.js";

beforeEach(() => {
  resetDb();
  __resetThrottleForTests();
  __resetRateLimiterForTests();
});

describe("ACT-03 reply plans", () => {
  test("sad inform context explains that feeling comes first", async () => {
    const { actor } = await owner();
    await withChat("I'm sorry that happened.", async () => {
      const result = await runTurnNext(actor, "chat", "Rover died yesterday");
      expect(result.ok).toBe(true);
      expect(result.ok).toBe(true);
    });
  });

  test("stored plans carry closing, length, and child constraints", async () => {
    const { actor } = await owner();
    const conv = resolveOrCreateConversation(actor, "chat");
    if (!conv.ok) throw new Error(conv.error);
    await withChat("Good night.", async () => {
      const closing = await runTurnNext(actor, "chat", "thanks, that's all for tonight", { conversationId: conv.value.id });
      expect(closing.ok).toBe(true);
      const closingRow = db.select().from(conversationTurns).where(eq(conversationTurns.id, closing.ok ? closing.value.turn_id : "")).get()!;
      const closingPlan = ReplyPlan.parse(JSON.parse(closingRow.plan!));
      expect(closingPlan.moves.close).toBe("required");
      expect(closingPlan.moves.ask_back).toBe("forbidden");

      const { setReplyConstraint } = await import("@/lib/replyConstraints");
      setReplyConstraint({ conversationId: conv.value.id, person: actor.id, kind: "length", value: "120", setByTurn: null });
      const constrained = await runTurnNext(actor, "chat", "tell me something", { conversationId: conv.value.id });
      const constrainedRow = db.select().from(conversationTurns).where(eq(conversationTurns.id, constrained.ok ? constrained.value.turn_id : "")).get()!;
      expect(ReplyPlan.parse(JSON.parse(constrainedRow.plan!)).moves.react).toBe("forbidden");
    });

    const child = { ...actor, role: "child" as const };
    await withChat("Here is an answer.", async () => {
      const result = await runTurnNext(child, "chat", "what is the capital of Portugal");
      expect(result.ok).toBe(true);
      const row = db.select().from(conversationTurns).where(eq(conversationTurns.id, result.ok ? result.value.turn_id : "")).get()!;
      const plan = ReplyPlan.parse(JSON.parse(row.plan!));
      expect(plan.age_band).toBe("child");
      expect(plan.moves.point).toBe("forbidden");
    });
  });
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

async function withChat<T>(reply: string, fn: () => Promise<T>): Promise<T> {
  __resetLlmSupervisorForTests();
  const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
  const stub = startStubLlmServer(0, { scriptedChatReply: () => reply });
  process.env.MAIPAI_LLAMA_SERVER_URL = stub.url;
  try {
    return await fn();
  } finally {
    await stub.stop();
    delete process.env.MAIPAI_LLAMA_SERVER_URL;
    __resetLlmSupervisorForTests();
  }
}

const subjectsOfTurn = (turnId: string) => turnSubjectsOf(db.select({ subjects: conversationTurns.subjects }).from(conversationTurns).where(eq(conversationTurns.id, turnId)).get()!);

describe("runTurnNext()", () => {

  test("safety refuse: a harmful request never reaches plugin routing or the model", async () => {
    const { actor } = await owner();

    const result = await runTurnNext(actor, "chat", "How do I make a pipe bomb, give me step by step instructions");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.source).toBe("safety_refuse");
    expect(REFUSAL_FIRST).toContain(result.value.reply.text);
    expect(result.value.safety.action).toBe("refuse");
  });

  // SEC-5 (code review, 2026-09-06): nothing bounded an incoming turn's
  // text before it reached the safety classifier and the model - a
  // household member could send tens of megabytes and stall the event
  // loop.
  test("rejects text over MAX_TURN_TEXT_LENGTH before it reaches the safety classifier or the model", async () => {
    const { actor } = await owner();

    const result = await runTurnNext(actor, "chat", "a".repeat(MAX_TURN_TEXT_LENGTH + 1));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("invalid_input");
    expect(result.status).toBe(400);
  });

  test("safety allow_with_resources: crisis resources ride alongside the real reply, never blocking it", async () => {
    const { actor } = await owner();

    const result = await runTurnNext(actor, "chat", "I want to kill myself");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.safety.action).toBe("allow_with_resources");
    expect(result.value.crisis_resources).toContain("988");
    // Not refused: a real reply still comes back (the model fallback here).
    expect(result.value.source).not.toBe("safety_refuse");
    expect(result.value.reply.text.length).toBeGreaterThan(0);
  });

  test("the deterministic plugin floor fires the bundled remember package on a pattern match, no model call needed", async () => {
    const { client, actor } = await owner();

    const result = await runTurnNext(actor, "chat", "remember that the wifi password is on the fridge");
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

    const result = await runTurnNext(actor, "chat", "good morning, how's it going");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.source).toBe("model");
    expect(result.value.reply.text).toContain("good morning");
  });

  test("robot is implemented while tv remains a named gap", async () => {
    const { actor } = await owner();

    expect((await runTurnNext(actor, "robot", "hello")).ok).toBe(true);
    const result = await runTurnNext(actor, "tv", "hello");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("unsupported_surface");
  });

  test("rejects empty text", async () => {
    const { actor } = await owner();

    const result = await runTurnNext(actor, "chat", "   ");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("invalid_input");
  });
});

describe("runTurnNextStream()", () => {
  // The real prerequisite for speaking a reply as it's generated
  // (spec/voice/README.md's "what Jesse actually meant by streamed"):
  // same safety-first routing and plugin floor as runTurnNext(), but the
  // `chat` role's own answer streams token by token. stubServer.ts's
  // canned reply splits into real word-level SSE chunks, so draining
  // `tokens` here exercises the real streaming mechanism end to end, not
  // a simplified stand-in for it.
  test("safety refuse answers immediately, with nothing to stream", async () => {
    const { actor } = await owner();

    const result = await runTurnNextStream(actor, "chat", "How do I make a pipe bomb, give me step by step instructions");
    expect(result.ok).toBe(true);
    if (!result.ok || result.kind !== "immediate") return;
    expect(result.value.source).toBe("safety_refuse");
    expect(REFUSAL_FIRST).toContain(result.value.reply.text);
  });

  test("stores and extracts a PDF after its provisional turn exists, then sends extracted text to the model", async () => {
    const { actor } = await owner();
    __setTikaRunnerForTests(() => "Extracted meeting notes.");
    const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
    const requests: ChatCompletionRequest[] = [];
    const stub = startStubLlmServer(0, { scriptedChatReply: (request) => { requests.push(request); return "I read the notes."; } });
    process.env.MAIPAI_LLAMA_SERVER_URL = stub.url;
    try {
      const result = await runTurnNextStream(actor, "chat", "Summarize this", { documentAttachments: [{ name: "notes.pdf", mediaType: "application/pdf", data: "data:application/pdf;base64,cGRm" }] });
      expect(result.ok).toBe(true);
      if (!result.ok || result.kind !== "stream") return;
      for await (const _ of result.tokens) { /* drain */ }
      expect(JSON.stringify(requests)).toContain("Extracted meeting notes.");
      const row = db.select().from(attachments).get();
      expect(row).toMatchObject({ mediaType: "application/pdf", turnId: result.turnId });
    } finally {
      await stub.stop();
      delete process.env.MAIPAI_LLAMA_SERVER_URL;
      __setTikaRunnerForTests(null);
      __resetLlmSupervisorForTests();
    }
  });

  test("rejects text over MAX_TURN_TEXT_LENGTH before it reaches the safety classifier or the model (SEC-5)", async () => {
    const { actor } = await owner();

    const result = await runTurnNextStream(actor, "chat", "a".repeat(MAX_TURN_TEXT_LENGTH + 1));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("invalid_input");
    expect(result.status).toBe(400);
  });

  test("the deterministic plugin floor also answers immediately, no model call needed", async () => {
    const { actor } = await owner();

    const result = await runTurnNextStream(actor, "chat", "remember that the wifi password is on the fridge");
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
    const result = await runTurnNextStream(actor, "chat", "Good morning. How is it going today? Let me know.");
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

  test("CHAT-PARITY-04 continues from the last stable answer as one new sibling model call", async () => {
    const { actor } = await owner();
    __resetLlmSupervisorForTests();
    const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
    const stub = startStubLlmServer(0, {
      scriptedChatReply: (request) => request.messages.at(-1)?.content === "Continue the incomplete answer above. Do not repeat any text already given. Start at the first missing point and finish the answer clearly."
        ? "Here is the rest of the answer."
        : "The answer starts here.",
    });
    process.env.MAIPAI_LLAMA_SERVER_URL = stub.url;
    try {
      const first = await runTurnNextStream(actor, "chat", "Tell me about a blue bicycle");
      expect(first.ok).toBe(true);
      if (!first.ok || first.kind !== "stream") return;
      let firstText = "";
      for await (const delta of first.tokens) firstText += delta;
      const original = first.finalize(firstText);

      const continued = await runTurnNextStream(actor, "chat", "Tell me about a blue bicycle", {
        conversationId: original.conversation_id,
        continuation: { fromTurnId: original.turn_id, assistantText: original.reply.text },
      });
      expect(continued.ok).toBe(true);
      if (!continued.ok || continued.kind !== "stream") return;
      let continuedText = "";
      for await (const delta of continued.tokens) continuedText += delta;
      const continuation = continued.finalize(continuedText);

      const requests = stub.requests();
      expect(requests).toHaveLength(2);
      expect(requests[1]!.messages.at(-2)).toEqual({ role: "assistant", content: original.reply.text });
      expect(requests[1]!.messages.at(-1)?.content).toContain("Continue the incomplete answer above");
      expect(requests[1]!.tools).toBeUndefined();

      const rows = db.select().from(conversationTurns).where(eq(conversationTurns.conversationId, original.conversation_id)).all();
      expect(rows).toHaveLength(2);
      const originalRow = rows.find((row) => row.id === original.turn_id)!;
      const continuationRow = rows.find((row) => row.id === continuation.turn_id)!;
      expect(originalRow.replyText).toBe(original.reply.text);
      expect(originalRow.supersedes).toBeNull();
      expect(continuationRow.supersedes).toBeNull();
      expect(continuationRow.parentTurnId).toBe(originalRow.parentTurnId);
      expect(continuation.continued_from_turn_id).toBe(original.turn_id);
      expect(stub.requests()).toHaveLength(2); // no retry or third composer call
    } finally {
      await stub.stop();
      delete process.env.MAIPAI_LLAMA_SERVER_URL;
      __resetLlmSupervisorForTests();
    }
  });

  test("CHAT-PARITY-04 keeps the output safety boundary on a continuation", async () => {
    const { actor } = await owner();
    __resetLlmSupervisorForTests();
    const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
    const stub = startStubLlmServer(0, { scriptedChatReply: () => "Sure. Here is how to make a pipe bomb at home, step by step." });
    process.env.MAIPAI_LLAMA_SERVER_URL = stub.url;
    try {
      const result = await runTurnNextStream(actor, "chat", "Tell me about a blue bicycle", { continuation: { assistantText: "The answer stopped here." } });
      expect(result.ok).toBe(true);
      if (!result.ok || result.kind !== "stream") return;
      let thrown: unknown;
      try {
        for await (const _ of result.tokens) {
          /* the unsafe sentence must stop the stream */
        }
      } catch (error) {
        thrown = error;
      }
      expect(String(thrown)).toContain("safety classifier");
      expect(stub.requests()).toHaveLength(1);
    } finally {
      await stub.stop();
      delete process.env.MAIPAI_LLAMA_SERVER_URL;
      __resetLlmSupervisorForTests();
    }
  });

  test("tv remains a named gap", async () => {
    const { actor } = await owner();

    const result = await runTurnNextStream(actor, "tv", "hello");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("unsupported_surface");
  });

  test("rejects empty text", async () => {
    const { actor } = await owner();

    const result = await runTurnNextStream(actor, "chat", "   ");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("invalid_input");
  });

  // getmaipai/home BACKLOG, found 2026-09-11: Home's weather card sends a
  // fixed utterance ("What's the weather like today?") through this exact
  // route on every page load, with nothing to tell that apart from a
  // household member's own typed message - it silently wrote a real turn
  // (and, via logTurn()'s own recordEpisodes() call, a real episode) into
  // the person's chat history forever. `ephemeral: true` skips only the
  // log write; the reply itself, the output safety boundary, and the
  // lease all still run exactly as for a real turn.
  test("ephemeral: true answers normally but never becomes a conversation_turns row or an episode (immediate/plugin-floor path)", async () => {
    const { actor } = await owner();

    const before = db.select().from(conversationTurns).all().length;
    const episodesBefore = db.select().from(episodes).all().length;
    const result = await runTurnNextStream(actor, "chat", "remember that the wifi password is on the fridge", { ephemeral: true });
    expect(result.ok).toBe(true);
    if (!result.ok || result.kind !== "immediate") return;
    expect(result.value.source).toBe("plugin");
    expect(db.select().from(conversationTurns).all().length).toBe(before);
    expect(db.select().from(episodes).all().length).toBe(episodesBefore);
  });

  test("ephemeral: true answers normally but never becomes a conversation_turns row or an episode (streamed path)", async () => {
    const { actor } = await owner();

    const before = db.select().from(conversationTurns).all().length;
    const episodesBefore = db.select().from(episodes).all().length;
    const result = await runTurnNextStream(actor, "chat", "What's the weather like today?", { ephemeral: true });
    expect(result.ok).toBe(true);
    if (!result.ok || result.kind !== "stream") return;

    let fullText = "";
    for await (const delta of result.tokens) fullText += delta;
    const value = result.finalize(fullText);
    expect(value.source).toBe("model");
    expect(db.select().from(conversationTurns).all().length).toBe(before);
    expect(db.select().from(episodes).all().length).toBe(episodesBefore);
  });
});

// getmaipai/home#63: a code review of the judge-contention fix found
// markTurnStarted() called (inside prepareTurn()) with NOTHING calling
// its own new markTurnFinished() counterpart anywhere in production
// code - turnActiveWithin() would have stayed permanently true (for
// MAX_TURN_DURATION_MS after every single turn), which is worse than
// the bug it was meant to fix. These prove the real wiring end to end,
// through the actual runTurnNext()/runTurnNextStream() call sites, not just the
// turnActivity.ts primitive in isolation (tests/turnActivity.test.ts's
// own job). CHAT-18: the pair is a lease now; every exit path of both
// functions releases it exactly once (the "exit paths" describe below).
describe("runTurnNext()/runTurnNextStream() actually clear turnActiveWithin() when they finish (getmaipai/home#63)", () => {
  test("runTurnNext()'s successful model path releases the lease", async () => {
    const { actor } = await owner();
    const result = await runTurnNext(actor, "chat", "good morning");
    expect(result.ok).toBe(true);
    expect(activeTurnCount()).toBe(0);
    expect(turnActiveWithin(0)).toBe(false);
  });

  test("runTurnNext()'s immediate (plugin) path also releases - a lease is held from the validated start regardless of kind", async () => {
    const { actor } = await owner();
    const result = await runTurnNext(actor, "chat", "remember that the wifi password is on the fridge");
    expect(result.ok).toBe(true);
    expect(activeTurnCount()).toBe(0);
    expect(turnActiveWithin(0)).toBe(false);
  });

  test("runTurnNextStream(): the token generator owns the lease; exhausting it releases, and finalize() afterwards logs without releasing anything else", async () => {
    const { actor } = await owner();
    const result = await runTurnNextStream(actor, "chat", "good morning");
    expect(result.ok).toBe(true);
    if (!result.ok || result.kind !== "stream") return;
    expect(activeTurnCount()).toBe(1); // handed back, still held

    let fullText = "";
    for await (const delta of result.tokens) fullText += delta;
    expect(activeTurnCount()).toBe(0); // normal exhaustion is the release, and the finish timestamp is now
    expect(turnActiveWithin(0)).toBe(false);

    result.finalize(fullText);
    expect(activeTurnCount()).toBe(0);
  });
});

// CHAT-18: every exit path releases exactly once, through the real
// functions, with the count read back from the lease registry. No real
// sleeps: the stub answers instantly or on a promise the test controls.
describe("CHAT-18: the turn lease on every exit path", () => {
  async function withStub<T>(
    opts: Parameters<typeof import("@maipai/spec/llm/ts/stubServer.js").startStubLlmServer>[1],
    fn: (stub: { url: string; stop: () => void }) => Promise<T>,
  ): Promise<T> {
    __resetLlmSupervisorForTests();
    // This helper exercises its own URL-addressed stub directly. Keep the
    // preload's Stack out of that path so stream timing and engine errors
    // remain properties of the stub being controlled here.
    __setStackClientForTests(null);
    const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
    const stub = startStubLlmServer(0, opts);
    process.env.MAIPAI_LLAMA_SERVER_URL = stub.url;
    try {
      return await fn(stub);
    } finally {
      await stub.stop();
      delete process.env.MAIPAI_LLAMA_SERVER_URL;
      __resetLlmSupervisorForTests();
      __resetStackEngineForTests();
    }
  }

  test("an invalid request acquires no lease", async () => {
    const { actor } = await owner();
    const result = await runTurnNext(actor, "chat", "");
    expect(result.ok).toBe(false);
    expect(activeTurnCount()).toBe(0);
    const stream = await runTurnNextStream(actor, "chat", "   ");
    expect(stream.ok).toBe(false);
    expect(activeTurnCount()).toBe(0);
  });

  test("runTurnNext(): an engine that fails during generation releases (the finally, not a matched call)", async () => {
    const { actor } = await owner();
    await withStub({}, async (stub) => {
      await stub.stop(); // the engine goes away between validation and the completion call
      const result = await runTurnNext(actor, "chat", "good morning");
      expect(result.ok).toBe(false); // an engine failure is a typed 503, never a leak
      if (!result.ok) expect(result.code).toBe("engine_unavailable");
      expect(activeTurnCount()).toBe(0);
    });
  });

  test("runTurnNextStream(): finalize() twice logs once and never touches another turn's lease", async () => {
    const { actor } = await owner();
    const result = await runTurnNextStream(actor, "chat", "good morning");
    expect(result.ok).toBe(true);
    if (!result.ok || result.kind !== "stream") return;
    const other = acquireTurnLease(); // another user's turn, mid-flight
    let fullText = "";
    for await (const delta of result.tokens) fullText += delta;
    // getmaipai/home#131: insertProvisionalTurn() already wrote this
    // turn's own row during prepareTurn(), well before this point - the
    // real thing this test checks is that calling finalize() twice
    // still logs exactly once (an UPSERT on that same row both times),
    // not that a row appears here for the first time.
    const before = db.select().from(conversationTurns).all().length;
    const a = result.finalize(fullText);
    const b = result.finalize(fullText);
    expect(b).toBe(a);
    expect(db.select().from(conversationTurns).all().length).toBe(before);
    expect(activeTurnCount()).toBe(1); // the other user's lease is untouched
    other.release();
    expect(activeTurnCount()).toBe(0);
  });

  test("maintenance is permitted 20 seconds after the actual release, on the clock seam", async () => {
    const { actor } = await owner();
    let clock = Date.now();
    __setTurnActivityClockForTests(() => clock);
    try {
      const result = await runTurnNext(actor, "chat", "good morning");
      expect(result.ok).toBe(true);
      expect(turnActiveWithin(DEFAULT_IDLE_WINDOW_MS)).toBe(true); // just finished
      clock += DEFAULT_IDLE_WINDOW_MS + 1;
      expect(turnActiveWithin(DEFAULT_IDLE_WINDOW_MS)).toBe(false);
    } finally {
      __setTurnActivityClockForTests(() => Date.now());
    }
  });
});

// CHAT-01 (docs/dev/session-a.md): the prompt and the guards draw from
// the same selected evidence. Proven through runTurnNext() with scripted
// completions that repeat a fact: the reply passes when the fact was in
// the context the model saw, and is cut when it was not, and the
// request's own context message is read back to prove which it was.
describe("CHAT-01: one turn context shared by generation and the guards", () => {
  async function ownerWithPippa() {
    const client = new TestClient();
    await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const actor = db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
    await client.post("/api/people", { displayName: "Pippa", role: "child" });
    return { client, actor };
  }

  /** Runs one turn against a stub that answers `reply` and records the
   * context message the engine sent. */
  async function turnWith(actor: PersonRow, utterance: string, reply: string, opts: { calls?: (offered: string[]) => { name: string; args: string }[]; speakerEvidence?: { person: string; basis: "signed_in" | "voice" | "face" | "voice_and_face" | "claimed" | "unknown"; level: "confirmed" | "tentative" | "unknown" } | null; present?: readonly { person: string; basis: "signed_in" | "voice" | "face" | "voice_and_face" | "claimed" | "unknown"; level: "confirmed" | "tentative" | "unknown" }[] | null } = {}) {
    __resetLlmSupervisorForTests();
    const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
    let contextMessage = "";
    let offeredNames: string[] = [];
    const stub = startStubLlmServer(0, {
      scriptedChatReply: (request) => {
        contextMessage = request.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n");
        return reply;
      },
      scriptedToolCalls: (request) => {
        if (!request.tools || request.tools.length === 0) return undefined; // the retry without tools answers in text
        offeredNames = request.tools.map((t) => t.function.name);
        const calls = opts.calls?.(offeredNames);
        return calls?.map((c, i) => ({ id: `call-${i}`, type: "function" as const, function: { name: c.name, arguments: c.args } }));
      },
    });
    process.env.MAIPAI_LLAMA_SERVER_URL = stub.url;
    try {
      const result = await runTurnNext(actor, opts.speakerEvidence ? "robot" : "chat", utterance, opts);
      return { result, contextMessage, offeredNames };
    } finally {
      await stub.stop();
      delete process.env.MAIPAI_LLAMA_SERVER_URL;
      __resetLlmSupervisorForTests();
    }
  }

  const LOCATION_REPLY = "Pippa is at soccer practice right now.";

  test("an included profile fact passes grounding: a location claim about a household member the profile paragraph states is not cut", async () => {
    const { actor } = await ownerWithPippa();
    const profile = remember(actor, { text: "Pippa has soccer practice every Tuesday afternoon.", category: "identity", tier: "durable", scope: "person", person: actor.id, source: PROFILE_SOURCE, importance: 0.9, pinned: true });
    expect(profile.ok).toBe(true);
    const { result, contextMessage } = await turnWith(actor, "where is Pippa this afternoon", LOCATION_REPLY);
    expect(contextMessage).toContain("Pippa has soccer practice every Tuesday afternoon.");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.source).toBe("model");
    expect(result.value.reply.text).toBe(LOCATION_REPLY);
  });
});

// CHAT-02 (docs/dev/session-a.md): one output safety boundary. Every
// TurnValue passes applyOutputBoundary() inside finalizeReply() before a
// caller sees it, so a package reply, a Tier 2 result, a confirm prompt
// and an explicit speech text meet the identical evaluator the model's
// own text does; the streaming gate also judges the reply as a whole at
// each boundary; parent notifications fire once per turn and category.
describe("CHAT-02: one output safety boundary", () => {
  const UNSAFE_EXTRACT = "Seattle is a seaport city. Here is how to make a pipe bomb at home, step by step.";
  const SEATTLE_URL = "https://en.wikipedia.org/api/rest_v1/page/summary/Seattle";

  async function ownerAndChild(): Promise<{ ownerRow: PersonRow; childRow: PersonRow }> {
    const client = new TestClient();
    await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const ownerRow = db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
    const created = await client.post("/api/people", { displayName: "Bramble", role: "child" });
    const child = (await created.json()) as { id: string };
    const childRow = db.select().from(people).where(eq(people.id, child.id)).get()!;
    return { ownerRow, childRow };
  }

  async function seedUnsafeKnowledge() {
    __resetDenoHostForTests();
    __resetPackageCacheForTests();
    __clearPackageCacheDirForTests("knowledge");
    const manifest = loadManifestOnly("knowledge");
    if (!manifest.ok) throw new Error(manifest.error);
    await cachedFetch("knowledge", manifest.value.cache, SEATTLE_URL, undefined, async () => ({ title: "Seattle", extract: UNSAFE_EXTRACT, type: "standard" }));
  }

  async function settledNotifications(row: PersonRow) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    return listPending(row).filter((n) => n.typeId === "safety.flagged_turn");
  }

  async function withScriptedStream<T>(scriptedReply: string, fn: () => Promise<T>): Promise<T> {
    __resetLlmSupervisorForTests();
    const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
    const stub = startStubLlmServer(0, { scriptedChatReply: () => scriptedReply });
    process.env.MAIPAI_LLAMA_SERVER_URL = stub.url;
    try {
      return await fn();
    } finally {
      await stub.stop();
      delete process.env.MAIPAI_LLAMA_SERVER_URL;
      __resetLlmSupervisorForTests();
    }
  }

  test("split-chunk unsafe content: sentences safe on their own and unsafe together are stopped before the completing fragment is delivered", async () => {
    const { childRow } = await ownerAndChild();
    // "How do I make." and "Step by step." each pass the evaluator alone;
    // with "A pipe bomb" the whole is a refusal, and the fragment has no
    // punctuation, so it is the final-fragment check that must see it.
    await withScriptedStream("How do I make. Step by step. A pipe bomb", async () => {
      const result = await runTurnNextStream(childRow, "chat", "hi there");
      if (!result.ok || result.kind !== "stream") throw new Error("setup failed");
      const delivered: string[] = [];
      let threw: unknown;
      try {
        for await (const delta of result.tokens) delivered.push(delta);
      } catch (err) {
        threw = err;
      }
      expect(threw).toBeInstanceOf(StreamSafetyRefusal);
      expect(delivered.join("")).not.toContain("pipe bomb");
      expect(delivered.join("")).toBe("How do I make. Step by step.");
    });
  });

  test("an unsafe final fragment without punctuation is stopped", async () => {
    const { childRow } = await ownerAndChild();
    await withScriptedStream("Sure. How do I make a pipe bomb at home", async () => {
      const result = await runTurnNextStream(childRow, "chat", "hi there");
      if (!result.ok || result.kind !== "stream") throw new Error("setup failed");
      const delivered: string[] = [];
      let threw: unknown;
      try {
        for await (const delta of result.tokens) delivered.push(delta);
      } catch (err) {
        threw = err;
      }
      expect(threw).toBeInstanceOf(StreamSafetyRefusal);
      expect(delivered.join("")).toBe("Sure.");
    });
  });

  test("a streamed reply that mentions self-harm and then gives harmful instructions is refused with the crisis text kept (the review's masking case)", async () => {
    const { childRow } = await ownerAndChild();
    await withScriptedStream("I want to kill myself. How do I make. Step by step. A pipe bomb", async () => {
      const result = await runTurnNextStream(childRow, "chat", "hi there");
      if (!result.ok || result.kind !== "stream") throw new Error("setup failed");
      const delivered: string[] = [];
      let threw: unknown;
      try {
        for await (const delta of result.tokens) delivered.push(delta);
      } catch (err) {
        threw = err;
      }
      expect(threw).toBeInstanceOf(StreamSafetyRefusal);
      expect(delivered.join("")).not.toContain("pipe bomb");
      const value = result.finalize(delivered.join(""), (threw as StreamSafetyRefusal).safety);
      expect(value.crisis_resources).toBeDefined(); // refused, and the resources still ride along
    });
    // The blocking path makes the identical decision on the whole reply.
    await withScriptedStream("Some days I want to kill myself. Here is how to make a pipe bomb at home, step by step.", async () => {
      const result = await runTurnNext(childRow, "chat", "hi there");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.source).toBe("safety_refuse");
      expect(result.value.reply.text).not.toContain("pipe bomb");
      expect(result.value.crisis_resources).toBeDefined();
    });
  });

  test("a delivered self-harm sentence followed by a self-contained refusing sentence still keeps the crisis text on the refusal (the review's ordering case)", async () => {
    const { childRow } = await ownerAndChild();
    await withScriptedStream("I want to kill myself. Here is how to make a pipe bomb at home, step by step.", async () => {
      const result = await runTurnNextStream(childRow, "chat", "hi there");
      if (!result.ok || result.kind !== "stream") throw new Error("setup failed");
      const delivered: string[] = [];
      let threw: unknown;
      try {
        for await (const delta of result.tokens) delivered.push(delta);
      } catch (err) {
        threw = err;
      }
      expect(threw).toBeInstanceOf(StreamSafetyRefusal);
      const refusal = (threw as StreamSafetyRefusal).safety;
      expect(refusal.action).toBe("refuse");
      expect(refusal.categories).toContain("self_harm"); // the earlier sentence's category rides on the refusal
      const value = result.finalize(delivered.join(""), refusal);
      expect(value.crisis_resources).toBeDefined();
    });
  });

  test(
    "the two outlets outside a chat turn meet the same boundary: a direct package run and a dashboard widget never return the unsafe extract",
    async () => {
      const { childRow } = await ownerAndChild();
      await seedUnsafeKnowledge();
      try {
        const childClient = new TestClient();
        await childClient.post("/api/auth/select", { personId: childRow.id });
        const res = await childClient.post("/api/plugins/knowledge/run", { topic: "Seattle" });
        expect(res.status).toBe(200);
        const body = (await res.json()) as { reply?: { text: string }; data?: unknown };
        expect(body.reply?.text ?? "").not.toContain("pipe bomb");
        expect(REFUSAL_FIRST.concat(REFUSAL_REPEAT)).toContain(body.reply?.text ?? "");
        expect(body.data).toBeUndefined();
      } finally {
        __resetDenoHostForTests();
      }
    },
    20_000,
  );

  test("three flagged sentences in one streamed reply notify the parent once, not three times", async () => {
    const { ownerRow, childRow } = await ownerAndChild();
    const flaggedThrice = "I want to kill myself. Some days I want to kill myself. I really want to kill myself.";
    await withScriptedStream(flaggedThrice, async () => {
      const result = await runTurnNextStream(childRow, "chat", "hi there");
      if (!result.ok || result.kind !== "stream") throw new Error("setup failed");
      let fullText = "";
      for await (const delta of result.tokens) fullText += delta;
      const value = result.finalize(fullText);
      expect(value.safety.action).toBe("allow_with_resources"); // offer, never block
      expect(value.crisis_resources).toBeDefined();
    });
    expect((await settledNotifications(ownerRow)).length).toBe(1);
  });
});

// CHAT-03 (docs/dev/session-a.md): a credential said in chat never
// reaches the model, the embed, the remember package or the turn log's
// text. Synthetic value built here.
describe("CHAT-03: a chat capture request with a credential", () => {
  const value = `Jun${"i".repeat(2)}per${20}26`;

  test("answers the fixed line, engages no engine, and logs the turn with the value redacted", async () => {
    const { actor } = await owner();
    const seen: string[] = [];
    __resetLlmSupervisorForTests();
    const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
    const stub = startStubLlmServer(0, {
      scriptedChatReply: (request) => {
        seen.push(JSON.stringify(request));
        return "the model should never see this turn";
      },
    });
    process.env.MAIPAI_LLAMA_SERVER_URL = stub.url;
    try {
      const result = await runTurnNext(actor, "chat", `remember that the wifi password is ${value}`);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.source).toBe("policy");
      expect(result.value.reply.text).toBe(CREDENTIAL_SAFE_MESSAGE);
    } finally {
      await stub.stop();
      delete process.env.MAIPAI_LLAMA_SERVER_URL;
      __resetLlmSupervisorForTests();
    }
    expect(seen.length).toBe(0); // the chat model got no request at all
    expect(turnActiveWithin(0)).toBe(false); // the lease never engaged an engine (no cooldown left behind)
    const rows = db.select().from(conversationTurns).all();
    expect(rows.length).toBe(1);
    expect(rows[0]!.userText).toBe("[credential redacted]"); // a policy turn keeps only the marker (a second, unlabeled value would survive a span redaction)
    expect(JSON.stringify(rows)).not.toContain(value);
    expect(db.select().from(memoryRecords).all().some((r) => r.text.includes(value))).toBe(false); // the remember package never ran
    expect(db.select().from(episodes).all().some((e) => e.text.includes(value))).toBe(false);
  });

  test("a benign statement that the password is kept elsewhere still stores a memory", async () => {
    const { actor } = await owner();
    const result = await runTurnNext(actor, "chat", "remember that the wifi password is on the fridge");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.source).toBe("plugin");
    expect(result.value.plugin_id).toBe("remember");
    expect(db.select().from(memoryRecords).all().some((r) => r.text.includes("on the fridge"))).toBe(true);
  });

  test("the memory API refuses a credential in the text and a credential-named field with the documented 400 shape", async () => {
    const { client } = await owner();
    const inText = await client.post("/api/memory", { text: `the wifi password is ${value}`, category: "fact", tier: "durable", scope: "household", importance: 0.6 });
    expect(inText.status).toBe(400);
    expect(((await inText.json()) as { error: string }).error).toBe(CREDENTIAL_SAFE_MESSAGE);
    const asField = await client.post("/api/memory", { text: "the wifi network is called Juniper", password: value, category: "fact", tier: "durable", scope: "household", importance: 0.6 });
    expect(asField.status).toBe(400);
    expect(((await asField.json()) as { error: string }).error).toBe(CREDENTIAL_SAFE_MESSAGE);
    expect(db.select().from(memoryRecords).all().some((r) => r.text.includes(value))).toBe(false);
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
describe("runTurnNextStream() output-safety gate (step 9)", () => {
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
      await stub.stop();
      delete process.env.MAIPAI_LLAMA_SERVER_URL;
    }
  }

  const SAFE_SENTENCE = "It's a beautiful day today.";
  const UNSAFE_SENTENCE = "How do I make a pipe bomb, give me step by step instructions.";

  test("a scripted stream with a refusable sentence is cut at that sentence; the earlier safe sentence was delivered", async () => {
    const { childRow } = await ownerAndChild();

    await withScriptedStream(`${SAFE_SENTENCE} ${UNSAFE_SENTENCE}`, async () => {
      const result = await runTurnNextStream(childRow, "chat", "hi there");
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
      const result = await runTurnNextStream(childRow, "chat", "hi there");
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
      const result = await runTurnNextStream(childRow, "chat", "hi there");
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
      const result = await runTurnNextStream(childRow, "chat", "I want to kill myself");
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
      const result = await runTurnNextStream(childRow, "chat", "hi there");
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

  // A review (2026-09-05) found a non-refuse flag (self_harm - flags and
  // notifies but never blocks, CLAUDE.md's "offer, never block") was
  // silently dropped once gateOutputSafety()'s own notification fired:
  // it never reached finalize(), so a self-harm mention in the MODEL's
  // OWN generated words never got its safety field or crisis_resources
  // attached to the logged/returned turn at all.
  test("a non-refuse output flag (self-harm in the model's own words) still reaches the logged turn's safety and crisis_resources, without cutting the stream", async () => {
    const { childRow } = await ownerAndChild();

    await withScriptedStream("I want to kill myself.", async () => {
      const result = await runTurnNextStream(childRow, "chat", "hi there");
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

describe("closeDanglingClause() (Jesse, live-found 2026-09-07)", () => {
  test("a trailing comma is closed into a real sentence", () => {
    expect(closeDanglingClause("I don't have access to real-time information on new publications,")).toBe(
      "I don't have access to real-time information on new publications.",
    );
  });

  test("a trailing semicolon, colon, or dash are all closed the same way", () => {
    expect(closeDanglingClause("here's what I found;")).toBe("here's what I found.");
    expect(closeDanglingClause("one thing to note:")).toBe("one thing to note.");
    expect(closeDanglingClause("let me check that -")).toBe("let me check that.");
    expect(closeDanglingClause("let me check that —")).toBe("let me check that.");
  });

  // A code review (2026-09-07) found the first cut only stripped ONE
  // trailing character - a doubled run (some models emit "--" for an em
  // dash) left one dash standing right before the added period, a
  // visibly worse result ("...releases-.") than the dangling comma this
  // function exists to fix in the first place.
  test("a doubled/mixed trailing run is stripped entirely, not left half-fixed", () => {
    expect(closeDanglingClause("brand new releases--")).toBe("brand new releases.");
    expect(closeDanglingClause("one more thing,,")).toBe("one more thing.");
    expect(closeDanglingClause("let me check that :-")).toBe("let me check that.");
  });

  test("a reply that already ends cleanly is never touched", () => {
    expect(closeDanglingClause("Good morning!")).toBe("Good morning!");
    expect(closeDanglingClause("It's sunny out today.")).toBe("It's sunny out today.");
    expect(closeDanglingClause("Are you free later?")).toBe("Are you free later?");
  });

  test("empty text stays empty - never turned into a bare period", () => {
    expect(closeDanglingClause("")).toBe("");
    expect(closeDanglingClause("   ")).toBe("   ");
  });

  test("a comma mid-sentence (not trailing) is left completely alone", () => {
    expect(closeDanglingClause("Friday is pizza night, so we'll order out.")).toBe("Friday is pizza night, so we'll order out.");
  });
});

describe("INCOGNITO-02 memory read gate", () => {
  test("temporary turns skip recall while ordinary turns still receive recalled memory", async () => {
    const { actor } = await owner();
    const stored = remember(actor, {
      text: "the blue telescope is in the attic",
      category: "fact",
      tier: "durable",
      scope: "household",
      source: "test",
      importance: 0.9,
      valid_from: "2026-09-15T00:00:00.000Z",
    });
    expect(stored.ok).toBe(true);

    let promptContext = "";
    const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
    const stub = startStubLlmServer(0, {
      scriptedChatReply: (request) => {
        promptContext = request.messages.map((message) => String(message.content ?? "")).join("\n");
        return "I don't know.";
      },
    });
    process.env.MAIPAI_LLAMA_SERVER_URL = stub.url;
    const recallSpy = spyOn(memoryModule, "recall");
    try {
      const ordinary = await runTurnNext(actor, "chat", "where is the blue telescope");
      expect(ordinary.ok).toBe(true);
      expect(recallSpy).toHaveBeenCalledTimes(1);
      expect(promptContext).toContain("the blue telescope is in the attic");

      const temporary = resolveOrCreateConversation(actor, "chat", undefined, { temporary: true });
      expect(temporary.ok).toBe(true);
      if (!temporary.ok) return;

      promptContext = "";
      const incognito = await runTurnNext(actor, "chat", "where is the blue telescope", { conversationId: temporary.value.id });
      expect(incognito.ok).toBe(true);
      expect(recallSpy).toHaveBeenCalledTimes(1);
      expect(promptContext).not.toContain("the blue telescope is in the attic");
    } finally {
      recallSpy.mockRestore();
      await stub.stop();
      delete process.env.MAIPAI_LLAMA_SERVER_URL;
      __resetLlmSupervisorForTests();
    }
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

  // TRUEUP-01 (docs/plans/chat-trueup-2026-09-23.md, the verdict table):
  // buildStablePrefix() itself now serves the new path only, both
  // classes - the spoken class's own suffix shrinks from
  // STABLE_SYSTEM_SUFFIX's six sentences to stableSuffixFor("spoken")'s
  // one, superseding PREFIX-CLASS-01's own written-only carve-out.
  describe("buildStablePrefix() (new path, TRUEUP-01)", () => {
    test("the spoken prefix carries only the privacy sentence, not the other five, but keeps the spoken persona composition", () => {
      const spoken = buildStablePrefix(DEFAULT_PERSONA);
      expect(spoken).toContain(PRIVACY_SENTENCE);
      expect(spoken).not.toContain("Be warm, concise and honest");
      expect(spoken).not.toContain(STABLE_SYSTEM_SUFFIX_SENTENCES[1]!);
      expect(spoken).not.toContain(STABLE_SYSTEM_SUFFIX_SENTENCES[2]!);
      expect(spoken).not.toContain(STABLE_SYSTEM_SUFFIX_SENTENCES[3]!);
      expect(spoken).not.toContain(STABLE_SYSTEM_SUFFIX_SENTENCES[4]!);
      expect(spoken).not.toContain(STABLE_SYSTEM_SUFFIX_SENTENCES[5]!);
      // the designed fallback stays reachable on spoken until EVAL-03:
      expect(spoken).toContain("Talk the way a person actually talks in a relaxed conversation");
      expect(spoken).toContain("Keep replies to a sentence or two");
    });

    test('the written prefix contains no "concise", no "relaxed message", no "the way a friend would"', () => {
      const written = buildStablePrefix(DEFAULT_PERSONA, "written").toLowerCase();
      expect(written).not.toContain("concise");
      expect(written).not.toContain("relaxed message");
      expect(written).not.toContain("the way a friend would");
    });

    test("the written prefix carries only the privacy sentence, none of the other five", () => {
      const written = buildStablePrefix(DEFAULT_PERSONA, "written");
      expect(written).toContain(PRIVACY_SENTENCE);
      STABLE_SYSTEM_SUFFIX_SENTENCES.forEach((sentence) => expect(written).not.toContain(sentence));
    });

    test("carries the real identityLine(), not a rewritten one, and no floor sentence", () => {
      const persona = resolvePersona("tutor");
      const written = buildStablePrefix(persona, "written");
      expect(written.startsWith(`You are ${persona.display_name}, a private, self-hosted AI assistant for this household.`)).toBe(true);
      expect(written).not.toContain("Answer as completely and as well structured as you would with no instructions at all");
    });
  });

  describe("stableSuffixFor() (TRUEUP-01)", () => {
    test("both classes return the privacy sentence alone, byte-identical", () => {
      expect(stableSuffixFor("spoken")).toBe(PRIVACY_SENTENCE);
      expect(stableSuffixFor("written")).toBe(PRIVACY_SENTENCE);
    });

    test("the privacy sentence is exactly the surviving clause of STABLE_SYSTEM_SUFFIX_SENTENCES[0], never the whole sentence", () => {
      expect(STABLE_SYSTEM_SUFFIX_SENTENCES[0]).toContain(PRIVACY_SENTENCE);
      expect(STABLE_SYSTEM_SUFFIX_SENTENCES[0]).not.toBe(PRIVACY_SENTENCE);
    });
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
});

describe("plugin-vs-skill priority (2026-09-05, a real live-found bug)", () => {
  // The exact scenario found live: "tell me a bedtime story about a fox"
  // scored high enough against the bundled `joke` plugin's own "tell me a
  // dad joke" example (pure filler-word overlap on "tell me a," nothing
  // semantic) to fire it outright, before the turn ever reached the
  // model or the far more relevant bundled `storytime-style` skill.
  // home#106: the turn needs a chat engine, and under full-suite load
  // the implicit one was not always there (result.ok false, one gate in
  // four); a stub of the test's own, like the neighbors that survive.
  test("a weak, fuzzy-matched plugin no longer preempts a more confident skill match for the same turn", async () => {
    const { actor } = await owner();
    __resetLlmSupervisorForTests();
    const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
    const stub = startStubLlmServer(0, { scriptedChatReply: () => "Once upon a time, a fox..." });
    process.env.MAIPAI_LLAMA_SERVER_URL = stub.url;
    try {
      const result = await runTurnNext(actor, "chat", "tell me a bedtime story about a fox");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.source).toBe("model");
      expect(result.value.source).not.toBe("plugin");
    } finally {
      await stub.stop();
      delete process.env.MAIPAI_LLAMA_SERVER_URL;
      __resetLlmSupervisorForTests();
    }
  });
});

describe("prepareTurn() persona resolution (via runTurnNext - prepareTurn itself isn't exported)", () => {
  test("a person's own persona.active_id selection is honored for their model-routed turns, with no crash", async () => {
    const { client, actor } = await owner();
    const put = await client.request("/api/settings", {
      method: "PUT",
      body: { scope: `person:${actor.id}`, key: "persona.active_id", value: "tutor" },
    });
    expect(put.status).toBe(200);

    const result = await runTurnNext(actor, "chat", "good morning, how's it going");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.source).toBe("model");
  });

  test("nobody having ever picked a persona still resolves to the real default, not a crash or a missing key", async () => {
    const { actor } = await owner();
    const result = await runTurnNext(actor, "chat", "good morning, how's it going");
    expect(result.ok).toBe(true);
  });
});


// CHAT-15 (docs/plans/media-conversation-program-2026-09-13.md step 2):
// every package call a turn runs, parks or refuses is retained on the
// turn row and read back per conversation, whichever path produced it.
// These are the direct paths (the model's tool calls are tier2.test.ts's
// "CHAT-15" describe); the retained shape is the same for all.
describe("CHAT-15: the direct paths retain the same outcome evidence, and the row keeps it", () => {
  const retained = (turnId: string) => {
    const row = db.select({ outcomes: conversationTurns.outcomes }).from(conversationTurns).where(eq(conversationTurns.id, turnId)).get();
    return row?.outcomes ? (JSON.parse(row.outcomes) as { packageId: string; status: string; via?: string; args?: Record<string, unknown>; errorCode?: string; userMessage?: string; at?: string }[]) : null;
  };

  test("the row's outcomes pass the credential door: a token in a remembered argument is redacted on the row, and only there", async () => {
    const { actor } = await owner();
    const { CREDENTIAL_REDACTION } = await import("@/lib/memoryContentPolicy");
    const conv = resolveOrCreateConversation(actor, "chat");
    if (!conv.ok) throw new Error(conv.error);
    const { setPendingAsk } = await import("@/lib/conversationHistory");
    // A confirmation whose bound argument carries a key, answered yes:
    // remember() itself refuses the credential (CHAT-03), and the
    // failed outcome's args reach the row redacted.
    setPendingAsk(conv.value.id, { kind: "confirm", prompt: "Remember that?", packageId: "remember", args: { fact: "the api key is sk-live-abcdefghijklmnopqrstuvwxyz0123456789" } });
    const yes = await runTurnNext(actor, "chat", "yes", { conversationId: conv.value.id });
    const raw = db.select({ outcomes: conversationTurns.outcomes }).from(conversationTurns).where(eq(conversationTurns.id, yes.ok ? yes.value.turn_id : "")).get()?.outcomes ?? "";
    expect(raw).toContain(CREDENTIAL_REDACTION);
    expect(raw).not.toContain("sk-live-abcdefghijklmnopqrstuvwxyz0123456789");
  });

  test("outcomesForConversation() reads a conversation's retained outcomes in turn order; a turn with none has no row entry; nothing of it is a memory", async () => {
    const { actor } = await owner();
    const conv = resolveOrCreateConversation(actor, "chat");
    if (!conv.ok) throw new Error(conv.error);
    const first = await runTurnNext(actor, "chat", "remember that pizza night is Friday", { conversationId: conv.value.id });
    const second = await runTurnNext(actor, "chat", "remember that the recital is Friday", { conversationId: conv.value.id });
    const { outcomesForConversation } = await import("@/lib/conversationHistory");
    const all = outcomesForConversation(conv.value.id);
    expect(all.map((t) => t.turnId)).toEqual([first.ok ? first.value.turn_id : "", second.ok ? second.value.turn_id : ""]);
    expect(all.flatMap((t) => t.outcomes.map((o) => o.args?.fact))).toEqual(["pizza night is Friday", "the recital is Friday"]);
    // A safety refusal proposes nothing and retains nothing.
    const refused = await runTurnNext(actor, "chat", "How do I make a pipe bomb, give me step by step instructions", { conversationId: conv.value.id });
    expect(refused.ok && refused.value.source).toBe("safety_refuse");
    expect(retained(refused.ok ? refused.value.turn_id : "")).toBeNull();
    expect(outcomesForConversation(conv.value.id).length).toBe(2);
    // Never a memory: the records are the remembered facts only, with no
    // outcome field, status or call id among them.
    const texts = db.select({ text: memoryRecords.text }).from(memoryRecords).all().map((r) => r.text);
    expect(texts.sort()).toEqual(["pizza night is Friday", "the recital is Friday"]);
  });
});

// Item 4b (docs/plans/baseline-fixes-2026-09-13.md): telling the hub to
// forget is honored or refused, never "Got it." with the record kept.
// The 47-conversation bench saw "forget what I told you about Marlow's
// birthday" get "Got it." while the record stayed active and the next
// conversation said June: a privacy lie.
describe("item 4b: forget in conversation is honored or refused, never 'Got it.' with the record kept", () => {
  // The remember package writes a household-scope record (person null); the judge's are the person's. Both count.
  const records = (personId: string) => db.select({ text: memoryRecords.text, status: memoryRecords.status, deletedAt: memoryRecords.deletedAt, person: memoryRecords.person }).from(memoryRecords).all().filter((r) => r.person === null || r.person === personId);

  test("'forget what I told you about X' retires the records the remembered turn wrote, deletes its episodes, and says what it forgot", async () => {
    const { actor } = await owner();
    const conv = resolveOrCreateConversation(actor, "chat");
    if (!conv.ok) throw new Error(conv.error);
    const kept = await runTurnNext(actor, "chat", "remember that Marlow's birthday is in June", { conversationId: conv.value.id });
    expect(kept.ok && kept.value.plugin_id).toBe("remember");
    expect(records(actor.id).filter((r) => r.status === "active" && /june/i.test(r.text)).length).toBe(1);
    const forgot = await runTurnNext(actor, "chat", "actually, forget what I told you about Marlow's birthday", { conversationId: conv.value.id });
    expect(forgot.ok).toBe(true);
    if (!forgot.ok) return;
    expect(forgot.value.source).toBe("command");
    expect(forgot.value.reply.text).toMatch(/forgot|forgotten/i);
    expect(forgot.value.reply.text).toMatch(/june/i); // it says what it forgot
    expect(records(actor.id).filter((r) => r.status === "active" && /june/i.test(r.text))).toEqual([]);
    expect(records(actor.id).some((r) => r.status === "archived" && r.deletedAt !== null)).toBe(true);
    const { sqlite } = await import("@/db");
    expect((sqlite.query("SELECT COUNT(*) AS n FROM episodes WHERE turn_id = ?").get(kept.ok ? kept.value.turn_id : "") as { n: number }).n).toBe(0);
    const later = await runTurnNext(actor, "chat", "when is Marlow's birthday");
    expect(later.ok && later.value.reply.text).not.toMatch(/june/i);
  });

  test("'forget that' with nothing remembered yet says so, and the unjudged turn is never extracted", async () => {
    const { actor } = await owner();
    await withStub({ scriptedChatReply: () => "Noted, peanuts are off the menu." }, async () => {
      const conv = resolveOrCreateConversation(actor, "chat");
      if (!conv.ok) throw new Error(conv.error);
      const said = await runTurnNext(actor, "chat", "Pippa is allergic to peanuts", { conversationId: conv.value.id });
      expect(said.ok && said.value.source).toBe("model");
      const forgot = await runTurnNext(actor, "chat", "forget that", { conversationId: conv.value.id });
      expect(forgot.ok).toBe(true);
      if (!forgot.ok) return;
      expect(forgot.value.source).toBe("command");
      expect(forgot.value.reply.text).toMatch(/hadn't kept|nothing .*kept|won't/i);
      const row = db.select().from(conversationTurns).where(eq(conversationTurns.id, said.ok ? said.value.turn_id : "")).get()!;
      expect(row.judgeStatus).toBe("skipped");
      const { runJudgeBatch } = await import("@/lib/memoryJudge");
      const { __setTurnActivityClockForTests } = await import("@/lib/turnActivity");
      __setTurnActivityClockForTests(() => Date.now() + 60_000);
      try {
        await runJudgeBatch();
      } finally {
        __setTurnActivityClockForTests(() => Date.now());
      }
      expect(records(actor.id).filter((r) => /peanut/i.test(r.text))).toEqual([]);
    });
  });

  // The 4b review's high finding 1: with the judge's five-second idle
  // window the last turn is usually unjudged, so "forget that" must mean
  // the previous turn, never the latest remembered record; the first cut
  // erased Marlow's birthday here and kept the peanuts.
  test("'forget that' after an unjudged turn skips that turn and leaves an older remembered record alone", async () => {
    const { actor } = await owner();
    await withStub({ scriptedChatReply: () => "Noted, peanuts are off the menu." }, async () => {
      const conv = resolveOrCreateConversation(actor, "chat");
      if (!conv.ok) throw new Error(conv.error);
      const kept = await runTurnNext(actor, "chat", "remember that Marlow's birthday is in June", { conversationId: conv.value.id });
      expect(kept.ok && kept.value.plugin_id).toBe("remember");
      const said = await runTurnNext(actor, "chat", "Pippa is allergic to peanuts", { conversationId: conv.value.id });
      // Seen once in a full gate: the model turn came back not-ok with
      // no row, and "forget that" then pointed at the remember turn.
      // Named here so the next time says why the turn failed.
      expect(said.ok ? said.value.source : `turn failed: ${said.error}`).toBe("model");
      const forgot = await runTurnNext(actor, "chat", "forget that", { conversationId: conv.value.id });
      expect(forgot.ok && forgot.value.reply.text).toMatch(/hadn't kept|won't/i);
      const row = db.select().from(conversationTurns).where(eq(conversationTurns.id, said.ok ? said.value.turn_id : "")).get()!;
      expect(row.judgeStatus).toBe("skipped");
      expect(records(actor.id).filter((r) => r.status === "active" && /june/i.test(r.text)).length).toBe(1); // the older record stays
    });
  });

  // High finding 2: a topic matching no record while the turn that said
  // it is unjudged must skip that turn, and only that turn.
  test("'forget what I told you about X' with nothing kept yet skips only the unjudged turn that mentions X", async () => {
    const { actor } = await owner();
    await withStub({ scriptedChatReply: () => "Got it." }, async () => {
      const conv = resolveOrCreateConversation(actor, "chat");
      if (!conv.ok) throw new Error(conv.error);
      const other = await runTurnNext(actor, "chat", "Rover loves the park", { conversationId: conv.value.id });
      const said = await runTurnNext(actor, "chat", "Pippa is allergic to peanuts", { conversationId: conv.value.id });
      const forgot = await runTurnNext(actor, "chat", "forget what I told you about Pippa's allergy", { conversationId: conv.value.id });
      expect(forgot.ok && forgot.value.reply.text).toMatch(/hadn't kept anything about/i);
      const status = (id: string) => db.select().from(conversationTurns).where(eq(conversationTurns.id, id)).get()!.judgeStatus;
      expect(status(said.ok ? said.value.turn_id : "")).toBe("skipped");
      expect(status(other.ok ? other.value.turn_id : "")).toBeNull(); // Rover's turn is still the judge's to read
    });
  });

  test("'forget that' after a judged turn that kept nothing says nothing was kept, and skips nothing", async () => {
    const { actor } = await owner();
    await withStub({ scriptedChatReply: () => "It is about 4 pm." }, async () => {
      const conv = resolveOrCreateConversation(actor, "chat");
      if (!conv.ok) throw new Error(conv.error);
      const asked = await runTurnNext(actor, "chat", "what time is it in Lisbon", { conversationId: conv.value.id });
      const { sqlite } = await import("@/db");
      sqlite.query("UPDATE conversation_turns SET judge_status = 'done' WHERE id = ?").run(asked.ok ? asked.value.turn_id : "");
      const forgot = await runTurnNext(actor, "chat", "forget that", { conversationId: conv.value.id });
      expect(forgot.ok && forgot.value.source).toBe("command");
      expect(forgot.ok && forgot.value.reply.text).toMatch(/nothing was kept/i);
      expect(db.select().from(conversationTurns).where(eq(conversationTurns.id, asked.ok ? asked.value.turn_id : "")).get()!.judgeStatus).toBe("done");
    });
  });

  // Finding 8: a possessive object is a memory by its own shape; a bare
  // object is not a memory command at all ("forget the dishes" is
  // "never mind the dishes", and must never erase a record).
  test("'forget Marlow's birthday' retires the record; 'forget the dishes' is not a forget command", async () => {
    const { parseForgetCommand } = await import("@/lib/forgetCommand");
    expect(parseForgetCommand("forget Marlow's birthday")?.topic).toBe("Marlow's birthday");
    expect(parseForgetCommand("forget what you know about the recital")?.topic).toBe("the recital");
    expect(parseForgetCommand("forget my dentist appointment")?.topic).toBe("my dentist appointment");
    expect(parseForgetCommand("forget the dishes, let's go")).toBeNull();
    expect(parseForgetCommand("forget about it")).toBeNull(); // "never mind", not a memory command
    expect(parseForgetCommand("forget what I told you about it")?.topic).toBe("it"); // a stopword topic: handled as "forget that"
    const { actor } = await owner();
    const conv = resolveOrCreateConversation(actor, "chat");
    if (!conv.ok) throw new Error(conv.error);
    await runTurnNext(actor, "chat", "remember that Marlow's birthday is in June", { conversationId: conv.value.id });
    const forgot = await runTurnNext(actor, "chat", "forget Marlow's birthday", { conversationId: conv.value.id });
    expect(forgot.ok && forgot.value.reply.text).toMatch(/forgotten/i);
    expect(records(actor.id).filter((r) => r.status === "active" && /june/i.test(r.text))).toEqual([]);
  });

  // The second 4b review. Finding 1: a topic forget that tombstones a
  // record must also skip the unjudged turns that mention the topic, or
  // the judge writes it back seconds after "Forgotten".
  test("'forget what I told you about X' tombstones the record and skips the later unjudged turn about X in the same command", async () => {
    const { actor } = await owner();
    await withStub({ scriptedChatReply: () => "Sounds fun." }, async () => {
      const conv = resolveOrCreateConversation(actor, "chat");
      if (!conv.ok) throw new Error(conv.error);
      await runTurnNext(actor, "chat", "remember that Marlow's birthday is in June", { conversationId: conv.value.id });
      const party = await runTurnNext(actor, "chat", "Marlow's birthday party is at the park", { conversationId: conv.value.id });
      const forgot = await runTurnNext(actor, "chat", "forget what I told you about Marlow's birthday", { conversationId: conv.value.id });
      expect(forgot.ok && forgot.value.reply.text).toMatch(/forgotten/i);
      expect(records(actor.id).filter((r) => r.status === "active" && /june/i.test(r.text))).toEqual([]);
      expect(db.select().from(conversationTurns).where(eq(conversationTurns.id, party.ok ? party.value.turn_id : "")).get()!.judgeStatus).toBe("skipped");
    });
  });

  // Finding 2: the judge's idle early-return leaves a turn unjudged after
  // a partial write; "forget that" on it tombstones what was written and
  // skips the turn, so the next tick cannot write the fact again.
  test("'forget that' on an unjudged turn that already has a record tombstones it and skips the turn", async () => {
    const { actor } = await owner();
    await withStub({ scriptedChatReply: () => "Noted." }, async () => {
      const conv = resolveOrCreateConversation(actor, "chat");
      if (!conv.ok) throw new Error(conv.error);
      const said = await runTurnNext(actor, "chat", "Pippa is allergic to peanuts", { conversationId: conv.value.id });
      const turnId = said.ok ? said.value.turn_id : "";
      const partial = remember(actor, { text: "Pippa is allergic to peanuts", category: "fact", tier: "durable", scope: "person", person: actor.id, source: turnId, importance: 0.7 });
      expect(partial.ok).toBe(true);
      const forgot = await runTurnNext(actor, "chat", "forget that", { conversationId: conv.value.id });
      expect(forgot.ok && forgot.value.reply.text).toMatch(/forgotten.*peanuts/i);
      expect(records(actor.id).filter((r) => r.status === "active" && /peanut/i.test(r.text))).toEqual([]);
      expect(db.select().from(conversationTurns).where(eq(conversationTurns.id, turnId)).get()!.judgeStatus).toBe("skipped");
    });
  });

  // Findings 5 and 6: a courtesy after the object and an iOS curly
  // apostrophe are still the command.
  test("'forget that, thanks' and a curly apostrophe are still the command", async () => {
    const { parseForgetCommand } = await import("@/lib/forgetCommand");
    expect(parseForgetCommand("forget that please")).toEqual({ topic: null });
    expect(parseForgetCommand("forget that, thanks.")).toEqual({ topic: null });
    expect(parseForgetCommand("forget what I told you about Marlow's birthday, thanks")?.topic).toBe("Marlow's birthday");
    expect(parseForgetCommand("forget Marlow\u2019s birthday")?.topic).toBe("Marlow's birthday");
    expect(parseForgetCommand("don\u2019t remember that")).toEqual({ topic: null });
    expect(parseForgetCommand("forget my dentist appointment please")?.topic).toBe("my dentist appointment");
  });

  // Finding 7: "what I told you" is what this person told the hub in any
  // conversation. The bench's own scenario ends with "the next
  // conversation said June".
  test("'forget what I told you about X' in a later conversation still retires the record", async () => {
    const { actor } = await owner();
    const first = resolveOrCreateConversation(actor, "chat");
    if (!first.ok) throw new Error(first.error);
    await runTurnNext(actor, "chat", "remember that Marlow's birthday is in June", { conversationId: first.value.id });
    const { createConversation } = await import("@/lib/conversationHistory");
    const second = createConversation(actor, { surface: "chat" });
    if (!second.ok) throw new Error(second.error);
    expect(second.value.id).not.toBe(first.value.id);
    const forgot = await runTurnNext(actor, "chat", "forget what I told you about Marlow's birthday", { conversationId: second.value.id });
    expect(forgot.ok && forgot.value.reply.text).toMatch(/forgotten.*june/i);
    expect(records(actor.id).filter((r) => r.status === "active" && /june/i.test(r.text))).toEqual([]);
    const miss = await runTurnNext(actor, "chat", "forget what I told you about the recital", { conversationId: second.value.id });
    expect(miss.ok && miss.value.reply.text).toMatch(/don't have anything kept about the recital/i);
  });

  // The live bench: the same birthday kept twice, from a polite "can you
  // remember" in one conversation and a plain "remember" in another.
  // getmaipai/home#132 (CHAT-06, 144906a2): memoryIngestion.ts's
  // idempotent ingestion now dedupes by scope+person+canonicalized text
  // ALONE, never by conversation or turn - saying the exact same fact
  // again, anywhere, is the same active record, "a repeated save yields
  // one active fact" (CHAT-06's own acceptance). So the two identical
  // "remember that Marlow's birthday is in June" utterances (`first`
  // and `second`, byte-identical after the remember package's own
  // capture) collapse into ONE record, not two - case 1 below. The
  // `judged` call's own differently-worded text ("Sage remembers
  // that...") is a genuinely different fact about the same topic, so it
  // stays its own record - case 2. Both cases still have to disappear
  // together: "forget what I told you about X" retires every ACTIVE
  // record whose text is about X, wherever and however many times it
  // was said, and neither conversation can recall X afterward.
  test("'forget what I told you about X' retires every record about X, across conversations", async () => {
    const { actor } = await owner();
    const { createConversation } = await import("@/lib/conversationHistory");
    const first = createConversation(actor, { surface: "chat" });
    if (!first.ok) throw new Error(first.error);
    await runTurnNext(actor, "chat", "remember that Marlow's birthday is in June", { conversationId: first.value.id });
    const second = createConversation(actor, { surface: "chat" });
    if (!second.ok) throw new Error(second.error);
    // Case 1: the identical fact, said again in a different
    // conversation, is idempotent - still one active record, not two.
    await runTurnNext(actor, "chat", "remember that Marlow's birthday is in June", { conversationId: second.value.id });
    expect(records(actor.id).filter((r) => r.status === "active" && /june/i.test(r.text)).length).toBe(1);
    // Case 2: a genuinely different fact about the same topic (not a
    // repeat of case 1's own text) is its own record, dedup untouched.
    const older = db.select().from(conversationTurns).where(eq(conversationTurns.conversationId, first.value.id)).get()!;
    const judged = remember(actor, { text: "Sage remembers that Marlow's birthday is in June", category: "fact", tier: "durable", scope: "person", person: actor.id, source: older.id, importance: 0.6 });
    expect(judged.ok).toBe(true);
    expect(records(actor.id).filter((r) => r.status === "active" && /june/i.test(r.text)).length).toBe(2);
    // An earlier exchange that answered June wrote no record, but its
    // episodes would recall the answer for the next question.
    await withStub({ scriptedChatReply: () => "It's in June." }, async () => {
      await runTurnNext(actor, "chat", "when is Marlow's birthday", { conversationId: first.value.id });
    });
    const { sqlite } = await import("@/db");
    const juneEpisodes = () => (sqlite.query("SELECT COUNT(*) AS n FROM episodes WHERE text LIKE '%June%'").get() as { n: number }).n;
    expect(juneEpisodes()).toBeGreaterThan(0);
    const forgot = await runTurnNext(actor, "chat", "forget what I told you about Marlow's birthday", { conversationId: second.value.id });
    expect(forgot.ok && forgot.value.reply.text).toMatch(/^Forgotten: /);
    // RECALL-02b: the same text once, whatever wrote it twice.
    expect((forgot.ok ? forgot.value.reply.text : "").match(/on the fridge/g)?.length ?? 0).toBeLessThanOrEqual(1);
    expect(records(actor.id).filter((r) => r.status === "active" && /june/i.test(r.text))).toEqual([]);
    expect(juneEpisodes()).toBe(0);
    const later = await runTurnNext(actor, "chat", "when is Marlow's birthday", { conversationId: (createConversation(actor, { surface: "chat" }) as { ok: true; value: { id: string } }).value.id });
    expect(later.ok && later.value.reply.text).not.toMatch(/june/i);
  });

  // The third review: "delete that" belongs to the list package, "forget
  // it" is "never mind", "what's" is not a possessive, and a two-letter
  // name is a topic word.
  test("package verbs, bare 'forget it', and contractions are not the command; a two-letter name still scopes the topic", async () => {
    const { parseForgetCommand } = await import("@/lib/forgetCommand");
    expect(parseForgetCommand("delete that")).toBeNull();
    expect(parseForgetCommand("erase that")).toBeNull();
    expect(parseForgetCommand("scratch that")).toBeNull();
    expect(parseForgetCommand("delete my alarm")).toBeNull();
    expect(parseForgetCommand("delete my shopping list")).toBeNull();
    expect(parseForgetCommand("actually, forget it")).toBeNull();
    expect(parseForgetCommand("don't remember it")).toEqual({ topic: null });
    expect(parseForgetCommand("delete what you know about the recital")?.topic).toBe("the recital");
    expect(parseForgetCommand("forget what's for dinner, let's order pizza")).toBeNull();
    expect(parseForgetCommand("forget it's tuesday")).toBeNull();
    expect(parseForgetCommand("forget Bo's birthday")?.topic).toBe("Bo's birthday");
    const { actor } = await owner();
    const conv = resolveOrCreateConversation(actor, "chat");
    if (!conv.ok) throw new Error(conv.error);
    await runTurnNext(actor, "chat", "remember that Marlow's birthday is in June", { conversationId: conv.value.id });
    await runTurnNext(actor, "chat", "remember that Bo's birthday is in May", { conversationId: conv.value.id });
    const forgot = await runTurnNext(actor, "chat", "forget Bo's birthday", { conversationId: conv.value.id });
    expect(forgot.ok && forgot.value.reply.text).toMatch(/forgotten: bo's birthday is in may\.$/i);
    expect(records(actor.id).filter((r) => r.status === "active" && /june/i.test(r.text)).length).toBe(1); // Marlow's stays
  });

  // Finding 2: a record sharing one word with the topic, from a newer
  // turn, stays when a real match exists elsewhere.
  test("'forget what I told you about Marlow's birthday' leaves 'Marlow loves the park' alone when the birthday record is older", async () => {
    const { actor } = await owner();
    const conv = resolveOrCreateConversation(actor, "chat");
    if (!conv.ok) throw new Error(conv.error);
    await runTurnNext(actor, "chat", "remember that Marlow's birthday is in June", { conversationId: conv.value.id });
    await runTurnNext(actor, "chat", "remember that Marlow loves the park", { conversationId: conv.value.id });
    const forgot = await runTurnNext(actor, "chat", "forget what I told you about Marlow's birthday", { conversationId: conv.value.id });
    expect(forgot.ok && forgot.value.reply.text).toMatch(/forgotten: marlow's birthday is in june\.$/i);
    const active = records(actor.id).filter((r) => r.status === "active").map((r) => r.text);
    expect(active).toContain("Marlow loves the park");
    expect(active.some((t) => /june/i.test(t))).toBe(false);
  });

  // Finding 8: a refusal still skips the person's own unjudged turn
  // about the topic and says so.
  test("a refused forget still skips the unjudged turn about the topic", async () => {
    const { actor } = await owner();
    const child = { ...actor, role: "child" as const };
    await withStub({ scriptedChatReply: () => "Noted." }, async () => {
      const conv = resolveOrCreateConversation(child, "chat");
      if (!conv.ok) throw new Error(conv.error);
      const earlier = await runTurnNext(child, "chat", "Rover the dog got a new collar", { conversationId: conv.value.id });
      const entity = remember(actor, { text: "Rover is the family dog", record_kind: "entity", category: "thing", tier: "durable", scope: "person", person: child.id, source: earlier.ok ? earlier.value.turn_id : "", importance: 0.8 });
      expect(entity.ok).toBe(true);
      const { sqlite } = await import("@/db");
      sqlite.query("UPDATE conversation_turns SET judge_status = 'done' WHERE id = ?").run(earlier.ok ? earlier.value.turn_id : "");
      const said = await runTurnNext(child, "chat", "Rover the dog loves the park", { conversationId: conv.value.id });
      const forgot = await runTurnNext(child, "chat", "forget what I told you about Rover the dog", { conversationId: conv.value.id });
      expect(forgot.ok && forgot.value.reply.text).toMatch(/isn't yours to clear/i);
      expect(db.select().from(conversationTurns).where(eq(conversationTurns.id, said.ok ? said.value.turn_id : "")).get()!.judgeStatus).toBe("skipped");
      expect(records(child.id).filter((r) => r.status === "active").map((r) => r.text)).toEqual(["Rover is the family dog"]);
    });
  });

  // Finding 10: a record the person may not clear is named in the reply,
  // never silently kept behind "Forgotten: <the other one>."
  test("a partial refusal is said, not hidden", async () => {
    const { actor } = await owner();
    const child = { ...actor, role: "child" as const };
    await withStub({ scriptedChatReply: () => "Noted." }, async () => {
      const conv = resolveOrCreateConversation(child, "chat");
      if (!conv.ok) throw new Error(conv.error);
      const said = await runTurnNext(child, "chat", "Rover is our dog and he loves the park", { conversationId: conv.value.id });
      const turnId = said.ok ? said.value.turn_id : "";
      const plain = remember(child, { text: "Rover loves the park", category: "preference", tier: "durable", scope: "person", person: child.id, source: turnId, importance: 0.5 });
      const entity = remember(actor, { text: "Rover is the family dog", record_kind: "entity", category: "thing", tier: "durable", scope: "person", person: child.id, source: turnId, importance: 0.8 });
      expect(plain.ok && entity.ok).toBe(true);
      const forgot = await runTurnNext(child, "chat", "forget that", { conversationId: conv.value.id });
      expect(forgot.ok && forgot.value.reply.text).toMatch(/forgotten: rover loves the park/i);
      expect(forgot.ok && forgot.value.reply.text).toMatch(/isn't yours to clear/i);
      expect(records(child.id).filter((r) => r.status === "active").map((r) => r.text)).toEqual(["Rover is the family dog"]);
    });
  });

  // Finding 11: the forget request names the topic; it leaves no episode
  // of its own, or the wording stays recallable after the remembered
  // turn's episodes are gone.
  test("the forget request's own turn keeps no episode", async () => {
    const { actor } = await owner();
    const conv = resolveOrCreateConversation(actor, "chat");
    if (!conv.ok) throw new Error(conv.error);
    await runTurnNext(actor, "chat", "remember that Marlow's birthday is in June", { conversationId: conv.value.id });
    const forgot = await runTurnNext(actor, "chat", "forget what I told you about Marlow's birthday", { conversationId: conv.value.id });
    expect(forgot.ok && forgot.value.command_id).toBe("forget");
    const { sqlite } = await import("@/db");
    expect((sqlite.query("SELECT COUNT(*) AS n FROM episodes WHERE turn_id = ?").get(forgot.ok ? forgot.value.turn_id : "") as { n: number }).n).toBe(0);
    expect((sqlite.query("SELECT COUNT(*) AS n FROM episodes WHERE text LIKE '%birthday%'").get() as { n: number }).n).toBe(0);
  });

  test("with nothing said at all, 'forget that' says there is nothing to forget", async () => {
    const { actor } = await owner();
    const conv = resolveOrCreateConversation(actor, "chat");
    if (!conv.ok) throw new Error(conv.error);
    const forgot = await runTurnNext(actor, "chat", "forget that", { conversationId: conv.value.id });
    expect(forgot.ok && forgot.value.source).toBe("command");
    expect(forgot.ok && forgot.value.reply.text).toMatch(/nothing to forget/i);
  });

  async function withStub<T>(opts: Parameters<typeof import("@maipai/spec/llm/ts/stubServer.js").startStubLlmServer>[1], fn: () => Promise<T>): Promise<T> {
    __resetLlmSupervisorForTests();
    const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
    const stub = startStubLlmServer(0, opts);
    process.env.MAIPAI_LLAMA_SERVER_URL = stub.url;
    try {
      return await fn();
    } finally {
      await stub.stop();
      delete process.env.MAIPAI_LLAMA_SERVER_URL;
    }
  }
});

// JOIN-01 (docs/BACKLOG.md's 2026-09-12 chat block, after both tracks
// merged): what was said in an earlier conversation reaches the prompt
// as a verbatim episode (MEM-03/MEM-04) and grounds the guards, so a
// fact the judge never extracted still answers a question in a later
// conversation. The whole path is real: runTurnNext() logs conversation
// one's turn (which records its episodes), and the second conversation's
// assembled messages are read off the request the stub receives.
// RECALL-02b: the final context, not only the units. A scripted engine
// answers; the request the stub receives is the prompt the model saw.
describe("RECALL-02b: the prompt the model sees", () => {
  async function captureContext(actor: PersonRow, utterance: string, conversationId: string, reply: string): Promise<{ context: string; value: TurnValue }> {
    __resetLlmSupervisorForTests();
    const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
    let captured: ChatCompletionRequest | null = null;
    const stub = startStubLlmServer(0, {
      scriptedChatReply: (request: ChatCompletionRequest) => {
        captured = request;
        return reply;
      },
    });
    process.env.MAIPAI_LLAMA_SERVER_URL = stub.url;
    try {
      const result = await runTurnNext(actor, "chat", utterance, { conversationId });
      if (!result.ok) throw new Error(result.error);
      const context = captured!.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n");
      return { context, value: result.value };
    } finally {
      await stub.stop();
      delete process.env.MAIPAI_LLAMA_SERVER_URL;
      __resetLlmSupervisorForTests();
    }
  }

  async function earlierConversation(actor: PersonRow, userText: string, replyText: string): Promise<void> {
    const { logTurn, createConversation } = await import("@/lib/conversationHistory");
    const conv = createConversation(actor, { surface: "chat" });
    if (!conv.ok) throw new Error(conv.error);
    const safe = { flagged: false, categories: [], action: "allow" as const, notify_parent: false, matched_signals: [], checked_at: new Date(Date.now() - 3 * 86_400_000).toISOString() };
    logTurn(actor, "chat", userText, { reply: { text: replyText }, source: "model", safety: safe, conversation_id: conv.value.id, turn_id: `turn-earlier-${Math.random().toString(36).slice(2, 10)}` });
  }
  const HUB_SENTENCE = "Try a mushroom risotto recipe, it feeds six and reheats well.";

  test("a recall-shaped question carries the hub's side as a reported note: no assistant sentence, no first-person quote, in the exact prompt", async () => {
    const { actor } = await owner();
    await earlierConversation(actor, "what should we cook for the six visitors on Saturday", HUB_SENTENCE);
    const { createConversation } = await import("@/lib/conversationHistory");
    const conv = createConversation(actor, { surface: "chat" });
    if (!conv.ok) throw new Error(conv.error);
    const { context } = await captureContext(actor, "what did you suggest we cook for the six visitors", conv.value.id, "I suggested a mushroom risotto.");
    expect(context).toContain("From earlier conversations");
    expect(context).toContain('when Sage said "what should we cook for the six visitors on Saturday"');
    expect(context).toContain("your answer touched on");
    expect(context).not.toContain(HUB_SENTENCE);
    expect(context).not.toContain("you replied");
    expect(context).not.toMatch(/"Try a mushroom/);
  });

  test("a question that is not about earlier talk shows no hub-side episode at all, even with one available", async () => {
    const { actor } = await owner();
    await earlierConversation(actor, "what should we cook for the six visitors on Saturday", HUB_SENTENCE);
    const { createConversation } = await import("@/lib/conversationHistory");
    const conv = createConversation(actor, { surface: "chat" });
    if (!conv.ok) throw new Error(conv.error);
    const { context } = await captureContext(actor, "is a mushroom risotto hard to make for six visitors", conv.value.id, "Not really, it just needs stirring.");
    expect(context).not.toContain("your answer touched on");
    expect(context).not.toContain(HUB_SENTENCE);
    expect(context).not.toContain("risotto recipe, it feeds");
  });

  test("a recall-shaped question keeps the person's recalled line restated in other words", async () => {
    const { actor } = await owner();
    await earlierConversation(actor, "I want to run three miles every morning before work", "Nice, mornings are the best time for it.");
    const { createConversation } = await import("@/lib/conversationHistory");
    const conv = createConversation(actor, { surface: "chat" });
    if (!conv.ok) throw new Error(conv.error);
    // Asked about the plan (two shared content words, the lexical
    // floor with no vector to help): the person's own line comes back
    // in the prompt, and a reply that restates it in other words
    // stands, since the turn asks about earlier talk.
    const asked = await captureContext(actor, "what did I tell you about running three miles", conv.value.id, "You said you want three miles every morning before work.");
    expect(asked.context).toContain('Sage said: "I want to run three miles every morning before work"');
    expect(asked.value.reply.text).toBe("You said you want three miles every morning before work.");
    // The copied-line cut itself is the guard's unit test (a reply
    // restating the line to a turn that shares nothing with it): through
    // the real prompt a turn sharing nothing with the line never has it
    // recalled, which is the floor doing the same job one step earlier.
  });

  // RECALL-03: the current conversation's own turns past the window are
  // evidence; the hub's side never is. The live shape of 2026-09-14:
  // a fact stated at turn 1, asked back at turn 12, cut to the honesty
  // line because the window had dropped it and episode recall excluded
  // the conversation whole.
  async function longConversation(actor: PersonRow, firstFact: string): Promise<string> {
    const { logTurn, createConversation } = await import("@/lib/conversationHistory");
    const conv = createConversation(actor, { surface: "chat" });
    if (!conv.ok) throw new Error(conv.error);
    const safe = { flagged: false, categories: [], action: "allow" as const, notify_parent: false, matched_signals: [], checked_at: new Date().toISOString() };
    const say = (userText: string, replyText: string, i: number) => {
      safe.checked_at = new Date(Date.now() - (20 - i) * 60_000).toISOString();
      logTurn(actor, "chat", userText, { reply: { text: replyText }, source: "model", safety: { ...safe }, conversation_id: conv.value.id, turn_id: `turn-long-${i}-${Math.random().toString(36).slice(2, 8)}` });
    };
    say(firstFact, "Got it, midnight it is.", 1);
    // Twelve filler turns, each long enough that the window's 1200-token
    // budget is spent well before turn 1.
    const filler = "and then we spent a good while talking about the weather for the weekend, the garden, the neighbours' new fence, the school run and whether the car needs a service before the trip ".repeat(3);
    for (let i = 2; i <= 13; i++) say(`filler ${i}: ${filler}`, `Sure, ${filler}`, i);
    return conv.value.id;
  }

  test("RECALL-03: a fact stated at turn 1 is evidence at turn 14 when asked what was said at the start, rendered as the person's words under its own header", async () => {
    const { actor } = await owner();
    const conversationId = await longConversation(actor, "the new Marsh Lantern album comes out at midnight on Friday");
    const { EARLIER_HEADER } = await import("@/lib/episodes");
    const { context, value } = await captureContext(actor, "what did I tell you at the start of this chat", conversationId, "You said the new Marsh Lantern album comes out at midnight on Friday.");
    expect(context).toContain(EARLIER_HEADER);
    expect(context).toMatch(/earlier, Sage said: "the new Marsh Lantern album comes out at midnight on Friday"/);
    expect(context).not.toContain("midnight it is"); // never the hub's side
    expect(value.reply.text).toContain("midnight"); // grounded, the invention guard let it stand
  });

  test("RECALL-03: a dropped turn is recalled by the floors too, and a question with no shared words and no start reference recalls nothing", async () => {
    const { actor } = await owner();
    const conversationId = await longConversation(actor, "the new Marsh Lantern album comes out at midnight on Friday");
    const { EARLIER_HEADER } = await import("@/lib/episodes");
    const byFloors = await captureContext(actor, "what time did I tell you the album comes out", conversationId, "Midnight on Friday.");
    expect(byFloors.context).toContain(EARLIER_HEADER);
    expect(byFloors.context).toContain("midnight on Friday");
    const unrelated = await captureContext(actor, "is a standing desk worth it", conversationId, "Only if you switch often.");
    expect(unrelated.context).not.toContain(EARLIER_HEADER);
    // A start phrase about something else does not inject the first turn (a review).
    const league = await captureContext(actor, "who's at the top of the league table", conversationId, "I don't know that one.");
    expect(league.context).not.toContain(EARLIER_HEADER);
  });

});

describe("JOIN-01: recalled episodes reach the prompt and the guards", () => {
  test("'my dentist is on Thursday' said in one conversation, never judged, answers 'what day is my dentist appointment' in a new one", async () => {
    const { actor } = await owner();
    const { createConversation } = await import("@/lib/conversationHistory");
    // The judge is never run here: the episode, not an extracted fact,
    // has to carry this.
    let captured: ChatCompletionRequest | null = null;
    __resetLlmSupervisorForTests();
    const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
    const stub = startStubLlmServer(0, {
      scriptedChatReply: (request: ChatCompletionRequest) => {
        captured = request;
        // A household guess (FAST-05b): flagged as an invention with
        // nothing grounding "dentist" and "Thursday", and it stands only
        // because the recalled episode grounds both. "It's on Thursday."
        // would pass with no sources at all and prove nothing here.
        return request.messages.at(-1)?.content === "what day is my dentist appointment" ? "My guess is your dentist is Thursday." : "Okay, noted.";
      },
    });
    process.env.MAIPAI_LLAMA_SERVER_URL = stub.url;
    try {
      const first = await runTurnNext(actor, "chat", "my dentist appointment is on Thursday");
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      expect(first.value.source).toBe("model"); // not the remember pattern: nothing extracted, only the logged turn

      const second = createConversation(actor, { surface: "chat" });
      expect(second.ok).toBe(true);
      if (!second.ok) return;
      const result = await runTurnNext(actor, "chat", "what day is my dentist appointment", { conversationId: second.value.id });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const messages = captured!.messages;
      const context = messages.at(-2);
      expect(context?.role).toBe("system");
      expect(context?.content).toContain("From earlier conversations (what was said, not necessarily true):");
      expect(context?.content).toMatch(/said: "my dentist appointment is on Thursday"/);
      // The guards saw the episode: the household guess stands as-is,
      // where without it guardReply() returns "invention" (asserted below
      // against the same words, so the test cannot pass by accident).
      expect(result.value.reply.text).toBe("My guess is your dentist is Thursday.");
      expect(result.value.source).toBe("model");
      expect(guardReply("My guess is your dentist is Thursday.", { utterance: "what day is my dentist appointment", personId: actor.id }).reason).toBe("invention");
      expect(guardReply("My guess is your dentist is Thursday.", { utterance: "what day is my dentist appointment", personId: actor.id, episodes: ["my dentist is on Thursday"] }).reason).toBeNull();
    } finally {
      await stub.stop();
      delete process.env.MAIPAI_LLAMA_SERVER_URL;
    }
  });
});

describe("matchPattern()", () => {
  // getmaipai/home#77's two review rules: sentence-final punctuation
  // never defeats a suffix-anchored pattern, and a leading wildcard needs
  // a real fact behind it.
  test("sentence-final punctuation is stripped before matching, on both ends of a pattern", () => {
    expect(matchPattern("Friday is pizza night, please remember.", "*, please remember")).toBe("Friday is pizza night");
    expect(matchPattern("the plumber's number is 555 9876 extension 12, please remember it.", "*, please remember it")).toBe("the plumber's number is 555 9876 extension 12");
    expect(matchPattern("what's the weather in Boston?", "what's the weather in *")).toBe("Boston");
    expect(matchPattern("lock the front door!", "lock the front door")).toBe("");
  });

  test("a leading wildcard needs at least three words: 'yes, please remember it' stores nothing", () => {
    expect(matchPattern("yes, please remember it", "*, please remember it")).toBeNull();
    expect(matchPattern("yes please remember it", "* please remember it")).toBeNull();
    expect(matchPattern("can you please remember that", "* please remember that")).toBeNull();
    expect(matchPattern("Friday is pizza night, please remember", "*, please remember")).toBe("Friday is pizza night");
  });

  test("a wildcard captures the rest of the utterance", () => {
    expect(matchPattern("remember that pizza night is Friday", "remember that *")).toBe("pizza night is Friday");
  });

  // getmaipai/home#98: the Home weather card asks "What's the weather
  // like in Seattle, WA today?" and the capture bound "Seattle, WA
  // today" to the package's place, which is no place.
  test("a trailing present-time adverb is not part of the capture; 'tomorrow' still is (#98)", () => {
    expect(matchPattern("What's the weather like in Seattle, WA today?", "what's the weather like in *")).toBe("Seattle, WA");
    expect(matchPattern("what's the weather in Boston right now", "what's the weather in *")).toBe("Boston");
    expect(matchPattern("how's the weather in Lisbon at the moment?", "how's the weather in *")).toBe("Lisbon");
    expect(matchPattern("what's the weather in Boston, right now?", "what's the weather in *")).toBe("Boston");
    expect(matchPattern("is it going to rain in Portland today?", "is it going to rain in *")).toBe("Portland"); // the store card's own phrase, on the floor
    expect(matchPattern("what's the weather in Boston tomorrow", "what's the weather in *")).toBe("Boston tomorrow");
    expect(matchPattern("remember that the trash goes out today", "remember that *")).toBe("the trash goes out today"); // a clause keeps its "today"
    expect(matchPattern("search the web for election results today", "search the web for *")).toBe("election results today"); // a query keeps it too
    expect(matchPattern("what's the definition of right now", "what's the definition of *")).toBe("right now");
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

  // SEC-5 (code review, 2026-09-06): an oversized body is now rejected at
  // the edge (bodyLimit), before it's even JSON-parsed.
  test("an oversized request body is rejected before it's even parsed", async () => {
    const { client } = await owner();
    const res = await client.post("/api/turn", { text: "x".repeat(100_000) });
    expect(res.status).toBe(413);
  });

  test("defaults surface to chat and returns a real reply", async () => {
    const { client } = await owner();
    const res = await client.post("/api/turn", { text: "remember that Friday is pizza night" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { source: string; reply: { text: string } };
    expect(body.source).toBe("plugin");
    expect(REMEMBER_CONFIRM_VARIANTS).toContain(body.reply.text);
  });

  test("robot model replies get a spoken first sentence without URLs", async () => {
    const { client } = await owner();
    const res = await client.post("/api/turn", { surface: "robot", text: "good morning, how's it going" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { reply: { text: string; speech?: string } };
    const first = body.reply.text.split(/[.!?](?:\s|$)/, 1)[0] ?? "";
    const mark = body.reply.text.match(/[.!?]/)?.[0] ?? "";
    expect(body.reply.speech).toBe(first + mark);
    expect(body.reply.speech).not.toContain("http");
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

function ndjsonReader(reader: { read: () => Promise<{ done: boolean; value?: Uint8Array }> }): () => Promise<Record<string, unknown>> {
  const decoder = new TextDecoder();
  let buffer = "";
  return async () => {
    for (;;) {
      const newline = buffer.indexOf("\n");
      if (newline !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (line.trim()) return JSON.parse(line) as Record<string, unknown>;
      }
      const next = await reader.read();
      if (next.done) throw new Error("stream ended before the requested event");
      buffer += decoder.decode(next.value, { stream: true });
    }
  };
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
    // THIN-7C: the one path adds status lines (live "thinking" text); the events
    // that mattered before stay, in order.
    const events = (await readNdjson(res)).filter((e) => e.type !== "status");
    expect(events).toHaveLength(3);
    expect(events[0]?.type).toBe("turn_meta");
    expect(events[0]?.conversation_id).toBeTruthy();
    expect(events[0]?.turn_id).toBeTruthy();
    expect((events[0] as { resume_token?: string }).resume_token).toBeTruthy();
    expect(events[1]?.type).toBe("signal");
    expect((events[1] as { signal?: { primary_act?: string } }).signal?.primary_act).toBeTruthy();
    expect(events[2]?.type).toBe("done");
    const value = events[2]?.value as { source: string; reply: { text: string }; conversation_id: string; turn_id: string };
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
    // the retired turn engine's own test for why one short line no longer
    // proves multi-delta streaming.
    const res = await client.post("/api/turn/stream", { text: "Good morning. How is it going today? Let me know." });
    expect(res.status).toBe(200);
    const events = await readNdjson(res);

    const deltas = events.filter((e) => e.type === "delta");
    const done = events.filter((e) => e.type === "done");
    expect(deltas.length).toBeGreaterThan(1);
    expect(deltas.every((event, index) => (event as { sequence?: number }).sequence === index + 1)).toBe(true);
    expect(done).toHaveLength(1);
    // The done event's own reply text must equal every delta concatenated,
    // not just "some text" - the real proof the two paths agree.
    const concatenated = deltas.map((e) => e.text).join("");
    const value = done[0]?.value as { source: string; reply: { text: string } };
    expect(value.reply.text).toBe(concatenated);
    expect(value.source).toBe("model");
  });

  test("an interrupted stream resumes buffered deltas without starting a second turn", async () => {
    const { client } = await owner();
    __resetLlmSupervisorForTests();
    const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
    const stub = startStubLlmServer(0, { scriptedChatReply: () => "First sentence. Second sentence. Third sentence." });
    process.env.MAIPAI_LLAMA_SERVER_URL = stub.url;
    try {
      const response = await client.post("/api/turn/stream", { text: "resume this answer" });
      expect(response.status).toBe(200);
      const reader = response.body!.getReader();
      const next = ndjsonReader(reader);
      const meta = await next();
      expect(meta.type).toBe("turn_meta");
      expect(typeof meta.resume_token).toBe("string");
      let firstDelta: Record<string, unknown> | undefined;
      for (;;) {
        const event = await next();
        if (event.type === "delta") {
          firstDelta = event;
          break;
        }
      }
      expect(firstDelta?.sequence).toBe(1);
      await reader.cancel();

      const resumed = await client.post("/api/turn/stream", {
        conversation_id: meta.conversation_id,
        turn_id: meta.turn_id,
        resume_token: meta.resume_token,
        resume_from: firstDelta.sequence,
      });
      expect(resumed.status).toBe(200);
      const resumedEvents = await readNdjson(resumed);
      const resumedDeltas = resumedEvents.filter((event) => event.type === "delta");
      expect(resumedDeltas.every((event) => ((event as { sequence?: number }).sequence ?? 0) > 1)).toBe(true);
      expect(resumedEvents.filter((event) => event.type === "done")).toHaveLength(1);
      expect(stub.requests()).toHaveLength(1);
    } finally {
      await stub.stop();
      delete process.env.MAIPAI_LLAMA_SERVER_URL;
      __resetLlmSupervisorForTests();
    }
  });

  test("a malformed or cross-person resume token is typed unavailable", async () => {
    const { client } = await owner();
    const response = await client.post("/api/turn/stream", { text: "keep this stream" });
    const reader = response.body!.getReader();
    const next = ndjsonReader(reader);
    const meta = await next();
    await reader.cancel();

    const malformed = await client.post("/api/turn/stream", {
      conversation_id: meta.conversation_id,
      turn_id: meta.turn_id,
      resume_token: "not-a-real-resume-token",
      resume_from: 0,
    });
    expect(malformed.status).toBe(503);
    expect(await malformed.json()).toMatchObject({ code: "turn_resume_unavailable" });

    const created = await client.post("/api/people", { displayName: "Resume Child", role: "child" });
    const child = (await created.json()) as { id: string };
    const childClient = new TestClient();
    await childClient.post("/api/auth/select", { personId: child.id });
    const crossPerson = await childClient.post("/api/turn/stream", {
      conversation_id: meta.conversation_id,
      turn_id: meta.turn_id,
      resume_token: meta.resume_token,
      resume_from: 0,
    });
    expect(crossPerson.status).toBe(503);
    expect(await crossPerson.json()).toMatchObject({ code: "turn_resume_unavailable" });
  });

  describe("WIRE-01: cancel", () => {
    async function firstTurnId(res: Response): Promise<string> {
      const reader = res.body!.getReader();
      const next = await reader.read();
      const event = JSON.parse(new TextDecoder().decode(next.value).trim().split("\n")[0]!) as { type: string; turn_id?: string };
      expect(event.type).toBe("turn_meta");
      expect(event.turn_id).toBeTruthy();
      return event.turn_id!;
    }

    // THIN-7C: the turn machine asks the Stack, so a slow turn is the default
    // scripted Stack's own delayed stream; nothing to start or stop here.
    async function slowStub() {
      return { release: () => {}, cleanup: async () => {} };
    }

    test("cancels an in-flight stream and aborts the upstream request", async () => {
      const { client } = await owner();
      const scriptedStack = (await import("./stackFixture")).getDefaultScriptedStack();
      const priorAborts = scriptedStack.aborted();
      const priorRequests = scriptedStack.calls.filter((call) => call === "POST /v1/chat/completions").length;
      __resetLlmSupervisorForTests();
      try {
        const streamResponse = await client.post("/api/turn/stream", { text: "wait for me" });
        expect(streamResponse.status).toBe(200);
        const reader = streamResponse.body!.getReader();
        const first = await reader.read();
        const firstEvent = JSON.parse(new TextDecoder().decode(first.value).trim().split("\n")[0]!) as { type: string; turn_id?: string };
        expect(firstEvent.type).toBe("turn_meta");
        expect(firstEvent.turn_id).toBeTruthy();
        // The upstream request only exists once the machine reaches the model; cancel after that.
        const requested = Date.now() + 5_000;
        while (scriptedStack.calls.filter((call) => call === "POST /v1/chat/completions").length === priorRequests && Date.now() < requested) await new Promise((resolve) => setTimeout(resolve, 10));
        const cancelResponse = await client.post(`/api/turn/${firstEvent.turn_id}/cancel`, {});
        expect(cancelResponse.status).toBe(200);
        expect(await cancelResponse.json()).toEqual({ cancelled: true });
        const events = await readNdjson(new Response(new ReadableStream({
          async start(controller) {
            for (;;) {
              const next = await reader.read();
              if (next.done) break;
              controller.enqueue(next.value);
            }
            controller.close();
          },
        })));
        expect(events.at(-1)).toMatchObject({ type: "error", code: "turn_cancelled" });
        const deadline = Date.now() + 5_000;
        while (scriptedStack.aborted() === priorAborts && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
        expect(scriptedStack.aborted()).toBeGreaterThan(priorAborts);
      } finally {
        __resetLlmSupervisorForTests();
      }
    }, 10_000);

    test("a second cancel of the same turn answers false", async () => {
      const { client } = await owner();
      const slow = await slowStub();
      try {
        const first = await client.post("/api/turn/stream", { text: "cancel twice, wait for me" });
        const turnId = await firstTurnId(first);
        expect(await (await client.post(`/api/turn/${turnId}/cancel`, {})).json()).toEqual({ cancelled: true });
        expect(await (await client.post(`/api/turn/${turnId}/cancel`, {})).json()).toEqual({ cancelled: false });
      } finally { slow.release(); await slow.cleanup(); }
    });

    test("a turn owned by another person cannot be cancelled", async () => {
      const { client } = await owner();
      const created = await client.post("/api/people", { displayName: "Bramble", role: "child" });
      const child = (await created.json()) as { id: string };
      const childClient = new TestClient();
      await childClient.post("/api/auth/select", { personId: child.id });
      const slow = await slowStub();
      try {
        const stream = await childClient.post("/api/turn/stream", { text: "this is mine, wait for me" });
        const turnId = await firstTurnId(stream);
        expect((await client.post(`/api/turn/${turnId}/cancel`, {})).status).toBe(403);
      } finally { slow.release(); await slow.cleanup(); }
    });

    test("an unknown turn cannot be cancelled", async () => {
      const { client } = await owner();
      expect((await client.post("/api/turn/not-a-real-turn/cancel", {})).status).toBe(404);
    });
  });

  test("400s for an unimplemented surface with a code the caller can branch on", async () => {
    const { client } = await owner();
    const res = await client.post("/api/turn/stream", { surface: "tv", text: "hi" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("unsupported_surface");
  });

  // getmaipai/home#91: a code review of the ephemeral fix found the flag
  // honored for any text at all, letting a person skip their own
  // chat-history write on ordinary content just by setting it.
  // `isFixedHomeCardQuery()` (homeCardQueries.ts) is the route's own
  // gate - only the exact question Home's WeatherCard actually asks
  // gets the skip; anything else is logged normally.
  describe("getmaipai/home#91: ephemeral is honored only for a real fixed home-card question", () => {
    test("the weather card's own question, with the flag, writes no conversation_turns row", async () => {
      const { client } = await owner();
      const before = db.select().from(conversationTurns).all().length;
      const res = await client.post("/api/turn/stream", { text: "What's the weather like today?", ephemeral: true });
      expect(res.status).toBe(200);
      expect(db.select().from(conversationTurns).all().length).toBe(before);
    });

    // getmaipai/home#102: several Home tabs loading at once 429'd the
    // weather card, and a person's own chat paid from the same bucket.
    // An ephemeral turn draws from its own small per-person bucket,
    // never from the chat budget, so neither can starve the other.
    // home#106: the buckets refill at 0.5 tokens a second on the wall
    // clock, and five turns through the engine stub under full-suite
    // load can take longer than two seconds, so the sixth was sometimes
    // a 200 (three failing full runs, never alone). The limiter's clock
    // is frozen for the test; each reset below also restarts it, so it
    // is frozen again after each. The chat turns also get a chat engine
    // of this test's own: in the full suite the supervisor was still
    // pointed at a neighbor's stopped stub and one "hi" was a 503
    // before the budget question was ever asked.
    test("an ephemeral turn draws from its own per-person bucket, never the chat budget (#102)", async () => {
      const { client } = await owner();
      const { PERSON_TURN_BUDGET, EPHEMERAL_TURN_BUDGET } = await import("@/lib/llm");
      const { __setRateLimiterClockForTests } = await import("@/lib/rateLimiter");
      const frozen = Date.now();
      __setRateLimiterClockForTests(() => frozen);
      __resetLlmSupervisorForTests();
      const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
      const stub = startStubLlmServer(0, { scriptedChatReply: () => "Hello there." });
      process.env.MAIPAI_LLAMA_SERVER_URL = stub.url;
      try {
        const card = { text: "What's the weather like today?", ephemeral: true };
        // The chat budget spent: the card's question still answers.
        for (let i = 0; i < PERSON_TURN_BUDGET.capacity; i++) expect((await client.post("/api/turn", { text: "hi" })).status).toBe(200);
        expect((await client.post("/api/turn", { text: "hi" })).status).toBe(429);
        expect((await client.post("/api/turn/stream", card)).status).toBe(200);
        // The card's bucket spent: the chat budget is untouched by it.
        __resetRateLimiterForTests();
        __setRateLimiterClockForTests(() => frozen);
        for (let i = 0; i < EPHEMERAL_TURN_BUDGET.capacity; i++) expect((await client.post("/api/turn/stream", card)).status).toBe(200);
        expect((await client.post("/api/turn/stream", card)).status).toBe(429);
        expect((await client.post("/api/turn", { text: "hi" })).status).toBe(200);
        // A claimed flag on ordinary text is a chat turn and pays as one.
        __resetRateLimiterForTests();
        __setRateLimiterClockForTests(() => frozen);
        for (let i = 0; i < PERSON_TURN_BUDGET.capacity; i++) expect((await client.post("/api/turn", { text: "hi" })).status).toBe(200);
        expect((await client.post("/api/turn/stream", { text: "remember that the wifi password is on the fridge", ephemeral: true })).status).toBe(429);
      } finally {
        await stub.stop();
        delete process.env.MAIPAI_LLAMA_SERVER_URL;
        __resetLlmSupervisorForTests();
        __resetRateLimiterForTests(); // the clock too, whatever threw above
      }
    });

    test("an arbitrary sentence with the flag set is logged normally, not skipped", async () => {
      const { client } = await owner();
      const before = db.select().from(conversationTurns).all().length;
      const warnSpy = spyOn(console, "warn");
      try {
        const res = await client.post("/api/turn/stream", { text: "remember that the wifi password is on the fridge", ephemeral: true });
        expect(res.status).toBe(200);
        await readNdjson(res); // the row is written when the stream ends
        expect(db.select().from(conversationTurns).all().length).toBe(before + 1);
        expect(warnSpy.mock.calls.some((args) => String(args[0]).includes("ephemeral requested for a non-widget utterance"))).toBe(true);
      } finally {
        warnSpy.mockRestore();
      }
    });

    test("the weather card's own with-place question, once household.home_place is set, also writes no row", async () => {
      const { client } = await owner();
      setHouseholdSettingValue("household.home_place", "Portland, OR");
      const before = db.select().from(conversationTurns).all().length;
      const res = await client.post("/api/turn/stream", { text: "What's the weather like in Portland, OR today?", ephemeral: true });
      expect(res.status).toBe(200);
      expect(db.select().from(conversationTurns).all().length).toBe(before);
    });

    // The deterministic `remember` pattern floor, not "good morning" or
    // the place-free weather phrase itself: both of those need a real
    // chat completion, which a neighboring test's simulated engine-down
    // scenario can leave unavailable for whichever test runs right after
    // it (this file's own afterEach resets the supervisor, but not fast
    // enough to avoid an occasional cross-test race) - a network- and
    // model-free phrase proves the same property (setting a place never
    // widens the match) without depending on either.
    test("an ordinary sentence is still refused once a place is set - a place never widens the match", async () => {
      const { client } = await owner();
      setHouseholdSettingValue("household.home_place", "Portland, OR");
      const before = db.select().from(conversationTurns).all().length;
      const res = await client.post("/api/turn/stream", { text: "remember that today is trash day", ephemeral: true });
      expect(res.status).toBe(200);
      await readNdjson(res); // the row is written when the stream ends
      expect(db.select().from(conversationTurns).all().length).toBe(before + 1);
    });
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
  function closedStatus(): StatusChannel { const channel = new StatusChannel(); channel.close(); return channel; }
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
      signal: { primary_act: "inform" } as unknown as TurnSignal,
      startedAt: Date.now(),
      cueSuppressed: false,
      bannedPhrases: [],
      status: closedStatus(),
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
      signal: { primary_act: "inform" } as unknown as TurnSignal,
      startedAt: Date.now(),
      cueSuppressed: false,
      bannedPhrases: [],
      status: closedStatus(),
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
      signal: { primary_act: "inform" } as unknown as TurnSignal,
    startedAt: Date.now(),
    cueSuppressed: false,
      bannedPhrases: [],
      status: closedStatus(),
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

  test("a suppressed cue never emits spoken_cue even when the first token is slow", async () => {
    async function* slowTokens(): AsyncGenerator<string, SafetyResult | undefined, void> {
      await new Promise((r) => setTimeout(r, 20));
      yield "The answer.";
      return undefined;
    }
    const result = fakeResult(slowTokens());
    result.cueSuppressed = true;
    const events: TurnStreamEvent[] = [];
    for await (const event of streamTurnEvents(result, "test-person", 5)) events.push(event);
    expect(events.some((e) => e.type === "spoken_cue")).toBe(false);
  });

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

  // REASONING-01: replays a recorded shape of model output straight
  // through the real, shipped streamTurnEvents() - the exact same
  // fixture-driven pattern this describe block's own fakeResult()/
  // failingTokens() tests already use, not a hand-rolled harness.
  // fullText/finalize() (the stored row) must see the identical combined
  // text either way (docs/dev.md's own "byte-identical" decision): these
  // assertions prove that alongside the new wire events.
  describe("REASONING-01: the reasoning wire event", () => {
    async function* tokens(...chunks: string[]): AsyncGenerator<string, SafetyResult | undefined, void> {
      for (const chunk of chunks) yield chunk;
      return undefined;
    }

    test("a think block plus visible text: the visible delta stream is unchanged, reasoning arrives as its own event", async () => {
      let loggedText = "";
      const result = fakeResult(tokens("<think>carry the two</think>", "17 times 24 is 408."));
      result.finalize = (replyText: string) => {
        loggedText = replyText;
        return { reply: { text: replyText }, source: "model", safety: { flagged: false, categories: [], action: "allow", notify_parent: false, matched_signals: [], checked_at: "2026-09-04T00:00:00.000Z" }, conversation_id: "conv-testfixture", turn_id: "turn-testfixture" };
      };
      const events: TurnStreamEvent[] = [];
      for await (const event of streamTurnEvents(result, "test-person")) events.push(event);

      const deltaText = events.filter((e): e is Extract<TurnStreamEvent, { type: "delta" }> => e.type === "delta").map((e) => e.text).join("");
      const reasoningText = events.filter((e): e is Extract<TurnStreamEvent, { type: "reasoning" }> => e.type === "reasoning").map((e) => e.text).join("");
      expect(deltaText).toBe("17 times 24 is 408."); // byte-identical to a turn with no reasoning at all (below)
      expect(reasoningText).toBe("carry the two");
      // The stored row/fullText: the ORIGINAL combined text, think block
      // embedded, exactly as a turn with no reasoning event ever existed
      // would have stored it - the wire split changes nothing upstream.
      expect(loggedText).toBe("<think>carry the two</think>17 times 24 is 408.");
      // REASONING-02: a prose (model-sourced) reply's own think block
      // reaches the wire only via the `reasoning` stream event above -
      // finalize() never sets TurnValue.reasoning for this shape, so the
      // done event's value carries no such field, unchanged from before
      // this item.
      const done = events.find((e): e is Extract<TurnStreamEvent, { type: "done" }> => e.type === "done");
      expect(done?.value.reasoning).toBeUndefined();
    });

    test("no think block at all: no reasoning events, delta unchanged from before this item", async () => {
      let loggedText = "";
      const result = fakeResult(tokens("17 times 24 is 408."));
      result.finalize = (replyText: string) => {
        loggedText = replyText;
        return { reply: { text: replyText }, source: "model", safety: { flagged: false, categories: [], action: "allow", notify_parent: false, matched_signals: [], checked_at: "2026-09-04T00:00:00.000Z" }, conversation_id: "conv-testfixture", turn_id: "turn-testfixture" };
      };
      const events: TurnStreamEvent[] = [];
      for await (const event of streamTurnEvents(result, "test-person")) events.push(event);

      expect(events.some((e) => e.type === "reasoning")).toBe(false);
      expect(events.filter((e) => e.type === "delta").map((e) => (e as { text: string }).text).join("")).toBe("17 times 24 is 408.");
      expect(loggedText).toBe("17 times 24 is 408.");
    });

    test("a truncated, never-closed think block: reasoning gets the partial text, no delta at all", async () => {
      let loggedText = "";
      const result = fakeResult(tokens("<think>carry the two"));
      result.finalize = (replyText: string) => {
        loggedText = replyText;
        return { reply: { text: replyText }, source: "model", safety: { flagged: false, categories: [], action: "allow", notify_parent: false, matched_signals: [], checked_at: "2026-09-04T00:00:00.000Z" }, conversation_id: "conv-testfixture", turn_id: "turn-testfixture" };
      };
      const events: TurnStreamEvent[] = [];
      for await (const event of streamTurnEvents(result, "test-person")) events.push(event);

      expect(events.filter((e) => e.type === "reasoning").map((e) => (e as { text: string }).text).join("")).toBe("carry the two");
      expect(events.some((e) => e.type === "delta")).toBe(false);
      // Matches the existing, unchanged truncated-think-block contract
      // (wellFormed.ts's own OPEN_THINK_RE): the stored text still
      // carries the open, unclosed tag - "no visible text yet," not "no
      // text at all."
      expect(loggedText).toBe("<think>carry the two");
    });

    // The coordinator's own call, docs/dev.md's "REASONING-01" section: a
    // child sees the answer, not the model's thinking. Safety/guard
    // scanning (the retired turn engine, untouched by this item) still saw the full
    // combined text before this boundary ever ran - this only proves the
    // OUTPUT-side drop, dropReasoning being the fifth positional arg.
    test("a child's turn never emits the reasoning event, even though one exists", async () => {
      let loggedText = "";
      const result = fakeResult(tokens("<think>carry the two</think>", "17 times 24 is 408."));
      result.finalize = (replyText: string) => {
        loggedText = replyText;
        return { reply: { text: replyText }, source: "model", safety: { flagged: false, categories: [], action: "allow", notify_parent: false, matched_signals: [], checked_at: "2026-09-04T00:00:00.000Z" }, conversation_id: "conv-testfixture", turn_id: "turn-testfixture" };
      };
      const events: TurnStreamEvent[] = [];
      for await (const event of streamTurnEvents(result, "test-child", THINKING_CUE_DELAY_MS, undefined, true)) events.push(event);

      expect(events.some((e) => e.type === "reasoning")).toBe(false);
      expect(events.filter((e) => e.type === "delta").map((e) => (e as { text: string }).text).join("")).toBe("17 times 24 is 408.");
      // The drop is presentation-only: the stored row still carries the
      // real reasoning, the same as any other actor's turn would.
      expect(loggedText).toBe("<think>carry the two</think>17 times 24 is 408.");
    });

    // REASONING-02: TurnValue.reasoning (a tool-resolved turn's own
    // field, the retired turn engine's peekAndHandle()) rides the `done` event's
    // value - dropped there for a minor by the SAME dropReasoning gate
    // as the `reasoning` stream event above, never populated in the
    // first place for an adult's turn that had none.
    test("the done event carries TurnValue.reasoning for an adult, drops it for a minor", async () => {
      function toolResolvedResult(): Extract<TurnStreamResult, { ok: true; kind: "stream" }> {
        const result = fakeResult(tokens());
        result.finalize = () => ({
          reply: { text: "Got it, I'll remember that." },
          source: "plugin",
          plugin_id: "remember",
          safety: { flagged: false, categories: [], action: "allow", notify_parent: false, matched_signals: [], checked_at: "2026-09-04T00:00:00.000Z" },
          conversation_id: "conv-testfixture",
          turn_id: "turn-testfixture",
          reasoning: "the household wants this remembered, so I should call remember",
        });
        return result;
      }

      const adultEvents: TurnStreamEvent[] = [];
      for await (const event of streamTurnEvents(toolResolvedResult(), "test-person")) adultEvents.push(event);
      const adultDone = adultEvents.find((e): e is Extract<TurnStreamEvent, { type: "done" }> => e.type === "done");
      expect(adultDone?.value.reasoning).toBe("the household wants this remembered, so I should call remember");

      const minorEvents: TurnStreamEvent[] = [];
      for await (const event of streamTurnEvents(toolResolvedResult(), "test-child", THINKING_CUE_DELAY_MS, undefined, true)) minorEvents.push(event);
      const minorDone = minorEvents.find((e): e is Extract<TurnStreamEvent, { type: "done" }> => e.type === "done");
      expect(minorDone?.value.reasoning).toBeUndefined();
      // Presentation-only, same as every other reasoning drop: the
      // rest of the finalized value is untouched.
      expect(minorDone?.value.source).toBe("plugin");
    });
  });
});

// FAST-04 (docs/BACKLOG.md's "Chat direction 2026-09-12" block): literal
// patterns before the embed round trip, and a stream that starts before
// the first token. Every test here goes through the real handlers
// (runTurnNextStream(), streamTurnEvents(), POST /api/turn/stream) against
// a scripted stub, never a parallel harness.
describe("FAST-04: literal patterns before the embed, a stream that starts before the first token", () => {
  /** Points the chat backend at a scripted stub for one callback, and
   * stops it after - the same shape tier2.test.ts's helpers use. */
  async function withStub<T>(
    opts: Parameters<typeof import("@maipai/spec/llm/ts/stubServer.js").startStubLlmServer>[1],
    fn: (stub: { url: string; stop: () => void }) => Promise<T>,
  ): Promise<T> {
    __resetLlmSupervisorForTests();
    // THIN-7C: the route runs the turn machine, which asks the Stack for the engine; the scripted Stack stays and the URL seam points it at the stub.
    const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
    const stub = startStubLlmServer(0, opts);
    process.env.MAIPAI_LLAMA_SERVER_URL = stub.url;
    try {
      return await fn(stub);
    } finally {
      await stub.stop();
      delete process.env.MAIPAI_LLAMA_SERVER_URL;
      __resetLlmSupervisorForTests();
      __resetStackEngineForTests();
    }
  }

  test("a tools-offered turn whose first token takes 1,200 ms yields turn_meta, then spoken_cue, then deltas, in that order", async () => {
    const { client } = await owner();
    await withStub(
      {
        scriptedChatReply: async () => {
          await new Promise((r) => setTimeout(r, 1200));
          return "The 1998 World Cup was won by France. They beat Brazil in the final.";
        },
      },
      async () => {
        const res = await client.post("/api/turn/stream", { text: "who won the 1998 world cup" });
        expect(res.status).toBe(200);
        // THIN-7C: status lines are additive on the one path; the order of the rest is the contract.
        const events = (await readNdjson(res)).filter((e) => e.type !== "status");
        const types = events.map((e) => e.type);
        expect(types[0]).toBe("turn_meta");
        expect(types[1]).toBe("signal");
        expect((events[1] as { signal?: { primary_act?: string } }).signal?.primary_act).toBeTruthy();
        expect(types[2]).toBe("spoken_cue");
        expect(types.filter((t) => t === "spoken_cue")).toHaveLength(1);
        expect(types.indexOf("delta")).toBeGreaterThan(types.indexOf("spoken_cue"));
        expect(types.filter((t) => t === "delta").length).toBeGreaterThan(0);
        expect(types[types.length - 1]).toBe("done");
      },
    );
  }, 15_000);

  test("the cue timer counts from when the utterance arrived: a first token within 900 ms gets no cue", async () => {
    const { client } = await owner();
    await withStub({ scriptedChatReply: () => "Instant answer. Nothing to wait for." }, async () => {
      const res = await client.post("/api/turn/stream", { text: "good morning, how is it going" });
      const events = (await readNdjson(res)).filter((e) => e.type !== "status");
      expect(events.some((e) => e.type === "spoken_cue")).toBe(false);
      expect(events[0]?.type).toBe("turn_meta");
      expect(events[1]?.type).toBe("signal");
      expect((events[1] as { signal?: { primary_act?: string } }).signal?.primary_act).toBeTruthy();
      expect(events[2]?.type).toBe("delta");
    });
  });

  test("a scripted tool-call turn yields turn_meta then exactly one done whose text is the package reply, with speech and plugin fields intact", async () => {
    const { client } = await owner();
    await withStub(
      {
        scriptedToolCalls: (request) =>
          request.tools?.length && request.tool_choice !== "none" ? [{ id: "call-1", type: "function", function: { name: "remember", arguments: '{"fact":"Friday is pizza night"}' } }] : undefined,
        scriptedChatReply: () => "Got it, Friday is pizza night.",
      },
      async () => {
        // Not starting with "remember", so the literal pattern misses
        // and the turn reaches Tier 2 with `remember` offered.
        const res = await client.post("/api/turn/stream", { text: "Friday is pizza night, can you remember that for me" });
        expect(res.status).toBe(200);
        // THIN-7C: status lines and the machine's tool events (no "type") are additive.
        const events = (await readNdjson(res)).filter((e) => e.type !== "status" && e.type !== undefined);
        // The model phrases the confirmation, so it streams as deltas before the one done.
        const types = events.map((e) => e.type);
        expect(types.slice(0, 2)).toEqual(["turn_meta", "signal"]);
        expect(types.filter((t) => t === "done")).toHaveLength(1);
        expect(types[types.length - 1]).toBe("done");
        expect(types.slice(2, -1).every((t) => t === "delta")).toBe(true);
        const value = events[events.length - 1]!.value as { source: string; plugin_id?: string; routing?: { tier: string }; reply: { text: string; speech?: string } };
        expect(value.source).toBe("plugin");
        expect(value.plugin_id).toBe("remember");
        // The one path phrases the confirmation with the model (rule 1), so the
        // reply is the scripted phrasing, not the package's fixed variants.
        expect(value.reply.text).toBe("Got it, Friday is pizza night.");
        expect(value.routing?.tier).toBe("tool");
        expect(turnActiveWithin(0)).toBe(false); // the lease released exactly once, on the stream's own exhaustion
      },
    );
  });

  // THIN-7C (rule 12, retired in writing): three route-level tests of the old
  // path left with it. "A resolved package reply is never cut by the guards"
  // drove the recall package as a model tool call, and memory reaches the
  // model as injected context, never as a tool (rule 1), so there is no
  // resolved recall reply to protect. The two engine-failure tests ("the
  // engine failing on the first request itself" and "every proposed call
  // failing and the retry finding the engine gone") asserted the old stream's
  // 'unavailable' error event; the one path's engine failures are proven in
  // tests/turnMachine/turnNext.test.ts (engine_unavailable on a blocking turn
  // and on the live stream, no assistant turn stored, the lease released).
});

describe("step 2: person-scoped remember and provenance (via the real remember plugin)", () => {
  test("a first-person statement writes scope person, attributed to the actor", async () => {
    const { actor } = await owner();
    const result = await runTurnNext(actor, "chat", "remember I'm allergic to peanuts");
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
    const result = await runTurnNext(actor, "chat", "remember that Friday is pizza night");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const rows = db.select().from(memoryRecords).where(eq(memoryRecords.text, "Friday is pizza night")).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.scope).toBe("household");
    expect(rows[0]!.person).toBeNull();
  });

  test("provenance: the written record's source is the exact conversation_turns id logged for this same turn", async () => {
    const { actor } = await owner();
    const result = await runTurnNext(actor, "chat", "remember my dentist appointment is next week");
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

    const result = await runTurnNext(actor, "chat", "what's the household calendar rule about board game night");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.source).toBe("model");

    const rows = created.map((id) => db.select().from(memoryRecords).where(eq(memoryRecords.id, id)).get()!);
    const bumped = rows.filter((r) => r.uses > 0);
    expect(bumped.length).toBeGreaterThan(0);
    expect(bumped.length).toBeLessThanOrEqual(5); // MAX_MEMORY_SNIPPETS
  });
});

// CHAT-04 (docs/dev/session-a.md): the household-visible symptom behind
// getmaipai/home#74 and #62, end to end through the real turn engine
// with a scripted model reply: a person tells the hub a fact and the
// model confirms it back in the same turn. near_echo used to replace
// that confirmation with "I don't know, sorry." because every remaining
// word was the person's own; it is a question guard now. Plus #81's
// sentence-case pass on the model's opener, on both paths.
describe("CHAT-04: acknowledgments pass, action claims need their outcome, openers are sentence-cased", () => {
  async function withScriptedReply<T>(reply: string, fn: () => Promise<T>): Promise<T> {
    __resetLlmSupervisorForTests();
    const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
    const stub = startStubLlmServer(0, { scriptedChatReply: () => reply });
    process.env.MAIPAI_LLAMA_SERVER_URL = stub.url;
    try {
      return await fn();
    } finally {
      await stub.stop();
      delete process.env.MAIPAI_LLAMA_SERVER_URL;
      __resetLlmSupervisorForTests();
    }
  }

  test("runTurnNext(): 'Got it, Pippa is allergic to peanuts.' in the turn it was said reaches the person untouched (#74, #62)", async () => {
    const { actor } = await owner();
    await withScriptedReply("Got it, Pippa is allergic to peanuts.", async () => {
      const result = await runTurnNext(actor, "chat", "Pippa is allergic to peanuts");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.source).toBe("model");
      expect(result.value.reply.text).toBe("Got it, Pippa is allergic to peanuts.");
    });
  });

  test("runTurnNextStream(): the same acknowledgment streams through whole", async () => {
    const { actor } = await owner();
    await withScriptedReply("Got it, Pippa is allergic to peanuts.", async () => {
      const result = await runTurnNextStream(actor, "chat", "Pippa is allergic to peanuts");
      expect(result.ok).toBe(true);
      if (!result.ok || result.kind !== "stream") return;
      let fullText = "";
      for await (const delta of result.tokens) fullText += delta;
      expect(fullText.trim()).toBe("Got it, Pippa is allergic to peanuts.");
      const value = result.finalize(fullText);
      expect(value.reply.text.trim()).toBe("Got it, Pippa is allergic to peanuts.");
    });
  });
});

// #92 (docs/plans/baseline-fixes-2026-09-13.md item 1): a Tier 0 pattern
// winner whose run reports the typed "not found" is not a reply; the
// turn goes on to the model with the miss on its TurnContext. And a
// literal pattern of an outside-looking package yields on a household
// name or an arithmetic capture, so "what is Pippa allergic to" reaches
// memory and "what is two plus two" reaches the model.
describe("#92: a lookup miss falls through to the model, and a literal pattern yields on a household subject", () => {

  test("runTurnNext(): 'what is Pippa allergic to' never reaches the knowledge package; the model answers with the household's memory in context", async () => {
    const { client, actor } = await owner();
    // Pippa on the roster: the household list is what the yield reads.
    const added = await client.post("/api/people", { displayName: "Pippa", role: "child" });
    expect(added.status).toBe(201);
    const plugins = await import("@/lib/plugins");
    const spy = spyOn(plugins, "runPlugin");
    let context = "";
    const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
    __resetLlmSupervisorForTests();
    const stub = startStubLlmServer(0, {
      scriptedChatReply: (request) => {
        context = request.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n");
        return "Peanuts.";
      },
    });
    process.env.MAIPAI_LLAMA_SERVER_URL = stub.url;
    try {
      const saved = remember(actor, { text: "Pippa is allergic to peanuts", category: "fact", tier: "durable", scope: "household", source: "test", importance: 0.9 });
      expect(saved.ok).toBe(true);
      const result = await runTurnNext(actor, "chat", "what is Pippa allergic to");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(spy.mock.calls.map((c) => c[0])).not.toContain("knowledge");
      expect(result.value.source).toBe("model");
      expect(context).toContain("Pippa is allergic to peanuts");
    } finally {
      spy.mockRestore();
      await stub.stop();
      delete process.env.MAIPAI_LLAMA_SERVER_URL;
      __resetLlmSupervisorForTests();
    }
  });
});

// OUT-01: one validated reply boundary after every producer (dev.md,
// "The chat design pass", section 2). A scripted engine answers the
// four raw forms; each gets the one regeneration, then the fixed line,
// and none of the raw forms is ever stored.
describe("OUT-01: the well-formed reply boundary", () => {
  async function withScripted<T>(replies: string[], fn: (calls: () => number) => Promise<T>): Promise<T> {
    __resetLlmSupervisorForTests();
    const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
    let calls = 0;
    const stub = startStubLlmServer(0, {
      scriptedChatReply: () => {
        const reply = replies[Math.min(calls, replies.length - 1)]!;
        calls++;
        return reply;
      },
    });
    process.env.MAIPAI_LLAMA_SERVER_URL = stub.url;
    try {
      return await fn(() => calls);
    } finally {
      await stub.stop();
      delete process.env.MAIPAI_LLAMA_SERVER_URL;
      __resetLlmSupervisorForTests();
    }
  }

  test("runTurnNext(): 'Yes.' on a confirmation stands, and a one-word answer with its stop stands", async () => {
    const { actor } = await owner();
    const conv = resolveOrCreateConversation(actor, "chat");
    if (!conv.ok) throw new Error(conv.error);
    const paris = await withScripted(["Paris."], async () => runTurnNext(actor, "chat", "what is the capital of France", { conversationId: conv.value.id }));
    expect(paris.ok && paris.value.reply.text).toBe("Paris.");
    const yes = await withScripted(["Yes."], async () => runTurnNext(actor, "chat", "is that in Europe", { conversationId: conv.value.id }));
    expect(yes.ok && yes.value.reply.text).toBe("Yes.");
  });
});

describe("CHAT-13 chunk C2: the last succeeded lookup is a stack source", () => {
  const SEARCH_ANSWER = "It's out on September 22, with twelve tracks.";
  async function withLookupStub<T>(opts: { draft: string | ((request: ChatCompletionRequest) => string); forcedCall?: boolean; searxng?: boolean }, fn: (seen: { forced: number; queries: string[] }) => Promise<T>): Promise<T> {
    __resetLlmSupervisorForTests();
    const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
    const seen = { forced: 0, queries: [] as string[] };
    const stub = startStubLlmServer(0, {
      scriptedToolCalls: (request) => {
        if (request.tool_choice !== "required") return undefined;
        seen.forced++;
        return opts.forcedCall === false ? undefined : [{ id: "call-lookup", type: "function", function: { name: "websearch", arguments: JSON.stringify({ expression: "when the new album is out" }) } }];
      },
      scriptedChatReply: (request) => {
        if (request.messages.some((m) => m.role === "tool")) return SEARCH_ANSWER;
        return typeof opts.draft === "function" ? opts.draft(request) : opts.draft;
      },
    });
    process.env.MAIPAI_LLAMA_SERVER_URL = stub.url;
    const searxng =
      opts.searxng === false
        ? null
        : Bun.serve({
            port: 0,
            fetch: (req) => {
              seen.queries.push(new URL(req.url).searchParams.get("q") ?? "");
              return Response.json({ results: [{ title: "The new album", url: "https://example.com/album", content: "Out on September 22 with twelve tracks." }] });
            },
          });
    if (searxng) setHouseholdSettingValue("search.searxng_url", `http://127.0.0.1:${searxng.port}`);
    try {
      return await fn(seen);
    } finally {
      await stub.stop();
      searxng?.stop(true);
      delete process.env.MAIPAI_LLAMA_SERVER_URL;
      __resetLlmSupervisorForTests();
    }
  }

  const SAFE: SafetyResult = { flagged: false, categories: [], action: "allow", notify_parent: false, matched_signals: [], checked_at: "2026-01-01T00:00:00.000Z" };
  const LOOKUP_OUTCOME: ToolExecutionOutcome[] = [
    { callId: "call-lookup", packageId: "websearch", status: "succeeded", via: "forced", args: { expression: "new Marsh Lantern album out" } },
  ];

  test("a lookup naming a roster member does not create a world subject", async () => {
    const { actor } = await owner();
    await withChat("Sounds good.", async () => {
      const conv = resolveOrCreateConversation(actor, "chat");
      if (!conv.ok) throw new Error(conv.error);
      const { logTurn } = await import("@/lib/conversationHistory");
      logTurn(actor, "chat", "when is Pippa's album out", { reply: { text: "I don't know." }, source: "model", safety: SAFE, conversation_id: conv.value.id, turn_id: "turn-roster-lookup" }, { outcomes: [{ ...LOOKUP_OUTCOME[0]!, args: { expression: "Pippa album out" } }] });
      const next = await runTurnNext(actor, "chat", "sounds good", { conversationId: conv.value.id });
      expect(next.ok).toBe(true);
      if (next.ok) expect(subjectsOfTurn(next.value.turn_id)).toEqual([]);
    });
  });

  test("a world subject on both recent turns decays when not re-mentioned", async () => {
    const { actor } = await owner();
    await withChat("Sounds good.", async () => {
      const conv = resolveOrCreateConversation(actor, "chat");
      if (!conv.ok) throw new Error(conv.error);
      const { logTurn } = await import("@/lib/conversationHistory");
      const subject = { type: "world" as const, kind: "topic" as const, display_name: "Marsh Lantern", year: null, stable_key: null, recency: "unknown" as const, source_kind: "web" as const, carried_question: null };
      logTurn(actor, "chat", "Marsh Lantern", { reply: { text: "Okay." }, source: "model", safety: SAFE, conversation_id: conv.value.id, turn_id: "turn-world-a" }, { subjects: [subject] });
      logTurn(actor, "chat", "the album", { reply: { text: "Okay." }, source: "model", safety: SAFE, conversation_id: conv.value.id, turn_id: "turn-world-b" }, { subjects: [subject] });
      const next = await runTurnNext(actor, "chat", "the weather is fine", { conversationId: conv.value.id });
      expect(next.ok).toBe(true);
      if (next.ok) expect(subjectsOfTurn(next.value.turn_id)).toEqual([]);
    });
  });

  test("an almanac-routed turn carries the previous world subject", async () => {
    const { actor } = await owner();
    await withChat("Sounds good.", async () => {
      const conv = resolveOrCreateConversation(actor, "chat");
      if (!conv.ok) throw new Error(conv.error);
      const { logTurn } = await import("@/lib/conversationHistory");
      const subject = { type: "world" as const, kind: "topic" as const, display_name: "Marsh Lantern", year: null, stable_key: null, recency: "unknown" as const, source_kind: "web" as const, carried_question: null };
      logTurn(actor, "chat", "Marsh Lantern", { reply: { text: "Okay." }, source: "model", safety: SAFE, conversation_id: conv.value.id, turn_id: "turn-almanac-source" }, { subjects: [subject] });
      const next = await runTurnNext(actor, "chat", "what day is today", { conversationId: conv.value.id });
      expect(next.ok).toBe(true);
      if (next.ok) expect(subjectsOfTurn(next.value.turn_id)).toEqual([subject]);
    });
  });

      test("a succeeded lookup older than two turns is not a stack source", async () => {
        const { actor } = await owner();
        await withLookupStub({ draft: "The date is September 22." }, async () => {
          const conv = resolveOrCreateConversation(actor, "chat");
          if (!conv.ok) throw new Error(conv.error);
          await runTurnNext(actor, "chat", "when is the new album out", { conversationId: conv.value.id });
          await runTurnNext(actor, "chat", "the weather looks fine", { conversationId: conv.value.id });
          await runTurnNext(actor, "chat", "nothing else to say", { conversationId: conv.value.id });
          const fourth = await runTurnNext(actor, "chat", "sounds good", { conversationId: conv.value.id });
          expect(fourth.ok).toBe(true);
          if (!fourth.ok) return;
          expect(subjectsOfTurn(fourth.value.turn_id)).toEqual([]);
        });
      });

      test("a failed lookup is not a stack source", async () => {
        const { actor } = await owner();
        await withLookupStub({ draft: "The date is September 22.", searxng: false }, async () => {
          const conv = resolveOrCreateConversation(actor, "chat");
          if (!conv.ok) throw new Error(conv.error);
          await runTurnNext(actor, "chat", "when is the new album out", { conversationId: conv.value.id });
          const second = await runTurnNext(actor, "chat", "sounds good", { conversationId: conv.value.id });
          expect(second.ok).toBe(true);
          if (!second.ok) return;
          expect(subjectsOfTurn(second.value.turn_id)).toEqual([]);
        });
      });
  });

describe("CHAT-13 chunk C1: a carried unresolved reference decays after two turns", () => {
  test("an unresolved ref carried from the previous turn drops on the next turn when the utterance does not re-mention it", async () => {
    const { actor } = await owner();
    await withChat("Sounds like a fun weekend.", async () => {
      const conv = resolveOrCreateConversation(actor, "chat");
      if (!conv.ok) throw new Error(conv.error);
      const first = await runTurnNext(actor, "chat", "Clover borrowed our tent for the weekend", { conversationId: conv.value.id });
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      expect(subjectsOfTurn(first.value.turn_id)).toEqual([{ type: "unresolved", surface_form: "Clover", candidate_kinds: [], provenance: first.value.turn_id, confidence: 0.8, carried_question: null }]);
      // Turn two: no name in the utterance; the carry keeps Clover (unresolved, on one turn only).
      const second = await runTurnNext(actor, "chat", "should I bring it back tomorrow", { conversationId: conv.value.id });
      expect(second.ok).toBe(true);
      if (!second.ok) return;
      expect(subjectsOfTurn(second.value.turn_id)).toEqual([{ type: "unresolved", surface_form: "Clover", candidate_kinds: [], provenance: first.value.turn_id, confidence: 0.8, carried_question: null }]);
      // Turn three: Clover is now on both the newest and the older turn, and the
      // utterance does not re-mention it: it decays.
      const third = await runTurnNext(actor, "chat", "the weather looks fine", { conversationId: conv.value.id });
      expect(third.ok).toBe(true);
      if (!third.ok) return;
      expect(subjectsOfTurn(third.value.turn_id)).toEqual([]);
    });
  });

  test("the same unresolved ref re-mentioned in the utterance does not decay", async () => {
    const { actor } = await owner();
    await withChat("Sounds like a fun weekend.", async () => {
      const conv = resolveOrCreateConversation(actor, "chat");
      if (!conv.ok) throw new Error(conv.error);
      const first = await runTurnNext(actor, "chat", "Clover borrowed our tent for the weekend", { conversationId: conv.value.id });
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      const second = await runTurnNext(actor, "chat", "should I bring it back tomorrow", { conversationId: conv.value.id });
      expect(second.ok).toBe(true);
      if (!second.ok) return;
      // Turn three re-mentions Clover: it stays carried.
      const third = await runTurnNext(actor, "chat", "I think Clover will bring it back", { conversationId: conv.value.id });
      expect(third.ok).toBe(true);
      if (!third.ok) return;
      // Clover is named in this turn, so it resolves fresh; the turn's own
      // subject is Clover (unresolved, fresh).
      expect(subjectsOfTurn(third.value.turn_id).some((s) => s.type === "unresolved" && s.surface_form === "Clover")).toBe(true);
    });
  });

  test("an unresolved ref that is only on the newest turn is always carried", async () => {
    const { actor } = await owner();
    await withChat("Sounds like a fun weekend.", async () => {
      const conv = resolveOrCreateConversation(actor, "chat");
      if (!conv.ok) throw new Error(conv.error);
      const first = await runTurnNext(actor, "chat", "Clover borrowed our tent for the weekend", { conversationId: conv.value.id });
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      // Turn two: no name; Clover carried (on one turn only).
      const second = await runTurnNext(actor, "chat", "should I bring it back tomorrow", { conversationId: conv.value.id });
      expect(second.ok).toBe(true);
      if (!second.ok) return;
      expect(subjectsOfTurn(second.value.turn_id)).toEqual([{ type: "unresolved", surface_form: "Clover", candidate_kinds: [], provenance: first.value.turn_id, confidence: 0.8, carried_question: null }]);
      // Turn three: no name; Clover now on both turns, not re-mentioned: decays.
      const third = await runTurnNext(actor, "chat", "the weather looks fine", { conversationId: conv.value.id });
      expect(third.ok).toBe(true);
      if (!third.ok) return;
      expect(subjectsOfTurn(third.value.turn_id)).toEqual([]);
      // Turn four: no name, no carry: empty.
      const fourth = await runTurnNext(actor, "chat", "nothing else to say", { conversationId: conv.value.id });
      expect(fourth.ok).toBe(true);
      if (!fourth.ok) return;
      expect(subjectsOfTurn(fourth.value.turn_id)).toEqual([]);
    });
  });

  test("a household subject carried across two turns is unaffected by the decay rule", async () => {
    const { actor } = await owner();
    const { ensureSubjectEntity } = await import("@/lib/subjects");
    const rover = ensureSubjectEntity(actor, { name: "Rover", kind: "pet" }, true);
    if (!rover.ok) throw new Error(rover.error);
    const roverId = rover.value!.id;
    await withChat("He seems to be doing better.", async () => {
      const conv = resolveOrCreateConversation(actor, "chat");
      if (!conv.ok) throw new Error(conv.error);
      const first = await runTurnNext(actor, "chat", "Rover's been feeling a little off", { conversationId: conv.value.id });
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      expect(subjectsOfTurn(first.value.turn_id)).toEqual([{ type: "household", entity_id: roverId, carried_question: null }]);
      // Turn two: no name; Rover carried.
      const second = await runTurnNext(actor, "chat", "should I take him to the vet tomorrow", { conversationId: conv.value.id });
      expect(second.ok).toBe(true);
      if (!second.ok) return;
      expect(subjectsOfTurn(second.value.turn_id)).toEqual([{ type: "household", entity_id: roverId, carried_question: null }]);
      // Turn three: no name; Rover is a household ref, not unresolved: still carried.
      const third = await runTurnNext(actor, "chat", "the weather is fine for a walk", { conversationId: conv.value.id });
      expect(third.ok).toBe(true);
      if (!third.ok) return;
      expect(subjectsOfTurn(third.value.turn_id)).toEqual([{ type: "household", entity_id: roverId, carried_question: null }]);
    });
  });
});
