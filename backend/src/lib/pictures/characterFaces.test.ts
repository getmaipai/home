import { describe, expect, test } from "bun:test";
import { CHARACTER_SCENES, characterFacesForBand, characterFacesPrompt, characterFaceFlowState, characterScenePrompt } from "./characterFaces";

describe("CREATOR-19 character picture helpers", () => {
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

  test("has twelve fixed scenes and uses the existing set cap", () => {
    expect(CHARACTER_SCENES).toHaveLength(12);
    expect(CHARACTER_SCENES.every((scene) => scene.length > 0)).toBe(true);
    expect(characterFaceFlowState()).toEqual({ prompt: "", count: "4", character_flow: "1" });
    expect(characterScenePrompt("Pip")).toContain("walking through a sunny garden");
    expect(characterScenePrompt("Pip")).toContain("planting flowers in a small garden");
  });

  test("Characters page declares both the make-face and make-scenes actions", async () => {
    const page = await Bun.file(new URL("../../../packages/image/pages/characters.json", import.meta.url)).json() as { body: Array<Record<string, any>> };
    const shelf = page.body[0]!;
    expect(shelf.row_actions?.map((action: { label: string }) => action.label)).toContain("Make pictures of them");
    expect(shelf.empty_state.action_label).toBe("Make a character");
    expect(shelf.empty_state.action.navigate.state).toMatchObject({ prompt: "Character: " });
  });
});

import { characterTraitsOf } from "./characterFaces";
describe("Make a character prefix", () => {
  test("a prompt starting with Character: gives the traits; others give null", () => {
    expect(characterTraitsOf("Character: a blue fox")).toBe("a blue fox");
    expect(characterTraitsOf("A blue fox")).toBeNull();
  });
});
