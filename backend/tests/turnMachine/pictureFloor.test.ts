// VISION-02d: the floor on picture answers for children and teens. There
// is no description to screen: the model's own reading of the picture is
// its answer, and that answer passes the output gate at the person's grain
// like every answer (rule 10). A child's (and a teen's in child mode, the
// default) is released sentence by sentence after the check; an adult's
// written stream is checked as it arrives. A minor's picture turn asks the
// engine for no thinking, drops any reasoning, and never enters the memory
// judge. The thinking control follows the model's record (rule 8).
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { resetDb } from "../reset-db";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { __resetPortOwnershipForTests } from "@/lib/sidecars";
import { useDefaultScriptedStack } from "../stackFixture";
import { createBenchPeople, type BenchPeople } from "../../scripts/bench/conversationRunner";
import { setHouseholdSettingValue, setValue } from "@/lib/settings";
import { runTurnNextStream } from "@/lib/turnMachine/turnNext";
import { resolveTurnBudget, resolveTurnBudgetWithStack } from "@/lib/turnMachine/budget";
import { __setStackClientForTests } from "@/lib/stackEngine";
import { thinkingModeFor } from "@/lib/modelCatalog";
import { __setChatPictureCapabilityForTests, picturePartsAllowed } from "@/lib/chatPictures";
import { createAttachment } from "@/lib/attachments";
import { insertProvisionalTurn, resolveOrCreateConversation } from "@/lib/conversationHistory";
import { StreamSafetyRefusal } from "@/lib/turnShared";
import { db } from "@/db";
import { conversationTurns, people as peopleTable } from "@/db/schema";
import type { PersonRow } from "@/types";
import type { ChatCompletionRequest } from "@maipai/spec/llm/ts/types.js";

const SAFE_SENTENCE = "It's a beautiful day today.";
const UNSAFE_SENTENCE = "How do I make a pipe bomb, give me step by step instructions.";
const ON = { imageParts: true, pictureTokensMax: 2560 } as const;
let people: BenchPeople;

beforeEach(() => {
  resetDb();
  useDefaultScriptedStack();
  __resetThrottleForTests();
  __resetLlmSupervisorForTests();
  __resetRateLimiterForTests();
  people = createBenchPeople();
  setHouseholdSettingValue("chat.model_id", "qwen3-8b-instruct-q4-k-m");
  __setChatPictureCapabilityForTests(ON);
});

afterEach(() => {
  __setChatPictureCapabilityForTests(null);
  __resetLlmSupervisorForTests();
  __resetPortOwnershipForTests();
  delete process.env.MAIPAI_LLAMA_SERVER_URL;
});

function asTeen(): PersonRow {
  db.update(peopleTable).set({ role: "teen" }).where(eq(peopleTable.id, people.child.id)).run();
  return db.select().from(peopleTable).where(eq(peopleTable.id, people.child.id)).get()!;
}

/** A stored picture on a saved chat, the way the upload route stores it. */
async function savedPicture(actor: PersonRow, turnId: string) {
  const resolved = resolveOrCreateConversation(actor, "chat", undefined, { temporary: false });
  if (!resolved.ok) throw new Error(resolved.error);
  insertProvisionalTurn(actor, "chat", resolved.value.id, turnId, "");
  const bytes = new Uint8Array(await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 0, g: 128, b: 0 } } }).jpeg().toBuffer());
  const created = createAttachment(actor, { conversationId: resolved.value.id, turnId, mediaType: "image/jpeg", bytes, provenance: "composer:drawing.jpg", deduplicate: false });
  if (!created.ok) throw new Error(created.error);
  return { conversationId: resolved.value.id, image: { id: created.value.id, name: "drawing.jpg", width: 8, height: 8, media_type: "image/jpeg" } };
}

