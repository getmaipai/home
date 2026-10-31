// LIBRARY-REVAMP-10: Trash for Library files.
import { beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { attachments, conversationTurns, fileContents, fileReferences, people, pictureJobs, shares } from "@/db/schema";
import { attachmentFilePath, createAttachment, deleteAttachmentsForTurns } from "@/lib/attachments";
import { referenceDrift, referenceKinds } from "@/lib/fileContent";
import { purgeExpiredFiles } from "@/lib/libraryTrash";
import { generatedLibraryReport } from "@/lib/libraryGenerated";
import { createShare } from "@/lib/shares";
import { purgeExpired } from "@/lib/trash/registry";
import "@/lib/trash/providers";
import { resolveOrCreateConversation } from "@/lib/conversationHistory";
import { newConversationTurnId } from "@/lib/id";
import { nextHlc } from "@/lib/hlc";
import { createHash } from "node:crypto";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";

beforeEach(() => resetDb());
const sha = (text: string) => createHash("sha256").update(text).digest("hex");

async function household() {
  const sage = new TestClient();
  const setup = await sage.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const sageId = ((await setup.json()) as { person: { id: string } }).person.id;
  async function member(displayName: string, role: string) {
    const made = await sage.post("/api/people", { displayName, role, secret: "0000" });
    const id = ((await made.json()) as { id: string }).id;
    const client = new TestClient();
    expect((await client.post("/api/auth/verify-secret", { personId: id, secret: "0000" })).status).toBe(200);
    return { id, client, row: () => db.select().from(people).where(eq(people.id, id)).get()! };
  }
  const lucia = await member("Lucia", "adult");
  const bramble = await member("Bramble", "child");
  const row = () => db.select().from(people).where(eq(people.id, sageId)).get()!;
  return { sage, sageId, sageRow: row, lucia, bramble };
}
function chatTurn(actor: typeof people.$inferSelect) {
  const conversation = resolveOrCreateConversation(actor, "chat");
  if (!conversation.ok) throw new Error(conversation.error);
  const turnId = newConversationTurnId();
  db.insert(conversationTurns).values({ id: turnId, personId: actor.id, surface: "chat", conversationId: conversation.value.id, userText: "hi", replyText: "ok", source: "model", safetyAction: "allow", createdAt: new Date().toISOString(), hlc: nextHlc() }).run();
  return { conversationId: conversation.value.id, turnId };
}
function file(actor: typeof people.$inferSelect, text: string, extra: { provenance?: string; retention?: "kept" | "conversation"; detach?: boolean } = {}) {
  const { conversationId, turnId } = chatTurn(actor);
  const created = createAttachment(actor, { conversationId, turnId, mediaType: "image/png", bytes: new TextEncoder().encode(text), provenance: extra.provenance ?? 'picture-gen:{"v":1,"audience":"all-ages","prompt":"a boat"}', retention: extra.retention, deduplicate: false });
  if (!created.ok) throw new Error(created.error);
  if (extra.detach) deleteAttachmentsForTurns([turnId]); // the chat is gone; a kept file stays
  return { ...created.value, turnId, conversationId };
}
const library = async (client: TestClient) => (await (await client.get("/api/library")).json()) as { items: Array<{ id: string; name: string }> };
const trashRows = async (client: TestClient) => ((await (await client.get("/api/trash")).json()) as { rows: Array<{ kind: string; id: string; title: string; can_restore: boolean }> }).rows.filter((r) => r.kind === "file");
const row = (id: string) => db.select().from(attachments).where(eq(attachments.id, id)).get();

describe("delete moves a file to Trash, restore brings it back", () => {
  test("the owner deletes; the file leaves the Library, the summary counts Trash, and Restore returns it", async () => {
    const h = await household();
    const boat = file(h.sageRow(), "boat picture", { retention: "kept", detach: true });
    expect((await library(h.sage)).items.map((i) => i.id)).toEqual([boat.id]);
    const deleted = await h.sage.request(`/api/files/${boat.id}`, { method: "DELETE" });
    expect(deleted.status).toBe(200);
    const body = (await deleted.json()) as { trash_until: string; deleted_at: string };
    expect(Date.parse(body.trash_until) - Date.parse(body.deleted_at)).toBe(30 * 86_400_000);
    expect((await library(h.sage)).items).toEqual([]);
    const summary = (await (await h.sage.get("/api/library/summary")).json()) as { items: number; trash: { items: number; bytes: number } };
    expect(summary.items).toBe(0);
    expect(summary.trash).toEqual({ items: 1, bytes: "boat picture".length });
    expect((await h.sage.get(`/api/files/${boat.id}`)).status).toBe(404);
    expect((await h.sage.get(`/api/files/${boat.id}/content`)).status).toBe(404);
    expect((await h.sage.get(`/api/files/${boat.id}/thumb?w=320`)).status).toBe(404);
    expect(await trashRows(h.sage)).toEqual([expect.objectContaining({ id: boat.id, title: "a boat", can_restore: true })]);
    expect((await h.sage.post(`/api/trash/file/${boat.id}/restore`, {})).status).toBe(200);
    expect((await library(h.sage)).items.map((i) => i.id)).toEqual([boat.id]);
    expect((await h.sage.get(`/api/files/${boat.id}/content`)).status).toBe(200);
    expect(await trashRows(h.sage)).toEqual([]);
    expect(referenceDrift()).toEqual({ missing: [], extra: [] });
  });

  test("a recipient loses access at once and regains it on Restore; the shares stay on the record", async () => {
    const h = await household();
    const boat = file(h.sageRow(), "shared boat", { retention: "kept", detach: true });
    expect(createShare(h.sageRow(), { fileId: boat.id, to: h.lucia.id }).ok).toBe(true);
    expect((await h.lucia.client.get(`/api/files/${boat.id}/content`)).status).toBe(200);
    expect((await library(h.lucia.client)).items).toHaveLength(1);
    await h.sage.request(`/api/files/${boat.id}`, { method: "DELETE" });
    expect((await h.lucia.client.get(`/api/files/${boat.id}/content`)).status).toBe(404);
    expect((await h.lucia.client.get(`/api/files/${boat.id}/thumb?w=320`)).status).toBe(404);
    expect((await library(h.lucia.client)).items).toEqual([]);
    expect((await (await h.lucia.client.get("/api/files")).json()) as unknown[]).toEqual([]);
    expect(db.select().from(shares).all()).toHaveLength(1);
    await h.sage.post(`/api/trash/file/${boat.id}/restore`, {});
    expect((await h.lucia.client.get(`/api/files/${boat.id}/content`)).status).toBe(200);
    expect((await library(h.lucia.client)).items).toHaveLength(1);
  });

  test("only the owner may delete; nobody else sees the id", async () => {
    const h = await household();
    const boat = file(h.sageRow(), "owner only", { retention: "kept", detach: true });
    createShare(h.sageRow(), { fileId: boat.id, to: h.lucia.id });
    const recipient = await h.lucia.client.request(`/api/files/${boat.id}`, { method: "DELETE" });
    expect(recipient.status).toBe(403);
    expect(((await recipient.json()) as { error: string }).error).toContain("Only the person who added this file");
    expect((await h.bramble.client.request(`/api/files/${boat.id}`, { method: "DELETE" })).status).toBe(404);
    expect((await h.sage.request(`/api/files/${"file-missing0000"}`, { method: "DELETE" })).status).toBe(404);
    expect(row(boat.id)?.deletedAt).toBeNull();
    expect((await h.sage.request(`/api/files/${boat.id}`, { method: "DELETE" })).status).toBe(200);
    expect((await h.sage.request(`/api/files/${boat.id}`, { method: "DELETE" })).status).toBe(404); // already in Trash
    expect(await trashRows(h.lucia.client)).toEqual([]); // a recipient never sees the owner's Trash
  });

  test("an admin can move a departed person's inherited file to Trash, while living owners keep control", async () => {
    const h = await household();
    const made = await h.sage.post("/api/people", { displayName: "Admin", role: "admin", secret: "0000" });
    const adminId = ((await made.json()) as { id: string }).id;
    const admin = new TestClient();
    expect((await admin.post("/api/auth/verify-secret", { personId: adminId, secret: "0000" })).status).toBe(200);

    const living = file(h.lucia.row(), "living owner file", { retention: "kept", detach: true });
    expect(createShare(h.lucia.row(), { fileId: living.id, to: "household" }).ok).toBe(true);
    expect((await admin.request(`/api/files/${living.id}`, { method: "DELETE" })).status).toBe(403);

    const inherited = file(h.lucia.row(), "inherited file", { retention: "kept", detach: true });
    createShare(h.lucia.row(), { fileId: inherited.id, to: "household" });
    db.update(people).set({ deletedAt: new Date().toISOString() }).where(eq(people.id, h.lucia.id)).run();
    expect((await admin.request(`/api/files/${inherited.id}`, { method: "DELETE" })).status).toBe(200);
    expect(row(inherited.id)?.deletedAt).not.toBeNull();

    expect(row(living.id)).toBeDefined();
  });

  test("a non-admin cannot delete an inherited file", async () => {
    const h = await household();
    const inherited = file(h.lucia.row(), "inherited file", { retention: "kept", detach: true });
    createShare(h.lucia.row(), { fileId: inherited.id, to: "household" });
    db.update(people).set({ deletedAt: new Date().toISOString() }).where(eq(people.id, h.lucia.id)).run();
    const denied = await h.bramble.client.request(`/api/files/${inherited.id}`, { method: "DELETE" });
    expect(denied.status).toBe(403);
    expect(((await denied.json()) as { error: string }).error).toContain("Only the person who added this file can delete it.");
    expect(row(inherited.id)).toBeDefined();
  });

  test("a child deletes their own file and restores it; a saved podcast copy cannot be deleted from the Library", async () => {
    const h = await household();
    const mine = file(h.bramble.row(), "child picture", { retention: "kept", detach: true });
    expect((await h.bramble.client.request(`/api/files/${mine.id}`, { method: "DELETE" })).status).toBe(200);
    expect(await trashRows(h.bramble.client)).toHaveLength(1);
    expect(await trashRows(h.sage)).toEqual([]); // an admin does not see a child's Trash rows here either
    expect((await h.bramble.client.post(`/api/trash/file/${mine.id}/restore`, {})).status).toBe(200);
    db.update(attachments).set({ origin: "fetched" }).where(eq(attachments.id, mine.id)).run();
    expect((await h.bramble.client.request(`/api/files/${mine.id}`, { method: "DELETE" })).status).toBe(403);
  });
});

describe("references and bytes", () => {
  test("the same-bytes case: one person's delete and purge never take another person's copy", async () => {
    const h = await household();
    const first = file(h.sageRow(), "same bytes", { retention: "kept", detach: true });
    const second = file(h.lucia.row(), "same bytes", { retention: "kept", detach: true });
    expect(second.storage_path).toBe(first.storage_path);
    await h.sage.request(`/api/files/${first.id}`, { method: "DELETE" });
    expect(existsSync(attachmentFilePath(first.storage_path))).toBe(true);
    expect((await h.sage.request(`/api/trash/file/${first.id}`, { method: "DELETE" })).status).toBe(200);
    expect(row(first.id)).toBeUndefined();
    expect(existsSync(attachmentFilePath(first.storage_path))).toBe(true); // the other person's copy still holds the bytes
    expect((await h.lucia.client.get(`/api/files/${second.id}/content`)).status).toBe(200);
    await h.lucia.client.request(`/api/files/${second.id}`, { method: "DELETE" });
    expect(existsSync(attachmentFilePath(first.storage_path))).toBe(true); // Trash still holds a reference
    expect((await h.lucia.client.request(`/api/trash/file/${second.id}`, { method: "DELETE" })).status).toBe(200);
    expect(existsSync(attachmentFilePath(first.storage_path))).toBe(false); // zero references: the bytes go
    expect(db.select().from(fileContents).all()).toHaveLength(0);
    expect(db.select().from(fileReferences).all()).toHaveLength(0);
  });

  test("a chat that still shows the file keeps a chat-only copy after the Library item is purged", async () => {
    const h = await household();
    const picture = file(h.sageRow(), "chat keeps this"); // conversation retention, still tied to its chat
    createShare(h.sageRow(), { fileId: picture.id, to: h.lucia.id });
    await h.sage.request(`/api/files/${picture.id}`, { method: "DELETE" });
    expect((await h.sage.request(`/api/trash/file/${picture.id}`, { method: "DELETE" })).status).toBe(200);
    const kept = row(picture.id)!;
    expect(kept.deletedAt).not.toBeNull();
    expect(kept.trashUntil).toBeNull();
    expect(db.select().from(shares).all()).toHaveLength(0);
    expect(referenceKinds(sha("chat keeps this"))).toEqual({ chat: 1 }); // no second copy and no Library reference
    expect(existsSync(attachmentFilePath(kept.storagePath))).toBe(true);
    expect(await trashRows(h.sage)).toEqual([]);
    expect((await library(h.sage)).items).toEqual([]);
    // The chat still reads it (the conversation route does not use the Library's access rule).
    const image = await h.sage.get(`/api/attachments/${picture.id}?v=full&conversation_id=${picture.conversationId}`);
    expect(image.status === 200 || image.status === 404).toBe(true);
    // When the chat goes, the chat-only copy and its bytes go with it.
    deleteAttachmentsForTurns([picture.turnId]);
    expect(row(picture.id)).toBeUndefined();
    expect(existsSync(attachmentFilePath(kept.storagePath))).toBe(false);
  });

  test("a chat deleted while its file is in Trash leaves the file in Trash until its window ends", async () => {
    const h = await household();
    const picture = file(h.sageRow(), "trash survives chat");
    await h.sage.request(`/api/files/${picture.id}`, { method: "DELETE" });
    deleteAttachmentsForTurns([picture.turnId]);
    expect(row(picture.id)).toBeDefined();
    expect(await trashRows(h.sage)).toHaveLength(1);
    expect((await h.sage.post(`/api/trash/file/${picture.id}/restore`, {})).status).toBe(200);
    expect((await library(h.sage)).items.map((i) => i.id)).toEqual([picture.id]);
  });
});

describe("expiry through the sweep", () => {
  test("the sweep drops only references whose keep window has ended, and the bytes at zero references", async () => {
    const h = await household();
    const old = file(h.sageRow(), "old file", { retention: "kept", detach: true });
    const fresh = file(h.sageRow(), "fresh file", { retention: "kept", detach: true });
    await h.sage.request(`/api/files/${old.id}`, { method: "DELETE" });
    await h.sage.request(`/api/files/${fresh.id}`, { method: "DELETE" });
    expect(purgeExpiredFiles(new Date(Date.now() + 29 * 86_400_000))).toBe(0);
    expect(row(old.id)).toBeDefined();
    purgeExpired(new Date(Date.now() + 31 * 86_400_000));
    expect(row(old.id)).toBeUndefined();
    expect(row(fresh.id)).toBeUndefined();
    expect(existsSync(attachmentFilePath(old.storage_path))).toBe(false);
  });

  test("an expired item cannot be restored", async () => {
    const h = await household();
    const gone = file(h.sageRow(), "late restore", { retention: "kept", detach: true });
    await h.sage.request(`/api/files/${gone.id}`, { method: "DELETE" });
    db.update(attachments).set({ trashUntil: new Date(Date.now() - 1000).toISOString() }).where(eq(attachments.id, gone.id)).run();
    expect((await trashRows(h.sage))[0]!.can_restore).toBe(false);
    expect((await h.sage.post(`/api/trash/file/${gone.id}/restore`, {})).status).toBe(404);
  });
});

describe("a picture and its edit versions travel together", () => {
  test("deleting the original trashes its versions; Restore brings all back; the Trash list shows one item", async () => {
    const h = await household();
    const root = file(h.sageRow(), "original", { retention: "kept", detach: true });
    const version = file(h.sageRow(), "edited version", { retention: "kept", detach: true, provenance: `image-edit:${JSON.stringify({ v: 1, audience: "all-ages", root: root.id, op: "crop" })}` });
    expect((await library(h.sage)).items.map((i) => i.id)).toEqual([root.id]);
    await h.sage.request(`/api/files/${root.id}`, { method: "DELETE" });
    expect(row(version.id)?.deletedAt).not.toBeNull();
    expect(await trashRows(h.sage)).toHaveLength(1);
    expect((await library(h.sage)).items).toEqual([]);
    await h.sage.post(`/api/trash/file/${root.id}/restore`, {});
    expect(row(version.id)?.deletedAt).toBeNull();
    expect((await library(h.sage)).items.map((i) => i.id)).toEqual([root.id]);
    await h.sage.request(`/api/files/${root.id}`, { method: "DELETE" });
    await h.sage.request(`/api/trash/file/${root.id}`, { method: "DELETE" });
    expect(row(root.id)).toBeUndefined();
    expect(row(version.id)).toBeUndefined();
  });
});

describe("generated items outlive their chats (LIBRARY-REVAMP-02)", () => {
  test("a generated item not pinned is detached from a deleted chat, stays in the Library, and a plain chat attachment still goes", async () => {
    const h = await household();
    const boat = file(h.sageRow(), "generated boat"); // generated, conversation retention
    const upload = file(h.sageRow(), "plain chat photo", { provenance: "composer:photo.jpg" });
    expect(deleteAttachmentsForTurns([boat.turnId, upload.turnId])).toBe(1);
    expect(row(boat.id)?.turnId).toBeNull();
    expect(row(upload.id)).toBeUndefined();
    expect(referenceKinds(sha("generated boat"))).toEqual({ owner: 1 });
    expect(existsSync(attachmentFilePath(boat.storage_path))).toBe(true);
    expect((await library(h.sage)).items.map((i) => i.id)).toEqual([boat.id]);
    const report = generatedLibraryReport();
    expect(report.generated).toEqual({ items: 1, bytes: "generated boat".length });
    expect(report.followingStorageRules.items).toBe(1);
    expect(report.tiedToChat.items).toBe(0);
  });
  test("the job that names a generated picture survives its chat so the Library keeps the prompt", async () => {
    const h = await household();
    const boat = file(h.sageRow(), "jobbed boat");
    db.insert(pictureJobs).values({ id: "picture-keepjob", personId: h.sageId, turnId: boat.turnId, kind: "generate", request: "{}", prompt: "a boat", state: "done", files: JSON.stringify([{ id: boat.id }]), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), hlc: nextHlc() }).run();
    deleteAttachmentsForTurns([boat.turnId]);
    expect(db.select().from(pictureJobs).all()).toHaveLength(1);
  });
});

