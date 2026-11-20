describe("edge partial speculative eligibility", () => {
  test("finished sentence commit rule handles punctuation and dangling endings", () => {
    for (const text of ["Why do cats purr?", "What can I do on a sunny afternoon with the kids?", "She said, ‘We’re ready.’", "That is enough.)"]) expect(isFinishedSentence(text)).toBe(true);
    for (const text of ["so I was thinking, and", "Well,", "Okay.", "I want to tell you about", "Hello?", "Yes it is the"]) expect(isFinishedSentence(text)).toBe(false);
  });

  test("sentence commit ignores short and unfinished phrases", () => {
    expect(isFinishedSentence("Why do cats purr?")).toBe(true);
    expect(isFinishedSentence("I want to tell you about")).toBe(false);
  });

  test("the edge score preserves the unfinished flag", () => {
    expect(scoreEdgePartial("What is a good name for a.").unfinished).toBe(true);
    expect(scoreEdgePartial("What is a good name for a small grey cat?").unfinished).toBe(false);
  });
});
import { describe, expect, test } from "bun:test";
import { isFinishedSentence, scoreEdgePartial } from "@/lib/turnEnd";

