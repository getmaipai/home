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
  const reference = {
    id: "src-moon1",
    kind: "reference",
    title: "Moon",
    url: "https://en.wikipedia.org/wiki/Moon",
    local_path: "/api/reference/wikipedia_en_all/A/Moon",
    site: "Wikipedia",
    licence: "cc-by-sa-4.0",
    snapshot_date: "2026-09-01",
  };
  test("a library source opens its reader route, never the public url", () => {
    const [part] = sourceMessageParts([reference] as never);
    expect(part).toMatchObject({ type: "source", sourceType: "url", url: "/reference/wikipedia_en_all/A/Moon" });
    const [source] = sourcesFromMessage(msg([part]));
    expect(source?.url).toBe("/reference/wikipedia_en_all/A/Moon");
    expect(JSON.stringify(source)).not.toContain("https://en.wikipedia.org/wiki/Moon");
  });
  test("a citation target keeps escaped article path segments on the reader", () => {
    const [part] = sourceMessageParts([{ ...reference, local_path: "/api/reference/wiki_en/A/Red%20Fox" }] as never);
    expect(part?.url).toBe("/reference/wiki_en/A/Red%2520Fox");
  });
  test("a library source shows the public host and the licence line from the backend label map", () => {
    const [source] = sourcesFromMessage(msg(sourceMessageParts([reference] as never)));
    expect(source).toEqual({ domain: "en.wikipedia.org", title: "Moon", url: "/reference/wikipedia_en_all/A/Moon", detail: "CC BY-SA 4.0, snapshot 2026-09-01" });
  });
  test("every licence value gets a label and a library source without a snapshot shows the label alone", () => {
    for (const [licence, label] of [["cc0", "CC0"], ["public-domain", "Public domain"], ["publisher", "Publisher's licence"]]) {
      const [source] = sourcesFromMessage(msg(sourceMessageParts([{ ...reference, licence, snapshot_date: undefined }] as never)));
      expect(source?.detail).toBe(label);
    }
  });
  test("a web source is unchanged even if it carries a licence", () => {
    const [part] = sourceMessageParts([{ id: "src-w", kind: "web", title: "A", url: "https://example.com/a", site: "example.com", licence: "cc0" }] as never);
    expect(part).toEqual({ type: "source", sourceType: "url", id: "src-w", url: "https://example.com/a", title: "A" });
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
