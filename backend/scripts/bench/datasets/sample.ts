// The coherence review's own LongMemEval sample (dev.md, "Coherence
// review, 2026-09-14", question 5): 40 questions per question type,
// abstention and knowledge-update first, seeded and deterministic, so
// the replay (Session A's own later item) is reproducible and the
// judge is run once per history and cached by checksum rather than
// re-sampled on every run.
import type { LongMemEvalQuestion } from "./types";

export interface SampleManifestEntry {
  questionId: string;
  questionType: string;
  isAbstention: boolean;
}

// knowledge-update named first, matching the coherence review's own
// wording ("abstention and knowledge-update first") as an ordering
// rule over classes too, not only over which questions win a slot
// within one class (the per-class logic below already gives every
// abstention question priority inside its own class regardless of this
// order). The rest is alphabetical - arbitrary, but fixed, so array
// order never depends on object key insertion order across runs.
const CLASS_ORDER = [
  "knowledge-update",
  "multi-session",
  "single-session-assistant",
  "single-session-preference",
  "single-session-user",
  "temporal-reasoning",
];

// mulberry32: a tiny, dependency-free deterministic PRNG (public
// domain). Not cryptographic, not meant to be - only meant to be the
// same sequence on every machine and every run for a given seed, which
// is the one property a reproducible sample needs. Exported (lane 13
// item 1's mine.ts is the second caller) rather than duplicated: one
// definition, the org's own rule.
export function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  const rng = mulberry32(seed);
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

/** The fixed seed this sample is pinned to - changing it produces a
 * different (still valid, still deterministic) sample, which is exactly
 * why it is a named constant checked into the file that builds
 * sample-manifest.json, not a runtime default a caller could vary by
 * accident. */
export const SAMPLE_SEED = 20260914;

function byQuestionType(questions: readonly LongMemEvalQuestion[]): Map<string, LongMemEvalQuestion[]> {
  const byType = new Map<string, LongMemEvalQuestion[]>();
  for (const q of questions) {
    const bucket = byType.get(q.questionType) ?? [];
    bucket.push(q);
    byType.set(q.questionType, bucket);
  }
  return byType;
}

function orderedTypes(byType: ReadonlyMap<string, unknown>): string[] {
  return [...byType.keys()].sort((a, b) => {
    const ai = CLASS_ORDER.indexOf(a);
    const bi = CLASS_ORDER.indexOf(b);
    return (ai === -1 ? CLASS_ORDER.length : ai) - (bi === -1 ? CLASS_ORDER.length : bi);
  });
}

export function selectLongMemEvalSample(questions: readonly LongMemEvalQuestion[], perClass = 40, seed = SAMPLE_SEED): SampleManifestEntry[] {
  const byType = byQuestionType(questions);
  const types = orderedTypes(byType);

  const manifest: SampleManifestEntry[] = [];
  for (const type of types) {
    const pool = byType.get(type)!;
    const abstention = pool.filter((q) => q.isAbstention);
    const rest = pool.filter((q) => !q.isAbstention);
    // Abstention questions are prioritized (dev.md's own wording): every
    // one of them wins a slot before the shuffle fills the rest, up to
    // the class's own target - a class with more abstention questions
    // than the target keeps only the first `perClass` of them, in the
    // same seeded shuffled order the rest of the class uses, so "which
    // ones" is still reproducible rather than an arbitrary array slice.
    const target = Math.min(perClass, pool.length);
    const shuffledAbstention = seededShuffle(abstention, seed);
    const shuffledRest = seededShuffle(rest, seed + 1);
    const selected = [...shuffledAbstention, ...shuffledRest].slice(0, target);
    for (const q of selected) {
      manifest.push({ questionId: q.questionId, questionType: q.questionType, isAbstention: q.isAbstention });
    }
  }

  return manifest;
}

/** One question type's own abstention math for a stratified sample -
 * recorded alongside the entries (not just baked silently into which
 * ids got picked) so a reader of the manifest sees the rule, not just
 * its result. */
export interface StratumInfo {
  questionType: string;
  poolSize: number;
  abstentionPoolSize: number;
  /** abstentionPoolSize / poolSize, rounded to 3 decimals. */
  abstentionRate: number;
  /** round(perClass * abstentionRate), clamped to what the pool and the
   * class target actually allow. */
  abstentionTarget: number;
}

export interface StratifiedSample {
  entries: SampleManifestEntry[];
  strata: StratumInfo[];
}

/** A baseline-v0-shaped sample (small perClass, e.g. 5): every class's
 * own abstention share is drawn PROPORTIONAL to that type's real
 * abstention rate in the source set, never prioritized ahead of it the
 * way selectLongMemEvalSample() above does for the 40-per-class S-set
 * sample. That rule is right at 40 per class (there is room for every
 * abstention question and the rest of the class both); at 5 per class
 * it made every class with an abstention pool of 5+ come out entirely
 * abstention, which is not a representative baseline of anything - the
 * coordinator's own fix, 2026-09-14, after the first v0 manifest came
 * out that way. The oracle set's own real per-type abstention rates are
 * small (roughly 4.5%-9%), so at perClass=5 this rounds to 0 abstention
 * questions in every class today - the honest, expected result of
 * proportional representation at this size, not a bug, and exactly why
 * `strata` records the computed rate and target rather than leaving a
 * reader to wonder why no abstention question appears. */
export function selectStratifiedLongMemEvalSample(questions: readonly LongMemEvalQuestion[], perClass = 5, seed = SAMPLE_SEED): StratifiedSample {
  const byType = byQuestionType(questions);
  const types = orderedTypes(byType);

  const entries: SampleManifestEntry[] = [];
  const strata: StratumInfo[] = [];
  for (const type of types) {
    const pool = byType.get(type)!;
    const abstention = pool.filter((q) => q.isAbstention);
    const rest = pool.filter((q) => !q.isAbstention);
    const abstentionRate = pool.length === 0 ? 0 : abstention.length / pool.length;
    const abstentionTarget = Math.min(Math.round(perClass * abstentionRate), abstention.length, perClass);
    const restTarget = Math.min(perClass - abstentionTarget, rest.length);
    const shuffledAbstention = seededShuffle(abstention, seed);
    const shuffledRest = seededShuffle(rest, seed + 1);
    const selected = [...shuffledAbstention.slice(0, abstentionTarget), ...shuffledRest.slice(0, restTarget)];
    for (const q of selected) entries.push({ questionId: q.questionId, questionType: q.questionType, isAbstention: q.isAbstention });
    strata.push({ questionType: type, poolSize: pool.length, abstentionPoolSize: abstention.length, abstentionRate: Math.round(abstentionRate * 1000) / 1000, abstentionTarget });
  }

  return { entries, strata };
}
