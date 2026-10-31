// ASSIST-REMIND-01 part B: the reminder actions of `remind` (edit, snooze, complete, delete, show). A reminder is a
// `reminders.fire` core scheduled job. Which reminder a person means is decided here, in code, from their own pending
// reminders only; the model never picks an id. One definition per operation: the old `reminder:cancel:` and
// `reminder:list:` folds map to delete and show.
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { scheduledJobs, toolUndo } from "@/db/schema";
import { HostError } from "@maipai/spec/emulators/ts/host-emulator.js";
import { jobLabel, whenText } from "@/lib/alarmChat";
import { fuzzy, similarity } from "@/lib/listResolver";
import { parseReminder } from "@/lib/reminderParsing";
import { getSettingValueForPerson } from "@/lib/settings";
import { tokenize, wordsOf } from "@/lib/text";
import type { JobRow } from "@/lib/scheduler";
import type { UndoInverse } from "@/lib/toolUndo";
import type { ReminderPayload } from "@/lib/alarmCalls";
import type { PersonRow } from "@/types";

export type ReminderResolution =
  | { ok: true; job: JobRow }
  | { ok: false; reason: "none" | "ambiguous"; candidates: JobRow[] };

const FILLER = new Set(["reminder", "reminders", "last", "one", "that", "this"]);
const MAX_TASK = 200;
const MAX_SNOOZE_MINUTES = 24 * 60;

/** The person's own pending reminders, soonest first. Never another person's, whatever the asker's role. */
export function pendingReminders(actor: Pick<PersonRow, "id">): JobRow[] {
  return db.select().from(scheduledJobs)
    .where(and(
      eq(scheduledJobs.personId, actor.id),
      eq(scheduledJobs.kind, "core"),
      eq(scheduledJobs.job, "reminders.fire"),
      eq(scheduledJobs.status, "pending"),
    ))
    .all()
    .sort((a, b) => a.nextRunAt.localeCompare(b.nextRunAt));
}

/** Resolves the person's words to one of their own pending reminders: exact task text, then a unique fuzzy match;
 * "that", "it" and "the last one" mean `lastReminderId`. */
export function resolveReminder(
  actor: Pick<PersonRow, "id">,
  words: string,
  options: { lastReminderId?: string } = {},
): ReminderResolution {
  const pending = pendingReminders(actor);
  const text = words.trim().toLowerCase();
  const exact = pending.filter((job) => jobLabel(job.inputs).trim().toLowerCase() === text);
  if (text && exact.length === 1) return { ok: true, job: exact[0]! };
  if (text && exact.length > 1) return { ok: false, reason: "ambiguous", candidates: exact };
  const query = [...tokenize(words)].filter((token) => !FILLER.has(token)).join(" ");
  if (!query) {
    const refersBack = wordsOf(words).some((word) => word === "that" || word === "it" || word === "this" || word === "last");
    const last = refersBack && options.lastReminderId ? pending.find((job) => job.id === options.lastReminderId) : undefined;
    if (last) return { ok: true, job: last };
    if (pending.length === 1) return { ok: true, job: pending[0]! };
    return pending.length === 0
      ? { ok: false, reason: "none", candidates: [] }
      : { ok: false, reason: "ambiguous", candidates: pending };
  }
  const found = fuzzy(pending, query, (job) => jobLabel(job.inputs));
  if (found.ok) return { ok: true, job: found.value };
  if (found.reason === "none") return { ok: false, reason: "none", candidates: [] };
  const scored = pending.map((job) => ({ job, score: similarity(query, jobLabel(job.inputs)) }));
  const best = Math.max(...scored.map((entry) => entry.score));
  return { ok: false, reason: "ambiguous", candidates: scored.filter((entry) => entry.score === best).map((entry) => entry.job) };
}

/** The reminder this person last made or changed (from their recent Undo receipts), for "that" and "it". */
export function lastReminderIdFor(personId: string): string | undefined {
  const rows = db.select().from(toolUndo)
    .where(and(eq(toolUndo.personId, personId), eq(toolUndo.tool, "remind")))
    .orderBy(desc(toolUndo.expiresAt))
    .limit(10)
    .all();
  for (const row of rows) {
    try {
      const inverse = JSON.parse(row.inverseJson) as { kind?: string; id?: unknown };
      const reminderKinds = ["cancel_reminder", "restore_reminder", "reschedule_reminder"];
      if (inverse.kind && reminderKinds.includes(inverse.kind) && typeof inverse.id === "string") return inverse.id;
    } catch {
      continue;
    }
  }
  return undefined;
}

export interface ReminderActionResult {
  /** The plain sentence the person is told. */
  reply: string;
  /** The result's action for the reply data and card: "set", "cancel", "list", "snooze", "edit" or "complete". */
  action: string;
  when_text: string;
  schedule_task?: string;
  /** Present when the change can be undone. */
  undo?: { action: string; inverse: UndoInverse };
}

const lineOf = (job: JobRow): string => `Reminder: ${jobLabel(job.inputs)} (${whenText(new Date(job.nextRunAt))})`;

function refusal(verb: string, found: Extract<ReminderResolution, { ok: false }>): ReminderActionResult {
  if (found.reason === "none") {
    const reply = verb === "cancel" ? "There is nothing matching that to cancel." : `I couldn't find a pending reminder matching that to ${verb}.`;
    return { reply, action: verb, when_text: "" };
  }
  const reply = `I found more than one match. Which one should I ${verb}?\n${found.candidates.map(lineOf).join("\n")}`;
  return { reply, action: verb, when_text: "" };
}

