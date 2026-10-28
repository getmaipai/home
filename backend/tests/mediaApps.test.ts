// MEDIA-VIDEOS-01: the shared media-app host (lib/media/appHost.ts, routes/mediaApps.ts) over HTTP, through the Videos package's
// data ids and actions: rows per band, progress with string numbers, the lists, and the child's allowlist-only view.
import { beforeEach, describe, expect, test } from "bun:test";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { scanRoot } from "@/lib/media/scan";
import { __resetProgressForTests, flushProgress } from "@/lib/media/progress";
import { coerceNumber } from "@/lib/media/appHost";
import { buildMediaTree } from "./support/mediaTree";
import { db } from "@/db";
import { people, shares, videoJobs, musicJobs, mediaItems } from "@/db/schema";
import { eq } from "drizzle-orm";
import { storeFile } from "@/lib/attachments";
import { getHouseholdSettingValue, setHouseholdSettingValue } from "@/lib/settings";
import { getRegistryKey } from "@/lib/settingsRegistry";
import { rememberPreviewStations, __resetRadioDirectoryForTests } from "@/lib/media/radioDirectory";

beforeEach(() => {
  resetDb();
  __resetProgressForTests();
  __resetRadioDirectoryForTests();
});

type Row = { id: string; title: string; channel: string | null; progress?: number; completed?: boolean; copy_label: string; thumbnail: string | null };
const stringsOnly = (value: unknown): string[] => typeof value === "string" ? [value] : Array.isArray(value) ? value.flatMap(stringsOnly) : value && typeof value === "object" ? Object.values(value).flatMap(stringsOnly) : [];

async function setup() {
  const owner = new TestClient();
  await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const signIn = async (displayName: string, role: string) => {
    const made = await owner.post("/api/people", { displayName, role, secret: "0000", ...(role === "child" ? { birthdate: "2018-03-01" } : {}) });
    const created = (await made.json()) as { id: string };
    const client = new TestClient();
    await client.post("/api/auth/verify-secret", { personId: created.id, secret: "0000" });
    return { client, id: created.id };
  };
  const adult = await signIn("Marlow", "adult");
  const admin = await signIn("Robin", "admin");
  const child = await signIn("Sprout", "child");
  const tree = buildMediaTree();
  const added = await owner.post("/api/media/sources", { label: "videos", path: tree.videos, kinds: ["video"] });
  await scanRoot(((await added.json()) as { source: { id: string } }).source.id, { prober: null, pruneGraceMs: 0 });
  const musicSource = await owner.post("/api/media/sources", { label: "music", path: tree.music, kinds: ["track"] });
  await scanRoot(((await musicSource.json()) as { source: { id: string } }).source.id, { prober: null, pruneGraceMs: 0 });
  const data = async (client: TestClient, id: string, body: Record<string, unknown> = {}) => (await client.post(`/api/plugins/videos/data/${id}`, body)).json() as Promise<Row[]>;
  const rows = async (client: TestClient, id: string, body: Record<string, unknown> = {}) => data(client, id, body);
  const idOf = async (title: string) => (await rows(adult.client, "library")).find((row) => row.title === title)!.id;
  return { owner, adult, admin, child, data, rows, idOf };
}

const progress = (client: TestClient, body: Record<string, unknown>) => client.post("/api/plugins/videos/progress", body);

