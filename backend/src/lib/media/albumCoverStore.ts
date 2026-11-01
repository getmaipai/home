// MUSIC-DATA-01: where a fetched album cover is kept and how a track finds it (the pass that fetches it is albumCovers.ts).
//
// A cover is a file in the cache data class plus a row in music_album_covers keyed by the MusicBrainz release group id. It never
// touches a track's own `artwork` (that field is the spec shape: a saved file or a path under the library folder). A track with no
// embedded or folder art reads as having artwork `{ path: "caa:<release group id>" }` (see model.ts), and serveItemArtwork streams the
// kept file. The local order is therefore: embedded art, folder art, then this cover, then the generated cover.
import { eq } from "drizzle-orm";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { db } from "@/db";
import { musicAlbumCovers } from "@/db/schema";
import { classDir } from "@/lib/paths";
import { getHouseholdSettingValue } from "@/lib/settings";

export const ALBUM_ART_KEY = "music.album_art_online";
export const COVER_PATH_PREFIX = "caa:";
export const COVER_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

export function albumArtEnabled(): boolean {
  return getHouseholdSettingValue(ALBUM_ART_KEY) !== false;
}

export function coverDir(): string {
  return join(classDir("cache"), "music-covers");
}

/** The kept cover for a release group: its file and type, or null (never kept, or the file is gone). */
export function albumCoverFile(releaseGroupId: string | null | undefined): { path: string; mime: string } | null {
  if (!releaseGroupId) return null;
  const row = db.select().from(musicAlbumCovers).where(eq(musicAlbumCovers.musicbrainzReleaseGroupId, releaseGroupId)).get();
  if (!row || row.status !== "found" || !row.file || !row.mime) return null;
  const path = join(coverDir(), row.file);
  return existsSync(path) ? { path, mime: row.mime } : null;
}

// Every track row passes through itemFromRow, so "which groups have a cover" is read once and kept briefly, not queried per row.
const MEMO_MS = 15_000;
let memo: { at: number; groups: Set<string> } | null = null;

export function forgetAlbumCovers(): void {
  memo = null;
}

/** Release group ids whose cover file is on disk right now. */
export function coveredGroups(): Set<string> {
  if (memo && Date.now() - memo.at < MEMO_MS) return memo.groups;
  const groups = new Set<string>();
  for (const row of db.select().from(musicAlbumCovers).all()) {
    if (row.status === "found" && row.file && existsSync(join(coverDir(), row.file))) groups.add(row.musicbrainzReleaseGroupId);
  }
  memo = { at: Date.now(), groups };
  return groups;
}
