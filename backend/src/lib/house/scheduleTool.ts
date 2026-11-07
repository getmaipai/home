// SCHED-02 / HOUSE-04 part B: the three schedule actions of the `house` tool (schedule, list_schedules, cancel_schedule).
// Reminders and timers stay on `remind` and `timer`; these are for lights, switches, fans and scenes only.
// Everything the person sees is built by code from the structured `when`: no word list and no regex (rule budget).
// Names appear only in the person-facing reply, never in a tool audit row or a log.
import { z } from "zod";
import { checkTargets, scheduleActor, type TargetReason } from "@/lib/schedules/guard";
import { adminScheduleCount, cancelSchedule, createDeviceSchedule, defaultZone, listOwnSchedules, type PublicSchedule, type ScheduleDeps } from "@/lib/schedules/store";
import type { EffectivePermission, HouseActor } from "./access";
import type { HouseArea, HouseEntity } from "./registry";

export const SCHEDULE_ACTIONS = ["schedule", "list_schedules", "cancel_schedule"] as const;
export type ScheduleActionName = (typeof SCHEDULE_ACTIONS)[number];
export const isScheduleAction = (action: string): action is ScheduleActionName => (SCHEDULE_ACTIONS as readonly string[]).includes(action);
export const SCHEDULE_DO = ["turn_on", "turn_off", "set_brightness", "activate"] as const;

function validTime(text: string): boolean {
  const parts = text.split(":");
  if (parts.length !== 2 || parts[0]!.length !== 2 || parts[1]!.length !== 2) return false;
  const [hour, minute] = parts.map(Number) as [number, number];
  return Number.isInteger(hour) && Number.isInteger(minute) && hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
}

/** Either a wall-clock repeat or one instant. No cron and no free text; the zone is never sent by the model. */
export const whenShape = z.union([
  z.object({ time: z.string().length(5).refine(validTime, "time must be HH:MM"), days: z.array(z.number().int().min(1).max(7)).max(7).optional() }).strict(),
  z.object({ once_at: z.string().min(10).max(40).refine((value) => !Number.isNaN(Date.parse(value)), "once_at must be a timestamp") }).strict(),
]);
export type ScheduleWhen = z.infer<typeof whenShape>;

/** Adult actors only, on top of the surface gate `houseAllowed` already applies (written, private, not a guest). */
export function canUseSchedules(actor: HouseActor | undefined): boolean {
  return !!actor && actor.band === "adult" && scheduleActor({ id: actor.id ?? "", role: actor.role }) !== null;
}

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const swapSpaces = (text: string): string => text.split(" ").join(" ");
const clock = (hour: number, minute: number): string => swapSpaces(new Date(Date.UTC(2000, 0, 1, hour, minute)).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" }));

/** "every day at 4:00 PM", "on Mon, Wed at 7:30 AM", "once on Nov 12 at 6:00 PM". Built from the structured value. */
export function describeWhen(when: { time?: string | null; days?: readonly number[] | null; once_at?: string | null }, zone: string): string {
  if (when.once_at) {
    const at = new Date(when.once_at);
    const day = at.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: zone });
    const time = swapSpaces(at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: zone }));
    return `once on ${day} at ${time}`;
  }
  const [hour, minute] = (when.time ?? "00:00").split(":").map(Number) as [number, number];
  const days = [...new Set(when.days ?? [])].sort((a, b) => a - b);
  return `${days.length === 0 || days.length === 7 ? "every day" : `on ${days.map((day) => DAY_NAMES[day - 1]).join(", ")}`} at ${clock(hour, minute)}`;
}

/** "Porch light": the name, with the kind added when the name does not already say it. */
function plainName(entity: HouseEntity): string { return entity.name.trim().toLocaleLowerCase().includes(entity.kind) ? entity.name.trim() : `${entity.name.trim()} ${entity.kind}`; }
/** Just the time: "4:00 PM", or "Nov 12, 6:00 PM" for a one-shot. Used where a name already says the rest. */
function shortWhen(row: PublicSchedule, zone: string): string {
  if (row.once_at) {
    const at = new Date(row.once_at);
    return `${at.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: zone })}, ${swapSpaces(at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: zone }))}`;
  }
  const [hour, minute] = (row.time ?? "00:00").split(":").map(Number) as [number, number];
  return clock(hour, minute);
}
const keyOf = (entity: Pick<HouseEntity, "id" | "instance">): string => `${entity.instance ?? "default"}/${entity.id}`;

