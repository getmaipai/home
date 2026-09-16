import { describe, expect, test } from "bun:test";
import { tokenize } from "@/lib/text";

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
