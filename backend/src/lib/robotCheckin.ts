import { setRobotFirmwareInstalled, getDeviceSettingValue } from "@/lib/settings";
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
  /** Bot 0.2.65: timers the unit is holding, how often it restarted itself, whether its restart guard is holding, and the microphone level. */
  timers_active?: number | null;
  self_restarts?: number | null;
  heal_hold?: boolean | null;
  mic_level?: number | null;
  updating?: boolean | null;
  update_progress?: number | null;
  wifi_saved?: string[] | null;
  link_encrypted?: boolean | null;
  /** Bot 0.2.103: how the robot is connected (home network, away through the laptop relay, other) and what the unit says about its hub link. */
  link_path?: "home" | "away" | "other" | null;
  link_state?: string | null;
  link_attempt?: number | null;
};

const latest = new Map<string, { value: RobotCheckin; receivedAt: number }>();
/** When the body last reported its unit connected. Other authenticated calls from the body never move this, so a powered-off unit cannot look alive. */
const unitOnlineAt = new Map<string, number>();

/** Store the newest body report in memory; only last-seen and the installed firmware are durable. */
export function recordRobotCheckin(deviceId: string, value: RobotCheckin, setBy: string): void {
  const now = Date.now();
  latest.set(deviceId, { value: { ...value, device_id: deviceId }, receivedAt: now });
  if (value.online) unitOnlineAt.set(deviceId, now);
  touchDevice(deviceId);
  if (value.firmware_version !== null) {
    // Read the stored value directly: the software status compares versions and must never decide whether a check-in succeeds.
    const stored = getDeviceSettingValue(deviceId, "robot.firmware.installed") as { version?: unknown } | null;
    if (stored?.version !== value.firmware_version) {
      setRobotFirmwareInstalled(deviceId, { version: value.firmware_version, at: new Date(now).toISOString() }, setBy);
    }
  }
}

export function getRobotCheckin(deviceId: string, now = Date.now()): (RobotCheckin & { online: boolean }) | null {
  const report = latest.get(deviceId);
  if (!report) return null;
  return { ...report.value, online: report.value.online && now - report.receivedAt < ROBOT_CHECKIN_ONLINE_MS };
}

export function getRobotUnitOnlineAt(deviceId: string): number | null { return unitOnlineAt.get(deviceId) ?? null; }

export function forgetRobotCheckin(deviceId: string): void { latest.delete(deviceId); unitOnlineAt.delete(deviceId); }
