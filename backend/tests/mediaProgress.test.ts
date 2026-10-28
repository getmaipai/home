// MEDIA-PROGRESS-01: `mergeProgress`, the one definition of how two states of a row become one, as a table (FileTube's offline
// progress cases: skew-corrected stamps, newest wins, a rewind when newer, the latch per kind, marks union), then the stored write
// path: coalescing, and a minor's row written only from their own screen.
import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { mediaProgress, mediaSources, mediaItems, people } from "@/db/schema";
import { createDevice } from "@/lib/devices";
import {
  __resetProgressForTests, correctedStamp, flushProgress, getProgress, mergeProgress, progressStats, reachesLatch, writeProgress,
  type ProgressState, type ProgressWrite,
} from "@/lib/media/progress";
import type { MediaItem } from "@/lib/media/model";
import { resetDb } from "./reset-db";
import type { PersonRow } from "@/types";

const T = (seconds: number) => new Date(Date.UTC(2026, 9, 17, 12, 0, seconds)).toISOString();
const secs = (seconds: number) => ({ seconds });
const state = (over: Partial<ProgressState> = {}): ProgressState => ({ position: secs(100), duration_s: 1000, completed: false, plays: 0, skips: 0, finishes: 0, marks: [], device_id: "device-aaaaaa", updated_at: T(100), ...over });
const write = (over: Partial<ProgressWrite> = {}): ProgressWrite => ({ position: secs(200), duration_s: 1000, stamp: T(200), device_id: "device-bbbbbb", ...over });

describe("mergeProgress: newest wins", () => {
  test("a first write creates the row", () => {
    const merged = mergeProgress("video", null, write());
    expect(merged.state).toMatchObject({ position: secs(200), duration_s: 1000, completed: false, device_id: "device-bbbbbb", updated_at: T(200) });
    expect(merged.positionApplied).toBe(true);
  });
  test("a newer write moves the place and the device that wrote it", () => {
    const merged = mergeProgress("video", state(), write());
    expect(merged.state).toMatchObject({ position: secs(200), device_id: "device-bbbbbb", updated_at: T(200) });
  });
  test("a rewind applies when it is newer: the furthest place does not win", () => {
    const merged = mergeProgress("video", state({ position: secs(800), updated_at: T(100) }), write({ position: secs(30), stamp: T(150) }));
    expect(merged.state.position).toEqual(secs(30));
    expect(merged.positionApplied).toBe(true);
  });
  test("an older write (an offline device catching up) does not move the place, and says so", () => {
    const merged = mergeProgress("video", state({ position: secs(500), updated_at: T(300), device_id: "device-aaaaaa" }), write({ position: secs(120), stamp: T(250) }));
    expect(merged.state).toMatchObject({ position: secs(500), updated_at: T(300), device_id: "device-aaaaaa" });
    expect(merged.positionApplied).toBe(false);
  });
  test("the same stamp counts as newer (the later arrival wins a tie)", () => {
    expect(mergeProgress("video", state({ updated_at: T(200) }), write({ stamp: T(200) })).state.position).toEqual(secs(200));
  });
  test("a book keeps a locator and a percent", () => {
    const position = { locator: { kind: "cfi" as const, cfi: "epubcfi(/6/4)", page: null, spine_index: 2, block_index: 9 }, percent: 41 };
    expect(mergeProgress("book", null, write({ position })).state.position).toEqual(position);
  });
});

