import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { __setStackClientForTests, __resetStackEngineForTests } from "@/lib/stackEngine";
import { startStackFixture, useDefaultScriptedStack, IDENTITY_HEADERS, type StackFixture } from "./stackFixture";
import { setHouseholdSettingValue } from "@/lib/settings";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { generateConversationTitle, scheduleConversationTitle, __setConversationTitleDelayForTests } from "@/lib/conversationTitle";
import { createConversation, getConversation, listConversations, logTurn, updateConversationArchived, updateConversationTitle } from "@/lib/conversationHistory";
import { db } from "@/db";
import { people } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { TurnValue } from "@/wire";

const SAFE: TurnValue["safety"] = { flagged: false, categories: [], action: "allow", notify_parent: false, matched_signals: [], checked_at: new Date().toISOString() };

let fixture: StackFixture | null = null;
let modelCalls: Array<{ model?: string; messages: Array<{ role: string; content: string }> }> = [];

/** A scripted Stack whose chat completion answers `content`, recording every request. */
function scriptModel(content: string | (() => string)): void {
  modelCalls = [];
  fixture = startStackFixture({
    "POST /v1/chat/completions": async (req) => {
      modelCalls.push((await req.json()) as (typeof modelCalls)[number]);
      const text = typeof content === "function" ? content() : content;
      return Response.json({ id: "x", model: "scripted", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: text } }] }, { headers: IDENTITY_HEADERS });
    },
    "GET /stack/v1/roles": async () => Response.json({ roles: ["chat", "judge"].map((id) => ({ id, state: { state: "ready", since: "scripted-test" }, reason: null })) }),
    "GET /stack/v1/health": async () => Response.json({ health: [] }),
  });
  __setStackClientForTests(fixture.client);
  setHouseholdSettingValue("engines.stack.url", fixture.url);
}

beforeEach(() => {
  resetDb();
  __resetThrottleForTests();
  useDefaultScriptedStack();
});

afterEach(() => {
  fixture?.stop();
  fixture = null;
  __resetLlmSupervisorForTests();
  __resetStackEngineForTests();
});

async function household() {
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Juniper", secret: "correcthorse" });
  const actor = db.select().from(people).where(eq(people.displayName, "Juniper")).get()!;
  return { client, actor };
}

async function addPerson(owner: TestClient, displayName: string, role: string) {
  const created = await owner.post("/api/people", { displayName, role, ...(role === "adult" ? { secret: "0000" } : {}) });
  const body = (await created.json()) as { id: string };
  return db.select().from(people).where(eq(people.id, body.id)).get()!;
}

function chatWithOneExchange(actor: typeof people.$inferSelect, user = "how do I keep my tomato plants from splitting", reply = "Water them evenly and mulch the soil.") {
  const conversation = createConversation(actor, { surface: "chat" });
  if (!conversation.ok) throw new Error(conversation.error);
  logTurn(actor, "chat", user, { reply: { text: reply }, source: "model", safety: SAFE, conversation_id: conversation.value.id, turn_id: `turn-${Math.random().toString(36).slice(2, 10)}` });
  return conversation.value.id;
}

