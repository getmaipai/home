// VIDEO-CREATE-01 (docs/design/video-create-2026-11-01.md section 6): the one list of video recipes. A recipe is tested wording for a
// camera move or style, added to the words the Stack gets (never to the words the person typed, which stay on the card). One list in
// one place: the Make a video page reads it through the package's `recipes` data id, the chat tool reads it by id.
/** `loop` is the card's sample clip, a path inside the Videos package's `assets/` folder (VIDEO-CREATE-02). */
export interface VideoRecipe { id: string; label: string; hint: string; wording: string; loop: string }

// VIDEO-CREATE-02: these are the Camera cards, in the order they show. Still is the eighth (it replaced Wide establishing shot, which no card or loop used).
export const VIDEO_RECIPES: readonly VideoRecipe[] = [
  { id: "dolly-in", label: "Dolly in", hint: "The camera glides slowly toward the subject.", wording: "slow dolly-in, the camera glides smoothly toward the subject", loop: "loops/dolly-in.mp4" },
  { id: "slow-orbit", label: "Slow orbit", hint: "The camera circles around the subject.", wording: "slow orbiting camera move circling around the subject", loop: "loops/slow-orbit.mp4" },
  { id: "handheld", label: "Handheld", hint: "A natural, slightly shaky camera, like a phone.", wording: "handheld camera with natural, subtle shake", loop: "loops/handheld.mp4" },
  { id: "slow-motion", label: "Slow motion", hint: "The action plays out slowly.", wording: "slow motion, every movement stretched and smooth", loop: "loops/slow-motion.mp4" },
  { id: "time-lapse", label: "Time-lapse", hint: "Hours pass in seconds.", wording: "time-lapse, time passing quickly, clouds and light moving fast", loop: "loops/time-lapse.mp4" },
  { id: "aerial", label: "Aerial", hint: "A view from high above, like a drone.", wording: "aerial drone shot from high above, moving smoothly forward", loop: "loops/aerial.mp4" },
  { id: "close-up", label: "Close-up", hint: "Fills the frame with a detail.", wording: "close-up shot, shallow depth of field, fine detail in focus", loop: "loops/close-up.mp4" },
  { id: "still", label: "Still", hint: "The camera stays put.", wording: "locked-off static camera, no camera movement", loop: "loops/still.mp4" },
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

// VIDEO-CREATE-01 (V1b): the Look and Voices lists, one place each. Measured on LTX-2.5 (docs/design/video-create-2026-11-01.md): a classic
// cartoon came back only when its era and animation style were said outright, and people looked right only with "natural colour grading"
// wording. A look goes BEFORE the person's words (style first); the card keeps only what they typed.
export interface VideoLook { id: string; label: string; wording: string; /** The card's sample clip, a path inside the package's `assets/` folder. */ loop: string }

export const VIDEO_LOOKS: readonly VideoLook[] = [
  { id: "natural", label: "Natural", wording: "", loop: "loops/natural.mp4" },
  { id: "classic-cartoon", label: "Classic cartoon", wording: "1980s Saturday-morning hand-drawn cartoon, cel animation, flat colours, thick black outlines, Hanna-Barbera style", loop: "loops/classic-cartoon.mp4" },
  { id: "anime", label: "Anime", wording: "2D anime style, painted backdrop, limited animation", loop: "loops/anime.mp4" },
  { id: "3d-animated", label: "3D animated", wording: "modern 3D animated film look", loop: "loops/3d-animated.mp4" },
  { id: "film", label: "Film", wording: "cinematic live-action film still, natural colour grading, muted realistic colours, soft contrast, true-to-life skin tones", loop: "loops/film.mp4" },
];

/** A look by its id or label (any letter case), or null. */
export function videoLookFor(value: unknown): VideoLook | null {
  if (typeof value !== "string") return null;
  const key = value.trim().toLowerCase();
  return key ? VIDEO_LOOKS.find((look) => look.id === key || look.label.toLowerCase() === key) ?? null : null;
}

/** The words the Stack gets with a look: its wording first, then the person's words. Natural adds nothing. */
export function withVideoLook(prompt: string, look: VideoLook | null): string {
  return look && look.wording ? `${look.wording}. ${prompt}` : prompt;
}

export interface VideoVoices { id: string; label: string; wording: string }

/** Clean dialogue is the default. The wording only forbids things; it never gives the model a line to say aloud. */
export const VIDEO_VOICES: readonly VideoVoices[] = [
  { id: "clean", label: "Keep it clean", wording: "no laugh track, no music, only one character speaks at a time" },
  { id: "full", label: "With music and effects", wording: "" },
];
export const DEFAULT_VIDEO_VOICES = "clean";

export function videoVoicesFor(value: unknown): VideoVoices | null {
  if (typeof value !== "string") return null;
  const key = value.trim().toLowerCase();
  return key ? VIDEO_VOICES.find((voices) => voices.id === key || voices.label.toLowerCase() === key) ?? null : null;
}

export function withVideoVoices(prompt: string, voices: VideoVoices | null): string {
  return voices && voices.wording ? `${prompt.replace(/[\s.]+$/, "")}. ${voices.wording}.` : prompt;
}

// VIDEO-UI-11 (docs/design/video-create-feel-2026-11-02.md item 1): the "Try this" rail on the Create page. One tile is a ready-made idea: words plus a Look and a
// Camera move from the two lists above. A press only refills the panel (it starts nothing). `poster` is one of the 13 loops; its poster JPEG sits beside the
// mp4 (made by scripts/video-posters.swift). Plain scenes only: no real person, no brand, no character from a film.
export interface VideoShowcase { id: string; title: string; prompt: string; look: string; camera: string; /** The loop whose poster is the tile's picture. */ poster: string }

export const VIDEO_SHOWCASE: readonly VideoShowcase[] = [
  { id: "paper-boat-anime", title: "Paper boat", prompt: "A paper boat floats down a rainy street, soft evening light", look: "anime", camera: "dolly-in", poster: "loops/anime.mp4" },
  { id: "valley-aerial", title: "Valley sunrise", prompt: "Sunrise over a misty green valley, birds crossing the sky", look: "natural", camera: "aerial", poster: "loops/aerial.mp4" },
  { id: "cabin-orbit", title: "Snowy cabin", prompt: "A small cabin in falling snow, warm light glowing in the windows", look: "3d-animated", camera: "slow-orbit", poster: "loops/3d-animated.mp4" },
  { id: "morning-cartoon", title: "Cartoon morning", prompt: "A cheerful cartoon fox chases a paper plane across a sunny backyard", look: "classic-cartoon", camera: "none", poster: "loops/classic-cartoon.mp4" },
  { id: "lighthouse-film", title: "Lighthouse", prompt: "A lighthouse on a rocky coast at dusk, waves rolling in, the lamp turning on", look: "film", camera: "handheld", poster: "loops/film.mp4" },
  { id: "city-time-lapse", title: "City waking", prompt: "A city street from dawn to morning, traffic and light building up", look: "natural", camera: "time-lapse", poster: "loops/time-lapse.mp4" },
  { id: "splash-slow", title: "Slow splash", prompt: "A water balloon bursts on a sunny lawn, drops flying everywhere", look: "natural", camera: "slow-motion", poster: "loops/slow-motion.mp4" },
  { id: "raindrop-close", title: "Raindrop", prompt: "A single raindrop rolls along a green leaf, then falls", look: "natural", camera: "close-up", poster: "loops/close-up.mp4" },
];
