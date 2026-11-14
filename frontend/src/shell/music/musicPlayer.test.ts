import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanup, renderHook } from "@testing-library/react";
import { createMusicPlayer, useMusicClock } from "./musicPlayer";
import { setPlayMode } from "@/shell/media/playMode";
import type { Track } from "./musicQueue";

/** A stand-in for the audio element: the player only needs these. */
class FakeAudio extends EventTarget {
  private source = "";
  loads = 0;
  endOnPlay = false;
  crossOrigin: string | null = null;
  get src() { return this.source; }
  set src(value: string) { this.source = value; if (value) { this.loads++; this.currentTime = 0; } }
  paused = true; currentTime = 0; duration = 100; volume = 1; muted = false; loop = false; preload = ""; dataset: Record<string, string> = {};
  play() { this.paused = false; this.dispatchEvent(new Event("play")); if (this.endOnPlay) this.dispatchEvent(new Event("ended")); return Promise.resolve(); }
  pause() { this.paused = true; this.dispatchEvent(new Event("pause")); }
  removeAttribute() { this.src = ""; }
}
const t = (key: string): Track => ({ key, url: `/a/${key}`, title: key });
const queue = ["a", "b", "c"].map(t);
let fake: FakeAudio;
const make = () => { fake = new FakeAudio(); return createMusicPlayer(() => fake as unknown as HTMLAudioElement); };
const realNow = Date.now;
let fakeNow = 10_000;
const advance = (ms = 301) => { fakeNow += ms; };

beforeEach(() => { fakeNow = 10_000; Date.now = () => fakeNow; setPlayMode({ shuffle: false, repeat: "off" }); });
afterEach(() => { Date.now = realNow; });

describe("music player", () => {
  test("pressing a song plays it with the queue; pressing it again pauses", () => {
    const player = make();
    player.toggle(t("b"), queue);
    expect(fake.preload).toBe("metadata");
    expect(fake.crossOrigin).toBe("anonymous");
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
    advance();
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
    fake.currentTime = 100;
    fake.dispatchEvent(new Event("ended"));
    expect(player.get().track?.key).toBe("c");
    fake.currentTime = 100;
    fake.dispatchEvent(new Event("ended"));
    expect(player.get().playing).toBe(false);
    setPlayMode({ repeat: "all" });
    fake.currentTime = 100;
    fake.dispatchEvent(new Event("ended"));
    expect(player.get().track?.key).toBe("a");
  });
  test("repeat one replays the same song when it ends", () => {
    const player = make();
    setPlayMode({ repeat: "one" });
    player.toggle(t("b"), queue);
    fake.currentTime = 100;
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
    advance();
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
  test("an ended event without playback does not advance", () => {
    const player = make();
    player.toggle(t("a"), queue);
    fake.currentTime = 0;
    fake.dispatchEvent(new Event("ended"));
    expect(player.get().track?.key).toBe("a");
    expect(fake.loads).toBe(1);
  });
  test.each([0, Number.NaN])("an ended event with duration %s does not advance", (duration) => {
    const player = make();
    player.toggle(t("a"), queue);
    fake.duration = duration;
    fake.currentTime = 100;
    fake.dispatchEvent(new Event("ended"));
    expect(player.get().track?.key).toBe("a");
    expect(fake.loads).toBe(1);
  });
  test("immediate ended events stop without looping and show the notice", () => {
    fake = new FakeAudio();
    fake.endOnPlay = true;
    const guarded = createMusicPlayer(() => fake as unknown as HTMLAudioElement);
    guarded.toggle(t("a"), queue);
    expect(fake.loads).toBeLessThanOrEqual(2);
    expect(fake.loads).toBe(1);
    expect(guarded.get().notice).toBe("This song could not be played. Check the file and try again.");
  });
  test("an error never advances", () => {
    const player = make();
    player.toggle(t("a"), queue);
    fake.dispatchEvent(new Event("error"));
    expect(player.get().track?.key).toBe("a");
    expect(player.get().failed).toBe(true);
    expect(fake.loads).toBe(1);
  });
  test("a real ended event after playback advances once", () => {
    const player = make();
    player.toggle(t("a"), queue);
    fake.currentTime = 2;
    fake.dispatchEvent(new Event("timeupdate"));
    fake.currentTime = 100;
    fake.dispatchEvent(new Event("ended"));
    expect(player.get().track?.key).toBe("b");
    expect(fake.loads).toBe(2);
  });
  test("two Next presses within 300 ms advance once", () => {
    const player = make();
    player.toggle(t("a"), queue);
    advance();
    player.next();
    player.next();
    expect(player.get().track?.key).toBe("b");
    expect(fake.loads).toBe(2);
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
  test("many reads between ticks give one object, and a seek or a tick gives a new one (the Safari cached clock)", () => {
    const { live, player } = makeLive();
    player.toggle(t("a"), queue);
    const first = player.clock();
    for (let i = 0; i < 50; i++) expect(player.clock()).toBe(first);
    expect(live.currentTime).toBeGreaterThan(first.time);
    player.seek(30);
    expect(player.clock()).not.toBe(first);
    expect(player.clock().time).toBeCloseTo(30, 1);
  });
});
