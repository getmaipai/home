// The cross-field rules for Entity, Relationship and Grant, in one place,
// because the schemas cannot carry them.
//
// Why this file exists at all: JSON Schema can express these as
// `if`/`then`/`else`, and both of this repo's generators silently drop
// them. Written that way, a schema looks enforced and does nothing - a
// pet could carry a `place_kind`, a person-scoped record could name no
// person, a stated relationship could arrive with a confidence score.
// Verified directly (2026-09-05) rather than assumed: an entity fixture
// violating every one of those parsed clean through both the generated
// Zod and the generated Pydantic. No other schema in this repo uses a
// conditional, and MemoryRecord already documents its own scope/person
// rule in prose and enforces it in code; this follows that convention
// and gives the rules somewhere real to live.
//
// TS-only for now, the same honest split spec/safety/ takes ("TS only
// for now, see safety/README.md"): the hub is the only thing writing
// these records today. The Python half lands when the robot writes one.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Entity } from "../../gen/ts/entity.js";
import type { Relationship } from "../../gen/ts/relationship.js";
import type { Grant } from "../../gen/ts/grant.js";
import type { List } from "../../gen/ts/list.js";
import type { MemoryRecord } from "../../gen/ts/memory-record.js";
import type { TurnSignal } from "../../gen/ts/turn-signal.js";
import type { OpenQuestion } from "../../gen/ts/open-question.js";
import type { SubjectRef } from "../../gen/ts/subject-ref.js";

const VOCAB_DIR = join(import.meta.dir, "..", "..", "vocab");

export interface RelationshipType {
  id: string;
  from: string[];
  to: string[];
  inverse: string;
  terminable: boolean;
  symmetric?: boolean;
  statuses: string[];
  description: string;
  /** The phrases a person uses to state this relationship from their
   * own side, lowercase ("my coworker"); absent on the inverse types
   * the hub writes itself. A relationship is the speaker's own
   * statement only when their sentence carries one. */
  said_as?: string[];
}

interface RelationshipVocab {
  statuses: { values: Array<{ id: string; description: string }> };
  types: RelationshipType[];
}

interface GrantVocab {
  actions: Array<{ id: string; parameterized: boolean; description: string }>;
}

/** vocab/entity-kind-nouns.json: the nouns a person answers "Who's
 * Quill?" with ("my coworker", "our rabbit"), each mapped to one of
 * entity.schema.json's kinds (SPEC-01, ASK-01's answer parser). */
export interface EntityKindNouns {
  kind: "person" | "pet" | "place" | "organization" | "thing";
  nouns: string[];
}

interface EntityKindVocab {
  kinds: EntityKindNouns[];
}

let relVocab: RelationshipVocab | null = null;
let grantVocab: GrantVocab | null = null;
let kindNounVocab: EntityKindVocab | null = null;

export function relationshipTypes(): RelationshipType[] {
  relVocab ??= JSON.parse(readFileSync(join(VOCAB_DIR, "relationship-types.json"), "utf-8")) as RelationshipVocab;
  return relVocab.types;
}

export function relationshipType(id: string): RelationshipType | undefined {
  return relationshipTypes().find((t) => t.id === id);
}

export function entityKindNouns(): EntityKindNouns[] {
  kindNounVocab ??= JSON.parse(readFileSync(join(VOCAB_DIR, "entity-kind-nouns.json"), "utf-8")) as EntityKindVocab;
  return kindNounVocab.kinds;
}

/** The kind a noun hints, or undefined when the vocabulary has no
 * entry for it (the kind is then left unset, never invented). */
export function kindForNoun(noun: string): EntityKindNouns["kind"] | undefined {
  const wanted = noun.trim().toLowerCase();
  return entityKindNouns().find((k) => k.nouns.includes(wanted))?.kind;
}

export function grantActions(): GrantVocab["actions"] {
  grantVocab ??= JSON.parse(readFileSync(join(VOCAB_DIR, "grant-actions.json"), "utf-8")) as GrantVocab;
  return grantVocab.actions;
}

/** Every problem found, rather than the first: a form correcting one
 * field at a time is the reason people give up on them. */
export type Problems = string[];

