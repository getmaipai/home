import { describe, expect, test } from "bun:test";
import { TTS_PROOF_LINES } from "../scripts/bench/tts-proof-lines";
import { clipFraction, compareLine, edgeSilence, parseWav, renderTable, summarize, type LineMetrics, type ProofRow } from "../scripts/bench/ttsProofMetrics";
import { parseArgs } from "../scripts/bench/tts-stack16-d";

function wav(values: number[], format: "pcm" | "float" = "pcm", riffSize = 36 + values.length * (format === "pcm" ? 2 : 4), dataSize = values.length * (format === "pcm" ? 2 : 4)): Uint8Array {
  const bytes = new Uint8Array(44 + values.length * (format === "pcm" ? 2 : 4));
  const view = new DataView(bytes.buffer); const text = (at: number, value: string) => { for (let i = 0; i < value.length; i++) bytes[at + i] = value.charCodeAt(i); };
  text(0, "RIFF"); view.setUint32(4, riffSize, true); text(8, "WAVE"); text(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, format === "pcm" ? 1 : 3, true); view.setUint16(22, 1, true); view.setUint32(24, 10, true); view.setUint32(28, 10 * (format === "pcm" ? 2 : 4), true); view.setUint16(32, format === "pcm" ? 2 : 4, true); view.setUint16(34, format === "pcm" ? 16 : 32, true); text(36, "data"); view.setUint32(40, dataSize, true);
  values.forEach((value, index) => format === "pcm" ? view.setInt16(44 + index * 2, Math.round(value * 32767), true) : view.setFloat32(44 + index * 4, value, true));
  return bytes;
}
const good: LineMetrics = { durationSeconds: 1, clipFraction: 0, leadingSeconds: 0.1, trailingSeconds: 0.1, firstAudioMs: 100 };
const row = (comparison = compareLine(good, good)): ProofRow => ({ line: 1, text: "The garden looks bright today.", home: good, stack: good, comparison });

describe("TTS proof metrics", () => {
  test("parses PCM sine samples, mono format, and duration", () => {
    const parsed = parseWav(wav(Array.from({ length: 100 }, (_, i) => Math.sin(i / 5) * 0.5)));
    expect(parsed.sampleRate).toBe(10); expect(parsed.channels).toBe(1); expect(parsed.bitsPerSample).toBe(16); expect(parsed.durationSeconds).toBe(10); expect(parsed.samples[4]).toBeCloseTo(Math.sin(4 / 5) * 0.5, 3);
  });
  test("parses streaming WAV headers with placeholder sizes from actual bytes", () => {
    const input = wav([0.2, -0.2], "pcm", 0xffffffff, 0xffffffff); const parsed = parseWav(input);
    expect(parsed.samples).toHaveLength(2); expect(parsed.durationSeconds).toBe(0.2);
  });
  test("parses float32 WAV", () => { const parsed = parseWav(wav([0.25, -0.5], "float")); expect(parsed.bitsPerSample).toBe(32); expect([...parsed.samples]).toEqual([0.25, -0.5]); });
  test("rejects garbage bytes with a clear error", () => { expect(() => parseWav(new Uint8Array([1, 2, 3]))).toThrow("Unsupported or invalid WAV"); });
  test("counts clipped samples", () => { expect(clipFraction(new Float32Array([0, 0.999, -1, 0.5]))).toBe(0.5); });
  test("measures one second of leading silence", () => { expect(edgeSilence(new Float32Array([0, 0, 0.4, 0.4]), 2).leadingSeconds).toBe(1); });
  test("all four checks pass on a matched pair", () => { expect(Object.values(compareLine(good, good)).filter((value) => typeof value === "boolean").every(Boolean)).toBe(true); });
  test("duration check fails alone", () => { const c = compareLine(good, { ...good, durationSeconds: 1.1 }); expect(c.durationOk).toBe(false); expect(c.clipOk && c.silenceOk && c.firstAudioOk).toBe(true); });
  test("clip check fails alone", () => { const c = compareLine(good, { ...good, clipFraction: 0.001 }); expect(c.clipOk).toBe(false); expect(c.durationOk && c.silenceOk && c.firstAudioOk).toBe(true); });
  test("silence check fails alone", () => { const c = compareLine(good, { ...good, trailingSeconds: 0.7 }); expect(c.silenceOk).toBe(false); expect(c.durationOk && c.clipOk && c.firstAudioOk).toBe(true); });
  test("first audio check fails alone", () => { const c = compareLine(good, { ...good, firstAudioMs: 126 }); expect(c.firstAudioOk).toBe(false); expect(c.durationOk && c.clipOk && c.silenceOk).toBe(true); });
  test("summarizes check counts and ratios", () => { const summary = summarize([row(), row(compareLine(good, { ...good, durationSeconds: 1.1 }))]); expect(summary.counts.durationOk).toEqual({ ok: 1, notOk: 1 }); expect(summary.durationRatio.median).toBe(1.05); expect(summary.passed).toBe(false); });
  test("renders stable plain text without em dash", () => { const rendered = renderTable([row()]); expect(rendered).toContain("Summary: PASS"); expect(rendered).toContain("duration median"); expect(rendered).not.toContain("—"); });
  test("has thirty unique, non-empty lines in the requested word bands", () => {
    expect(TTS_PROOF_LINES).toHaveLength(30); expect(new Set(TTS_PROOF_LINES).size).toBe(30); expect(TTS_PROOF_LINES.every((line) => line.trim().length > 0)).toBe(true);
    const lengths = TTS_PROOF_LINES.map((line) => line.trim().split(/\s+/).length);
    expect(lengths.slice(0, 10).every((length) => length >= 3 && length <= 6)).toBe(true);
    expect(lengths.slice(10, 20).every((length) => length >= 10 && length <= 18)).toBe(true);
    expect(lengths.slice(20).every((length) => length >= 25 && length <= 40)).toBe(true);
  });
  test("argument parser defaults ports, voice, lines and output", () => { expect(parseArgs([])).toEqual({ homePort: 8795, stackUrl: "http://127.0.0.1:8770", voice: "alba", lines: 30, out: "./tts-stack16-d-results.json", spawnHome: false }); });
  test("argument parser rejects unknown flags", () => { expect(() => parseArgs(["--unknown"])).toThrow("Unknown flag"); });
});