const PROMPT_VERB: Record<string, string> = { turn_on: "Turn on", turn_off: "Turn off", activate: "Run" };
export function schedulePrompt(labels: readonly string[], doAction: string, value: number | undefined, whenText: string): string {
  const named = labels.slice(0, 3).join(", ");
  const more = labels.length > 3 ? ` and ${labels.length - 3} more` : "";
  const what = doAction === "set_brightness" ? `Set ${named}${more} to ${value}% brightness` : `${PROMPT_VERB[doAction] ?? "Run"} ${named}${more}`;
  return `${what} ${whenText}?`;
}

const REMINDER = " I can set a reminder instead.";
const REFUSAL_TEXT: Partial<Record<TargetReason, string>> = {
  sensitive: `A schedule runs on its own with nobody to confirm it, so locks, alarms, garage doors, cameras, entry doors and scripts cannot be scheduled.${REMINDER}`,
  scene_changed: `That scene sets something a schedule is not allowed to run, such as a lock or a device you cannot control.${REMINDER}`,
  no_access: "You are not set up to control that device, so you cannot schedule it. Ask a parent to give you access.",
  scene_unknown: "I could not read what that scene sets just now. Try again in a minute.",
};

export type SchedulePlan =
  | { kind: "refuse"; reason: string; text: string; count: number }
  | { kind: "ask"; reason: string; action: string; count: number; kinds: string[]; labels: string[]; prompt: string }
  | { kind: "run"; matches: HouseEntity[]; count: number };

type Resolve = (targets: NonNullable<ScheduleArgs["targets"]>, entities: HouseEntity[], areas: HouseArea[]) => { matches: HouseEntity[]; ambiguous?: string[]; acrossInstances?: string[]; missing?: boolean };
export type ScheduleArgs = {
  action: ScheduleActionName;
  targets?: Array<{ area?: string; name?: string; kind?: "light" | "switch" | "scene" | "cover" | "lock" | "fan" | "climate" }>;
  do?: (typeof SCHEDULE_DO)[number];
  value?: number;
  when?: ScheduleWhen;
};

const refuse = (reason: string, text: string, count = 0): SchedulePlan => ({ kind: "refuse", reason, text, count });
const NOT_FOUND = "I could not find a visible device matching that area or name.";

function whenOfRow(row: PublicSchedule, zone: string): string { return describeWhen({ time: row.time, days: row.days, once_at: row.once_at }, zone); }

/** The speaker's own schedules whose targets include one of these devices, narrowed by `when` when given. */
function ownMatching(personId: string, devices: readonly HouseEntity[], when: ScheduleWhen | undefined): PublicSchedule[] {
  const keys = new Set(devices.map(keyOf));
  return listOwnSchedules(personId).filter((row) => row.what.targets.some((target) => keys.has(target)) && (
    !when ? true : "once_at" in when ? row.once_at !== null && Date.parse(row.once_at) === Date.parse(when.once_at) : row.time === when.time));
}

