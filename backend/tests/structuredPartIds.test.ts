import { describe, expect, test } from "bun:test";
import { SPEC_SHEET_READY, SPEC_SHEET_BOUND } from "@/lib/structuredPartIds";

const readyIds: ReadonlySet<string> = SPEC_SHEET_READY;
const boundIds: ReadonlySet<string> = SPEC_SHEET_BOUND;

describe("SPEC_SHEET_READY", () => {
  test("contains exactly the expected spec-sheet ready tool ids", () => {
    expect(SPEC_SHEET_READY).toBeInstanceOf(Set);
    expect(SPEC_SHEET_READY.has("almanac-time")).toBe(true);
    expect(SPEC_SHEET_READY.has("almanac-moon")).toBe(true);
    expect(SPEC_SHEET_READY.has("almanac-holiday")).toBe(true);
    expect(SPEC_SHEET_READY.has("almanac-onthisday")).toBe(true);
    expect(SPEC_SHEET_READY.has("media-lookup")).toBe(true);
    expect(SPEC_SHEET_READY.has("music")).toBe(true);
    expect(SPEC_SHEET_READY.has("currency")).toBe(true);
    expect(SPEC_SHEET_READY.has("convert")).toBe(true);
    expect(SPEC_SHEET_READY.has("define")).toBe(true);
    expect(SPEC_SHEET_READY.has("math")).toBe(true);
  });

  test("does not contain non-ready tool ids", () => {
    expect(readyIds.has("weather")).toBe(false);
    expect(readyIds.has("almanac-date")).toBe(false);
    expect(readyIds.has("unknown-tool")).toBe(false);
    expect(readyIds.has("")).toBe(false);
  });
});

describe("SPEC_SHEET_BOUND", () => {
  test("contains all of SPEC_SHEET_READY", () => {
    for (const id of SPEC_SHEET_READY) {
      expect(boundIds.has(id)).toBe(true);
    }
  });

  test("also contains weather and almanac-date", () => {
    expect(boundIds.has("weather")).toBe(true);
    expect(boundIds.has("almanac-date")).toBe(true);
  });

  test("does not contain tool ids that are not ready or explicitly bound", () => {
    expect(boundIds.has("unknown-tool")).toBe(false);
    expect(boundIds.has("")).toBe(false);
  });
});
