import { describe, expect, test } from "bun:test";
import { markCitations, parseCitationHref } from "@/apps/chat/chatCitations";
import type { Source } from "@maipai/spec/gen/ts/source.js";

function makeSource(id: string): Source {
  return {
    id,
    kind: "web",
    title: `Title for ${id}`,
    url: `https://example.com/${id}`,
    site: "example.com",
    snippet: null,
    source: "turn-abc123",
    created_at: "2026-09-13T00:00:00Z",
    hlc: "1757000000000:0:abc123",
  };
}

describe("markCitations", () => {
  test("a [N] marker with a matching source becomes a citation link", () => {
    const sources = [makeSource("src-1"), makeSource("src-2")];
    expect(markCitations("The weather is nice [2].", sources)).toBe("The weather is nice [2](#citation-2).");
  });

  test("a [7] marker with no matching source (only two) stays plain text", () => {
    const sources = [makeSource("src-1"), makeSource("src-2")];
    expect(markCitations("See [7] for more.", sources)).toBe("See [7] for more.");
  });

  test("no sources at all leaves every marker untouched", () => {
    expect(markCitations("See [1] for more.", undefined)).toBe("See [1] for more.");
    expect(markCitations("See [1] for more.", [])).toBe("See [1] for more.");
  });

  // The design note's own reason `preprocess` exists at all: a marker can
  // split across two streamed chunks ("[" then "2]"). markCitations()
  // itself is stateless and only ever sees whatever buffer it's handed -
  // a still-incomplete buffer simply has no "[N]" to match yet, proving
  // it can't half-convert a marker that hasn't fully arrived.
  test("a still-incomplete marker (buffer ends mid-bracket) is never converted", () => {
    const sources = [makeSource("src-1"), makeSource("src-2")];
    expect(markCitations("The weather is nice [", sources)).toBe("The weather is nice [");
  });

  // Found in review before this lane's commit: a naive whole-text regex
  // would rewrite `[2]` inside a code span too, breaking a literal code
  // example into a stray markdown-link fragment.
  test("a marker inside an inline code span is left alone", () => {
    const sources = [makeSource("src-1"), makeSource("src-2")];
    expect(markCitations("Explaining `items[2]` here, see [2] for the source.", sources)).toBe(
      "Explaining `items[2]` here, see [2](#citation-2) for the source.",
    );
  });

  test("a marker inside a fenced code block is left alone", () => {
    const sources = [makeSource("src-1"), makeSource("src-2")];
    const text = "```\nconst x = items[1];\n```\nSee [1] for the source.";
    expect(markCitations(text, sources)).toBe("```\nconst x = items[1];\n```\nSee [1](#citation-1) for the source.");
  });

  test("multiple markers each resolve independently", () => {
    const sources = [makeSource("src-1"), makeSource("src-2")];
    expect(markCitations("[1] and [2] agree, but not [9].", sources)).toBe(
      "[1](#citation-1) and [2](#citation-2) agree, but not [9].",
    );
  });
});

describe("parseCitationHref", () => {
  test("pulls the index back out of a #citation- href", () => {
    expect(parseCitationHref("#citation-3")).toBe(3);
  });

  test("a real URL is not a citation", () => {
    expect(parseCitationHref("https://example.com")).toBeNull();
  });

  test("undefined href is not a citation", () => {
    expect(parseCitationHref(undefined)).toBeNull();
  });
});
