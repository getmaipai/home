import { createHash } from "node:crypto";

/** One named song: what identification found, where it came from, and how confident the match was. */
export type IdentifyResult = {
  title: string;
  artist: string;
  album: string | null;
  musicbrainz_recording_id: string | null;
  musicbrainz_artist_id: string | null;
  musicbrainz_release_group_id: string | null;
  score: number;
  source: "library" | "acoustid";
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Parse an AcoustID `lookup` answer. Picks the result with the highest score (0..1, at least 0.5) that has a
 * titled recording, and returns that recording's title, the artists' names joined with ", ", the first release
 * group's title as the album, the MB recording/artist/release-group ids, the result's score, and source "acoustid".
 * Anything missing or malformed returns null; it never throws.
 */
export function parseAcoustId(json: unknown): IdentifyResult | null {
  try {
    if (!isRecord(json) || json.status !== "ok" || !Array.isArray(json.results)) return null;
    let best: Record<string, unknown> | null = null;
    for (const r of json.results) {
      if (!isRecord(r)) continue;
      const score = typeof r.score === "number" ? r.score : NaN;
      if (!Number.isFinite(score) || score < 0.5 || score > 1) continue;
      if (!Array.isArray(r.recordings)) continue;
      const firstTitled = r.recordings.find((rec) => isRecord(rec) && typeof rec.title === "string" && rec.title.length > 0);
      if (firstTitled === undefined) continue;
      if (best === null || score > (typeof best.score === "number" ? (best.score as number) : -1)) best = r;
    }
    if (best === null) return null;
    const recordings = best.recordings as unknown[];
    const rec = recordings.find((x) => isRecord(x) && typeof x.title === "string" && x.title.length > 0);
    if (rec === undefined) return null;
    const recObj = rec as Record<string, unknown>;
    const artists = Array.isArray(recObj.artists) ? (recObj.artists as unknown[]) : [];
    const names: string[] = [];
    let artistId: string | null = null;
    for (const a of artists) {
      if (!isRecord(a) || typeof a.name !== "string" || a.name.length === 0) continue;
      names.push(a.name);
      if (artistId === null && typeof a.id === "string") artistId = a.id;
    }
    if (names.length === 0) return null;
    const groups = Array.isArray(recObj.releasegroups) ? (recObj.releasegroups as unknown[]) : [];
    const firstGroup = groups.find((g) => isRecord(g) && typeof g.title === "string") as Record<string, unknown> | undefined;
    return {
      title: recObj.title as string,
      artist: names.join(", "),
      album: firstGroup && typeof firstGroup.title === "string" ? firstGroup.title : null,
      musicbrainz_recording_id: typeof recObj.id === "string" ? recObj.id : null,
      musicbrainz_artist_id: artistId,
      musicbrainz_release_group_id: firstGroup && typeof firstGroup.id === "string" ? firstGroup.id : null,
      score: best.score as number,
      source: "acoustid",
    };
  } catch {
    return null;
  }
}

/**
 * Build the AcoustID lookup URL: `${base}/v2/lookup?client=...&duration=<integer seconds>&fingerprint=...&meta=recordings+releasegroups&format=json`.
 * Every value is URL-encoded (the `+` in meta stays a literal plus). The audio is never an input.
 */
export function acoustIdUrl(base: string, key: string, fingerprint: string, durationSeconds: number): string {
  const duration = String(Math.max(0, Math.floor(durationSeconds)));
  return `${base}/v2/lookup?client=${encodeURIComponent(key)}&duration=${duration}&fingerprint=${encodeURIComponent(fingerprint)}&meta=recordings+releasegroups&format=json`;
}

/**
 * A sliding-window rate limiter: at most `maxPerSecond` requests per rolling 1000 ms, measured with the
 * injected `now` (ms). `take()` returns 0 when a request may go now, else the milliseconds to wait; refused
 * takes do not consume the window.
 */
export class RateLimiter {
  private times: number[] = [];
  constructor(private readonly maxPerSecond: number, private readonly now: () => number) {}
  take(): number {
    const t = this.now();
    this.times = this.times.filter((x) => t - x < 1000);
    if (this.times.length < this.maxPerSecond) {
      this.times.push(t);
      return 0;
    }
    const oldest = this.times[0]!;
    return oldest + 1000 - t;
  }
}

/**
 * Least recently used cache of identify results keyed by the SHA-256 hex of the fingerprint string.
 * Entries past `limit` are dropped, oldest first; nothing but the fingerprint hash and the result is kept.
 */
export class FingerprintCache {
  private readonly store = new Map<string, IdentifyResult>();
  constructor(private readonly limit: number) {}
  private key(fingerprint: string): string {
    return createHash("sha256").update(fingerprint, "utf8").digest("hex");
  }
  get(fingerprint: string): IdentifyResult | undefined {
    const k = this.key(fingerprint);
    const v = this.store.get(k);
    if (v === undefined) return undefined;
    this.store.delete(k);
    this.store.set(k, v);
    return v;
  }
  set(fingerprint: string, value: IdentifyResult): void {
    const k = this.key(fingerprint);
    this.store.delete(k);
    this.store.set(k, value);
    while (this.store.size > this.limit) {
      const oldest = this.store.keys().next().value;
      if (oldest === undefined) break;
      this.store.delete(oldest);
    }
  }
  get size(): number {
    return this.store.size;
  }
}

/** Count the set bits in a 32-bit word (a popcount written by hand so the bit error rate below is exact). */
export function popcount(x: number): number {
  let v = x | 0;
  v = (v & 0x55555555) + ((v >> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >> 2) & 0x33333333);
  v = (v + (v >> 4)) & 0x0f0f0f0f;
  v += v >> 8;
  return (v & 0x00ff00ff) % 255;
}

/**
 * Slide the clip's raw Chromaprint sub-fingerprints over the song's. At each integer offset the bit error rate
 * is the number of differing bits over `clip.length * 32`; returns the offset with the lowest error and
 * `score = 1 - bitErrorRate` (0..1). Empty input or a clip longer than the song returns { score: 0, offset: 0 }.
 */
export function compareFingerprints(clip: Uint32Array, song: Uint32Array): { score: number; offset: number } {
  if (clip.length === 0 || song.length === 0 || clip.length > song.length) return { score: 0, offset: 0 };
  let bestError = Infinity;
  let bestOffset = 0;
  const totalBits = clip.length * 32;
  for (let offset = 0; offset <= song.length - clip.length; offset++) {
    let error = 0;
    for (let i = 0; i < clip.length; i++) {
      error += popcount((clip[i] ?? 0) ^ (song[offset + i] ?? 0));
    }
    if (error < bestError) {
      bestError = error;
      bestOffset = offset;
    }
  }
  return { score: 1 - bestError / totalBits, offset: bestOffset };
}

/**
 * A clear local match needs `score >= 0.8` and a margin of at least 0.1 over `secondBest`
 * (the best score of any other library song; it may be 0).
 */
export function isLocalMatch(score: number, secondBest: number): boolean {
  return score >= 0.8 && score - secondBest >= 0.1;
}

/** The readiness state and its one sentence for the song naming screen. */
export type IdentifyReadiness = {
  state: "ready" | "no_key" | "fpcalc_missing" | "nothing_to_match";
  line: string;
};

/**
 * Decide the readiness in this order: no fpcalc -> fpcalc_missing; setting off with no local fingerprints ->
 * nothing_to_match; setting on or ask with no key and no local fingerprints -> no_key; otherwise ready.
 */
export function identifyReadinessFor(input: { hasKey: boolean; hasFpcalc: boolean; hasLocalFingerprints: boolean; setting: "on" | "ask" | "off" }): IdentifyReadiness {
  if (!input.hasFpcalc) {
    return { state: "fpcalc_missing", line: "Song naming needs Chromaprint, which is not installed on this computer yet." };
  }
  if (input.setting === "off" && !input.hasLocalFingerprints) {
    return { state: "nothing_to_match", line: "Song naming is off and your library has no fingerprints yet, so there is nothing to match. Turn on online naming in Settings." };
  }
  if ((input.setting === "on" || input.setting === "ask") && !input.hasKey && !input.hasLocalFingerprints) {
    return { state: "no_key", line: "Add your AcoustID key in Credentials to name songs that are not in your library." };
  }
  return { state: "ready", line: "Song naming is ready." };
}
