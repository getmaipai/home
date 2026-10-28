// MEDIA-PODCASTS-01: the Podcasts app's half of the shared media-app host (appHost.ts). It adds the data ids the shared ones do not have
// (`shows`, `episodes`, `saved`, `bookmarks`) and the fields a podcast item view carries (saved, queued, the show's skip-intro start).
// Rows go through the same `queryItems` (band, source `visible_to`, allowlist for a child), so a child sees only child-cleared shows and
// never an explicit episode, exactly as in Videos. Registered by importing this file (routes/mediaApps.ts does).
import { eq } from "drizzle-orm";
import { mediaItems } from "@/db/schema";
import type { PersonRow } from "@/types";
import { liveSourceById } from "./access";
import { allowedSources, readableIn, artworkUrl, collectionIds, contextFor, copyLabelOf, queryItems, registerItemView, registerMediaAppData, rowOf, rowsOf, type DataParams, type MediaRow } from "./appHost";
import { getProgress, getProgressMany, recentProgress } from "./progress";
import type { MediaItem, MediaSource } from "./model";
import { draftRows, filterEpisodes, personFilters, viewOf } from "./podcastFilters";
import { podcastStatsRows } from "./podcastStats";
import { searchPodcastTranscripts } from "./podcasts";
import { podcastDirectoryRows } from "@/routes/podcastApp";

const APP = "podcasts" as const;
const publishedOf = (item: MediaItem): string => item.external?.published_at ?? item.added_at;

/** "Keeps the newest 3 · Speed 1.2x" or "Streams only": what a show does, in the person's words. */
export function showRulesLine(source: MediaSource): string {
  const parts: string[] = [];
  if (source.auto.save === "audio") parts.push(`Keeps the newest ${source.auto.keep_latest ?? 1}`);
  else parts.push("Streams only");
  if (source.speed) parts.push(`Speed ${source.speed}x`);
  if (source.skip_intro_s > 0) parts.push(`Skips first ${source.skip_intro_s} s`);
  if (source.skip_outro_s > 0) parts.push(`Skips last ${source.skip_outro_s} s`);
  return parts.join(" · ");
}

function showRows(person: PersonRow): MediaRow[] {
  const rows: MediaRow[] = [];
  for (const source of allowedSources(person).filter((candidate) => candidate.kind === "feed")) {
    const items = queryItems(person, APP, { where: eq(mediaItems.sourceId, source.id), limit: 500 });
    if (items.length === 0) continue; // a child's list has no show with nothing child-cleared in it
    const art = items.find((item) => item.artwork);
    rows.push({
      id: source.id, title: source.label, channel: items[0]!.artist ?? `${items.length} episodes`, summary: showRulesLine(source), kind: "podcast_episode",
      thumbnail: art ? artworkUrl(art) : null, backdrop: art ? artworkUrl(art) : null, duration_s: null, copy_label: "",
    });
  }
  return rows.sort((a, b) => a.title.localeCompare(b.title));
}

function episodesOf(person: PersonRow, params: DataParams, limit: number, savedOnly = false): MediaItem[] {
  const show = params.channel;
  const query = params.query?.trim().toLocaleLowerCase();
  if (query && query.length >= 2) {
    return searchPodcastTranscripts(person, query).flatMap((hit) => {
      const item = readableIn(person, APP, hit.episode_id);
      if (!item) return [];
      return [{ ...item, description: `${Math.floor(hit.start_s / 60)}:${String(hit.start_s % 60).padStart(2, "0")} · ${hit.text}` }];
    }).slice(0, limit);
  }
  const items = queryItems(person, APP, { where: show ? eq(mediaItems.subtitle, show) : undefined, limit: Math.max(limit, 200) });
  return items.filter((item) => !savedOnly || !(item.location as { url?: string }).url).sort((a, b) => publishedOf(b).localeCompare(publishedOf(a))).slice(0, limit);
}

const episodeRows = (person: PersonRow, items: readonly MediaItem[]): MediaRow[] => rowsOf(person, items);

function bookmarkRows(person: PersonRow, limit: number): MediaRow[] {
  const rows: MediaRow[] = [];
  const ids = recentProgress(person.id, 200).filter((progress) => progress.marks.length > 0).map((progress) => progress.media_id);
  for (const progress of getProgressMany(person.id, ids)) {
    const item = readableIn(person, APP, progress.media_id);
    if (!item) continue;
    const context = contextFor(person, [item]);
    for (const mark of progress.marks) {
      const base = rowOf(item, context);
      rows.push({ ...base, id: item.id, summary: `Bookmark at ${clock(mark.at_s)}${mark.label ? `: ${mark.label}` : ""}`, duration_s: null });
    }
    if (rows.length >= limit) break;
  }
  return rows.slice(0, limit);
}