function snoozeMinutesFor(actor: Pick<PersonRow, "id">, asked: number | undefined): number {
  if (asked !== undefined && asked >= 1) return Math.min(asked, MAX_SNOOZE_MINUTES);
  const configured = Number(getSettingValueForPerson(actor.id, "alarms.snooze_minutes"));
  return Number.isFinite(configured) && configured >= 1 ? Math.min(Math.round(configured), MAX_SNOOZE_MINUTES) : 10;
}

function ownPendingRow(personId: string, id: string): JobRow | undefined {
  const row = db.select().from(scheduledJobs).where(eq(scheduledJobs.id, id)).get();
  return row && row.personId === personId && row.job === "reminders.fire" ? row : undefined;
}

/** Undo for complete and delete: the reminder is pending again. Only the person's own, and only if it was closed. */
export function restoreReminder(actor: Pick<PersonRow, "id">, id: string): boolean {
  const row = ownPendingRow(actor.id, id);
  if (!row || row.status === "pending") return false;
  db.update(scheduledJobs).set({ status: "pending", lastRunAt: null }).where(eq(scheduledJobs.id, id)).run();
  return true;
}

/** Undo for snooze and edit: back to the old time (and old task text when given). Only the person's own pending reminder. */
export function rescheduleReminder(actor: Pick<PersonRow, "id">, id: string, nextRunAt: string, task?: string): boolean {
  const row = ownPendingRow(actor.id, id);
  if (!row || row.status !== "pending") return false;
  const inputs = task === undefined ? row.inputs : JSON.stringify({ ...(JSON.parse(row.inputs) as Record<string, unknown>), task });
  db.update(scheduledJobs).set({ nextRunAt, when: nextRunAt, inputs }).where(eq(scheduledJobs.id, id)).run();
  return true;
}

function close(job: JobRow, status: "done" | "cancelled"): void {
  db.update(scheduledJobs)
    .set({ status, ...(status === "done" ? { lastRunAt: new Date().toISOString() } : {}) })
    .where(and(eq(scheduledJobs.id, job.id), eq(scheduledJobs.status, "pending")))
    .run();
}

/** Runs one reminder action for the actor. The action is the structured name (edit_reminder, snooze_reminder,
 * complete_reminder, delete_reminder or its old name cancel_reminder, show_reminders or its old name list_reminders). */
export function runReminderAction(
  actor: Pick<PersonRow, "id">,
  action: string,
  payload: ReminderPayload,
  options: { lastReminderId?: string; now?: Date } = {},
): ReminderActionResult {
  const now = options.now ?? new Date();
  if (action === "show_reminders" || action === "list_reminders") {
    const pending = pendingReminders(actor);
    return {
      reply: pending.length ? pending.map(lineOf).join("\n") : "You have no pending reminders.",
      action: "list",
      when_text: "",
    };
  }
  const verb = action === "snooze_reminder" ? "snooze"
    : action === "edit_reminder" ? "change"
    : action === "complete_reminder" ? "complete"
    : "cancel";
  const found = resolveReminder(actor, payload.reminder, { lastReminderId: options.lastReminderId });
  if (!found.ok) return refusal(verb, found);
  const job = found.job;
  const task = jobLabel(job.inputs);
  const before = job.nextRunAt;

  if (action === "delete_reminder" || action === "cancel_reminder") {
    close(job, "cancelled");
    return { reply: `Reminder cancelled: ${task}.`, action: "cancel", when_text: "", schedule_task: task, undo: { action, inverse: { kind: "restore_reminder", id: job.id } } };
  }
  if (action === "complete_reminder") {
    close(job, "done");
    return { reply: `Marked done: ${task}.`, action: "complete", when_text: "", undo: { action, inverse: { kind: "restore_reminder", id: job.id } } };
  }
  if (action === "snooze_reminder") {
    const minutes = snoozeMinutesFor(actor, payload.minutes);
    const base = Math.max(Date.parse(before), now.getTime());
    const next = new Date(base + minutes * 60_000).toISOString();
    rescheduleReminder(actor, job.id, next);
    return {
      reply: `Okay, snoozed ${task} until ${whenText(new Date(next))}.`,
      action: "snooze",
      when_text: whenText(new Date(next)),
      undo: { action, inverse: { kind: "reschedule_reminder", id: job.id, nextRunAt: before } },
    };
  }
  return editReminder(actor, job, payload, task, before, now);
}

function editReminder(
  actor: Pick<PersonRow, "id">,
  job: JobRow,
  payload: ReminderPayload,
  oldTask: string,
  before: string,
  now: Date,
): ReminderActionResult {
  const newTask = payload.task?.trim().slice(0, MAX_TASK);
  if (!newTask && !payload.when) {
    return { reply: "What should I change about that reminder, the words or the time?", action: "edit", when_text: "" };
  }
  let nextRunAt = before;
  if (payload.when) {
    try {
      // Only the time is wanted from the parse; a placeholder task keeps the parser from refusing a time alone.
      nextRunAt = parseReminder(`${payload.when} x`, now).when;
    } catch (error) {
      if (error instanceof HostError) return { reply: error.message, action: "edit", when_text: "" };
      throw error;
    }
  }
  const task = newTask || oldTask;
  rescheduleReminder(actor, job.id, nextRunAt, task);
  const when = whenText(new Date(nextRunAt));
  return {
    reply: `Okay, changed your reminder: ${task} (${when}).`,
    action: "edit",
    when_text: when,
    schedule_task: task,
    undo: { action: "edit_reminder", inverse: { kind: "reschedule_reminder", id: job.id, nextRunAt: before, task: oldTask } },
  };
}
