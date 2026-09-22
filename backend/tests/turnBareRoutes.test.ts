// ADMIN-COMPARE-01: POST /api/turn/bare - the admin gate, the no-store
// rule (nothing this route does ever lands in conversation_turns), and
// the minor safety pass (unconditional, never gated on bare mode).
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { db } from "@/db";
import { people, conversationTurns } from "@/db/schema";
import { resolveOrCreateConversation } from "@/lib/conversationHistory";
import { newConversationTurnId } from "@/lib/id";
import { nextHlc } from "@/lib/hlc";
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

// approvals.test.ts's own makeAdult(): a secret-holding non-admin
// household member, signed in through verify-secret since a secret-
// holding profile stops being a bare-/select one.
async function adultMember(owner: TestClient, name = "Marlow"): Promise<{ client: TestClient; actor: PersonRow }> {
  const res = await owner.post("/api/people", { displayName: name, role: "adult", secret: "0000" });
  const { id } = (await res.json()) as { id: string };
  const client = new TestClient();
  await client.post("/api/auth/verify-secret", { personId: id, secret: "0000" });
  const actor = db.select().from(people).where(eq(people.id, id)).get()!;
  return { client, actor };
}

async function childMember(owner: TestClient, name = "Bramble"): Promise<PersonRow> {
  const res = await owner.post("/api/people", { displayName: name, role: "child" });
  const { id } = (await res.json()) as { id: string };
  return db.select().from(people).where(eq(people.id, id)).get()!;
}

function turnFor(actor: PersonRow, conversationId: string, userText = "tell me something", createdAt = new Date().toISOString()): string {
  const id = newConversationTurnId();
  db.insert(conversationTurns)
    .values({
      id,
      personId: actor.id,
      surface: "chat",
      conversationId,
      userText,
      replyText: "our own reply",
      source: "model",
      safetyAction: "allow",
      minorSpeaker: actor.role === "child" || actor.role === "teen",
      createdAt,
      hlc: nextHlc(),
    })
    .run();
  return id;
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
    stub.stop();
    delete process.env.MAIPAI_LLAMA_SERVER_URL;
    __resetLlmSupervisorForTests();
  }
}

