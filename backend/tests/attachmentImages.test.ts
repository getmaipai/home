import { beforeEach, describe, expect, test } from "bun:test";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { attachments, conversationTurns, people } from "@/db/schema";
import { attachmentFilePath, deleteAttachmentsForTurns, temporaryChatImagesForTurn, removeTemporaryChatImages } from "@/lib/attachments";
import { newConversationTurnId } from "@/lib/id";
import { nextHlc } from "@/lib/hlc";
import { resolveOrCreateConversation } from "@/lib/conversationHistory";
import { MAX_CHAT_IMAGES, CHAT_IMAGE_REFUSAL } from "@/wire";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";

beforeEach(() => resetDb());

async function signedInOwner() {
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const actor = db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
  return { client, actor };
}

async function png(): Promise<Uint8Array> {
  return new Uint8Array(await sharp({ create: { width: 12, height: 8, channels: 3, background: { r: 80, g: 120, b: 200 } } }).png().toBuffer());
}

async function upload(client: TestClient, bytes: Uint8Array, conversationId: string | undefined, turnId: string, temporary = false): Promise<Response> {
  const form = new FormData();
  form.append("file", new File([bytes], "photo.png", { type: "image/png" }));
  form.append("turn_id", turnId);
  form.append("temporary", temporary ? "true" : "false");
  if (conversationId) form.append("conversation_id", conversationId);
  return client.postForm("/api/attachments/upload", form);
}

describe("chat image attachment route", () => {
  test("stores a cleaned JPEG and serves it by id", async () => {
    const { client, actor } = await signedInOwner();
    const conversation = resolveOrCreateConversation(actor, "chat");
    expect(conversation.ok).toBe(true);
    if (!conversation.ok) return;
    const turnId = newConversationTurnId();
    const response = await upload(client, await png(), conversation.value.id, turnId);
    expect(response.status).toBe(201);
    const body = await response.json() as { conversation_id: string; turn_id: string; image: { id: string; name: string; width: number; height: number; media_type: string } };
    expect(body.image).toMatchObject({ name: "photo.png", width: 12, height: 8, media_type: "image/jpeg" });
    const row = db.select().from(attachments).where(eq(attachments.id, body.image.id)).get()!;
    const path = attachmentFilePath(row.storagePath);
    const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
    const metadata = await sharp(bytes).metadata();
    expect(metadata.exif).toBeUndefined();
    const served = await client.get(`/api/attachments/${body.image.id}?v=full`);
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/jpeg");
    expect(served.headers.get("cache-control")).toBe("private, no-store");
    const childCreated = await client.post("/api/people", { displayName: "Bramble", role: "child" });
    const child = await childCreated.json() as { id: string };
    const childClient = new TestClient();
    await childClient.post("/api/auth/select", { personId: child.id });
    expect((await childClient.get(`/api/attachments/${body.image.id}?v=full`)).status).toBe(404);
    deleteAttachmentsForTurns([turnId]);
    db.delete(conversationTurns).where(eq(conversationTurns.id, turnId)).run();
  });

  test("refuses the fifth picture and a 12 MB upload with the same plain line", async () => {
    const { client, actor } = await signedInOwner();
    const conversation = resolveOrCreateConversation(actor, "chat");
    expect(conversation.ok).toBe(true);
    if (!conversation.ok) return;
    const turnId = newConversationTurnId();
    const bytes = await png();
    for (let i = 0; i < MAX_CHAT_IMAGES; i++) expect((await upload(client, bytes, conversation.value.id, turnId)).status).toBe(201);
    const fifth = await upload(client, bytes, conversation.value.id, turnId);
    expect(fifth.status).toBe(400);
    expect(((await fifth.json()) as { error: string }).error).toBe(CHAT_IMAGE_REFUSAL);
    const large = await upload(client, new Uint8Array(12 * 1024 * 1024), conversation.value.id, newConversationTurnId());
    expect(large.status).toBe(400);
    expect(((await large.json()) as { error: string }).error).toBe(CHAT_IMAGE_REFUSAL);
    deleteAttachmentsForTurns([turnId]);
    db.delete(conversationTurns).where(eq(conversationTurns.id, turnId)).run();
  });

  test("defaults child uploads off and lets only an adult turn them on", async () => {
    const { client: adultClient, actor } = await signedInOwner();
    const created = await adultClient.post("/api/people", { displayName: "Bramble", role: "child" });
    const child = await created.json() as { id: string };
    const childClient = new TestClient();
    await childClient.post("/api/auth/select", { personId: child.id });
    const turnId = newConversationTurnId();
    const denied = await upload(childClient, await png(), undefined, turnId);
    expect(denied.status).toBe(403);
    const selfEnable = await childClient.request("/api/settings", { method: "PUT", body: { scope: `person:${child.id}`, key: "chat.photo_uploads", value: true } });
    expect(selfEnable.status).toBe(403);
    const parentEnable = await adultClient.request("/api/settings", { method: "PUT", body: { scope: `person:${child.id}`, key: "chat.photo_uploads", value: true } });
    expect(parentEnable.status).toBe(200);
    const enabled = await upload(childClient, await png(), undefined, turnId);
    expect(enabled.status).toBe(201);
    const createdImage = await enabled.json() as { conversation_id: string };
    expect(actor.role).toBe("owner");
    const row = db.select().from(attachments).all().at(-1)!;
    expect((await adultClient.get(`/api/attachments/${row.id}?v=full`)).status).toBe(200);
    deleteAttachmentsForTurns([turnId]);
    db.delete(conversationTurns).where(eq(conversationTurns.id, turnId)).run();
    void createdImage;
  });

  test("keeps a temporary-chat image in memory and out of the attachment table", async () => {
    const { client, actor } = await signedInOwner();
    const turnId = newConversationTurnId();
    const response = await upload(client, await png(), undefined, turnId, true);
    expect(response.status).toBe(201);
    const body = await response.json() as { conversation_id: string; image: { id: string } };
    expect(db.select().from(attachments).all()).toHaveLength(0);
    expect(temporaryChatImagesForTurn(actor, body.conversation_id, turnId)).toHaveLength(1);
    const served = await client.get(`/api/attachments/${body.image.id}?v=thumb&conversation_id=${body.conversation_id}`);
    expect(served.status).toBe(200);
    removeTemporaryChatImages(body.conversation_id);
  });
});
