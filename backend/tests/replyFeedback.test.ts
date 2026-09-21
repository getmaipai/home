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

async function childOf(client: TestClient): Promise<{ client: TestClient; actor: PersonRow }> {
  const response = await client.post("/api/people", { displayName: "Bramble", role: "child" });
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
    expect(CURRENT_SCHEMA_VERSION).toBe(40);
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
