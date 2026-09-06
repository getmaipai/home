// Tier 1 routing on real embeddings (session-c-brain-and-voice.md step 1),
// replacing turnEngine.ts's own documented placeholder: `exampleScore()`
// there was keyword overlap against `routing.examples` "since no embedder
// exists (4.11's embed role)" - lib/llm.ts's `embed()` is real now
// (session-c-brain-and-voice.md step 0 extended it for the per-person
// rate limiter; the embed role itself shipped in session-a-intelligence.md
// step 5). This module owns the real thing; turnEngine.ts keeps
// `exampleScore()` only as the keyword-overlap fallback for when the
// embed backend is down, exactly as this step's own text asks for.
//
// The store mirrors memory.ts's `memoryEmbeddings` (same buffer shape:
// `space`/`dims`/`vector`/`hlc`, reusing its `vectorToBuffer`/
// `bufferToVector`), keyed instead by (package_id, example_hash, space):
// a package declares several `routing.examples`, not one, and hashing
// each example's own text is what makes "a changed example re-embeds, an
// unchanged one is a pure lookup" real rather than an unenforced
// intention. No space reconciliation beyond memory.ts's own precedent
// (recall()'s cosine comparison never filters by space either): a single
// pinned embedding model is the whole household's reality today, and a
// model change is a future migration, not a per-call check here.
import { createHash } from "node:crypto";
import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { routingEmbeddings } from "@/db/schema";
import { embed } from "@/lib/llm";
import { cosineSimilarity, vectorToBuffer, bufferToVector } from "@/lib/memory";
import { nextHlc } from "@/lib/hlc";

export interface RoutingCandidate {
  id: string;
  examples: readonly string[] | undefined;
}

function hashExample(example: string): string {
  return createHash("sha256").update(example).digest("hex");
}

/** At first load of each package (turnEngine.ts's own `loadAllManifests()`
 * re-reads every manifest every turn, so "first load" in practice means
 * "the first turn after an example's hash isn't in the store yet"):
 * embeds every `routing.examples` entry not already stored under its
 * current hash, one batched `embed()` call for everything missing rather
 * than one call per example. Best-effort and silent on failure - the
 * embed backend being down here just means Tier 1 falls back to keyword
 * overlap for this turn (turnEngine.ts's own fallback), never a thrown
 * error partway through preparing a turn. */
export async function ensureRoutingEmbeddings(candidates: readonly RoutingCandidate[]): Promise<void> {
  const packageIds = candidates.map((c) => c.id);
  // One query for everything already stored across every candidate,
  // never one query per example (a code review, 2026-09-06, found the
  // first cut doing exactly that - a real per-turn cost that only grows
  // with the catalog, for a check that's almost always "yes, skip it").
  const existingHashes = new Set(
    packageIds.length === 0
      ? []
      : db
          .select({ packageId: routingEmbeddings.packageId, exampleHash: routingEmbeddings.exampleHash })
          .from(routingEmbeddings)
          .where(inArray(routingEmbeddings.packageId, packageIds))
          .all()
          .map((r) => `${r.packageId}:${r.exampleHash}`),
  );

  const pending: { packageId: string; example: string; hash: string }[] = [];
  for (const { id, examples } of candidates) {
    for (const example of examples ?? []) {
      const hash = hashExample(example);
      if (!existingHashes.has(`${id}:${hash}`)) pending.push({ packageId: id, example, hash });
    }
  }
  if (pending.length === 0) return;

  let result;
  try {
    result = await embed(pending.map((p) => p.example));
  } catch (err) {
    console.error(`[routing] embed-on-load failed, Tier 1 falls back to keyword overlap this turn: ${(err as Error).message}`);
    return;
  }
  if (!result.ok) return;

  const now = nextHlc();
  for (let i = 0; i < pending.length; i++) {
    const { packageId, example, hash } = pending[i]!;
    const vector = result.value.vectors[i]!;
    const row = {
      packageId,
      exampleHash: hash,
      space: result.value.model,
      example,
      dims: vector.length,
      vector: vectorToBuffer(vector),
      hlc: now,
    };
    // A concurrent turn embedding the identical new example is possible
    // (two household members speaking at once, both missing the same
    // just-added example) - onConflictDoUpdate rather than a plain
    // insert, the same "last write wins, harmlessly" shape
    // memory.ts's storeEmbedding() already uses for the identical race.
    db.insert(routingEmbeddings)
      .values(row)
      .onConflictDoUpdate({ target: [routingEmbeddings.packageId, routingEmbeddings.exampleHash, routingEmbeddings.space], set: row })
      .run();
  }
}

