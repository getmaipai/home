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
import { getPersonSettingValue, setValue } from "@/lib/settings";
import { albumTile, musicLibrary, playlistTile, readableIn, trackRows, tileOfArtist, visiblePlaylists, type ActionResult, type DataParams } from "./appHost";

export const MUSIC_PIN_MAX = 6;
export const MUSIC_SEARCH_MAX = 10;
const PINS_TITLE = "music:pins";
/** MEDIA-PARITY-02: the song ids this browser or phone says it keeps for offline play, one private list per device (a hashed session or a paired device). */
const KEPT_TITLE_PREFIX = "music:kept:";
export const MUSIC_KEPT_MAX = 500;
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
  setItems(ownCollection(person, title, true)!, keys.map((key, position) => ({ media_id: encode(key), added_at: now, position, status: null, votes: [] })));
};

const pinKeys = (person: PersonRow): string[] => keysOf(person, PINS_TITLE);

/** Whether a pin key names something this person can read now: `track:<id>`, `album:<key>`, `artist:<key>` or `playlist:<id>`. */
function pinTargetExists(person: PersonRow, key: string): boolean {
  const split = key.indexOf(":");
  const kind = key.slice(0, split), ref = key.slice(split + 1);
  if (split < 1 || !ref) return false;
  if (kind === "track") return readableIn(person, "audio", ref)?.kind === "track";
  if (kind === "album" || kind === "artist") return groupTracks(musicLibrary(person), kind).has(ref);
  if (kind === "playlist") return visiblePlaylists(person).some((collection) => collection.id === ref);
  return false;
}

/** Pin or unpin one library entry. At most six pins per person; pinning a seventh asks the person to unpin one. */
export function pinMusicItem(person: PersonRow, args: Record<string, unknown>): ActionResult<{ key: string; on: boolean }> {
  const key = typeof args.key === "string" ? args.key : "";
  // `toggle` is the Library row's one Pin button: it pins what is not pinned and unpins what is.
  const toggled = args.op === "toggle" ? !pinKeys(person).includes(key) : null;
  const on = toggled === true || args.on === true || args.on === "true" || args.op === "pin";
  const off = toggled === false || args.on === false || args.on === "false" || args.op === "unpin";
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
  if (args.op === "reorder") return reorderMusicQueue(person, args);
  if (args.op !== "play_next" && args.op !== "add") return { ok: false, status: 400, error: "Choose Play next or Add to queue." };
  const item = typeof args.media_id === "string" ? readableIn(person, "audio", args.media_id) : null;
  if (!item || item.kind !== "track") return { ok: false, status: 404, error: "That song is not available. Go back to the library and choose another." };
  const queue = resolveCollection(person.id, "queue")!;
  const playing = queue.pointer !== null ? queue.items[queue.pointer]?.media_id : undefined;
  if (playing === item.id) return { ok: true, value: { id: item.id, label: "Playing now" } };
  const without = removeItemFrom(queue, item.id);
  if (args.op === "add") addItem(without, item.id);
  else addItem(without, item.id, { at: without.pointer === null ? 0 : without.pointer + 1 });
  return { ok: true, value: { id: item.id, label: args.op === "add" ? "Added to Up next" : "Playing next" } };
}

