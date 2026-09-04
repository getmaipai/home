// Shared role/person-access predicates. Extracted from lib/memory.ts
// (2026-09-04) the moment a second consumer (lib/settings.ts) needed the
// identical "can this actor touch this person's own scoped data" rule,
// per CLAUDE.md principle 4 ("one definition, one place... a second copy
// of anything is wrong even when it is faster") and the lesson from a
// code review that same day (memory.ts's own isOwnerOrAdmin() duplicated
// an equivalent inline check elsewhere).
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { people } from "@/db/schema";
import type { PersonRow } from "@/types";

export function isOwnerOrAdmin(actor: PersonRow): boolean {
  return actor.role === "owner" || actor.role === "admin";
}

// Batch form, for a caller filtering many records against many different
// target people in one pass (memory.ts's list()/recall(), one query
// instead of one per record).
export function rolesById(): Map<string, string> {
  const rows = db.select({ id: people.id, role: people.role }).from(people).all();
  return new Map(rows.map((r) => [r.id, r.role]));
}

// Single-target form, for a caller that only ever needs one person's
// role (settings' person-scope authorization). A review (2026-09-04)
// found the extraction into this module had settings call rolesById()
// (a full table scan) to resolve exactly one row; this is the targeted
// query that case actually needs.
export function getPersonRole(personId: string): string | undefined {
  return db.select({ role: people.role }).from(people).where(eq(people.id, personId)).get()?.role;
}

// Whether `actor` may access (read, write, export, or forget) `personId`'s
// own person-scoped data: themself, or owner/admin ONLY when the target
// is a child (parity with 4.14's conversation-visibility rule: a parent
// sees a child's, nothing of an adult's; teen support needs a summary
// mechanism that doesn't exist yet, so teens are treated like adults
// here, a deliberately conservative judgment call recorded in
// docs/dev.md). Used identically by memory (list/recall/forget/export)
// and settings (person-scope values) so the two can't drift apart the
// way memory's read and forget/export rules once did.
//
// `roleOf`, when supplied, is a pre-built batch map (memory's per-record
// filtering loop); omitted, this looks the one role up directly
// (settings' single-target case) rather than forcing every caller to pay
// for a full table scan.
export function canAccessPerson(actor: PersonRow, personId: string, roleOf?: Map<string, string>): boolean {
  if (actor.id === personId) return true;
  if (!isOwnerOrAdmin(actor)) return false;
  const role = roleOf ? roleOf.get(personId) : getPersonRole(personId);
  return role === "child";
}
