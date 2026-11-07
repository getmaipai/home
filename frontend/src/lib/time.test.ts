import { describe, expect, test } from "bun:test";
import { formatRelative } from "@/lib/time";

const now = new Date("2026-11-07T12:00:00Z");

describe("formatRelative", () => {
  test("formats a real time like the kit does", () => {
    expect(formatRelative("2026-11-07T11:30:00Z", now)).toBe("30m ago");
    expect(formatRelative("2026-11-06T11:59:00Z", now)).toBe("yesterday");
  });
  test("returns an empty string for a value that is not a date, never 'undefined NaN NaN'", () => {
    expect(formatRelative("What day is it", now)).toBe("");
    expect(formatRelative("", now)).toBe("");
    expect(formatRelative(null, now)).toBe("");
    expect(formatRelative(undefined, now)).toBe("");
  });
});
