// PARITY-01 (Music): the Library as one list (songs, albums, artists, playlists) with sort and filter chips, the person's pins (up to six),
// Play next and Add to queue, and recent searches. Everything is the person's own and stays on this hub: pins and recent searches are
// two private `pins` collections of theirs (an album, artist or search is text, not a media id, so each entry is kept as `media-` plus the
// text in hex, which is a valid collection entry; `keysOf` and `saveKeys` are the only readers and writers), and the queue is the same `queue` collection the stage's Up next list reads.
import type { PersonRow } from "@/types";
import { mediaBandOf, trips } from "./band";
import { addItem, createCollection, listCollections, removeItemFrom, resolveCollection, setItems } from "./collections";
import { artistKey, groupTracks } from "./music";
import type { MediaCollection, MediaItem } from "./model";
import { recentProgress } from "./progress";
import { albumTile, musicLibrary, playlistTile, readableIn, trackRows, tileOfArtist, visiblePlaylists, type ActionResult, type DataParams } from "./appHost";

export const MUSIC_PIN_MAX = 6;
export const MUSIC_SEARCH_MAX = 10;
const PINS_TITLE = "music:pins";
const SEARCHES_TITLE = "music:recent-searches";

/** The person's own private collection with this title, made the first time it is written. */
function ownCollection(person: PersonRow, title: string, make: boolean): MediaCollection | null {
  const found = listCollections(person.id, "pins").find((collection) => collection.title === title);
  return found ?? (make ? createCollection(person.id, "pins", title) : null);
}
const encode = (text: string): string => `media-${Buffer.from(text, "utf8").toString("hex")}`;
const decode = (id: string): string => Buffer.from(id.slice("media-".length), "hex").toString("utf8");
const keysOf = (person: PersonRow, title: string): string[] => (ownCollection(person, title, false)?.items ?? []).map((entry) => decode(entry.media_id));
const saveKeys = (person: PersonRow, title: string, keys: string[]): void => {
  const now = new Date().toISOString();
  setItems(ownCollection(person, title, true)!, keys.map((key, position) => ({ media_id: encode(key), added_at: now, position, status: null })));
};

const pinKeys = (person: PersonRow): string[] => keysOf(person, PINS_TITLE);

/** Whether a pin key names something this person can read now: `track:<id>`, `album:<key>`, `artist:<key>` or `playlist:<id>`. */
function pinTargetExists(person: PersonRow, key: string): boolean {
  const split = key.indexOf(":");
  const kind = key.slice(0, split), ref = key.slice(split + 1);
  if (split < 1 || !ref) return false;
  if (kind === "track") return readableIn(person, "music", ref)?.kind === "track";
  if (kind === "album" || kind === "artist") return groupTracks(musicLibrary(person), kind).has(ref);
  if (kind === "playlist") return visiblePlaylists(person).some((collection) => collection.id === ref);
  return false;
}

/** Pin or unpin one library entry. At most six pins per person; pinning a seventh asks the person to unpin one. */
export function pinMusicItem(person: PersonRow, args: Record<string, unknown>): ActionResult<{ key: string; on: boolean }> {
  const key = typeof args.key === "string" ? args.key : "";
  const on = args.on === true || args.on === "true" || args.op === "pin";
  const off = args.on === false || args.on === "false" || args.op === "unpin";
  if (!on && !off) return { ok: false, status: 400, error: "Choose Pin or Unpin." };
  if (off) {
    saveKeys(person, PINS_TITLE, pinKeys(person).filter((have) => have !== key));
    return { ok: true, value: { key, on: false } };
  }
  if (!pinTargetExists(person, key)) return { ok: false, status: 404, error: "That item is not in your library any more. Go back to Your Library and choose another." };
  const have = pinKeys(person);
  if (have.includes(key)) return { ok: true, value: { key, on: true } };
  if (have.length >= MUSIC_PIN_MAX) return { ok: false, status: 422, error: `You can pin up to ${MUSIC_PIN_MAX} items. Unpin one first, then pin this one.` };
  saveKeys(person, PINS_TITLE, [...have, key]);
  return { ok: true, value: { key, on: true } };
}

/** Play next puts a song right after the one playing; Add to queue puts it at the end. Only this person's queue changes. */
export function musicQueueAction(person: PersonRow, args: Record<string, unknown>): ActionResult<{ id: string; label: string }> {
  if (args.op !== "play_next" && args.op !== "add") return { ok: false, status: 400, error: "Choose Play next or Add to queue." };
  const item = typeof args.media_id === "string" ? readableIn(person, "music", args.media_id) : null;
  if (!item || item.kind !== "track") return { ok: false, status: 404, error: "That song is not available. Go back to the library and choose another." };
  const queue = resolveCollection(person.id, "queue")!;
  const playing = queue.pointer !== null ? queue.items[queue.pointer]?.media_id : undefined;
  if (playing === item.id) return { ok: true, value: { id: item.id, label: "Playing now" } };
  const without = removeItemFrom(queue, item.id);
  if (args.op === "add") addItem(without, item.id);
  else addItem(without, item.id, { at: without.pointer === null ? 0 : without.pointer + 1 });
  return { ok: true, value: { id: item.id, label: args.op === "add" ? "Added to Up next" : "Playing next" } };
}

