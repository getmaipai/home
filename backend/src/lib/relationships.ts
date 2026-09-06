// Step 7: the Relationship half of chapter 3 - a typed directed edge
// between two entities. NOT authorization (that's Grant, a deliberately
// separate store - see grants.ts's own header): a relationship can be
// `inferred` and wrong, so nothing here ever feeds a permission check.
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { relationships, entities } from "@/db/schema";
import { newRelationshipId } from "@/lib/id";
import { nextHlc } from "@/lib/hlc";
import { validateRelationship, validateRelationshipEndpoints, inverseRelationship, relationshipTypes } from "@maipai/spec/records/ts/validate.js";
import { Relationship } from "@maipai/spec/gen/ts/relationship.js";
import type { Relationship as RelationshipT } from "@maipai/spec/gen/ts/relationship.js";
import type { Entity as EntityT } from "@maipai/spec/gen/ts/entity.js";
import type { OpResult } from "@/lib/entities";

export type RelationshipRow = typeof relationships.$inferSelect;

function toRelationship(row: RelationshipRow): RelationshipT {
  return Relationship.parse({
    id: row.id,
    type: row.type,
    from_id: row.fromId,
    to_id: row.toId,
    status: row.status,
    valid_from: row.validFrom,
    valid_to: row.validTo,
    expired_at: row.expiredAt,
    source: row.source,
    stated_by_person_id: row.statedByPersonId,
    confidence: row.confidence,
    confirmed_by_person_id: row.confirmedByPersonId,
    evidence: JSON.parse(row.evidence) as string[],
    scope: row.scope,
    person: row.person,
    sensitive: row.sensitive,
    note: row.note,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    deleted_at: row.deletedAt,
    hlc: row.hlc,
  });
}

function toRow(rel: RelationshipT) {
  return {
    id: rel.id,
    type: rel.type,
    fromId: rel.from_id,
    toId: rel.to_id,
    status: rel.status,
    validFrom: rel.valid_from,
    validTo: rel.valid_to,
    expiredAt: rel.expired_at,
    source: rel.source,
    statedByPersonId: rel.stated_by_person_id,
    confidence: rel.confidence,
    confirmedByPersonId: rel.confirmed_by_person_id,
    evidence: JSON.stringify(rel.evidence),
    scope: rel.scope,
    person: rel.person,
    sensitive: rel.sensitive,
    note: rel.note,
    createdAt: rel.created_at,
    updatedAt: rel.updated_at,
    deletedAt: rel.deleted_at,
    hlc: rel.hlc,
  };
}

export interface RelationshipCreate {
  type: string;
  from_id: string;
  to_id: string;
  status?: string;
  valid_from?: string | null;
  valid_to?: string | null;
  note?: string | null;
  scope?: "household" | "person";
  person?: string | null;
  sensitive?: boolean;
}

/** Every relationship this hub stores today is a person's own statement
 * ("Alex is Marlow's partner"): `source: "stated"` naming the actor,
 * scope defaulting to "person" (spec/schemas/relationship.schema.json's
 * own default) since nobody has confirmed it for the household yet.
 * `source: "inferred"` exists in the spec for whatever later builds a
 * real inference pipeline - this hub-write path never produces one, the
 * same "storage without inference" scoping the platform plan calls out
 * for this wave. */
export function createRelationship(actor: { id: string }, input: RelationshipCreate): OpResult<RelationshipT> {
  // entities.kind is stored as free text (sqlite has no enum type), but
  // every row was written through Entity.safeParse() in lib/entities.ts,
  // so it is always one of the schema's five kinds - asserted here
  // rather than re-validated, the same trust boundary lib/entities.ts's
  // own toEntity() already relies on via Entity.parse().
  const from = db.select({ id: entities.id, kind: entities.kind }).from(entities).where(and(eq(entities.id, input.from_id), isNull(entities.deletedAt))).get() as
    | Pick<EntityT, "id" | "kind">
    | undefined;
  if (!from) return { ok: false, status: 400, error: "from_id does not name an existing entity" };
  const to = db.select({ id: entities.id, kind: entities.kind }).from(entities).where(and(eq(entities.id, input.to_id), isNull(entities.deletedAt))).get() as
    | Pick<EntityT, "id" | "kind">
    | undefined;
  if (!to) return { ok: false, status: 400, error: "to_id does not name an existing entity" };

  const type = relationshipTypes().find((t) => t.id === input.type);
  const now = new Date().toISOString();
  const candidate = Relationship.safeParse({
    id: newRelationshipId(),
    type: input.type,
    from_id: input.from_id,
    to_id: input.to_id,
    status: input.status ?? "normal",
    valid_from: input.valid_from ?? null,
    valid_to: input.valid_to ?? null,
    expired_at: null,
    source: "stated",
    stated_by_person_id: actor.id,
    confidence: null,
    confirmed_by_person_id: null,
    evidence: [],
    scope: input.scope ?? "person",
    person: input.scope === "household" ? null : (input.person ?? actor.id),
    sensitive: input.sensitive ?? false,
    note: input.note ?? null,
    created_at: now,
    updated_at: now,
    deleted_at: null,
    hlc: nextHlc(),
  });
  if (!candidate.success) return { ok: false, status: 400, error: candidate.error.issues.map((i) => i.message).join("; ") };

  const problems = [...validateRelationship(candidate.data), ...validateRelationshipEndpoints(candidate.data, from, to)];
  if (problems.length > 0) return { ok: false, status: 400, error: problems.join("; ") };

  db.insert(relationships).values(toRow(candidate.data)).run();

  // "parent_of and child_of are different edges, both stored" (the
  // schema's own promise) - inverseRelationship() is what keeps it true.
  if (type && !type.symmetric) {
    const inverse = inverseRelationship(candidate.data, { id: newRelationshipId(), created_at: now, updated_at: now });
    if (inverse) db.insert(relationships).values(toRow(inverse)).run();
  }

  return { ok: true, status: 201, value: candidate.data };
}

