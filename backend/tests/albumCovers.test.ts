// MUSIC-DATA-01: the Cover Art Archive album cover pass, against an offline fixture (no real network).
import { afterEach, beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { rmSync } from "node:fs";
import { db } from "@/db";
import { mediaItems, musicAlbumCovers } from "@/db/schema";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { buildMediaTree } from "./support/mediaTree";
import { scanRoot } from "@/lib/media/scan";
import { setHouseholdSettingValue } from "@/lib/settings";
import { albumCoverFile, forgetAlbumCovers } from "@/lib/media/albumCoverStore";
import { coverArtArchiveFetch, runAlbumCoverPass, type FetchCover } from "@/lib/media/albumCovers";
import { itemFromRow } from "@/lib/media/model";

const RG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RG2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const JPG = new Uint8Array([255, 216, 255, 224, 1, 2, 3, 4]);
const realFetch = globalThis.fetch;

beforeEach(() => resetDb());
afterEach(() => { globalThis.fetch = realFetch; });

let owner: TestClient;
async function trackIds(): Promise<string[]> {
  setHouseholdSettingValue("music.musicbrainz_match", false);
  owner = new TestClient();
  await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const tree = buildMediaTree();
  const made = await owner.post("/api/media/sources", { label: "music", path: tree.music, kinds: ["track"] });
  const id = ((await made.json()) as { source: { id: string } }).source.id;
  await scanRoot(id, { prober: null, pruneGraceMs: 0 });
  return db.select().from(mediaItems).where(eq(mediaItems.kind, "track")).all().map((row) => row.id);
}
const give = (id: string, rg: string | null, artwork: string | null = null) =>
  db.update(mediaItems).set({ musicbrainzReleaseGroupId: rg, artwork }).where(eq(mediaItems.id, id)).run();
const fakeCovers = () => {
  const asked: string[] = [];
  const fetchCover: FetchCover = async (id) => { asked.push(id); return { bytes: JPG, mime: "image/jpeg" }; };
  return { asked, fetchCover };
};
const row = (id: string) => itemFromRow(db.select().from(mediaItems).where(eq(mediaItems.id, id)).get()!);

test("a fetched cover is kept, shows as the track's art, and is served to a signed-in reader", async () => {
  const [first] = await trackIds() as [string];
  give(first, RG);
  expect(row(first).artwork).toBeNull();
  const f = fakeCovers();
  expect(await runAlbumCoverPass({ ...f, gapMs: 0 })).toMatchObject({ considered: 1, found: 1, failed: 0 });
  expect(f.asked).toEqual([RG]);
  expect(row(first).artwork).toEqual({ path: `caa:${RG}` });
  // The track's stored art stays empty: the cover is read from the local table, never written to the record.
  expect(db.select().from(mediaItems).where(eq(mediaItems.id, first)).get()!.artwork).toBeNull();
  const served = await owner.get(`/api/media/items/${first}/artwork`);
  expect(served.status).toBe(200);
  expect(served.headers.get("content-type")).toBe("image/jpeg");
  expect(new Uint8Array(await served.arrayBuffer())).toEqual(JPG);
  expect((await new TestClient().get(`/api/media/items/${first}/artwork`)).status).toBe(401);
});

test("art in the file or folder, and art a person set, is never asked about or replaced", async () => {
  const [first, second] = await trackIds() as [string, string];
  give(first, RG, JSON.stringify({ path: "Album/folder.jpg" }));
  give(second, RG2, JSON.stringify({ file_id: "file-abcdef123" }));
  const f = fakeCovers();
  await runAlbumCoverPass({ ...f, gapMs: 0 });
  expect(f.asked).toEqual([]);
  expect(row(first).artwork).toEqual({ path: "Album/folder.jpg" });
  expect(row(second).artwork).toEqual({ file_id: "file-abcdef123" });
});

test("a person who removed a track's art keeps it removed", async () => {
  const [first] = await trackIds() as [string];
  give(first, RG);
  db.update(mediaItems).set({ lockedFields: JSON.stringify(["artwork"]) }).where(eq(mediaItems.id, first)).run();
  await runAlbumCoverPass({ ...fakeCovers(), gapMs: 0 });
  expect(row(first).artwork).toBeNull();
});

test("a second pass asks nothing; a cleared cache is fetched again", async () => {
  const [first] = await trackIds() as [string];
  give(first, RG);
  const f = fakeCovers();
  await runAlbumCoverPass({ ...f, gapMs: 0 });
  await runAlbumCoverPass({ ...f, gapMs: 0 });
  expect(f.asked).toHaveLength(1);
  rmSync(albumCoverFile(RG)!.path);
  forgetAlbumCovers();
  expect(row(first).artwork).toBeNull();
  expect((await owner.get(`/api/media/items/${first}/artwork`)).status).toBe(404);
  expect(await runAlbumCoverPass({ ...f, gapMs: 0 })).toMatchObject({ considered: 1, found: 1 });
  expect(f.asked).toHaveLength(2);
  expect(row(first).artwork).toEqual({ path: `caa:${RG}` });
  expect((await owner.get(`/api/media/items/${first}/artwork`)).status).toBe(200);
});

test("no cover is kept as none and asked again only after 90 days", async () => {
  const [first] = await trackIds() as [string];
  give(first, RG);
  let asked = 0;
  const fetchCover: FetchCover = async () => { asked++; return null; };
  expect(await runAlbumCoverPass({ fetchCover, gapMs: 0 })).toMatchObject({ found: 0, none: 1 });
  await runAlbumCoverPass({ fetchCover, gapMs: 0 });
  expect(asked).toBe(1);
  expect(row(first).artwork).toBeNull();
  await runAlbumCoverPass({ fetchCover, gapMs: 0, now: () => Date.now() + 91 * 24 * 60 * 60 * 1000 });
  expect(asked).toBe(2);
});

test("off sends nothing and keeps the local order", async () => {
  const [first] = await trackIds() as [string];
  give(first, RG);
  setHouseholdSettingValue("music.album_art_online", false);
  const f = fakeCovers();
  expect((await runAlbumCoverPass({ ...f, gapMs: 0 })).considered).toBe(0);
  expect(f.asked).toEqual([]);
  expect(row(first).artwork).toBeNull();
  expect((await owner.get(`/api/media/items/${first}/artwork`)).status).toBe(404);
});

test("offline: nothing is stored, nothing throws, and the album is tried again at the next pass", async () => {
  const [first, second] = await trackIds() as [string, string];
  give(first, RG);
  give(second, RG2);
  const fetchCover: FetchCover = async () => { throw new Error("offline"); };
  expect(await runAlbumCoverPass({ fetchCover, gapMs: 0 })).toMatchObject({ found: 0, failed: 2 });
  expect(db.select().from(musicAlbumCovers).all()).toHaveLength(0);
  expect(row(first).artwork).toBeNull();
  expect((await owner.get(`/api/media/items/${first}/artwork`)).status).toBe(404);
  expect(await runAlbumCoverPass({ ...fakeCovers(), gapMs: 0 })).toMatchObject({ found: 2, failed: 0 });
});

test("the request: the release group id only, over https, redirects checked hop by hop", async () => {
  const seen: Array<{ url: string; headers: Record<string, string> }> = [];
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    seen.push({ url, headers: { ...(init?.headers as Record<string, string>) } });
    if (url.startsWith("https://coverartarchive.org/")) return new Response(null, { status: 307, headers: { location: "https://ia800000.us.archive.org/1/items/mbid-x/front-500.jpg" } });
    return new Response(JPG, { status: 200, headers: { "content-type": "image/jpeg" } });
  }) as unknown as typeof fetch;
  const got = await coverArtArchiveFetch(RG);
  expect(got?.mime).toBe("image/jpeg");
  expect(seen.map((s) => s.url)).toEqual([`https://coverartarchive.org/release-group/${RG}/front-500`, "https://ia800000.us.archive.org/1/items/mbid-x/front-500.jpg"]);
  expect(seen.every((s) => !("Cookie" in s.headers) && !("Authorization" in s.headers))).toBe(true);

  globalThis.fetch = (async () => new Response(null, { status: 404 })) as unknown as typeof fetch;
  expect(await coverArtArchiveFetch(RG)).toBeNull();
  globalThis.fetch = (async () => new Response(null, { status: 503 })) as unknown as typeof fetch;
  await expect(coverArtArchiveFetch(RG)).rejects.toThrow();
  globalThis.fetch = (async () => new Response(null, { status: 302, headers: { location: "https://evil.example.com/x.jpg" } })) as unknown as typeof fetch;
  await expect(coverArtArchiveFetch(RG)).rejects.toThrow("host");
  globalThis.fetch = (async () => new Response("<html>", { status: 200, headers: { "content-type": "text/html" } })) as unknown as typeof fetch;
  await expect(coverArtArchiveFetch(RG)).rejects.toThrow("type");
  await expect(coverArtArchiveFetch("not an id")).rejects.toThrow("id");
});
