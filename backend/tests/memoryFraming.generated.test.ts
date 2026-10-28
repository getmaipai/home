import { describe, expect, test } from "bun:test";
import { MEMORY_SECTION_HEADER, MEMORY_TRUST_REMINDER, NOTHING_STORED_LINE } from "@/lib/memoryFraming";

describe("memoryFraming", () => {
  test("uses the household memory heading and trust reminder in the prompt", () => {
    expect(MEMORY_SECTION_HEADER).toBe("What you already know about this household:");
    expect(MEMORY_TRUST_REMINDER).toBe("Use a fact only when it changes or completes your answer; never bring up a person, pet or detail from it just because you know it.");
  });

  test("says plainly when no stored fact bears on the message", () => {
    expect(NOTHING_STORED_LINE).toBe("Nothing stored here bears on this message.");
  });
});
