// Step 3a (docs/plans/media-conversation-program-2026-09-13.md): the
// judge's subjects. A fact the model tagged with a subject (a person,
// pet, place, organization or thing by name) is about an entity in the
// household's registry (lib/entities.ts): found by name or alias in the
// speaker's own scope or the household's, or created in the speaker's
// scope. A relation the speaker stated in so many words ("my coworker
// Quill") is a relationship from the speaker's own person entity to the
// named one, `source: stated` by the speaker (the schema's own
// definition of stated: a person in the household said so); one the
// model worked out from context is `inferred`, with the extraction's
// importance as its confidence and the turn as its evidence, hedged and
// never asserted until a household adult confirms it (PATCH
// /api/relationships/:id { confirm: true }). Entities follow the same
// line: named with a kind by the speaker is `local`, guessed is
// `inferred`. Everything here is the speaker's own data (scope person)
// until they say otherwise, the validator's rule for an unconfirmed
// inference and the least surprising home for a stated one.
import { and, eq, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { entities, people, memoryRecords, relationships } from "@/db/schema";
import { createEntity, toEntity, type OpResult } from "@/lib/entities";
import { createRelationship, findRelationship, promoteToStated, listRelationships } from "@/lib/relationships";
import { relationshipTypes } from "@maipai/spec/records/ts/validate.js";
import type { Entity } from "@maipai/spec/gen/ts/entity.js";
import type { Relationship } from "@maipai/spec/gen/ts/relationship.js";
import type { PersonRow } from "@/types";
import { nextHlc } from "@/lib/hlc";

type EntityKind = "person" | "pet" | "place" | "organization" | "thing";

function nameMatches(candidate: { name: string; aliases: string }, name: string): boolean {
  const wanted = name.trim().toLowerCase();
  if (!wanted) return false;
  if (candidate.name.trim().toLowerCase() === wanted) return true;
  return (JSON.parse(candidate.aliases) as string[]).some((a) => a.trim().toLowerCase() === wanted);
}

/** The registry entity a name refers to, for this speaker: the
 * household's or the speaker's own, by name or alias, the newest first
 * when more than one matches; null when none does. */
export function findEntityByName(speaker: { id: string }, name: string, kind?: EntityKind, opts: { excludeMembers?: boolean } = {}): Entity | null {
  const rows = db
    .select()
    .from(entities)
    .where(isNull(entities.deletedAt))
    .all()
    .filter((e) => (e.scope === "household" || e.person === speaker.id) && nameMatches(e, name) && (!kind || e.kind === kind) && !(opts.excludeMembers && e.accountPersonId));
  if (rows.length === 0) return null;
  rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return toEntity(rows[0]!);
}

/** Finds or creates the entity a fact is about, in the speaker's own
 * scope. `stated` (the speaker named it) makes a `local` entity;
 * otherwise `inferred`. A household member's own name, tagged as a
 * person or with no kind, resolves to their person entity and never
 * becomes a second one; tagged as a pet or a thing it is taken to be
 * that (a dog sharing a child's nickname), which a mis-kinded member
 * would turn into a stray entity beside them in People and things: the
 * trade-off of the narrowing, removable there. */
export function ensureSubjectEntity(speaker: PersonRow, subject: { name: string; kind: EntityKind }, stated: boolean): OpResult<Entity> {
  const known = findSubjectByName(speaker, subject.name, subject.kind);
  if (known) return known;
  // A place must say whether it is a map place or an area inside one
  // (the validator); a place a sentence names is a map place until
  // someone files it under another.
  return createEntity(speaker, {
    kind: subject.kind,
    name: subject.name,
    scope: "person",
    person: speaker.id,
    source: stated ? "local" : "inferred",
    ...(subject.kind === "place" ? { place_kind: "map" as const } : {}),
  });
}

/** The entity a name already refers to for this speaker, without
 * creating one: a household member by display name or nickname (their
 * person entity, made on first need), else the registry by name or
 * alias, the wanted kind first. */
export function findSubjectByName(speaker: PersonRow, name: string, kind?: EntityKind): OpResult<Entity> | null {
  const wanted = name.trim().toLowerCase();
  // A member only when the name could be one: a dog that shares a
  // child's nickname is the dog.
  const member =
    kind === undefined || kind === "person"
      ? db
          .select()
          .from(people)
          .where(and(isNull(people.deletedAt)))
          .all()
          .find((p) => p.displayName.trim().toLowerCase() === wanted || (p.nickname ?? "").trim().toLowerCase() === wanted)
      : undefined;
  if (member) return ensurePersonEntity(member);
  // The wanted kind first; then any kind (a Rover filed as a thing is
  // the same Rover), leaving a member's own entity out of the search
  // for a non-person kind.
  const existing = (kind ? findEntityByName(speaker, name, kind) : null) ?? findEntityByName(speaker, name, undefined, { excludeMembers: kind !== undefined && kind !== "person" });
  return existing ? { ok: true, status: 200, value: existing } : null;
}

/** A household person's own entity (kind person, account_person_id set,
 * household scope, source hub), created on first need. */
export function ensurePersonEntity(person: { id: string; displayName: string }): OpResult<Entity> {
  const existing = db.select().from(entities).where(and(eq(entities.accountPersonId, person.id), isNull(entities.deletedAt))).get();
  if (existing) return { ok: true, status: 200, value: toEntity(existing) };
  return createEntity({ id: person.id }, { kind: "person", name: person.displayName, account_person_id: person.id, scope: "household" });
}

function isSymmetric(type: string): boolean {
  return relationshipTypes().find((t: { id: string; symmetric?: boolean }) => t.id === type)?.symmetric ?? false;
}

/** The relationship types a fact's relation slot may carry, from the
 * speaker's side of the edge (the speaker's own person entity is
 * `from`), as the chat prompt says them. Both directions of an edge are
 * stored, so the speaker-as-from edge always exists when any does. */
export const RELATION_PHRASES: Record<string, string> = {
  parent_of: "your child",
  child_of: "your parent",
  sibling_of: "your sibling",
  partner_of: "your partner",
  guardian_of: "someone you look after",
  ward_of: "your guardian",
  friend_of: "your friend",
  colleague_of: "your coworker",
  relative_of: "your relative",
  owns: "yours",
  cares_for: "someone you look after",
  lives_at: "your home",
  employed_by: "your employer",
  works_at: "where you work",
  attends: "somewhere you go",
};

/** Writes the relationship a fact carries between the speaker and the
 * named entity, in the direction the vocabulary allows (the speaker's
 * person entity as `from` when the type admits it, else as `to`). A
 * pair that already has a live edge of that type gets no second one; an
 * inferred edge the speaker now states in their own words is promoted
 * to stated (promoteToStated). */
export function writeRelation(
  speaker: PersonRow,
  relation: { type: string; name: string; stated: boolean },
  other: Entity,
  turnId: string,
  importance: number,
): OpResult<Relationship> {
  const self = ensurePersonEntity(speaker);
  if (!self.ok || !self.value) return { ok: false, status: self.status, error: self.error };
  if (self.value.id === other.id) return { ok: false, status: 400, error: "a relation needs two different entities" };
  const type = relationshipTypes().find((t: { id: string }) => t.id === relation.type);
  if (!type) return { ok: false, status: 400, error: `unknown relationship type ${relation.type}` };
  const forward = (type.from as string[]).includes("person") && (type.to as string[]).includes(other.kind);
  const backward = (type.from as string[]).includes(other.kind) && (type.to as string[]).includes("person");
  if (!forward && !backward) return { ok: false, status: 400, error: `${relation.type} does not join a person and a ${other.kind}` };
  const [fromId, toId] = forward ? [self.value.id, other.id] : [other.id, self.value.id];
  const existing = findRelationship(speaker, fromId, toId, relation.type);
  if (existing) {
    if (relation.stated && existing.source === "inferred") return promoteToStated(speaker, existing.id);
    return { ok: true, status: 200, value: existing };
  }
  return createRelationship(speaker, {
    type: relation.type,
    from_id: fromId,
    to_id: toId,
    scope: "person",
    person: speaker.id,
    ...(relation.stated
      ? { source: "stated", stated_by_person_id: speaker.id }
      : { source: "inferred", confidence: Math.min(1, Math.max(0.05, importance)), evidence: [turnId] }),
  });
}

/** The kind an entity named only in a relation slot ("my coworker
 * Quill" with no subject of its own) must have: the type's other end.
 * When the type admits several kinds (owns: a pet or a thing), the
 * fact's own category decides where it can (a `thing` or `place` fact
 * names one), a person wins where the type admits one, else the
 * vocabulary's own order (pet first for owns, the one definition both
 * products read). */
export function kindForRelation(type: string, category?: string): EntityKind {
  const t = relationshipTypes().find((x: { id: string }) => x.id === type);
  if (!t) return "person";
  // The other end: `to` when the speaker's person entity is `from`
  // (owns, cares_for, employed_by), else `from` (owned_by, cared_for_by).
  const ends = ((t.from as string[]).includes("person") ? (t.to as string[]) : (t.from as string[])) as EntityKind[];
  if ((category === "thing" || category === "place") && ends.includes(category)) return category;
  // A type that admits a person at the other end names one by default
  // ("my grandma" in cares_for, "my boss" in employed_by): a person is
  // the common case, and a person misfiled as a pet or an organization
  // would be a name the guards do not know.
  if (ends.includes("person")) return "person";
  return ends[0] ?? "person";
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function namedIn(text: string, name: string): boolean {
  const n = name.trim();
  if (n.length < 2) return false;
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(n)}(?![\\p{L}\\p{N}])`, "iu").test(text);
}

/** Whether the speaker's own words name this subject: the line between
 * a `local` entity (the speaker said the name) and an `inferred` one
 * (the model supplied it). */
export function speakerNamed(userText: string, name: string): boolean {
  return namedIn(userText, name);
}

/** Whether the speaker's own words state this relationship: one of the
 * type's `said_as` phrases (spec/vocab/relationship-types.json) is in
 * the sentence. The model's own "stated" flag is not enough: on the
 * bench the 4B called "we got the same manager" a stated colleague, and
 * a relationship the person did not say is a candidate, not their
 * statement. A type with no phrases (the hub-written inverses) is never
 * stated. */
export function speakerStated(userText: string, type: string, names: readonly string[] = []): boolean {
  const phrases = saidAs(type);
  // Smart apostrophes from a phone are the plain one here.
  const text = userText.replace(/[\u2018\u2019]/g, "'");
  return phrases.some((p) => {
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(p)}(?![\\p{L}\\p{N}])`, "giu");
    for (const m of text.matchAll(re)) {
      if (names.length === 0) return true;
      // Beside the name: within a short reach of any way the speaker
      // could have said it ("my coworker Quill", "Quill, my coworker").
      // A heuristic, not a parse: a phrase in another clause of a
      // long sentence can still pass, and ASK-01's parser owns the
      // exact shape.
      const at = m.index ?? 0;
      if (names.some((n) => nearby(text, at, m[0].length, n))) return true;
    }
    return false;
  });
}

