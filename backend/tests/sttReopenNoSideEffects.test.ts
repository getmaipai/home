import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { conversationTurns, entities, episodes, memoryRecords, people } from "@/db/schema";
import { resolveOrCreateConversation, createConversation, logTurn, insertProvisionalTurn, buildConversationWindow, listConversationTurns } from "@/lib/conversationHistory";
import { judgeQueueStats, judgeTurn, runJudgeBatch } from "@/lib/memoryJudge";
import { recall } from "@/lib/memory";
import { recallEpisodes } from "@/lib/episodes";
import { __resetTurnActivityForTests } from "@/lib/turnActivity";
import { resetDb } from "./reset-db";
import { TestClient } from "./client";
import { startStackFixture, useDefaultScriptedStack } from "./stackFixture";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { __resetStackEngineForTests, __setStackClientForTests } from "@/lib/stackEngine";
import { setHouseholdSettingValue } from "@/lib/settings";
import type { TurnValue } from "@/wire";
import type { PersonRow } from "@/types";
import type { ChatCompletionRequest } from "@maipai/spec/llm/ts/types.js";

let judgeFixture: ReturnType<typeof startStackFixture> | null = null;
let embeddingStub: { stop(): Promise<void> } | null = null;

beforeEach(() => {
  resetDb();
  useDefaultScriptedStack();
  __resetTurnActivityForTests();
});

afterEach(async () => {
  judgeFixture?.stop();
  judgeFixture = null;
  await embeddingStub?.stop();
  embeddingStub = null;
  __resetStackEngineForTests();
  __resetLlmSupervisorForTests();
  __resetTurnActivityForTests();
});

const SAFE: TurnValue["safety"] = {
  flagged: false,
  categories: [],
  action: "allow",
  notify_parent: false,
  matched_signals: [],
  checked_at: new Date().toISOString(),
};

async function owner(): Promise<{ client: TestClient; actor: PersonRow }> {
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Marlow", secret: "correcthorse" });
  return { client, actor: db.select().from(people).where(eq(people.displayName, "Marlow")).get()! };
}

