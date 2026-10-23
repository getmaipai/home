import { and, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import { devices, deviceTokens } from "@/db/schema";
import { getRobotCheckinReceivedAt, ROBOT_CHECKIN_ONLINE_MS } from "@/lib/robotCheckin";
import { trigger as realTrigger } from "@/lib/notifications";

export const ROBOT_OFFLINE_AFTER_MS = 10 * 60_000;
export const ROBOT_OFFLINE_POLL_MS = 60_000;
let hubStartedAt = Date.now();
let trigger: typeof realTrigger = realTrigger;

export function __setRobotOfflineNotifierForTests(fn: typeof realTrigger | null): void { trigger = fn ?? realTrigger; }
export function __setRobotOfflineHubStartForTests(at: number): void { hubStartedAt = at; }

function stamp(ms: number): string { return new Date(ms).toISOString(); }

/** Checks paired robots using durable check-in state and records each outage notice once. */
export async function pollRobotOffline(now = Date.now()): Promise<void> {
  const rows = db.select().from(devices).leftJoin(deviceTokens, and(eq(deviceTokens.deviceId, devices.id), gt(deviceTokens.expiresAt, stamp(now))))
    .where(eq(devices.kind, "robot")).all();
  const seenIds = new Set<string>();
  for (const { devices: device, device_tokens: token } of rows) {
    if (!token) continue;
    if (seenIds.has(device.id)) continue;
    seenIds.add(device.id);
    const receivedAt = getRobotCheckinReceivedAt(device.id) ?? 0;
    const persistedAt = device.lastSeenAt ? Date.parse(device.lastSeenAt) : 0;
    const latestSeen = Math.max(receivedAt, persistedAt);
    if (!latestSeen) continue;
    const notificationAt = device.offlineNotifiedAt ? Date.parse(device.offlineNotifiedAt) : 0;
    if (notificationAt && persistedAt > notificationAt) {
      db.update(devices).set({ offlineNotifiedAt: null }).where(eq(devices.id, device.id)).run();
      continue;
    }
    if (latestSeen >= now - ROBOT_CHECKIN_ONLINE_MS) {
      if (device.offlineNotifiedAt !== null) db.update(devices).set({ offlineNotifiedAt: null }).where(eq(devices.id, device.id)).run();
      continue;
    }
    const outageAnchor = Math.max(latestSeen, hubStartedAt);
    if (now - outageAnchor < ROBOT_OFFLINE_AFTER_MS || device.offlineNotifiedAt !== null) continue;
    const notifiedAt = stamp(now);
    db.update(devices).set({ offlineNotifiedAt: notifiedAt }).where(eq(devices.id, device.id)).run();
    try { await trigger("robot.offline", { name: device.name }); }
    catch (error) { console.error(`[robot-offline] Could not notify about ${device.name}: ${(error as Error).message}`); }
  }
}

export function startRobotOfflineWatch(): () => void {
  hubStartedAt = Date.now();
  const timer = setInterval(() => { void pollRobotOffline().catch((error: Error) => console.error(`[robot-offline] ${error.message}`)); }, ROBOT_OFFLINE_POLL_MS);
  (timer as { unref?: () => void }).unref?.();
  return () => clearInterval(timer);
}

export function __resetRobotOfflineWatchForTests(startedAt = Date.now()): void { hubStartedAt = startedAt; trigger = realTrigger; }
