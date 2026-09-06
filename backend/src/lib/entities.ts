// Step 7: the Entity half of "entities, relationships, grants, approvals"
// (platform plan chapter 3). This is the hub's own boundary enforcement
// of spec/records/ts/validate.ts's validateEntity() - the schema alone
// cannot carry the cross-field rules (place_kind, account_person_id,
// parent_id, scope/person), so every write goes through here rather than
// straight through Drizzle.
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { entities, people } from "@/db/schema";
import { newEntityId } from "@/lib/id";
import { nextHlc } from "@/lib/hlc";
import { validateEntity } from "@maipai/spec/records/ts/validate.js";
import { Entity } from "@maipai/spec/gen/ts/entity.js";
import type { Entity as EntityT } from "@maipai/spec/gen/ts/entity.js";

export type EntityRow = typeof entities.$inferSelect;

export interface OpResult<T> {
  ok: boolean;
  status: 200 | 201 | 400 | 403 | 404;
  value?: T;
  error?: string;
}

function toEntity(row: EntityRow): EntityT {
  return Entity.parse({
    id: row.id,
    kind: row.kind,
    name: row.name,
    aliases: JSON.parse(row.aliases) as string[],
    description: row.description,
    place_kind: row.placeKind,
    parent_id: row.parentId,
    account_person_id: row.accountPersonId,
    source: row.source,
    confirmed_by_person_id: row.confirmedByPersonId,
    scope: row.scope,
    person: row.person,
    sensitive: row.sensitive,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    deleted_at: row.deletedAt,
    hlc: row.hlc,
  });
}

function toRow(entity: EntityT) {
  return {
    id: entity.id,
    kind: entity.kind,
    name: entity.name,
    aliases: JSON.stringify(entity.aliases),
    description: entity.description,
    placeKind: entity.place_kind,
    parentId: entity.parent_id,
    accountPersonId: entity.account_person_id,
    source: entity.source,
    confirmedByPersonId: entity.confirmed_by_person_id,
    scope: entity.scope,
    person: entity.person,
    sensitive: entity.sensitive,
    createdAt: entity.created_at,
    updatedAt: entity.updated_at,
    deletedAt: entity.deleted_at,
    hlc: entity.hlc,
  };
}

export interface EntityCreate {
  kind: "person" | "pet" | "place" | "organization" | "thing";
  name: string;
  aliases?: string[];
  description?: string | null;
  place_kind?: "map" | "area" | null;
  parent_id?: string | null;
  account_person_id?: string | null;
  scope?: "household" | "person";
  person?: string | null;
  sensitive?: boolean;
}

/** A person-scoped entity is visible only to the person it belongs to
 * (and to owner/admin, the same reach they already have over everything
 * else in the household). Household-scoped is visible to everyone
 * signed in - it is the shared roster of who/what the family knows
 * about, the same reach GET /api/people already has. */
export function listEntities(actor: { id: string; role: string }, kind?: string): EntityT[] {
  const canSeeAll = actor.role === "owner" || actor.role === "admin";
  const rows = db
    .select()
    .from(entities)
    .where(isNull(entities.deletedAt))
    .all()
    .filter((r) => (kind ? r.kind === kind : true))
    .filter((r) => r.scope === "household" || canSeeAll || r.person === actor.id);
  return rows.map(toEntity);
}

export function getEntity(actor: { id: string; role: string }, id: string): OpResult<EntityT> {
  const row = db.select().from(entities).where(and(eq(entities.id, id), isNull(entities.deletedAt))).get();
  if (!row) return { ok: false, status: 404, error: "no such entity" };
  const canSeeAll = actor.role === "owner" || actor.role === "admin";
  if (row.scope === "person" && row.person !== actor.id && !canSeeAll) {
    return { ok: false, status: 404, error: "no such entity" };
  }
  return { ok: true, status: 200, value: toEntity(row) };
}

