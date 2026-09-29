// ROBOT-CARD-01: state frames are short-lived telemetry, not fields on
// the synced Device record. Reachability is derived from the last
// hub-stamped report on read.
import { eq } from "drizzle-orm";
import { getCookie } from "hono/cookie";
import type { Context } from "hono";
import { RobotState, type RobotState as RobotStateFrame } from "@maipai/spec/gen/ts/robot-state.js";
import { db } from "@/db";
import { deviceStates, sessions } from "@/db/schema";
import { getDeviceById, type Device } from "@/lib/devices";
import { hashSessionToken } from "@/lib/session";
import type { AppEnv } from "@/types";

export const ROBOT_STATE_STALE_MS = 45_000;

type DeviceStateRow = typeof deviceStates.$inferSelect;

/** Resolve the device bound to the already-authenticated request session. */
export function resolveRequestDevice(c: Context<AppEnv>): Device | null {
  const token = getCookie(c, "session");
  if (!token) return null;
  const tokenHash = hashSessionToken(token);
  const row = db.select({ deviceId: sessions.deviceId }).from(sessions).where(eq(sessions.tokenHash, tokenHash)).get();
  if (!row?.deviceId) return null;
  return getDeviceById(row.deviceId);
}

export function upsertDeviceState(deviceId: string, frame: RobotStateFrame): void {
  const parsed = RobotState.parse(frame);
  const now = new Date().toISOString();
  const values = {
    deviceId,
    activity: parsed.activity,
    muted: parsed.muted,
    tracking: parsed.tracking,
    onBattery: parsed.on_battery ?? null,
    batteryLevel: parsed.battery_level ?? null,
    daemonVersion: parsed.daemon_version ?? null,
    reportedAt: now,
  };
  db.insert(deviceStates).values(values).onConflictDoUpdate({
    target: deviceStates.deviceId,
    set: {
      activity: values.activity,
      muted: values.muted,
      tracking: values.tracking,
      onBattery: values.onBattery,
      batteryLevel: values.batteryLevel,
      daemonVersion: values.daemonVersion,
      reportedAt: values.reportedAt,
    },
  }).run();
}

export interface DeviceState extends RobotStateFrame {
  on_battery: boolean | null;
  battery_level: number | null;
  daemon_version: string | null;
  reachable: boolean;
  unreachableSince: string | null;
}

export function getDeviceState(deviceId: string): DeviceState | null {
  const row = db.select().from(deviceStates).where(eq(deviceStates.deviceId, deviceId)).get() as DeviceStateRow | undefined;
  if (!row) return null;
  const reachable = Date.now() - new Date(row.reportedAt).getTime() <= ROBOT_STATE_STALE_MS;
  return {
    activity: row.activity as RobotStateFrame["activity"],
    muted: row.muted,
    tracking: row.tracking,
    on_battery: row.onBattery,
    battery_level: row.batteryLevel,
    daemon_version: row.daemonVersion,
    reachable,
    unreachableSince: reachable ? null : row.reportedAt,
  };
}
