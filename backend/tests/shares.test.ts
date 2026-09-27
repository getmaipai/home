import { describe, expect, test, beforeEach } from "bun:test";
import { db } from "@/db";
import { attachments, people } from "@/db/schema";
import { createAttachment, getAttachment } from "@/lib/attachments";
import { createShare, deleteShare, listFilesVisibleToActor } from "@/lib/shares";
import { newConversationTurnId, newPersonId } from "@/lib/id";
import { nextHlc } from "@/lib/hlc";
import { resolveOrCreateConversation } from "@/lib/conversationHistory";
import { conversationTurns } from "@/db/schema";
import { resetDb } from "./reset-db";
import { TestClient } from "./client";
import { eq } from "drizzle-orm";

beforeEach(() => resetDb());

async function owner() {
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  return db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
}

function person(role: "owner" | "admin" | "adult" | "teen" | "child" | "guest", displayName: string) {
  return db
    .insert(people)
    .values({
      id: newPersonId(),
      displayName,
      role,
      avatarSeed: displayName.toLowerCase(),
      source: "hub",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      hlc: nextHlc(),
    })
    .returning()
    .get()!;
}

function turnFor(actor: typeof people.$inferSelect, conversationId: string) {
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
      createdAt: new Date().toISOString(),
      hlc: nextHlc(),
    })
    .run();
  return id;
}

function conversationFor(actor: typeof people.$inferSelect) {
  const result = resolveOrCreateConversation(actor, "chat");
  if (!result.ok) throw new Error(result.error);
  return result.value.id;
}

function uploadFile(actor: typeof people.$inferSelect, text = "picture bytes") {
  const conversationId = conversationFor(actor);
  const turnId = turnFor(actor, conversationId);
  const created = createAttachment(actor, { conversationId, turnId, mediaType: "image/png", bytes: new TextEncoder().encode(text) });
  if (!created.ok) throw new Error(created.error);
  return created.value;
}

describe("share visibility", () => {
  test("a shared file is listed for the recipient and not for a third person", async () => {
    const ownerPerson = await owner();
    const lucia = person("adult", "Lucia");
    const marlow = person("adult", "Marlow");
    const file = uploadFile(ownerPerson);

    const shared = createShare(ownerPerson, { fileId: file.id, to: lucia.id });
    expect(shared.ok).toBe(true);

    const luciaLibrary = listFilesVisibleToActor(lucia);
    const luciaEntry = luciaLibrary.find((row) => row.file.id === file.id);
    expect(luciaEntry).toBeDefined();
    expect(luciaEntry?.ownerPersonId).toBe(ownerPerson.id);
    expect(luciaEntry?.shared).toBe(true);

    expect(listFilesVisibleToActor(marlow).some((row) => row.file.id === file.id)).toBe(false);
    expect(getAttachment(lucia, file.id).ok).toBe(true);
    expect(getAttachment(marlow, file.id).ok).toBe(false);
  });

  test("a household-wide share is visible to every other active person", async () => {
    const ownerPerson = await owner();
    const bramble = person("child", "Bramble");
    const marlow = person("adult", "Marlow");
    const file = uploadFile(ownerPerson);

    expect(createShare(ownerPerson, { fileId: file.id, to: "household" }).ok).toBe(true);

    expect(listFilesVisibleToActor(bramble).some((row) => row.file.id === file.id)).toBe(true);
    expect(listFilesVisibleToActor(marlow).some((row) => row.file.id === file.id)).toBe(true);
  });

  test("unsharing removes it at once", async () => {
    const ownerPerson = await owner();
    const lucia = person("adult", "Lucia");
    const file = uploadFile(ownerPerson);
    const shared = createShare(ownerPerson, { fileId: file.id, to: lucia.id });
    expect(shared.ok).toBe(true);
    if (!shared.ok) return;

    expect(listFilesVisibleToActor(lucia).some((row) => row.file.id === file.id)).toBe(true);
    const removed = deleteShare(ownerPerson, shared.value.id);
    expect(removed.ok).toBe(true);
    expect(listFilesVisibleToActor(lucia).some((row) => row.file.id === file.id)).toBe(false);
    expect(getAttachment(lucia, file.id).ok).toBe(false);
  });
});

describe("sharing bounds (household-storage-2026-09-23.md decisions 2 and 6)", () => {
  test("a child may share their own file with the household and with another person", () => {
    const bramble = person("child", "Bramble");
    const lucia = person("adult", "Lucia");
    const file = uploadFile(bramble);

    expect(createShare(bramble, { fileId: file.id, to: "household" }).ok).toBe(true);
    expect(createShare(bramble, { fileId: file.id, to: lucia.id }).ok).toBe(true);
  });

  test("sharing with a person the household does not have is refused - the household bound", () => {
    const bramble = person("child", "Bramble");
    const file = uploadFile(bramble);

    expect(createShare(bramble, { fileId: file.id, to: newPersonId() })).toEqual({
      ok: false,
      status: 400,
      error: "the household does not have that person",
    });
  });

  test("an adult may re-share anything shared with them, within the household", async () => {
    const ownerPerson = await owner();
    const lucia = person("adult", "Lucia");
    const marlow = person("adult", "Marlow");
    const file = uploadFile(ownerPerson);

    const shared = createShare(ownerPerson, { fileId: file.id, to: lucia.id });
    expect(shared.ok).toBe(true);

    const reshared = createShare(lucia, { fileId: file.id, to: marlow.id });
    expect(reshared.ok).toBe(true);
    if (reshared.ok) expect(reshared.value.from_person_id).toBe(lucia.id);
    expect(listFilesVisibleToActor(marlow).some((row) => row.file.id === file.id)).toBe(true);
  });

  test("a child re-shares only within the household - a real household target succeeds", async () => {
    const ownerPerson = await owner();
    const bramble = person("child", "Bramble");
    const cosmo = person("child", "Cosmo");
    const file = uploadFile(ownerPerson);

    expect(createShare(ownerPerson, { fileId: file.id, to: bramble.id }).ok).toBe(true);
    const reshared = createShare(bramble, { fileId: file.id, to: cosmo.id });
    expect(reshared.ok).toBe(true);
    expect(listFilesVisibleToActor(cosmo).some((row) => row.file.id === file.id)).toBe(true);
  });

  test("someone with no access to a file cannot share it", async () => {
    const ownerPerson = await owner();
    const marlow = person("adult", "Marlow");
    const file = uploadFile(ownerPerson);

    expect(createShare(marlow, { fileId: file.id, to: "household" })).toEqual({
      ok: false,
      status: 403,
      error: "you do not have access to this file",
    });
  });
});

