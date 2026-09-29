import { describe, expect, test } from "bun:test";
import { isAppearance, resolveDark } from "@/next/appearanceResolve";

describe("isAppearance", () => {
  test.each([
    ["light", true],
    ["dark", true],
    ["system", true],
    ["neutral", false],
    [undefined, false],
    [42, false],
  ] as const)("isAppearance(%p) -> %p", (value, expected) => {
    expect(isAppearance(value)).toBe(expected);
  });
});

describe("resolveDark", () => {
  test("an explicit light/dark choice always wins, regardless of the OS", () => {
    expect(resolveDark("dark", false)).toBe(true);
    expect(resolveDark("dark", true)).toBe(true);
    expect(resolveDark("light", false)).toBe(false);
    expect(resolveDark("light", true)).toBe(false);
  });

  test("\"system\" follows the OS media query", () => {
    expect(resolveDark("system", true)).toBe(true);
    expect(resolveDark("system", false)).toBe(false);
  });
});
