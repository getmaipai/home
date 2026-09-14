// The cross-field rules, proved to actually reject.
//
// This file exists because the first version of these schemas expressed
// the same rules as JSON Schema `if`/`then`, and both generators dropped
// them silently: every invalid case below parsed clean through the
// generated Zod and Pydantic. A rule that is documented but unenforced
// is worse than one that is merely absent, because the description
// claims otherwise. So each rule gets a test that watches it fail.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  validateEntity,
  validateRelationship,
  validateRelationshipEndpoints,
  validateGrant,
  validateList,
  validateMemoryRecord,
  validateTurnSignal,
  validateOpenQuestion,
  validateSubjectRef,
  inverseRelationship,
} from "../../records/ts/validate.js";
import type { Entity } from "../../gen/ts/entity.js";
import type { Relationship } from "../../gen/ts/relationship.js";
import type { Grant } from "../../gen/ts/grant.js";
import type { List } from "../../gen/ts/list.js";
import type { MemoryRecord } from "../../gen/ts/memory-record.js";
import type { TurnSignal } from "../../gen/ts/turn-signal.js";
import type { OpenQuestion } from "../../gen/ts/open-question.js";
import type { SubjectRef } from "../../gen/ts/subject-ref.js";
import { MemoryRecord as MemoryRecordSchema } from "../../gen/ts/memory-record.js";
import { TurnSignal as TurnSignalSchema } from "../../gen/ts/turn-signal.js";
import { OpenQuestion as OpenQuestionSchema } from "../../gen/ts/open-question.js";
import { SubjectRef as SubjectRefSchema } from "../../gen/ts/subject-ref.js";

const FIXTURES = join(import.meta.dir, "..", "..", "fixtures", "records");
const load = <T>(name: string): T => JSON.parse(readFileSync(join(FIXTURES, name), "utf-8")) as T;

const person = () => load<Entity>("entity.person.example.json");
const pet = () => load<Entity>("entity.pet.example.json");
const place = () => load<Entity>("entity.place.example.json");
const statedRel = () => load<Relationship>("relationship.stated.example.json");
const estrangedRel = () => load<Relationship>("relationship.estranged.example.json");
const inferredRel = () => load<Relationship>("relationship.inferred.example.json");
const grant = () => load<Grant>("grant.example.json");
const memoryRecord = () => load<MemoryRecord>("memory-record.memory.example.json");
const legacyMemoryRecord = () => load<MemoryRecord>("memory-record.memory-legacy.example.json");
const turnSignal = () => load<TurnSignal>("turn-signal.example.json");
const openQuestion = () => load<OpenQuestion>("open-question.example.json");
const worldSubjectRef = () => load<SubjectRef>("subject-ref.world.example.json");
const shoppingList = () => load<List>("list.shopping.example.json");
const todoList = () => load<List>("list.todo.example.json");
const customList = () => load<List>("list.custom.example.json");

const VALIDATION_FIXTURES = join(import.meta.dir, "..", "..", "fixtures", "validation");
type ValidationCase = { name: string; kind: string; base: string; overrides?: Record<string, unknown>; expected: "accept" | "refuse"; rule?: string };
const validationCases = (JSON.parse(readFileSync(join(VALIDATION_FIXTURES, "cross-field.json"), "utf-8")) as { cases: ValidationCase[] }).cases;
const mergedValidationRecord = (fixture: ValidationCase): Record<string, unknown> => ({
  ...(load<Record<string, unknown>>(fixture.base)),
  ...(fixture.overrides ?? {}),
});

describe("every shipped fixture is valid", () => {
  test("entities", () => {
    for (const e of [person(), pet(), place()]) expect(validateEntity(e)).toEqual([]);
  });
  test("relationships", () => {
    for (const r of [statedRel(), estrangedRel(), inferredRel()]) expect(validateRelationship(r)).toEqual([]);
  });
  test("grant", () => {
    expect(validateGrant(grant())).toEqual([]);
  });
  test("lists", () => {
    for (const l of [shoppingList(), todoList(), customList()]) expect(validateList(l)).toEqual([]);
  });
  test("memory record", () => {
    expect(validateMemoryRecord(memoryRecord())).toEqual([]);
  });
});

