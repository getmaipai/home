import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { readRailCollapsePreference, writeRailCollapsePreference } from "@/shell/railCollapsePreference";

const KEY = "maipai.chat.rail-collapsed";

describe("railCollapsePreference", () => {
  beforeEach(() => localStorage.removeItem(KEY));
  afterEach(() => localStorage.removeItem(KEY));

  test("is null when nothing is stored", () => {
    expect(readRailCollapsePreference()).toBeNull();
  });
  test("round-trips true and false", () => {
    writeRailCollapsePreference(true);
    expect(localStorage.getItem(KEY)).toBe("1");
    expect(readRailCollapsePreference()).toBe(true);
    writeRailCollapsePreference(false);
    expect(localStorage.getItem(KEY)).toBe("0");
    expect(readRailCollapsePreference()).toBe(false);
  });
  test("an unrecognized stored value reads as null", () => {
    localStorage.setItem(KEY, "yes");
    expect(readRailCollapsePreference()).toBeNull();
  });
  test("blocked storage reads as null and writes do not throw", () => {
    const getSpy = spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const setSpy = spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    try {
      expect(readRailCollapsePreference()).toBeNull();
      expect(() => writeRailCollapsePreference(true)).not.toThrow();
    } finally {
      getSpy.mockRestore();
      setSpy.mockRestore();
    }
  });
});
