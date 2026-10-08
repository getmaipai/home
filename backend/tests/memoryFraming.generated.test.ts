import { describe, expect, test } from "bun:test";
import { MEMORY_SECTION_HEADER, MEMORY_TRUST_REMINDER, NOTHING_STORED_LINE } from "@/lib/memoryFraming";

describe("memoryFraming", () => {
  test("uses the household memory heading and trust reminder in the prompt", () => {
    expect(MEMORY_SECTION_HEADER).toBe("What you already know about this household:");
    expect(MEMORY_TRUST_REMINDER).toBe("Prefer these facts over guessing when they're relevant.");
  });

  test("says plainly when no stored fact bears on the message", () => {
    expect(NOTHING_STORED_LINE).toBe("Nothing stored here bears on this message.");
  });
});
