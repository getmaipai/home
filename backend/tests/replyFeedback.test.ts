import { beforeEach, describe, expect, test } from "bun:test";
import { ReplyFeedback } from "@maipai/spec/gen/ts/reply-feedback.js";
import { db, sqlite } from "@/db";
import { conversationTurns, people, replyFeedback } from "@/db/schema";
import { resolveOrCreateConversation, logTurn, runRetention } from "@/lib/conversationHistory";
import { resetDb } from "./reset-db";
import { TestClient } from "./client";
import type { PersonRow } from "@/types";
import type { TurnValue } from "@/wire";
import { CURRENT_SCHEMA_VERSION } from "@/db/schema-version";
import { eq } from "drizzle-orm";

const SAFE: TurnValue["safety"] = {
  flagged: false,
  categories: [],
  action: "allow",
  notify_parent: false,
  matched_signals: [],
  checked_at: new Date().toISOString(),
};

beforeEach(() => resetDb());

async function owner(): Promise<{ client: TestClient; actor: PersonRow }> {
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const actor = db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
  return { client, actor };
}

async function childOf(client: TestClient, role: "child" | "teen" = "child", displayName = "Bramble"): Promise<{ client: TestClient; actor: PersonRow }> {
  const response = await client.post("/api/people", { displayName, role });
  const { id } = (await response.json()) as { id: string };
  const actor = db.select().from(people).where(eq(people.id, id)).get()!;
  const childClient = new TestClient();
  await childClient.post("/api/auth/select", { personId: id });
  return { client: childClient, actor };
}

function turnFor(actor: PersonRow, id: string): string {
  const conversation = resolveOrCreateConversation(actor, "chat");
  if (!conversation.ok) throw new Error(conversation.error);
  logTurn(actor, "chat", "hello", {
    turn_id: id,
    conversation_id: conversation.value.id,
    reply: { text: "Hi there." },
    source: "model",
    safety: SAFE,
  });
  return id;
}

