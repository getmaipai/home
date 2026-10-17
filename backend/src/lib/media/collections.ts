// MEDIA-PROGRESS-01 (design section 7): a person's media collections. One liked, one watch later and one queue exist for every
// person by construction (created the first time they are asked for; a unique index keeps it to one); playlists, watchlists and
// pins are made on request. A collection holds references with order, a status (watchlist) and, for the queue, a pointer. Everything
// here is the person's own: another person's collection is read only when it is shared to them, and never changed.
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { mediaCollections } from "@/db/schema";
import { nextHlc } from "@/lib/hlc";
import { newMediaCollectionId } from "@/lib/id";
import { collectionFromRow, type MediaCollection } from "./model";

export const SINGLETON_KINDS = ["liked", "watch_later", "queue"] as const;
export const MADE_KINDS = ["playlist", "watchlist", "pins"] as const;
export type CollectionKind = MediaCollection["kind"];
type Entry = MediaCollection["items"][number];

const DEFAULT_TITLES: Record<string, string> = { liked: "Liked", watch_later: "Watch later", queue: "Up next" };

/** Makes the person's three standing collections if they are not there yet. Safe to call every time. */
export function ensureStandingCollections(personId: string): void {
  const have = new Set(db.select({ kind: mediaCollections.kind }).from(mediaCollections).where(and(eq(mediaCollections.personId, personId), isNull(mediaCollections.deletedAt))).all().map((r) => r.kind));
  const now = new Date().toISOString();
  for (const kind of SINGLETON_KINDS) {
    if (have.has(kind)) continue;
    db.insert(mediaCollections).values({ id: newMediaCollectionId(), personId, kind, title: DEFAULT_TITLES[kind]!, createdAt: now, hlc: nextHlc(), provenance: `person:${personId}` }).onConflictDoNothing().run();
  }
}

export function listCollections(personId: string, kind?: CollectionKind): MediaCollection[] {
  ensureStandingCollections(personId);
  const rows = db.select().from(mediaCollections).where(and(eq(mediaCollections.personId, personId), isNull(mediaCollections.deletedAt))).all();
  return rows.map(collectionFromRow).filter((c) => !kind || c.kind === kind).sort((a, b) => a.created_at.localeCompare(b.created_at));
}

/** `liked`, `watch_later` and `queue` name the person's own standing collection; anything else is an id of one of their own. */
export function resolveCollection(personId: string, idOrKind: string): MediaCollection | null {
  ensureStandingCollections(personId);
  const where = (SINGLETON_KINDS as readonly string[]).includes(idOrKind) ? and(eq(mediaCollections.personId, personId), eq(mediaCollections.kind, idOrKind)) : and(eq(mediaCollections.id, idOrKind), eq(mediaCollections.personId, personId));
  const row = db.select().from(mediaCollections).where(and(where, isNull(mediaCollections.deletedAt))).get();
  return row ? collectionFromRow(row) : null;
}

export function createCollection(personId: string, kind: (typeof MADE_KINDS)[number], title: string): MediaCollection {
  const id = newMediaCollectionId();
  db.insert(mediaCollections).values({ id, personId, kind, title: title.trim() || "Untitled", createdAt: new Date().toISOString(), hlc: nextHlc(), provenance: `person:${personId}` }).run();
  return collectionFromRow(db.select().from(mediaCollections).where(eq(mediaCollections.id, id)).get()!);
}

function save(id: string, patch: Partial<typeof mediaCollections.$inferInsert>): MediaCollection {
  db.update(mediaCollections).set({ ...patch, hlc: nextHlc() }).where(eq(mediaCollections.id, id)).run();
  return collectionFromRow(db.select().from(mediaCollections).where(eq(mediaCollections.id, id)).get()!);
}

const renumber = (items: Entry[]): Entry[] => items.map((entry, index) => ({ ...entry, position: index }));

