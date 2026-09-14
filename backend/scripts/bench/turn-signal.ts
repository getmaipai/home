// ACT-01 (dev.md section 12 part 4): the turn signal's reference and its
// baseline, research use only. DailyDialog (CC BY-NC-SA, EVAL-07's
// registry) trains nothing that ships; here it is the distribution
// reference (the run header: acts, emotions, what a person does next)
// and the validation set for the rule pass, scored against the current
// lexical shape so ACT-02's heads have a baseline to beat. No engine, no
// database: classifyTurnSignal() is pure, and this script never writes
// anything but its report.
//
//   bun run scripts/bench/turn-signal.ts            # the test split
//   bun run scripts/bench/turn-signal.ts --split validation
//
// The label mapping (pinned in the registry's own dailydialog entry and
// in the loader): acts 1 to 4 are inform, question, directive,
// commissive; emotions 0 to 6 are neutral, anger, disgust, fear,
// happiness, sadness, surprise. DailyDialog folds greetings, closings
// and acknowledgments into inform; the design's relabel (a DailyDialog
// inform the rule pass reads as a management act scores as that act)
// is, on the four DailyDialog classes, the same as folding the rule's
// management act back into inform, so the score is computed once that
// way and the management reads are counted beside it. The management
// acts themselves get their own reviewed rows in the conversation
// fixture, since a relabel by the pass under test cannot validate them.
import { registryEntry, absolutePath } from "./datasets/registry";
import { loadDailyDialogSplit } from "./datasets/dailydialog";
import type { DatasetConversation } from "./datasets/types";
import { classifyTurnSignal, type Act, type Emotion } from "@/lib/turnSignal";
import { utteranceShape } from "@/lib/utteranceShape";

const ACTS: readonly Act[] = ["inform", "question", "directive", "commissive"];
const MANAGEMENT: readonly Act[] = ["greeting", "closing", "backchannel"];
const EMOTIONS: readonly Emotion[] = ["neutral", "anger", "disgust", "fear", "happiness", "sadness", "surprise"];
const ACT_BY_NUMBER: Record<number, Act> = { 1: "inform", 2: "question", 3: "directive", 4: "commissive" };
const EMOTION_BY_NUMBER: Record<number, Emotion> = { 0: "neutral", 1: "anger", 2: "disgust", 3: "fear", 4: "happiness", 5: "sadness", 6: "surprise" };
// DailyDialog has no installed packages to declare command openers; the
// everyday imperative verbs guards.ts's REQUEST_RE already trusts stand
// in for what a household's bundled packages declare.
const EVERYDAY_OPENERS: ReadonlySet<string> = new Set(["text", "send", "order", "book", "email", "add", "set", "call", "print", "buy", "schedule", "message", "put", "turn", "play", "lock", "unlock", "open", "close", "start", "stop", "remind", "remember", "tell", "give", "show", "bring", "get", "take", "let", "come", "go", "wait", "look", "try", "check", "make", "find", "help"]);

type Split = "train" | "validation" | "test";

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

interface Turn {
  text: string;
  act: Act;
  emotion: Emotion;
}

function turnsOf(conversations: DatasetConversation[]): Turn[][] {
  return conversations.map((c) =>
    c.sessions.flatMap((s) => s.turns).map((t) => ({ text: t.text, act: ACT_BY_NUMBER[t.act as number] ?? "inform", emotion: EMOTION_BY_NUMBER[t.emotion as number] ?? "neutral" })),
  );
}

const pct = (n: number, d: number) => (d === 0 ? "n/a" : `${((100 * n) / d).toFixed(1)}%`);

/** The distribution reference: counts, act and emotion shares, and the
 * transitions (what a person does next) on the training split. */
function distribution(splits: Record<Split, Turn[][]>): void {
  const all = (Object.values(splits) as Turn[][][]).flat();
  const turns = all.flat();
  const actCounts = new Map<Act, number>();
  const emotionCounts = new Map<Emotion, number>();
  for (const t of turns) {
    actCounts.set(t.act, (actCounts.get(t.act) ?? 0) + 1);
    emotionCounts.set(t.emotion, (emotionCounts.get(t.emotion) ?? 0) + 1);
  }
  console.log(`dialogues ${all.length}; turns ${turns.length}`);
  console.log(`acts: ${ACTS.map((a) => `${a} ${pct(actCounts.get(a) ?? 0, turns.length)}`).join(", ")}`);
  console.log(`emotions: ${EMOTIONS.map((e) => `${e} ${pct(emotionCounts.get(e) ?? 0, turns.length)}`).join(", ")}`);
  const next = new Map<string, number>();
  const after = new Map<Act, number>();
  let questionMarkAfterInform = 0;
  for (const dialogue of splits.train) {
    for (let i = 0; i + 1 < dialogue.length; i++) {
      const a = dialogue[i]!.act;
      const b = dialogue[i + 1]!;
      after.set(a, (after.get(a) ?? 0) + 1);
      next.set(`${a}>${b.act}`, (next.get(`${a}>${b.act}`) ?? 0) + 1);
      if (a === "inform" && /\?/.test(b.text)) questionMarkAfterInform++;
    }
  }
  const t = (a: Act, b: Act) => pct(next.get(`${a}>${b}`) ?? 0, after.get(a) ?? 0);
  console.log(`transitions (train): after an inform, an inform ${t("inform", "inform")}, a question ${t("inform", "question")}, a question mark in the reply ${pct(questionMarkAfterInform, after.get("inform") ?? 0)}; after a question, an inform ${t("question", "inform")}, a question ${t("question", "question")}; after a directive, a commissive ${t("directive", "commissive")}`);
}

interface Confusion {
  labels: readonly string[];
  counts: Map<string, number>;
}

