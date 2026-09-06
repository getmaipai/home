import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { SttSession, encodeWav, decodeWav, isLikelySpeech } from "@/lib/sttSession";
import { __setSttBackendForTests, __resetSttForTests } from "@/lib/stt";
import type { SttWireEvent } from "@maipai/spec/voice/ts/sttTypes.js";

const SAMPLE_RATE = 16_000;
const FRAME = 160; // 10ms @ 16kHz, a plausible mic frame size

function silenceFrame(): Float32Array {
  return new Float32Array(FRAME);
}

function loudFrame(amplitude = 0.5): Float32Array {
  const out = new Float32Array(FRAME);
  for (let i = 0; i < FRAME; i++) out[i] = amplitude * Math.sin(i);
  return out;
}

function quietFrame(): Float32Array {
  // Below VAD_ONSET_RMS (0.02) but above true silence - typing/fan noise.
  const out = new Float32Array(FRAME);
  for (let i = 0; i < FRAME; i++) out[i] = 0.005 * Math.sin(i);
  return out;
}

function config(overrides: Partial<{ silenceTimeoutS: number; partialIntervalS: number }> = {}) {
  return { sampleRate: SAMPLE_RATE, silenceTimeoutS: 0.3, partialIntervalS: 10, ...overrides };
}

async function flush(): Promise<void> {
  // pushPcm() chains through async work (the RMS fallback path is
  // synchronous per frame, but emitPartial()/finalize() are not) - give
  // the microtask queue a few turns to drain between pushed frames.
  await new Promise((r) => setTimeout(r, 0));
}

afterEach(() => {
  __resetSttForTests();
});

describe("SttSession - RMS fallback VAD (no Silero model installed in tests)", () => {
  test("silence alone never opens an utterance or calls transcribe", async () => {
    let called = false;
    __setSttBackendForTests(async () => {
      called = true;
      return "should never be called";
    });
    const events: SttWireEvent[] = [];
    const session = new SttSession(config(), (e) => events.push(e));

    for (let i = 0; i < 20; i++) session.pushPcm(silenceFrame());
    await flush();

    expect(called).toBe(false);
    expect(events.some((e) => e.t === "vad" && e.speaking)).toBe(false);
    session.close();
  });

  test("typing/fan-level noise (above true silence, below VAD_ONSET_RMS) never opens an utterance", async () => {
    __setSttBackendForTests(async () => "should never fire");
    const events: SttWireEvent[] = [];
    const session = new SttSession(config(), (e) => events.push(e));

    for (let i = 0; i < 40; i++) session.pushPcm(quietFrame());
    await flush();

    expect(events.some((e) => e.t === "vad" && e.speaking)).toBe(false);
    session.close();
  });

  test("a loud tone opens an utterance, and silence past the timeout finalizes it with the scripted transcript", async () => {
    __setSttBackendForTests(async () => "hello there");
    const events: SttWireEvent[] = [];
    const session = new SttSession(config({ silenceTimeoutS: 0.05 }), (e) => events.push(e));

    for (let i = 0; i < 20; i++) session.pushPcm(loudFrame());
    await flush();
    expect(events.some((e) => e.t === "vad" && e.speaking === true)).toBe(true);

    // Enough silence frames to clear the 0.05s timeout (160 samples/frame @ 16kHz = 10ms/frame).
    for (let i = 0; i < 10; i++) session.pushPcm(silenceFrame());
    await flush();
    await flush();

    const final = events.find((e) => e.t === "final");
    expect(final).toEqual({ t: "final", v: "hello there" });
    session.close();
  });

  test("an empty buffer shorter than the minimum speech fraction reports no_speech, not final", async () => {
    __setSttBackendForTests(async () => "should not be reached");
    const events: SttWireEvent[] = [];
    const session = new SttSession(config({ silenceTimeoutS: 0.01 }), (e) => events.push(e));

    // One loud frame (10ms) is well under MIN_SPEECH_SAMPLES_FRAC (0.2s).
    session.pushPcm(loudFrame());
    await flush();
    session.pushPcm(silenceFrame());
    await flush();
    await flush();

    expect(events.some((e) => e.t === "no_speech")).toBe(true);
    expect(events.some((e) => e.t === "final")).toBe(false);
    session.close();
  });

  test("a transcript that's only a bracketed annotation is treated as no_speech, not a real turn", async () => {
    __setSttBackendForTests(async () => "[BLANK_AUDIO]");
    const events: SttWireEvent[] = [];
    const session = new SttSession(config({ silenceTimeoutS: 0.05 }), (e) => events.push(e));

    for (let i = 0; i < 30; i++) session.pushPcm(loudFrame());
    await flush();
    for (let i = 0; i < 10; i++) session.pushPcm(silenceFrame());
    await flush();
    await flush();

    expect(events.some((e) => e.t === "no_speech")).toBe(true);
    expect(events.some((e) => e.t === "final")).toBe(false);
    session.close();
  });

  test("end() flushes an in-progress utterance without waiting for the silence timeout", async () => {
    __setSttBackendForTests(async () => "flushed early");
    const events: SttWireEvent[] = [];
    // A long timeout that would never fire on its own within this test.
    const session = new SttSession(config({ silenceTimeoutS: 10 }), (e) => events.push(e));

    for (let i = 0; i < 20; i++) session.pushPcm(loudFrame());
    await flush();
    session.end();
    await flush();
    await flush();

    expect(events.some((e) => e.t === "final" && e.v === "flushed early")).toBe(true);
    session.close();
  });

  test("the 30s force-flush fires on an unbroken loud tone that never dips into silence", async () => {
    __setSttBackendForTests(async () => "force flushed");
    const events: SttWireEvent[] = [];
    const session = new SttSession(config({ silenceTimeoutS: 60 }), (e) => events.push(e));

    // 30s @ 16kHz / 160-sample frames = 3000 frames to cross MAX_SPEECH_SECONDS.
    const framesFor30s = (30 * SAMPLE_RATE) / FRAME;
    for (let i = 0; i < framesFor30s + 5; i++) {
      session.pushPcm(loudFrame());
    }
    await flush();
    await flush();

    expect(events.some((e) => e.t === "final" && e.v === "force flushed")).toBe(true);
    session.close();
  });
});

