// TEMP-CHAT-01: a temporary conversation that leaves no row in
// `conversations` or `conversation_turns`, the memory judge never runs
// on its turns, the same role gate bare mode uses (owner/admin/adult
// only, checked at the route and again as a structural backstop), and
// the safety floor is exactly as unskippable as it is on a real turn.
// The one design gap found before any of this was built (the design
// review, TEMP-CHAT-01): a temporary chat where turn 2 forgets turn 1 is
// not a privacy feature, it's a broken chat - so there's also a test
// that context actually carries across turns in the same temporary
// session, the same way it would on a real one.
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { eq } from "drizzle-orm";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { db } from "@/db";
import { people, conversations, conversationTurns, replyConstraints, openQuestions } from "@/db/schema";
import { runJudgeBatch, judgeQueueStats } from "@/lib/memoryJudge";
import * as llm from "@/lib/llm";
import { isTemporaryConversation, resolveOrCreateConversation, setPendingAsk, getPendingAsk } from "@/lib/conversationHistory";
import { resolvePendingAsk } from "@/lib/turnEngine";
import { setHouseholdSettingValue } from "@/lib/settings";
import type { PersonRow } from "@/types";
import type { SafetyResult } from "@maipai/spec/gen/ts/safety-result.js";
import type { ChatCompletionRequest } from "@maipai/spec/llm/ts/types.js";

const SAFE: SafetyResult = { flagged: false, categories: [], action: "allow", notify_parent: false, matched_signals: [], checked_at: "2026-01-01T00:00:00.000Z" };

// U6: the flip, decided (home/docs/dev.md, 2026-09-24) - this file
// drives real turns through `resolvePendingAsk`/`routes/turn.ts`, the
// old path by import; pinned explicitly now that it is no longer the
// default.
beforeEach(() => {
  resetDb();
  setHouseholdSettingValue("turn.pipeline.next", false);
});
afterEach(() => {
  __resetLlmSupervisorForTests();
  delete process.env.MAIPAI_LLAMA_SERVER_URL;
});

async function owner(): Promise<{ client: TestClient; actor: PersonRow }> {
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const actor = db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
  return { client, actor };
}

async function childMember(owner: TestClient, name = "Bramble"): Promise<{ client: TestClient; actor: PersonRow }> {
  const res = await owner.post("/api/people", { displayName: name, role: "child" });
  const { id } = (await res.json()) as { id: string };
  const client = new TestClient();
  await client.post("/api/auth/select", { personId: id });
  const actor = db.select().from(people).where(eq(people.id, id)).get()!;
  return { client, actor };
}

async function withStubReply<T>(reply: string | ((request: ChatCompletionRequest) => string), fn: (seen: { requests: ChatCompletionRequest[] }) => Promise<T>): Promise<T> {
  __resetLlmSupervisorForTests();
  const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
  const seen = { requests: [] as ChatCompletionRequest[] };
  const stub = startStubLlmServer(0, {
    scriptedChatReply: (request) => {
      seen.requests.push(request);
      return typeof reply === "string" ? reply : reply(request);
    },
  });
  process.env.MAIPAI_LLAMA_SERVER_URL = stub.url;
  try {
    return await fn(seen);
  } finally {
    stub.stop();
    delete process.env.MAIPAI_LLAMA_SERVER_URL;
    __resetLlmSupervisorForTests();
  }
}