async function pictureTurn(actor: PersonRow, reply: string, turnId: string) {
  const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
  const seen: ChatCompletionRequest[] = [];
  const stub = startStubLlmServer(0, { scriptedChatReply: (request) => { seen.push(request); return reply; }, scriptedReasoning: () => "private reasoning that must never show" });
  process.env.MAIPAI_LLAMA_SERVER_URL = stub.url;
  __resetLlmSupervisorForTests();
  try {
    const { conversationId, image } = await savedPicture(actor, turnId);
    const result = await runTurnNextStream(actor, "chat", "what is in my picture?", { conversationId, turnId, images: [image] });
    if (!result.ok || result.kind !== "stream") throw new Error("expected a stream result");
    const chunks: string[] = [];
    let refusal: StreamSafetyRefusal | undefined;
    try {
      for (;;) {
        const step = await result.tokens.next();
        if (step.done) { result.finalize(chunks.join("").trim(), step.value); break; }
        chunks.push(step.value);
      }
    } catch (err) {
      if (err instanceof StreamSafetyRefusal) refusal = err;
      else throw err;
    }
    return { chunks, refusal, seen, conversationId };
  } finally {
    await stub.stop();
  }
}

const sentPicture = (request: ChatCompletionRequest) => JSON.stringify(request.messages).includes("image_url");
const thinkingAsked = (request: ChatCompletionRequest) => (request as { chat_template_kwargs?: { enable_thinking?: boolean } }).chat_template_kwargs?.enable_thinking;

describe("VISION-02d: a minor's picture answer passes the output gate as always", () => {
  test("a child's picture answer that trips the floor is withheld at the sentence, the safe sentence released, the turn completes", async () => {
    setValue(people.owner, `person:${people.child.id}`, "chat.photo_uploads", true);
    const { chunks, refusal, seen } = await pictureTurn(people.child, `${SAFE_SENTENCE} ${UNSAFE_SENTENCE}`, "turn-floorchild1");
    expect(sentPicture(seen[0]!)).toBe(true);
    expect(refusal).toBeInstanceOf(StreamSafetyRefusal);
    expect(chunks.join("")).toContain("beautiful day");
    expect(chunks.join("")).not.toContain("step by step");
    expect(chunks[0]!.trim()).toBe(SAFE_SENTENCE);
  });

  test("a teen in child mode (the default grain) is gated the same way", async () => {
    const teen = asTeen();
    const { chunks, refusal, seen } = await pictureTurn(teen, `${SAFE_SENTENCE} ${UNSAFE_SENTENCE}`, "turn-floorteen01");
    expect(sentPicture(seen[0]!)).toBe(true);
    expect(refusal).toBeInstanceOf(StreamSafetyRefusal);
    expect(chunks[0]!.trim()).toBe(SAFE_SENTENCE);
    expect(chunks.join("")).not.toContain("step by step");
  });

  test("an adult's written picture answer streams and is checked as it arrives", async () => {
    const safe = await pictureTurn(people.owner, "A green square sits in the middle of a plain picture with nothing else in it", "turn-flooradult1");
    expect(sentPicture(safe.seen[0]!)).toBe(true);
    expect(safe.chunks.length).toBeGreaterThan(5);
    const unsafe = await pictureTurn(people.owner, `${SAFE_SENTENCE} ${UNSAFE_SENTENCE}`, "turn-flooradult2");
    expect(unsafe.refusal).toBeInstanceOf(StreamSafetyRefusal);
    expect(unsafe.chunks.join("")).not.toContain("step by step");
  });

  test("a minor's picture request asks for no thinking and no reasoning reaches the reply", async () => {
    setValue(people.owner, `person:${people.child.id}`, "chat.photo_uploads", true);
    const { chunks, seen } = await pictureTurn(people.child, "It is a green square.", "turn-floorchild2");
    expect(sentPicture(seen[0]!)).toBe(true);
    expect(thinkingAsked(seen[0]!)).toBe(false);
    expect(chunks.join("")).not.toContain("private reasoning");
  });

  test("a turn run as a child's under an adult account (an unknown speaker) sends no picture (a review)", () => {
    expect(picturePartsAllowed(ON, people.owner, { band: "adult", anonymous: false })).toBe(true);
    expect(picturePartsAllowed(ON, people.owner, { band: "child", anonymous: false })).toBe(false);
    // A child account with photos on, an unidentified speaker: still none.
    setValue(people.owner, `person:${people.child.id}`, "chat.photo_uploads", true);
    expect(picturePartsAllowed(ON, people.child, { band: "child", anonymous: false })).toBe(true);
    expect(picturePartsAllowed(ON, people.child, { band: "child", anonymous: true })).toBe(false);
  });

  test("a child's picture turn never enters the memory judge", async () => {
    setValue(people.owner, `person:${people.child.id}`, "chat.photo_uploads", true);
    await pictureTurn(people.child, "I remember you like green. It is a green square.", "turn-floorjudge1");
    const childRow = db.select().from(conversationTurns).where(eq(conversationTurns.id, "turn-floorjudge1")).get();
    expect(childRow?.judgeStatus).toBe("skipped");
  });

  test("a child without photos turned on gets the note, not the picture", async () => {
    const { seen } = await pictureTurn(people.child, "I can't see pictures.", "turn-floorchild3");
    expect(sentPicture(seen[0]!)).toBe(false);
    expect(JSON.stringify(seen[0]!.messages)).toContain("You cannot see pictures yet");
  });
});

