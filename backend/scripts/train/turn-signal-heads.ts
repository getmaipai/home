// ACT-02 (docs/BACKLOG.md "ACT-02", docs/dev.md section 12): trains the
// three heads (act, stance, emotion) over the 768-dim nomic-embed-
// text-v1.5 vector `embedUtterance()` already computes for every model
// turn, so the artifact is a plain matrix multiply at runtime with no
// preprocessing step. Dev-time only, never runs in the house.
//
// Data and license: the emotion head trains on GoEmotions (Apache 2.0,
// real human labels, through its own published Ekman mapping) and
// validates on DailyDialog's test split (CC BY-NC-SA, research-license,
// NEVER trained on - it is the validation set and the distribution
// reference, exactly as docs/dev.md section 12 states). The act and
// stance heads train on a corpus the 4B labels under DailyDialog's own
// act definitions and this file's own stance definitions
// (labelActStance.ts), over Taskmaster-1 and CCPE-M (both CC BY 4.0),
// the bench fixture's un-hinted turns, and synthetic roster dialogues
// authored for this lane (syntheticRosterDialogues.ts) - never over
// DailyDialog, and never over a household transcript. The act head's
// acceptance number is DailyDialog's human act labels alone; the stance
// head has no such independent human-labeled source, so its acceptance
// number waits on a person reviewing the 500-turn sample this script
// generates (reviewSheet.ts) - the org's training rule, applied here:
// never validate on the labeler's own output where a human label
// exists, and here the human label does not exist yet until someone
// fills in the sheet.
//
// Every dataset file is verified against the registry's own recorded
// checksum before anything touches it (verifyRequiredDatasets(),
// mirroring scripts/bench/datasets/verify.ts's own logic exactly, run
// once here rather than shelled out to so the required-file list can be
// filtered to what this script actually reads). Training uses a
// class-weighted loss; each head is calibrated separately by temperature
// scaling on its own held-out split; per-class thresholds are chosen on
// precision (never F1): a false neutral is awkward, a false fear or
// sadness makes the companion behave wrongly, and a false `asserted` is
// a false memory.
//
// Engine use: this script spawns its OWN chat (4B) and embed engines
// (engines.ts), never pointing at a household's or a dev hub's running
// ones - cleared explicitly for this run by the coordinator, 2026-09-14.
// Run detached (nohup, disowned) and watched via a log tail, never a
// harness-tracked foreground wait: the labeling pass is the long part,
// and its own JSONL output (labelActStance.ts) resumes per-shard, so a
// harness "kill" (the false-positive kind EVAL-07's lane 14 work found
// and fixed) costs nothing but wall time.
//
// Run: bun run scripts/train/turn-signal-heads.ts (from backend/).
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { registryFiles, absolutePath } from "../bench/datasets/registry";
import { sha256OfFile } from "@/lib/modelDownload";
import { seededShuffle } from "../bench/datasets/sample";
import {
  ACT_LABELS,
  STANCE_LABELS,
  EMOTION_LABELS,
  LABEL_MAP_VERSION,
  type ActLabel,
  type StanceLabel,
  type EmotionLabel,
} from "./labelSets";
import {
  trainSoftmaxRegression,
  fitTemperature,
  chooseThresholds,
  evaluate,
  balancedIndices,
  baselineMetrics,
  predictWithThresholds,
  classWeights,
  logits,
  softmax,
  fmtPct,
  classMetricsTable,
  confusionTable,
  type SoftmaxModel,
  type EvalResult,
} from "./multinomialHead";
import { startChatEngine, startEmbedEngine, EMBED_MODEL_FILE, EMBED_MODEL_SHA256, EMBED_MODEL_DIMENSIONS } from "./engines";
import { embedTexts } from "./embedCache";
import { readEmotionsList, loadGoEmotionsFile } from "./goEmotions";
import { loadDailyDialogTestExamples } from "./dailyDialogValidation";
import { splitFixture } from "./fixtureSignals";
import { buildActStanceCorpus } from "./buildActStanceCorpus";
import { labelActStanceCorpus, readLabeledCorpus, type LabeledTurn } from "./labelActStance";
import { sampleForReview, renderReviewSheet } from "./reviewSheet";
import { ruleReading, composeAxis, actIsRuleDefault, stanceIsRuleDefault, emotionIsRuleDefault } from "./ruleComparison";

const SCRIPT_DIR = import.meta.dir;
const OUT_DIR = join(SCRIPT_DIR, "out");
const REPORT_PATH = join(OUT_DIR, "report.md");
const EMBED_CACHE_DIR = join(OUT_DIR, "embed-cache");
const REPO_ROOT = join(SCRIPT_DIR, "..", "..", "..");
const LABEL_OUT_PATH = join(REPO_ROOT, "data-scratch", "train", "act-stance-labels.jsonl");
const REVIEW_SHEET_PATH = join(REPO_ROOT, "data-scratch", "eval", "turn-signal-review-sheet.md");

