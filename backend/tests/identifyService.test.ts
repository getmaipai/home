// MUSIC-ID-01: the song-identification service, offline: injected decoder and fingerprint runner (and a fake `fpcalc` script for the
// real runner), a fake AcoustID server on a local port, captured logs.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FingerprintCache, RateLimiter } from "@/lib/music/identifyCore";
import { MAX_CLIP_BYTES, __resetIdentifyForTests, deviceGate, identifyReadiness, identifySong, type IdentifyClip, type IdentifyOptions } from "@/lib/music/identify";
import { packRaw, unpackRaw, type Decoder, type FingerprintRunner } from "@/lib/music/identifyAudio";
import type { LibraryFingerprint } from "@/lib/music/fingerprintStore";

const SECRET_TITLE = "Zebra Lullaby Zq";
const SECRET_ARTIST = "Quartz Wombat Band";
const SECRET_FP = "AQAAFPSECRETXYZ";
const SECRET_KEY = "keysecret123";

const acoustAnswer = { status: "ok", results: [{ id: "x", score: 0.97, recordings: [{ id: "rec-1", title: SECRET_TITLE, artists: [{ id: "art-1", name: SECRET_ARTIST }], releasegroups: [{ id: "rg-1", title: "Night Album" }] }] }] };

let server: ReturnType<typeof Bun.serve>;
let requests: string[] = [];
let respond: () => Response = () => Response.json(acoustAnswer);
beforeAll(() => { server = Bun.serve({ port: 0, fetch: (req) => { requests.push(new URL(req.url).pathname + new URL(req.url).search); return respond(); } }); });
afterAll(() => { server.stop(true); });
beforeEach(() => { requests = []; respond = () => Response.json(acoustAnswer); __resetIdentifyForTests(); });

const base = () => `http://127.0.0.1:${server.port}`;
const pcm = (seconds = 5) => new Uint8Array(Math.round(seconds * 11025) * 2);
const decode: Decoder = async () => ({ pcm: pcm(), seconds: 5 });
let counter = 0;
/** A fingerprint runner: `raw` for the local match, a fresh compressed string for each call unless one is given. */
const prints = (raw: number[] | null, compressed: string | null = null): FingerprintRunner => async (_pcm, want) => ({
  raw: want.raw ? Uint32Array.from(raw ?? [1, 2, 3]) : null, compressed: want.compressed ? (compressed ?? `${SECRET_FP}${counter++}`) : null, seconds: 5,
});
const clip = (): IdentifyClip => ({ bytes: new Uint8Array([1, 2, 3, 4]), kind: { kind: "container" } });
function opts(over: IdentifyOptions = {}): IdentifyOptions {
  return { decode, fingerprint: prints(null), library: () => [], mode: "on", key: SECRET_KEY, hasFpcalc: true, acoustIdBase: base(), sleep: async () => {}, log: () => {}, cache: new FingerprintCache(200), limiter: new RateLimiter(3, () => 0), ...over };
}
function song(id: string, raw: number[]): LibraryFingerprint {
  return { itemId: id, title: `Local ${id}`, artist: "Local Artist", album: "Local Album", recordingId: null, artistId: null, releaseGroupId: null, raw: Uint32Array.from(raw) };
}

describe("local first", () => {
  test("a library match is named with no network request", async () => {
    const mine = Array.from({ length: 8 }, (_, i) => 0x12345678 + i * 977);
    const other = Array.from({ length: 12 }, (_, i) => (0xdeadbeef ^ (i * 2654435761)) >>> 0);
    const out = await identifySong(clip(), opts({ fingerprint: prints(mine), library: () => [song("a", [9, 9, ...mine, 7, 7]), song("b", other)] }));
    expect(out.status).toBe("matched");
    if (out.status === "matched") { expect(out.result.title).toBe("Local a"); expect(out.result.source).toBe("library"); expect(out.result.score).toBeGreaterThan(0.99); }
    expect(requests).toHaveLength(0);
  });
});

describe("online", () => {
  test("no local match, setting on: one AcoustID request with the fingerprint and length only", async () => {
    const out = await identifySong(clip(), opts());
    expect(out.status).toBe("matched");
    if (out.status === "matched") { expect(out.result.source).toBe("acoustid"); expect(out.result.title).toBe(SECRET_TITLE); expect(out.result.album).toBe("Night Album"); }
    expect(requests).toHaveLength(1);
    const url = new URL(requests[0]!, "http://x");
    expect(url.pathname).toBe("/v2/lookup");
    expect(url.searchParams.get("duration")).toBe("5");
    expect(url.searchParams.get("fingerprint")).toStartWith(SECRET_FP);
    expect([...url.searchParams.keys()].sort()).toEqual(["client", "duration", "fingerprint", "format", "meta"]);
  });
  test("no match from AcoustID", async () => {
    respond = () => Response.json({ status: "ok", results: [] });
    expect((await identifySong(clip(), opts())).status).toBe("no_match");
    expect(requests).toHaveLength(1);
  });
  test("a second identical clip is answered from the memory cache", async () => {
    const o = opts({ fingerprint: prints(null, "SAMEPRINT") });
    await identifySong(clip(), o);
    const again = await identifySong(clip(), o);
    expect(again.status).toBe("matched");
    expect(requests).toHaveLength(1);
  });
});

