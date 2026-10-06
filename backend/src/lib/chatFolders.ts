// PROJECTS-01a (CHAT-PROJECT-01): chat folders, shown to people as
// Projects in the chat column. One person's own named group of their chat
// conversations. Every row crosses the spec's generated ChatFolder
// validator (spec/schemas/chat-folder.schema.json, spec-v0.1.87), so a row
// is always the spec shape, never a second definition here.
//
// Who may do what (CHAT-UI-SPEC section 9; rule 0):
// - Reading follows canAccessPerson: yourself, or an owner or admin for a
//   child. A teen's folders are private, the same as their chats.
// - An adult or a teen makes, renames and deletes their own.
// - A child never makes, renames or deletes one; an owner or admin may do
//   that for a child ("own folders made by a parent or none"). A child may
//   still move their own chats in and out of a folder a parent made.
//
// Deleting a folder keeps its chats: their folder_id goes back to null.
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { ChatFolder } from "@maipai/spec/gen/ts/chat-folder.js";
import { db, sqlite } from "@/db";
import { chatFolders } from "@/db/schema";
import { canAccessPerson, getPersonRole } from "@/lib/access";
import { nextHlc } from "@/lib/hlc";
import { newChatFolderId } from "@/lib/id";
import type { PersonRow } from "@/types";

export type ChatFolderRecord = ChatFolder;

export type FolderOpResult<T> = { ok: true; value: T } | { ok: false; status: 400 | 403 | 404; error: string };

type ChatFolderRow = typeof chatFolders.$inferSelect;

function toRecord(row: ChatFolderRow): ChatFolder {
  return ChatFolder.parse({
    id: row.id,
    person: row.personId,
    name: row.name,
    sort_order: row.sortOrder,
    source: row.source,
    provenance: row.provenance,
    hlc: row.hlc,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    deleted_at: row.deletedAt,
  });
}

/** Whether `actor` may make, rename or delete folders for `personId`: an
 * adult or teen for themself, an owner or admin for a child. A child never
 * manages their own. */
export function canManageFolders(actor: PersonRow, personId: string): boolean {
  if (actor.id === personId) return actor.role !== "child";
  return canAccessPerson(actor, personId);
}

function liveRow(id: string): ChatFolderRow | undefined {
  return db.select().from(chatFolders).where(and(eq(chatFolders.id, id), isNull(chatFolders.deletedAt))).get();
}

/** The live folder `actor` can see, or null (a 404 for anyone else's,
 * deleted, or unknown, never telling the three apart). */
export function visibleFolder(actor: PersonRow, id: string): ChatFolderRow | null {
  const row = liveRow(id);
  if (!row || !canAccessPerson(actor, row.personId)) return null;
  return row;
}

/** A person's live folders, by sort_order then newest first. Empty for a
 * person `actor` cannot see. */
export function listChatFolders(actor: PersonRow, personId?: string): ChatFolder[] {
  const target = personId ?? actor.id;
  if (!canAccessPerson(actor, target)) return [];
  return db
    .select()
    .from(chatFolders)
    .where(and(eq(chatFolders.personId, target), isNull(chatFolders.deletedAt)))
    .orderBy(asc(chatFolders.sortOrder), desc(chatFolders.createdAt), asc(chatFolders.id))
    .all()
    .map(toRecord);
}

function cleanName(name: unknown): FolderOpResult<string> {
  if (typeof name !== "string") return { ok: false, status: 400, error: "name is required" };
  const trimmed = name.trim();
  if (trimmed.length === 0) return { ok: false, status: 400, error: "name is required" };
  if (trimmed.length > 80) return { ok: false, status: 400, error: "name must be 80 characters or fewer" };
  return { ok: true, value: trimmed };
}

export function createChatFolder(actor: PersonRow, input: { name: unknown; person?: string | null }): FolderOpResult<ChatFolder> {
  const target = input.person ?? actor.id;
  if (!canAccessPerson(actor, target) || getPersonRole(target) === undefined) return { ok: false, status: 404, error: "person not found" };
  if (!canManageFolders(actor, target)) return { ok: false, status: 403, error: "a child's projects are made by a parent" };
  const name = cleanName(input.name);
  if (!name.ok) return name;
  const now = new Date().toISOString();
  const record = ChatFolder.parse({
    id: newChatFolderId(),
    person: target,
    name: name.value,
    sort_order: 0,
    source: "hub",
    provenance: `${actor.id} (${actor.id === target ? "self" : "parent"})`,
    hlc: nextHlc(),
    created_at: now,
    updated_at: now,
    deleted_at: null,
  });
  db.insert(chatFolders)
    .values({
      id: record.id,
      personId: record.person,
      name: record.name,
      sortOrder: record.sort_order ?? 0,
      source: record.source,
      provenance: record.provenance,
      hlc: record.hlc,
      createdAt: record.created_at,
      updatedAt: record.updated_at,
      deletedAt: null,
    })
    .run();
  return { ok: true, value: record };
}

export function updateChatFolder(actor: PersonRow, id: string, patch: { name?: unknown; sort_order?: unknown }): FolderOpResult<ChatFolder> {
  const row = visibleFolder(actor, id);
  if (!row) return { ok: false, status: 404, error: "project not found" };
  if (!canManageFolders(actor, row.personId)) return { ok: false, status: 403, error: "a child's projects are changed by a parent" };
  const set: Partial<ChatFolderRow> = {};
  if (patch.name !== undefined) {
    const name = cleanName(patch.name);
    if (!name.ok) return name;
    set.name = name.value;
  }
  if (patch.sort_order !== undefined) {
    if (typeof patch.sort_order !== "number" || !Number.isInteger(patch.sort_order) || patch.sort_order < 0) {
      return { ok: false, status: 400, error: "sort_order must be a whole number, 0 or more" };
    }
    set.sortOrder = patch.sort_order;
  }
  if (Object.keys(set).length === 0) return { ok: false, status: 400, error: "nothing to change" };
  const now = new Date().toISOString();
  db.update(chatFolders).set({ ...set, updatedAt: now, hlc: nextHlc() }).where(eq(chatFolders.id, id)).run();
  return { ok: true, value: toRecord(liveRow(id)!) };
}

/** Tombstones the folder and takes every chat out of it; the chats stay. */
export function deleteChatFolder(actor: PersonRow, id: string): FolderOpResult<{ chats_kept: number }> {
  const row = visibleFolder(actor, id);
  if (!row) return { ok: false, status: 404, error: "project not found" };
  if (!canManageFolders(actor, row.personId)) return { ok: false, status: 403, error: "a child's projects are changed by a parent" };
  const now = new Date().toISOString();
  const kept = sqlite.transaction(() => {
    const moved = sqlite.query("UPDATE conversations SET folder_id = NULL, hlc = ? WHERE folder_id = ?").run(nextHlc(), id).changes;
    db.update(chatFolders).set({ deletedAt: now, updatedAt: now, hlc: nextHlc() }).where(eq(chatFolders.id, id)).run();
    return moved;
  })();
  return { ok: true, value: { chats_kept: kept } };
}

/** The folder a chat of `personId` may join: live, and that person's own.
 * Null `folderId` always passes (it means "no project"). */
export function checkFolderFor(personId: string, folderId: string | null): FolderOpResult<string | null> {
  if (folderId === null) return { ok: true, value: null };
  if (typeof folderId !== "string") return { ok: false, status: 400, error: "folder_id must be a project id or null" };
  const row = liveRow(folderId);
  if (!row || row.personId !== personId) return { ok: false, status: 400, error: "that project is not one of this person's" };
  return { ok: true, value: row.id };
}