describe("the media-app host: data ids", () => {
  test("Music resolves a just-shown directory station as a preview item only for the eligible person", async () => {
    const { adult, child } = await setup();
    const person = db.select().from(people).where(eq(people.id, adult.id)).get()!;
    rememberPreviewStations("household", [{ id: "preview-1", name: "Cabin FM", url: "https://radio.example/live", favicon: null, tags: ["jazz"], country_code: "US", codec: "mp3", bitrate_kbps: 128, hls: false }]);
    const view = await (await adult.client.post("/api/plugins/music/data/item", { id: "preview-1" })).json() as Record<string, unknown>;
    expect(view).toMatchObject({ id: "preview-1", title: "Cabin FM", kind: "station", live: true, src: "/api/plugins/music/radio/preview/preview-1" });
    // An HLS station's preview item is marked so the shell attaches hls.js (a plain audio element cannot play a playlist).
    rememberPreviewStations("household", [{ id: "preview-hls", name: "Hill HLS", url: "https://radio.example/hill.m3u8", favicon: null, tags: [], country_code: "US", codec: "aac", bitrate_kbps: 64, hls: true }]);
    expect(await (await adult.client.post("/api/plugins/music/data/item", { id: "preview-hls" })).json()).toMatchObject({ src: "/api/plugins/music/radio/preview/preview-hls?hls=1" });
    expect(await (await adult.client.post("/api/plugins/music/data/item", { id: "stranger" })).json()).toEqual([]);
    expect(await (await child.client.post("/api/plugins/music/data/item", { id: "preview-1" })).json()).toEqual([]);
  });

  test("Music item views gate lyrics and expose lookup eligibility", async () => {
    const { adult, child } = await setup();
    expect(getRegistryKey("music.lyrics_online")).toMatchObject({ default: true, label: "Look up song lyrics online", lives_in: "household.pictures", honoured_by: ["home"] });
    expect(getHouseholdSettingValue("music.lyrics_online")).toBe(true);
    const row = db.select().from(mediaItems).all().find((item) => item.title === "Morning Light")!;
    db.update(mediaItems).set({ lyrics: JSON.stringify({ source: "file", text: "First line", timed: [{ t: 1, line: "First line", section: "Verse" }] }) }).where(eq(mediaItems.id, row.id)).run();
    const url = `/api/plugins/music/data/item`;
    const lyrics = await (await adult.client.post(url, { id: row.id })).json() as Record<string, unknown>;
    expect(lyrics).toMatchObject({ lyrics: "First line", timed_lyrics: [{ t: 1, line: "First line", section: "Verse" }], lyrics_lookup: "none" });
    expect(lyrics.facts).toBe("Tempo · 2023 · Indie");
    db.update(mediaItems).set({ bandOk: "adult" }).where(eq(mediaItems.id, row.id)).run();
    expect(await (await child.client.post(url, { id: row.id })).json()).toEqual([]);
    db.update(mediaItems).set({ lyrics: null }).where(eq(mediaItems.id, row.id)).run();
    db.update(mediaItems).set({ bandOk: "child" }).where(eq(mediaItems.id, row.id)).run();
    const eligible = await (await adult.client.post(url, { id: row.id })).json() as Record<string, unknown>;
    expect(eligible.lyrics_lookup).toBe("available");
    db.update(mediaItems).set({ artist: null }).where(eq(mediaItems.id, row.id)).run();
    expect(((await (await adult.client.post(url, { id: row.id })).json()) as Record<string, unknown>).lyrics_lookup).toBe("none");
    db.update(mediaItems).set({ artist: row.artist, provenance: "music:generated-library" }).where(eq(mediaItems.id, row.id)).run();
    expect(((await (await adult.client.post(url, { id: row.id })).json()) as Record<string, unknown>).lyrics_lookup).toBe("none");
    db.update(mediaItems).set({ provenance: row.provenance }).where(eq(mediaItems.id, row.id)).run();
    const noLookupForChild = await (await child.client.post(url, { id: row.id })).json() as Record<string, unknown>;
    expect(noLookupForChild.lyrics_lookup).toBe("none");
    setHouseholdSettingValue("music.lyrics_online", false);
    expect(((await (await adult.client.post(url, { id: row.id })).json()) as Record<string, unknown>).lyrics_lookup).toBe("none");
  });
  test("a made song copies its stored words onto the promoted media item", async () => {
    const { adult } = await setup();
    const person = db.select().from(people).where(eq(people.id, adult.id)).get()!;
    const made = storeFile(person, { conversationId: null, turnId: null, mediaType: "audio/mp4", bytes: new Uint8Array([2, 4, 6]), provenance: 'music-gen:{"job_id":"lyrics-made-test","title":"At Home"}', deduplicate: false });
    if (!made.ok) throw new Error(made.error);
    db.insert(musicJobs).values({ id: "lyrics-made-test", personId: adult.id, task: "text2music", state: "done", request: JSON.stringify({ title: "At Home", lyrics: "[Verse]\nWords from home" }), fileId: made.value.id, durationS: 40, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), hlc: "1:0:lyrics-made" }).run();
    await adult.client.post("/api/plugins/music/queue", { id: made.value.id });
    const item = db.select().from(mediaItems).where(eq(mediaItems.locFileId, made.value.id)).get()!;
    expect(JSON.parse(item.lyrics!)).toEqual({ source: "made", text: "[Verse]\nWords from home" });
    const view = await (await adult.client.post("/api/plugins/music/data/item", { id: item.id })).json() as Record<string, unknown>;
    expect(view.lyrics_lookup).toBe("none");
  });
  test("Videos lists made clips through Library visibility and plays them in the existing player", async () => {
    const { owner, adult, child } = await setup();
    const adultPerson = db.select().from(people).where(eq(people.id, adult.id)).get()!;
    const householdOwner = db.select().from(people).where(eq(people.role, "owner")).get()!;
    const made = storeFile(adultPerson, { conversationId: null, turnId: null, mediaType: "video/mp4", bytes: new Uint8Array([1, 2, 3]), provenance: 'video-gen:{"prompt":"A family kite","seconds":5,"audience":"all-ages"}', deduplicate: false });
    const adultsOnly = storeFile(adultPerson, { conversationId: null, turnId: null, mediaType: "video/mp4", bytes: new Uint8Array([4, 5, 6]), provenance: 'video-gen:{"prompt":"Adults only","audience":"adult-only"}', deduplicate: false });
    const privateFile = storeFile(householdOwner, { conversationId: null, turnId: null, mediaType: "video/mp4", bytes: new Uint8Array([7, 8, 9]), provenance: 'video-gen:{"prompt":"Private clip","audience":"all-ages"}', deduplicate: false });
    if (!made.ok) throw new Error(made.error);
    if (!adultsOnly.ok) throw new Error(adultsOnly.error);
    if (!privateFile.ok) throw new Error(privateFile.error);
    const shelf = await (await adult.client.post("/api/plugins/videos/data/made-at-home", {})).json() as Row[];
    expect(shelf.map((item) => item.id)).toContain(made.value.id);
    expect(shelf.map((item) => item.id)).not.toContain(privateFile.value.id);
    expect((await (await child.client.post("/api/plugins/videos/data/made-at-home", {})).json() as Row[]).map((item) => item.id)).not.toContain(adultsOnly.value.id);
    expect(await (await adult.client.post("/api/plugins/videos/data/item", { id: made.value.id })).json()).toMatchObject({ id: made.value.id, src: `/api/files/${made.value.id}/content`, kind: "video" });
    expect((await adult.client.get(`/api/media/items/${made.value.id}`)).status).toBe(200);
    expect((await child.client.get(`/api/media/items/${adultsOnly.value.id}`)).status).toBe(404);
  });

  test("creation header returns safe made and scanned details and uses Library sharing", async () => {
    const { owner, adult, admin, child, data } = await setup();
    const adultPerson = db.select().from(people).where(eq(people.id, adult.id)).get()!;
    const ownerPerson = db.select().from(people).where(eq(people.role, "owner")).get()!;
    const now = new Date().toISOString();
    const seedOf = (id: string) => db.select().from(people).where(eq(people.id, id)).get()!.avatarSeed;
    db.insert(videoJobs).values({ id: "clip-header",personId: adult.id, conversationId: null, turnId: null, kind: "generate", state: "done", stackJob: null, percent: 100, phase: null, position: null, prompt: "A tiny sailboat glides across a bright blue lake. Add soft morning light and gentle waves.", request: "{}", error: null, files: "[]", createdAt: now, updatedAt: now, hlc: "1:0:test" }).run();
    const made = storeFile(adultPerson, { conversationId: null, turnId: null, mediaType: "video/mp4", bytes: new Uint8Array([8, 8, 8]), provenance: 'video-gen:{"job":"clip-header","audience":"all-ages"}', deduplicate: false });
    const adultsOnly = storeFile(ownerPerson, { conversationId: null, turnId: null, mediaType: "video/mp4", bytes: new Uint8Array([8, 8, 7]), provenance: 'video-gen:{"prompt":"Adults only","audience":"adult-only"}', deduplicate: false });
    if (!made.ok) throw new Error(made.error);
    if (!adultsOnly.ok) throw new Error(adultsOnly.error);
    const view = await data(adult.client, "creation", { id: made.value.id }) as unknown as Array<Record<string, any>>;
    expect(view[0]?.id).toBe(made.value.id);
    expect(view[0]).toMatchObject({ title: "A tiny sailboat glides across a bright blue lake", description: "A tiny sailboat glides across a bright blue lake. Add soft morning light and gentle waves.", creator: { name: "Marlow", href: `/people/${adult.id}`, avatar_url: null }, made_at: expect.any(String), visibility: { mode: "private", can_manage: true } });
    expect(view[0]).not.toHaveProperty("candidates");
    expect(view[0]?.creator.avatar_seed).toBe(seedOf(adult.id));
    expect(stringsOnly(view).join(" ")).not.toMatch(/[{}]/);
    const adultOnlyCandidates = await data(owner, "creation", { id: adultsOnly.value.id, scope: "people" }) as unknown as Array<Record<string, any>>;
    expect(adultOnlyCandidates.map((candidate) => candidate.id).sort()).toEqual([adult.id, admin.id].sort());
    const owned = storeFile(ownerPerson, { conversationId: null, turnId: null, mediaType: "video/mp4", bytes: new Uint8Array([9, 9, 9]), provenance: 'video-gen:{"prompt":"A short family clip","audience":"all-ages"}', deduplicate: false });
    if (!owned.ok) throw new Error(owned.error);
    const allAgeCandidates = await data(owner, "creation", { id: owned.value.id, scope: "people" }) as unknown as Array<Record<string, any>>;
    expect(allAgeCandidates.map((candidate) => candidate.id).sort()).toEqual(["household", adult.id, admin.id, child.id].sort());
    expect(allAgeCandidates.find((candidate) => candidate.id === adult.id)?.avatar_seed).toBe(seedOf(adult.id));
    expect(allAgeCandidates.find((candidate) => candidate.id === "household")).not.toHaveProperty("avatar_seed");
    expect((await data(owner, "creation", { id: owned.value.id }) as any[])[0].creator.avatar_seed).toBe(seedOf(ownerPerson.id));
    expect(await data(adult.client, "creation", { id: owned.value.id, scope: "people" })).toEqual([]);
    expect((await owner.post("/api/plugins/videos/actions/share-add", { id: owned.value.id, person_id: adult.id })).status).toBe(200);
    expect((await data(owner, "creation", { id: owned.value.id }) as any[])[0].visibility.mode).toBe("shared");
    expect((await owner.post("/api/plugins/videos/actions/share-remove", { id: owned.value.id, person_id: adult.id })).status).toBe(200);
    expect((await owner.post("/api/plugins/videos/actions/share-add", { id: owned.value.id, person_id: adult.id })).status).toBe(200);
    expect((await owner.post("/api/plugins/videos/actions/share-add", { id: owned.value.id, person_id: child.id })).status).toBe(200);
    const adultView = await data(adult.client, "creation", { id: owned.value.id }) as unknown as Array<Record<string, any>>;
    expect(adultView[0]?.visibility).toMatchObject({ mode: "shared", can_manage: false });
    expect(adultView[0]?.visibility.people.map((p: any) => p.id)).toEqual([adult.id]);
    expect(adultView[0]?.visibility.people[0].avatar_seed).toBe(seedOf(adult.id));
    expect((await adult.client.post("/api/plugins/videos/actions/share-add", { id: owned.value.id, person_id: child.id })).status).toBe(403);
    const childRow = await data(child.client, "creation", { id: owned.value.id }) as unknown as Array<Record<string, any>>;
    expect(childRow[0]?.visibility).toMatchObject({ mode: "shared", can_manage: false });
    expect(childRow[0]?.visibility.people.map((p: any) => p.id)).toEqual([child.id]);
    expect((await child.client.post("/api/plugins/videos/actions/share-add", { id: owned.value.id, person_id: adult.id })).status).toBe(403);
    expect((await owner.post("/api/plugins/videos/actions/share-private", { id: owned.value.id })).status).toBe(200);
    expect((await data(owner, "creation", { id: owned.value.id }) as any[])[0].visibility.mode).toBe("private");
    expect((await data(owner, "creation", { id: made.value.id })).length).toBe(0);

    const childPerson = db.select().from(people).where(eq(people.id, child.id)).get()!;
    const childMade = storeFile(childPerson, { conversationId: null, turnId: null, mediaType: "video/mp4", bytes: new Uint8Array([6, 6, 6]), provenance: 'video-gen:{"prompt":"A child-safe kite","audience":"all-ages"}', deduplicate: false });
    if (!childMade.ok) throw new Error(childMade.error);
    db.insert(shares).values({ id: "share-childadmin", fileId: childMade.value.id, fromPersonId: child.id, to: admin.id, provenance: "test", createdAt: now, hlc: "1:0:testtest" }).run();
    const adminRow = await data(admin.client, "creation", { id: childMade.value.id }) as unknown as Array<Record<string, any>>;
    expect(adminRow[0]?.visibility).toMatchObject({ mode: "shared", can_manage: true });
    expect((await admin.client.post("/api/plugins/videos/actions/share-remove", { id: childMade.value.id, person_id: admin.id })).status).toBe(200);

    const scanItem = (await data(adult.client, "library") as unknown as Array<Record<string, any>>).find((row) => row.title === "Building a birdhouse")!;
    const scanned = await data(adult.client, "creation", { id: scanItem.id }) as unknown as Array<Record<string, any>>;
    expect(scanned[0]?.id).toBe(scanItem.id);
    expect(scanned[0]).toMatchObject({ title: "Building a birdhouse", creator: { name: "Bramble Workshop" }, visibility: { mode: "shared", can_manage: false } });
    expect(stringsOnly(scanned).join(" ")).not.toMatch(/[{}]/);
  });

  test("creation row id can be used directly by share-add", async () => {
    const { owner, adult, data } = await setup();
    const ownerPerson = db.select().from(people).where(eq(people.role, "owner")).get()!;
    const made = storeFile(ownerPerson, { conversationId: null, turnId: null, mediaType: "video/mp4", bytes: new Uint8Array([3, 2, 1]), provenance: 'video-gen:{"prompt":"A family clip","audience":"all-ages"}', deduplicate: false });
    if (!made.ok) throw new Error(made.error);

    const creation = await data(owner, "creation", { id: made.value.id }) as unknown as Array<Record<string, any>>;
    expect(creation[0]?.id).toBe(made.value.id);
    const response = await owner.post("/api/plugins/videos/actions/share-add", { id: creation[0]?.id, person_id: adult.id });
    expect(response.status).toBe(200);
    expect((await data(owner, "creation", { id: made.value.id }) as unknown as Array<Record<string, any>>)[0]?.visibility.mode).toBe("shared");
  });

  test("Music creation header shares only home-made songs and uses the Library file id", async () => {
    const { owner, adult, admin, child } = await setup();
    const ownerPerson = db.select().from(people).where(eq(people.role, "owner")).get()!;
    const now = new Date().toISOString();
    const song = storeFile(ownerPerson, { conversationId: null, turnId: null, mediaType: "audio/mp4", bytes: new Uint8Array([4, 5, 6]), provenance: 'music-gen:{"job_id":"music-header","audience":"all-ages"}', deduplicate: false });
    if (!song.ok) throw new Error(song.error);
    db.insert(musicJobs).values({ id: "music-header", personId: ownerPerson.id, task: "text2music", state: "done", request: JSON.stringify({ title: "River song", lyrics: "[Verse] Morning light\nA river runs." }), fileId: song.value.id, createdAt: now, updatedAt: now, hlc: "1:0:music" }).run();
    const data = async (client: TestClient, scope = "creation") => (await client.post("/api/plugins/music/data/header", { id: song.value.id, scope })).json() as Promise<any[]>;
    const creation = await data(owner);
    expect(creation[0]).toMatchObject({ id: song.value.id, title: "River song", description: "[Verse] Morning light\nA river runs.", creator: { name: "Sage", href: `/people/${ownerPerson.id}`, avatar_url: null }, made_at: expect.any(String), visibility: { mode: "private", can_manage: true } });
    expect((await data(owner, "creation-people")).map((candidate) => candidate.id).sort()).toEqual(["household", adult.id, admin.id, child.id].sort());
    expect(await data(adult.client, "creation-people")).toEqual([]);
    expect((await adult.client.post("/api/plugins/music/actions/share-add", { id: song.value.id, person_id: child.id })).status).toBe(403);
    const childPerson = db.select().from(people).where(eq(people.id, child.id)).get()!;
    const childSong = storeFile(childPerson, { conversationId: null, turnId: null, mediaType: "audio/mp4", bytes: new Uint8Array([7, 8, 9]), provenance: 'music-gen:{"audience":"all-ages"}', deduplicate: false });
    if (!childSong.ok) throw new Error(childSong.error);
    expect((await child.client.post("/api/plugins/music/actions/share-add", { id: childSong.value.id, person_id: adult.id })).status).toBe(403);
    const share = await owner.post("/api/plugins/music/actions/share-add", { id: creation[0].id, person_id: adult.id });
    expect(share.status).toBe(200);
    expect((await data(owner))[0].visibility.mode).toBe("shared");

    const scanned = (await (await adult.client.post("/api/plugins/music/data/songs", {})).json() as any[]).find((row) => row.title === "Morning Light");
    expect(scanned).toBeTruthy();
    const scannedHeader = await (await adult.client.post("/api/plugins/music/data/header", { id: scanned.id, scope: "creation" })).json() as any[];
    expect(scannedHeader[0]).toMatchObject({ id: scanned.id, creator: { name: "The Marlows" }, visibility: { can_manage: false } });
    expect(await adult.client.post("/api/plugins/music/data/header", { id: scanned.id, scope: "creation-people" }).then((response) => response.json())).toEqual([]);
  });

  test("Music collection headers include safe Apple Music metadata and readable child details", async () => {
    const { owner, adult, child } = await setup();
    const songs = await (await adult.client.post("/api/plugins/music/data/songs", {})).json() as any[];
    const morning = songs.find((row) => row.title === "Morning Light")!;
    const albumId = JSON.stringify(["The Marlows", "Tempo"]);
    const getHeader = async (client: TestClient, id: string, scope: string) => (await client.post("/api/plugins/music/data/header", { id, scope })).json() as Promise<any[]>;
    const album = (await getHeader(adult.client, albumId, "album"))[0];
    expect(album).toMatchObject({
      title: "Tempo", creator: { name: "The Marlows", href: "/apps/music/artist?id=The%20Marlows" },
      art: expect.stringContaining(morning.id), meta: expect.stringContaining("Album"),
      footer_lines: expect.arrayContaining([expect.stringMatching(/\d+ songs?, \d+ minutes?/)]),
      visibility: { mode: "shared" }, made_at: expect.any(String),
    });
    const explicit = songs.find((row) => row.title === "Loud Song")!;
    const childSongs = await (await child.client.post("/api/plugins/music/data/songs", {})).json() as any[];
    const childAlbumId = JSON.stringify(["The Marlows", "Tempo"]);
    const childAlbum = await getHeader(child.client, childAlbumId, "album");
    expect(childAlbum[0]?.title).toBe("Tempo");
    expect(JSON.stringify(childAlbum)).not.toContain(explicit.title);
    const madePlaylist = await adult.client.post("/api/plugins/music/playlist", { op: "new" });
    const playlistId = ((await madePlaylist.json()) as { id: string }).id;
    const playlist = (await getHeader(adult.client, playlistId, "playlist"))[0];
    expect(playlist).toMatchObject({ creator: { name: "Marlow" }, meta: expect.stringContaining("Playlist"), footer_lines: expect.arrayContaining([expect.stringMatching(/\d+ songs?, \d+ minutes?/)]) });
    const artist = (await getHeader(adult.client, "The Marlows", "artist"))[0];
    expect(artist).toMatchObject({ title: "The Marlows", meta: "Artist", radio_id: expect.stringContaining("radio:artist") });
    expect(artist).not.toHaveProperty("creator");
    expect(childSongs.map((row) => row.title)).not.toContain(explicit.title);
    expect(JSON.stringify(await getHeader(child.client, "Clover", "artist"))).not.toContain(explicit.title);
    expect(JSON.stringify(await (await child.client.post("/api/plugins/music/data/album-more", { id: albumId })).json())).not.toContain(explicit.title);
    const ownerAlbum = await (await owner.post("/api/plugins/music/data/header", { id: albumId, scope: "album" })).json() as any[];
    expect(ownerAlbum[0]?.title).toBe("Tempo");
  });

  test("an adult's rows carry title, channel, copy label and no progress before anything is watched", async () => {
    const { adult, rows } = await setup();
    const recent = await rows(adult.client, "recent");
    expect(recent.map((row) => row.title).sort()).toEqual(["Building a birdhouse", "Fixing a squeaky door", "Sprout at the beach"]);
    expect(recent[0]).toMatchObject({ copy_label: "Saved", thumbnail: null });
    expect(recent.find((row) => row.title === "Building a birdhouse")!.channel).toBe("Bramble Workshop");
    expect(recent.every((row) => row.progress === undefined)).toBe(true);
    expect((await rows(adult.client, "featured")).length).toBeGreaterThan(0);
    expect(await rows(adult.client, "continue")).toEqual([]);
  });

  test("progress arrives as strings from call.args placeholders, is coerced, and shows in continue, history and the item", async () => {
    const { adult, rows, data, idOf } = await setup();
    const id = await idOf("Building a birdhouse");
    const saved = await progress(adult.client, { media_id: id, position_s: "12.5", duration_s: "50", reason: "pause" });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ ok: true, applied: true, completed: false });
    flushProgress();
    const cont = await rows(adult.client, "continue");
    expect(cont).toHaveLength(1);
    expect(cont[0]).toMatchObject({ id, progress: 0.25 });
    const item = (await data(adult.client, "item", { id })) as unknown as { src: string; position_s: number; chapters: unknown[]; up_next?: { id: string } };
    expect(item.src).toBe(`/api/media/items/${id}/content`);
    expect(item.position_s).toBe(12.5);
    expect(item.up_next?.id).toBeTruthy();
    expect((await rows(adult.client, "history")).map((row) => row.id)).toEqual([id]);
    expect((await rows(adult.client, "more-from")).map((row) => row.channel)).toEqual(["Bramble Workshop", "Bramble Workshop"]);
  });

  test("finishing a video moves it from continue to watch again and latches", async () => {
    const { adult, rows, idOf } = await setup();
    const id = await idOf("Fixing a squeaky door");
    await progress(adult.client, { media_id: id, position_s: "10", duration_s: "10", reason: "ended" });
    flushProgress();
    expect(await rows(adult.client, "continue")).toEqual([]);
    expect((await rows(adult.client, "again")).map((row) => row.id)).toEqual([id]);
    // A finished video leaves watch later.
    await adult.client.post("/api/plugins/videos/watch-later", { media_id: id, on: true });
    await progress(adult.client, { media_id: id, position_s: "10", duration_s: "10", reason: "ended" });
    expect(await rows(adult.client, "watch-later")).toEqual([]);
    const item = (await adult.client.post("/api/plugins/videos/data/item", { id })).json() as Promise<{ position_s?: number }>;
    expect((await item).position_s).toBeUndefined();
  });

  test("watch later and like add, remove and toggle by `on`; the lists keep their order", async () => {
    const { adult, rows, idOf } = await setup();
    const a = await idOf("Building a birdhouse");
    const b = await idOf("Sprout at the beach");
    expect((await adult.client.post("/api/plugins/videos/watch-later", { media_id: a })).status).toBe(200);
    await adult.client.post("/api/plugins/videos/watch-later", { media_id: b, on: "true" });
    expect((await rows(adult.client, "watch-later")).map((row) => row.id)).toEqual([a, b]);
    const removed = await adult.client.post("/api/plugins/videos/watch-later", { media_id: a, on: false });
    expect(await removed.json()).toMatchObject({ on: false, label: "Not saved" });
    expect((await rows(adult.client, "watch-later")).map((row) => row.id)).toEqual([b]);
    // With `on` absent a press toggles (the Home billboard's button carries only the id).
    expect(await (await adult.client.post("/api/plugins/videos/watch-later", { media_id: b })).json()).toMatchObject({ on: false });
    expect(await (await adult.client.post("/api/plugins/videos/watch-later", { media_id: b })).json()).toMatchObject({ on: true });
    await adult.client.post("/api/plugins/videos/like", { media_id: a });
    expect((await rows(adult.client, "liked")).map((row) => row.id)).toEqual([a]);
    expect((await adult.client.post("/api/plugins/videos/like", { media_id: "media-nothing0001" })).status).toBe(404);
  });

  test("library filters by channel and channels lists them for the picker", async () => {
    const { adult, rows } = await setup();
    const library = await rows(adult.client, "library", { channel: "Bramble Workshop" });
    expect(library.map((row) => row.title)).toEqual(["Building a birdhouse", "Fixing a squeaky door"]);
    const channels = (await adult.client.post("/api/plugins/videos/data/channels", {}).then((res) => res.json())) as { rows: Array<{ id: string }> };
    expect(channels.rows.map((row) => row.id)).toEqual(["Bramble Workshop", "Home videos"]);
  });

  test("up_next lists the rest of the channel first, never the video itself", async () => {
    const { adult, rows, idOf } = await setup();
    const id = await idOf("Building a birdhouse");
    const next = await rows(adult.client, "up-next", { id });
    expect(next[0]!.title).toBe("Fixing a squeaky door");
    expect(next.map((row) => row.id)).not.toContain(id);
  });
});