const TARGET_CORPUS_SIZE = Number(process.env.MAIPAI_TRAIN_CORPUS_SIZE ?? 6000);
const LABEL_BATCH_SIZE = Number(process.env.MAIPAI_TRAIN_LABEL_BATCH ?? 8);
const TARGET_PRECISION = 0.8;
const DIM = EMBED_MODEL_DIMENSIONS;
// The stated margin (docs/BACKLOG.md:2305-2314's own words, this
// script's own number): the heads must beat the rule pass by at least
// 5 macro-F1 points (or 5 points of neutral-vs-not F1) on DailyDialog's
// test split to ship. Stated here, once, so the ship/no-ship verdict at
// the end of the run is never a judgment call made after seeing the
// number.
const REQUIRED_MARGIN = 0.05;

const REQUIRED_DATASETS = new Set(["dailydialog", "taskmaster-1", "ccpe-m", "goemotions"]);

async function verifyRequiredDatasets(): Promise<void> {
  const entries = registryFiles().filter((e) => REQUIRED_DATASETS.has(e.dataset));
  let missing = 0;
  let mismatched = 0;
  for (const { dataset, file } of entries) {
    const path = absolutePath(file.path);
    if (!existsSync(path)) {
      console.log(`  MISSING  ${dataset}: ${file.path}`);
      missing++;
      continue;
    }
    const actual = await sha256OfFile(path);
    if (actual !== file.sha256) {
      console.log(`  MISMATCH ${dataset}: ${file.path}`);
      mismatched++;
      continue;
    }
  }
  console.log(`  ${entries.length - missing - mismatched}/${entries.length} required files ok`);
  if (missing > 0 || mismatched > 0) {
    throw new Error(`refusing to train: ${missing} missing, ${mismatched} mismatched dataset file(s) - run 'bun run scripts/bench/datasets/verify.ts' for the full picture`);
  }
}

// ---------------------------------------------------------------------------
// A generic per-head training run: given labeled (text, label) pairs
// already split train/dev, embeds them, trains, calibrates, thresholds.
// ---------------------------------------------------------------------------
interface HeadTrainResult<L extends string> {
  model: SoftmaxModel;
  temperature: number;
  thresholds: number[];
  bestEpoch: number;
  devMacroF1: number;
  trainingMs: number;
  weights: number[];
}

async function trainHead<L extends string>(
  labels: readonly L[],
  trainX: Float32Array[],
  trainY: number[],
  devX: Float32Array[],
  devY: number[],
): Promise<HeadTrainResult<L>> {
  const numClasses = labels.length;
  const weights = classWeights(trainY, numClasses);
  const trainStart = Date.now();
  const evalEachEpoch = (model: SoftmaxModel): number => evaluate(model, devX, devY, 1, new Array(numClasses).fill(0), labels as readonly string[]).macroF1;
  const { model, bestEpoch, history } = trainSoftmaxRegression(trainX, trainY, weights, numClasses, DIM, { epochs: 400, batchSize: 128, learningRate: 0.01, l2: 1e-4, patience: 20 }, evalEachEpoch);
  const trainingMs = Date.now() - trainStart;
  const devLogits = devX.map((x) => logits(model, x));
  const temperature = fitTemperature(devLogits, devY);
  const devProbs = devX.map((x) => softmax(Array.from(logits(model, x), (v) => v / temperature)));
  const thresholds = chooseThresholds(devProbs, devY, numClasses, TARGET_PRECISION);
  return { model, temperature, thresholds, bestEpoch, devMacroF1: history[bestEpoch]!.devMetric ?? 0, trainingMs, weights };
}

function splitTrainDev<T>(items: readonly T[], devFraction: number, seed: number): { train: T[]; dev: T[] } {
  const shuffled = seededShuffle(items, seed);
  const devCount = Math.max(1, Math.round(shuffled.length * devFraction));
  return { dev: shuffled.slice(0, devCount), train: shuffled.slice(devCount) };
}

function predictLabel<L extends string>(model: SoftmaxModel, temperature: number, thresholds: readonly number[], labels: readonly L[], x: Float32Array): L | null {
  const { predicted } = predictWithThresholds(model, x, temperature, thresholds);
  return predicted === null ? null : labels[predicted]!;
}

