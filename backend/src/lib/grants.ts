// Step 7: Grant - subject/action/effect, NEVER inferred, and deliberately
// its own store even though Relationship has the identical shape
// (relationship-types.json's own $comment: "same shape, separate stores,
// opposite trust" - Relationship can be a guess and wrong; a Grant is
// never machine-inferred, only ever written by a person with the
// authority to grant).
//
// "Grants are added beside roles this wave" (this step's own plan text):
// this file is also where requireRoleOrGrant (middleware/auth.ts) gets
// its answer to "does this person have this, even though their role
// alone wouldn't allow it" - a widening mechanism only. It never narrows
// what the role ladder already allows an owner/admin to do.
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { grants, people } from "@/db/schema";
import { newGrantId } from "@/lib/id";
import { nextHlc } from "@/lib/hlc";
import { validateGrant, matchGrantAction } from "@maipai/spec/records/ts/validate.js";
import { Grant } from "@maipai/spec/gen/ts/grant.js";
import type { Grant as GrantT } from "@maipai/spec/gen/ts/grant.js";
import type { OpResult } from "@/lib/entities";

export type GrantRow = typeof grants.$inferSelect;

function toGrant(row: GrantRow): GrantT {
  return Grant.parse({
    id: row.id,
    person: row.person,
    action: row.action,
    effect: row.effect,
    valid_from: row.validFrom,
    valid_to: row.validTo,
    granted_by_person_id: row.grantedByPersonId,
    reason: row.reason,
    acknowledged_at: row.acknowledgedAt,
    acknowledged_by_person_id: row.acknowledgedByPersonId,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    deleted_at: row.deletedAt,
    hlc: row.hlc,
  });
}

function toRow(grant: GrantT) {
  return {
    id: grant.id,
    person: grant.person,
    action: grant.action,
    effect: grant.effect,
    validFrom: grant.valid_from,
    validTo: grant.valid_to,
    grantedByPersonId: grant.granted_by_person_id,
    reason: grant.reason,
    acknowledgedAt: grant.acknowledged_at,
    acknowledgedByPersonId: grant.acknowledged_by_person_id,
    createdAt: grant.created_at,
    updatedAt: grant.updated_at,
    deletedAt: grant.deleted_at,
    hlc: grant.hlc,
  };
}

export interface GrantCreate {
  person: string;
  action: string;
  effect: "allow" | "deny";
  valid_from?: string | null;
  valid_to?: string | null;
  reason?: string | null;
  acknowledged_at?: string | null;
  acknowledged_by_person_id?: string | null;
}

export function createGrant(actor: { id: string }, input: GrantCreate): OpResult<GrantT> {
  const person = db.select({ id: people.id }).from(people).where(and(eq(people.id, input.person), isNull(people.deletedAt))).get();
  if (!person) return { ok: false, status: 400, error: "person does not name an existing profile" };
  if (!matchGrantAction(input.action)) return { ok: false, status: 400, error: `unknown grant action: ${input.action}` };

  const now = new Date().toISOString();
  const candidate = Grant.safeParse({
    id: newGrantId(),
    person: input.person,
    action: input.action,
    effect: input.effect,
    valid_from: input.valid_from ?? null,
    valid_to: input.valid_to ?? null,
    granted_by_person_id: actor.id,
    reason: input.reason ?? null,
    acknowledged_at: input.acknowledged_at ?? null,
    acknowledged_by_person_id: input.acknowledged_by_person_id ?? null,
    created_at: now,
    updated_at: now,
    deleted_at: null,
    hlc: nextHlc(),
  });
  if (!candidate.success) return { ok: false, status: 400, error: candidate.error.issues.map((i) => i.message).join("; ") };

  const problems = validateGrant(candidate.data);
  if (problems.length > 0) return { ok: false, status: 400, error: problems.join("; ") };

  db.insert(grants).values(toRow(candidate.data)).run();
  return { ok: true, status: 201, value: candidate.data };
}

export function listGrants(personId?: string): GrantT[] {
  const rows = db
    .select()
    .from(grants)
    .where(isNull(grants.deletedAt))
    .all()
    .filter((r) => (personId ? r.person === personId : true));
  return rows.map(toGrant);
}

export function revokeGrant(id: string): OpResult<{ id: string }> {
  const row = db.select({ id: grants.id }).from(grants).where(and(eq(grants.id, id), isNull(grants.deletedAt))).get();
  if (!row) return { ok: false, status: 404, error: "no such grant" };
  const now = new Date().toISOString();
  db.update(grants).set({ deletedAt: now, updatedAt: now, hlc: nextHlc() }).where(eq(grants.id, id)).run();
  return { ok: true, status: 200, value: { id } };
}

/** Shared with lib/permissions.ts's effectivePermissions() - a code
 * review (2026-09-06) found this duplicated verbatim in both files. */
export function isGrantActive(row: Pick<GrantRow, "validFrom" | "validTo">, now: string): boolean {
  if (row.validFrom && row.validFrom > now) return false;
  if (row.validTo && row.validTo < now) return false;
  return true;
}

/** requireRoleOrGrant's whole question: "is there a currently-active
 * ALLOW grant on this exact action for this person" - a plain OR with
 * the role check, never a denial of what the role ladder already grants
 * an owner/admin. Full deny-overrides-allow resolution across the
 * grant's closed vocabulary lives in permissions.ts's effectivePermissions()
 * (GET /api/people/:id/permissions); this is the narrower, cheaper
 * question an admin-route gate actually needs on every request. */
export function personIsGranted(personId: string, action: string): boolean {
  const now = new Date().toISOString();
  const rows = db
    .select()
    .from(grants)
    .where(and(eq(grants.person, personId), eq(grants.action, action), isNull(grants.deletedAt)))
    .all()
    .filter((r) => isGrantActive(r, now));
  if (rows.length === 0) return false;
  if (rows.some((r) => r.effect === "deny")) return false;
  return rows.some((r) => r.effect === "allow");
}
