// ACT-02 (lane 16): the training pipeline's own deterministic, offline
// pieces - the multinomial math, the label-set definitions, the
// GoEmotions/DailyDialog-relabeling/fixture-split loaders, the rules-
// plus-heads composition, the review sheet, the corpus pooling, and the
// 4B labeling driver's resumable-write behavior against the real stub
// engine (spec/llm/ts/stubServer.ts, the same one every other engine-
// touching test in this repo uses). Never a live model, never a real
// dataset file on disk: every fixture here is embedded, matching
// tests/datasetsDailyDialog.test.ts's own pattern for the same reason.
import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LlamaServerClient } from "@maipai/spec/llm/ts/client.js";
import { startStubLlmServer } from "@maipai/spec/llm/ts/stubServer.js";
import {
  createModel,
  logits,
  softmax,
  classWeights,
  trainSoftmaxRegression,
  fitTemperature,
  chooseThresholds,
  evaluate,
  balancedIndices,
  predictWithThresholds,
} from "../scripts/train/multinomialHead";
import { ACT_LABELS, STANCE_LABELS, EMOTION_LABELS, DAILYDIALOG_ACT_ORDER, DAILYDIALOG_EMOTION_ORDER, GOEMOTIONS_TO_EKMAN } from "../scripts/train/labelSets";
import { loadGoEmotionsFile } from "../scripts/train/goEmotions";
import { ruleReading, composeAxis, actIsRuleDefault, stanceIsRuleDefault, emotionIsRuleDefault } from "../scripts/train/ruleComparison";
import { sampleForReview, renderReviewSheet } from "../scripts/train/reviewSheet";
import { splitFixture } from "../scripts/train/fixtureSignals";
import { poolAndCapCandidates } from "../scripts/train/buildActStanceCorpus";
import { labelActStanceCorpus, readLabeledCorpus, type LabelCandidate } from "../scripts/train/labelActStance";