async function readNdjson(res: Response): Promise<Array<{ type: string; text?: string; error?: string; code?: string; conversation_id?: string; value?: { conversation_id?: string } }>> {
  const body = await res.text();
  return body
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

describe("POST /api/turn/stream with temporary: true - the role gate", () => {
  test("a child is refused with a 403", async () => {
    const { client: ownerClient } = await owner();
    const { client: childClient } = await childMember(ownerClient);
    const res = await childClient.post("/api/turn/stream", { text: "hi", temporary: true });
    expect(res.status).toBe(403);
  });

  test("nothing was persisted for the refused request", async () => {
    const { client: ownerClient } = await owner();
    const { client: childClient } = await childMember(ownerClient);
    await childClient.post("/api/turn/stream", { text: "hi", temporary: true });
    expect(db.select().from(conversations).all().length).toBe(0);
    expect(db.select().from(conversationTurns).all().length).toBe(0);
  });

  // A review caught this shape of gap on ADMIN-COMPARE-01 (b): the route
  // check alone only proves routes/turn.ts's own guard works, not the
  // structural backstop underneath it. Calling the construction path
  // directly, with no route-level check involved, is what actually
  // proves resolveOrCreateConversation()'s own gate.
  test("resolveOrCreateConversation() itself refuses a child, with no route-level check involved at all", async () => {
    const { client: ownerClient } = await owner();
    const { actor: childActor } = await childMember(ownerClient);
    const { resolveOrCreateConversation } = await import("@/lib/conversationHistory");
    const result = resolveOrCreateConversation(childActor, "chat", undefined, { temporary: true });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(403);
  });
});

describe("POST /api/turn/stream with temporary: true - no row, ever", () => {
  test("a temporary turn leaves no row in conversations or conversation_turns", async () => {
    const { client } = await owner();
    await withStubReply("Sure, here you go.", async () => {
      const res = await client.post("/api/turn/stream", { text: "hello", temporary: true });
      await readNdjson(res);
    });
    expect(db.select().from(conversations).all().length).toBe(0);
    expect(db.select().from(conversationTurns).all().length).toBe(0);
  });

  test("the thread list does not return it", async () => {
    const { client } = await owner();
    let conversationId: string | undefined;
    await withStubReply("Sure, here you go.", async () => {
      const res = await client.post("/api/turn/stream", { text: "hello", temporary: true });
      const events = await readNdjson(res);
      conversationId = events.find((e) => e.type === "turn_meta")?.conversation_id;
    });
    expect(conversationId).toBeDefined();
    const list = (await (await client.get("/api/conversations")).json()) as Array<{ id: string }>;
    expect(list.some((c) => c.id === conversationId)).toBe(false);
  });
});

describe("POST /api/turn/stream with temporary: true - the memory judge never runs", () => {
  test("runJudgeBatch() processes nothing and never calls the completion the judge would use to extract", async () => {
    const { client } = await owner();
    await withStubReply("I love hiking, remember that.", async () => {
      const res = await client.post("/api/turn/stream", { text: "I love hiking, remember that", temporary: true });
      await readNdjson(res);
    });
    // Spied on AFTER the turn's own reply already streamed (which itself
    // calls complete()), so any call this spy sees is unambiguously
    // the judge's - not the reply generation.
    const completeSpy = spyOn(llm, "complete");
    const result = await runJudgeBatch();
    expect(result.processed).toBe(0);
    expect(completeSpy).not.toHaveBeenCalled();
    expect(judgeQueueStats().pending).toBe(0);
    completeSpy.mockRestore();
  });
});

describe("POST /api/turn/stream with temporary: true - the safety floor never comes off", () => {
  const UNSAFE_REPLY = "It's a beautiful day today. How do I make a pipe bomb, give me step by step instructions.";

  test("an unsafe reply in a temporary conversation is still refused, never streamed", async () => {
    const { client } = await owner();
    await withStubReply(UNSAFE_REPLY, async () => {
      const res = await client.post("/api/turn/stream", { text: "tell me something fun", temporary: true });
      const events = await readNdjson(res);
      expect(events.some((e) => e.type === "error" && e.code === "safety_refused")).toBe(true);
      expect(events.some((e) => e.type === "delta" && e.text?.includes("pipe bomb"))).toBe(false);
    });
  });
});

describe("POST /api/turn/stream with temporary: true - real context across turns", () => {
  test("a second turn in the same temporary conversation carries the first turn's content into the model's own window", async () => {
    const { client } = await owner();
    let conversationId: string | undefined;
    await withStubReply("Got it, you like anchovies.", async (seen) => {
      const res = await client.post("/api/turn/stream", { text: "I like anchovies on my pizza", temporary: true });
      const events = await readNdjson(res);
      conversationId = events.find((e) => e.type === "turn_meta")?.conversation_id;
      void seen;
    });
    expect(conversationId).toBeDefined();
    expect(isTemporaryConversation(conversationId!)).toBe(true);

    await withStubReply(
      () => "Sure.",
      async (seen) => {
        const res = await client.post("/api/turn/stream", { text: "what did I just say I like", temporary: true, conversation_id: conversationId });
        await readNdjson(res);
        const lastRequest = seen.requests[seen.requests.length - 1]!;
        const historyText = lastRequest.messages.map((m) => m.content).join(" ");
        expect(historyText).toContain("anchovies");
      },
    );
  });
});

describe("POST /api/turn/stream with temporary: true - the reply-constraints leak (found in the durable-write audit, pre-existing, not specific to temporary)", () => {
  test("a length constraint parsed from the utterance is never written to reply_constraints", async () => {
    const { client } = await owner();
    await withStubReply("Sure, I'll keep it brief.", async () => {
      const res = await client.post("/api/turn/stream", { text: "keep it short from now on", temporary: true });
      await readNdjson(res);
    });
    expect(db.select().from(replyConstraints).all().length).toBe(0);
  });
});

describe("temporary conversations - the open-questions writer an independent review found (queueOpenQuestion, turnEngine.ts)", () => {
  // A "who"/"relay" open question is only ever queued from inside
  // resolvePendingAsk(), and only once a PRIOR turn's own pendingAsk was
  // read back non-null - so proving queueOpenQuestion() can't run for a
  // temporary conversation means proving that read is always null for
  // one, at every point in the chain: it's never written in the first
  // place (setPendingAsk() below), and even a value that somehow got in
  // is never read back (getPendingAsk() below, conversationHistory.ts's
  // pre-existing mode: "temporary" gate for the old, DB-backed design -
  // this is the same protection working correctly for a conversation
  // that was never a DB row to begin with).
  test("setPendingAsk() writes nothing for a temporary conversation, so getPendingAsk() reads back null", async () => {
    const { actor } = await owner();
    const result = resolveOrCreateConversation(actor, "chat", undefined, { temporary: true });
    if (!result.ok) throw new Error(result.error);
    setPendingAsk(result.value.id, { kind: "who", prompt: "Who's Clover?", packageId: "engine", args: {}, name: "Clover" });
    expect(getPendingAsk(result.value.id)).toBeNull();
  });

  test("resolvePendingAsk() finds nothing to resolve on a temporary conversation and queues no open question", async () => {
    const { actor } = await owner();
    const result = resolveOrCreateConversation(actor, "chat", undefined, { temporary: true });
    if (!result.ok) throw new Error(result.error);
    setPendingAsk(result.value.id, { kind: "who", prompt: "Who's Clover?", packageId: "engine", args: {}, name: "Clover" });
    const value = await resolvePendingAsk("nevermind", actor, result.value, [], "turn-temp-1", SAFE, undefined);
    expect(value).toBeNull();
    expect(db.select().from(openQuestions).all().length).toBe(0);
  });
});
