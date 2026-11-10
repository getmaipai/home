// MEDIA-PARITY-02 (Videos): playlists of the household's own videos and AI-made clips. A video playlist is the shared `media-collection` record with
// `media_kind` "video", stored beside the Music playlists (lib/media/collections.ts). An entry is a saved video's id or a made clip's Library file id.
// The owner names members (people in the home) who can see the playlist and add videos to it; reordering, removing, renaming and deleting stay the owner's.
// Every read runs the reader's own gates (the age band, the Library's sharing and the Adult lock), so a playlist never shows anyone a video they could not
// open on their own, and no adult-only video is saved into a playlist a child or teen can read.
import { listActivePeople } from "@/lib/access";
import { speakerAgeBand } from "@/lib/ageBand";
import type { PersonRow } from "@/types";
import { mediaBandOf, trips } from "@/lib/media/band";
import { addItem, createCollection, deleteCollection, listCollections, playlistsWithMember, removeItemFrom, renameCollection, reorderItems, resolveCollection, setPlaylistMembers } from "@/lib/media/collections";
import type { MediaCollection, MediaItem } from "@/lib/media/model";
import { madeFiles, madeVideoRow, readableIn, rowOf, contextFor, type ActionResult, type MediaRow } from "@/lib/media/appHost";

export type PlaylistResult = ActionResult<{ id: string; title: string; added?: boolean }>;

const isVideo = (collection: MediaCollection): boolean => collection.kind === "playlist" && collection.media_kind === "video";
const isAdult = (person: PersonRow): boolean => person.role !== "guest" && speakerAgeBand(person, new Date()) === "adult";
const TITLE_MAX = 100;

export const GONE: PlaylistResult = { ok: false, status: 404, error: "That playlist is not available. Go back to Playlists and choose another." };
export const VIDEO_GONE: PlaylistResult = { ok: false, status: 404, error: "That video is not available. Go back to Videos and choose another." };
const OWNER_ONLY: PlaylistResult = { ok: false, status: 403, error: "Only the person who made this playlist can change it. You can add videos to it." };
const ADULT_ONLY_LINE: PlaylistResult = { ok: false, status: 422, error: "This playlist is shared with a child or teen, so it cannot hold an adult-only video. Save it to a playlist only grown-ups share." };
const MINOR_HAS_ADULT_LINE: PlaylistResult = { ok: false, status: 422, error: "This playlist holds adult-only videos, so it cannot be shared with a child or teen. Take those videos out first." };

/** The video playlists this person owns. A minor never sees one whose name trips the floor. */
export function ownVideoPlaylists(person: PersonRow): MediaCollection[] {
  return listCollections(person.id, "playlist").filter((c) => isVideo(c) && (mediaBandOf(person) === "adult" || !trips(c.title)));
}

/** Video playlists other people own that name this person as a member. */
export function memberVideoPlaylists(person: PersonRow): MediaCollection[] {
  return playlistsWithMember(person.id).filter((c) => isVideo(c) && (mediaBandOf(person) === "adult" || !trips(c.title)));
}

/** A video playlist this person owns or belongs to, and whether they own it. */
export function videoPlaylistFor(person: PersonRow, id: string): { collection: MediaCollection; owner: boolean } | null {
  if (!id) return null;
  const own = resolveCollection(person.id, id);
  if (own && isVideo(own) && ownVideoPlaylists(person).some((c) => c.id === own.id)) return { collection: own, owner: true };
  const shared = memberVideoPlaylists(person).find((c) => c.id === id);
  return shared ? { collection: shared, owner: false } : null;
}

type MadeFile = ReturnType<typeof madeFiles>[number];

/** What one reader may open of a playlist's entries, in order: saved videos through the media read gate, made clips through the Library's own listing
 * (which already drops locked clips and clips shared with nobody they are). `adult` says whether the entry is adult-only. */
interface Resolved { id: string; row: MediaRow & Record<string, unknown>; adult: boolean }
export function resolveEntries(person: PersonRow, ids: readonly string[]): Resolved[] {
  let made: Map<string, MadeFile> | null = null;
  const madeMap = () => (made ??= new Map(madeFiles(person, "videos").map((file) => [file.id, file])));
  const saved: Array<{ id: string; item: MediaItem }> = [];
  const slots: Array<{ id: string; item?: MediaItem }> = [];
  for (const id of ids) {
    const item = readableIn(person, "videos", id);
    slots.push(item ? { id, item } : { id });
    if (item) saved.push({ id, item });
  }
  const context = contextFor(person, saved.map((entry) => entry.item));
  const out: Resolved[] = [];
  for (const slot of slots) {
    if (slot.item) { out.push({ id: slot.id, row: rowOf(slot.item, context) as Resolved["row"], adult: slot.item.band_ok === "adult" }); continue; }
    const file = madeMap().get(slot.id);
    if (!file) continue;
    const adult = file.audience === "adult-only";
    if (adult && !isAdult(person)) continue;
    out.push({ id: slot.id, row: madeVideoRow(file) as unknown as Resolved["row"], adult });
  }
  return out;
}