describe("entity rules", () => {
  test("a place must say which kind of place it is", () => {
    expect(validateEntity({ ...place(), place_kind: null })).toContainEqual(expect.stringContaining("must say"));
  });

  test("nothing but a place carries a place_kind", () => {
    expect(validateEntity({ ...pet(), place_kind: "map" })).toContainEqual(
      expect.stringContaining("only meaningful on a place"),
    );
  });

  // A pet holding an account would reach the authorization layer.
  test("only a person can hold an account", () => {
    expect(validateEntity({ ...pet(), account_person_id: "person-a1b2c3" })).toContainEqual(
      expect.stringContaining("only a person can hold an account"),
    );
  });

  test("containment is physical, so only places contain", () => {
    expect(validateEntity({ ...pet(), parent_id: "ent-g7h8i9" })).toContainEqual(
      expect.stringContaining("physical containment"),
    );
  });

  test("an entity cannot contain itself", () => {
    const p = place();
    expect(validateEntity({ ...p, parent_id: p.id })).toContainEqual(expect.stringContaining("contain itself"));
  });

  test("a person-scoped entity names its person, and a household-scoped one does not", () => {
    expect(validateEntity({ ...person(), scope: "person", person: null })).toContainEqual(
      expect.stringContaining("must name its person"),
    );
    expect(validateEntity({ ...person(), scope: "household", person: "person-a1b2c3" })).toContainEqual(
      expect.stringContaining("must not name a person"),
    );
  });
});

describe("list rules", () => {
  test("a due_at is only meaningful on a todo list item", () => {
    const shopping = shoppingList();
    expect(
      validateList({ ...shopping, items: [{ ...shopping.items[0]!, due_at: "2026-09-08T17:00:00Z" }] }),
    ).toContainEqual(expect.stringContaining("only meaningful on a todo list item"));
  });

  test("a person-scoped list names its person, and a household-scoped one does not", () => {
    expect(validateList({ ...todoList(), scope: "person", person: null })).toContainEqual(
      expect.stringContaining("must name its person"),
    );
    expect(validateList({ ...shoppingList(), scope: "household", person: "person-a1b2c3" })).toContainEqual(
      expect.stringContaining("must not name a person"),
    );
  });
});

