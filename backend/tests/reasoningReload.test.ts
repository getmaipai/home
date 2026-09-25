// REASONING-04 (safety ruling, 2026-09-22, found from a real screenshot
// after a page refresh on /next/chat: the reply rendered as plain text
// beginning "<think>Okay, so the user is asking..."): a prose reply's
// own think block travels intact in TurnValue.reply.text by the
// pipeline's contract (wellFormed.ts's own header), and REASONING-01/03
// only ever split it for the LIVE wire (the stream's reasoning event,
// the done event's own TurnValue.reasoning) - nothing ever stopped the
// raw tags from landing in the STORED row's reply_text, so a reload
// rendered them verbatim, the wire split having changed nothing about
// what got persisted. conversationHistory.ts's buildTurnRow() now
// splits it the same way at write time (extractReasoningText()/
// visibleText(), REASONING-02's existing `reasoning` column, never
// populated for a minor's own turn), and listConversationTurns() heals
// any row written before this fix, on read, no migration.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { db } from "@/db";
import { people, conversationTurns } from "@/db/schema";
import { newConversationTurnId } from "@/lib/id";
import { nextHlc } from "@/lib/hlc";
import { resolveOrCreateConversation } from "@/lib/conversationHistory";
import type { PersonRow } from "@/types";
import type { ChatCompletionRequest } from "@maipai/spec/llm/ts/types.js";

beforeEach(() => resetDb());
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

async function withStubReply<T>(reply: string, fn: (seen: { requests: ChatCompletionRequest[] }) => Promise<T>): Promise<T> {
  __resetLlmSupervisorForTests();
  const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
  const seen = { requests: [] as ChatCompletionRequest[] };
  const stub = startStubLlmServer(0, {
    scriptedChatReply: (request) => {
      seen.requests.push(request);
      return reply;
    },
  });
  process.env.MAIPAI_LLAMA_SERVER_URL = stub.url;
  try {
    return await fn(seen);
  } finally {
    await stub.stop();
    delete process.env.MAIPAI_LLAMA_SERVER_URL;
    __resetLlmSupervisorForTests();
  }
}