/** The entries of a playlist this person may open. */
export function playlistEntryRows(person: PersonRow, collection: MediaCollection): Array<MediaRow & Record<string, unknown>> {
  return resolveEntries(person, collection.items.map((entry) => entry.media_id)).map((entry, index) => ({ ...entry.row, playlist_id: collection.id, position: index + 1 }));
}

/** The people who can read a playlist: its owner and its members. */
function readersOf(collection: MediaCollection): PersonRow[] {
  const active = listActivePeople();
  return active.filter((p) => p.id === collection.person_id || collection.members.includes(p.id));
}

const hasMinorReader = (collection: MediaCollection): boolean => readersOf(collection).some((p) => !isAdult(p));

/** Whether any entry is adult-only, judged by the owner (who made the list). */
function holdsAdultOnly(owner: PersonRow, collection: MediaCollection): boolean {
  const asked = collection.items.map((entry) => entry.media_id);
  const open = new Set(resolveEntries(owner, asked).map((entry) => entry.id));
  // An entry the owner cannot open (a locked clip) cannot be judged here, so it counts as adult-only: the safe reading.
  return asked.some((id) => !open.has(id)) || resolveEntries(owner, asked).some((entry) => entry.adult);
}

function ownerOf(collection: MediaCollection): PersonRow | undefined {
  return listActivePeople().find((p) => p.id === collection.person_id);
}

/** A new empty playlist. A minor cannot pick a name that trips the floor. */
export function createVideoPlaylist(person: PersonRow, rawTitle: unknown): PlaylistResult {
  if (person.role === "guest") return { ok: false, status: 403, error: "Guests cannot make playlists. Ask a grown-up in the home." };
  const asked = typeof rawTitle === "string" ? rawTitle.trim().slice(0, TITLE_MAX) : "";
  const title = asked || `Playlist ${ownVideoPlaylists(person).length + 1}`;
  if (mediaBandOf(person) !== "adult" && trips(title)) return { ok: false, status: 422, error: "Pick another name for this playlist." };
  const made = createCollection(person.id, "playlist", title, "video");
  return { ok: true, value: { id: made.id, title: made.title } };
}

/** The playlist `Save to playlist` uses when the page names none: the newest one this person owns (one is made if there is none). */
function defaultTarget(person: PersonRow): MediaCollection | null {
  const newest = [...ownVideoPlaylists(person)].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  if (newest) return newest;
  if (person.role === "guest") return null;
  return createCollection(person.id, "playlist", "My playlist", "video");
}

/** Save to playlist: add a video to a named playlist (the person's own, or one they were added to), or to their newest. */
export function saveToVideoPlaylist(person: PersonRow, args: Record<string, unknown>): PlaylistResult {
  const mediaId = typeof args.media_id === "string" ? args.media_id : "";
  const named = typeof args.playlist_id === "string" ? args.playlist_id : "";
  const found = named ? videoPlaylistFor(person, named) : null;
  if (named && !found) return GONE;
  const entry = mediaId ? resolveEntries(person, [mediaId])[0] : undefined;
  if (!entry) return VIDEO_GONE;
  const collection = found?.collection ?? defaultTarget(person);
  if (!collection) return GONE;
  if (entry.adult && hasMinorReader(collection)) return ADULT_ONLY_LINE;
  const already = collection.items.some((item) => item.media_id === entry.id);
  if (!already) addItem(collection, entry.id);
  return { ok: true, value: { id: collection.id, title: collection.title, added: !already } };
}

export function removeFromVideoPlaylist(person: PersonRow, args: Record<string, unknown>): PlaylistResult {
  const found = videoPlaylistFor(person, typeof args.playlist_id === "string" ? args.playlist_id : "");
  if (!found) return GONE;
  if (!found.owner) return OWNER_ONLY;
  const mediaId = typeof args.media_id === "string" ? args.media_id : "";
  removeItemFrom(found.collection, mediaId);
  return { ok: true, value: { id: found.collection.id, title: found.collection.title } };
}

/** Put the videos in the order given. The kit sends only the keys; the playlist is named by `playlist_id` or, failing that, found as the one of the person's
 * own playlists that holds every key. Videos the person cannot open keep their places at the end. */
