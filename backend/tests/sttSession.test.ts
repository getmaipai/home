import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test";
import { SttSession, encodeWav, decodeWav, isLikelySpeech, __setSileroLoaderForTests, __resetSileroLoaderForTests, type Endpointer } from "@/lib/sttSession";
import { __resetStackEngineForTests, __setStackClientForTests } from "@/lib/stackEngine";
import { setHouseholdSettingValue } from "@/lib/settings";
import { startStackFixture, type StackFixture } from "./stackFixture";
import type { SttWireEvent } from "@maipai/spec/voice/ts/sttTypes.js";
import type { SileroVadStream } from "@/lib/sileroVad";

const SAMPLE_RATE = 16_000;
const FRAME = 160; // 10ms @ 16kHz, a plausible mic frame size
let fixture: StackFixture | undefined;

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
  return { sampleRate: 16_000, silenceTimeoutS: 0.3, partialIntervalS: 10, ...overrides };
}

function transcriptionCalls(): number {
  return fixture?.calls.filter((call) => call === "POST /v1/audio/transcriptions").length ?? 0;
}

async function flush(): Promise<void> {
  // pushPcm() chains through async work (the RMS fallback path is
  // synchronous per frame, but emitPartial()/finalize() are not) - give
  // the microtask queue a few turns to drain between pushed frames.
  await new Promise((r) => setTimeout(r, 10));
}

async function settleEndpoint(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 280));
  await flush();
}

afterEach(() => {
  fixture?.stop();
  fixture = undefined;
  __resetStackEngineForTests();
  __setStackClientForTests(null);
  __resetSileroLoaderForTests();
});

beforeEach(() => __setSileroLoaderForTests(async () => null));

function scriptTranscript(text: string): void {
  fixture = startStackFixture({ "POST /v1/audio/transcriptions": async () => Response.json({ text }) });
  setHouseholdSettingValue("engines.stack.url", fixture.url);
  __setStackClientForTests(fixture.client);
}

async function pushPause(session: SttSession, pauseMs: number): Promise<void> {
  for (let i = 0; i < pauseMs / 10; i++) session.pushPcm(silenceFrame());
  await flush();
}

async function pushSentence(session: SttSession, pauseMs: number): Promise<void> {
  for (let i = 0; i < 30; i++) session.pushPcm(loudFrame());
  await flush();
  await pushPause(session, pauseMs);
  for (let i = 0; i < 30; i++) session.pushPcm(loudFrame());
  await flush();
  for (let i = 0; i < 40; i++) session.pushPcm(silenceFrame());
  await flush();
  await flush();
}

function finals(events: SttWireEvent[]): SttWireEvent[] {
  return events.filter((event) => event.t === "final");
}

function endpointConfig(endpointer: Endpointer, holdS = 0.8) {
  return { ...config(), endpointing: { endpointer, holdS } };
}

