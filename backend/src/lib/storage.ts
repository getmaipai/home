import { clearPreviews, previewStats } from "@/lib/fileThumbnails";
// Step 9: storage, quotas, the disk-full policy (plan 4.15).
//
// "Caches first" is already real and automatic: lib/packageCache.ts's
// own writeEntry() checks free disk space on every write and evicts its
// own oldest entries before ever growing further (D's file, not
// touched here). What follows is the other half - real household data
// (people, memories, conversations, cloned voices, models) cannot be
// evicted the way a reconstructible cache can, so once free space is
// still critically low AFTER caches have done everything they can, the
// only honest response left is a Repairs item, never a silent failure
// or a crash.
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { clonedVoices } from "@/db/schema";
import { dataDir, modelsDir, enginesDir, wakewordDir, visionDir, sttDir, cacheDir, clonedVoicesDir, backupDir, receivedBackupsDir } from "@/lib/paths";
import { getCacheStats } from "@/lib/packageCache";
import { getHouseholdSettingValue, getSettingValueForPerson } from "@/lib/settings";
import { raiseIssue, resolveIssue } from "@/lib/issues";
import { diskSpace } from "@maipai/core/src/hardware";
import { diskLevel, type DiskLevel, type DiskLevelOverrides } from "@maipai/spec/stack/ts/disk-levels.js";
import { getStackClient, isStackConfigured } from "@/lib/stackEngine";

/** Recursive directory walk, calling `onFile` with every regular file's
 * full path - shared by dirSizeBytes() below and lib/storage/usage.ts's
 * reconcileFileStore() (STORE-CAP-01), rather than two independently
 * maintained recursions over the same node:fs primitives (a code review
 * caught the first version of usage.ts's own copy of this exact walk).
 * Skips a directory that doesn't exist rather than throwing. */
export function walkFiles(dir: string, onFile: (path: string) => void): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(path, onFile);
    else if (entry.isFile()) onFile(path);
  }
}

/** Recursive, real bytes-on-disk - not `du`'s block-rounded size, a
 * plain sum of `stat().size` across every regular file. Good enough for
 * "which area is using space," not meant to match `du` exactly. */
function dirSizeBytes(dir: string): number {
  let total = 0;
  walkFiles(dir, (path) => {
    total += statSync(path).size;
  });
  return total;
}

export interface AreaUsage {
  area: string;
  bytes: number;
}

export interface DiskUsage {
  totalBytes: number;
  freeBytes: number;
}

export interface StorageSummary {
  areas: AreaUsage[];
  packages: Array<{ packageId: string; sizeBytes: number }>;
  disk: DiskUsage;
}

export function diskUsage(path: string = dataDir): DiskUsage {
  const target = existsSync(path) ? path : dataDir;
  try {
    const { freeBytes, totalBytes } = diskSpace(target);
    return { totalBytes, freeBytes };
  } catch {
    // Not available on every platform/CI sandbox - see packageCache.ts's
    // own freeDiskBytes() for the identical fallback and why.
    return { totalBytes: Number.POSITIVE_INFINITY, freeBytes: Number.POSITIVE_INFINITY };
  }
}

/** Every area D's `getCacheStats()` doesn't already cover, sized by
 * walking the real directories `lib/paths.ts` already names - one place
 * this repo's actual `data/` layout is enumerated for a person, matching
 * plan 4.15's own list (`db/` is `dataDir` itself, `hub.db` alongside
 * these subdirectories rather than nested under a `db/` folder of its
 * own - moving it now would be a real, riskier migration this step does
 * not attempt; see docs/BACKLOG.md). */
export function storageSummary(): StorageSummary {
  const areas: AreaUsage[] = [
    { area: "database", bytes: existsSync(join(dataDir, "hub.db")) ? statSync(join(dataDir, "hub.db")).size : 0 },
    { area: "models", bytes: dirSizeBytes(modelsDir) },
    { area: "engines", bytes: dirSizeBytes(enginesDir) },
    { area: "voice_wakewords", bytes: dirSizeBytes(wakewordDir) },
    { area: "vision_models", bytes: dirSizeBytes(visionDir) },
    { area: "voice_stt_vad", bytes: dirSizeBytes(sttDir) },
    { area: "voice_cloned", bytes: dirSizeBytes(clonedVoicesDir) },
    { area: "cache", bytes: dirSizeBytes(cacheDir) },
    { area: "previews", bytes: previewStats().bytes },
    { area: "backups", bytes: dirSizeBytes(backupDir) },
    { area: "received_backups", bytes: dirSizeBytes(receivedBackupsDir) },
  ];
  const packages = getCacheStats().map((s) => ({ packageId: s.packageId, sizeBytes: s.sizeBytes }));
  return { areas, packages, disk: diskUsage() };
}

export interface StorageImpact {
  disk: DiskUsage;
  requiredBytes: number;
  freeBytesAfter: number;
  fits: boolean;
}

/** REFERENCE-LIBRARY-01: "Home measures the chosen drive's free space...
 * shows the size impact before committing, and the person can pick
 * another" (owner's call 1, docs/plans/knowledge-sources-2026-09-24.md).
 * Generic on purpose - `path` is whatever directory a person is
 * considering (their own data folder, an external drive, a NAS mount:
 * `diskUsage()` already takes any path), `requiredBytes` is the size of
 * whatever they're about to install, already known before this is
 * called (a package manifest's own measured `approx_bytes`, or a
 * flavour `resolveReferenceFlavour()` just resolved) - this function
 * only measures, it never looks anything up itself, so it works for
 * any future thing that needs a "does this fit" answer, not just a
 * reference set. */