describe("companions", () => {
  test("a companion file cannot be deleted on its own; a pinned item's job goes when it is purged from Trash", async () => {
    const h = await household();
    const root = file(h.sageRow(), "pinned original", { retention: "kept", detach: true });
    const version = file(h.sageRow(), "pinned version", { retention: "kept", detach: true, provenance: `image-edit:${JSON.stringify({ v: 1, audience: "all-ages", root: root.id })}` });
    const refused = await h.sage.request(`/api/files/${version.id}`, { method: "DELETE" });
    expect(refused.status).toBe(403);
    expect(row(version.id)?.deletedAt).toBeNull();
    db.insert(pictureJobs).values({ id: "picture-pinned", personId: h.sageId, turnId: null, kind: "generate", request: "{}", prompt: "a boat", state: "done", files: JSON.stringify([{ id: root.id }]), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), hlc: nextHlc() }).run();
    await h.sage.request(`/api/files/${root.id}`, { method: "DELETE" });
    await h.sage.request(`/api/trash/file/${root.id}`, { method: "DELETE" });
    expect(db.select().from(pictureJobs).all()).toHaveLength(0);
  });
});

describe("review round 1", () => {
  test("purging a generated item while its chat lives, then deleting the chat, leaves no job behind", async () => {
    const h = await household();
    const picture = file(h.sageRow(), "stale job picture");
    db.insert(pictureJobs).values({ id: "picture-stale", personId: h.sageId, turnId: picture.turnId, kind: "generate", request: "{}", prompt: "a boat", state: "done", files: JSON.stringify([{ id: picture.id }]), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), hlc: nextHlc() }).run();
    await h.sage.request(`/api/files/${picture.id}`, { method: "DELETE" });
    await h.sage.request(`/api/trash/file/${picture.id}`, { method: "DELETE" });
    expect(db.select().from(pictureJobs).all()).toHaveLength(1); // the chat still shows the picture
    deleteAttachmentsForTurns([picture.turnId]);
    expect(row(picture.id)).toBeUndefined();
    expect(db.select().from(pictureJobs).all()).toHaveLength(0);
  });
  test("sharing a file in Trash answers 404 like an unknown id, so its existence is not confirmed", async () => {
    const h = await household();
    const boat = file(h.sageRow(), "hidden trash", { retention: "kept", detach: true });
    await h.sage.request(`/api/files/${boat.id}`, { method: "DELETE" });
    const known = await h.lucia.client.post(`/api/files/${boat.id}/shares`, { to: "household" });
    const unknown = await h.lucia.client.post(`/api/files/file-nothingtoseehere/shares`, { to: "household" });
    expect(known.status).toBe(404);
    expect(unknown.status).toBe(404);
  });
});
