// LYRICS-LOOKUP: the "look up lyrics" action with all of its gates (lib/media/lyricsAction.ts).
import { beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db, sqlite } from "@/db";
import { mediaItems, people } from "@/db/schema";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { buildMediaTree } from "./support/mediaTree";
import { scanRoot } from "@/lib/media/scan";
import { setHouseholdSettingValue } from "@/lib/settings";
import { lookupLyricsFor } from "@/lib/media/lyricsAction";
import { hasReceipt } from "@/lib/media/lyricsReceipts";

// These two tables land in a migration this change does not write, so the
// test database does not have them yet: create them here, matching
// backend/src/db/schema.ts exactly.
sqlite.exec(`
CREATE TABLE IF NOT EXISTS lyrics_lookups (
  item_id text PRIMARY KEY NOT NULL,
  looked_up_at integer NOT NULL,
  outcome text NOT NULL
);
CREATE TABLE IF NOT EXISTS lyrics_lookup_state (
  id integer PRIMARY KEY NOT NULL,
  paused_until integer NOT NULL DEFAULT 0,
  backoff_s integer NOT NULL DEFAULT 0
);
`);

// resetDb() predates these tables and does not clear them, so the rows go.
beforeEach(() => {
  resetDb();
  sqlite.exec("DELETE FROM lyrics_lookups");
  sqlite.exec("DELETE FROM lyrics_lookup_state");
});

async function setup(): Promise<{ adultId: string; childId: string; teenId: string }> {
  const owner = new TestClient();
  await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const signIn = async (displayName: string, role: string): Promise<string> => {
    const made = await owner.post("/api/people", { displayName, role, secret: "0000" });
    const created = (await made.json()) as { id: string };
    const client = new TestClient();
    await client.post("/api/auth/verify-secret", { personId: created.id, secret: "0000" });
    return created.id;
  };
  const adultId = await signIn("Marlow", "adult");
  const childId = await signIn("Sprout", "child");
  const teenId = await signIn("Tally", "teen");
  const tree = buildMediaTree();
  const musicSource = await owner.post("/api/media/sources", { label: "music", path: tree.music, kinds: ["track"] });
  await scanRoot(((await musicSource.json()) as { source: { id: string } }).source.id, { prober: null, pruneGraceMs: 0 });
  return { adultId, childId, teenId };
}

const person = (id: string) => db.select().from(people).where(eq(people.id, id)).get()!;
const trackId = (title: string) => db.select().from(mediaItems).all().find((item) => item.title === title)!.id;
const withArtist = (id: string, artist: string | null) => db.update(mediaItems).set({ artist }).where(eq(mediaItems.id, id)).run();
const storeLyrics = (id: string, lyrics: Record<string, unknown> | null) =>
  db.update(mediaItems).set({ lyrics: lyrics === null ? null : JSON.stringify(lyrics) }).where(eq(mediaItems.id, id)).run();
const storedLyrics = (id: string) => db.select().from(mediaItems).where(eq(mediaItems.id, id)).get()!.lyrics;

type Fake = { fetch: typeof fetch; calls: () => number };
function fakeFetch(status: number, body?: Record<string, unknown>): Fake {
  let calls = 0;
  const fn = async (): Promise<Response> => {
    calls++;
    return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  };
  return { fetch: fn as unknown as typeof fetch, calls: () => calls };
}

test("a hit stores the lyrics and a receipt, and a second call makes no fetch", async () => {
  const { adultId } = await setup();
  const id = trackId("Morning Light");
  withArtist(id, "The Marlows");
  const fake = fakeFetch(200, { plainLyrics: "Hello there\nGeneral Kenobi" });
  const first = await lookupLyricsFor(person(adultId), id, { fetch: fake.fetch, nowMs: () => 1000 });
  expect(first).toEqual({ ok: true, value: { lookup: "found", lyrics: "Hello there\nGeneral Kenobi" } });
  expect(fake.calls()).toBe(1);
  expect(hasReceipt(id)).toBe(true);
  expect(JSON.parse(storedLyrics(id)!)).toEqual({ source: "lrclib", text: "Hello there\nGeneral Kenobi" });
  const second = await lookupLyricsFor(person(adultId), id, { fetch: fake.fetch, nowMs: () => 2000 });
  expect(second).toMatchObject({ ok: true, value: { lookup: "none" } });
  expect(fake.calls()).toBe(1);
});

test("a miss stores a receipt and returns none", async () => {
  const { adultId } = await setup();
  const id = trackId("Morning Light");
  withArtist(id, "The Marlows");
  const fake = fakeFetch(404);
  const first = await lookupLyricsFor(person(adultId), id, { fetch: fake.fetch, nowMs: () => 1000 });
  expect(first).toEqual({ ok: true, value: { lookup: "none" } });
  expect(fake.calls()).toBe(1);
  expect(hasReceipt(id)).toBe(true);
  expect(storedLyrics(id)).toBeNull();
  const second = await lookupLyricsFor(person(adultId), id, { fetch: fake.fetch, nowMs: () => 2000 });
  expect(second).toEqual({ ok: true, value: { lookup: "none" } });
  expect(fake.calls()).toBe(1);
});

