import { describe, expect, test } from "bun:test";
import { CHECK_FIXTURES, CHECK_ROW_IDS } from "./checksFixtures";

describe("setup checks screen fixtures", () => {
  test("seed scenarios cover all-green, one amber and one red", () => {
    expect(CHECK_FIXTURES.green.every((row) => row.state === "green")).toBe(true);
    expect(CHECK_FIXTURES.amber.filter((row) => row.state === "amber")).toHaveLength(1);
    expect(CHECK_FIXTURES.red.filter((row) => row.state === "red")).toHaveLength(1);
    for (const state of ["green", "amber", "red"] as const) {
      expect(CHECK_FIXTURES[state].map((row) => row.id)).toEqual([...CHECK_ROW_IDS]);
    }
  });
});