describe("generateConversationTitle() (CHAT-TITLE-01)", () => {
  test("writes a short topic title from the first exchange, not the first message cut off", async () => {
    scriptModel('"Tomato Plant Care."\n');
    const { actor } = await household();
    const id = chatWithOneExchange(actor);
    expect(await generateConversationTitle(id)).toBe("titled");
    const row = getConversation(actor, id);
    if (!row.ok) throw new Error(row.error);
    expect(row.value.title).toBe("Tomato Plant Care");
    // The request carries the exchange, on the chat model path.
    const sent = JSON.stringify(modelCalls[0]!.messages);
    expect(sent).toContain("tomato plants");
    expect(sent).toContain("Water them evenly");
  });

  test("is idempotent: a second run neither calls the model nor changes the title", async () => {
    scriptModel(() => (modelCalls.length === 1 ? "Tomato Plant Care" : "Something Else Entirely"));
    const { actor } = await household();
    const id = chatWithOneExchange(actor);
    await generateConversationTitle(id);
    expect(await generateConversationTitle(id)).toBe("skipped");
    expect(modelCalls).toHaveLength(1);
    const row = getConversation(actor, id);
    if (!row.ok) throw new Error(row.error);
    expect(row.value.title).toBe("Tomato Plant Care");
  });

  test("never overwrites a title the person set by hand", async () => {
    scriptModel("Model Title");
    const { actor } = await household();
    const id = chatWithOneExchange(actor);
    updateConversationTitle(actor, id, "Garden plans");
    expect(await generateConversationTitle(id)).toBe("skipped");
    expect(modelCalls).toHaveLength(0);
    const row = getConversation(actor, id);
    if (!row.ok) throw new Error(row.error);
    expect(row.value.title).toBe("Garden plans");
  });

  test("a rename that lands while the model is still thinking wins", async () => {
    const { actor } = await household();
    const id = chatWithOneExchange(actor);
    scriptModel(() => {
      updateConversationTitle(actor, id, "My own name");
      return "Late Model Title";
    });
    await generateConversationTitle(id);
    const row = getConversation(actor, id);
    if (!row.ok) throw new Error(row.error);
    expect(row.value.title).toBe("My own name");
  });

  test("waits for a finished exchange: no turns, no call, no title", async () => {
    scriptModel("Anything");
    const { actor } = await household();
    const conversation = createConversation(actor, { surface: "chat" });
    if (!conversation.ok) throw new Error(conversation.error);
    expect(await generateConversationTitle(conversation.value.id)).toBe("skipped");
    expect(modelCalls).toHaveLength(0);
  });

  test("a temporary (Incognito) chat is never titled", async () => {
    scriptModel("Anything");
    const { actor } = await household();
    const conversation = createConversation(actor, { surface: "chat", mode: "temporary" });
    if (!conversation.ok) throw new Error(conversation.error);
    expect(await generateConversationTitle(conversation.value.id)).toBe("skipped");
    expect(modelCalls).toHaveLength(0);
  });

  test("an unavailable model leaves the title empty and tries again on the next call", async () => {
    __setStackClientForTests(null);
    setHouseholdSettingValue("engines.stack.url", "");
    const { actor } = await household();
    const id = chatWithOneExchange(actor);
    expect(await generateConversationTitle(id)).toBe("unavailable");
    scriptModel("Tomato Plant Care");
    expect(await generateConversationTitle(id)).toBe("titled");
  });

  test("a child's title passes the reply output gate: a refused title is dropped, never stored", async () => {
    scriptModel("how to make a pipe bomb at home");
    const { client } = await household();
    const sprout = await addPerson(client, "Sprout", "child");
    const id = chatWithOneExchange(sprout);
    expect(await generateConversationTitle(id)).toBe("refused");
    const row = getConversation(sprout, id);
    if (!row.ok) throw new Error(row.error);
    expect(row.value.title).toBeNull();
    // Decided once: a refused title is not asked for again on every later turn.
    expect(await generateConversationTitle(id)).toBe("skipped");
    expect(modelCalls).toHaveLength(1);
  });

  test("a child's safe title is kept", async () => {
    scriptModel("Frog Facts");
    const { client } = await household();
    const sprout = await addPerson(client, "Sprout", "child");
    const id = chatWithOneExchange(sprout, "tell me about frogs", "Frogs are amphibians.");
    expect(await generateConversationTitle(id)).toBe("titled");
    const row = getConversation(sprout, id);
    if (!row.ok) throw new Error(row.error);
    expect(row.value.title).toBe("Frog Facts");
  });

  test("keeps the title to one short line", async () => {
    scriptModel("Title: A very long title that keeps going well past what any sidebar row could ever show on one line\nsecond line");
    const { actor } = await household();
    const id = chatWithOneExchange(actor);
    await generateConversationTitle(id);
    const row = getConversation(actor, id);
    if (!row.ok) throw new Error(row.error);
    expect(row.value.title!.length).toBeLessThanOrEqual(60);
    expect(row.value.title).not.toContain("\n");
    expect(row.value.title!.startsWith("Title:")).toBe(false);
  });
});