async function main(): Promise<void> {
  const startedAt = Date.now();
  const reportLines: string[] = [];
  const log = (line: string) => {
    console.log(line);
  };

  mkdirSync(OUT_DIR, { recursive: true });
  log(`out dir: ${OUT_DIR}`);

  log("verifying required dataset files against the registry (dailydialog, taskmaster-1, ccpe-m, goemotions)...");
  await verifyRequiredDatasets();

  // ---- Load everything text-only (no engine yet) ----
  log("loading GoEmotions...");
  const emotionsByIndex = readEmotionsList(absolutePath("goemotions/emotions.txt"));
  const goTrain = loadGoEmotionsFile(absolutePath("goemotions/train.tsv"), emotionsByIndex);
  const goDev = loadGoEmotionsFile(absolutePath("goemotions/dev.tsv"), emotionsByIndex);
  const goTest = loadGoEmotionsFile(absolutePath("goemotions/test.tsv"), emotionsByIndex);
  log(`  train ${goTrain.examples.length}/${goTrain.totalRows}, dev ${goDev.examples.length}/${goDev.totalRows}, test ${goTest.examples.length}/${goTest.totalRows}`);

  log("loading DailyDialog test split (validation only, never trained on)...");
  const { examples: ddExamples, relabeled: ddRelabeled } = await loadDailyDialogTestExamples();
  log(`  ${ddExamples.length} labeled utterances, ${ddRelabeled} relabeled from inform to a management act by the rule pass`);

  log("loading the bench fixture...");
  const { validation: fixtureValidation } = splitFixture();
  log(`  ${fixtureValidation.length} human-hinted turns held out as the fixture validation slice`);

  log("building the act/stance labeling corpus (Taskmaster-1, CCPE-M, fixture, synthetic)...");
  const { candidates, stats } = buildActStanceCorpus(TARGET_CORPUS_SIZE);
  log(`  taskmaster1-self ${stats.taskmaster1Self}, taskmaster1-woz ${stats.taskmaster1Woz}, ccpe-m ${stats.ccpeM}, fixture ${stats.fixture}, synthetic ${stats.synthetic}`);
  log(`  pooled+deduped ${stats.pooledBeforeCap}, capped to ${stats.afterCap}`);

  // ---- 4B labeling pass ----
  log("starting the chat (4B) engine for the labeling pass...");
  const chat = await startChatEngine();
  log(`  ${chat.description}`);
  try {
    const { labeled, failed } = await labelActStanceCorpus(chat.client, candidates, LABEL_OUT_PATH, {
      batchSize: LABEL_BATCH_SIZE,
      onProgress: (done, total) => {
        if (done % 200 < LABEL_BATCH_SIZE) console.log(`    labeling ${done}/${total}`);
      },
    });
    log(`  labeling done: ${labeled} labeled, ${failed} failed/dropped`);
  } finally {
    await chat.stop();
  }
  const labeledCorpus = readLabeledCorpus(LABEL_OUT_PATH);

  // ---- The 500-turn human review sheet (docs/dev.md section 12; the
  // stance head's acceptance number waits on this being filled in) ----
  mkdirSync(join(REVIEW_SHEET_PATH, ".."), { recursive: true });
  const reviewSample = sampleForReview(labeledCorpus);
  writeFileSync(REVIEW_SHEET_PATH, renderReviewSheet(reviewSample));
  log(`wrote the 500-turn review sheet: ${REVIEW_SHEET_PATH} (${reviewSample.length} rows)`);

  // ---- Embedding ----
  log("starting the embed engine...");
  const embed = await startEmbedEngine();
  log(`  ${embed.description}`);

  try {
    const goTrainX = await embedTexts(embed.client, goTrain.examples.map((e) => e.text), join(EMBED_CACHE_DIR, "goemotions-train.json"), "goemotions-train");
    const goDevX = await embedTexts(embed.client, goDev.examples.map((e) => e.text), join(EMBED_CACHE_DIR, "goemotions-dev.json"), "goemotions-dev");
    const goTestX = await embedTexts(embed.client, goTest.examples.map((e) => e.text), join(EMBED_CACHE_DIR, "goemotions-test.json"), "goemotions-test");
    const ddX = await embedTexts(embed.client, ddExamples.map((e) => e.text), join(EMBED_CACHE_DIR, "dailydialog-test.json"), "dailydialog-test");
    const fixtureX = await embedTexts(embed.client, fixtureValidation.map((e) => e.text), join(EMBED_CACHE_DIR, "fixture-validation.json"), "fixture-validation");
    const corpusX = await embedTexts(embed.client, labeledCorpus.map((e) => e.text), join(EMBED_CACHE_DIR, "act-stance-corpus.json"), "act-stance-corpus");

    // ---- Emotion head: trains on GoEmotions, calibrates on GoEmotions dev ----
    log("training the emotion head (GoEmotions train, real human labels)...");
    const emotionIdx = (l: EmotionLabel) => EMOTION_LABELS.indexOf(l);
    const goTrainY = goTrain.examples.map((e) => emotionIdx(e.label));
    const goDevY = goDev.examples.map((e) => emotionIdx(e.label));
    const emotionRun = await trainHead(EMOTION_LABELS, goTrainX, goTrainY, goDevX, goDevY);
    log(`  best epoch ${emotionRun.bestEpoch}, dev macro F1 ${fmtPct(emotionRun.devMacroF1)}, T=${emotionRun.temperature.toFixed(3)}`);

    // ---- Act and stance heads: train on the 4B-labeled corpus, split
    // train/dev - the dev split here is self-consistency only (the
    // labeler's own held-out output), used for early stopping and
    // threshold calibration, NEVER reported as the acceptance number. ----
    log("training the act head (4B-labeled corpus - training weights only, never the acceptance number)...");
    const actIdx = (l: ActLabel) => ACT_LABELS.indexOf(l);
    const stanceIdx = (l: StanceLabel) => STANCE_LABELS.indexOf(l);
    const corpusActY = labeledCorpus.map((e) => actIdx(e.act));
    const corpusStanceY = labeledCorpus.map((e) => stanceIdx(e.stance));
    const order = labeledCorpus.map((_, i) => i);
    const { train: actTrainIdx, dev: actDevIdx } = splitTrainDev(order, 0.15, 101);
    const actRun = await trainHead(
      ACT_LABELS,
      actTrainIdx.map((i) => corpusX[i]!),
      actTrainIdx.map((i) => corpusActY[i]!),
      actDevIdx.map((i) => corpusX[i]!),
      actDevIdx.map((i) => corpusActY[i]!),
    );
    log(`  best epoch ${actRun.bestEpoch}, dev (4B self-consistency) macro F1 ${fmtPct(actRun.devMacroF1)}, T=${actRun.temperature.toFixed(3)}`);

    log("training the stance head (4B-labeled corpus - training weights only, never the acceptance number)...");
    const { train: stanceTrainIdx, dev: stanceDevIdx } = splitTrainDev(order, 0.15, 103);
    const stanceRun = await trainHead(
      STANCE_LABELS,
      stanceTrainIdx.map((i) => corpusX[i]!),
      stanceTrainIdx.map((i) => corpusStanceY[i]!),
      stanceDevIdx.map((i) => corpusX[i]!),
      stanceDevIdx.map((i) => corpusStanceY[i]!),
    );
    log(`  best epoch ${stanceRun.bestEpoch}, dev (4B self-consistency) macro F1 ${fmtPct(stanceRun.devMacroF1)}, T=${stanceRun.temperature.toFixed(3)}`);

    // =========================================================================
    // Validation: the real, human-labeled evaluation. DailyDialog test is
    // used for act and emotion; the fixture's human-hinted slice adds a
    // second, small, in-distribution check for all three; stance has no
    // independent human-labeled source here and is reported as pending
    // the review sheet.
    // =========================================================================
    log("validating on DailyDialog test (never trained on)...");

    const ddActY = ddExamples.map((e) => actIdx(e.act));
    const ddEmotionY = ddExamples.map((e) => emotionIdx(e.emotion));

    const actNatural = evaluate(actRun.model, ddX, ddActY, actRun.temperature, actRun.thresholds, ACT_LABELS as unknown as string[]);
    const actBalancedIdx = balancedIndices(ddActY, ACT_LABELS.length);
    const actBalanced = evaluate(actRun.model, actBalancedIdx.map((i) => ddX[i]!), actBalancedIdx.map((i) => ddActY[i]!), actRun.temperature, actRun.thresholds, ACT_LABELS as unknown as string[]);

    const emotionNatural = evaluate(emotionRun.model, ddX, ddEmotionY, emotionRun.temperature, emotionRun.thresholds, EMOTION_LABELS as unknown as string[], "neutral");
    const emotionBalancedIdx = balancedIndices(ddEmotionY, EMOTION_LABELS.length);
    const emotionBalanced = evaluate(emotionRun.model, emotionBalancedIdx.map((i) => ddX[i]!), emotionBalancedIdx.map((i) => ddEmotionY[i]!), emotionRun.temperature, emotionRun.thresholds, EMOTION_LABELS as unknown as string[], "neutral");
    const goTestEval = evaluate(emotionRun.model, goTestX, goTest.examples.map((e) => emotionIdx(e.label)), emotionRun.temperature, emotionRun.thresholds, EMOTION_LABELS as unknown as string[], "neutral");

    // ---- Rules-only vs rules-plus-heads, on DailyDialog test ----
    log("scoring the rule pass alone, and rules-plus-heads, on DailyDialog test...");
    const ddRuleReadings = ddExamples.map((e) => ruleReading(e.text));
    const ddRuleActY = ddRuleReadings.map((r) => actIdx(r.act));
    const ddRuleEmotionY = ddRuleReadings.map((r) => emotionIdx(r.emotion));
    // Rule-only and rules-plus-heads predictions are both already-decided
    // class indices (not a model to run forward), so both are scored
    // through this shared function rather than evaluate() (which expects
    // to compute predictions itself from a model) - the same confusion/F1
    // math, just fed a fixed prediction list instead of calling a model.
    const scoreFixedPredictions = (predictions: readonly (number | null)[], truthY: readonly number[], labels: readonly string[], referenceLabel?: string): EvalResult => {
      const numClasses = labels.length;
      const confusion: number[][] = Array.from({ length: numClasses }, () => new Array(numClasses + 1).fill(0));
      const tp = new Array(numClasses).fill(0);
      const fp = new Array(numClasses).fill(0);
      const fn = new Array(numClasses).fill(0);
      let unknownCount = 0;
      let correct = 0;
      const referenceIdx = referenceLabel ? labels.indexOf(referenceLabel) : -1;
      let refTp = 0, refFp = 0, refFn = 0;
      for (let i = 0; i < truthY.length; i++) {
        const truth = truthY[i]!;
        const predicted = predictions[i]!;
        if (predicted === null) {
          unknownCount++;
          confusion[truth]![numClasses]!++;
          fn[truth]++;
        } else {
          confusion[truth]![predicted]!++;
          if (predicted === truth) { tp[predicted]++; correct++; } else { fp[predicted]++; fn[truth]++; }
        }
        if (referenceIdx >= 0) {
          const predIsRef = predicted === referenceIdx;
          const truthIsRef = truth === referenceIdx;
          if (predIsRef && truthIsRef) refTp++; else if (predIsRef && !truthIsRef) refFp++; else if (!predIsRef && truthIsRef) refFn++;
        }
      }
      const perClass = labels.map((label, c) => {
        const support = truthY.filter((v) => v === c).length;
        const precision = tp[c] + fp[c] > 0 ? tp[c] / (tp[c] + fp[c]) : 0;
        const recall = tp[c] + fn[c] > 0 ? tp[c] / (tp[c] + fn[c]) : 0;
        const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
        return { label, tp: tp[c], fp: fp[c], fn: fn[c], precision, recall, f1, support };
      });
      const macroF1 = perClass.reduce((a, m) => a + m.f1, 0) / perClass.length;
      // No `ece`: a fixed prediction list carries no probability
      // distribution to bin (unlike evaluate(), which scores a live
      // model), so it is left unset rather than reported as 0, which
      // would read as a real, perfectly-calibrated result.
      const result: EvalResult = { perClass, macroF1, confusion, unknownCount, accuracyIncludingUnknown: truthY.length > 0 ? correct / truthY.length : 0 };
      if (referenceIdx >= 0) {
        const precision = refTp + refFp > 0 ? refTp / (refTp + refFp) : 0;
        const recall = refTp + refFn > 0 ? refTp / (refTp + refFn) : 0;
        const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
        result.referenceVsNot = { precision, recall, f1 };
      }
      return result;
    };

    const ruleOnlyAct = scoreFixedPredictions(ddRuleActY, ddActY, ACT_LABELS as unknown as string[]);
    const ruleOnlyEmotion = scoreFixedPredictions(ddRuleEmotionY, ddEmotionY, EMOTION_LABELS as unknown as string[], "neutral");

    const composedActY: (number | null)[] = ddExamples.map((e, i) => {
      const rule = ddRuleReadings[i]!;
      const head = predictLabel(actRun.model, actRun.temperature, actRun.thresholds, ACT_LABELS, ddX[i]!);
      const composed = composeAxis({ value: rule.act, confidence: rule.actConfidence }, actIsRuleDefault, head);
      return actIdx(composed);
    });
    const composedEmotionY: (number | null)[] = ddExamples.map((e, i) => {
      const rule = ddRuleReadings[i]!;
      const head = predictLabel(emotionRun.model, emotionRun.temperature, emotionRun.thresholds, EMOTION_LABELS, ddX[i]!);
      const composed = composeAxis({ value: rule.emotion, confidence: rule.emotionConfidence }, emotionIsRuleDefault, head);
      return emotionIdx(composed);
    });
    const composedAct = scoreFixedPredictions(composedActY, ddActY, ACT_LABELS as unknown as string[]);
    const composedEmotion = scoreFixedPredictions(composedEmotionY, ddEmotionY, EMOTION_LABELS as unknown as string[], "neutral");

    // ---- The same rules-only vs rules-plus-heads comparison on the fixture ----
    const fixtureActEntries = fixtureValidation.map((e, i) => ({ e, i })).filter((r) => r.e.act !== undefined);
    const fixtureEmotionEntries = fixtureValidation.map((e, i) => ({ e, i })).filter((r) => r.e.emotion !== undefined);
    const fixtureStanceEntries = fixtureValidation.map((e, i) => ({ e, i })).filter((r) => r.e.stance !== undefined);

    const fixtureRuleReadings = fixtureValidation.map((e) => ruleReading(e.text));
    const fixtureActTruthY = fixtureActEntries.map((r) => actIdx(r.e.act!));
    const fixtureRuleActY = fixtureActEntries.map((r) => actIdx(fixtureRuleReadings[r.i]!.act));
    const fixtureComposedActY = fixtureActEntries.map((r) => {
      const rule = fixtureRuleReadings[r.i]!;
      const head = predictLabel(actRun.model, actRun.temperature, actRun.thresholds, ACT_LABELS, fixtureX[r.i]!);
      return actIdx(composeAxis({ value: rule.act, confidence: rule.actConfidence }, actIsRuleDefault, head));
    });
    const fixtureRuleOnlyAct = scoreFixedPredictions(fixtureRuleActY, fixtureActTruthY, ACT_LABELS as unknown as string[]);
    const fixtureComposedAct = scoreFixedPredictions(fixtureComposedActY, fixtureActTruthY, ACT_LABELS as unknown as string[]);

    // Stance: the fixture's human-labeled slice is the only independent
    // human ground truth available in this run (the corpus-wide number
    // waits on the review sheet), so rules-plus-head is worth composing
    // here too, even at low n - the head's blended behavior against any
    // real human label should never go unmeasured just because the
    // bigger number isn't ready yet.
    const fixtureStanceTruthY = fixtureStanceEntries.map((r) => stanceIdx(r.e.stance!));
    const fixtureRuleStanceY = fixtureStanceEntries
      .map((r) => fixtureRuleReadings[r.i]!.stance)
      .map((s) => (s === "unknown" ? -1 : stanceIdx(s)));
    const fixtureComposedStanceY = fixtureStanceEntries.map((r) => {
      const rule = fixtureRuleReadings[r.i]!;
      if (rule.stance === "unknown") return -1;
      const head = predictLabel(stanceRun.model, stanceRun.temperature, stanceRun.thresholds, STANCE_LABELS, fixtureX[r.i]!);
      return stanceIdx(composeAxis({ value: rule.stance, confidence: rule.stanceConfidence }, stanceIsRuleDefault, head));
    });
    const fixtureRuleOnlyStance = scoreFixedPredictions(fixtureRuleStanceY, fixtureStanceTruthY, STANCE_LABELS as unknown as string[]);
    const fixtureComposedStance = scoreFixedPredictions(fixtureComposedStanceY, fixtureStanceTruthY, STANCE_LABELS as unknown as string[]);

    // ---- Neutral FP rate at natural distribution and on a balanced slice ----
    const neutralFpRate = (evalResult: EvalResult): number => {
      const neutral = evalResult.perClass.find((c) => c.label === "neutral");
      if (!neutral) return 0;
      const totalPredictedNeutral = neutral.tp + neutral.fp;
      return totalPredictedNeutral > 0 ? neutral.fp / totalPredictedNeutral : 0;
    };

    // =========================================================================
    // Artifacts
    // =========================================================================
    const now = new Date().toISOString();
    const embeddingIdentity = { model_name: "nomic-embed-text-v1.5", file: EMBED_MODEL_FILE, sha256: EMBED_MODEL_SHA256, dimensions: EMBED_MODEL_DIMENSIONS, prefix: null };

    function writeArtifact(name: string, labels: readonly string[], run: HeadTrainResult<string>, training: Record<string, unknown>) {
      const artifact = {
        head: name,
        artifact_version: 1,
        created_at: now,
        embedding: embeddingIdentity,
        label_map: { version: LABEL_MAP_VERSION, labels },
        weights: { W: Array.from(run.model.W), b: Array.from(run.model.b) },
        temperature: run.temperature,
        thresholds: Object.fromEntries(labels.map((l, i) => [l, run.thresholds[i]])),
        training,
      };
      const path = join(OUT_DIR, `${name}-head.json`);
      writeFileSync(path, JSON.stringify(artifact, null, 2));
      return { path, bytes: Buffer.byteLength(JSON.stringify(artifact)) };
    }

    const actArtifact = writeArtifact("act", ACT_LABELS as unknown as string[], actRun, {
      trained_on: "4B-labeled corpus (Taskmaster-1 CC BY 4.0, CCPE-M CC BY 4.0, bench fixture, synthetic roster dialogues) - NOT human ground truth",
      calibrated_on: "held-out split of the same 4B-labeled corpus (self-consistency only)",
      validated_on: "DailyDialog test split (human act labels, CC BY-NC-SA, never trained on) and the bench fixture's human-hinted turns",
      target_precision: TARGET_PRECISION,
      train_examples: actTrainIdx.length,
      best_epoch: actRun.bestEpoch,
    });
    const stanceArtifact = writeArtifact("stance", STANCE_LABELS as unknown as string[], stanceRun, {
      trained_on: "4B-labeled corpus (Taskmaster-1 CC BY 4.0, CCPE-M CC BY 4.0, bench fixture, synthetic roster dialogues) - NOT human ground truth",
      calibrated_on: "held-out split of the same 4B-labeled corpus (self-consistency only)",
      validated_on: "PENDING: the 500-turn human review sheet (data-scratch/eval/turn-signal-review-sheet.md) - no independent human-labeled stance source exists yet",
      target_precision: TARGET_PRECISION,
      train_examples: stanceTrainIdx.length,
      best_epoch: stanceRun.bestEpoch,
    });
    const emotionArtifact = writeArtifact("emotion", EMOTION_LABELS as unknown as string[], emotionRun, {
      trained_on: "GoEmotions (Apache 2.0) train split, through the published Ekman mapping - real human labels",
      calibrated_on: "GoEmotions dev split",
      validated_on: "DailyDialog test split (human emotion labels, CC BY-NC-SA, never trained on)",
      target_precision: TARGET_PRECISION,
      train_examples: goTrain.examples.length,
      best_epoch: emotionRun.bestEpoch,
    });

    // =========================================================================
    // Ship/no-ship verdict, against the stated margin
    // =========================================================================
    const actMargin = composedAct.macroF1 - ruleOnlyAct.macroF1;
    const emotionNeutralMargin = (composedEmotion.referenceVsNot?.f1 ?? 0) - (ruleOnlyEmotion.referenceVsNot?.f1 ?? 0);
    const fixtureActMargin = fixtureActEntries.length > 0 ? fixtureComposedAct.macroF1 - fixtureRuleOnlyAct.macroF1 : null;
    const actShips = actMargin >= REQUIRED_MARGIN && (fixtureActMargin === null || fixtureActMargin >= 0);
    const emotionShips = emotionNeutralMargin >= REQUIRED_MARGIN;

    // =========================================================================
    // Report
    // =========================================================================
    const totalMs = Date.now() - startedAt;
    reportLines.push(
      `## Session B, lane 16: ACT-02 training report (${now.slice(0, 10)})`,
      "",
      `Generated by \`bun run backend/scripts/train/turn-signal-heads.ts\`. Research-license data (DailyDialog, GoEmotions test/dev) and the 4B-labeled corpus never enter the artifact or git; the artifacts live only in \`${OUT_DIR}\`, gitignored. This section is the committed, verbatim record of this run.`,
      "",
      `### Engines`,
      `- Chat/4B: ${chat.description}`,
      `- Embed: ${embed.description}`,
      "",
      `### Dataset verification`,
      `Every file the registry names for dailydialog, taskmaster-1, ccpe-m and goemotions verified present and checksum-matched before training (\`bun run scripts/bench/datasets/verify.ts\` covers the same files plus the other EVAL-07 sources not used here).`,
      "",
      `### Corpus`,
      `- GoEmotions: train ${goTrain.examples.length}/${goTrain.totalRows} kept, dev ${goDev.examples.length}/${goDev.totalRows}, test ${goTest.examples.length}/${goTest.totalRows} (${goTrain.droppedAmbiguous + goDev.droppedAmbiguous + goTest.droppedAmbiguous} multi-target, ${goTrain.droppedUnmapped + goDev.droppedUnmapped + goTest.droppedUnmapped} unmapped rows dropped)`,
      `- DailyDialog test: ${ddExamples.length} labeled utterances (validation only, never trained on), ${ddRelabeled} relabeled from inform to a management act by the rule pass`,
      `- Bench fixture: ${fixtureValidation.length} human-hinted turns held out as validation (${fixtureActEntries.length} with an act label, ${fixtureEmotionEntries.length} with an emotion label, ${fixtureStanceEntries.length} with a stance label)`,
      `- Act/stance 4B-labeled corpus: ${stats.taskmaster1Self} taskmaster1-self, ${stats.taskmaster1Woz} taskmaster1-woz, ${stats.ccpeM} ccpe-m, ${stats.fixture} fixture, ${stats.synthetic} synthetic; pooled+deduped ${stats.pooledBeforeCap}, capped to ${stats.afterCap}, ${labeledCorpus.length} successfully labeled`,
      `- 500-turn human review sheet written to \`data-scratch/eval/turn-signal-review-sheet.md\` (git-ignored) - the stance head's real validation number waits on this being filled in`,
      "",
      `### Training`,
      `- Emotion: best epoch ${emotionRun.bestEpoch}, dev (GoEmotions) macro F1 ${fmtPct(emotionRun.devMacroF1)}, T=${emotionRun.temperature.toFixed(3)}`,
      `- Act: best epoch ${actRun.bestEpoch}, dev (4B self-consistency, NOT the acceptance number) macro F1 ${fmtPct(actRun.devMacroF1)}, T=${actRun.temperature.toFixed(3)}`,
      `- Stance: best epoch ${stanceRun.bestEpoch}, dev (4B self-consistency, NOT the acceptance number) macro F1 ${fmtPct(stanceRun.devMacroF1)}, T=${stanceRun.temperature.toFixed(3)}`,
      "",
      `### Act: rules alone vs. rules plus the head, DailyDialog test (${ddExamples.length} turns, human labels)`,
      `Rules alone macro F1: ${fmtPct(ruleOnlyAct.macroF1)}. Rules plus head: ${fmtPct(composedAct.macroF1)}. Margin: ${(actMargin * 100).toFixed(1)} points (required: ${(REQUIRED_MARGIN * 100).toFixed(0)}).`,
      "",
      classMetricsTable(composedAct.perClass),
      "",
      `Confusion (rules plus head):`,
      "",
      confusionTable(composedAct.confusion, ACT_LABELS as unknown as string[]),
      "",
      `### Act: rules alone vs. rules plus the head, the fixture (${fixtureActEntries.length} human-labeled turns)`,
      fixtureActEntries.length > 0
        ? `Rules alone macro F1: ${fmtPct(fixtureRuleOnlyAct.macroF1)}. Rules plus head: ${fmtPct(fixtureComposedAct.macroF1)}. Margin: ${((fixtureActMargin ?? 0) * 100).toFixed(1)} points. Small sample (n=${fixtureActEntries.length}): a directional check, not a statistically powered one.`
        : "No fixture turns carry a human act label.",
      "",
      `### Emotion: neutral-vs-not, DailyDialog test`,
      `Rules alone F1: ${fmtPct(ruleOnlyEmotion.referenceVsNot?.f1 ?? 0)} (precision ${fmtPct(ruleOnlyEmotion.referenceVsNot?.precision ?? 0)}, recall ${fmtPct(ruleOnlyEmotion.referenceVsNot?.recall ?? 0)}). Rules plus head: ${fmtPct(composedEmotion.referenceVsNot?.f1 ?? 0)} (precision ${fmtPct(composedEmotion.referenceVsNot?.precision ?? 0)}, recall ${fmtPct(composedEmotion.referenceVsNot?.recall ?? 0)}). Margin: ${(emotionNeutralMargin * 100).toFixed(1)} points.`,
      `Neutral false-positive rate (predicted neutral but wasn't) - natural distribution: ${fmtPct(neutralFpRate(composedEmotion))}; balanced slice: ${fmtPct(neutralFpRate(evaluate(emotionRun.model, emotionBalancedIdx.map((i) => ddX[i]!), emotionBalancedIdx.map((i) => ddEmotionY[i]!), emotionRun.temperature, emotionRun.thresholds, EMOTION_LABELS as unknown as string[], "neutral")))}.`,
      "",
      `### Emotion: full validation, DailyDialog test, natural distribution`,
      classMetricsTable(emotionNatural.perClass),
      "",
      `Macro F1: ${fmtPct(emotionNatural.macroF1)}. Accuracy including below-threshold as a miss: ${fmtPct(emotionNatural.accuracyIncludingUnknown)}. Below-threshold: ${emotionNatural.unknownCount}/${ddEmotionY.length} (${fmtPct(emotionNatural.unknownCount / ddEmotionY.length)}). ECE: ${emotionNatural.ece!.toFixed(4)}.`,
      "",
      `Confusion matrix (rows = true, columns = predicted, last column = below-threshold):`,
      "",
      confusionTable(emotionNatural.confusion, EMOTION_LABELS as unknown as string[]),
      "",
      `### Emotion: balanced slice, DailyDialog test (${emotionBalancedIdx.length} examples, equal per class)`,
      classMetricsTable(emotionBalanced.perClass),
      "",
      `Macro F1: ${fmtPct(emotionBalanced.macroF1)}.`,
      "",
      `### Emotion: in-domain sanity check, GoEmotions test (not used for any tuning)`,
      classMetricsTable(goTestEval.perClass),
      "",
      `Macro F1: ${fmtPct(goTestEval.macroF1)}.`,
      "",
      `### Stance: rules alone vs. rules plus the head, the fixture (${fixtureStanceEntries.length} human-labeled turns)`,
      `The corpus-wide stance number waits on the review sheet (below); this is a small, real, human-labeled check in the meantime.`,
      "",
      fixtureStanceEntries.length > 0
        ? `Rules alone macro F1: ${fmtPct(fixtureRuleOnlyStance.macroF1)}. Rules plus head: ${fmtPct(fixtureComposedStance.macroF1)}.\n\n${classMetricsTable(fixtureComposedStance.perClass)}`
        : "No fixture turns carry a human stance label.",
      "",
      `### Baselines`,
      (() => {
        const majorityClass = (() => {
          const counts = new Array(ACT_LABELS.length).fill(0);
          ddActY.forEach((l) => counts[l]++);
          return counts.indexOf(Math.max(...counts));
        })();
        const majorityBaseline = baselineMetrics(ddActY, majorityClass, ACT_LABELS.length, DIM, ACT_LABELS as unknown as string[]);
        return `- Act majority-class-always (${ACT_LABELS[majorityClass]}) on DailyDialog test: macro F1 ${fmtPct(majorityBaseline.macroF1)}\n- Act rules alone: macro F1 ${fmtPct(ruleOnlyAct.macroF1)}\n- Act rules plus head: macro F1 ${fmtPct(composedAct.macroF1)}`;
      })(),
      "",
      `### Ship verdict (stated margin: ${(REQUIRED_MARGIN * 100).toFixed(0)} macro-F1 points)`,
      `- Act head: ${actShips ? "SHIPS" : "DOES NOT SHIP"} - DailyDialog test margin ${(actMargin * 100).toFixed(1)} points${fixtureActMargin !== null ? `, fixture margin ${(fixtureActMargin * 100).toFixed(1)} points` : ""}.`,
      `- Emotion head (neutral-vs-not): ${emotionShips ? "SHIPS" : "DOES NOT SHIP"} - margin ${(emotionNeutralMargin * 100).toFixed(1)} points.`,
      `- Stance head: PENDING - no independent human-labeled validation exists yet; ships only after the 500-turn review sheet is filled in and its agreement rate is recorded here.`,
      "",
      `### Artifacts`,
      `- Act: ${actArtifact.path} (${actArtifact.bytes} bytes)`,
      `- Stance: ${stanceArtifact.path} (${stanceArtifact.bytes} bytes)`,
      `- Emotion: ${emotionArtifact.path} (${emotionArtifact.bytes} bytes)`,
      `- Embedding identity: ${EMBED_MODEL_FILE} (sha256 ${EMBED_MODEL_SHA256})`,
      `- Label map version: ${LABEL_MAP_VERSION}`,
      "",
      `### Timing`,
      `- Total wall time: ${(totalMs / 1000).toFixed(1)}s`,
      "",
    );

    const report = reportLines.join("\n");
    writeFileSync(REPORT_PATH, report);
    console.log(report);
    console.log(`report staged at: ${REPORT_PATH} (fold into docs/dev.md by hand before committing)`);
  } finally {
    await embed.stop();
  }
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.stack ?? err.message : err);
    process.exit(1);
  });
}
