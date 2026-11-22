// CODE-UX-01: a deleted Code session lives in the household Trash like every other deleted record (docs/design/code-app-refresh-2026-11-21.md section 3).
// Delete itself is lib/codingTurns.ts `deleteCodingSession` (it stops the turn and the sandbox, then `markSessionDeleted` keeps the record for TRASH_DAYS).
// This provider lists, restores and purges. Only the owner sees a session here; an admin sees no one else's.
import { and, eq, isNotNull, lte } from "drizzle-orm";
import { db } from "@/db";
import { codingEvents, codingMessages, codingSessions } from "@/db/schema";
import { nextHlc } from "@/lib/hlc";
import { appendLogLine } from "@/lib/log";
import type { PersonRow } from "@/types";
import { registerTrashProvider, type TrashRow } from "./registry";

type Row = typeof codingSessions.$inferSelect;
const rowsOf = (person: Pick<PersonRow, "id">): Row[] => db.select().from(codingSessions).where(and(eq(codingSessions.personId, person.id), isNotNull(codingSessions.deletedAt))).all();
const envelope = (row: Row): TrashRow => ({ kind: "coding_session", id: row.id, title: row.title, deleted_at: row.deletedAt!, trash_until: row.trashUntil,
  can_restore: row.trashUntil !== null && row.trashUntil > new Date().toISOString(), can_purge: true });

/** Bring a deleted session back as an idle session; its sandbox and keys were ended at delete, and the next message starts a new sandbox from the saved workspace. */
export function restoreCodingSession(person: Pick<PersonRow, "id">, id: string): boolean {
  const row = rowsOf(person).find((r) => r.id === id);
  if (!row || !envelope(row).can_restore) return false;
  const at = new Date().toISOString();
  db.update(codingSessions).set({ deletedAt: null, trashUntil: null, state: "idle", updatedAt: at, hlc: nextHlc() }).where(eq(codingSessions.id, id)).run();
  appendLogLine(`coding session_restored session=${id} person=${person.id}`);
  return true;
}

function purge(id: string): void {
  db.transaction(() => {
    db.delete(codingMessages).where(eq(codingMessages.sessionId, id)).run();
    db.delete(codingEvents).where(eq(codingEvents.sessionId, id)).run();
    db.delete(codingSessions).where(eq(codingSessions.id, id)).run();
  });
  appendLogLine(`coding session_purged session=${id}`);
}

registerTrashProvider({
  kind: "coding_session", label: "Coding sessions",
  list: (person) => rowsOf(person).map(envelope),
  restore: (person, id) => restoreCodingSession(person, id),
  purge(person, id) {
    if (!rowsOf(person).some((r) => r.id === id)) return false;
    purge(id);
    return true;
  },
  purgeExpired(now) {
    for (const row of db.select({ id: codingSessions.id }).from(codingSessions).where(and(isNotNull(codingSessions.deletedAt), lte(codingSessions.trashUntil, now.toISOString()))).all()) purge(row.id);
  },
});
