// ANSWER-IMG-04, re-pointed by GENUI-05: pictures in a chat answer are an `image_gallery` answer block drawn by the
// kit's block dispatcher, which draws the image-gallery Element as shipped (the `answer-images` data part and its
// renderer are retired). The block is built by the hub's one builder, so these cases hold the promises of the old
// picture test (pictures render with alt text and a source link; none renders nothing; the badge never reads +1)
// on the shape that now reaches the thread, live and from a stored turn.
import { afterEach, describe, expect, test } from "bun:test";
import type { ReactElement } from "react";
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { AnswerBlockDataRender, textWithAnswerParts } from "@/apps/chat/chatAnswerBlocks";
import { galleryBlockFor, legacyGalleryBlock } from "@maipai/home-backend/src/lib/answerImages/gallery";
import type { AnswerImageSet } from "@maipai/home-backend/src/wire";
import type { AnswerBlock } from "@maipai/spec/gen/ts/answer-block.js";

afterEach(cleanup);
// Hub-relative picture addresses need a page address to resolve against, as in
// the app; happy-dom fires `error` at once for an address it cannot parse.
(window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL("http://localhost/chat");

const id = (n: number) => `ai_${String(n).padStart(32, "0")}`;
function set(count: number, extra: Partial<AnswerImageSet> = {}): AnswerImageSet {
  return {
    layout: "row",
    after_paragraph: 0,
    visible: Math.min(5, count),
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
/** The gallery block the hub would send for this set (the live builder), and the one a stored legacy turn reads as. */
const live = (s: AnswerImageSet) => galleryBlockFor(s, "Eiffel Tower", "show_images test", "1:0:testnode") as unknown as AnswerBlock;
const stored = (s: AnswerImageSet) => legacyGalleryBlock(s, "turn-1", "2026-10-01T10:00:00.000Z") as AnswerBlock;
const Render = AnswerBlockDataRender as unknown as (props: { data: AnswerBlock }) => ReactElement | null;

describe("the answer's pictures (the image_gallery block, kit image gallery)", () => {
  test("a gallery renders hub-served tiles with alt text, and links the source page", () => {
    const { getAllByRole, getByRole } = render(<Render data={stored(set(3))} />);
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

  test("a stored turn from before GENUI-05 and a live turn draw the same gallery", () => {
    const a = render(<Render data={live(set(7))} />);
    const liveHtml = a.container.innerHTML;
    cleanup();
    const b = render(<Render data={stored(set(7))} />);
    expect(b.container.innerHTML).toBe(liveHtml);
  });

  test("the badge counts the extras, is a button, and equals what the gallery holds", () => {
    const { getAllByRole, getByText, getByRole } = render(<Render data={live(set(7))} />);
    expect(getAllByRole("img")).toHaveLength(5);
    expect(getByText("+2")).toBeTruthy();
    fireEvent.click(getByRole("button", { name: "Open image: Tower picture 3" }));
    expect(within(getByRole("dialog")).getByText("3 / 7")).toBeTruthy();
  });

  test("never a +1 badge: a lone extra is left out by the builder", () => {
    const block = live(set(6)) as unknown as { props: { images: unknown[] } };
    expect(block.props.images).toHaveLength(5);
    const { queryByText } = render(<Render data={live(set(6))} />);
    expect(queryByText("+1")).toBeNull();
  });

  test("a tile that fails to paint shows the kit's placeholder, never a broken image", () => {
    const { getAllByRole, container } = render(<Render data={live(set(3))} />);
    fireEvent.error(getAllByRole("img")[1]!);
    expect(getAllByRole("img")).toHaveLength(2);
    expect(container.querySelector("svg.lucide-image-off")).not.toBeNull();
  });

  // Focus going back to the tile is checked in a real browser by
  // `scripts/screenshot.ts --next-chat-answer-images` (happy-dom does not run
  // the dialog's focus return).
  test("Escape closes the gallery", async () => {
    const { getByRole, queryByRole } = render(<Render data={live(set(3))} />);
    const tile = getByRole("button", { name: "Open image: Tower picture 1" });
    tile.focus();
    fireEvent.click(tile);
    fireEvent.keyDown(getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(queryByRole("dialog")).toBeNull());
  });
});

describe("where the pictures sit in the reply", () => {
  const text = "First paragraph.\n\nSecond paragraph.\n\nThird.";

  test("the gallery is placed after the paragraph the hub named, and the text is unchanged around it", () => {
    const parts = textWithAnswerParts(text, { blocks: [stored(set(3, { after_paragraph: 1 }))] });
    expect(parts.map((p) => p.type)).toEqual(["text", "data", "text"]);
  });

  test("a reply with no pictures is one text part, exactly as before", () => {
    expect(textWithAnswerParts("Hello.", { blocks: [] })).toEqual([{ type: "text", text: "Hello." }]);
  });

  test("leading pictures come before any text", () => {
    expect(textWithAnswerParts("Hello.", { blocks: [stored(set(2))] }).map((p) => p.type)).toEqual(["data", "text"]);
  });
});