describe("mergeProgress: skew correction", () => {
  const server = new Date(Date.UTC(2026, 9, 17, 12, 10, 0));
  test("a phone whose clock is an hour fast is moved back by its own error", () => {
    // The phone read the position at 13:05 by its clock and sent at 13:10 by its clock; the hub received it at 12:10.
    const stamp = correctedStamp({ sampledAt: "2026-10-17T13:05:00Z", clientNow: "2026-10-17T13:10:00Z", serverNow: server });
    expect(stamp).toBe("2026-10-17T12:05:00.000Z");
  });
  test("an offline batch sampled long ago stays old, so a newer online place beats it", () => {
    const stale = correctedStamp({ sampledAt: "2026-10-16T09:00:00Z", clientNow: "2026-10-17T12:09:00Z", serverNow: server });
    const merged = mergeProgress("video", state({ position: secs(700), updated_at: "2026-10-17T11:00:00.000Z" }), write({ position: secs(60), stamp: stale }));
    expect(merged.state.position).toEqual(secs(700));
  });
  test("a stamp never lands in the future, and a write with no clock readings is stamped when it arrived", () => {
    expect(correctedStamp({ sampledAt: "2026-10-17T14:00:00Z", clientNow: "2026-10-17T12:00:00Z", serverNow: server })).toBe(server.toISOString());
    expect(correctedStamp({ serverNow: server })).toBe(server.toISOString());
    expect(correctedStamp({ sampledAt: "garbage", clientNow: "2026-10-17T12:00:00Z", serverNow: server })).toBe(server.toISOString());
  });
});

describe("mergeProgress: the completed latch per kind", () => {
  test.each([
    ["video", 900, true], ["video", 899, false], ["episode", 900, true], ["film", 905, true], ["podcast_episode", 950, true], ["podcast_episode", 949, false],
    ["audiobook", 950, true], ["audiobook", 940, false], ["chapter", 960, true],
  ] as const)("%s at %d of 1000 seconds latches: %s", (kind, at, latched) => {
    expect(reachesLatch(kind, secs(at), 1000)).toBe(latched);
    expect(mergeProgress(kind, null, write({ position: secs(at) })).state.completed).toBe(latched);
  });
  test("no duration, no latch from seconds", () => {
    expect(reachesLatch("video", secs(5000), null)).toBe(false);
  });
  test("a track never latches; a finish counts", () => {
    const merged = mergeProgress("track", state({ finishes: 2 }), write({ position: secs(240), duration_s: 240, events: { finish: true } }));
    expect(merged.state).toMatchObject({ completed: false, finishes: 3 });
  });
  test("a book is finished by the person or at the end of the text", () => {
    const at = (percent: number) => ({ locator: { kind: "page" as const, page: 3, cfi: null, spine_index: null, block_index: null }, percent });
    expect(mergeProgress("book", null, write({ position: at(98) })).state.completed).toBe(false);
    expect(mergeProgress("book", null, write({ position: at(99) })).state.completed).toBe(true);
    expect(mergeProgress("book", null, write({ position: at(40), completed: true })).state.completed).toBe(true);
  });
  test("the latch holds when the person rewinds, and when an older write arrives", () => {
    const done = mergeProgress("video", null, write({ position: secs(950), stamp: T(100) })).state;
    expect(done.completed).toBe(true);
    expect(mergeProgress("video", done, write({ position: secs(10), stamp: T(200) })).state).toMatchObject({ completed: true, position: secs(10) });
    expect(mergeProgress("video", done, write({ position: secs(10), stamp: T(50) })).state.completed).toBe(true);
  });
  test("a finish reported by an older write still latches (a finish is a fact whenever it arrives)", () => {
    const merged = mergeProgress("video", state({ position: secs(100), updated_at: T(300) }), write({ position: secs(980), stamp: T(250) }));
    expect(merged.state).toMatchObject({ completed: true, position: secs(100) });
  });
  test("only the person clears it, with a clear that is newer than the row", () => {
    const done = state({ completed: true, position: secs(950), updated_at: T(300) });
    expect(mergeProgress("video", done, write({ position: secs(0), completed: false, stamp: T(400) })).state).toMatchObject({ completed: false, position: secs(0) });
    expect(mergeProgress("video", done, write({ position: secs(0), completed: false, stamp: T(200) })).state.completed).toBe(true);
  });
});

