// STORE-SHARE-01's REST surface - lib/shares.ts and lib/attachments.ts
// hold the rules (see shares.test.ts, access.test.ts); this exercises
// the real HTTP boundary the same way lists.test.ts does for lib/lists.ts.
import { describe, expect, test, beforeEach } from "bun:test";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { db } from "@/db";
import { people, conversationTurns } from "@/db/schema";
import { createAttachment } from "@/lib/attachments";
import { newConversationTurnId } from "@/lib/id";
import { nextHlc } from "@/lib/hlc";
import { resolveOrCreateConversation } from "@/lib/conversationHistory";
import { eq } from "drizzle-orm";

beforeEach(() => resetDb());

async function ownerSession(): Promise<{ client: TestClient; id: string }> {
  const client = new TestClient();
  const res = await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const { person } = (await res.json()) as { person: { id: string } };
  return { client, id: person.id };
}

async function signedInAdult(owner: TestClient, displayName: string): Promise<{ client: TestClient; id: string }> {
  const res = await owner.post("/api/people", { displayName, role: "adult", secret: "0000" });
  const created = (await res.json()) as { id: string };
  const client = new TestClient();
  await client.post("/api/auth/verify-secret", { personId: created.id, secret: "0000" });
  return { client, id: created.id };
}

function uploadFileFor(ownerId: string): string {
  const actor = db.select().from(people).where(eq(people.id, ownerId)).get()!;
  const conversation = resolveOrCreateConversation(actor, "chat");
  if (!conversation.ok) throw new Error(conversation.error);
  const turnId = newConversationTurnId();
  db.insert(conversationTurns)
    .values({
      id: turnId,
      personId: actor.id,
      surface: "chat",
      conversationId: conversation.value.id,
      userText: "note",
      replyText: "saved",
      source: "model",
      safetyAction: "allow",
      createdAt: new Date().toISOString(),
      hlc: nextHlc(),
    })
    .run();
  const created = createAttachment(actor, { conversationId: conversation.value.id, turnId, mediaType: "image/png", bytes: new TextEncoder().encode("bytes") });
  if (!created.ok) throw new Error(created.error);
  return created.value.id;
}

describe("GET /api/files", () => {
  test("lists my own files", async () => {
    const owner = await ownerSession();
    const fileId = uploadFileFor(owner.id);

    const res = await owner.client.get("/api/files");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { file: { id: string }; owner_person_id: string; shared: boolean }[];
    expect(body.some((row) => row.file.id === fileId && !row.shared && row.owner_person_id === owner.id)).toBe(true);
  });
});

describe("POST /api/files/{id}/shares and DELETE /api/shares/{id}", () => {
  test("sharing makes a file appear in the recipient's list, under the owner's name; unsharing removes it", async () => {
    const owner = await ownerSession();
    const lucia = await signedInAdult(owner.client, "Lucia");
    const fileId = uploadFileFor(owner.id);

    const shareRes = await owner.client.post(`/api/files/${fileId}/shares`, { to: lucia.id });
    expect(shareRes.status).toBe(201);
    const share = (await shareRes.json()) as { id: string; to: string };
    expect(share.to).toBe(lucia.id);

    const luciaList = await lucia.client.get("/api/files");
    expect(luciaList.status).toBe(200);
    const luciaBody = (await luciaList.json()) as { file: { id: string }; owner_person_id: string; shared: boolean }[];
    const entry = luciaBody.find((row) => row.file.id === fileId);
    expect(entry).toBeDefined();
    expect(entry?.owner_person_id).toBe(owner.id);
    expect(entry?.shared).toBe(true);

    const deleteRes = await owner.client.request(`/api/shares/${share.id}`, { method: "DELETE" });
    expect(deleteRes.status).toBe(200);

    const luciaListAfter = await lucia.client.get("/api/files");
    const luciaBodyAfter = (await luciaListAfter.json()) as { file: { id: string } }[];
    expect(luciaBodyAfter.some((row) => row.file.id === fileId)).toBe(false);
  });

  test("a third person with no share cannot fetch the file directly", async () => {
    const owner = await ownerSession();
    const marlow = await signedInAdult(owner.client, "Marlow");
    const fileId = uploadFileFor(owner.id);

    const res = await marlow.client.get(`/api/files/${fileId}`);
    expect(res.status).toBe(404);
  });

  test("someone with no access to a file cannot share it", async () => {
    const owner = await ownerSession();
    const marlow = await signedInAdult(owner.client, "Marlow");
    const lucia = await signedInAdult(owner.client, "Lucia");
    const fileId = uploadFileFor(owner.id);

    const res = await marlow.client.post(`/api/files/${fileId}/shares`, { to: lucia.id });
    expect(res.status).toBe(403);
  });
});
