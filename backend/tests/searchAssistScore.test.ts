// ROUTER-BUILD-01c: the feature builder and the scoring head are pure; the
// raw-vs-prefixed and alone/pair/concat choices come from the manifest.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { buildFeatures, scoreHead } from "@/lib/searchAssist/score";
import { parseSearchAssistManifest } from "@/lib/searchAssist/weights";

const fixtureText = readFileSync(new URL("../src/lib/searchAssist/__fixtures__/weights.json", import.meta.url), "utf8");
const manifest = parseSearchAssistManifest(JSON.parse(fixtureText));

// Reference values computed once, independently of the TypeScript, from the
// fixture's coef and intercept (softmax of coef . x + intercept).
const REF_CONCAT_A = [0.06897724354230551, 0.9012445545433506, 0.02977820191434382];
const REF_STANDALONE = [0.11148353623680385, 0.8320370099366264, 0.05647945382656979];
const REF_LOW = [0.4973192845186734, 0.4071705923341766, 0.09551012314715006];

describe("search assist features", () => {
  test("concat puts the new question alone first, then the prior pair", () => {
    expect(buildFeatures({ alone: [0.6, 0.8], pair: [0.28, 0.96] }, manifest)).toEqual([0.6, 0.8, 0.28, 0.96]);
  });

  test("a standalone turn with no pair vector uses the alone vector for both halves", () => {
    expect(buildFeatures({ alone: [0.6, 0.8] }, manifest)).toEqual([0.6, 0.8, 0.6, 0.8]);
  });

  test("the manifest picks the shape: alone and pair each use one vector", () => {
    const alone = { ...manifest, features: "alone" as const, coef: manifest.coef.map((r) => r.slice(0, 2)) };
    const pair = { ...manifest, features: "pair" as const, coef: manifest.coef.map((r) => r.slice(0, 2)) };
    expect(buildFeatures({ alone: [1, 0], pair: [0, 1] }, alone)).toEqual([1, 0]);
    expect(buildFeatures({ alone: [1, 0], pair: [0, 1] }, pair)).toEqual([0, 1]);
  });

  test("a vector of the wrong length gives no features instead of a wrong score", () => {
    expect(buildFeatures({ alone: [0.6, 0.8, 0.1] }, manifest)).toBeNull();
    expect(buildFeatures({ alone: [0.6, Number.NaN] }, manifest)).toBeNull();
  });
});

describe("search assist scoring", () => {
  test("p matches the independent reference to 1e-6", () => {
    const a = scoreHead([0.6, 0.8, 0.28, 0.96], manifest, "websearch");
    expect(Math.abs(a.p - REF_CONCAT_A[1]!)).toBeLessThan(1e-6);
    const b = scoreHead([0.6, 0.8, 0.6, 0.8], manifest, "websearch");
    expect(Math.abs(b.p - REF_STANDALONE[1]!)).toBeLessThan(1e-6);
    const c = scoreHead([1, 0, 0, 1], manifest, "websearch");
    expect(Math.abs(c.p - REF_LOW[1]!)).toBeLessThan(1e-6);
  });

  test("at or above the recorded threshold is over; below is not", () => {
    expect(scoreHead([0.6, 0.8, 0.28, 0.96], manifest, "websearch").over).toBe(true);
    expect(scoreHead([1, 0, 0, 1], manifest, "websearch").over).toBe(false);
    const atThreshold = { ...manifest, thresholds: { websearch: { class: "recency", value: REF_CONCAT_A[1]! } } };
    expect(scoreHead([0.6, 0.8, 0.28, 0.96], atThreshold, "websearch").over).toBe(true);
  });

  test("a null threshold means argmax", () => {
    const argmax = { ...manifest, thresholds: { websearch: { class: "recency", value: null } } };
    expect(scoreHead([0.6, 0.8, 0.28, 0.96], argmax, "websearch").over).toBe(true);
    expect(scoreHead([1, 0, 0, 1], argmax, "websearch").over).toBe(false);
  });

  test("a tool with no recorded threshold is never over", () => {
    expect(scoreHead([0.6, 0.8, 0.28, 0.96], manifest, "weather")).toEqual({ p: 0, bucket: "none", over: false });
  });

  test("the bucket is a closed name, never text", () => {
    const names = new Set(["over", "mid", "low", "none"]);
    for (const f of [[0.6, 0.8, 0.28, 0.96], [1, 0, 0, 1], [0, 1, 0, -1]]) {
      expect(names.has(scoreHead(f, manifest, "websearch").bucket)).toBe(true);
    }
  });

  test("a two-class head scores like sklearn's binary layout", () => {
    const binary = {
      ...manifest,
      classes: ["no_tool", "recency"],
      coef: [[1, 0, 0, 0]],
      intercept: [0],
    };
    const r = scoreHead([2, 0, 0, 0], binary, "websearch");
    expect(Math.abs(r.p - 1 / (1 + Math.exp(-2)))).toBeLessThan(1e-9);
  });
});
