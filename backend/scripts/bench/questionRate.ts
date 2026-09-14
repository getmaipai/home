// Finding 23 (docs/plans/media-conversation-program-2026-09-13.md): the
// hub asks a question back far more often than a person does. The
// bench prints, per run, the share of replies carrying a question mark,
// overall and split by what the person's turn was (the frozen signal's
// act: a question or not), beside the DailyDialog reference the
// datasets' own reference.ts computed (reference/dailydialog.json):
// `nextTurnQuestionMarkRate` is the share of turns after an act whose
// own text carries a "?", and `actTransition` the act-level question
// rate; the overall reference is those rates weighted by the act
// distribution. Pure: no engine, no database, so a test can pin it.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DailyDialogReference } from "./datasets/reference";

export interface QuestionRateRow {
  reply: string;
  /** The person's turn's act, from the frozen signal; null when the
   * turn logged none. */
  act: string | null;
}

export interface QuestionRate {
  /** Replies carrying a question mark over replies, as percentages. */
  overall: number;
  afterNonQuestion: number;
  afterQuestion: number;
  counts: { replies: number; asked: number; afterNonQuestion: number; askedAfterNonQuestion: number; afterQuestion: number; askedAfterQuestion: number };
}

const pct = (n: number, d: number): number => (d === 0 ? NaN : Math.round((1000 * n) / d) / 10);

export function questionRate(rows: readonly QuestionRateRow[]): QuestionRate {
  const replied = rows.filter((r) => r.reply.trim().length > 0);
  const asked = (xs: readonly QuestionRateRow[]) => xs.filter((r) => r.reply.includes("?")).length;
  const afterQuestion = replied.filter((r) => r.act === "question");
  const afterNonQuestion = replied.filter((r) => r.act !== null && r.act !== "question");
  return {
    overall: pct(asked(replied), replied.length),
    afterNonQuestion: pct(asked(afterNonQuestion), afterNonQuestion.length),
    afterQuestion: pct(asked(afterQuestion), afterQuestion.length),
    counts: { replies: replied.length, asked: asked(replied), afterNonQuestion: afterNonQuestion.length, askedAfterNonQuestion: asked(afterNonQuestion), afterQuestion: afterQuestion.length, askedAfterQuestion: asked(afterQuestion) },
  };
}

export interface QuestionReference {
  /** The act-weighted share of next turns carrying a "?". */
  overall: number;
  /** After an inform, the largest non-question class. */
  afterInform: number;
  afterInformAct: number;
  afterQuestion: number;
  afterQuestionAct: number;
}

export function loadQuestionReference(path = join(import.meta.dir, "datasets", "reference", "dailydialog.json")): QuestionReference {
  const ref = JSON.parse(readFileSync(path, "utf-8")) as DailyDialogReference;
  const acts = Object.keys(ref.actDistribution) as (keyof typeof ref.actDistribution)[];
  const overall = acts.reduce((sum, act) => sum + (ref.actDistribution[act] / 100) * ref.nextTurnQuestionMarkRate[act], 0);
  return {
    overall: Math.round(overall * 10) / 10,
    afterInform: ref.nextTurnQuestionMarkRate.inform,
    afterInformAct: ref.actTransition.inform.question,
    afterQuestion: ref.nextTurnQuestionMarkRate.question,
    afterQuestionAct: ref.actTransition.question.question,
  };
}

const fmt = (x: number): string => (Number.isNaN(x) ? "n/a" : `${x.toFixed(1)}%`);

/** The two lines the bench prints. */
export function questionRateSummary(rows: readonly QuestionRateRow[], reference: QuestionReference = loadQuestionReference()): string {
  const r = questionRate(rows);
  return [
    `replies with a question: ${fmt(r.overall)} (${r.counts.asked} of ${r.counts.replies}); after a non-question turn ${fmt(r.afterNonQuestion)} (${r.counts.askedAfterNonQuestion} of ${r.counts.afterNonQuestion}); after a question ${fmt(r.afterQuestion)} (${r.counts.askedAfterQuestion} of ${r.counts.afterQuestion})`,
    `reference (DailyDialog, a "?" in the next turn): ${fmt(reference.overall)} overall (act-weighted); after an inform ${fmt(reference.afterInform)} (a question act ${fmt(reference.afterInformAct)}); after a question ${fmt(reference.afterQuestion)} (a question act ${fmt(reference.afterQuestionAct)})`,
  ].join("\n");
}
