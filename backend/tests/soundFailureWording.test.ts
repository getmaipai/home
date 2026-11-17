import { describe, expect, test } from "bun:test";
import { plainSoundFailure, soundWording } from "../src/lib/music/jobs";

describe("a failed sound never says song", () => {
  test("memory and storage failures use the sound word", () => {
    for (const code of ["no_memory", "storage_full"]) expect(plainSoundFailure(code)).not.toMatch(/\bsongs?\b/);
    expect(plainSoundFailure("no_memory")).toContain("I couldn't make that sound.");
  });
  test("soundWording swaps the word and leaves other text", () => {
    expect(soundWording("You already have a song being made.")).toBe("You already have a sound being made.");
    expect(soundWording("Ask for shorter songs")).toBe("Ask for shorter sounds");
  });
});
