// Home's side of the disk plan: which plan applies to this computer, where
// its files will land, how much room each of those places has, and the one
// verdict every screen shares (installer preflight, setup checks, the plan
// step, the storage step). The rows come from the Stack's install plan when
// it answers, or from shared/diskPlan.json (a copy of the Stack's
// docs/disk-plan.json) before a Stack exists. The arithmetic and the words
// are in shared/diskPlanMath.ts, which the wizard imports too.
import { existsSync, readFileSync, statfsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { totalmem } from "node:os";
import table from "../../../shared/diskPlan.json";
import {
  diskVerdict, selectionTotals, tierForLevel, tierForMemoryGb,
  type DiskLevel, type DiskPlan, type DiskVerdict, type DiskVolume,
} from "../../../shared/diskPlanMath";
import { dataDir, repoRoot } from "@/lib/paths";

export { diskVerdict, selectionTotals, tierForLevel, tierForMemoryGb };
export type { DiskLevel, DiskPlan, DiskVerdict, DiskVolume };

const tiers = (table as unknown as { tiers: Record<DiskPlan["tier"], DiskPlan> }).tiers;

/** The shipped plan of one tier (a copy of the Stack's table, so it names the sizes the Stack pinned when this Home was released). */
export function shippedDiskPlan(tier: DiskPlan["tier"]): DiskPlan { return structuredClone(tiers[tier]); }

/** Graphics memory in GB that an NVIDIA computer reports, or null when it cannot be read. */
function nvidiaMemoryGb(): number | null {
  try {
    const out = Bun.spawnSync(["nvidia-smi", "--query-gpu=memory.total", "--format=csv,noheader,nounits"], { stdout: "pipe", stderr: "ignore" });
    if (out.exitCode !== 0) return null;
    const mib = out.stdout.toString().trim().split(/\r?\n/).map(Number).filter((n) => Number.isFinite(n) && n > 0).reduce((sum, n) => sum + n, 0);
    return mib > 0 ? mib / 1024 : null;
  } catch { return null; }
}

/** The tier this computer's memory reaches, the way the Stack sizes it: an Apple silicon Mac by its total (shared) memory, any other computer by its graphics memory. Null when it is below the smallest tier or the memory cannot be read. */
export function machineTier(io: { platform?: string; totalMemoryBytes?: number; graphicsGb?: () => number | null } = {}): DiskPlan["tier"] | null {
  const platform = io.platform ?? process.platform;
  if (platform === "darwin") return tierForMemoryGb((io.totalMemoryBytes ?? totalmem()) / 1_073_741_824);
  const gb = (io.graphicsGb ?? nvidiaMemoryGb)();
  return gb === null ? null : tierForMemoryGb(gb);
}

/** The plan the installer and the setup checks use before a Stack can answer: the level asked for, capped by what this computer can run. A computer below the smallest tier still gets the smallest plan, so the check says how much room Home itself needs. */
export function shippedPlanForLevel(level: DiskLevel, io: Parameters<typeof machineTier>[0] = {}): DiskPlan {
  return shippedDiskPlan(tierForLevel(level, machineTier(io) ?? "p16"));
}

/** The plan level the installer recorded with --plan or MAIPAI_PLAN (data/setup-plan); the installer defaults to Recommended. */
export function recordedLevel(): DiskLevel {
  try {
    const value = readFileSync(join(dataDir, "setup-plan"), "utf8").trim();
    return value === "minimal" || value === "moderate" || value === "recommended" ? value : "recommended";
  } catch { return "recommended"; }
}

/** The nearest folder that exists at or above a path: a data folder that is not made yet lives on the disk of its parent. */
export function nearestExisting(path: string): string {
  let current = resolve(path);
  while (!existsSync(current)) { const parent = dirname(current); if (parent === current) break; current = parent; }
  return current;
}
export function freeBytesAt(path: string): number | null {
  try { const stats = statfsSync(nearestExisting(path)); return stats.bavail * stats.bsize; } catch { return null; }
}
export function deviceAt(path: string): number | null {
  try { return statSync(nearestExisting(path)).dev; } catch { return null; }
}

export interface DiskPaths {
  /** Where Home's program is installed. */
  program: string;
  /** Home's data folder (MAIPAI_DATA_DIR, or data/ in the install). */
  data: string;
  /** Where the AI's models and engines go (the Stack's data folder). */
  ai: string;
}
export function defaultDiskPaths(): DiskPaths {
  return { program: repoRoot, data: dataDir, ai: process.env.STACK_DATA_DIR ?? join(repoRoot, "stack", "data") };
}
export interface DiskIo { freeBytes?: (path: string) => number | null; device?: (path: string) => number | string | null }

/** The places the plan's files land, grouped by the disk they are on: a program, data and AI folder on one disk are one volume that must hold all three; on three disks, three volumes. `aiFreeBytes` is the Stack's own reading of its data disk when it has answered (the Stack may be on another computer). */
export function planVolumes(paths: DiskPaths, io: DiskIo = {}, options: { aiFreeBytes?: number | null; aiOnAnotherComputer?: boolean } = {}): DiskVolume[] {
  const free = io.freeBytes ?? freeBytesAt;
  const device = io.device ?? deviceAt;
  const places: Array<{ need: "home" | "ai" | "data"; path: string }> = [{ need: "home", path: paths.program }, { need: "data", path: paths.data }, { need: "ai", path: paths.ai }];
  const volumes: Array<{ id: string; freeBytes: number | null; needs: Array<"home" | "ai" | "data"> }> = [];
  for (const place of places) {
    // The AI on another computer is its own disk by definition; the Stack's reading of that disk is the one that counts.
    const remote = place.need === "ai" && options.aiOnAnotherComputer;
    const dev = remote ? "remote" : device(place.path);
    const id = dev === null ? "unknown" : String(dev);
    // An unknown disk is treated as shared with the first folder: asking for the sum is the safe side.
    const existing = volumes.find((volume) => volume.id === id) ?? (id === "unknown" ? volumes[0] : undefined);
    if (existing) {
      existing.needs.push(place.need);
      // The Stack's own reading of its disk, when it shares this one, can only lower what is free.
      if (place.need === "ai" && typeof options.aiFreeBytes === "number") existing.freeBytes = existing.freeBytes === null ? options.aiFreeBytes : Math.min(existing.freeBytes, options.aiFreeBytes);
      continue;
    }
    const read = place.need === "ai" && options.aiFreeBytes !== undefined ? options.aiFreeBytes : free(place.path);
    volumes.push({ id, freeBytes: read, needs: [place.need] });
  }
  return volumes.map(({ freeBytes, needs }) => ({ freeBytes, needs }));
}

/** The check every screen shows: the plan, the person's selection and where the files will land. */
export function setupDiskVerdict(plan: DiskPlan, selected: Iterable<string> | undefined, volumes: readonly DiskVolume[], options: { missingOnly?: boolean; smallerPlanHint?: boolean; word?: string } = {}): DiskVerdict {
  return diskVerdict(plan, selected ?? plan.default_selected, volumes, options);
}

/** The bytes the AI's models and engines ask of their disk under the default selection: what the Storage step and the models check compare a chosen folder's free space with. */
export function aiRequiredBytes(plan: DiskPlan, selected?: Iterable<string>): number {
  return selectionTotals(plan, selected ?? plan.default_selected, { only: "ai" }).required_free_bytes;
}