/** Remember one search the person ran: newest first, once each, the latest ten. */
export function recordMusicSearch(person: PersonRow, args: Record<string, unknown>): ActionResult<{ count: number }> {
  const q = typeof args.q === "string" ? args.q.trim().slice(0, 80) : "";
  const have = keysOf(person, SEARCHES_TITLE);
  if (q.length < 2) return { ok: true, value: { count: have.length } };
  const next = [q, ...have.filter((old) => old.toLocaleLowerCase() !== q.toLocaleLowerCase())].slice(0, MUSIC_SEARCH_MAX);
  saveKeys(person, SEARCHES_TITLE, next);
  return { ok: true, value: { count: next.length } };
}

export function clearMusicSearches(person: PersonRow): ActionResult<{ count: number }> {
  if (ownCollection(person, SEARCHES_TITLE, false)) saveKeys(person, SEARCHES_TITLE, []);
  return { ok: true, value: { count: 0 } };
}

function recentSearchRows(person: PersonRow): { as_of: string; rows: Array<{ key: string; label: string }> } {
  const adult = mediaBandOf(person) === "adult";
  const rows = keysOf(person, SEARCHES_TITLE).filter((q) => adult || !trips(q)).map((q) => ({ key: q, label: q }));
  return { as_of: new Date().toISOString(), rows };
}

type Entry = { row: Record<string, unknown>; title: string; creator: string; rank: number; added: string };
const SORTS = ["recents", "a-z", "creator"] as const;
const KINDS = ["all", "songs", "albums", "artists", "playlists"] as const;

/** The Library's one list. `sort` is recents (played last, then added last), a-z (title) or creator; `kind` narrows to one kind. Pinned rows carry `pinned: true`. */
function libraryRows(person: PersonRow, params: DataParams): Array<Record<string, unknown>> {
  const sort = (SORTS as readonly string[]).includes(params.sort ?? "") ? params.sort! : "recents";
  const kind = (KINDS as readonly string[]).includes(params.kind ?? "") ? params.kind! : "all";
  const library = musicLibrary(person);
  const rankOf = new Map(recentProgress(person.id, 1000).map((progress, index) => [progress.media_id, index]));
  const best = (tracks: readonly MediaItem[]) => tracks.reduce((low, item) => Math.min(low, rankOf.get(item.id) ?? Number.POSITIVE_INFINITY), Number.POSITIVE_INFINITY);
  const newest = (tracks: readonly MediaItem[]) => tracks.reduce((latest, item) => (item.added_at > latest ? item.added_at : latest), "");
  const pins = new Set(pinKeys(person));
  const albums = groupTracks(library, "album"), artists = groupTracks(library, "artist");
  const entries: Entry[] = [];
  const push = (route: string, label: string, pinKey: string, tile: Record<string, unknown>, creator: string, line: string, tracks: readonly MediaItem[], extra: Record<string, unknown> = {}, added = newest(tracks)) => {
    entries.push({ title: String(tile.title), creator, rank: best(tracks), added, row: { ...tile, ...extra, route, kind_label: label, pin_key: pinKey, pinned: pins.has(pinKey), is_song: route === "play", subtitle_line: line } });
  };
  if (kind === "all" || kind === "songs") {
    const rows = trackRows(person, library);
    library.forEach((item, index) => {
      const artist = artistKey(item);
      push("play", "Song", `track:${item.id}`, rows[index]!, artist, `Song · ${artist}`, [item], { artist_id: artist });
    });
  }
  if (kind === "all" || kind === "albums") {
    for (const [id, tracks] of albums) {
      const tile = albumTile(person, id, tracks);
      const owner = String(tile.channel ?? "");
      push("album", "Album", `album:${id}`, tile, owner, `Album · ${owner}`, tracks, { artist_id: artists.has(owner) ? owner : artistKey(tracks[0]!) });
    }
  }
  if (kind === "all" || kind === "artists") {
    for (const [id, tracks] of artists) push("artist", "Artist", `artist:${id}`, tileOfArtist(person, tracks), id, "Artist", tracks, { artist_id: id });
  }
  if (kind === "all" || kind === "playlists") {
    for (const collection of visiblePlaylists(person)) {
      const tracks = collection.items.flatMap((entry) => library.filter((item) => item.id === entry.media_id));
      push("playlist", "Playlist", `playlist:${collection.id}`, playlistTile(person, collection), "Playlist", `Playlist · ${String(playlistTile(person, collection).channel ?? "")}`, tracks, { queue_mode: "playlist" }, collection.created_at);
    }
  }
  const byTitle = (a: Entry, b: Entry) => a.title.localeCompare(b.title);
  entries.sort(sort === "a-z" ? byTitle : sort === "creator" ? (a, b) => a.creator.localeCompare(b.creator) || byTitle(a, b) : (a, b) => (a.rank === b.rank ? b.added.localeCompare(a.added) || byTitle(a, b) : a.rank - b.rank));
  return entries.map((entry) => entry.row);
}

/** Music's `songs` data id, scopes `library` (the Library list) and `recent-searches` (Search's recents); null for any other ask. */
export function musicLibraryData(person: PersonRow, dataId: string, params: DataParams): unknown | null {
  if (dataId !== "songs") return null;
  if (params.scope === "library") return libraryRows(person, params);
  if (params.scope === "recent-searches") return recentSearchRows(person);
  return null;
}
