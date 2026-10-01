import { describe, expect, test } from "bun:test";
import { compareStt, normalizeText, renderSttTable, resampleLinear, summarizeStt, wordErrorRate, type SttRow } from "../scripts/bench/sttProofMetrics";
import { parseArgs } from "../scripts/bench/stt-stack16-e";

describe("STT proof metrics", () => {
  test("normalizes case and punctuation, retaining internal apostrophes and digits", () => {
    expect(normalizeText("DON'T, stop! 12 cats. 'odd' rock’n’roll")).toBe("don't stop 12 cats odd rock’n’roll");
  });
  test("calculates identical, substitution, insertion, deletion, and empty-reference WER", () => {
    expect(wordErrorRate("a b", "a b")).toEqual({ errors: 0, referenceWords: 2, wer: 0 });
    expect(wordErrorRate("a b", "a c").errors).toBe(1);
    expect(wordErrorRate("a b", "a x b").errors).toBe(1);
    expect(wordErrorRate("a b", "b").errors).toBe(1);
    expect(wordErrorRate("", "").wer).toBe(0); expect(wordErrorRate("", "x").wer).toBe(1);
    // For a b c versus a x c d, one substitution and one insertion are the minimum edit path.
    expect(wordErrorRate("a b c", "a x c d")).toEqual({ errors: 2, referenceWords: 3, wer: 2 / 3 });
  });
  test("resamples 24 kHz to 16 kHz and preserves rough sine zero crossings", () => {
    const sine = Float32Array.from({ length: 2400 }, (_, i) => Math.sin(2 * Math.PI * 440 * i / 24000));
    const resampled = resampleLinear(sine, 24000, 16000);
    expect(resampled).toHaveLength(1600);
    const crossings = (a: Float32Array) => a.slice(1).filter((v, i) => (v >= 0) !== (a[i]! >= 0)).length;
    expect(Math.abs(crossings(resampled) - crossings(sine))).toBeLessThan(3);
    expect([...resampleLinear(new Float32Array([0.2, -0.5]), 16000, 16000)]).toEqual([...new Float32Array([0.2, -0.5])]);
  });
  test("compares WER, normalized identity, and latency", () => {
    expect(compareStt({ text: "Hello!", wer: 0, ms: 100, errors: 0 }, { text: "hello", wer: 0.01, ms: 240, errors: 0 })).toEqual({ stackWerDelta: 1, werOk: true, identical: true, msDelta: 140, msOk: true });
  });
  test("aggregates errors over all reference words rather than averaging line WER", () => {
    const mk = (line: number, words: number, hErr: number, sErr: number): SttRow => {
      const home = { text: "", errors: hErr, wer: hErr / words, ms: 100 }; const stack = { text: "", errors: sErr, wer: sErr / words, ms: 100 };
      return { line, reference: "r", referenceWords: words, home, stack, comparison: compareStt(home, stack) };
    };
    const rows = [mk(1, 1, 0, 1), mk(2, 99, 50, 50)];
    const summary = summarizeStt(rows, true);
    expect((summary.homeWer + summary.stackWer) / 2).toBeGreaterThan(0.5);
    expect(summary.aggregateHomeWer).toBeCloseTo(0.5); expect(summary.aggregateStackWer).toBeCloseTo(0.51); expect(summary.werOk).toBe(true);
  });
  test("renders stable plain text without em dash", () => {
    const home = { text: "same", wer: 0, errors: 0, ms: 10 }; const stack = { ...home };
    const rows: SttRow[] = [{ line: 1, reference: "short reference", referenceWords: 2, home, stack, comparison: compareStt(home, stack) }];
    const output = renderSttTable(rows, summarizeStt(rows, true));
    expect(output).toContain("line home WER stack WER identical home ms stack ms reference"); expect(output).toContain("short reference"); expect(output).not.toContain("—");
  });
  test("argument parser has defaults and rejects unknown flags", () => {
    expect(parseArgs([])).toEqual({ stackUrl: "http://127.0.0.1:8770", voice: "alba", lines: 30, out: "./stt-stack16-e-results.json" });
    expect(() => parseArgs(["--unknown"])).toThrow("Unknown flag");
  });
});
