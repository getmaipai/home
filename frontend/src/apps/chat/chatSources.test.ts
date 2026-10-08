import { describe, expect, test } from "bun:test";
import { sourceMessageParts, sourcesFromMessage } from "@/apps/chat/chatSources";

const msg = (content: unknown[]) => ({ content }) as never;

describe("chatSources", () => {
  test("sourceMessageParts maps sources to native url source parts", () => {
    const parts = sourceMessageParts([
      { id: "src-aaaaaa", url: "https://example.com/a", title: "A page", kind: "web", site: "example.com" },
    ] as never);
    expect(parts).toEqual([{ type: "source", sourceType: "url", id: "src-aaaaaa", url: "https://example.com/a", title: "A page" }]);
  });
  test("sourceMessageParts returns an empty list for undefined", () => {
    expect(sourceMessageParts(undefined)).toEqual([]);
  });
  test("sourcesFromMessage keeps order, strips www and falls back to the domain for a missing title", () => {
    const result = sourcesFromMessage(
      msg([
        { type: "text", text: "hello" },
        { type: "source", sourceType: "url", id: "s1", url: "https://www.example.com/a", title: "First" },
        { type: "source", sourceType: "url", id: "s2", url: "https://news.example.org/b", title: "" },
      ]),
    );
    expect(result).toEqual([
      { domain: "example.com", title: "First", url: "https://www.example.com/a" },
      { domain: "news.example.org", title: "news.example.org", url: "https://news.example.org/b" },
    ]);
  });
  test("sourcesFromMessage skips non-url sources and sources without a url", () => {
    const result = sourcesFromMessage(
      msg([
        { type: "source", sourceType: "document", id: "s1", url: "https://example.com/a", title: "Doc" },
        { type: "source", sourceType: "url", id: "s2", url: "", title: "No url" },
      ]),
    );
    expect(result).toEqual([]);
  });
  test("sourcesFromMessage uses the raw text as domain when the url does not parse", () => {
    const result = sourcesFromMessage(msg([{ type: "source", sourceType: "url", id: "s1", url: "not a url", title: "" }]));
    expect(result).toEqual([{ domain: "not a url", title: "not a url", url: "not a url" }]);
  });
  test("sourcesFromMessage returns an empty list without a message and caches per content array", () => {
    expect(sourcesFromMessage(undefined)).toEqual([]);
    const message = msg([{ type: "source", sourceType: "url", id: "s1", url: "https://example.com/", title: "T" }]);
    expect(sourcesFromMessage(message)).toBe(sourcesFromMessage(message));
  });
});
