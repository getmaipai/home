// MU-IDENT-01: the pure parts of song identification: parsing AcoustID lookup answers, building the lookup URL,
// a sliding-window rate limiter, an LRU fingerprint cache, Chromaprint sub-fingerprint comparison with a
// hand-written popcount, the local-match rule, and the readiness line for the song naming screen. No network,
// no processes, no database: everything is a pure function or a small class with injected dependencies.
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { acoustIdUrl, compareFingerprints, FingerprintCache, identifyReadinessFor, isLocalMatch, parseAcoustId, popcount, RateLimiter, type IdentifyResult } from "@/lib/music/identifyCore";

const result = (over: Partial<IdentifyResult> = {}): IdentifyResult => ({
  title: "Song",
  artist: "Someone",
  album: null,
  musicbrainz_recording_id: null,
  musicbrainz_artist_id: null,
  musicbrainz_release_group_id: null,
  score: 1,
  source: "library",
  ...over,
});

describe("parseAcoustId", () => {
  test("picks the higher-scoring result, joins two artists, and takes the album from the first release group", () => {
    const answer = {
      status: "ok",
      results: [
        { id: "r-low", score: 0.55, recordings: [{ id: "rec-low", title: "Low", artists: [{ id: "a-low", name: "Low Artist" }], releasegroups: [{ id: "rg-low", title: "Low Album" }] }] },
        {
          id: "r-high",
          score: 0.9,
          recordings: [{
            id: "rec-1",
            title: "Morning Light",
            duration: 200,
            artists: [{ id: "art-1", name: "Ada Lovelace" }, { id: "art-2", name: "Babbage Ensemble" }],
            releasegroups: [{ id: "rg-1", title: "Analytical Engine" }, { id: "rg-2", title: "Later" }],
          }],
        },
      ],
    };
    expect(parseAcoustId(answer)).toEqual({
      title: "Morning Light",
      artist: "Ada Lovelace, Babbage Ensemble",
      album: "Analytical Engine",
      musicbrainz_recording_id: "rec-1",
      musicbrainz_artist_id: "art-1",
      musicbrainz_release_group_id: "rg-1",
      score: 0.9,
      source: "acoustid",
    });
  });

  test("returns null when the best result has no recordings", () => {
    expect(parseAcoustId({ status: "ok", results: [{ id: "r", score: 0.9, recordings: [] }] })).toBeNull();
    expect(parseAcoustId({ status: "ok", results: [{ id: "r", score: 0.9 }] })).toBeNull();
  });

  test("returns null when no recording has a title", () => {
    expect(parseAcoustId({ status: "ok", results: [{ id: "r", score: 0.9, recordings: [{ id: "rec-1", artists: [{ id: "a", name: "Solo" }] }] }] })).toBeNull();
  });

  test("ignores results with a score under 0.5", () => {
    expect(parseAcoustId({ status: "ok", results: [{ id: "r", score: 0.4, recordings: [{ id: "rec-1", title: "Faint", artists: [{ id: "a", name: "Solo" }] }] }] })).toBeNull();
    expect(parseAcoustId({
      status: "ok",
      results: [
        { id: "r1", score: 0.4, recordings: [{ id: "rec-low", title: "Faint", artists: [{ id: "a1", name: "Faint" }] }] },
        { id: "r2", score: 0.6, recordings: [{ id: "rec-high", title: "Solid", artists: [{ id: "a2", name: "Solid" }] }] },
      ],
    })).toMatchObject({ title: "Solid", score: 0.6 });
  });

  test("returns null for non-objects", () => {
    expect(parseAcoustId("ok")).toBeNull();
    expect(parseAcoustId(null)).toBeNull();
    expect(parseAcoustId(42)).toBeNull();
    expect(parseAcoustId([{ id: "r", score: 0.9, recordings: [] }])).toBeNull();
    expect(parseAcoustId(undefined)).toBeNull();
  });

  test("returns null when the results array is missing or the status is not ok", () => {
    expect(parseAcoustId({ status: "ok" })).toBeNull();
    expect(parseAcoustId({ status: "ok", results: "no" })).toBeNull();
    expect(parseAcoustId({ status: "INVALID", results: [] })).toBeNull();
  });

  test("never throws, even on hostile input", () => {
    expect(parseAcoustId({ get results() { throw new Error("boom"); } })).toBeNull();
    expect(parseAcoustId({ status: "ok", results: [undefined, 7, { score: "0.9" }] })).toBeNull();
  });
});