export function planSchedule(ctx: {
  args: ScheduleArgs; actor: HouseActor; registry: { areas: HouseArea[]; entities: HouseEntity[] }; permissions: readonly EffectivePermission[];
  visible: HouseEntity[]; approved: boolean; resolve: Resolve; label: (entity: HouseEntity, areas: HouseArea[]) => string; zone?: string;
}): SchedulePlan {
  const { args, actor, registry } = ctx;
  // Rule 0 and 1: anyone who is not an adult on a private surface finds nothing.
  if (!canUseSchedules(actor)) return refuse("missing", NOT_FOUND);
  if (args.action === "list_schedules") return { kind: "run", matches: [], count: 0 };
  const zone = ctx.zone ?? defaultZone(actor.id ?? "");
  if (!args.targets || args.targets.length === 0) return refuse("invalid", "Name the light, switch, fan or scene.");

  if (args.action === "cancel_schedule") {
    const resolved = ctx.resolve(args.targets, registry.entities, registry.areas);
    if (resolved.missing || resolved.matches.length === 0) return refuse("missing", NOT_FOUND);
    if (resolved.ambiguous) return refuse("ambiguous", `That name matches more than one device: ${resolved.ambiguous.join(", ")}. Please be more specific.`, resolved.ambiguous.length);
    if (resolved.acrossInstances) return refuse("ambiguous", `That name matches in more than one home: ${resolved.acrossInstances.join(" or ")}. Say which one.`, resolved.acrossInstances.length);
    const rows = ownMatching(actor.id ?? "", resolved.matches, args.when);
    if (rows.length === 0) return refuse("missing", "You have no schedule for that.");
    if (rows.length > 1) {
      const names = new Map(registry.entities.map((entity) => [keyOf(entity), entity.name]));
      const each = rows.map((row) => `${names.get(row.what.targets[0]!) ?? "A device"} at ${shortWhen(row, zone)}`);
      return refuse("ambiguous", `You have more than one schedule for that: ${each.join("; ")}. Say which time to cancel.`, rows.length);
    }
    return { kind: "run", matches: resolved.matches, count: 1 };
  }

  const resolved = ctx.resolve(args.targets, ctx.visible, registry.areas);
  if (resolved.acrossInstances) return refuse("ambiguous", `That name matches in more than one home: ${resolved.acrossInstances.join(" or ")}. Say which one.`, resolved.acrossInstances.length);
  if (resolved.ambiguous) return refuse("ambiguous", `That name matches more than one device: ${resolved.ambiguous.join(", ")}. Please be more specific.`, resolved.ambiguous.length);
  if (resolved.missing || resolved.matches.length === 0) return refuse("missing", NOT_FOUND);
  if (resolved.matches.length > 12) return refuse("bulk", "That would schedule too many devices at once. Choose a smaller area or name specific devices.", resolved.matches.length);
  if (!args.when) return refuse("invalid", "Say when: a time of day (and days), or one date and time.");
  const scenes = resolved.matches.filter((entity) => entity.kind === "scene").length;
  if (scenes !== 0 && scenes !== resolved.matches.length) return refuse("invalid", "A scene and a device cannot share one schedule. Schedule them separately.");
  const doAction = args.do ?? (scenes > 0 ? "activate" : undefined);
  if (!doAction || (doAction === "activate") !== (scenes > 0) || (doAction === "set_brightness" && !(args.value !== undefined && args.value >= 1 && args.value <= 100))) {
    return refuse("invalid", "Use on, off or a brightness from 1 to 100 for lights, on or off for switches and fans, and activate for scenes.");
  }
  // Refuse before asking: a lock, a script, a scene with a sensitive member or a device the speaker cannot control is never offered a yes.
  const checked = checkTargets({ actor, permissions: ctx.permissions, entities: registry.entities, targets: resolved.matches.map(keyOf) });
  if (!checked.ok) return refuse("schedule_refused", REFUSAL_TEXT[checked.reason] ?? NOT_FOUND, resolved.matches.length);
  const labels = resolved.matches.map((entity) => ctx.label(entity, registry.areas));
  const prompt = schedulePrompt(labels, doAction, args.value, describeWhen(args.when as { time?: string; days?: number[]; once_at?: string }, zone));
  // A schedule runs without Home's brakes, so it always asks, whatever tools.house.mode says (mode "never" is refused before this).
  if (!ctx.approved) return { kind: "ask", reason: "confirmation_required", action: "schedule", count: resolved.matches.length, kinds: [...new Set(resolved.matches.map((entity) => entity.kind))], labels, prompt };
  return { kind: "run", matches: resolved.matches, count: resolved.matches.length };
}

export type ScheduleOutcome = { ok: true; text: string } | { ok: false; kind: "bad_arguments" | "found_nothing" | "unavailable"; text: string };

const PAUSED_WORDS: Record<string, string> = {
  grant_revoked: "paused because you can no longer control the device",
  scene_changed: "paused because the scene changed",
  automation_unavailable: "paused because Home Assistant could not take it",
  owner_removed: "paused because its owner was removed",
};
const DONE_WORDS: Record<string, string> = { turn_on: "turns on", turn_off: "turns off", activate: "runs" };

