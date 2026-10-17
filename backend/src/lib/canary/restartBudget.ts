// CANARY-01: at most ONE canary-triggered engine restart per 30 minutes, remembered across Home restarts.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "@/lib/paths";

export const RESTART_WINDOW_MS = 30 * 60_000;

export function fileRestartBudget(path = join(dataDir, "canary-restart.json"), now: () => number = Date.now) {
  const lastAt = (): number => {
    try { return existsSync(path) ? Number(JSON.parse(readFileSync(path, "utf8")).at) || 0 : 0; } catch { return 0; }
  };
  return {
    allowed: (): boolean => now() - lastAt() >= RESTART_WINDOW_MS,
    note: (): void => { try { writeFileSync(path, JSON.stringify({ at: now() })); } catch { /* a missing file only means the next check may ask again after the window */ } },
  };
}
