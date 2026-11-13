// TALK-OVER-01: the acknowledgement clips render once through the speech route, play from memory, and cut with a hard stop whose
// anti-click ramp is at most 20 ms and whose cut lands within 250 ms.
import { describe, expect, spyOn, test } from "bun:test";
import { api } from "@/lib/api";
import { ANTI_CLICK_RAMP_MS } from "@/lib/sentenceSpeechScheduler";
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
  async decodeAudioData() { this.decoded += 1; return { duration: 0.45 } as AudioBuffer; }
}

function wav(): Response {
  const bytes = new Uint8Array(44 + 100);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x52494646, false); view.setUint32(8, 0x57415645, false);
  return new Response(bytes, { status: 200 });
}

describe("TALK-OVER-01: acknowledgement clips", () => {
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

  test("a hard stop ramps the gain to zero in at most 20 ms and stops the source within 250 ms; a clip that fails to render is left out", async () => {
    const speech = spyOn(api, "streamSpeech").mockImplementation(async (text: string) => text === "Okay." ? new Response("no", { status: 503 }) : wav());
    try {
      const context = new FakeContext();
      const pool = await renderAckClips(["Mm-hm.", "Okay."], undefined, { context: context as unknown as AudioContext });
      expect(pool.size).toBe(1);
      const handle = pool.play(0)!;
      const began = performance.now();
      const yieldMs = handle.stop();
      expect(yieldMs).toBeLessThanOrEqual(250);
      const gain = context.gains[context.gains.length - 1]!;
      expect(gain.ramps).toHaveLength(1);
      expect(gain.ramps[0]!.to).toBe(0);
      expect(Math.round((gain.ramps[0]!.at - 10) * 1000)).toBeLessThanOrEqual(20);
      expect(ANTI_CLICK_RAMP_MS).toBeLessThanOrEqual(20);
      await new Promise((resolve) => setTimeout(resolve, ANTI_CLICK_RAMP_MS + 30));
      const source = context.sources[context.sources.length - 1]!;
      expect(source.stopped).toBe(true);
      expect((source.stoppedAt ?? Infinity) - began).toBeLessThanOrEqual(250);
      expect(handle.ended).toBe(true);
      expect(handle.stop()).toBe(0); // a second stop is a no-op
    } finally { speech.mockRestore(); }
  });
});
