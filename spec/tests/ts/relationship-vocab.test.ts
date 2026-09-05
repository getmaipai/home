// The relationship vocabulary is only worth having if something enforces
// it. These are the rules that keep the household graph from becoming a
// swamp, and every one of them comes from a real example rather than a
// category someone invented:
//
//   - "ex-daughter" must be unsayable      (parent_of/child_of are not terminable)
//   - "your boyfriend Alex", three weeks late (partner_of IS terminable, and a
//                                              renderer has to read valid_to)
//   - "Jesse's former job"                 (status and validity are two axes)
//
// Grants are checked here too, for the one property that matters most
// about them: nothing in the vocabulary weakens the safety floor.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Relationship } from "../../gen/ts/relationship.js";
import { Entity } from "../../gen/ts/entity.js";
import { relationshipTypes, grantActions } from "../../records/ts/validate.js";

const VOCAB_DIR = join(import.meta.dir, "..", "..", "vocab");

// The shapes and loaders come from records/ts/validate.ts rather than
// being redeclared here: a code review (2026-09-05) counted three copies
// of the vocabulary's type and a fourth of the entity `kind` enum, which
// go stale silently the moment a kind is added.
const vocabTypes = relationshipTypes();
const grantActionList = grantActions();
const statusIds = new Set(
  (
    JSON.parse(readFileSync(join(VOCAB_DIR, "relationship-types.json"), "utf-8")) as {
      statuses: { values: Array<{ id: string }> };
    }
  ).statuses.values.map((s) => s.id),
);
// Straight from the generated schema, so adding a kind cannot leave this
// list behind.
const ENTITY_KINDS = new Set(Entity.shape.kind.options as readonly string[]);
const byId = new Map(vocabTypes.map((t) => [t.id, t]));

describe("the relationship vocabulary is internally consistent", () => {
  test("every type's inverse exists and points back at it", () => {
    for (const t of vocabTypes) {
      const inverse = byId.get(t.inverse);
      expect(inverse, `${t.id}'s inverse ${t.inverse} is not in the vocabulary`).toBeDefined();
      expect(inverse!.inverse, `${t.id} and ${t.inverse} do not point at each other`).toBe(t.id);
    }
  });

  test("a symmetric type is its own inverse, and only symmetric types are", () => {
    for (const t of vocabTypes) {
      if (t.symmetric) expect(t.inverse, `${t.id} is symmetric but its inverse is ${t.inverse}`).toBe(t.id);
      else expect(t.inverse, `${t.id} is its own inverse but is not marked symmetric`).not.toBe(t.id);
    }
  });

  // An inverse that can end while its counterpart cannot would let the
  // same fact be both over and not over, depending which way you read it.
  test("a type and its inverse agree on whether they can end", () => {
    for (const t of vocabTypes) {
      expect(byId.get(t.inverse)!.terminable, `${t.id} and ${t.inverse} disagree on terminable`).toBe(t.terminable);
    }
  });

  test("an inverse joins the same kinds, the other way round", () => {
    for (const t of vocabTypes) {
      const inv = byId.get(t.inverse)!;
      expect(new Set(inv.from), `${t.inverse}.from should equal ${t.id}.to`).toEqual(new Set(t.to));
      expect(new Set(inv.to), `${t.inverse}.to should equal ${t.id}.from`).toEqual(new Set(t.from));
    }
  });

  test("every type joins real entity kinds and admits real statuses", () => {
    for (const t of vocabTypes) {
      for (const k of [...t.from, ...t.to]) expect(ENTITY_KINDS.has(k), `${t.id} names unknown kind ${k}`).toBe(true);
      expect(t.statuses.length, `${t.id} admits no statuses`).toBeGreaterThan(0);
      for (const s of t.statuses) expect(statusIds.has(s), `${t.id} admits unknown status ${s}`).toBe(true);
    }
  });

  // `estranged` means "broken off, while the relationship itself still
  // exists". On a type that can end, ending it is the honest record, and
  // offering both invites "ex-partner, estranged" - two ways to say one
  // thing, stored inconsistently.
  test("estranged is only offered where a relationship cannot end", () => {
    for (const t of vocabTypes) {
      if (t.statuses.includes("estranged")) {
        expect(t.terminable, `${t.id} admits estranged but can also end`).toBe(false);
      }
    }
  });
});

