import { describe, expect, test } from "bun:test";
import { cleanTitle } from "@/lib/conversationTitle";

describe("cleanTitle", () => {
  test("drops the label, quotes, trailing period and later lines", () => {
    expect(cleanTitle('Title: "Planning a week of dinners."\nmore')).toBe("Planning a week of dinners");
  });
  test("skips leading blank lines and strips markdown emphasis", () => {
    expect(cleanTitle("\n\n  **Rainbows**  ")).toBe("Rainbows");
  });
  test("handles the Topic label in any case", () => {
    expect(cleanTitle("topic: Soccer practice")).toBe("Soccer practice");
  });
  test("returns an empty string when nothing is usable", () => {
    expect(cleanTitle("")).toBe("");
    expect(cleanTitle('  ""  ')).toBe("");
  });
  test("collapses inner whitespace", () => {
    expect(cleanTitle("Weekend   trip    ideas")).toBe("Weekend trip ideas");
  });
  test("cuts a long title at a word boundary", () => {
    const title = cleanTitle("x ".repeat(100));
    expect(title).toBe(Array(30).fill("x").join(" "));
    expect(title.length).toBe(59);
  });
  test("hard-cuts a long single word at 60 characters", () => {
    expect(cleanTitle("a".repeat(100))).toBe("a".repeat(60));
  });
});
