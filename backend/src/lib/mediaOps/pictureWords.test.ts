import { describe, expect, test } from "bun:test";
import { FIX_WORDS_LABEL, pictureWordsForFix } from "./pictureWords";

describe("Fix the words Library action", () => {
  test("re-makes from the stored prompt and words, with the spelling check path enabled", () => {
    const call = pictureWordsForFix({ prompt: "A hand-painted poster", words: ["Summer Fair"], seed: 42 });
    expect(FIX_WORDS_LABEL).toBe("Fix the words");
    expect(call).toEqual({ prompt: "A hand-painted poster", words: ["Summer Fair"], seed: 42, checkSpelling: true });
  });

  test("asks for words when the older picture has no stored words", () => {
    expect(pictureWordsForFix({ prompt: "An old album cover", words: null, seed: null })).toEqual({ askForWords: true });
  });
});
