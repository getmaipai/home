// MEDIA-LIB-01 (design section 8): turns the files of one folder into drafts of media items. Pure of the database: the scan
// orchestrator (scan.ts) walks, calls this, and persists. One parser per kind (parsers/); the root's declared kinds decide what a
// file may become, so a music root never turns a `S01E01` clip into an episode.
import { basename } from "node:path";
import { classOfExtension, mediaTypeOfExtension, audioPlayableByExtension } from "./kinds";
import type { MediaKind } from "./model";
import { readAudioTags, readSidecarLyrics, type AudioTags } from "./parsers/audioTags";
import { readEpubMeta } from "./parsers/epub";
import { filmNameHasYear, parseFilmName, readNfoFor } from "./parsers/film";
import { readPdfMeta } from "./parsers/pdf";
import { extensionOf, naturalCompare, spaced, stripExtension } from "./parsers/text";
import { findFolderArt, parseTvName } from "./parsers/tv";
import type { RootKind } from "./sources";

export interface FileEntry {
  name: string;
  rel: string;
  abs: string;
  size: number;
  mtimeMs: number;
}

export interface DirListing {
  rel: string;
  abs: string;
  files: FileEntry[];
}

export interface Draft {
  kind: MediaKind;
  title: string;
  subtitle: string | null;
  description: string | null;
  rel: string;
  mediaType: string;
  size: number | null;
  durationS: number | null;
  width: number | null;
  height: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  playable: "original" | "transcode" | "none" | "unknown";
  artworkPath: string | null;
  chapters: Array<{ start_s: number; title: string; source: "embedded" | "files" | "manual" | "description" }>;
  series: string | null;
  season: number | null;
  episode: number | null;
  artist: string | null;
  album: string | null;
  albumArtist: string | null;
  trackNo: number | null;
  discNo: number | null;
  year: number | null;
  genre: string | null;
  author: string | null;
  narrator: string | null;
  seriesIndex: number | null;
  locatorKind: "cfi" | "page" | "none";
  explicit: boolean;
  lyrics: { source: "file" | "sidecar"; text: string; timed?: { t: number; line: string; section?: string | null }[] } | null;
  pages: number | null;
  fingerprint: string;
  children: Draft[];
}

export interface IngestContext {
  kinds: ReadonlySet<RootKind>;
  /** The names (not paths) of the files in a folder of the root, by its path under the root ("" for the root itself). */
  namesIn(relDir: string): readonly string[];
}

export function fingerprintOf(file: Pick<FileEntry, "size" | "mtimeMs">): string {
  return `${file.size}-${Math.round(file.mtimeMs)}`;
}

function blank(kind: MediaKind, title: string, rel: string, file: FileEntry | null): Draft {
  const ext = extensionOf(rel);
  return {
    kind, title, subtitle: null, description: null, rel, mediaType: mediaTypeOfExtension(ext), size: file?.size ?? null, durationS: null, width: null, height: null,
    videoCodec: null, audioCodec: null, playable: "unknown", artworkPath: null, chapters: [], series: null, season: null, episode: null, artist: null, album: null,
    albumArtist: null, trackNo: null, discNo: null, year: null, genre: null, author: null, narrator: null, seriesIndex: null, locatorKind: "none", explicit: false,
    pages: null, fingerprint: file ? fingerprintOf(file) : "", lyrics: null, children: [],
  };
}

function relOf(dirRel: string, name: string): string {
  return dirRel ? `${dirRel}/${name}` : name;
}

function sidecarArt(names: readonly string[], base: string): string | null {
  const lower = new Map(names.map((name) => [name.toLowerCase(), name]));
  for (const suffix of ["", "-poster", "-thumb", "-cover", "-folder"]) {
    for (const ext of ["jpg", "jpeg", "png", "webp"]) {
      const hit = lower.get(`${base}${suffix}.${ext}`.toLowerCase());
      if (hit) return hit;
    }
  }
  return null;
}

const SPOKEN_GENRE = /audiobook|spoken|speech/i;
export const isSpokenGenre = (genre: string | null): boolean => genre !== null && SPOKEN_GENRE.test(genre);

function leadingNumber(name: string): number | null {
  const match = /^\s*(?:disc\s*\d+\s*[-_. ]\s*)?(\d{1,4})(?=\D|$)/i.exec(name);
  return match ? Number(match[1]) : null;
}

function nameWithoutNumber(name: string): string {
  return spaced(stripExtension(name).replace(/^\s*(?:disc\s*\d+\s*[-_. ]\s*)?\d{1,4}\s*[-_. ]*\s*/i, "")) || spaced(stripExtension(name));
}

