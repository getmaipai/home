import { describe, expect, test } from "bun:test";
import { chirp, doubleTalkDelta, findDelay, measureClip, rms } from "../public/echo-math.js";

describe("echo test signal math", () => {
  test("locates an 80 ms echo and measures its level", () => {
    const rate = 8000;
    const reference = Float32Array.from({ length: 4000 }, (_, i) => Math.sin(i * 0.071) * Math.sin(Math.PI * i / 4000));
    const signal = new Float32Array(6000);
    const delay = Math.round(rate * .08), scale = 10 ** (-20 / 20);
    for (let i = 0; i < reference.length; i++) signal[delay + i] = reference[i] * scale;
    const found = findDelay(signal, reference, rate, 0, 200);
    expect(Math.abs(found.delayMs - 80)).toBeLessThanOrEqual(5);
    const result = measureClip(signal, reference, rate, found.delayMs);
    expect(result.heard).toBe(true);
    expect(20 * Math.log10(result.clipLevel)).toBeCloseTo(-20, 0);
  });

  test("reports noise and silence as not heard", () => {
    const reference = chirp(8000);
    const silence = new Float32Array(12000);
    const noise = Float32Array.from({ length: 12000 }, (_, i) => Math.sin(i * 1.113) * .1);
    expect(measureClip(silence, reference, 8000, 0).heard).toBe(false);
    expect(measureClip(noise, reference, 8000, 0).heard).toBe(false);
  });

  test("projects clip level despite a louder unrelated voice", () => {
    const rate = 8000, reference = Float32Array.from({ length: 4000 }, (_, i) => Math.sin(i * .077));
    const signal = new Float32Array(6000), delay = 640;
    for (let i = 0; i < reference.length; i++) {
      signal[delay + i] = reference[i] * .1 + Math.sin(i * .293) * .4;
    }
    const result = measureClip(signal, reference, rate, 80);
    expect(result.heard).toBe(true);
    expect(20 * Math.log10(result.clipLevel)).toBeCloseTo(-20, 0);
  });

  test("double-talk delta reports unchanged and attenuated voice levels", () => {
    const voice = rms(Float32Array.from({ length: 5000 }, (_, i) => Math.sin(i * .081)));
    expect(doubleTalkDelta(voice, voice)).toBeCloseTo(0, 1);
    expect(doubleTalkDelta(voice, voice * 10 ** (-12 / 20))).toBeCloseTo(-12, 1);
  });
});
