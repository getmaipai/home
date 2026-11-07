// AUDIT-PERF-01: loadPackage()/loadManifestOnly() stat two package files on every read (every turn, every tool list). The stat result is
// kept for 5 s; the package install, rollback and remove paths (lib/store.ts) drop it at once, so a changed package is seen on the next read.
import { statMtimeMs } from "@/lib/paths";

export const MANIFEST_STAT_TTL_MS = 5_000;
const cache = new Map<string, { at: number; mtimeMs: number | null }>();

export function cachedMtimeMs(path: string): number | null {
  const hit = cache.get(path);
  const now = Date.now();
  if (hit && now - hit.at < MANIFEST_STAT_TTL_MS) return hit.mtimeMs;
  const mtimeMs = statMtimeMs(path);
  cache.set(path, { at: now, mtimeMs });
  return mtimeMs;
}

export function invalidateManifestStats(): void { cache.clear(); }
