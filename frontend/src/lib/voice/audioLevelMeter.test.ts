import { describe, expect, test } from "bun:test";
import { createLevelMeter } from "@/lib/voice/audioLevelMeter";

// A minimal fake AnalyserNode/AudioContext - only what createLevelMeter
// itself calls (fakeAudioContext.ts's own shared fake is for
// sentenceSpeechScheduler.ts's real playback path, a different shape;
// this file's own concern is the meter's math, isolated from either
// caller).
function fakeContextWithFixedByte(byte: number): AudioContext {
  const analyser = {
    fftSize: 0,
    smoothingTimeConstant: 0,
    frequencyBinCount: 8,
    connect: () => {},
    disconnect: () => {},
    getByteTimeDomainData: (data: Uint8Array) => data.fill(byte),
  };
  return { createAnalyser: () => analyser } as unknown as AudioContext;
}

function fakeSource(): AudioNode {
  return { connect: () => {} } as unknown as AudioNode;
}

describe("createLevelMeter", () => {
  test("silence (every byte at the 128 center) reads 0", () => {
    const context = fakeContextWithFixedByte(128);
    const meter = createLevelMeter(context, fakeSource());
    expect(meter.read()).toBe(0);
  });

  test("a full-scale wave (byte 255, the most a Uint8Array can hold) reads a real, positive level", () => {
    const context = fakeContextWithFixedByte(255);
    const meter = createLevelMeter(context, fakeSource());
    const level = meter.read();
    expect(level).toBeGreaterThan(0);
    expect(level).toBeLessThanOrEqual(1);
  });

  test("stop() makes every later read() return 0, whatever the analyser still holds", () => {
    const context = fakeContextWithFixedByte(255);
    const meter = createLevelMeter(context, fakeSource());
    expect(meter.read()).toBeGreaterThan(0);
    meter.stop();
    expect(meter.read()).toBe(0);
  });
});
