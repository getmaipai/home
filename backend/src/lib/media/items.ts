// MEDIA-LIB-01: reading and changing media items for the routes: paged lists by kind (filtered by band and source visibility),
// one item with its parts and the item it is linked to, groups (shows, albums, authors), and a person's removal of an item.
import { and, asc, desc, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { dirname } from "node:path";
import { db } from "@/db";
import { mediaItems, mediaSources } from "@/db/schema";
import { nextHlc } from "@/lib/hlc";
import type { PersonRow } from "@/types";
import { allowedBandsFor, bandAllows } from "./band";
import { readableItem, sourceVisibleTo } from "./access";
import { itemFromRow, sourceFromRow, type MediaItem, type MediaItemRow } from "./model";
import { matchKey } from "./parsers/text";
import { archivePath, TRASH_DAYS } from "./sources";

export const KINDS: readonly MediaItem["kind"][] = ["video", "episode", "film", "track", "podcast_episode", "book", "audiobook", "chapter"];

/** The ids of the live sources `actor` may see. */
export function visibleSourceIds(actor: PersonRow): string[] {
  return db
    .select()
    .from(mediaSources)
    .where(isNull(mediaSources.deletedAt))
    .all()
    .map(sourceFromRow)
    .filter((source) => sourceVisibleTo(source, actor))
    .map((source) => source.id);
}

export interface ItemQuery {
  kind?: MediaItem["kind"];
  sourceId?: string;
  parentId?: string;
  series?: string;
  album?: string;
  q?: string;
  sort?: "default" | "title" | "added";
  limit: number;
  offset: number;
}

export interface ItemPage {
  items: MediaItem[];
  total: number;
  next_offset: number | null;
}

function orderFor(query: ItemQuery): SQL[] {
  if (query.sort === "added") return [desc(mediaItems.addedAt)];
  if (query.sort === "title") return [asc(sql`lower(${mediaItems.title})`)];
  switch (query.kind) {
    case "episode": return [asc(mediaItems.series), asc(mediaItems.season), asc(mediaItems.episode)];
    case "track": return [asc(mediaItems.albumArtist), asc(mediaItems.album), asc(mediaItems.discNo), asc(mediaItems.trackNo), asc(mediaItems.title)];
    case "chapter": return [asc(mediaItems.trackNo)];
    default: return [asc(sql`lower(${mediaItems.title})`)];
  }
}

/** A page of items `actor` may see. Hidden and trashed items and chapter parts (unless a parent is asked for) are left out. */
export function listItems(actor: PersonRow, query: ItemQuery): ItemPage {
  const sources = visibleSourceIds(actor);
  if (sources.length === 0) return { items: [], total: 0, next_offset: null };
  const conditions: SQL[] = [
    isNull(mediaItems.deletedAt), eq(mediaItems.hidden, false), inArray(mediaItems.sourceId, sources), inArray(mediaItems.bandOk, allowedBandsFor(actor)),
  ];
  if (query.kind) conditions.push(eq(mediaItems.kind, query.kind));
  else if (!query.parentId) conditions.push(sql`${mediaItems.kind} <> 'chapter'`);
  if (query.sourceId) conditions.push(eq(mediaItems.sourceId, query.sourceId));
  if (query.parentId) conditions.push(eq(mediaItems.parentId, query.parentId));
  if (query.series) conditions.push(eq(mediaItems.series, query.series));
  if (query.album) conditions.push(eq(mediaItems.album, query.album));
  const text = query.q?.trim();
  if (text) {
    const pattern = `%${text.replace(/[\\%_]/g, "\\$&")}%`;
    conditions.push(or(...[mediaItems.title, mediaItems.subtitle, mediaItems.series, mediaItems.album, mediaItems.artist, mediaItems.author].map((column) => sql`${column} LIKE ${pattern} ESCAPE '\\'`))!);
  }
  const where = and(...conditions);
  const total = db.select({ n: sql<number>`count(*)` }).from(mediaItems).where(where).get()?.n ?? 0;
  const minor = actor.role === "guest" || allowedBandsFor(actor).length < 3;
  // Over-read a little for a minor: the floor runs again on the words and may drop a row or two.
  const rows = db.select().from(mediaItems).where(where).orderBy(...orderFor(query)).limit(query.limit + (minor ? query.limit : 0)).offset(query.offset).all();
  const items: MediaItem[] = [];
  let consumed = 0;
  for (const row of rows) {
    consumed++;
    const item = itemFromRow(row);
    if (bandAllows(actor, item)) items.push(item);
    if (items.length >= query.limit) break;
  }
  const nextOffset = query.offset + consumed;
  return { items, total, next_offset: nextOffset < total ? nextOffset : null };
}

export interface ItemDetail {
  item: MediaItem;
  /** The files of a folder audiobook, in order. */
  parts: MediaItem[];
  /** The same title as a book or an audiobook in the same folder (design section 8: "listen" and "read" on one detail page). */
  linked: MediaItem[];
  page_count: number | null;
}

export function linkedItems(actor: PersonRow, row: MediaItemRow): MediaItem[] {
  if ((row.kind !== "book" && row.kind !== "audiobook") || !row.locRootId || !row.locPath || !row.subtitle) return [];
  const folder = dirname(row.locPath);
  const wantTitle = matchKey(row.title);
  const wantSubtitle = matchKey(row.subtitle);
  const candidates = db
    .select()
    .from(mediaItems)
    .where(and(eq(mediaItems.locRootId, row.locRootId), inArray(mediaItems.kind, ["book", "audiobook"]), isNull(mediaItems.deletedAt), eq(mediaItems.hidden, false)))
    .all();
  return candidates
    .filter((other) => other.id !== row.id && other.kind !== row.kind && other.locPath !== null && dirname(other.locPath) === folder && matchKey(other.title) === wantTitle && other.subtitle !== null && matchKey(other.subtitle) === wantSubtitle)
    .map(itemFromRow)
    .filter((item) => readableItem(actor, item.id) !== null);
}

export function itemDetail(actor: PersonRow, item: MediaItem): ItemDetail {
  const row = db.select().from(mediaItems).where(eq(mediaItems.id, item.id)).get()!;
  const parts = db
    .select()
    .from(mediaItems)
    .where(and(eq(mediaItems.parentId, item.id), isNull(mediaItems.deletedAt)))
    .orderBy(asc(mediaItems.trackNo))
    .all()
    .map(itemFromRow)
    .filter((part) => readableItem(actor, part.id) !== null);
  return { item, parts, linked: linkedItems(actor, row), page_count: row.pages };
}

export interface MediaGroup {
  key: string;
  count: number;
  /** An item to take artwork from. */
  sample_id: string;
  year: number | null;
  subtitle: string | null;
}

/** Shows (by series), albums (by album) or authors/artists: one row each, newest first. */
export function listGroups(actor: PersonRow, by: "series" | "album" | "author" | "artist", kind: MediaItem["kind"] | undefined): MediaGroup[] {
  const sources = visibleSourceIds(actor);
  if (sources.length === 0) return [];
  const column = { series: mediaItems.series, album: mediaItems.album, author: mediaItems.author, artist: mediaItems.artist }[by];
  const conditions: SQL[] = [isNull(mediaItems.deletedAt), eq(mediaItems.hidden, false), inArray(mediaItems.sourceId, sources), inArray(mediaItems.bandOk, allowedBandsFor(actor)), sql`${column} IS NOT NULL`];
  if (kind) conditions.push(eq(mediaItems.kind, kind));
  const rows = db.select().from(mediaItems).where(and(...conditions)).orderBy(asc(sql`lower(${column})`), asc(mediaItems.season), asc(mediaItems.episode), asc(mediaItems.trackNo)).all();
  const groups = new Map<string, MediaGroup>();
  for (const row of rows) {
    const item = itemFromRow(row);
    if (!bandAllows(actor, item)) continue;
    const key = by === "series" ? item.series! : by === "album" ? item.album! : by === "author" ? item.author! : item.artist!;
    const group = groups.get(key);
    if (group) group.count++;
    else groups.set(key, { key, count: 1, sample_id: item.id, year: item.year, subtitle: by === "album" ? item.album_artist ?? item.artist : null });
  }
  return [...groups.values()];
}

/** A person removes an item: it goes to the trash and its path is remembered, so a re-scan never brings it back ("deleted stays gone"). */
export function removeItem(id: string): boolean {
  const row = db.select().from(mediaItems).where(eq(mediaItems.id, id)).get();
  if (!row || row.deletedAt) return false;
  const now = new Date();
  const until = new Date(now.getTime() + TRASH_DAYS * 24 * 3600 * 1000);
  const ids = [row.id, ...db.select({ id: mediaItems.id }).from(mediaItems).where(eq(mediaItems.parentId, row.id)).all().map((part) => part.id)];
  db.update(mediaItems).set({ deletedAt: now.toISOString(), trashUntil: until.toISOString(), missingSince: null, hlc: nextHlc() }).where(inArray(mediaItems.id, ids)).run();
  if (row.locPath) archivePath(row.sourceId, row.locPath);
  return true;
}

export function hideItem(id: string, hidden: boolean): boolean {
  const result = db.update(mediaItems).set({ hidden, hlc: nextHlc() }).where(eq(mediaItems.id, id)).returning({ id: mediaItems.id }).all();
  return result.length > 0;
}

export function rowById(id: string): MediaItemRow | undefined {
  return db.select().from(mediaItems).where(eq(mediaItems.id, id)).get();
}

