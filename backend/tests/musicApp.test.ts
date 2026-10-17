import { beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { people, mediaItems, mediaSources } from "@/db/schema";
import type { PersonRow } from "@/types";
import { mediaAppData, startMusicQueue, saveProgress, setListed } from "@/lib/media/appHost";
import { resolveCollection } from "@/lib/media/collections";
import { resetDb } from "./reset-db";
import { __resetProgressForTests } from "@/lib/media/progress";
import { albumKey } from "@/lib/media/music";
import { itemFromRow } from "@/lib/media/model";
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
  for (const [n, disc, track, artist, albumArtist, explicit] of [[1,2,1,"nova","atlas",false],[2,1,2,"pippa","atlas",false],[3,1,1,"nova","atlas",false],[4,1,3,"nova","atlas",true],[5,1,1,"nova","pippa",false],[6,1,1,"nova","atlas",false]] as const) {
    db.insert(mediaItems).values({ id: id(n), sourceId: n === 6 ? "msrc-private0001" : "msrc-music000001", kind: "track", locRootId: n === 6 ? "msrc-private0001" : "msrc-music000001", locPath: `${n}.mp3`, title: `Song ${n}`, artist, albumArtist, album: "Garden", discNo: disc, trackNo: track, genre: "Folk", year: 2021, advisoryExplicit: explicit, bandOk: "child", mediaType: "audio/mpeg", playable: "original", addedAt: now, createdAt: now, hlc: "1:0:aaaaaa", provenance: "test" }).run();
  }
});
const data = (person: PersonRow, name: string, key?: string) => mediaAppData(person, "music", name, { id: key }) as Array<{id: string; title: string}>;
const album = () => albumKey(itemFromRow(db.select().from(mediaItems).where(eq(mediaItems.id,id(1))).get()!));
test("albums group by album artist and album; artists group by track artist", () => {
  expect(data(atlas,"albums")).toHaveLength(2);
  expect(data(atlas,"artists").map((row) => row.title)).toEqual(["nova","pippa"]);
  expect(data(atlas,"album",album()).map((row) => row.id)).toEqual([id(3),id(6),id(2),id(4),id(1)]);
});
test("album playback writes ordered own queue and progress advances its pointer", () => {
  expect(startMusicQueue(atlas,{mode:"album",id:album()}).ok).toBe(true);
  expect(resolveCollection(atlas.id,"queue")!.items[0]!.media_id).toBe(id(3));
  expect(resolveCollection(sprout.id,"queue")!.items).toEqual([]);
  saveProgress(atlas,"music",{media_id:id(3),position_s:10,duration_s:10,reason:"ended"});
  expect(resolveCollection(atlas.id,"queue")!.pointer).toBe(1);
  expect(data(atlas,"up-next",id(3))[0]!.id).toBe(id(6));
});
test("a child sees no explicit title, discovery seeds or another person's source", () => {
  expect(data(sprout,"songs").map((row) => row.id)).toEqual([id(1),id(2),id(3),id(5)]);
  expect(data(sprout,"item",id(4))).toEqual([]);
  expect(data(sprout,"radio-seeds")).toEqual([]);
  expect(startMusicQueue(sprout,{mode:"radio",id:id(4)}).ok).toBe(false);
});
test("radio for track, artist, album and genre stays in the child's authorized library", () => {
  for (const [seed_kind,seed] of [["track",id(1)],["artist","nova"],["album",album()],["genre","Folk"]]) {
    expect(startMusicQueue(sprout,{mode:"radio",seed_kind,id:seed}).ok).toBe(true);
    const ids=resolveCollection(sprout.id,"queue")!.items.map((entry)=>entry.media_id);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.every((value)=>[id(1),id(2),id(3),id(5)].includes(value))).toBe(true);
  }
});
test("shuffle preserves the authorized album membership", () => {
  startMusicQueue(sprout,{mode:"album",id:album(),shuffle:true});
  expect(resolveCollection(sprout.id,"queue")!.items.map((entry)=>entry.media_id).sort()).toEqual([id(1),id(2),id(3)]);
});
test("a minor never sees a track whose artist, album or genre trips the floor, even with a stored child band", () => {
  db.update(mediaItems).set({ genre: "Hardcore porn" }).where(eq(mediaItems.id, id(5))).run();
  expect(data(sprout, "songs").map((row) => row.id)).toEqual([id(1), id(2), id(3)]);
  expect(data(sprout, "item", id(5))).toEqual([]);
  expect(data(atlas, "songs").map((row) => row.id)).toContain(id(5));
});
test("radio orders by similarity: the seed first, then the same artist, then the same album artist, then the genre, then the decade", () => {
  db.update(mediaItems).set({ artist: "bruno", albumArtist: "bruno" }).where(eq(mediaItems.id, id(5))).run();
  db.update(mediaItems).set({ artist: "marlow", albumArtist: "bruno", genre: "Rock" }).where(eq(mediaItems.id, id(2))).run();
  expect(startMusicQueue(atlas, { mode: "radio", seed_kind: "track", id: id(1) }).ok).toBe(true);
  const ids = resolveCollection(atlas.id, "queue")!.items.map((entry) => entry.media_id);
  expect(ids[0]).toBe(id(1));
  expect(ids.slice(1, 4).sort()).toEqual([id(3), id(4), id(6)]);
  expect(ids.slice(4)).toEqual([id(5), id(2)]); // genre tier, then the same decade only
});
test("the Music package passes the hub's own package-page check", async () => {
  const { appPackageProblems } = await import("@/lib/apps");
  const { loadManifestOnly } = await import("@/lib/plugins");
  const loaded = loadManifestOnly("music");
  expect(loaded.ok).toBe(true);
  if (loaded.ok) expect(appPackageProblems(loaded.value, new URL("../packages/music", import.meta.url).pathname)).toEqual([]);
});
test("a playlist is made empty, then a song is added once and a child cannot add a song it may not read", async () => {
  const { musicPlaylistAction } = await import("@/lib/media/appHost");
  const made = musicPlaylistAction(atlas, { op: "new" });
  expect(made.ok).toBe(true);
  expect(musicPlaylistAction(atlas, { op: "add", media_id: id(1) }).ok).toBe(true);
  expect(musicPlaylistAction(atlas, { op: "add", media_id: id(1) }).ok).toBe(true);
  const lists = data(atlas, "playlists");
  expect(lists).toHaveLength(1);
  expect(data(atlas, "playlist", lists[0]!.id).map((row) => row.id)).toEqual([id(1)]);
  expect(musicPlaylistAction(sprout, { op: "add", media_id: id(4) }).ok).toBe(false);
  expect(data(sprout, "playlists")).toEqual([]);
});