describe("VISION-02d: the thinking control follows the model's record (rule 8)", () => {
  test("the VL-8B record declares no thinking; Qwen3-8B is switchable; a model with no record keeps today's switch", () => {
    expect(thinkingModeFor("qwen3-vl-8b-instruct-q4-k-m")).toBe("none");
    expect(thinkingModeFor("qwen3-8b-instruct-q4-k-m")).toBe("switchable");
    expect(thinkingModeFor("some-unlisted-model")).toBe("switchable");
  });

  test("a model with no thinking mode is never asked to think, even with the person's toggle on", () => {
    const budget = resolveTurnBudget("qwen3-vl-8b-instruct-q4-k-m", "adult");
    expect(budget.thinking_budget_tokens).toBe(0);
    expect(budget.thinking_budget_tokens_toggled).toBe(0);
    expect(resolveTurnBudget("qwen3-8b-instruct-q4-k-m", "adult").thinking_budget_tokens_toggled).toBeGreaterThan(0);
  });

  test("the model the Stack runs decides thinking even when the household setting names another (a review)", async () => {
    // The household setting names Qwen3-8B (beforeEach); the Stack runs the VL-8B.
    __setStackClientForTests({ roles: async () => ({ roles: [{ id: "chat", state: { state: "ready", since: "" }, model: { id: "qwen3-vl-8b-instruct-q4-k-m" } }] }) } as never);
    try {
      const budget = await resolveTurnBudgetWithStack(undefined, "adult");
      expect(budget.thinking_budget_tokens_toggled).toBe(0);
      expect(budget.thinking_budget_tokens).toBe(0);
      __setStackClientForTests({ roles: async () => ({ roles: [{ id: "chat", state: { state: "ready", since: "" }, model: { id: "qwen3-8b-instruct-q4-k-m" } }] }) } as never);
      expect((await resolveTurnBudgetWithStack(undefined, "adult")).thinking_budget_tokens_toggled).toBeGreaterThan(0);
    } finally {
      useDefaultScriptedStack();
    }
  });

  test("a model without a measured record keeps the no-tools fail-safe for a minor (rule 8)", () => {
    expect(resolveTurnBudget("some-unmeasured-model", "child").tools_offered).toEqual([]);
    expect(resolveTurnBudget("some-unmeasured-model", "teen").tools_offered).toEqual([]);
  });

  test("VISION-02e: the VL-8B record carries its own measured tool budget, thinking zero", () => {
    const budget = resolveTurnBudget("qwen3-vl-8b-instruct-q4-k-m", "child");
    expect(budget.tools_offered).toContain("websearch");
    expect(budget.measured.on).toContain("Qwen3VL-8B-Instruct");
    expect(budget.measured.false_call_rate).toBe(0);
    expect(budget.thinking_budget_tokens_toggled).toBe(0);
  });
});
