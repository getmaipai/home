// MEDIA-LIB-01: the one place a media row becomes its spec record and back. The spec objects (location, artwork,
// chapters, advisory...) are stored as JSON text; everything here goes through the generated Zod schema so a record
// that leaves the hub is always the spec shape (docs/design/media-apps-blend-2026-10-17.md, section 7).
import { MediaItem } from "@maipai/spec/gen/ts/media-item.js";
import { MediaSource } from "@maipai/spec/gen/ts/media-source.js";
import { MediaProgress } from "@maipai/spec/gen/ts/media-progress.js";
import { MediaCollection } from "@maipai/spec/gen/ts/media-collection.js";
import type { mediaItems, mediaSources, mediaProgress, mediaCollections } from "@/db/schema";

export { MediaItem, MediaSource, MediaProgress, MediaCollection };
export type MediaItemRow = typeof mediaItems.$inferSelect;
export type MediaSourceRow = typeof mediaSources.$inferSelect;
export type MediaProgressRow = typeof mediaProgress.$inferSelect;
export type MediaCollectionRow = typeof mediaCollections.$inferSelect;
export type MediaKind = MediaItem["kind"];
export type Band = MediaItem["band_ok"];

function json<T>(text: string | null, fallback: T): T {
  if (text === null || text === undefined) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

export function itemFromRow(row: MediaItemRow): MediaItem {
  const location = row.locFileId ? { file_id: row.locFileId } : row.locRootId && row.locPath !== null ? { root_id: row.locRootId, path: row.locPath } : { url: row.locUrl ?? "" };
  return MediaItem.parse({
    id: row.id, kind: row.kind, title: row.title, subtitle: row.subtitle, description: row.description, source_id: row.sourceId,
    parent_id: row.parentId, location, media_type: row.mediaType, duration_s: row.durationS, size: row.size, width: row.width, height: row.height,
    video_codec: row.videoCodec, audio_codec: row.audioCodec, playable: row.playable, artwork: json(row.artwork, null), previews: json(row.previews, null),
    chapters: json(row.chapters, []), subtitles: json(row.subtitles, []), lyrics: json(row.lyrics, null), locked_fields: json(row.lockedFields, []), series: row.series, season: row.season, episode: row.episode,
    artist: row.artist, album: row.album, album_artist: row.albumArtist, track_no: row.trackNo, disc_no: row.discNo, year: row.year, genre: row.genre,
    author: row.author, narrator: row.narrator, series_index: row.seriesIndex, locator_kind: row.locatorKind, external: json(row.external, null),
    advisory: { explicit: row.advisoryExplicit, source: row.advisorySource }, band_ok: row.bandOk, verified_by_person_id: row.verifiedByPersonId,
    added_at: row.addedAt, fingerprint: row.fingerprint, hidden: row.hidden, deleted_at: row.deletedAt, trash_until: row.trashUntil,
    created_at: row.createdAt, hlc: row.hlc, provenance: row.provenance,
  });
}

/** A record as insert values. The caller supplies the whole spec record plus the two hub-internal scan fields. */
export interface ItemExtras {
  lastSeenScan: string | null;
  missingSince: string | null;
  pages: number | null;
  probeFailedFp: string | null;
}

export function itemToRow(item: MediaItem, scan: ItemExtras = { lastSeenScan: null, missingSince: null, pages: null, probeFailedFp: null }): MediaItemRow {
  const loc = item.location as { file_id?: string; root_id?: string; path?: string; url?: string };
  return {
    id: item.id, kind: item.kind, title: item.title, subtitle: item.subtitle, description: item.description, sourceId: item.source_id, parentId: item.parent_id,
    locFileId: loc.file_id ?? null, locRootId: loc.root_id ?? null, locPath: loc.path ?? null, locUrl: loc.url ?? null,
    mediaType: item.media_type, durationS: item.duration_s, size: item.size, width: item.width, height: item.height, videoCodec: item.video_codec, audioCodec: item.audio_codec,
    playable: item.playable, artwork: item.artwork ? JSON.stringify(item.artwork) : null, previews: item.previews ? JSON.stringify(item.previews) : null,
    chapters: JSON.stringify(item.chapters), subtitles: JSON.stringify(item.subtitles), lyrics: item.lyrics ? JSON.stringify(item.lyrics) : null, lockedFields: item.locked_fields.length > 0 ? JSON.stringify(item.locked_fields) : null, series: item.series, season: item.season, episode: item.episode,
    artist: item.artist, album: item.album, albumArtist: item.album_artist, trackNo: item.track_no, discNo: item.disc_no, year: item.year, genre: item.genre,
    author: item.author, narrator: item.narrator, seriesIndex: item.series_index, locatorKind: item.locator_kind,
    external: item.external ? JSON.stringify(item.external) : null, externalId: item.external ? item.external.id : null,
    advisoryExplicit: item.advisory.explicit, advisorySource: item.advisory.source, bandOk: item.band_ok, verifiedByPersonId: item.verified_by_person_id,
    addedAt: item.added_at, fingerprint: item.fingerprint, hidden: item.hidden, lastSeenScan: scan.lastSeenScan, missingSince: scan.missingSince, pages: scan.pages, probeFailedFp: scan.probeFailedFp,
    deletedAt: item.deleted_at, trashUntil: item.trash_until, createdAt: item.created_at, hlc: item.hlc, provenance: item.provenance,
  };
}

/** The spec's defaults for a source's `auto` block; the column stores only what was changed. */
const DEFAULT_AUTO = { save: "none", keep_latest: null, remove_watched: false, max_per_check: 2, max_duration_s: null, min_duration_s: null, skip_shorts: true, cutoff_date: null, quality_max_height: null };

/** The private "Created by you" root that saves a song made at home. It is not a scanned folder: it is paused and its folder name is fixed.
 * The id is `msrc-made` plus the person's id without punctuation, because the spec's source id is `msrc-` and letters and digits only. */
export const MADE_SOURCE_PREFIX = "msrc-made";
export const LEGACY_MADE_SOURCE_PREFIX = "msrc-made-";
export const madeSourceId = (personId: string): string => `${MADE_SOURCE_PREFIX}${personId.replace(/[^a-z0-9]/gi, "").toLowerCase()}`;

export function sourceFromRow(row: MediaSourceRow): MediaSource {
  return MediaSource.parse({
    id: row.id, kind: row.kind, scope: row.scope, owner_person_id: row.ownerPersonId, label: row.label,
    root: row.kind === "root" && row.rootPath ? { mount_id: row.rootMountId, path: row.rootPath, kinds: json(row.rootKinds, []) } : null,
    feed_id: row.feedId, url: row.url, extractor: row.extractor, auto: { ...DEFAULT_AUTO, ...json<Record<string, unknown>>(row.auto, {}) }, speed: row.speed, skip_intro_s: row.skipIntroS, skip_outro_s: row.skipOutroS,
    poll_minutes: row.pollMinutes, paused: row.paused, last_checked_at: row.lastCheckedAt, last_status: row.lastStatus, failures: row.failures, backoff_until: row.backoffUntil,
    visible_to: json(row.visibleTo, "household"), archive: json(row.archive, []), deleted_at: row.deletedAt, trash_until: row.trashUntil,
    created_at: row.createdAt, hlc: row.hlc, provenance: row.provenance,
  });
}

/** Every source row that parses. A row that no longer parses is left out and logged, so one bad source never fails every shelf of every media app. */
export function sourcesFromRows(rows: readonly MediaSourceRow[]): MediaSource[] {
  const out: MediaSource[] = [];
  for (const row of rows) {
    try {
      out.push(sourceFromRow(row));
    } catch (error) {
      console.warn("[media] skipped a source that no longer parses:", row.id, error instanceof Error ? error.message.slice(0, 200) : String(error));
    }
  }
  return out;
}

export function progressFromRow(row: MediaProgressRow): MediaProgress {
  return MediaProgress.parse({
    id: row.id, person_id: row.personId, media_id: row.mediaId, position: json(row.position, { seconds: 0 }), duration_s: row.durationS, completed: row.completed,
    plays: row.plays, skips: row.skips, finishes: row.finishes, marks: json(row.marks, []), device_id: row.deviceId, updated_at: row.updatedAt, hlc: row.hlc, provenance: row.provenance,
  });
}

export function collectionFromRow(row: MediaCollectionRow): MediaCollection {
  return MediaCollection.parse({
    id: row.id, person_id: row.personId, kind: row.kind, title: row.title, items: json(row.items, []), pointer: row.pointer, shared_to: json(row.sharedTo, null),
    rules: null, deleted_at: row.deletedAt, trash_until: row.trashUntil, created_at: row.createdAt, hlc: row.hlc, provenance: row.provenance,
  });
}
