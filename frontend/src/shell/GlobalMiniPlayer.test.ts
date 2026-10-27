// MEDIA-VIZ-01: when the global mini player steps aside (the page that plays the same item), and the stage clock.
import { describe, expect, test } from "bun:test";
import { onPlayPageOf } from "@/shell/GlobalMiniPlayer";
import { clock } from "@/shell/media/NowPlayingStage";
import { analyserFor } from "@/lib/media/audioGraph";
import type { HoistedMedia } from "@/shell/mediaHost";

const held = (appId: string, id: string) => ({ appId, id, src: "/s", kind: "audio", title: "T", el: document.createElement("audio"), started: true }) as HoistedMedia;

describe("onPlayPageOf", () => {
  test("is true only on the held item's own play page", () => {
    expect(onPlayPageOf(held("music", "m1"), "/apps/music/play", "?id=m1", undefined)).toBe(true);
    expect(onPlayPageOf(held("music", "m1"), "/apps/music/play", "", "m1")).toBe(true);
    expect(onPlayPageOf(held("music", "m1"), "/apps/music/play", "?id=m2", undefined)).toBe(false);
    expect(onPlayPageOf(held("music", "m1"), "/apps/music", "?id=m1", undefined)).toBe(false);
    expect(onPlayPageOf(held("music", "m1"), "/apps/news", "?id=m1", undefined)).toBe(false);
    expect(onPlayPageOf(held("music", "m1"), "/chat", "", undefined)).toBe(false);
    expect(onPlayPageOf(held("books", "b1"), "/apps/books/listen", "", undefined)).toBe(true);
  });
});

describe("stage clock", () => {
  test("formats minutes and hours and survives bad numbers", () => {
    expect(clock(5)).toBe("0:05");
    expect(clock(185)).toBe("3:05");
    expect(clock(3725)).toBe("1:02:05");
    expect(clock(Number.NaN)).toBe("0:00");
  });
});

describe("analyserFor", () => {
  test("gives no tap to a stream from another origin, so its sound is never muted", () => {
    const el = document.createElement("audio");
    el.setAttribute("src", "https://cdn.example.com/a.mp3");
    expect(analyserFor(el)).toBeNull();
  });
});