describe("reply feedback migration and schema", () => {
  test("migration creates the table, its unique key, and the current schema stamp", () => {
    const table = sqlite.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'reply_feedback'").get();
    expect(table).toEqual({ name: "reply_feedback" });
    const indexes = sqlite.query("PRAGMA index_list(reply_feedback)").all() as Array<{ name: string; unique: number }>;
    expect(indexes.some((index) => index.name === "reply_feedback_turn_person_unique" && index.unique === 1)).toBe(true);
    expect((sqlite.query("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(CURRENT_SCHEMA_VERSION);
    expect(CURRENT_SCHEMA_VERSION).toBe(52);
  });
});

describe("POST/GET /api/conversations/turns/:id/feedback", () => {
  test("upserts one label per person and GET reads the current person's label", async () => {
    const { client, actor } = await owner();
    const id = turnFor(actor, "turn-feedbackupsert");

    const first = await client.post(`/api/conversations/turns/${id}/feedback`, { verdict: "down", reason: "wrong" });
    expect(first.status).toBe(200);
    const firstBody = ReplyFeedback.parse(await first.json());
    expect(firstBody).toMatchObject({ turn_id: id, person_id: actor.id, verdict: "down", reason: "wrong", source: `api:${actor.id}` });

    const second = await client.post(`/api/conversations/turns/${id}/feedback`, { verdict: "up" });
    expect(second.status).toBe(200);
    const secondBody = ReplyFeedback.parse(await second.json());
    expect(secondBody.id).toBe(firstBody.id);
    expect(secondBody.verdict).toBe("up");
    expect(secondBody.reason).toBeNull();
    expect(db.select().from(replyFeedback).where(eq(replyFeedback.turnId, id)).all()).toHaveLength(1);

    const read = await client.get(`/api/conversations/turns/${id}/feedback`);
    expect(read.status).toBe(200);
    expect(ReplyFeedback.parse(await read.json())).toEqual(secondBody);
  });

  test("a second visible person gets an independent label for the same turn", async () => {
    const { client: ownerClient } = await owner();
    const { client: childClient, actor: child } = await childOf(ownerClient);
    const id = turnFor(child, "turn-feedbackindependent");

    const ownerFeedback = await ownerClient.post(`/api/conversations/turns/${id}/feedback`, { verdict: "down", reason: "off" });
    expect(ownerFeedback.status).toBe(200);
    const childFeedback = await childClient.post(`/api/conversations/turns/${id}/feedback`, { verdict: "up" });
    expect(childFeedback.status).toBe(200);

    const rows = db.select().from(replyFeedback).where(eq(replyFeedback.turnId, id)).all();
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.personId))).toEqual(new Set([child.id, db.select({ id: people.id }).from(people).where(eq(people.displayName, "Sage")).get()!.id]));
  });

  test("a child reason is rejected and never stored", async () => {
    const { client: ownerClient } = await owner();
    const { client: childClient, actor: child } = await childOf(ownerClient);
    const id = turnFor(child, "turn-feedbackchild");

    const response = await childClient.post(`/api/conversations/turns/${id}/feedback`, { verdict: "down", reason: "wrong" });
    expect(response.status).toBe(400);
    expect(db.select().from(replyFeedback).where(eq(replyFeedback.turnId, id)).all()).toHaveLength(0);
  });

  test("ELEMENTS-ADOPT-02: a down rating stores several reasons and a trimmed note, and GET reads them back", async () => {
    const { client, actor } = await owner();
    const id = turnFor(actor, "turn-feedbackreasons");
    const response = await client.post(`/api/conversations/turns/${id}/feedback`, { verdict: "down", reasons: ["wrong", "too_long"], note: "  The hours were for another branch.  " });
    expect(response.status).toBe(200);
    const body = ReplyFeedback.parse(await response.json());
    expect(body).toMatchObject({ verdict: "down", reason: "wrong", reasons: ["wrong", "too_long"], note: "The hours were for another branch." });
    const read = ReplyFeedback.parse(await (await client.get(`/api/conversations/turns/${id}/feedback`)).json());
    expect(read.reasons).toEqual(["wrong", "too_long"]);
    expect(read.note).toBe("The hours were for another branch.");
  });

  test("ELEMENTS-ADOPT-02: an older one-tap body still works and reads back empty reasons and no note", async () => {
    const { client, actor } = await owner();
    const id = turnFor(actor, "turn-feedbackolder");
    const body = ReplyFeedback.parse(await (await client.post(`/api/conversations/turns/${id}/feedback`, { verdict: "down", reason: "off" })).json());
    expect(body).toMatchObject({ reason: "off", reasons: [], note: null });
  });

  test("ELEMENTS-ADOPT-02: an up rating clears earlier reasons and note", async () => {
    const { client, actor } = await owner();
    const id = turnFor(actor, "turn-feedbackclears");
    await client.post(`/api/conversations/turns/${id}/feedback`, { verdict: "down", reasons: ["unsafe"], note: "Not for us." });
    const up = ReplyFeedback.parse(await (await client.post(`/api/conversations/turns/${id}/feedback`, { verdict: "up" })).json());
    expect(up).toMatchObject({ verdict: "up", reason: null, reasons: [], note: null });
    const row = db.select().from(replyFeedback).where(eq(replyFeedback.turnId, id)).get()!;
    expect(row.note).toBeNull();
    expect(row.reasons).toBe("[]");
  });

  test("ELEMENTS-ADOPT-02: a child's reasons or note are refused and nothing is stored", async () => {
    const { client: ownerClient } = await owner();
    const { client: childClient, actor: child } = await childOf(ownerClient);
    const id = turnFor(child, "turn-feedbackchildnote");
    expect((await childClient.post(`/api/conversations/turns/${id}/feedback`, { verdict: "down", reasons: ["wrong"] })).status).toBe(400);
    expect((await childClient.post(`/api/conversations/turns/${id}/feedback`, { verdict: "down", note: "bad" })).status).toBe(400);
    expect(db.select().from(replyFeedback).where(eq(replyFeedback.turnId, id)).all()).toHaveLength(0);
    // The plain thumbs still work for a child.
    expect((await childClient.post(`/api/conversations/turns/${id}/feedback`, { verdict: "down" })).status).toBe(200);
  });

  test("ELEMENTS-ADOPT-02: a teen-role person whose birthdate makes them a child is refused reasons and a note", async () => {
    const { client: ownerClient } = await owner();
    const { client: youngClient, actor: young } = await childOf(ownerClient, "teen", "Pippa");
    const birthdate = new Date(Date.now() - 9 * 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    sqlite.query("UPDATE people SET birthdate = ? WHERE id = ?").run(birthdate, young.id);
    const id = turnFor(young, "turn-feedbackbirthdate");
    expect((await youngClient.post(`/api/conversations/turns/${id}/feedback`, { verdict: "down", note: "bad" })).status).toBe(400);
    expect((await youngClient.post(`/api/conversations/turns/${id}/feedback`, { verdict: "down", reasons: ["wrong"] })).status).toBe(400);
    expect(db.select().from(replyFeedback).where(eq(replyFeedback.turnId, id)).all()).toHaveLength(0);
  });

  test("ELEMENTS-ADOPT-02: a plain thumbs-down again keeps the reasons and note already saved", async () => {
    const { client, actor } = await owner();
    const id = turnFor(actor, "turn-feedbackkeeps");
    await client.post(`/api/conversations/turns/${id}/feedback`, { verdict: "down", reasons: ["off"], note: "Kept words." });
    const again = ReplyFeedback.parse(await (await client.post(`/api/conversations/turns/${id}/feedback`, { verdict: "down" })).json());
    expect(again).toMatchObject({ verdict: "down", reason: "off", reasons: ["off"], note: "Kept words." });
    const replaced = ReplyFeedback.parse(await (await client.post(`/api/conversations/turns/${id}/feedback`, { verdict: "down", reasons: ["wrong"], note: null })).json());
    expect(replaced).toMatchObject({ reasons: ["wrong"], note: null });
  });

  test("ELEMENTS-ADOPT-02: a teen's note stays private; the owner reading the same turn sees only their own label", async () => {
    const { client: ownerClient } = await owner();
    const { client: teenClient, actor: teen } = await childOf(ownerClient, "teen", "Juniper");
    const id = turnFor(teen, "turn-feedbackteen");
    expect((await teenClient.post(`/api/conversations/turns/${id}/feedback`, { verdict: "down", reasons: ["did_not_listen"], note: "It ignored my question." })).status).toBe(200);
    const ownerRead = await ownerClient.get(`/api/conversations/turns/${id}/feedback`);
    expect(ownerRead.status === 404 || (await ownerRead.json()) === null).toBe(true);
    const teenRead = ReplyFeedback.parse(await (await teenClient.get(`/api/conversations/turns/${id}/feedback`)).json());
    expect(teenRead.note).toBe("It ignored my question.");
  });

  const clear = (client: TestClient, id: string) => client.request(`/api/conversations/turns/${id}/feedback`, { method: "DELETE" });

  test("FEEDBACK-CANCEL-01: an adult clearing a rating removes the row, reasons and note, and GET reads null", async () => {
    const { client, actor } = await owner();
    const id = turnFor(actor, "turn-feedbackclearadult");
    await client.post(`/api/conversations/turns/${id}/feedback`, { verdict: "down", reasons: ["wrong"], note: "Nope." });
    const response = await clear(client, id);
    expect(response.status).toBe(200);
    expect(await response.json()).toBeNull();
    expect(db.select().from(replyFeedback).where(eq(replyFeedback.turnId, id)).all()).toHaveLength(0);
    expect(await (await client.get(`/api/conversations/turns/${id}/feedback`)).json()).toBeNull();
  });

  test("FEEDBACK-CANCEL-01: a teen and a child can clear their own rating, and clearing twice is harmless", async () => {
    const { client: ownerClient } = await owner();
    for (const [role, name] of [["teen", "Juniper"], ["child", "Bramble"]] as const) {
      const { client, actor } = await childOf(ownerClient, role, name);
      const id = turnFor(actor, `turn-feedbackclear${role}`);
      await client.post(`/api/conversations/turns/${id}/feedback`, role === "teen" ? { verdict: "down", note: "Private." } : { verdict: "up" });
      expect((await clear(client, id)).status).toBe(200);
      expect(db.select().from(replyFeedback).where(eq(replyFeedback.turnId, id)).all()).toHaveLength(0);
      const again = await clear(client, id);
      expect(again.status).toBe(200);
      expect(await again.json()).toBeNull();
    }
  });

  test("FEEDBACK-CANCEL-01: clearing removes only my own label, never another person's", async () => {
    const { client: ownerClient, actor: ownerActor } = await owner();
    const { client: childClient } = await childOf(ownerClient);
    const id = turnFor(ownerActor, "turn-feedbackclearshared");
    await ownerClient.post(`/api/conversations/turns/${id}/feedback`, { verdict: "down" });
    await clear(childClient, id);
    expect(db.select().from(replyFeedback).where(eq(replyFeedback.turnId, id)).all()).toHaveLength(1);
  });

  test("FEEDBACK-CANCEL-01: clearing needs sign-in and a visible turn", async () => {
    const { client } = await owner();
    expect((await clear(client, "turn-nosuchturn")).status).toBe(404);
    expect((await clear(new TestClient(), "turn-nosuchturn")).status).toBe(401);
  });

  test("ELEMENTS-ADOPT-02: a repeated reason or an over-long note is refused", async () => {
    const { client, actor } = await owner();
    const id = turnFor(actor, "turn-feedbackinvalid");
    expect((await client.post(`/api/conversations/turns/${id}/feedback`, { verdict: "down", reasons: ["wrong", "wrong"] })).status).toBe(400);
    expect((await client.post(`/api/conversations/turns/${id}/feedback`, { verdict: "down", note: "x".repeat(1001) })).status).toBe(400);
  });

  test("ELEMENTS-ADOPT-02: deleting the conversation and the retention window take the note with the rating", async () => {
    const { client, actor } = await owner();
    const conversation = resolveOrCreateConversation(actor, "chat");
    if (!conversation.ok) throw new Error(conversation.error);
    const id = turnFor(actor, "turn-feedbacknotedelete");
    await client.post(`/api/conversations/turns/${id}/feedback`, { verdict: "down", note: "Private words." });
    expect((await client.request(`/api/conversations/${conversation.value.id}`, { method: "DELETE" })).status).toBe(200);
    expect(sqlite.query("SELECT count(*) AS n FROM reply_feedback WHERE note IS NOT NULL").get()).toEqual({ n: 0 });

    const aged = turnFor(actor, "turn-feedbacknoteaged");
    await client.post(`/api/conversations/turns/${aged}/feedback`, { verdict: "down", note: "Older words." });
    sqlite.query("UPDATE conversation_turns SET created_at = ? WHERE id = ?").run(new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString(), aged);
    runRetention();
    expect(sqlite.query("SELECT count(*) AS n FROM reply_feedback WHERE note IS NOT NULL").get()).toEqual({ n: 0 });
  });

  test("deleting a person erases their labels and labels about their turns", async () => {
    const { client: ownerClient, actor: ownerActor } = await owner();
    const { client: childClient, actor: child } = await childOf(ownerClient);
    const id = turnFor(child, "turn-feedbackerase");
    expect((await ownerClient.post(`/api/conversations/turns/${id}/feedback`, { verdict: "down" })).status).toBe(200);
    expect((await childClient.post(`/api/conversations/turns/${id}/feedback`, { verdict: "up" })).status).toBe(200);
    expect(db.select().from(conversationTurns).where(eq(conversationTurns.id, id)).get()).toBeDefined();

    const deleted = await ownerClient.request(`/api/people/${child.id}`, { method: "DELETE" });
    expect(deleted.status).toBe(200);
    const deletedBody = (await deleted.json()) as { erased: { feedback: number } };
    expect(deletedBody.erased.feedback).toBe(2);
    expect(db.select().from(replyFeedback).where(eq(replyFeedback.personId, ownerActor.id)).all()).toHaveLength(0);
    expect(db.select().from(replyFeedback).where(eq(replyFeedback.turnId, id)).all()).toHaveLength(0);
  });

  test("deleting a conversation erases labels before deleting its turns", async () => {
    const { client, actor } = await owner();
    const conversation = resolveOrCreateConversation(actor, "chat");
    if (!conversation.ok) throw new Error(conversation.error);
    const id = turnFor(actor, "turn-feedbackconversationdelete");
    expect((await client.post(`/api/conversations/turns/${id}/feedback`, { verdict: "down" })).status).toBe(200);

    expect((await client.request(`/api/conversations/${conversation.value.id}`, { method: "DELETE" })).status).toBe(200);
    expect(db.select().from(replyFeedback).where(eq(replyFeedback.turnId, id)).all()).toHaveLength(0);
    expect(db.select().from(conversationTurns).where(eq(conversationTurns.id, id)).all()).toHaveLength(0);
  });

  test("retention erases labels before deleting aged turns", async () => {
    const { client, actor } = await owner();
    const id = turnFor(actor, "turn-feedbackretention");
    expect((await client.post(`/api/conversations/turns/${id}/feedback`, { verdict: "down" })).status).toBe(200);
    sqlite.query("UPDATE conversation_turns SET created_at = ? WHERE id = ?").run(new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString(), id);

    expect(runRetention().deleted).toBe(1);
    expect(db.select().from(replyFeedback).where(eq(replyFeedback.turnId, id)).all()).toHaveLength(0);
  });
});
