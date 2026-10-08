import { describe, expect, test } from "bun:test";
import { NAV_ENTRIES } from "@/shell/nav";

describe("NAV_ENTRIES", () => {
  test("keeps Home, Chat and Family as the first three entries", () => {
    expect(NAV_ENTRIES.slice(0, 3).map((entry) => [entry.label, entry.to])).toEqual([
      ["Home", "/"],
      ["Chat", "/chat"],
      ["Family", "/people"],
    ]);
  });
  test("lists Privacy and Settings after them", () => {
    expect(NAV_ENTRIES.slice(3).map((entry) => entry.to)).toEqual(["/privacy", "/settings"]);
  });
  test("every entry has a unique absolute path, a label and an icon", () => {
    const paths = NAV_ENTRIES.map((entry) => entry.to);
    expect(new Set(paths).size).toBe(paths.length);
    for (const entry of NAV_ENTRIES) {
      expect(entry.to.startsWith("/")).toBe(true);
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.icon.length).toBeGreaterThan(0);
    }
  });
});