// SPEC-01's own acceptance names two of these refusals explicitly: a
// companion scope without a companion_id, and a child_disclosure on
// person scope (the third, a world SubjectRef carrying an entity_id,
// is proven in fixtures.test.ts at the generated-model level).
describe("memory record rules", () => {
  test("a companion-scoped record must name its companion_id", () => {
    expect(
      validateMemoryRecord({ ...memoryRecord(), scope: "companion", person: null, companion_id: null }),
    ).toContainEqual(expect.stringContaining("must name its companion_id"));
  });

  test("companion_id is only meaningful on companion scope", () => {
    expect(
      validateMemoryRecord({ ...memoryRecord(), scope: "person", companion_id: "comp-marlow" }),
    ).toContainEqual(expect.stringContaining("only meaningful on companion scope"));
  });

  test("child_disclosure must stay null on person and self scope", () => {
    expect(
      validateMemoryRecord({ ...memoryRecord(), scope: "person", child_disclosure: "adult_only" }),
    ).toContainEqual(expect.stringContaining("meaningless on person scope"));
    expect(
      validateMemoryRecord({ ...memoryRecord(), scope: "self", person: null, child_disclosure: "child_ok" }),
    ).toContainEqual(expect.stringContaining("meaningless on self scope"));
  });

  test("child_disclosure is fine on household and companion scope", () => {
    expect(
      validateMemoryRecord({ ...memoryRecord(), scope: "household", person: null, child_disclosure: "adult_only" }),
    ).toEqual([]);
  });

  test("a memory record must carry a fact_confidence", () => {
    expect(validateMemoryRecord({ ...memoryRecord(), fact_confidence: null })).toContainEqual(
      expect.stringContaining("must carry a fact_confidence"),
    );
  });

  test("an entity or episode record never carries fact credence", () => {
    const asEntity: MemoryRecord = { ...memoryRecord(), record_kind: "entity", fact_confidence: 0.9 };
    expect(validateMemoryRecord(asEntity)).toContainEqual(expect.stringContaining("only meaningful on a memory record"));
    const withEvidence: MemoryRecord = {
      ...memoryRecord(),
      record_kind: "episode",
      fact_confidence: null,
      confidence_evidence: [{ source_id: "turn-1", source_person_id: null, kind: "initial_assertion", observed_at: "2026-09-14T00:00:00Z" }],
    };
    expect(validateMemoryRecord(withEvidence)).toContainEqual(expect.stringContaining("confidence_evidence is only meaningful"));
  });

  // Item 1b (SPEC-01's second reading, 2026-09-14): the migrated-legacy
  // shape the schema's own description promises (1.0, one
  // legacy_assertion entry) is a real, valid record, not just prose.
  test("the migrated-legacy fixture is itself valid", () => {
    expect(validateMemoryRecord(legacyMemoryRecord())).toEqual([]);
  });

  test("child_disclosure_set_by and _set_at must be set together", () => {
    expect(
      validateMemoryRecord({ ...memoryRecord(), scope: "household", person: null, child_disclosure_set_by: "person-a1b2c3", child_disclosure_set_at: null }),
    ).toContainEqual(expect.stringContaining("must be set together"));
    expect(
      validateMemoryRecord({ ...memoryRecord(), scope: "household", person: null, child_disclosure_set_by: null, child_disclosure_set_at: "2026-09-14T00:00:00Z" }),
    ).toContainEqual(expect.stringContaining("must be set together"));
  });

  // A third code review on item 1b caught this: the pairing test above
  // only proves the two fields move together, not that either is
  // meaningless on a scope where child_disclosure itself must stay null.
  test("child_disclosure_set_by and _set_at are also meaningless on person and self scope", () => {
    expect(
      validateMemoryRecord({ ...memoryRecord(), scope: "person", child_disclosure_set_by: "person-a1b2c3", child_disclosure_set_at: "2026-09-14T00:00:00Z" }),
    ).toContainEqual(expect.stringContaining("meaningless on person scope"));
    expect(
      validateMemoryRecord({ ...memoryRecord(), scope: "self", person: null, child_disclosure_set_by: "person-a1b2c3", child_disclosure_set_at: "2026-09-14T00:00:00Z" }),
    ).toContainEqual(expect.stringContaining("meaningless on self scope"));
  });

  test("retrieval_feedback.corrections and last_corrected_at move together", () => {
    expect(
      validateMemoryRecord({ ...memoryRecord(), retrieval_feedback: { corrections: 0, last_corrected_at: "2026-09-14T00:00:00Z" } }),
    ).toContainEqual(expect.stringContaining("must be null while corrections is 0"));
    expect(
      validateMemoryRecord({ ...memoryRecord(), retrieval_feedback: { corrections: 2, last_corrected_at: null } }),
    ).toContainEqual(expect.stringContaining("must be set once corrections is above 0"));
    expect(
      validateMemoryRecord({ ...memoryRecord(), retrieval_feedback: { corrections: 0, last_corrected_at: null } }),
    ).toEqual([]);
  });
});

