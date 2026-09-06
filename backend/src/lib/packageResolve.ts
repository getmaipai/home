// Where a package's own files actually live right now (session-d-
// packages-and-store.md step 6): an installed override from the store
// if one exists, the bundled checked-in copy otherwise. This is the ONE
// place that answer is computed - `lib/plugins.ts`, `lib/denoHost.ts`,
// and `lib/smoke.ts` all resolve a package's directory through here
// instead of hardcoding `PACKAGES_DIR` themselves, so a store install
// actually takes effect the moment `lib/store.ts` writes its row,
// nowhere else needs to know.
//
// Deliberately its own small module, not folded into `lib/store.ts`
// (which needs the rest of `@/db`'s write surface, `lib/storeIndex.ts`'s
// verification, and `lib/smoke.ts` for its own post-install check) or
// `lib/paths.ts` (which `@/db` itself imports for `dataDir` - `lib/store.ts`
// importing `@/db` and `@/db` importing `lib/paths.ts` back would be a
// real cycle the moment `lib/plugins.ts` needed both "resolve" and
// "paths"). This file only ever needs a `packageInstalls` row and a
// plain path join, so it sits below both without creating one.
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { packageInstalls } from "@/db/schema";
import { PACKAGES_DIR, installedPackageVersionDir } from "@/lib/paths";

export interface ActiveInstall {
  version: string;
  previousVersion: string | null;
  channel: "stable" | "beta";
  sourceCommit: string;
  permissions: string[];
  installedAt: string;
}

/** The current store-install row for `id`, or null if it has never been
 * installed through the store (bundled-only, the common case today). */
export function getActiveInstall(id: string): ActiveInstall | null {
  const row = db.select().from(packageInstalls).where(eq(packageInstalls.packageId, id)).get();
  if (!row) return null;
  return {
    version: row.version,
    previousVersion: row.previousVersion,
    channel: row.channel as "stable" | "beta",
    sourceCommit: row.sourceCommit,
    permissions: JSON.parse(row.permissions) as string[],
    installedAt: row.installedAt,
  };
}

/** Every package id the store has ever installed - a genuinely new
 * community package (never bundled at all) still needs to show up in
 * `lib/plugins.ts`'s own `listPackageIds()`, which otherwise only ever
 * saw `PACKAGES_DIR`'s own directory names. */
export function listInstalledPackageIds(): string[] {
  return db.select({ packageId: packageInstalls.packageId }).from(packageInstalls).all().map((r) => r.packageId);
}

/** The directory a package's manifest/recipe/handler actually load from
 * right now: an active store install's own version directory if one
 * exists, `PACKAGES_DIR/<id>` (the bundled checked-in copy) otherwise.
 * Every caller that used to hardcode `join(PACKAGES_DIR, id)` for a
 * package's OWN files (never its cache, its Tier 1 writable state, or
 * anything else under `data/`) resolves through here instead. */
export function resolvePackageDir(id: string): string {
  const active = getActiveInstall(id);
  if (active) return installedPackageVersionDir(id, active.version);
  return join(PACKAGES_DIR, id);
}
