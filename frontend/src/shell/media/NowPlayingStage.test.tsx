import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { lyricsOf, NowPlayingStage } from "@/shell/media/NowPlayingStage";
import { MediaDockContext, type HoistedMedia, type MediaDock } from "@/shell/mediaHost";
import { setPlayMode } from "@/shell/media/playMode";

const realFetch = globalThis.fetch;
let calls: Array<{ url: string; body: string }> = [];
let item: Record<string, unknown> = {};

beforeEach(() => {
  localStorage.clear();
  setPlayMode({ shuffle: false, repeat: "off" });
  calls = [];
  item = { liked: false, timed_lyrics: [{ t: 0, line: "First line" }, { t: 5, line: "Second line" }] };
  globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: String(init?.body ?? "") });
    const json = (value: unknown) => Promise.resolve(new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } }));
    if (url.includes("up-next")) return json([{ id: "s2", title: "Second song", channel: "Marsh" }]);
    if (url.includes("/data/item") || url.includes("item")) return json(item);
    return json({ ok: true });
  }) as unknown as typeof fetch;
});
afterEach(() => { cleanup(); globalThis.fetch = realFetch; });

const media = (): HoistedMedia => ({ id: "s1", src: "/a.mp3", kind: "audio", title: "First song", subtitle: "Marsh", appId: "audio", el: document.createElement("audio"), started: true });

function mount(dock: Partial<MediaDock> = {}, initialView?: "scene" | "lyrics" | "queue") {
  const full: MediaDock = { current: null, clear: () => {}, next: async () => {}, previous: async () => {}, play: async () => {}, ...dock };
  return render(<MediaDockContext.Provider value={full}><NowPlayingStage media={media()} onClose={() => {}} {...(initialView ? { initialView } : {})} /></MediaDockContext.Provider>);
}

describe("lyricsOf", () => {
  test("prefers timed lines, falls back to text, and is null without lyrics", () => {
    expect(lyricsOf({ timed_lyrics: [{ t: 0, line: "a" }], lyrics: "a" })?.lines).toHaveLength(1);
    expect(lyricsOf({ lyrics: "plain" })?.text).toBe("plain");
    expect(lyricsOf({ lyrics: "  " })).toBeNull();
    expect(lyricsOf(null)).toBeNull();
  });
});

describe("stage transport", () => {
  test("previous and next call the host; shuffle and repeat set the mode with labels", async () => {
    const next = mock(async () => {}), previous = mock(async () => {});
    const view = mount({ next, previous });
    fireEvent.click(view.getByRole("button", { name: "Next song" }));
    fireEvent.click(view.getByRole("button", { name: "Previous song" }));
    expect(next).toHaveBeenCalledTimes(1);
    expect(previous).toHaveBeenCalledTimes(1);
    const shuffle = view.getByRole("button", { name: "Shuffle" });
    expect(shuffle).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(shuffle);
    expect(view.getByRole("button", { name: "Shuffle" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(view.getByRole("button", { name: "Repeat off" }));
    fireEvent.click(view.getByRole("button", { name: "Repeat all songs" }));
    expect(view.getByRole("button", { name: "Repeat one song" })).toHaveAttribute("aria-pressed", "true");
  });

  test("like posts the song to the like route and toggles back on failure", async () => {
    const view = mount();
    await waitFor(() => expect(calls.some((c) => c.url.includes("item"))).toBe(true));
    await act(async () => { fireEvent.click(view.getByRole("button", { name: "Like" })); });
    const post = calls.find((c) => c.url.endsWith("/api/plugins/audio/like"));
    expect(JSON.parse(post!.body)).toEqual({ media_id: "s1", on: true });
    expect(view.getByRole("button", { name: "Unlike" })).toHaveAttribute("aria-pressed", "true");
  });

  test("Up next lists the queue and playing a row asks the host", async () => {
    const play = mock(async () => {});
    const view = mount({ play });
    fireEvent.click(view.getByRole("button", { name: "Up next" }));
    const row = await view.findByText("Second song");
    fireEvent.click(row);
    expect(play).toHaveBeenCalledWith("s2");
  });
});

describe("stage lyrics", () => {
  test("the Lyrics button appears only when the song has lyrics and shows them in the stage", async () => {
    const view = mount();
    const button = await view.findByRole("button", { name: "Lyrics" });
    fireEvent.click(button);
    expect(view.getByTestId("stage-lyrics")).toBeTruthy();
    expect(view.getByText("First line")).toBeTruthy();
    cleanup();
    item = { liked: false };
    const bare = mount();
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(bare.queryByRole("button", { name: "Lyrics" })).toBeNull();
  });
});

describe("stage ambient color", () => {
  test("a cover tints the backdrop with variables from its palette; no cover uses tokens", () => {
    const withArt = render(<MediaDockContext.Provider value={{ current: null, clear: () => {}, next: async () => {} }}><NowPlayingStage media={{ ...media(), poster: "/cover.png" }} onClose={() => {}} /></MediaDockContext.Provider>);
    const tint = withArt.getByTestId("stage-ambient");
    expect(tint.style.getPropertyValue("--stage-a")).toMatch(/^#[0-9a-f]{6}$/i);
    expect(tint.getAttribute("data-motion")).toBe("fade");
    cleanup();
    const bare = mount();
    expect(bare.getByTestId("stage-ambient").getAttribute("data-motion")).toBe("tokens");
  });

  test("reduced motion makes the tint still", () => {
    const real = window.matchMedia;
    window.matchMedia = ((q: string) => ({ matches: q.includes("reduce"), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as typeof window.matchMedia;
    try {
      const view = render(<MediaDockContext.Provider value={{ current: null, clear: () => {}, next: async () => {} }}><NowPlayingStage media={{ ...media(), poster: "/cover.png" }} onClose={() => {}} /></MediaDockContext.Provider>);
      expect(view.getByTestId("stage-ambient").getAttribute("data-motion")).toBe("still");
    } finally { window.matchMedia = real; }
  });
});

describe("stage opened from the kit's Up next button", () => {
  test("opening on the queue view lists Up next at once", async () => {
    const view = mount({}, "queue");
    await waitFor(() => expect(view.getByText("Second song")).toBeTruthy());
    expect(view.getByTestId("stage-queue")).toBeTruthy();
  });
});
