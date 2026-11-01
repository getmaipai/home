// The composer's one answer-style control (owner design, 2026-11-01): Instant, Thinking, Max. Plain words only, grade 6, no resource or
// system-state words (noResourceWordsInUserCopy tests scan these lines on both sides).
export const MODE_CHOICES = [
  { id: "instant", word: "Instant", line: "Quick answers." },
  { id: "thinking", word: "Thinking", line: "Slower answers, only for you." },
  { id: "max", word: "Max", line: "Strongest answers. Slows everyone down." },
] as const;
export type ModeChoiceId = (typeof MODE_CHOICES)[number]["id"];
export const MODE_LINES: readonly string[] = MODE_CHOICES.flatMap((choice) => [choice.word, choice.line]);
export const MAX_DIALOG_TITLE = "Use Max for this message?";
export const MAX_DIALOG_BODY = "Strongest answers. Slows everyone down.";
/** "It takes about a minute to start." from the measured estimate; `phrase` is waitPhrase(seconds). */
export const maxStartLine = (phrase: string): string => `It takes about ${phrase} to start.`;
