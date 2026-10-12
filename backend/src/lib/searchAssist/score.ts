// ROUTER-BUILD-01c: pure scoring. Nothing here reads state, the clock or the
// network. The feature shape (alone, pair, concat) comes from the weights
// manifest, so a retrained head changes the manifest, not this code.
import type { SearchAssistManifest } from "./weights";

export interface FeatureVectors {
  /** The new question alone, raw (the recall embedding). */
  alone: readonly number[];
  /** The prior question/answer plus the new question. Omit on a standalone
   * turn, where that text equals the alone text and so does its vector. */
  pair?: readonly number[];
}

/** Null when a vector has the wrong length or a non-finite value, so a
 * mismatch can never become a wrong score. */
export function buildFeatures(vectors: FeatureVectors, manifest: SearchAssistManifest): number[] | null {
  const dims = manifest.embed.dims;
  const alone = vectors.alone;
  const pair = vectors.pair ?? vectors.alone;
  const ok = (v: readonly number[]) => v.length === dims && v.every((x) => Number.isFinite(x));
  const parts = manifest.features === "alone" ? [alone] : manifest.features === "pair" ? [pair] : [alone, pair];
  if (!parts.every(ok)) return null;
  return parts.flatMap((v) => [...v]);
}

export interface HeadScore {
  /** Probability of the tool's recorded class, 0 when the tool has no row. */
  p: number;
  /** Closed names only: over, mid, low, none. */
  bucket: "over" | "mid" | "low" | "none";
  over: boolean;
}

function probabilities(features: readonly number[], m: SearchAssistManifest): number[] {
  const z = m.coef.map((row, i) => row.reduce((s, c, j) => s + c * (features[j] ?? 0), m.intercept[i] ?? 0));
  if (m.classes.length === 2 && z.length === 1) {
    // sklearn's binary layout: one row, positive for classes[1].
    const p1 = 1 / (1 + Math.exp(-z[0]!));
    return [1 - p1, p1];
  }
  const max = Math.max(...z);
  const e = z.map((v) => Math.exp(v - max));
  const sum = e.reduce((a, b) => a + b, 0);
  return e.map((v) => v / sum);
}

/** Softmax over the classes, then the tool's recorded threshold on its class
 * (argmax when the recorded value is null). */
export function scoreHead(features: readonly number[], manifest: SearchAssistManifest, tool: string): HeadScore {
  const rule = manifest.thresholds[tool];
  if (!rule) return { p: 0, bucket: "none", over: false };
  const probs = probabilities(features, manifest);
  const idx = manifest.classes.indexOf(rule.class);
  if (idx < 0) return { p: 0, bucket: "none", over: false };
  const p = probs[idx]!;
  const over = rule.value === null ? probs.every((q) => q <= p) : p >= rule.value;
  const bar = rule.value ?? 0.5;
  return { p, bucket: over ? "over" : p >= bar / 2 ? "mid" : "low", over };
}
