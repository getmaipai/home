import { and, eq, isNull } from "drizzle-orm";
import { Alarm } from "@maipai/spec/gen/ts/alarm.js";
import type { Alarm as AlarmT } from "@maipai/spec/gen/ts/alarm.js";
import { db } from "@/db";
import { alarms, scheduledJobs } from "@/db/schema";
import { newJobId } from "@/lib/id";
import { nextHlc } from "@/lib/hlc";
import { nextOccurrence } from "@/lib/scheduler";
import { getSettingValueForPerson } from "@/lib/settings";
import type { PersonRow } from "@/types";

type Result<T> = { ok: true; value: T } | { ok: false; status: 400 | 404; error: string };
type AlarmRow = typeof alarms.$inferSelect;
function shape(row: AlarmRow): AlarmT { return Alarm.parse({ id: row.id, person: row.person, time: row.time, days: JSON.parse(row.days), label: row.label, tag: row.tag, enabled: row.enabled, skip_until: row.skipUntil, sound: row.sound, snooze_minutes: row.snoozeMinutes, source: row.source, created_at: row.createdAt, updated_at: row.updatedAt, deleted_at: row.deletedAt, hlc: row.hlc }); }
function rowOf(a: AlarmT) { return { id: a.id, person: a.person, time: a.time, days: JSON.stringify(a.days), label: a.label, tag: a.tag, enabled: a.enabled, skipUntil: a.skip_until, sound: a.sound, snoozeMinutes: a.snooze_minutes, source: a.source, createdAt: a.created_at, updatedAt: a.updated_at, deletedAt: a.deleted_at, hlc: a.hlc }; }
function zoneFor(person: string): string { const z = getSettingValueForPerson(person, "time.time_zone"); return typeof z === "string" && z ? z : Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; }
function nextAt(a: AlarmT): string | null { return a.enabled ? nextOccurrence({ time: a.time, days: a.days, zone: zoneFor(a.person), after: new Date(), skipUntil: a.skip_until })?.toISOString() ?? null : null; }
function owned(actor: PersonRow, id: string): AlarmRow | undefined { return db.select().from(alarms).where(and(eq(alarms.id, id), eq(alarms.person, actor.id), isNull(alarms.deletedAt))).get(); }

export function syncAlarmJob(alarm: AlarmT): void {
  const existing = db.select().from(scheduledJobs).all().filter((j) => j.job === "alarms.fire" && j.status === "pending" && JSON.parse(j.inputs || "{}").alarmId === alarm.id);
  if (!alarm.enabled || alarm.deleted_at) {
    for (const job of existing) db.update(scheduledJobs).set({ status: "cancelled" }).where(eq(scheduledJobs.id, job.id)).run();
    return;
  }
  const next = nextAt(alarm);
  if (!next) return;
  if (existing.length) {
    const keep = existing[0]!;
    db.update(scheduledJobs).set({ inputs: JSON.stringify({ task: alarm.label || "Alarm", alarmId: alarm.id }), nextRunAt: next, when: next, recurring: false }).where(eq(scheduledJobs.id, keep.id)).run();
    for (const extra of existing.slice(1)) db.update(scheduledJobs).set({ status: "cancelled" }).where(eq(scheduledJobs.id, extra.id)).run();
  } else {
    db.insert(scheduledJobs).values({ id: newJobId(), kind: "core", packageId: "core", job: "alarms.fire", personId: alarm.person, inputs: JSON.stringify({ task: alarm.label || "Alarm", alarmId: alarm.id }), when: next, recurring: false, nextRunAt: next, status: "pending", createdAt: new Date().toISOString() }).run();
  }
}

export function listAlarms(actor: PersonRow): (AlarmT & { next_at: string | null })[] {
  return db.select().from(alarms).where(and(eq(alarms.person, actor.id), isNull(alarms.deletedAt))).all().map(shape).map((a) => ({ ...a, next_at: nextAt(a) })).sort((a, b) => (a.next_at ?? "").localeCompare(b.next_at ?? ""));
}

export function createAlarm(actor: PersonRow, input: Partial<Pick<AlarmT, "time" | "days" | "label" | "tag" | "enabled" | "sound" | "snooze_minutes">>): Result<AlarmT> {
  const now = new Date().toISOString();
  const candidate = Alarm.safeParse({ id: `alarm-${Math.random().toString(36).slice(2, 12)}`, person: actor.id, time: input.time, days: input.days ?? [], label: input.label ?? "", tag: input.tag ?? "", enabled: input.enabled ?? true, skip_until: null, sound: input.sound ?? "default", snooze_minutes: input.snooze_minutes ?? null, source: "hub", created_at: now, updated_at: now, deleted_at: null, hlc: nextHlc() });
  if (!candidate.success) return { ok: false, status: 400, error: "invalid alarm" };
  db.insert(alarms).values(rowOf(candidate.data)).run(); syncAlarmJob(candidate.data); return { ok: true, value: candidate.data };
}

export function updateAlarm(actor: PersonRow, id: string, edit: Partial<Pick<AlarmT, "time" | "days" | "label" | "tag" | "enabled" | "sound" | "snooze_minutes">>): Result<AlarmT> {
  const row = owned(actor, id); if (!row) return { ok: false, status: 404, error: "no such alarm" };
  const current = shape(row); const parsed = Alarm.safeParse({ ...current, ...edit, updated_at: new Date().toISOString(), hlc: nextHlc() });
  if (!parsed.success) return { ok: false, status: 400, error: "invalid alarm" };
  db.update(alarms).set(rowOf(parsed.data)).where(eq(alarms.id, id)).run(); syncAlarmJob(parsed.data); return { ok: true, value: parsed.data };
}

export function skipNext(actor: PersonRow, id: string): Result<AlarmT> {
  const row = owned(actor, id); if (!row) return { ok: false, status: 404, error: "no such alarm" };
  const current = shape(row); const next = nextAt(current); if (!next) return { ok: false, status: 400, error: "alarm has no next occurrence" };
  const updated = Alarm.parse({ ...current, skip_until: new Date(Date.parse(next) + 1).toISOString(), updated_at: new Date().toISOString(), hlc: nextHlc() });
  db.update(alarms).set(rowOf(updated)).where(eq(alarms.id, id)).run(); syncAlarmJob(updated); return { ok: true, value: updated };
}

export function deleteAlarm(actor: PersonRow, id: string): Result<{ id: string }> {
  const row = owned(actor, id); if (!row) return { ok: false, status: 404, error: "no such alarm" };
  const now = new Date().toISOString(); db.update(alarms).set({ deletedAt: now, updatedAt: now, hlc: nextHlc() }).where(eq(alarms.id, id)).run(); syncAlarmJob(Alarm.parse({ ...shape(row), deleted_at: now, updated_at: now, hlc: nextHlc() })); return { ok: true, value: { id } };
}