/** Folders above a book, from the root: `Author/Series/Book` gives series = the folder above the book, `Author/Book` only an author. */
export function bookPathHints(dirs: readonly string[]): { author: string | null; series: string | null } {
  if (dirs.length >= 2) return { author: spaced(dirs[dirs.length - 2]!), series: spaced(dirs[dirs.length - 1]!) };
  if (dirs.length === 1) return { author: spaced(dirs[0]!), series: null };
  return { author: null, series: null };
}

function folderArtIn(ctx: IngestContext, relDir: string): string | null {
  const names = ctx.namesIn(relDir);
  const hit = findFolderArt(names);
  return hit ? relOf(relDir, hit) : null;
}

function singleVideoIn(ctx: IngestContext, relDir: string): boolean {
  return ctx.namesIn(relDir).filter((name) => classOfExtension(extensionOf(name)) === "video").length === 1;
}

function videoDraft(file: FileEntry, relDir: string, ctx: IngestContext): Draft | null {
  const { kinds } = ctx;
  const tv = kinds.has("episode") ? parseTvName(file.rel) : null;
  const base = stripExtension(file.name);
  let draft: Draft;
  if (tv) {
    draft = blank("episode", tv.title, file.rel, file);
    draft.series = tv.series;
    draft.season = tv.season;
    draft.episode = tv.episode;
    draft.subtitle = tv.series;
    // The season folder's art, else the show folder's (poster.jpg).
    const dirs = relDir ? relDir.split("/") : [];
    draft.artworkPath = folderArtIn(ctx, relDir) ?? (dirs.length >= 2 ? folderArtIn(ctx, dirs.slice(0, -1).join("/")) : null) ?? sidecarArt(ctx.namesIn(relDir), base) ?? null;
    if (draft.artworkPath && !draft.artworkPath.includes("/") && relDir) draft.artworkPath = relOf(relDir, draft.artworkPath);
  } else if (kinds.has("film") && (!kinds.has("video") || filmNameHasYear(file.rel))) {
    const film = parseFilmName(file.rel);
    draft = blank("film", film.title, file.rel, file);
    draft.year = film.year;
    const nfo = readNfoFor(file.abs);
    if (nfo) {
      if (nfo.title) draft.title = nfo.title;
      if (nfo.year) draft.year = nfo.year;
      draft.description = nfo.plot;
      draft.genre = nfo.genre;
      draft.durationS = nfo.runtimeS; // a hint until the file is probed
    }
    const side = sidecarArt(ctx.namesIn(relDir), base);
    draft.artworkPath = side ? relOf(relDir, side) : singleVideoIn(ctx, relDir) ? folderArtIn(ctx, relDir) : null;
  } else if (kinds.has("video")) {
    draft = blank("video", spaced(base.replace(/\s*\[[\w-]{6,}\]\s*$/, "")), file.rel, file);
    const channel = relDir ? basename(relDir) : "";
    draft.subtitle = channel ? spaced(channel) : null;
    const side = sidecarArt(ctx.namesIn(relDir), base);
    draft.artworkPath = side ? relOf(relDir, side) : null;
  } else {
    return null;
  }
  // Stream facts need the Stack's probe; until it answers the file is playable "unknown".
  draft.playable = "unknown";
  return draft;
}

function trackDraft(file: FileEntry, relDir: string, tags: AudioTags | null, ctx: IngestContext): Draft {
  const draft = blank("track", tags?.title ?? nameWithoutNumber(file.name), file.rel, file);
  const ext = extensionOf(file.name);
  draft.playable = audioPlayableByExtension(ext);
  if (tags) {
    if (tags.lyrics) draft.lyrics = { source: "file", ...tags.lyrics };
    draft.artist = tags.artist;
    draft.album = tags.album;
    draft.albumArtist = tags.albumArtist;
    draft.discNo = tags.discNo;
    draft.year = tags.year;
    draft.genre = tags.genre;
    draft.durationS = tags.durationS;
    draft.audioCodec = tags.codec;
    draft.explicit = tags.explicit;
  }
  draft.trackNo = tags?.trackNo ?? leadingNumber(file.name);
  draft.subtitle = draft.artist ?? draft.albumArtist;
  draft.artworkPath = folderArtIn(ctx, relDir) ?? (tags?.hasEmbeddedArt ? file.rel : null);
  return draft;
}

function chaptersFrom(tags: AudioTags | null): Draft["chapters"] {
  return (tags?.chapters ?? []).map((chapter) => ({ start_s: chapter.start_s, title: chapter.title, source: "embedded" as const }));
}