describe("turn signal rules", () => {
  test("every shipped fixture is valid", () => {
    expect(validateTurnSignal(turnSignal())).toEqual([]);
  });

  test("source: head must carry a classifier_id", () => {
    expect(validateTurnSignal({ ...turnSignal(), source: "head", classifier_id: null })).toContainEqual(
      expect.stringContaining("must carry a classifier_id"),
    );
  });

  test("classifier_id is only meaningful when source is head", () => {
    expect(validateTurnSignal({ ...turnSignal(), source: "rule", classifier_id: "act-head-v1" })).toContainEqual(
      expect.stringContaining("only meaningful when source is head"),
    );
  });

  test("a clause range unordered within itself is rejected", () => {
    const signal = turnSignal();
    const bad = { ...signal, clauses: [{ ...signal.clauses[0]!, range: { start: 10, end: 2 } }] };
    expect(validateTurnSignal(bad)).toContainEqual(expect.stringContaining("unordered"));
  });

  test("a clause range past the utterance's own length is rejected when the text is supplied", () => {
    const signal = turnSignal();
    const bad = { ...signal, clauses: [{ ...signal.clauses[0]!, range: { start: 0, end: 500 } }] };
    expect(validateTurnSignal(bad, "short utterance")).toContainEqual(expect.stringContaining("runs past the utterance's own length"));
    // Without the utterance text, the same signal is not checked against a length at all.
    expect(validateTurnSignal(bad)).toEqual([]);
  });

  test("overlapping clause ranges are rejected", () => {
    const signal = turnSignal();
    const base = signal.clauses[0]!;
    const bad = { ...signal, clauses: [{ ...base, range: { start: 0, end: 10 } }, { ...base, range: { start: 5, end: 15 } }] };
    expect(validateTurnSignal(bad)).toContainEqual(expect.stringContaining("overlap"));
  });
});

describe("shared cross-language validation conformance", () => {
  for (const fixture of validationCases) {
    test(fixture.name, () => {
      const raw = mergedValidationRecord(fixture);
      const utterance = raw.utterance_text as string | undefined;
      delete raw.utterance_text;
      let problems: string[] = [];
      let schemaRefused = false;
      try {
        if (fixture.kind === "memory") problems = validateMemoryRecord(MemoryRecordSchema.parse(raw));
        else if (fixture.kind === "turn") problems = validateTurnSignal(TurnSignalSchema.parse(raw), utterance);
        else if (fixture.kind === "question") problems = validateOpenQuestion(OpenQuestionSchema.parse(raw));
        else if (fixture.kind === "subject") {
          const subject = SubjectRefSchema.parse(raw);
          problems = validateSubjectRef(subject);
        }
      } catch {
        schemaRefused = true;
      }
      if (fixture.expected === "accept") expect(schemaRefused ? ["schema"] : problems).toEqual([]);
      else expect(schemaRefused || problems.some((problem) => problem.includes(fixture.rule!))).toBe(true);
    });
  }
});

describe("open question rules", () => {
  test("every shipped fixture is valid", () => {
    expect(validateOpenQuestion(openQuestion())).toEqual([]);
  });

  test("pending must not carry asked_at", () => {
    expect(validateOpenQuestion({ ...openQuestion(), status: "pending", asked_at: "2026-09-14T00:00:00Z", resolved_at: null })).toContainEqual(
      expect.stringContaining("must not carry asked_at"),
    );
  });

  test("asked, answered and declined must carry asked_at", () => {
    for (const status of ["asked", "answered", "declined"] as const) {
      expect(validateOpenQuestion({ ...openQuestion(), status, asked_at: null })).toContainEqual(
        expect.stringContaining("must carry asked_at"),
      );
    }
  });

  test("answered and declined must carry resolved_at", () => {
    for (const status of ["answered", "declined"] as const) {
      expect(
        validateOpenQuestion({ ...openQuestion(), status, asked_at: "2026-09-14T00:00:00Z", resolved_at: null }),
      ).toContainEqual(expect.stringContaining("must carry resolved_at"));
    }
  });

  test("pending, asked and expired must not carry resolved_at", () => {
    for (const status of ["pending", "asked", "expired"] as const) {
      expect(
        validateOpenQuestion({ ...openQuestion(), status, asked_at: status === "pending" ? null : "2026-09-14T00:00:00Z", resolved_at: "2026-09-14T01:00:00Z" }),
      ).toContainEqual(expect.stringContaining("must not carry resolved_at"));
    }
  });

  test("a valid answered question has both timestamps", () => {
    expect(
      validateOpenQuestion({ ...openQuestion(), status: "answered", asked_at: "2026-09-14T00:00:00Z", resolved_at: "2026-09-14T01:00:00Z" }),
    ).toEqual([]);
  });
});

