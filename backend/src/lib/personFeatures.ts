// ACCESS-UI-01 (RULES.md C7, C10): what an admin sees when they set one person's feature access. Booleans and the grant id only: never the
// pass, its version, ceilings or settings. `effective` is read from the TARGET person's own pass, never the admin's.
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { people } from "@/db/schema";
import { audienceBand, isGuestRole } from "@/lib/audience";
import { userFacingManifests } from "@/lib/apps";
import { passForPerson } from "@/lib/filter/pass";
import { isGrantActive, listGrants } from "@/lib/grants";
import { meetsMinRole } from "@/lib/plugins";
import { getHouseholdSettingValue } from "@/lib/settings";
import type { PersonRow } from "@/types";

export interface PersonFeatureRow {
  id: string;
  title: string;
  min_role: string;
  role_allows: boolean;
  effective: boolean;
  grant: null | { id: string; effect: "allow" | "deny" };
  /** Only the Coding row: an admin may allow it for a child or teen (the owner's 2026-10-17 ruling). */
  allow_for_minors?: true;
}

export const CODING_FEATURE_ID = "code";

export function personFeatures(target: PersonRow): PersonFeatureRow[] {
  const pass = passForPerson(target);
  const now = new Date().toISOString();
  const active = listGrants(target.id).filter((grant) => isGrantActive({ validFrom: grant.valid_from, validTo: grant.valid_to }, now));
  const grantFor = (id: string): PersonFeatureRow["grant"] => {
    const found = active.filter((grant) => grant.action === `use:${id}`);
    const pick = found.find((grant) => grant.effect === "deny") ?? found[0];
    return pick ? { id: pick.id, effect: pick.effect } : null;
  };
  const rows: PersonFeatureRow[] = userFacingManifests().map((manifest) => ({
    id: manifest.id,
    title: typeof manifest.display === "string" && manifest.display.trim() ? manifest.display : manifest.id,
    min_role: manifest.min_role,
    role_allows: meetsMinRole(target.role, manifest.min_role),
    effective: pass.access.has(`use:${manifest.id}`),
    grant: grantFor(manifest.id),
  }));
  rows.sort((a, b) => a.title.localeCompare(b.title));
  if (!isGuestRole(target.role)) { // guests are left out of the Coding row, as the old roster was
    rows.unshift({
      id: CODING_FEATURE_ID, title: "Coding", min_role: "adult",
      role_allows: audienceBand(target) === "adult" && getHouseholdSettingValue("coding.adults_by_default") === true,
      effective: pass.access.has(`use:${CODING_FEATURE_ID}`), grant: grantFor(CODING_FEATURE_ID), allow_for_minors: true,
    });
  }
  return rows;
}

export function activePerson(id: string): PersonRow | undefined {
  return db.select().from(people).where(and(eq(people.id, id), isNull(people.deletedAt))).get() as PersonRow | undefined;
}
