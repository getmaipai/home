// MEDIA-HOME-01: the Media home's data over HTTP: a guest is refused, the "new" shelf mixes the apps' newest additions, saving a place in
// a book puts it on "continue" (and still on /api/continue), a child's shelves hold only what the child's band allows, and the songs a
// person played lately show on "recent music".
import { beforeEach, describe, expect, test } from "bun:test";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { scanRoot } from "@/lib/media/scan";
import { __resetProgressForTests, flushProgress } from "@/lib/media/progress";
import { buildMediaTree } from "./support/mediaTree";

beforeEach(() => {
  resetDb();
  __resetProgressForTests();
});

interface Row {
  id: string; app: string; kind: string; title: string; subtitle: string | null; artwork_url: string | null;
  href: string; percent: number | null; at: string;
}
interface Home { continue: Row[]; new: Row[]; recent_music: Row[] }

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
  const child = await signIn("Sprout", "child");
  const tree = buildMediaTree();
  for (const [label, path, kinds] of [["films", tree.films, ["film"]], ["music", tree.music, ["track"]], ["reading", tree.reading, ["book", "audiobook"]]] as const) {
    const added = await owner.post("/api/media/sources", { label, path, kinds });
    await scanRoot(((await added.json()) as { source: { id: string } }).source.id, { prober: null, pruneGraceMs: 0 });
  }
  const find = async (client: TestClient, query: string) => ((await (await client.get(`/api/media/items?${query}`)).json()) as { items: Array<{ id: string; title: string }> }).items[0]!.id;
  const home = async (client: TestClient) => (await client.get("/api/media/home")).json() as Promise<Home>;
  const play = (client: TestClient, id: string, seconds: number) => client.request(`/api/media/progress/${id}`, { method: "PUT", body: { immediate: true, position: { seconds }, duration_s: 100, device_id: null, event: "play" } });
  return { owner, adult, child, find, home, play };
}

describe("media home", () => {
  test("a signed-out visitor is refused", async () => {
    await setup();
    expect((await new TestClient().get("/api/media/home")).status).toBe(401);
  });

  test("new: the owner sees additions from at least two apps, newest first", async () => {
    const { owner, home } = await setup();
    const shelf = (await home(owner)).new;
    expect(shelf.length).toBeGreaterThan(0);
    expect(shelf.length).toBeLessThanOrEqual(12);
    expect(new Set(shelf.map((row) => row.app)).size).toBeGreaterThanOrEqual(2);
    expect(new Set(shelf.map((row) => row.app)).has("books")).toBe(true);
    for (const [index, row] of shelf.entries()) {
      expect(row.percent).toBeNull();
      expect(row.at).not.toHaveLength(0);
      if (index > 0) expect(row.at.localeCompare(shelf[index - 1]!.at)).toBeLessThanOrEqual(0);
    }
  });

  test("continue: saving a place in a book puts it on the home with its percent", async () => {
    const { adult, find, home } = await setup();
    const book = await find(adult.client, "kind=book&q=Clockwork");
    expect((await home(adult.client)).continue).toEqual([]);
    const saved = await adult.client.post("/api/plugins/books/progress", {
      media_id: book, locator: { kind: "cfi", cfi: "epubcfi(/6/4!/4/2/1:120)", spine_index: 1, block_index: 3 }, percent: "42.5", reason: "pause",
    });
    expect(saved.status).toBe(200);
    flushProgress();
    const rows = (await home(adult.client)).continue;
    expect(rows.map((row) => row.id)).toEqual([book]);
    expect(rows[0]).toMatchObject({ app: "books", kind: "book", href: `/media/${book}` });
    expect(rows[0]!.percent).toBe(43);
  });

  test("a child's shelves hold only what the child may read", async () => {
    const { child, find, home, play } = await setup();
    const film = await find(child.client, "kind=film&q=moon");
    await play(child.client, film, 10);
    flushProgress();
    const homeRows = (await home(child.client));
    for (const row of [...homeRows.new, ...homeRows.continue, ...homeRows.recent_music]) {
      expect((await child.client.get(`/api/media/items/${row.id}`)).status).toBe(200);
    }
    // The explicit single is cleared for adults only: it is not on the child's new shelf.
    expect(homeRows.new.map((row) => row.title)).not.toContain("Loud Song");
    expect(homeRows.continue.map((row) => row.id)).toContain(film);
  });

  test("recent music: the songs the person played lately, newest first, once each", async () => {
    const { adult, find, home, play } = await setup();
    const one = await find(adult.client, "kind=track&q=Morning");
    const two = await find(adult.client, "kind=track&q=Loud");
    await play(adult.client, one, 5);
    await play(adult.client, two, 5);
    flushProgress();
    await play(adult.client, one, 8); // one more place in the first song: still one row, newer
    flushProgress();
    const songs = (await home(adult.client)).recent_music;
    expect(songs.map((row) => row.id)).toEqual([one, two]);
    expect(songs.every((row) => row.app === "music")).toBe(true);
    expect(songs.every((row) => row.percent === null)).toBe(true);
  });

  test("the Pick up route still answers with its rows", async () => {
    const { adult, find, play } = await setup();
    const film = await find(adult.client, "kind=film&q=moon");
    await play(adult.client, film, 30);
    flushProgress();
    const res = await adult.client.get("/api/continue");
    expect(res.status).toBe(200);
    const { rows } = (await res.json()) as { rows: Array<{ kind: string; id: string; title: string; href: string; percent: number | null; media_kind: string | null }> };
    expect(rows).toEqual([expect.objectContaining({ kind: "media", id: film, media_kind: "film", percent: 30 })]);
  });
});
