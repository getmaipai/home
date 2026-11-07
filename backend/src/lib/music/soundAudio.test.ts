import { describe, expect, test } from "bun:test";
import { crossfadeLoopWav, mixSoundAtWav, trimWav, wavOfPcm } from "./soundAudio";
import { SAMPLE_RATE } from "./mixParts";

const frames = (seconds: number) => Math.round(seconds * SAMPLE_RATE);
/** Stereo 16-bit PCM from a per-frame function. */
function wavOf(seconds: number, sample: (i: number) => number): Uint8Array {
  const pcm = new Int16Array(frames(seconds) * 2);
  for (let i = 0; i < pcm.length / 2; i++) { const v = Math.round(sample(i)); pcm[i * 2] = v; pcm[i * 2 + 1] = v; }
  return wavOfPcm(pcm);
}
const pcm = (wav: Uint8Array) => { const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength); return Int16Array.from({ length: (wav.length - 44) / 2 }, (_, i) => view.getInt16(44 + i * 2, true)); };
const rms = (samples: Int16Array, from: number, to: number) => { let sum = 0; for (let i = from; i < to; i++) sum += samples[i]! * samples[i]!; return Math.sqrt(sum / (to - from)); };
// A deterministic noise-like signal (no period), the worst case for a seam.
const noise = (i: number) => 9000 * Math.sin(i * 0.37) * Math.cos(i * 0.011) + 4000 * Math.sin(i * 1.9);

describe("crossfadeLoopWav", () => {
  test("the loop is the fade shorter and has no jump where the end meets the start", () => {
    const out = pcm(crossfadeLoopWav(wavOf(4, noise)));
    expect(out.length / 2).toBe(frames(4) - Math.round(0.5 * SAMPLE_RATE));
    const last = out[out.length - 2]!, first = out[0]!;
    // The largest step between neighbouring samples inside the sound is the natural scale of a step.
    let biggest = 0; for (let i = 2; i < out.length; i += 2) biggest = Math.max(biggest, Math.abs(out[i]! - out[i - 2]!));
    expect(Math.abs(first - last)).toBeLessThanOrEqual(biggest);
  });
  test("the first and last 50 ms carry the same level within a small tolerance", () => {
    const out = pcm(crossfadeLoopWav(wavOf(4, noise)));
    const n = frames(0.05) * 2;
    const head = rms(out, 0, n), tail = rms(out, out.length - n, out.length);
    expect(Math.abs(head - tail) / tail).toBeLessThan(0.1);
  });
  test("the fade blends the tail into the head with equal power", () => {
    const out = pcm(crossfadeLoopWav(wavOf(2, () => 8000)));
    // A constant signal blended with itself by an equal-power fade stays within 3 dB of itself and returns to it.
    const mid = out[frames(0.25) * 2]!;
    expect(mid).toBeGreaterThan(8000 * 0.99);
    expect(mid).toBeLessThan(8000 * 1.45);
    expect(out[out.length - 2]).toBe(8000);
  });
  test("a sound too short to fade is returned unchanged", () => {
    const wav = wavOf(0.2, noise);
    expect(crossfadeLoopWav(wav)).toBe(wav);
  });
});

describe("mixSoundAtWav", () => {
  test("lays the sound in at the start time and keeps the song's length", () => {
    const song = wavOf(4, () => 1000), sound = wavOf(1, () => 2000);
    const out = pcm(mixSoundAtWav(song, sound, 2));
    expect(out.length).toBe(frames(4) * 2);
    expect(out[frames(1) * 2]).toBe(1000);
    expect(out[frames(2) * 2 + 20]).toBe(3000);
    expect(out[frames(3.5) * 2]).toBe(1000);
  });
  test("cuts a sound that runs past the end and turns the mix down instead of clipping", () => {
    const song = wavOf(2, () => 30000), sound = wavOf(2, () => 30000);
    const out = pcm(mixSoundAtWav(song, sound, 1.5));
    expect(out.length).toBe(frames(2) * 2);
    expect(Math.max(...out)).toBeLessThanOrEqual(32767 * 0.98 + 1);
  });
  test("refuses a start time at or after the end", () => {
    expect(() => mixSoundAtWav(wavOf(2, () => 1), wavOf(1, () => 1), 2)).toThrow("start_after_end");
  });
});

describe("trimWav", () => {
  test("cuts to the asked length and fades the last 30 ms to silence", () => {
    const out = pcm(trimWav(wavOf(10, () => 5000), 3));
    expect(out.length).toBe(frames(3) * 2);
    expect(out[frames(1) * 2]).toBe(5000);
    expect(Math.abs(out[out.length - 2]!)).toBeLessThan(10);
  });
  test("a sound already that short is returned unchanged", () => {
    const wav = wavOf(2, () => 5000);
    expect(trimWav(wav, 3)).toBe(wav);
  });
});
