// MEDIA-VIDEOS-01: the shared host every media app (Videos, Shows, Music, Podcasts, Books) mounts under /api/plugins/<appId>. A media app
// is a catalog package whose pages bind to `contributes.data[]` ids; this file answers those ids from the one media record layer
// (access.ts, progress.ts, collections.ts) so no app keeps a store of its own. Rows are shaped for the kit's `media_shelf`, `billboard`
// and `player` nodes (docs/dev/media-library.md, "Media apps"). Every read goes through the person's band and each source's `visible_to`;
// a child is allowlist-only (design section 11): the household's library plus channels an adult followed for them, and no discovery rows.
import { and, desc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { attachments, mediaItems, mediaSources, people, videoJobs } from "@/db/schema";
import { loadManifestOnly } from "@/lib/plugins";
import { appIndexFloorOk, appVisibleTo } from "@/lib/apps";
import type { PersonRow } from "@/types";
import { MediaProgress as MediaProgressSchema } from "@maipai/spec/gen/ts/media-progress.js";
import { z } from "zod";
import { itemDetail } from "./items";
import type { MediaBudget } from "./watchTime";
import { listLibrary } from "@/lib/library";
import { liveSourceById, noDiscovery, readableItem, sourceVisibleTo } from "./access";
import { allowedBandsFor, bandAllows, mediaBandOf, trips } from "./band";
import { addItem, createCollection, removeItemFrom, resolveCollection, listCollections, setItems, setPointer } from "./collections";
import { itemFromRow, madeSourceId, sourcesFromRows, type MediaCollection, type MediaItem, type MediaSource } from "./model";
import { correctedStamp, getProgress, getProgressMany, percentOf, recentProgress, writeProgress } from "./progress";
import { nextHlc } from "@/lib/hlc";
import { createShare, deleteShare, listSharesForFile } from "@/lib/shares";
import { canReadFileAudience, fileAudience, getPersonRole, isOwnerOrAdmin, listActivePeople } from "@/lib/access";
import { libraryProvenance } from "@/lib/libraryProvenance";
import { speakerAgeBand } from "@/lib/ageBand";

import { albumKey, artistKey, albumOrder, groupTracks, radioTracks, shuffled } from "./music";

export type MediaKind = MediaItem["kind"];

/** The apps this host serves, and the item kinds each one is about. One definition: the route mount, the shell and the packages read it. */
export const MEDIA_APPS = {
  videos: { kinds: ["video"] as MediaKind[], noun: "video" },
  shows: { kinds: ["episode", "film"] as MediaKind[], noun: "title" },
  music: { kinds: ["track"] as MediaKind[], noun: "song" },
  podcasts: { kinds: ["podcast_episode"] as MediaKind[], noun: "episode" },
  books: { kinds: ["book", "audiobook", "chapter"] as MediaKind[], noun: "book" },
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
  action_label?: string;
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
  format?: "epub" | "pdf";
  locator?: unknown;
  parent_id?: string;
  linked?: MediaRow[];
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

export { noDiscovery };

export function allowedSources(person: PersonRow): MediaSource[] {
  const live = sourcesFromRows(db.select().from(mediaSources).where(isNull(mediaSources.deletedAt)).all()).filter((source) => sourceVisibleTo(source, person));
  if (!allowlistOnly(person)) return live;
  // Allowlist: the household library roots, and any channel, feed or link an adult named this child for (an explicit `visible_to`).
  return live.filter((source) => source.kind === "root" || (Array.isArray(source.visible_to) && source.visible_to.includes(person.id)));
}

/** The person may read this item in this app (band, source, kind, allowlist). */
export function readableIn(person: PersonRow, appId: MediaAppId, id: string): MediaItem | null {
  const item = readableItem(person, id);
  if (item && appId === "music" && !allowedSources(person).some((source) => source.id === item.source_id && source.kind === "root")) return null;
  if (!item || !(MEDIA_APPS[appId].kinds as readonly string[]).includes(item.kind)) return null;
  if (item.kind === "chapter") {
    const parent = item.parent_id ? readableItem(person, item.parent_id) : null;
    if (!parent || parent.kind !== "audiobook") return null;
  }
  if (appId === "shows" && !showWordsAllowed(person, item)) return null;
  if (allowlistOnly(person) && !allowedSources(person).some((source) => source.id === item.source_id)) return null;
  return item;
}

export interface ItemFilter {
  where?: SQL;
  order?: SQL[];
  limit?: number;
  /** Only items from sources that are not a library folder (channels, feeds, links). */
  followedOnly?: boolean;
  all?: boolean;
}

/** Items of the app's kinds this person may read, filtered through the band again (the floor runs for a minor), in the given order. */
export function queryItems(person: PersonRow, appId: MediaAppId, filter: ItemFilter = {}): MediaItem[] {
  let sources = allowedSources(person);
  if (appId === "music") sources = sources.filter((source) => source.kind === "root");
  if (filter.followedOnly) sources = sources.filter((source) => source.kind !== "root");
  if (sources.length === 0) return [];
  const conditions: SQL[] = [
    isNull(mediaItems.deletedAt), eq(mediaItems.hidden, false), inArray(mediaItems.kind, [...MEDIA_APPS[appId].kinds]),
    inArray(mediaItems.sourceId, sources.map((source) => source.id)), inArray(mediaItems.bandOk, allowedBandsFor(person)),
  ];
  if (filter.where) conditions.push(filter.where);
  if (appId === "books") conditions.push(sql`${mediaItems.kind} <> 'chapter'`);
  const limit = filter.limit ?? 50;
  const rows = db.select().from(mediaItems).where(and(...conditions)).orderBy(...(filter.order ?? [desc(mediaItems.addedAt)])).limit(filter.all ? -1 : limit * 2 + 2).all();
  const items: MediaItem[] = [];
  for (const row of rows) {
    // A stored row that no longer parses is left out and logged: one bad row never fails every shelf of every media app.
    let item: MediaItem;
    try {
      item = itemFromRow(row);
    } catch (error) {
      console.warn("[media] skipped a row that no longer parses:", row.id, error instanceof Error ? error.message.slice(0, 200) : String(error));
      continue;
    }
    if (bandAllows(person, item) && (appId !== "shows" || showWordsAllowed(person, item))) items.push(item);
    if (!filter.all && items.length >= limit) break;
  }
  return items;
}

/** Generated Library files join the app shelves through the Library's own listing (and therefore its file sharing and audience gates).
 * A saved media-item wins when both records point at the same file. */
type MadeLibraryFile = ReturnType<typeof listLibrary>["items"][number];
export function madeFiles(person: PersonRow, appId: "music" | "videos"): MadeLibraryFile[] {
  const kind = appId === "music" ? "audio" : "video";
  const savedFileIds = new Set(queryItems(person, appId, { all: true }).map((item) => (item.location as { file_id?: string }).file_id).filter((id): id is string => !!id));
  const files: MadeLibraryFile[] = [];
  let cursor: string | undefined;
  do {
    const page = listLibrary(person, { type: kind, origin: "made", sort: "newest", limit: 60, ...(cursor ? { cursor } : {}) });
    files.push(...page.items);
    cursor = page.next_cursor ?? undefined;
  } while (cursor);
  return files.filter((file) => !savedFileIds.has(file.id));
}

export function madeFileFor(person: PersonRow, appId: "music" | "videos", id: string): MadeLibraryFile | null {
  return madeFiles(person, appId).find((file) => file.id === id) ?? null;
}

function madeFileItemView(file: MadeLibraryFile, appId: "music" | "videos"): MediaItemView {
  const kind = appId === "music" ? "track" : "video";
  const title = file.name;
  const poster = file.thumb_url;
  return {
    id: file.id, title, channel: file.owner.display_name || "Made at home", summary: "", kind, thumbnail: poster, backdrop: poster,
    duration_s: file.duration_seconds, copy_label: "Saved", src: `/api/files/${encodeURIComponent(file.id)}/content`,
    subtitle: null, description: null, poster, chapters: [], captions: [], liked: false, watch_later: false,
  };
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
  for (const item of items) {
    if (item.kind !== "audiobook") continue;
    const parts = itemDetail(person, item).parts;
    if (!parts.length) continue;
    const progress = getProgressMany(person.id, parts.map((part) => part.id));
    const duration = parts.reduce((sum, part) => sum + (part.duration_s ?? 0), 0);
    const played = parts.reduce((sum, part) => {
      const saved = progress.find((row) => row.media_id === part.id);
      return sum + (saved?.completed ? part.duration_s ?? 0 : saved && "seconds" in saved.position ? Math.min(saved.position.seconds, part.duration_s ?? saved.position.seconds) : 0);
    }, 0);
    progressById.set(item.id, { percent: duration > 0 ? played / duration * 100 : null, completed: progress.length === parts.length && progress.every((row) => row.completed) });
  }
  return { progressById };
}

export function rowOf(item: MediaItem, context: RowContext): MediaRow {
  const seen = context.progressById.get(item.id);
  const art = artworkUrl(item);
  const row: MediaRow = {
    id: item.id, title: item.title, channel: eyebrowOf(item), summary: oneLine(item.description, 140) || item.subtitle || "", kind: item.kind, thumbnail: art, backdrop: art,
    duration_s: item.duration_s, copy_label: copyLabelOf(item),
    ...(item.kind === "book" || item.kind === "audiobook" ? { action_label: item.kind === "book" ? "Read" : "Listen" } : {}),
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
  /** What `id` names, for a data id that serves more than one page (Music's `header`: album, artist or playlist). */
  scope?: string;
  channel?: string;
  series?: string;
  season?: number;
  genre?: string;
  status?: string;
  limit?: number;
}

function safeText(value: unknown): string {
  return typeof value === "string" && !/\{[^{}]+\}/.test(value) ? value : "";
}

function shortPromptTitle(prompt: string): string {
  const clause = (prompt.split(/[.!?](?:\s|$)|[,;:\n]/, 1)[0] ?? prompt).trim().replace(/[\s.,;:!?-]+$/g, "");
  if (clause.length <= 60) return clause;
  return `${clause.slice(0, 60).replace(/\s+\S*$/, "").replace(/[\s.,;:!?-]+$/g, "")}`;
}

function visibilityForFile(person: PersonRow, fileId: string, canManage: boolean, adultOnly: boolean) {
  const active = listActivePeople();
  const rows = listSharesForFile(fileId);
  const current = rows.flatMap((share) => {
    if (share.to === "household") return [{ id: "household", name: "Everyone in the home", avatar_url: null }];
    const recipient = active.find((candidate) => candidate.id === share.to);
    if (!recipient || (!canManage && recipient.id !== person.id)) return [];
    return [{ id: recipient.id, name: recipient.displayName, avatar_url: null }];
  });
  const candidates = canManage ? [
    ...(!adultOnly ? [{ id: "household", name: "Everyone in the home", avatar_url: null }] : []),
    ...active.filter((candidate) => candidate.id !== person.id && (!adultOnly || speakerAgeBand(candidate, new Date()) === "adult"))
      .map((candidate) => ({ id: candidate.id, name: candidate.displayName, avatar_url: null })),
  ] : [];
  return {
    visibility: { mode: rows.length ? "shared" : "private", people: current, can_manage: canManage },
    candidates,
  };
}

function canManageMadeFile(person: PersonRow, ownerId: string): boolean {
  if (person.role === "child") return false;
  return person.id === ownerId || (isOwnerOrAdmin(person) && getPersonRole(ownerId) === "child");
}

function videoCreation(person: PersonRow, id: string): unknown[] {
  const made = madeFileFor(person, "videos", id);
  if (made) {
    const file = db.select().from(attachments).where(eq(attachments.id, id)).get();
    if (!file || file.deletedAt !== null || !canReadFileAudience(person, file)) return [];
    const metadata = libraryProvenance(file.provenance) as Record<string, unknown>;
    const jobId = typeof metadata.job === "string" ? metadata.job : "";
    const job = jobId ? db.select().from(videoJobs).where(and(eq(videoJobs.id, jobId), eq(videoJobs.personId, file.ownerPersonId))).get() : undefined;
    const prompt = safeText(job?.prompt) || safeText(metadata.prompt);
    let request: Record<string, unknown> = {};
    try { request = JSON.parse(job?.request ?? "{}") as Record<string, unknown>; } catch { request = {}; }
    const title = safeText(metadata.title) || safeText(request.title) || shortPromptTitle(prompt) || "Made at home";
    const owner = db.select().from(people).where(eq(people.id, file.ownerPersonId)).get();
    const canManage = canManageMadeFile(person, file.ownerPersonId);
    const adultOnly = fileAudience(file.provenance) === "adult-only";
    const share = visibilityForFile(person, id, canManage, adultOnly);
    return [{ id, title, description: prompt, creator: owner
      ? { name: owner.displayName, avatar_url: null, href: `/people/${encodeURIComponent(owner.id)}` }
      : { label: "Made at home" }, made_at: made.created_at, visibility: share.visibility }];
  }
  const item = readableIn(person, "videos", id);
  if (!item) return [];
  const source = liveSourceById(item.source_id);
  if (!source) return [];
  const shared = source.visible_to === "household";
  const household = shared ? listActivePeople().map((candidate) => ({ id: candidate.id, name: candidate.displayName, avatar_url: null })) : [];
  return [{ id, title: safeText(item.title) || "Video", description: safeText(item.description), creator: { name: safeText(item.subtitle) || safeText(source.label) || "Video source" }, made_at: item.added_at,
    visibility: { mode: shared ? "shared" : "private", people: household, can_manage: false } }];
}

function videoCreationPeople(person: PersonRow, id: string): unknown[] {
  const made = madeFileFor(person, "videos", id);
  if (!made) return [];
  const file = db.select().from(attachments).where(eq(attachments.id, id)).get();
  if (!file || file.deletedAt !== null || !canReadFileAudience(person, file)) return [];
  const canManage = canManageMadeFile(person, file.ownerPersonId);
  return visibilityForFile(person, id, canManage, fileAudience(file.provenance) === "adult-only").candidates;
}

export function changeVideoCreationShare(person: PersonRow, op: "add" | "remove" | "private", id: string, target?: string) {
  const file = db.select().from(attachments).where(eq(attachments.id, id)).get();
  if (!file || file.deletedAt !== null || file.origin === "fetched" || !canReadFileAudience(person, file)) return { ok: false as const, status: 404, error: "Video unavailable. Go back to Videos and choose another." };
  if (!madeFileFor(person, "videos", id)) return { ok: false as const, status: 404, error: "Video unavailable. Go back to Videos and choose another." };
  if (!canManageMadeFile(person, file.ownerPersonId)) return { ok: false as const, status: 403, error: "Only the owner or an admin may change who sees this video." };
  if (person.role === "child") return { ok: false as const, status: 403, error: "Sharing is turned off for children. Ask a grown-up to share this for you." };
  if (op === "add") {
    if (!target) return { ok: false as const, status: 400, error: "Choose someone in your home." };
    const result = createShare(person, { fileId: id, to: target, provenance: "videos:creation-header" });
    if (!result.ok) return result;
  } else {
    const matching = listSharesForFile(id).filter((share) => op === "private" || share.to === target);
    for (const share of matching) {
      const result = deleteShare(person, share.id);
      if (!result.ok) return result;
    }
  }
  const refreshed = videoCreation(person, id)[0];
  return { ok: true as const, value: refreshed ?? { visibility: visibilityForFile(person, id, true, fileAudience(file.provenance) === "adult-only").visibility } };
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

function mediaAppDataRaw(person: PersonRow, appId: MediaAppId, dataId: string, params: DataParams): MediaRow[] | MediaItemView | MediaItemView[] | { as_of: string; rows: Array<{ id: string; label: string }> } | null {
  const limit = Math.min(Math.max(params.limit ?? 20, 1), 200);
  dataId = dataId.replace(/_/g, "-"); // manifest ids use hyphens; the underscore spelling of a page written earlier still answers
  if (noDiscovery(person) && (DISCOVERY_IDS as readonly string[]).includes(dataId)) return [];
  // Up next outside Music is a suggestion list (series order, then the newest); Music's up-next is the person's own queue.
  if (noDiscovery(person) && dataId === "up-next" && appId !== "music") return [];
  if (appId === "shows") return showsData(person, dataId, params, limit) as ReturnType<typeof mediaAppData>;
  if (appId === "books") {
    const titles = () => queryItems(person, "books", { all: true, order: [sql`lower(${mediaItems.title})`] });
    if (dataId === "books" || dataId === "audiobooks") return rowsOf(person, titles().filter((item) => item.kind === (dataId === "books" ? "book" : "audiobook")));
    if (dataId === "continue-reading" || dataId === "continue-listening") {
      const found = new Set<string>(); const items: MediaItem[] = [];
      for (const progress of recentProgress(person.id, 200)) {
        if (progress.completed || (percentOf(progress.position, progress.duration_s) ?? 0) <= 0) continue;
        let item = readableIn(person, "books", progress.media_id);
        if (item?.kind === "chapter" && item.parent_id) item = readableIn(person, "books", item.parent_id);
        if (!item || item.kind !== (dataId === "continue-reading" ? "book" : "audiobook") || found.has(item.id)) continue;
        found.add(item.id); items.push(item);
      }
      return rowsOf(person, items.slice(0, limit));
    }
    if (dataId === "series") {
      const groups = new Map<string, MediaItem[]>();
      for (const item of titles()) if (item.series) groups.set(item.series, [...(groups.get(item.series) ?? []), item]);
      return [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([series, items]) => ({ ...rowsOf(person, [items[0]!])[0]!, title: series, series, summary: `${items.length} book${items.length === 1 ? "" : "s"}` }));
    }
    if (dataId === "series-items") return rowsOf(person, titles().filter((item) => item.series === params.series).sort((a, b) => (a.series_index ?? 0) - (b.series_index ?? 0) || a.title.localeCompare(b.title)));
    if (dataId === "editions" || dataId === "linked-editions") {
      const item = params.id ? readableIn(person, "books", params.id) : null;
      const parent = item?.kind === "chapter" && item.parent_id ? readableIn(person, "books", item.parent_id) : item;
      return parent ? rowsOf(person, [...(dataId === "editions" ? [parent] : []), ...itemDetail(person, parent).linked.filter((linked) => readableIn(person, "books", linked.id))]) : [];
    }
    if (dataId === "chapters") {
      const item = params.id ? readableIn(person, "books", params.id) : null;
      const parent = item?.kind === "chapter" && item.parent_id ? readableIn(person, "books", item.parent_id) : item;
      if (!parent) return [];
      const parts = itemDetail(person, parent).parts.filter((part) => readableIn(person, "books", part.id));
      if (parts.length) return rowsOf(person, parts).map((row, index) => ({ ...row, key: row.id, index: index + 1 }));
      const saved = getProgress(person.id, parent.id); const at = saved && "seconds" in saved.position ? saved.position.seconds : 0;
      return parent.chapters.map((chapter, index) => {
        const end = parent.chapters[index + 1]?.start_s ?? parent.duration_s ?? chapter.start_s; const length = Math.max(0, end - chapter.start_s);
        const row: MediaRow & { key: string; index: number; position_s: number } = { ...rowOf(parent, contextFor(person, [parent])), key: `${parent.id}-${index}`, index: index + 1, title: chapter.title, duration_s: length || null, position_s: chapter.start_s };
        delete row.progress; delete row.completed;
        if (saved?.completed || (length > 0 && at >= end)) row.completed = true;
        else if (length > 0 && at > chapter.start_s) row.progress = Math.min(1, (at - chapter.start_s) / length);
        return row;
      });
    }
  }
  if (appId === "music") {
    const music = musicData(person, dataId, params);
    if (music !== null) return music as never;
  }
  switch (dataId) {
    case "creation":
      return appId === "videos" && params.id
        ? (params.scope === "people" ? videoCreationPeople(person, params.id) : videoCreation(person, params.id)) as never
        : null;
    case "made-at-home":
      return appId === "videos" ? madeFiles(person, "videos").slice(0, 16).map((file) => ({ id: file.id, title: file.name, channel: file.owner.display_name || "Made at home", summary: "", kind: "video", thumbnail: file.thumb_url, backdrop: file.thumb_url, duration_s: file.duration_seconds, copy_label: "Saved" })) : null;
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
      if (params.id && (appId === "music" || appId === "videos")) {
        const file = madeFileFor(person, appId, params.id);
        if (file) return madeFileItemView(file, appId);
      }
      const item = params.id ? readableIn(person, appId, params.id) : null;
      return item ? (appId === "books" ? bookItemView(person, item) : itemView(person, appId, item)) : [];
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

/** Page documents use `{field}` as a field lookup. A missing row value must never
 * leak that template token into a person's screen; empty text is the safe fallback. */
export function safeTemplateFields<T>(value: T): T {
  if (Array.isArray(value)) return value.map((row) => safeTemplateFields(row)) as T;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const copy = { ...record };
    if ("channel" in copy && (copy.channel === null || copy.channel === undefined)) copy.channel = "";
    return copy as T;
  }
  return value;
}

export function mediaAppData(person: PersonRow, appId: MediaAppId, dataId: string, params: DataParams): ReturnType<typeof mediaAppDataRaw> {
  return safeTemplateFields(mediaAppDataRaw(person, appId, dataId, params));
}

/** What to play after `item`: the person's watch-later queue first, then the rest of the channel in order, then the newest others. */
function upNextItems(person: PersonRow, appId: MediaAppId, item: MediaItem, limit: number): MediaItem[] {
  if (appId === "shows") { if (item.kind !== "episode") return []; const siblings = showEpisodes(person, item); return siblings.slice(siblings.findIndex((candidate) => candidate.id === item.id) + 1).slice(0, limit); }
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
  const queue = appId === "music" ? musicNext(person, item.id)[0] : noDiscovery(person) ? undefined : upNextItems(person, appId, item, 1)[0];
  const seconds = progress && "seconds" in progress.position ? progress.position.seconds : undefined;
  const address = (item.location as { url?: string }).url;
  const direct = item.kind === "podcast_episode" ? address?.replace(/^http:\/\//i, "https://") : address;
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

/** Books keep their locator; folder audiobooks resolve to the latest part or the next unfinished one. */
function bookItemView(person: PersonRow, requested: MediaItem): MediaItemView {
  let item = requested;
  let parent = item.kind === "chapter" && item.parent_id ? readableIn(person, "books", item.parent_id) : null;
  if (item.kind === "audiobook") {
    const parts = itemDetail(person, item).parts.filter((part) => readableIn(person, "books", part.id));
    if (parts.length) {
      parent = item;
      const latest = recentProgress(person.id, 200).find((progress) => parts.some((part) => part.id === progress.media_id));
      const index = latest ? parts.findIndex((part) => part.id === latest.media_id) : 0;
      item = parts[latest?.completed && index < parts.length - 1 ? index + 1 : index]!;
    }
  }
  const view = itemView(person, "books", item);
  delete view.up_next;
  const progress = getProgress(person.id, item.id);
  if (item.kind === "book") {
    view.format = item.media_type === "application/pdf" ? "pdf" : "epub";
    if (progress && "locator" in progress.position) view.locator = progress.position.locator;
  }
  const edition = parent ?? item;
  view.linked = rowsOf(person, itemDetail(person, edition).linked.filter((linked) => readableIn(person, "books", linked.id)));
  if (parent) {
    view.parent_id = parent.id; view.title = parent.title; view.poster = artworkUrl(parent) ?? view.poster;
    view.chapters = [{ start_s: 0, title: item.title }];
    const parts = itemDetail(person, parent).parts.filter((part) => readableIn(person, "books", part.id));
    const next = parts[parts.findIndex((part) => part.id === item.id) + 1];
    if (next && !noDiscovery(person)) view.up_next = { id: next.id, title: next.title };
  }
  return view;
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
  locator?: unknown;
  percent?: unknown;
}

/** The one progress path for an app page: coerce, check the title is readable here, then `writeProgress` (mergeProgress inside). */
export function saveProgress(person: PersonRow, appId: MediaAppId, args: ProgressArgs, now = new Date(), meterKey?: string): ActionResult<{ applied: boolean; completed: boolean; budget?: MediaBudget }> {
  const item = typeof args.media_id === "string" ? readableIn(person, appId, args.media_id) : null;
  if (!item) return { ok: false, status: 404, error: `That ${MEDIA_APPS[appId].noun} is not in the library.` };
  let position: import("./progress").Position;
  if (item.kind === "book") {
    const locator = z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("cfi"), cfi: z.string().min(1).max(8192), spine_index: z.number().int().min(0).nullable().optional(), block_index: z.number().int().min(0).nullable().optional(), page: z.null().optional() }).strict(),
      z.object({ kind: z.literal("page"), page: z.number().int().min(1), cfi: z.null().optional(), spine_index: z.null().optional(), block_index: z.null().optional() }).strict(),
    ]).safeParse(args.locator);
    const percent = coerceNumber(args.percent);
    if (!locator.success || percent === undefined || percent < 0 || percent > 100 || locator.data.kind !== (item.media_type === "application/pdf" ? "page" : "cfi")) return { ok: false, status: 400, error: "The reading place was not valid. Open the book and turn the page again." };
    position = MediaProgressSchema.shape.position.parse({ locator: locator.data, percent });
  } else {
    const seconds = coerceNumber(args.position_s);
    if (seconds === undefined || seconds < 0) return { ok: false, status: 400, error: "Where to save the place was missing. Play the item again." };
    position = { seconds };
  }
  const duration = coerceNumber(args.duration_s);
  let outroHit = false;
  let reason = typeof args.reason === "string" && (PROGRESS_REASONS as readonly string[]).includes(args.reason) ? args.reason : "interval";
  // A show's "skip the last N seconds" (media-source skip_outro_s): reaching that point counts as finishing the episode.
  if (reason !== "ended" && duration !== undefined && duration > 0) {
    const outro = outroSecondsOf(item);
    if (outro > 0 && "seconds" in position && position.seconds >= duration - outro) { reason = "ended"; outroHit = true; }
  }
  const device = typeof args.device_id === "string" && /^device-[a-z0-9]{6,}$/.test(args.device_id) ? args.device_id : null;
  const outcome = writeProgress(person, item, {
    position, duration_s: duration !== undefined && duration >= 0 ? duration : undefined, device_id: device,
    events: reason === "ended" ? { finish: true } : undefined, ...(outroHit ? { completed: true } : {}), stamp: correctedStamp({ serverNow: now }),
  }, { now, immediate: item.kind === "book" || reason !== "interval", meterKey });
  if (!outcome.ok) {
    return outcome.refusal === "other_persons_device"
      ? { ok: false, status: 403, error: "This screen belongs to someone else, so it cannot save your place. Sign in on your own screen." }
      : { ok: false, status: 422, error: "That place could not be saved. Play the item again." };
  }
  if (appId === "music" && reason === "ended") {
    const queue = resolveCollection(person.id, "queue");
    const index = queue?.items.findIndex((entry) => entry.media_id === item.id) ?? -1;
    if (queue && index >= 0) setPointer(queue, index + 1 < queue.items.length ? index + 1 : null);
  }
  // A finished title leaves the person's later list: Watch later, or the queue for a podcast (FileTube's "remove watched").
  if (outcome.progress.completed) {
    const later = resolveCollection(person.id, laterKindOf(appId));
    if (later?.items.some((entry) => entry.media_id === item.id)) removeItemFrom(later, item.id);
  }
  if (appId === "shows") {
    const list = showCollection(person); const entry = list?.items.find((e) => { const saved = readableIn(person, "shows", e.media_id); return saved && (saved.id === item.id || item.kind === "episode" && saved.kind === "episode" && saved.source_id === item.source_id && saved.series === item.series); });
    if (list && entry?.status === "want") addItem(list, entry.media_id, { status: "watching" });
  }
  return { ok: true, value: { applied: outcome.positionApplied, completed: outcome.progress.completed, budget: outcome.budget } };
}

function showEpisodes(person: PersonRow, item: MediaItem): MediaItem[] { return item.kind === "episode" ? queryItems(person, "shows", { all: true, where: and(eq(mediaItems.sourceId, item.source_id), item.series === null ? isNull(mediaItems.series) : eq(mediaItems.series, item.series)) }).filter((entry) => item.series !== null || entry.id === item.id).sort((a,b) => (a.season ?? 0)-(b.season ?? 0) || (a.episode ?? 0)-(b.episode ?? 0) || a.id.localeCompare(b.id)) : [item]; }
function showWordsAllowed(person: PersonRow, item: MediaItem): boolean { return bandAllows(person, { ...item, title: [item.title, item.series, item.genre].filter(Boolean).join(". ") }); }
function showTitles(items: MediaItem[]): MediaItem[] { const seen = new Set<string>(); return items.filter((item) => { const key = item.kind === "episode" && item.series ? JSON.stringify([item.source_id, item.series]) : item.id; if (seen.has(key)) return false; seen.add(key); return true; }); }
function showRow(person: PersonRow, item: MediaItem) {
  const episodes = showEpisodes(person, item); const context = contextFor(person, episodes);
  const next = episodes.find((episode) => !context.progressById.get(episode.id)?.completed) ?? episodes[0]!;
  return { ...rowOf(item, context), title: item.kind === "episode" ? item.series ?? item.title : item.title, play_id: next.id,
    next_season: next.season === null ? "" : String(next.season), detail_page: item.kind === "film" ? "film" : "show",
    summary: item.description ?? "", channel: item.kind === "film" ? [item.year, item.genre].filter(Boolean).join(" · ") : `${new Set(episodes.map((e) => e.season)).size} seasons`,
    play_label: context.progressById.get(next.id)?.percent ? "Resume" : "Play" };
}
function showCollection(person: PersonRow, create = false): MediaCollection | null { return listCollections(person.id, "watchlist").find((c) => c.title === "Shows and Films") ?? (create ? createCollection(person.id, "watchlist", "Shows and Films") : null); }
function showsData(person: PersonRow, dataId: string, params: DataParams, limit: number): unknown | null {
  const all = () => queryItems(person, "shows", { all: true }).filter((item) => showWordsAllowed(person, item));
  const rows = (items: MediaItem[]) => showTitles(items).slice(0, limit).map((item) => showRow(person, item));
  const item = params.id ? readableIn(person, "shows", params.id) : null;
  switch (dataId) {
    case "featured": return rows(all()).slice(0, 5);
    case "recent": return rows(all());
    case "shows": return rows(all().filter((i) => i.kind === "episode").sort((a,b) => (a.series ?? a.title).localeCompare(b.series ?? b.title)));
    case "films": return rows(all().filter((i) => i.kind === "film").sort((a,b) => a.title.localeCompare(b.title)));
    case "genres": return { rows: noDiscovery(person) ? [] : [...new Set(all().map((i) => i.genre).filter((g): g is string => !!g))].sort().map((g) => ({ id:g,label:g })) };
    case "genre": return noDiscovery(person) || !params.genre ? [] : rows(all().filter((i) => i.genre === params.genre));
    case "detail": return item ? [showRow(person,item)] : [];
    case "seasons": return { rows: item?.kind === "episode" ? [...new Set(showEpisodes(person,item).filter((episode) => readableIn(person,"shows",episode.id)).map((e) => e.season ?? 0))].map((s) => ({ id:String(s),label:`Season ${s}` })) : [] };
    case "episodes": {
      if (item?.kind !== "episode") return [];
      const episodes = showEpisodes(person,item).filter((episode) => readableIn(person,"shows",episode.id)); const context = contextFor(person,episodes); const next = episodes.find((e) => !context.progressById.get(e.id)?.completed);
      return episodes.filter((e) => e.season === (params.season ?? next?.season ?? episodes[0]?.season)).map((episode) => { const row = rowOf(episode,context); const done = context.progressById.get(episode.id)?.completed === true; return { ...row,title: episode.episode ? `${episode.episode}. ${episode.title}` : episode.title,summary:oneLine(episode.description,140),progress:done ? 1 : row.progress,up_next:next?.id === episode.id,copy_label:done ? "Watched" : "Saved" }; });
    }
    case "watchlist": return (showCollection(person)?.items ?? []).filter((e) => !params.status || params.status === "all" || e.status === params.status).flatMap((e) => { const saved = readableIn(person,"shows",e.media_id); return saved ? [{...showRow(person,saved),copy_label:e.status === "want" ? "Want to watch" : e.status === "watching" ? "Watching" : "Completed"}] : []; });
    case "continue": case "continue-adult": case "continue-child": return rows(itemsInOrder(person,"shows",recentProgress(person.id,200).filter((p) => !p.completed && "seconds" in p.position && p.position.seconds > 0).map((p) => p.media_id),limit));
    case "item": return item ? itemView(person,"shows",item) : [];
    case "up-next": return item ? rowsOf(person,upNextItems(person,"shows",item,limit)) : [];
    default: return null;
  }
}
function watchlist(person: PersonRow, create = false): MediaCollection | null { return listCollections(person.id, "watchlist").find((c) => c.title === "Shows and Films") ?? (create ? createCollection(person.id, "watchlist", "Shows and Films") : null); }
export function setWatchlist(person: PersonRow, args: Record<string, unknown>): ActionResult<{ status: string }> {
  const item = typeof args.media_id === "string" ? readableIn(person, "shows", args.media_id) : null;
  if (!item) return { ok: false, status: 404, error: "This title is not available. Go back to Shows and Films and choose another." };
  const status = args.status ?? "want";
  if (status !== "want" && status !== "watching" && status !== "completed") return { ok: false, status: 400, error: "This watchlist status is not valid." };
  const collection = watchlist(person, true)!;
  const existing = collection.items.find((entry) => { const saved = readableIn(person, "shows", entry.media_id); return saved && (saved.id === item.id || item.kind === "episode" && item.series !== null && saved.kind === "episode" && saved.source_id === item.source_id && saved.series === item.series); });
  const anchor = existing?.media_id ?? (item.kind === "episode" ? showEpisodes(person, item)[0]?.id ?? item.id : item.id);
  addItem(collection, anchor, { status: status as "want" | "watching" | "completed" });
  return { ok: true, value: { status: String(status) } };
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


// Music uses the same read gate and collections as every other media app. No album or artist store.
function musicLibrary(person: PersonRow): MediaItem[] {
  // No page-sized cap before grouping: every readable track belongs to its derived album.
  return queryItems(person, "music", { all: true, order: [sql`lower(${mediaItems.title})`] });
}

/** Turn a visible generated Library audio file into the shared media record used by Music queues.
 * The file visibility check is delegated to madeFileFor. A person's own root is valid when the
 * fresh hub has no household root; readableIn still applies the ordinary source and band gates. */
function promoteMadeMusicFile(person: PersonRow, fileId: string): MediaItem | null {
  // A file saved by an earlier press is a media item already (and no longer listed as a made file): reuse it.
  const existing = db.select().from(mediaItems).where(eq(mediaItems.locFileId, fileId)).get();
  if (existing) return readableIn(person, "music", existing.id);
  const file = madeFileFor(person, "music", fileId);
  if (!file) return null;
  const roots = allowedSources(person).filter((candidate) => candidate.kind === "root");
  // Reuse only a root the person can actually read items from (its `visible_to` is the household or names them).
  const readable = (candidate: MediaSource): boolean => candidate.visible_to === "household" || (Array.isArray(candidate.visible_to) && candidate.visible_to.includes(person.id));
  let source = roots.find((candidate) => candidate.scope === "household" && readable(candidate))
    ?? roots.find((candidate) => candidate.scope === "person" && candidate.owner_person_id === person.id && readable(candidate));
  if (!source) {
    // Generated Library files exist before a household has configured any scanned media roots.
    // Give this person's generated tracks a normal, private root so all later reads use the same gate.
    const sourceId = madeSourceId(person.id);
    const now = new Date().toISOString();
    db.insert(mediaSources).values({
      id: sourceId, kind: "root", scope: "person", ownerPersonId: person.id,
      label: "Created by you", rootPath: "made-at-home", rootKinds: JSON.stringify(["track"]), paused: true,
      visibleTo: JSON.stringify([person.id]), createdAt: now,
      hlc: nextHlc(), provenance: "music:generated-library",
    }).run();
    source = allowedSources(person).find((candidate) => candidate.id === sourceId);
  }
  if (!source) return null;
  const now = new Date().toISOString();
  const id = `media-${crypto.randomUUID().replace(/-/g, "")}`;
  db.insert(mediaItems).values({
    id, kind: "track", title: file.name, sourceId: source.id, locFileId: file.id, mediaType: file.media_type,
    durationS: file.duration_seconds, size: file.size_bytes, playable: "original", bandOk: file.audience === "adult-only" ? "adult" : "child",
    addedAt: file.created_at, createdAt: now, hlc: nextHlc(), provenance: "music:generated-library",
  }).run();
  return readableIn(person, "music", id);
}
function musicNext(person: PersonRow, id: string): MediaItem[] {
  const queue = resolveCollection(person.id, "queue");
  const index = queue?.items.findIndex((entry) => entry.media_id === id) ?? -1;
  return index < 0 ? [] : itemsInOrder(person, "music", queue!.items.slice(index + 1).map((entry) => entry.media_id), 200);
}

const artistOf = (item: MediaItem): string => item.artist ?? item.subtitle ?? "Unknown artist";
const songCount = (count: number): string => `${count} ${count === 1 ? "song" : "songs"}`;

/** The track the person's queue points at: the row the kit rings as "playing" (item_highlight_field). */
function queueCurrent(person: PersonRow): string | null {
  const queue = resolveCollection(person.id, "queue");
  return queue && queue.pointer !== null ? queue.items[queue.pointer]?.media_id ?? null : null;
}

/** Track rows for the compact list: the media row plus the album track number, the playing flag and the Like label the row actions read. */
function trackRows(person: PersonRow, items: readonly MediaItem[], extra?: (item: MediaItem) => Record<string, unknown>): Array<MediaRow & Record<string, unknown>> {
  const base = rowsOf(person, items);
  const liked = new Set(collectionIds(person, "liked"));
  const current = queueCurrent(person);
  return items.map((item, index) => ({
    ...base[index]!, channel: artistOf(item), track_number: item.track_no, playing: item.id === current, like_label: liked.has(item.id) ? "Liked" : "Like", ...extra?.(item),
  }));
}

/** An album or artist tile: the first track's picture, the derived id (the group key) and the page it opens. */
function albumTile(person: PersonRow, id: string, tracks: readonly MediaItem[]): MediaRow & Record<string, unknown> {
  const first = albumOrder(tracks)[0]!;
  const pictured = albumOrder(tracks).find((item) => item.artwork) ?? first;
  return { ...rowsOf(person, [pictured])[0]!, id, title: first.album ?? "Unknown album", channel: first.album_artist ?? artistOf(first), kind: "track", queue_mode: "album" };
}

function musicData(person: PersonRow, dataId: string, params: DataParams): unknown | null {
  if (dataId === "songs" && params.scope === "made") return madeFiles(person, "music").slice(0, 16).map((file) => ({ id: file.id, title: file.name, channel: null, summary: "", kind: "track", thumbnail: file.thumb_url, backdrop: file.thumb_url, duration_s: file.duration_seconds, copy_label: "Saved", playing: false, like_label: "Like" }));
  if (dataId === "up-next") return trackRows(person, musicNext(person, params.id ?? ""));
  if (dataId === "songs") return trackRows(person, musicLibrary(person));
  if (dataId === "albums") {
    const groups = [...groupTracks(musicLibrary(person), "album")];
    // `scope: "recent"` is Listen now's "Recently added": the newest albums first, a dozen of them.
    if (params.scope === "recent") {
      const added = (tracks: readonly MediaItem[]) => tracks.reduce((latest, item) => (item.added_at > latest ? item.added_at : latest), "");
      return groups.sort((a, b) => added(b[1]).localeCompare(added(a[1])) || a[0].localeCompare(b[0])).slice(0, 12).map(([id, tracks]) => albumTile(person, id, tracks));
    }
    return groups.map(([id, tracks]) => albumTile(person, id, tracks)).sort((a, b) => a.title.localeCompare(b.title));
  }
  if (dataId === "artists") {
    return [...groupTracks(musicLibrary(person), "artist")].map(([id, tracks]) => {
      const pictured = tracks.find((item) => item.artwork) ?? tracks[0]!;
      return { ...rowsOf(person, [pictured])[0]!, id, title: artistKey(tracks[0]!), channel: songCount(tracks.length), kind: "track", queue_mode: "artist" };
    }).sort((a, b) => a.title.localeCompare(b.title));
  }
  if (dataId === "header" && params.scope === "album") {
    const tracks = albumOrder(groupTracks(musicLibrary(person), "album").get(params.id ?? "") ?? []);
    if (tracks.length === 0) return [];
    const years = [...new Set(tracks.map((item) => item.year).filter((year): year is number => !!year))];
    const tile = albumTile(person, params.id!, tracks);
    return [{ ...tile, channel: [tile.channel, years.length === 1 ? String(years[0]) : null, songCount(tracks.length)].filter(Boolean).join(" · "), shuffle_id: `shuffle:${params.id}` }];
  }
  if (dataId === "header" && params.scope === "artist") {
    const tracks = groupTracks(musicLibrary(person), "artist").get(params.id ?? "") ?? [];
    if (tracks.length === 0) return [];
    const pictured = tracks.find((item) => item.artwork) ?? tracks[0]!;
    return [{ ...rowsOf(person, [pictured])[0]!, id: params.id, title: artistKey(tracks[0]!), channel: songCount(tracks.length), kind: "track", queue_mode: "artist", radio_id: `radio:artist:${params.id}` }];
  }
  if (dataId === "header" && params.scope === "playlist") {
    const collection = resolveCollection(person.id, params.id ?? "");
    if (collection?.kind !== "playlist" || !visiblePlaylists(person).some((entry) => entry.id === collection.id)) return [];
    return [{ ...playlistTile(person, collection), queue_mode: "playlist", shuffle_id: `shuffle:${collection.id}` }];
  }
  if (dataId === "album") return trackRows(person, albumOrder(groupTracks(musicLibrary(person), "album").get(params.id ?? "") ?? []));
  if (dataId === "album-more") {
    // The same artist's other albums, never the one open.
    const groups = groupTracks(musicLibrary(person), "album");
    const here = groups.get(params.id ?? "")?.[0];
    if (!here) return [];
    const owner = (item: MediaItem) => item.album_artist ?? artistOf(item);
    return [...groups].filter(([id, tracks]) => id !== params.id && owner(tracks[0]!) === owner(here))
      .map(([id, tracks]) => albumTile(person, id, tracks)).sort((a, b) => a.title.localeCompare(b.title));
  }
  if (dataId === "artist") return trackRows(person, albumOrder(groupTracks(musicLibrary(person), "artist").get(params.id ?? "") ?? []).sort((a, b) => (a.album ?? "").localeCompare(b.album ?? "")));
  if (dataId === "artist-albums") {
    const tracks = groupTracks(musicLibrary(person), "artist").get(params.id ?? "") ?? [];
    return [...groupTracks(tracks, "album")].map(([id, group]) => albumTile(person, id, group)).sort((a, b) => a.title.localeCompare(b.title));
  }
  if (dataId === "radio-seeds") {
    if (noDiscovery(person)) return [];
    return [...groupTracks(musicLibrary(person), "artist")].map(([, tracks]) => ({ ...rowsOf(person, [tracks.find((item) => item.artwork) ?? tracks[0]!])[0]!, id: tracks[0]!.id, title: `${artistKey(tracks[0]!)} radio`, channel: null, kind: "track", queue_mode: "radio", radio_seed: tracks[0]!.id }));
  }
  if (dataId === "playlists") return visiblePlaylists(person).map((collection) => playlistTile(person, collection));
  if (dataId === "playlist-new") return [{ id: "new", title: "New playlist", channel: "Start an empty playlist", kind: "track" }];
  if (dataId === "playlist") {
    const collection = resolveCollection(person.id, params.id ?? "");
    if (collection?.kind !== "playlist" || !visiblePlaylists(person).some((entry) => entry.id === collection.id)) return [];
    const tracks = playlistTracks(person, collection);
    // The index column is the place in this list, not the song's number on its album.
    return trackRows(person, tracks, (item) => ({ playlist_id: collection.id, track_number: tracks.indexOf(item) + 1 }));
  }
  if (dataId === "liked") return trackRows(person, itemsInOrder(person, "music", [...collectionIds(person, "liked")].reverse(), Math.min(Math.max(params.limit ?? 20, 1), 200)));
  if (dataId === "history") return trackRows(person, itemsInOrder(person, "music", recentProgress(person.id, 120).map((progress) => progress.media_id), 60));
  return null;
}

function playlistTile(person: PersonRow, collection: MediaCollection): MediaRow & Record<string, unknown> {
  const tracks = playlistTracks(person, collection);
  const pictured = tracks.find((item) => item.artwork) ?? tracks[0];
  const base = pictured ? rowsOf(person, [pictured])[0]! : { id: collection.id, title: collection.title, channel: null, summary: "", kind: "track" as const, thumbnail: null, backdrop: null, duration_s: null, copy_label: "Saved" };
  return { ...base, id: collection.id, title: collection.title, channel: songCount(tracks.length), kind: "track" };
}

const ALL_TRACKS = 1_000_000;
function playlistTracks(person: PersonRow, collection: MediaCollection): MediaItem[] {
  return itemsInOrder(person, "music", collection.items.map((entry) => entry.media_id), ALL_TRACKS);
}
/** The person's own playlists; a minor never sees one whose name trips the floor. */
function visiblePlaylists(person: PersonRow): MediaCollection[] {
  return listCollections(person.id, "playlist").filter((collection) => mediaBandOf(person) === "adult" || !trips(collection.title));
}

/** The Playlists page's two buttons. "new" makes an empty playlist; "add" puts a song on the newest playlist (a first one is made if there is none). */
export function musicPlaylistAction(person: PersonRow, args: Record<string, unknown>): ActionResult<{ id: string; title: string }> {
  if (args.op === "new") {
    const made = createCollection(person.id, "playlist", `Playlist ${listCollections(person.id, "playlist").length + 1}`);
    return { ok: true, value: { id: made.id, title: made.title } };
  }
  if (args.op === "remove") {
    const own = typeof args.playlist_id === "string" ? resolveCollection(person.id, args.playlist_id) : null;
    if (own?.kind !== "playlist" || typeof args.media_id !== "string") return { ok: false, status: 404, error: "That playlist is not available. Go back to Playlists and choose another." };
    removeItemFrom(own, args.media_id);
    return { ok: true, value: { id: own.id, title: own.title } };
  }
  const item = typeof args.media_id === "string" ? readableIn(person, "music", args.media_id) : null;
  if (!item) return { ok: false, status: 404, error: "That song is not available. Go back to the library and choose another." };
  const playlist = visiblePlaylists(person).sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? createCollection(person.id, "playlist", "My playlist");
  if (!playlist.items.some((entry) => entry.media_id === item.id)) addItem(playlist, item.id);
  return { ok: true, value: { id: playlist.id, title: playlist.title } };
}

/** Replace only this person's queue. A seed and every candidate are checked before use. */
export function startMusicQueue(person: PersonRow, args: Record<string, unknown>): ActionResult<{ id: string }> {
  const library = musicLibrary(person);
  let id = typeof args.id === "string" ? args.id : "";
  let mode: unknown = args.mode;
  let seedKind: unknown = args.seed_kind;
  let shuffle = args.shuffle === true || args.shuffle === "true";
  // A page button that can carry only one id says what it wants in the id: "shuffle:<album or playlist id>" or "radio:<kind>:<seed>".
  if (id.startsWith("shuffle:")) { shuffle = true; id = id.slice("shuffle:".length); }
  const radio = /^radio:(artist|album|genre|track):(.+)$/s.exec(id);
  if (radio) { mode = "radio"; seedKind = radio[1]; id = radio[2]!; }
  let tracks: MediaItem[] = [];
  if (mode === "radio") {
    const seed = library.find((item) => item.id === id || (seedKind === "artist" && artistKey(item) === id) || (seedKind === "album" && albumKey(item) === id) || (seedKind === "genre" && item.genre === id));
    if (seed) tracks = radioTracks(library, seed);
  } else if (mode === "artist") tracks = albumOrder(library.filter((item) => artistKey(item) === id)).sort((a, b) => (a.album ?? "").localeCompare(b.album ?? ""));
  else if (mode === "album") tracks = albumOrder(library.filter((item) => albumKey(item) === id));
  else if (mode === "playlist") {
    const collection = resolveCollection(person.id, id);
    if (collection?.kind === "playlist") tracks = playlistTracks(person, collection);
  } else {
    const item = library.find((item) => item.id === id) ?? (id ? promoteMadeMusicFile(person, id) : null);
    if (item) {
      const current = resolveCollection(person.id, "queue")!;
      const index = current.items.findIndex((entry) => entry.media_id === item.id);
      if (index >= 0) { setPointer(current, index); return { ok: true, value: { id: item.id } }; }
      const currentLibrary = library.some((candidate) => candidate.id === item.id) ? library : [...library, item];
      tracks = albumOrder(currentLibrary.filter((candidate) => albumKey(candidate) === albumKey(item)));
      tracks = tracks.slice(tracks.findIndex((candidate) => candidate.id === item.id));
    }
  }
  if (shuffle) tracks = shuffled(tracks);
  if (!tracks.length) return { ok: false, status: 404, error: "No songs are available for this queue. Choose another song or album." };
  const now = new Date().toISOString();
  setItems(resolveCollection(person.id, "queue")!, tracks.map((item, position) => ({ media_id: item.id, position, added_at: now, status: null })), 0);
  return { ok: true, value: { id: tracks[0]!.id } };
}
