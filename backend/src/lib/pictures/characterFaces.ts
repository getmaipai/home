/** ELEMENTS-HOME-03: the words for a character's four comparable face pictures (the Elements app's Make an element, from words). */

/** Make the requested trait words produce four comparable face choices. */
export function characterFacesPrompt(traits: string): string {
  return `Create a head-and-shoulders portrait of ${traits.trim() || "the described character"}, centered, facing forward, on a plain simple background. Keep the same character design across four portrait takes.`;
}

/** Keeps minor-generated character art inside the existing child rule: only a cartoon of their own character. */
export function characterFacesForBand(traits: string, band: "adult" | "teen" | "child"): string {
  const portrait = characterFacesPrompt(traits);
  return band === "adult" ? portrait : `${portrait} Make it a cartoon of your own character.`;
}