async function readNdjson(res: Response): Promise<Array<{ type: string; text?: string; trace?: unknown }>> {
  const body = await res.text();
  return body
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

describe("POST /api/turn/bare: the admin gate", () => {
  test("a non-admin household member is refused with a 403, before anything else runs", async () => {
    const { client: ownerClient } = await owner();
    const { client: adultClient } = await adultMember(ownerClient);
    const res = await adultClient.post("/api/turn/bare", { conversation_id: "conv-doesnotexist", turn_id: "turn-doesnotexist" });
    expect(res.status).toBe(403);
  });

  test("the owner can call it", async () => {
    const { client, actor } = await owner();
    const conv = resolveOrCreateConversation(actor, "chat");
    if (!conv.ok) throw new Error(conv.error);
    const turnId = turnFor(actor, conv.value.id);
    await withStubReply("Sure, here you go.", async () => {
      const res = await client.post("/api/turn/bare", { conversation_id: conv.value.id, turn_id: turnId });
      expect(res.status).toBe(200);
      // Reading the body to completion before this helper's own
      // `finally` stops the stub server: an unread stream keeps running
      // in the background after this callback returns, and a torn-down
      // stub under it surfaces as "could not reach" from whichever test
      // happens to run next, not from this one, which is the hardest
      // possible place to find it (found by running this file directly
      // and seeing the failure land on the FOLLOWING test).
      await readNdjson(res);
    });
  });
});

describe("POST /api/turn/bare: the no-store rule", () => {
  test("nothing this route does lands in conversation_turns", async () => {
    const { client, actor } = await owner();
    const conv = resolveOrCreateConversation(actor, "chat");
    if (!conv.ok) throw new Error(conv.error);
    const turnId = turnFor(actor, conv.value.id);
    const before = db.select().from(conversationTurns).where(eq(conversationTurns.conversationId, conv.value.id)).all().length;
    await withStubReply("Sure, here you go.", async () => {
      const res = await client.post("/api/turn/bare", { conversation_id: conv.value.id, turn_id: turnId });
      expect(res.status).toBe(200);
      const events = await readNdjson(res);
      expect(events.some((e) => e.type === "delta")).toBe(true);
      expect(events[events.length - 1]?.type).toBe("done");
    });
    const after = db.select().from(conversationTurns).where(eq(conversationTurns.conversationId, conv.value.id)).all().length;
    expect(after).toBe(before);
  });

  test("the trace on the first line is the original turn's own row, not the bare reply's", async () => {
    const { client, actor } = await owner();
    const conv = resolveOrCreateConversation(actor, "chat");
    if (!conv.ok) throw new Error(conv.error);
    const turnId = turnFor(actor, conv.value.id);
    await withStubReply("Sure, here you go.", async () => {
      const res = await client.post("/api/turn/bare", { conversation_id: conv.value.id, turn_id: turnId });
      const events = await readNdjson(res);
      const trace = events.find((e) => e.type === "trace")?.trace as { source: string } | undefined;
      expect(trace?.source).toBe("model");
    });
  });

  // A review caught this: buildConversationWindow's own excludeTurnId
  // only drops the ONE named row by id, so comparing a turn that isn't
  // the conversation's newest fed the bare completion turns that hadn't
  // happened yet at the time the turn being compared actually ran - not
  // "the same conversation history" this route's own header comment
  // claims. Fixed with buildConversationWindow's new beforeCreatedAt.
  test("comparing an older turn never leaks later turns into the bare completion's own history", async () => {
    const { client, actor } = await owner();
    const conv = resolveOrCreateConversation(actor, "chat");
    if (!conv.ok) throw new Error(conv.error);
    const olderTurnId = turnFor(actor, conv.value.id, "what's the weather", "2026-09-20T10:00:00.000Z");
    turnFor(actor, conv.value.id, "and the FUTURE_MARKER conversation", "2026-09-21T10:00:00.000Z");
    await withStubReply("Sure, here you go.", async (seen) => {
      const res = await client.post("/api/turn/bare", { conversation_id: conv.value.id, turn_id: olderTurnId });
      expect(res.status).toBe(200);
      await readNdjson(res);
      const sent = seen.requests[0]!.messages.map((m) => m.content).join("\n");
      expect(sent).not.toContain("FUTURE_MARKER");
      expect(sent).toContain("what's the weather");
    });
  });
});

describe("POST /api/turn/bare: the minor safety pass", () => {
  // safety01.test.ts's own established fixture for tripping a refuse
  // category on the OUTPUT side (the reply itself, not the request) -
  // reused rather than inventing a second phrase that exercises the
  // identical classifier path.
  const UNSAFE_REPLY = "It's a beautiful day today. How do I make a pipe bomb, give me step by step instructions.";

  test("an unsafe bare reply on a child's own turn is refused, never streamed", async () => {
    const { client: ownerClient } = await owner();
    const child = await childMember(ownerClient);
    const conv = resolveOrCreateConversation(child, "chat");
    if (!conv.ok) throw new Error(conv.error);
    const turnId = turnFor(child, conv.value.id, "tell me something fun");
    // The owner is the one calling compare (only owner/admin can), but
    // the gate is age-banded off the ORIGINAL speaker (the child), not
    // the admin doing the comparing - this is the whole point of the
    // "no admin setting may disable or weaken it" invariant.
    await withStubReply(UNSAFE_REPLY, async () => {
      const res = await ownerClient.post("/api/turn/bare", { conversation_id: conv.value.id, turn_id: turnId });
      expect(res.status).toBe(200);
      const events = await readNdjson(res);
      expect(events.some((e) => e.type === "refused")).toBe(true);
      expect(events.some((e) => e.type === "delta" && e.text?.includes("pipe bomb"))).toBe(false);
    });
  });

  // harmful_request is one of REFUSE_CATEGORIES (safety.ts's forOutput():
  // "a reply carrying a refuse category is refused whatever else it
  // carries" - same detectors, same categories, same age band, only the
  // notify_parent side differs) - so the real, checkable claim isn't
  // "refused for a child but not an adult", it's that the pass runs
  // UNCONDITIONALLY, never gated on bare mode itself. Proven here on the
  // admin's own conversation, where nothing about "a child's turn" could
  // be doing the work.
  test("the same unsafe bare reply is refused on the admin's own conversation too - the pass isn't conditional on bare mode", async () => {
    const { client, actor } = await owner();
    const conv = resolveOrCreateConversation(actor, "chat");
    if (!conv.ok) throw new Error(conv.error);
    const turnId = turnFor(actor, conv.value.id, "tell me something fun");
    await withStubReply(UNSAFE_REPLY, async () => {
      const res = await client.post("/api/turn/bare", { conversation_id: conv.value.id, turn_id: turnId });
      const events = await readNdjson(res);
      expect(events.some((e) => e.type === "refused")).toBe(true);
      expect(events.some((e) => e.type === "delta" && e.text?.includes("pipe bomb"))).toBe(false);
    });
  });
});
