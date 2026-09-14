// Lane 14 item 2: EVAL-07's memory replay, the pure scoring half.
// LongMemEval's own metric is judged accuracy (a grader's yes/no
// verdict against the dataset's reference answer, with abstention and
// knowledge-update reported separately - the coherence review's own
// rule); the reference answer never reaches the turn itself, only the
// grader. LoCoMo's own metric is F1 against its answer text, except
// category 5 (adversarial), whose "correct" behavior is refusing a
// false premise, never repeating the adversarial answer back - LoCoMo's
// own eval treats a model doing that as the failure case, not a score
// against a right answer that does not exist for that category.
/** One dataset-named evidence turn, and whether its own text reached
 * the model's context this question's live turn actually saw - so a
 * miss is classified as retrieval (never reached context) or reasoning
 * (reached context, the reply still got it wrong), the coordinator's
 * own read on a failing row. */
export interface RecallHit {
  turnId: string | null;
  text: string;
  foundInContext: boolean;
}

/** One memory record the judge actually wrote from this question's own
 * ingested history, however it stands at question time - so "never
 * stored" and "stored but not retrieved" read differently even when
 * the question's own answer came out wrong either way. */
export interface JudgeWrittenRecord {
  text: string;
  status: string;
}

export interface LongMemEvalResult {
  questionId: string;
  questionType: string;
  isAbstention: boolean;
  reply: string;
  /** Which grader produced the verdict - recorded so a reader of the
   * numbers knows whose judgment they are reading. */
  grader: "persona-judge" | "4b";
  verdict: "correct" | "incorrect";
  /** Set when ingestion, the live turn or the grader itself threw for
   * this question - the run keeps going (one bad question is scored
   * incorrect, not a lost run), and the message says why. */
  error?: string;
  /** The live question turn's own context message (the recording
   * proxy's systemText, joined) - the memory and episode lines recall
   * actually put in front of the model, verbatim. Null when no model
   * call was made (a thrown question, matching the household bench's
   * own contextMessage: null convention for that case). */
  contextMessage: string | null;
  recallHits: RecallHit[];
  judgeWrittenRecords: JudgeWrittenRecord[];
}

export interface LocomoResult {
  conversationId: string;
  category: 1 | 2 | 3 | 4 | 5;
  reply: string;
  answer: string | null;
  adversarialAnswer: string | null;
  f1: number;
  /** Set when ingestion or the live turn threw for this question. */
  error?: string;
  /** Only meaningful for category 5: true when the reply did not
   * repeat the adversarial answer's own words back. Null for every
   * other category. */
  refusedAdversarialPremise: boolean | null;
  contextMessage: string | null;
  recallHits: RecallHit[];
  judgeWrittenRecords: JudgeWrittenRecord[];
}

const STOPWORDS = new Set(["a", "an", "the", "is", "are", "was", "were", "of", "to", "in", "on", "at", "and", "or"]);

function normalize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0 && !STOPWORDS.has(w));
}

/** SQuAD-style token-overlap F1 between a reply and a gold answer - the
 * standard extractive-QA metric (multiset word overlap, precision and
 * recall over it), pure and offline; LoCoMo's own paper uses the same
 * shape. Two empty strings match perfectly (nothing said, nothing
 * expected); one empty and one not is a total miss. */
export function tokenF1(predicted: string, gold: string): number {
  const p = normalize(predicted);
  const g = normalize(gold);
  if (p.length === 0 && g.length === 0) return 1;
  if (p.length === 0 || g.length === 0) return 0;
  const goldCounts = new Map<string, number>();
  for (const w of g) goldCounts.set(w, (goldCounts.get(w) ?? 0) + 1);
  const used = new Map<string, number>();
  let overlap = 0;
  for (const w of p) {
    const remaining = (goldCounts.get(w) ?? 0) - (used.get(w) ?? 0);
    if (remaining > 0) {
      overlap++;
      used.set(w, (used.get(w) ?? 0) + 1);
    }
  }
  if (overlap === 0) return 0;
  const precision = overlap / p.length;
  const recall = overlap / g.length;
  return (2 * precision * recall) / (precision + recall);
}

/** Below this share of an evidence turn's own words appearing in the
 * context message, the turn is read as not having reached the model -
 * a substantial majority, not every word: the context often paraphrases
 * or truncates a long turn (a memory line summarizes it, an episode
 * line clips it), so this checks whether the FACT reached the model,
 * never an exact quote. */
