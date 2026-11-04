// MUSIC-MB-01: the background MusicBrainz matcher (docs/design/music-like-this-2026-11-01.md, section 1).
//
// A library song that carries no MusicBrainz ids gets them from one text search: title, artist, album and track number, sent to
// musicbrainz.org only, one request a second at most, with an identifying User-Agent. A match is accepted only when the names are equal
// after folding spelling quirks and exactly one recording fits; anything less stays empty (a wrong id shown as fact is worse than none).
// Embedded tag ids win and are filled at scan time (parsers/audioTags.ts); this module never overwrites one.
//
// Rule 6: a failed, slow or offline lookup never fails anything (it is counted and the song is tried again at the next pass).
// Rule 6a: logs carry counts and timings only, never a title, an artist or an id.
//
// Client choice (checked 2026-11-01): `musicbrainz-api` 2.0.1 was installed and read. It is maintained and bun-compatible, but it calls the
// global fetch with no per-request timeout or abort, limits by a sliding window (a burst, not a spacing), and brings seven dependencies
// of which most serve submission (XML, digest auth). This item needs two GET searches, so a small fetch client that owns the spacing,
// the timeout and the host check is smaller and testable. Mirror: the pre-migration catalog.ts `sameArtistName` fold and 1.1 s queue,
// rebuilt small (rule 8).
import { and, eq, isNull, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { db } from "@/db";
import { mediaItems, mediaSources } from "@/db/schema";
import { nextHlc } from "@/lib/hlc";
import { HOME_USER_AGENT } from "@/lib/outbound";
import { getHouseholdSettingValue } from "@/lib/settings";
import { trackBackgroundWork } from "@/lib/backgroundWork";

export const MUSICBRAINZ_HOST = "musicbrainz.org";
export const MUSICBRAINZ_MATCH_KEY = "music.musicbrainz_match";
/** MusicBrainz asks for no more than one request a second; a little over, as the old hub's queue did. */
export const MIN_GAP_MS = 1100;
const REQUEST_TIMEOUT_MS = 8000;
const MIN_SCORE = 90;
const DURATION_SLACK_S = 5;
/** The most songs searched per pass (about two minutes); the rest wait for the next scan. */
const PASS_BUDGET = 100;
/** Stop a pass after this many failures in a row (offline, blocked, throttled). */
const MAX_CONSECUTIVE_FAILURES = 3;

export function matchingEnabled(): boolean {
  return getHouseholdSettingValue(MUSICBRAINZ_MATCH_KEY) !== false;
}

function baseUrl(): string {
  // Tests point this at a closed port (tests/preload.ts); production never sets it.
  return process.env.MAIPAI_MUSICBRAINZ_BASE_URL || `https://${MUSICBRAINZ_HOST}`;
}

// ---- Name folding ----------------------------------------------------------------------------------------------------------------

/** Names equal across spelling quirks: accents, curly quotes, case, "&" against "and", punctuation and a trailing remaster note. */
export function foldName(value: string): string {
  return value
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[‘’ʼ`´]/g, "'")
    .toLowerCase()
    .replace(/\s*[(\[][^)\]]*remaster[^)\]]*[)\]]\s*$/u, "")
    .replace(/\s+-\s+(?:\d{4}\s+)?remaster(?:ed)?(?:\s+\d{4})?\s*$/u, "")
    .replace(/&/g, " and ")
    .replace(/['"]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function sameName(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const fa = foldName(a);
  return fa !== "" && fa === foldName(b);
}

// ---- The client ------------------------------------------------------------------------------------------------------------------

export interface ClientDeps {
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  minGapMs?: number;
}

export interface MbCredit { name?: string; joinphrase?: string; artist?: { id?: string; name?: string } }
export interface MbRelease { id?: string; title?: string; "release-group"?: { id?: string }; media?: Array<{ track?: Array<{ number?: string }>; "track-offset"?: number }> }
export interface MbRecording { id?: string; title?: string; score?: number; length?: number; "artist-credit"?: MbCredit[]; releases?: MbRelease[] }
export interface MbRecordingRelations { relations?: Array<{ type?: string; url?: { resource?: string } }> }

export class MusicBrainzUnavailable extends Error {}

export interface MusicBrainzClient {
  searchRecordings(query: string, limit: number): Promise<MbRecording[]>;
  /** MUSIC-WIKI-01: the artist's Wikidata id from its MusicBrainz url relations, or null when it has none. Only the artist's MusicBrainz id is sent. */
  lookupArtistWikidata(artistId: string): Promise<string | null>;
  /** MUSIC-LIKE-01: the artist's public genre names, for a band made "like" a playing song. Only the artist's MusicBrainz id is sent. */
  lookupArtistGenres(artistId: string): Promise<string[]>;
  /** MUSIC-FACTS-01: the recording's linked Wikipedia page or Wikidata entity. */
  lookupRecordingRelations(recordingId: string): Promise<MbRecordingRelations>;
}

/** One client holds the one queue: every request to MusicBrainz from this process goes through it, so the spacing is global. */
export function createMusicBrainzClient(deps: ClientDeps = {}): MusicBrainzClient {
  const doFetch = deps.fetch ?? ((input: string | URL | Request, init?: RequestInit) => globalThis.fetch(input, init));
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const gap = deps.minGapMs ?? MIN_GAP_MS;
  let chain: Promise<unknown> = Promise.resolve();
  let last = Number.NEGATIVE_INFINITY;
  const turn = (): Promise<void> => {
    const mine = chain.then(async () => {
      const wait = gap - (now() - last);
      if (wait > 0) await sleep(wait);
      last = now();
    });
    chain = mine.catch(() => undefined);
    return mine;
  };
  const getJson = async (url: URL): Promise<unknown> => {
    // Only musicbrainz.org (or the test override) is ever asked.
    if (url.hostname !== MUSICBRAINZ_HOST && !process.env.MAIPAI_MUSICBRAINZ_BASE_URL) throw new MusicBrainzUnavailable("host");
    await turn();
    let response: Response;
    try {
      response = await doFetch(url, {
        method: "GET",
        headers: { "User-Agent": HOME_USER_AGENT, Accept: "application/json" },
        credentials: "omit",
        referrerPolicy: "no-referrer",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new MusicBrainzUnavailable("network");
    }
    if (response.status === 404) return null;
    if (!response.ok) throw new MusicBrainzUnavailable(`status ${response.status}`);
    try {
      return await response.json();
    } catch {
      throw new MusicBrainzUnavailable("body");
    }
  };
  return {
    async searchRecordings(query, limit) {
      const url = new URL(`${baseUrl()}/ws/2/recording`);
      url.searchParams.set("query", query);
      url.searchParams.set("limit", String(limit));
      url.searchParams.set("fmt", "json");
      const body = (await getJson(url)) as { recordings?: unknown } | null;
      return Array.isArray(body?.recordings) ? (body!.recordings as MbRecording[]) : [];
    },
    async lookupArtistWikidata(artistId) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(artistId)) return null;
      const url = new URL(`${baseUrl()}/ws/2/artist/${artistId}`);
      url.searchParams.set("inc", "url-rels");
      url.searchParams.set("fmt", "json");
      const body = (await getJson(url)) as { relations?: Array<{ type?: string; url?: { resource?: string } }> } | null;
      for (const relation of body?.relations ?? []) {
        if (relation.type !== "wikidata") continue;
        const found = /^https?:\/\/(?:www\.)?wikidata\.org\/(?:wiki|entity)\/(Q\d+)$/.exec(relation.url?.resource ?? "");
        if (found) return found[1]!;
      }
      return null;
    },
    async lookupArtistGenres(artistId) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(artistId)) return [];
      const url = new URL(`${baseUrl()}/ws/2/artist/${artistId}`);
      url.searchParams.set("inc", "genres");
      url.searchParams.set("fmt", "json");
      const body = (await getJson(url)) as { genres?: Array<{ name?: string; count?: number }> } | null;
      return (body?.genres ?? []).filter((g) => typeof g.name === "string" && g.name !== "").sort((a, b) => (b.count ?? 0) - (a.count ?? 0)).slice(0, 6).map((g) => g.name!);
    },
    async lookupRecordingRelations(recordingId) {
      if (!UUID.test(recordingId.toLowerCase())) return {};
      const url = new URL(`${baseUrl()}/ws/2/recording/${recordingId}`);
      url.searchParams.set("inc", "url-rels+work-rels");
      url.searchParams.set("fmt", "json");
      const body = (await getJson(url)) as MbRecordingRelations | null;
      return body ?? {};
    },
  };
}

let shared: MusicBrainzClient | null = null;
/** The process-wide client (so later MusicBrainz callers share the one queue). */
export function sharedMusicBrainzClient(): MusicBrainzClient {
  return (shared ??= createMusicBrainzClient());
}
export function __setMusicBrainzClientForTests(client: MusicBrainzClient | null): void {
  shared = client;
}

// ---- Matching ---------------------------------------------------------------------------------------------------------------------

export interface SongText {
  title: string;
  artist: string;
  album: string | null;
  albumArtist: string | null;
  trackNo: number | null;
  durationS: number | null;
}

export interface MbIds { recordingId: string; artistId: string | null; releaseGroupId: string | null }

const lucene = (value: string): string => value.replace(/[+\-&|!(){}[\]^"~*?:\\/]/g, " ").replace(/\s+/g, " ").trim();

export function recordingQuery(song: SongText): string {
  const parts = [`recording:"${lucene(song.title)}"`, `artist:"${lucene(song.artist)}"`];
  if (song.album) parts.push(`release:"${lucene(song.album)}"`);
  return parts.join(" AND ");
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const validId = (value: unknown): string | null => (typeof value === "string" && UUID.test(value.toLowerCase()) ? value.toLowerCase() : null);

function creditArtistId(recording: MbRecording, song: SongText): string | null {
  const credits = recording["artist-credit"] ?? [];
  const wanted = [song.artist, song.albumArtist];
  const hit = credits.find((credit) => wanted.some((name) => sameName(credit.artist?.name ?? credit.name, name)));
  return validId((hit ?? (credits.length === 1 ? credits[0] : undefined))?.artist?.id);
}

function creditsMatch(recording: MbRecording, song: SongText): boolean {
  const credits = recording["artist-credit"] ?? [];
  if (credits.length === 0) return false;
  const joined = credits.map((credit) => `${credit.name ?? credit.artist?.name ?? ""}${credit.joinphrase ?? ""}`).join("");
  const names = [song.artist, song.albumArtist];
  if (names.some((name) => sameName(joined, name))) return true;
  return credits.some((credit) => names.some((name) => sameName(credit.artist?.name ?? credit.name, name)));
}

function albumReleases(recording: MbRecording, song: SongText): MbRelease[] {
  return song.album ? (recording.releases ?? []).filter((release) => sameName(release.title, song.album)) : [];
}

function hasTrackNumber(release: MbRelease, trackNo: number | null): boolean {
  if (trackNo === null) return false;
  return (release.media ?? []).some((medium) => (medium.track ?? []).some((track) => Number(track.number) === trackNo));
}

/** The one recording this song is, or null. Pure: the search results come in, an id set or nothing comes out. */
export function chooseMatch(song: SongText, recordings: readonly MbRecording[]): MbIds | null {
  const seen = new Set<string>();
  let fits = recordings.filter((recording) => {
    const id = validId(recording.id);
    if (!id || seen.has(id)) return false;
    seen.add(id);
    if (typeof recording.score === "number" && recording.score < MIN_SCORE) return false;
    if (!sameName(recording.title, song.title)) return false;
    if (!creditsMatch(recording, song)) return false;
    if (song.durationS && typeof recording.length === "number" && Math.abs(recording.length / 1000 - song.durationS) > DURATION_SLACK_S) return false;
    return true;
  });
  if (song.album) {
    // The album the file names must be one of the recording's releases; a recording on other albums only is a different version.
    fits = fits.filter((recording) => albumReleases(recording, song).length > 0);
    if (fits.length > 1) {
      const byTrack = fits.filter((recording) => albumReleases(recording, song).some((release) => hasTrackNumber(release, song.trackNo)));
      if (byTrack.length === 1) fits = byTrack;
    }
  }
  if (fits.length !== 1) return null; // none fits, or the name is ambiguous
  const recording = fits[0]!;
  const releases = albumReleases(recording, song);
  const groups = new Set(releases.map((release) => validId(release["release-group"]?.id)).filter((id): id is string => id !== null));
  return { recordingId: validId(recording.id)!, artistId: creditArtistId(recording, song), releaseGroupId: groups.size === 1 ? [...groups][0]! : null };
}

/** Looks one song up. Throws MusicBrainzUnavailable when MusicBrainz could not answer (the song is not marked as searched). */
export async function matchSong(song: SongText, client: MusicBrainzClient = sharedMusicBrainzClient()): Promise<MbIds | null> {
  return chooseMatch(song, await client.searchRecordings(recordingQuery(song), 10));
}

// ---- The background pass --------------------------------------------------------------------------------------------------------

export interface PassResult { considered: number; matched: number; empty: number; failed: number; ms: number }

/** What was searched, folded: the song is searched again only when this changes. */
export function checkedKeyOf(song: SongText): string {
  const text = [song.title, song.artist, song.album ?? "", song.albumArtist ?? "", String(song.trackNo ?? "")].map(foldName).join("|");
  return createHash("sha256").update(text).digest("hex").slice(0, 24);
}

export interface PassDeps { client?: MusicBrainzClient; now?: () => number; budget?: number }

/** One pass over library songs that have no recording id and whose text has not been searched. Never throws. */
export async function runMusicBrainzPass(deps: PassDeps = {}): Promise<PassResult> {
  const now = deps.now ?? Date.now;
  const started = now();
  const result: PassResult = { considered: 0, matched: 0, empty: 0, failed: 0, ms: 0 };
  try {
    if (!matchingEnabled()) return result;
    const client = deps.client ?? sharedMusicBrainzClient();
    // A scan clears the checked key when a song's text changes, so only never-searched songs are read.
    // Scanned library songs only: not a song made at home, not a saved copy, not a trashed or hidden one.
    const rows = db
      .select()
      .from(mediaItems)
      .innerJoin(mediaSources, eq(mediaSources.id, mediaItems.sourceId))
      .where(and(
        eq(mediaItems.kind, "track"), isNull(mediaItems.deletedAt), isNull(mediaItems.musicbrainzRecordingId),
        sql`${mediaItems.artist} IS NOT NULL AND ${mediaItems.artist} <> ''`, sql`${mediaItems.provenance} <> 'music:generated-library'`, sql`${mediaItems.sourceId} NOT LIKE 'msrc-made%'`,
        eq(mediaSources.kind, "root"), isNull(mediaItems.musicbrainzCheckedKey),
      ))
      .limit(deps.budget ?? PASS_BUDGET)
      .all()
      .map((row) => row.media_items);
    let failuresInARow = 0;
    for (const row of rows) {
      if (result.considered >= (deps.budget ?? PASS_BUDGET) || failuresInARow >= MAX_CONSECUTIVE_FAILURES) break;
      if (!matchingEnabled()) break;
      const song: SongText = { title: row.title, artist: row.artist!, album: row.album, albumArtist: row.albumArtist, trackNo: row.trackNo, durationS: row.durationS };
      const key = checkedKeyOf(song);
      if (row.musicbrainzCheckedKey === key) continue;
      result.considered++;
      let ids: MbIds | null;
      try {
        ids = await matchSong(song, client);
      } catch {
        result.failed++;
        failuresInARow++;
        continue;
      }
      failuresInARow = 0;
      const update = ids
        ? { musicbrainzRecordingId: ids.recordingId, musicbrainzArtistId: row.musicbrainzArtistId ?? ids.artistId, musicbrainzReleaseGroupId: row.musicbrainzReleaseGroupId ?? ids.releaseGroupId, musicbrainzCheckedKey: key, hlc: nextHlc() }
        : { musicbrainzCheckedKey: key };
      // Only a row still unmatched and untrashed is written: a scan or an edit that landed meanwhile wins.
      db.update(mediaItems).set(update).where(and(eq(mediaItems.id, row.id), isNull(mediaItems.musicbrainzRecordingId), isNull(mediaItems.deletedAt))).run();
      ids ? result.matched++ : result.empty++;
    }
  } catch {
    result.failed++;
  }
  result.ms = now() - started;
  if (result.considered > 0 || result.failed > 0) {
    console.log(`[music] musicbrainz match considered=${result.considered} matched=${result.matched} empty=${result.empty} failed=${result.failed} ms=${result.ms}`);
  }
  return result;
}

let passRunning: Promise<PassResult> | null = null;
let passAgain = false;

/** Starts a pass in the background (coalescing: a request during a pass asks for one more after it). Never awaited by a scan. */
export function kickMusicBrainzMatch(deps: PassDeps = {}): Promise<PassResult> {
  if (process.env.MAIPAI_MUSICBRAINZ_NO_AUTOSTART === "1") return Promise.resolve({ considered: 0, matched: 0, empty: 0, failed: 0, ms: 0 });
  if (passRunning) { passAgain = true; return passRunning; }
  const run = (async () => {
    let last: PassResult;
    do {
      passAgain = false;
      last = await runMusicBrainzPass(deps);
    } while (passAgain && last.considered > 0 && last.failed === 0);
    return last;
  })().finally(() => { passRunning = null; });
  passRunning = run;
  return trackBackgroundWork(run);
}