export function storageImpact(path: string, requiredBytes: number): StorageImpact {
  const disk = diskUsage(path);
  const freeBytesAfter = disk.freeBytes - requiredBytes;
  return { disk, requiredBytes, freeBytesAfter, fits: freeBytesAfter >= 0 };
}

/** The only real per-person quota today: cloned voices, the one
 * per-person upload with a tracked byte count (cloned_voices.bytes -
 * lib/clonedVoices.ts, C's file, not touched here). `0` (the setting's
 * own default) means unlimited, so this is a no-op for every household
 * until an admin sets a real number. `routes/voice.ts`'s upload route
 * (also C's) is expected to call this before writing a new sample -
 * this file only builds the check, the same "mechanism here, wiring
 * there" split step 7's ctx.allowance and ambient allowance settings
 * already use for a cross-session boundary. */
export function checkPersonQuota(personId: string, additionalBytes: number): { ok: boolean; error?: string } {
  const quotaGb = (getSettingValueForPerson(personId, "storage.person_quota_gb") as number | undefined) ?? 0;
  if (quotaGb <= 0) return { ok: true };
  const quotaBytes = quotaGb * 1024 * 1024 * 1024;
  const used =
    (db
      .select({ total: sql<number>`coalesce(sum(${clonedVoices.bytes}), 0)` })
      .from(clonedVoices)
      .where(eq(clonedVoices.creatorId, personId))
      .get()?.total as number | undefined) ?? 0;
  if (used + additionalBytes > quotaBytes) {
    return { ok: false, error: `this would go over your ${quotaGb} GB storage quota` };
  }
  return { ok: true };
}

function diskOverrides(): DiskLevelOverrides {
  return {
    warnFreeGb: (getHouseholdSettingValue("storage.warn_free_gb") as number | undefined) ?? 0,
    criticalFreeGb: (getHouseholdSettingValue("storage.critical_free_gb") as number | undefined) ?? 0,
  };
}

/** The level of one disk reading, by the one shared rule (@maipai/spec disk-levels). statfs reads bavail (what a download can truly use,
 * purgeable space excluded); an unreadable disk is "normal" so a sandbox never raises a false alarm. */
export function levelOfDisk(disk: DiskUsage, previous: DiskLevel = "normal"): DiskLevel {
  if (disk.freeBytes === Number.POSITIVE_INFINITY || disk.totalBytes === Number.POSITIVE_INFINITY) return "normal";
  return diskLevel(disk.freeBytes, disk.totalBytes, previous, diskOverrides());
}

let lastLevel: DiskLevel = "normal";
export const __resetDiskLevelForTests = (): void => { lastLevel = "normal"; };

/** The test checkDiskFull() raises its error on: free space is under the critical line. Background savers ask this before they write. */
export function diskIsLow(): boolean {
  return levelOfDisk(diskUsage()) === "critical";
}

export async function stackDiskReading() {
  if (!isStackConfigured()) return null;
  try { return await getStackClient().disk?.() ?? null; } catch { return null; }
}
export async function diskIsCritical(): Promise<boolean> {
  const local = diskIsLow();
  const stack = await stackDiskReading();
  return local || stack?.level === "critical";
}

const ISSUE_SOURCE = "storage";
const ISSUE_KEY = "disk_full";
const FIX_LINK = "/settings/models";

/** The core job (scheduler.ts's "storage.check_disk_full", hourly) with two levels (DISK-GUARD-03): a warning Repairs item when free space is
 * under the warning line, an error (which notifies the admins once) under the critical line, resolved once free space is a margin above.
 * Caches and previews are cleared first at critical; real household data never shrinks itself. */
export async function checkDiskFull(read: () => DiskUsage = diskUsage): Promise<void> {
  let disk = read();
  let level = levelOfDisk(disk, lastLevel);
  const stack = await stackDiskReading();
  const worseLevel = (home: DiskLevel): DiskLevel => stack?.level === "critical" || (stack?.level === "warn" && home === "normal") ? stack.level : home;
  level = worseLevel(level);
  if (level === "critical") { clearPreviews(); disk = read(); level = levelOfDisk(disk, lastLevel); }
  level = worseLevel(level);
  lastLevel = level;
  if (level === "normal") { resolveIssue(ISSUE_SOURCE, ISSUE_KEY); return; }
  const critical = level === "critical";
  await raiseIssue({
    source: ISSUE_SOURCE,
    key: ISSUE_KEY,
    severity: critical ? "error" : "warning",
    title: critical ? "The hub is almost out of room" : "The hub's storage is getting full",
    detail: critical
      ? "There is not enough room left for new downloads, backups or picture, video and music making. Open Models and storage to free up space."
      : "Free space is getting low. Open Models and storage to see what can be cleared safely before it runs short.",
    learnMore: FIX_LINK,
    notifyOnEscalation: true,
  });
}

/** DISK-GUARD-05: refreshes the one Repairs row from the Stack's selected-file check. */
export async function checkMissingModelFiles(read: typeof stackDiskReading = stackDiskReading): Promise<void> {
  const disk = await read();
  const key = "model_files_missing";
  if (!disk) return;
  if (disk.missing.length === 0) { resolveIssue("storage", key); return; }
  const missing = disk.missing.map((row) => `${row.role} (${row.model})`).join(", ");
  await raiseIssue({ source: "storage", key, severity: "error", title: "A model the AI needs is missing", detail: `Missing for ${missing}. Install it again in Models and storage.`, learnMore: "/settings/models" });
}
