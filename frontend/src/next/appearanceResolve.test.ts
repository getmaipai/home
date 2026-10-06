import { describe, expect, test } from "bun:test";
import { isAppearance, resolveAppearance, resolveDark } from "@/next/appearanceResolve";
import { readDeviceAppearancePreference, writeDeviceAppearancePreference } from "@/next/deviceAppearancePreference";

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

describe("device appearance preference", () => {
  test("device override wins over the person's setting", () => {
    expect(resolveAppearance("system", "dark")).toBe("dark");
  });

  test("survives reload by reading it back from storage", () => {
    writeDeviceAppearancePreference("light");
    expect(readDeviceAppearancePreference()).toBe("light");
    writeDeviceAppearancePreference(null);
  });

  test("a fresh device has no override and reset clears it", () => {
    writeDeviceAppearancePreference(null);
    expect(readDeviceAppearancePreference()).toBeNull();
    writeDeviceAppearancePreference("dark");
    writeDeviceAppearancePreference(null);
    expect(readDeviceAppearancePreference()).toBeNull();
  });

  test("storage errors leave the person setting usable", () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", { configurable: true, get: () => { throw new Error("blocked"); } });
    try {
      expect(readDeviceAppearancePreference()).toBeNull();
      expect(resolveAppearance("light", readDeviceAppearancePreference())).toBe("light");
      expect(() => writeDeviceAppearancePreference("dark")).not.toThrow();
    } finally {
      if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
    }
  });
});
