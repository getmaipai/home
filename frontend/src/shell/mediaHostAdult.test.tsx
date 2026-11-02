// ADULT-LOCK-05 (design note 3.9, test 9): the media host is the one rule point. An adult-only item is never registered, never given an element,
// never reaches the audio session or the mini bar.
import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { ADULT_ONLY_PAGE_ONLY } from "@maipai/ui/src/schema/mediaHost";
import { createMediaStore } from "@/shell/mediaHost";
import { MediaPlayerRegistration } from "@/shell/MediaPlayerRegistration";

afterEach(() => cleanup());

const clip = { id: "clip-1", src: "/api/files/clip-1/content", kind: "video" as const, title: "A title", poster: "/api/files/clip-1/thumb" };

describe("createMediaStore refuses an adult-only item", () => {
  test("elementFor throws the plain line, creates no element and holds nothing", () => {
    const store = createMediaStore();
    expect(() => store.elementFor({ ...clip, adultOnly: true }, "videos")).toThrow(ADULT_ONLY_PAGE_ONLY);
    expect(store.get()).toBeNull();
    expect(document.querySelectorAll("video").length).toBe(0);
  });

  test("an adult-only item asked for while another plays does not replace it, and the other keeps playing", () => {
    const store = createMediaStore();
    const open = store.elementFor({ ...clip, id: "open-1" }, "videos");
    expect(() => store.elementFor({ ...clip, adultOnly: true }, "videos")).toThrow();
    expect(store.get()?.id).toBe("open-1");
    expect(store.get()?.el).toBe(open);
    store.clear();
  });

  test("an item with adultOnly false or absent is held as before", () => {
    const store = createMediaStore();
    store.elementFor({ ...clip, adultOnly: false }, "videos");
    expect(store.get()?.id).toBe("clip-1");
    store.clear();
  });
});

describe("the audio session never sees an adult-only item", () => {
  test("the registration of an item the host holds reads the item's title, an adult-only one reads nothing", () => {
    const fetched = mock(() => Promise.resolve(new Response("{}")));
    const original = globalThis.fetch;
    globalThis.fetch = fetched as unknown as typeof fetch;
    try {
      render(<MediaPlayerRegistration appId="videos" mediaId="clip-1" element={document.createElement("video")} adultOnly />);
    } finally { globalThis.fetch = original; }
    expect(fetched).not.toHaveBeenCalled();
  });
});
