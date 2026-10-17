// MEDIA-LIB-01: audio tags through `music-metadata` (ID3, MP4/iTunes, Vorbis, FLAC, APE...), including the iTunes advisory flag
// and whether the file carries embedded art. Stream facts a tag reader knows (duration, codec, chapters) come with it, so a
// track needs no Stack probe.
import { parseFile } from "music-metadata";
import type { IAudioMetadata, ITag } from "music-metadata";

export interface AudioChapter {
  start_s: number;
  title: string;
}

export interface AudioTags {
  title: string | null;
  artist: string | null;
  album: string | null;
  albumArtist: string | null;
  composer: string | null;
  grouping: string | null;
  trackNo: number | null;
  discNo: number | null;
  year: number | null;
  genre: string | null;
  durationS: number | null;
  codec: string | null;
  container: string | null;
  explicit: boolean;
  hasEmbeddedArt: boolean;
  chapters: AudioChapter[];
}

function advisoryValue(value: unknown): boolean {
  if (typeof value === "number") return value === 1 || value === 4;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.trim() === "1" || value.trim() === "4" || /^explicit$/i.test(value.trim());
  return false;
}

/** The iTunes advisory in any tag format: the MP4 `rtng` atom (1 and 4 mean explicit, 2 means clean), an ID3 `TXXX:ITUNESADVISORY` text
 * frame, or a Vorbis/FLAC `ITUNESADVISORY` comment. */
export function explicitFromNative(native: Record<string, ITag[]>): boolean {
  for (const tags of Object.values(native)) {
    for (const tag of tags) {
      const id = tag.id.toLowerCase();
      if ((id === "rtng" || id.endsWith("itunesadvisory")) && advisoryValue(tag.value)) return true;
    }
  }
  return false;
}

function text(value: string | undefined | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function tagsFromMetadata(meta: IAudioMetadata): AudioTags {
  const { common, format } = meta;
  const chapters = (format.chapters ?? [])
    .map((chapter, index) => ({ start_s: chapter.start / (chapter.timeScale || 1000), title: text(chapter.title) ?? `Chapter ${index + 1}` }))
    .filter((chapter) => Number.isFinite(chapter.start_s) && chapter.start_s >= 0)
    .sort((a, b) => a.start_s - b.start_s);
  return {
    title: text(common.title),
    artist: text(common.artist) ?? text(common.artists?.[0]),
    album: text(common.album),
    albumArtist: text(common.albumartist),
    composer: text(common.composer?.[0]),
    grouping: text(common.grouping) ?? text(common.movement),
    trackNo: common.track?.no ?? null,
    discNo: common.disk?.no ?? null,
    year: common.year ?? null,
    genre: text(common.genre?.[0]),
    durationS: typeof format.duration === "number" && Number.isFinite(format.duration) ? format.duration : null,
    codec: text(format.codec),
    container: text(format.container),
    explicit: explicitFromNative(meta.native),
    hasEmbeddedArt: (common.picture?.length ?? 0) > 0,
    chapters,
  };
}

/** Tags of an audio file, or null when the file is not readable audio (the item is then made from its name). */
export async function readAudioTags(absPath: string): Promise<AudioTags | null> {
  try {
    const meta = await parseFile(absPath, { duration: true, includeChapters: true });
    // A file the reader could not recognise parses to nothing at all: it is not audio.
    if (!meta.format.container && !meta.format.codec && meta.format.duration === undefined) return null;
    return tagsFromMetadata(meta);
  } catch {
    return null;
  }
}

/** The embedded front cover of an audio file, or null. */
export async function readEmbeddedCover(absPath: string): Promise<{ data: Uint8Array; mediaType: string } | null> {
  try {
    const meta = await parseFile(absPath, { duration: false });
    const pictures = meta.common.picture ?? [];
    const front = pictures.find((picture) => /front/i.test(picture.type ?? "")) ?? pictures[0];
    return front ? { data: front.data, mediaType: front.format || "image/jpeg" } : null;
  } catch {
    return null;
  }
}
