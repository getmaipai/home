// MEDIA-PARITY-02 (Music): the saved Library sort, queue and playlist reorder, and shared playlists.
import { beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { people, mediaItems, mediaSources } from "@/db/schema";
import type { PersonRow } from "@/types";
import { mediaAppData, musicPlaylistAction, startMusicQueue } from "@/lib/media/appHost";
import { getAppPage } from "@/lib/apps";
import { resolveCollection } from "@/lib/media/collections";
import { musicQueueAction, pinMusicItem, reportKeptSongs, savedLibrarySort } from "@/lib/media/musicLibrary";
import { changePlaylistMembers, musicPlaylistOps } from "@/lib/media/musicPlaylists";
import "@/lib/media/musicApp";
import { getPersonSettingValue, setValue } from "@/lib/settings";
import { getRegistryKey } from "@/lib/settingsRegistry";
import { placeSetting, settingsViewerFor } from "@/lib/settingsAreas";
import { resetDb } from "./reset-db";
import { __resetProgressForTests } from "@/lib/media/progress";

let atlas: PersonRow, nova: PersonRow, sprout: PersonRow;
const id = (n: number) => `media-song00000${n}`;
beforeEach(() => {
  resetDb(); __resetProgressForTests();
  const now = new Date().toISOString();
  for (const [name, role] of [["atlas", "adult"], ["nova", "adult"], ["sprout", "child"]]) {
    db.insert(people).values({ id: `person-${name}000001`, displayName: name!, role: role!, birthdate: role === "child" ? "2018-03-01" : null, avatarSeed: "s", source: "local", createdAt: now, updatedAt: now, hlc: "1:0:aaaaaa" }).run();
  }
  const get = (name: string) => db.select().from(people).where(eq(people.displayName, name)).get() as PersonRow;
  atlas = get("atlas"); nova = get("nova"); sprout = get("sprout");
  db.insert(mediaSources).values({ id: "msrc-music000001", kind: "root", scope: "household", label: "Music", createdAt: now, hlc: "1:0:aaaaaa", provenance: "test" }).run();
  const songs = [[1, "zed", "Zeta", "Alpha Album"], [2, "bea", "Beta", "Alpha Album"], [3, "cal", "Gamma", "Gamma Album"], [4, "ann", "Delta", "Delta Album"]] as const;
  for (const [n, artist, title, album] of songs) {
    db.insert(mediaItems).values({ id: id(n), sourceId: "msrc-music000001", kind: "track", locRootId: "msrc-music000001", locPath: `${n}.mp3`, title, artist, albumArtist: album === "Alpha Album" ? "zed" : artist, album, discNo: 1, trackNo: 1, genre: "Folk", year: 2021, advisoryExplicit: false, bandOk: "child", mediaType: "audio/mpeg", playable: "original", addedAt: `2026-01-0${n}T00:00:00.000Z`, createdAt: now, hlc: "1:0:aaaaaa", provenance: "test" }).run();
  }
  // Song 4 is adult-only.
  db.update(mediaItems).set({ advisoryExplicit: true, bandOk: "adult" }).where(eq(mediaItems.id, id(4))).run();
});

type Row = Record<string, unknown> & { id: string; title: string };
const lib = (person: PersonRow, params: { sort?: string; kind?: string } = {}) => mediaAppData(person, "audio", "songs", { scope: "library", ...params }) as unknown as Row[];
const queueIds = (person: PersonRow) => resolveCollection(person.id, "queue")!.items.map((entry) => entry.media_id);
const newPlaylist = (owner: PersonRow, songs: number[]) => {
  const made = musicPlaylistAction(owner, { op: "new" });
  if (!made.ok) throw new Error("no playlist");
  for (const n of songs) musicPlaylistOps(owner, { op: "add", playlist_id: made.value.id, media_id: id(n) });
  return made.value.id;
};
const playlistIds = (person: PersonRow, playlist: string) => (mediaAppData(person, "audio", "playlist", { id: playlist }) as unknown as Row[]).map((row) => row.id);

test("the Library sort the person chose is saved, read back and opens first on the page", () => {
  expect(savedLibrarySort(atlas)).toBe("recents");
  lib(atlas, { sort: "a-z" });
  expect(getPersonSettingValue(atlas, "music.library_sort")).toBe("az");
  expect(savedLibrarySort(sprout)).toBe("recents");
  // With no sort in the call the saved order applies.
  expect(lib(atlas, { kind: "songs" }).map((row) => row.title)).toEqual(["Beta", "Delta", "Gamma", "Zeta"]);
  lib(atlas, { sort: "creator" });
  expect(savedLibrarySort(atlas)).toBe("creator");
  lib(atlas, { sort: "nonsense" });
  expect(savedLibrarySort(atlas)).toBe("creator");
  const page = getAppPage(atlas, "audio", "library");
  if (!page.ok) throw new Error("no page");
  const shelf = (page.value as { body: Array<{ sort: { options: Array<{ value: string }> } }> }).body[0]!;
  expect(shelf.sort.options.map((option) => option.value)).toEqual(["creator", "recents", "az"]);
  const other = getAppPage(sprout, "audio", "library");
  expect((other.ok ? (other.value as typeof page.value as { body: Array<{ sort: { options: Array<{ value: string }> } }> }) : null)!.body[0]!.sort.options[0]!.value).toBe("recents");
});

test("reordering Up next moves only the songs after the playing one and keeps the playing song", () => {
  startMusicQueue(atlas, { mode: "album", id: lib(atlas, { kind: "albums" }).find((row) => row.title === "Alpha Album")!.id });
  musicQueueAction(atlas, { op: "add", media_id: id(3) });
  const before = queueIds(atlas);
  expect(before).toHaveLength(3);
  const playing = before[0]!;
  expect(musicQueueAction(atlas, { op: "reorder", ids: [id(3), before[1]!] }).ok).toBe(true);
  expect(queueIds(atlas)).toEqual([playing, id(3), before[1]!]);
  expect(resolveCollection(atlas.id, "queue")!.pointer).toBe(0);
  // Songs not named keep their place after the named ones; unknown ids are ignored.
  expect(musicQueueAction(atlas, { op: "reorder", ids: [before[1]!, "media-nothere"] }).ok).toBe(true);
  expect(queueIds(atlas)).toEqual([playing, before[1]!, id(3)]);
  expect(musicQueueAction(atlas, { op: "reorder", ids: ["media-nothere"] }).ok).toBe(false);
  expect(musicQueueAction(atlas, { op: "reorder", ids: "x" }).ok).toBe(false);
  expect(queueIds(nova)).toEqual([]);
});

test("reordering a playlist uses the keys the page sends and keeps the rest", () => {
  const playlist = newPlaylist(atlas, [1, 2, 3]);
  expect(playlistIds(atlas, playlist)).toEqual([id(1), id(2), id(3)]);
  const keys = (mediaAppData(atlas, "audio", "playlist", { id: playlist }) as unknown as Row[]).map((row) => row.reorder_key as string);
  expect(keys[0]).toBe(`${playlist}:${id(1)}`);
  expect(musicPlaylistOps(atlas, { op: "reorder", ids: [keys[2]!, keys[0]!, keys[1]!] })?.ok).toBe(true);
  expect(playlistIds(atlas, playlist)).toEqual([id(3), id(1), id(2)]);
  // Plain ids with a playlist id also work; a playlist that is not theirs is refused.
  expect(musicPlaylistOps(atlas, { op: "reorder", playlist_id: playlist, ids: [id(2)] })?.ok).toBe(true);
  expect(playlistIds(atlas, playlist)).toEqual([id(2), id(3), id(1)]);
  expect(musicPlaylistOps(nova, { op: "reorder", playlist_id: playlist, ids: [id(1)] })?.ok).toBe(false);
});

test("a member can add and remove songs; only the owner changes who the members are", () => {
  const playlist = newPlaylist(atlas, [1]);
  expect(changePlaylistMembers(nova, "add", playlist, nova.id).ok).toBe(false);
  expect(musicPlaylistOps(nova, { op: "add", playlist_id: playlist, media_id: id(2) })?.ok).toBe(false);
  expect(playlistIds(nova, playlist)).toEqual([]);
  expect(changePlaylistMembers(atlas, "add", playlist, nova.id).ok).toBe(true);
  expect(changePlaylistMembers(atlas, "add", playlist, atlas.id).ok).toBe(false);
  expect(playlistIds(nova, playlist)).toEqual([id(1)]);
  expect((mediaAppData(nova, "audio", "playlists", {}) as unknown as Row[]).map((row) => row.id)).toContain(playlist);
  expect(musicPlaylistOps(nova, { op: "add", playlist_id: playlist, media_id: id(2) })?.ok).toBe(true);
  expect(playlistIds(atlas, playlist)).toEqual([id(1), id(2)]);
  expect(musicPlaylistOps(nova, { op: "reorder", playlist_id: playlist, ids: [id(2), id(1)] })?.ok).toBe(true);
  expect(musicPlaylistOps(nova, { op: "remove", playlist_id: playlist, media_id: id(2) })?.ok).toBe(true);
  expect(playlistIds(atlas, playlist)).toEqual([id(1)]);
  expect(changePlaylistMembers(nova, "remove", playlist, nova.id).ok).toBe(false);
  expect(changePlaylistMembers(atlas, "remove", playlist, nova.id).ok).toBe(true);
  expect(musicPlaylistOps(nova, { op: "add", playlist_id: playlist, media_id: id(3) })?.ok).toBe(false);
  expect(playlistIds(nova, playlist)).toEqual([]);
});

test("a child member is added only by an adult and never adds or sees a song it may not read", () => {
  const playlist = newPlaylist(atlas, [1, 4]);
  expect(changePlaylistMembers(atlas, "add", playlist, sprout.id).ok).toBe(true);
  // The adult-only song stays on the playlist but the child neither sees nor adds it.
  expect(playlistIds(sprout, playlist)).toEqual([id(1)]);
  expect(musicPlaylistOps(sprout, { op: "add", playlist_id: playlist, media_id: id(4) })?.ok).toBe(false);
  expect(musicPlaylistOps(sprout, { op: "add", playlist_id: playlist, media_id: id(2) })?.ok).toBe(true);
  expect(playlistIds(atlas, playlist)).toEqual([id(1), id(4), id(2)]);
  // Reordering what the child sees leaves the hidden song where it was.
  expect(musicPlaylistOps(sprout, { op: "reorder", playlist_id: playlist, ids: [id(2), id(1)] })?.ok).toBe(true);
  expect(playlistIds(atlas, playlist)).toEqual([id(2), id(4), id(1)]);
  expect(musicPlaylistOps(sprout, { op: "remove", playlist_id: playlist, media_id: id(4) })?.ok).toBe(false);
  // A child owner shares with nobody, and a grown-up is not added by a child.
  const kids = newPlaylist(sprout, [1]);
  expect(changePlaylistMembers(sprout, "add", kids, nova.id).ok).toBe(false);
  // The share panel: the owner manages, a member only sees the list.
  const header = (person: PersonRow) => (mediaAppData(person, "audio", "header", { id: playlist, scope: "playlist" }) as unknown as Array<{ visibility: { can_manage: boolean; people: unknown[] }; candidates: Array<{ id: string }> }>)[0]!;
  expect(header(atlas).visibility.can_manage).toBe(true);
  expect(header(atlas).visibility.people).toHaveLength(1);
  expect(header(atlas).candidates.map((entry) => entry.id)).toEqual([nova.id]);
  expect(header(sprout).visibility.can_manage).toBe(false);
  expect(header(sprout).candidates).toEqual([]);
  expect(changePlaylistMembers(atlas, "private", playlist).ok).toBe(true);
  expect(playlistIds(sprout, playlist)).toEqual([]);
});

const libFor = (person: PersonRow, params: { kind?: string; device?: string }) => mediaAppData(person, "audio", "songs", { scope: "library", ...params }) as unknown as Row[];

test("the Library's one Pin button pins what is not pinned and unpins what is, and says which", () => {
  expect(pinMusicItem(atlas, { op: "toggle", key: `track:${id(1)}` }).ok).toBe(true);
  const row = () => libFor(atlas, { kind: "songs" }).find((entry) => entry.id === id(1))!;
  expect(row().pinned).toBe(true);
  expect(row().pin_label).toBe("Unpin");
  expect(pinMusicItem(atlas, { op: "toggle", key: `track:${id(1)}` }).ok).toBe(true);
  expect(row().pinned).toBe(false);
  expect(row().pin_label).toBe("Pin");
});

test("a device's kept songs are marked, filtered by Downloaded, and private to that device and person", () => {
  expect(reportKeptSongs(atlas, "s:phone", { ids: [id(2), id(3), "media-nothere", id(4)] })).toEqual({ ok: true, value: { count: 3 } });
  const song = (device: string | undefined, person = atlas) => libFor(person, { kind: "songs", device }).find((entry) => entry.id === id(2))!;
  expect(song("s:phone").downloaded).toBe(true);
  expect(song("s:phone").offline_label).toBe("Remove download");
  expect(song("s:laptop").downloaded).toBe(false);
  expect(song("s:laptop").offline_label).toBe("Save for offline");
  expect(libFor(atlas, { kind: "downloaded", device: "s:phone" }).map((row) => row.id).sort()).toEqual([id(2), id(3), id(4)].sort());
  expect(libFor(atlas, { kind: "downloaded", device: "s:laptop" })).toEqual([]);
  expect(libFor(atlas, { kind: "downloaded" })).toEqual([]);
  // A child's device never keeps, or is shown, a song it may not read (song 4 is adult-only).
  expect(reportKeptSongs(sprout, "s:phone", { ids: [id(4), id(1)] })).toEqual({ ok: true, value: { count: 1 } });
  expect(libFor(sprout, { kind: "downloaded", device: "s:phone" }).map((row) => row.id)).toEqual([id(1)]);
  expect(libFor(atlas, { kind: "downloaded", device: "s:phone" })).toHaveLength(3);
  // Reporting again replaces the list; a bad list is refused with a next step.
  reportKeptSongs(atlas, "s:phone", { ids: [] });
  expect(libFor(atlas, { kind: "downloaded", device: "s:phone" })).toEqual([]);
  const bad = reportKeptSongs(atlas, "s:phone", { ids: "all" });
  expect(bad.ok).toBe(false);
});

test("crossfade and the Equalizer preset are Music settings an adult finds on the Music card, and a person saves their own", () => {
  for (const key of ["music.crossfade_s", "music.eq_preset"]) {
    const def = getRegistryKey(key)!;
    expect(def.scope).toBe("person");
    expect(def.lives_in).toBe("person.music");
    expect(placeSetting(def, settingsViewerFor(atlas))?.card).toBe("Music");
  }
  expect(setValue(atlas, `person:${atlas.id}`, "music.crossfade_s", 6).ok).toBe(true);
  expect(setValue(atlas, `person:${atlas.id}`, "music.crossfade_s", 13).ok).toBe(false);
  expect(setValue(atlas, `person:${atlas.id}`, "music.eq_preset", "bass").ok).toBe(true);
  expect(setValue(atlas, `person:${atlas.id}`, "music.eq_preset", "loud").ok).toBe(false);
  expect(getPersonSettingValue(atlas, "music.crossfade_s")).toBe(6);
  expect(getPersonSettingValue(nova, "music.crossfade_s")).toBe(0);
  expect(getPersonSettingValue(atlas, "music.eq_preset")).toBe("bass");
});