function confusion(labels: readonly string[]): Confusion {
  return { labels, counts: new Map() };
}
function tally(c: Confusion, gold: string, predicted: string): void {
  c.counts.set(`${gold}>${predicted}`, (c.counts.get(`${gold}>${predicted}`) ?? 0) + 1);
}
function metrics(c: Confusion): { macroF1: number; accuracy: number; perClass: string[]; matrix: string[] } {
  let total = 0;
  let correct = 0;
  const perClass: string[] = [];
  let f1Sum = 0;
  for (const label of c.labels) {
    let tp = 0;
    let fp = 0;
    let fn = 0;
    for (const other of c.labels) {
      const goldIs = c.counts.get(`${label}>${other}`) ?? 0;
      const predIs = c.counts.get(`${other}>${label}`) ?? 0;
      if (other === label) tp = goldIs;
      else {
        fn += goldIs;
        fp += predIs;
      }
    }
    const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
    const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
    const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
    f1Sum += f1;
    total += tp + fn;
    correct += tp;
    perClass.push(`${label}: p ${precision.toFixed(3)} r ${recall.toFixed(3)} f1 ${f1.toFixed(3)} (n ${tp + fn})`);
  }
  const matrix = c.labels.map((gold) => `${gold.padEnd(12)} ${c.labels.map((p) => String(c.counts.get(`${gold}>${p}`) ?? 0).padStart(7)).join("")}`);
  return { macroF1: f1Sum / c.labels.length, accuracy: total === 0 ? 0 : correct / total, perClass, matrix: [`${"gold\\pred".padEnd(12)} ${c.labels.map((p) => p.padStart(7)).join("")}`, ...matrix] };
}

function shapeAct(text: string): Act {
  const shape = utteranceShape(text, EVERYDAY_OPENERS);
  return shape === "command" ? "directive" : shape === "question" ? "question" : "inform";
}

function score(dialogues: Turn[][], split: Split): void {
  const rulesRaw = confusion(ACTS);
  const shapeRaw = confusion(ACTS);
  const emotionRules = confusion(EMOTIONS);
  const management = new Map<Act, number>();
  let managementOnInform = 0;
  let neutralGoldMarked = 0;
  let neutralGold = 0;
  let n = 0;
  const started = performance.now();
  for (const dialogue of dialogues) {
    for (const turn of dialogue) {
      n++;
      const signal = classifyTurnSignal({ text: turn.text, commandOpeners: EVERYDAY_OPENERS, ageBand: "adult" });
      const predicted = signal.primary_act;
      const shaped = shapeAct(turn.text);
      const isManagement = MANAGEMENT.includes(predicted);
      if (isManagement) management.set(predicted, (management.get(predicted) ?? 0) + 1);
      // A management act the rules read counts as an inform on the four
      // DailyDialog classes (the fold DailyDialog itself applies).
      const predictedFour: Act = isManagement ? "inform" : predicted;
      if (isManagement && turn.act === "inform") managementOnInform++;
      tally(rulesRaw, turn.act, predictedFour);
      tally(shapeRaw, turn.act, shaped);
      tally(emotionRules, turn.emotion, signal.expressed_emotion);
      if (turn.emotion === "neutral") {
        neutralGold++;
        if (signal.expressed_emotion !== "neutral") neutralGoldMarked++;
      }
    }
  }
  const elapsed = performance.now() - started;
  console.log(`\n## Acts on the ${split} split (${n} turns; the rules read ${MANAGEMENT.map((a) => `${a} ${management.get(a) ?? 0}`).join(", ")}, ${managementOnInform} of them on a DailyDialog inform; scored folded into inform)\n`);
  for (const [name, c] of [
    ["rule pass", rulesRaw],
    ["current lexical shape (utteranceShape, folded to inform/question/directive)", shapeRaw],
  ] as const) {
    const m = metrics(c);
    console.log(`${name}: macro F1 ${m.macroF1.toFixed(3)}, accuracy ${m.accuracy.toFixed(3)}`);
    for (const line of m.perClass) console.log(`  ${line}`);
  }
  const m = metrics(rulesRaw);
  console.log("\nconfusion, rule pass:");
  for (const line of m.matrix) console.log(`  ${line}`);
  const e = metrics(emotionRules);
  console.log(`\n## Emotions on the ${split} split (the rule pass; the common case is the head's, ACT-02)\n`);
  console.log(`macro F1 ${e.macroF1.toFixed(3)}, accuracy ${e.accuracy.toFixed(3)} (an always-neutral classifier scores the neutral share); neutral marked as an emotion ${pct(neutralGoldMarked, neutralGold)} of ${neutralGold} neutral turns`);
  for (const line of e.perClass) console.log(`  ${line}`);
  console.log(`\nclassifier cost: ${(elapsed / n).toFixed(3)} ms per turn over ${n} turns (${Math.round(elapsed)} ms)`);
}

async function main(): Promise<void> {
  const entry = registryEntry("dailydialog");
  const split = (argValue("--split") ?? "test") as Split;
  if (!["train", "validation", "test"].includes(split)) throw new Error(`--split must be train, validation or test, not ${split}`);
  const zipFor = (s: Split) => absolutePath(entry.files.find((f) => f.path.endsWith(`${s}.zip`))!.path);
  console.log(`# turn-signal bench (research use only; ${entry.name}, ${entry.license}, ${entry.version})\n`);
  console.log("## The reference: DailyDialog across its three splits\n");
  const splits = {
    train: turnsOf(await loadDailyDialogSplit(zipFor("train"), "train")),
    validation: turnsOf(await loadDailyDialogSplit(zipFor("validation"), "validation")),
    test: turnsOf(await loadDailyDialogSplit(zipFor("test"), "test")),
  };
  distribution(splits);
  score(splits[split], split);
}

await main();
