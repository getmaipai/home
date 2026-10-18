// LIBRARY-DEDUP-01: one stored file per sha256, separate references, bytes removed only at zero references.
import { beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { eq } from "drizzle-orm";
import { db, sqlite } from "@/db";
import { attachments, conversationTurns, fileBlobRemovals, fileContents, fileReferences, mediaItems, mediaSources, people, shares } from "@/db/schema";
import { attachmentFilePath, createAttachment, deleteAttachmentsForTurns, getAttachment, purgeFileRecord, readAttachment, removeFileBlobs } from "@/lib/attachments";
import { contentFor, dedupReport, referenceCount, referenceDrift, referenceKinds, syncFileReferences } from "@/lib/fileContent";
import { reclaimQueuedBlobs } from "@/lib/fileBlobs";
import { createShare, deleteShare } from "@/lib/shares";
import { personUsageBytes, householdInheritedUsage, householdUsageBytes } from "@/lib/storage/usage";
import { newConversationTurnId, newPersonId } from "@/lib/id";
import { nextHlc } from "@/lib/hlc";
import { resolveOrCreateConversation } from "@/lib/conversationHistory";
import { resetDb } from "./reset-db";

beforeEach(() => resetDb());

function person(role: "owner" | "adult" | "child", displayName: string) {
  return db.insert(people).values({ id: newPersonId(), displayName, role, avatarSeed: displayName.toLowerCase(), source: "hub", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), hlc: nextHlc() }).returning().get()!;
}
function chat(actor: typeof people.$inferSelect) {
  const conversation = resolveOrCreateConversation(actor, "chat");
  if (!conversation.ok) throw new Error(conversation.error);
  const turnId = newConversationTurnId();
  db.insert(conversationTurns).values({ id: turnId, personId: actor.id, surface: "chat", conversationId: conversation.value.id, userText: "hi", replyText: "ok", source: "model", safetyAction: "allow", createdAt: new Date().toISOString(), hlc: nextHlc() }).run();
  return { conversationId: conversation.value.id, turnId };
}
function upload(actor: typeof people.$inferSelect, text: string, extra: { retention?: "kept" | "conversation"; deduplicate?: boolean } = {}) {
  const { conversationId, turnId } = chat(actor);
  const created = createAttachment(actor, { conversationId, turnId, mediaType: "image/png", bytes: new TextEncoder().encode(text), ...extra });
  if (!created.ok) throw new Error(created.error);
  return { ...created.value, turnId, conversationId };
}
const row = (id: string) => db.select().from(attachments).where(eq(attachments.id, id)).get()!;
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
/** What the Library delete (LIBRARY-REVAMP-10) and every other removal do: drop the record, then the bytes if none are held. */
function remove(id: string) { const blob = purgeFileRecord(row(id)); if (blob) removeFileBlobs([blob]); return blob; }