function listLine(row: PublicSchedule, names: Map<string, string>, zone: string): string {
  const targets = row.what.targets.map((target) => names.get(target) ?? "a device");
  const subject = `${targets.slice(0, 3).join(", ")}${targets.length > 3 ? ` and ${targets.length - 3} more` : ""}`;
  const action = row.what.action === "set_brightness" ? `is set to ${row.what.value}%` : DONE_WORDS[row.what.action ?? ""] ?? "runs";
  const state = row.state === "paused" ? ` (${PAUSED_WORDS[row.paused_reason ?? ""] ?? "paused"})` : row.state === "done" ? " (done)" : "";
  return `${subject} ${action} ${whenOfRow(row, zone)}${state}`;
}

export async function runScheduleAction(ctx: {
  args: ScheduleArgs; actor: HouseActor; role: string; matches: HouseEntity[]; registry: { entities: HouseEntity[] }; permissions: readonly EffectivePermission[];
  deps?: ScheduleDeps; zone?: string;
}): Promise<ScheduleOutcome> {
  const personId = ctx.actor.id ?? "";
  const zone = ctx.zone ?? ctx.deps?.zoneOf?.(personId) ?? defaultZone(personId);
  if (!canUseSchedules(ctx.actor)) return { ok: false, kind: "found_nothing", text: NOT_FOUND };
  const names = new Map(ctx.registry.entities.map((entity) => [keyOf(entity), plainName(entity)]));

  if (ctx.args.action === "list_schedules") {
    const own = listOwnSchedules(personId).filter((row) => row.state !== "done");
    const others = ctx.role === "owner" || ctx.role === "admin" ? adminScheduleCount().total - listOwnSchedules(personId).length : 0;
    const lines = own.map((row) => listLine(row, names, zone));
    const count = others > 0 ? `${others} ${others === 1 ? "schedule belongs" : "schedules belong"} to other people.` : "";
    if (lines.length === 0) return { ok: true, text: `You have no device schedules.${count ? ` ${count}` : ""}` };
    return { ok: true, text: `Your schedules: ${lines.join("; ")}.${count ? ` ${count}` : ""}` };
  }

  if (ctx.args.action === "cancel_schedule") {
    const rows = ownMatching(personId, ctx.matches, ctx.args.when);
    if (rows.length !== 1) return { ok: false, kind: rows.length === 0 ? "found_nothing" : "bad_arguments", text: rows.length === 0 ? "You have no schedule for that." : "More than one schedule matches. Say which time to cancel." };
    const result = await cancelSchedule(personId, rows[0]!.id, ctx.deps);
    return result.ok ? { ok: true, text: `Cancelled: ${listLine(rows[0]!, names, zone)}.` } : { ok: false, kind: "found_nothing", text: "You have no schedule for that." };
  }

  const scenes = ctx.matches.some((entity) => entity.kind === "scene");
  const when = ctx.args.when!;
  const doAction = ctx.args.do ?? "activate";
  const created = await createDeviceSchedule({
    person: { id: personId, role: ctx.role }, kind: scenes ? "scene" : "device_action", targets: ctx.matches.map(keyOf), action: doAction,
    ...(ctx.args.value !== undefined ? { value: ctx.args.value } : {}),
    ...("once_at" in when ? { onceAt: when.once_at } : { time: when.time, days: when.days ?? [] }),
    zone, provenance: "chat",
  }, { permissionsOf: () => [...ctx.permissions], loadRegistry: async () => ({ ok: true, areas: [], entities: ctx.registry.entities }), ...ctx.deps });
  if (!created.ok) {
    if (created.reason === "invalid") return { ok: false, kind: "bad_arguments", text: created.text };
    if (created.reason === "unavailable") return { ok: false, kind: "unavailable", text: created.text };
    return { ok: true, text: created.text };
  }
  const labels = ctx.matches.map(plainName);
  const subject = `${labels.slice(0, 3).join(", ")}${labels.length > 3 ? ` and ${labels.length - 3} more` : ""}`;
  const verb = doAction === "set_brightness" ? `is set to ${ctx.args.value}%` : DONE_WORDS[doAction] ?? "runs";
  const note = created.fellBack ? " Home Assistant could not take it, so Home will run it." : "";
  return { ok: true, text: `Done. ${subject} ${verb} ${describeWhen(when as { time?: string; days?: number[]; once_at?: string }, zone)}.${note}` };
}