const RECALL_HIT_THRESHOLD = 0.6;

/** For each dataset-named evidence turn, whether its own text reached
 * the context message the live question turn actually saw - read from
 * what happened (the recording proxy's own captured request), never
 * assumed from "a memory record exists somewhere" (a written record
 * that recall never queries back into context is still a miss). */
export function computeRecallHits(evidence: readonly { turnId: string | null; text: string }[], contextMessage: string | null): RecallHit[] {
  const contextWords = new Set(contextMessage ? normalize(contextMessage) : []);
  return evidence.map((e) => {
    const words = normalize(e.text);
    const hitShare = words.length === 0 ? 0 : words.filter((w) => contextWords.has(w)).length / words.length;
    return { turnId: e.turnId, text: e.text, foundInContext: hitShare >= RECALL_HIT_THRESHOLD };
  });
}

/** Below this overlap with the adversarial answer's own words, a reply
 * is read as not having repeated it back. Not zero: a reply may share
 * an incidental word (a name in the question) without asserting the
 * false premise; 0.5 is a real half-match on both precision and
 * recall, which a refusal only crosses by substantially restating the
 * trap answer. */
const ADVERSARIAL_REPEAT_THRESHOLD = 0.5;

/** Context/recall diagnostics (the coordinator's own request, after the
 * first dry run): gathered by replay.ts from the live turn's own
 * recording-proxy capture and the database, passed in rather than
 * computed here, since neither is this pure function's own job -
 * spread straight into the result so a reader of one question's row
 * never has to join two separate objects back together. */
export interface RecallDiagnostics {
  contextMessage: string | null;
  recallHits: RecallHit[];
  judgeWrittenRecords: JudgeWrittenRecord[];
}

export function scoreLocomo(conversationId: string, category: 1 | 2 | 3 | 4 | 5, reply: string, answer: string | null, adversarialAnswer: string | null, diagnostics: RecallDiagnostics): LocomoResult {
  if (category === 5) {
    const overlapWithTrap = adversarialAnswer ? tokenF1(reply, adversarialAnswer) : 0;
    return { conversationId, category, reply, answer, adversarialAnswer, f1: 0, refusedAdversarialPremise: overlapWithTrap < ADVERSARIAL_REPEAT_THRESHOLD, ...diagnostics };
  }
  return { conversationId, category, reply, answer, adversarialAnswer, f1: answer !== null ? tokenF1(reply, answer) : 0, refusedAdversarialPremise: null, ...diagnostics };
}

export interface TypeTotal {
  type: string;
  n: number;
  correct: number;
  accuracy: number;
}

/** LongMemEval's own reporting rule (the coherence review): abstention
 * is its own bucket, read off `isAbstention`, never folded into
 * whichever question_type an abstention question happens to carry. */
export function longMemEvalTotalsByType(results: readonly LongMemEvalResult[]): TypeTotal[] {
  const byType = new Map<string, LongMemEvalResult[]>();
  for (const r of results) {
    const key = r.isAbstention ? "abstention" : r.questionType;
    const bucket = byType.get(key) ?? [];
    bucket.push(r);
    byType.set(key, bucket);
  }
  return [...byType.entries()].map(([type, rs]) => {
    const correct = rs.filter((r) => r.verdict === "correct").length;
    return { type, n: rs.length, correct, accuracy: correct / rs.length };
  });
}

export interface CategoryTotal {
  category: number;
  n: number;
  /** Null for category 5: scoreLocomo() always sets f1: 0 there (no
   * "right answer" exists to score against), so a mean over it carries
   * no signal - reported as refusalRate instead, never printed or
   * averaged as if it were a real F1. */
  meanF1: number | null;
  /** Category 5 only: the share that refused the adversarial premise. */
  refusalRate: number | null;
}

export function locomoTotalsByCategory(results: readonly LocomoResult[]): CategoryTotal[] {
  const byCategory = new Map<number, LocomoResult[]>();
  for (const r of results) {
    const bucket = byCategory.get(r.category) ?? [];
    bucket.push(r);
    byCategory.set(r.category, bucket);
  }
  return [...byCategory.entries()]
    .sort(([a], [b]) => a - b)
    .map(([category, rs]) => ({
      category,
      n: rs.length,
      meanF1: category === 5 ? null : rs.reduce((s, r) => s + r.f1, 0) / rs.length,
      refusalRate: category === 5 ? rs.filter((r) => r.refusedAdversarialPremise === true).length / rs.length : null,
    }));
}