describe("one stored file, one record per owner", () => {
  test("two people uploading the same bytes share one stored file and have separate records", () => {
    const sage = person("owner", "Sage");
    const lucia = person("adult", "Lucia");
    const first = upload(sage, "family picture");
    const second = upload(lucia, "family picture");
    expect(second.id).not.toBe(first.id);
    expect(second.storage_path).toBe(first.storage_path);
    expect(contentFor(sha("family picture"))?.storagePath).toBe(first.storage_path);
    expect(db.select().from(fileContents).all()).toHaveLength(1);
    expect(referenceKinds(sha("family picture"))).toEqual({ owner: 2, chat: 2 });
    expect(existsSync(attachmentFilePath(first.storage_path))).toBe(true);
    expect(readAttachment(lucia, second.id).ok).toBe(true);
    expect(readAttachment(sage, first.id).ok).toBe(true);
    const report = dedupReport();
    expect(report.records).toBe(2);
    expect(report.blobs).toBe(1);
    expect(report.savedBytes).toBe("family picture".length);
    expect(referenceDrift()).toEqual({ missing: [], extra: [] });
  });

  test("deleting the first owner's copy first keeps the second person's copy, then the last delete removes the bytes", () => {
    const sage = person("owner", "Sage");
    const lucia = person("adult", "Lucia");
    const first = upload(sage, "order one");
    const second = upload(lucia, "order one");
    expect(remove(first.id)).toBeNull();
    expect(existsSync(attachmentFilePath(second.storage_path))).toBe(true);
    expect(readAttachment(lucia, second.id).ok).toBe(true);
    expect(contentFor(sha("order one"))).toBeDefined();
    expect(remove(second.id)).toBe(second.storage_path);
    expect(existsSync(attachmentFilePath(second.storage_path))).toBe(false);
    expect(contentFor(sha("order one"))).toBeUndefined();
    expect(db.select().from(fileReferences).all()).toHaveLength(0);
  });

  test("deleting the second owner's copy first keeps the first person's copy, then the last delete removes the bytes", () => {
    const sage = person("owner", "Sage");
    const lucia = person("adult", "Lucia");
    const first = upload(sage, "order two");
    const second = upload(lucia, "order two");
    expect(remove(second.id)).toBeNull();
    expect(readAttachment(sage, first.id).ok).toBe(true);
    expect(remove(first.id)).toBe(first.storage_path);
    expect(existsSync(attachmentFilePath(first.storage_path))).toBe(false);
  });

  test("the same person sending the same bytes again gets their record back", () => {
    const sage = person("owner", "Sage");
    const first = upload(sage, "same again");
    const again = upload(sage, "same again");
    expect(again.id).toBe(first.id);
    expect(db.select().from(attachments).all()).toHaveLength(1);
  });

  test("a job that saves identical bytes twice keeps two records on one stored file and counts the bytes once", () => {
    const sage = person("owner", "Sage");
    const a = upload(sage, "job picture", { deduplicate: false });
    const b = upload(sage, "job picture", { deduplicate: false });
    expect(b.id).not.toBe(a.id);
    expect(b.storage_path).toBe(a.storage_path);
    expect(personUsageBytes(sage.id)).toBe("job picture".length);
    expect(householdUsageBytes()).toBe("job picture".length);
    expect(remove(a.id)).toBeNull();
    expect(remove(b.id)).toBe(a.storage_path);
  });

  test("a damaged stored file is rewritten from new bytes of the same hash", () => {
    const sage = person("owner", "Sage");
    const lucia = person("adult", "Lucia");
    const first = upload(sage, "damaged one");
    writeFileSync(attachmentFilePath(first.storage_path), "damaged on");
    const second = upload(lucia, "damaged one");
    expect(readFileSync(attachmentFilePath(second.storage_path), "utf8")).toBe("damaged one");
    expect(readAttachment(sage, first.id).ok).toBe(true);
  });

  test("a fetched download repairs a damaged stored file instead of pointing at it", async () => {
    const sage = person("owner", "Sage");
    const lucia = person("adult", "Lucia");
    const first = upload(sage, "episode audio bytes");
    writeFileSync(attachmentFilePath(first.storage_path), "damaged");
    const { createFetchedFile } = await import("@/lib/media/fetchedFiles");
    const fetched = createFetchedFile(lucia, { mediaType: "image/png", mediaSourceId: "msrc-test001", note: "podcast:auto", bytes: new TextEncoder().encode("episode audio bytes") });
    expect(fetched.ok).toBe(true);
    expect(readFileSync(attachmentFilePath(first.storage_path), "utf8")).toBe("episode audio bytes");
    expect(readAttachment(sage, first.id).ok).toBe(true);
  });

  test("a missing stored file is written again from new bytes of the same hash", () => {
    const sage = person("owner", "Sage");
    const lucia = person("adult", "Lucia");
    const first = upload(sage, "healing");
    rmSync(attachmentFilePath(first.storage_path));
    const second = upload(lucia, "healing");
    expect(readFileSync(attachmentFilePath(second.storage_path), "utf8")).toBe("healing");
    expect(readAttachment(sage, first.id).ok).toBe(true);
  });
});

describe("library summary agrees with storage", () => {
  test("identical bytes held in two records count once in the summary bytes", async () => {
    const { listLibrary, librarySummary } = await import("@/lib/library");
    const sage = person("owner", "Sage");
    upload(sage, "same job picture", { deduplicate: false });
    upload(sage, "same job picture", { deduplicate: false });
    expect(personUsageBytes(sage.id)).toBe("same job picture".length);
    const summary = librarySummary(sage, {});
    expect(summary.bytes).toBe("same job picture".length);
    expect(summary.items).toBe(2);
    expect(listLibrary(sage, {}).items).toHaveLength(2);
  });
});

