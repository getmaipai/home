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
//
// PROJECTS-P1 (spec-v0.1.90): a project also has a colour, icon, description,
// instructions, a pin, an archive stamp, a memory mode and a share list.
// Access is one of three levels (the `access` field of every response):
// manage (the owner, or an owner/admin for a child's project), edit (a
// can_edit member: name, icon, colour, description, instructions) and use
// (a can_use member, or a child on the project a parent made). Shares are
// record-only: a member never gains access to the owner's chats, memory or
// any prompt path, and a chat still joins only its own person's project
// (checkFolderFor). memory_mode is stored only; no recall filter reads it yet.
// Description and instructions of a minor's project pass the safety floor on
// save (the stricter of the owner's and the editor's band).
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "@hono/zod-openapi";
import { ChatFolder } from "@maipai/spec/gen/ts/chat-folder.js";
import projectIcons from "@maipai/spec/vocab/project-icons.json" with { type: "json" };
import { db, sqlite } from "@/db";
import { chatFolders, chatFolderShares, people } from "@/db/schema";
import { canAccessPerson, getPersonRole, isOwnerOrAdmin } from "@/lib/access";
import { speakerAgeBand, type AgeBand } from "@/lib/ageBand";
import { nextHlc } from "@/lib/hlc";
import { newChatFolderId } from "@/lib/id";
import { evaluateSafety } from "@/lib/safety";
import type { PersonRow } from "@/types";

export type ChatFolderRecord = ChatFolder;

export type FolderAccess = "manage" | "edit" | "use";

/** The one response shape of every /api/chat-folders route: the spec record
 * plus what depends on who is asking (access) or is computed (counts,
 * last_activity_at). The spec's own fields are never redeclared here. */
export const ChatFolderView = ChatFolder.extend({
  access: z.enum(["manage", "edit", "use"]).describe("What the caller may do: manage (owner or parent), edit (can_edit member), use (can_use member, or a child)."),
  last_activity_at: z.string().describe("The latest of the project's own change and the newest chat in it."),
  counts: z.object({ chats: z.number().int(), files: z.number().int(), artifacts: z.number().int() }),
});
export type ChatFolderView = z.infer<typeof ChatFolderView>;

export type FolderOpResult<T> = { ok: true; value: T } | { ok: false; status: 400 | 403 | 404; error: string };

type ChatFolderRow = typeof chatFolders.$inferSelect;
type ShareRow = typeof chatFolderShares.$inferSelect;

export const MAX_SHARES = 20;
const ICONS = new Set<string>(projectIcons.icons);

function sharesOf(folderId: string): Array<{ person: string; role: "can_use" | "can_edit" }> {
  return db
    .select()
    .from(chatFolderShares)
    .where(eq(chatFolderShares.folderId, folderId))
    .orderBy(asc(chatFolderShares.createdAt), asc(chatFolderShares.personId))
    .all()
    .map((s) => ({ person: s.personId, role: s.role as "can_use" | "can_edit" }));
}

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
    color: row.color,
    icon: row.icon,
    description: row.description,
    instructions: row.instructions,
    pinned: row.pinned,
    pinned_at: row.pinnedAt,
    archived_at: row.archivedAt,
    memory_mode: row.memoryMode,
    shares: sharesOf(row.id),
  });
}

function personRow(personId: string): PersonRow | undefined {
  return db.select().from(people).where(eq(people.id, personId)).get() as PersonRow | undefined;
}