test("with the setting off it returns none and makes no fetch", async () => {
  const { adultId } = await setup();
  const id = trackId("Morning Light");
  withArtist(id, "The Marlows");
  setHouseholdSettingValue("music.lyrics_online", false);
  const fake = fakeFetch(200, { plainLyrics: "x" });
  const res = await lookupLyricsFor(person(adultId), id, { fetch: fake.fetch, nowMs: () => 1000 });
  expect(res).toEqual({ ok: true, value: { lookup: "none" } });
  expect(fake.calls()).toBe(0);
  expect(hasReceipt(id)).toBe(false);
});

test("a child gets none and makes no fetch", async () => {
  const { childId } = await setup();
  const id = trackId("Morning Light");
  withArtist(id, "The Marlows");
  const fake = fakeFetch(200, { plainLyrics: "x" });
  const res = await lookupLyricsFor(person(childId), id, { fetch: fake.fetch, nowMs: () => 1000 });
  expect(res).toEqual({ ok: true, value: { lookup: "none" } });
  expect(fake.calls()).toBe(0);
});

test("a generated song is not scanned and makes no fetch", async () => {
  const { adultId } = await setup();
  const id = trackId("Morning Light");
  withArtist(id, "The Marlows");
  db.update(mediaItems).set({ provenance: "music:generated-library" }).where(eq(mediaItems.id, id)).run();
  const fake = fakeFetch(200, { plainLyrics: "x" });
  const res = await lookupLyricsFor(person(adultId), id, { fetch: fake.fetch, nowMs: () => 1000 });
  expect(res).toEqual({ ok: true, value: { lookup: "none" } });
  expect(fake.calls()).toBe(0);
});

test("an item that already has lyrics returns them and makes no fetch", async () => {
  const { adultId } = await setup();
  const id = trackId("Morning Light");
  withArtist(id, "The Marlows");
  storeLyrics(id, { source: "file", text: "First line", timed: [{ t: 1, line: "First line", section: "Verse" }] });
  const fake = fakeFetch(200, { plainLyrics: "x" });
  const res = await lookupLyricsFor(person(adultId), id, { fetch: fake.fetch, nowMs: () => 1000 });
  expect(res).toEqual({ ok: true, value: { lookup: "none", lyrics: "First line", timed_lyrics: [{ t: 1, line: "First line", section: "Verse" }] } });
  expect(fake.calls()).toBe(0);
});

test("an item with no artist gets none and makes no fetch", async () => {
  const { adultId } = await setup();
  const id = trackId("Morning Light");
  withArtist(id, null);
  const fake = fakeFetch(200, { plainLyrics: "x" });
  const res = await lookupLyricsFor(person(adultId), id, { fetch: fake.fetch, nowMs: () => 1000 });
  expect(res).toEqual({ ok: true, value: { lookup: "none" } });
  expect(fake.calls()).toBe(0);
});

test("a refusal pauses the lookup and the next call makes no fetch", async () => {
  const { adultId } = await setup();
  const id = trackId("Morning Light");
  withArtist(id, "The Marlows");
  const fake = fakeFetch(500);
  const first = await lookupLyricsFor(person(adultId), id, { fetch: fake.fetch, nowMs: () => 1000 });
  expect(first).toEqual({ ok: true, value: { lookup: "paused" } });
  expect(fake.calls()).toBe(1);
  expect(hasReceipt(id)).toBe(false);
  const second = await lookupLyricsFor(person(adultId), id, { fetch: fake.fetch, nowMs: () => 2000 });
  expect(second).toEqual({ ok: true, value: { lookup: "paused" } });
  expect(fake.calls()).toBe(1);
});

test("two lookups of different songs inside one second: the second is paused", async () => {
  const { adultId } = await setup();
  const a = trackId("Morning Light");
  const b = trackId("Loud Song");
  withArtist(a, "The Marlows");
  withArtist(b, "Clover");
  const fake = fakeFetch(200, { plainLyrics: "x" });
  const first = await lookupLyricsFor(person(adultId), a, { fetch: fake.fetch, nowMs: () => 1000 });
  expect(first).toMatchObject({ ok: true, value: { lookup: "found" } });
  expect(fake.calls()).toBe(1);
  const second = await lookupLyricsFor(person(adultId), b, { fetch: fake.fetch, nowMs: () => 1500 });
  expect(second).toEqual({ ok: true, value: { lookup: "paused" } });
  expect(fake.calls()).toBe(1);
});

test("a hit whose text fails the band for a minor stores nothing but keeps the receipt", async () => {
  const { teenId } = await setup();
  const id = trackId("Morning Light");
  withArtist(id, "The Marlows");
  const fake = fakeFetch(200, { plainLyrics: "She danced naked in the rain" });
  const res = await lookupLyricsFor(person(teenId), id, { fetch: fake.fetch, nowMs: () => 1000 });
  expect(res).toEqual({ ok: true, value: { lookup: "none" } });
  expect(fake.calls()).toBe(1);
  expect(hasReceipt(id)).toBe(true);
  expect(storedLyrics(id)).toBeNull();
});
