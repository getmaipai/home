// ACT-02: the generic multinomial (softmax) head shared by all three
// classifiers (act, stance, emotion) trained by turn-signal-heads.ts. One
// module because the math is IDENTICAL across heads (a linear layer over
// the same 768-dim nomic vector, class-weighted cross-entropy, temperature
// scaling, precision-oriented thresholds) - the only thing that differs
// per head is its label set and its data. Lifted and generalized from
// ../../../../home-codex-act02/backend/scripts/train/turn-signal-heads.ts
// (an earlier, emotion-only draft): the math here is unchanged from that
// draft, just parameterized on `numClasses`/`dim` instead of hardcoded
// module-level constants, so one implementation now serves three heads
// instead of being copy-pasted per head.
import { seededShuffle, mulberry32 } from "../bench/datasets/sample";

export interface SoftmaxModel {
  /** Row-major, numClasses x dim. */
  W: Float64Array;
  b: Float64Array;
  numClasses: number;
  dim: number;
}

export function createModel(numClasses: number, dim: number): SoftmaxModel {
  return { W: new Float64Array(numClasses * dim), b: new Float64Array(numClasses), numClasses, dim };
}

export function logits(model: SoftmaxModel, x: Float32Array): Float64Array {
  const out = new Float64Array(model.numClasses);
  for (let c = 0; c < model.numClasses; c++) {
    let sum = model.b[c]!;
    const rowOffset = c * model.dim;
    for (let d = 0; d < model.dim; d++) sum += model.W[rowOffset + d]! * x[d]!;
    out[c] = sum;
  }
  return out;
}

