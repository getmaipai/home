// ROBOT-CHANNEL-01: durable, typed hub-to-robot commands and the single
// authenticated WebSocket for each paired robot. Commands remain in SQLite
// for 24 hours; an ack is the point at which a command is no longer replayed.
import { randomUUID } from "node:crypto";
import { and, asc, eq, gte, isNull, lt } from "drizzle-orm";
import { DeviceCommand, type DeviceCommand as DeviceCommandShape } from "@maipai/spec/gen/ts/device-command.js";
import type { WSEvents, WSContext } from "hono/ws";
import { db } from "@/db";
import { deviceCommands, devices } from "@/db/schema";
import { updateMutedFromDeviceCommand } from "@/lib/deviceStates";
import { nextHlc } from "@/lib/hlc";
import { getRegistryKey } from "@/lib/settingsRegistry";

export const DEVICE_COMMAND_RETENTION_MS = 24 * 60 * 60 * 1000;
export const DEVICE_HEARTBEAT_MS = 15_000;

type DeviceCommandKind = DeviceCommandShape["kind"];
type DeviceCommandPayload = Record<string, unknown>;
type DeviceAlarmAction = "acknowledge" | "quiet_here" | "false_alarm";
type DeviceAlarmActionResult = { ok: true; state: string } | { ok: false; error: string };
let alarmActionHandler: ((deviceId: string, alarmId: string, action: DeviceAlarmAction, evidence: unknown) => DeviceAlarmActionResult) | undefined;

export function registerDeviceAlarmActionHandler(handler: typeof alarmActionHandler): void { alarmActionHandler = handler; }

interface CommandRow {
  id: string;
  deviceId: string;
  kind: string;
  payload: string;
  issuedAt: string;
  deliveredAt: string | null;
  ackedAt: string | null;
}

interface DeviceCommandEvent {
  type: "device-command";
  id: string;
  kind: DeviceCommandKind;
  payload: DeviceCommandPayload;
  issued_at: string;
  expires_at: string;
  hlc: string;
}

interface ActiveConnection {
  deviceId: string;
  ws: WSContext;
  lastEventId: string | undefined;
  lastHeartbeatAt: number;
  sentIds: Set<string>;
  timer: ReturnType<typeof setInterval> | undefined;
}

const connections = new Map<string, ActiveConnection>();
let heartbeatIntervalMs = DEVICE_HEARTBEAT_MS;

function eventFromRow(row: CommandRow): DeviceCommandEvent {
  const parts = row.id.split(":");
  const hlc = parts.length >= 4 ? parts.slice(0, 3).join(":") : "0:0:abcdef";
  const command = DeviceCommand.parse({
    id: row.id,
    kind: row.kind,
    payload: JSON.parse(row.payload) as unknown,
    issued_at: row.issuedAt,
    expires_at: new Date(Date.parse(row.issuedAt) + DEVICE_COMMAND_RETENTION_MS).toISOString(),
    hlc,
  }) as DeviceCommandShape;
  return { type: "device-command", ...command } as DeviceCommandEvent;
}

function sendControl(connection: ActiveConnection, message: Record<string, unknown>): void {
  if (connection.ws.readyState !== 1) return;
  try {
    connection.ws.send(JSON.stringify(message));
  } catch {
    // A disconnect can race a send. The durable command remains unacked and
    // the next authenticated connection will replay it with the same id.
  }
}

function commandRows(deviceId: string): CommandRow[] {
  const cutoff = new Date(Date.now() - DEVICE_COMMAND_RETENTION_MS).toISOString();
  const rows = db.select().from(deviceCommands)
    .where(and(eq(deviceCommands.deviceId, deviceId), gte(deviceCommands.issuedAt, cutoff)))
    .orderBy(asc(deviceCommands.issuedAt), asc(deviceCommands.id))
    .all();
  return rows as CommandRow[];
}

function replayRows(deviceId: string, lastEventId?: string): CommandRow[] {
  const rows = commandRows(deviceId);
  const cursorIndex = lastEventId ? rows.findIndex((row) => row.id === lastEventId) : -1;
  // A command after the cursor is replayed if it has not been acked. An
  // unacked command at or before the cursor is also retried: the client may
  // have received it but its acknowledgement may have been lost. Acked
  // commands are never sent twice.
  const beforeOrAtCursor = cursorIndex >= 0 ? rows.slice(0, cursorIndex + 1) : [];
  const afterCursor = cursorIndex >= 0 ? rows.slice(cursorIndex + 1) : rows;
  return [...beforeOrAtCursor, ...afterCursor].filter((row) => row.ackedAt === null);
}

function sendCommand(connection: ActiveConnection, row: CommandRow): void {
  if (connection.sentIds.has(row.id) || connection.ws.readyState !== 1) return;
  const event = eventFromRow(row);
  connection.sentIds.add(row.id);
  db.update(deviceCommands)
    .set({ deliveredAt: new Date().toISOString() })
    .where(eq(deviceCommands.id, row.id))
    .run();
  try {
    connection.ws.send(JSON.stringify(event));
  } catch {
    connection.sentIds.delete(row.id);
  }
}