async function readNdjson(res: Response): Promise<Array<{ type: string; conversation_id?: string }>> {
  const body = await res.text();
  return body
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

interface ReloadedTurn { replyText: string; reasoning?: string }

const THINK_BLOCK_REPLY = "<think>carry the two</think>17 times 24 is 408.";

describe("GET /api/conversations/:id/turns - a fresh turn's own think block never survives to reload", () => {
  test("a reloaded adult turn shows the answer and a Reasoning block, never <think>", async () => {
    const { client } = await owner();
    await withStubReply(THINK_BLOCK_REPLY, async () => {
      const res = await client.post("/api/turn/stream", { text: "what's 17 times 24", thinking: true });
      const events = await readNdjson(res);
      const id = events.find((e) => e.type === "turn_meta")!.conversation_id!;
      const turnsRes = await client.get(`/api/conversations/${id}/turns`);
      const turns = (await turnsRes.json()) as ReloadedTurn[];
      const turn = turns[0]!;
      expect(turn.replyText).not.toContain("<think>");
      expect(turn.replyText).toContain("17 times 24 is 408.");
      expect(turn.reasoning).toBe("carry the two");
    });
  });

  test("a reloaded child turn shows the answer and no reasoning", async () => {
    const { client: ownerClient } = await owner();
    const { client: childClient } = await childMember(ownerClient);
    await withStubReply(THINK_BLOCK_REPLY, async () => {
      const res = await childClient.post("/api/turn/stream", { text: "what's 17 times 24", thinking: true });
      const events = await readNdjson(res);
      const id = events.find((e) => e.type === "turn_meta")!.conversation_id!;
      const turnsRes = await childClient.get(`/api/conversations/${id}/turns`);
      const turns = (await turnsRes.json()) as ReloadedTurn[];
      const turn = turns[0]!;
      expect(turn.replyText).not.toContain("<think>");
      expect(turn.replyText).toContain("17 times 24 is 408.");
      expect(turn.reasoning).toBeUndefined();
    });
  });

  // REASONING-03 (owner's ruling, 2026-09-22, a privacy invariant, not
  // a setting): retires this test's own old contract ("the row itself
  // always keeps it, the drop is presentation-only, gated on the
  // READING actor") - conversationHistory.ts's buildTurnRow() now
  // never stores a child's reasoning at all (`minorSpeaker` checked at
  // WRITE time), so an owner/admin's read has nothing left to surface
  // either, even though the stub still "thought" for this turn (a
  // scripted reply, standing in for the engine ignoring the
  // server-side thinking-off instruction, or a model that thinks
  // unprompted). A parent's oversight of a child's turn keeps the
  // question, the answer, the sources, the executed tools and the
  // policy decisions - all still stored, none of them this field.
  test("an owner/admin does not see a child's own prose reasoning either - it was never stored", async () => {
    const { client: ownerClient } = await owner();
    const { client: childClient } = await childMember(ownerClient);
    await withStubReply(THINK_BLOCK_REPLY, async () => {
      const res = await childClient.post("/api/turn/stream", { text: "what's 17 times 24", thinking: true });
      const events = await readNdjson(res);
      const id = events.find((e) => e.type === "turn_meta")!.conversation_id!;
      const asChild = (await (await childClient.get(`/api/conversations/${id}/turns`)).json()) as ReloadedTurn[];
      expect(asChild[0]!.reasoning).toBeUndefined();
      const asOwner = (await (await ownerClient.get(`/api/conversations/${id}/turns`)).json()) as ReloadedTurn[];
      expect(asOwner[0]!.reasoning).toBeUndefined();
      const row = db.select().from(conversationTurns).where(eq(conversationTurns.conversationId, id)).get();
      expect(row?.reasoning).toBeNull();
    });
  });
});

describe("GET /api/conversations/:id/turns - a row written before this fix heals on read", () => {
  test("an old row with inline <think> text renders without the tags", async () => {
    const { client, actor } = await owner();
    const conv = resolveOrCreateConversation(actor, "chat");
    if (!conv.ok) throw new Error(conv.error);
    db.insert(conversationTurns)
      .values({
        id: newConversationTurnId(),
        personId: actor.id,
        surface: "chat",
        conversationId: conv.value.id,
        userText: "what's 17 times 24",
        replyText: THINK_BLOCK_REPLY, // the pre-fix shape: reasoning still embedded, reasoning column left null
        source: "model",
        safetyAction: "allow",
        minorSpeaker: false,
        createdAt: new Date().toISOString(),
        hlc: nextHlc(),
      })
      .run();
    const turnsRes = await client.get(`/api/conversations/${conv.value.id}/turns`);
    const turns = (await turnsRes.json()) as ReloadedTurn[];
    const turn = turns[0]!;
    expect(turn.replyText).not.toContain("<think>");
    expect(turn.replyText).toBe("17 times 24 is 408.");
    // A bonus, not the literal requirement: an old ADULT row gets its
    // reasoning reconstructed on read too, the same Reasoning Element
    // treatment a fresh turn already has.
    expect(turn.reasoning).toBe("carry the two");
  });

  test("an old row from a minor's own turn renders without the tags and stays reasoning-free", async () => {
    const { client: ownerClient } = await owner();
    const { client: childClient, actor: childActor } = await childMember(ownerClient);
    const conv = resolveOrCreateConversation(childActor, "chat");
    if (!conv.ok) throw new Error(conv.error);
    db.insert(conversationTurns)
      .values({
        id: newConversationTurnId(),
        personId: childActor.id,
        surface: "chat",
        conversationId: conv.value.id,
        userText: "what's 17 times 24",
        replyText: THINK_BLOCK_REPLY,
        source: "model",
        safetyAction: "allow",
        minorSpeaker: true,
        createdAt: new Date().toISOString(),
        hlc: nextHlc(),
      })
      .run();
    const turnsRes = await childClient.get(`/api/conversations/${conv.value.id}/turns`);
    const turns = (await turnsRes.json()) as ReloadedTurn[];
    const turn = turns[0]!;
    expect(turn.replyText).not.toContain("<think>");
    expect(turn.replyText).toBe("17 times 24 is 408.");
    expect(turn.reasoning).toBeUndefined();
  });
});
