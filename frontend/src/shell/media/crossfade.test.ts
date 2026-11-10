// MEDIA-PARITY-02: crossfade with fake elements and a fake clock. No audio plays.
import { describe, expect, test } from "bun:test";
import { attachCrossfade, crossfadeSeconds, fadeDue, handedOff, mayCrossfade, runCrossfade, type CrossfadeDeps, type CrossfadeHeld } from "@/shell/media/crossfade";

class FakeEl extends EventTarget {
  currentTime = 0; duration = 100; paused = false; ended = false; volume = 1; loop = false; src = "";
  playRejects = false; plays = 0; released = false;
  setAttribute(name: string, value: string) { if (name === "src") this.src = value; }
  removeAttribute() { this.src = ""; }
  load() {}
  remove() { this.released = true; }
  pause() { if (!this.paused) { this.paused = true; this.dispatchEvent(new Event("pause")); } }
  async play() { if (this.playRejects) throw new Error("blocked"); this.plays += 1; this.paused = false; }
  tick(to: number) { this.currentTime = to; this.dispatchEvent(new Event("timeupdate")); }
}
const asEl = (el: FakeEl) => el as unknown as HTMLMediaElement;

function clock() {
  let tick: (() => void) | null = null;
  return { setTimer: (fn: () => void) => { tick = fn; return 1; }, clearTimer: () => { tick = null; }, run: () => tick?.(), active: () => tick !== null };
}

describe("settings and rules", () => {
  test("seconds are whole numbers from 0 to 12", () => {
    expect([crossfadeSeconds(5), crossfadeSeconds(99), crossfadeSeconds(-3), crossfadeSeconds("x"), crossfadeSeconds(null), crossfadeSeconds(2.6)]).toEqual([5, 12, 0, 0, 0, 3]);
  });
  const song = { appId: "music", kind: "audio", live: false, loop: false, duration: 200 };
  test("only a song crossfades: not a podcast, audiobook, station, repeat-one song, video or very short song", () => {
    expect(mayCrossfade(song, 6)).toBe(true);
    expect(mayCrossfade(song, 0)).toBe(false);
    expect(mayCrossfade({ ...song, appId: "podcasts" }, 6)).toBe(false);
    expect(mayCrossfade({ ...song, appId: "books" }, 6)).toBe(false);
    expect(mayCrossfade({ ...song, live: true }, 6)).toBe(false);
    expect(mayCrossfade({ ...song, loop: true }, 6)).toBe(false);
    expect(mayCrossfade({ ...song, kind: "video" }, 6)).toBe(false);
    expect(mayCrossfade({ ...song, duration: 10 }, 6)).toBe(false);
    expect(mayCrossfade(song, 6, true)).toBe(false);
  });
  test("the fade is due in the last seconds of a playing song", () => {
    expect(fadeDue({ currentTime: 93, duration: 100, paused: false, ended: false }, 6)).toBe(false);
    expect(fadeDue({ currentTime: 94, duration: 100, paused: false, ended: false }, 6)).toBe(true);
    expect(fadeDue({ currentTime: 96, duration: 100, paused: true, ended: false }, 6)).toBe(false);
  });
});

describe("runCrossfade", () => {
  test("the held song fades down and the next fades up, never above the person's volume", () => {
    const from = new FakeEl(), to = new FakeEl(), time = clock();
    from.duration = 100; from.currentTime = 94; from.volume = 0.8;
    const done: Array<{ paused: boolean }> = [];
    runCrossfade({ from: asEl(from), to: asEl(to), seconds: 6, onDone: (r) => done.push(r), onAbort: () => {}, setTimer: time.setTimer, clearTimer: time.clearTimer });
    expect(to.volume).toBe(0);
    from.currentTime = 97; time.run();
    expect(from.volume).toBeCloseTo(0.8 * Math.cos(Math.PI / 4), 5);
    expect(to.volume).toBeCloseTo(0.8 * Math.sin(Math.PI / 4), 5);
    from.currentTime = 100; time.run();
    expect(done).toEqual([{ paused: false }]);
    expect(to.volume).toBeCloseTo(0.8, 5);
    expect(time.active()).toBe(false);
  });
  test("pausing during the fade hands over once, paused, with nothing playing twice", () => {
    const from = new FakeEl(), to = new FakeEl(), time = clock();
    from.currentTime = 94;
    const done: Array<{ paused: boolean }> = [];
    runCrossfade({ from: asEl(from), to: asEl(to), seconds: 6, onDone: (r) => done.push(r), onAbort: () => {}, setTimer: time.setTimer, clearTimer: time.clearTimer });
    from.pause();
    from.pause();
    expect(done).toEqual([{ paused: true }]);
  });
  test("moving back in the song cancels the fade", () => {
    const from = new FakeEl(), to = new FakeEl(), time = clock();
    from.currentTime = 97;
    let aborted = 0;
    runCrossfade({ from: asEl(from), to: asEl(to), seconds: 6, onDone: () => {}, onAbort: () => { aborted += 1; }, setTimer: time.setTimer, clearTimer: time.clearTimer });
    from.currentTime = 20; time.run();
    expect(aborted).toBe(1);
    expect(from.volume).toBe(1);
  });
});

