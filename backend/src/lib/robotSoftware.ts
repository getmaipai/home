import { getDeviceSettingValue } from "@/lib/settings";
import { botReleaseVersion } from "@/lib/botRelease";
import { robotHostRunningVersion } from "@/lib/robotHost";

export type FirmwareStatus = "up_to_date" | "update_available" | "unknown";
export type BotStatus = "up_to_date" | "restart_needed" | "unknown";
export type InstalledFirmware = { version: string; at: string };
export type RobotSoftware = {
  firmware: { installed: InstalledFirmware | null; available: string; status: FirmwareStatus };
  bot: { running: string | null; available: string; status: BotStatus };
};

/** Semantic version comparison, including numeric prerelease identifiers (for example 1.2.0-beta.10 > beta.2). */
export function compareSemver(left: string, right: string): number {
  const parse = (value: string) => {
    const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value);
    if (!match) return null;
    const pre = match[4]?.split(".") ?? null;
    if (pre?.some((part) => /^\d+$/.test(part) && part.length > 1 && part.startsWith("0"))) return null;
    return { core: match.slice(1, 4), pre };
  };
  const a = parse(left); const b = parse(right);
  if (!a || !b) throw new Error("Invalid semantic version.");
  for (let i = 0; i < 3; i++) if (a.core[i] !== b.core[i]) return BigInt(a.core[i]!) < BigInt(b.core[i]!) ? -1 : 1;
  if (!a.pre && !b.pre) return 0;
  if (!a.pre) return 1;
  if (!b.pre) return -1;
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    const x = a.pre[i]; const y = b.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    const xn = /^(0|[1-9]\d*)$/.test(x) ? BigInt(x) : null;
    const yn = /^(0|[1-9]\d*)$/.test(y) ? BigInt(y) : null;
    if (xn !== null && yn !== null) return xn < yn ? -1 : 1;
    if (xn !== null) return -1;
    if (yn !== null) return 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

function installedFirmwareValue(value: unknown): InstalledFirmware | null {
  if (!value || typeof value !== "object") return null;
  const entry = value as Record<string, unknown>;
  return typeof entry.version === "string" && typeof entry.at === "string" ? { version: entry.version, at: entry.at } : null;
}

export function robotSoftwareStatus(input: { installed: InstalledFirmware | null; running: string | null; available: string }): RobotSoftware {
  const firmwareStatus: FirmwareStatus = !input.installed ? "unknown"
    : compareSemver(input.installed.version, input.available) === 0 ? "up_to_date"
      : compareSemver(input.installed.version, input.available) < 0 ? "update_available" : "unknown";
  const botStatus: BotStatus = !input.running ? "unknown"
    : compareSemver(input.running, input.available) === 0 ? "up_to_date"
      : compareSemver(input.running, input.available) < 0 ? "restart_needed" : "unknown";
  return { firmware: { installed: input.installed, available: input.available, status: firmwareStatus }, bot: { running: input.running, available: input.available, status: botStatus } };
}

export function getRobotSoftware(deviceId: string): RobotSoftware {
  const available = botReleaseVersion();
  return robotSoftwareStatus({
    installed: installedFirmwareValue(getDeviceSettingValue(deviceId, "robot.firmware.installed")),
    running: robotHostRunningVersion(deviceId),
    available,
  });
}
