// MUSIC-DATA-01: an album cover from the Cover Art Archive for an album with no embedded or folder art
// (docs/design/music-listen-build-2026-11-01.md, data table).
//
// For a release group id the MusicBrainz matcher (MUSIC-MB-01) or a tagger gave a track, one request asks coverartarchive.org for the
// group's front cover. Only that public id is sent: nothing about the household, no title, no name. The image is kept on this computer
// (a file in the cache data class plus a row), so showing an album makes no request. Off or offline, albums show embedded art, folder
// art, or the generated cover, as before. Art that is embedded, in the folder, or set by a person is never replaced: only a track whose
// own `artwork` is empty is looked up, and the cover is never written to the track (albumCoverStore.ts).
//
// Rule 6: a failed, slow or offline request never fails anything (counted, tried again at the next pass). A missing file (the cache was
// cleared) is fetched again. Rule 6a: logs carry counts and timings only, never an id or a title.
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { db } from "@/db";
import { mediaItems, musicAlbumCovers } from "@/db/schema";
import { trackBackgroundWork } from "@/lib/backgroundWork";
import { nextHlc } from "@/lib/hlc";
import { HOME_USER_AGENT } from "@/lib/outbound";
import { albumArtEnabled, COVER_TYPES, coverDir, forgetAlbumCovers } from "./albumCoverStore";

/** A release group with no cover is asked about again after this long (the archive gains covers). */
const RECHECK_MS = 90 * 24 * 60 * 60 * 1000;
const PASS_BUDGET = 40;
const MAX_CONSECUTIVE_FAILURES = 3;
const GAP_MS = 1000;
const COVER_TIMEOUT_MS = 10_000;
const COVER_MAX_BYTES = 4 * 1024 * 1024;
const MAX_HOPS = 4;
const RELEASE_GROUP = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const hostAllowed = (host: string): boolean => host === "coverartarchive.org" || host === "archive.org" || host.endsWith(".archive.org");

/** One cover: the bytes, or null when the archive has no front cover for the group. Throws when it could not answer. */
export type FetchCover = (releaseGroupId: string) => Promise<{ bytes: Uint8Array; mime: string } | null>;

/** The front cover (500 px) of a release group. coverartarchive.org answers with a redirect to archive.org; each hop is checked
 * against the two hosts, over https, with Home's User-Agent, no cookie, no referrer and a size cap. */
export const coverArtArchiveFetch: FetchCover = async (releaseGroupId) => {
  if (!RELEASE_GROUP.test(releaseGroupId)) throw new Error("id");
  let target = new URL(`https://coverartarchive.org/release-group/${releaseGroupId}/front-500`);
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    if (target.protocol !== "https:" || !hostAllowed(target.hostname)) throw new Error("host");
    const response = await fetch(target, { headers: { "User-Agent": HOME_USER_AGENT, Accept: "image/*" }, credentials: "omit", referrerPolicy: "no-referrer", redirect: "manual", signal: AbortSignal.timeout(COVER_TIMEOUT_MS) });
    if (response.status >= 300 && response.status < 400) {
      const next = response.headers.get("location");
      if (!next) throw new Error("redirect");
      target = new URL(next, target);
      continue;
    }
    if (response.status === 404) return null;
    if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
    const mime = (response.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    if (!(mime in COVER_TYPES)) throw new Error("type");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > COVER_MAX_BYTES) throw new Error("size");
    return { bytes, mime };
  }
  throw new Error("redirects");
};

function saveCover(releaseGroupId: string, cover: { bytes: Uint8Array; mime: string } | null, now: Date): void {
  let file: string | null = null;
  if (cover) {
    const dir = coverDir();
    mkdirSync(dir, { recursive: true });
    file = `${releaseGroupId}.${COVER_TYPES[cover.mime]}`;
    const temp = join(dir, `${file}.tmp`);
    writeFileSync(temp, cover.bytes);
    renameSync(temp, join(dir, file));
  }
  const values = {
    musicbrainzReleaseGroupId: releaseGroupId,
    status: cover ? "found" : "none",
    file,
    mime: cover ? cover.mime : null,
    checkedAt: now.toISOString(),
    hlc: nextHlc(),
    provenance: "music:coverartarchive",
  };
  db.insert(musicAlbumCovers).values(values).onConflictDoUpdate({ target: musicAlbumCovers.musicbrainzReleaseGroupId, set: values }).run();
  forgetAlbumCovers();
}

export interface CoverPassResult { considered: number; found: number; none: number; failed: number; ms: number }
export interface CoverPassDeps { fetchCover?: FetchCover; now?: () => number; budget?: number; gapMs?: number }

/** One pass over release groups that have a track with no art of its own and no usable answer yet (or an old "none", or a missing
 * file). Never throws. */
export async function runAlbumCoverPass(deps: CoverPassDeps = {}): Promise<CoverPassResult> {
  const now = deps.now ?? Date.now;
  const started = now();
  const result: CoverPassResult = { considered: 0, found: 0, none: 0, failed: 0, ms: 0 };
  try {
    if (!albumArtEnabled()) return result;
    const fetchCover = deps.fetchCover ?? coverArtArchiveFetch;
    const groups = db.selectDistinct({ id: mediaItems.musicbrainzReleaseGroupId }).from(mediaItems)
      .where(and(eq(mediaItems.kind, "track"), isNull(mediaItems.deletedAt), isNull(mediaItems.artwork), isNotNull(mediaItems.musicbrainzReleaseGroupId))).all()
      .map((row) => row.id!).sort();
    const known = new Map(db.select().from(musicAlbumCovers).all().map((row) => [row.musicbrainzReleaseGroupId, row]));
    const due = groups.filter((id) => {
      const row = known.get(id);
      if (!row) return true;
      if (row.status === "found") return !row.file || !existsSync(join(coverDir(), row.file)); // the cache was cleared: fetch it again
      return now() - Date.parse(row.checkedAt) > RECHECK_MS;
    }).slice(0, deps.budget ?? PASS_BUDGET);
    let failuresInARow = 0;
    for (const id of due) {
      if (failuresInARow >= MAX_CONSECUTIVE_FAILURES || !albumArtEnabled()) break;
      if (result.considered > 0 && (deps.gapMs ?? GAP_MS) > 0) await new Promise((resolve) => setTimeout(resolve, deps.gapMs ?? GAP_MS));
      result.considered++;
      try {
        const cover = await fetchCover(id);
        saveCover(id, cover, new Date(now()));
        failuresInARow = 0;
        result[cover ? "found" : "none"]++;
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
    console.log(`[music] album art considered=${result.considered} found=${result.found} none=${result.none} failed=${result.failed} ms=${result.ms}`);
  }
  return result;
}

let passRunning: Promise<CoverPassResult> | null = null;

/** Starts a pass in the background (one at a time). Never awaited by a scan. */
export function kickAlbumCovers(deps: CoverPassDeps = {}): Promise<CoverPassResult> {
  const idle = { considered: 0, found: 0, none: 0, failed: 0, ms: 0 };
  if (process.env.MAIPAI_MUSICBRAINZ_NO_AUTOSTART === "1") return Promise.resolve(idle);
  if (passRunning) return passRunning;
  const run = runAlbumCoverPass(deps).finally(() => { passRunning = null; });
  passRunning = run;
  return trackBackgroundWork(run);
}
