// MEDIA-PARITY-02 (Music): shared playlists and reordering. A playlist's owner may name members (people in the home) who can add and
// remove songs and reorder the list; nothing else about the playlist is theirs. Every member action runs the member's own read gate,
// so a child or teen never adds or sees a song they may not read, and an adult-only song a grown-up added stays out of their view.
import { listActivePeople } from "@/lib/access";
import { speakerAgeBand } from "@/lib/ageBand";
import type { PersonRow } from "@/types";
import { mediaBandOf, trips } from "./band";
import { addItem, listCollections, playlistsWithMember, removeItemFrom, resolveCollection, setItems, setPlaylistMembers } from "./collections";
import type { MediaCollection } from "./model";
import { readableIn, type ActionResult } from "./appHost";

const isMusic = (collection: MediaCollection): boolean => collection.kind === "playlist" && collection.media_kind !== "video";
const isAdult = (person: PersonRow): boolean => person.role !== "guest" && speakerAgeBand(person, new Date()) === "adult";

/** The music playlists this person owns. */
export function ownPlaylists(person: PersonRow): MediaCollection[] {
  return listCollections(person.id, "playlist").filter(isMusic);
}

/** Playlists other people own that name this person as a member. A minor never sees one whose name trips the floor. */
export function memberPlaylists(person: PersonRow): MediaCollection[] {
  return playlistsWithMember(person.id).filter((collection) => isMusic(collection) && (mediaBandOf(person) === "adult" || !trips(collection.title)));
}

/** A music playlist this person owns or is a member of, with whether they own it; null when it is neither. */
export function playlistFor(person: PersonRow, id: string): { collection: MediaCollection; owner: boolean } | null {
  const own = id ? resolveCollection(person.id, id) : null;
  if (own && isMusic(own)) return { collection: own, owner: true };
  const shared = memberPlaylists(person).find((collection) => collection.id === id);
  return shared ? { collection: shared, owner: false } : null;
}

const GONE = { ok: false, status: 404, error: "That playlist is not available. Go back to Playlists and choose another." } as const;

/** The people the owner can add: everyone active in the home but themselves and guests. A child owner shares nothing; a minor is added only by an adult. */
export function memberCandidates(owner: PersonRow, collection: MediaCollection): Array<{ id: string; name: string; avatar_url: null; avatar_seed: string }> {
  if (collection.person_id !== owner.id || owner.role === "guest" || mediaBandOf(owner) === "child") return [];
  return listActivePeople()
    .filter((candidate) => candidate.id !== owner.id && candidate.role !== "guest" && !collection.members.includes(candidate.id) && (isAdult(owner) || isAdult(candidate)))
    .map((candidate) => ({ id: candidate.id, name: candidate.displayName, avatar_url: null, avatar_seed: candidate.avatarSeed }));
}

/** What the playlist page's share panel draws: the members and whether this person can change them. */
export function playlistVisibility(person: PersonRow, collection: MediaCollection): { mode: "private" | "shared"; people: Array<{ id: string; name: string; avatar_url: null; avatar_seed: string }>; can_manage: boolean } {
  const active = new Map(listActivePeople().map((entry) => [entry.id, entry]));
  const people = collection.members.flatMap((id) => {
    const member = active.get(id);
    return member ? [{ id, name: member.displayName, avatar_url: null, avatar_seed: member.avatarSeed }] : [];
  });
  const owner = collection.person_id === person.id;
  return { mode: people.length ? "shared" : "private", people: owner || people.some((entry) => entry.id === person.id) ? people : [], can_manage: owner && person.role !== "guest" && mediaBandOf(person) !== "child" };
}

