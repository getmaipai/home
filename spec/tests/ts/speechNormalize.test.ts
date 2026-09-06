// normalizeForSpeech (spec/voice/ts/normalizeForSpeech.ts): the mechanical
// half of the voice sidecar's speech normalization. Every case here checks
// the SPOKEN form only - callers keep the original text for display
// untouched (Jesse, 2026-09-04: "if you have the voice say ten O four, you
// still display 10:04" - this file never asserts anything about display
// text because this module never produces any).
//
// Session C step 6: the full-pipeline cases below are loaded from
// spec/voice/fixtures/normalize-for-speech.json rather than hardcoded here,
// so the SAME cases also drive spec/tests/py/test_speech_normalize.py
// against the Python twin - "one fixture set both must pass" (the plan's
// own words), not two hand-maintained lists that can silently drift apart.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeForSpeech, numberToWords, lintSpeechTemplate } from "../../voice/ts/normalizeForSpeech.js";

interface Fixture {
  input: string;
  expected: string;
  note?: string;
}

const fixtures: Fixture[] = JSON.parse(readFileSync(join(import.meta.dir, "..", "..", "voice", "fixtures", "normalize-for-speech.json"), "utf-8"));

describe("numberToWords", () => {
  test("zero and small numbers", () => {
    expect(numberToWords(0)).toBe("zero");
    expect(numberToWords(5)).toBe("five");
    expect(numberToWords(19)).toBe("nineteen");
  });
  test("tens and compound tens", () => {
    expect(numberToWords(20)).toBe("twenty");
    expect(numberToWords(21)).toBe("twenty-one");
    expect(numberToWords(99)).toBe("ninety-nine");
  });
  test("hundreds", () => {
    expect(numberToWords(100)).toBe("one hundred");
    expect(numberToWords(234)).toBe("two hundred thirty-four");
    expect(numberToWords(905)).toBe("nine hundred five");
  });
  test("thousands and millions compose with the smaller scales", () => {
    expect(numberToWords(1000)).toBe("one thousand");
    expect(numberToWords(1234)).toBe("one thousand two hundred thirty-four");
    expect(numberToWords(2_500_000)).toBe("two million five hundred thousand");
  });
  test("negative numbers", () => {
    expect(numberToWords(-42)).toBe("negative forty-two");
  });
  test("a number whose final chunk has no hundreds digit, cross-checked against the Python twin's own regression case", () => {
    // A code review (2026-09-06) found the Python twin's num2words
    // inserted a stray "and" for exactly this shape (1021, 100021,
    // 1000021) that to-words never produces - kept here too so a future
    // change to either adapter has a matching case on both sides.
    expect(numberToWords(1021)).toBe("one thousand twenty-one");
    expect(numberToWords(100021)).toBe("one hundred thousand twenty-one");
    expect(numberToWords(1000021)).toBe("one million twenty-one");
  });
});

describe("normalizeForSpeech: the shared fixture set", () => {
  for (const { input, expected, note } of fixtures) {
    test(note ? `${JSON.stringify(input)}: ${note}` : JSON.stringify(input), () => {
      expect(normalizeForSpeech(input)).toBe(expected);
    });
  }
});

describe("lintSpeechTemplate", () => {
  test("a template already in spoken form has nothing to flag", () => {
    expect(lintSpeechTemplate("Got it, I'll remember that.")).toEqual([]);
    expect(lintSpeechTemplate("{summary}")).toEqual([]);
    expect(lintSpeechTemplate("It's {temp} degrees in {place_name} right now.")).toEqual([]);
  });
  test("an author's own harmless whitespace (never audible either way) doesn't lint", () => {
    // "{question} ... The answer" - the same real shape a recipe.json's
    // own speech field used before this exact false positive was found
    // and fixed: normalizeForSpeech()'s own whitespace tidy-up removes
    // the space before the ellipsis, a purely cosmetic difference no TTS
    // engine would ever voice differently either way.
    expect(lintSpeechTemplate("{question} ... The answer: {answer}.")).toEqual([]);
  });
  test("a static, un-normalized number or currency amount is flagged", () => {
    expect(lintSpeechTemplate("It costs $5.")).toHaveLength(1);
  });
  test("static markdown baked into the template is flagged", () => {
    expect(lintSpeechTemplate("This is **great**!")).toHaveLength(1);
  });
  test("a placeholder alone is never flagged, regardless of its name", () => {
    expect(lintSpeechTemplate("{word}: {definition}")).toEqual([]);
  });
});

describe("normalizeForSpeech: never touches the caller's own text", () => {
  test("is a pure function - the same input always normalizes the same way", () => {
    const input = "It's 10:04 and 25% chance of rain, $5.50.";
    expect(normalizeForSpeech(input)).toBe(normalizeForSpeech(input));
    // And the input string itself is never mutated - this is the whole
    // point of keeping normalizeForSpeech's output out of reply.text.
    expect(input).toBe("It's 10:04 and 25% chance of rain, $5.50.");
  });
});
