import { describe, expect, test, afterEach } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { SourcesCard } from "@/apps/chat/chatSourcesCard";
import type { Source } from "@maipai/spec/gen/ts/source.js";

afterEach(cleanup);

function makeSource(id: string, title: string): Source {
  return {
    id,
    kind: "web",
    title,
    url: `https://example.com/${id}`,
    site: "example.com",
    snippet: null,
    source: "turn-abc123",
    created_at: "2026-09-13T00:00:00Z",
    hlc: "1757000000000:0:abc123",
  };
}

describe("SourcesCard", () => {
  test("a turn with three sources renders a card with three numbered links and the right attributes", () => {
    const sources = [makeSource("src-1", "First"), makeSource("src-2", "Second"), makeSource("src-3", "Third")];
    const { getAllByRole } = render(<SourcesCard sources={sources} />);
    const links = getAllByRole("link");
    expect(links).toHaveLength(3);
    expect(links.map((l) => l.textContent)).toEqual(["First · example.com", "Second · example.com", "Third · example.com"]);
    for (const [i, link] of links.entries()) {
      expect(link.getAttribute("href")).toBe(sources[i]!.url);
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")).toBe("noopener noreferrer");
      expect(link.getAttribute("referrerpolicy")).toBe("no-referrer");
    }
  });

  test("a turn without sources renders no card", () => {
    const { container } = render(<SourcesCard sources={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  test("an empty sources array renders no card", () => {
    const { container } = render(<SourcesCard sources={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
