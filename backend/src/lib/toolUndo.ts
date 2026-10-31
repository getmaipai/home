import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { toolUndo, scheduledJobs, lists } from "@/db/schema";
import { newToolUndoId } from "@/lib/id";
import { cancelJob } from "@/lib/scheduler";
import { removeItem } from "@/lib/lists";
import { rescheduleReminder, restoreReminder } from "@/lib/reminderActions";
import { recordToolAudit } from "@/lib/toolAudit";
import { nextHlc } from "@/lib/hlc";
import type { PersonRow } from "@/types";

export type UndoInverse =
  | { kind: "cancel_reminder"; id: string }
  | { kind: "remove_item"; listId: string; itemId: string }
  | { kind: "restore_list"; listId: string }
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
  let ok = false;
  if (inverse.kind === "cancel_reminder") ok = cancelJob(actor, inverse.id).ok;
  else if (inverse.kind === "restore_reminder") ok = restoreReminder(actor, inverse.id);
  else if (inverse.kind === "reschedule_reminder") ok = rescheduleReminder(actor, inverse.id, inverse.nextRunAt, inverse.task);
  else if (inverse.kind === "remove_item") ok = removeItem(actor, inverse.listId, inverse.itemId).ok;
  else if (inverse.kind === "restore_list") {
    const list = db.select().from(lists).where(eq(lists.id, inverse.listId)).get();
    if (
      list !== undefined &&
      list.deletedAt !== null &&
      (list.person === actor.id || list.scope === "household")
    ) {
      db.update(lists)
        .set({ deletedAt: null, updatedAt: now.toISOString(), hlc: nextHlc() })
        .where(eq(lists.id, inverse.listId))
        .run();
      ok = true;
    }
  }
  if (!ok) return { ok: false, status: 409, error: "undo action is no longer available" };
  db.update(toolUndo).set({ usedAt: now.toISOString() }).where(and(eq(toolUndo.id, undoId), isNull(toolUndo.usedAt))).run();
  recordToolAudit({ personId: actor.id, tool: row.tool, action: row.action, decision: "undo", band: actor.role });
  return { ok: true };
}