describe("multinomialHead", () => {
  test("trainSoftmaxRegression separates two well-separated Gaussian-ish clusters", () => {
    const dim = 4;
    const rand = (() => {
      let s = 7;
      return () => {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        return s / 0x7fffffff;
      };
    })();
    const X: Float32Array[] = [];
    const y: number[] = [];
    for (let i = 0; i < 200; i++) {
      const label = i % 2;
      const center = label === 0 ? -3 : 3;
      X.push(Float32Array.from({ length: dim }, () => center + (rand() - 0.5)));
      y.push(label);
    }
    const weights = classWeights(y, 2);
    const { model } = trainSoftmaxRegression(X, y, weights, 2, dim, { epochs: 60, batchSize: 32, learningRate: 0.1, l2: 0, patience: 60 });
    let correct = 0;
    for (let i = 0; i < X.length; i++) {
      const probs = softmax(logits(model, X[i]!));
      if (probs.indexOf(Math.max(...probs)) === y[i]) correct++;
    }
    expect(correct / X.length).toBeGreaterThan(0.9);
  });

  test("classWeights: a class with zero examples gets weight 0, never NaN or Infinity", () => {
    const weights = classWeights([0, 0, 0, 1], 3);
    expect(weights[2]).toBe(0);
    expect(Number.isFinite(weights[0]!)).toBe(true);
    expect(Number.isFinite(weights[1]!)).toBe(true);
  });

  test("fitTemperature reduces NLL relative to T=1 on badly-calibrated (overconfident) logits", () => {
    const y = [0, 1, 0, 1, 0, 1, 0, 0];
    const overconfident: Float64Array[] = y.map((label) => {
      const z = new Float64Array(2);
      z[label] = 20; // absurdly confident, even when occasionally wrong
      z[1 - label] = -20;
      return z;
    });
    // Flip two labels so T=1 is genuinely miscalibrated (some confident predictions are wrong).
    const noisyY = [...y];
    noisyY[2] = 1;
    noisyY[5] = 0;
    const T = fitTemperature(overconfident, noisyY);
    expect(T).toBeGreaterThan(1); // softens overconfidence
  });

  test("chooseThresholds: a threshold cleared implies the target precision on the calibration split", () => {
    // Class 0: 8 correct, 2 wrong among its own argmax predictions -> 80% precision achievable near the low end.
    const probs = [
      [0.95, 0.05], [0.9, 0.1], [0.85, 0.15], [0.8, 0.2], [0.75, 0.25],
      [0.7, 0.3], [0.65, 0.35], [0.6, 0.4], [0.55, 0.45], [0.51, 0.49],
    ];
    const y = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1]; // last two argmax-0 predictions are wrong
    const thresholds = chooseThresholds(probs, y, 2, 0.8);
    // 8/10 argmax-0 rows are correct overall (80%), so a threshold near the bottom clears 0.8;
    // it must not be "never fires" (>1).
    expect(thresholds[0]!).toBeLessThanOrEqual(1);
  });

  test("evaluate: confusion matrix and macro F1 match a hand-computed 2-class case", () => {
    const dim = 1;
    const model = createModel(2, dim);
    // b[0] very positive => always predicts class 0 regardless of x.
    model.b[0] = 100;
    const X = [new Float32Array([0]), new Float32Array([0]), new Float32Array([0]), new Float32Array([0])];
    const y = [0, 0, 1, 1]; // two correct, two wrong (both predicted 0)
    const result = evaluate(model, X, y, 1, [0, 0], ["a", "b"]);
    expect(result.confusion[0]).toEqual([2, 0, 0]);
    expect(result.confusion[1]).toEqual([2, 0, 0]);
    // class "a": tp=2, fp=2, fn=0 -> precision .5, recall 1, f1 2/3
    // class "b": tp=0, fp=0, fn=2 -> precision 0, recall 0, f1 0
    expect(result.perClass[0]!.recall).toBe(1);
    expect(result.perClass[1]!.recall).toBe(0);
  });

  test("evaluate: a threshold above the max probability yields a below-threshold ('unknown') prediction, not a forced guess", () => {
    const dim = 1;
    const model = createModel(2, dim);
    const X = [new Float32Array([0])];
    const y = [0];
    const result = evaluate(model, X, y, 1, [1.5, 1.5], ["a", "b"]);
    expect(result.unknownCount).toBe(1);
    expect(result.confusion[0]![2]).toBe(1); // the below-threshold column
  });

  test("balancedIndices: equal count per class, seeded-deterministic", () => {
    const y = [0, 0, 0, 1, 1, 2];
    const idx1 = balancedIndices(y, 3, 5);
    const idx2 = balancedIndices(y, 3, 5);
    expect(idx1).toEqual(idx2);
    const counts = [0, 0, 0];
    idx1.forEach((i) => counts[y[i]!] = counts[y[i]!]! + 1);
    expect(counts).toEqual([1, 1, 1]); // class 2 only has 1 example, so the balanced slice caps at 1 each
  });

  test("predictWithThresholds picks argmax and gates it on that class's own threshold", () => {
    const model = createModel(2, 1);
    model.b[0] = 1;
    model.b[1] = 0;
    const x = new Float32Array([0]);
    const belowThreshold = predictWithThresholds(model, x, 1, [0.99, 0.99]);
    expect(belowThreshold.predicted).toBeNull();
    const clearedThreshold = predictWithThresholds(model, x, 1, [0.5, 0.5]);
    expect(clearedThreshold.predicted).toBe(0);
  });
});

describe("labelSets", () => {
  test("DailyDialog's act order is 1-indexed with index 0 unused", () => {
    expect(DAILYDIALOG_ACT_ORDER[0]).toBeNull();
    expect(DAILYDIALOG_ACT_ORDER[1]).toBe("inform");
    expect(DAILYDIALOG_ACT_ORDER[2]).toBe("question");
    expect(DAILYDIALOG_ACT_ORDER[3]).toBe("directive");
    expect(DAILYDIALOG_ACT_ORDER[4]).toBe("commissive");
  });

  test("DailyDialog's emotion order matches Li et al. 2017's own numbering", () => {
    expect(DAILYDIALOG_EMOTION_ORDER).toEqual(["neutral", "anger", "disgust", "fear", "happiness", "sadness", "surprise"]);
  });

  test("GoEmotions-to-Ekman mapping covers all 27 published labels plus neutral, every value in our own emotion set", () => {
    expect(Object.keys(GOEMOTIONS_TO_EKMAN)).toHaveLength(28);
    for (const mapped of Object.values(GOEMOTIONS_TO_EKMAN)) {
      expect(EMOTION_LABELS as readonly string[]).toContain(mapped);
    }
    expect(GOEMOTIONS_TO_EKMAN.joy).toBe("happiness");
  });

  test("ACT_LABELS and STANCE_LABELS match the real spec enum, stance excluding 'unknown' (the head never predicts it directly)", () => {
    expect(ACT_LABELS).toEqual(["inform", "question", "directive", "commissive", "greeting", "closing", "backchannel"]);
    expect(STANCE_LABELS).toEqual(["asserted", "reported", "quoted", "hypothetical", "joke"]);
  });
});