describe("acoustIdUrl", () => {
  test("URL-encodes the fingerprint, keeps the literal plus in meta, and never mentions audio", () => {
    const url = acoustIdUrl("https://acoustid.org", "my-key", "A+BC/DE=", 215.7);
    expect(url).toBe("https://acoustid.org/v2/lookup?client=my-key&duration=215&fingerprint=A%2BBC%2FDE%3D&meta=recordings+releasegroups&format=json");
    expect(url).toContain("fingerprint=A%2BBC%2FDE%3D");
    expect(url).not.toContain("fingerprint=A+BC/DE=");
    expect(url).toContain("meta=recordings+releasegroups");
    expect(url).not.toContain("audio");
  });

  test("floors non-integer seconds", () => {
    expect(acoustIdUrl("https://acoustid.org", "k", "A", 30).includes("duration=30")).toBe(true);
    expect(acoustIdUrl("https://acoustid.org", "k", "A", 30.9).includes("duration=30")).toBe(true);
    expect(acoustIdUrl("https://acoustid.org", "k", "A", 2.4).includes("duration=2")).toBe(true);
  });
});

describe("RateLimiter", () => {
  test("allows 3 in one second, refuses the 4th with a wait, and allows again after 1000 ms", () => {
    let clock = 0;
    const limiter = new RateLimiter(3, () => clock);
    expect(limiter.take()).toBe(0);
    clock = 10;
    expect(limiter.take()).toBe(0);
    clock = 20;
    expect(limiter.take()).toBe(0);
    expect(limiter.take()).toBe(980);
    expect(limiter.take()).toBe(980);
    clock = 1019;
    expect(limiter.take()).toBe(0);
    clock = 1020;
    expect(limiter.take()).toBe(0);
    clock = 1021;
    expect(limiter.take()).toBe(0);
    expect(limiter.take()).toBe(998);
  });
});

describe("FingerprintCache", () => {
  test("stores by fingerprint, serves get, drops least recently used past the limit", () => {
    const cache = new FingerprintCache(2);
    const a = result({ title: "A" });
    const b = result({ title: "B" });
    const c = result({ title: "C" });
    expect(cache.size).toBe(0);
    expect(cache.get("fp-a")).toBeUndefined();
    cache.set("fp-a", a);
    cache.set("fp-b", b);
    expect(cache.size).toBe(2);
    expect(cache.get("fp-a")).toEqual(a);
    cache.set("fp-c", c);
    expect(cache.size).toBe(2);
    expect(cache.get("fp-b")).toBeUndefined();
    expect(cache.get("fp-a")).toEqual(a);
    expect(cache.get("fp-c")).toEqual(c);
  });

  test("replacing an entry refreshes its recency and re-evicts the oldest", () => {
    const cache = new FingerprintCache(2);
    const a = result({ title: "A1" });
    const b = result({ title: "B1" });
    const a2 = result({ title: "A2" });
    const c = result({ title: "C" });
    cache.set("fp-a", a);
    cache.set("fp-b", b);
    cache.set("fp-a", a2);
    cache.set("fp-c", c);
    expect(cache.size).toBe(2);
    expect(cache.get("fp-b")).toBeUndefined();
    expect(cache.get("fp-a")).toEqual(a2);
    expect(cache.get("fp-c")).toEqual(c);
  });

  test("keys on the SHA-256 of the fingerprint, so different fingerprints never collide", () => {
    const cache = new FingerprintCache(10);
    cache.set("0:0100", result({ title: "first" }));
    cache.set("1:0001", result({ title: "second" }));
    expect(cache.size).toBe(2);
    expect(cache.get("0:0100")).toEqual(result({ title: "first" }));
    expect(cache.get("1:0001")).toEqual(result({ title: "second" }));
  });
});

function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomWords(length: number, seed: number): Uint32Array {
  const next = mulberry32(seed);
  const out = new Uint32Array(length);
  for (let i = 0; i < length; i++) out[i] = Math.floor(next() * 4294967296);
  return out;
}

