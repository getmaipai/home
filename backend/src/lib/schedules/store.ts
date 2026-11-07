// SCHED-02 part A: the scheduled_tasks store for device schedules (kinds device_action and scene).
// `createDeviceSchedule` validates, checks the creator's access, makes the Home Assistant automation and writes the row;
// when the automation API is unavailable the row is written with the hub executor instead. Nothing here logs, audits or
// raises an issue with a task id, an automation id, an instance slug, an entity id or a person id (rule 6a, C3).
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { scheduledTasks } from "@/db/schema";
import { ScheduledTask } from "@maipai/spec/gen/ts/scheduled-task.js";
import { validateScheduledTask } from "@maipai/spec/records/ts/validate.js";
import { nextHlc } from "@/lib/hlc";
import { newScheduledTaskId } from "@/lib/id";
import { getSettingValueForPerson } from "@/lib/settings";
import { effectivePermissions } from "@/lib/permissions";
import { loadHouseRegistries } from "@/lib/house/cache";
import { houseInstanceLanFetch, type HouseLanFetchDeps } from "@/lib/house/connection";
import type { EffectivePermission } from "@/lib/house/access";
import type { HouseRegistryResult } from "@/lib/house/registry";
import { buildAutomationBody, createAutomation, deleteAutomation, newAutomationId, type AutomationAction, type AutomationSpec } from "@/lib/house/automations";
import { checkTargets, parseTarget, scheduleActor, schedulableDomain, type SchedulePerson, type TargetReason } from "./guard";
import { queueHubRun } from "./executor";

export type ScheduleDeps = {
  /** Connection settings and the fetch seam for the Home Assistant instance(s). */
  house?: HouseLanFetchDeps;
  loadRegistry?: () => Promise<HouseRegistryResult>;
  permissionsOf?: (personId: string) => EffectivePermission[];
  /** The zone a person's wall-clock times are read in. */
  zoneOf?: (personId: string) => string;
  now?: () => Date;
  newAutomationId?: () => string;
};

export type ScheduleKind = "device_action" | "scene";
export type CreateScheduleInput = {
  person: SchedulePerson;
  kind: ScheduleKind;
  targets: string[];
  action: AutomationAction;
  value?: number;
  /** One-shot form: when it fires. */
  onceAt?: string;
  /** Repeat form: HH:MM, ISO weekdays (empty is every day) and the zone (defaults to the person's). */
  time?: string;
  days?: number[];
  zone?: string;
  provenance?: string;
};

export type PublicSchedule = {
  id: string;
  kind: string;
  executor: string;
  once_at: string | null;
  time: string | null;
  days: number[] | null;
  zone: string | null;
  what: { targets: string[]; action?: string; value?: number };
  enabled: boolean;
  state: string;
  paused_reason: string | null;
  created_at: string;
};

export type CreateScheduleResult =
  | { ok: true; id: string; executor: "home_assistant" | "hub"; fellBack: boolean; task: PublicSchedule }
  | { ok: false; reason: "not_allowed" | "sensitive" | "not_found" | "no_access" | "invalid" | "unavailable"; text: string; offerReminder: boolean };

export type TaskRow = typeof scheduledTasks.$inferSelect;

/** Automation ids made but not yet written to a row, so a reconcile that lists in between never sees them as orphans. */
export const pendingAutomationIds = new Set<string>();

const REMINDER_OFFER = " I can set a reminder for you instead.";
const REFUSALS: Record<TargetReason, { reason: Extract<CreateScheduleResult, { ok: false }>["reason"]; text: string; offerReminder: boolean }> = {
  bad_target: { reason: "invalid", text: "I could not tell which device you meant. Name a light, switch, fan or scene and try again.", offerReminder: false },
  sensitive: { reason: "sensitive", text: `A schedule runs on its own with nobody to confirm it, so locks, alarms, garage doors, cameras, entry doors and scripts cannot be scheduled.${REMINDER_OFFER}`, offerReminder: true },
  not_found: { reason: "not_found", text: "I could not find that device in your home. Check the name and try again.", offerReminder: false },
  no_access: { reason: "no_access", text: "You are not set up to control that device, so you cannot schedule it. Ask a parent to give you access.", offerReminder: false },
  scene_changed: { reason: "sensitive", text: `That scene sets something a schedule is not allowed to run, such as a lock or a device you cannot control.${REMINDER_OFFER}`, offerReminder: true },
};

function jsonOf<T>(text: string | null, fallback: T): T {
  if (text === null) return fallback;
  try { return JSON.parse(text) as T; } catch { return fallback; }
}

function hubZone(): string { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; }
export function defaultZone(personId: string): string {
  const value = getSettingValueForPerson(personId, "time.time_zone");
  return typeof value === "string" && value ? value : hubZone();
}

