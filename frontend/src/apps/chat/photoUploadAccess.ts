import type { Roster } from "@/lib/api";

/** Mirrors the upload endpoint's default-off rule for a child, using the
 * backend's computed band. The server remains authoritative on upload. */
export function photoUploadsEnabledForBand(
  ageBand: Roster["age_band"],
  setting?: { value?: unknown; source?: string },
): boolean {
  if (ageBand === undefined) return false;
  if (ageBand === "child") return setting?.source !== "default" && setting?.value === true;
  return setting?.value === true;
}
