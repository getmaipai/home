import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { SentenceSpeechScheduler } from "@/lib/sentenceSpeechScheduler";
import { __resetPlaybackContextForTests, installPlaybackUnlock, primePlaybackAudio, sharedPlaybackContext } from "@/lib/voice/playbackContext";
import { fakeWavBody } from "../../../tests/fakeAudioContext";

// iOS Safari plays nothing through a context that was not resumed inside a tap (2026-10-25: replies stored, none heard).
class FakeSource {
  starts: number[] = []; stops = 0; disconnects = 0; onended: (() => void) | null = null; buffer: unknown = null;
  playbackRate = { value: 1 };
  connect() {} start(when?: number) { this.starts.push(when ?? 0); } stop() { this.stops++; } disconnect() { this.disconnects++; }
}
class FakeContext {
  static made: FakeContext[] = [];
  state = "suspended"; currentTime = 0; destination = {}; resumed = 0; closed = 0; sources: FakeSource[] = [];
  constructor() { FakeContext.made.push(this); }
  async resume() { this.resumed++; this.state = "running"; }
  async suspend() { this.state = "suspended"; }
  async close() { this.closed++; this.state = "closed"; }
  createBuffer(_c: number, length: number, rate: number) { return { duration: length / rate, getChannelData: () => new Float32Array(length) }; }
  createBufferSource() { const s = new FakeSource(); this.sources.push(s); return s; }
  createGain() { return { connect() {}, disconnect() {}, gain: { value: 1 } }; }
  createAnalyser() { return { fftSize: 0, smoothingTimeConstant: 0, frequencyBinCount: 8, connect() {}, disconnect() {}, getByteTimeDomainData: (d: Uint8Array) => d.fill(128) }; }
}

const original = (globalThis as { AudioContext?: unknown }).AudioContext;
beforeEach(() => { FakeContext.made = []; __resetPlaybackContextForTests(); (window as unknown as { AudioContext: unknown }).AudioContext = FakeContext; (globalThis as { AudioContext?: unknown }).AudioContext = FakeContext; });
afterEach(() => { (globalThis as { AudioContext?: unknown }).AudioContext = original; (window as unknown as { AudioContext: unknown }).AudioContext = original; __resetPlaybackContextForTests(); });

describe("playback context", () => {
  test("one context is shared and made again only after the browser closes it", () => {
    const first = sharedPlaybackContext();
    expect(sharedPlaybackContext()).toBe(first);
    (first as unknown as FakeContext).state = "closed";
    expect(sharedPlaybackContext()).not.toBe(first);
    expect(FakeContext.made.length).toBe(2);
  });

  test("a tap primes it: the context resumes and one silent sample plays", () => {
    primePlaybackAudio();
    const context = FakeContext.made[0]!;
    expect(context.resumed).toBe(1);
    expect(context.sources[0]!.starts).toEqual([0]);
  });

  test("the first gesture unlocks it, and a running context is left alone", async () => {
    installPlaybackUnlock();
    document.dispatchEvent(new Event("pointerdown"));
    await Promise.resolve();
    expect(FakeContext.made.length).toBe(1);
    document.dispatchEvent(new Event("pointerdown"));
    expect(FakeContext.made[0]!.resumed).toBe(1);
  });

  test("replies reuse the shared context, and stopping one silences it without closing the context", async () => {
    primePlaybackAudio();
    const context = FakeContext.made[0]!;
    const scheduler = new SentenceSpeechScheduler(undefined, async () => new Response(fakeWavBody() as unknown as BodyInit));
    scheduler.enqueueSentence("hello there");
    scheduler.finish();
    for (let i = 0; i < 8; i++) await new Promise((resolve) => setTimeout(resolve, 0));
    expect(FakeContext.made.length).toBe(1);
    const reply = context.sources.slice(1);
    expect(reply.length).toBeGreaterThan(0);
    scheduler.stop();
    expect(context.closed).toBe(0);
    expect(reply.every((source) => source.stops === 1)).toBe(true);
  });

  test("stopping a paused reply leaves the shared context running for the next one", async () => {
    primePlaybackAudio();
    const context = FakeContext.made[0]!;
    const scheduler = new SentenceSpeechScheduler(undefined, async () => new Response(fakeWavBody() as unknown as BodyInit));
    scheduler.pause();
    await Promise.resolve();
    expect(context.state).toBe("suspended");
    scheduler.stop();
    await Promise.resolve();
    expect(context.state).toBe("running");
  });
});