/** The spec record for a row (the shape validateScheduledTask and the record schema check). */
export function recordOf(row: TaskRow): Record<string, unknown> {
  return {
    id: row.id, person: row.person, kind: row.kind, executor: row.executor,
    ...(row.onceAt !== null ? { once_at: row.onceAt } : {}),
    ...(row.time !== null ? { time: row.time } : {}),
    ...(row.days !== null ? { days: jsonOf<number[]>(row.days, []) } : {}),
    ...(row.zone !== null ? { zone: row.zone } : {}),
    what: jsonOf(row.what, { targets: [] }),
    enabled: row.enabled, state: row.state,
    ...(row.pausedReason !== null ? { paused_reason: row.pausedReason } : {}),
    ...(row.externalRef !== null ? { external_ref: row.externalRef } : {}),
    grant_snapshot: jsonOf<string[]>(row.grantSnapshot, []),
    ...(row.deliverOn !== null ? { deliver_on: row.deliverOn } : {}),
    deleted_at: row.deletedAt, provenance: row.provenance, created_at: row.createdAt, updated_at: row.updatedAt, hlc: row.hlc,
  };
}

function publicOf(row: TaskRow): PublicSchedule {
  return {
    id: row.id, kind: row.kind, executor: row.executor, once_at: row.onceAt, time: row.time,
    days: row.days === null ? null : jsonOf<number[]>(row.days, []), zone: row.zone,
    what: jsonOf(row.what, { targets: [] }), enabled: row.enabled, state: row.state, paused_reason: row.pausedReason, created_at: row.createdAt,
  };
}

/** The wall clock in a zone: the date and HH:MM a Home Assistant in that zone shows for an instant. */
export function wallClock(at: Date, zone: string): { date: string; time: string } {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(at).map((part) => [part.type, part.value])) as Record<string, string>;
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

/** The automation a stored task needs, in the task's own zone. Null when the task cannot be an automation. */
export function automationSpecOf(row: TaskRow, zone: string): AutomationSpec | null {
  const what = jsonOf<{ targets: string[]; action?: AutomationAction; value?: number }>(row.what, { targets: [] });
  const parsed = what.targets.map(parseTarget);
  if (!what.action || parsed.some((entry) => entry === null)) return null;
  const spec = { action: what.action, ...(what.value !== undefined ? { value: what.value } : {}), entityIds: parsed.map((entry) => entry!.native) };
  if (row.onceAt !== null) {
    const clock = wallClock(new Date(row.onceAt), zone);
    return { ...spec, time: clock.time, date: clock.date, days: [] };
  }
  return row.time === null ? null : { ...spec, time: row.time, days: jsonOf<number[]>(row.days, []) };
}

function instanceOf(targets: readonly string[]): string | null {
  const instances = new Set(targets.map((target) => parseTarget(target)?.instance ?? ""));
  return instances.size === 1 && !instances.has("") ? [...instances][0]! : null;
}
export function instanceOfRow(row: TaskRow): string | null { return instanceOf(jsonOf<{ targets: string[] }>(row.what, { targets: [] }).targets); }

