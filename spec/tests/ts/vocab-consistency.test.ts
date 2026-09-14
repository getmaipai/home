// SPEC-01's three new plain-data vocabularies (entity-kind-nouns.json,
// life-events.json, defect-codes.json): not JSON Schema, so no generated
// model round-trips them, but untested vocab data is exactly the kind of
// thing that drifts silently, the same reasoning relationship-vocab.test.ts
// already applies to relationship-types.json.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Entity } from "../../gen/ts/entity.js";

const VOCAB_DIR = join(import.meta.dir, "..", "..", "vocab");
const load = <T>(name: string): T => JSON.parse(readFileSync(join(VOCAB_DIR, name), "utf-8")) as T;

interface EntityKindNouns {
  kinds: Array<{ kind: string; nouns: string[] }>;
}
interface LifeEvents {
  classes: Array<{ id: string; life_event: boolean; adult_to_tell: boolean; description: string }>;
}
interface DefectCodes {
  guard_reasons: Array<{ id: string; shipped: boolean; description: string }>;
  plan_violation_subkinds: Array<{ id: string; description: string }>;
  review_only: Array<{ id: string; description: string }>;
}

const ENTITY_KINDS = new Set(Entity.shape.kind.options as readonly string[]);

describe("vocab/entity-kind-nouns.json", () => {
  const vocab = load<EntityKindNouns>("entity-kind-nouns.json");

  test("every kind is a real entity kind", () => {
    for (const k of vocab.kinds) expect(ENTITY_KINDS.has(k.kind), `unknown kind ${k.kind}`).toBe(true);
  });

  test("every noun is lowercase, non-empty, and named exactly once", () => {
    const seen = new Set<string>();
    for (const k of vocab.kinds) {
      for (const noun of k.nouns) {
        expect(noun).toBe(noun.toLowerCase().trim());
        expect(noun.length).toBeGreaterThan(0);
        expect(seen.has(noun), `"${noun}" appears under more than one kind`).toBe(false);
        seen.add(noun);
      }
    }
  });
});

describe("vocab/life-events.json", () => {
  const vocab = load<LifeEvents>("life-events.json");

  test("every class id is unique and carries at least one flag", () => {
    const ids = new Set<string>();
    for (const c of vocab.classes) {
      expect(ids.has(c.id), `duplicate class id ${c.id}`).toBe(false);
      ids.add(c.id);
      expect(c.life_event || c.adult_to_tell, `${c.id} carries neither flag`).toBe(true);
      expect(c.description.length).toBeGreaterThan(0);
    }
  });

  // MEM-06/CRED-01's own claim about this file: it serves both readers.
  test("at least one class serves each reader", () => {
    expect(vocab.classes.some((c) => c.life_event)).toBe(true);
    expect(vocab.classes.some((c) => c.adult_to_tell)).toBe(true);
  });
});

describe("vocab/defect-codes.json", () => {
  const vocab = load<DefectCodes>("defect-codes.json");

  test("every id across the three lists is unique - a defect code is never ambiguous about which family it belongs to", () => {
    const all = [
      ...vocab.guard_reasons.map((g) => g.id),
      ...vocab.plan_violation_subkinds.map((p) => p.id),
      ...vocab.review_only.map((r) => r.id),
    ];
    expect(new Set(all).size).toBe(all.length);
  });

  test("the ten already-shipped guard reasons are marked shipped", () => {
    const shipped = new Set(vocab.guard_reasons.filter((g) => g.shipped).map((g) => g.id));
    for (const id of [
      "invention", "unrelated_recall", "near_echo", "medication_dose", "capability_claim",
      "unsupported_action", "like_i_said", "example_parrot", "claimed_experience", "placeholder_echo",
    ]) {
      expect(shipped.has(id), `${id} should be marked shipped`).toBe(true);
    }
  });

  test("REVIEW-01's five review-only codes are exactly the coherence review's own list", () => {
    const ids = vocab.review_only.map((r) => r.id).sort();
    expect(ids).toEqual(["act_mismatch", "emotion_mismatch", "missed_lookup", "unasked_unknown", "wrong_subject"].sort());
  });
});
