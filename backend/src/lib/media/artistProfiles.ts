// MUSIC-WIKI-01: a photo and a two-sentence bio for a matched artist, from Wikimedia (docs/design/music-like-this-2026-11-01.md, section 1b).
//
// For an artist the MusicBrainz matcher gave an artist id (MUSIC-MB-01), one MusicBrainz lookup returns the artist's Wikidata id; Wikidata names
// the English Wikipedia page and the lead photo on Commons. Only the MusicBrainz artist id, then the Wikidata id, the page title and the file
// title are ever sent: nothing about the household, no library title, no name anyone typed. The bio and the photo are kept on this computer
// (a table row plus a file in the cache data class), so a page view makes no request. Off or offline, the artist page shows the generated
// cover and initials as before.
//
// Reuses backend/src/lib/answerImages/wikimedia.ts: its paced fetch with Home's User-Agent, its Commons lead-photo lookup with licence
// fields, its claim readers, its source-mode gate and its under-18 rule (a person under 18, or one whose age Wikidata does not state, gets
// no photo and no bio). A disambiguation page is never used.
//
// Rule 6: a failed, slow or offline lookup never fails anything (counted, and tried again at the next pass).
// Rule 6a: logs carry counts and timings only, never an artist, an id or a title.
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { db } from "@/db";
import { mediaItems, musicArtistProfiles } from "@/db/schema";
import { claimText, entityId, isUnder18, wikimediaCandidates, wikimediaFetchJson, wikimediaLiveBlocked, type FetchJson, type WikimediaCandidate } from "@/lib/answerImages/wikimedia";
import { trackBackgroundWork } from "@/lib/backgroundWork";
import { nextHlc } from "@/lib/hlc";
import { HOME_USER_AGENT } from "@/lib/outbound";
import { classDir } from "@/lib/paths";
import { getHouseholdSettingValue } from "@/lib/settings";
import { sharedMusicBrainzClient, type MusicBrainzClient } from "./musicbrainzMatch";

export const ARTIST_WIKIMEDIA_KEY = "music.artist_wikimedia";
/** An artist with no usable page is asked about again after this long (Wikipedia gains pages). */
const RECHECK_MS = 90 * 24 * 60 * 60 * 1000;
/** The most artists looked up per pass; the rest wait for the next scan. */
const PASS_BUDGET = 25;
const MAX_CONSECUTIVE_FAILURES = 3;
const PHOTO_TIMEOUT_MS = 8000;
const PHOTO_MAX_BYTES = 4 * 1024 * 1024;
const PHOTO_HOSTS = new Set(["upload.wikimedia.org", "commons.wikimedia.org"]);
const PHOTO_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const BIO_MAX_CHARS = 500;
/** Wikidata classes that are not an artist: a disambiguation page, a category. */
const NOT_AN_ARTIST = new Set(["Q4167410", "Q4167836"]);

export function artistWikimediaEnabled(): boolean {
  return getHouseholdSettingValue(ARTIST_WIKIMEDIA_KEY) !== false;
}

function photoDir(): string {
  return join(classDir("cache"), "music-artists");
}

// ---- The lookup ------------------------------------------------------------------------------------------------------------------

export type PhotoCredit = { title: string; page: string; license: string; license_url?: string; author?: string };
export interface FoundProfile { status: "found"; wikidataId: string; bio: string | null; bioUrl: string | null; photo: { bytes: Uint8Array; mime: string; credit: PhotoCredit } | null }
export type ProfileResult = FoundProfile | { status: "none" | "withheld"; wikidataId: string | null };

export type FetchPhoto = (url: string) => Promise<{ bytes: Uint8Array; mime: string }>;

/** One photo download: Wikimedia's picture hosts only, Home's User-Agent, no cookie, no referrer, a size cap. Throws on anything else. */
export const wikimediaFetchPhoto: FetchPhoto = async (url) => {
  const target = new URL(url);
  if (target.protocol !== "https:" || !PHOTO_HOSTS.has(target.hostname)) throw new Error("host");
  const response = await fetch(target, { headers: { "User-Agent": HOME_USER_AGENT }, credentials: "omit", referrerPolicy: "no-referrer", redirect: "error", signal: AbortSignal.timeout(PHOTO_TIMEOUT_MS) });
  if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
  const mime = (response.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  if (!(mime in PHOTO_TYPES)) throw new Error("type");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > PHOTO_MAX_BYTES) throw new Error("size");
  return { bytes, mime };
};