function conversation(actor: PersonRow) {
  const result = resolveOrCreateConversation(actor, "chat");
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

function turn(actor: PersonRow, conversationId: string, id: string, text: string, opts: { supersedes?: string; flagged?: boolean; status?: "done" | "failed" } = {}) {
  return logTurn(actor, "chat", text, {
    reply: { text: "Understood." },
    source: "model",
    safety: { ...SAFE, flagged: opts.flagged ?? false, action: opts.flagged ? "refuse" : "allow" },
    conversation_id: conversationId,
    turn_id: id,
  }, { ...(opts.supersedes ? { supersedes: opts.supersedes } : {}), status: opts.status });
}

function ndjsonReader(reader: { read: () => Promise<{ done: boolean; value?: Uint8Array }> }) {
  const decoder = new TextDecoder();
  let buffered = "";
  return async (): Promise<Record<string, unknown> | null> => {
    for (;;) {
      const newline = buffered.indexOf("\n");
      if (newline >= 0) {
        const line = buffered.slice(0, newline);
        buffered = buffered.slice(newline + 1);
        if (line.trim()) return JSON.parse(line) as Record<string, unknown>;
        continue;
      }
      const next = await reader.read();
      if (next.done) return null;
      buffered += decoder.decode(next.value ?? new Uint8Array(), { stream: true });
    }
  };
}

async function withScriptedJudge<T>(reply: (request: ChatCompletionRequest) => unknown, fn: () => Promise<T>): Promise<T> {
  const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
  const embeddings = startStubLlmServer(0);
  embeddingStub = embeddings;
  judgeFixture?.stop();
  judgeFixture = startStackFixture({
    "POST /v1/chat/completions": async (req) => {
      const request = await req.json() as ChatCompletionRequest;
      const value = reply(request) ?? { facts: [] };
      return Response.json({ model: "scripted-judge", choices: [{ message: { role: "assistant", content: JSON.stringify(value) } }] });
    },
    "POST /v1/embeddings": async (req) => fetch(`${embeddings.url}/v1/embeddings`, { method: "POST", headers: req.headers, body: await req.arrayBuffer() }),
  });
  __setStackClientForTests(judgeFixture.client);
  setHouseholdSettingValue("engines.stack.url", judgeFixture.url);
  return fn();
}

function fact(text: string) {
  return { facts: [{ text, category: "preference", scope: "person", importance: 0.8 }] };
}

describe("STT-SMARTTURN-01B reopened turn side effects", () => {
  test("a reopened turn leaves no memory row for the abandoned first fragment", async () => {
    const { actor } = await owner();
    const conv = conversation(actor);
    turn(actor, conv.id, "turn-abandoned", "my dentist appointment is on");
    turn(actor, conv.id, "turn-resumed", "my dentist appointment is on Thursday", { supersedes: "turn-abandoned" });

    await withScriptedJudge((request) => {
      const content = request.messages.map((message) => String(message.content)).join("\n");
      return content.includes("Thursday") ? fact("Marlow has a dentist appointment on Thursday") : { facts: [] };
    }, () => runJudgeBatch());

    const rows = db.select().from(memoryRecords).all();
    expect(rows.filter((row) => row.source === "turn-abandoned")).toHaveLength(0);
    expect(rows.filter((row) => row.source === "turn-resumed").map((row) => row.text)).toEqual(["Marlow has a dentist appointment on Thursday"]);
  });

  test("a first turn already judged before the reopen has its memory rows retired when the reopened turn supersedes it", async () => {
    const { actor } = await owner();
    const conv = conversation(actor);
    const first = turn(actor, conv.id, "turn-judged-first", "Riff is our dog");

    await withScriptedJudge(() => ({ facts: [{ text: "Riff is our dog", category: "thing", scope: "household", importance: 0.8, subject: { name: "Riff", kind: "pet" } }] }), async () => { await judgeTurn(first); });
    const before = db.select().from(memoryRecords).where(eq(memoryRecords.source, first.id)).all();
    expect(before.length).toBeGreaterThan(0);
    expect(before.every((row) => row.status === "active")).toBe(true);
    expect(before.some((row) => row.recordKind === "entity" && row.subjectId !== null)).toBe(true);
    const riff = db.select().from(entities).where(eq(entities.name, "Riff")).get();
    expect(riff?.deletedAt).toBeNull();

    turn(actor, conv.id, "turn-judged-resume", "we rehomed the pet", { supersedes: first.id });

    expect(db.select().from(memoryRecords).where(eq(memoryRecords.source, first.id)).all().every((row) => row.status === "archived")).toBe(true);
    expect(db.select().from(entities).where(eq(entities.name, "Riff")).get()?.deletedAt).not.toBeNull();
    expect(recall(actor, "Riff dog", { selfOnly: true, bumpUsage: false }).some((match) => match.record.source === first.id)).toBe(false);
    expect(db.select().from(episodes).where(eq(episodes.turnId, first.id)).all().length).toBeGreaterThan(0);
    expect(recallEpisodes(actor, "Riff our dog", undefined, { withinConversationId: conv.id })).toHaveLength(0);
  });

  test("a reopened turn leaves exactly one visible turn in the conversation", async () => {
    const { client, actor } = await owner();
    const conv = conversation(actor);
    turn(actor, conv.id, "turn-visible-fragment", "my dentist appointment is on");
    turn(actor, conv.id, "turn-visible-full", "my dentist appointment is on Thursday", { supersedes: "turn-visible-fragment" });

    const window = await buildConversationWindow(conv);
    expect(window.messages.map((message) => message.content).join("\n")).toContain("my dentist appointment is on Thursday");
    expect(window.turnIds).toEqual(["turn-visible-full"]);
    const rows = db.select().from(conversationTurns).where(eq(conversationTurns.conversationId, conv.id)).all();
    expect(rows).toHaveLength(2);
    expect(rows.filter((row) => row.supersedes === "turn-visible-fragment")).toHaveLength(1);
    const history = await client.get("/api/conversations?q=my%20dentist%20appointment%20is%20on%20Thursday");
    expect(history.status).toBe(200);
    const listed = await history.json() as Array<{ id: string }>;
    expect(listed.map((row) => row.id)).toContain(conv.id);
  });

  test("a cancelled first turn leaves no judge-eligible row", async () => {
    const { client, actor } = await owner();
    const conv = conversation(actor);
    insertProvisionalTurn(actor, "chat", conv.id, "turn-cancelled-running", "abandoned cancellation text");
    expect(db.select().from(conversationTurns).where(eq(conversationTurns.id, "turn-cancelled-running")).get()?.status).toBe("running");
    expect(judgeQueueStats().pending).toBe(0);

    db.update(conversationTurns).set({ status: "failed" }).where(eq(conversationTurns.id, "turn-cancelled-running")).run();
    expect((await runJudgeBatch()).processed).toBe(0);
    expect(db.select().from(memoryRecords).all()).toHaveLength(0);

    __resetLlmSupervisorForTests();
    const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
    let releaseReply!: (text: string) => void;
    const delayedReply = new Promise<string>((resolve) => { releaseReply = resolve; });
    const upstream = startStubLlmServer(0, { scriptedChatReply: () => delayedReply });
    process.env.MAIPAI_LLAMA_SERVER_URL = upstream.url;
    try {
      const stream = await client.post("/api/turn/stream", { text: "cancel me now", conversation_id: conv.id });
      expect(stream.status).toBe(200);
      const reader = stream.body!.getReader();
      const next = ndjsonReader(reader);
      const meta = await next() as { type: string; turn_id: string };
      expect(meta.type).toBe("turn_meta");
      const requested = Date.now() + 5_000;
      while (upstream.requests().length === 0 && Date.now() < requested) await new Promise((resolve) => setTimeout(resolve, 10));
      expect(upstream.requests().length).toBeGreaterThan(0);
      const cancelBody = await (await client.post(`/api/turn/${meta.turn_id}/cancel`, {})).json() as { cancelled: boolean };
      expect(cancelBody.cancelled).toBe(true);
      releaseReply("A late reply after cancellation.");
      let sawCancel = false;
      for (;;) {
        const event = await next();
        if (!event) break;
        if (event.code === "turn_cancelled") sawCancel = true;
      }
      expect(sawCancel).toBe(true);
      expect(db.select().from(conversationTurns).where(eq(conversationTurns.id, meta.turn_id)).get()).toMatchObject({ status: "done", judgeStatus: "skipped" });
      expect(judgeQueueStats().pending).toBe(0);
      expect((await runJudgeBatch()).processed).toBe(0);
      expect(db.select().from(memoryRecords).where(eq(memoryRecords.source, meta.turn_id)).all()).toHaveLength(0);
      const cancelledSearch = await client.get("/api/conversations?q=cancel%20me%20now");
      expect(cancelledSearch.status).toBe(200);
      expect((await cancelledSearch.json() as Array<{ id: string }>).map((row) => row.id)).toContain(conv.id);
    } finally {
      releaseReply("A late reply after cancellation.");
      await upstream.stop();
      delete process.env.MAIPAI_LLAMA_SERVER_URL;
      __resetLlmSupervisorForTests();
    }
  });

  test("a superseded or cancelled first turn is not returned by conversation search", async () => {
    const { client, actor } = await owner();
    const conv = conversation(actor);
    turn(actor, conv.id, "turn-search-old", "abandoned unique fragment zebra");
    turn(actor, conv.id, "turn-search-new", "resumed ordinary sentence", { supersedes: "turn-search-old" });
    turn(actor, conv.id, "turn-search-cancelled", "cancelled visible text", { status: "failed" });

    const supersededSearch = await client.get("/api/conversations?q=abandoned%20unique%20fragment");
    const cancelledSearch = await client.get("/api/conversations?q=cancelled%20visible%20text");
    expect(await supersededSearch.json()).toEqual([]);
    expect((await cancelledSearch.json() as Array<{ id: string }>).map((row) => row.id)).toContain(conv.id);
    expect(listConversationTurns(actor, conv.id).ok).toBe(true);
    expect(db.select().from(episodes).where(eq(episodes.turnId, "turn-search-old")).all().length).toBeGreaterThan(0);
    expect(recallEpisodes(actor, "abandoned unique fragment zebra", undefined, { withinConversationId: conv.id })).toHaveLength(0);
  });

  test("reopening does not write a duplicate turn id", async () => {
    const { client, actor } = await owner();
    const conv = conversation(actor);
    turn(actor, conv.id, "turn-idempotent-first", "first fragment");
    __resetLlmSupervisorForTests();
    const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
    const stub = startStubLlmServer(0, { scriptedChatReply: () => "First sentence. Second sentence. Third sentence." });
    process.env.MAIPAI_LLAMA_SERVER_URL = stub.url;
    try {
      const initial = await client.post("/api/turn/stream", { text: "first fragment continued", conversation_id: conv.id, supersedes: "turn-idempotent-first" });
      expect(initial.status).toBe(200);
      const initialReader = initial.body!.getReader();
      const nextInitial = ndjsonReader(initialReader);
      const meta = await nextInitial() as { type: string; conversation_id: string; turn_id: string; resume_token: string };
      expect(meta.type).toBe("turn_meta");
      let firstDelta: { type: string; sequence: number } | null = null;
      while (!firstDelta) {
        const event = await nextInitial();
        if (!event) throw new Error("stream ended before its first delta");
        if (event.type === "delta") firstDelta = event as { type: string; sequence: number };
      }
      await initialReader.cancel();

      const resumed = await client.post("/api/turn/stream", {
        conversation_id: meta.conversation_id,
        turn_id: meta.turn_id,
        resume_token: meta.resume_token,
        resume_from: firstDelta.sequence,
      });
      expect(resumed.status).toBe(200);
      const resumedReader = ndjsonReader(resumed.body!.getReader());
      const resumedEvents: Record<string, unknown>[] = [];
      for (;;) {
        const event = await resumedReader();
        if (!event) break;
        resumedEvents.push(event);
      }
      expect(resumedEvents.filter((event) => event.type === "done")).toHaveLength(1);

      const rows = db.select().from(conversationTurns).where(eq(conversationTurns.conversationId, conv.id)).all();
      expect(rows).toHaveLength(2);
      expect(new Set(rows.map((row) => row.id)).size).toBe(2);
      expect(rows.find((row) => row.id !== "turn-idempotent-first")?.supersedes).toBe("turn-idempotent-first");
      const duplicateResume = await client.post("/api/turn/stream", {
        conversation_id: meta.conversation_id,
        turn_id: meta.turn_id,
        resume_token: meta.resume_token,
        resume_from: firstDelta.sequence,
      });
      expect(duplicateResume.status).toBe(503);
      expect(db.select().from(conversationTurns).where(eq(conversationTurns.conversationId, conv.id)).all()).toHaveLength(2);
    } finally {
      await stub.stop();
      delete process.env.MAIPAI_LLAMA_SERVER_URL;
      __resetLlmSupervisorForTests();
    }
  });

  test("supersedes pointing at another conversation is ignored and archives nothing", async () => {
    const { actor } = await owner();
    const convA = conversation(actor);
    const convBResult = createConversation(actor);
    if (!convBResult.ok) throw new Error(convBResult.error);
    const convB = convBResult.value;
    const other = turn(actor, convB.id, "turn-cross-conversation", "I like tea");
    const { remember } = await import("@/lib/memory");
    const saved = remember(actor, { text: "Marlow likes tea", category: "preference", tier: "durable", scope: "person", person: actor.id, source: other.id, importance: 0.8 });
    if (!saved.ok) throw new Error(saved.error);
    turn(actor, convA.id, "turn-cross-conversation-resume", "I like tea", { supersedes: other.id });
    expect(db.select().from(conversationTurns).where(eq(conversationTurns.id, "turn-cross-conversation-resume")).get()?.supersedes).toBeNull();
    expect(db.select().from(memoryRecords).where(eq(memoryRecords.source, other.id)).get()?.status).toBe("active");
  });

  test("cross-person supersedes in one household is ignored, and safety fields survive a valid supersede", async () => {
    const { client, actor } = await owner();
    const otherResponse = await client.post("/api/people", { displayName: "Quill", role: "adult", secret: "correcthorse" });
    const otherId = (await otherResponse.json() as { id: string }).id;
    const otherPerson = db.select().from(people).where(eq(people.id, otherId)).get()!;
    const actorConversation = conversation(actor);
    // Deliberately put a different household member's row under the same
    // conversation id to pin the storage boundary against cross-person
    // provenance, even if a malformed internal caller bypasses routing.
    const otherTurn = turn(otherPerson, actorConversation.id, "turn-other-person", "I like jasmine tea");
    const { remember } = await import("@/lib/memory");
    const saved = remember(otherPerson, { text: "Quill likes jasmine tea", category: "preference", tier: "durable", scope: "person", person: otherPerson.id, source: otherTurn.id, importance: 0.8 });
    if (!saved.ok) throw new Error(saved.error);
    turn(actor, actorConversation.id, "turn-cross-person-resume", "replacement text", { supersedes: otherTurn.id });
    expect(db.select().from(conversationTurns).where(eq(conversationTurns.id, "turn-cross-person-resume")).get()?.supersedes).toBeNull();
    expect(db.select().from(memoryRecords).where(eq(memoryRecords.source, otherTurn.id)).get()?.status).toBe("active");

    const flagged = turn(actor, actorConversation.id, "turn-safety-preserved", "I need help", { flagged: true });
    turn(actor, actorConversation.id, "turn-safety-replacement", "I am safe now", { supersedes: flagged.id });
    expect(db.select().from(conversationTurns).where(eq(conversationTurns.id, flagged.id)).get()).toMatchObject({ safetyFlagged: true, safetyAction: "refuse" });
  });
});
