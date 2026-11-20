import { expect, test } from "bun:test";
import { PlaybackBuffer } from "../public/playback-buffer.js";
import { LocalDuckDetector } from "../public/local-duck.js";
import { TurnState } from "../public/turn-state.js";

test("playback buffer preserves received samples across pause, append, resume, duck and stop", () => {
  const b = new PlaybackBuffer();
  const all = Float32Array.from({ length: 5000 }, (_, i) => i);
  for (let i = 0; i < 5000; i += 500) b.append(all.subarray(i, i + 500));
  const heard = [...b.read(2300)];
  b.pause();
  b.append(Float32Array.from({ length: 100 }, (_, i) => i + 5000));
  b.resume(1000);
  const replay = [...b.read(3000)];
  expect(replay[0]).toBe(2180);
  expect([...heard.slice(0, 2180), ...replay]).toEqual([...all.slice(0, 2180), ...all.slice(2180), ...Array.from({ length: 100 }, (_, i) => i + 5000)]);
  const cursor = b.cursor;
  b.duck(); b.restore();
  expect(b.cursor).toBe(cursor);
  b.stop(); b.append([7, 8]);
  expect([...b.read(2)]).toEqual([7, 8]);
});

test("page turn state rejects stopped and older turns and accepts a new generation", () => {
  const state = new TurnState();
  expect(state.accepts(4)).toBe(true);
  expect(state.stop(4)).toBe(true);
  expect(state.accepts(4)).toBe(false);
  expect(state.accepts(3)).toBe(false);
  expect(state.accepts(5)).toBe(true);
  expect(state.isCurrent(4)).toBe(false);
});

test("local duck ignores steady noise and triggers within two burst frames only during playback", () => {
  const detector = new LocalDuckDetector();
  const noise = new Float32Array(512).fill(0.001);
  for (let i = 0; i < 100; i++) expect(detector.frame(noise, { playing: false })).toBe(false);
  for (let i = 0; i < 4; i++) expect(detector.frame(new Float32Array(512).fill(0.1), { playing: false })).toBe(false);
  const active = new LocalDuckDetector();
  for (let i = 0; i < 100; i++) active.frame(noise, { playing: false });
  for (let i = 0; i < 50; i++) expect(active.frame(noise, { playing: true })).toBe(false);
  expect(active.frame(new Float32Array(512).fill(0.1), { playing: true })).toBe(false);
  expect(active.frame(new Float32Array(512).fill(0.1), { playing: true })).toBe(true);
});
import { WarmGate } from "../public/warmup.js";
test("warm-up gate: the microphone stays closed until the server reports the voice loaded; the page says so in plain words and never starts silently", () => {
  const g = new WarmGate(1000); expect(g.open).toBe(false); expect(g.line(2000)).toContain("Warming up"); expect(g.line(25000)).toContain("taking longer");
  expect(g.onMessage({ t: "warm", part: "chat", ms: 300 })).toBe(false); expect(g.open).toBe(false);   // the chat model alone is not enough
  expect(g.onMessage({ t: "warm", part: "voice", ms: 400 })).toBe(true); expect(g.open).toBe(true);
  g.reset(5000); expect(g.open).toBe(false);                                                           // a reconnect warms up again
});
