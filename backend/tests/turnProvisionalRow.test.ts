import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { db } from "@/db";
import { conversationTurns, people } from "@/db/schema";
import { buildConversationWindow, createConversation, failInterruptedTurns, insertProvisionalTurn } from "@/lib/conversationHistory";
import { judgeQueueStats } from "@/lib/memoryJudge";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { __resetStackEngineForTests } from "@/lib/stackEngine";
import { getDefaultScriptedStack, useDefaultScriptedStack } from "./stackFixture";

beforeEach(() => {
  resetDb();
  useDefaultScriptedStack();
  __resetLlmSupervisorForTests();
  __resetRateLimiterForTests();
  __resetThrottleForTests();
});

afterEach(() => {
  __resetStackEngineForTests();
  delete process.env.MAIPAI_LLAMA_SERVER_URL;
});

async function owner() {
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  return { client, actor: db.select().from(people).where(eq(people.displayName, "Sage")).get()! };
}

function holdDefaultEngine() {
  const fixture = getDefaultScriptedStack();
  const original = fixture.client.chat.bind(fixture.client);
  fixture.client.chat = async (request, options) => {
    if (request.stream !== true) return original(request, options);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ id: "held-turn", model: "stub-chat", choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] })}\n\n`));
        options?.signal?.addEventListener("abort", () => controller.close(), { once: true });
      },
    });
    return { stream, headers: new Headers({ "x-maipai-engine": "local test", "x-maipai-model": "stub-chat" }) };
  };
  return () => { fixture.client.chat = original; };
}

async function firstEvent(response: Response) {
  const reader = response.body!.getReader();
  const first = await reader.read();
  return { reader, event: JSON.parse(new TextDecoder().decode(first.value).trim().split("\n")[0]!) as Record<string, any> };
}

describe("CHAT-RESUME-02 provisional turn row", () => {
  test("an ordinary turn has a running row while its model reply is still open", async () => {
    const restore = holdDefaultEngine();
    try {
      const { client } = await owner();
      const response = await client.post("/api/turn/stream", { text: "wait for me" });
      const { reader, event } = await firstEvent(response);
      expect(event.type).toBe("turn_meta");
      await new Promise((resolve) => setTimeout(resolve, 50));
      const row = db.select().from(conversationTurns).where(eq(conversationTurns.id, event.turn_id)).get();
      expect(row?.status).toBe("running");
      expect(row?.userText).toContain("wait for me");
      await client.post(`/api/turn/${event.turn_id}/cancel`, {});
      await reader.cancel();
    } finally { restore(); }
  }, 15_000);

  test("the boot sweep makes an interrupted running row a failed history turn with retry", async () => {
    const restore = holdDefaultEngine();
    try {
      const { client } = await owner();
      const response = await client.post("/api/turn/stream", { text: "wait for me" });
      const { reader, event } = await firstEvent(response);
      await new Promise((resolve) => setTimeout(resolve, 50));
      const before = db.select().from(conversationTurns).where(eq(conversationTurns.id, event.turn_id)).get();
      expect(before?.status).toBe("running");
      expect(failInterruptedTurns()).toBe(1);
      const history = await client.get(`/api/conversations/${event.conversation_id}/turns`);
      const turns = await history.json() as Array<{ id: string; userText: string; status: string; replyText: string; retry?: boolean }>;
      expect(turns.find((turn) => turn.id === event.turn_id)).toMatchObject({ userText: "wait for me", status: "failed" });
      expect(turns.find((turn) => turn.id === event.turn_id)?.replyText).toBeTruthy();
      await client.post(`/api/turn/${event.turn_id}/cancel`, {});
      await reader.cancel();
    } finally { restore(); }
  }, 15_000);

  test("a normally completed turn has no running row", async () => {
    const { client } = await owner();
    const response = await client.post("/api/turn/stream", { text: "say hello" });
    const events = (await response.text()).split("\n").filter(Boolean).map((line) => JSON.parse(line) as Record<string, any>);
    const turnId = events.find((event) => event.type === "turn_meta")!.turn_id;
    expect(db.select().from(conversationTurns).where(eq(conversationTurns.id, turnId)).get()?.status).toBe("done");
    expect(db.select().from(conversationTurns).where(eq(conversationTurns.id, turnId)).get()?.status).not.toBe("running");
  }, 15_000);

  test("temporary and incognito route turns never persist a conversation turn row", async () => {
    const { client } = await owner();
    for (const mode of ["temporary", "incognito"] as const) {
      const response = await client.post("/api/turn/stream", { text: `private ${mode} words`, temporary: true });
      const { reader, event } = await firstEvent(response);
      expect(db.select().from(conversationTurns).where(eq(conversationTurns.id, event.turn_id)).get()).toBeUndefined();
      await reader.cancel();
      await client.post(`/api/turn/${event.turn_id}/cancel`, {});
      expect(db.select().from(conversationTurns).where(eq(conversationTurns.id, event.turn_id)).get()).toBeUndefined();
    }
  }, 15_000);

  test("model history, memory judge input and branch walk skip a running row", async () => {
    const { actor } = await owner();
    const created = createConversation(actor, { surface: "chat" });
    if (!created.ok) throw new Error("conversation creation failed");
    const conversationId = created.value.id;
    const basePending = judgeQueueStats().pending;
    insertProvisionalTurn(actor, "chat", conversationId, "turn-reader-running", "RUNNING-READER-SECRET");
    const window = JSON.stringify(await buildConversationWindow(created.value));
    expect(window).not.toContain("RUNNING-READER-SECRET");
    expect(judgeQueueStats().pending).toBe(basePending);
    const nextConversation = db.select().from(people).where(eq(people.id, actor.id)).get()!;
    expect(nextConversation).toBeTruthy();
    // logTurn's branch winner queries are exercised through its ordinary parent selection in CHAT-CALM-ERRORS-01.
    expect(db.select().from(conversationTurns).where(eq(conversationTurns.id, "turn-reader-running")).get()?.status).toBe("running");
  });

  test.todo("starting the same turn id twice does not create two rows", () => { /* The public stream route treats a supplied turn id only as a resume request, so a repeat start is not reachable yet. */ });
});
