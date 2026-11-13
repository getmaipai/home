// TALK-OVER-01: the acknowledgement clips render once through the speech route, play from memory, and always play to their end;
// only the call closing stops one (Jesse's rule, 2026-11-12).
import { describe, expect, spyOn, test } from "bun:test";
import { api } from "@/lib/api";
import { renderAckClips } from "@/lib/voice/ackClip";

class FakeGainParam { value = 1; ramps: Array<{ to: number; at: number }> = []; setValueAtTime(v: number) { this.value = v; } linearRampToValueAtTime(to: number, at: number) { this.ramps.push({ to, at }); } cancelScheduledValues() {} }
class FakeContext {
  currentTime = 10;
  state: AudioContextState = "running";
  destination = {};
  sources: Array<{ stopped: boolean; stoppedAt: number | null; onended: (() => void) | null }> = [];
  gains: FakeGainParam[] = [];
  decoded = 0;
  async resume() {}
  createGain() { const gain = new FakeGainParam(); this.gains.push(gain); return { gain, connect() {}, disconnect() {} } as unknown as GainNode; }
  createBufferSource() {
    const source = { buffer: null as AudioBuffer | null, stopped: false, stoppedAt: null as number | null, onended: null as (() => void) | null, connect() {}, disconnect() {}, start() {}, stop() { source.stopped = true; source.stoppedAt = performance.now(); } };
    this.sources.push(source);
    return source as unknown as AudioBufferSourceNode;
  }
  createBuffer(_channels: number, length: number, sampleRate: number) { const data = new Float32Array(length); return { duration: length / sampleRate, sampleRate, length, getChannelData: () => data } as unknown as AudioBuffer; }
  // A decoded clip with sound all the way through (nothing to trim), 0.45 s unless a test overrides it.
  async decodeAudioData() { this.decoded += 1; return sound(0.45); }
}

function sound(seconds: number): AudioBuffer { const rate = 16_000; const data = new Float32Array(Math.round(rate * seconds)); for (let i = 0; i < data.length; i++) data[i] = 0.3 * Math.sin(i / 9); return { duration: seconds, sampleRate: rate, length: data.length, getChannelData: () => data } as unknown as AudioBuffer; }

function wav(): Response {
  const bytes = new Uint8Array(44 + 100);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x52494646, false); view.setUint32(8, 0x57415645, false);
  return new Response(bytes, { status: 200 });
}

describe("TALK-OVER-01: acknowledgement clips", () => {
  test("the engine's silence padding is trimmed before the length check, so a padded 'Mm-hm.' is kept", async () => {
    const { trimSilence, MAX_ACK_CLIP_MS } = await import("@/lib/voice/ackClip");
    const rate = 16_000; const padded = new Float32Array(rate * 1.2); // 1.2 s with 0.4 s of sound in the middle
    for (let i = Math.round(rate * 0.5); i < Math.round(rate * 0.9); i++) padded[i] = 0.3 * Math.sin(i / 9);
    const context = { createBuffer: (_c: number, length: number, sampleRate: number) => { const data = new Float32Array(length); return { duration: length / sampleRate, sampleRate, length, getChannelData: () => data } as unknown as AudioBuffer; } };
    const buffer = { duration: 1.2, sampleRate: rate, length: padded.length, getChannelData: () => padded } as unknown as AudioBuffer;
    const trimmed = trimSilence(buffer, context);
    expect(trimmed.duration * 1000).toBeLessThanOrEqual(MAX_ACK_CLIP_MS);
    expect(Math.round(trimmed.duration * 1000)).toBeGreaterThanOrEqual(400);
    expect(Math.round(trimmed.duration * 1000)).toBeLessThanOrEqual(450);
  });

  test("the pool renders each clip once in the given voice and plays them without repeating the same clip twice in a row", async () => {
    const speech = spyOn(api, "streamSpeech").mockImplementation(async () => wav());
    try {
      const context = new FakeContext();
      const pool = await renderAckClips(["Mm-hm.", "Okay."], "voice-1", { context: context as unknown as AudioContext, now: () => 1000 });
      expect(pool.size).toBe(2);
      expect(context.decoded).toBe(2);
      expect(speech).toHaveBeenCalledTimes(2);
      expect(speech.mock.calls[0]?.[2]).toEqual({ turnId: "", generation: 0, voice: "voice-1" });
      const first = pool.play(1000);
      expect(first?.durationMs).toBe(450);
      let repeated = 0; let previous = context.sources.length;
      for (let i = 0; i < 20; i++) { const handle = pool.play(2000 + i); expect(handle).not.toBeNull(); if (context.sources.length === previous) repeated += 1; previous = context.sources.length; }
      expect(repeated).toBe(0);
    } finally { speech.mockRestore(); }
  });

  test("a clip plays to its natural end and says so; only the call closing stops it early (completed false); a render longer than 700 ms is left out", async () => {
    const speech = spyOn(api, "streamSpeech").mockImplementation(async (text: string) => text === "Okay." ? new Response("no", { status: 503 }) : wav());
    try {
      const context = new FakeContext();
      // A long render is dropped from the pool.
      context.decodeAudioData = async () => sound(context.decoded++ === 0 ? 0.45 : 1.2);
      const pool = await renderAckClips(["Mm-hm.", "Okay.", "Right."], undefined, { context: context as unknown as AudioContext, now: () => 100 });
      expect(pool.size).toBe(1);
      const played = pool.play(50)!;
      expect(played.ended).toBe(false);
      expect(played.completed).toBe(false);
      // The source reaches its end: completed.
      context.sources[context.sources.length - 1]!.onended?.();
      expect(played.ended).toBe(true);
      expect(played.completed).toBe(true);
      expect(played.endedAt).toBe(100);
      expect(context.sources[context.sources.length - 1]!.stopped).toBe(false);
      // Another clip, cut only by the call closing.
      const second = pool.play(200)!;
      pool.stopAll();
      expect(second.ended).toBe(true);
      expect(second.completed).toBe(false);
      expect(context.sources[context.sources.length - 1]!.stopped).toBe(true);
      // Nothing else on the handle can stop it: there is no stop at all.
      expect("stop" in second).toBe(false);
    } finally { speech.mockRestore(); }
  });
});