function sendPending(connection: ActiveConnection): void {
  for (const row of replayRows(connection.deviceId, connection.lastEventId)) sendCommand(connection, row);
}

function pruneOldCommands(): void {
  const cutoff = new Date(Date.now() - DEVICE_COMMAND_RETENTION_MS).toISOString();
  db.delete(deviceCommands).where(lt(deviceCommands.issuedAt, cutoff)).run();
}

/** Persist and, when connected, deliver a typed command. Its id contains
 * the HLC prefix so replay reproduces the exact validated spec envelope. */
export function issueDeviceCommand(
  deviceId: string,
  kind: DeviceCommandKind,
  payload: DeviceCommandPayload,
): DeviceCommandShape {
  pruneOldCommands();
  const issuedAt = new Date().toISOString();
  const hlc = nextHlc();
  const id = `${hlc}:${randomUUID()}`;
  const command = DeviceCommand.parse({
    id,
    kind,
    payload,
    issued_at: issuedAt,
    expires_at: new Date(Date.parse(issuedAt) + DEVICE_COMMAND_RETENTION_MS).toISOString(),
    hlc,
  }) as DeviceCommandShape;
  db.insert(deviceCommands).values({
    id,
    deviceId,
    kind,
    payload: JSON.stringify(payload),
    issuedAt,
    deliveredAt: null,
    ackedAt: null,
  }).run();
  const connection = connections.get(deviceId);
  if (connection) sendPending(connection);
  return command;
}

/** Device/person scope changes go to that person's paired robots only. */
export function publishSettingsChanged(scope: string, key: string, value: unknown): void {
  const definition = getRegistryKey(key);
  if (!definition || definition.secret) return;
  let robotIds: string[] = [];
  const deviceScope = /^device:([a-z0-9-]+)$/.exec(scope);
  if (deviceScope) {
    const device = db.select({ id: devices.id }).from(devices)
      .where(and(eq(devices.id, deviceScope[1]!), eq(devices.kind, "robot"))).get();
    if (device) robotIds = [device.id];
  } else {
    const personScope = /^person:([a-z0-9-]+)$/.exec(scope);
    if (!personScope) return;
    robotIds = db.select({ id: devices.id }).from(devices)
      .where(and(eq(devices.personId, personScope[1]!), eq(devices.kind, "robot")))
      .all().map((device) => device.id);
  }
  for (const deviceId of robotIds) {
    issueDeviceCommand(deviceId, "settings_changed", { values: { [key]: value } });
  }
}

/** The asset store calls this after a device manifest changes. */
export function publishAssetChanged(manifestVersion: string, deviceId?: string): void {
  const robots = deviceId
    ? db.select({ id: devices.id }).from(devices)
      .where(and(eq(devices.id, deviceId), eq(devices.kind, "robot"))).all()
    : db.select({ id: devices.id }).from(devices).where(eq(devices.kind, "robot")).all();
  for (const robot of robots) issueDeviceCommand(robot.id, "asset_changed", { manifest_version: manifestVersion });
}

function ackCommand(deviceId: string, id: string, muted: boolean | undefined): boolean {
  const row = db.select({ id: deviceCommands.id }).from(deviceCommands)
    .where(and(eq(deviceCommands.id, id), eq(deviceCommands.deviceId, deviceId), isNull(deviceCommands.ackedAt))).get();
  if (!row) return false;
  const ackedAt = new Date().toISOString();
  db.update(deviceCommands).set({ ackedAt }).where(eq(deviceCommands.id, id)).run();
  if (muted !== undefined) updateMutedFromDeviceCommand(deviceId, muted);
  return true;
}

function isDeviceHeartbeat(value: unknown): value is { type: "heartbeat"; device_time: string } {
  if (typeof value !== "object" || value === null) return false;
  const message = value as Record<string, unknown>;
  return message.type === "heartbeat" && typeof message.device_time === "string" && Number.isFinite(Date.parse(message.device_time));
}

function isDeviceAck(value: unknown): value is { type: "ack"; id: string; state?: { muted?: boolean } } {
  if (typeof value !== "object" || value === null) return false;
  const message = value as Record<string, unknown>;
  if (message.type !== "ack" || typeof message.id !== "string") return false;
  if (message.state === undefined) return true;
  if (typeof message.state !== "object" || message.state === null) return false;
  const state = message.state as Record<string, unknown>;
  return state.muted === undefined || typeof state.muted === "boolean";
}

