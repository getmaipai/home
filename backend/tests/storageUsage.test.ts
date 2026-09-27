// STORE-CAP-01 (docs/plans/household-storage-2026-09-23.md): the two
// enforced caps (a person's own, the household total), usage computed
// from the File records (never a disk walk), and the reconcile health
// item that never deletes anything.
import { describe, expect, test, beforeEach } from "bun:test";
import { existsSync, mkdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { attachments, conversationTurns, people } from "@/db/schema";
import { createAttachment, attachmentFilePath } from "@/lib/attachments";
import { resolveOrCreateConversation } from "@/lib/conversationHistory";
import { newConversationTurnId, newPersonId } from "@/lib/id";
import { nextHlc } from "@/lib/hlc";
import { attachmentsDir } from "@/lib/paths";
import { setHouseholdSettingValue, setValue, getSettingValueForPerson } from "@/lib/settings";
import { listIssues } from "@/lib/issues";
import {
  personUsageBytes,
  householdUsageBytes,
  personCapBytes,
  householdCapBytes,
  storageRefusalMessage,
  checkStorageCap,
  reconcileFileStore,
} from "@/lib/storage/usage";
import { resetDb } from "./reset-db";
import { TestClient } from "./client";
import type { PersonRow } from "@/types";

beforeEach(() => resetDb());

async function owner(): Promise<PersonRow> {
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  return db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
}

function insertPerson(role: string, displayName: string): PersonRow {
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

function conversationFor(actor: PersonRow): string {
  const result = resolveOrCreateConversation(actor, "chat");
  if (!result.ok) throw new Error(result.error);
  return result.value.id;
}

function turnFor(actor: PersonRow, conversationId: string): string {
  const id = newConversationTurnId();
  db.insert(conversationTurns)
    .values({
      id,
      personId: actor.id,
      surface: "chat",
      conversationId,
      userText: "here's a picture",
      replyText: "saved",
      source: "model",
      safetyAction: "allow",
      createdAt: new Date().toISOString(),
      hlc: nextHlc(),
    })
    .run();
  return id;
}

describe("storageRefusalMessage()", () => {
  test("a child gets the exact child line", () => {
    expect(storageRefusalMessage("child")).toBe("Your storage is full; delete some pictures or ask a parent for more room");
  });

  test("an adult gets the same line plus the raise-the-limit clause", () => {
    expect(storageRefusalMessage("adult")).toBe("Your storage is full; delete some pictures or ask a parent for more room, or raise the limit under Settings");
  });
});

describe("createAttachment() enforcing the two caps", () => {
  test("a child at their cap writing a picture gets the child line, refused before any bytes are written", async () => {
    const child = insertPerson("child", "Poppy");
    setHouseholdSettingValue("storage.person.default_cap_bytes", 10);
    const conversationId = conversationFor(child);
    const turnId = turnFor(child, conversationId);

    const result = createAttachment(child, { conversationId, turnId, mediaType: "image/png", bytes: new TextEncoder().encode("twenty bytes of image") });

    expect(result).toEqual({ ok: false, status: 403, error: "Your storage is full; delete some pictures or ask a parent for more room" });
    expect(db.select().from(attachments).all()).toHaveLength(0);
  });

  test("an adult at their cap writing a picture gets the adult line", async () => {
    const adult = insertPerson("adult", "Marlow");
    setHouseholdSettingValue("storage.person.default_cap_bytes", 10);
    const conversationId = conversationFor(adult);
    const turnId = turnFor(adult, conversationId);

    const result = createAttachment(adult, { conversationId, turnId, mediaType: "image/png", bytes: new TextEncoder().encode("twenty bytes of image") });

    expect(result).toEqual({
      ok: false,
      status: 403,
      error: "Your storage is full; delete some pictures or ask a parent for more room, or raise the limit under Settings",
    });
  });

  test("under the cap still writes normally", async () => {
    const adult = insertPerson("adult", "Marlow");
    setHouseholdSettingValue("storage.person.default_cap_bytes", 10_000);
    const conversationId = conversationFor(adult);
    const turnId = turnFor(adult, conversationId);

    const result = createAttachment(adult, { conversationId, turnId, mediaType: "image/png", bytes: new TextEncoder().encode("small") });
    expect(result.ok).toBe(true);
  });

  test("the household total refuses a write even when the person's own cap has room", async () => {
    const adult = insertPerson("adult", "Marlow");
    setHouseholdSettingValue("storage.person.default_cap_bytes", 10_000_000); // plenty of personal room
    setHouseholdSettingValue("storage.household.cap_bytes", 10); // almost none for the household
    const conversationId = conversationFor(adult);
    const turnId = turnFor(adult, conversationId);

    const result = createAttachment(adult, { conversationId, turnId, mediaType: "image/png", bytes: new TextEncoder().encode("more than ten bytes") });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(403);
    expect(result.error).toContain("Your storage is full");
  });

  test("a person's own admin-set override wins over the household default", async () => {
    const admin = await owner();
    const adult = insertPerson("adult", "Marlow");
    setHouseholdSettingValue("storage.person.default_cap_bytes", 5); // would refuse on its own
    const set = setValue(admin, `person:${adult.id}`, "storage.person.cap_bytes", 10_000);
    expect(set.ok).toBe(true);
    const conversationId = conversationFor(adult);
    const turnId = turnFor(adult, conversationId);

    const result = createAttachment(adult, { conversationId, turnId, mediaType: "image/png", bytes: new TextEncoder().encode("comfortably under the override") });
    expect(result.ok).toBe(true);
  });
});

describe("usage: computed from the File records, never a disk walk", () => {
  test("a shared file counts once, against its owner, never against a recipient", async () => {
    const ownerPerson = insertPerson("adult", "Bramble");
    const recipient = insertPerson("adult", "Lucia"); // a household member who might one day receive a share pointer
    const conversationId = conversationFor(ownerPerson);
    const turnId = turnFor(ownerPerson, conversationId);
    const bytes = new TextEncoder().encode("a picture bramble made");

    const created = createAttachment(ownerPerson, { conversationId, turnId, mediaType: "image/png", bytes });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    expect(personUsageBytes(ownerPerson.id)).toBe(bytes.byteLength);
    expect(personUsageBytes(recipient.id)).toBe(0);
    // The household total is the owner's bytes exactly once - not doubled
    // by counting it again for anyone it might be shared with.
    expect(householdUsageBytes()).toBe(bytes.byteLength);
  });

  test("personCapBytes() falls back to the household default when no override is set", async () => {
    const adult = insertPerson("adult", "Marlow");
    setHouseholdSettingValue("storage.person.default_cap_bytes", 12_345);
    expect(personCapBytes(adult.id)).toBe(12_345);
  });

  test("householdCapBytes() is 0 (no cap enforced) until the wizard sets one", () => {
    expect(householdCapBytes()).toBe(0);
  });

  test("an explicit 0 default per-person cap means no per-person cap, never a silent 20 GB substitute", async () => {
    const adult = insertPerson("adult", "Marlow");
    setHouseholdSettingValue("storage.person.default_cap_bytes", 0);
    expect(personCapBytes(adult.id)).toBe(0);

    const conversationId = conversationFor(adult);
    const turnId = turnFor(adult, conversationId);
    const result = createAttachment(adult, { conversationId, turnId, mediaType: "image/png", bytes: new Uint8Array(1000) });
    expect(result.ok).toBe(true);
  });
});

describe("dedupe (STORE-SHARE-01) composed with the cap: a dedupe hit is not new usage", () => {
  // household-storage-2026-09-23.md, "Enforcement": the cap refuses "a
  // write that would take the owner past their cap". A dedupe hit
  // (attachments.ts's createAttachment(), sha256 match) writes no new
  // blob and no new File row, so it is not that write - checkStorageCap()
  // must never run for it, cap already exhausted or not.
  test("a second person's identical bytes still succeed via a share pointer when the household cap is already fully used by the first file", async () => {
    const ownerPerson = insertPerson("adult", "Bramble");
    const recipient = insertPerson("adult", "Lucia");
    const bytes = new TextEncoder().encode("bytes that exactly fill the household cap");
    setHouseholdSettingValue("storage.household.cap_bytes", bytes.byteLength);

    const firstConversationId = conversationFor(ownerPerson);
    const firstTurnId = turnFor(ownerPerson, firstConversationId);
    const first = createAttachment(ownerPerson, { conversationId: firstConversationId, turnId: firstTurnId, mediaType: "image/png", bytes });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(householdUsageBytes()).toBe(bytes.byteLength); // the cap is now exactly used up

    // The recipient uploading the SAME bytes dedupes to a share pointer,
    // not a new File row - no new usage, so the (already-exhausted) cap
    // must not refuse it.
    const secondConversationId = conversationFor(recipient);
    const secondTurnId = turnFor(recipient, secondConversationId);
    const second = createAttachment(recipient, { conversationId: secondConversationId, turnId: secondTurnId, mediaType: "image/png", bytes });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.id).toBe(first.value.id);
    expect(second.value.owner_person_id).toBe(ownerPerson.id);
    expect(db.select().from(attachments).all()).toHaveLength(1); // still one File row
    expect(householdUsageBytes()).toBe(bytes.byteLength); // still exactly the same usage, not doubled
    // "No duplicates at any level" (household-storage-2026-09-23.md) means
    // no second blob either, not just no second row: the recipient's own
    // attachments directory is never created by the dedupe branch (only
    // the non-dedupe path below calls ensureDataDir/writeFileSync), so a
    // future regression that accidentally wrote a redundant blob there
    // would be caught here rather than only by the byte-count assertion
    // above, which a duplicate write of the same size would not move.
    expect(existsSync(join(attachmentsDir, recipient.id, "attachments"))).toBe(false);

    // Contrast: the SAME recipient uploading genuinely NEW bytes (any
    // nonzero content, distinct hash), with the cap already exhausted by
    // the first file, is refused exactly as STORE-CAP-01 built it -
    // proving the prior success was the dedupe path, not a cap that
    // secretly had room.
    const thirdConversationId = conversationFor(recipient);
    const thirdTurnId = turnFor(recipient, thirdConversationId);
    const newBytes = new TextEncoder().encode("genuinely different bytes, never uploaded before");
    const third = createAttachment(recipient, { conversationId: thirdConversationId, turnId: thirdTurnId, mediaType: "image/png", bytes: newBytes });
    expect(third.ok).toBe(false);
    if (third.ok) return;
    expect(third.status).toBe(403);
    expect(third.error).toContain("Your storage is full");
  });
});

describe("checkStorageCap() as a job's own preflight (decision 3)", () => {
  test("refuses before anything is written - no attachment, no bytes, no job needs to exist yet to prove it", () => {
    const child = insertPerson("child", "Poppy");
    setHouseholdSettingValue("storage.person.default_cap_bytes", 100);

    const preflight = checkStorageCap(child.role, child.id, 1_000);

    expect(preflight.ok).toBe(false);
    expect(preflight.error).toBe("Your storage is full; delete some pictures or ask a parent for more room");
    expect(db.select().from(attachments).all()).toHaveLength(0);
  });
});

describe("storage.person.cap_bytes: admin-set override only", () => {
  test("a plain adult cannot raise their own cap override", async () => {
    const adult = insertPerson("adult", "Marlow");
    const result = setValue(adult, `person:${adult.id}`, "storage.person.cap_bytes", 999_999_999);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(403);
  });

  test("an owner can set another person's cap override", async () => {
    const admin = await owner();
    const child = insertPerson("child", "Poppy");
    const result = setValue(admin, `person:${child.id}`, "storage.person.cap_bytes", 5_000_000);
    expect(result.ok).toBe(true);
    expect(getSettingValueForPerson(child.id, "storage.person.cap_bytes")).toBe(5_000_000);
  });
});

describe("reconcileFileStore(): raises a health item, never deletes anything", () => {
  // Isolated from every other test's leftover files: attachmentsDir is
  // inside the disposable per-run test dataDir (tests/preload.ts), so
  // wiping it clean here (and only here) is what lets these tests make
  // exact assertions instead of counting around whatever other test
  // files in this same `bun test` run happened to leave behind.
  beforeEach(() => {
    if (existsSync(attachmentsDir)) rmSync(attachmentsDir, { recursive: true, force: true });
  });

  test("bytes on disk with no record raise a warning, and the file is left exactly where it was", () => {
    const orphanDir = join(attachmentsDir, "person-orphan", "attachments");
    mkdirSync(orphanDir, { recursive: true });
    const orphanPath = join(orphanDir, "file-orphan123");
    writeFileSync(orphanPath, "orphan bytes, no matching record");

    reconcileFileStore();

    const issue = listIssues().find((i) => i.source === "storage" && i.key === "file_reconcile");
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe("warning");
    expect(existsSync(orphanPath)).toBe(true); // never deleted
  });

  test("a record with no bytes on disk raises a warning, and the record is left exactly where it was", async () => {
    const actor = await owner();
    const conversationId = conversationFor(actor);
    const turnId = turnFor(actor, conversationId);
    const created = createAttachment(actor, { conversationId, turnId, mediaType: "image/png", bytes: new TextEncoder().encode("real bytes, then removed") });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    unlinkSync(attachmentFilePath(created.value.storage_path));

    reconcileFileStore();

    const issue = listIssues().find((i) => i.source === "storage" && i.key === "file_reconcile");
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe("warning");
    expect(db.select().from(attachments).where(eq(attachments.id, created.value.id)).all()).toHaveLength(1); // never deleted
  });

  test("resolves once the mismatch is actually fixed - never on its own", () => {
    const orphanDir = join(attachmentsDir, "person-orphan2", "attachments");
    mkdirSync(orphanDir, { recursive: true });
    const orphanPath = join(orphanDir, "file-orphan456");
    writeFileSync(orphanPath, "orphan bytes");

    reconcileFileStore();
    expect(listIssues().find((i) => i.source === "storage" && i.key === "file_reconcile")).toBeDefined();

    unlinkSync(orphanPath);
    reconcileFileStore();
    const resolved = listIssues({ includeResolved: true }).find((i) => i.source === "storage" && i.key === "file_reconcile");
    expect(resolved?.resolved_at).not.toBeNull();
  });

  test("a perfectly matched store raises nothing", async () => {
    const actor = await owner();
    const conversationId = conversationFor(actor);
    const turnId = turnFor(actor, conversationId);
    const created = createAttachment(actor, { conversationId, turnId, mediaType: "image/png", bytes: new TextEncoder().encode("matched pair") });
    expect(created.ok).toBe(true);

    reconcileFileStore();

    expect(listIssues().find((i) => i.source === "storage" && i.key === "file_reconcile")).toBeUndefined();
  });
});
