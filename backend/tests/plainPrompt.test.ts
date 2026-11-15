import { expect, test } from "bun:test";
import { plainPrompt } from "@/lib/pictures/quality";

test("the sentences the picture tool adds are removed from the person's request", () => {
  expect(plainPrompt('a poster that says "Summer Fair". Show this text on the picture, spelled exactly as written: "Summer Fair".')).toBe('a poster that says "Summer Fair".');
  expect(plainPrompt('a cafe sign. Show this text on the picture, spelled exactly as written: "Open", "Late".')).toBe("a cafe sign.");
  expect(plainPrompt("a red fox in the snow. No text, no letters, no words, no logos anywhere in the picture.")).toBe("a red fox in the snow.");
  expect(plainPrompt("a red fox")).toBe("a red fox");
});
