import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { scheduledJobs } from "@/db/schema";
import type { PersonRow } from "@/types";
import { cancelJob, scheduleCoreJob } from "@/lib/scheduler";
import { getSettingValueForPerson } from "@/lib/settings";

const JOB_KINDS = ["alarms.fire", "reminders.fire", "timers.fire"] as const;

export type ComingUpKind = "alarm" | "reminder" | "timer";
export type ComingUpRow = {
  id: string;
  kind: ComingUpKind;
  text: string;
  at: string;
  total_seconds?: number;
};

function parseInputs(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    // Old or malformed jobs still appear, without their optional text fields.
    return {};
  }
}

function kindForJob(job: string): ComingUpKind {
  if (job === "alarms.fire") return "alarm";
  if (job === "timers.fire") return "timer";
  return "reminder";
}

function timerDuration(inputs: Record<string, unknown>, createdAt: string, nextRunAt: string) {
  if (typeof inputs.total_seconds === "number") return inputs.total_seconds;
  return Math.max(1, Math.ceil((Date.parse(nextRunAt) - Date.parse(createdAt)) / 1000));
}

export function listComingUp(actor: PersonRow): ComingUpRow[] {
  const rows = db.select().from(scheduledJobs).where(and(
    eq(scheduledJobs.personId, actor.id),
    eq(scheduledJobs.kind, "core"),
    eq(scheduledJobs.status, "pending"),
    inArray(scheduledJobs.job, [...JOB_KINDS]),
  )).all();

  return rows.flatMap((row) => {
    const inputs = parseInputs(row.inputs);
    const kind = kindForJob(row.job);

    // Alarm records have their own list; only chat-created one-time alarms belong here.
    if (typeof inputs.alarmId === "string") return [];

    const textKey = kind === "timer" ? "label" : "task";
    const text = typeof inputs[textKey] === "string" ? inputs[textKey] as string : "";
    const totalSeconds = kind === "timer"
      ? timerDuration(inputs, row.createdAt, row.nextRunAt)
      : undefined;

    return [{
      id: row.id,
      kind,
      text,
      at: row.nextRunAt,
      ...(totalSeconds === undefined ? {} : { total_seconds: totalSeconds }),
    }];
  }).sort((left, right) => Date.parse(left.at) - Date.parse(right.at));
}

export function createTimer(actor: PersonRow, input: { label: string; minutes: number }) {
  const label = input.label.trim();
  if (!label || !Number.isInteger(input.minutes) || input.minutes < 1 || input.minutes > 1440) {
    return {
      ok: false as const,
      status: 400 as const,
      error: "Enter a label and a duration from 1 to 1440 minutes.",
    };
  }

  const totalSeconds = input.minutes * 60;
  const dueAt = new Date(Date.now() + totalSeconds * 1000).toISOString();
  const scheduled = scheduleCoreJob(actor, "timers.fire", dueAt, {
    label,
    total_seconds: totalSeconds,
  });

  return scheduled.ok ? { ok: true as const, value: { id: scheduled.value.id } } : scheduled;
}

export function extendTimer(actor: PersonRow, id: string) {
  const row = db.select().from(scheduledJobs).where(eq(scheduledJobs.id, id)).get();
  if (!row || row.personId !== actor.id || row.kind !== "core" || row.job !== "timers.fire") {
    return {
      ok: false as const,
      status: row ? 403 as const : 404 as const,
      error: "timer not found",
    };
  }
  if (row.status !== "pending") {
    return { ok: false as const, status: 400 as const, error: "timer is no longer pending" };
  }

  const inputs = parseInputs(row.inputs);
  const totalSeconds = typeof inputs.total_seconds === "number"
    ? inputs.total_seconds + 60
    : Math.max(60, Math.ceil((Date.parse(row.nextRunAt) - Date.now()) / 1000) + 60);
  const nextRunAt = new Date(Date.parse(row.nextRunAt) + 60_000).toISOString();

  db.update(scheduledJobs).set({
    nextRunAt,
    when: nextRunAt,
    inputs: JSON.stringify({ ...inputs, total_seconds: totalSeconds }),
  }).where(and(
    eq(scheduledJobs.id, id),
    eq(scheduledJobs.personId, actor.id),
    eq(scheduledJobs.status, "pending"),
  )).run();

  return { ok: true as const, value: { id, at: nextRunAt, total_seconds: totalSeconds } };
}

export function doneComingUp(actor: PersonRow, id: string) {
  const row = db.select().from(scheduledJobs).where(eq(scheduledJobs.id, id)).get();
  if (!row || row.personId !== actor.id || row.kind !== "core" || !(JOB_KINDS as readonly string[]).includes(row.job)) {
    return { ok: false as const, status: row ? 403 : 404, error: "job not found" };
  }

  const cancelled = cancelJob(actor, id);
  if (!cancelled.ok) return cancelled;
  return { ok: true as const, value: true };
}

function tomorrowMorning(timeZone: string) {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(now);
  const part = (key: string) => Number(parts.find((item) => item.type === key)?.value);
  const localTomorrow = new Date(Date.UTC(part("year"), part("month") - 1, part("day") + 1, 8));
  const offsetName = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
    .formatToParts(localTomorrow)
    .find((item) => item.type === "timeZoneName")?.value ?? "GMT+00:00";
  const match = offsetName.match(/GMT([+-])(\d{2}):(\d{2})/);
  const offset = match
    ? (match[1] === "+" ? 1 : -1) * (Number(match[2]) * 60 + Number(match[3]))
    : 0;
  return new Date(localTomorrow.getTime() - offset * 60_000);
}

export function snoozeComingUp(actor: PersonRow, id: string, input: { minutes?: number; until?: "tomorrow_morning" }) {
  const row = db.select().from(scheduledJobs).where(eq(scheduledJobs.id, id)).get();
  if (!row || row.personId !== actor.id || row.kind !== "core" || !(JOB_KINDS as readonly string[]).includes(row.job)) {
    return { ok: false as const, status: row ? 403 : 404, error: "job not found" };
  }

  const firedAlarm = row.job === "alarms.fire" && row.status === "done";
  if (row.status !== "pending" && !firedAlarm) {
    return { ok: false as const, status: 400, error: "job is no longer pending" };
  }

  const next = input.minutes
    ? new Date(Date.now() + input.minutes * 60_000)
    : tomorrowMorning(getPersonTimeZone(actor.id));

  db.update(scheduledJobs).set({
    nextRunAt: next.toISOString(),
    when: next.toISOString(),
    status: "pending",
    ...(firedAlarm ? { lastRunAt: null } : {}),
  }).where(and(
    eq(scheduledJobs.id, id),
    eq(scheduledJobs.personId, actor.id),
    eq(scheduledJobs.status, row.status),
  )).run();

  return { ok: true as const, value: true };
}

function getPersonTimeZone(personId: string) {
  const zone = getSettingValueForPerson(personId, "time.time_zone");
  return typeof zone === "string" && zone
    ? zone
    : Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}
