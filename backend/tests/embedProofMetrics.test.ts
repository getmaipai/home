import { describe, expect, test } from "bun:test";
import { EMBED_PROOF_SENTENCES } from "../scripts/bench/embed-proof-sentences";
import { compareEmbedding, cosine, l2norm, renderEmbedTable, summarizeEmbed, type EmbedRow } from "../scripts/bench/embedProofMetrics";
import { parseArgs } from "../scripts/bench/embed-stack16-e";

const row = (patch: Partial<EmbedRow> = {}): EmbedRow => ({ line: 1, sentence: "The garden looks bright today.", cosine: 1, dimensionsEqual: true, cosineOk: true, homeMs: 10, stackMs: 10, deterministic: true, singleMsDelta: 0, batchRatio: 1, ...patch });

describe("embedding proof metrics", () => {
  test("has 200 unique non-empty sentences in the requested length bands", () => {
    expect(EMBED_PROOF_SENTENCES).toHaveLength(200); expect(new Set(EMBED_PROOF_SENTENCES).size).toBe(200);
    expect(EMBED_PROOF_SENTENCES.every((sentence) => sentence.trim().length > 0)).toBe(true);
    const counts = EMBED_PROOF_SENTENCES.map((sentence) => sentence.trim().split(/\s+/).length);
    expect(counts.slice(0, 67).every((count) => count >= 4 && count <= 8)).toBe(true);
    expect(counts.slice(67, 134).every((count) => count >= 9 && count <= 20)).toBe(true);
    expect(counts.slice(134).every((count) => count >= 21 && count <= 45)).toBe(true);
  });
  test("computes norms and cosine for identical, orthogonal, opposite, and scaled vectors", () => {
    expect(l2norm([3, 4])).toBe(5); expect(cosine([1, 2], [1, 2])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 1])).toBe(0); expect(cosine([1, 0], [-1, 0])).toBe(-1);
    expect(cosine([1, 2], [5, 10])).toBeCloseTo(1);
  });
  test("compares matching dimensions and both sides of the cosine bar", () => {
    expect(compareEmbedding([1, 0], [1, 0])).toEqual({ cosine: 1, dimensionsEqual: true, cosineOk: true });
    expect(compareEmbedding([1, 0], [1, 0.05]).cosineOk).toBe(false);
    expect(compareEmbedding([1, 0], [1, 0.02]).cosineOk).toBe(true);
    expect(compareEmbedding([1, 0], [1]).dimensionsEqual).toBe(false);
  });
  test("summarizes cosine failures", () => {
    const summary = summarizeEmbed([row({ cosine: 0.8, cosineOk: false })]); expect(summary.passed).toBe(false); expect(summary.cosineOk).toBe(0);
  });
  test("summarizes dimension mismatch failure", () => { expect(summarizeEmbed([row({ dimensionsEqual: false })]).passed).toBe(false); });
  test("summarizes nondeterminism failure", () => { expect(summarizeEmbed([row({ deterministic: false })]).passed).toBe(false); });
  test("summarizes single latency failure", () => { expect(summarizeEmbed([row({ singleMsDelta: 50.01 })]).passed).toBe(false); });
  test("summarizes batch throughput failure", () => { expect(summarizeEmbed([row({ batchRatio: 0.79 })]).passed).toBe(false); });
  test("renders aligned plain text without an em dash", () => {
    const rendered = renderEmbedTable([row()], summarizeEmbed([row()]));
    expect(rendered).toContain("Summary: PASS"); expect(rendered).toContain("line  cosine"); expect(rendered).not.toContain("—");
  });
  test("argument parser defaults and unknown flags", () => {
    expect(parseArgs([])).toEqual({ stackUrl: "http://127.0.0.1:8770", homePort: 8796, out: "./embed-stack16-e-results.json", lines: 200, homeModel: "/Users/jessetorres/Developer/github.com/getmaipai/home/data/models/nomic-embed-text-v1.5.Q4_K_M.gguf" });
    expect(() => parseArgs(["--unknown"])).toThrow("Unknown flag");
  });
});
