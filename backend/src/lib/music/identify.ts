// MUSIC-ID-01 (docs/design/music-identify-2026-11-13.md): the one song-identification service. A caller gives a short clip; it
// returns the song. Robots, the Home app and the assistant all call `identifySong`; nothing about fingerprints or AcoustID lives
// anywhere else.
//
// Privacy: the clip is decoded in memory, fingerprinted and dropped, never written to disk or kept. Local first: the clip's fingerprint is
// matched against the household's own library fingerprints with no network. Only with no local match, and only when
// `music.identify.online` is `on` (or `ask` and the person confirmed), the fingerprint and the clip length (never audio) go to AcoustID.
// Rule 6: nothing here throws; every outcome is a typed result. Rule 6a: logs carry counts and timings only, never a title, an artist,
// a fingerprint or the key. The in-process cache is memory only and keyed by a hash of the fingerprint, never a person or a device.
import { getHouseholdSettingValue } from "@/lib/settings";
import {
  FingerprintCache, RateLimiter, acoustIdUrl, compareFingerprints, identifyReadinessFor, isLocalMatch, parseAcoustId,
  type IdentifyReadiness, type IdentifyResult,
} from "./identifyCore";
import {
  decodeWithFfmpeg, findFpcalc, fingerprintWithFpcalc,
  type ClipKind, type Decoder, type FingerprintRunner,
} from "./identifyAudio";
import { libraryFingerprintCount, loadLibraryFingerprints, type LibraryFingerprint } from "./fingerprintStore";

export const IDENTIFY_SETTING = "music.identify.online";
/** The credentials-center entry holding the AcoustID application key (a write-only secret; never logged, never returned). */
export const ACOUSTID_KEY_SETTING = "acoustid.client";
export const ACOUSTID_HOST = "api.acoustid.org";
export const MAX_CLIP_SECONDS = 20;
export const MAX_CLIP_BYTES = 2 * 1024 * 1024;
export const DEVICE_COOLDOWN_MS = 60_000;
const REQUEST_TIMEOUT_MS = 5_000;
const CACHE_SIZE = 200;
const MAX_PER_SECOND = 3;

export type IdentifyMode = "on" | "ask" | "off";
export type NotReadyReason = Exclude<IdentifyReadiness["state"], "ready">;
export type FailedReason = "bad_clip" | "too_long" | "too_big" | "decode_failed" | "fingerprint_failed" | "lookup_failed" | "unexpected";

/** Every outcome, typed. `matched` carries the song; the rest say why there is none. */
export type IdentifyOutcome =
  | { status: "matched"; result: IdentifyResult }
  | { status: "no_match" }
  | { status: "needs_confirm" }
  | { status: "not_ready"; reason: NotReadyReason; line: string }
  | { status: "failed"; reason: FailedReason }
  | { status: "rate_limited"; retry_after_s: number };

/** The declared clip: bytes plus how to read them. */
export type IdentifyClip = { bytes: Uint8Array; kind: ClipKind };

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface IdentifyOptions {
  /** Test seams: every outside dependency is injectable. */
  decode?: Decoder;
  fingerprint?: FingerprintRunner;
  library?: () => LibraryFingerprint[];
  fetch?: FetchLike;
  acoustIdBase?: string;
  mode?: IdentifyMode;
  key?: string | null;
  hasFpcalc?: boolean;
  /** The surface already asked the person and got a yes: `ask` then proceeds like `on`. */
  confirmed?: boolean;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  limiter?: RateLimiter;
  cache?: FingerprintCache;
  log?: (line: string) => void;
}

// ---- Settings and readiness -----------------------------------------------------------------------------------------------------

export function identifyMode(): IdentifyMode {
  try {
    const value = getHouseholdSettingValue(IDENTIFY_SETTING);
    return value === "ask" || value === "off" ? value : "on";
  } catch {
    return "on";
  }
}

/** The AcoustID key, or null when none is set (or it no longer decrypts). Never logged. */
export function acoustIdKey(): string | null {
  try {
    const value = getHouseholdSettingValue(ACOUSTID_KEY_SETTING);
    return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
  } catch {
    return null;
  }
}