describe("mergeProgress: marks and counters", () => {
  test("a deleted snip's tombstone wins over the snip it replaces, and a stale copy of the snip does not bring it back", () => {
    const tomb = { at_s: 10, label: "podcast-snip:deleted:12" };
    const live = { at_s: 10, label: "podcast-snip:12:note" };
    expect(mergeProgress("audiobook", state({ marks: [live] }), write({ marks: [tomb] })).state.marks).toEqual([tomb]);
    expect(mergeProgress("audiobook", state({ marks: [tomb], updated_at: T(300) }), write({ marks: [live], stamp: T(250) })).state.marks).toEqual([tomb]);
  });
  test("marks union by at_s; the newer write's label wins for a shared time", () => {
    const merged = mergeProgress("audiobook", state({ marks: [{ at_s: 10, label: "old" }, { at_s: 50, label: "keep" }] }), write({ marks: [{ at_s: 10, label: "new" }, { at_s: 5, label: null }] }));
    expect(merged.state.marks).toEqual([{ at_s: 5, label: null }, { at_s: 10, label: "new" }, { at_s: 50, label: "keep" }]);
    const older = mergeProgress("audiobook", state({ marks: [{ at_s: 10, label: "mine" }], updated_at: T(500) }), write({ stamp: T(100), marks: [{ at_s: 10, label: "stale" }] }));
    expect(older.state.marks).toEqual([{ at_s: 10, label: "mine" }]);
  });
  test("absolute counts take the larger, so replaying a batch twice counts nothing twice; events add one each", () => {
    const batch = write({ counts: { plays: 4, skips: 1, finishes: 2 } });
    const once = mergeProgress("track", state({ plays: 3 }), batch).state;
    const twice = mergeProgress("track", once, batch).state;
    expect(twice).toMatchObject({ plays: 4, skips: 1, finishes: 2 });
    expect(mergeProgress("track", twice, write({ events: { play: true, skip: true } })).state).toMatchObject({ plays: 5, skips: 2 });
  });
});

// ---- the stored path ----

let adult: PersonRow;
let child: PersonRow;
let teen: PersonRow;
const movie = { id: "media-movie000001", kind: "film" } as Pick<MediaItem, "id" | "kind">;
const song = { id: "media-song0000001", kind: "track" } as Pick<MediaItem, "id" | "kind">;

beforeEach(() => {
  resetDb();
  __resetProgressForTests();
  const now = new Date().toISOString();
  const add = (id: string, role: string, birthdate?: string) =>
    db.insert(people).values({ id, displayName: id, role, birthdate: birthdate ?? null, avatarSeed: "s", source: "local", createdAt: now, updatedAt: now, hlc: "1:0:aaaaaa" }).run();
  add("person-adult00001", "adult");
  add("person-child00001", "child", "2018-03-01");
  add("person-teen000001", "teen", "2011-03-01");
  const get = (id: string) => db.select().from(people).where(eq(people.id, id)).get() as unknown as PersonRow;
  adult = get("person-adult00001");
  child = get("person-child00001");
  teen = get("person-teen000001");
  db.insert(mediaSources).values({ id: "msrc-fixture0001", kind: "root", scope: "household", label: "x", createdAt: now, hlc: "1:0:aaaaaa", provenance: "test" }).run();
  for (const item of [movie, song]) {
    db.insert(mediaItems).values({ id: item.id, kind: item.kind, title: item.id, sourceId: "msrc-fixture0001", mediaType: "video/mp4", playable: "original", bandOk: "child", addedAt: now, createdAt: now, hlc: "1:0:aaaaaa", provenance: "test" }).run();
  }
});

const rowsFor = (personId: string) => db.select().from(mediaProgress).where(eq(mediaProgress.personId, personId)).all();