describe("compareFingerprints", () => {
  test("finds a clip cut from the middle of a song at the right offset with score 1", () => {
    const song = randomWords(200, 42);
    const clip = song.slice(73, 103);
    expect(compareFingerprints(clip, song)).toEqual({ score: 1, offset: 73 });
  });

  test("scores under 0.7 for unrelated random data", () => {
    const song = randomWords(500, 7);
    const clip = randomWords(40, 99);
    const { score, offset } = compareFingerprints(clip, song);
    expect(score).toBeLessThan(0.7);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
    expect(offset).toBeGreaterThanOrEqual(0);
    expect(offset).toBeLessThanOrEqual(460);
  });

  test("returns score 0 when the clip is longer than the song", () => {
    const song = randomWords(10, 1);
    const clip = randomWords(11, 2);
    expect(compareFingerprints(clip, song)).toEqual({ score: 0, offset: 0 });
  });

  test("returns score 0 for empty input", () => {
    expect(compareFingerprints(new Uint32Array(0), new Uint32Array(5))).toEqual({ score: 0, offset: 0 });
    expect(compareFingerprints(new Uint32Array(5), new Uint32Array(0))).toEqual({ score: 0, offset: 0 });
    expect(compareFingerprints(new Uint32Array(0), new Uint32Array(0))).toEqual({ score: 0, offset: 0 });
  });

  test("reports a fractional score when one bit out of four words differs at offset zero", () => {
    const song = new Uint32Array([0x00000000, 0xffffffff, 0xaaaaaaaa, 0x55555555]);
    const clip = new Uint32Array([0x00000001, 0xffffffff, 0xaaaaaaaa, 0x55555555]);
    expect(compareFingerprints(clip, song)).toEqual({ score: 1 - 1 / 128, offset: 0 });
  });
});

describe("popcount", () => {
  test("counts bits on 0, 1, 0xFFFFFFFF and 0xAAAAAAAA", () => {
    expect(popcount(0)).toBe(0);
    expect(popcount(1)).toBe(1);
    expect(popcount(0xffffffff)).toBe(32);
    expect(popcount(0xaaaaaaaa)).toBe(16);
    expect(popcount(0x0f0f0f0f)).toBe(16);
    expect(popcount(0x80000000)).toBe(1);
  });
});

describe("isLocalMatch", () => {
  test("edge values of the score and the margin", () => {
    expect(isLocalMatch(0.8, 0)).toBe(true);
    expect(isLocalMatch(0.8, 0.7)).toBe(true);
    expect(isLocalMatch(0.8, 0.7000001)).toBe(false);
    expect(isLocalMatch(0.7999999, 0)).toBe(false);
    expect(isLocalMatch(0.9, 0)).toBe(true);
    expect(isLocalMatch(0.85, 0.8)).toBe(false);
    expect(isLocalMatch(0.7, 0.9)).toBe(false);
  });
});

describe("identifyReadinessFor", () => {
  test("fpcalc missing wins over everything else", () => {
    const missing = { hasFpcalc: false, hasKey: false, hasLocalFingerprints: false, setting: "off" as const };
    expect(identifyReadinessFor(missing)).toEqual({ state: "fpcalc_missing", line: "Song naming needs Chromaprint, which is not installed on this computer yet." });
    expect(identifyReadinessFor({ hasFpcalc: false, hasKey: true, hasLocalFingerprints: true, setting: "on" })).toMatchObject({ state: "fpcalc_missing" });
  });

  test("setting off with no local fingerprints says nothing to match", () => {
    expect(identifyReadinessFor({ hasKey: false, hasFpcalc: true, hasLocalFingerprints: false, setting: "off" })).toEqual({
      state: "nothing_to_match",
      line: "Song naming is off and your library has no fingerprints yet, so there is nothing to match. Turn on online naming in Settings.",
    });
  });

  test("off with local fingerprints is ready", () => {
    expect(identifyReadinessFor({ hasKey: false, hasFpcalc: true, hasLocalFingerprints: true, setting: "off" })).toEqual({ state: "ready", line: "Song naming is ready." });
  });

  test("on or ask with no key and no local fingerprints asks for the key", () => {
    expect(identifyReadinessFor({ hasKey: false, hasFpcalc: true, hasLocalFingerprints: false, setting: "on" })).toEqual({
      state: "no_key",
      line: "Add your AcoustID key in Credentials to name songs that are not in your library.",
    });
    expect(identifyReadinessFor({ hasKey: false, hasFpcalc: true, hasLocalFingerprints: false, setting: "ask" })).toMatchObject({ state: "no_key" });
  });

  test("ready when a key or local fingerprints exist", () => {
    expect(identifyReadinessFor({ hasKey: true, hasFpcalc: true, hasLocalFingerprints: false, setting: "on" })).toEqual({ state: "ready", line: "Song naming is ready." });
    expect(identifyReadinessFor({ hasKey: false, hasFpcalc: true, hasLocalFingerprints: true, setting: "ask" })).toEqual({ state: "ready", line: "Song naming is ready." });
    expect(identifyReadinessFor({ hasKey: false, hasFpcalc: true, hasLocalFingerprints: true, setting: "on" })).toMatchObject({ state: "ready" });
  });
});
