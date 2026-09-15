import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { ChatMedia } from "@/apps/chat/chatCitations";
import type { Source } from "@maipai/spec/gen/ts/source.js";

afterEach(cleanup);
const source: Source = { id: "s1", kind: "web", title: "Photo", url: "https://example.com/page", site: "example.com", snippet: null, source: "turn-1", created_at: "2026-09-15T00:00:00Z", hlc: "1:0:test" };

describe("ChatMedia", () => {
  test("a message with media renders the thumbnail, accessible alt, and first-source link", () => {
    const { getByRole } = render(<ChatMedia media={{ kind: "image", url: "https://img.example.com/full.jpg", thumbnail: "https://img.example.com/thumb.jpg", source: "example.com" }} sources={[source]} />);
    const image = getByRole("img");
    expect(image.getAttribute("src")).toBe("https://img.example.com/thumb.jpg");
    expect(image.getAttribute("alt")).toBe("From example.com");
    expect(getByRole("link").getAttribute("href")).toBe(source.url);
  });

  test("no media renders nothing", () => {
    const { container } = render(<ChatMedia media={undefined} sources={[source]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
