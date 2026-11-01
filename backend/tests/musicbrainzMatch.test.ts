// MUSIC-MB-01: the background MusicBrainz matcher, against an offline MusicBrainz fixture (no real network).
import { beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { mediaItems } from "@/db/schema";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { buildMediaTree } from "./support/mediaTree";
import { scanRoot } from "@/lib/media/scan";
import { setHouseholdSettingValue } from "@/lib/settings";
import { tagsFromMetadata } from "@/lib/media/parsers/audioTags";
import {
  checkedKeyOf, chooseMatch, createMusicBrainzClient, foldName, MusicBrainzUnavailable, recordingQuery, runMusicBrainzPass, type MbRecording, type MusicBrainzClient, type SongText,
} from "@/lib/media/musicbrainzMatch";

const REC = "11111111-1111-4111-8111-111111111111";
const REC2 = "22222222-2222-4222-8222-222222222222";
const ART = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RG = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const RG2 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const song: SongText = { title: "Morning Light", artist: "Quill", album: "Riff Tales", albumArtist: null, trackNo: 3, durationS: 200 };
function recording(over: Partial<MbRecording> = {}, releaseTitle = "Riff Tales", group = RG): MbRecording {
  return {
    id: REC, title: "Morning Light", score: 100, length: 201_000,
    "artist-credit": [{ name: "Quill", artist: { id: ART, name: "Quill" } }],
    releases: [{ id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", title: releaseTitle, "release-group": { id: group }, media: [{ track: [{ number: "3" }] }] }],
    ...over,
  };
}

beforeEach(() => resetDb());

test("a clean match returns the recording, artist and release group ids", () => {
  expect(chooseMatch(song, [recording()])).toEqual({ recordingId: REC, artistId: ART, releaseGroupId: RG });
});

test("spelling quirks fold: accents, curly quotes, ampersand, a remaster note", () => {
  expect(foldName("Café ’Riff’ & Tempo (2011 Remaster)")).toBe(foldName("Cafe 'Riff' and Tempo"));
  const quirky: SongText = { ...song, title: "Morning Light - 2011 Remastered", artist: "QUILL" };
  expect(chooseMatch(quirky, [recording()])?.recordingId).toBe(REC);
});

test("an ambiguous name (two recordings fit) stays empty, a track number can still decide", () => {
  const noAlbum: SongText = { ...song, album: null };
  expect(chooseMatch(noAlbum, [recording(), recording({ id: REC2 })])).toBeNull();
  const second = recording({ id: REC2 }, "Riff Tales", RG);
  second.releases![0]!.media = [{ track: [{ number: "9" }] }];
  expect(chooseMatch(song, [recording(), second])?.recordingId).toBe(REC);
});

test("a wrong match stays empty: other title, other artist, other album, low score, wrong length", () => {
  expect(chooseMatch(song, [recording({ title: "Evening Dark" })])).toBeNull();
  expect(chooseMatch(song, [recording({ "artist-credit": [{ name: "Riff", artist: { id: ART, name: "Riff" } }] })])).toBeNull();
  expect(chooseMatch(song, [recording({}, "Another Album", RG2)])).toBeNull();
  expect(chooseMatch(song, [recording({ score: 60 })])).toBeNull();
  expect(chooseMatch(song, [recording({ length: 400_000 })])).toBeNull();
  expect(chooseMatch(song, [])).toBeNull();
});

test("the search text quotes title, artist and album and strips query syntax", () => {
  expect(recordingQuery({ ...song, title: 'Morning "Light" (live)' })).toBe('recording:"Morning Light live" AND artist:"Quill" AND release:"Riff Tales"');
});

test("embedded MusicBrainz tag ids are read from the file's tags and win over a search", () => {
  const meta = { common: { title: "Morning Light", musicbrainz_recordingid: REC.toUpperCase(), musicbrainz_artistid: [ART], musicbrainz_releasegroupid: "not-a-uuid" }, format: {}, native: {} } as never;
  const tags = tagsFromMetadata(meta);
  expect(tags.musicbrainzRecordingId).toBe(REC);
  expect(tags.musicbrainzArtistId).toBe(ART);
  expect(tags.musicbrainzReleaseGroupId).toBeNull();
});

test("rate spacing: requests are at least 1.1 s apart, send an identifying User-Agent, and ask musicbrainz only", async () => {
  let clock = 0;
  const slept: number[] = [];
  const seen: Array<{ at: number; url: string; ua: string | null }> = [];
  const client = createMusicBrainzClient({
    now: () => clock,
    sleep: async (ms) => { slept.push(ms); clock += ms; },
    fetch: (async (input: string | URL, init?: RequestInit) => {
      seen.push({ at: clock, url: String(input), ua: new Headers(init?.headers).get("User-Agent") });
      return new Response(JSON.stringify({ recordings: [] }), { status: 200 });
    }) as unknown as typeof fetch,
  });
  await Promise.all([client.searchRecordings("a", 5), client.searchRecordings("b", 5), client.searchRecordings("c", 5)]);
  expect(seen).toHaveLength(3);
  expect(seen[1]!.at - seen[0]!.at).toBeGreaterThanOrEqual(1000);
  expect(seen[2]!.at - seen[1]!.at).toBeGreaterThanOrEqual(1000);
  for (const call of seen) expect(call.ua).toMatch(/^MaiPai-Home\/.+github\.com\/getmaipai\/home/);
  expect(seen.every((call) => new URL(call.url).pathname === "/ws/2/recording")).toBe(true);
});

test("offline fallback: a network error, a 503 and a bad body all become MusicBrainzUnavailable", async () => {
  const make = (fetchImpl: unknown) => createMusicBrainzClient({ now: () => 0, sleep: async () => undefined, minGapMs: 0, fetch: fetchImpl as typeof fetch });
  await expect(make(async () => { throw new TypeError("offline"); }).searchRecordings("x", 1)).rejects.toBeInstanceOf(MusicBrainzUnavailable);
  await expect(make(async () => new Response("busy", { status: 503 })).searchRecordings("x", 1)).rejects.toBeInstanceOf(MusicBrainzUnavailable);
  await expect(make(async () => new Response("<html>", { status: 200 })).searchRecordings("x", 1)).rejects.toBeInstanceOf(MusicBrainzUnavailable);
});

// ---- The pass, against the database ------------------------------------------------------------------------------------------------

async function scannedTracks(): Promise<string[]> {
  setHouseholdSettingValue("music.musicbrainz_match", false); // the scan's own kick must not search while the fixture is set up
  const owner = new TestClient();
  await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const tree = buildMediaTree();
  const made = await owner.post("/api/media/sources", { label: "music", path: tree.music, kinds: ["track"] });
  const id = ((await made.json()) as { source: { id: string } }).source.id;
  await scanRoot(id, { prober: null, pruneGraceMs: 0 });
  setHouseholdSettingValue("music.musicbrainz_match", true);
  return db.select().from(mediaItems).where(eq(mediaItems.kind, "track")).all().map((row) => row.id);
}

function fakeClient(answer: (query: string) => MbRecording[] | Error): { client: MusicBrainzClient; queries: string[] } {
  const queries: string[] = [];
  return {
    queries,
    client: { lookupArtistWikidata: async () => null, searchRecordings: async (query) => { queries.push(query); const out = answer(query); if (out instanceof Error) throw out; return out; } },
  };
}

test("the pass stores ids for a clean match, leaves a wrong match empty, and does not search the same text twice", async () => {
  const ids = await scannedTracks();
  const [first, second] = ids as [string, string];
  db.update(mediaItems).set({ title: "Morning Light", artist: "Quill", album: "Riff Tales", trackNo: 3, durationS: 200 }).where(eq(mediaItems.id, first)).run();
  db.update(mediaItems).set({ title: "Loud Song", artist: "Riff", album: null, trackNo: null, durationS: null }).where(eq(mediaItems.id, second)).run();
  const fake = fakeClient((query) => (query.includes("Morning Light") ? [recording()] : [recording({ title: "Quiet Song" })]));
  const result = await runMusicBrainzPass({ client: fake.client });
  expect(result).toMatchObject({ considered: 2, matched: 1, empty: 1, failed: 0 });
  const a = db.select().from(mediaItems).where(eq(mediaItems.id, first)).get()!;
  expect([a.musicbrainzRecordingId, a.musicbrainzArtistId, a.musicbrainzReleaseGroupId]).toEqual([REC, ART, RG]);
  const b = db.select().from(mediaItems).where(eq(mediaItems.id, second)).get()!;
  expect([b.musicbrainzRecordingId, b.musicbrainzArtistId, b.musicbrainzReleaseGroupId]).toEqual([null, null, null]);
  expect(b.musicbrainzCheckedKey).toBe(checkedKeyOf({ title: "Loud Song", artist: "Riff", album: null, albumArtist: b.albumArtist, trackNo: null, durationS: null }));
  const again = await runMusicBrainzPass({ client: fake.client });
  expect(again.considered).toBe(0);
  expect(fake.queries).toHaveLength(2);
});

test("a song that already has a recording id (a tag) is never searched", async () => {
  const [id] = await scannedTracks();
  db.update(mediaItems).set({ artist: "Quill", musicbrainzRecordingId: REC2 }).where(eq(mediaItems.id, id!)).run();
  db.update(mediaItems).set({ artist: null }).where(eq(mediaItems.kind, "track")).run();
  db.update(mediaItems).set({ artist: "Quill" }).where(eq(mediaItems.id, id!)).run();
  const fake = fakeClient(() => [recording()]);
  await runMusicBrainzPass({ client: fake.client });
  expect(fake.queries).toHaveLength(0);
  expect(db.select().from(mediaItems).where(eq(mediaItems.id, id!)).get()!.musicbrainzRecordingId).toBe(REC2);
});

test("offline: the pass fails nothing, stores nothing, marks nothing searched and stops after three failures", async () => {
  const ids = await scannedTracks();
  db.update(mediaItems).set({ artist: "Quill" }).where(eq(mediaItems.kind, "track")).run();
  const fake = fakeClient(() => new MusicBrainzUnavailable("network"));
  const result = await runMusicBrainzPass({ client: fake.client });
  expect(result.matched).toBe(0);
  expect(result.failed).toBe(Math.min(3, ids.length));
  for (const row of db.select().from(mediaItems).where(eq(mediaItems.kind, "track")).all()) {
    expect(row.musicbrainzRecordingId).toBeNull();
    expect(row.musicbrainzCheckedKey).toBeNull();
  }
});

test("the owner's off switch stops the matcher before any request", async () => {
  await scannedTracks();
  db.update(mediaItems).set({ artist: "Quill" }).where(eq(mediaItems.kind, "track")).run();
  setHouseholdSettingValue("music.musicbrainz_match", false);
  const fake = fakeClient(() => [recording()]);
  const result = await runMusicBrainzPass({ client: fake.client });
  expect(result.considered).toBe(0);
  expect(fake.queries).toHaveLength(0);
});

test("a rescan keeps a matched id while the song's text is unchanged and drops it when the text changes", async () => {
  setHouseholdSettingValue("music.musicbrainz_match", false);
  const owner = new TestClient();
  await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const tree = buildMediaTree();
  const made = await owner.post("/api/media/sources", { label: "music", path: tree.music, kinds: ["track"] });
  const sourceId = ((await made.json()) as { source: { id: string } }).source.id;
  await scanRoot(sourceId, { prober: null, pruneGraceMs: 0 });
  const row = db.select().from(mediaItems).where(eq(mediaItems.kind, "track")).all()[0]!;
  db.update(mediaItems).set({ musicbrainzRecordingId: REC, musicbrainzArtistId: ART, musicbrainzCheckedKey: "k" }).where(eq(mediaItems.id, row.id)).run();
  await scanRoot(sourceId, { prober: null, pruneGraceMs: 0, force: true });
  expect(db.select().from(mediaItems).where(eq(mediaItems.id, row.id)).get()!.musicbrainzRecordingId).toBe(REC);
  db.update(mediaItems).set({ title: "Edited elsewhere" }).where(eq(mediaItems.id, row.id)).run();
  await scanRoot(sourceId, { prober: null, pruneGraceMs: 0, force: true });
  const after = db.select().from(mediaItems).where(eq(mediaItems.id, row.id)).get()!;
  expect(after.musicbrainzRecordingId).toBeNull();
  expect(after.musicbrainzCheckedKey).toBeNull();
});