export async function createDeviceSchedule(input: CreateScheduleInput, deps: ScheduleDeps = {}): Promise<CreateScheduleResult> {
  const invalid = (text: string): CreateScheduleResult => ({ ok: false, reason: "invalid", text, offerReminder: false });
  const actor = scheduleActor(input.person);
  if (!actor) return { ok: false, reason: "not_allowed", text: "Only an adult can schedule home devices. A parent can set this up for you.", offerReminder: false };

  const now = (deps.now ?? (() => new Date()))();
  const zone = input.zone ?? (deps.zoneOf ?? defaultZone)(input.person.id);
  const once = input.onceAt !== undefined;
  if (once && (Number.isNaN(Date.parse(input.onceAt!)) || Date.parse(input.onceAt!) <= now.getTime())) return invalid("That time has already passed. Pick a time later than now.");
  if (!once && (input.time === undefined || input.days === undefined)) return invalid("Say what time to run it, and which days, or give one date and time.");
  const targets = [...new Set(input.targets.map((target) => parseTarget(target)?.key ?? target))];
  if (targets.length === 0) return invalid("Name the light, switch, fan or scene to schedule.");
  if ((input.kind === "scene") !== (input.action === "activate")) return invalid("A scene is activated, and a light, switch or fan is turned on, off or dimmed.");

  // Check the shape before any network call: the same builder makes the automation later.
  const spec: AutomationSpec = { time: once ? "00:00" : input.time!, ...(once ? { date: "2000-01-01" } : {}), days: input.days ?? [], action: input.action, ...(input.value !== undefined ? { value: input.value } : {}), entityIds: targets.map((target) => parseTarget(target)?.native ?? "") };
  if (targets.some((target) => parseTarget(target) === null)) return refusalFor("bad_target");
  if (targets.some((target) => !schedulableDomain(parseTarget(target)!.native))) return refusalFor("sensitive");
  if (buildAutomationBody(spec) === null) return invalid("That action does not fit those devices. Use on, off or a brightness for lights, and on or off for switches and fans.");

  const registry = await (deps.loadRegistry ?? loadHouseRegistries)();
  if (!registry.ok) return { ok: false, reason: "unavailable", text: "I could not reach Home Assistant to check that device. Try again in a minute.", offerReminder: false };
  const permissions = (deps.permissionsOf ?? effectivePermissions)(input.person.id);
  const checked = checkTargets({ actor, permissions, entities: registry.entities, targets });
  if (!checked.ok) return refusalFor(checked.reason);

  const id = newScheduledTaskId();
  const stamp = now.toISOString();
  const instance = instanceOf(targets);
  const base = {
    id, person: input.person.id, kind: input.kind,
    onceAt: once ? new Date(input.onceAt!).toISOString() : null,
    time: once ? null : input.time!, days: once ? null : JSON.stringify(input.days!), zone: once ? null : zone,
    what: JSON.stringify({ targets, action: input.action, ...(input.value !== undefined ? { value: input.value } : {}) }),
    enabled: true, state: "active", pausedReason: null, grantSnapshot: JSON.stringify(targets), deliverOn: null,
    provenance: input.provenance ?? "chat", createdAt: stamp, updatedAt: stamp, hlc: nextHlc(), deletedAt: null,
  } as const;

  // A one-shot keeps no zone on the record (the spec's rule); its wall clock is read in the person's zone when the automation is built.
  let row: TaskRow = { ...base, executor: "home_assistant", externalRef: null };
  const rowSpec = automationSpecOf(row, zone);
  const body = rowSpec ? buildAutomationBody(rowSpec) : null;
  let made: string | null = null;
  const connection = instance !== null && body ? houseInstanceLanFetch(instance, deps.house) : null;
  if (connection?.ok && body) {
    const automationId = (deps.newAutomationId ?? newAutomationId)();
    pendingAutomationIds.add(automationId);
    const result = await createAutomation({ lanFetch: connection.lanFetch, token: connection.token, id: automationId, body });
    if (result.ok) made = automationId; else pendingAutomationIds.delete(automationId);
  }
  row = made ? { ...row, externalRef: made } : { ...row, executor: "hub", externalRef: null };

  const parsed = ScheduledTask.safeParse(recordOf(row));
  const problems = parsed.success ? validateScheduledTask(parsed.data) : ["the record does not match the schedule shape"];
  if (problems.length > 0) {
    if (made && connection?.ok) await deleteAutomation({ lanFetch: connection.lanFetch, token: connection.token, id: made });
    if (made) pendingAutomationIds.delete(made);
    return invalid("I could not save that schedule. Check the time and the device and try again.");
  }
  db.insert(scheduledTasks).values(row).run();
  if (made) pendingAutomationIds.delete(made);
  if (row.executor === "hub") queueHubRun(row, now);
  return { ok: true, id, executor: row.executor as "home_assistant" | "hub", fellBack: made === null, task: publicOf(row) };
}

function refusalFor(reason: TargetReason): CreateScheduleResult {
  const refusal = REFUSALS[reason];
  return { ok: false, reason: refusal.reason, text: refusal.text, offerReminder: refusal.offerReminder };
}

export type CancelScheduleResult = { ok: true; automationRemoved: boolean } | { ok: false; reason: "not_found" };

/** Own rows only: the owner and admins do not cancel another person's schedule (rule 6a). Deletes the automation, then tombstones the row. */
export async function cancelSchedule(personId: string, taskId: string, deps: ScheduleDeps = {}): Promise<CancelScheduleResult> {
  const row = db.select().from(scheduledTasks).where(and(eq(scheduledTasks.id, taskId), eq(scheduledTasks.person, personId), isNull(scheduledTasks.deletedAt))).get();
  if (!row) return { ok: false, reason: "not_found" };
  let removed = row.externalRef === null;
  if (row.executor === "home_assistant" && row.externalRef !== null) {
    const instance = instanceOfRow(row);
    const connection = instance === null ? null : houseInstanceLanFetch(instance, deps.house);
    if (connection?.ok) removed = (await deleteAutomation({ lanFetch: connection.lanFetch, token: connection.token, id: row.externalRef })).ok;
  }
  const stamp = (deps.now ?? (() => new Date()))().toISOString();
  // If the automation could not be deleted now it is an orphan, and the next reconcile removes it.
  db.update(scheduledTasks).set({ deletedAt: stamp, enabled: false, updatedAt: stamp, hlc: nextHlc() }).where(eq(scheduledTasks.id, taskId)).run();
  return { ok: true, automationRemoved: removed };
}

/** A person sees only their own schedules; the opaque automation reference and the grant snapshot stay inside. */
export function listOwnSchedules(personId: string): PublicSchedule[] {
  return db.select().from(scheduledTasks).where(and(eq(scheduledTasks.person, personId), isNull(scheduledTasks.deletedAt))).all().map(publicOf);
}

/** Counts, never names or owners (rule 6a). */
export function adminScheduleCount(): { total: number; active: number; paused: number } {
  const rows = db.select({ state: scheduledTasks.state }).from(scheduledTasks).where(isNull(scheduledTasks.deletedAt)).all();
  return { total: rows.length, active: rows.filter((row) => row.state === "active").length, paused: rows.filter((row) => row.state === "paused").length };
}