describe("the setting and readiness gates", () => {
  test("off: local only, no request, no match", async () => {
    const out = await identifySong(clip(), opts({ mode: "off", library: () => [song("z", Array.from({ length: 12 }, (_, i) => (0xa5a5a5a5 ^ (i * 40503 * 65537)) >>> 0))] }));
    expect(out.status).toBe("no_match");
    expect(requests).toHaveLength(0);
  });
  test("off with an empty library: not_ready nothing_to_match", async () => {
    const out = await identifySong(clip(), opts({ mode: "off" }));
    expect(out).toMatchObject({ status: "not_ready", reason: "nothing_to_match" });
    expect(requests).toHaveLength(0);
  });
  test("ask: needs_confirm with no request; confirmed goes ahead", async () => {
    expect((await identifySong(clip(), opts({ mode: "ask" }))).status).toBe("needs_confirm");
    expect(requests).toHaveLength(0);
    expect((await identifySong(clip(), opts({ mode: "ask", confirmed: true }))).status).toBe("matched");
    expect(requests).toHaveLength(1);
  });
  test("no key: Shazam remains available", async () => {
    const out = await identifySong(clip(), opts({ key: null, shazam: async () => ({ kind: "ok", result: { title: "Quick", artist: "Artist", album: null, year: null, musicbrainz_recording_id: null, musicbrainz_artist_id: null, musicbrainz_release_group_id: null, score: 0.9, source: "shazam" } }) }));
    expect(out.status).toBe("matched");
  });
  test("fpcalc missing: not_ready fpcalc_missing, and a runner that fails is failed", async () => {
    expect(await identifySong(clip(), opts({ hasFpcalc: false, shazamEnabled: false }))).toEqual({ status: "no_match" });
    expect(await identifySong(clip(), opts({ fingerprint: async () => null, shazamEnabled: false }))).toMatchObject({ status: "failed" });
    expect(await identifySong(clip(), opts({ decode: async () => null }))).toEqual({ status: "failed", reason: "decode_failed" });
    expect(requests).toHaveLength(0);
  });
  test("readiness states", () => {
    const base = { key: SECRET_KEY, hasFpcalc: true, localCount: 0, mode: "on" as const };
    expect(identifyReadiness(base).state).toBe("ready");
    expect(identifyReadiness({ ...base, key: null }).state).toBe("ready");
    expect(identifyReadiness({ ...base, key: null, localCount: 3 }).state).toBe("ready");
    expect(identifyReadiness({ ...base, hasFpcalc: false }).state).toBe("ready");
    expect(identifyReadiness({ ...base, mode: "off" }).state).toBe("nothing_to_match");
    expect(identifyReadiness({ ...base, mode: "off", localCount: 2 }).state).toBe("ready");
  });
});

describe("failures never throw", () => {
  test("AcoustID 500: failed after one retry", async () => {
    respond = () => new Response("boom", { status: 500 });
    expect(await identifySong(clip(), opts())).toEqual({ status: "failed", reason: "lookup_failed" });
    expect(requests).toHaveLength(2);
  });
  test("a 4xx is not retried", async () => {
    respond = () => new Response("bad", { status: 400 });
    expect(await identifySong(clip(), opts())).toEqual({ status: "failed", reason: "lookup_failed" });
    expect(requests).toHaveLength(1);
  });
  test("a timeout (aborted request) is failed, retried once", async () => {
    let calls = 0;
    const slow = (async () => { calls++; throw new DOMException("timed out", "TimeoutError"); }) as unknown as NonNullable<IdentifyOptions["fetch"]>;
    expect(await identifySong(clip(), opts({ fetch: slow }))).toEqual({ status: "failed", reason: "lookup_failed" });
    expect(calls).toBe(2);
  });
  test("a decoder or runner that throws is failed, not thrown", async () => {
    const out = await identifySong(clip(), opts({ decode: async () => { throw new Error("boom"); } }));
    expect(out.status).toBe("failed");
  });
});

