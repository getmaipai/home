// MEDIA-PARITY-02 (Videos): playlists, the channel strip, search suggestions, Remove from history and the saved Library sort. Everything reads the
// household's own library; a child or teen never reads or receives an adult-only video through a playlist.
import { beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { mediaItems, mediaProgress } from "@/db/schema";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { scanRoot } from "@/lib/media/scan";
import { __resetProgressForTests, flushProgress } from "@/lib/media/progress";
import { buildMediaTree } from "./support/mediaTree";
import { getSettingValueForPerson } from "@/lib/settings";

const pkg = join(import.meta.dir, "..", "packages", "videos");
const pageOf = (id: string) => JSON.parse(readFileSync(join(pkg, "pages", `${id}.json`), "utf8"));
const manifest = JSON.parse(readFileSync(join(pkg, "manifest.json"), "utf8"));

beforeEach(() => { resetDb(); __resetProgressForTests(); });

type Row = Record<string, any>;

async function house() {
  const owner = new TestClient();
  await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const make = async (displayName: string, role: string, birthdate?: string) => {
    const made = await owner.post("/api/people", { displayName, role, secret: "0000", ...(birthdate ? { birthdate } : {}) });
    const created = (await made.json()) as { id: string };
    const client = new TestClient();
    await client.post("/api/auth/verify-secret", { personId: created.id, secret: "0000" });
    return { client, id: created.id };
  };
  const adult = await make("Marlow", "adult");
  const teen = await make("Nova", "teen", "2011-03-01");
  const child = await make("Sprout", "child", "2018-03-01");
  const added = await owner.post("/api/media/sources", { label: "videos", path: buildMediaTree().videos, kinds: ["video"] });
  await scanRoot(((await added.json()) as { source: { id: string } }).source.id, { prober: null, pruneGraceMs: 0 });
  const ask = async (client: TestClient, id: string, body: Record<string, unknown> = {}) => (await (await client.post(`/api/plugins/videos/data/${id}`, body)).json()) as Row[];
  const library = await ask(owner, "library");
  const me = ((await (await owner.get("/api/auth/me")).json()) as { id?: string; person?: { id: string } });
  return { owner, adult, teen, child, ask, library, ownerId: me.person?.id ?? me.id! };
}

describe("video playlists", () => {
  test("make one, save videos to it, reorder, remove and delete; Music never sees it", async () => {
    const { owner, ask, library } = await house();
    expect(library.length).toBeGreaterThanOrEqual(3);
    const made = await (await owner.post("/api/plugins/videos/playlists/new", { title: "Rainy day" })).json() as Row;
    expect(made.title).toBe("Rainy day");
    for (const row of library.slice(0, 3)) expect((await owner.post("/api/plugins/videos/playlists/save", { media_id: row.id, playlist_id: made.id })).status).toBe(200);
    const tiles = await ask(owner, "library", { scope: "playlists" });
    expect(tiles.map((t) => t.title)).toEqual(["Rainy day"]);
    expect(tiles[0]!.channel).toBe("3 videos");
    const wanted = library.slice(0, 3).map((row) => row.id as string).reverse();
    expect((await owner.post("/api/plugins/videos/playlists/reorder", { ids: wanted })).status).toBe(200);
    expect((await ask(owner, "library", { scope: "playlist", id: made.id })).map((row) => row.id)).toEqual(wanted);
    const header = (await ask(owner, "library", { scope: "playlist-header", id: made.id }))[0]!;
    expect(header).toMatchObject({ title: "Rainy day", play_id: wanted[0] });
    expect((await owner.post("/api/plugins/videos/playlists/remove", { playlist_id: made.id, media_id: wanted[0] })).status).toBe(200);
    expect((await ask(owner, "library", { scope: "playlist", id: made.id })).length).toBe(2);
    // The Music playlists page and the generic list keep the two kinds apart.
    expect(await ask(owner, "library", { scope: "playlists" })).toHaveLength(1);
    const musicPlaylists = (await (await owner.post("/api/plugins/music/data/playlists", {})).json()) as Row[];
    expect(musicPlaylists.map((t) => t.title)).not.toContain("Rainy day");
    const stored = (await (await owner.get("/api/media/collections?kind=playlist")).json()) as Row[];
    expect(stored.find((c) => c.id === made.id)?.media_kind).toBe("video");
    expect((await owner.post("/api/plugins/videos/playlists/delete", { playlist_id: made.id })).status).toBe(200);
    expect(await ask(owner, "library", { scope: "playlists" })).toEqual([]);
  });

  test("Save to playlist with no playlist named uses the newest one, and makes one if there is none", async () => {
    const { owner, ask, library } = await house();
    expect((await owner.post("/api/plugins/videos/playlists/save", { media_id: library[0]!.id })).status).toBe(200);
    expect((await ask(owner, "library", { scope: "playlists" })).map((t) => t.title)).toEqual(["My playlist"]);
    expect((await owner.post("/api/plugins/videos/playlists/save", { media_id: "nope" })).status).toBe(404);
    expect((await owner.post("/api/plugins/videos/playlists/save", { media_id: library[1]!.id, playlist_id: "mcol-missing" })).status).toBe(404);
  });

  test("a reorder without a playlist id finds the one that holds those videos", async () => {
    const { owner, ask, library } = await house();
    const a = await (await owner.post("/api/plugins/videos/playlists/new", { title: "A" })).json() as Row;
    const b = await (await owner.post("/api/plugins/videos/playlists/new", { title: "B" })).json() as Row;
    await owner.post("/api/plugins/videos/playlists/save", { media_id: library[0]!.id, playlist_id: a.id });
    for (const row of library.slice(1, 3)) await owner.post("/api/plugins/videos/playlists/save", { media_id: row.id, playlist_id: b.id });
    const flipped = [library[2]!.id, library[1]!.id];
    expect((await owner.post("/api/plugins/videos/playlists/reorder", { ids: flipped })).status).toBe(200);
    expect((await ask(owner, "library", { scope: "playlist", id: b.id })).map((r) => r.id)).toEqual(flipped);
    expect((await owner.post("/api/plugins/videos/playlists/reorder", { ids: [] })).status).toBe(400);
  });

  test("members see the playlist and may add videos; only the owner reorders, removes or deletes", async () => {
    const { owner, adult, ask, library } = await house();
    const made = await (await owner.post("/api/plugins/videos/playlists/new", { title: "Family picks" })).json() as Row;
    await owner.post("/api/plugins/videos/playlists/save", { media_id: library[0]!.id, playlist_id: made.id });
    expect(await ask(adult.client, "library", { scope: "shared-playlists" })).toEqual([]);
    expect(await ask(adult.client, "library", { scope: "playlist", id: made.id })).toEqual([]);
    expect((await owner.post("/api/plugins/videos/actions/share-add", { id: made.id, person_id: adult.id })).status).toBe(200);
    const shared = await ask(adult.client, "library", { scope: "shared-playlists" });
    expect(shared.map((t) => t.title)).toEqual(["Family picks"]);
    expect(shared[0]!.channel).toContain("by Sage");
    expect((await adult.client.post("/api/plugins/videos/playlists/save", { media_id: library[1]!.id, playlist_id: made.id })).status).toBe(200);
    expect((await ask(owner, "library", { scope: "playlist", id: made.id })).length).toBe(2);
    expect((await adult.client.post("/api/plugins/videos/playlists/reorder", { playlist_id: made.id, ids: [library[1]!.id, library[0]!.id] })).status).toBe(403);
    expect((await adult.client.post("/api/plugins/videos/playlists/remove", { playlist_id: made.id, media_id: library[0]!.id })).status).toBe(403);
    expect((await adult.client.post("/api/plugins/videos/playlists/delete", { playlist_id: made.id })).status).toBe(403);
    expect((await owner.post("/api/plugins/videos/actions/share-private", { id: made.id })).status).toBe(200);
    expect(await ask(adult.client, "library", { scope: "shared-playlists" })).toEqual([]);
    expect((await adult.client.post("/api/plugins/videos/playlists/save", { media_id: library[2]!.id, playlist_id: made.id })).status).toBe(404);
  });

  test("an adult-only video never enters a playlist a child or teen can read, and never reaches their eyes", async () => {
    const { owner, teen, child, ask, library } = await house();
    const adultOnly = library[0]!.id as string;
    const plain = library[1]!.id as string;
    db.update(mediaItems).set({ bandOk: "adult" }).where(eq(mediaItems.id, adultOnly)).run();
    const made = await (await owner.post("/api/plugins/videos/playlists/new", { title: "Mixed" })).json() as Row;
    await owner.post("/api/plugins/videos/playlists/save", { media_id: adultOnly, playlist_id: made.id });
    await owner.post("/api/plugins/videos/playlists/save", { media_id: plain, playlist_id: made.id });
    // The teen cannot be added while the playlist holds an adult-only video.
    const refused = await owner.post("/api/plugins/videos/actions/share-add", { id: made.id, person_id: teen.id });
    expect(refused.status).toBe(422);
    await owner.post("/api/plugins/videos/playlists/remove", { playlist_id: made.id, media_id: adultOnly });
    expect((await owner.post("/api/plugins/videos/actions/share-add", { id: made.id, person_id: teen.id })).status).toBe(200);
    // Now that a teen reads it, the adult-only video is refused.
    const again = await owner.post("/api/plugins/videos/playlists/save", { media_id: adultOnly, playlist_id: made.id });
    expect(again.status).toBe(422);
    expect(((await again.json()) as { error: string }).error).toContain("adult-only");
    // A forced row (the band changed later) is still hidden from the teen.
    db.update(mediaItems).set({ bandOk: "adult" }).where(eq(mediaItems.id, plain)).run();
    expect(await ask(teen.client, "library", { scope: "playlist", id: made.id })).toEqual([]);
    // The child, who was never added, sees nothing at all.
    expect(await ask(child.client, "library", { scope: "shared-playlists" })).toEqual([]);
    expect(await ask(child.client, "library", { scope: "playlist", id: made.id })).toEqual([]);
  });

  test("a child cannot share a playlist, and a minor cannot give one a name that trips the floor", async () => {
    const { child, owner } = await house();
    const made = await (await child.client.post("/api/plugins/videos/playlists/new", { title: "Cartoons" })).json() as Row;
    expect(made.title).toBe("Cartoons");
    expect((await child.client.post("/api/plugins/videos/actions/share-add", { id: made.id, person_id: "person-abcdef" })).status).toBe(403);
    expect((await child.client.post("/api/plugins/videos/playlists/new", { title: "porn" })).status).toBe(422);
    expect((await owner.post("/api/plugins/videos/playlists/new", { title: "porn" })).status).toBe(200);
  });

  test("another person's playlist is never read, changed or deleted by guessing its id", async () => {
    const { owner, adult, ask, library } = await house();
    const made = await (await owner.post("/api/plugins/videos/playlists/new", { title: "Mine" })).json() as Row;
    await owner.post("/api/plugins/videos/playlists/save", { media_id: library[0]!.id, playlist_id: made.id });
    expect(await ask(adult.client, "library", { scope: "playlist", id: made.id })).toEqual([]);
    expect(await ask(adult.client, "library", { scope: "playlist-header", id: made.id })).toEqual([]);
    expect((await adult.client.post("/api/plugins/videos/playlists/rename", { playlist_id: made.id, title: "Taken" })).status).toBe(404);
    expect((await adult.client.post("/api/plugins/videos/playlists/delete", { playlist_id: made.id })).status).toBe(404);
    expect((await owner.post("/api/plugins/videos/playlists/rename", { playlist_id: made.id, title: "Renamed" })).status).toBe(200);
  });
});

describe("channels, suggestions, history and the saved sort", () => {
  test("the channel strip lists each channel once with its count, and cards carry the channel's picture when it has one", async () => {
    const { owner, ask, library } = await house();
    const strip = await ask(owner, "channels", { scope: "strip" });
    const names = [...new Set(library.map((row) => row.channel as string))].sort((a, b) => a.localeCompare(b));
    expect(strip.map((row) => row.title)).toEqual(names);
    expect(strip.reduce((sum, row) => sum + Number(String(row.channel).split(" ")[0]), 0)).toBe(library.length);
    // The picker still gets its own rows.
    const picker = (await ask(owner, "channels")) as unknown as { rows: Row[] };
    expect(picker.rows.map((row) => row.label)).toEqual(names);
    expect(await ask(owner, "library", { channel: names[0]! })).toSatisfy((rows: Row[]) => rows.every((row) => row.channel === names[0]));
  });

  test("suggestions: nothing under two letters, at most eight, matching titles and channels, in order of how well they match", async () => {
    const { owner, ask, library } = await house();
    expect(await ask(owner, "library", { scope: "suggest", q: "a" })).toEqual([]);
    const title = String(library[0]!.title);
    const word = title.slice(0, 3).toLocaleLowerCase();
    const found = await ask(owner, "library", { scope: "suggest", q: word });
    expect(found.length).toBeGreaterThan(0);
    expect(found.length).toBeLessThanOrEqual(8);
    expect(found.every((row) => String(row.label).toLocaleLowerCase().includes(word))).toBe(true);
    expect(found.map((row) => row.label)).toContain(title);
    expect(new Set(found.map((row) => row.key)).size).toBe(found.length);
    expect(await ask(owner, "library", { scope: "suggest", q: "zzzzqq" })).toEqual([]);
  });

  test("suggestions never name a video the person cannot read", async () => {
    const { owner, teen, ask, library } = await house();
    const title = String(library[0]!.title);
    db.update(mediaItems).set({ bandOk: "adult" }).where(eq(mediaItems.id, library[0]!.id as string)).run();
    const q = title.slice(0, 4).toLocaleLowerCase();
    expect((await ask(owner, "library", { scope: "suggest", q })).map((row) => row.label)).toContain(title);
    expect((await ask(teen.client, "library", { scope: "suggest", q })).map((row) => row.label)).not.toContain(title);
  });

  test("Remove from history deletes only this person's own progress row for that video", async () => {
    const { owner, adult, ask, library, ownerId } = await house();
    const id = library[0]!.id as string;
    await owner.post("/api/plugins/videos/progress", { media_id: id, position_s: 5, duration_s: 100 });
    await adult.client.post("/api/plugins/videos/progress", { media_id: id, position_s: 9, duration_s: 100 });
    flushProgress();
    expect((await ask(owner, "history")).map((row) => row.id)).toContain(id);
    const res = await owner.post("/api/plugins/videos/history/remove", { media_id: id });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { removed: boolean }).removed).toBe(true);
    expect((await ask(owner, "history")).map((row) => row.id)).not.toContain(id);
    expect((await ask(adult.client, "history")).map((row) => row.id)).toContain(id);
    expect(db.select().from(mediaProgress).all().filter((row) => row.personId === ownerId)).toEqual([]);
    expect(((await (await owner.post("/api/plugins/videos/history/remove", { media_id: id })).json()) as { removed: boolean }).removed).toBe(false);
    expect((await owner.post("/api/plugins/videos/history/remove", {})).status).toBe(400);
    // The video itself is still in the library.
    expect((await ask(owner, "library")).map((row) => row.id)).toContain(id);
  });

  test("the Library keeps the sort a person chose, per person", async () => {
    const { owner, adult, ask, ownerId } = await house();
    const recents = (await ask(owner, "library")).map((row) => row.title as string);
    const az = (await ask(owner, "library", { sort: "a-z" })).map((row) => row.title as string);
    expect(az).toEqual([...az].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })));
    expect(getSettingValueForPerson(ownerId, "videos.library_sort")).toBe("az");
    // No sort in the request: the saved one answers.
    expect((await ask(owner, "library")).map((row) => row.title)).toEqual(az);
    // Another person is unaffected.
    expect((await ask(adult.client, "library")).map((row) => row.title)).toEqual(recents);
    // Choosing Recents again is saved too; a word that is no sort changes nothing.
    await ask(owner, "library", { sort: "recents" });
    expect(getSettingValueForPerson(ownerId, "videos.library_sort")).toBe("recents");
    await ask(owner, "library", { sort: "sideways" });
    expect(getSettingValueForPerson(ownerId, "videos.library_sort")).toBe("recents");
  });
});

