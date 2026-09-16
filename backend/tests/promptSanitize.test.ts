import { describe, expect, test } from "bun:test";
import { sanitizeForPrompt } from "@/lib/promptSanitize";

describe("sanitizeForPrompt()", () => {
  test("replaces braces, newlines, and carriage returns with spaces", () => {
    expect(sanitizeForPrompt("a\nb\rc")).toBe("a b c");
  });

  test("trims surrounding whitespace after collapsing", () => {
    expect(sanitizeForPrompt("  \n{ name }  ")).toBe("name");
  });

  test("leaves ordinary text untouched", () => {
    expect(sanitizeForPrompt("Bramble is here")).toBe("Bramble is here");
  });

  test("empties a string of only control characters", () => {
    expect(sanitizeForPrompt("\r\n{}")).toBe("");
  });
});