function bandOfPerson(personId: string): AgeBand {
  const row = personRow(personId);
  return row ? speakerAgeBand(row, new Date()) : "child";
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

function shareRow(folderId: string, personId: string): ShareRow | undefined {
  return db.select().from(chatFolderShares).where(and(eq(chatFolderShares.folderId, folderId), eq(chatFolderShares.personId, personId))).get();
}

/** What `actor` may do with `row`, or null for nothing (a 404). A teen's
 * project reaches an admin only through the teen's own share, never through
 * canAccessPerson. A child never gets more than "use". */
export function folderAccess(actor: PersonRow, row: ChatFolderRow): FolderAccess | null {
  if (actor.id === row.personId) return actor.role === "child" ? "use" : "manage";
  if (canAccessPerson(actor, row.personId)) return "manage";
  const share = shareRow(row.id, actor.id);
  if (!share) return null;
  if (share.role === "can_edit" && actor.role !== "child") return "edit";
  return "use";
}

/** The live folder `actor` can see, or null (a 404 for anyone else's,
 * deleted, or unknown, never telling the three apart). */
export function visibleFolder(actor: PersonRow, id: string): ChatFolderRow | null {
  const row = liveRow(id);
  if (!row || folderAccess(actor, row) === null) return null;
  return row;
}

function countsFor(row: ChatFolderRow, chatsOf: string): { counts: ChatFolderView["counts"]; lastChat: string | null } {
  const chats = sqlite
    .query("SELECT COUNT(*) AS n, MAX(updated_at) AS m FROM conversations WHERE folder_id = ? AND person_id = ? AND status != 'deleted' AND mode != 'temporary' AND archived = 0")
    .get(row.id, chatsOf) as { n: number; m: string | null };
  const artifacts = sqlite
    .query("SELECT COUNT(DISTINCT a.artifact_key) AS n FROM artifacts a JOIN conversations c ON c.id = a.conversation_id WHERE c.folder_id = ? AND c.person_id = ? AND c.status != 'deleted' AND c.mode != 'temporary'")
    .get(row.id, chatsOf) as { n: number };
  return { counts: { chats: chats.n, files: 0, artifacts: artifacts.n }, lastChat: chats.m };
}

function toView(actor: PersonRow, row: ChatFolderRow, access: FolderAccess): ChatFolderView {
  const { counts, lastChat } = countsFor(row, access === "manage" ? row.personId : actor.id);
  const last = lastChat && lastChat > row.updatedAt ? lastChat : row.updatedAt;
  return ChatFolderView.parse({ ...toRecord(row), access, last_activity_at: last, counts });
}

export interface ListOptions {
  person?: string;
  q?: string;
  archived?: boolean;
  scope?: "mine" | "shared" | "all";
  sort?: "order" | "updated";
}

/** Projects, pinned first (newest pin first), then by `sort`: "order" (the
 * default: sort_order, newest first) or "updated" (last activity, newest
 * first). `scope` mine (default) is the person's own, shared is what others
 * shared with the caller, all is both. A search `q` matches name and
 * description, case-insensitively. Archived ones only with archived=true. */
export function listChatFolders(actor: PersonRow, opts: ListOptions = {}): ChatFolderView[] {
  const scope = opts.scope ?? "mine";
  const target = opts.person ?? actor.id;
  const rows: ChatFolderRow[] = [];
  if (scope !== "shared" && canAccessPerson(actor, target)) {
    rows.push(...db.select().from(chatFolders).where(and(eq(chatFolders.personId, target), isNull(chatFolders.deletedAt))).all());
  }
  if (scope !== "mine") {
    const ids = db.select({ id: chatFolderShares.folderId }).from(chatFolderShares).where(eq(chatFolderShares.personId, actor.id)).all().map((r) => r.id);
    if (ids.length > 0) {
      for (const row of db.select().from(chatFolders).where(and(inArray(chatFolders.id, ids), isNull(chatFolders.deletedAt))).all()) {
        if (!rows.some((r) => r.id === row.id)) rows.push(row);
      }
    }
  }
  const needle = opts.q?.trim().toLowerCase() ?? "";
  const views = rows
    .filter((row) => (opts.archived ? row.archivedAt !== null : row.archivedAt === null))
    .filter((row) => needle === "" || row.name.toLowerCase().includes(needle) || row.description.toLowerCase().includes(needle))
    .map((row) => ({ row, access: folderAccess(actor, row) }))
    .filter((e): e is { row: ChatFolderRow; access: FolderAccess } => e.access !== null)
    .map(({ row, access }) => toView(actor, row, access));
  const rowOf = new Map(rows.map((r) => [r.id, r]));
  const byOrder = (a: ChatFolderView, b: ChatFolderView) => a.sort_order - b.sort_order || (rowOf.get(b.id)!.createdAt < rowOf.get(a.id)!.createdAt ? -1 : rowOf.get(b.id)!.createdAt > rowOf.get(a.id)!.createdAt ? 1 : 0) || a.id.localeCompare(b.id);
  const byUpdated = (a: ChatFolderView, b: ChatFolderView) => (a.last_activity_at < b.last_activity_at ? 1 : a.last_activity_at > b.last_activity_at ? -1 : 0) || a.id.localeCompare(b.id);
  const tie = opts.sort === "updated" ? byUpdated : byOrder;
  return views.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (a.pinned && b.pinned && a.pinned_at !== b.pinned_at) return (a.pinned_at ?? "") < (b.pinned_at ?? "") ? 1 : -1;
    return tie(a, b);
  });
}

