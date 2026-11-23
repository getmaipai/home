import { beforeEach, describe, expect, test } from "bun:test";
import { createMusicPlayer } from "./musicPlayer";
import { pendingTrackOf } from "./musicHandoff";
import { setPlayMode } from "@/shell/media/playMode";
import type { Track } from "./musicQueue";

class FakeAudio extends EventTarget {
  private source = "";
  crossOrigin: string | null = null;
  get src() { return this.source; }
  set src(value: string) { this.source = value; if (value) this.currentTime = 0; }
  paused = true; currentTime = 0; duration = 100; volume = 1; muted = false; loop = false; preload = ""; dataset: Record<string, string> = {};
  play() { this.paused = false; this.dispatchEvent(new Event("play")); return Promise.resolve(); }
  pause() { this.paused = true; this.dispatchEvent(new Event("pause")); }
  removeAttribute() { this.src = ""; }
}
const t = (key: string): Track => ({ key, url: `/a/${key}`, title: key, state: "done", hasFile: true, mediaType: "audio/mp4" });
const make = () => createMusicPlayer(() => new FakeAudio() as unknown as HTMLAudioElement, () => "probably");
beforeEach(() => setPlayMode({ shuffle: false, repeat: "off" }));

describe("the clicked song shows in the mini player at once", () => {
  test("pendingTrackOf takes the title, the artist line and the artwork from the clicked shelf item", () => {
    expect(pendingTrackOf({ title: "Pancakes", channel: "Sage", thumbnail: "/thumb" }, "media-1")).toEqual({ key: "media-1", title: "Pancakes", subtitle: "Sage", artworkUrl: "/thumb" });
    expect(pendingTrackOf({ title: "Pancakes", subtitle: "Band" }, "shuffle:media-2")).toEqual({ key: "media-2", title: "Pancakes", subtitle: "Band", artworkUrl: null });
    expect(pendingTrackOf({ title: "Pancakes", poster: "/poster" }, "media-3")?.artworkUrl).toBe("/poster");
  });

  test("an item with no title gives nothing to show", () => {
    expect(pendingTrackOf({}, "media-1")).toBeNull();
    expect(pendingTrackOf({ title: "   " }, "media-1")).toBeNull();
  });

  test("showPending puts the clicked song in the snapshot before any track loads, and the real track clears it", () => {
    const player = make();
    expect(player.get().pending).toBeNull();
    player.showPending({ key: "b", title: "B", artworkUrl: "/b" });
    expect(player.get().pending).toEqual({ key: "b", title: "B", artworkUrl: "/b" });
    expect(player.get().track).toBeNull();
    player.toggle(t("b"), [t("a"), t("b")]);
    expect(player.get().pending).toBeNull();
    expect(player.get().track?.key).toBe("b");
  });

  test("showPending(null) clears it and stop drops it", () => {
    const player = make();
    player.showPending({ key: "b", title: "B", artworkUrl: null });
    player.showPending(null);
    expect(player.get().pending).toBeNull();
    player.showPending({ key: "c", title: "C", artworkUrl: null });
    player.stop();
    expect(player.get().pending).toBeNull();
  });
});
