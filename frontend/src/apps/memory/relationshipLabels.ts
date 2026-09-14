import relationshipTypesVocab from "@maipai/spec/vocab/relationship-types.json";
import type { Entity, Relationship } from "@/lib/api";

interface RelationshipTypeDef {
  id: string;
  from: string[];
  to: string[];
  inverse: string;
  terminable?: boolean;
  symmetric?: boolean;
  statuses: string[];
  description: string;
}

// spec/vocab/relationship-types.json's own header: "A closed list" - safe
// to import directly (no `@maipai/spec` subpath restricts it, and
// normalizeForSpeech.js/lineReader.js are already imported the same way
// from this same package elsewhere in this file's siblings) rather than
// round-tripping to the backend for static, non-personal metadata.
const TYPES = (relationshipTypesVocab as { types: RelationshipTypeDef[] }).types;

function typeById(id: string): RelationshipTypeDef | undefined {
  return TYPES.find((t) => t.id === id);
}

// A short verb phrase per vocab type, read as "<Entity name> is <label>
// <other name>" - kept separate from the vocab's own `description` field
// (built for the spec, not a chat-sized UI line). Exhaustive over the
// closed list above; a type this map doesn't recognize (should never
// happen while the vocab stays closed) falls back to its own id with
// underscores turned to spaces, still readable rather than broken.
const LABELS: Record<string, string> = {
  parent_of: "parent of",
  child_of: "child of",
  sibling_of: "sibling of",
  partner_of: "partner of",
  guardian_of: "guardian of",
  ward_of: "ward of",
  friend_of: "friend of",
  owns: "owner of",
  owned_by: "owned by",
  cares_for: "caregiver of",
  cared_for_by: "cared for by",
  lives_at: "lives at",
  home_of: "home of",
  employed_by: "employed by",
  employs: "employer of",
  works_at: "works at",
  workplace_of: "workplace of",
  attends: "attends",
  attended_by: "attended by",
};

export function relationshipTypeLabel(typeId: string): string {
  return LABELS[typeId] ?? typeId.replace(/_/g, " ");
}

/** One line per relationship worth showing under `entity`'s own row.
 * Every real edge stores BOTH directions as separate rows (createEntity's
 * own inverse-write) except a `symmetric` type, which stores one row for
 * both parties - so a non-symmetric edge is only picked up here from its
 * OWN `from_id` row (the reciprocal `to_id` row is the SAME fact, already
 * shown under the other entity's row from its own `from_id` side); a
 * symmetric edge has no separate reciprocal row, so it's also picked up
 * from the `to_id` side, or it would never appear on the second party's
 * own row at all. Getting this wrong either duplicates every ordinary
 * relationship under both entities, or drops every symmetric one under
 * the entity that happens to be `to_id`. */
export function relationshipLinesFor(entity: Entity, relationships: readonly Relationship[], entityById: ReadonlyMap<string, Entity>): { relationship: Relationship; text: string }[] {
  const lines: { relationship: Relationship; text: string }[] = [];
  for (const r of relationships) {
    let otherId: string | undefined;
    if (r.from_id === entity.id) {
      otherId = r.to_id;
    } else if (r.to_id === entity.id && typeById(r.type)?.symmetric) {
      otherId = r.from_id;
    } else {
      continue;
    }
    const other = entityById.get(otherId);
    const otherName = other?.name ?? "someone no longer known";
    lines.push({ relationship: r, text: `${relationshipTypeLabel(r.type)} ${otherName}` });
  }
  return lines;
}

export interface RelationshipTypeOption {
  id: string;
  label: string;
  /** Which slot the entity being created fills, so the caller knows
   * whether to send it as from_id or to_id. */
  directionNewIsFrom: boolean;
}

/** Every vocab type that can join an entity of `newKind` to one of
 * `otherKind`, in whichever direction the vocab actually allows -
 * powers the "relate to a household member" picker when creating an
 * entity. A symmetric type whose kind sets happen to match in both
 * directions (every symmetric type today: person<->person) would
 * otherwise appear twice for the identical meaning; deduplicated by id,
 * keeping "new entity is from" since a symmetric edge's direction is
 * never shown to begin with. */
export function relationshipOptionsBetween(newKind: string, otherKind: string): RelationshipTypeOption[] {
  const byId = new Map<string, RelationshipTypeOption>();
  for (const t of TYPES) {
    if (t.from.includes(newKind) && t.to.includes(otherKind) && !byId.has(t.id)) {
      byId.set(t.id, { id: t.id, label: relationshipTypeLabel(t.id), directionNewIsFrom: true });
    }
    if (t.from.includes(otherKind) && t.to.includes(newKind) && !byId.has(t.id)) {
      byId.set(t.id, { id: t.id, label: relationshipTypeLabel(t.id), directionNewIsFrom: false });
    }
  }
  return [...byId.values()];
}
