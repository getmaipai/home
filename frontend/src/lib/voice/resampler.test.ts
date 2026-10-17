import { describe, expect, test } from "bun:test";
import { StreamResampler } from "@/lib/voice/resampler";

function sine(freq: number, rate: number, seconds: number): Float32Array {
  const out = new Float32Array(Math.floor(rate * seconds));
  for (let i = 0; i < out.length; i++) out[i] = Math.sin((2 * Math.PI * freq * i) / rate);
  return out;
}
function zeroCrossingFreq(x: Float32Array, rate: number): number {
  let crossings = 0;
  for (let i = 1; i < x.length; i++) if (x[i - 1]! < 0 && x[i]! >= 0) crossings++;
  return crossings / (x.length / rate);
}

describe("StreamResampler", () => {
  for (const rate of [48_000, 44_100]) {
    test(`${rate} Hz to 16 kHz keeps a 440 Hz tone, across odd chunk sizes`, () => {
      const input = sine(440, rate, 1);
      const r = new StreamResampler(rate);
      const parts: Float32Array[] = [];
      for (let i = 0; i < input.length; i += 1000) parts.push(r.process(input.slice(i, i + 1000)));
      const total = parts.reduce((n, p) => n + p.length, 0);
      const out = new Float32Array(total);
      let o = 0;
      for (const p of parts) { out.set(p, o); o += p.length; }
      expect(Math.abs(out.length - 16_000)).toBeLessThan(5);
      expect(Math.abs(zeroCrossingFreq(out, 16_000) - 440)).toBeLessThan(5);
    });
  }
  test("same rate passes through", () => {
    const x = new Float32Array([1, 2, 3]);
    expect(new StreamResampler(16_000).process(x)).toBe(x);
  });
});
