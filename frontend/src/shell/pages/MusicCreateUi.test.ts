import { describe, expect, test } from "bun:test";
import { coverVars, seedOf } from "./MusicCreateUi";

describe("generated covers", () => {
  test("the same id always gives the same cover", () => {
    expect(coverVars("song-1")).toEqual(coverVars("song-1"));
    expect(seedOf("song-1")).toBe(seedOf("song-1"));
  });
  test("different ids give different covers and only kit hues", () => {
    expect(coverVars("song-1")).not.toEqual(coverVars("song-2"));
    for (const key of ["--c1", "--c2", "--c3"]) expect(coverVars("song-3")[key]).toMatch(/^var\(--hue-/);
  });
});
