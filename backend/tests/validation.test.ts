import { describe, expect, test } from "bun:test";
import { validateDisplayName, validateSecret } from "@/lib/validation";

describe("validateDisplayName()", () => {
  test("trims and accepts a normal name", () => {
    expect(validateDisplayName("  Sage ")).toEqual({ ok: true, value: "Sage" });
  });

  test("rejects an empty or whitespace-only name", () => {
    expect(validateDisplayName("   ").ok).toBe(false);
  });

  test("rejects a name over 80 characters", () => {
    expect(validateDisplayName("x".repeat(81)).ok).toBe(false);
  });

  test("rejects a value that is not a string", () => {
    expect(validateDisplayName(42).ok).toBe(false);
  });
});

describe("validateSecret()", () => {
  test("accepts a 4-character secret", () => {
    expect(validateSecret("abcd")).toEqual({ ok: true, value: "abcd" });
  });

  test("rejects a 3-character secret", () => {
    expect(validateSecret("abc").ok).toBe(false);
  });

  test("rejects a secret over 128 characters", () => {
    expect(validateSecret("x".repeat(129)).ok).toBe(false);
  });

  test("rejects a non-string secret", () => {
    expect(validateSecret(null).ok).toBe(false);
  });
});
