// MEDIA-LIB-01: TV names. `Show/Season N/Show SxxEyy - Title.ext` is the layout the Shows app expects; a file straight in the
// show folder, a dotted release name and the `1x02` form also parse. Returns null for a file that is not an episode.
import { extensionOf, spaced, stripExtension } from "./text";

export interface TvName {
  series: string;
  season: number;
  episode: number;
  title: string;
}

/** From the first release marker on (resolution, source, codec) is not part of a title. */
const RELEASE_TAGS = /[\s._[(-]+(?:\d{3,4}p|web[-.\s]?dl|webrip|blu-?ray|brrip|hdtv|x26[45]|h[.\s]?26[45]|hevc|dvdrip|proper|repack)\b.*$/i;

const SEASON_FOLDER = /^(?:season|series|staffel|saison|s)[\s._-]*(\d{1,3})$/i;
const SPECIALS_FOLDER = /^specials?$/i;
const EPISODE = /^(.*?)[\s._-]*(?:[Ss](\d{1,3})[\s._-]*[Ee](\d{1,4})|(\d{1,2})x(\d{2,3}))(?:[\s._-]*(?:[Ee]|-)\d{1,4})*[\s._-]*(.*)$/;

export function seasonFolderNumber(folder: string): number | null {
  if (SPECIALS_FOLDER.test(folder)) return 0;
  const match = SEASON_FOLDER.exec(folder.trim());
  return match ? Number(match[1]) : null;
}

/** `rel` is the path under the root, forward slashes. */
export function parseTvName(rel: string): TvName | null {
  const parts = rel.split("/");
  const file = stripExtension(parts[parts.length - 1] ?? "");
  const match = EPISODE.exec(file);
  if (!match) return null;
  const season = match[2] !== undefined ? Number(match[2]) : Number(match[4]);
  const episode = match[3] !== undefined ? Number(match[3]) : Number(match[5]);
  if (!Number.isFinite(season) || !Number.isFinite(episode)) return null;
  const dirs = parts.slice(0, -1);
  const last = dirs[dirs.length - 1];
  // The show folder is the one above a Season folder, else the file's own folder; the file name's prefix is the fallback.
  let folderShow: string | null = null;
  if (last !== undefined && seasonFolderNumber(last) !== null) folderShow = dirs.length >= 2 ? dirs[dirs.length - 2]! : null;
  else if (last !== undefined) folderShow = last;
  const series = spaced(folderShow ?? match[1] ?? "");
  if (!series) return null;
  const rest = ` ${match[6] ?? ""}`.replace(RELEASE_TAGS, "").replace(/^[\s._-]+/, "");
  const title = spaced(rest) || `Episode ${episode}`;
  return { series, season, episode, title };
}

const POSTER_NAMES = ["poster", "folder", "cover", "front", "albumart", "show", "thumb"];
const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp"];

/** The first of poster/folder/cover/show/thumb with an image extension among a folder's file names, or null. */
export function findFolderArt(names: readonly string[]): string | null {
  const byLower = new Map(names.map((name) => [name.toLowerCase(), name]));
  for (const base of POSTER_NAMES) {
    for (const ext of IMAGE_EXTENSIONS) {
      const hit = byLower.get(`${base}.${ext}`);
      if (hit) return hit;
    }
  }
  return null;
}