describe("subject ref rules", () => {
  test("every shipped fixture is valid", () => {
    expect(validateSubjectRef(worldSubjectRef())).toEqual([]);
  });

  test("household and unresolved refs have nothing to check", () => {
    expect(validateSubjectRef({ type: "household", entity_id: "ent-a1b2c3", carried_question: null })).toEqual([]);
    expect(
      validateSubjectRef({ type: "unresolved", surface_form: "Quill", candidate_kinds: [], provenance: "turn-1", confidence: 0.4, carried_question: null }),
    ).toEqual([]);
  });

  test("a world ref's source_kind and stable_key must be set together", () => {
    const ref = worldSubjectRef();
    if (ref.type !== "world") throw new Error("fixture is not the world variant");
    expect(validateSubjectRef({ ...ref, source_kind: null, stable_key: "Q123456789" })).toContainEqual(
      expect.stringContaining("must be set together"),
    );
    expect(validateSubjectRef({ ...ref, source_kind: "wikidata", stable_key: null })).toContainEqual(
      expect.stringContaining("must be set together"),
    );
    expect(validateSubjectRef({ ...ref, source_kind: null, stable_key: null })).toEqual([]);
  });
});

describe("relationship rules", () => {
  test("an unknown type is rejected outright", () => {
    expect(validateRelationship({ ...statedRel(), type: "frenemy_of" })).toEqual([
      "unknown relationship type: frenemy_of",
    ]);
  });

  // The headline rule: family does not end, it changes status.
  test("an ex-daughter cannot be expressed", () => {
    const problems = validateRelationship({ ...estrangedRel(), valid_to: "2026-01-01T00:00:00Z" });
    expect(problems).toContainEqual(expect.stringContaining("cannot end"));
  });

  test("a job can end, and saying so is not an error", () => {
    expect(validateRelationship(statedRel())).toEqual([]);
    expect(statedRel().valid_to).not.toBeNull();
  });

  test("a status the type does not admit is rejected", () => {
    expect(validateRelationship({ ...statedRel(), status: "estranged" })).toContainEqual(
      expect.stringContaining("does not admit"),
    );
  });

  test("a relationship cannot join an entity to itself", () => {
    const r = statedRel();
    expect(validateRelationship({ ...r, to_id: r.from_id })).toContainEqual(
      expect.stringContaining("join an entity to itself"),
    );
  });

  test("dates that run backwards are rejected", () => {
    expect(
      validateRelationship({ ...statedRel(), valid_from: "2024-01-01T00:00:00Z", valid_to: "2019-01-01T00:00:00Z" }),
    ).toContainEqual(expect.stringContaining("before valid_from"));
  });
});

