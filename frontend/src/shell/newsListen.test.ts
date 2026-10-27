import { describe, expect, test } from "bun:test";
import { listenParagraphs, paragraphLine, createStoryListener, NOTHING_TO_READ } from "@/shell/newsListen";
import { createMediaStore } from "@/shell/mediaHost";
import { api } from "@/lib/api";
import type { DiscussStory } from "@/shell/pages/NewsDiscussPage";

const paragraph = (text: string) => ({ type: "paragraph" as const, inlines: [{ type: "text" as const, text }] });
const story: DiscussStory = {
  title: "Barn fire",
  blocks: [paragraph("First."), { type: "figure", src: "/x.png", alt: "barn", caption: "A barn" }, paragraph("Second.")],
};

describe("News Listen", () => {
  test("reads the title, then every block that has words, and skips pictures", () => {
    expect(listenParagraphs(story)).toEqual(["Barn fire", "First.", "Second."]);
    expect(listenParagraphs({ ...story, speech: ["Barn fire. From Example Times.", "First."] })).toEqual(["Barn fire. From Example Times.", "First."]);
    expect(paragraphLine(0, 3)).toBe("Paragraph 1 of 3");
  });

  test("a story with no words says so instead of playing", async () => {
    const original = api.appData;
    (api as { appData: unknown }).appData = async () => [{ props: { title: "Empty", blocks: [] } }];
    try {
      const listener = createStoryListener(createMediaStore() as never, () => {});
      await expect(listener.listen("s1")).rejects.toThrow(NOTHING_TO_READ);
    } finally {
      (api as { appData: unknown }).appData = original;
    }
  });

  test("retarget moves the held element to the next paragraph without a new element", () => {
    const store = createMediaStore();
    const el = store.elementFor({ id: "story:s1", src: "data:audio/wav;base64,", kind: "audio", title: "Barn fire" }, "news");
    store.retarget(el, { src: "blob:one", subtitle: paragraphLine(0, 2) });
    expect(store.get()?.el).toBe(el);
    expect(store.get()?.src).toBe("blob:one");
    expect(store.get()?.subtitle).toBe("Paragraph 1 of 2");
  });
});