/** One project the caller can see, with counts. */
export function getChatFolder(actor: PersonRow, id: string): FolderOpResult<ChatFolderView> {
  const row = liveRow(id);
  const access = row ? folderAccess(actor, row) : null;
  if (!row || !access) return { ok: false, status: 404, error: "project not found" };
  return { ok: true, value: toView(actor, row, access) };
}

function cleanName(name: unknown): FolderOpResult<string> {
  if (typeof name !== "string") return { ok: false, status: 400, error: "name is required" };
  const trimmed = name.trim();
  if (trimmed.length === 0) return { ok: false, status: 400, error: "name is required" };
  if (trimmed.length > 80) return { ok: false, status: 400, error: "name must be 80 characters or fewer" };
  return { ok: true, value: trimmed };
}

type FieldSet = Partial<Pick<ChatFolderRow, "name" | "color" | "icon" | "description" | "instructions" | "memoryMode">>;

/** The bounds of the look and notes fields, shared by create and patch. */
function checkLookFields(input: Record<string, unknown>): FolderOpResult<FieldSet> {
  const set: FieldSet = {};
  if (input.name !== undefined) {
    const name = cleanName(input.name);
    if (!name.ok) return name;
    set.name = name.value;
  }
  if (input.color !== undefined) {
    const color = ChatFolder.shape.color.safeParse(input.color);
    if (!color.success) return { ok: false, status: 400, error: "color must be one of the project colours" };
    set.color = color.data;
  }
  if (input.icon !== undefined) {
    if (typeof input.icon !== "string" || !ICONS.has(input.icon)) return { ok: false, status: 400, error: "icon must be one of the project icons" };
    set.icon = input.icon;
  }
  if (input.description !== undefined) {
    if (typeof input.description !== "string" || input.description.length > 500) return { ok: false, status: 400, error: "description must be 500 characters or fewer" };
    set.description = input.description.trim();
  }
  if (input.instructions !== undefined) {
    if (typeof input.instructions !== "string" || input.instructions.length > 1500) return { ok: false, status: 400, error: "instructions must be 1500 characters or fewer" };
    set.instructions = input.instructions.trim();
  }
  if (input.memory_mode !== undefined) {
    const mode = ChatFolder.shape.memory_mode.safeParse(input.memory_mode);
    if (!mode.success) return { ok: false, status: 400, error: "memory_mode must be shared or project_only" };
    set.memoryMode = mode.data;
  }
  return { ok: true, value: set };
}

/** The output floor on save: a minor owner's or editor's description and
 * instructions are read with the stricter of the two bands; a flagged text
 * is refused. An adult's own are not floored. */
function floorRefuses(set: FieldSet, ownerId: string, actor: PersonRow, folderId?: string): boolean {
  const bands: AgeBand[] = [bandOfPerson(ownerId), speakerAgeBand(actor, new Date())];
  // A project shared with a child shows its description to that child, so the
  // child's floor applies to what is saved from then on.
  if (folderId) for (const s of sharesOf(folderId)) bands.push(bandOfPerson(s.person));
  if (bands.every((b) => b === "adult")) return false;
  const band: AgeBand = bands.includes("child") ? "child" : "teen";
  return [set.description, set.instructions].some((text) => text !== undefined && text !== "" && evaluateSafety(text, band).flagged);
}

const FLOOR_ERROR = "that text is not allowed in a child's or teen's project";

export type CreateInput = { name: unknown; person?: string | null } & Record<string, unknown>;

export function createChatFolder(actor: PersonRow, input: CreateInput): FolderOpResult<ChatFolderView> {
  const target = input.person ?? actor.id;
  if (!canAccessPerson(actor, target) || getPersonRole(target) === undefined) return { ok: false, status: 404, error: "person not found" };
  if (!canManageFolders(actor, target)) return { ok: false, status: 403, error: "a child's projects are made by a parent" };
  const fields = checkLookFields(input);
  if (!fields.ok) return fields;
  if (fields.value.name === undefined) return { ok: false, status: 400, error: "name is required" };
  if (floorRefuses(fields.value, target, actor)) return { ok: false, status: 400, error: FLOOR_ERROR };
  const now = new Date().toISOString();
  const id = newChatFolderId();
  const row: ChatFolderRow = {
    id,
    personId: target,
    name: fields.value.name,
    sortOrder: 0,
    source: "hub",
    provenance: `${actor.id} (${actor.id === target ? "self" : "parent"})`,
    hlc: nextHlc(),
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    color: fields.value.color ?? "neutral",
    icon: fields.value.icon ?? "folder",
    description: fields.value.description ?? "",
    instructions: fields.value.instructions ?? "",
    pinned: false,
    pinnedAt: null,
    archivedAt: null,
    // The owner's 2026-10-06 answer: a NEW project starts with only its own memories.
    memoryMode: fields.value.memoryMode ?? "project_only",
  };
  toRecord(row); // validates the spec shape before anything is written
  db.insert(chatFolders).values(row).run();
  return { ok: true, value: toView(actor, row, folderAccess(actor, row)!) };
}