describe("re-share cascade on unshare", () => {
  test("deleting a household share prunes a re-share that depended solely on it", async () => {
    const ownerPerson = await owner();
    const lucia = person("adult", "Lucia");
    const marlow = person("adult", "Marlow");
    const file = uploadFile(ownerPerson);

    const householdShare = createShare(ownerPerson, { fileId: file.id, to: "household" });
    expect(householdShare.ok).toBe(true);
    if (!householdShare.ok) return;
    expect(createShare(lucia, { fileId: file.id, to: marlow.id }).ok).toBe(true);

    const removed = deleteShare(ownerPerson, householdShare.value.id);
    expect(removed.ok).toBe(true);
    if (removed.ok) expect(removed.value.deletedShareIds).toHaveLength(2);
    expect(listFilesVisibleToActor(marlow).some((row) => row.file.id === file.id)).toBe(false);
  });

  test("revoking a direct share prunes a household-wide share its recipient made from it (no self-justifying cycle)", async () => {
    // Regression for a code-review finding (2026-09-27): a first cut of
    // pruneUnreachableShares folded every row's `to` into "reachable"
    // unconditionally, including a household-wide row's own creator -
    // so lucia's own household share counted HER as reachable simply
    // because her own row named "household," and it survived her
    // direct access being revoked forever.
    const ownerPerson = await owner();
    const lucia = person("adult", "Lucia");
    const marlow = person("adult", "Marlow");
    const file = uploadFile(ownerPerson);

    const direct = createShare(ownerPerson, { fileId: file.id, to: lucia.id });
    expect(direct.ok).toBe(true);
    if (!direct.ok) return;
    expect(createShare(lucia, { fileId: file.id, to: "household" }).ok).toBe(true);
    expect(listFilesVisibleToActor(marlow).some((row) => row.file.id === file.id)).toBe(true);

    const removed = deleteShare(ownerPerson, direct.value.id);
    expect(removed.ok).toBe(true);
    if (removed.ok) expect(removed.value.deletedShareIds).toHaveLength(2);
    expect(listFilesVisibleToActor(lucia).some((row) => row.file.id === file.id)).toBe(false);
    expect(listFilesVisibleToActor(marlow).some((row) => row.file.id === file.id)).toBe(false);
  });

  test("a re-share survives when the re-sharer still has their own direct share", async () => {
    const ownerPerson = await owner();
    const lucia = person("adult", "Lucia");
    const marlow = person("adult", "Marlow");
    const file = uploadFile(ownerPerson);

    const householdShare = createShare(ownerPerson, { fileId: file.id, to: "household" });
    expect(createShare(ownerPerson, { fileId: file.id, to: lucia.id }).ok).toBe(true);
    expect(createShare(lucia, { fileId: file.id, to: marlow.id }).ok).toBe(true);
    expect(householdShare.ok).toBe(true);
    if (!householdShare.ok) return;

    const removed = deleteShare(ownerPerson, householdShare.value.id);
    expect(removed.ok).toBe(true);
    if (removed.ok) expect(removed.value.deletedShareIds).toEqual([householdShare.value.id]);
    expect(listFilesVisibleToActor(marlow).some((row) => row.file.id === file.id)).toBe(true);
  });
});

describe("dedupe - no duplicates at any level (STORE-SPEC-01)", () => {
  test("a second person's identical bytes become a share pointer to the first person's file", async () => {
    const ownerPerson = await owner();
    const lucia = person("adult", "Lucia");
    const bytes = "identical photo bytes";
    const first = uploadFile(ownerPerson, bytes);

    const conversationId = conversationFor(lucia);
    const turnId = turnFor(lucia, conversationId);
    const second = createAttachment(lucia, { conversationId, turnId, mediaType: "image/png", bytes: new TextEncoder().encode(bytes) });
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    expect(second.value.id).toBe(first.id);
    expect(second.value.owner_person_id).toBe(ownerPerson.id);
    expect(db.select().from(attachments).all()).toHaveLength(1);
    expect(getAttachment(lucia, first.id).ok).toBe(true);
    expect(listFilesVisibleToActor(lucia).some((row) => row.file.id === first.id)).toBe(true);
  });

  test("the same person re-uploading identical bytes doesn't create a duplicate row", async () => {
    const ownerPerson = await owner();
    const bytes = "same person, same bytes";
    const first = uploadFile(ownerPerson, bytes);
    const second = uploadFile(ownerPerson, bytes);

    expect(second.id).toBe(first.id);
    expect(db.select().from(attachments).all()).toHaveLength(1);
  });
});
