// #87: the memory judge's extraction scorer, pure so a deterministic test
// can tell a missed fact from an extra one. The bench used to print
// "precision" and "recall" that were both the same two-case pass rate,
// which cannot say whether the judge invents facts or misses them, and
// MEM-05's verdict rule (85 percent recall, precision within five points)
// depends on exactly that distinction.
//
// Each seeded turn carries its expected facts as keyword sets: an
// extracted fact matches an expected one when its text contains every
// keyword of that expected fact (case-insensitive). Each expected fact
// can be matched by one extraction at most; every extraction that
// matches nothing is a false positive; every expected fact nothing
// matched is a miss. An abstention turn has an empty expected list, so
// any extraction from it is a false positive.

export interface JudgeCase {
  /** The seeded turn this case scores. */
  turnId: string;
  label: string;
  /** One keyword set per expected fact. Empty for an abstention turn. */
  expected: readonly (readonly string[])[];
  /** The judge's extracted facts for this turn (memory record texts,
   * whatever their later status: superseded still counts as extracted). */
  extracted: readonly string[];
}

export interface CaseScore {
  turnId: string;
  label: string;
  truePositives: number;
  falsePositives: number;
  misses: number;
  /** The expected facts nothing matched, by their keywords. */
  missed: string[][];
  /** The extractions that matched nothing. */
  extra: string[];
}

export interface ExtractionScore {
  cases: CaseScore[];
  truePositives: number;
  falsePositives: number;
  misses: number;
  /** tp / (tp + fp); null when nothing was extracted at all. */
  precision: number | null;
  /** tp / (tp + misses); null when nothing was expected at all. */
  recall: number | null;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Whole words, not substrings ("nurse" must not match "nursery", "tea"
// must not match "teacher"); an empty keyword set is a mis-authored case
// and throws rather than matching everything.
function matches(extracted: string, keywords: readonly string[]): boolean {
  if (keywords.length === 0) throw new Error("an expected fact needs at least one keyword");
  return keywords.every((k) => new RegExp(`\\b${escapeRegExp(k)}\\b`, "i").test(extracted));
}

export function scoreCase(c: JudgeCase): CaseScore {
  const unmatched = new Set(c.extracted.map((_, i) => i));
  const missed: string[][] = [];
  let truePositives = 0;
  // The most specific expected facts claim first, so an extraction that
  // satisfies two overlapping sets is taken by the narrower one and a
  // perfect extraction is never scored as a miss plus an extra.
  const expectedInOrder = [...c.expected].sort((a, b) => b.length - a.length);
  for (const expected of expectedInOrder) {
    const hit = [...unmatched].find((i) => matches(c.extracted[i]!, expected));
    if (hit === undefined) {
      missed.push([...expected]);
      continue;
    }
    unmatched.delete(hit);
    truePositives++;
  }
  const extra = [...unmatched].map((i) => c.extracted[i]!);
  return { turnId: c.turnId, label: c.label, truePositives, falsePositives: extra.length, misses: missed.length, missed, extra };
}

export function scoreExtraction(cases: readonly JudgeCase[]): ExtractionScore {
  const scored = cases.map(scoreCase);
  const truePositives = scored.reduce((n, s) => n + s.truePositives, 0);
  const falsePositives = scored.reduce((n, s) => n + s.falsePositives, 0);
  const misses = scored.reduce((n, s) => n + s.misses, 0);
  const extractedTotal = truePositives + falsePositives;
  const expectedTotal = truePositives + misses;
  return {
    cases: scored,
    truePositives,
    falsePositives,
    misses,
    precision: extractedTotal === 0 ? null : truePositives / extractedTotal,
    recall: expectedTotal === 0 ? null : truePositives / expectedTotal,
  };
}

export function formatPercent(value: number | null): string {
  return value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
}
