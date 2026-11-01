// VIDEO-CREATE-01 (docs/design/video-create-2026-11-01.md section 6): the one list of video recipes. A recipe is tested wording for a
// camera move or style, added to the words the Stack gets (never to the words the person typed, which stay on the card). One list in
// one place: the Make a video page reads it through the package's `recipes` data id, the chat tool reads it by id.
export interface VideoRecipe { id: string; label: string; hint: string; wording: string }

export const VIDEO_RECIPES: readonly VideoRecipe[] = [
  { id: "dolly-in", label: "Dolly in", hint: "The camera glides slowly toward the subject.", wording: "slow dolly-in, the camera glides smoothly toward the subject" },
  { id: "slow-orbit", label: "Slow orbit", hint: "The camera circles around the subject.", wording: "slow orbiting camera move circling around the subject" },
  { id: "handheld", label: "Handheld", hint: "A natural, slightly shaky camera, like a phone.", wording: "handheld camera with natural, subtle shake" },
  { id: "slow-motion", label: "Slow motion", hint: "The action plays out slowly.", wording: "slow motion, every movement stretched and smooth" },
  { id: "time-lapse", label: "Time-lapse", hint: "Hours pass in seconds.", wording: "time-lapse, time passing quickly, clouds and light moving fast" },
  { id: "aerial", label: "Aerial", hint: "A view from high above, like a drone.", wording: "aerial drone shot from high above, moving smoothly forward" },
  { id: "close-up", label: "Close-up", hint: "Fills the frame with a detail.", wording: "close-up shot, shallow depth of field, fine detail in focus" },
  { id: "wide-establishing", label: "Wide establishing shot", hint: "Shows the whole place at once.", wording: "wide establishing shot showing the whole scene, steady camera" },
];

/** A recipe by its id or its label (any letter case), or null. */
export function videoRecipeFor(value: unknown): VideoRecipe | null {
  if (typeof value !== "string") return null;
  const key = value.trim().toLowerCase();
  if (!key) return null;
  return VIDEO_RECIPES.find((recipe) => recipe.id === key || recipe.label.toLowerCase() === key) ?? null;
}

/** The words the Stack gets: the person's words, then the recipe's wording. */
export function withVideoRecipe(prompt: string, recipe: VideoRecipe | null): string {
  return recipe ? `${prompt.replace(/[\s.]+$/, "")}. ${recipe.wording}.` : prompt;
}

/** Three starter ideas for the Create home: a tap makes the clip with the page's defaults. */
export const VIDEO_STARTERS: readonly { id: string; title: string; prompt: string }[] = [
  { id: "paper-boat", title: "A paper boat in the rain", prompt: "A paper boat floats down a rainy street, soft evening light" },
  { id: "sunrise-valley", title: "Sunrise over a valley", prompt: "Sunrise over a misty green valley, birds crossing the sky" },
  { id: "cozy-cabin", title: "A cozy cabin in the snow", prompt: "A small cabin in falling snow, warm light glowing in the windows" },
];