/** Both directions of an edge: household-scoped, or belonging to
 * `actor` (their own person-scoped statements), or anything at all if
 * the actor is owner/admin. */
export function listRelationships(actor: { id: string; role: string }, entityId?: string): RelationshipT[] {
  const canSeeAll = actor.role === "owner" || actor.role === "admin";
  const rows = db
    .select()
    .from(relationships)
    .where(isNull(relationships.deletedAt))
    .all()
    .filter((r) => (entityId ? r.fromId === entityId || r.toId === entityId : true))
    .filter((r) => r.scope === "household" || canSeeAll || r.person === actor.id);
  return rows.map(toRelationship);
}

function getOwnedRow(actor: { id: string; role: string }, id: string): RelationshipRow | undefined {
  const row = db.select().from(relationships).where(and(eq(relationships.id, id), isNull(relationships.deletedAt))).get();
  if (!row) return undefined;
  const canSeeAll = actor.role === "owner" || actor.role === "admin";
  if (row.scope === "person" && row.person !== actor.id && !canSeeAll) return undefined;
  return row;
}

export interface RelationshipEdit {
  status?: string;
  valid_to?: string | null;
  note?: string | null;
}

/** The one edit this route allows: ending it (valid_to) or requalifying
 * it (status - "your boyfriend Alex" becoming "estranged", never a new
 * type). Everything else about an edge - who it joins, its type, its
 * direction - is a different fact, not an edit to this one: delete this
 * relationship and state a new one instead. Applies to the edge and its
 * stored inverse together, so the two never drift into contradicting
 * tenses. */
export function updateRelationship(actor: { id: string; role: string }, id: string, edit: RelationshipEdit): OpResult<RelationshipT> {
  const row = getOwnedRow(actor, id);
  if (!row) return { ok: false, status: 404, error: "no such relationship" };

  const candidate = Relationship.safeParse({
    ...toRelationship(row),
    status: edit.status ?? row.status,
    valid_to: edit.valid_to !== undefined ? edit.valid_to : row.validTo,
    note: edit.note !== undefined ? edit.note : row.note,
    updated_at: new Date().toISOString(),
    hlc: nextHlc(),
  });
  if (!candidate.success) return { ok: false, status: 400, error: candidate.error.issues.map((i) => i.message).join("; ") };

  const problems = validateRelationship(candidate.data);
  if (problems.length > 0) return { ok: false, status: 400, error: problems.join("; ") };

  db.update(relationships).set(toRow(candidate.data)).where(eq(relationships.id, id)).run();

  // The stored inverse (same from/to pair, opposite direction, opposite
  // type) carries the identical status/valid_to/note - a status or an
  // end date is a fact about the relationship, not about which side is
  // asking, so both rows must always agree.
  const reciprocal = db
    .select()
    .from(relationships)
    .where(and(eq(relationships.fromId, row.toId), eq(relationships.toId, row.fromId), isNull(relationships.deletedAt)))
    .all()
    .find((r) => relationshipTypes().find((t) => t.id === row.type)?.inverse === r.type);
  if (reciprocal) {
    db.update(relationships)
      .set({ status: candidate.data.status, validTo: candidate.data.valid_to, note: candidate.data.note, updatedAt: candidate.data.updated_at, hlc: nextHlc() })
      .where(eq(relationships.id, reciprocal.id))
      .run();
  }

  return { ok: true, status: 200, value: candidate.data };
}

/** Removes the edge and its stored inverse together - the same
 * both-directions-or-neither invariant creation and update keep. */
export function deleteRelationship(actor: { id: string; role: string }, id: string): OpResult<{ id: string }> {
  const row = getOwnedRow(actor, id);
  if (!row) return { ok: false, status: 404, error: "no such relationship" };
  const now = new Date().toISOString();
  db.update(relationships).set({ deletedAt: now, updatedAt: now, hlc: nextHlc() }).where(eq(relationships.id, id)).run();

  const inverseType = relationshipTypes().find((t) => t.id === row.type)?.inverse ?? "";
  const reciprocal = db
    .select({ id: relationships.id })
    .from(relationships)
    .where(and(eq(relationships.fromId, row.toId), eq(relationships.toId, row.fromId), eq(relationships.type, inverseType), isNull(relationships.deletedAt)))
    .get();
  if (reciprocal) db.update(relationships).set({ deletedAt: now, updatedAt: now, hlc: nextHlc() }).where(eq(relationships.id, reciprocal.id)).run();

  return { ok: true, status: 200, value: { id } };
}
