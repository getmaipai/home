#!/usr/bin/env bun
// Lane 13 item 2 (docs/plans/session-b-lane-13-2026-09-14.md): dev.md
// section 12's own DailyDialog reference figures ("a question back
// after an inform 43 percent"), computed by hand once, made
// reproducible. Every number below was checked live against the real
// downloaded splits, 2026-09-14, and matches dev.md's quoted figures
// within 0.5 percentage point - except one, documented below.
//
// Split choice: the act and emotion DISTRIBUTIONS use train and
// validation only, honoring registry.json's own held-out note for
// dailydialog ("the test split is never used for register-reference
// sampling in this project"). dev.md's original hand count used all
// three splits (13,118 dialogues, 102,979 turns matches exactly); the
// held-out train+validation figures land within 0.1 percentage point
// of every one of dev.md's quoted distribution numbers, so honoring
// the held-out split costs nothing in practice. The TRANSITION tables
// and the question-mark rate use the training split only, matching
// dev.md's own explicit "in the training split" wording.
//
// A live check found dev.md's own "after a question, ... a question
// 16 [percent]" does not match the act-to-next-act transition
// (question -> question is 11.4 percent of the time, not 16 - a 4.6
// point gap, outside this item's own one-point tolerance and the one
// figure among the six quoted that does not reproduce). The other
// five all land within 0.5 point. The 16 percent turns out to be a
// different measurement dev.md's prose folds into the same sentence
// without saying so: the share of turns AFTER a question whose own
// text carries a "?" (16.3 percent, matching to 0.3 point) - the same
// surface metric the "after an inform ... carries a question mark 43
// percent" clause names explicitly two sentences earlier (42.8
// percent measured, matching to 0.2 point). Both figures are computed
// here (`nextTurnQuestionMarkRate`) and pinned; the act-based
// question -> question transition (11.4 percent) is reported too,
// correctly, as its own number - not silently made to say 16.
//
// Usage: bun run backend/scripts/bench/datasets/reference.ts
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { loadDailyDialogSplit } from "./dailydialog";
import { absolutePath, registryEntry } from "./registry";
import type { DatasetConversation, DatasetTurn } from "./types";

export const ACT_NAMES = ["inform", "question", "directive", "commissive"] as const;
type ActName = (typeof ACT_NAMES)[number];
const ACT_BY_NUMBER: Record<number, ActName> = { 1: "inform", 2: "question", 3: "directive", 4: "commissive" };

export const EMOTION_NAMES = ["neutral", "anger", "disgust", "fear", "happiness", "sadness", "surprise"] as const;
type EmotionName = (typeof EMOTION_NAMES)[number];
const EMOTION_BY_NUMBER: Record<number, EmotionName> = { 0: "neutral", 1: "anger", 2: "disgust", 3: "fear", 4: "happiness", 5: "sadness", 6: "surprise" };

export type ActDistribution = Record<ActName, number>;
export type EmotionDistribution = Record<EmotionName, number>;
export type ActTransitionTable = Record<ActName, ActDistribution>;
export type EmotionTransitionTable = Record<EmotionName, EmotionDistribution>;
export type QuestionMarkFollowRate = Record<ActName, number>;

export interface DailyDialogReference {
  datasetVersion: string;
  datasetChecksums: readonly { path: string; sha256: string }[];
  distributionSplits: readonly string[];
  transitionSplit: string;
  dialogueCount: number;
  turnCount: number;
  actDistribution: ActDistribution;
  emotionDistribution: EmotionDistribution;
  actTransition: ActTransitionTable;
  emotionTransition: EmotionTransitionTable;
  /** Percent of the next turn's own text carrying a "?", by the
   * current turn's act - the surface measurement dev.md's "carries a
   * question mark" clauses name, distinct from the act-based
   * transition to a question-labeled turn. */
  nextTurnQuestionMarkRate: QuestionMarkFollowRate;
}

const round1 = (n: number, total: number): number => Math.round((1000 * n) / total) / 10;

function allTurns(conversations: readonly DatasetConversation[]): DatasetTurn[] {
  return conversations.flatMap((c) => c.sessions.flatMap((s) => s.turns));
}

