// CHAT-TITLE-01 follow-up (TITLEBUG): "I left while the chat was producing a response and came back: the reply is
// there, the title still says New Chat". The title must not depend on the client staying connected, and a chat
// read with no title and nothing on its way must get one asked for.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { __setConversationTitleDelayForTests, __clearPendingConversationTitlesForTests } from "@/lib/conversationTitle";
import { createConversation, logTurn } from "@/lib/conversationHistory";
import { db } from "@/db";
import { conversations, conversationTurns, people } from "@/db/schema";
import type { TurnValue } from "@/wire";

const SAFE: TurnValue["safety"] = { flagged: false, categories: [], action: "allow", notify_parent: false, matched_signals: [], checked_at: new Date().toISOString() };

beforeEach(() => {
  resetDb();
  __setConversationTitleDelayForTests(30);
});
afterEach(() => {
  __setConversationTitleDelayForTests(null);
  __clearPendingConversationTitlesForTests();
  __resetLlmSupervisorForTests();
  delete process.env.MAIPAI_LLAMA_SERVER_URL;
});

async function owner() {
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const actor = db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
  return { client, actor };
}

async function until(check: () => boolean, ms = 5000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return true;
    await Bun.sleep(25);
  }
  return check();
}

/** A stub engine: the first request is the turn's reply, every later one is the title call. */
async function stubEngine() {
  const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
  let requests = 0;
  const stub = startStubLlmServer(0, { scriptedChatReply: () => (++requests === 1 ? "Water them evenly and mulch the soil." : "Tomato Plant Care") });
  process.env.MAIPAI_LLAMA_SERVER_URL = stub.url;
  return stub;
}

const storedTitle = (id: string) => db.select().from(conversations).where(eq(conversations.id, id)).get()?.title ?? null;

describe("the title survives the client leaving", () => {
  test("a turn whose stream body is cancelled mid-reply still finishes, is stored, and gets a title", async () => {
    const { client, actor } = await owner();
    __resetLlmSupervisorForTests();
    const stub = await stubEngine();
    try {
      const res = await client.post("/api/turn/stream", { text: "how do I keep my tomato plants from splitting" });
      const reader = res.body!.getReader();
      await reader.read(); // the first chunk (turn_meta), then the person leaves
      await reader.cancel();

      expect(await until(() => db.select().from(conversationTurns).where(eq(conversationTurns.personId, actor.id)).all().length === 1)).toBe(true);
      const conversationId = db.select().from(conversationTurns).where(eq(conversationTurns.personId, actor.id)).get()!.conversationId;
      expect(await until(() => storedTitle(conversationId) !== null)).toBe(true);
      expect(storedTitle(conversationId)).toBe("Tomato Plant Care");
    } finally {
      await stub.stop();
    }
  });

  test("a temporary chat whose stream is cancelled stores no row and no title", async () => {
    const { client } = await owner();
    __resetLlmSupervisorForTests();
    const stub = await stubEngine();
    try {
      const res = await client.post("/api/turn/stream", { text: "a private question", temporary: true });
      const reader = res.body!.getReader();
      await reader.read();
      await reader.cancel();
      await Bun.sleep(300);
      expect(db.select().from(conversations).all()).toHaveLength(0);
    } finally {
      await stub.stop();
    }
  });
});

describe("a chat read with no title gets one asked for", () => {
  test("GET /api/conversations/:id schedules the title when none is pending (a restart dropped the timer), and a temporary chat gets none", async () => {
    const { client, actor } = await owner();
    __resetLlmSupervisorForTests();
    const stub = await stubEngine();
    try {
      const created = createConversation(actor, { surface: "chat" });
      if (!created.ok) throw new Error(created.error);
      const id = created.value.id;
      logTurn(actor, "chat", "how do I keep my tomato plants from splitting", { reply: { text: "Water them evenly." }, source: "model", safety: SAFE, conversation_id: id, turn_id: "turn-leave-1" });
      expect(storedTitle(id)).toBeNull();

      // The stub's first request is treated as the turn reply above, so burn it: the next one is the title.
      await fetch(`${stub.url}/v1/chat/completions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: [{ role: "user", content: "x" }] }) });
      // Reading twice must not push the timer back or ask twice.
      await client.get(`/api/conversations/${id}`);
      await client.get(`/api/conversations/${id}`);
      expect(await until(() => storedTitle(id) !== null)).toBe(true);
      expect(storedTitle(id)).toBe("Tomato Plant Care");

      const temporary = createConversation(actor, { surface: "chat", mode: "temporary" });
      if (!temporary.ok) throw new Error(temporary.error);
      await client.get(`/api/conversations/${temporary.value.id}`);
      await Bun.sleep(200);
      expect(db.select().from(conversations).where(eq(conversations.id, temporary.value.id)).all()).toHaveLength(0);
    } finally {
      await stub.stop();
    }
  });
});
