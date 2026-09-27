import { describe, expect, test, beforeEach } from "bun:test";
import { db } from "@/db";
import { people } from "@/db/schema";
import { canAccessFile, fileDisclosure } from "@/lib/access";
import { createShare } from "@/lib/shares";
import { createAttachment } from "@/lib/attachments";
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

function uploadFile(actor: typeof people.$inferSelect) {
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
  return created.value;
}

describe("canAccessFile", () => {
  test("the owner always has access", async () => {
    const ownerPerson = await owner();
    const file = uploadFile(ownerPerson);
    expect(canAccessFile(ownerPerson, file.owner_person_id, file.id)).toBe(true);
  });

  test("a third person with no share has no access", async () => {
    const ownerPerson = await owner();
    const marlow = person("adult", "Marlow");
    const file = uploadFile(ownerPerson);
    expect(canAccessFile(marlow, file.owner_person_id, file.id)).toBe(false);
  });

  test("a named recipient has access; a household share opens it to everyone", async () => {
    const ownerPerson = await owner();
    const lucia = person("adult", "Lucia");
    const marlow = person("adult", "Marlow");
    const file = uploadFile(ownerPerson);

    createShare(ownerPerson, { fileId: file.id, to: lucia.id });
    expect(canAccessFile(lucia, file.owner_person_id, file.id)).toBe(true);
    expect(canAccessFile(marlow, file.owner_person_id, file.id)).toBe(false);

    createShare(ownerPerson, { fileId: file.id, to: "household" });
    expect(canAccessFile(marlow, file.owner_person_id, file.id)).toBe(true);
  });
});

describe("fileDisclosure", () => {
  test("a minor's own file defaults to child_ok", () => {
    const bramble = person("child", "Bramble");
    expect(fileDisclosure(bramble.id)).toBe("child_ok");
    const teen = person("teen", "Sprout");
    expect(fileDisclosure(teen.id)).toBe("child_ok");
  });

  test("an adult's file defaults to adult_only", () => {
    const marlow = person("adult", "Marlow");
    expect(fileDisclosure(marlow.id)).toBe("adult_only");
  });
});
