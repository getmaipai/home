import { describe, expect, test } from "bun:test";
import { nextSentenceBoundary, splitReadyChunks } from "@/lib/sentenceChunker";

describe("nextSentenceBoundary", () => {
  test("finds a whole sentence terminator", () => {
    const text = "Dogs are great pets. They also need walks.";
    const end = nextSentenceBoundary(text);
    expect(text.slice(0, end)).toBe("Dogs are great pets.");
  });

  test("returns -1 when no boundary exists yet", () => {
    expect(nextSentenceBoundary("Dogs are great")).toBe(-1);
  });

  test("does not treat a single newline as a boundary", () => {
    expect(nextSentenceBoundary("Dogs are great\npets are too")).toBe(-1);
  });

  test("a paragraph break with no terminal punctuation is still a real boundary", () => {
    // No period before the break, so the sentence-terminator alternative
    // can't fire - only the \n{2,} alternative can.
    const text = "First paragraph\n\nSecond paragraph.";
    const end = nextSentenceBoundary(text);
    expect(text.slice(0, end)).toBe("First paragraph\n\n");
  });

  test("an abbreviation like Dr. does not falsely fire (uppercase/digit lookahead)", () => {
    // "Dr." is followed by a lowercase word, not the start of a new
    // sentence, so this must NOT fire on the abbreviation's own period.
    const text = "Dr. smith arrives tomorrow.";
    const end = nextSentenceBoundary(text);
    expect(text.slice(0, end)).toBe("Dr. smith arrives tomorrow.");
  });

  test("a short run-on sentence with no terminator in sight is never clause-split", () => {
    // Under CLAUSE_FLUSH_MIN/the clause gate - must wait for a real
    // terminator rather than chopping at the first comma ("Oh no,").
    expect(nextSentenceBoundary("Oh no, that's concerning")).toBe(-1);
  });

  test("a long run-on sentence flushes at the last in-range clause boundary", () => {
    const text =
      "This is a genuinely long opening clause that keeps going and going, and then continues even further before finally reaching a natural pause point, and the sentence still has not ended yet";
    const end = nextSentenceBoundary(text, true);
    expect(end).toBeGreaterThan(0);
    expect(text[end - 1]).toBe(","); // the match is the punctuation itself, not the space after it
  });
});

describe("splitReadyChunks", () => {
  test("splits every complete sentence, leaving an incomplete trailing fragment unconsumed", () => {
    const text = "Dogs are great pets. They need walks. And they lov";
    const { chunks, consumed } = splitReadyChunks(text, true);
    expect(chunks).toEqual(["Dogs are great pets.", "They need walks."]);
    expect(text.slice(consumed)).toBe(" And they lov");
  });

  test("returns nothing consumed when the text has no boundary yet", () => {
    const { chunks, consumed } = splitReadyChunks("Dogs are great", true);
    expect(chunks).toEqual([]);
    expect(consumed).toBe(0);
  });

  test("a second call picks up exactly where the first left off", () => {
    const first = splitReadyChunks("Dogs are great pets. They need wa", true);
    expect(first.chunks).toEqual(["Dogs are great pets."]);

    const remainder = "They need wa".slice(0); // simulate the caller's own remainder tracking
    const grown = remainder + "lks daily. Cats are independent.";
    const second = splitReadyChunks(grown, false);
    expect(second.chunks).toEqual(["They need walks daily.", "Cats are independent."]);
  });
});