/** The type's `said_as` phrases from the vocabulary. */
export function saidAs(type: string): string[] {
  return (relationshipTypes().find((t: { id: string }) => t.id === type) as { said_as?: string[] } | undefined)?.said_as ?? [];
}

const REACH = 40;
function nearby(text: string, at: number, length: number, name: string): boolean {
  // The text had its smart apostrophes made plain; the name gets the same.
  const n = name.trim().replace(/[\u2018\u2019]/g, "'");
  if (n.length < 2) return false;
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(n)}(?![\\p{L}\\p{N}])`, "giu");
  for (const m of text.matchAll(re)) {
    const i = m.index ?? 0;
    // Inside the phrase counts too: a parent nicknamed "Mom" is named
    // by "my mom" itself.
    if (i >= at && i < at + length) return true;
    if (i >= at + length && i - (at + length) <= REACH) return true;
    if (at >= i + n.length && at - (i + n.length) <= REACH) return true;
  }
  return false;
}

/** Whether the speaker's own words use any of these names. */
export function speakerNamedAny(userText: string, names: readonly string[]): boolean {
  return names.some((n) => namedIn(userText, n));
}

/** The known entity a plain fact names (the longest name wins when one
 * name contains another): the speaker's own or the household's, by name
 * or alias. Never the speaker's own entity: the judge writes facts in
 * the third person with the speaker's name in them ("Marlow's coworker
 * Quill was out sick"), and the speaker is who the record belongs to,
 * not what it is about. */
export function findEntityNamedIn(speaker: { id: string }, text: string): Entity | null {
  const rows = db
    .select()
    .from(entities)
    .where(isNull(entities.deletedAt))
    .all()
    .filter((e) => (e.scope === "household" || e.person === speaker.id) && e.accountPersonId !== speaker.id);
  let best: { row: (typeof rows)[number]; length: number } | null = null;
  for (const row of rows) {
    for (const name of [row.name, ...(JSON.parse(row.aliases) as string[])]) {
      if (namedIn(text, name) && (!best || name.length > best.length)) best = { row, length: name.length };
    }
  }
  return best ? toEntity(best.row) : null;
}

/** An inferred entity or relationship nobody has confirmed: a
 * candidate for the open question (ASK-01), never knowledge. The
 * design pass's amendment to step 3a: not rendered to the model, not a
 * known name for the guards, not an identity recall reads by. */
function isCandidate(row: { id: string; source: string; confirmedByPersonId: string | null }, vouched: ReadonlySet<string> = vouchedEntityIds()): boolean {
  return row.source === "inferred" && row.confirmedByPersonId === null && !vouched.has(row.id);
}

/** ASK-01: the entities a stated or confirmed live relationship
 * touches. An inferred entity at the far end of an edge the person
 * stated or an adult confirmed is vouched for by that edge (the
 * confirm names it as the coworker), so it is no longer a candidate
 * even before its own confirm transition runs. */
function vouchedEntityIds(): Set<string> {
  const ids = new Set<string>();
  for (const r of db
    .select({ fromId: relationships.fromId, toId: relationships.toId, source: relationships.source, confirmedByPersonId: relationships.confirmedByPersonId, validTo: relationships.validTo })
    .from(relationships)
    .where(isNull(relationships.deletedAt))
    .all()) {
    if (r.validTo !== null) continue;
    if (r.source === "stated" || r.confirmedByPersonId !== null) {
      ids.add(r.fromId);
      ids.add(r.toId);
    }
  }
  return ids;
}

/** Names the guards may treat as known subjects beside the household
 * roster: the people and pets in the speaker's registry (their own or
 * the household's), so "what does Quill drink" is a question about
 * someone the hub knows, not a name to guard against. Places and
 * things stay out: a place name in the roster would make a weather
 * pattern yield. An unconfirmed inferred entity stays out too: its
 * kind is the model's guess, and the guards treat the name as one of
 * unknown kind until the person answers. */
export function subjectRosterFor(speaker: { id: string }): string[] {
  const vouched = vouchedEntityIds();
  return db
    .select({ id: entities.id, name: entities.name, aliases: entities.aliases, kind: entities.kind, scope: entities.scope, person: entities.person, source: entities.source, confirmedByPersonId: entities.confirmedByPersonId })
    .from(entities)
    .where(isNull(entities.deletedAt))
    .all()
    .filter((e) => (e.scope === "household" || e.person === speaker.id) && (e.kind === "person" || e.kind === "pet") && !isCandidate(e, vouched))
    .flatMap((e) => [e.name, ...(JSON.parse(e.aliases) as string[])]);
}

/** ASK-01: every name and alias the speaker's registry knows (their
 * own and the household's, every kind), with the entity it belongs to,
 * for the turn's name resolver. A candidate (an unconfirmed inferred
 * entity) stays out, as it does for the guards' roster: its name is
 * still unknown-kind until the person answers. */
export function registryNamesFor(speaker: { id: string }): { name: string; id: string; kind: string }[] {
  const vouched = vouchedEntityIds();
  return db
    .select({ id: entities.id, name: entities.name, aliases: entities.aliases, kind: entities.kind, scope: entities.scope, person: entities.person, source: entities.source, confirmedByPersonId: entities.confirmedByPersonId })
    .from(entities)
    .where(isNull(entities.deletedAt))
    .all()
    .filter((e) => (e.scope === "household" || e.person === speaker.id) && !isCandidate(e, vouched))
    .flatMap((e) => [e.name, ...(JSON.parse(e.aliases) as string[])].map((name) => ({ name, id: e.id, kind: e.kind })));
}

/** ASK-01: an entity's name by id, for a log line; null when gone. */
export function registryNameById(id: string): string | null {
  return db.select({ name: entities.name }).from(entities).where(and(eq(entities.id, id), isNull(entities.deletedAt))).get()?.name ?? null;
}

/** ASK-01: an entity by id, when the speaker may see it (the
 * household's or their own); null otherwise. */
export function entityForSpeaker(speaker: { id: string }, id: string): Entity | null {
  const row = db.select().from(entities).where(and(eq(entities.id, id), isNull(entities.deletedAt))).get();
  if (!row || !(row.scope === "household" || row.person === speaker.id)) return null;
  return toEntity(row);
}

/** How the chat prompt says whose fact a memory is: the subject's name,
 * and the relationship to the speaker when one is stored. A stated or
 * confirmed edge is said plainly ("Quill (your coworker)"); an
 * unconfirmed inferred one is not said at all (the name alone), and an
 * unconfirmed inferred entity gets no label (its kind is a guess): a
 * candidate reaches the model only as the person's own words in the
 * record, never as the hub's claim about who someone is. Null when the
 * subject is unknown to this speaker (another person's entity) or is
 * the speaker. */
export function subjectLabel(speaker: { id: string; role: string }, subjectId: string): string | null {
  const row = db.select().from(entities).where(and(eq(entities.id, subjectId), isNull(entities.deletedAt))).get();
  if (!row || !(row.scope === "household" || row.person === speaker.id)) return null;
  if (row.accountPersonId === speaker.id || isCandidate(row)) return null;
  const self = db.select({ id: entities.id }).from(entities).where(and(eq(entities.accountPersonId, speaker.id), isNull(entities.deletedAt))).get();
  if (!self) return row.name;
  // A symmetric type (colleague_of, friend_of) is stored once, in
  // whichever direction it was written; a directed one always has the
  // speaker-as-from edge.
  // The speaker's own edges or the household's, never another
  // person's own statement (an admin's listRelationships() sees those).
  const edge = listRelationships(speaker, self.id).find(
    (r) =>
      r.valid_to === null &&
      RELATION_PHRASES[r.type] &&
      (r.scope === "household" || r.person === speaker.id) &&
      ((r.from_id === self.id && r.to_id === row.id) || (r.from_id === row.id && r.to_id === self.id && isSymmetric(r.type))),
  );
  if (!edge || (edge.source === "inferred" && edge.confirmed_by_person_id === null)) return row.name;
  return `${row.name} (${RELATION_PHRASES[edge.type]!})`;
}

/** The judge's registry rows go when the fact that brought them goes.
 * Called after records are retired (a "forget that", the Memory page's
 * forget, an edited turn, a write the store refused): for each retired
 * record, its subject entity and every live edge touching it are
 * removed when nothing else keeps them: no other active record cites
 * the entity, it is the speaker's own (scope person, source local or
 * inferred: the judge's own sources, since the API writes `hub`), and
 * nobody confirmed it or a relationship of its. Every entity the judge
 * makes is the subject of the record it was made for (writeFactRelation
 * in memoryJudge.ts creates none beside the subject), so the record's
 * subject is the whole link, whenever the last record citing it goes.
 * A household entity, a person's own entity, one made by hand in
 * People and things, or a confirmed one stays. */
export function retireOrphanSubjects(records: readonly { subjectId: string | null }[]): void {
  const now = new Date().toISOString();
  for (const record of records) {
    if (!record.subjectId) continue;
    const entity = db.select().from(entities).where(and(eq(entities.id, record.subjectId), isNull(entities.deletedAt))).get();
    if (!entity) continue;
    if (entity.scope !== "person" || entity.accountPersonId || !(entity.source === "local" || entity.source === "inferred")) continue;
    if (entity.confirmedByPersonId) continue;
    const stillCited = db
      .select({ id: memoryRecords.id })
      .from(memoryRecords)
      .where(and(eq(memoryRecords.subjectId, entity.id), eq(memoryRecords.status, "active"), isNull(memoryRecords.deletedAt)))
      .get();
    if (stillCited) continue;
    // A relationship an adult confirmed is a deliberate act of its
    // own, kept like a hand-made entity. One a person typed in through
    // the API to a judge-made entity has the judge's own stated shape
    // and goes with the entity: the entity was the fact's, and with
    // the fact gone there is nothing for the edge to join.
    const confirmedEdge = db
      .select({ id: relationships.id, confirmedByPersonId: relationships.confirmedByPersonId })
      .from(relationships)
      .where(and(isNull(relationships.deletedAt), or(eq(relationships.fromId, entity.id), eq(relationships.toId, entity.id))))
      .all()
      .find((r) => r.confirmedByPersonId !== null);
    if (confirmedEdge) continue;
    db.update(relationships)
      .set({ deletedAt: now, updatedAt: now, hlc: nextHlc() })
      .where(and(isNull(relationships.deletedAt), or(eq(relationships.fromId, entity.id), eq(relationships.toId, entity.id))))
      .run();
    db.update(entities).set({ deletedAt: now, updatedAt: now, hlc: nextHlc() }).where(eq(entities.id, entity.id)).run();
  }
}
