import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanup, renderHook } from "@testing-library/react";
import { createMusicPlayer, useMusicClock } from "./musicPlayer";
import { setPlayMode } from "@/shell/media/playMode";
import type { Track } from "./musicQueue";

/** A stand-in for the audio element: the player only needs these. */
class FakeAudio extends EventTarget {
  src = ""; paused = true; currentTime = 0; duration = 100; volume = 1; muted = false; loop = false; preload = ""; dataset: Record<string, string> = {};
  play() { this.paused = false; this.dispatchEvent(new Event("play")); return Promise.resolve(); }
  pause() { this.paused = true; this.dispatchEvent(new Event("pause")); }
  removeAttribute() { this.src = ""; }
}
const t = (key: string): Track => ({ key, url: `/a/${key}`, title: key });
const queue = ["a", "b", "c"].map(t);
let fake: FakeAudio;
const make = () => { fake = new FakeAudio(); return createMusicPlayer(() => fake as unknown as HTMLAudioElement); };

beforeEach(() => setPlayMode({ shuffle: false, repeat: "off" }));

describe("music player", () => {
  test("pressing a song plays it with the queue; pressing it again pauses", () => {
    const player = make();
    player.toggle(t("b"), queue);
    expect(player.get().track?.key).toBe("b");
    expect(player.get().index).toBe(1);
    expect(player.get().playing).toBe(true);
    expect(fake.src).toBe("/a/b");
    player.toggle(t("b"), queue);
    expect(player.get().playing).toBe(false);
  });
  test("next and previous follow the queue; Next at the end says no", () => {
    const player = make();
    player.toggle(t("a"), queue);
    player.next();
    expect(player.get().track?.key).toBe("b");
    player.next();
    expect(player.canNext()).toBe(false);
    player.next();
    expect(player.get().track?.key).toBe("c");
    fake.currentTime = 1;
    player.previous();
    expect(player.get().track?.key).toBe("b");
    fake.currentTime = 10;
    player.previous();
    expect(player.get().track?.key).toBe("b");
    expect(fake.currentTime).toBe(0);
  });
  test("a song that ends moves to the next; the last one stops; repeat all wraps", () => {
    const player = make();
    player.toggle(t("b"), queue);
    fake.dispatchEvent(new Event("ended"));
    expect(player.get().track?.key).toBe("c");
    fake.dispatchEvent(new Event("ended"));
    expect(player.get().playing).toBe(false);
    setPlayMode({ repeat: "all" });
    fake.dispatchEvent(new Event("ended"));
    expect(player.get().track?.key).toBe("a");
  });
  test("repeat one replays the same song when it ends", () => {
    const player = make();
    setPlayMode({ repeat: "one" });
    player.toggle(t("b"), queue);
    fake.dispatchEvent(new Event("ended"));
    expect(player.get().track?.key).toBe("b");
    expect(player.get().playing).toBe(true);
  });
  test("shuffle never repeats a song until all have played", () => {
    const player = make();
    setPlayMode({ shuffle: true });
    player.toggle(t("a"), queue);
    const seen = new Set(["a"]);
    player.next(); seen.add(player.get().track!.key);
    player.next(); seen.add(player.get().track!.key);
    expect(seen.size).toBe(3);
    expect(player.canNext()).toBe(false);
  });
  test("seek stays inside the song; volume is kept; stop clears the queue", () => {
    const player = make();
    player.toggle(t("a"), queue);
    player.seek(500);
    expect(fake.currentTime).toBe(100);
    player.seek(-3);
    expect(fake.currentTime).toBe(0);
    player.seekBy(5);
    expect(fake.currentTime).toBe(5);
    player.setVolume(0.4);
    expect(fake.volume).toBe(0.4);
    player.toggleMute();
    expect(player.volume().muted).toBe(true);
    player.stop();
    expect(player.get().track).toBeNull();
    expect(player.get().queue.length).toBe(0);
  });
  test("a file the browser cannot play marks the player failed, the next song clears it", () => {
    const player = make();
    player.toggle(t("a"), queue);
    fake.dispatchEvent(new Event("error"));
    expect(player.get().failed).toBe(true);
    player.next();
    expect(player.get().failed).toBe(false);
  });
});

// 2026-11-13 live crash: Safari's audio element moves `currentTime` on every read while it plays. The clock hook read the element inside
// React's getSnapshot, so two reads in one render differed, React warned "The result of getSnapshot should be cached" and then threw
// "Maximum update depth exceeded" in the bar's SeekRow, which took the whole page down to the "Something went wrong" screen.
describe("music clock", () => {
  /** An element like Safari's: every read of currentTime while playing is a little later than the last. */
  class LiveClockAudio extends FakeAudio {
    constructor() {
      super();
      let at = 0;
      Object.defineProperty(this, "currentTime", { get: () => { if (!this.paused) at += 0.001; return at; }, set: (value: number) => { at = value; } });
    }
  }
  const makeLive = () => { const live = new LiveClockAudio(); return { live, player: createMusicPlayer(() => live as unknown as HTMLAudioElement) }; };
  afterEach(cleanup);

  test("the clock reads the same between ticks even while the element's time moves", () => {
    const { live, player } = makeLive();
    player.toggle(t("a"), queue);
    const first = player.clock();
    expect(player.clock()).toBe(first);
    live.dispatchEvent(new Event("timeupdate"));
    expect(player.clock()).not.toBe(first);
    expect(player.clock().time).toBeGreaterThan(first.time);
  });
  test("the clock hook renders a playing song without looping", () => {
    const { player } = makeLive();
    player.toggle(t("a"), queue);
    const errors: unknown[] = [];
    const before = console.error;
    console.error = (...args: unknown[]) => { errors.push(args[0]); };
    try {
      const { result } = renderHook(() => useMusicClock(player));
      expect(result.current.duration).toBe(100);
    } finally { console.error = before; }
    expect(errors.map(String).filter((line) => /getSnapshot|Maximum update depth/.test(line))).toEqual([]);
  });
});
