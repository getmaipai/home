// MUSIC-ID-05 (docs/design/music-identify-shazam-2026-11-14.md): name a song from its acoustic signature with Shazam's discovery
// service, the one lookup built for a few seconds of a song taken from the middle (AcoustID matches whole recordings from the start).
//
// What leaves the home: the signature (a list of spectral peaks, never audio) and its length, over HTTPS, with a plain `MaiPai-Home`
// user agent, a neutral location (0, 0) and the time zone UTC: nothing about the household, the person or the device.
// "We are the user" (THIRD-PARTY-SERVICES.md): one request in flight, a limiter, a 6 s timeout, no retry, and quiet mode after a 429.
// Rule 6: nothing here throws; a failure is a typed result and the caller falls back to AcoustID. Rule 6a: no title, artist or signature
// is logged here.
import { RateLimiter, type IdentifyResult } from "./identifyCore";
import type { Signature } from "./shazamHelper";

export const SHAZAM_HOST = "amp.shazam.com";
export const SHAZAM_USER_AGENT = "MaiPai-Home";
const TIMEOUT_MS = 6_000;
/** After a 429 (the service pushed back) no snippet lookup is made for this long. */
export const SHAZAM_QUIET_MS = 10 * 60_000;

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
export type ShazamLookup = { kind: "ok"; result: IdentifyResult | null } | { kind: "rate_limited"; retryAfterS: number } | { kind: "failed" };

export interface ShazamOptions {
  fetch?: FetchLike;
  base?: string;
  now?: () => number;
  limiter?: RateLimiter;
  uuid?: () => string;
  /** The race aborts the loser through this. */
  signal?: AbortSignal;
}

let quietUntil = 0;
let inFlight: Promise<unknown> = Promise.resolve();
/** One request per second at most, and one at a time: a person's pace, not a crawler's. */
const sharedLimiter = new RateLimiter(1, () => Date.now());
export function __resetShazamForTests(): void { quietUntil = 0; inFlight = Promise.resolve(); }
export function shazamQuietUntil(): number { return quietUntil; }

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** The request body: the signature and its length, a neutral place and zone. */
export function shazamBody(signature: Signature, nowMs: number): string {
  return JSON.stringify({
    geolocation: { altitude: 0, latitude: 0, longitude: 0 },
    signature: { samplems: signature.sampleMs, timestamp: nowMs, uri: signature.uri },
    timestamp: nowMs,
    timezone: "UTC",
  });
}

export function shazamUrl(base: string, first: string, second: string): string {
  return `${base}/discovery/v5/en/US/android/-/tag/${first.toUpperCase()}/${second}?sync=true&webv3=true&sampling=true&connected=&shazamapiversion=v3&sharehub=true&video=v3`;
}

/** The song in the service's answer: `track.title`, `track.subtitle` (the artist) and the Album line of its first section. Never throws. */
export function parseShazam(json: unknown): IdentifyResult | null {
  try {
    if (!isRecord(json) || !isRecord(json.track)) return null;
    const title = json.track.title;
    const artist = json.track.subtitle;
    if (typeof title !== "string" || title.trim() === "" || typeof artist !== "string" || artist.trim() === "") return null;
    let album: string | null = null;
    let year: number | null = null;
    const sections = Array.isArray(json.track.sections) ? json.track.sections : [];
    for (const section of sections) {
      if (!isRecord(section) || !Array.isArray(section.metadata)) continue;
      for (const item of section.metadata) {
        if (isRecord(item) && item.title === "Album" && typeof item.text === "string" && item.text.trim() !== "") album = item.text.trim().slice(0, 200);
        if (isRecord(item) && item.title === "Released" && typeof item.text === "string") { const match = /^(\d{4})/.exec(item.text.trim()); if (match) year = Number(match[1]); }
      }
      if (album !== null) break;
    }
    return { title: title.trim().slice(0, 200), artist: artist.trim().slice(0, 200), album, year, musicbrainz_recording_id: null, musicbrainz_artist_id: null, musicbrainz_release_group_id: null, score: 0.9, source: "shazam" };
  } catch {
    return null;
  }
}

/** Ask the service. At most one request in flight for every caller in this process. */
export async function lookupShazam(signature: Signature, options: ShazamOptions = {}): Promise<ShazamLookup> {
  const now = options.now ?? Date.now;
  const run = async (): Promise<ShazamLookup> => {
    if (options.signal?.aborted) return { kind: "failed" };
    if (!options.fetch && process.env.MAIPAI_SHAZAM_OFFLINE === "1") return { kind: "failed" };
    if (now() < quietUntil) return { kind: "rate_limited", retryAfterS: Math.max(1, Math.ceil((quietUntil - now()) / 1000)) };
    const wait = (options.limiter ?? sharedLimiter).take();
    if (wait > 0) return { kind: "rate_limited", retryAfterS: Math.max(1, Math.ceil(wait / 1000)) };
    try {
      const uuid = options.uuid ?? (() => crypto.randomUUID());
      const response = await (options.fetch ?? ((input, init) => globalThis.fetch(input, init)))(shazamUrl(options.base ?? `https://${SHAZAM_HOST}`, uuid(), uuid()), {
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Language": "en_US", Accept: "application/json", "User-Agent": SHAZAM_USER_AGENT },
        body: shazamBody(signature, now()),
        credentials: "omit",
        referrerPolicy: "no-referrer",
        signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(TIMEOUT_MS)]) : AbortSignal.timeout(TIMEOUT_MS),
      });
      if (response.status === 429) { quietUntil = now() + SHAZAM_QUIET_MS; return { kind: "rate_limited", retryAfterS: Math.ceil(SHAZAM_QUIET_MS / 1000) }; }
      if (!response.ok) return { kind: "failed" };
      return { kind: "ok", result: parseShazam(await response.json()) };
    } catch {
      return { kind: "failed" };
    }
  };
  const mine = inFlight.then(run, run);
  inFlight = mine.catch(() => undefined);
  return mine;
}
