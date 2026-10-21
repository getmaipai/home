import { getRobotSoftware } from "@/lib/robotSoftware";
import { setRobotFirmwareInstalled } from "@/lib/settings";
import { touchDevice } from "@/lib/devices";

export const ROBOT_CHECKIN_ONLINE_MS = 150_000;

export type RobotCheckin = {
  device_id: string;
  board: string;
  online: boolean;
  last_seen: string;
  connected_since: string | null;
  ip: string | null;
  firmware_version: string | null;
  bot_version: string | null;
  rssi: number | null;
  signal: "strong" | "medium" | "weak" | null;
  free_heap_internal: number | null;
  free_heap_min: number | null;
  psram_free: number | null;
  boot_reason: number | null;
  crash_resets: number | null;
  battery_level: number | null;
  charging: boolean | null;
};

const latest = new Map<string, { value: RobotCheckin; receivedAt: number }>();

/** Store the newest body report in memory; only last-seen and the installed firmware are durable. */
export function recordRobotCheckin(deviceId: string, value: RobotCheckin, setBy: string): void {
  const now = Date.now();
  latest.set(deviceId, { value: { ...value, device_id: deviceId }, receivedAt: now });
  touchDevice(deviceId);
  if (value.firmware_version !== null) {
    const installed = getRobotSoftware(deviceId).firmware.installed;
    if (installed?.version !== value.firmware_version) {
      setRobotFirmwareInstalled(deviceId, { version: value.firmware_version, at: new Date(now).toISOString() }, setBy);
    }
  }
}

export function getRobotCheckin(deviceId: string, now = Date.now()): (RobotCheckin & { online: boolean }) | null {
  const report = latest.get(deviceId);
  if (!report) return null;
  return { ...report.value, online: report.value.online && now - report.receivedAt < ROBOT_CHECKIN_ONLINE_MS };
}

export function forgetRobotCheckin(deviceId: string): void { latest.delete(deviceId); }
