import { describe, expect, test } from "bun:test";
import { discussMessage, DISCUSS_MAX_CHARS, DISCUSS_PROMPT } from "@/shell/pages/NewsDiscussPage";
import type { DiscussStory } from "@/shell/pages/NewsDiscussPage";

const paragraph = (text: string) => ({ type: "paragraph" as const, inlines: [{ type: "text" as const, text }] });
const story: DiscussStory = {
  title: "Barn fire",
  byline: { publisher: "Example Times" },
  blocks: [
    paragraph("First."),
    { type: "figure", src: "/x.png", alt: "barn", caption: "A barn" },
    { type: "heading", level: 2, id: "h", text: "Later" },
    { type: "list", ordered: false, items: [[{ type: "text", text: "one" }], [{ type: "text", text: "two" }]] },
    paragraph("x".repeat(DISCUSS_MAX_CHARS)),
  ],
};

describe("News Discuss text", () => {
  test("Discuss opens with the ask, names the story and outlet, and stops before the limit", () => {
    const message = discussMessage(story);
    expect(message.startsWith(`${DISCUSS_PROMPT}\n\nBarn fire (Example Times)\n\nFirst.`)).toBe(true);
    expect(message).toContain("- one\n- two");
    expect(message.length).toBeLessThan(DISCUSS_MAX_CHARS + 400);
  });
});
