// SAFETY-ALARM-01: deterministic Home Assistant sensor alarm path.
// Keep this module free of model, turn, TTS and package-host imports.
import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { devices, people, safetyAlarms } from "@/db/schema";
import { listDevicesByKind } from "@/lib/devices";
import { speakerAgeBand } from "@/lib/ageBand";
import { issueDeviceCommand, registerDeviceAlarmActionHandler } from "@/lib/deviceCommands";
import { readHomeAssistantEntityState, subscribeHomeAssistantEntities, type HomeAssistantChange } from "@/lib/integrations/homeAssistant";
import { getHouseholdSettingValue } from "@/lib/settings";
import { trigger } from "@/lib/notifications";
import { dismiss, isSuppressed, type SuppressionKind } from "@/lib/sceneSuppression";
import { setBounded } from "@/lib/boundedMap";
import { isOwnerOrAdminRole } from "@/wire";

export type SafetyAlarmKind = "smoke" | "carbon_monoxide" | "gas" | "water_leak" | "alarm_panel";
export interface SafetySensorMapping { entityId: string; area: string | null; kind: SafetyAlarmKind }
export type SafetyAlarmAction = "acknowledge" | "quiet_here" | "false_alarm";
export interface SpeakerEvidence { person: string | null; basis: "signed_in" | "voice" | "face" | "voice_and_face" | "claimed" | "unknown"; level: "confirmed" | "tentative" | "unknown" }
type AlarmRow = typeof safetyAlarms.$inferSelect;

const ALARM_KIND_SET = new Set<SafetyAlarmKind>(["smoke", "carbon_monoxide", "gas", "water_leak", "alarm_panel"]);
const DEBOUNCE_MS = 10_000;
const candidates = new Map<string, { timer: ReturnType<typeof setTimeout>; mapping: SafetySensorMapping }>();
const lastRepeatAt = new Map<string, number>();
const heldSensors = new Map<string, SafetySensorMapping>();
const checkingHeld = new Set<string>();
const MAX_HELD_SENSORS = 200;
let clockNow = () => Date.now();
let unsubscribe: (() => void) | undefined;
let repeatTimer: ReturnType<typeof setInterval> | undefined;
let debounceMs = DEBOUNCE_MS;

function parseMapping(value: unknown): SafetySensorMapping | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.entityId !== "string" || !/^[a-z0-9_]+\.[a-z0-9_]+$/.test(row.entityId)) return null;
  if (typeof row.kind !== "string" || !ALARM_KIND_SET.has(row.kind as SafetyAlarmKind)) return null;
  const area = typeof row.area === "string" && row.area.trim() ? row.area.trim().slice(0, 80) : null;
  return { entityId: row.entityId, area, kind: row.kind as SafetyAlarmKind };
}

export function safetySensorMappings(value: unknown = getHouseholdSettingValue("safety.alarm.sensors")): SafetySensorMapping[] {
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    const unique = new Map<string, SafetySensorMapping>();
    for (const entry of parsed) {
      const mapping = parseMapping(entry);
      if (mapping) unique.set(mapping.entityId, mapping);
    }
    return [...unique.values()];
  } catch { return []; }
}

function activeForSensor(entityId: string): AlarmRow | undefined {
  return db.select().from(safetyAlarms)
    .where(and(eq(safetyAlarms.sensorId, entityId), eq(safetyAlarms.state, "active"))).get();
}

function activeAlarms(): AlarmRow[] {
  return db.select().from(safetyAlarms).where(eq(safetyAlarms.state, "active")).all();
}

function commandPayload(alarm: AlarmRow, state: "active" | "cleared" | "false_alarm") {
  return { alarm_id: alarm.id, area: alarm.area, kind: alarm.kind, state };
}

function broadcast(alarm: AlarmRow, state: "active" | "cleared" | "false_alarm", quieted: readonly string[] = [], onlyDeviceId?: string): void {
  const robots = listDevicesByKind("robot").filter((robot) => !onlyDeviceId || robot.id === onlyDeviceId);
  for (const robot of robots) {
    if (state === "active" && quieted.includes(robot.id)) continue;
    issueDeviceCommand(robot.id, "alarm", commandPayload(alarm, state));
  }
}