/** The first two sentences of the page's lead, or null. */
export function shortBio(extract: string): string | null {
  const text = extract.replace(/\s+/g, " ").trim();
  if (!text) return null;
  const sentences = text.match(/[^.!?]+(?:[.!?]+(?=\s+[A-Z"'(]|$)|$)/g) ?? [text];
  const joined = sentences.slice(0, 2).join("").trim();
  const bounded = joined.length > BIO_MAX_CHARS ? `${joined.slice(0, BIO_MAX_CHARS).replace(/\s+\S*$/, "")}...` : joined;
  return bounded || null;
}

type WdEntity = { claims?: Record<string, unknown[]>; sitelinks?: Record<string, { title?: string }> };

export interface LookupDeps { client: MusicBrainzClient; fetchJson?: FetchJson; fetchPhoto?: FetchPhoto }

/** Looks one artist up. Throws when a service could not answer (nothing is stored then). */
export async function lookupArtistProfile(artistId: string, deps: LookupDeps): Promise<ProfileResult> {
  const fetchJson = deps.fetchJson ?? wikimediaFetchJson;
  const fetchPhoto = deps.fetchPhoto ?? wikimediaFetchPhoto;
  const qid = await deps.client.lookupArtistWikidata(artistId);
  if (!qid) return { status: "none", wikidataId: null };
  const wd = (await fetchJson(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qid}&props=claims%7Csitelinks&sitefilter=enwiki&format=json`)) as { entities?: Record<string, WdEntity & { missing?: unknown }> };
  const entity = wd.entities?.[qid];
  if (!entity || entity.missing !== undefined) return { status: "none", wikidataId: qid };
  const claims = entity.claims ?? {};
  const classes = (claims.P31 ?? []).map(entityId);
  if (classes.some((id) => id && NOT_AN_ARTIST.has(id))) return { status: "none", wikidataId: qid };
  // A person under 18, or one whose age Wikidata does not give, gets nothing (isUnder18 reads an unreadable date as a minor).
  if (classes.includes("Q5")) {
    const birth = claimText(claims.P569?.[0]);
    if (!birth || isUnder18(birth, new Date())) return { status: "withheld", wikidataId: qid };
  }
  const title = entity.sitelinks?.enwiki?.title;
  let bio: string | null = null;
  let bioUrl: string | null = null;
  if (title) {
    const page = (await fetchJson(`https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(title)}&redirects=1&prop=extracts%7Cpageprops&exintro=1&explaintext=1&exsentences=2&ppprop=disambiguation&format=json`)) as {
      query?: { pages?: Record<string, { title?: string; missing?: unknown; extract?: unknown; pageprops?: Record<string, unknown> }> };
    };
    const found = Object.values(page.query?.pages ?? {})[0];
    const isDisambiguation = !!found?.pageprops && "disambiguation" in found.pageprops;
    if (found && found.missing === undefined && !isDisambiguation && typeof found.extract === "string") {
      bio = shortBio(found.extract);
      if (bio) bioUrl = `https://en.wikipedia.org/wiki/${encodeURIComponent((found.title ?? title).replace(/ /g, "_"))}`;
    }
  }
  let photo: FoundProfile["photo"] = null;
  const image = claimText(claims.P18?.[0]);
  if (image) {
    const candidates = await wikimediaCandidates({ id: qid, label: "", description: "", human: false, wikipediaTitle: title ?? "", image }, fetchJson, { leadOnly: true });
    // Only a photo that states its licence is kept, so the page can credit it.
    const pick: WikimediaCandidate | undefined = candidates.find((c) => c.lead && c.license?.short);
    if (pick?.license) {
      const downloaded = await fetchPhoto(pick.url);
      photo = { ...downloaded, credit: { title: pick.title, page: pick.page, license: pick.license.short, ...(pick.license.url ? { license_url: pick.license.url } : {}), ...(pick.license.artist ? { author: pick.license.artist } : {}) } };
    }
  }
  if (!bio && !photo) return { status: "none", wikidataId: qid };
  return { status: "found", wikidataId: qid, bio, bioUrl, photo };
}

// ---- Storage ---------------------------------------------------------------------------------------------------------------------

function storePhoto(artistId: string, photo: NonNullable<FoundProfile["photo"]>): string {
  const dir = photoDir();
  mkdirSync(dir, { recursive: true });
  const name = `${artistId}.${PHOTO_TYPES[photo.mime]}`;
  const temp = join(dir, `${name}.tmp`);
  writeFileSync(temp, photo.bytes);
  renameSync(temp, join(dir, name));
  return name;
}

function saveProfile(artistId: string, result: ProfileResult, now: Date): void {
  const photoFile = result.status === "found" && result.photo ? storePhoto(artistId, result.photo) : null;
  const values = {
    musicbrainzArtistId: artistId,
    status: result.status,
    wikidataId: result.wikidataId,
    bio: result.status === "found" ? result.bio : null,
    bioUrl: result.status === "found" ? result.bioUrl : null,
    photoFile,
    photoMime: result.status === "found" && result.photo ? result.photo.mime : null,
    photoCredit: result.status === "found" && result.photo ? JSON.stringify(result.photo.credit) : null,
    checkedAt: now.toISOString(),
    hlc: nextHlc(),
    provenance: "music:wikimedia",
  };
  db.insert(musicArtistProfiles).values(values).onConflictDoUpdate({ target: musicArtistProfiles.musicbrainzArtistId, set: values }).run();
}

/** The id most of an artist's songs carry (one stray tag does not decide), or null. */
export function mostCommon(ids: ReadonlyArray<string | null | undefined>): string | null {
  const counts = new Map<string, number>();
  for (const id of ids) if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
}

// ---- Reading ---------------------------------------------------------------------------------------------------------------------

export interface ArtistProfileView { bio: string | null; bioUrl: string | null; photoUrl: string | null; photoCredit: PhotoCredit | null }

/** What is kept for an artist, or null (the page then shows the generated cover). Reads only the local table. */
export function artistProfileFor(artistId: string | null | undefined): ArtistProfileView | null {
  if (!artistId) return null;
  const row = db.select().from(musicArtistProfiles).where(eq(musicArtistProfiles.musicbrainzArtistId, artistId)).get();
  if (!row || row.status !== "found") return null;
  let credit: PhotoCredit | null = null;
  try { credit = row.photoCredit ? (JSON.parse(row.photoCredit) as PhotoCredit) : null; } catch { credit = null; }
  const hasPhoto = !!row.photoFile && existsSync(join(photoDir(), row.photoFile));
  return {
    bio: row.bio,
    bioUrl: row.bioUrl,
    photoUrl: hasPhoto ? `/api/media/artists/${encodeURIComponent(artistId)}/photo` : null,
    photoCredit: hasPhoto ? credit : null,
  };
}

/** The kept photo for an artist: its file and type, or null. Gating by the viewer is the route's job. */
export function artistPhotoFile(artistId: string): { path: string; mime: string } | null {
  const row = db.select().from(musicArtistProfiles).where(eq(musicArtistProfiles.musicbrainzArtistId, artistId)).get();
  if (!row || row.status !== "found" || !row.photoFile || !row.photoMime) return null;
  const path = join(photoDir(), row.photoFile);
  return existsSync(path) ? { path, mime: row.photoMime } : null;
}

/** The credit line shown under a photo and bio. */
export function creditLines(view: ArtistProfileView): string[] {
  const lines: string[] = [];
  if (view.photoCredit) lines.push(`Photo: ${[view.photoCredit.author, view.photoCredit.license].filter(Boolean).join(", ")}, via Wikimedia Commons`);
  if (view.bio) lines.push("About: Wikipedia");
  return lines;
}

// ---- The background pass ---------------------------------------------------------------------------------------------------------

export interface ProfilePassResult { considered: number; found: number; none: number; withheld: number; failed: number; ms: number }

export interface ProfilePassDeps extends Partial<LookupDeps> { now?: () => number; budget?: number }

/** One pass over matched artists that have no stored answer yet (or an old "none"). Never throws. */
export async function runArtistProfilePass(deps: ProfilePassDeps = {}): Promise<ProfilePassResult> {
  const now = deps.now ?? Date.now;
  const started = now();
  const result: ProfilePassResult = { considered: 0, found: 0, none: 0, withheld: 0, failed: 0, ms: 0 };
  try {
    // The source mode's gate counts a blocked call; an adult's value is the household's.
    if (!artistWikimediaEnabled() || wikimediaLiveBlocked("adult")) return result;
    const client = deps.client ?? sharedMusicBrainzClient();
    const ids = db.selectDistinct({ id: mediaItems.musicbrainzArtistId }).from(mediaItems)
      .where(and(eq(mediaItems.kind, "track"), isNull(mediaItems.deletedAt), isNotNull(mediaItems.musicbrainzArtistId))).all()
      .map((row) => row.id!).sort();
    const known = new Map(db.select().from(musicArtistProfiles).all().map((row) => [row.musicbrainzArtistId, row]));
    const due = ids.filter((id) => {
      const row = known.get(id);
      return !row || (row.status !== "found" && now() - Date.parse(row.checkedAt) > RECHECK_MS);
    }).slice(0, deps.budget ?? PASS_BUDGET);
    let failuresInARow = 0;
    for (const id of due) {
      if (failuresInARow >= MAX_CONSECUTIVE_FAILURES || !artistWikimediaEnabled()) break;
      result.considered++;
      try {
        const profile = await lookupArtistProfile(id, { client, ...(deps.fetchJson ? { fetchJson: deps.fetchJson } : {}), ...(deps.fetchPhoto ? { fetchPhoto: deps.fetchPhoto } : {}) });
        saveProfile(id, profile, new Date(now()));
        failuresInARow = 0;
        result[profile.status]++;
      } catch {
        result.failed++;
        failuresInARow++;
      }
    }
  } catch {
    result.failed++;
  }
  result.ms = now() - started;
  if (result.considered > 0 || result.failed > 0) {
    console.log(`[music] artist wikimedia considered=${result.considered} found=${result.found} none=${result.none} withheld=${result.withheld} failed=${result.failed} ms=${result.ms}`);
  }
  return result;
}

let passRunning: Promise<ProfilePassResult> | null = null;

/** Starts a pass in the background (one at a time). Never awaited by a scan. */
export function kickArtistProfiles(deps: ProfilePassDeps = {}): Promise<ProfilePassResult> {
  const idle = { considered: 0, found: 0, none: 0, withheld: 0, failed: 0, ms: 0 };
  if (process.env.MAIPAI_MUSICBRAINZ_NO_AUTOSTART === "1") return Promise.resolve(idle);
  if (passRunning) return passRunning;
  const run = runArtistProfilePass(deps).finally(() => { passRunning = null; });
  passRunning = run;
  return trackBackgroundWork(run);
}
