// Provider race tests use injected fakes only; no network requests are made.
import { beforeEach, describe, expect, test } from "bun:test";
import { FingerprintCache, RateLimiter } from "@/lib/music/identifyCore";
import { __resetIdentifyForTests, identifySong, type IdentifyOptions } from "@/lib/music/identify";
import type { LibraryFingerprint } from "@/lib/music/fingerprintStore";
import type { IdentifyResult } from "@/lib/music/identifyCore";

const pcm = new Uint8Array(16000 * 5 * 2);
const clip = { bytes: new Uint8Array([1]), kind: { kind: "container" } as const };
const result = (title: string, source: IdentifyResult["source"]): IdentifyResult => ({ title, artist: "Artist", album: null, year: null, musicbrainz_recording_id: null, musicbrainz_artist_id: null, musicbrainz_release_group_id: null, score: 0.9, source });
const matchingRaw = Uint32Array.from([0x12345678, 0x23456789, 0x3456789a, 0x456789ab, 0x56789abc, 0x6789abcd, 0x789abcde, 0x89abcdef]);
const libraryRow: LibraryFingerprint = { itemId: "1", title: "Local", artist: "Artist", album: null, recordingId: null, artistId: null, releaseGroupId: null, raw: Uint32Array.from([9, 9, ...matchingRaw, 8, 8]) };
let calls: { shazam: number; acoustid: number };
function opts(over: IdentifyOptions = {}): IdentifyOptions {
  return { decode: async () => ({ pcm, seconds: 5 }), signature: async () => ({ uri: "data:audio/vnd.shazam.sig;base64,AA==", sampleMs: 10000 }), fingerprint: async (_pcm, want) => ({ raw: want.raw ? matchingRaw : null, compressed: want.compressed ? "fingerprint" : null, seconds: 5 }), library: () => [], hasFpcalc: true, mode: "on", key: "key", fetch: async () => { calls.acoustid++; return Response.json({ status: "ok", results: [{ score: 0.9, recordings: [{ title: "AcoustID", artists: [{ name: "Artist" }] }] }] }); }, shazam: async () => { calls.shazam++; return { kind: "ok", result: result("Shazam", "shazam") }; }, shazamEnabled: true, cache: new FingerprintCache(20), limiter: new RateLimiter(20, () => 0), log: () => {}, ...over };
}
beforeEach(() => { calls = { shazam: 0, acoustid: 0 }; __resetIdentifyForTests(); });

describe("identify providers", () => {
  test("library match runs alone and never asks Shazam", async () => {
    const out = await identifySong(clip, opts({ mode: "off", library: () => [libraryRow], shazam: async () => { calls.shazam++; throw new Error("unexpected"); } }));
    expect(out).toMatchObject({ status: "matched", result: { source: "library" } }); expect(calls.shazam).toBe(0);
  });
  test("Shazam works without AcoustID key or fpcalc", async () => {
    expect(await identifySong(clip, opts({ key: null, hasFpcalc: false }))).toMatchObject({ status: "matched", result: { source: "shazam" } });
  });
  test("AcoustID works alone", async () => {
    expect(await identifySong(clip, opts({ shazamEnabled: false }))).toMatchObject({ status: "matched", result: { source: "acoustid" } });
  });
  test("Shazam resolves the answer before deferred AcoustID and keeps it running", async () => {
    let finish!: (response: Response) => void; let began!: () => void;
    const started = new Promise<void>((resolve) => { began = resolve; });
    const slow = new Promise<Response>((resolve) => { finish = resolve; });
    let candidates: unknown[] = [];
    const pending = identifySong(clip, opts({ fetch: async () => { calls.acoustid++; began(); return slow; }, onCandidates: (c) => { candidates = c; } }));
    const outcome = await pending;
    expect(outcome).toMatchObject({ status: "matched", result: { source: "shazam" } });
    await started;
    expect(calls.acoustid).toBe(1);
    finish(Response.json({ status: "ok", results: [{ score: 0.8, recordings: [{ title: "Shazam", artists: [{ name: "Artist" }] }] }] }));
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(candidates).toHaveLength(2);
    expect(candidates[1]).toMatchObject({ source: "acoustid", agrees: true });
  });
  test("fast AcoustID can win", async () => {
    expect(await identifySong(clip, opts({ shazam: () => new Promise((resolve) => setTimeout(() => resolve({ kind: "ok", result: result("Shazam", "shazam") }), 30)) }))).toMatchObject({ status: "matched", result: { source: "acoustid" } });
  });
  test("one provider error does not hide the other match", async () => {
    expect(await identifySong(clip, opts({ shazam: async () => { throw new Error("bad"); } }))).toMatchObject({ status: "matched", result: { source: "acoustid" } });
  });
  test("no matches return no_match", async () => {
    expect(await identifySong(clip, opts({ shazam: async () => ({ kind: "ok", result: null }), fetch: async () => Response.json({ status: "ok", results: [] }) }))).toEqual({ status: "no_match" });
  });
  test("slower provider candidates report agreement and disagreement", async () => {
    let release!: (value: Response) => void;
    const slow = new Promise<Response>((resolve) => { release = resolve; });
    const candidates: { agrees: boolean }[] = [];
    const answer = await identifySong(clip, opts({ fetch: async () => slow, onCandidates: (items) => candidates.push(...items) }));
    expect(answer).toMatchObject({ status: "matched", result: { source: "shazam" } });
    release(Response.json({ status: "ok", results: [{ score: 0.9, recordings: [{ title: "Other", artists: [{ name: "Artist" }] }] }] }));
    await Bun.sleep(0);
    expect(candidates.map((x) => x.agrees)).toEqual([true, false]);
  });
  test("deadline publishes answers collected before a hung provider", async () => {
    let released = false;
    const candidates: unknown[] = [];
    const out = await identifySong(clip, opts({ deadlineMs: 20, shazam: async () => { released = true; return { kind: "ok", result: result("Shazam", "shazam") }; }, fetch: async () => new Promise<Response>(() => {}), onCandidates: (items) => candidates.push(...items) }));
    expect(out.status).toBe("matched"); expect(released).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 30)); expect(candidates).toHaveLength(1);
  });
  test("ask and off gates, plus signature cache", async () => {
    expect(await identifySong(clip, opts({ mode: "ask" }))).toEqual({ status: "needs_confirm" });
    expect(calls).toEqual({ shazam: 0, acoustid: 0 });
    expect(await identifySong(clip, opts({ mode: "off", library: () => [libraryRow], fingerprint: async () => ({ raw: Uint32Array.from([0xdeadbeef, 0x12345678, 0xdeadbeef]), compressed: null, seconds: 5 }) }))).toMatchObject({ status: "no_match" });
    expect(calls).toEqual({ shazam: 0, acoustid: 0 });
    const cache = new FingerprintCache(20); cache.set("data:audio/vnd.shazam.sig;base64,AA==", result("Cached", "shazam"));
    const signature = async () => ({ uri: "data:audio/vnd.shazam.sig;base64,AA==", sampleMs: 10000 });
    expect(await identifySong(clip, opts({ key: null, cache, signature }))).toMatchObject({ status: "matched", result: { source: "shazam", title: "Cached" } });
    expect(calls.shazam).toBe(0);
  });
});