/** Looks up a turn's act/emotion in the fixed DailyDialog enum
 * (Li et al. 2017: acts 1-4, emotions 0-6) and throws rather than
 * silently miscounting - a code outside either range would otherwise
 * increment a phantom bucket and understate every real one, exactly
 * the kind of silent drift this file exists to catch. This guard is
 * this file's own; a review noted it does not extend to
 * `parseDailyDialog()` (dailydialog.ts, lane 12, already shipped and
 * tested), where the codes are actually produced - deliberately out
 * of scope here, since that loader has its own committed tests this
 * item does not touch. */
function actName(t: DatasetTurn): ActName {
  const name = ACT_BY_NUMBER[t.act!];
  if (!name) throw new Error(`turn ${t.turnId} has an act code (${t.act}) outside DailyDialog's own 1-4 range`);
  return name;
}
function emotionName(t: DatasetTurn): EmotionName {
  const name = EMOTION_BY_NUMBER[t.emotion!];
  if (!name) throw new Error(`turn ${t.turnId} has an emotion code (${t.emotion}) outside DailyDialog's own 0-6 range`);
  return name;
}

export function computeActDistribution(conversations: readonly DatasetConversation[], turns: readonly DatasetTurn[] = allTurns(conversations)): ActDistribution {
  const counts: Record<ActName, number> = { inform: 0, question: 0, directive: 0, commissive: 0 };
  for (const t of turns) counts[actName(t)]++;
  const result = {} as ActDistribution;
  for (const name of ACT_NAMES) result[name] = turns.length === 0 ? 0 : round1(counts[name], turns.length);
  return result;
}

export function computeEmotionDistribution(conversations: readonly DatasetConversation[], turns: readonly DatasetTurn[] = allTurns(conversations)): EmotionDistribution {
  const counts: Record<EmotionName, number> = { neutral: 0, anger: 0, disgust: 0, fear: 0, happiness: 0, sadness: 0, surprise: 0 };
  for (const t of turns) counts[emotionName(t)]++;
  const result = {} as EmotionDistribution;
  for (const name of EMOTION_NAMES) result[name] = turns.length === 0 ? 0 : round1(counts[name], turns.length);
  return result;
}

interface ConsecutivePair {
  from: DatasetTurn;
  to: DatasetTurn;
}

function consecutivePairs(conversations: readonly DatasetConversation[]): ConsecutivePair[] {
  const pairs: ConsecutivePair[] = [];
  for (const c of conversations) {
    for (const s of c.sessions) {
      for (let i = 0; i < s.turns.length - 1; i++) pairs.push({ from: s.turns[i]!, to: s.turns[i + 1]! });
    }
  }
  return pairs;
}

/** Groups a pair list's own `to` turns by the `from` turn's act -
 * the one grouping step `computeActTransition` and
 * `computeNextTurnQuestionMarkRate` both need, shared so the two can
 * never end up grouping the same pairs two different ways. */
function groupNextTurnsByFromAct(pairs: readonly ConsecutivePair[]): Record<ActName, DatasetTurn[]> {
  const byFrom: Record<ActName, DatasetTurn[]> = { inform: [], question: [], directive: [], commissive: [] };
  for (const { from, to } of pairs) byFrom[actName(from)].push(to);
  return byFrom;
}

export function computeActTransition(
  conversations: readonly DatasetConversation[],
  pairs: readonly ConsecutivePair[] = consecutivePairs(conversations),
  byFrom: Record<ActName, DatasetTurn[]> = groupNextTurnsByFromAct(pairs),
): ActTransitionTable {
  const result = {} as ActTransitionTable;
  for (const fromName of ACT_NAMES) {
    const tos = byFrom[fromName];
    const counts: Record<ActName, number> = { inform: 0, question: 0, directive: 0, commissive: 0 };
    for (const t of tos) counts[actName(t)]++;
    const row = {} as ActDistribution;
    for (const toName of ACT_NAMES) row[toName] = tos.length === 0 ? 0 : round1(counts[toName], tos.length);
    result[fromName] = row;
  }
  return result;
}