export interface PatchInput extends Record<string, unknown> {
  sort_order?: unknown;
  pinned?: unknown;
  archived?: unknown;
}

const MANAGE_ONLY = ["sort_order", "pinned", "archived", "memory_mode"] as const;

export function updateChatFolder(actor: PersonRow, id: string, patch: PatchInput): FolderOpResult<ChatFolderView> {
  const row = visibleFolder(actor, id);
  if (!row) return { ok: false, status: 404, error: "project not found" };
  const access = folderAccess(actor, row)!;
  if (access === "use") return { ok: false, status: 403, error: row.personId === actor.id ? "a child's projects are changed by a parent" : "you can use this project, not change it" };
  if (access === "edit" && MANAGE_ONLY.some((k) => patch[k] !== undefined)) return { ok: false, status: 403, error: "only the owner changes that" };
  const fields = checkLookFields(patch);
  if (!fields.ok) return fields;
  const set: Partial<ChatFolderRow> = { ...fields.value };
  if (patch.sort_order !== undefined) {
    if (typeof patch.sort_order !== "number" || !Number.isInteger(patch.sort_order) || patch.sort_order < 0) {
      return { ok: false, status: 400, error: "sort_order must be a whole number, 0 or more" };
    }
    set.sortOrder = patch.sort_order;
  }
  const now = new Date().toISOString();
  if (patch.pinned !== undefined) {
    if (typeof patch.pinned !== "boolean") return { ok: false, status: 400, error: "pinned must be true or false" };
    set.pinned = patch.pinned;
    set.pinnedAt = patch.pinned ? (row.pinned ? row.pinnedAt : now) : null;
  }
  if (patch.archived !== undefined) {
    if (typeof patch.archived !== "boolean") return { ok: false, status: 400, error: "archived must be true or false" };
    set.archivedAt = patch.archived ? (row.archivedAt ?? now) : null;
  }
  if (set.memoryMode === "shared" && sharesOf(row.id).length > 0) {
    return { ok: false, status: 400, error: "a shared project uses only this project's memory" };
  }
  if (Object.keys(set).length === 0) return { ok: false, status: 400, error: "nothing to change" };
  if (floorRefuses(fields.value, row.personId, actor, row.id)) return { ok: false, status: 400, error: FLOOR_ERROR };
  db.update(chatFolders).set({ ...set, updatedAt: now, hlc: nextHlc() }).where(eq(chatFolders.id, id)).run();
  return { ok: true, value: toView(actor, liveRow(id)!, access) };
}

/** Adds a member or changes their role. Owner (or a parent for a child's
 * project) only. Only an owner or admin may add a child; a child is never
 * can_edit. The first share sets the project to project_only memory. */
export function setFolderShare(actor: PersonRow, folderId: string, targetId: string, role: unknown): FolderOpResult<ChatFolderView> {
  const row = visibleFolder(actor, folderId);
  if (!row) return { ok: false, status: 404, error: "project not found" };
  if (folderAccess(actor, row) !== "manage") return { ok: false, status: 403, error: "only the owner shares a project" };
  if (role !== "can_use" && role !== "can_edit") return { ok: false, status: 400, error: "role must be can_use or can_edit" };
  const target = personRow(targetId);
  if (!target || target.deletedAt) return { ok: false, status: 404, error: "person not found" };
  if (target.id === row.personId) return { ok: false, status: 400, error: "the owner already has this project" };
  if (target.role === "guest") return { ok: false, status: 400, error: "a guest cannot be added to a project" };
  if (target.role === "child") {
    if (!isOwnerOrAdmin(actor)) return { ok: false, status: 403, error: "only a parent adds a child to a project" };
    if (role === "can_edit") return { ok: false, status: 400, error: "a child can use a project but not edit it" };
  }
  // A child is shown the project's description, so it must pass the child floor now.
  if (target.role === "child" && row.description !== "" && evaluateSafety(row.description, "child").flagged) {
    return { ok: false, status: 400, error: "this project's description is not suitable to share with a child" };
  }
  const existing = shareRow(folderId, targetId);
  if (existing?.role === role) return { ok: true, value: toView(actor, row, "manage") };
  if (!existing && sharesOf(folderId).length >= MAX_SHARES) return { ok: false, status: 400, error: `a project can be shared with ${MAX_SHARES} people at most` };
  const now = new Date().toISOString();
  sqlite.transaction(() => {
    if (existing) db.update(chatFolderShares).set({ role }).where(and(eq(chatFolderShares.folderId, folderId), eq(chatFolderShares.personId, targetId))).run();
    else db.insert(chatFolderShares).values({ folderId, personId: targetId, role, createdAt: now }).run();
    db.update(chatFolders).set({ memoryMode: "project_only", updatedAt: now, hlc: nextHlc() }).where(eq(chatFolders.id, folderId)).run();
  })();
  return { ok: true, value: toView(actor, liveRow(folderId)!, "manage") };
}