async function activate(mapping: SafetySensorMapping, opts: { afterHold?: boolean } = {}): Promise<void> {
  if (activeForSensor(mapping.entityId)) return;
  const suppressionKind = suppressedKind(mapping.kind);
  // Owner's ruling (2026-11-14): the hold covers ONLY the sensor that was acknowledged. Any other sensor, of any room, alarms at once,
  // so an acknowledged kitchen alarm can never keep a bedroom smoke sensor silent. The held sensor stays quiet until the hold ends.
  if (!opts.afterHold && suppressionKind && heldSensors.has(mapping.entityId) && isSuppressed({ kind: suppressionKind, room: mapping.area, now: clockNow() })) return;
  heldSensors.delete(mapping.entityId);
  const at = new Date().toISOString();
  const row: AlarmRow = {
    id: `alarm-${randomUUID()}`,
    sensorId: mapping.entityId,
    area: mapping.area,
    kind: mapping.kind,
    state: "active",
    startedAt: at,
    updatedAt: at,
    endedAt: null,
    endedByPersonId: null,
    quietedDevices: "[]",
  };
  db.insert(safetyAlarms).values(row).run();
  lastRepeatAt.set(row.id, clockNow());
  broadcast(row, "active");
  await trigger("safety.alarm", { area: mapping.area ?? "home", kind: mapping.kind });
}

function suppressedKind(kind: SafetyAlarmKind): SuppressionKind | null {
  switch (kind) {
    case "smoke": return "smoke";
    case "carbon_monoxide": return "co";
    case "gas": return "gas";
    case "water_leak": return "water_leak";
    case "alarm_panel": return "intrusion";
  }
}

function checkHeldSensors(now: number): void {
  for (const [entityId, mapping] of [...heldSensors]) {
    const kind = suppressedKind(mapping.kind);
    if (!kind) { heldSensors.delete(entityId); continue; }
    if (isSuppressed({ kind, room: mapping.area, now })) continue;
    if (checkingHeld.has(entityId)) continue;
    checkingHeld.add(entityId);
    // The entry leaves the map only after a successful read: a failed read is retried on the next tick, never lost.
    void (async () => {
      try {
        const state = await readHomeAssistantEntityState(mapping.entityId);
        heldSensors.delete(entityId);
        if (state?.state === "on") await activate(mapping, { afterHold: true });
      } catch (error) {
        console.error(`[safety-alarm] held sensor read failed for ${mapping.entityId}: ${String(error)}`);
      } finally {
        checkingHeld.delete(entityId);
      }
    })();
  }
}

function cancelCandidate(entityId: string): void {
  const candidate = candidates.get(entityId);
  if (candidate) clearTimeout(candidate.timer);
  candidates.delete(entityId);
}

function startCandidate(mapping: SafetySensorMapping): void {
  if (activeForSensor(mapping.entityId) || candidates.has(mapping.entityId)) return;
  const timer = setTimeout(() => {
    candidates.delete(mapping.entityId);
    void (async () => {
      try {
        const state = await readHomeAssistantEntityState(mapping.entityId);
        if (state?.state === "on" && safetySensorMappings().some((item) => item.entityId === mapping.entityId)) {
          await activate(mapping);
        }
      } catch (error) {
        console.error(`[safety-alarm] final sensor read failed for ${mapping.entityId}: ${String(error)}`);
      }
    })();
  }, debounceMs);
  candidates.set(mapping.entityId, { timer, mapping });
}

function clearActive(entityId: string): void {
  cancelCandidate(entityId);
  const row = activeForSensor(entityId);
  if (!row) return;
  const at = new Date().toISOString();
  db.update(safetyAlarms).set({ state: "cleared", updatedAt: at, endedAt: at, endedByPersonId: null }).where(eq(safetyAlarms.id, row.id)).run();
  lastRepeatAt.delete(row.id);
  broadcast({ ...row, state: "cleared", updatedAt: at, endedAt: at }, "cleared");
}