/** The one readiness answer (rule S6): served through healthSnapshot.ts and /api/health; no client recomputes it. */
export function identifyReadiness(inputs: { key?: string | null; hasFpcalc?: boolean; localCount?: number; mode?: IdentifyMode } = {}): IdentifyReadiness {
  let localCount = inputs.localCount;
  if (localCount === undefined) { try { localCount = libraryFingerprintCount(); } catch { localCount = 0; } }
  return identifyReadinessFor({
    hasKey: (inputs.key === undefined ? acoustIdKey() : inputs.key) !== null,
    hasFpcalc: inputs.hasFpcalc ?? findFpcalc() !== null,
    hasLocalFingerprints: localCount > 0,
    setting: inputs.mode ?? identifyMode(),
  });
}

// ---- AcoustID: one limiter, one request in flight --------------------------------------------------------------------------------

const sharedLimiter = new RateLimiter(MAX_PER_SECOND, () => Date.now());
let sharedCache = new FingerprintCache(CACHE_SIZE);
let inFlight: Promise<unknown> = Promise.resolve();
export function __resetIdentifyForTests(): void { inFlight = Promise.resolve(); sharedCache = new FingerprintCache(CACHE_SIZE); deviceLast.clear(); }
/** Test seam: the shared cache, so a test can check what it holds. */
export function __sharedCacheForTests(): FingerprintCache { return sharedCache; }

type Lookup = { kind: "ok"; result: IdentifyResult | null } | { kind: "rate_limited"; retryAfterS: number } | { kind: "failed" };

/** Ask AcoustID with the fingerprint and the length only. At most one retry (a 5xx, a network error or a timeout), 5 s timeout each. */
async function lookupAcoustId(fingerprint: string, seconds: number, key: string, o: Required<Pick<IdentifyOptions, "acoustIdBase" | "now" | "sleep" | "limiter">> & { fetch: FetchLike }): Promise<Lookup> {
  const run = async (): Promise<Lookup> => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const wait = o.limiter.take();
      if (wait > 0) return { kind: "rate_limited", retryAfterS: Math.max(1, Math.ceil(wait / 1000)) };
      try {
        const response = await o.fetch(acoustIdUrl(o.acoustIdBase, key, fingerprint, seconds), {
          method: "GET", headers: { Accept: "application/json" }, credentials: "omit", referrerPolicy: "no-referrer", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (response.ok) return { kind: "ok", result: parseAcoustId(await response.json()) };
        if (response.status < 500) return { kind: "failed" };
      } catch { /* a network error or the timeout: one retry */ }
      if (attempt === 0) await o.sleep(250);
    }
    return { kind: "failed" };
  };
  // One request in flight at a time, for every caller in this process.
  const mine = inFlight.then(run, run);
  inFlight = mine.catch(() => undefined);
  return mine;
}

// ---- Per-device refusal ------------------------------------------------------------------------------------------------------------

const deviceLast = new Map<string, number>();
/** A device that sent a clip in the last 60 s gets a typed `rate_limited`, not an error. Memory only; entries are dropped once stale. */
export function deviceGate(deviceKey: string, now: number = Date.now()): { ok: true } | { ok: false; retry_after_s: number } {
  for (const [key, at] of deviceLast) if (now - at >= DEVICE_COOLDOWN_MS) deviceLast.delete(key);
  const last = deviceLast.get(deviceKey);
  if (last !== undefined && now - last < DEVICE_COOLDOWN_MS) return { ok: false, retry_after_s: Math.max(1, Math.ceil((DEVICE_COOLDOWN_MS - (now - last)) / 1000)) };
  deviceLast.set(deviceKey, now);
  return { ok: true };
}

// ---- The service -------------------------------------------------------------------------------------------------------------------

function localMatch(raw: Uint32Array, library: LibraryFingerprint[]): IdentifyResult | null {
  let best: { score: number; row: LibraryFingerprint } | null = null;
  let second = 0;
  for (const row of library) {
    const { score } = compareFingerprints(raw, row.raw);
    if (best === null || score > best.score) { if (best) second = Math.max(second, best.score); best = { score, row }; }
    else second = Math.max(second, score);
  }
  if (!best || !isLocalMatch(best.score, second)) return null;
  const r = best.row;
  return { title: r.title, artist: r.artist, album: r.album, musicbrainz_recording_id: r.recordingId, musicbrainz_artist_id: r.artistId, musicbrainz_release_group_id: r.releaseGroupId, score: best.score, source: "library" };
}

