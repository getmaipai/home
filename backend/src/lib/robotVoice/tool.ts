// ROBOT-VOICE-01: the model-callable `robot_timer` and `robot_announce` tools. They send the StackChan body's own device commands
// (timer_set, alarm_set, timer_list, timer_cancel, timer_stop, timer_snooze, announce) over the robot channel and answer from the robot's
// own ack (the hub stores nothing of it). The model decides when to call them (rule 1): they are offered by structure alone, on a turn that
// comes from a StackChan body with timers on (robot_timer) or to an adult who has such a body to speak through (robot_announce). When the
// body is not one, or is away, the household's own `timer` and `remind` tools stay the way (rule 6: a failed tool never fails the answer).
import { z } from "zod";
import type { ToolSpec } from "@/lib/llm";
import { outcomeOf, type ToolExecutionOutcome } from "@/lib/turnContext";
import { recordToolAudit } from "@/lib/toolAudit";
import { isOwnerOrAdmin } from "@/lib/access";
import { listDevicesByKind, type Device } from "@/lib/devices";
import { awaitDeviceCommandAck, issueDeviceCommand, retractUndeliveredDeviceCommand, robotChannelConnected } from "@/lib/deviceCommands";
import { getRobotCheckin } from "@/lib/robotCheckin";
import { getDeviceSettingValue } from "@/lib/settings";
import type { PersonRow } from "@/types";
import { ROBOT_ANNOUNCE_TOOL_ID, ROBOT_TIMER_TOOL_ID } from "./ids";
export { ROBOT_ANNOUNCE_TOOL_ID, ROBOT_TIMER_TOOL_ID } from "./ids";

/** The first Bot release that answers the timer and announce commands. */
export const ROBOT_VOICE_MIN_BOT = "0.2.65";
/** How long a turn waits for the robot's answer. */
export const ROBOT_ACK_WAIT_MS = 10_000;
const TIMER_COMMAND_EXPIRY_MS = 15_000;
const ANNOUNCE_COMMAND_EXPIRY_MS = 60_000;
const TEXT_MAX = 400;
const LINE_MAX = 200;

export const ROBOT_TIMER_ACTIONS = ["set", "alarm", "list", "cancel", "stop", "snooze"] as const;
type TimerAction = (typeof ROBOT_TIMER_ACTIONS)[number];

const COMMAND_KIND: Record<TimerAction, "timer_set" | "alarm_set" | "timer_list" | "timer_cancel" | "timer_stop" | "timer_snooze"> = {
  set: "timer_set", alarm: "alarm_set", list: "timer_list", cancel: "timer_cancel", stop: "timer_stop", snooze: "timer_snooze",
};

/** Audit rows take the action name only from this closed list. */
export function safeTimerAction(value: unknown): string { return typeof value === "string" && (ROBOT_TIMER_ACTIONS as readonly string[]).includes(value) ? value : "invalid"; }

const label = z.string().trim().min(1).max(60);
const TimerArgs = z.object({
  action: z.enum(ROBOT_TIMER_ACTIONS),
  seconds: z.number().int().min(1).max(86_400).optional(),
  hour: z.number().int().min(0).max(23).optional(),
  minute: z.number().int().min(0).max(59).optional(),
  label: label.optional(),
  id: z.number().int().min(1).optional(),
}).strict();

const AnnounceArgs = z.object({
  text: z.string().trim().min(1).max(TEXT_MAX),
  urgent: z.boolean().optional(),
  robot: z.string().trim().min(1).max(64).optional(),
}).strict();

export type RobotVoiceDeps = {
  device?: (id: string) => Device | null;
  robots?: () => Device[];
  /** Whether this device is a StackChan body that can answer the commands: board, Bot version and an open channel. */
  capable?: (deviceId: string) => boolean;
  setting?: (deviceId: string, key: string) => unknown;
  send?: (deviceId: string, kind: string, payload: Record<string, unknown>, expiresInMs: number) => { id: string };
  wait?: (commandId: string, timeoutMs: number) => Promise<Record<string, unknown> | null>;
  retract?: (commandId: string) => boolean;
  audit?: typeof recordToolAudit;
  waitMs?: number;
};

