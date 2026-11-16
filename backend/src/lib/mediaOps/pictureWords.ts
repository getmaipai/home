// TEXT-PIC-06: pure input selection for the Library action.
export const FIX_WORDS_LABEL = "Fix the words";
export function promptWithoutPrintedWords(prompt: string): string {
  return prompt.replace(/\s*Show this text on the picture, spelled exactly as written:(?:\s*"[^"]*"\s*,?)+\.?/g, "").trim();
}
export function pictureWordsForFix(input: { prompt: string; words: string[] | null; seed: number | null }): { prompt: string; words: string[]; seed: number | null; checkSpelling: true } | { askForWords: true } {
  if (!input.words?.length) return { askForWords: true };
  return { prompt: input.prompt, words: [...input.words], seed: input.seed, checkSpelling: true };
}
