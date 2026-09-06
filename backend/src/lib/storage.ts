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
import { existsSync, readdirSync, statSync, statfsSync } from "node:fs";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { clonedVoices } from "@/db/schema";
import { dataDir, modelsDir, enginesDir, wakewordDir, sttDir, cacheDir, clonedVoicesDir, backupDir, receivedBackupsDir } from "@/lib/paths";
import { getCacheStats } from "@/lib/packageCache";
import { getHouseholdSettingValue, getSettingValueForPerson } from "@/lib/settings";
import { raiseIssue, resolveIssue } from "@/lib/issues";

/** Recursive, real bytes-on-disk - not `du`'s block-rounded size, a
 * plain sum of `stat().size` across every regular file. Good enough for
 * "which area is using space," not meant to match `du` exactly. */
function dirSizeBytes(dir: string): number {
  if (!existsSync(dir)) return 0;
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) total += dirSizeBytes(path);
    else if (entry.isFile()) total += statSync(path).size;
  }
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
    const stats = statfsSync(target);
    return { totalBytes: stats.blocks * stats.bsize, freeBytes: stats.bavail * stats.bsize };
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
    { area: "voice_stt", bytes: dirSizeBytes(sttDir) },
    { area: "voice_cloned", bytes: dirSizeBytes(clonedVoicesDir) },
    { area: "cache", bytes: dirSizeBytes(cacheDir) },
    { area: "backups", bytes: dirSizeBytes(backupDir) },
    { area: "received_backups", bytes: dirSizeBytes(receivedBackupsDir) },
  ];
  const packages = getCacheStats().map((s) => ({ packageId: s.packageId, sizeBytes: s.sizeBytes }));
  return { areas, packages, disk: diskUsage() };
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

const ISSUE_SOURCE = "storage";
const ISSUE_KEY = "disk_full";

/** The core job (scheduler.ts's "storage.check_disk_full") that closes
 * the loop packageCache.ts's own automatic eviction cannot: once free
 * space is still below the household's own threshold AFTER caches have
 * done everything they can, real household data cannot shrink itself,
 * so the honest response is a Repairs item, not a crash the next write
 * would otherwise risk. */
export function checkDiskFull(): void {
  const criticalGb = (getHouseholdSettingValue("storage.critical_free_gb") as number | undefined) ?? 2;
  const { freeBytes } = diskUsage();
  if (freeBytes === Number.POSITIVE_INFINITY) return; // statfs unavailable here - nothing to check
  const freeGb = freeBytes / (1024 * 1024 * 1024);
  if (freeGb < criticalGb) {
    void raiseIssue({
      source: ISSUE_SOURCE,
      key: ISSUE_KEY,
      severity: "error",
      title: "The hub is almost out of disk space",
      detail: `Only ${freeGb.toFixed(1)} GB free (below the ${criticalGb} GB threshold). Free up space or add storage soon.`,
    });
  } else {
    resolveIssue(ISSUE_SOURCE, ISSUE_KEY);
  }
}
