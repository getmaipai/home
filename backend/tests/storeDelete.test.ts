// STORE-DELETE-01 (docs/plans/household-storage-2026-09-23.md, "When a
// person is deleted", decision 5): a deleted person's unshared files go
// with them, record and blob; a shared file stays and passes to the
// household; a memorialized person keeps everything; an export is offered
// first.
import { beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { attachmentsDir } from "@/lib/paths";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { attachments, conversationTurns, people, shares } from "@/db/schema";
import { attachmentFilePath, createAttachment, deleteAttachmentsForPerson } from "@/lib/attachments";
import { createShare, listFilesVisibleToActor } from "@/lib/shares";
import { resolveOrCreateConversation } from "@/lib/conversationHistory";
import { checkStorageCap, householdUsageBytes, personUsageBytes, storageUsageOverview } from "@/lib/storage/usage";
import { setHouseholdSettingValue } from "@/lib/settings";
import { newConversationTurnId } from "@/lib/id";
import { nextHlc } from "@/lib/hlc";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";

beforeEach(() => resetDb());

type PersonRowT = typeof people.$inferSelect;

async function household() {
  const owner = new TestClient();
  await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const add = async (displayName: string, role: string) => {
    const res = await owner.post("/api/people", { displayName, role, secret: role === "child" ? undefined : `${displayName.toLowerCase()}pin1` });
    expect(res.status).toBe(201);
    return row(((await res.json()) as { id: string }).id);
  };
  return { owner, sage: db.select().from(people).where(eq(people.displayName, "Sage")).get()!, add };
}

function row(id: string): PersonRowT {
  return db.select().from(people).where(eq(people.id, id)).get()!;
}

function picture(actor: PersonRowT, text: string) {
  const conversation = resolveOrCreateConversation(actor, "chat");
  if (!conversation.ok) throw new Error(conversation.error);
  const turnId = newConversationTurnId();
  db.insert(conversationTurns)
    .values({ id: turnId, personId: actor.id, surface: "chat", conversationId: conversation.value.id, userText: "look", replyText: "nice", source: "model", safetyAction: "allow", createdAt: new Date().toISOString(), hlc: nextHlc() })
    .run();
  const created = createAttachment(actor, { conversationId: conversation.value.id, turnId, mediaType: "image/png", bytes: new TextEncoder().encode(text) });
  if (!created.ok) throw new Error(created.error);
  return created.value;
}

function blobExists(storagePath: string): boolean {
  return existsSync(attachmentFilePath(storagePath));
}

describe("deleting a person, in the filed words", () => {
  test("bramble shares a picture with lucia, lucia shares it with the family, bramble is deleted: the picture stays with the household and the unshared one is gone", async () => {
    const { owner, add } = await household();
    const bramble = await add("Bramble", "adult");
    const lucia = await add("Lucia", "adult");
    const marlow = await add("Marlow", "adult");
    setHouseholdSettingValue("storage.household.cap_bytes", 1_000_000);

    const shared = picture(bramble, "the picture bramble shared");
    const unshared = picture(bramble, "the picture bramble kept to themself");
    expect(createShare(bramble, { fileId: shared.id, to: lucia.id }).ok).toBe(true);
    expect(createShare(lucia, { fileId: shared.id, to: "household" }).ok).toBe(true);
    const householdBytesBefore = householdUsageBytes();

    // The export is offered first: the confirmation reads what goes and
    // what stays. Bramble is an adult, so their private files are not
    // handed to the owner removing them.
    const preview = await owner.get(`/api/people/${bramble.id}/deletion-preview`);
    expect(preview.status).toBe(200);
    expect(await preview.json()).toEqual({
      files: { purged: { files: 1, bytes: unshared.size }, keptForHousehold: { files: 1, bytes: shared.size } },
      export: { allowed: false, url: null },
    });
    expect((await owner.get(`/api/people/${bramble.id}/files/export`)).status).toBe(404);

    const deleted = await owner.request(`/api/people/${bramble.id}`, { method: "DELETE" });
    expect(deleted.status).toBe(200);
    const { erased } = (await deleted.json()) as { erased: { attachments: number; filesKeptForHousehold: number } };
    expect(erased.attachments).toBe(1);
    expect(erased.filesKeptForHousehold).toBe(1);

    // The picture remains, bytes and record, with bramble in its provenance.
    const kept = db.select().from(attachments).where(eq(attachments.id, shared.id)).get()!;
    expect(kept).toBeDefined();
    expect(kept.ownerPersonId).toBe(bramble.id);
    expect(kept.conversationId).toBeNull();
    expect(kept.turnId).toBeNull();
    expect(kept.retention).toBe("kept");
    expect(blobExists(kept.storagePath)).toBe(true);

    // Listed under the household, for lucia and for marlow.
    for (const reader of [lucia, marlow]) {
      const listed = listFilesVisibleToActor(row(reader.id)).find((f) => f.file.id === shared.id);
      expect(listed).toMatchObject({ household: true, formerOwnerName: "Bramble", shared: true });
    }
    const overview = storageUsageOverview(row((await household_owner()).id));
    expect(overview.people.some((p) => p.personId === bramble.id)).toBe(false);
    expect(overview.household?.inherited).toEqual({ files: 1, bytes: shared.size });

    // Counted against the household cap, against nobody's personal cap.
    expect(householdUsageBytes()).toBe(householdBytesBefore - unshared.size);
    expect(personUsageBytes(lucia.id)).toBe(0);
    expect(personUsageBytes(marlow.id)).toBe(0);
    setHouseholdSettingValue("storage.household.cap_bytes", householdUsageBytes() + 1);
    expect(checkStorageCap(marlow.role, marlow.id, 2).ok).toBe(false);
    expect(checkStorageCap(marlow.role, marlow.id, 1).ok).toBe(true);

    // The picture bramble never shared is gone, blob and record.
    expect(db.select().from(attachments).where(eq(attachments.id, unshared.id)).get()).toBeUndefined();
    expect(blobExists(unshared.storage_path)).toBe(false);
  });

  test("a parent removing a child can download every file first, and the export holds the bytes and the records", async () => {
    const { owner, add } = await household();
    const bramble = await add("Bramble", "child");
    const kept = picture(bramble, "a drawing of a rocket");

    const preview = (await (await owner.get(`/api/people/${bramble.id}/deletion-preview`)).json()) as { export: { allowed: boolean; url: string } };
    expect(preview.export).toEqual({ allowed: true, url: `/api/people/${bramble.id}/files/export` });

    const scratch = () => readdirSync(dirname(attachmentsDir)).filter((name) => name.startsWith(".maipai-files-export-")).length;
    const scratchBefore = scratch();
    const exported = await owner.get(preview.export.url);
    expect(exported.status).toBe(200);
    expect(exported.headers.get("content-type")).toBe("application/gzip");
    const archive = new Bun.Archive(new Uint8Array(await exported.arrayBuffer()));
    const files = await archive.files();
    const manifest = JSON.parse(await files.get("files.json")!.text()) as Array<{ id: string; export_path: string }>;
    expect(manifest.map((f) => f.id)).toEqual([kept.id]);
    expect(await files.get(manifest[0]!.export_path)!.text()).toBe("a drawing of a rocket");
    // Streamed from a scratch folder that goes once the stream ends.
    expect(scratch()).toBe(scratchBefore);

    expect((await owner.request(`/api/people/${bramble.id}`, { method: "DELETE" })).status).toBe(200);
    expect(db.select().from(attachments).where(eq(attachments.id, kept.id)).get()).toBeUndefined();
  });

  test("a memorialized person's files all remain, shared or not (decision 5)", async () => {
    const { owner, add } = await household();
    const bramble = await add("Bramble", "adult");
    const lucia = await add("Lucia", "adult");
    const shared = picture(bramble, "shared before");
    const unshared = picture(bramble, "never shared");
    expect(createShare(bramble, { fileId: shared.id, to: lucia.id }).ok).toBe(true);

    expect((await owner.post(`/api/people/${bramble.id}/memorialize`)).status).toBe(200);

    for (const file of [shared, unshared]) {
      const stillThere = db.select().from(attachments).where(eq(attachments.id, file.id)).get()!;
      expect(stillThere.ownerPersonId).toBe(bramble.id);
      expect(stillThere.turnId).toBe(file.provenance.turn_id);
      expect(blobExists(stillThere.storagePath)).toBe(true);
    }
    expect(db.select().from(shares).where(eq(shares.fileId, shared.id)).all()).toHaveLength(1);
    expect(personUsageBytes(bramble.id)).toBe(shared.size + unshared.size);
  });
});

describe("the share pointers a deleted person held", () => {
  test("a pointer to them is removed, and a re-share they made from the household's pointer dies with them", async () => {
    const { owner, add } = await household();
    const bramble = await add("Bramble", "adult");
    const lucia = await add("Lucia", "adult");
    const marlow = await add("Marlow", "adult");
    const luciasPicture = picture(lucia, "lucia's picture");
    expect(createShare(lucia, { fileId: luciasPicture.id, to: bramble.id }).ok).toBe(true);
    expect(createShare(lucia, { fileId: luciasPicture.id, to: "household" }).ok).toBe(true);
    expect(createShare(bramble, { fileId: luciasPicture.id, to: marlow.id }).ok).toBe(true);

    expect((await owner.request(`/api/people/${bramble.id}`, { method: "DELETE" })).status).toBe(200);

    const left = db.select().from(shares).where(eq(shares.fileId, luciasPicture.id)).all();
    expect(left.map((s) => [s.fromPersonId, s.to])).toEqual([[lucia.id, "household"]]);
    expect(db.select().from(attachments).where(eq(attachments.id, luciasPicture.id)).get()).toBeDefined();
  });

  test("a file left to the household goes once the last person it was shared with is deleted too", async () => {
    const { owner, add } = await household();
    const bramble = await add("Bramble", "adult");
    const lucia = await add("Lucia", "adult");
    const file = picture(bramble, "only lucia ever saw this");
    expect(createShare(bramble, { fileId: file.id, to: lucia.id }).ok).toBe(true);

    expect((await owner.request(`/api/people/${bramble.id}`, { method: "DELETE" })).status).toBe(200);
    expect(db.select().from(attachments).where(eq(attachments.id, file.id)).get()).toBeDefined();

    expect((await owner.request(`/api/people/${lucia.id}`, { method: "DELETE" })).status).toBe(200);
    expect(db.select().from(attachments).where(eq(attachments.id, file.id)).get()).toBeUndefined();
    expect(blobExists(file.storage_path)).toBe(false);
  });

  test("an export cancelled mid-download leaves no scratch folder behind", async () => {
    const { owner, add } = await household();
    const bramble = await add("Bramble", "child");
    for (let i = 0; i < 3; i++) picture(bramble, `picture ${i} `.repeat(20_000));
    const scratch = () => readdirSync(dirname(attachmentsDir)).filter((name) => name.startsWith(".maipai-files-export-")).length;
    const before = scratch();
    const exported = await owner.get(`/api/people/${bramble.id}/files/export`);
    const reader = exported.body!.getReader();
    await reader.read();
    await reader.cancel();
    expect(scratch()).toBe(before);
  });

  test("a pointer to someone deleted before this rule existed keeps nothing alive", async () => {
    const { owner, add } = await household();
    const bramble = await add("Bramble", "adult");
    const lucia = await add("Lucia", "adult");
    const file = picture(bramble, "shared only with someone long gone");
    expect(createShare(bramble, { fileId: file.id, to: lucia.id }).ok).toBe(true);
    // The old delete path left pointers addressed to the person it deleted.
    db.update(people).set({ deletedAt: new Date().toISOString() }).where(eq(people.id, lucia.id)).run();

    const preview = (await (await owner.get(`/api/people/${bramble.id}/deletion-preview`)).json()) as { files: { purged: { files: number } } };
    expect(preview.files.purged.files).toBe(1);
    expect((await owner.request(`/api/people/${bramble.id}`, { method: "DELETE" })).status).toBe(200);
    expect(db.select().from(attachments).where(eq(attachments.id, file.id)).get()).toBeUndefined();
    expect(blobExists(file.storage_path)).toBe(false);
  });

  test("host.data.forget still removes every file the person owns, a shared one and its pointers included", async () => {
    const { add } = await household();
    const bramble = await add("Bramble", "adult");
    const lucia = await add("Lucia", "adult");
    const file = picture(bramble, "forget me");
    expect(createShare(bramble, { fileId: file.id, to: lucia.id }).ok).toBe(true);

    expect(deleteAttachmentsForPerson(bramble.id)).toBe(1);
    expect(db.select().from(shares).where(eq(shares.fileId, file.id)).all()).toHaveLength(0);
    expect(blobExists(file.storage_path)).toBe(false);
  });
});

async function household_owner(): Promise<PersonRowT> {
  return db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
}

// The migration that makes a kept file's conversation and turn nullable
// rebuilds `attachments`, which `shares` points at. Drizzle runs every
// migration inside one transaction, where PRAGMA foreign_keys=OFF does
// nothing, so a hub that already has share pointers would refuse the
// rebuild unless the migration sets them aside first.
test("the attachments rebuild migrates a database that already holds share pointers", () => {
  const source = join(import.meta.dir, "../src/db/migrations");
  const journal = JSON.parse(readFileSync(join(source, "meta/_journal.json"), "utf8")) as { entries: Array<{ idx: number; tag: string }> };
  const rebuild = journal.entries.find((e) => readFileSync(join(source, `${e.tag}.sql`), "utf8").includes("__store_delete_shares"))!;
  expect(rebuild).toBeDefined();

  const before = mkdtempSync(join(tmpdir(), "maipai-store-delete-migrations-"));
  mkdirSync(join(before, "meta"));
  const earlier = journal.entries.filter((e) => e.idx < rebuild.idx);
  for (const entry of earlier) copyFileSync(join(source, `${entry.tag}.sql`), join(before, `${entry.tag}.sql`));
  writeFileSync(join(before, "meta/_journal.json"), JSON.stringify({ ...journal, entries: earlier }));
  for (const name of readdirSync(join(source, "meta"))) if (name.endsWith("_snapshot.json")) copyFileSync(join(source, "meta", name), join(before, "meta", name));

  const sqlite = new Database(":memory:");
  try {
    sqlite.exec("PRAGMA foreign_keys = ON");
    migrate(drizzle(sqlite), { migrationsFolder: before });
    const now = new Date().toISOString();
    sqlite.query("INSERT INTO people (id, display_name, role, avatar_seed, source, created_at, updated_at, hlc) VALUES ('person-bramble1', 'Bramble', 'adult', 'b', 'hub', ?, ?, '1:0:aaaaaa')").run(now, now);
    sqlite.query("INSERT INTO conversations (id, person_id, surface, created_at, updated_at, hlc) VALUES ('conv-aaaaaa', 'person-bramble1', 'chat', ?, ?, '1:0:aaaaaa')").run(now, now);
    sqlite.query("INSERT INTO conversation_turns (id, person_id, surface, conversation_id, user_text, reply_text, source, safety_action, created_at, hlc) VALUES ('turn-aaaaaa', 'person-bramble1', 'chat', 'conv-aaaaaa', 'u', 'r', 'model', 'allow', ?, '1:0:aaaaaa')").run(now);
    sqlite.query("INSERT INTO attachments (id, owner_person_id, conversation_id, turn_id, media_type, size, sha256, storage_path, provenance, created_at, hlc) VALUES ('file-aaaaaa', 'person-bramble1', 'conv-aaaaaa', 'turn-aaaaaa', 'image/png', 1, ?, 'people/person-bramble1/attachments/file-aaaaaa', 'composer:upload', ?, '1:0:aaaaaa')").run("a".repeat(64), now);
    sqlite.query("INSERT INTO shares (id, file_id, from_person_id, \"to\", provenance, created_at, hlc) VALUES ('share-aaaaaa', 'file-aaaaaa', 'person-bramble1', 'household', 'files-page:share', ?, '1:0:aaaaaa')").run(now);

    migrate(drizzle(sqlite), { migrationsFolder: source });

    expect(sqlite.query("SELECT id, file_id, \"to\" FROM shares").all()).toEqual([{ id: "share-aaaaaa", file_id: "file-aaaaaa", to: "household" }]);
    expect(sqlite.query("SELECT id, turn_id FROM attachments").all()).toEqual([{ id: "file-aaaaaa", turn_id: "turn-aaaaaa" }]);
    expect(sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
    const turnColumn = (sqlite.query("PRAGMA table_info(attachments)").all() as Array<{ name: string; notnull: number }>).find((c) => c.name === "turn_id")!;
    expect(turnColumn.notnull).toBe(0);
    expect(sqlite.query("SELECT name FROM sqlite_master WHERE name = '__store_delete_shares'").all()).toEqual([]);
  } finally {
    sqlite.close();
  }
});