/** The owner adds or removes a member (or makes the playlist private again). */
export function changePlaylistMembers(person: PersonRow, op: "add" | "remove" | "private", id: string, target?: string): ActionResult<{ id: string; title: string }> {
  const found = playlistFor(person, id);
  if (!found) return GONE;
  if (!found.owner) return { ok: false, status: 403, error: "Only the person who made this playlist can change who it is shared with." };
  if (mediaBandOf(person) === "child" || person.role === "guest") return { ok: false, status: 403, error: "Sharing is turned off for children. Ask a grown-up to share this playlist for you." };
  const { collection } = found;
  if (op === "private") setPlaylistMembers(collection, []);
  else {
    if (!target) return { ok: false, status: 400, error: "Choose someone in your home." };
    if (op === "remove") setPlaylistMembers(collection, collection.members.filter((member) => member !== target));
    else {
      const candidate = memberCandidates(person, collection).find((entry) => entry.id === target);
      if (!candidate) return { ok: false, status: 403, error: "That person cannot be added. Choose someone else in your home; a child or teen can be added only by a grown-up." };
      setPlaylistMembers(collection, [...collection.members, target]);
    }
  }
  return { ok: true, value: { id: collection.id, title: collection.title } };
}

/** Puts the songs this person can see in the order given, leaving songs they cannot see where they are. */
function visibleReorder(person: PersonRow, collection: MediaCollection, named: readonly string[]): string[] {
  const current = collection.items.map((entry) => entry.media_id);
  const seen = new Set(current.filter((mediaId) => readableIn(person, "audio", mediaId)));
  const asked = [...new Set(named)].filter((mediaId) => seen.has(mediaId));
  const order = [...asked, ...current.filter((mediaId) => seen.has(mediaId) && !asked.includes(mediaId))];
  let next = 0;
  return current.map((mediaId) => (seen.has(mediaId) ? order[next++]! : mediaId));
}

/** A reorder key is the song id, or `<playlist id>:<song id>` when the page's rows carry it (the kit sends only the keys). */
function splitKeys(args: Record<string, unknown>): { playlistId: string; ids: string[] } | null {
  const raw = Array.isArray(args.ids) ? args.ids : null;
  if (!raw || raw.some((entry) => typeof entry !== "string")) return null;
  let playlistId = typeof args.playlist_id === "string" ? args.playlist_id : "";
  const ids = (raw as string[]).map((key) => {
    const at = key.indexOf(":");
    if (at <= 0) return key;
    playlistId ||= key.slice(0, at);
    return key.slice(at + 1);
  });
  return { playlistId, ids };
}

/** The shared-playlist ops of the `playlist` route: add (to a named playlist), remove, reorder. Null when the call is the Playlists page's older add/new/remove. */
export function musicPlaylistOps(person: PersonRow, args: Record<string, unknown>): ActionResult<{ id: string; title: string }> | null {
  if (args.op === "reorder") {
    const keys = splitKeys(args);
    if (!keys) return { ok: false, status: 400, error: "Drag the songs into the order you want, then try again." };
    const found = playlistFor(person, keys.playlistId);
    if (!found) return GONE;
    const order = visibleReorder(person, found.collection, keys.ids);
    setItems(found.collection, order.map((mediaId) => found.collection.items.find((entry) => entry.media_id === mediaId)!));
    return { ok: true, value: { id: found.collection.id, title: found.collection.title } };
  }
  const playlistId = typeof args.playlist_id === "string" ? args.playlist_id : "";
  if (args.op === "remove" || (args.op === "add" && playlistId)) {
    const found = playlistFor(person, playlistId);
    if (!found) return GONE;
    const mediaId = typeof args.media_id === "string" ? args.media_id : "";
    const item = readableIn(person, "audio", mediaId);
    if (!item) return { ok: false, status: 404, error: "That song is not available. Go back to the library and choose another." };
    if (args.op === "remove") removeItemFrom(found.collection, item.id);
    else if (!found.collection.items.some((entry) => entry.media_id === item.id)) addItem(found.collection, item.id);
    return { ok: true, value: { id: found.collection.id, title: found.collection.title } };
  }
  return null;
}