describe("summary across kinds and a duplicate left behind", () => {
  test("identical bytes filed under two kinds count once in the summary total", async () => {
    const { librarySummary } = await import("@/lib/library");
    const sage = person("owner", "Sage");
    const a = upload(sage, "ten bytes!", { deduplicate: false });
    const b = upload(sage, "ten bytes!", { deduplicate: false });
    db.update(attachments).set({ mediaType: "audio/mpeg" }).where(eq(attachments.id, b.id)).run();
    expect(a.id).not.toBe(b.id);
    expect(librarySummary(sage, {}).bytes).toBe("ten bytes!".length);
  });
  test("a queued duplicate is removed when every record of its bytes was purged before it was reached", async () => {
    const sage = person("owner", "Sage");
    const canonicalPath = `people/${sage.id}/attachments/file-canon999`;
    const duplicatePath = `people/${sage.id}/attachments/file-dupe9999`;
    for (const path of [canonicalPath, duplicatePath]) mkdirSync(dirname(attachmentFilePath(path)), { recursive: true });
    writeFileSync(attachmentFilePath(duplicatePath), "purged before reclaim");
    db.insert(fileBlobRemovals).values({ storagePath: duplicatePath, queuedAt: new Date().toISOString() }).run();
    expect(await reclaimQueuedBlobs()).toEqual({ removed: 1, promoted: 0, kept: 0, dropped: 0 });
    expect(existsSync(attachmentFilePath(duplicatePath))).toBe(false);
    expect(db.select().from(fileBlobRemovals).all()).toHaveLength(0);
  });
});

describe("usage of a departed person's files", () => {
  test("bytes an active person also holds are not counted as inherited", () => {
    const sage = person("owner", "Sage");
    const gone = person("adult", "Marsh");
    const shared = upload(gone, "held by both");
    upload(sage, "held by both");
    const alone = upload(gone, "held by marsh only");
    db.update(people).set({ deletedAt: new Date().toISOString() }).where(eq(people.id, gone.id)).run();
    expect(householdInheritedUsage()).toEqual({ files: 1, bytes: alone.size });
    expect(householdUsageBytes()).toBe(shared.size + alone.size);
  });
});

describe("references", () => {
  test("a chat reference ends with its turn while the owner's kept file stays", () => {
    const sage = person("owner", "Sage");
    const kept = upload(sage, "kept song", { retention: "kept" });
    const plain = upload(sage, "plain picture");
    expect(referenceKinds(sha("kept song"))).toEqual({ owner: 1, chat: 1 });
    expect(deleteAttachmentsForTurns([kept.turnId, plain.turnId])).toBe(1);
    expect(referenceKinds(sha("kept song"))).toEqual({ owner: 1 });
    expect(existsSync(attachmentFilePath(kept.storage_path))).toBe(true);
    expect(existsSync(attachmentFilePath(plain.storage_path))).toBe(false);
    expect(contentFor(sha("plain picture"))).toBeUndefined();
  });

  test("a chat that is deleted before the other owner's copy keeps the bytes for the other owner", () => {
    const sage = person("owner", "Sage");
    const lucia = person("adult", "Lucia");
    const first = upload(sage, "chat order");
    const second = upload(lucia, "chat order");
    deleteAttachmentsForTurns([first.turnId]);
    expect(row(second.id)).toBeDefined();
    expect(existsSync(attachmentFilePath(second.storage_path))).toBe(true);
    expect(referenceKinds(sha("chat order"))).toEqual({ owner: 1, chat: 1 });
  });

  test("a share is a reference and goes with unshare and with the file", () => {
    const sage = person("owner", "Sage");
    const lucia = person("adult", "Lucia");
    const file = upload(sage, "shared once");
    const share = createShare(sage, { fileId: file.id, to: lucia.id });
    expect(share.ok).toBe(true);
    if (!share.ok) return;
    expect(referenceKinds(sha("shared once"))).toEqual({ owner: 1, chat: 1, share: 1 });
    expect(deleteShare(sage, share.value.id).ok).toBe(true);
    expect(referenceKinds(sha("shared once"))).toEqual({ owner: 1, chat: 1 });
    const again = createShare(sage, { fileId: file.id, to: "household" });
    expect(again.ok).toBe(true);
    expect(referenceCount(sha("shared once"))).toBe(3);
    expect(remove(file.id)).toBe(file.storage_path);
    expect(db.select().from(shares).all()).toHaveLength(0);
    expect(db.select().from(fileReferences).all()).toHaveLength(0);
  });

  test("a media item that keeps a saved copy is a collection reference", () => {
    const sage = person("owner", "Sage");
    const file = upload(sage, "episode bytes");
    const fill = (table: string, values: Record<string, unknown>) => {
      const columns = sqlite.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string; notnull: number; dflt_value: string | null; type: string }>;
      const filled: Record<string, unknown> = { ...values };
      for (const column of columns) if (column.notnull && column.dflt_value === null && !(column.name in filled)) filled[column.name] = column.type.toUpperCase().includes("INT") || column.type.toUpperCase() === "REAL" ? 0 : "x";
      sqlite.query(`INSERT INTO ${table} (${Object.keys(filled).join(",")}) VALUES (${Object.keys(filled).map(() => "?").join(",")})`).run(...(Object.values(filled) as never[]));
    };
    fill("media_sources", { id: "msrc-test", kind: "feed" });
    fill("media_items", { id: "media-test1", source_id: "msrc-test", loc_file_id: file.id, kind: "podcast_episode" });
    syncFileReferences(file.id);
    expect(referenceKinds(sha("episode bytes")).collection).toBe(1);
    db.update(mediaItems).set({ locFileId: null }).where(eq(mediaItems.id, "media-test1")).run();
    syncFileReferences(file.id);
    expect(referenceKinds(sha("episode bytes")).collection).toBeUndefined();
    expect(db.select().from(mediaSources).all().length).toBe(1);
  });

  test("a record that lost its reference rows still protects its bytes", () => {
    const sage = person("owner", "Sage");
    const lucia = person("adult", "Lucia");
    const first = upload(sage, "belt and braces");
    const second = upload(lucia, "belt and braces");
    db.delete(fileReferences).where(eq(fileReferences.fileId, second.id)).run();
    expect(remove(first.id)).toBeNull();
    expect(existsSync(attachmentFilePath(second.storage_path))).toBe(true);
    expect(referenceDrift()).toEqual({ missing: [], extra: [] });
  });
});

