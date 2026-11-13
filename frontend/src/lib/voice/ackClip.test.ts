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

  test("a clip plays to its natural end and says so; only the call closing stops it early (completed false); a render longer than 700 ms is left out", async () => {
    const speech = spyOn(api, "streamSpeech").mockImplementation(async (text: string) => text === "Okay." ? new Response("no", { status: 503 }) : wav());
    try {
      const context = new FakeContext();
      // A long render is dropped from the pool.
      context.decodeAudioData = async () => ({ duration: context.decoded++ === 0 ? 0.45 : 1.2 } as AudioBuffer);
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