export function createEntity(actor: { id: string }, input: EntityCreate): OpResult<EntityT> {
  const now = new Date().toISOString();
  const candidate = Entity.safeParse({
    id: newEntityId(),
    kind: input.kind,
    name: input.name,
    aliases: input.aliases ?? [],
    description: input.description ?? null,
    place_kind: input.place_kind ?? null,
    parent_id: input.parent_id ?? null,
    account_person_id: input.account_person_id ?? null,
    source: "hub",
    confirmed_by_person_id: null,
    scope: input.scope ?? "household",
    person: input.scope === "person" ? (input.person ?? actor.id) : null,
    sensitive: input.sensitive ?? false,
    created_at: now,
    updated_at: now,
    deleted_at: null,
    hlc: nextHlc(),
  });
  if (!candidate.success) return { ok: false, status: 400, error: candidate.error.issues.map((i) => i.message).join("; ") };

  const problems = validateEntity(candidate.data);
  if (problems.length > 0) return { ok: false, status: 400, error: problems.join("; ") };

  if (candidate.data.parent_id) {
    const parent = db.select({ id: entities.id }).from(entities).where(and(eq(entities.id, candidate.data.parent_id), isNull(entities.deletedAt))).get();
    if (!parent) return { ok: false, status: 400, error: "parent_id does not name an existing entity" };
  }
  if (candidate.data.account_person_id) {
    const person = db.select({ id: people.id }).from(people).where(and(eq(people.id, candidate.data.account_person_id), isNull(people.deletedAt))).get();
    if (!person) return { ok: false, status: 400, error: "account_person_id does not name an existing person" };
  }

  db.insert(entities).values(toRow(candidate.data)).run();
  return { ok: true, status: 201, value: candidate.data };
}

export interface EntityEdit {
  name?: string;
  aliases?: string[];
  description?: string | null;
  parent_id?: string | null;
  sensitive?: boolean;
}

/** Deliberately narrow: kind, source, account_person_id, scope and
 * person are set once at creation and never move afterward - none of
 * them are "edit a fact", they're "this is a different kind of record".
 * A household that got a person's scope wrong deletes the entity and
 * makes a new one rather than reclassifying it in place. */
export function updateEntity(actor: { id: string; role: string }, id: string, edit: EntityEdit): OpResult<EntityT> {
  const existing = getEntity(actor, id);
  if (!existing.ok || !existing.value) return existing;
  const target = existing.value;

  const candidate = Entity.safeParse({
    ...target,
    name: edit.name ?? target.name,
    aliases: edit.aliases ?? target.aliases,
    description: edit.description !== undefined ? edit.description : target.description,
    parent_id: edit.parent_id !== undefined ? edit.parent_id : target.parent_id,
    sensitive: edit.sensitive ?? target.sensitive,
    updated_at: new Date().toISOString(),
    hlc: nextHlc(),
  });
  if (!candidate.success) return { ok: false, status: 400, error: candidate.error.issues.map((i) => i.message).join("; ") };

  const problems = validateEntity(candidate.data);
  if (problems.length > 0) return { ok: false, status: 400, error: problems.join("; ") };

  if (candidate.data.parent_id) {
    if (candidate.data.parent_id === id) return { ok: false, status: 400, error: "an entity cannot contain itself" };
    const parent = db.select({ id: entities.id }).from(entities).where(and(eq(entities.id, candidate.data.parent_id), isNull(entities.deletedAt))).get();
    if (!parent) return { ok: false, status: 400, error: "parent_id does not name an existing entity" };
  }

  db.update(entities).set(toRow(candidate.data)).where(eq(entities.id, id)).run();
  return { ok: true, status: 200, value: candidate.data };
}

export function deleteEntity(actor: { id: string; role: string }, id: string): OpResult<{ id: string }> {
  const existing = getEntity(actor, id);
  if (!existing.ok) return { ok: false, status: existing.status, error: existing.error };
  const now = new Date().toISOString();
  db.update(entities).set({ deletedAt: now, updatedAt: now, hlc: nextHlc() }).where(eq(entities.id, id)).run();
  return { ok: true, status: 200, value: { id } };
}
