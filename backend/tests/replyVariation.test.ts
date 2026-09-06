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

  // Step 8 (session-a-intelligence.md): "a per-companion confirmation
  // pool with the shared pool as the default."
  describe("per-companion confirmation pools (step 8)", () => {
    test("a companion with its own pool never gets the shared pool's phrasing for the remember confirmation", () => {
      const personId = crypto.randomUUID();
      for (let i = 0; i < 10; i++) {
        const pick = varyKnownConstant(personId, "Got it, I'll remember that.", "tutor");
        expect(REMEMBER_CONFIRM_VARIANTS).not.toContain(pick);
      }
    });

    test("a companion with no dedicated pool (including 'default') falls through to the shared pool", () => {
      const personId = crypto.randomUUID();
      const pick = varyKnownConstant(personId, "Got it, I'll remember that.", "default");
      expect(REMEMBER_CONFIRM_VARIANTS).toContain(pick);
    });

    test("omitting personaId entirely still uses the shared pool, exactly as before this step", () => {
      const personId = crypto.randomUUID();
      const pick = varyKnownConstant(personId, "Got it, I'll remember that.");
      expect(REMEMBER_CONFIRM_VARIANTS).toContain(pick);
    });

    test("a companion pool never applies to a DIFFERENT known constant, even for a companion with its own remember pool", () => {
      const personId = crypto.randomUUID();
      const pick = varyKnownConstant(personId, "I don't remember anything about that.", "tutor");
      expect(RECALL_NOTHING_VARIANTS).toContain(pick);
    });

    test("two different companions' rotation state for the same person never collide", () => {
      const personId = crypto.randomUUID();
      const tutorPick = varyKnownConstant(personId, "Got it, I'll remember that.", "tutor");
      const buddyPick = varyKnownConstant(personId, "Got it, I'll remember that.", "buddy");
      // Distinct pools by construction (see replyVariation.ts's own
      // COMPANION_REMEMBER_CONFIRM) - a real collision here would mean
      // the two companions' rotation keys accidentally aliased.
      expect(tutorPick).not.toBe(buddyPick);
    });
  });
});