/** Name the song in a short clip. Never throws; every outcome is a typed result. */
export async function identifySong(clip: IdentifyClip, options: IdentifyOptions = {}): Promise<IdentifyOutcome> {
  const now = options.now ?? Date.now;
  const started = now();
  const log = options.log ?? ((line: string) => console.log(line));
  const done = (outcome: IdentifyOutcome, extra = ""): IdentifyOutcome => {
    log(`[music] identify status=${outcome.status}${"reason" in outcome ? ` reason=${outcome.reason}` : ""}${extra} ms=${now() - started}`);
    return outcome;
  };
  try {
    if (clip.bytes.byteLength === 0) return done({ status: "failed", reason: "bad_clip" });
    if (clip.bytes.byteLength > MAX_CLIP_BYTES) return done({ status: "failed", reason: "too_big" });
    if (clip.kind.kind === "pcm16" && (!Number.isInteger(clip.kind.rate) || clip.kind.rate < 4000 || clip.kind.rate > 48000)) return done({ status: "failed", reason: "bad_clip" });
    if (clip.kind.kind === "pcm16" && clip.bytes.byteLength / 2 / clip.kind.rate > MAX_CLIP_SECONDS) return done({ status: "failed", reason: "too_long" });

    const mode = options.mode ?? identifyMode();
    const key = options.key === undefined ? acoustIdKey() : options.key;
    const library = options.library ?? loadLibraryFingerprints;
    let localRows: LibraryFingerprint[] = [];
    try { localRows = library(); } catch { localRows = []; }
    const readiness = identifyReadiness({ key, hasFpcalc: options.hasFpcalc ?? findFpcalc() !== null, localCount: localRows.length, mode });
    if (readiness.state !== "ready") return done({ status: "not_ready", reason: readiness.state, line: readiness.line });

    const decoded = await (options.decode ?? decodeWithFfmpeg)(clip.bytes, clip.kind);
    if (!decoded) return done({ status: "failed", reason: "decode_failed" });
    if (decoded.seconds > MAX_CLIP_SECONDS) return done({ status: "failed", reason: "too_long" });

    // Local first: the raw fingerprint is all it needs. The compressed one is made only if a lookup is going to happen.
    const needOnline = mode === "on" || (mode === "ask" && options.confirmed === true);
    const prints = await (options.fingerprint ?? fingerprintWithFpcalc)(decoded.pcm, { raw: localRows.length > 0, compressed: false });
    if (!prints) return done({ status: "failed", reason: "fingerprint_failed" });
    if (prints.raw && localRows.length > 0) {
      const hit = localMatch(prints.raw, localRows);
      if (hit) return done({ status: "matched", result: hit }, " source=library");
    }
    if (mode === "off") return done({ status: "no_match" }, " online=off");
    if (!needOnline) return done({ status: "needs_confirm" });
    if (key === null) return done({ status: "not_ready", reason: "no_key", line: identifyReadinessFor({ hasKey: false, hasFpcalc: true, hasLocalFingerprints: false, setting: mode }).line });

    const online = await (options.fingerprint ?? fingerprintWithFpcalc)(decoded.pcm, { raw: false, compressed: true });
    if (!online?.compressed) return done({ status: "failed", reason: "fingerprint_failed" });
    const cache = options.cache ?? sharedCache;
    const cached = cache.get(online.compressed);
    if (cached) return done({ status: "matched", result: cached }, " source=cache");
    const answer = await lookupAcoustId(online.compressed, Math.max(1, Math.round(online.seconds || decoded.seconds)), key, {
      fetch: options.fetch ?? ((input, init) => globalThis.fetch(input, init)),
      acoustIdBase: options.acoustIdBase ?? `https://${ACOUSTID_HOST}`,
      now, sleep: options.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms))), limiter: options.limiter ?? sharedLimiter,
    });
    if (answer.kind === "rate_limited") return done({ status: "rate_limited", retry_after_s: answer.retryAfterS });
    if (answer.kind === "failed") return done({ status: "failed", reason: "lookup_failed" });
    if (!answer.result) return done({ status: "no_match" }, " source=acoustid");
    cache.set(online.compressed, answer.result);
    return done({ status: "matched", result: answer.result }, " source=acoustid");
  } catch {
    return done({ status: "failed", reason: "unexpected" });
  }
}