describe("startup reclaim of the duplicate copies the migration queued", () => {
  function seed(text: string, canonicalExists: boolean) {
    const sage = person("owner", "Sage");
    const canonicalPath = `people/${sage.id}/attachments/file-canon${text.length}`;
    const duplicatePath = `people/${sage.id}/attachments/file-dupe${text.length}`;
    for (const path of [canonicalPath, duplicatePath]) mkdirSync(dirname(attachmentFilePath(path)), { recursive: true });
    if (canonicalExists) writeFileSync(attachmentFilePath(canonicalPath), text);
    writeFileSync(attachmentFilePath(duplicatePath), text);
    db.insert(fileContents).values({ sha256: sha(text), storagePath: canonicalPath, size: text.length, createdAt: new Date().toISOString() }).run();
    db.insert(attachments).values({ id: `file-canon${text.length}`, ownerPersonId: sage.id, conversationId: null, turnId: null, mediaType: "image/png", size: text.length, sha256: sha(text), storagePath: canonicalPath, retention: "kept", provenance: "composer:upload", createdAt: new Date().toISOString(), hlc: nextHlc() }).run();
    db.insert(fileBlobRemovals).values({ storagePath: duplicatePath, queuedAt: new Date().toISOString() }).run();
    return { canonicalPath, duplicatePath };
  }
  test("the duplicate is removed once the one stored file is confirmed on disk and hashes right", async () => {
    const { canonicalPath, duplicatePath } = seed("duplicate A", true);
    expect(await reclaimQueuedBlobs()).toEqual({ removed: 1, promoted: 0, kept: 0, dropped: 0 });
    expect(existsSync(attachmentFilePath(canonicalPath))).toBe(true);
    expect(existsSync(attachmentFilePath(duplicatePath))).toBe(false);
    expect(db.select().from(fileBlobRemovals).all()).toHaveLength(0);
  });
  test("when the one stored file is missing, the duplicate is moved into its place instead of deleted", async () => {
    const { canonicalPath, duplicatePath } = seed("duplicate B!", false);
    expect(await reclaimQueuedBlobs()).toEqual({ removed: 0, promoted: 1, kept: 0, dropped: 0 });
    expect(readFileSync(attachmentFilePath(canonicalPath), "utf8")).toBe("duplicate B!");
    expect(existsSync(attachmentFilePath(duplicatePath))).toBe(false);
  });
  test("when the one stored file is damaged, the good duplicate replaces it instead of being deleted", async () => {
    const { canonicalPath, duplicatePath } = seed("duplicate D!!", true);
    writeFileSync(attachmentFilePath(canonicalPath), "truncated");
    expect(await reclaimQueuedBlobs()).toEqual({ removed: 0, promoted: 1, kept: 0, dropped: 0 });
    expect(readFileSync(attachmentFilePath(canonicalPath), "utf8")).toBe("duplicate D!!");
    expect(existsSync(attachmentFilePath(duplicatePath))).toBe(false);
  });
  test("a path a record still names is never removed", async () => {
    const { duplicatePath } = seed("duplicate C", true);
    const sage = db.select().from(people).get()!;
    db.insert(attachments).values({ id: "file-stillnamed", ownerPersonId: sage.id, conversationId: null, turnId: null, mediaType: "image/png", size: 3, sha256: sha("other"), storagePath: duplicatePath, retention: "kept", provenance: "composer:upload", createdAt: new Date().toISOString(), hlc: nextHlc() }).run();
    expect((await reclaimQueuedBlobs()).dropped).toBe(1);
    expect(existsSync(attachmentFilePath(duplicatePath))).toBe(true);
  });
});