describe("write coalescing", () => {
  test("a flood of position ticks from one tab is one row and a handful of database writes, not one per tick", () => {
    const now = new Date();
    writeProgress(adult, movie, write({ position: secs(1), stamp: T(1) }), { now, immediate: true });
    expect(progressStats.dbWrites).toBe(1);
    for (let i = 2; i <= 60; i++) writeProgress(adult, movie, write({ position: secs(i), stamp: T(i) }), { now: new Date(now.getTime() + i * 10) });
    expect(progressStats.dbWrites).toBe(1); // 59 ticks held
    expect(getProgress(adult.id, movie.id)!.position).toEqual(secs(60)); // a read sees the newest
    expect(progressStats.dbWrites).toBe(2);
    expect(rowsFor(adult.id)).toHaveLength(1);
  });
  test("a held tick answers with the row as it will be; an event or a finish between ticks is kept in order", () => {
    const now = new Date();
    writeProgress(adult, movie, write({ position: secs(1), stamp: T(1) }), { now, immediate: true });
    const held = writeProgress(adult, movie, write({ position: secs(20), stamp: T(20) }), { now });
    expect(held.ok && held.progress.position).toEqual(secs(20));
    writeProgress(adult, movie, write({ position: secs(30), stamp: T(30), events: { play: true } }), { now });
    writeProgress(adult, movie, write({ position: secs(40), stamp: T(40), events: { skip: true } }), { now });
    writeProgress(adult, movie, write({ position: secs(950), stamp: T(95), events: { finish: true } }), { now }); // a finish is stored at once
    const row = rowsFor(adult.id)[0]!;
    expect(row).toMatchObject({ plays: 1, skips: 1, finishes: 1, completed: true });
    expect(JSON.parse(row.position)).toEqual(secs(950));
  });
  test("pause, seek and unload store at once", () => {
    writeProgress(adult, movie, write({ position: secs(1), stamp: T(1) }), { immediate: true });
    writeProgress(adult, movie, write({ position: secs(2), stamp: T(2) }), { immediate: true });
    expect(progressStats.dbWrites).toBe(2);
  });
  test("flushProgress stores what is held", () => {
    const now = new Date();
    writeProgress(adult, movie, write({ position: secs(1), stamp: T(1) }), { now, immediate: true });
    writeProgress(adult, movie, write({ position: secs(9), stamp: T(9) }), { now });
    flushProgress();
    expect(JSON.parse(rowsFor(adult.id)[0]!.position)).toEqual(secs(9));
  });
  test("a book wants a place in the text and everything else wants seconds", () => {
    const book = { id: "media-book00000001", kind: "book" } as Pick<MediaItem, "id" | "kind">;
    expect(writeProgress(adult, book, write({ position: secs(5) }))).toEqual({ ok: false, refusal: "wrong_position_shape" });
    expect(writeProgress(adult, movie, write({ position: { locator: { kind: "page", page: 2 }, percent: 3 } as never }))).toEqual({ ok: false, refusal: "wrong_position_shape" });
  });
});

describe("a minor's row is never written by another person's device", () => {
  test("a device paired to a parent cannot save a child's place; the child's own device can; an adult may use any device", () => {
    const parentTv = createDevice("tv", "Living room TV", adult.id);
    const childTablet = createDevice("browser", "Tablet", child.id);
    expect(writeProgress(child, movie, write({ device_id: parentTv.id }), { immediate: true })).toEqual({ ok: false, refusal: "other_persons_device" });
    expect(rowsFor(child.id)).toHaveLength(0);
    expect(writeProgress(child, movie, write({ device_id: childTablet.id }), { immediate: true }).ok).toBe(true);
    expect(writeProgress(teen, movie, write({ device_id: parentTv.id }), { immediate: true })).toEqual({ ok: false, refusal: "other_persons_device" });
    expect(writeProgress(adult, movie, write({ device_id: childTablet.id }), { immediate: true }).ok).toBe(true); // an adult signed in on a shared screen
    expect(writeProgress(child, movie, write({ device_id: null }), { immediate: true }).ok).toBe(true); // a browser with no paired device
  });
  test("rows are per person: two people watching one title do not touch each other's place", () => {
    writeProgress(adult, movie, write({ position: secs(500), stamp: T(500) }), { immediate: true });
    writeProgress(child, movie, write({ position: secs(20), stamp: T(20) }), { immediate: true });
    expect(getProgress(adult.id, movie.id)!.position).toEqual(secs(500));
    expect(getProgress(child.id, movie.id)!.position).toEqual(secs(20));
  });
  test("a track counts plays and finishes and never completes", () => {
    for (let i = 0; i < 3; i++) writeProgress(adult, song, write({ position: secs(240), duration_s: 240, stamp: T(10 + i), events: { play: true, finish: true } }));
    expect(rowsFor(adult.id)[0]).toMatchObject({ plays: 3, finishes: 3, completed: false });
  });
});
