import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const HOST_GUARD_STATE_DIR = () => process.env.MAIPAI_HOST_GUARD_STATE_DIR || "/var/db/maipai-host-guard";
const KEYS = ["host.guard.mode", "host.guard.hard_minutes", "host.guard.metal_minutes", "host.guard.max_reboots_per_12h"] as const;
type Values = { mode: "off" | "dry" | "live"; hard_minutes: number; metal_minutes: number; max_reboots_per_12h: number };
const clamp = (value: unknown, low: number, high: number, fallback: number) => {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? Math.max(low, Math.min(high, Math.trunc(n))) : fallback;
};

/** Write the host guard's user-owned tuning file after one of its Settings values changes. */
export function writeHostGuardTuning(read: (key: string) => unknown, platform = process.platform): boolean {
  if (platform !== "darwin") return false;
  const mode = read(KEYS[0]);
  if (typeof mode !== "string" || !["off", "dry", "live"].includes(mode)) return false;
  const path = join(HOST_GUARD_STATE_DIR(), "tuning.json");
  if (!existsSync(path)) return false;
  const values: Values = {
    mode: mode as Values["mode"],
    hard_minutes: clamp(read(KEYS[1]), 2, 30, 3),
    metal_minutes: clamp(read(KEYS[2]), 5, 120, 10),
    max_reboots_per_12h: clamp(read(KEYS[3]), 0, 3, 2),
  };
  let error: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try { writeFileSync(path, `${JSON.stringify(values)}\n`); return true; } catch (caught) { error = caught; }
  }
  throw new Error(`Home could not update the Mac self-check settings. Check that ${path} is writable, then try again.`, { cause: error });
}

export function isHostGuardSetting(key: string): boolean { return (KEYS as readonly string[]).includes(key); }