describe("the rules that keep an inference honest", () => {
  test("a guess must carry a confidence and its evidence", () => {
    expect(validateRelationship({ ...inferredRel(), confidence: null })).toContainEqual(
      expect.stringContaining("must carry a confidence"),
    );
    expect(validateRelationship({ ...inferredRel(), evidence: [] })).toContainEqual(
      expect.stringContaining("cannot be reviewed"),
    );
  });

  // The one that matters most: an unconfirmed guess about someone's
  // private life must not become household knowledge because the hub
  // joined two records together.
  test("an unconfirmed guess cannot be household-scoped", () => {
    expect(
      validateRelationship({ ...inferredRel(), scope: "household", person: null, confirmed_by_person_id: null }),
    ).toContainEqual(expect.stringContaining("the person's data until they say otherwise"));
  });

  test("once a person confirms it, it may be shared", () => {
    expect(
      validateRelationship({
        ...inferredRel(),
        scope: "household",
        person: null,
        confirmed_by_person_id: "person-a1b2c3",
      }),
    ).toEqual([]);
  });

  test("a stated relationship carries no confidence and must name who said it", () => {
    expect(validateRelationship({ ...statedRel(), confidence: 0.9 })).toContainEqual(
      expect.stringContaining("only an inferred relationship has a confidence"),
    );
    expect(validateRelationship({ ...statedRel(), stated_by_person_id: null })).toContainEqual(
      expect.stringContaining("who stated it"),
    );
  });
});

describe("relationship endpoints", () => {
  /** An edge whose from_id/to_id really are these two entities, which the
   * endpoint check now insists on. */
  function edgeBetween(type: string, from: Entity, to: Entity): Relationship {
    return { ...statedRel(), type, from_id: from.id, to_id: to.id };
  }

  test("a type refuses kinds it cannot join", () => {
    // A pet can live at a place.
    expect(validateRelationshipEndpoints(edgeBetween("lives_at", pet(), place()), pet(), place())).toEqual([]);
    // A place cannot live at a person.
    expect(
      validateRelationshipEndpoints(edgeBetween("lives_at", place(), person()), place(), person()).length,
    ).toBeGreaterThan(0);
  });

  test("ownership reaches pets and things, never a person", () => {
    expect(validateRelationshipEndpoints(edgeBetween("owns", person(), pet()), person(), pet())).toEqual([]);
    const p = person();
    const other: Entity = { ...p, id: "ent-z9y8x7" };
    expect(validateRelationshipEndpoints(edgeBetween("owns", p, other), p, other)).toContainEqual(
      expect.stringContaining("cannot point at a person"),
    );
  });

  // Both parameters have the same TypeScript shape, so a transposed call
  // site type-checks perfectly. Before this check it stored a backwards
  // edge with no error anywhere.
  test("entities that are not this edge's endpoints are refused", () => {
    const edge = edgeBetween("lives_at", pet(), place());
    expect(validateRelationshipEndpoints(edge, place(), pet())).toContainEqual(
      expect.stringContaining("is not this relationship's from_id"),
    );
  });
});

describe("dates are compared as instants, not strings", () => {
  // Both directions verified broken on the lexicographic version this
  // replaced (code review, 2026-09-05).
  test("an offset timestamp that runs forward is accepted", () => {
    expect(
      validateRelationship({
        ...statedRel(),
        valid_from: "2026-03-01T08:00:00+05:00",
        valid_to: "2026-03-01T04:00:00Z",
      }),
    ).toEqual([]);
  });

  test("an offset timestamp that runs backward is rejected", () => {
    expect(
      validateRelationship({
        ...statedRel(),
        valid_from: "2026-03-01T23:00:00Z",
        valid_to: "2026-03-02T00:30:00+02:00",
      }),
    ).toContainEqual(expect.stringContaining("before valid_from"));
  });

  test("a grant that expires before it starts is rejected", () => {
    expect(
      validateGrant({ ...grant(), valid_from: "2026-09-08T00:00:00Z", valid_to: "2026-09-05T00:00:00Z" }),
    ).toContainEqual(expect.stringContaining("before valid_from"));
  });
});