export function softmax(z: ArrayLike<number>): number[] {
  const max = Math.max(...Array.from(z));
  const exps = Array.from(z, (v) => Math.exp(v - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((v) => v / sum);
}

/** Inverse-frequency class weights, normalized to mean 1 - a class with
 * zero examples gets weight 0 (never divides by zero) rather than being
 * silently dropped from the loss shape. */
export function classWeights(labelIndices: readonly number[], numClasses: number): number[] {
  const counts = new Array(numClasses).fill(0);
  for (const l of labelIndices) counts[l]++;
  const n = labelIndices.length;
  const raw = counts.map((c) => (c > 0 ? n / (numClasses * c) : 0));
  const mean = raw.reduce((a, b) => a + b, 0) / numClasses;
  return mean > 0 ? raw.map((w) => w / mean) : raw;
}

export interface TrainOptions {
  epochs: number;
  batchSize: number;
  learningRate: number;
  l2: number;
  /** Stop once this many epochs pass with no dev-metric improvement. */
  patience: number;
  seed?: number;
}

/** Plain minibatch gradient descent (no momentum, no adaptive rates) over
 * class-weighted cross-entropy, stopping early once `patience` epochs pass
 * with no dev-metric improvement. */
export function trainSoftmaxRegression(
  X: Float32Array[],
  y: number[],
  weights: readonly number[],
  numClasses: number,
  dim: number,
  opts: TrainOptions,
  evalEachEpoch?: (model: SoftmaxModel, epoch: number) => number,
): { model: SoftmaxModel; bestEpoch: number; history: Array<{ epoch: number; loss: number; devMetric: number | null }> } {
  const n = X.length;
  const rand = mulberry32(opts.seed ?? 42);
  const model = createModel(numClasses, dim);

  const order = Array.from({ length: n }, (_, i) => i);
  const history: Array<{ epoch: number; loss: number; devMetric: number | null }> = [];
  let bestModel: SoftmaxModel = { W: model.W.slice(), b: model.b.slice(), numClasses, dim };
  let bestMetric = -Infinity;
  let bestEpoch = 0;
  let epochsSinceImprovement = 0;

  for (let epoch = 0; epoch < opts.epochs; epoch++) {
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [order[i], order[j]] = [order[j]!, order[i]!];
    }
    let epochLoss = 0;
    for (let start = 0; start < n; start += opts.batchSize) {
      const idxBatch = order.slice(start, start + opts.batchSize);
      const gW = new Float64Array(numClasses * dim);
      const gB = new Float64Array(numClasses);
      for (const i of idxBatch) {
        const x = X[i]!;
        const label = y[i]!;
        const w = weights[label]!;
        const z = logits(model, x);
        const p = softmax(z);
        epochLoss += -w * Math.log(Math.max(p[label]!, 1e-12));
        for (let c = 0; c < numClasses; c++) {
          const grad = w * (p[c]! - (c === label ? 1 : 0));
          const rowOffset = c * dim;
          for (let d = 0; d < dim; d++) gW[rowOffset + d]! += grad * x[d]!;
          gB[c]! += grad;
        }
      }
      const invBatch = 1 / idxBatch.length;
      for (let k = 0; k < gW.length; k++) model.W[k]! -= opts.learningRate * (gW[k]! * invBatch + opts.l2 * model.W[k]!);
      for (let k = 0; k < gB.length; k++) model.b[k]! -= opts.learningRate * (gB[k]! * invBatch);
    }
    const devMetric = evalEachEpoch ? evalEachEpoch(model, epoch) : null;
    history.push({ epoch, loss: epochLoss / n, devMetric });
    if (devMetric !== null) {
      if (devMetric > bestMetric) {
        bestMetric = devMetric;
        bestEpoch = epoch;
        bestModel = { W: model.W.slice(), b: model.b.slice(), numClasses, dim };
        epochsSinceImprovement = 0;
      } else if (++epochsSinceImprovement >= opts.patience) {
        break;
      }
    }
  }
  return { model: evalEachEpoch ? bestModel : model, bestEpoch, history };
}

// ---------------------------------------------------------------------------
// Temperature scaling (Guo et al. 2017): a single scalar T>0 minimizing NLL
// on a held-out split, found by golden-section search.
// ---------------------------------------------------------------------------
export function nllAtTemperature(allLogits: readonly Float64Array[], y: readonly number[], T: number): number {
  let total = 0;
  for (let i = 0; i < allLogits.length; i++) {
    const scaled = Array.from(allLogits[i]!, (v) => v / T);
    const p = softmax(scaled);
    total += -Math.log(Math.max(p[y[i]!]!, 1e-12));
  }
  return total / allLogits.length;
}

export function fitTemperature(allLogits: readonly Float64Array[], y: readonly number[]): number {
  let lo = 0.05;
  let hi = 10;
  for (let pass = 0; pass < 40; pass++) {
    const m1 = lo + (hi - lo) / 3;
    const m2 = hi - (hi - lo) / 3;
    const f1 = nllAtTemperature(allLogits, y, m1);
    const f2 = nllAtTemperature(allLogits, y, m2);
    if (f1 < f2) hi = m2;
    else lo = m1;
  }
  return (lo + hi) / 2;
}

// ---------------------------------------------------------------------------
// Per-class thresholds, chosen for precision: the lowest threshold on
// P(c|x) among predictions where argmax==c that still clears the target
// precision on the held-out split. No threshold clearing it means the
// class is never predicted with confidence - permanently above 1.0.
// ---------------------------------------------------------------------------
export function chooseThresholds(probs: readonly (readonly number[])[], y: readonly number[], numClasses: number, targetPrecision: number): number[] {
  const thresholds: number[] = [];
  for (let c = 0; c < numClasses; c++) {
    const candidates: Array<{ p: number; correct: boolean }> = [];
    for (let i = 0; i < probs.length; i++) {
      const row = probs[i]!;
      const argmax = row.indexOf(Math.max(...row));
      if (argmax !== c) continue;
      candidates.push({ p: row[c]!, correct: y[i] === c });
    }
    candidates.sort((a, b) => b.p - a.p);
    let tp = 0;
    let best = 1.01; // above 1.0: never fires
    for (let i = 0; i < candidates.length; i++) {
      tp += candidates[i]!.correct ? 1 : 0;
      const precisionAtI = tp / (i + 1);
      if (precisionAtI >= targetPrecision) best = candidates[i]!.p;
    }
    thresholds.push(best);
  }
  return thresholds;
}

export function predictWithThresholds(model: SoftmaxModel, x: Float32Array, temperature: number, thresholds: readonly number[]): { predicted: number | null; probs: number[] } {
  const z = logits(model, x);
  const scaled = Array.from(z, (v) => v / temperature);
  const probs = softmax(scaled);
  const argmax = probs.indexOf(Math.max(...probs));
  const predicted = probs[argmax]! >= thresholds[argmax]! ? argmax : null;
  return { predicted, probs };
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------
export interface ClassMetrics {
  label: string;
  tp: number;
  fp: number;
  fn: number;
  precision: number;
  recall: number;
  f1: number;
  support: number;
}

export interface EvalResult {
  perClass: ClassMetrics[];
  macroF1: number;
  /** rows = true class index, cols = predicted class index, +1 col = below-threshold ("unknown"/fallback). */
  confusion: number[][];
  unknownCount: number;
  accuracyIncludingUnknown: number;
  /** Expected calibration error over the model's own predicted
   * probabilities. Undefined when there is no such distribution to bin
   * (a rules-vs-heads comparison scoring an already-decided prediction
   * list, never a model's output) - never a stand-in 0, which would
   * read as a real, perfectly-calibrated model. */
  ece?: number;
  /** Only set when `referenceLabel` (e.g. "neutral") names a class in `labels`. */
  referenceVsNot?: { precision: number; recall: number; f1: number };
}

export function evaluate(
  model: SoftmaxModel,
  X: readonly Float32Array[],
  y: readonly number[],
  temperature: number,
  thresholds: readonly number[],
  labels: readonly string[],
  referenceLabel?: string,
): EvalResult {
  const numClasses = labels.length;
  const confusion: number[][] = Array.from({ length: numClasses }, () => new Array(numClasses + 1).fill(0));
  const tp = new Array(numClasses).fill(0);
  const fp = new Array(numClasses).fill(0);
  const fn = new Array(numClasses).fill(0);
  let unknownCount = 0;
  let correctIncludingUnknown = 0;
  let eceSum = 0;

  const referenceIdx = referenceLabel ? labels.indexOf(referenceLabel) : -1;
  let refTp = 0;
  let refFp = 0;
  let refFn = 0;

  const NUM_BINS = 15;
  const binCorrect = new Array(NUM_BINS).fill(0);
  const binTotal = new Array(NUM_BINS).fill(0);
  const binConfSum = new Array(NUM_BINS).fill(0);

  for (let i = 0; i < X.length; i++) {
    const { predicted, probs } = predictWithThresholds(model, X[i]!, temperature, thresholds);
    const truth = y[i]!;
    const argmax = probs.indexOf(Math.max(...probs));
    const confidence = probs[argmax]!;
    const bin = Math.min(NUM_BINS - 1, Math.floor(confidence * NUM_BINS));
    binTotal[bin]++;
    binConfSum[bin] += confidence;
    if (argmax === truth) binCorrect[bin]++;

    if (predicted === null) {
      unknownCount++;
      confusion[truth]![numClasses]!++;
      fn[truth]++;
    } else {
      confusion[truth]![predicted]!++;
      if (predicted === truth) {
        tp[predicted]++;
        correctIncludingUnknown++;
      } else {
        fp[predicted]++;
        fn[truth]++;
      }
    }

    if (referenceIdx >= 0) {
      const predictedIsRef = predicted === referenceIdx;
      const truthIsRef = truth === referenceIdx;
      if (predictedIsRef && truthIsRef) refTp++;
      else if (predictedIsRef && !truthIsRef) refFp++;
      else if (!predictedIsRef && truthIsRef) refFn++;
    }
  }

  for (let b = 0; b < NUM_BINS; b++) {
    if (binTotal[b] === 0) continue;
    const acc = binCorrect[b] / binTotal[b];
    const conf = binConfSum[b] / binTotal[b];
    eceSum += (binTotal[b] / X.length) * Math.abs(acc - conf);
  }

  const perClass: ClassMetrics[] = labels.map((label, c) => {
    const support = y.filter((v) => v === c).length;
    const precision = tp[c] + fp[c] > 0 ? tp[c] / (tp[c] + fp[c]) : 0;
    const recall = tp[c] + fn[c] > 0 ? tp[c] / (tp[c] + fn[c]) : 0;
    const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
    return { label, tp: tp[c], fp: fp[c], fn: fn[c], precision, recall, f1, support };
  });
  const macroF1 = perClass.reduce((a, m) => a + m.f1, 0) / perClass.length;

  const result: EvalResult = {
    perClass,
    macroF1,
    confusion,
    unknownCount,
    accuracyIncludingUnknown: X.length > 0 ? correctIncludingUnknown / X.length : 0,
    ece: eceSum,
  };
  if (referenceIdx >= 0) {
    const precision = refTp + refFp > 0 ? refTp / (refTp + refFp) : 0;
    const recall = refTp + refFn > 0 ? refTp / (refTp + refFn) : 0;
    const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
    result.referenceVsNot = { precision, recall, f1 };
  }
  return result;
}

export function balancedIndices(y: readonly number[], numClasses: number, seed = 7): number[] {
  const byClass: number[][] = Array.from({ length: numClasses }, () => []);
  y.forEach((label, i) => byClass[label]!.push(i));
  const nonEmpty = byClass.filter((arr) => arr.length > 0);
  const minCount = Math.min(...nonEmpty.map((arr) => arr.length));
  const out: number[] = [];
  byClass.forEach((arr, i) => {
    if (arr.length === 0) return;
    out.push(...seededShuffle(arr, seed + i).slice(0, minCount));
  });
  return out;
}

/** Forces argmax == predictedClass regardless of x - the "always predict
 * this one class" baseline, used to sanity-check that the real comparison
 * (the rule pass, not this) is doing better than a constant guess. */
export function baselineMetrics(y: readonly number[], predictedClass: number, numClasses: number, dim: number, labels: readonly string[], referenceLabel?: string): EvalResult {
  const model = createModel(numClasses, dim);
  model.b[predictedClass] = 1000;
  const thresholds = new Array(numClasses).fill(0);
  const X = y.map(() => new Float32Array(dim));
  return evaluate(model, X, y, 1, thresholds, labels, referenceLabel);
}

export function fmtPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

export function classMetricsTable(rows: readonly ClassMetrics[]): string {
  const header = "| label | support | precision | recall | F1 |\n|---|---|---|---|---|";
  const body = rows.map((r) => `| ${r.label} | ${r.support} | ${fmtPct(r.precision)} | ${fmtPct(r.recall)} | ${fmtPct(r.f1)} |`).join("\n");
  return `${header}\n${body}`;
}

export function confusionTable(confusion: readonly (readonly number[])[], labels: readonly string[]): string {
  const cols = [...labels, "below-threshold"];
  const header = `| true \\ pred | ${cols.join(" | ")} |\n|${"---|".repeat(cols.length + 1)}`;
  const body = confusion.map((row, i) => `| ${labels[i]} | ${row.join(" | ")} |`).join("\n");
  return `${header}\n${body}`;
}