function singleAudiobookDraft(file: FileEntry, relDir: string, tags: AudioTags | null, ctx: IngestContext): Draft {
  const hints = bookPathHints(relDir ? relDir.split("/") : []);
  const draft = blank("audiobook", tags?.album ?? tags?.title ?? spaced(stripExtension(file.name)), file.rel, file);
  draft.playable = audioPlayableByExtension(extensionOf(file.name));
  draft.author = tags?.albumArtist ?? tags?.artist ?? hints.author;
  draft.narrator = tags?.composer ?? null;
  draft.series = tags?.grouping ?? hints.series;
  draft.genre = tags?.genre ?? null;
  draft.year = tags?.year ?? null;
  draft.durationS = tags?.durationS ?? null;
  draft.audioCodec = tags?.codec ?? null;
  draft.explicit = tags?.explicit ?? false;
  draft.chapters = chaptersFrom(tags);
  draft.subtitle = draft.author;
  draft.artworkPath = folderArtIn(ctx, relDir) ?? (tags?.hasEmbeddedArt ? file.rel : null);
  return draft;
}

export interface BuiltDraft {
  /** One draft per new or changed file, or a folder audiobook (a draft with `children`). */
  drafts: Draft[];
  /** Paths whose item is unchanged (the fast path: same size and modified time), so nothing was parsed. */
  touched: string[];
  skipped: number;
}

async function mapLimit<T, R>(items: readonly T[], limit: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      out[index] = await run(items[index]!);
    }
  });
  await Promise.all(workers);
  return out;
}

/** Which audio files of a folder form one audiobook, per the root's kinds (design section 8): in a root that holds audiobooks and no
 * tracks every audio file is part of the folder's book; in a root that holds both, a folder is a book when its first file is tagged as
 * spoken word; otherwise they are tracks. */
function folderIsBook(audioFiles: readonly FileEntry[], firstTags: AudioTags | null, ctx: IngestContext): boolean {
  if (!ctx.kinds.has("audiobook") || audioFiles.length < 2) return false;
  if (!ctx.kinds.has("track")) return true;
  return isSpokenGenre(firstTags?.genre ?? null);
}

/** `isUnchanged(path, fingerprint)` is the unchanged-path fast path: true when the stored item for that path has this fingerprint. */
export async function draftsForDirectory(listing: DirListing, ctx: IngestContext, isUnchanged: (rel: string, fingerprint: string) => boolean): Promise<BuiltDraft> {
  const drafts: Draft[] = [];
  const touched: string[] = [];
  let skipped = 0;
  const audioFiles = listing.files.filter((file) => classOfExtension(extensionOf(file.name)) === "audio").sort((a, b) => naturalCompare(a.name, b.name));
  let bookFiles: readonly FileEntry[] = [];
  if (audioFiles.length >= 2 && ctx.kinds.has("audiobook")) {
    const firstTags = ctx.kinds.has("track") ? await readAudioTags(audioFiles[0]!.abs) : null;
    if (folderIsBook(audioFiles, firstTags, ctx)) bookFiles = audioFiles;
  }
  const inBook = new Set(bookFiles.map((file) => file.rel));
  if (bookFiles.length > 0) {
    const bookRel = listing.rel || ".";
    if (isUnchanged(bookRel, folderFingerprint(bookFiles))) touched.push(bookRel, ...bookFiles.map((file) => file.rel));
    else drafts.push(await folderBookDraft(listing, bookFiles, ctx));
  }
  const todo: FileEntry[] = [];
  for (const file of listing.files) {
    if (inBook.has(file.rel)) continue;
    if (isUnchanged(file.rel, fingerprintOf(file))) touched.push(file.rel);
    else todo.push(file);
  }
  const built = await mapLimit(todo, 4, async (file): Promise<Draft | null> => {
    const ext = extensionOf(file.name);
    const cls = classOfExtension(ext);
    if (cls === "video") return videoDraft(file, listing.rel, ctx);
    if (cls === "audio") {
      const tags = await readAudioTags(file.abs);
      const sidecarLyrics = tags?.lyrics?.timed?.length ? null : await readSidecarLyrics(file.abs);
      const wantsBook = ctx.kinds.has("audiobook") && (ext === "m4b" || (tags?.chapters.length ?? 0) >= 2 || isSpokenGenre(tags?.genre ?? null) || !ctx.kinds.has("track"));
      if (wantsBook) {
        const draft = singleAudiobookDraft(file, listing.rel, tags, ctx);
        draft.lyrics = sidecarLyrics ? { source: "sidecar", ...sidecarLyrics } : tags?.lyrics ? { source: "file", ...tags.lyrics } : null;
        return draft;
      }
      if (ctx.kinds.has("track")) {
        const draft = trackDraft(file, listing.rel, tags, ctx);
        draft.lyrics = sidecarLyrics ? { source: "sidecar", ...sidecarLyrics } : tags?.lyrics ? { source: "file", ...tags.lyrics } : null;
        return draft;
      }
      return null;
    }
    if (cls === "book" && ctx.kinds.has("book")) return bookDraftFor(file, listing.rel, ctx);
    return null;
  });
  built.forEach((draft, index) => {
    if (draft) drafts.push(draft);
    else if (classOfExtension(extensionOf(todo[index]!.name)) !== "image" && classOfExtension(extensionOf(todo[index]!.name)) !== "other") skipped++;
  });
  return { drafts, touched, skipped };
}

