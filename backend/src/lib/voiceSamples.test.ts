import { describe, expect, test } from "bun:test";
import { decodeWavClip, encodeWavClip } from "@/lib/voiceShift";
import { joinReferenceClips, prepareStyleClip, normalizePeak, trimSilence } from "@/lib/voiceSamples";

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
  test("pads the joined clip so it does not start or end on a hard edge", async () => {
    const result = await joinReferenceClips([{ bytes: tone(8, 0.5), extension: "wav" }]);
    if (!result.ok) throw new Error("join failed");
    const pcm = decodeWavClip(result.wav)!;
    expect(Math.max(...pcm.samples.slice(0, 6000).map(Math.abs))).toBeLessThan(0.01);
    expect(Math.max(...pcm.samples.slice(-6000).map(Math.abs))).toBeLessThan(0.01);
  });
  test("a style recording under 6 seconds is refused with a plain next step", async () => {
    const short = await prepareStyleClip(tone(3, 0.5), "wav", "whisper");
    expect(short.ok).toBe(false);
    if (!short.ok) expect(short.error).toContain("too short");
    expect((await prepareStyleClip(tone(10, 0.5), "wav", "anger")).ok).toBe(true);
  });
});

describe("cleaning options", () => {
  test("builds the filter chain from the chosen options", async () => {
    const { cleanFilter } = await import("@/lib/voiceSamples");
    expect(cleanFilter({})).toBeNull();
    expect(cleanFilter({ noise: true })).toContain("afftdn");
    expect(cleanFilter({ echo: true })).toContain("agate");
  });
  test("runs real ffmpeg cleaning when ffmpeg exists and the clip stays usable", async () => {
    const { cleanWav } = await import("@/lib/voiceSamples");
    const { findFfmpeg } = await import("@/lib/ffmpegPath");
    if (!findFfmpeg()) return;
    const out = await cleanWav(tone(4, 0.5, 24000), { noise: true, echo: true });
    expect(out).not.toBeNull();
    expect(decodeWavClip(out!)).not.toBeNull();
  });
});

describe("isolate the voice", () => {
  test("uses the isolated voice track, and says what to do when the splitter is not ready", async () => {
    const { __isolateForTests } = await import("@/lib/voiceSamples");
    let received = 0;
    __isolateForTests.run = async (wav) => { received = wav.length; return tone(8, 0.5, 24000); };
    const ok = await joinReferenceClips([{ bytes: tone(8, 0.2), extension: "wav" }], { isolate: true });
    expect(ok.ok).toBe(true);
    expect(received).toBeGreaterThan(1000);
    __isolateForTests.run = async () => null;
    const bad = await joinReferenceClips([{ bytes: tone(8, 0.2), extension: "wav" }], { isolate: true });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toContain("stem splitter");
    __isolateForTests.run = null;
  });
});

describe("remove echo", () => {
  test("uses the speech enhancer when it answers, and falls back to the ffmpeg gate with a plain notice when it does not", async () => {
    const { __enhanceForTests, ECHO_FALLBACK_NOTICE } = await import("@/lib/voiceSamples");
    let received = 0;
    __enhanceForTests.run = async (wav) => { received = wav.length; return tone(8, 0.5, 24000); };
    const ok = await joinReferenceClips([{ bytes: tone(8, 0.2), extension: "wav" }], { echo: true });
    expect(ok.ok).toBe(true);
    expect(received).toBeGreaterThan(1000);
    if (ok.ok) expect(ok.notice).toBeUndefined();
    __enhanceForTests.run = async () => null;
    const fallback = await joinReferenceClips([{ bytes: tone(8, 0.2), extension: "wav" }], { echo: true });
    if (fallback.ok) expect(fallback.notice).toBe(ECHO_FALLBACK_NOTICE);
    __enhanceForTests.run = null;
  });
});