describe("migration 0117 on a database from before it", () => {
  const migrations = join(dirname(new URL(import.meta.url).pathname), "..", "src", "db", "migrations");
  function legacyDatabase() {
    const folder = mkdtempSync(join(tmpdir(), "dedup-migration-"));
    cpSync(migrations, folder, { recursive: true });
    rmSync(join(folder, "0117_library_dedup.sql"));
    const journalPath = join(folder, "meta", "_journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: Array<{ tag: string }> };
    journal.entries = journal.entries.filter((entry) => entry.tag !== "0117_library_dedup");
    writeFileSync(journalPath, JSON.stringify(journal));
    const database = new Database(":memory:");
    migrate(drizzle(database), { migrationsFolder: folder });
    rmSync(folder, { recursive: true, force: true });
    return database;
  }
  const insert = (database: Database, table: string, values: Record<string, unknown>) => {
    const columns = database.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string; notnull: number; dflt_value: string | null; type: string }>;
    const filled: Record<string, unknown> = { ...values };
    for (const column of columns) if (column.notnull && column.dflt_value === null && !(column.name in filled)) filled[column.name] = column.type.toUpperCase().includes("INT") || column.type.toUpperCase() === "REAL" ? 0 : "x";
    database.query(`INSERT INTO ${table} (${Object.keys(filled).map((k) => `"${k}"`).join(",")}) VALUES (${Object.keys(filled).map(() => "?").join(",")})`).run(...(Object.values(filled) as never[]));
  };
  const attachment = (database: Database, id: string, owner: string, hash: string, path: string, extra: Record<string, unknown> = {}) =>
    insert(database, "attachments", { id, owner_person_id: owner, media_type: "image/png", size: 10, sha256: hash, storage_path: path, retention: "conversation", provenance: "composer:upload", origin: "sent", created_at: `2026-10-0${id.length % 9 + 1}T00:00:00.000Z`, hlc: "1:0:aaaaaa", ...extra });
  function run0117(database: Database) {
    const sql = readFileSync(join(migrations, "0117_library_dedup.sql"), "utf8");
    for (const statement of sql.split("--> statement-breakpoint")) if (statement.trim()) database.exec(statement);
  }

  test("builds the content and reference rows, folds duplicates, converts dedupe pointers, and keeps counts and bytes", () => {
    const database = legacyDatabase();
    database.exec("PRAGMA foreign_keys = ON");
    insert(database, "people", { id: "person-sage000001", role: "owner", display_name: "Sage" });
    insert(database, "people", { id: "person-lucia00001", role: "adult", display_name: "Lucia" });
    insert(database, "people", { id: "person-gone000001", role: "adult", display_name: "Gone", deleted_at: "2026-10-01T00:00:00.000Z" });
    insert(database, "people", { id: "person-teen000001", role: "teen", display_name: "Riff" });
    insert(database, "conversations", { id: "conv-1", person_id: "person-sage000001" });
    insert(database, "conversation_turns", { id: "turn-1", person_id: "person-sage000001", conversation_id: "conv-1" });
    // The first upload, and a dedupe pointer that gave Lucia no record of her own.
    attachment(database, "file-aaaaaaaaa1", "person-sage000001", "a".repeat(64), "people/person-sage000001/attachments/file-aaaaaaaaa1", { conversation_id: "conv-1", turn_id: "turn-1" });
    insert(database, "shares", { id: "share-dedupe0001", file_id: "file-aaaaaaaaa1", from_person_id: "person-sage000001", to: "person-lucia00001", provenance: "dedupe:same-bytes" });
    insert(database, "shares", { id: "share-dedupe0002", file_id: "file-aaaaaaaaa1", from_person_id: "person-sage000001", to: "person-gone000001", provenance: "dedupe:same-bytes" });
    insert(database, "shares", { id: "share-dedupe0003", file_id: "file-aaaaaaaaa1", from_person_id: "person-sage000001", to: "person-teen000001", provenance: "dedupe:same-bytes" });
    insert(database, "shares", { id: "share-human00001", file_id: "file-aaaaaaaaa1", from_person_id: "person-sage000001", to: "household", provenance: "files-page:share" });
    // The same bytes stored twice by one person with different paths (two generated pictures), plus one unique file.
    attachment(database, "file-bbbbbbbbb1", "person-sage000001", "b".repeat(64), "people/person-sage000001/attachments/file-bbbbbbbbb1", { created_at: "2026-10-01T00:00:00.000Z" });
    attachment(database, "file-bbbbbbbbb2", "person-sage000001", "b".repeat(64), "people/person-sage000001/attachments/file-bbbbbbbbb2", { created_at: "2026-10-02T00:00:00.000Z" });
    attachment(database, "file-ccccccccc1", "person-lucia00001", "c".repeat(64), "people/person-lucia00001/attachments/file-ccccccccc1");
    const before = database.query("SELECT count(*) AS n, sum(size) AS bytes FROM attachments").get() as { n: number; bytes: number };

    run0117(database);

    expect(database.query("SELECT count(*) AS n FROM file_contents").get()).toEqual({ n: 3 });
    expect((database.query("SELECT storage_path FROM file_contents WHERE sha256 = ?").get("b".repeat(64)) as { storage_path: string }).storage_path).toBe("people/person-sage000001/attachments/file-bbbbbbbbb1");
    expect((database.query("SELECT storage_path FROM attachments WHERE id = 'file-bbbbbbbbb2'").get() as { storage_path: string }).storage_path).toBe("people/person-sage000001/attachments/file-bbbbbbbbb1");
    expect(database.query("SELECT storage_path FROM file_blob_removals").all()).toEqual([{ storage_path: "people/person-sage000001/attachments/file-bbbbbbbbb2" }]);
    // Lucia's pointer became her own record on the same stored file; the pointer for a deleted person is only dropped.
    const luciaCopy = database.query("SELECT * FROM attachments WHERE owner_person_id = 'person-lucia00001' AND sha256 = ?").get("a".repeat(64)) as { storage_path: string; retention: string; id: string };
    expect(luciaCopy.storage_path).toBe("people/person-sage000001/attachments/file-aaaaaaaaa1");
    expect(luciaCopy.retention).toBe("kept");
    // A teen's pointer is never converted (ownership would lift the audience gate): it stays exactly as it was.
    expect(database.query("SELECT count(*) AS n FROM attachments WHERE owner_person_id = 'person-teen000001'").get()).toEqual({ n: 0 });
    expect(database.query("SELECT id FROM shares ORDER BY id").all()).toEqual([{ id: "share-dedupe0002" }, { id: "share-dedupe0003" }, { id: "share-human00001" }]);
    const after = database.query("SELECT count(*) AS n, sum(size) AS bytes FROM attachments").get() as { n: number; bytes: number };
    expect(after.n).toBe(before.n + 1);
    const kinds = database.query("SELECT kind, count(*) AS n FROM file_references GROUP BY kind ORDER BY kind").all();
    expect(kinds).toEqual([{ kind: "chat", n: 1 }, { kind: "owner", n: 5 }, { kind: "share", n: 3 }]);
    expect(database.query("SELECT count(*) AS n FROM file_references r LEFT JOIN file_contents c ON c.sha256 = r.sha256 WHERE c.sha256 IS NULL").get()).toEqual({ n: 0 });
    expect((database.query("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check).toBe("ok");
    expect(database.query("PRAGMA foreign_key_check").all()).toEqual([]);
    database.close();
  });
});
