import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { toolUndo, scheduledJobs, lists } from "@/db/schema";
import { newToolUndoId } from "@/lib/id";
import { cancelJob } from "@/lib/scheduler";
import { deleteList, editItem, getList, moveItems, removeItem, updateList } from "@/lib/lists";
import { rescheduleReminder, restoreReminder } from "@/lib/reminderActions";
import { recordToolAudit } from "@/lib/toolAudit";
import { nextHlc } from "@/lib/hlc";
import type { PersonRow } from "@/types";

export type UndoInverse =
  | { kind: "cancel_reminder"; id: string }
  | { kind: "remove_item"; listId: string; itemId: string }
  | { kind: "restore_list"; listId: string }
  | { kind: "remove_list"; listId: string }
  | { kind: "rename_list"; listId: string; title: string }
  | { kind: "set_items_done"; listId: string; itemIds: string[]; done: boolean }
  | { kind: "move_items_back"; fromListId: string; toListId: string; itemIds: string[] }
  | { kind: "batch"; inverses: UndoInverse[] }
  | { kind: "restore_reminder"; id: string }
  | { kind: "reschedule_reminder"; id: string; nextRunAt: string; task?: string };

export function recordUndo(
  input: {
    personId: string;
    turnId?: string | null;
    tool: string;
    action: string;
    inverse: UndoInverse;
  },
  now = new Date(),
): { id: string; expiresAt: string } {
  const id = newToolUndoId();
  const expiresAt = new Date(now.getTime() + 10 * 60_000).toISOString();
  db.insert(toolUndo).values({
    id,
    personId: input.personId,
    turnId: input.turnId ?? null,
    tool: input.tool,
    action: input.action,
    inverseJson: JSON.stringify(input.inverse),
    expiresAt,
    usedAt: null,
  }).run();
  return { id, expiresAt };
}

export function undoBlockFor(
  row: { id: string; usedAt: string | null; expiresAt: string },
  now = new Date(),
): { label: "Undo"; action: "undo" } | undefined {
  return !row.usedAt && Date.parse(row.expiresAt) > now.getTime() ? { label: "Undo", action: "undo" } : undefined;
}

export function undoPropsFor(id: string): { label: "Undo"; action: "undo" } | undefined {
  const row = db.select().from(toolUndo).where(eq(toolUndo.id, id)).get();
  return row ? undoBlockFor(row) : undefined;
}

/** Whether this person may change this list: their own, or a household list. An owner or admin gets no wider reach here,
 * so an Undo can never reach a list the resolver would not have shown them (rule 6a). */
function mayTouchList(actor: PersonRow, listId: string): boolean {
  const list = db.select().from(lists).where(and(eq(lists.id, listId), isNull(lists.deletedAt))).get();
  return list !== undefined && (list.person === actor.id || list.scope === "household");
}

function applyInverse(actor: PersonRow, inverse: UndoInverse, now: Date): boolean {
  if (inverse.kind === "cancel_reminder") return cancelJob(actor, inverse.id).ok;
  if (inverse.kind === "restore_reminder") return restoreReminder(actor, inverse.id);
  if (inverse.kind === "reschedule_reminder") return rescheduleReminder(actor, inverse.id, inverse.nextRunAt, inverse.task);
  if (inverse.kind === "remove_item") return removeItem(actor, inverse.listId, inverse.itemId).ok;
  if (inverse.kind === "restore_list") {
    const list = db.select().from(lists).where(eq(lists.id, inverse.listId)).get();
    if (list === undefined || list.deletedAt === null) return false;
    if (list.person !== actor.id && list.scope !== "household") return false;
    db.update(lists)
      .set({ deletedAt: null, updatedAt: now.toISOString(), hlc: nextHlc() })
      .where(eq(lists.id, inverse.listId))
      .run();
    return true;
  }
  if (inverse.kind === "remove_list") {
    // Only a list this person made (create_list and copy_list make person lists), never a household list.
    const list = db.select().from(lists).where(and(eq(lists.id, inverse.listId), isNull(lists.deletedAt))).get();
    if (list === undefined || list.scope !== "person" || list.person !== actor.id) return false;
    return deleteList(actor, inverse.listId).ok;
  }
  if (inverse.kind === "rename_list") {
    if (!mayTouchList(actor, inverse.listId)) return false;
    return updateList(actor, inverse.listId, { title: inverse.title }).ok;
  }
  if (inverse.kind === "set_items_done") {
    if (!mayTouchList(actor, inverse.listId)) return false;
    const list = getList(actor, inverse.listId);
    if (!list.ok) return false;
    const present = inverse.itemIds.filter((id) => list.value.items.some((item) => item.id === id));
    if (present.length === 0) return false;
    return present.every((id) => editItem(actor, inverse.listId, id, { done: inverse.done }).ok);
  }
  if (inverse.kind === "move_items_back") {
    if (!mayTouchList(actor, inverse.fromListId) || !mayTouchList(actor, inverse.toListId)) return false;
    return moveItems(actor, inverse.fromListId, inverse.toListId, inverse.itemIds).ok;
  }
  if (inverse.kind === "batch") {
    if (inverse.inverses.length === 0 || inverse.inverses.some((entry) => entry.kind === "batch")) return false;
    return inverse.inverses.map((entry) => applyInverse(actor, entry, now)).every(Boolean);
  }
  return false;
}

export type UndoResult = { ok: true } | { ok: false; status: 404 | 409; error: string };
export function runUndo(
  actor: PersonRow,
  undoId: string,
  now = new Date(),
): UndoResult {
  const row = db.select().from(toolUndo).where(eq(toolUndo.id, undoId)).get();
  if (!row || row.personId !== actor.id) return { ok: false, status: 404, error: "no such undo" };
  if (row.usedAt || Date.parse(row.expiresAt) <= now.getTime()) return { ok: false, status: 409, error: "undo expired or already used" };
  let inverse: UndoInverse;
  try {
    inverse = JSON.parse(row.inverseJson) as UndoInverse;
  } catch {
    return { ok: false, status: 409, error: "invalid undo" };
  }
  const ok = applyInverse(actor, inverse, now);
  if (!ok) return { ok: false, status: 409, error: "undo action is no longer available" };
  db.update(toolUndo).set({ usedAt: now.toISOString() }).where(and(eq(toolUndo.id, undoId), isNull(toolUndo.usedAt))).run();
  recordToolAudit({ personId: actor.id, tool: row.tool, action: row.action, decision: "undo", band: actor.role });
  return { ok: true };
}