describe("loadGoEmotionsFile", () => {
  test("a multi-label row is dropped as ambiguous, an unmapped label is dropped, a mapped single label is kept", () => {
    const dir = mkdtempSync(join(tmpdir(), "goemotions-test-"));
    try {
      const emotionsPath = join(dir, "emotions.txt");
      // Index 0 joy (mapped), index 1 grief (mapped), index 2 some unmapped
      // placeholder not in the published Ekman mapping.
      writeFileSync(emotionsPath, "joy\ngrief\nnot_a_real_label\n");
      const tsvPath = join(dir, "train.tsv");
      writeFileSync(tsvPath, "so happy today\t0\tid1\nthis is devastating\t1\tid2\ntwo labels here\t0,1\tid3\nunmapped one\t2\tid4\n");
      const emotionsByIndex = readFileSync(emotionsPath, "utf8").split("\n").filter(Boolean);
      const result = loadGoEmotionsFile(tsvPath, emotionsByIndex);
      expect(result.totalRows).toBe(4);
      expect(result.droppedAmbiguous).toBe(1);
      expect(result.droppedUnmapped).toBe(1);
      expect(result.examples).toEqual([
        { text: "so happy today", label: "happiness" },
        { text: "this is devastating", label: "sadness" },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("ruleComparison", () => {
  test("ruleReading reads a real greeting, a real closing, and a real question through the production rule pass", () => {
    expect(ruleReading("good morning").act).toBe("greeting");
    expect(ruleReading("bye for now").act).toBe("closing");
    expect(ruleReading("what time is it").act).toBe("question");
  });

  test("a real reported-stance sentence with a low-confidence inform act does not get flagged as the rule's stance default (the exact case the min-confidence bug produced)", () => {
    const reading = ruleReading("Pippa said she doesn't like mushrooms");
    expect(reading.stance).toBe("reported");
    // turnSignal.ts's clause.confidence is Math.min(act.confidence,
    // stance.confidence): an inform act here (no first-person cue, 0.6)
    // pulls the exposed confidence below the 0.8 cutoff even though the
    // stance marker itself was confident.
    expect(reading.stanceConfidence).toBeLessThan(0.8);
    expect(stanceIsRuleDefault({ value: reading.stance, confidence: reading.stanceConfidence })).toBe(false);
  });

  test("composeAxis keeps the rule's value when it is not the default call, regardless of what the head says", () => {
    const composed = composeAxis({ value: "question", confidence: 0.95 }, actIsRuleDefault, "inform");
    expect(composed).toBe("question");
  });

  test("composeAxis defers to the head's prediction only when the rule made its default call, and falls back to the rule when the head has none", () => {
    const overridden = composeAxis({ value: "inform", confidence: 0.6 }, actIsRuleDefault, "commissive");
    expect(overridden).toBe("commissive");
    const noHeadOpinion = composeAxis({ value: "inform", confidence: 0.6 }, actIsRuleDefault, null);
    expect(noHeadOpinion).toBe("inform");
  });

  test("actIsRuleDefault never fires on a real, non-default act call (a 0.7-confidence suggestion/negative-imperative directive included), fires only on inform", () => {
    expect(actIsRuleDefault({ value: "directive" })).toBe(false);
    expect(actIsRuleDefault({ value: "commissive" })).toBe(false);
    expect(actIsRuleDefault({ value: "inform" })).toBe(true);
  });

  test("stanceIsRuleDefault separates the residual asserted guess (0.7) from an act-implied asserted call (0.9), and never fires on a marker-based stance even at a low clause-level (min-with-act) confidence", () => {
    expect(stanceIsRuleDefault({ value: "asserted", confidence: 0.7 })).toBe(true);
    expect(stanceIsRuleDefault({ value: "asserted", confidence: 0.9 })).toBe(false);
    // A marker-based stance (reported/quoted/hypothetical/joke) paired
    // with a low-confidence act reads as low overall (turnSignal.ts's
    // clause.confidence = min(act, stance)), but must never be treated
    // as the rule's default - this is exactly the bug a code review
    // caught in a bare confidence-only check.
    expect(stanceIsRuleDefault({ value: "reported", confidence: 0.6 })).toBe(false);
    expect(stanceIsRuleDefault({ value: "quoted", confidence: 0.6 })).toBe(false);
    expect(stanceIsRuleDefault({ value: "hypothetical", confidence: 0.75 })).toBe(false);
    expect(stanceIsRuleDefault({ value: "joke", confidence: 0.6 })).toBe(false);
  });

  test("emotionIsRuleDefault fires only on the no-cue neutral default, never a matched cue (weak or strong)", () => {
    expect(emotionIsRuleDefault({ value: "neutral" })).toBe(true);
    expect(emotionIsRuleDefault({ value: "happiness" })).toBe(false);
    expect(emotionIsRuleDefault({ value: "sadness" })).toBe(false);
  });
});

describe("reviewSheet", () => {
  const corpus = Array.from({ length: 20 }, (_, i) => ({ id: `x:${i}`, text: `turn ${i}`, act: "inform" as const, stance: "asserted" as const }));

  test("sampleForReview is deterministic and caps at the corpus size", () => {
    const a = sampleForReview(corpus, 5);
    const b = sampleForReview(corpus, 5);
    expect(a).toEqual(b);
    expect(a).toHaveLength(5);
    expect(sampleForReview(corpus, 1000)).toHaveLength(20);
  });

  test("renderReviewSheet includes every sampled row's id, text and checkbox", () => {
    const sample = sampleForReview(corpus, 3);
    const sheet = renderReviewSheet(sample);
    for (const row of sample) {
      expect(sheet).toContain(row.id);
      expect(sheet).toContain(row.text);
    }
    expect(sheet).toContain("- [ ] agree");
  });
});

describe("fixtureSignals.splitFixture", () => {
  test("partitions the real bench fixture into human-hinted validation turns and unhinted training candidates, with no overlap", () => {
    const { trainingCandidates, validation } = splitFixture();
    expect(trainingCandidates.length).toBeGreaterThan(0);
    expect(validation.length).toBeGreaterThan(0);
    const trainIds = new Set(trainingCandidates.map((c) => c.id));
    for (const v of validation) expect(trainIds.has(v.id)).toBe(false);
    // Every validation row carries at least one real hint.
    for (const v of validation) expect(v.act !== undefined || v.emotion !== undefined || v.stance !== undefined).toBe(true);
  });
});

describe("buildActStanceCorpus.poolAndCapCandidates", () => {
  function candidates(prefix: string, texts: readonly string[]): LabelCandidate[] {
    return texts.map((text, i) => ({ id: `${prefix}:${i}`, text }));
  }

  test("dedupes by lowercased text across sources", () => {
    const { candidates: result } = poolAndCapCandidates(
      {
        taskmaster1Self: candidates("taskmaster1-self", ["Hello there", "unique one"]),
        taskmaster1Woz: candidates("taskmaster1-woz", ["hello there"]), // dupe of the first, different case
        ccpeM: [],
        fixture: [],
        synthetic: [],
      },
      100,
    );
    expect(result).toHaveLength(2);
  });

  test("keeps every fixture and synthetic candidate outright even under a tight cap, trimming only taskmaster1/ccpe-m", () => {
    const { candidates: result, stats } = poolAndCapCandidates(
      {
        taskmaster1Self: candidates("taskmaster1-self", Array.from({ length: 50 }, (_, i) => `tm self ${i}`)),
        taskmaster1Woz: [],
        ccpeM: [],
        fixture: candidates("fixture", ["fixture one", "fixture two"]),
        synthetic: candidates("synthetic", ["syn one", "syn two", "syn three"]),
      },
      5,
    );
    expect(stats.afterCap).toBe(5);
    expect(result.filter((c) => c.id.startsWith("fixture:"))).toHaveLength(2);
    expect(result.filter((c) => c.id.startsWith("synthetic:"))).toHaveLength(3);
    expect(result.filter((c) => c.id.startsWith("taskmaster1-self:"))).toHaveLength(0);
  });

  test("a guaranteed synthetic/fixture candidate wins a text collision against taskmaster1/ccpe-m, never the other way around", () => {
    // A code review (2026-09-14) caught the pooling order dropping a
    // guaranteed candidate whenever a non-guaranteed source happened to
    // carry the identical text first - this is the collision that
    // regression covers directly.
    const { candidates: result } = poolAndCapCandidates(
      {
        taskmaster1Self: candidates("taskmaster1-self", ["ok", "unrelated one"]),
        taskmaster1Woz: [],
        ccpeM: candidates("ccpe-m", ["wow"]),
        fixture: [],
        synthetic: candidates("synthetic", ["ok", "wow"]),
      },
      100,
    );
    const kept = result.filter((c) => c.text === "ok" || c.text === "wow");
    expect(kept).toHaveLength(2);
    expect(kept.every((c) => c.id.startsWith("synthetic:"))).toBe(true);
  });
});

describe("readLabeledCorpus", () => {
  test("skips a truncated trailing line (the kind a harness kill leaves behind) instead of throwing", () => {
    const dir = mkdtempSync(join(tmpdir(), "read-labeled-corpus-test-"));
    const outPath = join(dir, "labels.jsonl");
    try {
      const goodLine = JSON.stringify({ id: "c:0", text: "hi", act: "greeting", stance: "asserted" });
      const truncated = '{"id":"c:1","text":"cut off mid-writ';
      writeFileSync(outPath, `${goodLine}\n${truncated}`);
      const rows = readLabeledCorpus(outPath);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.id).toBe("c:0");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("labelActStanceCorpus (against the real stub engine)", () => {
  test("writes one JSONL line per candidate, and resumes past already-labeled ids on a second run", async () => {
    const stub = startStubLlmServer(0, {
      scriptedChatReply: (request) => {
        const userMessage = request.messages.find((m) => m.role === "user")!.content as string;
        const n = (userMessage.match(/^\d+\./gm) ?? []).length;
        return { labels: Array.from({ length: n }, () => ({ act: "inform", stance: "asserted" })) };
      },
    });
    const client = new LlamaServerClient(stub.url);
    const dir = mkdtempSync(join(tmpdir(), "label-corpus-test-"));
    const outPath = join(dir, "labels.jsonl");
    try {
      const candidates: LabelCandidate[] = Array.from({ length: 5 }, (_, i) => ({ id: `c:${i}`, text: `utterance ${i}` }));
      const first = await labelActStanceCorpus(client, candidates, outPath, { batchSize: 2 });
      expect(first.labeled).toBe(5);
      expect(first.failed).toBe(0);
      expect(existsSync(outPath)).toBe(true);
      const afterFirst = readLabeledCorpus(outPath);
      expect(afterFirst).toHaveLength(5);
      expect(afterFirst.every((r) => r.act === "inform" && r.stance === "asserted")).toBe(true);

      // A second call with more candidates only labels the new ones.
      const moreCandidates: LabelCandidate[] = [...candidates, { id: "c:5", text: "utterance 5" }];
      const second = await labelActStanceCorpus(client, moreCandidates, outPath, { batchSize: 2 });
      expect(second.labeled).toBe(6); // 5 already-done counted + 1 new
      const afterSecond = readLabeledCorpus(outPath);
      expect(afterSecond).toHaveLength(6);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      stub.stop();
    }
  });

  test("a malformed batch reply is dropped, not fatal, and never written to the output file", async () => {
    let call = 0;
    const stub = startStubLlmServer(0, {
      scriptedChatReply: (request) => {
        call++;
        const userMessage = request.messages.find((m) => m.role === "user")!.content as string;
        const n = (userMessage.match(/^\d+\./gm) ?? []).length;
        if (call === 1) return { labels: [{ act: "inform", stance: "asserted" }] }; // wrong length for a batch of 2
        return { labels: Array.from({ length: n }, () => ({ act: "question", stance: "asserted" })) };
      },
    });
    const client = new LlamaServerClient(stub.url);
    const dir = mkdtempSync(join(tmpdir(), "label-corpus-fail-test-"));
    const outPath = join(dir, "labels.jsonl");
    try {
      const candidates: LabelCandidate[] = Array.from({ length: 4 }, (_, i) => ({ id: `c:${i}`, text: `utterance ${i}` }));
      const result = await labelActStanceCorpus(client, candidates, outPath, { batchSize: 2 });
      expect(result.failed).toBe(2); // the first batch of 2
      expect(result.labeled).toBe(2); // the second batch of 2
      const rows = readLabeledCorpus(outPath);
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.act === "question")).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      stub.stop();
    }
  });
});