describe("attachCrossfade", () => {
  const next = { id: "media-b", src: "/b.mp3", title: "B" };
  function setup(over: Partial<CrossfadeDeps> = {}, held: Partial<CrossfadeHeld> = {}) {
    const el = new FakeEl(), incoming = new FakeEl(), time = clock();
    let current: FakeEl = el;
    const primed: string[] = [], hand: string[] = [], elementFor: string[] = [];
    const deps: CrossfadeDeps = {
      seconds: 6, setTimer: time.setTimer, clearTimer: time.clearTimer,
      store: { get: () => ({ el: asEl(current) }), prime: (ref) => { primed.push(ref.id); }, unprime: () => { primed.pop(); },
        elementFor: (ref) => { elementFor.push(ref.id); const taken = incoming; current = taken; return asEl(taken); } },
      pickNext: async () => "media-b", readNext: async () => next, makeElement: () => asEl(incoming),
      afterHandOff: ({ next: n }) => { hand.push(n.id); },
      ...over,
    };
    const heldItem: CrossfadeHeld = { id: "media-a", appId: "music", kind: "audio", src: "/a.mp3", el: asEl(el), live: false, ...held };
    const detach = attachCrossfade(heldItem, deps);
    return { el, incoming, time, primed, hand, elementFor, detach };
  }
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  test("a song with six seconds left starts the next one silent, fades, then hands it over without a restart", async () => {
    const s = setup();
    s.el.tick(50);
    await flush();
    expect(s.incoming.plays).toBe(0);
    s.el.currentTime = 94; s.el.tick(94);
    await flush();
    expect(s.incoming.src).toBe("/b.mp3");
    expect(s.incoming.plays).toBe(1);
    expect(s.primed).toEqual(["media-b"]);
    s.el.currentTime = 100; s.time.run();
    expect(s.elementFor).toEqual(["media-b"]);
    expect(s.hand).toEqual(["media-b"]);
    expect(handedOff.has(asEl(s.el))).toBe(true);
    // The incoming song was never asked to start again.
    expect(s.incoming.plays).toBe(1);
  });
  test("when no next song is there nothing starts", async () => {
    const s = setup({ pickNext: async () => null });
    s.el.tick(95);
    await flush();
    expect(s.incoming.plays).toBe(0);
    expect(s.primed).toEqual([]);
    const gone = setup({ readNext: async () => null });
    gone.el.tick(95);
    await flush();
    expect(gone.incoming.plays).toBe(0);
  });
  test("the same song again (repeat all with one song) is not faded into itself", async () => {
    const s = setup({ pickNext: async () => "media-a" });
    s.el.tick(95);
    await flush();
    expect(s.incoming.plays).toBe(0);
  });
  test("a paused song, a podcast or a setting of 0 never fade", async () => {
    const paused = setup();
    paused.el.paused = true; paused.el.tick(95);
    await flush();
    expect(paused.incoming.plays).toBe(0);
    const pod = setup({}, { appId: "podcasts" });
    pod.el.tick(95);
    await flush();
    expect(pod.incoming.plays).toBe(0);
    const off = setup({ seconds: 0 });
    off.el.tick(95);
    await flush();
    expect(off.incoming.plays).toBe(0);
  });
  test("a browser that will not start the second element leaves the song to end on its own", async () => {
    const s = setup();
    s.incoming.playRejects = true;
    s.el.tick(95);
    await flush();
    expect(s.primed).toEqual([]);
    expect(s.incoming.released).toBe(true);
    expect(s.el.volume).toBe(1);
  });
  test("leaving the song mid-fade puts its volume back and drops the second element", async () => {
    const s = setup();
    s.el.currentTime = 96; s.el.tick(96);
    await flush();
    s.el.currentTime = 98; s.time.run();
    expect(s.el.volume).toBeLessThan(1);
    s.detach();
    expect(s.el.volume).toBe(1);
    expect(s.primed).toEqual([]);
    expect(s.hand).toEqual([]);
  });
});