function versionAtLeast(version: string | null | undefined, floor: string): boolean {
  const parse = (value: string) => value.split(".").map((part) => Number.parseInt(part, 10));
  if (!version) return false;
  const have = parse(version);
  const need = parse(floor);
  if (have.some(Number.isNaN)) return false;
  for (let i = 0; i < need.length; i += 1) {
    const a = have[i] ?? 0;
    const b = need[i]!;
    if (a !== b) return a > b;
  }
  return true;
}

/** A StackChan body that can take the commands now: the check-in says its board and Bot release, and its channel is open. */
export function capableStackChanBody(deviceId: string): boolean {
  const checkin = getRobotCheckin(deviceId);
  if (!checkin?.online || !/stack-?chan/i.test(checkin.board)) return false;
  return versionAtLeast(checkin.bot_version, ROBOT_VOICE_MIN_BOT) && robotChannelConnected(deviceId);
}

const isCapable = (deps: RobotVoiceDeps, deviceId: string) => (deps.capable ?? capableStackChanBody)(deviceId);
const settingOf = (deps: RobotVoiceDeps, deviceId: string, key: string) => (deps.setting ?? getDeviceSettingValue)(deviceId, key);
const sendOf = (deps: RobotVoiceDeps) => deps.send ?? ((deviceId, kind, payload, expiresInMs) => issueDeviceCommand(deviceId, kind as Parameters<typeof issueDeviceCommand>[1], payload, expiresInMs));

const ROLES = new Set(["owner", "admin", "adult", "teen", "child"]);

/** The offer gate for `robot_timer`: the turn comes from a StackChan body that has timers on. Anyone but a guest, as the household timer is. */
export function robotTimerAllowed(input: { actor: Pick<PersonRow, "role">; surface?: string; deviceId?: string; bare: boolean }, deps: RobotVoiceDeps = {}): boolean {
  if (input.surface !== "robot" || !input.deviceId || input.bare || !ROLES.has(input.actor.role)) return false;
  if (!isCapable(deps, input.deviceId)) return false;
  return settingOf(deps, input.deviceId, "robot.timers.enabled") !== false;
}

/** The robots this person may speak through: a StackChan body that can answer, announcements on, owned by them or any when they are an owner or admin. */
export function announceTargets(actor: Pick<PersonRow, "id" | "role">, deps: RobotVoiceDeps = {}): Device[] {
  const adult = actor.role === "owner" || actor.role === "admin" || actor.role === "adult";
  if (!adult) return [];
  const robots = (deps.robots ?? (() => listDevicesByKind("robot")))();
  return robots.filter((robot) => (robot.personId === actor.id || isOwnerOrAdmin(actor))
    && isCapable(deps, robot.id) && settingOf(deps, robot.id, "robot.announce.enabled") !== false);
}

/** The offer gate for `robot_announce`: an adult, on a turn that is not bare, with at least one body to speak through. */
export function robotAnnounceAllowed(input: { actor: Pick<PersonRow, "id" | "role">; band: string; bare: boolean }, deps: RobotVoiceDeps = {}): boolean {
  if (input.band !== "adult" || input.bare) return false;
  return announceTargets(input.actor, deps).length > 0;
}

export function robotTimerToolSpec(): ToolSpec {
  return {
    id: ROBOT_TIMER_TOOL_ID,
    description: "Timers and alarms kept on this robot's own body, which ring on the robot even when the home hub is off. Use this, not the timer tool, whenever the person is talking to the robot. "
      + "set: a countdown, whole length in seconds (ten minutes is 600). alarm: ring at the next hour and minute in 24 hour time (7 in the morning is hour 7, minute 0). list: what is running and the time left. "
      + "cancel: one timer by its id from list, or every timer when no id is given; when more than one is running and the person did not say which, call list first. stop: end the timer that is ringing now. snooze: ring again after seconds (5 minutes if not said). "
      + "label is the person's name for it, such as tea. If this tool fails because the robot cannot be reached, the timer tool still works.",
    args: { type: "object", required: ["action"], properties: {
      action: { type: "string", enum: [...ROBOT_TIMER_ACTIONS] },
      seconds: { type: "integer", minimum: 1, maximum: 86_400, description: "set: the length. snooze: the delay (at most 3600)." },
      hour: { type: "integer", minimum: 0, maximum: 23 },
      minute: { type: "integer", minimum: 0, maximum: 59 },
      label: { type: "string", maxLength: 60 },
      id: { type: "integer", minimum: 1, description: "cancel: the timer's id from list." },
    }, additionalProperties: false },
  };
}