describe("the Videos pages", () => {
  const actionsOf = (node: Row): string[] => (node.row_actions ?? []).map((a: { label: string }) => a.label);
  const shelves = (page: string): Row[] => (pageOf(page).body as Row[]).filter((n) => n.type === "media_shelf");

  test("Save and Share are on the index, library, search, history, channel and playlist cards within three actions", () => {
    for (const page of ["index", "library", "search", "history", "liked", "watch-later", "channel", "playlist"]) {
      for (const shelf of shelves(page)) {
        if (!shelf.row_actions) continue;
        expect(shelf.row_actions.length).toBeLessThanOrEqual(3);
        if (page !== "playlist") expect(actionsOf(shelf)).toContain("Save to playlist"); // a playlist's own rows offer Remove from playlist instead
        expect(actionsOf(shelf)).toContain("Share");
      }
    }
    expect(actionsOf(shelves("history")[0]!)).toContain("Remove from history");
    expect(shelves("history")[0]!.row_actions.at(-1).action.call.target).toBe("/api/plugins/videos/history/remove");
  });

  test("the shelves use the soft card radius", () => {
    for (const page of ["index", "library", "search", "history", "liked", "watch-later", "channel", "playlists", "playlist"]) {
      for (const shelf of shelves(page)) expect(shelf.card_radius).toBe("soft");
    }
  });

  test("playlists, channels and suggestions are wired: manifest pages, sidebar, reorder, avatar strip and search.suggest", () => {
    const ids = manifest.contributes.pages.map((p: { id: string }) => p.id);
    for (const id of ["playlists", "playlist", "channel"]) expect(ids).toContain(id);
    expect(manifest.contributes.sidebar.groups[0].pages).toContain("playlists");
    expect(manifest.contributes.data.length).toBeLessThanOrEqual(16);
    const list = shelves("playlist").find((n) => n.reorder)!;
    expect(list.reorder).toEqual({ call: { call: { target: "/api/plugins/videos/playlists/reorder", args: { playlist_id: "{playlist_id}" } } }, id_param: "ids" });
    const strip = shelves("index").find((n) => n.bind.path === "channels")!;
    expect(strip).toMatchObject({ art_shape: "circle", bind: { params: { scope: "strip" } } });
    expect(shelves("index").some((n) => n.item_avatar_field === "channel_avatar")).toBe(true);
    const search = (pageOf("search").body as Row[]).find((n) => n.type === "search")!;
    expect(search.suggest).toMatchObject({ bind: { path: "library", params: { scope: "suggest", q: "$state.q" } }, max: 8, min_chars: 2 });
    expect(shelves("library")[0]!.heading).toBe("Playlists");
    expect(pageOf("watch").body[0].main[0].actions.map((a: { label: string }) => a.label)).toContain("Save to playlist");
  });
});