/** True when `to` is genuinely before `from` as instants.
 *
 * Not a string comparison. `format: date-time` permits a non-Z offset,
 * and a code review (2026-09-05) verified both failure directions on the
 * lexicographic version this replaces: "2026-03-01T08:00:00+05:00"
 * (03:00Z) followed by "2026-03-01T04:00:00Z" was rejected though it
 * runs forward, and "2026-03-01T23:00:00Z" followed by
 * "2026-03-02T00:30:00+02:00" (22:30Z) passed though it runs backward. */
function endsBeforeItStarts(from: string | null, to: string | null): boolean {
  if (!from || !to) return false;
  const start = Date.parse(from);
  const end = Date.parse(to);
  if (Number.isNaN(start) || Number.isNaN(end)) return false;
  return end < start;
}

export function validateEntity(entity: Entity): Problems {
  const problems: Problems = [];

  if (entity.kind === "place") {
    if (!entity.place_kind) problems.push("a place must say whether it is a `map` place or an `area` inside one");
  } else if (entity.place_kind) {
    problems.push(`place_kind is only meaningful on a place, not on a ${entity.kind}`);
  }

  // Only a person can sign in. A pet with an account is a data error that
  // would otherwise reach the authorization layer.
  if (entity.kind !== "person" && entity.account_person_id) {
    problems.push(`only a person can hold an account; this is a ${entity.kind}`);
  }

  // Containment is physical, so only places contain and are contained.
  if (entity.parent_id && entity.kind !== "place") {
    problems.push("parent_id is physical containment and only applies to places");
  }
  if (entity.parent_id && entity.parent_id === entity.id) {
    problems.push("an entity cannot contain itself");
  }

  problems.push(...scopeProblems(entity.scope, entity.person));

  // An inferred entity nobody has confirmed must not claim a confirmer.
  if (entity.source === "inferred" && entity.confirmed_by_person_id === null && entity.scope === "household") {
    problems.push("an unconfirmed inferred entity cannot be household-scoped; it belongs to the person it came from");
  }

  return problems;
}

export function validateRelationship(rel: Relationship): Problems {
  const problems: Problems = [];
  const type = relationshipType(rel.type);

  if (!type) {
    // Everything below reads the vocabulary, so there is nothing more to
    // say about a type that is not in it.
    return [`unknown relationship type: ${rel.type}`];
  }

  if (!type.statuses.includes(rel.status)) {
    problems.push(`${rel.type} does not admit the status "${rel.status}" (allowed: ${type.statuses.join(", ")})`);
  }

  // The rule that makes "ex-daughter" unsayable.
  if (rel.valid_to && !type.terminable) {
    problems.push(
      `${rel.type} cannot end, so valid_to must stay null; if the relationship has gone bad, that is a status`,
    );
  }

  if (endsBeforeItStarts(rel.valid_from, rel.valid_to)) {
    problems.push("valid_to is before valid_from");
  }

  if (rel.from_id === rel.to_id) {
    problems.push("a relationship cannot join an entity to itself");
  }

  // A guess carries confidence and its evidence; a person's statement
  // carries neither, and carries who said it instead.
  if (rel.source === "inferred") {
    if (rel.confidence === null) problems.push("an inferred relationship must carry a confidence");
    if (rel.evidence.length === 0) {
      problems.push("an inferred relationship must carry the evidence it came from, or it cannot be reviewed");
    }
    if (rel.scope === "household" && rel.confirmed_by_person_id === null) {
      problems.push(
        "an unconfirmed inferred relationship cannot be household-scoped: it is the person's data until they say otherwise",
      );
    }
    // The guard the confidence and evidence checks already had, and this
    // one was missing (code review, 2026-09-05). Without it the hub can
    // copy a speaker's id into stated_by_person_id and a renderer will
    // show "Riff said Alex is Marlow's partner" for something nobody
    // said - exactly the assertion this record type exists to prevent.
    if (rel.stated_by_person_id) {
      problems.push("an inferred relationship must not name a person as having stated it; nobody did");
    }
  } else {
    if (rel.confidence !== null) problems.push("only an inferred relationship has a confidence; a person said this one");
    if (rel.evidence.length > 0) problems.push("evidence belongs to an inferred relationship");
    if (rel.source === "stated" && !rel.stated_by_person_id) {
      problems.push("a stated relationship must record who stated it");
    }
  }

  problems.push(...scopeProblems(rel.scope, rel.person));
  return problems;
}

