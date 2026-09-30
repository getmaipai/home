import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { maintenanceWindows, statusNotes } from "@/db/schema";
import { nextHlc } from "@/lib/hlc";
import { randomSuffix } from "@/lib/id";
import { MaintenanceWindow } from "@maipai/spec/gen/ts/maintenance-window.js";
import { StatusNote } from "@maipai/spec/gen/ts/status-note.js";

export type StatusActor = { id: string; displayName: string };
export class StatusBoardError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 = 400) { super(message); }
}
export type MaintenanceStatus = "cancelled" | "scheduled" | "in_progress" | "completed";
export type MaintenanceView = MaintenanceWindow & { status: MaintenanceStatus };
export type MaintenanceInput = { title: string; description?: string; components: string[]; startsAt: string; endsAt: string };

function timestamp(date: Date): string { return date.toISOString(); }
function noteFromRow(row: typeof statusNotes.$inferSelect): StatusNote {
  return StatusNote.parse({ id: row.id, body: row.body, posted_by: row.postedBy, posted_at: row.postedAt,
    expires_at: row.expiresAt, cleared_at: row.clearedAt, cleared_by: row.clearedBy, hlc: row.hlc });
}
function maintenanceFromRow(row: typeof maintenanceWindows.$inferSelect): MaintenanceWindow {
  return MaintenanceWindow.parse({ id: row.id, title: row.title, description: row.description,
    components: JSON.parse(row.components), starts_at: row.startsAt, ends_at: row.endsAt,
    cancelled_at: row.cancelledAt, created_by: row.createdBy, created_at: row.createdAt, hlc: row.hlc });
}
function activeNoteRows(now: Date): (typeof statusNotes.$inferSelect)[] {
  return db.select().from(statusNotes).where(isNull(statusNotes.clearedAt)).all()
    .filter((row) => row.expiresAt === null || Date.parse(row.expiresAt) > now.getTime());
}

export function postNote(actor: StatusActor, input: { body: string; expiresAt?: string }, now: Date = new Date()): StatusNote {
  const at = timestamp(now);
  const parsed = StatusNote.parse({ id: `note-${randomSuffix(10)}`, body: input.body, posted_by: actor.id,
    posted_at: at, expires_at: input.expiresAt ?? null, cleared_at: null, cleared_by: null, hlc: nextHlc() });
  for (const row of activeNoteRows(now)) {
    db.update(statusNotes).set({ clearedAt: at, clearedBy: actor.id }).where(eq(statusNotes.id, row.id)).run();
  }
  db.insert(statusNotes).values({ id: parsed.id, body: parsed.body, postedBy: parsed.posted_by,
    postedAt: parsed.posted_at, expiresAt: parsed.expires_at, clearedAt: null, clearedBy: null, hlc: parsed.hlc }).run();
  return parsed;
}

export function clearNote(actor: StatusActor, now: Date = new Date()): void {
  for (const row of activeNoteRows(now)) {
    db.update(statusNotes).set({ clearedAt: timestamp(now), clearedBy: actor.id }).where(eq(statusNotes.id, row.id)).run();
  }
}

export function getActiveNote(now: Date = new Date()): StatusNote | null {
  const row = activeNoteRows(now).sort((a, b) => b.postedAt.localeCompare(a.postedAt))[0];
  return row ? noteFromRow(row) : null;
}

export function createMaintenance(actor: StatusActor, input: MaintenanceInput, now: Date = new Date()): MaintenanceWindow {
  const start = Date.parse(input.startsAt);
  const end = Date.parse(input.endsAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) throw new StatusBoardError("Maintenance times must be valid dates.");
  if (end <= start) throw new StatusBoardError("Maintenance must end after it starts.");
  if (end < now.getTime()) throw new StatusBoardError("Maintenance cannot end in the past.");
  if (start > now.getTime() + 90 * 24 * 60 * 60 * 1000) throw new StatusBoardError("Maintenance cannot start more than 90 days ahead.");
  const parsed = MaintenanceWindow.parse({ id: `maint-${randomSuffix(10)}`, title: input.title,
    description: input.description ?? "", components: input.components, starts_at: input.startsAt,
    ends_at: input.endsAt, cancelled_at: null, created_by: actor.id, created_at: timestamp(now), hlc: nextHlc() });
  db.insert(maintenanceWindows).values({ id: parsed.id, title: parsed.title, description: parsed.description,
    components: JSON.stringify(parsed.components), startsAt: parsed.starts_at, endsAt: parsed.ends_at,
    cancelledAt: null, createdBy: parsed.created_by, createdAt: parsed.created_at, hlc: parsed.hlc }).run();
  return parsed;
}

export function cancelMaintenance(actor: StatusActor, id: string, now: Date = new Date()): MaintenanceWindow {
  const row = db.select().from(maintenanceWindows).where(eq(maintenanceWindows.id, id)).get();
  if (!row) throw new StatusBoardError("Maintenance window was not found.", 404);
  if (row.cancelledAt || Date.parse(row.endsAt) <= now.getTime()) throw new StatusBoardError("Completed or cancelled maintenance cannot be cancelled.", 409);
  db.update(maintenanceWindows).set({ cancelledAt: timestamp(now), hlc: nextHlc() }).where(eq(maintenanceWindows.id, id)).run();
  return maintenanceFromRow({ ...row, cancelledAt: timestamp(now) });
}

export function listMaintenance(now: Date = new Date()): MaintenanceView[] {
  const cutoff = now.getTime() - 7 * 24 * 60 * 60 * 1000;
  const rows = db.select().from(maintenanceWindows).all().map((row) => {
    const record = maintenanceFromRow(row);
    const status: MaintenanceStatus = record.cancelled_at ? "cancelled" : now.getTime() < Date.parse(record.starts_at) ? "scheduled"
      : now.getTime() < Date.parse(record.ends_at) ? "in_progress" : "completed";
    return { record, status };
  }).filter(({ record, status }) => (status !== "completed" && status !== "cancelled") || Date.parse(record.ends_at) >= cutoff);
  const rank: Record<MaintenanceStatus, number> = { in_progress: 0, scheduled: 1, completed: 2, cancelled: 3 };
  rows.sort((a, b) => rank[a.status] - rank[b.status] || (a.status === "scheduled"
    ? Date.parse(a.record.starts_at) - Date.parse(b.record.starts_at)
    : Date.parse(b.record.starts_at) - Date.parse(a.record.starts_at)));
  return rows.map(({ record, status }) => ({ ...record, status }));
}

export function activeMaintenanceComponents(now: Date = new Date()): Set<string> {
  const active = listMaintenance(now).filter((row) => row.status === "in_progress");
  return new Set(active.flatMap((row) => row.components));
}