const rows = (person: PersonRow, name: string, key?: string, scope?: string) => mediaAppData(person, "music", name, { id: key, scope }) as unknown as Array<Record<string, unknown>>;
test("the album page header, track rows and Like label carry the fields the kit nodes bind", () => {
  const [header] = rows(atlas, "header", album(), "album");
  expect(header).toMatchObject({ id: album(), title: "Garden", channel: "atlas · 2021 · 5 songs", queue_mode: "album", shuffle_id: `shuffle:${album()}` });
  const tracks = rows(atlas, "album", album());
  expect(tracks.map((row) => row.track_number)).toEqual([1, 1, 2, 3, 1]);
  expect(tracks.every((row) => row.like_label === "Like" && row.playing === false)).toBe(true);
  setListed(atlas, "music", "liked", id(3), true);
  startMusicQueue(atlas, { mode: "album", id: album() });
  const after = rows(atlas, "album", album());
  expect(after.find((row) => row.id === id(3))).toMatchObject({ like_label: "Liked", playing: true });
  expect(after.filter((row) => row.playing)).toHaveLength(1);
  expect(rows(atlas, "header", "nope", "album")).toEqual([]);
});
test("a page button that carries one id can ask for a shuffled album or for artist radio", () => {
  expect(startMusicQueue(atlas, { mode: "album", id: `shuffle:${album()}` }).ok).toBe(true);
  expect(resolveCollection(atlas.id, "queue")!.items.map((entry) => entry.media_id).sort()).toEqual([id(1), id(2), id(3), id(4), id(6)]);
  expect(startMusicQueue(atlas, { mode: "artist", id: "radio:artist:nova" }).ok).toBe(true);
  const radioIds = resolveCollection(atlas.id, "queue")!.items.map((entry) => entry.media_id);
  expect(radioIds[0]).toBe(id(1)); // the seed is the library's first nova song, then the rest of the tiers
  expect(radioIds).not.toContain("nova");
  expect(startMusicQueue(atlas, { mode: "artist", id: "pippa" }).ok).toBe(true);
  expect(resolveCollection(atlas.id, "queue")!.items.map((entry) => entry.media_id)).toEqual([id(2)]);
});
test("artist header, artist albums and more albums read from the same derived groups", () => {
  expect(rows(atlas, "header", "nova", "artist")[0]).toMatchObject({ id: "nova", title: "nova", channel: "5 songs", radio_id: "radio:artist:nova" });
  expect(rows(atlas, "artist-albums", "nova").map((row) => row.title)).toEqual(["Garden", "Garden"]);
  expect(rows(atlas, "album-more", album()).map((row) => row.id)).not.toContain(album());
  expect(rows(atlas, "albums", undefined, "recent")).toHaveLength(2);
});
test("a playlist page lists its songs with the playlist id, removes one, and is another person's secret", async () => {
  const { musicPlaylistAction } = await import("@/lib/media/appHost");
  const made = musicPlaylistAction(atlas, { op: "new" });
  if (!made.ok) throw new Error("no playlist");
  musicPlaylistAction(atlas, { op: "add", media_id: id(1) });
  musicPlaylistAction(atlas, { op: "add", media_id: id(2) });
  const list = rows(atlas, "playlist", made.value.id);
  expect(list.map((row) => row.playlist_id)).toEqual([made.value.id, made.value.id]);
  expect(list.map((row) => row.track_number)).toEqual([1, 2]);
  expect(rows(atlas, "header", made.value.id, "playlist")[0]).toMatchObject({ title: made.value.title, channel: "2 songs", queue_mode: "playlist" });
  expect(rows(sprout, "playlist", made.value.id)).toEqual([]);
  expect(rows(sprout, "header", made.value.id, "playlist")).toEqual([]);
  expect(musicPlaylistAction(sprout, { op: "remove", media_id: id(1), playlist_id: made.value.id }).ok).toBe(false);
  expect(musicPlaylistAction(atlas, { op: "remove", media_id: id(1), playlist_id: made.value.id }).ok).toBe(true);
  expect(rows(atlas, "playlist", made.value.id).map((row) => row.id)).toEqual([id(2)]);
});
test("a child's header, artist and album pages hold only band_ok child songs", () => {
  expect((rows(sprout, "header", album(), "album")[0] as { channel: string }).channel).toBe("atlas · 2021 · 3 songs");
  expect(rows(sprout, "album", album()).map((row) => row.id)).toEqual([id(3), id(2), id(1)]);
  expect(rows(sprout, "artist", "nova").map((row) => row.id).sort()).toEqual([id(1), id(3), id(5)].sort());
  expect(rows(sprout, "up-next", id(3))).toEqual([]);
  expect(rows(sprout, "liked")).toEqual([]);
});
test("a guest reads Music like a child: no explicit song, no radio, no private source, no playing someone else's song", () => {
  const now = new Date().toISOString();
  db.insert(people).values({ id: "person-guest0000001", displayName: "visitor", role: "guest", avatarSeed: "s", source: "local", createdAt: now, updatedAt: now, hlc: "1:0:aaaaaa" }).run();
  const guest = db.select().from(people).where(eq(people.displayName, "visitor")).get() as PersonRow;
  expect(data(guest, "songs").map((row) => row.id)).toEqual([id(1), id(2), id(3), id(5)]);
  expect(data(guest, "radio-seeds")).toEqual([]);
  expect(data(guest, "item", id(4))).toEqual([]);
  expect(data(guest, "item", id(6))).toEqual([]);
  expect(startMusicQueue(guest, { mode: "track", id: id(4) }).ok).toBe(false);
  expect(startMusicQueue(guest, { mode: "radio", seed_kind: "genre", id: "Folk" }).ok).toBe(true);
  expect(resolveCollection(guest.id, "queue")!.items.map((entry) => entry.media_id).every((value) => [id(1), id(2), id(3), id(5)].includes(value))).toBe(true);
});