/** Checks the entity kinds an edge joins. Separate from
 * validateRelationship because it needs the two entities, which a caller
 * holding only the edge does not have. */
export function validateRelationshipEndpoints(
  rel: Relationship,
  from: Pick<Entity, "id" | "kind">,
  to: Pick<Entity, "id" | "kind">,
): Problems {
  const type = relationshipType(rel.type);
  if (!type) return [`unknown relationship type: ${rel.type}`];
  const problems: Problems = [];
  // This function's whole job is direction (lives_at vs home_of), and
  // both parameters have the same TypeScript shape, so a transposed call
  // site type-checks perfectly and stores a backwards edge. Checked
  // rather than trusted (code review, 2026-09-05).
  if (from.id !== rel.from_id) problems.push(`the "from" entity ${from.id} is not this relationship's from_id`);
  if (to.id !== rel.to_id) problems.push(`the "to" entity ${to.id} is not this relationship's to_id`);
  if (problems.length > 0) return problems;
  if (!type.from.includes(from.kind)) {
    problems.push(`${rel.type} cannot start at a ${from.kind} (allowed: ${type.from.join(", ")})`);
  }
  if (!type.to.includes(to.kind)) {
    problems.push(`${rel.type} cannot point at a ${to.kind} (allowed: ${type.to.join(", ")})`);
  }
  return problems;
}

/** Builds the reciprocal edge a writer must store alongside this one.
 *
 * Relationship's own description promises that "parent_of and child_of
 * are different edges, both stored, so a lookup either way is an index
 * hit rather than a scan". A code review (2026-09-05) pointed out that
 * nothing created or checked the second row, so a writer inserting only
 * `parent_of` leaves `child_of` queries silently empty and the promise
 * fails in one direction with no error anywhere. This is the function
 * that keeps it true; a writer calls it rather than remembering.
 *
 * Returns null for a symmetric type whose reciprocal is the same edge
 * read the other way (sibling_of, partner_of, friend_of): storing a
 * second row there would be storing the same fact twice.
 *
 * The caller supplies the new row's id and timestamps, because minting
 * ids is the hub's job, not the spec's. */
export function inverseRelationship(
  rel: Relationship,
  fields: { id: string; created_at: string; updated_at: string },
): Relationship | null {
  const type = relationshipType(rel.type);
  if (!type || type.symmetric) return null;
  return {
    ...rel,
    ...fields,
    type: type.inverse,
    from_id: rel.to_id,
    to_id: rel.from_id,
  };
}

/** Matches a grant's concrete action against the vocabulary, the same way
 * a manifest's `net:api.open-meteo.com` matches permissions.json's
 * `net:<host>`: a literal entry matches exactly, a parameterized one
 * matches on its prefix and requires a non-empty target after the colon. */
export function matchGrantAction(action: string): { id: string; parameterized: boolean } | undefined {
  // An un-substituted template is not an action. Persisted, `use:<package>`
  // would validate clean and later resolve against a package literally
  // named "<package>" (code review, 2026-09-05).
  if (action.includes("<") || action.includes(">")) return undefined;
  const exact = grantActions().find((a) => !a.parameterized && a.id === action);
  if (exact) return exact;
  const colon = action.indexOf(":");
  if (colon <= 0 || colon === action.length - 1) return undefined;
  const prefix = action.slice(0, colon + 1);
  return grantActions().find((a) => a.parameterized && a.id.startsWith(prefix));
}

