// ANSWER-IMG-04: pictures in a chat answer through the kit image-gallery
// Element. Re-pointed from the retired hand-built ChatMedia's test with the
// same promises (pictures render with alt text and a source link; no
// pictures renders nothing) plus the gallery's own acceptance rows.
import { afterEach, describe, expect, test } from "bun:test";
import type { ReactElement } from "react";
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { AnswerImagesDataRender, galleryImages, splitAfterParagraph, textWithAnswerImages } from "@/apps/chat/chatAnswerImages";
import type { AnswerImageSet } from "@maipai/home-backend/src/wire";

afterEach(cleanup);
// Hub-relative picture addresses need a page address to resolve against, as in
// the app; happy-dom fires `error` at once for an address it cannot parse.
(window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL("http://localhost/chat");

const id = (n: number) => `ai_${String(n).padStart(32, "0")}`;
function set(count: number, extra: Partial<AnswerImageSet> = {}): AnswerImageSet {
  return {
    layout: "row",
    after_paragraph: 0,
    visible: Math.min(3, count),
    items: Array.from({ length: count }, (_, i) => ({
      id: id(i + 1),
      src: `/api/answer-image/${id(i + 1)}?v=tile`,
      full: `/api/answer-image/${id(i + 1)}?v=full`,
      width: 640,
      height: 480,
      alt: `Tower picture ${i + 1}`,
      caption: `The tower, view ${i + 1}`,
      source: { title: `Tower ${i + 1}`, site: "commons.wikimedia.org", url: `https://commons.wikimedia.org/wiki/File:Tower_${i + 1}.jpg` },
      license: { short: "CC BY-SA 4.0", artist: "Iris" },
    })),
    ...extra,
  };
}
const Render = AnswerImagesDataRender as unknown as (props: { data: AnswerImageSet }) => ReactElement | null;

describe("the answer's pictures (kit image gallery)", () => {
  test("a message with pictures renders hub-served tiles with alt text, and the gallery links the source page", () => {
    const { getAllByRole, getByRole } = render(<Render data={set(3)} />);
    const images = getAllByRole("img");
    expect(images).toHaveLength(3);
    for (const img of images) expect(img.getAttribute("src")!.startsWith("/api/answer-image/")).toBe(true);
    expect(images[0]!.getAttribute("alt")).toBe("Tower picture 1");
    fireEvent.click(getByRole("button", { name: "Open image: Tower picture 2" }));
    const dialog = getByRole("dialog");
    expect(within(dialog).getByRole("img").getAttribute("alt")).toBe("Tower picture 2");
    const link = within(dialog).getByRole("link");
    expect(link.getAttribute("href")).toBe("https://commons.wikimedia.org/wiki/File:Tower_2.jpg");
    expect(link.getAttribute("rel")).toContain("noreferrer");
    expect(within(dialog).getByText(/The tower, view 2 · CC BY-SA 4.0, Iris/)).toBeTruthy();
  });

  test("no pictures renders nothing, and no box is reserved", () => {
    const { container } = render(<Render data={set(0)} />);
    expect(container).toBeEmptyDOMElement();
  });

  test("the badge counts validated extras, is a button, and equals what the gallery holds", () => {
    const { getAllByRole, getByText, getByRole } = render(<Render data={set(5)} />);
    expect(getAllByRole("img")).toHaveLength(3);
    expect(getByText("+2")).toBeTruthy();
    fireEvent.click(getByRole("button", { name: "Open image: Tower picture 3" }));
    expect(within(getByRole("dialog")).getByText("3 / 5")).toBeTruthy();
  });

  test("never a +1 badge: a lone extra is left out", () => {
    expect(galleryImages(set(4), new Set())).toHaveLength(3);
    const { queryByText } = render(<Render data={set(4)} />);
    expect(queryByText("+1")).toBeNull();
  });

  test("a tile that fails to paint is removed silently and the badge updates", () => {
    const { getAllByRole, queryByText, container } = render(<Render data={set(5)} />);
    fireEvent.error(getAllByRole("img")[1]!);
    const imgs = getAllByRole("img");
    expect(imgs).toHaveLength(3);
    expect(imgs.map((i) => i.getAttribute("alt"))).not.toContain("Tower picture 2");
    expect(queryByText("+2")).toBeNull();
    expect(queryByText("+1")).toBeNull();
    // No broken-image icon anywhere.
    expect(container.querySelector("svg.lucide-image-off")).toBeNull();
  });

  test("a picture that is not served by the hub is never shown", () => {
    const outside = set(1);
    outside.items[0]!.src = "https://upload.example/photo.jpg";
    const { container } = render(<Render data={outside} />);
    expect(container).toBeEmptyDOMElement();
  });

  // Focus going back to the tile is checked in a real browser by
  // `scripts/screenshot.ts --next-chat-answer-images` (happy-dom does not run
  // the dialog's focus return).
  test("Escape closes the gallery", async () => {
    const { getByRole, queryByRole } = render(<Render data={set(3)} />);
    const tile = getByRole("button", { name: "Open image: Tower picture 1" });
    tile.focus();
    fireEvent.click(tile);
    fireEvent.keyDown(getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(queryByRole("dialog")).toBeNull());
  });
});

describe("where the pictures sit in the reply", () => {
  test("the set is placed after the paragraph the hub named, and the text is unchanged around it", () => {
    const text = "First paragraph.\n\nSecond paragraph.\n\nThird.";
    expect(splitAfterParagraph(text, 0)).toEqual(["", text]);
    expect(splitAfterParagraph(text, 1)).toEqual(["First paragraph.\n\n", "Second paragraph.\n\nThird."]);
    expect(splitAfterParagraph(text, 3)).toEqual([text, ""]);
    const parts = textWithAnswerImages(text, set(3, { after_paragraph: 1 }), "t1-images");
    expect(parts.map((p) => p.type)).toEqual(["text", "data", "text"]);
  });

  test("a reply with no pictures is one text part, exactly as before", () => {
    expect(textWithAnswerImages("Hello.", undefined, "t1")).toEqual([{ type: "text", text: "Hello." }]);
  });

  test("leading pictures come before any text", () => {
    expect(textWithAnswerImages("Hello.", set(2), "t1").map((p) => p.type)).toEqual(["data", "text"]);
  });
});
