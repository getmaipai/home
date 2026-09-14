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
import { confirmTransition, type OpResult } from "@/lib/entities";

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
    confirmed_at: row.confirmedAt,
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
    confirmedAt: rel.confirmed_at,
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
  /** Provenance. The API route never sets it (a person typing a
   * relationship in is stating it, so the route's default holds); the
   * judge's subject writer (lib/subjects.ts, step 3a) passes `stated`
   * for a relation the speaker said in so many words and `inferred`,
   * with the confidence and the turn as evidence, for one it worked
   * out. The spec's validator holds the pairing either way. */
  source?: "stated" | "inferred";
  stated_by_person_id?: string | null;
  confidence?: number | null;
  evidence?: string[];
}

/** A relationship a person states ("Alex is Marlow's partner") is
 * `source: "stated"` naming the actor, scope defaulting to "person"
 * (spec/schemas/relationship.schema.json's own default) since nobody has
 * confirmed it for the household yet. Step 3a's judge is the one writer
 * of `source: "inferred"` (lib/subjects.ts): a guess with a confidence
 * and its evidence, hedged in chat until a household adult confirms it
 * through updateRelationship's confirm transition. */
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
  const source = input.source ?? "stated";
  const candidate = Relationship.safeParse({
    id: newRelationshipId(),
    type: input.type,
    from_id: input.from_id,
    to_id: input.to_id,
    status: input.status ?? "normal",
    valid_from: input.valid_from ?? null,
    valid_to: input.valid_to ?? null,
    expired_at: null,
    source,
    stated_by_person_id: source === "stated" ? (input.stated_by_person_id ?? actor.id) : null,
    confidence: source === "inferred" ? (input.confidence ?? null) : null,
    confirmed_by_person_id: null,
    evidence: source === "inferred" ? (input.evidence ?? []) : [],
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
  /** Step 3a's confirm transition: a household adult vouches for an
   * `inferred` relationship. The source, confidence and evidence stay
   * (how it was learned is not what changed); confirmed_by_person_id
   * and confirmed_at record who and when, and a renderer stops hedging.
   * Only a household adult; only once; only an inferred one. */
  confirm?: true;
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

  let confirmed: Record<string, unknown> | null = null;
  if (edit.confirm) {
    const transition = confirmTransition(actor, row.source, row.confirmedByPersonId);
    if (!transition.ok) return { ok: false, status: transition.status, error: transition.error };
    confirmed = { ...transition.value! };
  }
  const candidate = Relationship.safeParse({
    ...toRelationship(row),
    status: edit.status ?? row.status,
    valid_to: edit.valid_to !== undefined ? edit.valid_to : row.validTo,
    note: edit.note !== undefined ? edit.note : row.note,
    ...(confirmed ?? {}),
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
  const reciprocal = storedInverseOf(row);
  // Provenance rides along the same way: confirming one direction of an
  // inferred edge confirms the pair, or a renderer reading the inverse
  // would still hedge a relationship an adult just vouched for.
  if (reciprocal) {
    db.update(relationships)
      .set({
        status: candidate.data.status,
        validTo: candidate.data.valid_to,
        note: candidate.data.note,
        ...(confirmed ? provenanceColumns(candidate.data) : {}),
        updatedAt: candidate.data.updated_at,
        hlc: nextHlc(),
      })
      .where(eq(relationships.id, reciprocal.id))
      .run();
  }

  return { ok: true, status: 200, value: candidate.data };
}

/** The stored inverse of a directed edge: the same pair the other way,
 * the inverse type, the same scope and (for a person's own) the same
 * person, since the inverse createRelationship() wrote is that
 * person's own row and another household member's statement of the
 * same pair is theirs, never this edit's. A symmetric type stores no
 * inverse, so it has none: another person's own edge of the same type
 * the other way is not it. */
function storedInverseOf(row: RelationshipRow): { id: string } | undefined {
  const type = relationshipTypes().find((t) => t.id === row.type);
  if (!type || type.symmetric || !type.inverse) return undefined;
  return db
    .select({ id: relationships.id, person: relationships.person })
    .from(relationships)
    .where(and(eq(relationships.fromId, row.toId), eq(relationships.toId, row.fromId), eq(relationships.type, type.inverse), eq(relationships.scope, row.scope), isNull(relationships.deletedAt)))
    .all()
    .find((r) => row.scope === "household" || r.person === row.person);
}

function provenanceColumns(rel: RelationshipT) {
  return {
    source: rel.source,
    statedByPersonId: rel.stated_by_person_id,
    confidence: rel.confidence,
    evidence: JSON.stringify(rel.evidence),
    confirmedByPersonId: rel.confirmed_by_person_id,
    confirmedAt: rel.confirmed_at,
  };
}

/** Step 3a's other way out of `inferred`: the person the relationship
 * is about says it themselves ("my coworker Quill" after the hub had
 * only guessed). Their own statement is the schema's definition of
 * `stated`, so the edge and its inverse become stated by them, with no
 * confidence and no evidence (the validator's shape for a statement;
 * the memory record's own source turn is the trail); nothing left to
 * confirm. Only the person whose relationship it is (scope person,
 * theirs) can do this, and only from inferred: a stated edge is left
 * alone. */
export function promoteToStated(speaker: { id: string }, id: string): OpResult<RelationshipT> {
  const row = db.select().from(relationships).where(and(eq(relationships.id, id), isNull(relationships.deletedAt))).get();
  if (!row) return { ok: false, status: 404, error: "no such relationship" };
  if (row.scope !== "person" || row.person !== speaker.id) return { ok: false, status: 403, error: "only the person whose relationship this is can state it" };
  if (row.source !== "inferred") return { ok: true, status: 200, value: toRelationship(row) };
  const candidate = Relationship.safeParse({
    ...toRelationship(row),
    source: "stated",
    stated_by_person_id: speaker.id,
    confidence: null,
    evidence: [],
    updated_at: new Date().toISOString(),
    hlc: nextHlc(),
  });
  if (!candidate.success) return { ok: false, status: 400, error: candidate.error.issues.map((i) => i.message).join("; ") };
  const problems = validateRelationship(candidate.data);
  if (problems.length > 0) return { ok: false, status: 400, error: problems.join("; ") };
  db.update(relationships).set(toRow(candidate.data)).where(eq(relationships.id, id)).run();
  const reciprocal = storedInverseOf(row);
  if (reciprocal) {
    db.update(relationships)
      .set({ ...provenanceColumns(candidate.data), updatedAt: candidate.data.updated_at, hlc: nextHlc() })
      .where(eq(relationships.id, reciprocal.id))
      .run();
  }
  return { ok: true, status: 200, value: candidate.data };
}

/** The live edge of one type between two entities that this person
 * can build on: their own (scope person, theirs) or the household's.
 * The judge's check before writing a relation a fact carries, so a
 * repeated "my coworker Quill" is one edge, not one per mention; a
 * second household member stating the same relation from their side
 * gets their own edge, since another person's statement is not theirs
 * to read or to promote. */
export function findRelationship(person: { id: string }, fromId: string, toId: string, type: string): RelationshipT | null {
  const symmetric = relationshipTypes().find((t) => t.id === type)?.symmetric ?? false;
  const row = db
    .select()
    .from(relationships)
    .where(and(eq(relationships.type, type), isNull(relationships.deletedAt)))
    .all()
    .find(
      (r) =>
        r.validTo === null &&
        (r.scope === "household" || r.person === person.id) &&
        ((r.fromId === fromId && r.toId === toId) || (symmetric && r.fromId === toId && r.toId === fromId)),
    );
  return row ? toRelationship(row) : null;
}

/** Removes the edge and its stored inverse together - the same
 * both-directions-or-neither invariant creation and update keep. */
export function deleteRelationship(actor: { id: string; role: string }, id: string): OpResult<{ id: string }> {
  const row = getOwnedRow(actor, id);
  if (!row) return { ok: false, status: 404, error: "no such relationship" };
  const now = new Date().toISOString();
  db.update(relationships).set({ deletedAt: now, updatedAt: now, hlc: nextHlc() }).where(eq(relationships.id, id)).run();

  const reciprocal = storedInverseOf(row);
  if (reciprocal) db.update(relationships).set({ deletedAt: now, updatedAt: now, hlc: nextHlc() }).where(eq(relationships.id, reciprocal.id)).run();

  return { ok: true, status: 200, value: { id } };
}