export function validateGrant(grant: Grant): Problems {
  const problems: Problems = [];

  if (!matchGrantAction(grant.action)) {
    // A grant naming an action nobody defined cannot be rendered,
    // explained or audited, which is most of the point of having a
    // closed vocabulary.
    return [`unknown grant action: ${grant.action}`];
  }

  // A "screens until Sunday" grant that expires before it starts is
  // silently no grant at all.
  if (endsBeforeItStarts(grant.valid_from, grant.valid_to)) {
    problems.push("valid_to is before valid_from");
  }

  // The org's Safety invariants: unrestricted mode is unlocked per adult
  // by "a single clear dialog... one confirmation, no legalese ceremony,
  // never repeated". A grant for it that nobody acknowledged has skipped
  // that step.
  const NEEDS_ACKNOWLEDGMENT = new Set(["chat.unrestricted", "generate.unrestricted"]);
  if (NEEDS_ACKNOWLEDGMENT.has(grant.action) && grant.effect === "allow") {
    if (!grant.acknowledged_at || !grant.acknowledged_by_person_id) {
      problems.push(`${grant.action} requires the adult's one-time acknowledgment before it can be allowed`);
    } else if (grant.acknowledged_by_person_id !== grant.person) {
      // Unrestricted mode is something an adult accepts FOR THEMSELVES.
      // A code review (2026-09-05) found the earlier check proved only
      // that some timestamp existed, with nothing recording who agreed.
      problems.push(
        `${grant.action} must be acknowledged by the person it is about, not on their behalf by someone else`,
      );
    }
  }

  return problems;
}

function scopeProblems(scope: string, person: string | null | undefined): Problems {
  if (scope === "person" && !person) return ["a person-scoped record must name its person"];
  if (scope !== "person" && person) return [`a ${scope}-scoped record must not name a person`];
  return [];
}

/** SPEC-01's own cross-field rules (dev.md 'Coherence review', question 1;
 * BACKLOG's SPEC-01 acceptance names two of these three refusals
 * explicitly): a companion-scoped record without a companion_id, and a
 * child_disclosure set on a scope where it is meaningless. The third
 * named refusal (a world SubjectRef carrying an entity_id) needs no
 * function here - `additionalProperties: false` on each branch of
 * subject-ref.schema.json's own `oneOf` already refuses it at the
 * generated-model level, the same way recipe.schema.json's own step
 * union already proves this pattern works through both generators. */
export function validateMemoryRecord(record: MemoryRecord): Problems {
  const problems: Problems = [];

  if (record.scope === "companion") {
    if (!record.companion_id) problems.push("a companion-scoped record must name its companion_id");
  } else if (record.companion_id) {
    problems.push(`companion_id is only meaningful on companion scope, not on ${record.scope}`);
  }

  problems.push(...scopeProblems(record.scope, record.person));

  if (record.scope === "person" || record.scope === "self") {
    if (record.child_disclosure !== null) {
      problems.push(`child_disclosure is meaningless on ${record.scope} scope and must stay null`);
    }
    // A third code review on item 1b caught the gap: the pairing check
    // just below only proves set_by and set_at move together, not that
    // either is meaningless here too - a person/self record could claim
    // an adult set a disclosure the record doesn't even carry.
    if (record.child_disclosure_set_by !== null || record.child_disclosure_set_at !== null) {
      problems.push(`child_disclosure_set_by and child_disclosure_set_at are meaningless on ${record.scope} scope and must stay null`);
    }
  }

  // Item 1b (a second reading of SPEC-01, 2026-09-14): set_by and set_at
  // are one fact together (who acted, and when) - one present without
  // the other is a half-written record no reader can trust.
  if ((record.child_disclosure_set_by === null) !== (record.child_disclosure_set_at === null)) {
    problems.push("child_disclosure_set_by and child_disclosure_set_at must be set together, or both null");
  }

  // Section 14: fact credence exists only where a proposition can be
  // credited or doubted. An entity or an episode never acquires it by
  // accident.
  if (record.record_kind === "memory") {
    if (record.fact_confidence === null) problems.push("a memory record must carry a fact_confidence");
  } else {
    if (record.fact_confidence !== null) problems.push(`fact_confidence is only meaningful on a memory record, not a ${record.record_kind}`);
    if (record.confidence_evidence.length > 0) problems.push(`confidence_evidence is only meaningful on a memory record, not a ${record.record_kind}`);
  }

  // Item 1b: retrieval_feedback's own two fields tell one story (how many
  // times, and when most recently) - a count with no date, or a date with
  // no count, is a signal REVIEW-01 could never have produced honestly.
  const feedback = record.retrieval_feedback;
  if (feedback.corrections === 0 && feedback.last_corrected_at !== null) {
    problems.push("retrieval_feedback.last_corrected_at must be null while corrections is 0");
  }
  if (feedback.corrections > 0 && feedback.last_corrected_at === null) {
    problems.push("retrieval_feedback.last_corrected_at must be set once corrections is above 0");
  }

  return problems;
}

