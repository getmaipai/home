import { describe, expect, test } from "bun:test";
import { discussMessage, DISCUSS_PROMPT } from "@/shell/pages/NewsDiscussPage";

describe("News Discuss message", () => {
  test("Discuss sends the ask and the story reference, never the article", () => {
    expect(discussMessage("news-1a2b3c4d")).toBe(`${DISCUSS_PROMPT}\n\nmaipai://news/story/news-1a2b3c4d`);
  });
});
