// IMGSIM-01: group pictures that are the same photo, and pick the clean one
// of each group. Pure: no network, no answer-image types.
//
// Stage 1 (cheap, every pair): the fingerprints' hash distance. Two pictures
// at 3 bits or under are the same pixels rescaled or recompressed (the
// closest real burst-frame pair measured 5) and merge at once. Pairs farther
// than 20 bits are different photos (every measured edited copy was within
// 19) and are never verified. Stage 2 (the pairs in between): ORB + RANSAC
// and the aligned-tile check in geometry.ts.
//
// The clean representative is chosen by consensus: each verified pair votes
// on which side carries something the other lacks (more edges where they
// disagree: text, strokes, a sticker; or a flat bar or border outside the
// shared region), so the member the rest of its group agrees with wins. The
// caller's preferred member comes first, then the votes, then more pixels
// (never sharpness: an overlay's text and strokes raise it).
import { hashDistance, type ImageFingerprint } from "./fingerprint";
import { geometricFeatures, verifyPair, type GeometricFeatures, type PairVerdict } from "./geometry";

export const SAME_PIXELS_BITS = 3;
export const VERIFY_RADIUS_BITS = 20;
/** At most this many pairs are verified per call (about 11 ms each on the
 * laptop measured); pairs past it are treated as different photos, so the
 * cap can only ever show one picture too many, never merge two. */
export const MAX_VERIFIED_PAIRS = 24;

export type ClusterItem = {
  id: string;
  bytes: Uint8Array;
  fingerprint: ImageFingerprint;
  /** Kept as the representative when its group has it (an article's own
   * lead image, a person's original). */
  preferred?: boolean;
};

export type ClusterGroup = { representative: string; members: string[] };

export type ClusterResult = {
  groups: ClusterGroup[];
  /** Counted for the admin trace. */
  /** `unverified`: close pairs left out by the cap or the deadline;
   * `failed`: close pairs whose comparison threw (opencv-js did not load, a
   * picture would not decode). Both stay apart. */
  stats: { pairs: number; same_pixels: number; verified: number; verified_same: number; unverified: number; failed: number };
};

export type ClusterOptions = {
  /** Shared feature cache (by item id) so a caller can keep features next to
   * the picture they came from. */
  features?: Map<string, Promise<GeometricFeatures>>;
  maxVerifiedPairs?: number;
  /** Stop verifying after this long (ms from the call); pairs left are
   * treated as different photos. */
  timeBudgetMs?: number;
  /** Or stop at this moment (Date.now() clock), whichever comes first: a
   * caller with a deadline of its own passes it, so time spent before the
   * call counts. */
  verifyUntil?: number;
  /** ORB features per picture (measurement only; the default is the
   * measured one). */
  orbFeatures?: number;
  /** Hash distance up to which a pair is verified (default VERIFY_RADIUS_BITS). */
  verifyRadiusBits?: number;
};

/** Default time for the verification stage of a call that has no deadline
 * of its own (a caller with one, like a chat turn, passes what it has left). */
export const VERIFY_TIME_BUDGET_MS = 10_000;

export async function cluster(items: readonly ClusterItem[], opts: ClusterOptions = {}): Promise<ClusterResult> {
  const parent = items.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  const union = (i: number, j: number) => { parent[find(i)] = find(j); };
  const votes = items.map(() => 0);
  const stats = { pairs: 0, same_pixels: 0, verified: 0, verified_same: 0, unverified: 0, failed: 0 };
  const cache = opts.features ?? new Map<string, Promise<GeometricFeatures>>();
  const features = (i: number) => {
    const item = items[i]!;
    let f = cache.get(item.id);
    if (!f) { f = geometricFeatures(item.bytes, opts.orbFeatures ? { features: opts.orbFeatures } : {}); cache.set(item.id, f); }
    return f;
  };
  const toVerify: [number, number, number][] = [];
  // Same-pixels pairs are already merged; they are still compared, after the
  // pairs that decide merging and inside the same budget, only so the clean
  // copy wins (a border or a logo moves a hash by a few bits at most).
  const sameVotes: [number, number][] = [];
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    stats.pairs++;
    const d = hashDistance(items[i]!.fingerprint, items[j]!.fingerprint);
    if (d <= SAME_PIXELS_BITS) { stats.same_pixels++; union(i, j); sameVotes.push([i, j]); continue; }
    if (d <= (opts.verifyRadiusBits ?? VERIFY_RADIUS_BITS)) toVerify.push([d, i, j]);
  }
  // Closest pairs first, so the cap drops the least likely matches.
  toVerify.sort((x, y) => x[0] - y[0]);
  const cap = opts.maxVerifiedPairs ?? MAX_VERIFIED_PAIRS;
  const stopAt = Math.min(Date.now() + (opts.timeBudgetMs ?? VERIFY_TIME_BUDGET_MS), opts.verifyUntil ?? Number.POSITIVE_INFINITY);
  for (const [n, [, i, j]] of toVerify.entries()) {
    if (n >= cap || Date.now() >= stopAt) { stats.unverified++; continue; }
    let verdict: PairVerdict;
    try {
      const [fa, fb] = await Promise.all([features(i), features(j)]);
      // Loading opencv-js and decoding count against the deadline too.
      if (Date.now() >= stopAt) { stats.unverified++; continue; }
      verdict = await verifyPair(fa, fb);
    } catch {
      stats.failed++;
      continue; // a pair that cannot be compared stays apart
    }
    stats.verified++;
    if (!verdict.same) continue;
    stats.verified_same++;
    union(i, j);
    // The side with more overlay evidence loses the vote.
    if (verdict.overlay[0] > verdict.overlay[1]) votes[j]!++;
    else if (verdict.overlay[1] > verdict.overlay[0]) votes[i]!++;
  }
  for (const [i, j] of sameVotes) {
    if (Date.now() >= stopAt) break;
    try {
      const [fa, fb] = await Promise.all([features(i), features(j)]);
      if (Date.now() >= stopAt) break;
      const verdict = await verifyPair(fa, fb);
      if (verdict.overlay[0] > verdict.overlay[1]) votes[j]!++;
      else if (verdict.overlay[1] > verdict.overlay[0]) votes[i]!++;
    } catch { /* no vote */ }
  }
  const byRoot = new Map<number, number[]>();
  items.forEach((_, i) => { const r = find(i); byRoot.set(r, [...(byRoot.get(r) ?? []), i]); });
  const groups: ClusterGroup[] = [];
  for (const members of byRoot.values()) {
    const best = [...members].sort((x, y) =>
      Number(Boolean(items[y]!.preferred)) - Number(Boolean(items[x]!.preferred)) ||
      votes[y]! - votes[x]! ||
      items[y]!.fingerprint.width * items[y]!.fingerprint.height - items[x]!.fingerprint.width * items[x]!.fingerprint.height,
    )[0]!;
    groups.push({ representative: items[best]!.id, members: members.map((m) => items[m]!.id) });
  }
  // Groups in the order of their first member, so callers keep their ranking.
  const firstIndex = (g: ClusterGroup) => Math.min(...g.members.map((id) => items.findIndex((it) => it.id === id)));
  groups.sort((a, b) => firstIndex(a) - firstIndex(b));
  return { groups, stats };
}
