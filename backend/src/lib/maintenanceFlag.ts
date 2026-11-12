// HOST-LAUNCH-03 (owner, 2026-11-12): "Chat is unavailable while the system upgrades." The flag is one small file that the lease broker
// (scripts/jobs/lease.sh) writes while a development lease holds the whole machine in direct mode, and that an upgrade may write too.
// This file only reads it; the line itself rides the existing chat health row (RULES S6), never a new status surface. A flag whose
// `until` time has passed is ignored, so a crashed writer can never leave chat off.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "@/lib/paths";

export const maintenanceFlagPath = (): string => process.env.MAIPAI_MAINTENANCE_FLAG ?? join(dataDir, "local-app", "maintenance.json");

/** True while a flag file names a future `until` (epoch seconds). Unreadable or malformed never blocks chat. */
export function maintenanceActive(now = Date.now()): boolean {
  try {
    const flag = JSON.parse(readFileSync(maintenanceFlagPath(), "utf-8")) as { until?: unknown };
    return typeof flag.until === "number" && flag.until * 1000 > now;
  } catch { return false; }
}
