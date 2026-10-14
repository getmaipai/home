import { describe, expect, test } from "bun:test";
import { CHECK_FIXTURES, CHECK_ROW_IDS } from "./checksFixtures";

describe("setup checks screen fixtures", () => {
  test("each ordered row has green, amber and red state coverage", () => {
    for (const state of ["green", "amber", "red"] as const) {
      expect(CHECK_FIXTURES[state].map((row) => row.id)).toEqual([...CHECK_ROW_IDS]);
      expect(CHECK_FIXTURES[state].every((row) => row.state === state)).toBe(true);
    }
  });
});
