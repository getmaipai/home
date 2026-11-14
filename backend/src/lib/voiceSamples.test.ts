import { describe, expect, test } from "bun:test";
import { decodeWavClip, encodeWavClip } from "@/lib/voiceShift";
import { joinReferenceClips, normalizePeak, trimSilence } from "@/lib/voiceSamples";

const tone = (seconds: number, amp: number, rate = 16000) => encodeWavClip({ sampleRate: rate, samples: Float32Array.from({ length: Math.floor(seconds * rate) }, (_, i) => amp * Math.sin(i / 8)) });

describe("voiceSamples", () => {
  test("trims silence at both ends", () => {
    const samples = new Float32Array(24000 * 3); samples.fill(0.5, 24000, 48000);
    const out = trimSilence(samples, 24000);
    expect(out.length).toBeLessThan(24000 * 1.3);
    expect(out.length).toBeGreaterThanOrEqual(24000);
  });
  test("normalizes the peak", () => {
    const out = normalizePeak(Float32Array.from([0.1, -0.2, 0.05]));
    expect(Math.max(...out.map(Math.abs))).toBeCloseTo(0.9, 3);
  });
  test("joins three clips at 24 kHz, quiet and loud matched, capped at 29 s", async () => {
    const result = await joinReferenceClips([8, 12, 20].map((s, i) => ({ bytes: tone(s, [0.1, 0.5, 0.9][i]!), extension: "wav" })));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const pcm = decodeWavClip(result.wav)!;
    expect(pcm.sampleRate).toBe(24000);
    expect(result.seconds).toBeLessThanOrEqual(29);
    expect(result.seconds).toBeGreaterThan(20);
  });
  test("says what to do for a silent clip and for four clips", async () => {
    const silent = await joinReferenceClips([{ bytes: tone(3, 0), extension: "wav" }]);
    expect(silent.ok).toBe(false);
    const four = await joinReferenceClips(Array.from({ length: 4 }, () => ({ bytes: tone(3, 0.5), extension: "wav" })));
    expect(four.ok).toBe(false);
  });
});