describe("the rules that keep a household graph honest", () => {
  test("family is permanent: an ex-daughter cannot be expressed", () => {
    for (const id of ["parent_of", "child_of", "sibling_of"]) {
      expect(byId.get(id)!.terminable, `${id} must not be terminable`).toBe(false);
    }
  });

  test("jobs, homes and partnerships all end", () => {
    for (const id of ["employed_by", "works_at", "lives_at", "partner_of", "attends"]) {
      expect(byId.get(id)!.terminable, `${id} must be terminable`).toBe(true);
    }
  });

  // The two-axis rule, as a shape rather than a comment: the same fixture
  // pair a renderer has to tell apart.
  test("a former job and an estranged daughter are different records", () => {
    const dir = join(import.meta.dir, "..", "..", "fixtures", "records");
    const job = Relationship.parse(JSON.parse(readFileSync(join(dir, "relationship.stated.example.json"), "utf-8")));
    const daughter = Relationship.parse(
      JSON.parse(readFileSync(join(dir, "relationship.estranged.example.json"), "utf-8")),
    );

    // Over: says so with valid_to, and needs no status to do it.
    expect(job.valid_to).not.toBeNull();
    expect(byId.get(job.type)!.terminable).toBe(true);

    // Still true, just not well: valid_to stays null.
    expect(daughter.valid_to).toBeNull();
    expect(daughter.status).toBe("estranged");
    expect(byId.get(daughter.type)!.terminable).toBe(false);
  });

  // A machine guess about someone's family must be traceable and must
  // not read as fact until a person says so.
  test("an inferred relationship carries its evidence and is unconfirmed", () => {
    const dir = join(import.meta.dir, "..", "..", "fixtures", "records");
    const guess = Relationship.parse(
      JSON.parse(readFileSync(join(dir, "relationship.inferred.example.json"), "utf-8")),
    );
    expect(guess.source).toBe("inferred");
    expect(guess.confidence).not.toBeNull();
    expect(guess.evidence.length).toBeGreaterThan(0);
    expect(guess.confirmed_by_person_id).toBeNull();
    // And it belongs to the person it came from, not the household: this
    // default is what stops the hub outing someone by joining two records.
    expect(guess.scope).toBe("person");
  });

  test("a stated relationship carries no confidence and names who said it", () => {
    const dir = join(import.meta.dir, "..", "..", "fixtures", "records");
    const stated = Relationship.parse(
      JSON.parse(readFileSync(join(dir, "relationship.stated.example.json"), "utf-8")),
    );
    expect(stated.confidence).toBeNull();
    expect(stated.stated_by_person_id).not.toBeNull();
  });
});

describe("the grant vocabulary", () => {
  test("action ids are unique", () => {
    const ids = grantActionList.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("parameterized actions are the ones that name a target", () => {
    for (const a of grantActionList) {
      expect(a.id.includes("<"), `${a.id} disagrees with its parameterized flag`).toBe(a.parameterized);
    }
  });

  // The org's Safety invariants: child-safety protections are
  // non-removable by any setting, flag or admin, including the
  // household's own owner. An action that claimed otherwise would be a
  // lie in a list a family is meant to be able to trust.
  test("nothing in the vocabulary can weaken the safety floor", () => {
    for (const a of grantActionList) {
      expect(a.id).not.toMatch(/bypass|disable.*(safety|filter)|safety.*(off|disable)/i);
    }
  });

  test("handing out authority is a separate power from editing profiles", () => {
    const ids = grantActionList.map((a) => a.id);
    expect(ids).toContain("people.manage");
    expect(ids).toContain("people.grant");
  });
});