describe("limits", () => {
  test("the limiter allows three lookups a second, the fourth is rate_limited", async () => {
    const limiter = new RateLimiter(3, () => 1000);
    const results = [];
    for (let i = 0; i < 4; i++) results.push((await identifySong(clip(), opts({ limiter }))).status);
    expect(results).toEqual(["matched", "matched", "matched", "rate_limited"]);
    expect(requests).toHaveLength(3);
  });
  test("one request in flight at a time", async () => {
    let active = 0, peak = 0;
    const f = (async () => { active++; peak = Math.max(peak, active); await Bun.sleep(15); active--; return Response.json(acoustAnswer); }) as unknown as NonNullable<IdentifyOptions["fetch"]>;
    const limiter = new RateLimiter(10, () => 0);
    await Promise.all([1, 2, 3].map(() => identifySong(clip(), opts({ fetch: f, limiter }))));
    expect(peak).toBe(1);
  });
  test("a device is refused a second clip within 60 seconds, then allowed", () => {
    expect(deviceGate("dev-1", 1_000).ok).toBe(true);
    const second = deviceGate("dev-1", 30_000);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.retry_after_s).toBe(31);
    expect(deviceGate("dev-2", 30_000).ok).toBe(true);
    expect(deviceGate("dev-1", 61_001).ok).toBe(true);
  });
  test("an oversize clip is refused before anything runs", async () => {
    let decoded = 0;
    const counting: Decoder = async () => { decoded++; return { pcm: pcm(), seconds: 5 }; };
    expect(await identifySong({ bytes: new Uint8Array(MAX_CLIP_BYTES + 1), kind: { kind: "container" } }, opts({ decode: counting }))).toEqual({ status: "failed", reason: "too_big" });
    expect(await identifySong({ bytes: new Uint8Array(21 * 16000 * 2), kind: { kind: "pcm16", rate: 16000 } }, opts({ decode: counting }))).toEqual({ status: "failed", reason: "too_long" });
    expect(await identifySong(clip(), opts({ decode: async () => ({ pcm: pcm(), seconds: 25 }) }))).toEqual({ status: "failed", reason: "too_long" });
    expect(await identifySong({ bytes: new Uint8Array(0), kind: { kind: "container" } }, opts({ decode: counting }))).toEqual({ status: "failed", reason: "bad_clip" });
    expect(decoded).toBe(0);
  });
});

describe("privacy", () => {
  test("logs carry counts and timings, never a title, artist, fingerprint or key", async () => {
    const lines: string[] = [];
    const log = (line: string) => lines.push(line);
    await identifySong(clip(), opts({ log }));
    respond = () => new Response("x", { status: 500 });
    await identifySong(clip(), opts({ log }));
    await identifySong(clip(), opts({ log, key: null }));
    const text = lines.join("\n");
    expect(lines.filter((line) => line.includes("status=")).length).toBe(3);
    for (const secret of [SECRET_TITLE, SECRET_ARTIST, SECRET_FP, SECRET_KEY, "Night Album"]) expect(text).not.toContain(secret);
    expect(text).toMatch(/status=matched/);
    expect(text).toMatch(/ms=\d+/);
  });
  test("the cache is keyed by a hash and holds the result only: no person or device", async () => {
    const cache = new FingerprintCache(200);
    await identifySong(clip(), opts({ cache, fingerprint: prints(null, SECRET_FP) }));
    const store = (cache as unknown as { store: Map<string, Record<string, unknown>> }).store;
    expect(store.size).toBe(1);
    const [[key, value]] = [...store.entries()] as [[string, Record<string, unknown>]];
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.keys(value).sort()).toEqual(["album", "artist", "musicbrainz_artist_id", "musicbrainz_recording_id", "musicbrainz_release_group_id", "score", "source", "title", "year"]);
    expect(JSON.stringify([...store.entries()])).not.toMatch(/person|device|user/i);
    expect(JSON.stringify([...store.entries()])).not.toContain(SECRET_FP);
  });
});

describe("the real fingerprint runner, with a fake fpcalc", () => {
  test("PCM goes to fpcalc on stdin and the answer is parsed", async () => {
    const dir = mkdtempSync(join(tmpdir(), "fake-fpcalc-"));
    const script = join(dir, "fpcalc");
    writeFileSync(script, `#!/bin/sh\ncat >/dev/null\ncase "$*" in *-raw*) echo '{"duration": 5.0, "fingerprint": [1, 2, 4294967295]}';; *) echo '{"duration": 5.0, "fingerprint": "AQAAfakeprint"}';; esac\n`);
    chmodSync(script, 0o755);
    const oldPath = process.env.PATH;
    process.env.PATH = `${dir}:${oldPath}`;
    try {
      const out = await identifySong(clip(), { decode, library: () => [], mode: "on", key: SECRET_KEY, acoustIdBase: base(), sleep: async () => {}, log: () => {}, cache: new FingerprintCache(5), limiter: new RateLimiter(3, () => 0) });
      expect(out.status).toBe("matched");
      expect(requests[0]).toContain("fingerprint=AQAAfakeprint");
    } finally { process.env.PATH = oldPath; }
  });
  test("raw fingerprints round trip through the stored form", () => {
    const raw = Uint32Array.from([0, 1, 4294967295, 123456789]);
    expect([...unpackRaw(packRaw(raw))]).toEqual([...raw]);
  });
});
