import { describe, expect, test } from "bun:test";
import { shouldRetake, keepBetter } from "@/lib/videos/frameCheck";

describe("automatic clip retakes", () => {
  test("the shared clip rule starts at most one retake and ties keep take two", () => {
    const serious = [{ code: "black", level: "serious", message: "Part of the clip is black. Make it again." }] as const;
    expect(shouldRetake({ findings: [...serious], isRetake: false })).toBe(true);
    expect(shouldRetake({ findings: [...serious], isRetake: true })).toBe(false);
    expect(keepBetter([], [])).toBe("second");
    expect(keepBetter([...serious], [])).toBe("second");
  });
});
