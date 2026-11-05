import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { attachments, people } from "@/db/schema";
import { resolveOrCreateConversation } from "@/lib/conversationHistory";
import { newConversationTurnId } from "@/lib/id";
import { resetDb } from "./reset-db";
import { TestClient } from "./client";

beforeEach(() => resetDb());
async function signedIn() {
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const actor = db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
  const conversation = resolveOrCreateConversation(actor, "chat");
  if (!conversation.ok) throw new Error(conversation.error);
  return { client, actor, conversation: conversation.value };
}
async function upload(client: TestClient, name: string, type: string, bytes = new Uint8Array([1, 2, 3]), temporary = false) {
  const form = new FormData(); form.append("file", new File([bytes], name, { type }));
  form.append("turn_id", newConversationTurnId()); form.append("conversation_id", ""); form.append("temporary", String(temporary));
  return client.postForm("/api/attachments/upload-audio", form);
}
describe("chat audio attachment route", () => {
  test("accepts m4a as an owned composer attachment", async () => {
    const { client } = await signedIn();
    const turnId = newConversationTurnId();
    const form = new FormData(); form.append("file", new File([new Uint8Array([1, 2, 3])], "demo.m4a", { type: "audio/mp4" }));
    form.append("turn_id", turnId); form.append("temporary", "false");
    const response = await client.postForm("/api/attachments/upload-audio", form);
    expect(response.status).toBe(201);
    const { audio } = await response.json() as { audio: { id: string; name: string; media_type: string } };
    expect(audio).toMatchObject({ name: "demo.m4a", media_type: expect.stringMatching(/^audio\/(mp4|x-m4a)$/) });
    expect(audio.id).toMatch(/^file-/);
    expect(db.select().from(attachments).where(eq(attachments.id, audio.id)).get()?.provenance).toBe("composer:demo.m4a");
  });
  test("refuses png, oversized files, and temporary chats", async () => {
    const { client } = await signedIn();
    expect((await upload(client, "x.png", "image/png")).status).toBe(400);
    expect((await upload(client, "huge.m4a", "audio/mp4", new Uint8Array(40 * 1024 * 1024 + 1))).status).toBe(413);
    expect((await upload(client, "x.m4a", "audio/mp4", new Uint8Array([1]), true)).status).toBe(400);
  });
});