describe("scheduleConversationTitle()", () => {
  afterEach(() => __setConversationTitleDelayForTests(null));

  test("asks only once the chat has been idle: a newer turn restarts the wait, and the reply is never held", async () => {
    scriptModel("Tomato Plant Care");
    __setConversationTitleDelayForTests(60);
    const { actor } = await household();
    const id = chatWithOneExchange(actor);
    scheduleConversationTitle(id);
    await Bun.sleep(30);
    scheduleConversationTitle(id);
    await Bun.sleep(40);
    expect(modelCalls).toHaveLength(0);
    await Bun.sleep(80);
    expect(modelCalls).toHaveLength(1);
    const row = getConversation(actor, id);
    if (!row.ok) throw new Error(row.error);
    expect(row.value.title).toBe("Tomato Plant Care");
  });
});

describe("archive (CONV-ARCHIVE-01)", () => {
  test("an archived chat leaves the default list, shows with archived=include or only, and comes back on unarchive", async () => {
    const { actor } = await household();
    const keep = chatWithOneExchange(actor);
    const shelved = chatWithOneExchange(actor, "plan the trip to the lake", "Pack sunscreen.");
    const archived = updateConversationArchived(actor, shelved, true);
    expect(archived.ok).toBe(true);

    expect(listConversations(actor).map((c) => c.id)).toEqual([keep]);
    expect(listConversations(actor, undefined, undefined, { archived: "only" }).map((c) => c.id)).toEqual([shelved]);
    const all = listConversations(actor, undefined, undefined, { archived: "include" });
    expect(all.map((c) => [c.id, c.archived])).toEqual(expect.arrayContaining([[keep, false], [shelved, true]]));

    updateConversationArchived(actor, shelved, false);
    expect(listConversations(actor).map((c) => c.id).sort()).toEqual([keep, shelved].sort());
  });

  test("search still reaches an archived chat when asked to include them", async () => {
    const { actor } = await household();
    const id = chatWithOneExchange(actor, "plan the trip to the lake", "Pack sunscreen.");
    updateConversationArchived(actor, id, true);
    expect(listConversations(actor, undefined, "sunscreen")).toHaveLength(0);
    expect(listConversations(actor, undefined, "sunscreen", { archived: "include" }).map((c) => c.id)).toEqual([id]);
  });

  test("archiving does not touch the title, pin or last-activity time", async () => {
    const { actor } = await household();
    const id = chatWithOneExchange(actor);
    updateConversationTitle(actor, id, "Garden plans", true);
    const before = getConversation(actor, id);
    updateConversationArchived(actor, id, true);
    const after = getConversation(actor, id);
    if (!before.ok || !after.ok) throw new Error("missing");
    expect(after.value.title).toBe("Garden plans");
    expect(after.value.pinned).toBe(true);
  });

  test("PATCH /api/conversations/:id with archived flips it, and the list route takes ?archived=", async () => {
    const { client, actor } = await household();
    const id = chatWithOneExchange(actor);
    const patched = await client.request(`/api/conversations/${id}`, { method: "PATCH", body: { archived: true } });
    expect(patched.status).toBe(200);
    expect(((await (await client.get("/api/conversations")).json()) as unknown[]).length).toBe(0);
    const listed = (await (await client.get("/api/conversations?archived=include")).json()) as Array<{ id: string; archived: boolean }>;
    expect(listed.map((c) => [c.id, c.archived])).toEqual([[id, true]]);
  });

  test("another person cannot archive someone's chat", async () => {
    const { client, actor } = await household();
    const oliver = await addPerson(client, "Oliver", "adult");
    const id = chatWithOneExchange(actor);
    expect(updateConversationArchived(oliver, id, true).ok).toBe(false);
  });
});