async function bookDraftFor(file: FileEntry, relDir: string, ctx: IngestContext): Promise<Draft> {
  const ext = extensionOf(file.name);
  const hints = bookPathHints(relDir ? relDir.split("/") : []);
  const draft = blank("book", spaced(stripExtension(file.name)), file.rel, file);
  draft.playable = "original";
  if (ext === "epub") {
    const meta = await readEpubMeta(file.abs);
    draft.locatorKind = "cfi";
    if (meta) {
      draft.title = meta.title ?? draft.title;
      draft.author = meta.author;
      draft.description = meta.description;
      draft.year = meta.year;
      draft.series = meta.series;
      draft.seriesIndex = meta.seriesIndex;
      draft.artworkPath = meta.coverEntry ? file.rel : null;
    }
  } else {
    const meta = readPdfMeta(file.abs);
    draft.locatorKind = "page";
    if (meta) {
      draft.title = meta.title ?? draft.title;
      draft.author = meta.author;
      draft.pages = meta.pages;
    }
  }
  draft.author = draft.author ?? hints.author;
  draft.series = draft.series ?? hints.series;
  draft.subtitle = draft.author;
  if (!draft.artworkPath) draft.artworkPath = folderArtIn(ctx, relDir);
  return draft;
}

async function folderBookDraft(listing: DirListing, files: readonly FileEntry[], ctx: IngestContext): Promise<Draft> {
  const tagsList = await mapLimit(files, 4, (file) => readAudioTags(file.abs));
  const first = tagsList[0] ?? null;
  const dirName = listing.rel ? basename(listing.rel) : basename(listing.abs);
  const dirs = listing.rel ? listing.rel.split("/").slice(0, -1) : [];
  const hints = bookPathHints(dirs);
  // The book is the folder; it is addressed by the folder's path under the root ("." for the root folder itself).
  const draft = blank("audiobook", first?.album ?? spaced(dirName), listing.rel || ".", null);
  draft.mediaType = mediaTypeOfExtension(extensionOf(files[0]!.name));
  draft.author = first?.albumArtist ?? first?.artist ?? hints.author;
  draft.narrator = first?.composer ?? null;
  draft.series = first?.grouping ?? hints.series;
  draft.genre = first?.genre ?? null;
  draft.year = first?.year ?? null;
  draft.explicit = tagsList.some((tags) => tags?.explicit);
  draft.subtitle = draft.author;
  draft.artworkPath = folderArtIn(ctx, listing.rel) ?? (first?.hasEmbeddedArt ? files[0]!.rel : null);
  let elapsed = 0;
  let total = 0;
  let playable: Draft["playable"] = "original";
  files.forEach((file, index) => {
    const tags = tagsList[index] ?? null;
    const child = blank("chapter", tags?.title ?? nameWithoutNumber(file.name), file.rel, file);
    child.trackNo = index + 1;
    child.durationS = tags?.durationS ?? null;
    child.audioCodec = tags?.codec ?? null;
    child.playable = audioPlayableByExtension(extensionOf(file.name));
    child.album = draft.title;
    child.explicit = tags?.explicit ?? false;
    child.artist = tags?.artist ?? null;
    if (child.playable !== "original") playable = "unknown";
    draft.chapters.push({ start_s: elapsed, title: child.title, source: "files" });
    elapsed += child.durationS ?? 0;
    total += file.size;
    draft.children.push(child);
  });
  draft.durationS = elapsed > 0 ? elapsed : null;
  draft.size = total;
  draft.playable = playable;
  draft.fingerprint = folderFingerprint(files);
  return draft;
}

export function folderFingerprint(files: readonly Pick<FileEntry, "rel" | "size" | "mtimeMs">[]): string {
  const hasher = new Bun.CryptoHasher("sha1");
  for (const file of [...files].sort((a, b) => naturalCompare(a.rel, b.rel))) hasher.update(`${file.rel}:${file.size}:${Math.round(file.mtimeMs)}\n`);
  return `dir-${hasher.digest("hex").slice(0, 20)}`;
}
