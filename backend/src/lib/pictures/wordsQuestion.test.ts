import { describe, expect, test } from "bun:test";
import { __setWordsQuestionCompleterForTests, askPictureWords, picturePromptNeedsWordsQuestion } from "./wordsQuestion";

describe("Create picture words question", () => {
  test("asks once for exact words and skips prompts that already quote words", async () => {
    let calls = 0;
    __setWordsQuestionCompleterForTests(async () => { calls += 1; return { ok: true, text: '{"words":["Summer Fair"]}' }; });
    try {
      expect(picturePromptNeedsWordsQuestion("A poster for our summer fair", { template: "", words: [] })).toBe(true);
      expect(picturePromptNeedsWordsQuestion('A poster that says "Summer Fair"', { template: "", words: [] })).toBe(false);
      expect(await askPictureWords("A poster for our summer fair")).toEqual({ ok: true, words: ["Summer Fair"] });
      expect(calls).toBe(1);
    } finally { __setWordsQuestionCompleterForTests(null); }
  });

  test("when chat is unavailable, returns the plain line and no words", async () => {
    __setWordsQuestionCompleterForTests(async () => ({ ok: false, unavailable: true }));
    try {
      expect(await askPictureWords("A poster for our summer fair")).toEqual({ ok: false, words: [], notice: "I couldn't check whether you want words on the picture, so I'm making it without words." });
    } finally { __setWordsQuestionCompleterForTests(null); }
  });
});
