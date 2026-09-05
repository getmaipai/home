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
  inverseRelationship,
} from "../../records/ts/validate.js";
import type { Entity } from "../../gen/ts/entity.js";
import type { Relationship } from "../../gen/ts/relationship.js";
import type { Grant } from "../../gen/ts/grant.js";

const FIXTURES = join(import.meta.dir, "..", "..", "fixtures", "records");
const load = <T>(name: string): T => JSON.parse(readFileSync(join(FIXTURES, name), "utf-8")) as T;

const person = () => load<Entity>("entity.person.example.json");
const pet = () => load<Entity>("entity.pet.example.json");
const place = () => load<Entity>("entity.place.example.json");
const statedRel = () => load<Relationship>("relationship.stated.example.json");
const estrangedRel = () => load<Relationship>("relationship.estranged.example.json");
const inferredRel = () => load<Relationship>("relationship.inferred.example.json");
const grant = () => load<Grant>("grant.example.json");

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