function onChange(mappingById: Map<string, SafetySensorMapping>, change: HomeAssistantChange): void {
  const mapping = mappingById.get(change.entityId);
  if (!mapping) return;
  if (change.newState.state === "on") {
    if (change.oldState?.state !== "on") startCandidate(mapping);
  } else if (["off", "clear", "disarmed"].includes(change.newState.state)) {
    clearActive(change.entityId);
  }
}

export function refreshSafetyAlarmSensors(): void {
  unsubscribe?.();
  unsubscribe = undefined;
  for (const entityId of candidates.keys()) cancelCandidate(entityId);
  const mappings = safetySensorMappings();
  const mappedIds = new Set(mappings.map((mapping) => mapping.entityId));
  for (const entityId of heldSensors.keys()) if (!mappedIds.has(entityId)) heldSensors.delete(entityId);
  const mappingById = new Map(mappings.map((mapping) => [mapping.entityId, mapping]));
  if (mappings.length === 0) return;
  unsubscribe = subscribeHomeAssistantEntities(
    "safety-alarm",
    mappings.map((mapping) => mapping.entityId),
    (change) => onChange(mappingById, change),
  );
}

export function initSafetyAlarm(): void {
  refreshSafetyAlarmSensors();
  if (repeatTimer) clearInterval(repeatTimer);
  repeatTimer = setInterval(() => {
    const intervalSeconds = Math.max(10, Math.min(60, Number(getHouseholdSettingValue("safety.alarm.repeat_seconds") ?? 20) || 20));
    const now = clockNow();
    checkHeldSensors(now);
    for (const alarm of activeAlarms()) {
      const last = lastRepeatAt.get(alarm.id) ?? Date.parse(alarm.startedAt);
      if (now - last < intervalSeconds * 1_000) continue;
      const quieted = safeQuietedDevices(alarm.quietedDevices);
      broadcast(alarm, "active", quieted);
      lastRepeatAt.set(alarm.id, now);
    }
  }, 1_000);
}

function safeQuietedDevices(value: string): string[] {
  try { const parsed: unknown = JSON.parse(value); return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []; }
  catch { return []; }
}

function endAlarm(row: AlarmRow, state: "acknowledged" | "false_alarm", personId: string): void {
  const at = new Date().toISOString();
  db.update(safetyAlarms).set({ state, updatedAt: at, endedAt: at, endedByPersonId: personId }).where(eq(safetyAlarms.id, row.id)).run();
  lastRepeatAt.delete(row.id);
  const outgoing = state === "false_alarm" ? "false_alarm" : "cleared";
  broadcast({ ...row, state, updatedAt: at, endedAt: at }, outgoing);
  if (state === "acknowledged") {
    const kind = suppressedKind(row.kind as SafetyAlarmKind);
    if (kind) {
      dismiss({ kind, scope: "household", reason: "handled", room: row.area, now: clockNow(), byBand: "adult", byConfirmedAdult: true });
      // The acknowledged sensor may still read on: it is a source for the hold's re-alert rules (a second sensor agrees, or it is still on when the hold ends).
      setBounded(heldSensors, row.sensorId, { entityId: row.sensorId, area: row.area, kind: row.kind as SafetyAlarmKind }, MAX_HELD_SENSORS);
    }
    trigger("safety.alarm_dismissed", { area: row.area ?? "home" }).catch((error) => console.error(`[safety-alarm] dismissed notification failed: ${String(error)}`));
  }
}

export type AlarmActionResult = { ok: true; state: string } | { ok: false; status: 400 | 403 | 404; error: string };

