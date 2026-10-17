// The words the collapsed reasoning header cycles through while the model
// thinks. One list in one place so it can be localized later. Plain, calm,
// grade-6 words that say nothing about the content, so they are safe for every
// age band. No model call and no network: a status line only.

export const THINKING_WORDS: readonly string[] = [
  "Thinking",
  "Pondering",
  "Deliberating",
  "Mulling it over",
  "Working it out",
  "Considering",
  "Reflecting",
  "Figuring it out",
  "Weighing it up",
  "Chewing on it",
  "Puzzling it out",
  "Thinking it through",
  "Looking into it",
  "Sorting it out",
  "Musing",
  "Contemplating",
  "Taking a moment",
  "Piecing it together",
  "Connecting the dots",
  "Gathering my thoughts",
];

/** The word shown when motion is reduced, and the one the screen reader hears. */
export const STATIC_THINKING_WORD = "Thinking";
export const DONE_THINKING_ANNOUNCEMENT = "Done thinking";

/** No rotation at all for the first 8 seconds of a turn, then each word holds 10 to 14 seconds. */
export const FIRST_HOLD_MS = 8000;
export const ROTATE_MIN_MS = 10_000;
export const ROTATE_MAX_MS = 14_000;

/** A random word that is never `previous`. */
export function pickThinkingWord(previous: string | null, rand: () => number = Math.random): string {
  const choices = THINKING_WORDS.filter((w) => w !== previous);
  return choices[Math.min(choices.length - 1, Math.floor(rand() * choices.length))] as string;
}

/** Milliseconds until the next word, between 10 and 14 seconds. */
export function nextRotationDelay(rand: () => number = Math.random): number {
  return Math.round(ROTATE_MIN_MS + rand() * (ROTATE_MAX_MS - ROTATE_MIN_MS));
}