export function reorderVideoPlaylist(person: PersonRow, args: Record<string, unknown>): PlaylistResult {
  const raw = Array.isArray(args.ids) ? args.ids : null;
  if (!raw || raw.length === 0 || raw.some((id) => typeof id !== "string")) return { ok: false, status: 400, error: "Drag the videos into the order you want, then try again." };
  const ids = [...new Set(raw as string[])];
  const named = typeof args.playlist_id === "string" ? args.playlist_id : "";
  let found = named ? videoPlaylistFor(person, named) : null;
  if (!found && !named) {
    const own = ownVideoPlaylists(person).filter((c) => ids.every((id) => c.items.some((entry) => entry.media_id === id)));
    const exact = own.find((c) => c.items.length === ids.length) ?? own[0];
    found = exact ? { collection: exact, owner: true } : null;
  }
  if (!found) return GONE;
  if (!found.owner) return OWNER_ONLY;
  const open = new Set(resolveEntries(person, found.collection.items.map((entry) => entry.media_id)).map((entry) => entry.id));
  const asked = ids.filter((id) => open.has(id));
  const current = found.collection.items.map((entry) => entry.media_id);
  const order = [...asked, ...current.filter((id) => open.has(id) && !asked.includes(id))];
  let next = 0;
  reorderItems(found.collection, current.map((id) => (open.has(id) ? order[next++]! : id)));
  return { ok: true, value: { id: found.collection.id, title: found.collection.title } };
}

export function renameVideoPlaylist(person: PersonRow, args: Record<string, unknown>): PlaylistResult {
  const found = videoPlaylistFor(person, typeof args.playlist_id === "string" ? args.playlist_id : "");
  if (!found) return GONE;
  if (!found.owner) return OWNER_ONLY;
  const title = typeof args.title === "string" ? args.title.trim().slice(0, TITLE_MAX) : "";
  if (!title) return { ok: false, status: 400, error: "Type a name for the playlist, then try again." };
  if (mediaBandOf(person) !== "adult" && trips(title)) return { ok: false, status: 422, error: "Pick another name for this playlist." };
  const renamed = renameCollection(found.collection, title);
  return { ok: true, value: { id: renamed.id, title: renamed.title } };
}

export function deleteVideoPlaylist(person: PersonRow, args: Record<string, unknown>): PlaylistResult {
  const found = videoPlaylistFor(person, typeof args.playlist_id === "string" ? args.playlist_id : "");
  if (!found) return GONE;
  if (!found.owner) return OWNER_ONLY;
  deleteCollection(found.collection);
  return { ok: true, value: { id: found.collection.id, title: found.collection.title } };
}

/** The people the owner can add. A child owner shares nothing; a minor is added only to a playlist with no adult-only video. */
export function videoMemberCandidates(owner: PersonRow, collection: MediaCollection): Array<{ id: string; name: string; avatar_url: null; avatar_seed: string }> {
  if (collection.person_id !== owner.id || owner.role === "guest" || mediaBandOf(owner) === "child") return [];
  const adultOnly = holdsAdultOnly(owner, collection);
  return listActivePeople()
    .filter((p) => p.id !== owner.id && p.role !== "guest" && !collection.members.includes(p.id) && (isAdult(owner) || isAdult(p)) && (!adultOnly || isAdult(p)))
    .map((p) => ({ id: p.id, name: p.displayName, avatar_url: null, avatar_seed: p.avatarSeed }));
}

export function videoPlaylistVisibility(person: PersonRow, collection: MediaCollection) {
  const active = new Map(listActivePeople().map((p) => [p.id, p]));
  const people = collection.members.flatMap((id) => {
    const member = active.get(id);
    return member ? [{ id, name: member.displayName, avatar_url: null, avatar_seed: member.avatarSeed }] : [];
  });
  const owner = collection.person_id === person.id;
  return { mode: people.length ? "shared" as const : "private" as const, people: owner || people.some((p) => p.id === person.id) ? people : [], can_manage: owner && person.role !== "guest" && mediaBandOf(person) !== "child" };
}

/** The owner adds or removes a member, or makes the playlist private again (the Share panel's three calls). */
export function changeVideoPlaylistMembers(person: PersonRow, op: "add" | "remove" | "private", id: string, target?: string): PlaylistResult {
  const found = videoPlaylistFor(person, id);
  if (!found) return GONE;
  if (!found.owner) return { ok: false, status: 403, error: "Only the person who made this playlist can change who it is shared with." };
  if (mediaBandOf(person) === "child" || person.role === "guest") return { ok: false, status: 403, error: "Sharing is turned off for children. Ask a grown-up to share this playlist for you." };
  const { collection } = found;
  if (op === "private") setPlaylistMembers(collection, []);
  else {
    if (!target) return { ok: false, status: 400, error: "Choose someone in your home." };
    if (op === "remove") setPlaylistMembers(collection, collection.members.filter((member) => member !== target));
    else {
      const person_ = listActivePeople().find((p) => p.id === target);
      if (person_ && !isAdult(person_) && holdsAdultOnly(person, collection)) return MINOR_HAS_ADULT_LINE;
      if (!videoMemberCandidates(person, collection).some((entry) => entry.id === target)) return { ok: false, status: 403, error: "That person cannot be added. Choose someone else in your home; a child or teen can be added only by a grown-up." };
      setPlaylistMembers(collection, [...collection.members, target]);
    }
  }
  return { ok: true, value: { id: collection.id, title: collection.title } };
}

export { ownerOf };