function parseAlarmAction(value: unknown): { alarm_id: string; action: DeviceAlarmAction; evidence: unknown } | null {
  if (!value || typeof value !== "object") return null;
  const message = value as Record<string, unknown>;
  if (message.type !== "alarm_action" || typeof message.alarm_id !== "string" || !["acknowledge", "quiet_here", "false_alarm"].includes(String(message.action))) return null;
  const raw = message.speaker_evidence;
  if (!raw || typeof raw !== "object") return { alarm_id: message.alarm_id, action: message.action as DeviceAlarmAction, evidence: null };
  const evidence = raw as Record<string, unknown>;
  const valid = (evidence.person === null || typeof evidence.person === "string") &&
    ["signed_in", "voice", "face", "voice_and_face", "claimed", "unknown"].includes(String(evidence.basis)) &&
    ["confirmed", "tentative", "unknown"].includes(String(evidence.level));
  return { alarm_id: message.alarm_id, action: message.action as DeviceAlarmAction, evidence: valid ? evidence : null };
}

function disposeConnection(connection: ActiveConnection, code?: number, reason?: string): void {
  if (connection.timer) clearInterval(connection.timer);
  connection.timer = undefined;
  if (connections.get(connection.deviceId) === connection) connections.delete(connection.deviceId);
  if (code !== undefined) connection.ws.close(code, reason);
}

/** Hono's existing Bun WebSocket adapter invokes these after the existing
 * device-session middleware has authenticated and scoped the robot. */
export function deviceCommandWebSocket(deviceId: string, lastEventId?: string): WSEvents {
  let connection: ActiveConnection | undefined;
  return {
    onOpen(_event, ws) {
      const previous = connections.get(deviceId);
      if (previous) disposeConnection(previous, 4001, "replaced by a newer device connection");
      connection = {
        deviceId,
        ws,
        lastEventId,
        lastHeartbeatAt: Date.now(),
        sentIds: new Set(),
        timer: undefined,
      };
      connections.set(deviceId, connection);
      // Every new session gets the current hub clock as a spec command;
      // subsequent heartbeat frames carry hub_time so the client can track drift.
      const hubTime = new Date().toISOString();
      issueDeviceCommand(deviceId, "time", { hub_time: hubTime });
      sendPending(connection);
      connection.timer = setInterval(() => {
        if (!connection) return;
        if (Date.now() - connection.lastHeartbeatAt > heartbeatIntervalMs * 3) {
          disposeConnection(connection, 4000, "device heartbeat timed out");
          return;
        }
        sendControl(connection, { type: "heartbeat", hub_time: new Date().toISOString() });
      }, heartbeatIntervalMs);
    },
    onMessage(event, ws) {
      if (!connection || typeof event.data !== "string") return;
      let message: unknown;
      try {
        message = JSON.parse(event.data) as unknown;
      } catch {
        sendControl(connection, { type: "error", message: "malformed control message" });
        return;
      }
      if (isDeviceHeartbeat(message)) {
        connection.lastHeartbeatAt = Date.now();
        const hubTime = new Date().toISOString();
        sendControl(connection, {
          type: "heartbeat_ack",
          hub_time: hubTime,
          device_time: message.device_time,
          drift_ms: Date.parse(hubTime) - Date.parse(message.device_time),
        });
        return;
      }
      if (isDeviceAck(message)) {
        const muted = message.state?.muted;
        if (!ackCommand(deviceId, message.id, muted)) {
          sendControl(connection, { type: "ack_rejected", id: message.id });
          return;
        }
        connection.lastEventId = message.id;
        return;
      }
      const alarmAction = parseAlarmAction(message);
      if (alarmAction) {
        const result = alarmActionHandler?.(deviceId, alarmAction.alarm_id, alarmAction.action, alarmAction.evidence) ?? { ok: false as const, error: "Alarm actions are unavailable" };
        sendControl(connection, { type: result.ok ? "alarm_action_accepted" : "alarm_action_rejected", alarm_id: alarmAction.alarm_id, ...(result.ok ? { state: result.state } : { message: result.error }) });
        return;
      }
      sendControl(connection, { type: "error", message: "unknown device channel message" });
      // `ws` is retained here so malformed input never throws out of Bun's
      // callback path, which cannot recover from an uncaught handler error.
      void ws;
    },
    onClose() {
      if (connection) disposeConnection(connection);
      connection = undefined;
    },
    onError() {
      if (connection) disposeConnection(connection);
      connection = undefined;
    },
  };
}

/** Close on revocation and during the test DB reset. */
export function closeDeviceCommandChannel(deviceId: string): void {
  const connection = connections.get(deviceId);
  if (connection) disposeConnection(connection, 4003, "device session revoked");
}

export function __resetDeviceCommandsForTests(): void {
  for (const connection of connections.values()) disposeConnection(connection, 4003, "test reset");
  connections.clear();
  heartbeatIntervalMs = DEVICE_HEARTBEAT_MS;
}

/** Keep real production cadence while letting the heartbeat test exercise
 * both directions without a 15-second wall-clock delay. */
export function __setDeviceHeartbeatIntervalForTests(intervalMs: number): void {
  heartbeatIntervalMs = intervalMs;
}
