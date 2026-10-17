// MEDIA-VIDEOS-01: the shared host every media app (Videos, Shows, Music, Podcasts, Books) mounts under /api/plugins/<appId>. A media app
// is a catalog package whose pages bind to `contributes.data[]` ids; this file answers those ids from the one media record layer
// (access.ts, progress.ts, collections.ts) so no app keeps a store of its own. Rows are shaped for the kit's `media_shelf`, `billboard`
// and `player` nodes (docs/dev/media-library.md, "Media apps"). Every read goes through the person's band and each source's `visible_to`;
// a child is allowlist-only (design section 11): the household's library plus channels an adult followed for them, and no discovery rows.
import { and, desc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { mediaItems, mediaSources } from "@/db/schema";
import { loadManifestOnly } from "@/lib/plugins";
import { appIndexFloorOk, appVisibleTo } from "@/lib/apps";
import type { PersonRow } from "@/types";
import { readableItem, sourceVisibleTo } from "./access";
import { allowedBandsFor, bandAllows, mediaBandOf } from "./band";
import { addItem, removeItemFrom, resolveCollection } from "./collections";
import { itemFromRow, sourceFromRow, type MediaItem, type MediaSource } from "./model";
import { correctedStamp, getProgress, getProgressMany, percentOf, recentProgress, writeProgress } from "./progress";

export type MediaKind = MediaItem["kind"];

/** The apps this host serves, and the item kinds each one is about. One definition: the route mount, the shell and the packages read it. */
export const MEDIA_APPS = {
  videos: { kinds: ["video"] as MediaKind[], noun: "video" },
  shows: { kinds: ["episode", "film"] as MediaKind[], noun: "title" },
  music: { kinds: ["track"] as MediaKind[], noun: "song" },
  podcasts: { kinds: ["podcast_episode"] as MediaKind[], noun: "episode" },
  books: { kinds: ["book", "audiobook"] as MediaKind[], noun: "book" },
} as const;
export type MediaAppId = keyof typeof MEDIA_APPS;
export const MEDIA_APP_IDS = Object.keys(MEDIA_APPS) as MediaAppId[];
export const isMediaAppId = (id: string): id is MediaAppId => Object.prototype.hasOwnProperty.call(MEDIA_APPS, id);

/** The shelf and billboard row every data id returns (the fields the page documents name). */
/** The standing collection an app's "later" list is: Watch later for the video apps, the queue for Podcasts (and the other audio apps). */
export const laterKindOf = (appId: MediaAppId): "watch_later" | "queue" => (appId === "podcasts" || appId === "music" || appId === "books" ? "queue" : "watch_later");

export interface MediaRow {
  id: string;
  title: string;
  channel: string | null;
  summary: string;
  kind: MediaKind;
  thumbnail: string | null;
  backdrop: string | null;
  duration_s: number | null;
  /** The played share, 0 to 1; absent when nothing was played or the length is not known. */
  progress?: number;
  completed?: boolean;
  /** "Saved" (the copy is on this hub) or "Not saved" (stream only). */
  copy_label: string;
}

export interface MediaItemView extends MediaRow {
  /** Podcasts: the item is in this person's queue, and a copy is saved on the hub. */
  queued?: boolean;
  saved?: boolean;
  /** Podcasts: the show's own speed and skip seconds (media-source fields). */
  speed?: number;
  skip_intro_s?: number;
  skip_outro_s?: number;
  src: string;
  subtitle: string | null;
  description: string | null;
  poster: string | null;
  chapters: Array<{ start_s: number; title: string }>;
  captions: never[];
  position_s?: number;
  liked: boolean;
  watch_later: boolean;
  up_next?: { id: string; title: string; subtitle?: string; art?: string };
}

/** Whether `appId` is an installed, visible app for this person. A media app that is not installed falls through to the generic 404. */
export function mediaAppAllowed(person: PersonRow, appId: string): boolean {
  const loaded = loadManifestOnly(appId);
  if (!loaded.ok) return false;
  if (!loaded.value.contributes || !(loaded.value.contributes as { pages?: unknown[] }).pages?.length) return false;
  // NEWS-00 review: the person also clears the index page's floor, as on the plugin routes.
  return appVisibleTo(person, loaded.value) && appIndexFloorOk(person, appId) !== false;
}

/** A child (and a guest, read as a child) sees the household library plus channels an adult followed for them, and no discovery. */
export function allowlistOnly(person: PersonRow): boolean {
  return person.role === "guest" || mediaBandOf(person) === "child";
}

export function allowedSources(person: PersonRow): MediaSource[] {
  const live = db.select().from(mediaSources).where(isNull(mediaSources.deletedAt)).all().map(sourceFromRow).filter((source) => sourceVisibleTo(source, person));
  if (!allowlistOnly(person)) return live;
  // Allowlist: the household library roots, and any channel, feed or link an adult named this child for (an explicit `visible_to`).
  return live.filter((source) => source.kind === "root" || (Array.isArray(source.visible_to) && source.visible_to.includes(person.id)));
}

/** The person may read this item in this app (band, source, kind, allowlist). */
export function readableIn(person: PersonRow, appId: MediaAppId, id: string): MediaItem | null {
  const item = readableItem(person, id);
  if (!item || !(MEDIA_APPS[appId].kinds as readonly string[]).includes(item.kind)) return null;
  if (allowlistOnly(person) && !allowedSources(person).some((source) => source.id === item.source_id)) return null;
  return item;
}

export interface ItemFilter {
  where?: SQL;
  order?: SQL[];
  limit?: number;
  /** Only items from sources that are not a library folder (channels, feeds, links). */
  followedOnly?: boolean;
}

/** Items of the app's kinds this person may read, filtered through the band again (the floor runs for a minor), in the given order. */
export function queryItems(person: PersonRow, appId: MediaAppId, filter: ItemFilter = {}): MediaItem[] {
  let sources = allowedSources(person);
  if (filter.followedOnly) sources = sources.filter((source) => source.kind !== "root");
  if (sources.length === 0) return [];
  const conditions: SQL[] = [
    isNull(mediaItems.deletedAt), eq(mediaItems.hidden, false), inArray(mediaItems.kind, [...MEDIA_APPS[appId].kinds]),
    inArray(mediaItems.sourceId, sources.map((source) => source.id)), inArray(mediaItems.bandOk, allowedBandsFor(person)),
  ];
  if (filter.where) conditions.push(filter.where);
  const limit = filter.limit ?? 50;
  const rows = db.select().from(mediaItems).where(and(...conditions)).orderBy(...(filter.order ?? [desc(mediaItems.addedAt)])).limit(limit * 2 + 2).all();
  const items: MediaItem[] = [];
  for (const row of rows) {
    const item = itemFromRow(row);
    if (bandAllows(person, item)) items.push(item);
    if (items.length >= limit) break;
  }
  return items;
}

export function oneLine(text: string | null, max: number): string {
  const flat = (text ?? "").replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

export const artworkUrl = (item: MediaItem): string | null => (item.artwork ? `/api/media/items/${encodeURIComponent(item.id)}/artwork` : null);

/** A podcast's per-show "skip the last N seconds"; 0 for every other kind. */
function outroSecondsOf(item: MediaItem): number {
  if (item.kind !== "podcast_episode") return 0;
  return db.select({ outro: mediaSources.skipOutroS }).from(mediaSources).where(eq(mediaSources.id, item.source_id)).get()?.outro ?? 0;
}

/** The line under a title in a list: the channel for a video, "Today · The show" for a podcast episode (how Apple Podcasts says it). */
function eyebrowOf(item: MediaItem): string | null {
  if (item.kind !== "podcast_episode") return item.subtitle;
  return [whenLabel(item.external?.published_at ?? item.added_at), item.subtitle].filter(Boolean).join(" · ");
}

/** "Today", "Yesterday", "Tue", "Oct 10": how long ago, as Apple Podcasts says it. */
export function whenLabel(iso: string, now = new Date()): string {
  const day = (date: Date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const then = new Date(iso);
  const days = Math.round((day(now) - day(then)) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return then.toLocaleDateString("en-US", { weekday: "short" });
  return then.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function copyLabelOf(item: MediaItem): string {
  return (item.location as { url?: string }).url ? "Not saved" : "Saved";
}

export interface RowContext {
  progressById: Map<string, { percent: number | null; completed: boolean }>;
}

export function contextFor(person: PersonRow, items: readonly MediaItem[]): RowContext {
  const progressById = new Map<string, { percent: number | null; completed: boolean }>();
  for (const progress of getProgressMany(person.id, items.map((item) => item.id))) {
    const item = items.find((candidate) => candidate.id === progress.media_id);
    progressById.set(progress.media_id, { percent: percentOf(progress.position, progress.duration_s ?? item?.duration_s ?? null), completed: progress.completed });
  }
  return { progressById };
}

export function rowOf(item: MediaItem, context: RowContext): MediaRow {
  const seen = context.progressById.get(item.id);
  const art = artworkUrl(item);
  const row: MediaRow = {
    id: item.id, title: item.title, channel: eyebrowOf(item), summary: oneLine(item.description, 140) || item.subtitle || "", kind: item.kind, thumbnail: art, backdrop: art,
    duration_s: item.duration_s, copy_label: copyLabelOf(item),
  };
  if (seen?.completed) row.completed = true;
  else if (seen?.percent !== null && seen?.percent !== undefined && seen.percent > 0) row.progress = Math.min(1, Math.round(seen.percent) / 100);
  return row;
}

export function rowsOf(person: PersonRow, items: readonly MediaItem[]): MediaRow[] {
  const context = contextFor(person, items);
  return items.map((item) => rowOf(item, context));
}

/** Items in the order of `ids`, the ones this person may read in this app. */
export function itemsInOrder(person: PersonRow, appId: MediaAppId, ids: readonly string[], limit: number): MediaItem[] {
  const items: MediaItem[] = [];
  for (const id of ids) {
    const item = readableIn(person, appId, id);
    if (item) items.push(item);
    if (items.length >= limit) break;
  }
  return items;
}

export const collectionIds = (person: PersonRow, kind: "liked" | "watch_later" | "queue"): string[] => (resolveCollection(person.id, kind)?.items ?? []).map((entry) => entry.media_id);

// ---- the data ids ---------------------------------------------------------------------------------------------------------------

export interface DataParams {
  id?: string;
  channel?: string;
  limit?: number;
}

/** Ids whose rows are discovery: a child gets none (allowlist-only). */
export const DISCOVERY_IDS = ["featured", "new", "recent", "more-from"] as const;

/** An app's own data ids (Podcasts adds shows, episodes, queue, saved): answered after the shared ones, so a package cannot shadow them. */
export type AppDataHook = (person: PersonRow, dataId: string, params: DataParams) => unknown | null;
const appDataHooks = new Map<MediaAppId, AppDataHook>();
export function registerMediaAppData(appId: MediaAppId, hook: AppDataHook): void { appDataHooks.set(appId, hook); }

/** A hook that adds fields to an item view for its app (stream address, saved, queued, per-show skips). */
export type ItemViewHook = (person: PersonRow, item: MediaItem, view: MediaItemView) => MediaItemView;
const itemViewHooks = new Map<MediaAppId, ItemViewHook>();
export function registerItemView(appId: MediaAppId, hook: ItemViewHook): void { itemViewHooks.set(appId, hook); }

export function mediaAppData(person: PersonRow, appId: MediaAppId, dataId: string, params: DataParams): MediaRow[] | MediaItemView | MediaItemView[] | { as_of: string; rows: Array<{ id: string; label: string }> } | null {
  const limit = Math.min(Math.max(params.limit ?? 20, 1), 200);
  dataId = dataId.replace(/_/g, "-"); // manifest ids use hyphens; the underscore spelling of a page written earlier still answers
  if (allowlistOnly(person) && (DISCOVERY_IDS as readonly string[]).includes(dataId)) return [];
  switch (dataId) {
    case "featured": {
      // A billboard wants pictures: the newest items that have one, else the newest.
      const items = queryItems(person, appId, { limit: 12 });
      const pictured = items.filter((item) => item.artwork);
      return rowsOf(person, (pictured.length > 0 ? pictured : items).slice(0, 5));
    }
    case "continue": {
      const ids: string[] = [];
      for (const progress of recentProgress(person.id, 80)) if (!progress.completed && (percentOf(progress.position, progress.duration_s) ?? 1) > 0) ids.push(progress.media_id);
      const items = itemsInOrder(person, appId, ids, limit);
      return rowsOf(person, items).filter((row) => row.progress === undefined || row.progress < 1);
    }
    case "new": {
      const items = queryItems(person, appId, { followedOnly: true, limit: 40 });
      const published = (item: MediaItem) => item.external?.published_at ?? item.added_at;
      const context = contextFor(person, items);
      return items.sort((a, b) => published(b).localeCompare(published(a))).filter((item) => !context.progressById.get(item.id)?.completed).slice(0, limit).map((item) => rowOf(item, context));
    }
    case "recent":
      return rowsOf(person, queryItems(person, appId, { limit }));
    case "more-from": {
      // The channel (or folder) the person watches most, minus what they finished.
      const counts = new Map<string, number>();
      for (const progress of recentProgress(person.id, 200)) {
        const item = readableIn(person, appId, progress.media_id);
        if (item?.subtitle) counts.set(item.subtitle, (counts.get(item.subtitle) ?? 0) + 1);
      }
      const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      if (!top) return [];
      const items = queryItems(person, appId, { where: eq(mediaItems.subtitle, top), limit: 40 });
      const context = contextFor(person, items);
      return items.filter((item) => !context.progressById.get(item.id)?.completed).slice(0, limit).map((item) => rowOf(item, context));
    }
    case "liked":
      return rowsOf(person, itemsInOrder(person, appId, [...collectionIds(person, "liked")].reverse(), limit));
    case "again": {
      const ids = recentProgress(person.id, 120).filter((progress) => progress.completed).map((progress) => progress.media_id);
      return rowsOf(person, itemsInOrder(person, appId, ids, limit));
    }
    case "watch-later":
      return rowsOf(person, itemsInOrder(person, appId, collectionIds(person, "watch_later"), 200));
    case "queue":
      return rowsOf(person, itemsInOrder(person, appId, collectionIds(person, "queue"), 200));
    case "history":
      return rowsOf(person, itemsInOrder(person, appId, recentProgress(person.id, 120).map((progress) => progress.media_id), 60));
    case "library": {
      const where = params.channel ? eq(mediaItems.subtitle, params.channel) : undefined;
      const items = queryItems(person, appId, { where, limit: Math.max(limit, 100), order: [sql`lower(coalesce(${mediaItems.subtitle}, ''))`, sql`lower(${mediaItems.title})`] });
      return rowsOf(person, items);
    }
    case "channels": {
      const items = queryItems(person, appId, { limit: 500 });
      const names = [...new Set(items.map((item) => item.subtitle).filter((name): name is string => !!name))].sort((a, b) => a.localeCompare(b));
      return { as_of: new Date().toISOString(), rows: names.map((name) => ({ id: name, label: name })) };
    }
    case "up-next": {
      const item = params.id ? readableIn(person, appId, params.id) : null;
      if (!item) return [];
      return rowsOf(person, upNextItems(person, appId, item, limit));
    }
    case "item": {
      const item = params.id ? readableIn(person, appId, params.id) : null;
      return item ? itemView(person, appId, item) : [];
    }
    case "item-actions": {
      const item = params.id ? readableIn(person, appId, params.id) : null;
      if (!item) return [];
      return actionRows(person, item) as never;
    }
    default:
      return (appDataHooks.get(appId)?.(person, dataId, params) as MediaRow[] | null | undefined) ?? null;
  }
}

/** What to play after `item`: the person's watch-later queue first, then the rest of the channel in order, then the newest others. */
function upNextItems(person: PersonRow, appId: MediaAppId, item: MediaItem, limit: number): MediaItem[] {
  const out: MediaItem[] = [];
  const seen = new Set<string>([item.id]);
  const add = (candidates: readonly MediaItem[]) => {
    for (const candidate of candidates) {
      if (seen.has(candidate.id) || out.length >= limit) continue;
      seen.add(candidate.id);
      out.push(candidate);
    }
  };
  const queue = collectionIds(person, laterKindOf(appId));
  const at = queue.indexOf(item.id);
  add(itemsInOrder(person, appId, at >= 0 ? [...queue.slice(at + 1), ...queue.slice(0, at)] : queue, limit));
  if (item.subtitle) {
    const siblings = queryItems(person, appId, { where: eq(mediaItems.subtitle, item.subtitle), limit: 60, order: appId === "podcasts" ? [sql`json_extract(${mediaItems.external}, '$.published_at') DESC`] : [sql`lower(${mediaItems.title})`] });
    const here = siblings.findIndex((candidate) => candidate.id === item.id);
    add(here >= 0 ? [...siblings.slice(here + 1), ...siblings.slice(0, here)] : siblings);
  }
  add(queryItems(person, appId, { limit: limit + 1 }));
  return out;
}

function actionRows(person: PersonRow, item: MediaItem) {
  const liked = collectionIds(person, "liked").includes(item.id);
  const later = collectionIds(person, "watch_later").includes(item.id);
  return [
    { id: "like", endpoint: "like", media_id: item.id, label: "Liked videos", text: liked ? "This video is in your liked videos." : "Add this video to your liked videos.", on: liked },
    { id: "watch-later", endpoint: "watch-later", media_id: item.id, label: "Watch later", text: later ? "This video is on your watch later list." : "Save this video for later.", on: later },
  ];
}

function itemView(person: PersonRow, appId: MediaAppId, item: MediaItem): MediaItemView {
  const context = contextFor(person, [item]);
  const base = rowOf(item, context);
  const progress = getProgress(person.id, item.id);
  // A child's screen never counts down to the next video by itself (the Player's autoplay needs `up_next`).
  const queue = allowlistOnly(person) ? undefined : upNextItems(person, appId, item, 1)[0];
  const seconds = progress && "seconds" in progress.position ? progress.position.seconds : undefined;
  const direct = (item.location as { url?: string }).url;
  const view: MediaItemView = {
    // A stream-only item (a podcast episode not saved yet) plays from its own address on the person's device; the hub never relays it.
    ...base, channel: item.subtitle, src: direct ?? `/api/media/items/${encodeURIComponent(item.id)}/content`, subtitle: item.subtitle, description: item.description, poster: artworkUrl(item),
    chapters: item.chapters.map((chapter) => ({ start_s: chapter.start_s, title: chapter.title })), captions: [],
    ...(seconds !== undefined && !progress?.completed ? { position_s: seconds } : {}),
    liked: collectionIds(person, "liked").includes(item.id), watch_later: collectionIds(person, "watch_later").includes(item.id),
    ...(queue ? { up_next: { id: queue.id, title: queue.title, ...(queue.subtitle ? { subtitle: queue.subtitle } : {}), ...(artworkUrl(queue) ? { art: artworkUrl(queue)! } : {}) } } : {}),
  };
  return itemViewHooks.get(appId)?.(person, item, view) ?? view;
}

// ---- the actions ----------------------------------------------------------------------------------------------------------------

/** `call.args` placeholders arrive as strings ("12.5"); a number, a numeric string, or nothing. */
export function coerceNumber(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

export const PROGRESS_REASONS = ["interval", "pause", "seek", "unload", "ended"] as const;

export type ActionResult<T> = { ok: true; value: T } | { ok: false; status: 400 | 403 | 404 | 422; error: string };

export interface ProgressArgs {
  media_id?: unknown;
  position_s?: unknown;
  duration_s?: unknown;
  reason?: unknown;
  device_id?: unknown;
}

/** The one progress path for an app page: coerce, check the title is readable here, then `writeProgress` (mergeProgress inside). */
export function saveProgress(person: PersonRow, appId: MediaAppId, args: ProgressArgs, now = new Date()): ActionResult<{ applied: boolean; completed: boolean }> {
  const item = typeof args.media_id === "string" ? readableIn(person, appId, args.media_id) : null;
  if (!item) return { ok: false, status: 404, error: `That ${MEDIA_APPS[appId].noun} is not in the library.` };
  const position = coerceNumber(args.position_s);
  if (position === undefined || position < 0) return { ok: false, status: 400, error: "Where to save the place was missing. Play the video again." };
  const duration = coerceNumber(args.duration_s);
  let outroHit = false;
  let reason = typeof args.reason === "string" && (PROGRESS_REASONS as readonly string[]).includes(args.reason) ? args.reason : "interval";
  // A show's "skip the last N seconds" (media-source skip_outro_s): reaching that point counts as finishing the episode.
  if (reason !== "ended" && duration !== undefined && duration > 0) {
    const outro = outroSecondsOf(item);
    if (outro > 0 && position >= duration - outro) { reason = "ended"; outroHit = true; }
  }
  const device = typeof args.device_id === "string" && /^device-[a-z0-9]{6,}$/.test(args.device_id) ? args.device_id : null;
  const outcome = writeProgress(person, item, {
    position: { seconds: position }, duration_s: duration !== undefined && duration >= 0 ? duration : undefined, device_id: device,
    events: reason === "ended" ? { finish: true } : undefined, ...(outroHit ? { completed: true } : {}), stamp: correctedStamp({ serverNow: now }),
  }, { now, immediate: reason !== "interval" });
  if (!outcome.ok) {
    return outcome.refusal === "other_persons_device"
      ? { ok: false, status: 403, error: "This screen belongs to someone else, so it cannot save your place. Sign in on your own screen." }
      : { ok: false, status: 422, error: "That place could not be saved." };
  }
  // A finished title leaves the person's later list: Watch later, or the queue for a podcast (FileTube's "remove watched").
  if (outcome.progress.completed) {
    const later = resolveCollection(person.id, laterKindOf(appId));
    if (later?.items.some((entry) => entry.media_id === item.id)) removeItemFrom(later, item.id);
  }
  return { ok: true, value: { applied: outcome.positionApplied, completed: outcome.progress.completed } };
}

/** Add to or remove from the person's own liked or watch later list. `on: true` adds and `on: false` removes (both idempotent); with `on`
 * absent the title is toggled (a page button that carries only the id). */
export function setListed(person: PersonRow, appId: MediaAppId, kind: "liked" | "watch_later" | "queue", mediaId: unknown, on: unknown): ActionResult<{ on: boolean; label: "Saved" | "Not saved" | "Liked" | "Not liked" | "Queued" | "Not queued" }> {
  const item = typeof mediaId === "string" ? readableIn(person, appId, mediaId) : null;
  if (!item) return { ok: false, status: 404, error: `That ${MEDIA_APPS[appId].noun} is not in the library.` };
  const collection = resolveCollection(person.id, kind);
  if (!collection) return { ok: false, status: 404, error: "Your list is not available right now. Try again." };
  const listed = collection.items.some((entry) => entry.media_id === item.id);
  const want = on === undefined || on === null ? !listed : !(on === false || on === "false");
  if (want) addItem(collection, item.id);
  else removeItemFrom(collection, item.id);
  return { ok: true, value: { on: want, label: kind === "liked" ? (want ? "Liked" : "Not liked") : kind === "queue" ? (want ? "Queued" : "Not queued") : want ? "Saved" : "Not saved" } };
}
