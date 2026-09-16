import { describe, expect, test, beforeEach } from "bun:test";
import { existsSync } from "node:fs";
import { createHost } from "@/lib/packageHost";
import { Attachment, type Attachment as AttachmentRecord } from "@maipai/spec/gen/ts/attachment.js";
import { db } from "@/db";
import { attachments, conversationTurns, conversations, people } from "@/db/schema";
import { createAttachment, attachmentFilePath, deleteAttachmentsForPerson, getAttachment, readAttachment } from "@/lib/attachments";
import { newConversationTurnId, newPersonId } from "@/lib/id";
import { nextHlc } from "@/lib/hlc";
import { dataDir } from "@/lib/paths";
import { resolveOrCreateConversation, runRetention } from "@/lib/conversationHistory";
import { resetDb } from "./reset-db";
import { TestClient } from "./client";
import { PackageManifest } from "@maipai/spec/gen/ts/manifest.js";
import { eq } from "drizzle-orm";

beforeEach(() => resetDb());

async function owner() {
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  return db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
}

function turnFor(actor: typeof people.$inferSelect, conversationId: string, createdAt = new Date().toISOString()) {
  const id = newConversationTurnId();
  db.insert(conversationTurns)
    .values({
      id,
      personId: actor.id,
      surface: "chat",
      conversationId,
      userText: "attached note",
      replyText: "saved",
      source: "model",
      safetyAction: "allow",
      createdAt,
      hlc: nextHlc(),
    })
    .run();
  return id;
}

function manifest(): PackageManifest {
  return PackageManifest.parse({
    id: "test-attachments",
    version: "0.1.0",
    kind: "plugin",
    category: "Utilities",
    display: "Attachment test",
    description: "Attachment test package.",
    author: "test",
    license: "AGPL-3.0",
    platforms: ["home"],
    min_role: "child",
    consequential: false,
    offline: "full",
    min_app: "0.1.0",
    tier: 0,
    permissions: [],
  });
}

function conversationFor(actor: typeof people.$inferSelect) {
  const result = resolveOrCreateConversation(actor, "chat");
  if (!result.ok) throw new Error(result.error);
  return result.value.id;
}

describe("attachment storage", () => {
  test("writes a spec-valid record and verifies the bytes on read", async () => {
    const actor = await owner();
    const conversationId = conversationFor(actor);
    const turnId = turnFor(actor, conversationId);
    const bytes = new TextEncoder().encode("local attachment bytes");

    const created = createAttachment(actor, { conversationId, turnId, mediaType: "TEXT/PLAIN", bytes });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(Attachment.safeParse(created.value).success).toBe(true);
    expect(created.value.owner_person_id).toBe(actor.id);
    expect(created.value.conversation_id).toBe(conversationId);
    expect(created.value.turn_id).toBe(turnId);
    expect(created.value.size).toBe(bytes.byteLength);
    expect(created.value.sha256).toBe("ad4f8b9a71fafb89ec7255e9af4dcc351c858433b39155411b520bd0b55e4800");
    expect(existsSync(attachmentFilePath(created.value.storage_path))).toBe(true);

    const read = readAttachment(actor, created.value.id);
    expect(read.ok).toBe(true);
    if (read.ok) expect(read.value.bytes).toEqual(bytes);
    expect(getAttachment(actor, created.value.id).ok).toBe(true);
    expect(getAttachment({ ...actor, id: newPersonId() }, created.value.id).ok).toBe(false);
  });

  test("refuses absolute and traversal paths before resolving them", () => {
    for (const path of ["/tmp/outside", "../outside", "people/person-safe/attachments/../../outside", "people//person-safe"]) {
      expect(() => attachmentFilePath(path)).toThrow("invalid attachment storage path");
    }
    expect(attachmentFilePath("people/person-safe/attachments/att-safe123")).toBe(
      `${dataDir}/people/person-safe/attachments/att-safe123`,
    );
  });

  test("binds an upload to the signed-in person's conversation turn", async () => {
    const actor = await owner();
    const other = db
      .insert(people)
      .values({
        id: newPersonId(),
        displayName: "Poppy",
        role: "child",
        avatarSeed: "poppy",
        source: "hub",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        hlc: nextHlc(),
      })
      .returning()
      .get()!;
    const otherConversationId = conversationFor(other);
    const otherTurnId = turnFor(other, otherConversationId);

    const result = createAttachment(actor, {
      conversationId: otherConversationId,
      turnId: otherTurnId,
      mediaType: "text/plain",
      bytes: new TextEncoder().encode("not yours"),
    });
    expect(result).toEqual({ ok: false, status: 404, error: "conversation turn not found" });
    expect(db.select().from(attachments).all()).toHaveLength(0);
  });
});

describe("attachment retention and erasure", () => {
  test("conversation retention removes the row and bytes with the turn", async () => {
    const actor = await owner();
    const conversationId = conversationFor(actor);
    const stale = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString();
    const turnId = turnFor(actor, conversationId, stale);
    const created = createAttachment(actor, {
      conversationId,
      turnId,
      mediaType: "text/plain",
      bytes: new TextEncoder().encode("old note"),
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const filePath = attachmentFilePath(created.value.storage_path);

    expect(runRetention().deleted).toBe(1);
    expect(existsSync(filePath)).toBe(false);
    expect(db.select().from(attachments).where(eq(attachments.id, created.value.id)).all()).toHaveLength(0);
    expect(db.select().from(conversationTurns).where(eq(conversationTurns.id, turnId)).all()).toHaveLength(0);
  });

  test("host.data.forget removes only the target person's attachment files", async () => {
    const actor = await owner();
    const other = db
      .insert(people)
      .values({
        id: newPersonId(),
        displayName: "Poppy",
        role: "child",
        avatarSeed: "poppy",
        source: "hub",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        hlc: nextHlc(),
      })
      .returning()
      .get()!;
    const ownConversationId = conversationFor(actor);
    const ownTurnId = turnFor(actor, ownConversationId);
    const otherConversationId = conversationFor(other);
    const otherTurnId = turnFor(other, otherConversationId);
    const own = createAttachment(actor, { conversationId: ownConversationId, turnId: ownTurnId, mediaType: "text/plain", bytes: new TextEncoder().encode("keep") });
    const foreign = createAttachment(other, { conversationId: otherConversationId, turnId: otherTurnId, mediaType: "text/plain", bytes: new TextEncoder().encode("erase") });
    expect(own.ok).toBe(true);
    expect(foreign.ok).toBe(true);
    if (!own.ok || !foreign.ok) return;
    const ownPath = attachmentFilePath(own.value.storage_path);
    const foreignPath = attachmentFilePath(foreign.value.storage_path);

    const host = createHost(actor, manifest());
    expect(host.data.forget(other.id)).toBe(0);
    expect(existsSync(foreignPath)).toBe(false);
    expect(existsSync(ownPath)).toBe(true);
    expect(deleteAttachmentsForPerson(other.id)).toBe(0);
    expect(db.select().from(attachments).where(eq(attachments.ownerPersonId, other.id)).all()).toHaveLength(0);
    expect(db.select().from(attachments).where(eq(attachments.ownerPersonId, actor.id)).all()).toHaveLength(1);
  });
});