/** Removes a member: the owner (or parent) removes anyone, a member may
 * remove themself (leave). */
export function removeFolderShare(actor: PersonRow, folderId: string, targetId: string): FolderOpResult<ChatFolderView | { left: true }> {
  const row = visibleFolder(actor, folderId);
  if (!row) return { ok: false, status: 404, error: "project not found" };
  const access = folderAccess(actor, row)!;
  const leaving = actor.id === targetId && actor.id !== row.personId;
  if (access !== "manage" && !leaving) return { ok: false, status: 403, error: "only the owner removes people from a project" };
  if (!shareRow(folderId, targetId)) return { ok: false, status: 404, error: "that person is not a member" };
  const now = new Date().toISOString();
  sqlite.transaction(() => {
    db.delete(chatFolderShares).where(and(eq(chatFolderShares.folderId, folderId), eq(chatFolderShares.personId, targetId))).run();
    db.update(chatFolders).set({ updatedAt: now, hlc: nextHlc() }).where(eq(chatFolders.id, folderId)).run();
  })();
  if (leaving) return { ok: true, value: { left: true } };
  return { ok: true, value: toView(actor, liveRow(folderId)!, access) };
}

/** Tombstones the folder, drops its shares and takes every chat out of it;
 * the chats stay. `files_removed` is 0 until projects hold files. */
export function deleteChatFolder(actor: PersonRow, id: string): FolderOpResult<{ chats_kept: number; files_removed: number }> {
  const row = visibleFolder(actor, id);
  if (!row) return { ok: false, status: 404, error: "project not found" };
  if (folderAccess(actor, row) !== "manage") return { ok: false, status: 403, error: row.personId === actor.id ? "a child's projects are changed by a parent" : "only the owner deletes a project" };
  const now = new Date().toISOString();
  const kept = sqlite.transaction(() => {
    const moved = sqlite.query("UPDATE conversations SET folder_id = NULL, hlc = ? WHERE folder_id = ?").run(nextHlc(), id).changes;
    sqlite.query("DELETE FROM chat_folder_shares WHERE folder_id = ?").run(id);
    db.update(chatFolders).set({ deletedAt: now, updatedAt: now, hlc: nextHlc() }).where(eq(chatFolders.id, id)).run();
    return moved;
  })();
  return { ok: true, value: { chats_kept: kept, files_removed: 0 } };
}

/** Person deletion: takes every chat (anyone's) out of the person's projects,
 * drops those projects' shares and every share naming the person. The caller
 * then deletes the folder rows. */
export function eraseChatFolderReferences(personId: string): void {
  sqlite.query("UPDATE conversations SET folder_id = NULL, hlc = ? WHERE folder_id IN (SELECT id FROM chat_folders WHERE person_id = ?)").run(nextHlc(), personId);
  sqlite.query("DELETE FROM chat_folder_shares WHERE person_id = ? OR folder_id IN (SELECT id FROM chat_folders WHERE person_id = ?)").run(personId, personId);
}

/** The folder a chat of `personId` may join: live, and that person's own.
 * Null `folderId` always passes (it means "no project"). Shares are
 * record-only, so a member cannot put a chat in the owner's project. */
export function checkFolderFor(personId: string, folderId: string | null): FolderOpResult<string | null> {
  if (folderId === null) return { ok: true, value: null };
  if (typeof folderId !== "string") return { ok: false, status: 400, error: "folder_id must be a project id or null" };
  const row = liveRow(folderId);
  if (!row || row.personId !== personId) return { ok: false, status: 400, error: "that project is not one of this person's" };
  return { ok: true, value: row.id };
}