export function robotAnnounceToolSpec(targets: readonly Pick<Device, "name" | "area">[]): ToolSpec {
  const many = targets.length > 1;
  return {
    id: ROBOT_ANNOUNCE_TOOL_ID,
    description: "Have a household robot show and say a short message out loud, such as \"dinner is ready\". Use it when the person asks to tell, announce to or call someone through a robot. Say the message as the robot should speak it. "
      + "urgent is for something that cannot wait; leave it out otherwise, so the robot holds it back at night. The robot may refuse (announcements off, muted, quiet hours); say so plainly.",
    args: { type: "object", required: ["text"], properties: {
      text: { type: "string", minLength: 1, maxLength: TEXT_MAX },
      urgent: { type: "boolean" },
      ...(many ? { robot: { type: "string", enum: targets.map((target) => target.name), description: `Which robot: ${targets.map((target) => `${target.name}${target.area ? ` (${target.area})` : ""}`).join("; ")}. Leave out only when speaking from a robot, which then answers itself.` } } : {}),
    }, additionalProperties: false },
  };
}

function fail(packageId: string, callId: string, line: string, failureKind: "unavailable" | "bad_arguments" | "found_nothing", status: "failed" | "rejected" = "failed"): ToolExecutionOutcome {
  return outcomeOf({ callId, packageId, status, via: "tool_call", args: {}, durationMs: 0, errorCode: "robot_voice_tool", failureKind, userMessage: line } as Parameters<typeof outcomeOf>[0]);
}

function ok(packageId: string, callId: string, args: Record<string, unknown>, line: string): ToolExecutionOutcome {
  return outcomeOf({ callId, packageId, status: "succeeded", via: "tool_call", args, durationMs: 0, result: { reply: { text: line }, data: {}, actions: [] } });
}

const clip = (value: unknown, max = LINE_MAX): string => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** "10 minutes", "1 hour 5 minutes", "45 seconds". */
export function spokenDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  if (seconds < 60) return `${seconds} ${seconds === 1 ? "second" : "seconds"}`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  const part = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;
  const parts = [hours ? part(hours, "hour") : "", minutes ? part(minutes, "minute") : "", hours === 0 && rest ? part(rest, "second") : ""].filter(Boolean);
  return parts.join(" ");
}

