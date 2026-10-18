// LIBRARY-REVAMP-12: rename and Keep.
import { beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { attachments, conversations, conversationTurns, people } from "@/db/schema";
import { createAttachment, deleteAttachmentsForTurns } from "@/lib/attachments";
import { resolveOrCreateConversation } from "@/lib/conversationHistory";
import { createShare } from "@/lib/shares";
import { newConversationTurnId } from "@/lib/id";
import { nextHlc } from "@/lib/hlc";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";

beforeEach(() => resetDb());
async function setup() {
  const sage = new TestClient();
  const made = await sage.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const sageId = ((await made.json()) as { person: { id: string } }).person.id;
  const lucia = await sage.post("/api/people", { displayName: "Lucia", role: "adult", secret: "0000" });
  const luciaId = ((await lucia.json()) as { id: string }).id;
  const luciaClient = new TestClient();
  await luciaClient.post("/api/auth/verify-secret", { personId: luciaId, secret: "0000" });
  const actor = db.select().from(people).where(eq(people.id, sageId)).get()!;
  const conversation = resolveOrCreateConversation(actor, "chat");
  if (!conversation.ok) throw new Error(conversation.error);
  const file = (text: string, provenance: string, retention: "kept" | "conversation" = "conversation") => {
    const turnId = newConversationTurnId();
    db.insert(conversationTurns).values({ id: turnId, personId: sageId, surface: "chat", conversationId: conversation.value.id, userText: "x", replyText: "y", source: "model", safetyAction: "allow", createdAt: new Date().toISOString(), hlc: nextHlc() }).run();
    const created = createAttachment(actor, { conversationId: conversation.value.id, turnId, mediaType: "image/png", bytes: new TextEncoder().encode(text), provenance, retention, deduplicate: false });
    if (!created.ok) throw new Error(created.error);
    return { ...created.value, turnId, conversationId: conversation.value.id };
  };
  return { sage, sageId, actor, luciaClient, luciaId, file };
}
const patch = (client: TestClient, id: string, body: unknown) => client.request(`/api/files/${id}`, { method: "PATCH", body });
const list = async (client: TestClient) => ((await (await client.get("/api/library")).json()) as { items: Array<{ id: string; name: string; retention: string }> }).items;

test("rename stores the owner's name, shows it in the Library and searches by it; clearing returns to the derived name", async () => {
  const s = await setup();
  const boat = s.file("boat", 'picture-gen:{"v":1,"audience":"all-ages","prompt":"a boat"}');
  expect((await list(s.sage))[0]!.name).toBe("a boat");
  const renamed = await patch(s.sage, boat.id, { name: "  Lake   day\n" });
  expect(renamed.status).toBe(200);
  expect(await renamed.json()).toEqual({ id: boat.id, name: "Lake day", retention: "conversation" });
  expect((await list(s.sage))[0]!.name).toBe("Lake day");
  const found = (await (await s.sage.get("/api/library?search=lake")).json()) as { items: unknown[] };
  expect(found.items).toHaveLength(1);
  expect((await patch(s.sage, boat.id, { name: null })).status).toBe(200);
  expect((await list(s.sage))[0]!.name).toBe("a boat");
  expect((await patch(s.sage, boat.id, { name: "x".repeat(256) })).status).toBe(400);
  expect((await patch(s.sage, boat.id, { name: "\n\t" })).status).toBe(200); // blank clears
  expect((await patch(s.sage, boat.id, {})).status).toBe(400);
});

test("only the owner changes a file, and a recipient or a stranger learns nothing more than they could see", async () => {
  const s = await setup();
  const boat = s.file("owned", 'picture-gen:{"v":1,"audience":"all-ages","prompt":"a boat"}', "kept");
  expect((await patch(s.luciaClient, boat.id, { name: "Mine now" })).status).toBe(404);
  createShare(s.actor, { fileId: boat.id, to: s.luciaId });
  const recipient = await patch(s.luciaClient, boat.id, { name: "Mine now" });
  expect(recipient.status).toBe(403);
  expect(db.select().from(attachments).where(eq(attachments.id, boat.id)).get()!.name).toBeNull();
});

test("Keep pins a generated item against the nightly job; un-keeping is only for generated items", async () => {
  const s = await setup();
  const boat = s.file("generated boat", 'picture-gen:{"v":1,"audience":"all-ages","prompt":"a boat"}');
  const upload = s.file("my upload", "composer:upload", "kept");
  expect((await patch(s.sage, boat.id, { keep: true })).status).toBe(200);
  expect((await list(s.sage)).find((i) => i.id === boat.id)!.retention).toBe("kept");
  expect(deleteAttachmentsForTurns([boat.turnId, upload.turnId])).toBe(0); // kept: both survive chat deletion
  expect((await patch(s.sage, boat.id, { keep: false })).status).toBe(200);
  expect(db.select().from(attachments).where(eq(attachments.id, boat.id)).get()!.retention).toBe("conversation");
  const refused = await patch(s.sage, upload.id, { keep: false });
  expect(refused.status).toBe(400);
  expect(((await refused.json()) as { error: string }).error).toBe("Files you added stay until you delete them.");
});

test("a file in Trash cannot be renamed", async () => {
  const s = await setup();
  const boat = s.file("trashed", 'picture-gen:{"v":1,"audience":"all-ages"}', "kept");
  await s.sage.request(`/api/files/${boat.id}`, { method: "DELETE" });
  expect((await patch(s.sage, boat.id, { name: "late" })).status).toBe(404);
});

test("a picture links to its chat for editing while the chat exists, only for its owner", async () => {
  const s = await setup();
  const boat = s.file("editable boat", 'picture-gen:{"v":1,"audience":"all-ages","prompt":"a boat"}', "kept");
  const note = s.file("a plain upload", "composer:upload", "kept");
  createShare(s.actor, { fileId: boat.id, to: s.luciaId });
  const mine = (await list(s.sage)) as unknown as Array<{ id: string; chat_id: string | null; can_edit: boolean }>;
  expect(mine.find((i) => i.id === boat.id)).toMatchObject({ chat_id: boat.conversationId, can_edit: true });
  expect(mine.find((i) => i.id === note.id)).toMatchObject({ can_edit: false });
  const theirs = (await list(s.luciaClient)) as unknown as Array<{ id: string; chat_id: string | null; can_edit: boolean }>;
  expect(theirs.find((i) => i.id === boat.id)).toMatchObject({ chat_id: null, can_edit: false });
  db.update(conversations).set({ status: "deleted" }).where(eq(conversations.id, boat.conversationId)).run();
  const after = (await list(s.sage)) as unknown as Array<{ id: string; chat_id: string | null; can_edit: boolean }>;
  expect(after.find((i) => i.id === boat.id)).toMatchObject({ chat_id: null, can_edit: false });
});