describe("grant rules", () => {
  test("an unknown action is rejected outright", () => {
    expect(validateGrant({ ...grant(), action: "do.anything" })).toEqual(["unknown grant action: do.anything"]);
  });

  // The concrete form, matched the way manifest permissions already are:
  // `use:videos` against the vocabulary's `use:<package>`.
  test("a parameterized action matches its template and needs a real target", () => {
    expect(validateGrant({ ...grant(), action: "use:videos" })).toEqual([]);
    expect(validateGrant({ ...grant(), action: "integration:home-assistant" })).toEqual([]);
    // A bare prefix names nothing.
    expect(validateGrant({ ...grant(), action: "use:" })).toEqual(["unknown grant action: use:"]);
    // A literal action does not take one.
    expect(validateGrant({ ...grant(), action: "backups.run" })).toEqual([]);
    expect(validateGrant({ ...grant(), action: "backups.run:videos" })).toEqual([
      "unknown grant action: backups.run:videos",
    ]);
  });

  // Persisted, an un-substituted template would later resolve against a
  // package literally named "<package>".
  test("the raw vocabulary template is not an action", () => {
    expect(validateGrant({ ...grant(), action: "use:<package>" })).toEqual([
      "unknown grant action: use:<package>",
    ]);
  });

  // The org's Safety invariants: unrestricted mode is one clear dialog
  // per adult, never repeated. A grant nobody acknowledged skipped it.
  test("unrestricted mode cannot be granted without the adult's acknowledgment", () => {
    const g: Grant = { ...grant(), action: "chat.unrestricted", effect: "allow", acknowledged_at: null };
    expect(validateGrant(g)).toContainEqual(expect.stringContaining("one-time acknowledgment"));
    // A timestamp alone proves only that something happened, not who
    // agreed to what.
    expect(validateGrant({ ...g, acknowledged_at: "2026-09-05T12:00:00Z" })).toContainEqual(
      expect.stringContaining("one-time acknowledgment"),
    );
    expect(
      validateGrant({
        ...g,
        acknowledged_at: "2026-09-05T12:00:00Z",
        acknowledged_by_person_id: g.person,
      }),
    ).toEqual([]);
  });

  // Unrestricted mode is something an adult accepts for themselves.
  test("one adult cannot acknowledge unrestricted mode on another's behalf", () => {
    expect(
      validateGrant({
        ...grant(),
        action: "chat.unrestricted",
        effect: "allow",
        acknowledged_at: "2026-09-05T12:00:00Z",
        acknowledged_by_person_id: "person-someoneelse",
      }),
    ).toContainEqual(expect.stringContaining("not on their behalf"));
  });

  // A deny needs no acknowledgment: taking something away is never the
  // action that needs a consent step.
  test("denying unrestricted mode needs no acknowledgment", () => {
    expect(
      validateGrant({ ...grant(), action: "chat.unrestricted", effect: "deny", acknowledged_at: null }),
    ).toEqual([]);
  });
});

// Relationship's own description promises "parent_of and child_of are
// different edges, both stored". Nothing created the second row, so a
// writer inserting one direction left the other silently empty (code
// review, 2026-09-05). This is the helper that keeps the promise.
describe("the reciprocal edge", () => {
  const stamps = { id: "rel-z9y8x7", created_at: "2026-09-05T12:00:00Z", updated_at: "2026-09-05T12:00:00Z" };

  test("an asymmetric edge produces its inverse, pointing the other way", () => {
    const daughter = estrangedRel(); // child_of
    const inverse = inverseRelationship(daughter, stamps);
    expect(inverse).not.toBeNull();
    expect(inverse!.type).toBe("parent_of");
    expect(inverse!.from_id).toBe(daughter.to_id);
    expect(inverse!.to_id).toBe(daughter.from_id);
    // And it is a valid record in its own right, status carried across.
    expect(validateRelationship(inverse!)).toEqual([]);
    expect(inverse!.status).toBe("estranged");
  });

  // Storing a second row for a symmetric type would be storing the same
  // fact twice.
  test("a symmetric edge has no second row", () => {
    expect(inverseRelationship(inferredRel(), stamps)).toBeNull(); // partner_of
  });

  test("an unknown type produces nothing rather than a broken row", () => {
    expect(inverseRelationship({ ...statedRel(), type: "frenemy_of" }, stamps)).toBeNull();
  });
});
