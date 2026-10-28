import { describe, expect, test } from "bun:test";
import {
  MEMORY_SECTION_HEADER,
  MEMORY_TRUST_REMINDER,
  NOTHING_STORED_LINE,
} from "@/lib/memoryFraming";

describe("memoryFraming", () => {
  test("header names what the model already knows", () => {
    expect(MEMORY_SECTION_HEADER).toBe("What you already know about this household:");
  });

  test("trust reminder tells the model to prefer stored facts", () => {
    expect(MEMORY_TRUST_REMINDER).toBe("Use a fact only when it changes or completes your answer; never bring up a person, pet or detail from it just because you know it.");
  });

  test("nothing-stored line is the exact fixed sentence", () => {
    expect(NOTHING_STORED_LINE).toBe("Nothing stored here bears on this message.");
  });

  test("all three lines are distinct, non-empty and single-line", () => {
    const lengths = [MEMORY_SECTION_HEADER.length, MEMORY_TRUST_REMINDER.length, NOTHING_STORED_LINE.length];
    const hasNewlines = [MEMORY_SECTION_HEADER.includes("\n"), MEMORY_TRUST_REMINDER.includes("\n"), NOTHING_STORED_LINE.includes("\n")];
    const set = new Set([MEMORY_SECTION_HEADER, MEMORY_TRUST_REMINDER, NOTHING_STORED_LINE]);

    expect(lengths.every(l => l > 0)).toBe(true);
    expect(hasNewlines.every(n => n === false)).toBe(true);
    expect(set.size).toBe(3);
  });
});

describe("memory is background, not a topic (weather turn regression)", () => {
  test("the trust line says to use a fact only when it changes the answer and never to volunteer a person", () => {
    expect(MEMORY_TRUST_REMINDER).toContain("only when it changes or completes your answer");
    expect(MEMORY_TRUST_REMINDER).toContain("never bring up a person, pet or detail");
    expect(MEMORY_TRUST_REMINDER).not.toContain("Prefer these facts");
  });
});
