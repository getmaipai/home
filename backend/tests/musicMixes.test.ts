import { beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { people, mediaItems, mediaSources } from "@/db/schema";
import type { PersonRow } from "@/types";
import { mediaAppData, saveProgress } from "@/lib/media/appHost";
import { daylistRows, musicGreeting, replayRows } from "@/lib/media/musicMixes";
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
  // Song 1,2: nova/Folk on "Garden"; 3: pippa/Jazz on "Night"; 4: explicit nova/Folk (a child may not see it); 5: pippa/Jazz on "Night".
  for (const [n, artist, album, genre, explicit] of [[1, "nova", "Garden", "Folk", false], [2, "nova", "Garden", "Folk", false], [3, "pippa", "Night", "Jazz", false], [4, "nova", "Garden", "Folk", true], [5, "pippa", "Night", "Jazz", false]] as const) {
    db.insert(mediaItems).values({ id: id(n), sourceId: "msrc-music000001", kind: "track", locRootId: "msrc-music000001", locPath: `${n}.mp3`, title: `Song ${n}`, artist, albumArtist: artist, album, discNo: 1, trackNo: n, genre, year: 2021, advisoryExplicit: explicit, bandOk: "child", mediaType: "audio/mpeg", playable: "original", addedAt: now, createdAt: now, hlc: "1:0:aaaaaa", provenance: "test" }).run();
  }
});
const call = (person: PersonRow, name: string, params: Record<string, unknown>) => mediaAppData(person, "audio", name, params) as unknown as Array<Record<string, any>>;
const play = (person: PersonRow, n: number, times = 1) => { for (let i = 0; i < times; i++) saveProgress(person, "audio", { media_id: id(n), position_s: 10, duration_s: 10, reason: "ended" }); };

test("the greeting follows the hour in the given zone, with the person's name", () => {
  const noon = new Date("2026-11-09T12:00:00Z");
  expect(musicGreeting(atlas, new Date("2026-11-09T09:00:00Z"), "UTC").title).toBe("Good morning, atlas");
  expect(musicGreeting(atlas, new Date("2026-11-09T14:00:00Z"), "UTC").title).toBe("Good afternoon, atlas");
  expect(musicGreeting(atlas, new Date("2026-11-09T20:00:00Z"), "UTC").title).toBe("Good evening, atlas");
  expect(musicGreeting(atlas, noon, "Asia/Tokyo").title).toBe("Good evening, atlas");
  expect(musicGreeting(atlas, noon, "America/Los_Angeles").title).toBe("Good morning, atlas");
  expect(call(atlas, "history", { scope: "greeting" })).toHaveLength(1);
});

test("Jump back in lists only albums the person played, newest first, and never a stranger's play", () => {
  expect(call(atlas, "history", { scope: "jump-back" })).toEqual([]);
  play(atlas, 1); play(atlas, 3);
  expect(call(atlas, "history", { scope: "jump-back" }).map((row) => row.title)).toEqual(["Night", "Garden"]);
  expect(call(sprout, "history", { scope: "jump-back" })).toEqual([]);
});

test("Your most played ranks the person's own songs by plays; empty without plays", () => {
  expect(call(atlas, "history", { scope: "most-played" })).toEqual([]);
  play(atlas, 2, 3); play(atlas, 1, 1);
  expect(call(atlas, "history", { scope: "most-played" }).map((row) => row.id)).toEqual([id(2), id(1)]);
});

test("Made for you builds at most four radio mixes from own plays, genre and artist", () => {
  expect(call(atlas, "history", { scope: "made" })).toEqual([]);
  play(atlas, 1, 3); play(atlas, 3, 2);
  const mixes = call(atlas, "history", { scope: "made" });
  expect(mixes.map((row) => row.title)).toEqual(["Folk mix", "nova mix", "Jazz mix", "pippa mix"]);
  expect(mixes.map((row) => row.id)).toEqual(["radio:genre:Folk", "radio:artist:nova", "radio:genre:Jazz", "radio:artist:pippa"]);
  expect(mixes.every((row) => row.queue_mode === "radio" && row.kind === "track")).toBe(true);
  expect(mixes.length).toBeLessThanOrEqual(4);
});

test("a child gets no mixes or most played, and Jump back in holds only songs the child may read", () => {
  play(sprout, 1, 2); play(sprout, 3, 1);
  expect(call(sprout, "history", { scope: "made" })).toEqual([]);
  expect(call(sprout, "history", { scope: "most-played" })).toEqual([]);
  expect(call(sprout, "history", { scope: "jump-back" }).map((row) => row.title)).toEqual(["Night", "Garden"]);
  expect(call(sprout, "history", { scope: "greeting" })).toHaveLength(1);
});

test("Daylist holds the songs played in this part of the day, ranked by plays, once there are three", () => {
  const now = new Date();
  play(atlas, 1, 3); play(atlas, 2, 1);
  expect(daylistRows(atlas, now, "UTC")).toEqual([]);
  play(atlas, 3, 2);
  expect(daylistRows(atlas, now, "UTC").map((row: any) => row.id)).toEqual([id(1), id(3), id(2)]);
  expect(daylistRows(atlas, new Date(now.getTime() + 12 * 3600 * 1000), "UTC")).toEqual([]);
  expect(call(atlas, "history", { scope: "daylist" })).toHaveLength(3);
});

test("Replay ranks the past year's own plays and drops older ones", () => {
  play(atlas, 2, 3); play(atlas, 1, 1);
  expect(replayRows(atlas).map((row: any) => row.id)).toEqual([id(2), id(1)]);
  expect(replayRows(atlas, new Date(Date.now() + 400 * 24 * 3600 * 1000))).toEqual([]);
  expect(call(atlas, "history", { scope: "replay" }).map((row) => row.id)).toEqual([id(2), id(1)]);
});

test("a child gets no Daylist or Replay", () => {
  play(sprout, 1, 2); play(sprout, 3, 1); play(sprout, 2, 1);
  expect(daylistRows(sprout, new Date(), "UTC")).toEqual([]);
  expect(call(sprout, "history", { scope: "replay" })).toEqual([]);
});
