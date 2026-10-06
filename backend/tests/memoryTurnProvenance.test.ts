import { beforeEach, describe, expect, test } from "bun:test";
import { MemoryRecord } from "@maipai/spec/gen/ts/memory-record.js";
import { db } from "@/db";
import { people } from "@/db/schema";
import { resolveOrCreateConversation, logTurn, listConversationTurns } from "@/lib/conversationHistory";
import { archiveByProvenance } from "@/lib/memory";
import { resetDb } from "./reset-db";
import { TestClient } from "./client";
import type { PersonRow } from "@/types";
import type { TurnValue } from "@/wire";
import { eq } from "drizzle-orm";

// ELEMENTS-ADOPT-02 slice 2: "Remember this" on a reply records that turn as
// the memory's source, so the reply's memory chips show it. The hub accepts
// the turn only when the person owns it and it is a saved turn (an Incognito
// turn is never saved, so it can never be named).
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

async function member(client: TestClient, role: "child" | "teen" | "adult", displayName: string): Promise<{ client: TestClient; actor: PersonRow }> {
  const response = await client.post("/api/people", { displayName, role });
  const { id } = (await response.json()) as { id: string };
  const actor = db.select().from(people).where(eq(people.id, id)).get()!;
  const memberClient = new TestClient();
  await memberClient.post("/api/auth/select", { personId: id });
  return { client: memberClient, actor };
}

function turnFor(actor: PersonRow, id: string): { turnId: string; conversationId: string } {
  const conversation = resolveOrCreateConversation(actor, "chat");
  if (!conversation.ok) throw new Error(conversation.error);
  logTurn(actor, "chat", "hello", {
    turn_id: id,
    conversation_id: conversation.value.id,
    reply: { text: "The library opens at nine on Saturdays." },
    source: "model",
    safety: SAFE,
  });
  return { turnId: id, conversationId: conversation.value.id };
}

const BODY = { text: "The library opens at nine on Saturdays.", category: "fact", tier: "durable", scope: "person", importance: 0.6 };

describe("POST /api/memory with turn_id (ELEMENTS-ADOPT-02)", () => {
  test("names the person's own saved turn as the source, so the turn lists the memory", async () => {
    const { client, actor } = await owner();
    const { turnId, conversationId } = turnFor(actor, "turn-remembermine");
    const response = await client.post("/api/memory", { ...BODY, person: actor.id, turn_id: turnId });
    expect(response.status).toBe(201);
    const record = MemoryRecord.parse(await response.json());
    expect(record.source).toBe(`saved:${turnId}`);
    const turns = listConversationTurns(actor, conversationId);
    if (!turns.ok) throw new Error(turns.error);
    expect(turns.value.find((t) => t.id === turnId)?.memory_ids).toEqual([record.id]);
  });

  test("saving the same reply twice returns the memory already saved, not a duplicate", async () => {
    const { client, actor } = await owner();
    const { turnId, conversationId } = turnFor(actor, "turn-remembertwice");
    const first = MemoryRecord.parse(await (await client.post("/api/memory", { ...BODY, person: actor.id, turn_id: turnId })).json());
    const again = await client.post("/api/memory", { ...BODY, person: actor.id, turn_id: turnId });
    expect(again.status).toBe(200);
    expect(MemoryRecord.parse(await again.json()).id).toBe(first.id);
    const turns = listConversationTurns(actor, conversationId);
    if (!turns.ok) throw new Error(turns.error);
    expect(turns.value.find((t) => t.id === turnId)?.memory_ids).toEqual([first.id]);
  });

  test("without turn_id the source stays the hub's own, as before", async () => {
    const { client, actor } = await owner();
    const record = MemoryRecord.parse(await (await client.post("/api/memory", { ...BODY, person: actor.id })).json());
    expect(record.source).toBe(`api:${actor.id}`);
  });

  test("a turn the person does not own is refused, even one an admin can read", async () => {
    const { client: ownerClient } = await owner();
    const { actor: teen } = await member(ownerClient, "teen", "Marlow");
    const { turnId } = turnFor(teen, "turn-rememberteen");
    const response = await ownerClient.post("/api/memory", { ...BODY, turn_id: turnId });
    expect(response.status).toBe(404);
  });

  test("an admin writing a child's memory cannot file it under the admin's own turn", async () => {
    const { client, actor } = await owner();
    const { actor: child } = await member(client, "child", "Bramble");
    const { turnId } = turnFor(actor, "turn-rememberforchild");
    const response = await client.post("/api/memory", { ...BODY, person: child.id, turn_id: turnId });
    expect(response.status).toBe(400);
  });

  test("editing the turn retires what the judge guessed from it, never what the person saved", async () => {
    const { client, actor } = await owner();
    const { turnId, conversationId } = turnFor(actor, "turn-remembersurvive");
    const saved = MemoryRecord.parse(await (await client.post("/api/memory", { ...BODY, person: actor.id, turn_id: turnId })).json());
    expect(archiveByProvenance(turnId)).toBe(0);
    const turns = listConversationTurns(actor, conversationId);
    if (!turns.ok) throw new Error(turns.error);
    expect(turns.value.find((t) => t.id === turnId)?.memory_ids).toEqual([saved.id]);
  });

  test("a forgotten (archived) memory no longer lists on its turn", async () => {
    const { client, actor } = await owner();
    const { turnId, conversationId } = turnFor(actor, "turn-rememberforgot");
    const saved = MemoryRecord.parse(await (await client.post("/api/memory", { ...BODY, person: actor.id, turn_id: turnId })).json());
    expect((await client.post(`/api/memory/${saved.id}/archive`, {})).status).toBe(200);
    const turns = listConversationTurns(actor, conversationId);
    if (!turns.ok) throw new Error(turns.error);
    expect(turns.value.find((t) => t.id === turnId)?.memory_ids).toEqual([]);
  });

  test("an unknown or Incognito turn id (never saved) is refused", async () => {
    const { client, actor } = await owner();
    const response = await client.post("/api/memory", { ...BODY, person: actor.id, turn_id: "turn-neversaved1" });
    expect(response.status).toBe(404);
  });

  test("a teen names their own turn the same way an adult does", async () => {
    const { client: ownerClient } = await owner();
    const { client: teenClient, actor: teen } = await member(ownerClient, "teen", "Juniper");
    const { turnId } = turnFor(teen, "turn-rememberteenown");
    const response = await teenClient.post("/api/memory", { ...BODY, person: teen.id, turn_id: turnId });
    expect(response.status).toBe(201);
    expect(MemoryRecord.parse(await response.json()).source).toBe(`saved:${turnId}`);
  });
});
