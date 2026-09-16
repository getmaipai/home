import { describe, expect, test } from "bun:test";
import { AFFIRMATIVE_RE, NEGATIVE_RE, SHORT_ANSWERS } from "@/lib/consentVocab";

describe("AFFIRMATIVE_RE", () => {
  test("accepts a bare yes", () => {
    expect(AFFIRMATIVE_RE.test("yes")).toBe(true);
  });

  test("accepts repeated consent words with courtesy", () => {
    expect(AFFIRMATIVE_RE.test("yeah, sure, thank you!")).toBe(true);
  });

  test("accepts go ahead with terminal punctuation", () => {
    expect(AFFIRMATIVE_RE.test("Go ahead.")).toBe(true);
  });
});

describe("NEGATIVE_RE", () => {
  test("matches a leading no", () => {
    expect(NEGATIVE_RE.test("no thanks")).toBe(true);
  });

  test("matches stop mid-sentence", () => {
    expect(NEGATIVE_RE.test("Stop doing that")).toBe(true);
  });

  test("does not match an affirmative reply", () => {
    expect(NEGATIVE_RE.test("Yes, do it")).toBe(false);
  });
});

describe("SHORT_ANSWERS", () => {
  test("contains the consent and negative words", () => {
    expect(SHORT_ANSWERS.has("yes")).toBe(true);
    expect(SHORT_ANSWERS.has("nope")).toBe(true);
  });

  test("contains the closers a reply is made of", () => {
    expect(SHORT_ANSWERS.has("done")).toBe(true);
    expect(SHORT_ANSWERS.has("thanks")).toBe(true);
    expect(SHORT_ANSWERS.has("goodnight")).toBe(true);
  });
});
