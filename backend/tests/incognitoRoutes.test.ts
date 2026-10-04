// THIN-INC audit rows 5 to 7 (docs/plans/privacy-mode-2026-09-24.md): the
// web chat's assistant-stream wire (THIN-5D) and the Incognito list keep a
// temporary chat exclusive, the spoken OpenAI-style route cannot reach a
// temporary session, and issue #163's durable-id-claimed-temporary mismatch
// is refused on the default path. Rows 1 to 4 are turnMachine/incognitoAudit.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { setHouseholdSettingValue } from "@/lib/settings";
import { db } from "@/db";
import { people, conversations } from "@/db/schema";
import { createConversation, listTemporaryConversations } from "@/lib/conversationHistory";
import { runTurnNext, runTurnNextStream } from "@/lib/turnMachine/turnNext";
import { useDefaultScriptedStack } from "./stackFixture";
import { changedTables, tableCounts, withEngine } from "./turnMachine/modeHarness";
import type { PersonRow } from "@/types";

beforeEach(() => {
  resetDb();
  useDefaultScriptedStack();
  __resetThrottleForTests();
  __resetRateLimiterForTests();
  setHouseholdSettingValue("chat.model_id", "qwen3-8b-instruct-q4-k-m");
});
afterEach(() => {
  __resetLlmSupervisorForTests();
  delete process.env.MAIPAI_LLAMA_SERVER_URL;
});

async function owner(): Promise<{ client: TestClient; actor: PersonRow }> {
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Oliver", secret: "correcthorse" });
  const actor = db.select().from(people).where(eq(people.displayName, "Oliver")).get()!;
  return { client, actor };
}

const ASSISTANT_STREAM = { accept: "application/x-assistant-stream" };

describe("THIN-INC row 5: the Incognito list is exclusive, on the assistant-stream wire too", () => {
  test("a temporary turn on the assistant-stream wire stores nothing, shows only in the Incognito list, and discard empties it", async () => {
    const { client, actor } = await owner();
    const before = tableCounts();
    let conversationId = "";
    await withEngine(() => "Okay, between us.", async () => {
      const res = await client.request("/api/turn/stream", { method: "POST", body: { surface: "chat", text: "hello there", temporary: true }, headers: ASSISTANT_STREAM });
      const body = await res.text();
      expect(body.length).toBeGreaterThan(0);
      expect(body).toContain('0:"Okay,"'); // the assistant-stream framing, not NDJSON
    });
    conversationId = listTemporaryConversations(actor)[0]?.id ?? "";
    expect(conversationId).not.toBe("");
    expect(changedTables(before, tableCounts())).toEqual([]);

    const ordinary = (await (await client.get("/api/conversations")).json()) as { id: string }[];
    expect(ordinary.some((c) => c.id === conversationId)).toBe(false);
    const incognito = (await (await client.get("/api/conversations/incognito")).json()) as { id: string; turn_count: number }[];
    expect(incognito.map((c) => c.id)).toEqual([conversationId]);

    const discarded = (await (await client.post("/api/conversations/incognito/discard", {})).json()) as { discarded: number };
    expect(discarded.discarded).toBe(1);
    expect(await (await client.get("/api/conversations/incognito")).json()).toEqual([]);

    // The discarded id is gone: a later turn naming it is refused, never quietly made durable.
    const after = tableCounts();
    await withEngine(() => "Okay.", async () => {
      const again = await runTurnNext(actor, "chat", "are you still there", { conversationId, temporary: true });
      expect(again.ok).toBe(false);
    });
    expect(changedTables(after, tableCounts())).toEqual([]);
  });

  test("another person's Incognito list never holds this person's chat", async () => {
    const { actor } = await owner();
    await withEngine(() => "Okay.", async () => {
      await runTurnNext(actor, "chat", "just between us", { temporary: true });
    });
    expect(listTemporaryConversations(actor)).toHaveLength(1);
    const now = new Date().toISOString();
    db.insert(people).values({ id: "person-willow", displayName: "Willow", role: "adult", avatarSeed: "willow", source: "hub", createdAt: now, updatedAt: now, hlc: "1700000000000:2:testfix" }).run();
    const willow = db.select().from(people).where(eq(people.id, "person-willow")).get()!;
    expect(listTemporaryConversations(willow)).toEqual([]);
  });
});

describe("THIN-INC row 6: the spoken OpenAI-style route cannot reach a temporary session", () => {
  test("a temporary chat's turn count and the database are untouched by a /v1/chat/completions call that names it", async () => {
    const { client, actor } = await owner();
    let conversationId = "";
    await withEngine(() => "Okay.", async () => {
      const first = await runTurnNext(actor, "chat", "just between us", { temporary: true });
      if (!first.ok || first.kind !== "immediate") throw new Error("expected an immediate result");
      conversationId = first.value.conversation_id;
      const token = ((await (await client.post("/api/settings/api-token", {})).json()) as { token: string }).token;
      await client.request("/v1/chat/completions", {
        method: "POST",
        body: { messages: [{ role: "user", content: "and another thing" }], temporary: true, conversation_id: conversationId },
        headers: { authorization: `Bearer ${token}` },
      });
    });
    const session = listTemporaryConversations(actor).find((c) => c.id === conversationId);
    expect(session?.turn_count).toBe(1);
  });
});

describe("THIN-INC row 7: issue #163 on the default path", () => {
  test("a durable id claimed temporary is refused with the typed code by runTurnNext and runTurnNextStream, nothing written", async () => {
    const { actor } = await owner();
    const durable = createConversation(actor, { surface: "chat" });
    if (!durable.ok) throw new Error(durable.error);
    const before = tableCounts();
    await withEngine(() => "Okay.", async () => {
      const blocking = await runTurnNext(actor, "chat", "hello", { conversationId: durable.value.id, temporary: true });
      expect(blocking).toMatchObject({ ok: false, status: 400, code: "temporary_mismatch" });
      const streamed = await runTurnNextStream(actor, "chat", "hello", { conversationId: durable.value.id, temporary: true });
      expect(streamed).toMatchObject({ ok: false, status: 400, code: "temporary_mismatch" });
    });
    expect(changedTables(before, tableCounts())).toEqual([]);
    expect(db.select().from(conversations).where(eq(conversations.id, durable.value.id)).get()!.mode).toBe("chat");
  });

  test("the routes carry the same refusal as a 400 with the code, and the client's own flow (create temporary, then turn) leaves no row", async () => {
    const { client } = await owner();
    const durable = (await (await client.post("/api/conversations", { surface: "chat" })).json()) as { id: string };
    const before = tableCounts();
    for (const path of ["/api/turn", "/api/turn/stream"]) {
      const res = await client.post(path, { surface: "chat", text: "hello", conversation_id: durable.id, temporary: true });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { code: string }).code).toBe("temporary_mismatch");
    }
    expect(changedTables(before, tableCounts())).toEqual([]);

    const created = (await (await client.post("/api/conversations", { mode: "temporary" })).json()) as { id: string; mode: string };
    expect(created.mode).toBe("temporary");
    const afterCreate = tableCounts();
    await withEngine(() => "Okay.", async () => {
      const res = await client.post("/api/turn/stream", { surface: "chat", text: "hello", conversation_id: created.id, temporary: true });
      expect(res.status).toBe(200);
      await res.text();
    });
    expect(changedTables(afterCreate, tableCounts())).toEqual([]);
  });
});
