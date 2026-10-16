// CAP-GATE-01: when the allocation changes and a required capability goes
// away, every store-installed package that requires it is uninstalled through
// the normal uninstall path. A person's own files are never touched here: the
// uninstall keeps package state and the household media records.
import { db } from "@/db";
import { packageInstalls } from "@/db/schema";
import { capabilityWords, missingRequired, unavailableCapabilities } from "@/lib/capabilities";
import { loadManifestOnly } from "@/lib/plugins";
import { uninstall } from "@/lib/store";

export interface CapabilityLoser { id: string; name: string; lost: string[] }

/** The installed packages that need something that is off right now. */
export function packagesLosingCapability(failedRoles: readonly string[] = []): CapabilityLoser[] {
  const unavailable = unavailableCapabilities(failedRoles);
  const losers: CapabilityLoser[] = [];
  for (const row of db.select().from(packageInstalls).all()) {
    const loaded = loadManifestOnly(row.packageId);
    if (!loaded.ok) continue;
    const lost = missingRequired(loaded.value, unavailable);
    if (lost.length) losers.push({ id: row.packageId, name: typeof loaded.value.display === "string" && loaded.value.display.trim() ? loaded.value.display : row.packageId, lost });
  }
  return losers;
}

/** The confirmation line shown before a role is turned off. */
export function removalConfirmation(losers: readonly CapabilityLoser[]): string | null {
  if (losers.length === 0) return null;
  const names = losers.map((loser) => loser.name).join(", ");
  const things = [...new Set(losers.flatMap((loser) => loser.lost.map(capabilityWords)))].join(" and ");
  return `Turning off ${things} removes ${names}. The following will be uninstalled and users will lose access. Anything made with them stays in Library.`;
}

/** Runs at start and after every allocation change; one place. */
export async function reconcileCapabilities(failedRoles: readonly string[] = []): Promise<string[]> {
  const removed: string[] = [];
  for (const loser of packagesLosingCapability(failedRoles)) {
    const result = await uninstall(loser.id);
    if (result.ok) removed.push(loser.id);
  }
  return removed;
}
