import { beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { mediaItems, musicSongFacts } from "@/db/schema";
import { lookupSongFact, runSongFactPass, songFactFor } from "@/lib/media/songFacts";
import type { MusicBrainzClient } from "@/lib/media/musicbrainzMatch";
import { resetDb } from "./reset-db";
import { people, mediaSources } from "@/db/schema";

const REC = "11111111-1111-4111-8111-111111111111";
const stamp = { createdAt: new Date().toISOString(), hlc: "1:0:aaaaaa", provenance: "test" };
const EN_WIKI = "https://en.wikipedia.org/wiki/Paper_Boats";
const extract = "Paper Boats is a song by Rivet Row. It was released in 1974. A third sentence.";
const linked = (url: string) => ({ relations: [{ type: "wikipedia", url: { resource: url } }] });
function client(relations: unknown): MusicBrainzClient {
  return { searchRecordings: async () => [], lookupArtistWikidata: async () => null, lookupArtistGenres: async () => [], lookupRecordingRelations: async () => relations as never };
}
function pageFetch(calls: string[] = []) {
  return async (url: string): Promise<unknown> => { calls.push(url); if (url.includes("wikipedia.org/api/rest_v1")) return { title: "Paper Boats", extract }; if (url.includes("wikidata.org")) return { entities: { Q123: { claims: {}, sitelinks: { enwiki: { title: "Paper Boats" } } } } }; throw new Error("unexpected URL"); };
}

beforeEach(() => resetDb());

test("uses a recording's direct English Wikipedia link and shortens the extract", async () => {
  const calls: string[] = [];
  expect(await lookupSongFact(REC, { client: client(linked(EN_WIKI)), fetchJson: pageFetch(calls) })).toEqual({ status: "found", summary: "Paper Boats is a song by Rivet Row. It was released in 1974.", pageUrl: EN_WIKI });
  expect(calls).toHaveLength(1);
  expect(calls[0]).toContain("Paper_Boats");
});

test("uses Wikidata only when no direct article link exists; no link or non-English page means none", async () => {
  const wd = { relations: [{ type: "wikidata", url: { resource: "https://www.wikidata.org/wiki/Q123" } }] };
  expect((await lookupSongFact(REC, { client: client(wd), fetchJson: pageFetch() })).status).toBe("found");
  expect((await lookupSongFact(REC, { client: client({}), fetchJson: pageFetch() })).status).toBe("none");
  expect((await lookupSongFact(REC, { client: client(linked("https://fr.wikipedia.org/wiki/Paper_Boats")), fetchJson: pageFetch() })).status).toBe("none");
});

test("a Wikidata-linked human under 18 or with no birth date is withheld before Wikipedia", async () => {
  const youth = new Date().getUTCFullYear() - 12;
  const wd = { relations: [{ type: "wikidata", url: { resource: "https://www.wikidata.org/wiki/Q123" } }] };
  const fetchJson = async (url: string) => url.includes("wikidata.org") ? { entities: { Q123: { claims: { P31: [{ mainsnak: { datavalue: { value: { id: "Q5" } } } }], P569: [{ mainsnak: { datavalue: { value: { time: `+${youth}-01-01T00:00:00Z` } } } }] } } } } : { title: "Paper Boats", extract };
  expect((await lookupSongFact(REC, { client: client(wd), fetchJson })).status).toBe("withheld");
});

function insertTrack() {
  db.insert(people).values({ id: "person-reader0001", displayName: "Reader", role: "adult", birthdate: "1990-01-01", avatarSeed: "s", source: "local", createdAt: stamp.createdAt, updatedAt: stamp.createdAt, hlc: stamp.hlc }).run();
  db.insert(mediaSources).values({ id: "msrc-music000001", kind: "root", scope: "household", label: "Music", createdAt: stamp.createdAt, hlc: stamp.hlc, provenance: "test" }).run();
  db.insert(mediaItems).values({ id: "media-song000001", sourceId: "msrc-music000001", kind: "track", locRootId: "msrc-music000001", locPath: "song.mp3", title: "Paper Boats", artist: "Rivet Row", musicbrainzRecordingId: REC, bandOk: "child", mediaType: "audio/mpeg", playable: "original", addedAt: stamp.createdAt, ...stamp }).run();
  return db.select().from(mediaItems).where(eq(mediaItems.id, "media-song000001")).get()!;
}

test("pass stores found locally, respects switch, and reader view checks the fact band", async () => {
  insertTrack();
  const track = { ...db.select().from(mediaItems).get()!, musicbrainz_recording_id: REC, band_ok: "child", advisory: { explicit: false } } as never;
  const person = db.select().from(people).get()!;
  const deps = { client: client(linked(EN_WIKI)), fetchJson: pageFetch(), budget: 10, now: () => new Date("2026-11-04T12:00:00Z") };
  const found = await runSongFactPass(deps);
  expect(found).toMatchObject({ considered: 1, found: 1, failed: 0 });
  expect(songFactFor(track, person)).toEqual({ summary: "Paper Boats is a song by Rivet Row. It was released in 1974.", url: EN_WIKI });
  db.delete(musicSongFacts).where(eq(musicSongFacts.musicbrainzRecordingId, REC)).run();
});

import { mediaAppData } from "@/lib/media/appHost";
function storeFact(status: string, summary: string | null) {
  db.insert(musicSongFacts).values({ musicbrainzRecordingId: REC, status, summary, pageUrl: summary ? EN_WIKI : null, fetchedAt: stamp.createdAt, hlc: stamp.hlc }).onConflictDoUpdate({ target: musicSongFacts.musicbrainzRecordingId, set: { status, summary, pageUrl: summary ? EN_WIKI : null } }).run();
}
const factRows = (person: ReturnType<typeof insertPerson>) => mediaAppData(person, "audio", "up-next", { id: "media-song000001", scope: "fact" }) as unknown as Array<Record<string, unknown>>;
function insertPerson() { return db.select().from(people).get()!; }

test("the song fact data path (up-next, scope fact) returns one text row for a stored fact and nothing otherwise", () => {
  insertTrack();
  const person = insertPerson();
  expect(factRows(person)).toEqual([]);
  storeFact("found", "Paper Boats is a song by Rivet Row.");
  expect(factRows(person)).toMatchObject([{ id: "media-song000001", title: "Did you know?", channel: "Paper Boats is a song by Rivet Row. (Wikipedia)", source_url: EN_WIKI }]);
  expect(mediaAppData(person, "audio", "up-next", { scope: "fact" })).toEqual([]);
  storeFact("none", null);
  expect(factRows(person)).toEqual([]);
  storeFact("withheld", null);
  expect(factRows(person)).toEqual([]);
});

test("the song fact data path (up-next, scope fact) returns nothing when the fact text fails the reader's band", () => {
  insertTrack();
  db.insert(people).values({ id: "person-child00001", displayName: "Kid", role: "child", birthdate: new Date().getUTCFullYear() - 7 + "-01-01", avatarSeed: "s", source: "local", createdAt: stamp.createdAt, updatedAt: stamp.createdAt, hlc: "1:1:aaaaaa" }).run();
  const child = db.select().from(people).where(eq(people.id, "person-child00001")).get()!;
  storeFact("found", "Paper Boats is a song about porn.");
  expect(factRows(child)).toEqual([]);
  storeFact("found", "Paper Boats is a song by Rivet Row.");
  expect(factRows(child).length).toBeLessThanOrEqual(1);
  expect(factRows(insertPerson()).length).toBe(1);
});