describe("SttSession reply pause", () => {
  let voice = false;
  async function voicedSession(now: () => number = () => 1000) {
    const events: SttWireEvent[] = [];
    voice = false;
    __setSileroLoaderForTests(async () => ({
      failed: false,
      push: async () => [voice ? 0.9 : 0.1],
      reset: () => {},
    } as unknown as SileroVadStream));
    const session = new SttSession(config({ silenceTimeoutS: 0.8 }), (event) => events.push(event), now);
    await flush();
    return { session, events };
  }
  async function frames(session: SttSession, count: number, voiced: boolean) {
    voice = voiced;
    for (let i = 0; i < count; i++) session.pushPcm(voiced ? loudFrame() : silenceFrame());
    await flush();
  }
  // A partial transcript can land at any moment (it depends on how fast the recognizer answers), so these tests read only the pause events.
  const types = (events: SttWireEvent[]) => events.map((event) => event.t).filter((type) => type !== "partial");

  afterEach(() => __resetSileroLoaderForTests());

  test("without played_ms, a voiced onset only emits vad", async () => {
    const { session, events } = await voicedSession();
    await frames(session, 1, true);
    expect(types(events)).toEqual(["vad"]);
    session.close();
  });

  test("a playing reply is paused right after the vad onset", async () => {
    const { session, events } = await voicedSession();
    session.notePlayback("reply", 0, 1000);
    await frames(session, 1, true);
    expect(types(events)).toEqual(["vad", "reply_pause"]);
    session.close();
  });

  test("voice that continues past 0.4 s confirms the speech and sends no resume", async () => {
    const { session, events } = await voicedSession();
    session.notePlayback("reply", 0, 1000);
    await frames(session, 60, true);
    expect(types(events)).toEqual(["vad", "reply_pause"]);
    session.close();
  });

  test("silence after a short burst resumes the reply once, after 0.4 s", async () => {
    const { session, events } = await voicedSession();
    session.notePlayback("reply", 0, 1000);
    await frames(session, 1, true);
    await frames(session, 30, false);
    expect(types(events)).toEqual(["vad", "reply_pause"]);
    await frames(session, 20, false);
    expect(types(events).filter((type) => type === "reply_resume")).toHaveLength(1);
    session.close();
  });

  test("a third unconfirmed burst within 10 s is not paused", async () => {
    const { session, events } = await voicedSession();
    session.notePlayback("reply", 0, 1000);
    for (let burst = 0; burst < 3; burst++) {
      await frames(session, 1, true);
      await frames(session, 120, false); // resumes at 0.4 s, then the utterance ends and the state resets
    }
    expect(types(events).filter((type) => type === "reply_pause")).toHaveLength(2);
    expect(types(events).filter((type) => type === "reply_resume")).toHaveLength(2);
    session.close();
  });

  test("a pause still open at 1.5 s counts as confirmed and never resumes", async () => {
    const { session, events } = await voicedSession();
    session.notePlayback("reply", 0, 1000);
    await frames(session, 1, true);
    await frames(session, 12, true);
    await frames(session, 3, false);
    await frames(session, 140, true);
    expect(types(events).filter((type) => type === "reply_resume")).toHaveLength(0);
    session.close();
  });

  test("a short sound that ends the utterance while paused resumes the reply with no speech found", async () => {
    const { session, events } = await voicedSession();
    session.notePlayback("reply", 0, 1000);
    session.close();
    const second = await voicedSession();
    second.session.notePlayback("reply", 0, 1000);
    await frames(second.session, 1, true);
    await frames(second.session, 100, false);
    expect(types(second.events).filter((type) => type === "reply_resume")).toHaveLength(1);
    void events;
    second.session.close();
  });

  test("a pause the server stopped managing (voice confirmed) still resumes the reply when the transcript holds no speech", async () => {
    scriptTranscript("");
    const { session, events } = await voicedSession();
    session.notePlayback("reply", 0, 1000);
    await frames(session, 60, true);
    expect(types(events)).toEqual(["vad", "reply_pause"]);
    await frames(session, 120, false);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(types(events).filter((type) => type === "reply_resume")).toHaveLength(1);
    expect(types(events)).toContain("no_speech");
    session.close();
  });

  test("a confirmed pause whose transcript is real speech sends no resume", async () => {
    scriptTranscript("did he really win four");
    const { session, events } = await voicedSession();
    session.notePlayback("reply", 0, 1000);
    await frames(session, 60, true);
    await frames(session, 120, false);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(types(events).filter((type) => type === "reply_resume")).toHaveLength(0);
    expect(events.some((event) => event.t === "final")).toBe(true);
    session.close();
  });

  test("a playback report older than 700 ms does not count as playing", async () => {
    const { session, events } = await voicedSession(() => 2000);
    session.notePlayback("reply", 0, 1000);
    await frames(session, 1, true);
    expect(types(events)).toEqual(["vad"]);
    session.close();
  });
});

