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
    expect(MEMORY_TRUST_REMINDER).toBe("Prefer these facts over guessing when they're relevant.");
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