// Snips share the existing person-owned progress marks. A reserved label prefix
// carries the clip length and optional note without changing the media schema.
const SNIP_PREFIX = "podcast-snip:";
export function podcastSnipLabel(lengthS: number, note: string): string {
  return `${SNIP_PREFIX}${lengthS}:${encodeURIComponent(note)}`;
}
function parsePodcastSnip(label: string | null): { length_s: number; note: string } | null {
  if (!label?.startsWith(SNIP_PREFIX)) return null;
  const match = label.slice(SNIP_PREFIX.length).match(/^(\d+):(.*)$/);
  if (!match) return null;
  try { return { length_s: Number(match[1]), note: decodeURIComponent(match[2]!) }; } catch { return null; }
}
type SnipRow = MediaRow & { start_s: number; length_s: number; note: string; snip_label: string; snip_id: string };
export function podcastSnipRowsForRoute(person: PersonRow, limit = 200): SnipRow[] {
  const rows: SnipRow[] = [];
  const ids = recentProgress(person.id, 200).map((progress) => progress.media_id);
  for (const progress of getProgressMany(person.id, ids)) {
    const item = readableIn(person, APP, progress.media_id);
    if (!item) continue;
    for (const mark of progress.marks) {
      const snip = parsePodcastSnip(mark.label);
      if (!snip) continue;
      rows.push({ ...rowOf(item, contextFor(person, [item])), id: item.id, title: item.title, summary: snip.note, duration_s: snip.length_s, start_s: mark.at_s, length_s: snip.length_s, note: snip.note, snip_label: mark.label!, snip_id: `${encodeURIComponent(item.id)}:${mark.at_s}:${encodeURIComponent(mark.label!)}` });
    }
    if (rows.length >= limit) break;
  }
  return rows.slice(0, limit);
}

const clock = (seconds: number): string => {
  const whole = Math.max(0, Math.floor(seconds));
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
};

registerMediaAppData(APP, (person, dataId, params) => {
  const limit = Math.min(Math.max(params.limit ?? 40, 1), 200);
  switch (dataId) {
    case "shows": return showRows(person);
    case "directory": return podcastDirectoryRows(person, params.query ?? "", params.scope ?? "search");
    case "episodes": {
      const rows = episodeRows(person, episodesOf(person, params, limit));
      const q = params.query?.trim();
      if (!q || q.length < 2) return rows;
      // A transcript search row carries the second its phrase starts, so selecting it seeks there.
      const starts = new Map(searchPodcastTranscripts(person, q).map((hit) => [hit.episode_id, hit.start_s]));
      return rows.map((row) => ({ ...row, start_s: starts.get(String((row as { id?: string }).id)) ?? 0 }));
    }
    case "saved": return params.scope === "snips" ? podcastSnipRowsForRoute(person, limit).map(({ start_s, snip_id, ...row }) => ({ ...row, id: snip_id, media_id: row.id, start_s })) : episodeRows(person, episodesOf(person, params, limit, true));
    case "bookmarks": return bookmarkRows(person, limit);
    // PODCAST-PORT-03: the person's own saved filters, and the episodes one of them shows now.
    case "filters": return personFilters(person).map((collection) => { const view = viewOf(person, collection); return { id: view.id, title: view.title, summary: view.summary }; });
    case "filter-options": return params.scope === "shows"
      ? { as_of: new Date().toISOString(), rows: showRows(person).map((row) => ({ id: row.id, label: row.title })) }
      : { as_of: new Date().toISOString(), rows: personFilters(person).map((collection) => ({ id: collection.id, label: collection.title })) };
    case "filter-draft": return draftRows(person, params);
    case "filter-episodes": return episodeRows(person, filterEpisodes(person, params.filter ?? "", limit));
    case "stats": return podcastStatsRows(person, params.year ?? new Date().getFullYear());
    default: return null;
  }
});

registerItemView(APP, (person, item, view) => {
  const source = liveSourceById(item.source_id);
  const saved = !(item.location as { url?: string }).url;
  const out = { ...view, saved, queued: collectionIds(person, "queue").includes(item.id), copy_label: copyLabelOf(item) };
  if (!source) return out;
  // The show's "skip the first N seconds": a first listen starts there. (A resume keeps the person's own place.)
  const progress = getProgress(person.id, item.id);
  if (out.position_s === undefined && !progress && source.skip_intro_s > 0) out.position_s = source.skip_intro_s;
  return { ...out, ...(source.speed ? { speed: source.speed } : {}), skip_intro_s: source.skip_intro_s, skip_outro_s: source.skip_outro_s };
});
