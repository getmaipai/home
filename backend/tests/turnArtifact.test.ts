import { beforeEach, describe, expect, test } from "bun:test";
import { TurnArtifact } from "@maipai/spec/gen/ts/turn-artifact.js";
import { db, sqlite } from "@/db";
import { conversationTurns, people } from "@/db/schema";
import { resolveOrCreateConversation, logTurn } from "@/lib/conversationHistory";
import { resetDb } from "./reset-db";
import { TestClient } from "./client";
import type { PersonRow } from "@/types";
import type { TurnValue } from "@/wire";
import { eq } from "drizzle-orm";

beforeEach(() => resetDb());

const SAFE: TurnValue["safety"] = {
  flagged: false,
  categories: [],
  action: "allow",
  notify_parent: false,
  matched_signals: [],
  checked_at: "2026-09-16T00:00:00.000Z",
};

const ARTIFACT = TurnArtifact.parse({
  id: "doc-example123",
  turn_id: "turn-artifact123",
  revision: 1,
  evidence_version: "outcome-v1",
  section: { type: "procedure", title: "Tea", steps: [{ position: 1, instruction: "Steep the tea.", quantities: [] }] },
  sources: [{ id: "src-example123", kind: "package", title: "Tea guide", url: "https://example.com/tea", site: "example.com", snippet: null, source: "turn-artifact123", created_at: "2026-09-16T00:00:00.000Z", hlc: "1789516800000:0:abc123" }],
  provenance: "outcome:tea",
  created_at: "2026-09-16T00:00:00.000Z",
  hlc: "1789516800000:1:abc123",
});

const ATTACHMENT_ARTIFACT = TurnArtifact.parse({
  id: "doc-attachment123",
  turn_id: "turn-attachment123",
  revision: 1,
  evidence_version: "outcome-attachment1",
  section: { type: "document", attachment_id: "att-example123", chunks: [{ attachment_id: "att-example123", page: 1, text: "A locally retained page.", source_id: "src-attachment123" }] },
  sources: [{ id: "src-attachment123", kind: "package", title: "Attachment page 1", url: "attachment://att-example123/page/1", site: "MaiPai Home", snippet: "A locally retained page.", source: "turn-attachment123", created_at: "2026-09-16T00:00:00.000Z", hlc: "1789516800000:0:abc123" }],
  provenance: "composer:turn-attachment123:document",
  created_at: "2026-09-16T00:00:00.000Z",
  hlc: "1789516800000:1:abc123",
});

async function owner(): Promise<{ client: TestClient; actor: PersonRow }> {
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const actor = db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
  return { client, actor };
}

function turnFor(actor: PersonRow, document?: typeof ARTIFACT, id = document?.turn_id ?? "turn-artifact456"): string {
  const conversation = resolveOrCreateConversation(actor, "chat");
  if (!conversation.ok) throw new Error(conversation.error);
  logTurn(actor, "chat", "make tea", {
    turn_id: id,
    conversation_id: conversation.value.id,
    reply: { text: "Steep the tea." },
    source: "model",
    safety: SAFE,
  }, { document });
  return id;
}

describe("COMP-01 document storage", () => {
  test("a valid TurnArtifact round-trips beside outcomes and absent documents stay null", async () => {
    const { actor } = await owner();
    const id = turnFor(actor, ARTIFACT);
    const stored = db.select({ document: conversationTurns.document }).from(conversationTurns).where(eq(conversationTurns.id, id)).get()!;
    expect(TurnArtifact.parse(JSON.parse(stored.document!))).toEqual(ARTIFACT);

    const absentId = turnFor(actor);
    const absent = db.select({ document: conversationTurns.document }).from(conversationTurns).where(eq(conversationTurns.id, absentId)).get()!;
    expect(absent.document).toBeNull();
  });

  test("a document for another turn is rejected before it can be stored", async () => {
    const { actor } = await owner();
    const mismatched = { ...ARTIFACT, turn_id: "turn-artifact456" };
    expect(() => turnFor(actor, mismatched, "turn-artifact789")).toThrow(/belongs to/);
  });

  test("the completed wire value reports document availability additively", async () => {
    const { actor } = await owner();
    const conversation = resolveOrCreateConversation(actor, "chat");
    if (!conversation.ok) throw new Error(conversation.error);
    const value: TurnValue = { turn_id: ARTIFACT.turn_id, conversation_id: conversation.value.id, reply: { text: "Steep the tea." }, source: "model", safety: SAFE };
    logTurn(actor, "chat", "make tea", value, { document: ARTIFACT });
    expect(value.document_available).toBe(true);
  });
});

describe("GET /api/conversations/turns/:id/document", () => {
  test("returns the validated artifact and 404s when it is absent", async () => {
    const { client, actor } = await owner();
    const id = turnFor(actor, ARTIFACT);
    const response = await client.get(`/api/conversations/turns/${id}/document`);
    expect(response.status).toBe(200);
    expect(TurnArtifact.parse(await response.json())).toEqual(ARTIFACT);

    const absentId = turnFor(actor);
    const missing = await client.get(`/api/conversations/turns/${absentId}/document`);
    expect(missing.status).toBe(404);
  });

  test("does not return malformed stored JSON", async () => {
    const { client, actor } = await owner();
    const id = turnFor(actor, ARTIFACT);
    sqlite.query("UPDATE conversation_turns SET document = ? WHERE id = ?").run("not json", id);
    expect((await client.get(`/api/conversations/turns/${id}/document`)).status).toBe(404);
  });

  test("does not return a valid artifact whose turn_id was tampered", async () => {
    const { client, actor } = await owner();
    const id = turnFor(actor, ARTIFACT);
    sqlite.query("UPDATE conversation_turns SET document = ? WHERE id = ?").run(JSON.stringify({ ...ARTIFACT, turn_id: "turn-other123" }), id);
    expect((await client.get(`/api/conversations/turns/${id}/document`)).status).toBe(404);
  });

  test("adult delivery keeps an attachment document while child delivery gets no document or source link", async () => {
    const { client: ownerClient } = await owner();
    const created = await ownerClient.post("/api/people", { displayName: "Bramble", role: "child" });
    const childId = ((await created.json()) as { id: string }).id;
    const childActor = db.select().from(people).where(eq(people.id, childId)).get()!;
    const id = turnFor(childActor, ATTACHMENT_ARTIFACT);

    const adultResponse = await ownerClient.get(`/api/conversations/turns/${id}/document`);
    expect(adultResponse.status).toBe(200);
    expect(await adultResponse.json()).toEqual(ATTACHMENT_ARTIFACT);

    const childClient = new TestClient();
    await childClient.post("/api/auth/select", { personId: childId });
    expect((await childClient.get(`/api/conversations/turns/${id}/document`)).status).toBe(404);
  });
});
