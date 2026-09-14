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

/** The dedicated abstention stratum's own math, alongside the six
 * per-type strata - the same "record the rule, not just its result"
 * reasoning StratumInfo already applies per type. */
export interface AbstentionStratumInfo {
  /** Every abstention question in the whole source set (context: how
   * large a pool this stratum drew from before any exclusion) - NOT
   * reduced by ids a per-type stratum already picked; `target` is the
   * number actually reserved for this stratum after that exclusion, so
   * a gap between the two here means the type strata's own proportional
   * math (usually, but not guaranteed to be, zero) already spent some
   * of this pool. */
  poolSize: number;
  /** How many abstention questions this stratum actually selected,
   * clamped to what remained after excluding ids the type strata already
   * chose - this stratum never double-picks one of those. */
  target: number;
}

/** A baseline-v0 entry carries which stratum actually picked it,
 * explicitly - a review found the alternative (recovering this from
 * `questionType` plus the type stratum's own `abstentionTarget`)
 * actively wrong: the dedicated stratum's own picks keep their real
 * `questionType` (a knowledge-update question the dedicated stratum
 * drew still reads `questionType: "knowledge-update"`), so a reader
 * checking `abstentionTarget === 0` for that type would misattribute
 * the pick to the type stratum instead. */
export interface BaselineV0Entry extends SampleManifestEntry {
  fromAbstentionStratum: boolean;
}

export interface BaselineV0Sample {
  entries: BaselineV0Entry[];
  strata: StratumInfo[];
  abstentionStratum: AbstentionStratumInfo;
}

/** Baseline v0's actual shape (the coordinator, 2026-09-14, second
 * pass): proportional representation alone left abstention - "the
 * answer is that nothing was said", the class that maps onto the
 * project's worst defect class - measured by zero questions in a
 * 30-question sample, since the oracle set's own real per-type rates
 * all round to 0 at perClass=5 (selectStratifiedLongMemEvalSample's own
 * documented, correct behavior; not touched here). This layers a
 * SEVENTH stratum on top: a fixed number of abstention questions drawn
 * from the whole source set regardless of type, so v0 always measures
 * something on that class. 35 total at the default sizing (30 from the
 * six type strata + 5 dedicated), not 30 - a real change from the
 * first version of this manifest, recorded via `abstentionStratum`
 * exactly the way `strata` already records the per-type rule.
 *
 * A dedicated-stratum pick keeps its own real `questionType` (it is a
 * real question of that type, just drawn by a different rule), so
 * grouping the returned `entries` by `questionType` alone no longer
 * gives a uniform `perClass` per type the way the six strata's own
 * output would on its own - some types end up with more than `perClass`
 * once the dedicated stratum's own picks land on them. `fromAbstentionStratum`
 * on each entry is the one reliable way to tell which stratum picked
 * it; never infer it from `questionType` plus a type stratum's own
 * `abstentionTarget`. */
export function selectBaselineV0Sample(questions: readonly LongMemEvalQuestion[], perClass = 5, abstentionStratumSize = 5, seed = SAMPLE_SEED): BaselineV0Sample {
  const { entries: typeEntries, strata } = selectStratifiedLongMemEvalSample(questions, perClass, seed);
  const alreadySelected = new Set(typeEntries.map((e) => e.questionId));
  const abstentionPool = questions.filter((q) => q.isAbstention && !alreadySelected.has(q.questionId));
  // seed + 2: selectStratifiedLongMemEvalSample already spends seed and
  // seed + 1 on its own per-type abstention/rest shuffles, so this
  // stratum's own shuffle order needs a third, independent offset -
  // reusing either of the first two would make this stratum's picks a
  // deterministic function of one type's own shuffle rather than its
  // own thing.
  const shuffled = seededShuffle(abstentionPool, seed + 2);
  const target = Math.min(abstentionStratumSize, shuffled.length);
  const abstentionEntries = shuffled.slice(0, target).map((q) => ({ questionId: q.questionId, questionType: q.questionType, isAbstention: q.isAbstention, fromAbstentionStratum: true }));

  return {
    entries: [...typeEntries.map((e) => ({ ...e, fromAbstentionStratum: false })), ...abstentionEntries],
    strata,
    // Summed from the strata this call already computed, not a second
    // independent `questions.filter()` scan - a review found the two
    // duplicating each other, agreeing only because every question
    // belongs to exactly one type bucket today; one source of truth
    // instead of two that have to agree by coincidence.
    abstentionStratum: { poolSize: strata.reduce((sum, s) => sum + s.abstentionPoolSize, 0), target },
  };
}