describe("the media-app host: a child", () => {
  test("a child gets no discovery rows, only band_ok child items, and cannot read or save an adult item", async () => {
    const { owner, adult, child, rows, idOf } = await setup();
    const adultOnly = await idOf("Sprout at the beach");
    expect((await owner.request(`/api/media/items/${adultOnly}`, { method: "PATCH", body: { band_ok: "adult" } })).status).toBe(200);
    for (const id of ["featured", "new", "recent", "more-from"]) expect(await rows(child.client, id)).toEqual([]);
    const library = await rows(child.client, "library");
    expect(library.map((row) => row.title)).toEqual(["Building a birdhouse", "Fixing a squeaky door"]);
    expect((await rows(adult.client, "library")).map((row) => row.title)).toContain("Sprout at the beach");
    expect(await rows(child.client, "item", { id: adultOnly })).toEqual([]);
    expect((await progress(child.client, { media_id: adultOnly, position_s: "3", duration_s: "9", reason: "pause" })).status).toBe(404);
    expect((await child.client.post("/api/plugins/videos/watch-later", { media_id: adultOnly })).status).toBe(404);
  });

  test("a child's own watching shows in continue and a child's item has no autoplay up_next", async () => {
    const { child, rows, idOf } = await setup();
    const id = await idOf("Building a birdhouse");
    expect((await progress(child.client, { media_id: id, position_s: "5", duration_s: "50", reason: "pause" })).status).toBe(200);
    flushProgress();
    expect((await rows(child.client, "continue")).map((row) => row.id)).toEqual([id]);
    const item = (await rows(child.client, "item", { id })) as unknown as { up_next?: unknown };
    expect(item.up_next).toBeUndefined();
  });
});

