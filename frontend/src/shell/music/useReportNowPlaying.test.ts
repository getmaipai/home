import { describe, expect, test } from "bun:test";
import { createNowPlayingReporter } from "./useReportNowPlaying";
import type { MusicPlayerStore, MusicSnapshot } from "./musicPlayer";

function harness() {
  let snap: MusicSnapshot = { track: null, queue: [], index: -1, playing: false, failed: false, notice: null, manual: [], source: null };
  const listeners = new Set<() => void>();
  const store = { get: () => snap, subscribe(fn: () => void) { listeners.add(fn); return () => listeners.delete(fn); } } as unknown as MusicPlayerStore;
  const change = (track: MusicSnapshot["track"], playing: boolean) => { snap = { ...snap, track, playing }; for (const fn of listeners) fn(); };
  let nextId = 0; const jobs = new Map<number, { fn: () => void; ms: number; interval: boolean }>();
  const timers = { setTimeout(fn: () => void, ms: number) { const id = ++nextId; jobs.set(id, { fn, ms, interval: false }); return id as unknown as ReturnType<typeof setTimeout>; }, clearTimeout(id: ReturnType<typeof setTimeout>) { jobs.delete(id as unknown as number); }, setInterval(fn: () => void, ms: number) { const id = ++nextId; jobs.set(id, { fn, ms, interval: true }); return id as unknown as ReturnType<typeof setInterval>; }, clearInterval(id: ReturnType<typeof setInterval>) { jobs.delete(id as unknown as number); }, pagehide(fn: () => void) { pagehide = fn; return () => { pagehide = undefined; }; } };
  let pagehide: (() => void) | undefined;
  const advance = (ms: number) => { for (const [id, job] of [...jobs]) if (job.ms <= ms) { job.fn(); if (!job.interval) jobs.delete(id); } };
  const sent: Array<{ payload: unknown; keepalive?: boolean }> = [];
  const stop = createNowPlayingReporter(store, (payload, keepalive) => { sent.push({ payload, keepalive }); }, timers);
  return { change, advance, sent, get pagehide() { return pagehide; }, stop };
}
const track = { key: "song-key", url: "", title: "Song", songId: "song-id", state: "done" as const, hasFile: true, mediaType: "audio/mp4" };

describe("Home player reporting", () => {
  test("debounces changes and reports pause", () => { const h = harness(); h.change(track, true); h.change({ ...track, key: "new" }, true); h.advance(600); expect(h.sent).toHaveLength(1); expect(h.sent[0]?.payload).toMatchObject({ state: "playing", key: "new", song_id: "song-id" }); h.change({ ...track, key: "new" }, false); h.advance(600); expect(h.sent[1]?.payload).toEqual({ state: "stopped" }); h.stop(); });
  test("heartbeat repeats every minute only while playing and pagehide stops with keepalive", () => { const h = harness(); h.change(track, true); h.advance(600); h.advance(60_000); expect(h.sent).toHaveLength(2); h.pagehide?.(); expect(h.sent.at(-1)).toMatchObject({ payload: { state: "stopped" }, keepalive: true }); h.change(track, false); h.advance(600); const count = h.sent.length; h.advance(60_000); expect(h.sent).toHaveLength(count); h.stop(); });
  test("a rejected post is swallowed", async () => { const h = harness(); h.stop(); const failing = createNowPlayingReporter(({ get: () => ({ track, playing: true }), subscribe: () => () => {} } as unknown as MusicPlayerStore), async () => { throw new Error("offline"); }, { setTimeout: (fn) => { queueMicrotask(fn); return 1 as unknown as ReturnType<typeof setTimeout>; }, clearTimeout: () => {}, setInterval: () => 2 as unknown as ReturnType<typeof setInterval>, clearInterval: () => {}, pagehide: () => () => {} }); expect(() => failing()).not.toThrow(); await Promise.resolve(); });
  test("the default timers work when the browser rejects a setTimeout called on another object (it crashed every page)", async () => {
    const g = globalThis as unknown as Record<string, unknown>;
    const names = ["setTimeout", "clearTimeout", "setInterval", "clearInterval"];
    const saved = Object.fromEntries(names.map((name) => [name, g[name]]));
    for (const name of names) g[name] = function (this: unknown, ...args: unknown[]) { if (this !== undefined && this !== globalThis) throw new TypeError(`Can only call Window.${name} on instances of Window`); return (saved[name] as (...a: unknown[]) => unknown)(...args); };
    try {
      const fresh = await import(`./useReportNowPlaying?detached-${Math.random()}`) as { createNowPlayingReporter: typeof createNowPlayingReporter };
      let snap = { track: null, playing: false } as unknown as MusicSnapshot;
      const listeners = new Set<() => void>();
      const store = { get: () => snap, subscribe(fn: () => void) { listeners.add(fn); return () => listeners.delete(fn); } } as unknown as MusicPlayerStore;
      const stop = fresh.createNowPlayingReporter(store, () => {});
      snap = { ...snap, track, playing: true } as MusicSnapshot;
      expect(() => { for (const fn of listeners) fn(); stop(); }).not.toThrow();
    } finally { for (const name of names) g[name] = saved[name]; }
  });
});