export function setItems(collection: MediaCollection, items: Entry[], pointer?: number | null): MediaCollection {
  const next = renumber(items);
  const keep = pointer === undefined ? collection.pointer : pointer;
  return save(collection.id, { items: JSON.stringify(next), pointer: next.length === 0 ? null : keep === null ? null : Math.min(keep, next.length - 1) });
}

/** Adds a title (or, if it is there already, updates its status). `at` places it; the default is the end. */
export function addItem(collection: MediaCollection, mediaId: string, options: { at?: number; status?: Entry["status"] } = {}): MediaCollection {
  const items = [...collection.items];
  const existing = items.findIndex((entry) => entry.media_id === mediaId);
  const status = options.status ?? (collection.kind === "watchlist" ? "want" : null);
  if (existing >= 0) {
    items[existing] = { ...items[existing]!, status: options.status ?? items[existing]!.status };
    return setItems(collection, items);
  }
  const entry: Entry = { media_id: mediaId, added_at: new Date().toISOString(), position: 0, status };
  items.splice(Math.min(Math.max(options.at ?? items.length, 0), items.length), 0, entry);
  // The queue's pointer keeps pointing at the same title when something is inserted before it.
  const pointer = collection.pointer !== null && options.at !== undefined && options.at <= collection.pointer ? collection.pointer + 1 : collection.pointer;
  return setItems(collection, items, pointer);
}

export function removeItemFrom(collection: MediaCollection, mediaId: string): MediaCollection {
  const index = collection.items.findIndex((entry) => entry.media_id === mediaId);
  if (index < 0) return collection;
  const items = collection.items.filter((entry) => entry.media_id !== mediaId);
  let pointer = collection.pointer;
  if (pointer !== null && index < pointer) pointer -= 1;
  return setItems(collection, items, pointer);
}

/** Puts the entries in the given order; titles not named keep their relative order at the end. */
export function reorderItems(collection: MediaCollection, mediaIds: readonly string[]): MediaCollection {
  const byId = new Map(collection.items.map((entry) => [entry.media_id, entry]));
  const named = mediaIds.map((id) => byId.get(id)).filter((entry): entry is Entry => entry !== undefined);
  const rest = collection.items.filter((entry) => !mediaIds.includes(entry.media_id));
  const items = [...named, ...rest];
  const current = collection.pointer !== null ? collection.items[collection.pointer]?.media_id : undefined;
  const pointer = current ? items.findIndex((entry) => entry.media_id === current) : collection.pointer;
  return setItems(collection, items, pointer === -1 ? null : pointer);
}

export function renameCollection(collection: MediaCollection, title: string): MediaCollection {
  return save(collection.id, { title: title.trim() || collection.title });
}

export function setPointer(collection: MediaCollection, pointer: number | null): MediaCollection {
  return save(collection.id, { pointer: pointer === null ? null : Math.min(Math.max(pointer, 0), Math.max(collection.items.length - 1, 0)) });
}

export function setSharedTo(collection: MediaCollection, sharedTo: MediaCollection["shared_to"]): MediaCollection {
  return save(collection.id, { sharedTo: sharedTo === null ? null : JSON.stringify(sharedTo) });
}

/** Made collections go to the trash; the three standing ones cannot be deleted. */
export function deleteCollection(collection: MediaCollection): boolean {
  if ((SINGLETON_KINDS as readonly string[]).includes(collection.kind)) return false;
  const now = new Date();
  save(collection.id, { deletedAt: now.toISOString(), trashUntil: new Date(now.getTime() + 30 * 24 * 3600 * 1000).toISOString() });
  return true;
}

/** Collections other people shared with this person (to the household or to them). */
export function sharedWith(personId: string): MediaCollection[] {
  return db.select().from(mediaCollections).where(isNull(mediaCollections.deletedAt)).all().map(collectionFromRow)
    .filter((c) => c.person_id !== personId && (c.shared_to === "household" || (Array.isArray(c.shared_to) && c.shared_to.includes(personId))));
}
