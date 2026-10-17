// MEDIA-LIB-01: the /api/media boundary: admin-only sources, the no-overlap rule, band and visibility filtering, the byte route with
// Range, artwork, linked editions and the duplicate report.
import { beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { db } from "@/db";
import { mediaItems } from "@/db/schema";
import { scanRoot } from "@/lib/media/scan";
import { buildMediaTree, type MediaTree } from "./support/mediaTree";
import { parseRange, resolveUnderRoot } from "@/lib/media/serve";

beforeEach(() => resetDb());

async function setup() {
  const owner = new TestClient();
  const res = await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const { person } = (await res.json()) as { person: { id: string } };
  const signIn = async (displayName: string, role: string) => {
    const made = await owner.post("/api/people", { displayName, role, secret: "0000", ...(role === "child" ? { birthdate: "2018-03-01" } : {}) });
    const created = (await made.json()) as { id: string };
    const client = new TestClient();
    await client.post("/api/auth/verify-secret", { personId: created.id, secret: "0000" });
    return { client, id: created.id };
  };
  return { owner, ownerId: person.id, adult: await signIn("Marlow", "adult"), child: await signIn("Sprout", "child"), tree: buildMediaTree() };
}

async function addAll(owner: TestClient, tree: MediaTree) {
  const ids: Record<string, string> = {};
  const specs: Array<[string, string, string[]]> = [["videos", tree.videos, ["video"]], ["shows", tree.shows, ["episode"]], ["films", tree.films, ["film"]], ["music", tree.music, ["track"]], ["reading", tree.reading, ["book", "audiobook"]]];
  for (const [label, path, kinds] of specs) {
    const res = await owner.post("/api/media/sources", { label, path, kinds });
    expect(res.status).toBe(201);
    ids[label] = ((await res.json()) as { source: { id: string } }).source.id;
    await scanRoot(ids[label]!, { prober: null, pruneGraceMs: 0 });
  }
  return ids;
}

const itemsOf = async (c: TestClient, query: string) => (await (await c.get(`/api/media/items?${query}`)).json()) as { items: Array<{ id: string; title: string; kind: string }>; total: number; next_offset: number | null };

describe("sources", () => {
  test("only an owner or admin adds, removes or rescans a folder; everyone signed in lists the ones they may see", async () => {
    const { owner, adult, child, tree } = await setup();
    const body = { label: "Films", path: tree.films, kinds: ["film"] };
    expect((await adult.client.post("/api/media/sources", body)).status).toBe(403);
    expect((await child.client.post("/api/media/sources", body)).status).toBe(403);
    expect((await new TestClient().post("/api/media/sources", body)).status).toBe(401);
    const added = await owner.post("/api/media/sources", body);
    expect(added.status).toBe(201);
    const id = ((await added.json()) as { source: { id: string } }).source.id;
    expect((await adult.client.post(`/api/media/sources/${id}/rescan`, {})).status).toBe(403);
    expect((await owner.post(`/api/media/sources/${id}/rescan`, { force: true })).status).toBe(202);
    const listedByAdult = (await (await adult.client.get("/api/media/sources")).json()) as Array<{ source: { root: { path: string } | null } }>;
    expect(listedByAdult).toHaveLength(1);
    expect(listedByAdult[0]!.source.root!.path).toBe(""); // only an admin sees where it lives
    const listedByOwner = (await (await owner.get("/api/media/sources")).json()) as Array<{ source: { root: { path: string } } }>;
    expect(listedByOwner[0]!.source.root.path.length).toBeGreaterThan(1);
    expect((await adult.client.request(`/api/media/sources/${id}`, { method: "DELETE" })).status).toBe(403);
    expect((await owner.request(`/api/media/sources/${id}`, { method: "DELETE" })).status).toBe(200);
    expect(((await (await owner.get("/api/media/sources")).json()) as unknown[]).length).toBe(0);
  });

  test("roots may not overlap, inside or around another, and a missing folder is refused with a plain line", async () => {
    const { owner, tree } = await setup();
    expect((await owner.post("/api/media/sources", { label: "All", path: tree.base, kinds: ["video"] })).status).toBe(201);
    const inside = await owner.post("/api/media/sources", { label: "Films", path: tree.films, kinds: ["film"] });
    expect(inside.status).toBe(409);
    expect(((await inside.json()) as { error: string }).error).toContain("overlaps");
    const missing = await owner.post("/api/media/sources", { label: "Nope", path: join(tree.base, "no-such-folder"), kinds: ["film"] });
    expect(missing.status).toBe(400);
    expect((await owner.post("/api/media/sources", { label: "Rel", path: "films", kinds: ["film"] })).status).toBe(400);
    // A sibling folder with a similar name is not an overlap.
    mkdirSync(join(tree.base, "films-more"));
    expect((await owner.post("/api/media/sources", { label: "Films 2", path: join(tree.base, "films-more"), kinds: ["film"] })).status).toBe(409);
  });

  test("a network share root must sit inside its declared mount", async () => {
    const { owner, tree } = await setup();
    const mount = (await (await owner.post("/api/storage/nas-mounts", { label: "Family share", path: tree.films, scanPaths: [] })).json()) as { id: string };
    expect((await owner.post("/api/media/sources", { label: "Elsewhere", path: tree.music, kinds: ["track"], mount_id: mount.id })).status).toBe(400);
    expect((await owner.post("/api/media/sources", { label: "On the share", path: tree.films, kinds: ["film"], mount_id: mount.id })).status).toBe(201);
    expect((await owner.post("/api/media/sources", { label: "Gone", path: tree.music, kinds: ["track"], mount_id: "nas-missing01" })).status).toBe(404);
  });
});

describe("reading items", () => {
  test("a list by kind, in pages, in the right order", async () => {
    const { owner, adult, tree } = await setup();
    await addAll(owner, tree);
    const episodes = await itemsOf(adult.client, "kind=episode");
    expect(episodes.items.map((i) => i.title)).toEqual(["Pilot", "The Lighthouse", "New Season"]);
    const first = await itemsOf(adult.client, "kind=video&limit=2&sort=title");
    expect(first).toMatchObject({ total: 3, next_offset: 2 });
    expect(first.items.map((i) => i.title)).toEqual(["Building a birdhouse", "Fixing a squeaky door"]);
    const second = await itemsOf(adult.client, "kind=video&limit=2&sort=title&offset=2");
    expect(second.items.map((i) => i.title)).toEqual(["Sprout at the beach"]);
    expect(second.next_offset).toBeNull();
    expect((await itemsOf(adult.client, "kind=film&q=moon")).items.map((i) => i.title)).toEqual(["Moon Rivets"]);
    // Chapter parts are not in a general list.
    expect((await itemsOf(adult.client, "")).items.some((i) => i.kind === "chapter")).toBe(false);
    expect((await adult.client.get("/api/media/items?limit=500")).status).toBe(400);
  });

  test("a child reads only items cleared for a child: an explicit track is neither listed, opened, served nor shown", async () => {
    const { owner, adult, child, tree } = await setup();
    await addAll(owner, tree);
    const tracks = await itemsOf(adult.client, "kind=track");
    expect(tracks.items.map((i) => i.title).sort()).toEqual(["Loud Song", "Morning Light"]);
    expect((await itemsOf(child.client, "kind=track")).items.map((i) => i.title)).toEqual(["Morning Light"]);
    const loud = tracks.items.find((i) => i.title === "Loud Song")!;
    for (const path of ["", "/content", "/artwork"]) expect((await child.client.get(`/api/media/items/${loud.id}${path}`)).status).toBe(404);
    expect((await adult.client.get(`/api/media/items/${loud.id}`)).status).toBe(200);
    expect(((await (await child.client.get("/api/media/groups?by=artist&kind=track")).json()) as Array<{ key: string }>).map((g) => g.key)).toEqual(["The Marlows"]);
    // A child cannot see what the adult marks adult; an adult can lower it again.
    const lullaby = (await itemsOf(adult.client, "kind=film&q=garden")).items[0]!;
    expect((await owner.request(`/api/media/items/${lullaby.id}`, { method: "PATCH", body: { band_ok: "adult" } })).status).toBe(200);
    expect((await itemsOf(child.client, "kind=film")).items.map((i) => i.title)).toEqual(["Moon Rivets"]);
    expect((await child.client.request(`/api/media/items/${lullaby.id}`, { method: "PATCH", body: { band_ok: "child" } })).status).toBe(403);
  });

  test("an adult's mark survives a rescan; a source limited to some people hides its titles from the rest", async () => {
    const { owner, adult, child, tree } = await setup();
    const res = await owner.post("/api/media/sources", { label: "Films", path: tree.films, kinds: ["film"], visible_to: [adult.id] });
    const id = ((await res.json()) as { source: { id: string } }).source.id;
    await scanRoot(id, { prober: null, pruneGraceMs: 0 });
    expect((await itemsOf(adult.client, "kind=film")).total).toBe(2);
    expect((await itemsOf(child.client, "kind=film")).total).toBe(0);
    const garden = (await itemsOf(adult.client, "kind=film&q=garden")).items[0]!;
    await owner.request(`/api/media/items/${garden.id}`, { method: "PATCH", body: { band_ok: "teen" } });
    writeFileSync(join(tree.films, "Garden Road.mkv"), "changed film bytes");
    await scanRoot(id, { prober: null, pruneGraceMs: 0 });
    expect(db.select().from(mediaItems).where(eq(mediaItems.id, garden.id)).get()!.bandOk).toBe("teen");
  });

  test("one title carries its folder-audiobook parts and the linked edition", async () => {
    const { owner, adult, tree } = await setup();
    await addAll(owner, tree);
    const m4b = (await itemsOf(adult.client, "kind=audiobook&q=Clockwork")).items[0]!;
    const detail = (await (await adult.client.get(`/api/media/items/${m4b.id}`)).json()) as { item: { id: string }; linked: Array<{ kind: string; title: string }>; parts: unknown[] };
    expect(detail.linked.map((l) => [l.kind, l.title])).toEqual([["book", "The Clockwork Garden"]]);
    const folder = (await itemsOf(adult.client, "kind=audiobook&q=Moon")).items[0]!;
    const folderDetail = (await (await adult.client.get(`/api/media/items/${folder.id}`)).json()) as { parts: Array<{ title: string }>; linked: unknown[] };
    expect(folderDetail.parts.map((p) => p.title)).toEqual(["Part 1", "Part 2", "Part 3"]);
    expect(folderDetail.linked).toEqual([]);
    expect((await itemsOf(adult.client, `parent_id=${folder.id}`)).items.map((i) => i.title)).toEqual(["Part 1", "Part 2", "Part 3"]);
    const pdf = (await itemsOf(adult.client, "kind=book&q=Field")).items[0]!;
    expect(((await (await adult.client.get(`/api/media/items/${pdf.id}`)).json()) as { page_count: number }).page_count).toBe(2);
  });
});

describe("bytes and artwork", () => {
  test("the byte route serves the file with its media type and Range support", async () => {
    const { owner, adult, tree } = await setup();
    await addAll(owner, tree);
    const film = (await itemsOf(adult.client, "kind=film&q=moon")).items[0]!;
    const whole = await adult.client.get(`/api/media/items/${film.id}/content`);
    expect(whole.status).toBe(200);
    expect(whole.headers.get("content-type")).toBe("video/mp4");
    expect(whole.headers.get("accept-ranges")).toBe("bytes");
    expect(await whole.text()).toBe("film one");
    const part = await adult.client.get(`/api/media/items/${film.id}/content`, { Range: "bytes=2-4" });
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe("bytes 2-4/8");
    expect(await part.text()).toBe("lm ");
    const tail = await adult.client.get(`/api/media/items/${film.id}/content`, { Range: "bytes=-3" });
    expect(await tail.text()).toBe("one");
    expect((await adult.client.get(`/api/media/items/${film.id}/content`, { Range: "bytes=50-60" })).status).toBe(416);
    const track = (await itemsOf(adult.client, "kind=track&q=Morning")).items[0]!;
    expect((await adult.client.get(`/api/media/items/${track.id}/content`)).headers.get("content-type")).toBe("audio/mpeg");
    const folder = (await itemsOf(adult.client, "kind=audiobook&q=Moon")).items[0]!;
    expect((await adult.client.get(`/api/media/items/${folder.id}/content`)).status).toBe(422);
    expect((await new TestClient().get(`/api/media/items/${film.id}/content`)).status).toBe(401);
  });

  test("a file that has gone from the disk answers with a plain 404, and a name cannot escape its root", async () => {
    const { owner, adult, tree } = await setup();
    const ids = await addAll(owner, tree);
    const film = (await itemsOf(adult.client, "kind=film&q=garden")).items[0]!;
    writeFileSync(join(tree.base, "secret.txt"), "outside");
    symlinkSync(join(tree.base, "secret.txt"), join(tree.films, "link.mp4"));
    await scanRoot(ids["films"]!, { prober: null, pruneGraceMs: 0 });
    const link = (await itemsOf(adult.client, "kind=film&q=link")).items[0]!;
    expect((await adult.client.get(`/api/media/items/${link.id}/content`)).status).toBe(404);
    expect(resolveUnderRoot(ids["films"]!, "../secret.txt")).toBeNull();
    expect(resolveUnderRoot(ids["films"]!, "link.mp4")).toBeNull(); // a symbolic link out of the root
    expect(resolveUnderRoot(ids["films"]!, "Garden Road.mkv")).not.toBeNull();
    // A row the spec shape rejects reads as "not in the library", never a server error.
    db.update(mediaItems).set({ locPath: "../secret.txt" }).where(eq(mediaItems.id, film.id)).run();
    expect((await adult.client.get(`/api/media/items/${film.id}/content`)).status).toBe(404);
  });

  test("artwork: a poster file, a cover file, an embedded cover and an EPUB cover", async () => {
    const { owner, adult, tree } = await setup();
    await addAll(owner, tree);
    const art = async (query: string) => adult.client.get(`/api/media/items/${(await itemsOf(adult.client, query)).items[0]!.id}/artwork`);
    expect(await (await art("kind=episode&q=Pilot")).text()).toBe("poster");
    expect((await art("kind=episode&q=Pilot")).headers.get("content-type")).toBe("image/jpeg");
    expect(await (await art("kind=track&q=Morning")).text()).toBe("album art");
    const epub = await art("kind=book&q=Clockwork");
    expect(epub.status).toBe(200);
    expect(epub.headers.get("content-type")).toBe("image/jpeg");
    expect((await epub.arrayBuffer()).byteLength).toBeGreaterThan(100);
    expect((await art("kind=video&q=birdhouse")).status).toBe(404);
  });

  test("parseRange: suffix, open end, clamped end, garbage and past the end", () => {
    expect(parseRange(undefined, 10)).toBeNull();
    expect(parseRange("bytes=0-0", 10)).toEqual({ start: 0, end: 0 });
    expect(parseRange("bytes=4-", 10)).toEqual({ start: 4, end: 9 });
    expect(parseRange("bytes=4-99", 10)).toEqual({ start: 4, end: 9 });
    expect(parseRange("bytes=-4", 10)).toEqual({ start: 6, end: 9 });
    expect(parseRange("bytes=10-12", 10)).toBe("unsatisfiable");
    expect(parseRange("bytes=5-2", 10)).toBe("unsatisfiable");
    expect(parseRange("bytes=-0", 10)).toBe("unsatisfiable");
    expect(parseRange("items=1-2", 10)).toBeNull();
    expect(parseRange("bytes=0-1", 0)).toBe("unsatisfiable");
  });
});

describe("removing and duplicates", () => {
  test("an admin removes a title; it leaves every list, stays gone after a rescan, and the file is untouched", async () => {
    const { owner, adult, tree } = await setup();
    const ids = await addAll(owner, tree);
    const film = (await itemsOf(adult.client, "kind=film&q=garden")).items[0]!;
    expect((await adult.client.request(`/api/media/items/${film.id}`, { method: "DELETE" })).status).toBe(403);
    expect((await owner.request(`/api/media/items/${film.id}`, { method: "DELETE" })).status).toBe(200);
    await scanRoot(ids["films"]!, { prober: null, pruneGraceMs: 0, force: true });
    expect((await itemsOf(adult.client, "kind=film")).items.map((i) => i.title)).toEqual(["Moon Rivets"]);
    expect((await adult.client.get(`/api/media/items/${film.id}`)).status).toBe(404);
    expect(await Bun.file(join(tree.films, "Garden Road.mkv")).text()).toBe("film two");
  });

  test("duplicates are reported to an admin and change nothing", async () => {
    const { owner, adult, tree } = await setup();
    await addAll(owner, tree);
    const copy = join(tree.base, "copy");
    mkdirSync(copy);
    writeFileSync(join(copy, "Garden Road.mkv"), "film two");
    const res = await owner.post("/api/media/sources", { label: "copy", path: copy, kinds: ["film"] });
    await scanRoot(((await res.json()) as { source: { id: string } }).source.id, { prober: null, pruneGraceMs: 0 });
    const dupes = (await (await owner.get("/api/media/duplicates")).json()) as Array<{ title: string; items: unknown[] }>;
    expect(dupes).toHaveLength(1);
    expect(dupes[0]).toMatchObject({ title: "Garden Road" });
    expect(dupes[0]!.items).toHaveLength(2);
    expect((await adult.client.get("/api/media/duplicates")).status).toBe(403);
    expect((await itemsOf(adult.client, "kind=film&q=garden")).total).toBe(2);
  });
});