describe("SttSession - RMS fallback VAD (no Silero model installed in tests)", () => {
  test("a held mid-sentence pause that resumes produces one final carrying the whole utterance and nothing else", async () => {
    const receivedSamples: number[] = [];
    fixture = startStackFixture({
      "POST /v1/audio/transcriptions": async (req) => {
        const form = await req.formData();
        const file = form.get("file") as unknown as File;
        receivedSamples.push((file.size - 44) / 2);
        return Response.json({ text: "the whole resumed utterance" });
      },
    });
    setHouseholdSettingValue("engines.stack.url", fixture.url);
    __setStackClientForTests(fixture.client);
    const events: SttWireEvent[] = [];
    let endpointCalls = 0;
    const session = new SttSession(endpointConfig({ isComplete: async () => endpointCalls++ > 0 }), (e) => events.push(e));

    for (let i = 0; i < 30; i++) session.pushPcm(loudFrame());
    await flush();
    await pushPause(session, 600);
    expect(finals(events)).toHaveLength(0);
    for (let i = 0; i < 30; i++) session.pushPcm(loudFrame());
    await flush();
    for (let i = 0; i < 30; i++) session.pushPcm(silenceFrame());
    await flush();
    await flush();

    expect(finals(events)).toEqual([{ t: "final", v: "the whole resumed utterance" }]);
    expect(events.filter((event) => event.t === "no_speech" || event.t === "error")).toHaveLength(0);
    expect(receivedSamples).toHaveLength(1);
    expect(receivedSamples[0]).toBeGreaterThan(30 * FRAME * 2);
    session.close();
  });

  test("a held pause that never resumes ends at the hold limit with one final and no second event", async () => {
    scriptTranscript("held utterance");
    const events: SttWireEvent[] = [];
    let endpointCalls = 0;
    const session = new SttSession(endpointConfig({ isComplete: async () => { endpointCalls++; return false; } }, 0.2), (e) => events.push(e));

    for (let i = 0; i < 30; i++) session.pushPcm(loudFrame());
    await flush();
    await pushPause(session, 600);
    // The final waits on a transcription request, which can outlast one flush under load (issue 279).
    for (let i = 0; i < 100 && finals(events).length === 0; i++) await flush();
    const afterHold = [...events];
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(finals(events)).toHaveLength(1);
    expect(events).toEqual(afterHold);
    expect(endpointCalls).toBe(1);
    expect(transcriptionCalls()).toBe(1);
    session.close();
  });

  test("the first fragment of a held utterance is never sent as its own final", async () => {
    scriptTranscript("whole utterance, not the fragment");
    const events: SttWireEvent[] = [];
    let endpointCalls = 0;
    const session = new SttSession(endpointConfig({ isComplete: async () => endpointCalls++ > 0 }), (e) => events.push(e));

    for (let i = 0; i < 30; i++) session.pushPcm(loudFrame());
    await flush();
    await pushPause(session, 600);
    expect(finals(events)).toHaveLength(0);
    for (let i = 0; i < 30; i++) session.pushPcm(loudFrame());
    await flush();
    for (let i = 0; i < 30; i++) session.pushPcm(silenceFrame());
    await flush();
    await flush();

    expect(finals(events)).toEqual([{ t: "final", v: "whole utterance, not the fragment" }]);
    expect(transcriptionCalls()).toBe(1);
    session.close();
  });

  test("with no endpointer, a 600 ms pause ends the utterance as before", async () => {
    scriptTranscript("one utterance");
    const events: SttWireEvent[] = [];
    const session = new SttSession(config(), (e) => events.push(e));

    for (let i = 0; i < 30; i++) session.pushPcm(loudFrame());
    await flush();
    await pushPause(session, 600);
    for (let i = 0; i < 30; i++) session.pushPcm(loudFrame());
    await flush();
    for (let i = 0; i < 30; i++) session.pushPcm(silenceFrame());
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(finals(events)).toHaveLength(2);
    expect(transcriptionCalls()).toBe(2);
    session.close();
  });

  test("with the endpointer on and answering not finished, a 600 ms mid-sentence pause does not end the utterance", async () => {
    scriptTranscript("whole sentence");
    const events: SttWireEvent[] = [];
    let endpointCalls = 0;
    const endpointer = { isComplete: async () => endpointCalls++ === 0 ? false : true };
    const session = new SttSession(endpointConfig(endpointer), (e) => events.push(e));

    for (let i = 0; i < 30; i++) session.pushPcm(loudFrame());
    await flush();
    await pushPause(session, 600);
    for (let i = 0; i < 30; i++) session.pushPcm(loudFrame());
    await flush();
    for (let i = 0; i < 30; i++) session.pushPcm(silenceFrame());
    await flush();
    await flush();

    expect(endpointCalls).toBe(2);
    expect(finals(events)).toHaveLength(1);
    expect(transcriptionCalls()).toBe(1);
    session.close();
  });

  test("with the endpointer on and answering finished, the utterance ends at the base silence", async () => {
    scriptTranscript("finished");
    const events: SttWireEvent[] = [];
    const session = new SttSession(endpointConfig({ isComplete: async () => true }), (e) => events.push(e));

    for (let i = 0; i < 30; i++) session.pushPcm(loudFrame());
    await flush();
    await pushPause(session, 300);
    await flush();

    expect(finals(events)).toHaveLength(1);
    expect(transcriptionCalls()).toBe(1);
    session.close();
  });

  test("a pause longer than the hold still ends the utterance", async () => {
    scriptTranscript("held sentence");
    const events: SttWireEvent[] = [];
    let calls = 0;
    const session = new SttSession(endpointConfig({ isComplete: async () => { calls++; return false; } }, 0.2), (e) => events.push(e));

    for (let i = 0; i < 30; i++) session.pushPcm(loudFrame());
    await flush();
    await pushPause(session, 500);

    expect(finals(events)).toHaveLength(1);
    expect(calls).toBe(1);
    session.close();
  });

  test("an endpointer that throws or hangs fails open to the normal end", async () => {
    for (const endpointer of [
      { isComplete: async () => { throw new Error("private transcript must not appear"); } },
      { isComplete: () => new Promise<boolean>(() => {}) },
    ]) {
      scriptTranscript("fail open");
      const events: SttWireEvent[] = [];
      const session = new SttSession(endpointConfig(endpointer), (e) => events.push(e));
      for (let i = 0; i < 30; i++) session.pushPcm(loudFrame());
      await flush();
      await pushPause(session, 300);
      await settleEndpoint();
      await flush();
      expect(finals(events)).toHaveLength(1);
      session.close();
      fixture?.stop();
      fixture = undefined;
      __resetStackEngineForTests();
      __setStackClientForTests(null);
    }
  });

  test("the endpointer is asked once per silence run, not once per frame", async () => {
    scriptTranscript("one silence");
    const events: SttWireEvent[] = [];
    let calls = 0;
    const session = new SttSession(endpointConfig({ isComplete: async () => { calls++; return false; } }, 1), (e) => events.push(e));
    for (let i = 0; i < 30; i++) session.pushPcm(loudFrame());
    await flush();
    await pushPause(session, 300);
    await settleEndpoint();
    expect(calls).toBe(1);
    session.close();
  });

  test("vad speaking false is sent when the utterance ends, not at the first silent frame, in hold mode", async () => {
    scriptTranscript("held");
    const events: SttWireEvent[] = [];
    const session = new SttSession(endpointConfig({ isComplete: async () => false }, 0.2), (e) => events.push(e));
    for (let i = 0; i < 30; i++) session.pushPcm(loudFrame());
    await flush();
    await pushPause(session, 350);
    expect(events.some((e) => e.t === "vad" && e.speaking === false)).toBe(false);
    await pushPause(session, 200);
    expect(events.some((e) => e.t === "vad" && e.speaking === false)).toBe(true);
    session.close();
  });

  test("silence alone never opens an utterance or calls transcribe", async () => {
    const events: SttWireEvent[] = [];
    const session = new SttSession(config(), (e) => events.push(e));

    for (let i = 0; i < 20; i++) session.pushPcm(silenceFrame());
    await flush();

    expect(events.some((e) => e.t === "vad" && e.speaking)).toBe(false);
    expect(transcriptionCalls()).toBe(0);
    session.close();
  });

  test("typing/fan-level noise (above true silence, below VAD_ONSET_RMS) never opens an utterance", async () => {
    scriptTranscript("should never fire");
    const events: SttWireEvent[] = [];
    const session = new SttSession(config(), (e) => events.push(e));

    for (let i = 0; i < 40; i++) session.pushPcm(quietFrame());
    await flush();

    expect(events.some((e) => e.t === "vad" && e.speaking)).toBe(false);
    expect(transcriptionCalls()).toBe(0);
    session.close();
  });

  test("a loud tone opens an utterance, and silence past the timeout finalizes it with the scripted transcript", async () => {
    scriptTranscript("hello there");
    const events: SttWireEvent[] = [];
    const session = new SttSession(config({ silenceTimeoutS: 0.05 }), (e) => events.push(e));

    for (let i = 0; i < 20; i++) session.pushPcm(loudFrame());
    await flush();
    expect(events.some((e) => e.t === "vad" && e.speaking === true)).toBe(true);

    // Enough silence frames to clear the timeout (160 samples/frame @ 16kHz = 10ms/frame).
    for (let i = 0; i < 10; i++) session.pushPcm(silenceFrame());
    await flush();
    await flush();

    expect(transcriptionCalls()).toBeGreaterThan(0);
    const final = events.find((e) => e.t === "final");
    expect(final).toEqual({ t: "final", v: "hello there" });
    session.close();
  });

  test("the speech socket never sends a raw engine message to the browser", async () => {
    const sentinel = "unique-engine-sentinel";
    fixture = startStackFixture({ "POST /v1/audio/transcriptions": async () => Response.json({ error: sentinel }, { status: 503 }) });
    setHouseholdSettingValue("engines.stack.url", fixture.url);
    __setStackClientForTests(fixture.client);
    const errorLog = spyOn(console, "error").mockImplementation(() => {});
    const events: SttWireEvent[] = [];
    const session = new SttSession(config({ silenceTimeoutS: 0.05 }), (event) => events.push(event));
    for (let i = 0; i < 20; i++) session.pushPcm(loudFrame());
    await flush();
    for (let i = 0; i < 10; i++) session.pushPcm(silenceFrame());
    await flush();
    await flush();
    const error = events.find((event) => event.t === "error");
    expect(error?.t === "error" && error.v.includes(sentinel)).toBe(false);
    expect(JSON.stringify(errorLog.mock.calls).includes(sentinel)).toBe(true);
    session.close();
    errorLog.mockRestore();
  });

  test("an empty buffer shorter than the minimum speech fraction reports no_speech, not final", async () => {
    scriptTranscript("should not be reached");
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
    scriptTranscript("(keyboard clicking)");
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
    scriptTranscript("flushed early");
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

  test("end() on a listen where nobody spoke answers no_speech at once", async () => {
    const events: SttWireEvent[] = [];
    const session = new SttSession(config({ silenceTimeoutS: 10 }), (e) => events.push(e));

    for (let i = 0; i < 5; i++) session.pushPcm(silenceFrame());
    await flush();
    session.end();
    await flush();
    await flush();

    expect(events.filter((e) => e.t === "no_speech")).toHaveLength(1);
    expect(events.some((e) => e.t === "final")).toBe(false);
    session.close();
  });

  test("the 30s force-flush fires on an unbroken loud tone that never dips into silence", async () => {
    scriptTranscript("force flushed");
    const events: SttWireEvent[] = [];
    const session = new SttSession(config({ silenceTimeoutS: 60 }), (e) => events.push(e));

    // 30s @ 16kHz / 160-sample frames = 3000 frames to cross MAX_SPEECH_SECONDS.
    const framesFor30s = (30 * SAMPLE_RATE) / FRAME;
    for (let i = 0; i < framesFor30s + 5; i++) {
      session.pushPcm(loudFrame());
      if (i % 100 === 99) await flush();
    }
    await flush();
    await flush();

    expect(events.some((e) => e.t === "final" && e.v === "force flushed")).toBe(true);
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