export function applyAlarmAction(personId: string, alarmId: string, action: SafetyAlarmAction, robotId?: string): AlarmActionResult {
  const person = db.select().from(people).where(and(eq(people.id, personId), eq(people.enabled, true), isNull(people.deletedAt))).get();
  if (!person) return { ok: false, status: 403, error: "The speaker is not a household member" };
  const role = person.role;
  let robotOwner: string | null = null;
  if (robotId) {
    const robot = db.select({ id: devices.id, personId: devices.personId }).from(devices)
      .where(and(eq(devices.id, robotId), eq(devices.kind, "robot"))).get();
    if (!robot) return { ok: false, status: 403, error: "The device is not a paired robot" };
    robotOwner = robot.personId ?? null;
  }
  const isAdult = speakerAgeBand(person, new Date()) === "adult";
  if (action !== "quiet_here" && !isAdult) return { ok: false, status: 403, error: "Only an adult can act on a safety alarm" };
  // A minor may quiet only their own robot (A3: quiet_here is for a person's own device); it never silences another person's robot.
  if (action === "quiet_here" && !isAdult && robotOwner !== personId) return { ok: false, status: 403, error: "A minor can quiet only their own robot" };
  if (action === "false_alarm" && !isOwnerOrAdminRole(role)) return { ok: false, status: 403, error: "Only an admin can mark a safety alarm as false" };
  if (action === "quiet_here" && !robotId) return { ok: false, status: 400, error: "quiet_here needs a robot" };
  const row = db.select().from(safetyAlarms).where(and(eq(safetyAlarms.id, alarmId), eq(safetyAlarms.state, "active"))).get();
  if (!row) return { ok: false, status: 404, error: "No active alarm with that id" };
  if (action === "quiet_here") {
    const quieted = [...new Set([...safeQuietedDevices(row.quietedDevices), robotId!])];
    db.update(safetyAlarms).set({ quietedDevices: JSON.stringify(quieted), updatedAt: new Date().toISOString() }).where(eq(safetyAlarms.id, row.id)).run();
    issueDeviceCommand(robotId!, "alarm", commandPayload(row, "cleared"));
    return { ok: true, state: "quiet_here" };
  }
  endAlarm(row, action === "false_alarm" ? "false_alarm" : "acknowledged", personId);
  return { ok: true, state: action === "false_alarm" ? "false_alarm" : "cleared" };
}

function validSpeakerEvidence(value: unknown): value is SpeakerEvidence {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (row.person === null || typeof row.person === "string") &&
    ["signed_in", "voice", "face", "voice_and_face", "claimed", "unknown"].includes(String(row.basis)) &&
    ["confirmed", "tentative", "unknown"].includes(String(row.level));
}

export function applyRobotAlarmAction(robotId: string, alarmId: string, action: SafetyAlarmAction, rawEvidence: unknown): AlarmActionResult {
  if (!validSpeakerEvidence(rawEvidence) || rawEvidence.level !== "confirmed" || !rawEvidence.person || ["claimed", "unknown"].includes(rawEvidence.basis)) {
    return { ok: false, status: 403, error: "A confirmed speaker is required" };
  }
  if (action === "false_alarm") {
    const role = db.select({ role: people.role }).from(people).where(and(eq(people.id, rawEvidence.person), eq(people.enabled, true), isNull(people.deletedAt))).get()?.role;
    if (!role || !isOwnerOrAdminRole(role)) {
      return { ok: false, status: 403, error: "Only an admin may mark a safety alarm as false" };
    }
  }
  return applyAlarmAction(rawEvidence.person, alarmId, action, robotId);
}

export function listActiveSafetyAlarms(): Array<{ id: string; sensorId: string; area: string | null; kind: string; state: string; startedAt: string }> {
  return activeAlarms().map(({ id, sensorId, area, kind, state, startedAt }) => ({ id, sensorId, area, kind, state, startedAt }));
}

export function __setSafetyAlarmDebounceForTests(ms: number): void { debounceMs = ms; }
export function __setSafetyAlarmClockForTests(now: () => number): void { clockNow = now; }
export function __resetSafetyAlarmForTests(): void {
  unsubscribe?.(); unsubscribe = undefined;
  if (repeatTimer) clearInterval(repeatTimer);
  repeatTimer = undefined;
  for (const entityId of candidates.keys()) cancelCandidate(entityId);
  lastRepeatAt.clear();
  heldSensors.clear(); checkingHeld.clear();
  clockNow = () => Date.now();
  debounceMs = DEBOUNCE_MS;
}

registerDeviceAlarmActionHandler((robotId, alarmId, action, evidence) => applyRobotAlarmAction(robotId, alarmId, action, evidence));