/** Item 1b: TurnSignal.source and classifier_id are one fact - which
 * layer produced the signal, and (only for the head layer) which
 * artifact. `clauses` ranges are checked against each other and,
 * when the turn's own utterance is supplied, against its length -
 * optional because a signal can be validated on its own, off the
 * turn record that carries the text a clause range indexes into. */
export function validateTurnSignal(signal: TurnSignal, utteranceText?: string): Problems {
  const problems: Problems = [];

  if (signal.source === "head") {
    if (signal.classifier_id === null) problems.push("source: head must carry a classifier_id");
  } else if (signal.classifier_id !== null) {
    problems.push(`classifier_id is only meaningful when source is head, not ${signal.source}`);
  }

  const sorted = [...signal.clauses].sort((a, b) => a.range.start - b.range.start);
  for (let i = 0; i < sorted.length; i++) {
    const { start, end } = sorted[i]!.range;
    if (end < start) problems.push(`a clause range is unordered: start ${start} is after end ${end}`);
    if (utteranceText !== undefined && end > utteranceText.length) {
      problems.push(`a clause range (${start}-${end}) runs past the utterance's own length (${utteranceText.length})`);
    }
    const next = sorted[i + 1];
    if (next && next.range.start < end) {
      problems.push(`clause ranges overlap: ${start}-${end} and ${next.range.start}-${next.range.end}`);
    }
  }

  return problems;
}

/** Item 1b: an OpenQuestion's own status and its timestamps have to
 * agree on what has actually happened. pending is strictly before
 * asked_at exists; asked and answered/declined require it. Only
 * answered/declined may carry resolved_at - expired is a lapse, not a
 * resolution, and its own asked_at is left unconstrained (an
 * expired question may have lapsed before it was ever asked, or after,
 * per its own description). */
export function validateOpenQuestion(question: OpenQuestion): Problems {
  const problems: Problems = [];

  if (question.status === "pending" && question.asked_at !== null) {
    problems.push("a pending open question must not carry asked_at yet");
  }
  if ((question.status === "asked" || question.status === "answered" || question.status === "declined") && question.asked_at === null) {
    problems.push(`status ${question.status} must carry asked_at`);
  }
  if ((question.status === "answered" || question.status === "declined") && question.resolved_at === null) {
    problems.push(`status ${question.status} must carry resolved_at`);
  }
  if ((question.status === "pending" || question.status === "asked" || question.status === "expired") && question.resolved_at !== null) {
    problems.push(`status ${question.status} must not carry resolved_at`);
  }

  return problems;
}

/** Item 1b: a world SubjectRef's source_kind and stable_key name one
 * typed source's answer together - a kind with no key, or a key with
 * no kind naming what answered, is not traceable to anything. Only the
 * world variant carries either field; household and unresolved refs
 * have nothing to check here. */
export function validateSubjectRef(ref: SubjectRef): Problems {
  if (ref.type !== "world") return [];
  if ((ref.source_kind === null) !== (ref.stable_key === null)) {
    return ["a world SubjectRef's source_kind and stable_key must be set together, or both null"];
  }
  return [];
}

/** Step 8's own cross-field rule, the same shape Entity's place_kind
 * check already follows: `due_at` on a list item is only meaningful for
 * a to-do list (list.schema.json's own description) - a shopping-list
 * "milk" with a due date, or a custom list's book with one, is a data
 * error the schema alone can't catch. */
export function validateList(list: List): Problems {
  const problems: Problems = [];
  problems.push(...scopeProblems(list.scope, list.person));
  if (list.kind !== "todo") {
    for (const item of list.items) {
      if (item.due_at) problems.push(`due_at is only meaningful on a todo list item, not a ${list.kind} one ("${item.text}")`);
    }
  }
  return problems;
}
