/** CREATOR-19: fixed scenes for character pictures. CREATOR-16 currently supports sets of 2 to 8, so Create uses its existing cap. */
export const CHARACTER_SCENES = [
  "walking through a sunny garden", "reading beside a cozy window", "building a sandcastle at the beach", "exploring a forest path",
  "sharing a picnic under a tree", "painting at an art table", "watching clouds from a hill", "riding a bicycle down a quiet lane",
  "visiting a friendly market", "playing in fresh snow", "looking at stars from a campsite", "planting flowers in a small garden",
] as const;

/** The Make a character tile prefills this; a prompt that starts with it makes four face portraits of the traits after it. */
export const CHARACTER_PROMPT_PREFIX = "Character: ";
export function characterTraitsOf(prompt: string): string | null {
  return prompt.trimStart().toLowerCase().startsWith(CHARACTER_PROMPT_PREFIX.trim().toLowerCase()) ? prompt.trimStart().slice(CHARACTER_PROMPT_PREFIX.trim().length).trim() : null;
}

/** Make the requested trait words produce four comparable face choices. */
export function characterFacesPrompt(traits: string): string {
  return `Create a head-and-shoulders portrait of ${traits.trim() || "the described character"}, centered, facing forward, on a plain simple background. Keep the same character design across four portrait takes.`;
}

export function characterScenePrompt(name: string): string {
  return `${name.trim() || "this character"}: ${CHARACTER_SCENES.join("; ")}`;
}

/** Keeps minor-generated character art inside the existing child rule: only a cartoon of their own character. */
export function characterFacesForBand(traits: string, band: "adult" | "teen" | "child"): string {
  const portrait = characterFacesPrompt(traits);
  return band === "adult" ? portrait : `${portrait} Make it a cartoon of your own character.`;
}

export function characterFaceFlowState(traits = ""): { prompt: string; count: string; character_flow: string } {
  return { prompt: traits, count: "4", character_flow: "1" };
}