/** Embeds the utterance once per turn (never once per candidate). Never
 * throws: undefined means "fall back to keyword overlap for every
 * candidate this turn," the same contract memory.ts's
 * `embedQueryForRecall()` already established for the identical
 * down-backend case. */
export async function embedUtterance(text: string): Promise<Float32Array | undefined> {
  try {
    const result = await embed([text]);
    if (!result.ok) return undefined;
    return new Float32Array(result.value.vectors[0]!);
  } catch {
    return undefined;
  }
}

/** Max cosine similarity between `utteranceVector` and each candidate's
 * OWN stored example embeddings - brute-force in JS, the same "household
 * scale, no ANN index needed yet" posture memory.ts's own vector store
 * comment already states. A candidate with no stored rows (embed backend
 * was down at ensureRoutingEmbeddings time, or it simply has no
 * examples) is absent from the returned map entirely, not scored 0 -
 * callers that need a fallback score for it use `exampleScore()`. */
export function scoreByEmbedding(utteranceVector: Float32Array, candidateIds: readonly string[]): Map<string, number> {
  if (candidateIds.length === 0) return new Map();
  const rows = db.select().from(routingEmbeddings).where(inArray(routingEmbeddings.packageId, [...candidateIds])).all();
  const scores = new Map<string, number>();
  for (const row of rows) {
    const cosine = cosineSimilarity(utteranceVector, bufferToVector(row.vector));
    const best = scores.get(row.packageId);
    if (best === undefined || cosine > best) scores.set(row.packageId, cosine);
  }
  return scores;
}

// Start values (this step's own text: "measure on the corpus before
// trusting either"); the routing-corpus bench script
// (backend/scripts/bench/routing.ts) is what actually measures them -
// these are the numbers it started from, not a claim they are final.
export const TIER1_THRESHOLD = 0.62;
export const TIER1_MARGIN = 0.08;

export interface Tier1Score {
  id: string;
  score: number;
}

/** The real Tier 1 firing rule: not "does this ONE candidate clear a bar"
 * (the old per-package `EXAMPLE_MATCH_THRESHOLD` check this replaces) but
 * "does the best candidate clear the bar AND clearly beat whatever else
 * was in contention" - the margin exists specifically for the live-found
 * bug this step's own goal names ("'bedtime story' reaches the storytime
 * skill, not the joke plugin"): two candidates landing close together
 * from shared filler words is exactly what a bare per-candidate threshold
 * cannot tell apart, and a real margin against the runner-up can. A
 * single candidate with nothing to beat still needs to clear the
 * threshold on its own. */
export function pickTier1Winner(scored: readonly Tier1Score[]): Tier1Score | null {
  if (scored.length === 0) return null;
  const sorted = [...scored].sort((a, b) => b.score - a.score);
  const top = sorted[0]!;
  if (top.score < TIER1_THRESHOLD) return null;
  const runnerUp = sorted[1];
  if (runnerUp && top.score - runnerUp.score < TIER1_MARGIN) return null;
  return top;
}

/** pickTier1Winner(), retried against whatever's left when the winner
 * turns out unable to actually fire (turnEngine.ts's `deterministicArgs`:
 * a required arg with no wildcard capture to bind, the one real way a
 * Tier 1 winner can still be a non-starter) - the same "skip it, keep
 * looking" behavior the pre-embedding per-candidate loop had. A code
 * review (2026-09-06) found the first cut of route() returning null for
 * the WHOLE turn the instant the top scorer couldn't bind its arg,
 * silently dropping a perfectly good arg-free runner-up (joke, trivia, a
 * skill) that had also cleared the bar. Each retry re-runs the margin
 * check against the shrunk field, so a genuinely ambiguous runner-up
 * still doesn't fire just because the top pick got disqualified. */
export function pickTier1WinnerAmong(scored: readonly Tier1Score[], canFire: (id: string) => boolean): Tier1Score | null {
  let remaining = scored;
  for (;;) {
    const winner = pickTier1Winner(remaining);
    if (!winner) return null;
    if (canFire(winner.id)) return winner;
    remaining = remaining.filter((s) => s.id !== winner.id);
  }
}
