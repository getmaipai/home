// ASSIST-WIRE-01: "that list" and "those items" in a list call mean the list and items this person's most recent list
// action touched. The tool_undo rows already name them (ids only), so no second store is kept; a change older than the
// Undo window no longer counts. Mirrors lastReminderIdFor for reminders.
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { toolUndo } from "@/db/schema";
import type { UndoInverse } from "@/lib/toolUndo";

export interface ListContext {
  lastListId?: string;
  lastItemIds?: string[];
}

function touched(inverse: UndoInverse): { listId: string; itemIds: string[] } | null {
  if (inverse.kind === "remove_item") return { listId: inverse.listId, itemIds: [inverse.itemId] };
  if (inverse.kind === "set_items_done") return { listId: inverse.listId, itemIds: inverse.itemIds };
  if (inverse.kind === "move_items_back") return { listId: inverse.fromListId, itemIds: inverse.itemIds };
  if (inverse.kind === "restore_list" || inverse.kind === "remove_list" || inverse.kind === "rename_list") {
    return { listId: inverse.listId, itemIds: [] };
  }
  if (inverse.kind === "batch") {
    const parts = inverse.inverses.map(touched).filter((part): part is NonNullable<typeof part> => part !== null);
    const first = parts[0];
    return first ? { listId: first.listId, itemIds: parts.flatMap((part) => part.itemIds) } : null;
  }
  return null;
}

/** The list and items this person's latest unexpired list change touched, or an empty context. */
export function lastListContextFor(personId: string, now = new Date()): ListContext {
  const rows = db.select().from(toolUndo)
    .where(and(eq(toolUndo.personId, personId), eq(toolUndo.tool, "remind")))
    .orderBy(desc(toolUndo.expiresAt))
    .limit(10)
    .all();
  for (const row of rows) {
    if (Date.parse(row.expiresAt) <= now.getTime()) continue;
    try {
      const found = touched(JSON.parse(row.inverseJson) as UndoInverse);
      if (found) return { lastListId: found.listId, ...(found.itemIds.length ? { lastItemIds: found.itemIds } : {}) };
    } catch {
      continue;
    }
  }
  return {};
}
