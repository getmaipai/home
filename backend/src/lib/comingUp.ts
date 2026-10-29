import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { scheduledJobs } from "@/db/schema";
import type { PersonRow } from "@/types";
import { cancelJob } from "@/lib/scheduler";
import { getSettingValueForPerson } from "@/lib/settings";

const JOB_KINDS = ["alarms.fire", "reminders.fire", "timers.fire"] as const;
export type ComingUpKind = "alarm" | "reminder" | "timer";
export type ComingUpRow = { id: string; kind: ComingUpKind; text: string; at: string };

export function listComingUp(actor: PersonRow): ComingUpRow[] {
  return db.select().from(scheduledJobs).where(and(
    eq(scheduledJobs.personId, actor.id), eq(scheduledJobs.kind, "core"),
    eq(scheduledJobs.status, "pending"), inArray(scheduledJobs.job, [...JOB_KINDS]),
  )).all().map((row) => {
    let inputs: Record<string, unknown> = {};
    try { inputs = JSON.parse(row.inputs) as Record<string, unknown>; } catch { /* malformed legacy inputs have no text */ }
    const kind: ComingUpKind = row.job === "alarms.fire" ? "alarm" : row.job === "timers.fire" ? "timer" : "reminder";
    return { id: row.id, kind, text: typeof inputs[kind === "timer" ? "label" : "task"] === "string" ? inputs[kind === "timer" ? "label" : "task"] as string : "", at: row.nextRunAt };
  }).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

export function doneComingUp(actor: PersonRow, id: string) {
  const row = db.select().from(scheduledJobs).where(eq(scheduledJobs.id, id)).get();
  if (!row || row.personId !== actor.id || row.kind !== "core" || !(JOB_KINDS as readonly string[]).includes(row.job)) return { ok: false as const, status: row ? 403 : 404, error: "job not found" };
  const cancelled = cancelJob(actor, id);
  if (!cancelled.ok) return cancelled;
  return { ok: true as const, value: true };
}

export function snoozeComingUp(actor: PersonRow, id: string, input: { minutes?: number; until?: "tomorrow_morning" }) {
  const row = db.select().from(scheduledJobs).where(eq(scheduledJobs.id, id)).get();
  if (!row || row.personId !== actor.id || row.kind !== "core" || !(JOB_KINDS as readonly string[]).includes(row.job)) return { ok: false as const, status: row ? 403 : 404, error: "job not found" };
  if (row.status !== "pending") return { ok: false as const, status: 400, error: `job ${id} is already ${row.status}, not pending` };
  let next: Date;
  if (input.minutes) next = new Date(Date.now() + input.minutes * 60_000);
  else {
    const zone = getSettingValueForPerson(actor.id, "time.time_zone");
    const timeZone = typeof zone === "string" && zone ? zone : Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const now = new Date();
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "numeric", day: "numeric" }).formatToParts(now);
    const part = (key: string) => Number(parts.find((item) => item.type === key)?.value);
    const localTomorrow = new Date(Date.UTC(part("year"), part("month") - 1, part("day") + 1, 8));
    const target = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" }).formatToParts(localTomorrow).find((item) => item.type === "timeZoneName")?.value ?? "GMT+00:00";
    const match = target.match(/GMT([+-])(\d{2}):(\d{2})/);
    const offset = match ? (match[1] === "+" ? 1 : -1) * (Number(match[2]) * 60 + Number(match[3])) : 0;
    next = new Date(localTomorrow.getTime() - offset * 60_000);
  }
  db.update(scheduledJobs).set({ nextRunAt: next.toISOString(), when: next.toISOString() }).where(and(eq(scheduledJobs.id, id), eq(scheduledJobs.personId, actor.id), eq(scheduledJobs.status, "pending"))).run();
  return { ok: true as const, value: true };
}