/** The Up next list was dragged: `ids` is the new order of the songs shown (the ones after the playing song). The playing song and what came before it stay put. */
function reorderMusicQueue(person: PersonRow, args: Record<string, unknown>): ActionResult<{ id: string; label: string }> {
  const ids = Array.isArray(args.ids) && args.ids.every((entry) => typeof entry === "string") ? (args.ids as string[]) : null;
  if (!ids) return { ok: false, status: 400, error: "Drag the songs into the order you want, then try again." };
  const queue = resolveCollection(person.id, "queue")!;
  const inQueue = new Set(queue.items.map((entry) => entry.media_id));
  const named = [...new Set(ids)].filter((id) => inQueue.has(id));
  if (named.length === 0) return { ok: false, status: 404, error: "Those songs are no longer in Up next. Open Now playing and look at the list again." };
  const upTo = queue.pointer === null ? -1 : queue.pointer;
  const played = queue.items.slice(0, upTo + 1).filter((entry) => !named.includes(entry.media_id));
  const rest = queue.items.slice(upTo + 1).filter((entry) => !named.includes(entry.media_id));
  const byId = new Map(queue.items.map((entry) => [entry.media_id, entry]));
  const items = [...played, ...named.map((id) => byId.get(id)!), ...rest];
  const current = queue.pointer === null ? undefined : queue.items[queue.pointer]?.media_id;
  const pointer = current === undefined ? null : items.findIndex((entry) => entry.media_id === current);
  setItems(queue, items, pointer === -1 ? null : pointer);
  return { ok: true, value: { id: named[0]!, label: "Up next reordered" } };
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

/** The device told us which songs it keeps for offline play (only songs this person may read, at most 500). The list replaces the device's last one. */
export function reportKeptSongs(person: PersonRow, device: string, args: Record<string, unknown>): ActionResult<{ count: number }> {
  if (!Array.isArray(args.ids) || args.ids.some((id) => typeof id !== "string")) return { ok: false, status: 400, error: "Say which songs this device keeps, then try again." };
  const ids = [...new Set(args.ids as string[])].slice(0, MUSIC_KEPT_MAX).filter((id) => readableIn(person, "audio", id)?.kind === "track");
  saveKeys(person, `${KEPT_TITLE_PREFIX}${device}`, ids);
  return { ok: true, value: { count: ids.length } };
}
const keptOn = (person: PersonRow, device: string | undefined): Set<string> => new Set(device ? keysOf(person, `${KEPT_TITLE_PREFIX}${device}`) : []);

type Entry = { row: Record<string, unknown>; title: string; creator: string; rank: number; added: string };
const SORTS = ["recents", "az", "creator"] as const;
type LibrarySort = (typeof SORTS)[number];
/** The page says `az`; an older page or caller may still say `a-z`. Anything else is not a sort. */
const asSort = (value: unknown): LibrarySort | null => (value === "a-z" ? "az" : (SORTS as readonly unknown[]).includes(value) ? (value as LibrarySort) : null);

/** The person's saved Library order (setting `music.library_sort`), Recents until they choose one. */
export function savedLibrarySort(person: PersonRow): LibrarySort {
  return asSort(getPersonSettingValue(person, "music.library_sort")) ?? "recents";
}

/** The sort chip wrote a new choice: keep it for this person so the Library opens the same way next time. */
function rememberLibrarySort(person: PersonRow, sort: LibrarySort): void {
  if (savedLibrarySort(person) !== sort) setValue(person, `person:${person.id}`, "music.library_sort", sort);
}

/** The Library page opens on the person's saved order: their choice is moved to the front of the sort options, and the first option is the page's default. */
export function fillLibraryPage(person: PersonRow, page: Record<string, unknown>): void {
  const shelf = (page.body as Array<Record<string, unknown>> | undefined)?.find((node) => node.type === "media_shelf");
  const options = (shelf?.sort as { options?: Array<{ value: string }> } | undefined)?.options;
  if (!options) return;
  const saved = savedLibrarySort(person);
  const at = options.findIndex((option) => option.value === saved);
  if (at > 0) options.unshift(...options.splice(at, 1));
}
const KINDS = ["all", "songs", "albums", "artists", "playlists", "downloaded"] as const;

/** The Library's one list. `sort` is recents (played last, then added last), a-z (title) or creator; `kind` narrows to one kind. Pinned rows carry `pinned: true`. */
function libraryRows(person: PersonRow, params: DataParams): Array<Record<string, unknown>> {
  const asked = asSort(params.sort);
  if (asked) rememberLibrarySort(person, asked);
  const sort = asked ?? savedLibrarySort(person);
  const kind = (KINDS as readonly string[]).includes(params.kind ?? "") ? params.kind! : "all";
  const library = musicLibrary(person);
  const rankOf = new Map(recentProgress(person.id, 1000).map((progress, index) => [progress.media_id, index]));
  const best = (tracks: readonly MediaItem[]) => tracks.reduce((low, item) => Math.min(low, rankOf.get(item.id) ?? Number.POSITIVE_INFINITY), Number.POSITIVE_INFINITY);
  const newest = (tracks: readonly MediaItem[]) => tracks.reduce((latest, item) => (item.added_at > latest ? item.added_at : latest), "");
  const pins = new Set(pinKeys(person));
  const kept = keptOn(person, params.device);
  const albums = groupTracks(library, "album"), artists = groupTracks(library, "artist");
  const entries: Entry[] = [];
  const push = (route: string, label: string, pinKey: string, tile: Record<string, unknown>, creator: string, line: string, tracks: readonly MediaItem[], extra: Record<string, unknown> = {}, added = newest(tracks)) => {
    entries.push({ title: String(tile.title), creator, rank: best(tracks), added, row: { ...tile, ...extra, route, kind_label: label, pin_key: pinKey, pinned: pins.has(pinKey), pin_label: pins.has(pinKey) ? "Unpin" : "Pin", is_song: route === "play",
      downloaded: route === "play" && kept.has(String(tile.id)), offline_label: kept.has(String(tile.id)) ? "Remove download" : "Save for offline", subtitle_line: line } });
  };
  if (kind === "all" || kind === "songs" || kind === "downloaded") {
    const rows = trackRows(person, library);
    library.forEach((item, index) => {
      if (kind === "downloaded" && !kept.has(item.id)) return;
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
  entries.sort(sort === "az" ? byTitle : sort === "creator" ? (a, b) => a.creator.localeCompare(b.creator) || byTitle(a, b) : (a, b) => (a.rank === b.rank ? b.added.localeCompare(a.added) || byTitle(a, b) : a.rank - b.rank));
  return entries.map((entry) => entry.row);
}

/** Music's `songs` data id, scopes `library` (the Library list) and `recent-searches` (Search's recents); null for any other ask. */
export function musicLibraryData(person: PersonRow, dataId: string, params: DataParams): unknown | null {
  if (dataId !== "songs") return null;
  if (params.scope === "library") return libraryRows(person, params);
  if (params.scope === "recent-searches") return recentSearchRows(person);
  return null;
}

export interface RecentSong { id: string; title: string; subtitle: string | null; artwork_url: string | null; played_at: string; duration_s: number | null }

/** SF-08c: the songs this person played lately for the Recent tab, newest first, each once. Only songs they may read; nothing else leaves. */
export function recentMusicSongs(person: PersonRow, limit = 30): RecentSong[] {
  const seen = new Set<string>();
  const rows: RecentSong[] = [];
  for (const progress of recentProgress(person.id, 200)) {
    const item = readableIn(person, "audio", progress.media_id);
    if (!item || item.kind !== "track" || seen.has(item.id)) continue;
    seen.add(item.id);
    rows.push({ id: item.id, title: item.title, subtitle: item.subtitle ?? null, artwork_url: item.artwork ? `/api/media/items/${encodeURIComponent(item.id)}/artwork` : null, played_at: progress.updated_at, duration_s: progress.duration_s ?? null });
    if (rows.length >= Math.min(Math.max(limit, 1), 100)) break;
  }
  return rows;
}
