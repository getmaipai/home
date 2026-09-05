import { describe, expect, test } from "bun:test";
import {
  pickVariant,
  pickRefusalVariant,
  varyKnownConstant,
  REFUSAL_FIRST,
  REFUSAL_REPEAT,
  REMEMBER_CONFIRM_VARIANTS,
  RECALL_NOTHING_VARIANTS,
} from "@/lib/replyVariation";

describe("pickVariant", () => {
  test("never repeats the immediately previous pick for the same person and key", () => {
    const personId = crypto.randomUUID();
    const pool = ["a", "b", "c"] as const;
    let previous = pickVariant(personId, "test-key", pool);
    for (let i = 0; i < 20; i++) {
      const next = pickVariant(personId, "test-key", pool);
      expect(next).not.toBe(previous);
      previous = next;
    }
  });

  test("a different pool key for the same person rotates independently", () => {
    const personId = crypto.randomUUID();
    const poolA: readonly string[] = ["a1", "a2"];
    const poolB: readonly string[] = ["b1", "b2"];
    const firstA = pickVariant(personId, "pool-a", poolA);
    const firstB = pickVariant(personId, "pool-b", poolB);
    expect(poolA).toContain(firstA);
    expect(poolB).toContain(firstB);
  });
});

describe("pickRefusalVariant", () => {
  test("the first refusal for a person never uses repeat-acknowledging language", () => {
    const personId = crypto.randomUUID();
    expect(REFUSAL_FIRST).toContain(pickRefusalVariant(personId));
  });

  test("every refusal after the first switches to the repeat pool", () => {
    const personId = crypto.randomUUID();
    pickRefusalVariant(personId); // the first
    for (let i = 0; i < 5; i++) {
      expect(REFUSAL_REPEAT).toContain(pickRefusalVariant(personId));
    }
  });

  test("consecutive refusals for the same person never repeat the exact same sentence", () => {
    const personId = crypto.randomUUID();
    let previous = pickRefusalVariant(personId);
    for (let i = 0; i < 10; i++) {
      const next = pickRefusalVariant(personId);
      expect(next).not.toBe(previous);
      previous = next;
    }
  });
});

describe("varyKnownConstant", () => {
  test("a known constant reply gets varied", () => {
    const personId = crypto.randomUUID();
    expect(REMEMBER_CONFIRM_VARIANTS).toContain(varyKnownConstant(personId, "Got it, I'll remember that."));
    expect(RECALL_NOTHING_VARIANTS).toContain(varyKnownConstant(personId, "I don't remember anything about that."));
  });

  test("real dynamic content that happens to not be a known constant passes through completely unchanged", () => {
    const personId = crypto.randomUUID();
    const dynamic = "the wifi password is on the fridge";
    expect(varyKnownConstant(personId, dynamic)).toBe(dynamic);
  });

  test("two different known constants for the same person rotate independently", () => {
    const personId = crypto.randomUUID();
    const rememberPick = varyKnownConstant(personId, "Got it, I'll remember that.");
    const recallPick = varyKnownConstant(personId, "I don't remember anything about that.");
    expect(REMEMBER_CONFIRM_VARIANTS).toContain(rememberPick);
    expect(RECALL_NOTHING_VARIANTS).toContain(recallPick);
  });
});
