// Step 7: "GET /api/people/:id/permissions computing the effective set
// (denies win, safety_stop undeniable)" (this step's own plan text).
//
// "Denies win" here means the standard ABAC/ReBAC tie-break: for any one
// action a person has more than one active grant on (which shouldn't
// normally happen, but nothing stops a household from granting and
// separately denying the same thing at different times), an explicit
// deny always resolves the action, regardless of how many allows also
// apply or which was written first. There is no cross-action prefix
// hierarchy to resolve (a deny of `use:videos` does not "beat" a
// separate allow of `packages.use_all` here - that composition is the
// package host's own business the moment it reads a person's resolved
// set, not something this file can decide on its behalf for a vocabulary
// it does not own the semantics of).
//
// "safety_stop undeniable" needs no special-case code: grant-actions.json
// deliberately contains no action that weakens the non-removable safety
// floor (its own $comment says so), and validateGrant()/matchGrantAction()
// already refuse to create a grant for anything outside that closed
// vocabulary. There is structurally nothing here that could ever
// override it - which is the point.
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { grants } from "@/db/schema";
import { isGrantActive } from "@/lib/grants";

export interface EffectivePermission {
  action: string;
  effect: "allow" | "deny";
}

export function effectivePermissions(personId: string): EffectivePermission[] {
  const now = new Date().toISOString();
  const rows = db
    .select()
    .from(grants)
    .where(and(eq(grants.person, personId), isNull(grants.deletedAt)))
    .all()
    .filter((r) => isGrantActive(r, now));

  const resolved = new Map<string, "allow" | "deny">();
  for (const row of rows) {
    if (resolved.get(row.action) === "deny") continue; // already denied: nothing can un-deny it
    if (row.effect === "deny") {
      resolved.set(row.action, "deny");
      continue;
    }
    if (!resolved.has(row.action)) resolved.set(row.action, "allow");
  }

  return [...resolved.entries()].map(([action, effect]) => ({ action, effect })).sort((a, b) => a.action.localeCompare(b.action));
}
