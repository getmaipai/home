import { describe, expect, test } from "bun:test";
import { EQ_PRESETS, scheduleAudioRamp } from "@/lib/media/audioGraph";
import { boundedBandGains, clampLoudnessGainDb, EQ_FREQUENCIES, LIMITER_SETTINGS, loudnessGainDb, presetGains } from "./musicEq";

describe("music listening chain", () => {
  test("has ten octave-spaced bands and bounded gains", () => {
    expect(EQ_FREQUENCIES).toEqual([31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]);
    expect(boundedBandGains([100, -100])).toEqual([12, -12, 0, 0, 0, 0, 0, 0, 0, 0]);
  });
  test("ships named ten-band presets", () => {
    expect(Object.keys(EQ_PRESETS)).toEqual(["flat", "bass", "treble", "vocal", "loud", "acoustic", "dance", "jazz", "rock"]);
    for (const preset of Object.keys(EQ_PRESETS) as (keyof typeof EQ_PRESETS)[]) expect(presetGains(preset)).toHaveLength(10);
  });
  test("uses limiter settings and clamps loudness gain", () => {
    expect(LIMITER_SETTINGS).toEqual({ threshold: -1, knee: 2, ratio: 20, attack: 0.0015, release: 0.1 });
    expect(clampLoudnessGainDb(20)).toBe(9);
    expect(clampLoudnessGainDb(-20)).toBe(-9);
    expect(loudnessGainDb(-20)).toBe(6);
    expect(loudnessGainDb(undefined)).toBe(0);
  });
  test("ramps an AudioParam with the requested target time", () => {
    const calls: unknown[][] = [];
    const fake = { cancelScheduledValues: (...args: unknown[]) => calls.push(["cancel", ...args]), setTargetAtTime: (...args: unknown[]) => calls.push(["target", ...args]) };
    scheduleAudioRamp(fake as unknown as AudioParam, 0.4, 8, 0.03);
    expect(calls).toEqual([["cancel", 8], ["target", 0.4, 8, 0.01]]);
  });
});