describe("SttSession - Moonshine silent-head retry", () => {
  test("an empty first transcription retries once from the voiced onset (dropping the pre-roll) before giving up", async () => {
    let calls: { samplesLen: number }[] = [];
    __setSttBackendForTests(async (samples) => {
      calls.push({ samplesLen: samples.length });
      // First call (includes pre-roll) returns empty; the retry (shorter,
      // pre-roll dropped) returns real text.
      return calls.length === 1 ? "" : "recovered on retry";
    });
    const events: SttWireEvent[] = [];
    const session = new SttSession(config({ silenceTimeoutS: 0.05 }), (e) => events.push(e));

    for (let i = 0; i < 30; i++) session.pushPcm(loudFrame());
    await flush();
    for (let i = 0; i < 10; i++) session.pushPcm(silenceFrame());
    await flush();
    await flush();

    expect(calls.length).toBeGreaterThanOrEqual(1);
    const final = events.find((e) => e.t === "final");
    expect(final).toEqual({ t: "final", v: "recovered on retry" });
    session.close();
  });
});

describe("isLikelySpeech()", () => {
  test("real words are speech", () => {
    expect(isLikelySpeech("hello there")).toBe(true);
  });
  test("a bracketed annotation alone is not speech", () => {
    expect(isLikelySpeech("[BLANK_AUDIO]")).toBe(false);
  });
  test("a parenthetical alone is not speech", () => {
    expect(isLikelySpeech("(keyboard clicking)")).toBe(false);
  });
  test("music notes alone are not speech", () => {
    expect(isLikelySpeech("♪♪♪")).toBe(false);
  });
  test("an empty string is not speech", () => {
    expect(isLikelySpeech("")).toBe(false);
  });
});

describe("encodeWav()/decodeWav()", () => {
  test("round-trips a synthetic waveform through 16-bit mono PCM", () => {
    const original = new Float32Array(1000);
    for (let i = 0; i < original.length; i++) original[i] = Math.sin(i / 10) * 0.5;

    const wav = encodeWav(original, SAMPLE_RATE);
    const { samples, sampleRate } = decodeWav(wav);

    expect(sampleRate).toBe(SAMPLE_RATE);
    expect(samples.length).toBe(original.length);
    // 16-bit quantization is lossy - close, not exact.
    for (let i = 0; i < original.length; i++) {
      expect(Math.abs(samples[i]! - original[i]!)).toBeLessThan(0.001);
    }
  });

  test("rejects a non-WAV byte blob", () => {
    expect(() => decodeWav(new Uint8Array([1, 2, 3, 4]))).toThrow();
  });
});
