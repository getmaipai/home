import { describe, expect, test } from "bun:test";
import { characterFacesForBand, characterFacesPrompt } from "./characterFaces";

describe("character face words", () => {
  test("wraps traits as four comparable head-and-shoulders portraits", () => {
    const prompt = characterFacesPrompt("a blue fox with round glasses");
    expect(prompt).toContain("head-and-shoulders portrait");
    expect(prompt).toContain("plain simple background");
    expect(prompt).toContain("four portrait takes");
    expect(prompt).toContain("a blue fox with round glasses");
  });

  test("keeps the existing minor cartoon-of-own-character rule", () => {
    expect(characterFacesForBand("my dragon", "child")).toContain("cartoon of your own character");
    expect(characterFacesForBand("my dragon", "teen")).toContain("cartoon of your own character");
    expect(characterFacesForBand("my dragon", "adult")).not.toContain("cartoon of your own character");
  });

  test("the old Character: prefix start is gone from Image Create: such a prompt is an ordinary picture prompt", async () => {
    const make = await Bun.file(new URL("./make.ts", import.meta.url)).text();
    expect(make).not.toContain("characterTraitsOf");
  });
});