describe("the media-app host: gates", () => {
  test("a person who is not signed in is refused; an app that is not installed and an unknown id fall through to the generic route", async () => {
    const { adult } = await setup();
    expect((await new TestClient().post("/api/plugins/videos/data/recent", {})).status).toBe(401);
    expect((await adult.client.post("/api/plugins/photos/data/recent", {})).status).toBe(404);
    expect((await adult.client.post("/api/plugins/videos/data/not_an_id", {})).status).toBe(404);
    expect((await adult.client.post("/api/plugins/weather/data/places", {})).status).toBe(200);
  });

  test("coerceNumber takes numbers and numeric strings only", () => {
    expect(coerceNumber("12.5")).toBe(12.5);
    expect(coerceNumber(3)).toBe(3);
    expect(coerceNumber("")).toBeUndefined();
    expect(coerceNumber("abc")).toBeUndefined();
    expect(coerceNumber(null)).toBeUndefined();
    expect(coerceNumber(Number.NaN)).toBeUndefined();
  });

  test("the Videos package declares the Made at home shelf on Home and Library", async () => {
    const { appPackageProblems } = await import("@/lib/apps");
    const { loadManifestOnly } = await import("@/lib/plugins");
    const loaded = loadManifestOnly("videos");
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(appPackageProblems(loaded.value, new URL("../packages/videos", import.meta.url).pathname)).toEqual([]);
    expect(loaded.value.contributes?.data?.map((entry) => entry.id)).toContain("made-at-home");
    const index = await Bun.file(new URL("../packages/videos/pages/index.json", import.meta.url)).json() as { body: Array<{ heading?: string; bind?: { path?: string } }> };
    const library = await Bun.file(new URL("../packages/videos/pages/library.json", import.meta.url)).json() as { body: Array<{ heading?: string; bind?: { path?: string } }> };
    expect(index.body.some((node) => node.heading === "Made at home" && node.bind?.path === "made-at-home")).toBe(true);
    expect(library.body.some((node) => node.heading === "Made at home" && node.bind?.path === "made-at-home")).toBe(true);
  });
});
