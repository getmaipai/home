// CAPTION-01e: the Library viewer shows uploaded files (file-*), not only media items, so a transcript must
// work for a file the person can see and stay 404 for a person who cannot.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { conversationTurns, people } from "@/db/schema";
import { createAttachment } from "@/lib/attachments";
import { resolveOrCreateConversation } from "@/lib/conversationHistory";
import { nextHlc } from "@/lib/hlc";
import { newConversationTurnId } from "@/lib/id";
import { __setTranscriptStackClientForTests } from "@/lib/transcripts/stack";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";

beforeEach(() => {
  resetDb();
  __setTranscriptStackClientForTests({
    transcribeJob: async () => ({
      language: "en",
      segments: [{ id: "seg-1", start: 0, end: 2, text: "Welcome back to the show." }],
      engine: "scripted",
      model_id: "scripted-model",
    }),
  });
});
afterEach(() => __setTranscriptStackClientForTests(null));

function audioFileFor(ownerId: string): string {
  const actor = db.select().from(people).where(eq(people.id, ownerId)).get()!;
  const conversation = resolveOrCreateConversation(actor, "chat");
  if (!conversation.ok) throw new Error(conversation.error);
  const turnId = newConversationTurnId();
  db.insert(conversationTurns).values({
    id: turnId, personId: actor.id, surface: "chat", conversationId: conversation.value.id,
    userText: "note", replyText: "saved", source: "model", safetyAction: "allow",
    createdAt: new Date().toISOString(), hlc: nextHlc(),
  }).run();
  const created = createAttachment(actor, {
    conversationId: conversation.value.id, turnId, mediaType: "audio/mp4",
    bytes: new TextEncoder().encode("audio bytes"), retention: "kept",
  });
  if (!created.ok) throw new Error(created.error);
  return created.value.id;
}

async function signedIn(name: string): Promise<{ client: TestClient; id: string }> {
  const client = new TestClient();
  const res = await client.post("/api/auth/setup", { displayName: name, secret: "correcthorse" });
  const { person } = (await res.json()) as { person: { id: string } };
  return { client, id: person.id };
}

describe("transcripts for uploaded Library files", () => {
  test("the owner makes, reads and exports a transcript for a file", async () => {
    const owner = await signedIn("Sage");
    const fileId = audioFileFor(owner.id);
    expect((await owner.client.get(`/api/library/${fileId}/transcript`)).status).toBe(404);
    const made = await owner.client.post(`/api/library/${fileId}/transcript`, {});
    expect(made.status).toBe(201);
    const found = await owner.client.get(`/api/library/${fileId}/transcript`);
    expect(found.status).toBe(200);
    const record = (await found.json()) as { id: string };
    const exported = await owner.client.get(`/api/transcripts/${record.id}/export?format=vtt`);
    expect(exported.status).toBe(200);
    expect(await exported.text()).toContain("Welcome back to the show.");
  });

  test("a file id that does not exist is a plain 404", async () => {
    const owner = await signedIn("Sage");
    const res = await owner.client.post("/api/library/file-nothere/transcript", {});
    expect(res.status).toBe(404);
  });
});
