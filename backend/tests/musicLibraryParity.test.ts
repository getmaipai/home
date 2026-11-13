// PARITY-01 (Music): the Library's one list with sort, filter chips and pins; play next and add to queue; recent searches.
import { beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { people, mediaItems, mediaSources } from "@/db/schema";
import type { PersonRow } from "@/types";
import { mediaAppData, musicPlaylistAction, saveProgress, startMusicQueue } from "@/lib/media/appHost";
import { resolveCollection } from "@/lib/media/collections";
import { musicQueueAction, pinMusicItem, recordMusicSearch, clearMusicSearches, MUSIC_PIN_MAX } from "@/lib/media/musicLibrary";
import { resetDb } from "./reset-db";
import { __resetProgressForTests } from "@/lib/media/progress";

let atlas: PersonRow, sprout: PersonRow;
const id = (n: number) => `media-song00000${n}`;
beforeEach(() => {
  resetDb(); __resetProgressForTests();
  const now = new Date().toISOString();
  for (const [name, role] of [["atlas", "adult"], ["sprout", "child"]]) {
    db.insert(people).values({ id: `person-${name}000001`, displayName: name!, role: role!, birthdate: role === "child" ? "2018-03-01" : null, avatarSeed: "s", source: "local", createdAt: now, updatedAt: now, hlc: "1:0:aaaaaa" }).run();
  }
  atlas = db.select().from(people).where(eq(people.displayName, "atlas")).get() as PersonRow;
  sprout = db.select().from(people).where(eq(people.displayName, "sprout")).get() as PersonRow;
  db.insert(mediaSources).values({ id: "msrc-music000001", kind: "root", scope: "household", label: "Music", createdAt: now, hlc: "1:0:aaaaaa", provenance: "test" }).run();
  db.insert(mediaSources).values({ id: "msrc-private0001", kind: "root", scope: "person", ownerPersonId: atlas.id, visibleTo: JSON.stringify([atlas.id]), label: "Private", createdAt: now, hlc: "1:0:aaaaaa", provenance: "test" }).run();
  const songs = [[1, "zed", "zed", "Zeta", "Alpha Album"], [2, "bea", "zed", "Beta", "Alpha Album"], [3, "cal", "cal", "Gamma", "Gamma Album"], [4, "ann", "ann", "Delta", "Delta Album"]] as const;
  for (const [n, artist, albumArtist, title, album] of songs) {
    db.insert(mediaItems).values({ id: id(n), sourceId: "msrc-music000001", kind: "track", locRootId: "msrc-music000001", locPath: `${n}.mp3`, title, artist, albumArtist, album, discNo: 1, trackNo: 1, genre: "Folk", year: 2021, advisoryExplicit: false, bandOk: "child", mediaType: "audio/mpeg", playable: "original", addedAt: `2026-01-0${n}T00:00:00.000Z`, createdAt: now, hlc: "1:0:aaaaaa", provenance: "test" }).run();
  }
});

type Row = Record<string, unknown> & { id: string; title: string };
const lib = (person: PersonRow, params: { sort?: string; kind?: string } = {}) => mediaAppData(person, "audio", "songs", { scope: "library", ...params }) as unknown as Row[];

test("the Library lists songs, albums, artists and playlists in one list and the chips narrow it", () => {
  musicPlaylistAction(atlas, { op: "new" });
  const all = lib(atlas);
  expect(new Set(all.map((row) => row.route))).toEqual(new Set(["play", "album", "artist", "playlist"]));
  expect(lib(atlas, { kind: "songs" }).every((row) => row.route === "play")).toBe(true);
  expect(lib(atlas, { kind: "albums" }).map((row) => row.title).sort()).toEqual(["Alpha Album", "Delta Album", "Gamma Album"]);
  expect(lib(atlas, { kind: "artists" })).toHaveLength(4);
  expect(lib(atlas, { kind: "playlists" })).toHaveLength(1);
  expect(lib(atlas, { kind: "all" }).length).toBe(all.length);
});

test("sort A to Z orders by title, Creator by creator then title, Recents by what was played last", () => {
  expect(lib(atlas, { kind: "songs", sort: "a-z" }).map((row) => row.title)).toEqual(["Beta", "Delta", "Gamma", "Zeta"]);
  expect(lib(atlas, { kind: "songs", sort: "creator" }).map((row) => row.title)).toEqual(["Delta", "Beta", "Gamma", "Zeta"]);
  saveProgress(atlas, "audio", { media_id: id(1), position_s: 10, duration_s: 10, reason: "ended" });
  expect(lib(atlas, { kind: "songs", sort: "recents" })[0]!.id).toBe(id(1));
  // With no play history the newest addition comes first.
  expect(lib(sprout, { kind: "songs", sort: "recents" }).map((row) => row.id)).toEqual([id(4), id(3), id(2), id(1)]);
});

test("pins are per person, capped at six, drawn flagged, and unpin removes them", () => {
  expect(pinMusicItem(atlas, { key: `track:${id(2)}`, on: true }).ok).toBe(true);
  const pinned = lib(atlas, { kind: "songs" }).filter((row) => row.pinned === true);
  expect(pinned.map((row) => row.id)).toEqual([id(2)]);
  expect(lib(sprout, { kind: "songs" }).some((row) => row.pinned === true)).toBe(false);
  expect(pinMusicItem(atlas, { key: `track:${id(2)}`, on: true }).ok).toBe(true);
  expect(lib(atlas, { kind: "songs" }).filter((row) => row.pinned === true)).toHaveLength(1);
  for (const n of [1, 3, 4]) pinMusicItem(atlas, { key: `track:${id(n)}`, on: true });
  for (const name of ["Alpha Album", "Gamma Album"]) {
    const row = lib(atlas, { kind: "albums" }).find((entry) => entry.title === name)!;
    pinMusicItem(atlas, { key: row.pin_key as string, on: true });
  }
  expect(MUSIC_PIN_MAX).toBe(6);
  const seventh = pinMusicItem(atlas, { key: `artist:zed`, on: true });
  expect(lib(atlas).filter((row) => row.pinned === true)).toHaveLength(6);
  expect(seventh.ok).toBe(false);
  expect(pinMusicItem(atlas, { key: `track:${id(2)}`, on: false }).ok).toBe(true);
  expect(lib(atlas, { kind: "songs" }).some((row) => row.pinned === true && row.id === id(2))).toBe(false);
  expect(pinMusicItem(atlas, { key: "track:media-nothere", on: true }).ok).toBe(false);
});

test("a child cannot pin a song it may not read", () => {
  db.update(mediaItems).set({ advisoryExplicit: true }).where(eq(mediaItems.id, id(1))).run();
  expect(pinMusicItem(sprout, { key: `track:${id(1)}`, on: true }).ok).toBe(false);
});

test("play next puts a song right after the current one, add to queue puts it last, and each is the person's own", () => {
  startMusicQueue(atlas, { mode: "album", id: lib(atlas, { kind: "albums" }).find((row) => row.title === "Alpha Album")!.id });
  const queue = () => resolveCollection(atlas.id, "queue")!.items.map((entry) => entry.media_id);
  const before = queue();
  expect(before).toHaveLength(2);
  expect(musicQueueAction(atlas, { op: "play_next", media_id: id(3) }).ok).toBe(true);
  expect(queue()).toEqual([before[0]!, id(3), before[1]!]);
  expect(musicQueueAction(atlas, { op: "add", media_id: id(4) }).ok).toBe(true);
  expect(queue().at(-1)).toBe(id(4));
  expect(musicQueueAction(atlas, { op: "play_next", media_id: id(4) }).ok).toBe(true);
  expect(queue()).toEqual([before[0]!, id(4), id(3), before[1]!]);
  expect(resolveCollection(sprout.id, "queue")!.items).toEqual([]);
  expect(musicQueueAction(atlas, { op: "add", media_id: "media-nothere" }).ok).toBe(false);
  expect(musicQueueAction(atlas, { op: "bogus", media_id: id(3) }).ok).toBe(false);
});

test("recent searches keep the newest ten once each, are per person, and clear", () => {
  for (let n = 0; n < 12; n += 1) recordMusicSearch(atlas, { q: `query ${n}` });
  recordMusicSearch(atlas, { q: "query 5" });
  recordMusicSearch(atlas, { q: " " });
  const read = (person: PersonRow) => (mediaAppData(person, "audio", "songs", { scope: "recent-searches" }) as unknown as { rows: Array<{ key: string; label: string }> }).rows.map((row) => row.label);
  const got = read(atlas);
  expect(got).toHaveLength(10);
  expect(got[0]).toBe("query 5");
  expect(got.filter((label) => label === "query 5")).toHaveLength(1);
  expect(read(sprout)).toEqual([]);
  clearMusicSearches(atlas);
  expect(read(atlas)).toEqual([]);
});

test("album and playlist headers carry a share link id and the playlist header says how to play it", () => {
  const album = (mediaAppData(atlas, "audio", "header", { id: lib(atlas, { kind: "albums" })[0]!.id, scope: "album" }) as unknown as Row[])[0]!;
  expect(album.share_id).toBe(encodeURIComponent(album.id as string));
  const made = musicPlaylistAction(atlas, { op: "new" });
  const playlist = (mediaAppData(atlas, "audio", "header", { id: made.ok ? made.value.id : "", scope: "playlist" }) as unknown as Row[])[0]!;
  expect(playlist.share_id).toBe(playlist.id);
});