function clockTime(hour: number, minute: number): string {
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}:${String(minute).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`;
}

type Sent = { kind: "answer"; state: Record<string, unknown> } | { kind: "unanswered"; reached: boolean } | { kind: "away" };

/** Sends one command and waits for the robot's ack. `reached` is whether the robot received it, so a later reconnect cannot replay an unreached one. */
async function sendAndWait(deps: RobotVoiceDeps, deviceId: string, kind: string, payload: Record<string, unknown>, expiresInMs: number): Promise<Sent> {
  if (!isCapable(deps, deviceId)) return { kind: "away" };
  const command = sendOf(deps)(deviceId, kind, payload, expiresInMs);
  const state = await (deps.wait ?? awaitDeviceCommandAck)(command.id, deps.waitMs ?? ROBOT_ACK_WAIT_MS);
  if (state) return { kind: "answer", state };
  const retracted = (deps.retract ?? retractUndeliveredDeviceCommand)(command.id);
  return { kind: "unanswered", reached: !retracted };
}

function payloadFor(input: z.infer<typeof TimerArgs>): { payload: Record<string, unknown> } | { error: string } {
  const withLabel = input.label ? { label: input.label } : {};
  switch (input.action) {
    case "set":
      return input.seconds === undefined ? { error: "Say how long the timer should run, in seconds." } : { payload: { seconds: input.seconds, ...withLabel } };
    case "alarm":
      return input.hour === undefined || input.minute === undefined ? { error: "Say the hour and minute for the alarm." } : { payload: { hour: input.hour, minute: input.minute, ...withLabel } };
    case "cancel": return { payload: input.id === undefined ? {} : { id: input.id } };
    case "snooze":
      return input.seconds !== undefined && input.seconds > 3600 ? { error: "A snooze can be at most one hour." } : { payload: input.seconds === undefined ? {} : { seconds: input.seconds } };
    default: return { payload: {} };
  }
}

function timerLine(input: z.infer<typeof TimerArgs>, state: Record<string, unknown>): string {
  const named = input.label ? ` called ${input.label}` : "";
  switch (input.action) {
    case "set": return `Timer set for ${spokenDuration(input.seconds!)}${named}.`;
    case "alarm": return `Alarm set for ${clockTime(input.hour!, input.minute!)}${named}.`;
    case "cancel": return input.id === undefined ? "Cancelled all the timers on the robot." : "Cancelled that timer.";
    case "stop": return "Stopped the ringing.";
    case "snooze": return `Snoozed for ${spokenDuration(input.seconds ?? 300)}.`;
    default: {
      const rows = Array.isArray(state.timers) ? state.timers.filter((row): row is Record<string, unknown> => !!row && typeof row === "object") : [];
      if (rows.length === 0) return "No timers or alarms are running on the robot.";
      const items = rows.slice(0, 8).map((row) => {
        const left = typeof row.left === "number" && Number.isFinite(row.left) ? `${spokenDuration(row.left)} left` : "running";
        const name = clip(row.label, 60);
        const id = typeof row.id === "number" ? ` (id ${row.id})` : "";
        return `${row.kind === "alarm" ? "alarm" : "timer"}${name ? ` ${name}` : ""}${id}: ${left}`;
      });
      return `${rows.length} running on the robot. ${items.join("; ")}.`;
    }
  }
}

const sentWords = (input: z.infer<typeof TimerArgs>): string => {
  const named = input.label ? ` called ${input.label}` : "";
  switch (input.action) {
    case "set": return `set a timer for ${spokenDuration(input.seconds!)}${named}`;
    case "alarm": return `set an alarm for ${clockTime(input.hour!, input.minute!)}${named}`;
    case "cancel": return "cancel the timer";
    case "stop": return "stop the ringing";
    case "snooze": return `snooze for ${spokenDuration(input.seconds ?? 300)}`;
    default: return "list its timers";
  }
};

export async function runRobotTimerTool({ actor, band, args, callId, deviceId, deps = {} }: { actor: Pick<PersonRow, "id" | "role">; band: string; args: Record<string, unknown>; callId: string; deviceId: string | undefined; deps?: RobotVoiceDeps }): Promise<ToolExecutionOutcome> {
  const audit = deps.audit ?? recordToolAudit;
  const action = safeTimerAction(args.action);
  const done = (outcome: ToolExecutionOutcome, good: boolean): ToolExecutionOutcome => {
    audit({ personId: actor.id, tool: ROBOT_TIMER_TOOL_ID, action, decision: good ? "do" : "never", band, count: 1 });
    return outcome;
  };
  const failed = (line: string, kind: "unavailable" | "bad_arguments" | "found_nothing", status: "failed" | "rejected" = "failed") => done(fail(ROBOT_TIMER_TOOL_ID, callId, line, kind, status), false);
  if (!deviceId) return failed("Robot timers are only for a person talking to the robot.", "found_nothing", "rejected");
  const parsed = TimerArgs.safeParse(args);
  if (!parsed.success) return failed("That timer request was not valid. Give the action and the length or the time.", "bad_arguments", "rejected");
  const input = parsed.data;
  const built = payloadFor(input);
  if ("error" in built) return failed(built.error, "bad_arguments", "rejected");
  if (settingOf(deps, deviceId, "robot.timers.enabled") === false) return failed("Timers are turned off on this robot.", "unavailable");

  const sent = await sendAndWait(deps, deviceId, COMMAND_KIND[input.action], built.payload, TIMER_COMMAND_EXPIRY_MS);
  if (sent.kind === "away") return failed("The robot is not connected right now, so nothing was set on it.", "unavailable");
  if (sent.kind === "unanswered") {
    if (!sent.reached) return failed("The robot did not answer, so nothing was set on it.", "unavailable");
    // Delivered but unanswered: it may well have done it. Say what was asked, and do not claim it worked.
    return done(ok(ROBOT_TIMER_TOOL_ID, callId, { action }, `I asked the robot to ${sentWords(input)}, but it has not confirmed, so I can't say it worked.`), true);
  }
  if (sent.state.ok === false) {
    const why = clip(sent.state.error) || "The robot could not do that.";
    return done(ok(ROBOT_TIMER_TOOL_ID, callId, { action }, why), true);
  }
  if (sent.state.ok !== true) return failed("The robot did not confirm that, so nothing is known to be set on it.", "unavailable");
  return done(ok(ROBOT_TIMER_TOOL_ID, callId, { action }, timerLine(input, sent.state)), true);
}

