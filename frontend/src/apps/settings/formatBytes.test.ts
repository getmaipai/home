import { describe, expect, test } from "bun:test";
import { formatBytes } from "@/apps/settings/formatBytes";

describe("formatBytes", () => {
  test("bytes under 1024 show as bytes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
  });

  test("kilobytes, with one decimal place under 10", () => {
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
  });

  test("rounds to a whole number at 10 or more", () => {
    expect(formatBytes(15 * 1024)).toBe("15 KB");
  });

  test("megabytes and gigabytes", () => {
    expect(formatBytes(5 * 1024 * 1024)).toBe("5 MB");
    expect(formatBytes(2 * 1024 * 1024 * 1024)).toBe("2 GB");
  });

  test("caps at the largest unit rather than inventing a bigger one", () => {
    expect(formatBytes(3 * 1024 * 1024 * 1024 * 1024)).toBe("3 TB");
  });

  // Real bug, code review 2026-09-04: rounding happened before checking
  // whether the rounded value crosses into the next unit, so a size one
  // byte under a power-of-1024 boundary displayed in the wrong unit
  // ("1024 KB" instead of "1 MB").
  test("a value that rounds up to 1024 promotes to the next unit", () => {
    expect(formatBytes(1024 * 1024 - 1)).toBe("1 MB");
    expect(formatBytes(1024 * 1024 * 1024 - 1)).toBe("1 GB");
  });
});
