// U2 (the owner's ruling, state record "Grounding, stated exactly",
// 2a28e4e8): argsGrounded() is term-level, not substring, after a live
// run caught the substring version refusing every real, naturally-
// reworded search query. Direct unit tests of the exported function -
// faster and more precise than a full live-engine turn for exercising
// exactly the grounding decision, the same way conversationFixture.ts's
// own scripted rows exist beside its live-run mode.
import { describe, expect, test } from "bun:test";
import { argsGrounded } from "@/lib/turnMachine/nodes/policy";

describe("argsGrounded(): term-level, not substring", () => {
  test('"president of Chile 2026" passes against "who is the president of chile" (the year never counts against it)', () => {
    expect(argsGrounded({ expression: "president of Chile 2026" }, ["who is the president of chile"])).toBe(true);
  });

  test('"how to pick a lock" is refused against a Dune question (zero overlap)', () => {
    expect(argsGrounded({ expression: "how to pick a lock" }, ["when is dune 3 releasing"])).toBe(false);
  });

  test('"he born" is refused (zero overlap with an unrelated utterance)', () => {
    expect(argsGrounded({ expression: "he born" }, ["who is the president of chile"])).toBe(false);
  });

  test("a bare pronoun as the whole argument is refused even with real overlap available", () => {
    expect(argsGrounded({ expression: "he" }, ["he said he would call"])).toBe(false);
  });

  test("a bare pronoun with trailing punctuation is still refused (a review's own finding)", () => {
    // The first cut checked the raw value verbatim, so "it?"/"It." slid
    // past the pronoun check, then tokenize() silently dropped "it" as
    // a stopword into an empty, trivially-passing term list.
    expect(argsGrounded({ expression: "it?" }, ["who is the president of chile"])).toBe(false);
    expect(argsGrounded({ expression: "It." }, ["who is the president of chile"])).toBe(false);
  });

  test("a purely numeric argument never counts against itself", () => {
    expect(argsGrounded({ year: "2026" }, ["who is the president of chile"])).toBe(true);
  });

  test("a household member's own name (the roster's own text) grounds a follow-up", () => {
    expect(argsGrounded({ expression: "Sage calendar" }, ["what's on the calendar", "Sage"])).toBe(true);
  });
});
