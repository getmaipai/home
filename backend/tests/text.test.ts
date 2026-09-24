import { describe, expect, test } from "bun:test";
import { tokenize, isBarePronoun } from "@/lib/text";

describe("tokenize()", () => {
  test("returns a lowercase word set with stopwords dropped", () => {
    expect(tokenize("The quick brown FOX")).toEqual(new Set(["quick", "brown", "fox"]));
  });

  test("drops one-letter words and keeps short meaningful ones", () => {
    expect(tokenize("a I we ox")).toEqual(new Set(["ox"]));
  });

  test("splits hyphenated words into pieces", () => {
    expect(tokenize("sun-set")).toEqual(new Set(["sun", "set"]));
  });

  test("splits on punctuation and keeps multi-digit tokens", () => {
    expect(tokenize("2026 update!")).toEqual(new Set(["2026", "update"]));
  });

  test("returns an empty set for stopword-only input", () => {
    expect(tokenize("the is of and to")).toEqual(new Set());
  });

  test("keeps apostrophe words together", () => {
    expect(tokenize("didn't it work?")).toEqual(new Set(["didn't", "work"]));
  });
});

// CONFIRM-01: moved here from turnMachine/nodes/policy.ts, one
// definition shared with nodes/model.ts's own offeredButInvalid check -
// policy.test.ts's own "a bare pronoun as the whole argument" tests
// exercise the identical behavior indirectly, through checkGrounding();
// this is the one place it's tested directly, by name.
describe("isBarePronoun()", () => {
  test("a lone pronoun word is a bare pronoun", () => {
    for (const word of ["he", "she", "it", "they", "him", "her", "them", "his", "hers", "their", "theirs", "its"]) {
      expect(isBarePronoun(word)).toBe(true);
    }
  });

  test("case and trailing punctuation don't matter", () => {
    expect(isBarePronoun("He")).toBe(true);
    expect(isBarePronoun("it?")).toBe(true);
    expect(isBarePronoun("It.")).toBe(true);
  });

  test("a pronoun alongside any other word is not bare", () => {
    expect(isBarePronoun("his show")).toBe(false);
    expect(isBarePronoun("president of chile")).toBe(false);
  });

  test("an empty or numbers-only value is not a bare pronoun (nothing to refuse on that ground)", () => {
    expect(isBarePronoun("")).toBe(false);
    expect(isBarePronoun("2026")).toBe(false);
  });
});
