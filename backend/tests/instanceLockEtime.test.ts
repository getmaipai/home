import { describe, expect, test } from "bun:test";
import { parseEtime } from "@/lib/instanceLock";

describe("parseEtime", () => {
  test("parses minutes and seconds", () => {
    expect(parseEtime("05:30")).toBe(330);
    expect(parseEtime("00:00")).toBe(0);
  });
  test("parses hours", () => {
    expect(parseEtime("1:05:30")).toBe(3930);
  });
  test("parses days", () => {
    expect(parseEtime("2-03:04:05")).toBe(183845);
  });
  test("trims surrounding whitespace", () => {
    expect(parseEtime("  12:00 ")).toBe(720);
  });
  test("returns null for text that is not an etime", () => {
    expect(parseEtime("")).toBeNull();
    expect(parseEtime("5")).toBeNull();
    expect(parseEtime("abc")).toBeNull();
    expect(parseEtime("1:2:3:4")).toBeNull();
  });
});