export function computeEmotionTransition(conversations: readonly DatasetConversation[], pairs: readonly ConsecutivePair[] = consecutivePairs(conversations)): EmotionTransitionTable {
  const byFrom: Record<EmotionName, DatasetTurn[]> = { neutral: [], anger: [], disgust: [], fear: [], happiness: [], sadness: [], surprise: [] };
  for (const { from, to } of pairs) byFrom[emotionName(from)].push(to);
  const result = {} as EmotionTransitionTable;
  for (const fromName of EMOTION_NAMES) {
    const tos = byFrom[fromName];
    const counts: Record<EmotionName, number> = { neutral: 0, anger: 0, disgust: 0, fear: 0, happiness: 0, sadness: 0, surprise: 0 };
    for (const t of tos) counts[emotionName(t)]++;
    const row = {} as EmotionDistribution;
    for (const toName of EMOTION_NAMES) row[toName] = tos.length === 0 ? 0 : round1(counts[toName], tos.length);
    result[fromName] = row;
  }
  return result;
}

export function computeNextTurnQuestionMarkRate(
  conversations: readonly DatasetConversation[],
  pairs: readonly ConsecutivePair[] = consecutivePairs(conversations),
  byFrom: Record<ActName, DatasetTurn[]> = groupNextTurnsByFromAct(pairs),
): QuestionMarkFollowRate {
  const result = {} as QuestionMarkFollowRate;
  for (const fromName of ACT_NAMES) {
    const tos = byFrom[fromName];
    const withQuestionMark = tos.filter((t) => t.text.includes("?")).length;
    result[fromName] = tos.length === 0 ? 0 : round1(withQuestionMark, tos.length);
  }
  return result;
}

export function buildReference(distributionSplitConversations: readonly DatasetConversation[], trainConversations: readonly DatasetConversation[]): DailyDialogReference {
  const entry = registryEntry("dailydialog");
  // One pass over the distribution split's own turns and the training
  // split's own consecutive pairs (and, for the latter, one grouping
  // pass by from-act), shared by every computation below instead of
  // each re-walking or re-grouping the same ~95k/~85k items on its own
  // (a review found the original version re-walking three times and,
  // after a first fix, still re-grouping the shared pairs twice).
  const distributionTurns = allTurns(distributionSplitConversations);
  const trainPairs = consecutivePairs(trainConversations);
  const trainByFromAct = groupNextTurnsByFromAct(trainPairs);
  return {
    datasetVersion: entry.version,
    datasetChecksums: entry.files,
    distributionSplits: ["train", "validation"],
    transitionSplit: "train",
    dialogueCount: distributionSplitConversations.length,
    turnCount: distributionTurns.length,
    actDistribution: computeActDistribution(distributionSplitConversations, distributionTurns),
    emotionDistribution: computeEmotionDistribution(distributionSplitConversations, distributionTurns),
    actTransition: computeActTransition(trainConversations, trainPairs, trainByFromAct),
    emotionTransition: computeEmotionTransition(trainConversations, trainPairs),
    nextTurnQuestionMarkRate: computeNextTurnQuestionMarkRate(trainConversations, trainPairs, trainByFromAct),
  };
}

async function main() {
  const train = await loadDailyDialogSplit(absolutePath("dailydialog/train.zip"), "train");
  const validation = await loadDailyDialogSplit(absolutePath("dailydialog/validation.zip"), "validation");
  const reference = buildReference([...train, ...validation], train);

  const outDir = join(import.meta.dir, "reference");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, "dailydialog.json");
  writeFileSync(outPath, `${JSON.stringify(reference, null, 2)}\n`);

  console.log(`Wrote ${outPath}`);
  console.log(`${reference.dialogueCount} dialogues, ${reference.turnCount} turns (train+validation)`);
  console.log(`act distribution: ${JSON.stringify(reference.actDistribution)}`);
  console.log(`emotion distribution: ${JSON.stringify(reference.emotionDistribution)}`);
  console.log(`after inform: ${JSON.stringify(reference.actTransition.inform)}, next carries "?" ${reference.nextTurnQuestionMarkRate.inform}%`);
  console.log(`after question: ${JSON.stringify(reference.actTransition.question)}, next carries "?" ${reference.nextTurnQuestionMarkRate.question}%`);
  console.log(`after directive: ${JSON.stringify(reference.actTransition.directive)}`);
}

if (import.meta.main) main();