const REFUSAL: Record<string, string> = {
  disabled: "announcements are turned off on it",
  muted: "it is muted",
  quiet: "it is in quiet hours",
  night: "it is holding back normal announcements at night; it will say an urgent one",
};

export async function runRobotAnnounceTool({ actor, band, args, callId, turnDeviceId, deps = {} }: { actor: Pick<PersonRow, "id" | "role">; band: string; args: Record<string, unknown>; callId: string; turnDeviceId?: string; deps?: RobotVoiceDeps }): Promise<ToolExecutionOutcome> {
  const audit = deps.audit ?? recordToolAudit;
  const done = (outcome: ToolExecutionOutcome, good: boolean): ToolExecutionOutcome => {
    audit({ personId: actor.id, tool: ROBOT_ANNOUNCE_TOOL_ID, action: "announce", decision: good ? "do" : "never", band, count: 1 });
    return outcome;
  };
  const failed = (line: string, kind: "unavailable" | "bad_arguments" | "found_nothing", status: "failed" | "rejected" = "failed") => done(fail(ROBOT_ANNOUNCE_TOOL_ID, callId, line, kind, status), false);
  if (band !== "adult") return failed("Announcements through a robot are for adults.", "found_nothing", "rejected");
  const parsed = AnnounceArgs.safeParse(args);
  if (!parsed.success) return failed("That announcement was not valid. Give the words the robot should say.", "bad_arguments", "rejected");
  const input = parsed.data;
  const targets = announceTargets(actor, deps);
  if (targets.length === 0) return failed("There is no robot that can speak an announcement right now.", "unavailable");

  let target: Device | undefined;
  if (input.robot !== undefined) {
    const wanted = input.robot.toLocaleLowerCase();
    const named = targets.filter((robot) => robot.name.toLocaleLowerCase() === wanted);
    const byRoom = named.length ? named : targets.filter((robot) => (robot.area ?? "").toLocaleLowerCase() === wanted);
    if (byRoom.length > 1) return failed("More than one robot has that name. Ask which one.", "bad_arguments", "rejected");
    target = byRoom[0];
    if (!target) return failed(`No robot called ${clip(input.robot, 64)} can speak an announcement. They are ${targets.map((robot) => robot.name).join(", ")}.`, "found_nothing", "rejected");
  } else if (turnDeviceId && targets.some((robot) => robot.id === turnDeviceId)) {
    target = targets.find((robot) => robot.id === turnDeviceId);
  } else if (targets.length === 1) {
    target = targets[0];
  } else {
    return failed(`Which robot? They are ${targets.map((robot) => `${robot.name}${robot.area ? ` (${robot.area})` : ""}`).join(", ")}.`, "bad_arguments", "rejected");
  }
  const name = clip(target!.name, 64);

  const payload: Record<string, unknown> = { text: input.text, ...(input.urgent === undefined ? {} : { urgent: input.urgent }) };
  const sent = await sendAndWait(deps, target!.id, "announce", payload, ANNOUNCE_COMMAND_EXPIRY_MS);
  if (sent.kind === "away") return failed(`${name} is not connected right now, so it did not say it.`, "unavailable");
  if (sent.kind === "unanswered") {
    if (!sent.reached) return failed(`${name} did not answer, so it did not say it.`, "unavailable");
    return done(ok(ROBOT_ANNOUNCE_TOOL_ID, callId, {}, `I asked ${name} to say it, but it has not confirmed, so I can't say it was heard.`), true);
  }
  const state = sent.state;
  if (state.status === "delivered") return done(ok(ROBOT_ANNOUNCE_TOOL_ID, callId, {}, `${name} is showing the message and saying it now.`), true);
  if (state.status === "refused") {
    const reason = typeof state.reason === "string" ? state.reason : "";
    const why = REFUSAL[reason] ?? (clip(state.error) || "it could not say it");
    return done(ok(ROBOT_ANNOUNCE_TOOL_ID, callId, {}, `${name} did not say it: ${why}.`), true);
  }
  return failed(`${name} did not confirm that it said it.`, "unavailable");
}
