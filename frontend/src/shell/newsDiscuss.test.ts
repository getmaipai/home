import { describe, expect, test } from "bun:test";
import { discussMessage, DISCUSS_PROMPT } from "@/shell/pages/NewsDiscussPage";

describe("News Discuss message", () => {
  test("Discuss sends the ask and the story reference, never the article", () => {
    expect(discussMessage("news-1a2b3c4d")).toBe(`${DISCUSS_PROMPT}\n\nmaipai://news/story/news-1a2b3c4d`);
  });
  test("the opening line is a short, neutral invitation to talk, with no critique framing", () => {
    expect(DISCUSS_PROMPT.length).toBeLessThan(60);
    expect(DISCUSS_PROMPT).not.toMatch(/one-sided|missing|bias|critique|judge|what you think/i);
  });
});
