import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { db } from "@/db";
import { conversations, conversationTurns, memoryRecords, people } from "@/db/schema";
import { eq } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { createConversation, getConversation, listConversations, listTemporaryConversations, updateConversationPlacement } from "@/lib/conversationHistory";
import { useDefaultScriptedStack } from "./stackFixture";
import { runTurnNext } from "@/lib/turnMachine/turnNext";

beforeEach(() => { resetDb(); useDefaultScriptedStack(); });
afterEach(() => resetDb());

async function signedInOwner() {
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Household Owner", secret: "correcthorse" });
  return { client, actor: db.select().from(people).where(eq(people.displayName, "Household Owner")).get()! };
}

describe("AMBIENT-03 side conversations", () => {
  test("creates chat and side placements independently, and filters the default history list", async () => {
    const { client } = await signedInOwner();
    const chatResponse = await client.post("/api/conversations", { surface: "chat" });
    const sideResponse = await client.post("/api/conversations", { surface: "chat", placement: "side" });
    expect(chatResponse.status).toBe(201);
    expect(sideResponse.status).toBe(201);
    const chat = await chatResponse.json() as { id: string; placement: string };
    const side = await sideResponse.json() as { id: string; placement: string };
    expect(chat.placement).toBe("chat");
    expect(side.placement).toBe("side");
    expect((await client.get(`/api/conversations/${chat.id}`)).status).toBe(200);
    expect((await client.get(`/api/conversations/${side.id}`)).status).toBe(200);

    const defaults = await (await client.get("/api/conversations")).json() as Array<{ id: string; placement: string }>;
    const sideRows = await (await client.get("/api/conversations?placement=side")).json() as Array<{ id: string; placement: string }>;
    const allRows = await (await client.get("/api/conversations?placement=all")).json() as Array<{ id: string; placement: string }>;
    expect(defaults.map((row) => row.id)).toContain(chat.id);
    expect(defaults.map((row) => row.id)).not.toContain(side.id);
    expect(sideRows.map((row) => row.id)).toEqual([side.id]);
    expect(allRows.map((row) => row.id)).toContain(side.id);
  });

  test("side conversations appear in own companion activity with placement and hand off only to Chat", async () => {
    const { client } = await signedInOwner();
    const created = await (await client.post("/api/conversations", { placement: "side" })).json() as { id: string; companion_id: string; placement: string };
    const activity = await client.get(`/api/companions/${created.companion_id}/activity`);
    expect(activity.status).toBe(200);
    const rows = (await activity.json() as { activity: Array<{ kind: string; conversation_id?: string; placement?: string }> }).activity;
    expect(rows.find((row) => row.conversation_id === created.id)).toMatchObject({ kind: "chat", placement: "side" });

    const chat = await (await client.post("/api/conversations", {})).json() as { id: string };
    const refused = await client.request(`/api/conversations/${chat.id}`, { method: "PATCH", body: { placement: "side" } });
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({ error: expect.stringMatching(/open the companion pane and start a new chat/i) });
    const continued = await client.request(`/api/conversations/${created.id}`, { method: "PATCH", body: { placement: "chat" } });
    expect(continued.status).toBe(200);
    expect((await continued.json() as { placement: string }).placement).toBe("chat");
    expect((await (await client.get(`/api/conversations/${chat.id}`)).json() as { status: string }).status).toBe("closed");
  });

  test("deleted side conversations disappear from lists, activity and thread search", async () => {
    const { client } = await signedInOwner();
    const response = await client.post("/api/conversations", { placement: "side" });
    const created = await response.json() as { id: string; companion_id: string };
    await client.request(`/api/conversations/${created.id}`, { method: "PATCH", body: { title: "Ambient sunset" } });
    const defaultSearch = await (await client.get("/api/conversations?q=Ambient")).json() as Array<{ id: string }>;
    const allSearch = await (await client.get("/api/conversations?q=Ambient&placement=all")).json() as Array<{ id: string }>;
    expect(defaultSearch.some((row) => row.id === created.id)).toBe(false);
    expect(allSearch.some((row) => row.id === created.id)).toBe(true);
    expect((await client.request(`/api/conversations/${created.id}`, { method: "DELETE" })).status).toBe(200);
    for (const path of ["/api/conversations?placement=all", "/api/conversations?placement=side", "/api/conversations?q=Ambient&placement=all", `/api/companions/${created.companion_id}/activity`]) {
      const body = await (await client.get(path)).json() as Array<{ id?: string; conversation_id?: string }> | { activity: Array<{ conversation_id?: string }> };
      const rows: Array<{ id?: string; conversation_id?: string }> = Array.isArray(body) ? body : body.activity;
      expect(rows.some((row) => row.id === created.id || row.conversation_id === created.id)).toBe(false);
    }
  });

  test("temporary side chats use the same minor restriction as Chat", async () => {
    const { client } = await signedInOwner();
    const childResponse = await client.post("/api/people", { displayName: "Child Profile", role: "child", secret: "0000" });
    const child = await childResponse.json() as { id: string };
    const childClient = new TestClient();
    await childClient.post("/api/auth/verify-secret", { personId: child.id, secret: "0000" });
    const response = await childClient.post("/api/conversations", { surface: "chat", placement: "side", mode: "temporary" });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "temporary chat is not available for minors" });
  });

  test("a typed side turn enters the ordinary written chat turn path", async () => {
    const { client } = await signedInOwner();
    const created = await (await client.post("/api/conversations", { placement: "side" })).json() as { id: string };
    const response = await client.post("/api/turn", { surface: "chat", conversation_id: created.id, text: "Tell me one short greeting." });
    expect(response.status).toBe(200);
    const result = await response.json() as { source: string; conversation_id: string };
    expect(result).toMatchObject({ source: "model", conversation_id: created.id });
    const rows = db.select().from(conversationTurns).where(eq(conversationTurns.conversationId, created.id)).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userText: "Tell me one short greeting.", source: "model" });
  });

  test("a child's blocked prompt has the same refusal on Chat and in a side conversation", async () => {
    const { client } = await signedInOwner();
    const childResult = await client.post("/api/people", { displayName: "Child Speaker", role: "child", secret: "0000" });
    const childId = (await childResult.json() as { id: string }).id;
    const child = db.select().from(people).where(eq(people.id, childId)).get()!;
    const chat = createConversation(child, { placement: "chat" });
    const side = createConversation(child, { placement: "side" });
    if (!chat.ok || !side.ok) throw new Error("conversation creation failed");
    const chatTurn = await runTurnNext(child, "chat", "keep this between us", { conversationId: chat.value.id });
    const sideTurn = await runTurnNext(child, "chat", "keep this between us", { conversationId: side.value.id });
    expect(chatTurn.ok).toBe(true);
    expect(sideTurn.ok).toBe(true);
    if (!chatTurn.ok || chatTurn.kind !== "immediate" || !sideTurn.ok || sideTurn.kind !== "immediate") throw new Error("expected immediate refusals");
    expect(sideTurn.value.source).toBe(chatTurn.value.source);
    expect(sideTurn.value.source).toBe("safety_refuse");
    expect(sideTurn.value.safety).toMatchObject({ action: chatTurn.value.safety.action, categories: chatTurn.value.safety.categories, notify_parent: chatTurn.value.safety.notify_parent });
    db.update(people).set({ role: "teen" }).where(eq(people.id, child.id)).run();
    const teen = db.select().from(people).where(eq(people.id, child.id)).get()!;
    const teenChat = createConversation(teen, { placement: "chat" });
    const teenSide = createConversation(teen, { placement: "side" });
    if (!teenChat.ok || !teenSide.ok) throw new Error("teen conversation creation failed");
    const teenChatTurn = await runTurnNext(teen, "chat", "keep this between us", { conversationId: teenChat.value.id });
    const teenSideTurn = await runTurnNext(teen, "chat", "keep this between us", { conversationId: teenSide.value.id });
    expect(teenChatTurn.ok && teenChatTurn.kind === "immediate").toBe(true);
    expect(teenSideTurn.ok && teenSideTurn.kind === "immediate").toBe(true);
    if (!teenChatTurn.ok || teenChatTurn.kind !== "immediate" || !teenSideTurn.ok || teenSideTurn.kind !== "immediate") throw new Error("expected teen turns");
    expect(teenSideTurn.value.safety).toMatchObject({ action: teenChatTurn.value.safety.action, categories: teenChatTurn.value.safety.categories });
    expect(teenSideTurn.value.safety.action).toBe("refuse");
  });

  test("a temporary side turn stays out of durable history and memory", async () => {
    const { client, actor } = await signedInOwner();
    const created = await (await client.post("/api/conversations", { placement: "side", mode: "temporary" })).json() as { id: string };
    const result = await runTurnNext(actor, "chat", "Remember that the blue notebook is on my desk.", { conversationId: created.id });
    expect(result.ok).toBe(true);
    expect(listTemporaryConversations(actor).find((row) => row.id === created.id)).toBeUndefined();
    expect(listTemporaryConversations(actor, undefined, "side").find((row) => row.id === created.id)?.placement).toBe("side");
    expect(listTemporaryConversations(actor, undefined, "all").some((row) => row.id === created.id)).toBe(true);
    expect(db.select().from(conversationTurns).where(eq(conversationTurns.conversationId, created.id)).all()).toHaveLength(0);
    expect(db.select().from(memoryRecords).where(eq(memoryRecords.person, actor.id)).all()).toHaveLength(0);
  });

  test("side conversation visibility matches the existing person access rule", async () => {
    const { client, actor: owner } = await signedInOwner();
    const createPerson = async (displayName: string, role: string) => {
      const response = await client.post("/api/people", { displayName, role, ...(role === "admin" || role === "adult" ? { secret: "0000" } : {}) });
      return db.select().from(people).where(eq(people.id, (await response.json() as { id: string }).id)).get()!;
    };
    const child = await createPerson("Child Viewer", "child");
    const admin = await createPerson("Admin Viewer", "admin");
    const adult = await createPerson("Adult Owner", "adult");
    const stranger = await createPerson("Stranger Viewer", "adult");
    const childSide = createConversation(child, { placement: "side" });
    const adultSide = createConversation(adult, { placement: "side" });
    if (!childSide.ok || !adultSide.ok) throw new Error("side conversation creation failed");

    expect(listConversations(owner, child.id, undefined, { placement: "side" }).map((row) => row.id)).toContain(childSide.value.id);
    expect(getConversation(owner, childSide.value.id).ok).toBe(true);
    expect(updateConversationPlacement(admin, childSide.value.id, "chat")).toMatchObject({ ok: false, status: 404 });
    expect(listConversations(adult, undefined, undefined, { placement: "side" }).map((row) => row.id)).toContain(adultSide.value.id);
    expect(listConversations(admin, adult.id, undefined, { placement: "side" })).toEqual([]);
    expect(getConversation(admin, adultSide.value.id)).toMatchObject({ ok: false, status: 404 });
    expect(listConversations(stranger, child.id, undefined, { placement: "side" })).toEqual([]);
    expect(getConversation(stranger, childSide.value.id)).toMatchObject({ ok: false, status: 404 });
  });

  test("turn gate and safety modules never read placement", () => {
    const gateModules = [
      "src/lib/ageBand.ts",
      "src/lib/safety.ts",
      "src/lib/guards.ts",
      "src/lib/childLinks.ts",
      "src/lib/turnMachine/nodes/policy.ts",
      "src/lib/turnMachine/nodes/outputGate.ts",
      "src/lib/turnMachine/nodes/safety.ts",
      "src/lib/turnMachine/nodes/context.ts",
      "src/lib/turnMachine/turnNext.ts",
      "src/lib/turnContext.ts",
      "src/lib/pictures/lane.ts",
      "src/lib/pictures/laneGate.ts",
      "src/routes/turn.ts",
      "src/lib/access.ts",
      "src/lib/gate/decide.ts",
      "src/lib/gate/types.ts",
    ];
    for (const path of gateModules) {
      const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
      expect(source, `${path} must not branch on conversation placement`).not.toMatch(/\bplacement\b/);
    }
  });

  test("handing a closed side chat to Chat opens it and keeps one open Chat conversation", async () => {
    const { client, actor } = await signedInOwner();
    const chat = await (await client.post("/api/conversations", {})).json() as { id: string };
    const sideA = await (await client.post("/api/conversations", { placement: "side" })).json() as { id: string };
    const sideB = await (await client.post("/api/conversations", { placement: "side" })).json() as { id: string };
    expect(db.select().from(conversations).where(eq(conversations.id, sideA.id)).get()?.status).toBe("closed");
    const moved = await client.request(`/api/conversations/${sideA.id}`, { method: "PATCH", body: { placement: "chat" } });
    expect(moved.status).toBe(200);
    const rows = db.select().from(conversations).where(eq(conversations.personId, actor.id)).all();
    expect(rows.find((row) => row.id === sideA.id)).toMatchObject({ placement: "chat", status: "open", archived: false });
    expect(rows.find((row) => row.id === chat.id)?.status).toBe("closed");
    expect(rows.find((row) => row.id === sideB.id)).toMatchObject({ placement: "side", status: "open" });
    expect(rows.filter((row) => row.placement === "chat" && row.status === "open")).toHaveLength(1);
  });

  test("a placement change must be sent on its own", async () => {
    const { client } = await signedInOwner();
    const side = await (await client.post("/api/conversations", { placement: "side" })).json() as { id: string };
    const mixed = await client.request(`/api/conversations/${side.id}`, { method: "PATCH", body: { placement: "chat", title: "Mixed" } });
    expect(mixed.status).toBe(400);
    expect(((await mixed.json()) as { error: string }).error).toContain("on its own");
  });
});
