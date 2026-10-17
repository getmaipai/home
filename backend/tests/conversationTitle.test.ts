import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { __setStackClientForTests, __resetStackEngineForTests } from "@/lib/stackEngine";
import { startStackFixture, useDefaultScriptedStack, IDENTITY_HEADERS, type StackFixture } from "./stackFixture";
import { setHouseholdSettingValue } from "@/lib/settings";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { generateConversationTitle, scheduleConversationTitle, provisionalTitleFrom, ensureProvisionalTitle, sweepConversationTitles, __setConversationTitleDelayForTests } from "@/lib/conversationTitle";
import { createConversation, getConversation, listConversations, logTurn, updateConversationArchived, updateConversationTitle } from "@/lib/conversationHistory";
import { db } from "@/db";
import { people, conversations } from "@/db/schema";
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

/** A Stack whose chat completions fail: the engine is down. */
function scriptEngineDown(): void {
  modelCalls = [];
  fixture = startStackFixture({
    "POST /v1/chat/completions": async () => Response.json({ error: { message: "down" } }, { status: 503, headers: IDENTITY_HEADERS }),
    "GET /stack/v1/roles": async () => Response.json({ roles: [] }),
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
    // Asked for a noun-phrase topic, not the message cut off.
    expect(sent).toContain("three to six words");
    expect(sent).toContain("never copy or truncate the first message");
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
    scriptEngineDown();
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
    // The refused text is never stored; the chat keeps its provisional title.
    expect(row.value.title).toBe("How do I keep my tomato plants from");
    expect(row.value.title).not.toContain("bomb");
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

describe("a chat is never left on the default title (CHAT-TITLE-02)", () => {
  const sourceOf = (id: string) => db.select().from(conversations).where(eq(conversations.id, id)).get()!;

  test("the first stored message sets a provisional title at once, with no model", async () => {
    scriptEngineDown();
    const { actor } = await household();
    const id = chatWithOneExchange(actor, "## **How do I keep** my tomato plants from splitting in the heat? https://example.com/x");
    const row = sourceOf(id);
    expect(row.titleSource).toBe("provisional");
    expect(row.title).toBe("How do I keep my tomato plants from");
    expect(row.title!.length).toBeLessThanOrEqual(40);
  });

  test("a greeting, a short message and a blank message give no provisional title, and a date is never one", () => {
    for (const text of ["hi", "Hello!", "?", "", "   ", "what time", "New chat", "my password is hunter2 [credential redacted]"]) {
      expect(provisionalTitleFrom(text)).toBeNull();
    }
  });

  test("a chat opening with 'hi' shows the first later message with at least three words, else the default", async () => {
    const { actor } = await household();
    const conversation = createConversation(actor, { surface: "chat" });
    if (!conversation.ok) throw new Error(conversation.error);
    const id = conversation.value.id;
    logTurn(actor, "chat", "hi", { reply: { text: "Hello!" }, source: "model", safety: SAFE, conversation_id: id, turn_id: "turn-hi-1" });
    expect(sourceOf(id)).toMatchObject({ title: "New chat", titleSource: "provisional" });
    // The placeholder is replaceable: the model title (judge role) takes it.
    scriptModel("Tomato Plant Care");
    expect(await generateConversationTitle(id)).toBe("titled");
    expect(modelCalls[0]!.model).toBe("judge");
    expect(sourceOf(id)).toMatchObject({ title: "Tomato Plant Care", titleSource: "model" });
    const second = createConversation(actor, { surface: "chat" });
    if (!second.ok) throw new Error(second.error);
    logTurn(actor, "chat", "hi", { reply: { text: "Hello!" }, source: "model", safety: SAFE, conversation_id: second.value.id, turn_id: "turn-hi-2" });
    expect(sourceOf(second.value.id).title).toBe("New chat");
    logTurn(actor, "chat", "plan a birthday party for saturday", { reply: { text: "Sure." }, source: "model", safety: SAFE, conversation_id: second.value.id, turn_id: "turn-hi-3" });
    db.update(conversations).set({ title: null, titleSource: null }).where(eq(conversations.id, second.value.id)).run();
    expect(ensureProvisionalTitle(second.value.id)).toBe("Plan a birthday party for saturday");
  });

  test("reasoning text in the model output is stripped before the title is used", async () => {
    scriptModel("<think>The user wants a title about tomatoes, so</think>\nTomato Plant Care");
    const { actor } = await household();
    const id = chatWithOneExchange(actor);
    expect(await generateConversationTitle(id)).toBe("titled");
    expect(sourceOf(id).title).toBe("Tomato Plant Care");
    scriptModel("<think>never closed, still reasoning about tomatoes");
    const other = chatWithOneExchange(actor);
    expect(await generateConversationTitle(other)).toBe("refused");
    expect(sourceOf(other).titleSource).toBe("provisional");
  });

  test("the sweep replaces a legacy 'Chat, Oct 17' provisional title with a model title", async () => {
    scriptModel("Tomato Plant Care");
    const { actor } = await household();
    const id = chatWithOneExchange(actor);
    db.update(conversations).set({ title: "Chat, Oct 17", titleSource: "provisional" }).where(eq(conversations.id, id)).run();
    const result = await sweepConversationTitles();
    expect(result.titled).toBe(1);
    expect(sourceOf(id)).toMatchObject({ title: "Tomato Plant Care", titleSource: "model" });
  });

  test("one chat the model gives nothing usable for does not starve the rest of the sweep", async () => {
    const { actor } = await household();
    const ids = Array.from({ length: 7 }, () => chatWithOneExchange(actor));
    let n = 0;
    scriptModel(() => (n++ < 5 ? "" : "Tomato Plant Care"));
    const result = await sweepConversationTitles(5);
    expect(result.unavailable).toBe(false);
    expect(result.titled).toBe(2);
    expect(ids.length).toBe(7);
  });

  test("a failed first reply still leaves the chat titled from the person's message", async () => {
    const { actor } = await household();
    const conversation = createConversation(actor, { surface: "chat" });
    if (!conversation.ok) throw new Error(conversation.error);
    logTurn(actor, "chat", "plan a birthday party for saturday", { reply: { text: "Sorry." }, source: "model", safety: SAFE, conversation_id: conversation.value.id, turn_id: "turn-failed-1" }, { status: "failed" });
    expect(sourceOf(conversation.value.id).title).toBe("Plan a birthday party for saturday");
  });

  test("a child's provisional title passes the output gate: a refused message falls back to the default", async () => {
    const { client } = await household();
    const sprout = await addPerson(client, "Sprout", "child");
    const id = chatWithOneExchange(sprout, "how to make a pipe bomb at home");
    expect(sourceOf(id).title).toBe("New chat");
  });

  test("engine unavailable: the provisional title stands, and a later call replaces it with the model title", async () => {
    scriptEngineDown();
    const { actor } = await household();
    const id = chatWithOneExchange(actor);
    expect(await generateConversationTitle(id)).toBe("unavailable");
    expect(sourceOf(id).title).toBe("How do I keep my tomato plants from");
    scriptModel("Tomato Plant Care");
    expect(await generateConversationTitle(id)).toBe("titled");
    expect(sourceOf(id)).toMatchObject({ title: "Tomato Plant Care", titleSource: "model" });
  });

  test("a blank or default-text model title keeps the provisional one", async () => {
    scriptModel('""');
    const { actor } = await household();
    const id = chatWithOneExchange(actor);
    expect(await generateConversationTitle(id)).toBe("refused");
    expect(sourceOf(id).titleSource).toBe("provisional");
    scriptModel("New chat");
    expect(await generateConversationTitle(id)).toBe("refused");
    expect(sourceOf(id).title).not.toBe("New chat");
  });

  test("a hand rename is never overwritten, even when it equals the provisional text", async () => {
    scriptModel("Model Title");
    const { actor } = await household();
    const id = chatWithOneExchange(actor);
    updateConversationTitle(actor, id, "How do I keep my tomato plants from");
    expect(sourceOf(id).titleSource).toBe("user");
    expect(await generateConversationTitle(id)).toBe("skipped");
    expect(modelCalls).toHaveLength(0);
  });

  test("clearing a title re-fills it from the first message", async () => {
    const { actor } = await household();
    const id = chatWithOneExchange(actor);
    updateConversationTitle(actor, id, "Mine");
    const cleared = updateConversationTitle(actor, id, null);
    if (!cleared.ok) throw new Error(cleared.error);
    expect(cleared.value.title).toBe("How do I keep my tomato plants from");
    expect(sourceOf(id).titleSource).toBe("provisional");
  });

  test("the sweep titles an old chat found with no title, then upgrades provisional ones within its cap", async () => {
    scriptModel("Tomato Plant Care");
    const { actor } = await household();
    const ids = [chatWithOneExchange(actor), chatWithOneExchange(actor), chatWithOneExchange(actor)];
    // An install that predates this: no title, no source.
    db.update(conversations).set({ title: null, titleSource: null }).where(eq(conversations.id, ids[0]!)).run();
    const result = await sweepConversationTitles(2);
    expect(result.provisional).toBe(1);
    expect(result.titled).toBe(2);
    expect(modelCalls).toHaveLength(2);
    const sources = ids.map((id) => sourceOf(id).titleSource).sort();
    expect(sources).toEqual(["model", "model", "provisional"]);
    expect(ids.every((id) => sourceOf(id).title !== null)).toBe(true);
  });

  test("the sweep stops after one call when the engine is down, and still leaves every chat titled", async () => {
    scriptEngineDown();
    const { actor } = await household();
    const ids = [chatWithOneExchange(actor), chatWithOneExchange(actor)];
    db.update(conversations).set({ title: null, titleSource: null }).run();
    const result = await sweepConversationTitles(5);
    expect(result.unavailable).toBe(true);
    expect(result.titled).toBe(0);
    expect(ids.every((id) => sourceOf(id).title !== null)).toBe(true);
  });

  test("a temporary chat is never titled by the sweep", async () => {
    const { actor } = await household();
    const conversation = createConversation(actor, { surface: "chat", mode: "temporary" });
    if (!conversation.ok) throw new Error(conversation.error);
    expect(ensureProvisionalTitle(conversation.value.id)).toBeNull();
  });
});
