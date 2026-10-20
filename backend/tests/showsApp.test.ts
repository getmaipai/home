import { beforeEach, expect, test } from "bun:test";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import UI_SCHEMA from "@maipai/spec/ui/schema.json" with { type: "json" };
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { buildMediaTree } from "./support/mediaTree";
import { scanRoot } from "@/lib/media/scan";
import { __resetProgressForTests } from "@/lib/media/progress";
import { loadManifestOnly } from "@/lib/plugins";
import { db } from "@/db";
import { mediaItems } from "@/db/schema";
import { eq } from "drizzle-orm";

beforeEach(() => { resetDb(); __resetProgressForTests(); });
type Row = { id: string; title: string; play_id: string; copy_label: string; progress?: number };
async function setup() {
  const owner = new TestClient();
  await owner.post("/api/auth/setup", { displayName: "atlas", secret: "correcthorse" });
  const child = new TestClient();
  const made = await owner.post("/api/people", { displayName: "sprout", role: "child", birthdate: "2018-03-01", secret: "0000" });
  const { id } = await made.json() as { id: string };
  await child.post("/api/auth/verify-secret", { personId: id, secret: "0000" });
  const tree = buildMediaTree();
  writeFileSync(join(tree.shows, "Juniper Bay/Season 1/Juniper Bay S01E03 - The Garden.mp4"), "episode");
  for (const [path, kind] of [[tree.shows, "episode"], [tree.films, "film"]]) {
    const response = await owner.post("/api/media/sources", { label: kind, path, kinds: [kind] });
    const { source } = await response.json() as { source: { id: string } };
    await scanRoot(source.id, { prober: null });
  }
  const data = async (client: TestClient, dataId: string, args = {}) => (await client.post(`/api/plugins/shows/data/${dataId}`, args)).json();
  const rows = async (dataId: string, args = {}) => await data(owner, dataId, args) as Row[];
  const show = (await rows("shows"))[0]!;
  return { owner, child, data, rows, show };
}

test("the package manifest and every page use the shipped schema", () => {
  expect(loadManifestOnly("shows").ok).toBe(true);
  const directory = join(import.meta.dir, "../packages/shows/pages");
  const ajv = new Ajv2020({ strict: false });
  const validate = ajv.compile(UI_SCHEMA as object);
  for (const file of readdirSync(directory)) {
    expect(validate(JSON.parse(readFileSync(join(directory, file), "utf8")))).toBe(true);
  }
});

test("two seasons sort numerically and offer E03 then the first episode of season 2", async () => {
  const { rows, show } = await setup();
  expect(await rows("shows")).toHaveLength(1);
  const seasons = await rows("seasons", { id: show.id }) as unknown as { rows: { id: string }[] };
  expect(seasons.rows.map((row) => row.id)).toEqual(["1", "2"]);
  const episodes = await rows("episodes", { id: show.id, season: 1 });
  expect(episodes.map((row) => row.title)).toEqual(["1. Pilot", "2. The Lighthouse", "3. The Garden"]);
  expect((episodes as unknown as Array<{ up_next: boolean }>).map((row) => row.up_next)).toEqual([true, false, false]); // the kit rings the next episode to watch
  for (const [id, title] of [[episodes[1]!.id, "The Garden"], [episodes[2]!.id, "New Season"]] as const) {
    const item = await rows("item", { id }) as unknown as { up_next: { title: string } };
    expect(item.up_next.title).toBe(title);
  }
  const last = (await rows("episodes", { id: show.id, season: "2" }))[0]!;
  expect((await rows("item", { id: last.id }) as unknown as { up_next?: unknown }).up_next).toBeUndefined();
});

test("chapters, progress and next-to-watch badge use the shared records", async () => {
  const { owner, rows, show } = await setup();
  const episodes = await rows("episodes", { id: show.id, season: 1 });
  const first = episodes[0]!;
  db.update(mediaItems).set({ chapters: JSON.stringify([{ start_s: 0, title: "Intro", source: "embedded" }, { start_s: 30, title: "Story", source: "embedded" }, { start_s: 90, title: "Credits", source: "embedded" }]) }).where(eq(mediaItems.id, first.id)).run();
  const item = await rows("item", { id: first.id }) as unknown as { chapters: { title: string }[] };
  expect(item.chapters.map((chapter) => chapter.title)).toEqual(["Intro", "Story", "Credits"]);
  expect((await owner.post("/api/plugins/shows/progress", { media_id: first.id, position_s: "50", duration_s: "100", reason: "pause" })).status).toBe(200);
  expect((await rows("episodes", { id: show.id, season: 1 }))[0]).toMatchObject({ progress: 0.5, up_next: true });
  await owner.post("/api/plugins/shows/progress", { media_id: first.id, position_s: "100", duration_s: "100", reason: "ended" });
  const updated = await rows("episodes", { id: show.id, season: 1 });
  expect(updated[0]).toMatchObject({ progress: 1, copy_label: "Watched", up_next: false });
  expect(updated[1]).toMatchObject({ up_next: true });
});

test("watchlist statuses change one show reference and stay private", async () => {
  const { owner, child, data, rows, show } = await setup();
  for (const status of ["want", "watching", "completed"]) {
    expect((await owner.post("/api/plugins/shows/watchlist", { media_id: show.id, status })).status).toBe(200);
    expect(await rows("watchlist", { status })).toHaveLength(1);
  }
  expect(await rows("watchlist")).toHaveLength(1);
  expect(await rows("watchlist", { status: "want" })).toEqual([]);
  expect(await data(child, "watchlist")).toEqual([]);
  expect((await owner.post("/api/plugins/shows/watchlist", { media_id: show.id, status: "invalid" })).status).toBe(400);
});

test("child items are filtered before grouping and never autoplay or discover", async () => {
  const { owner, child, data, rows, show } = await setup();
  const episodes = await rows("episodes", { id: show.id, season: 1 });
  const hidden = episodes[1]!.id;
  await owner.request(`/api/media/items/${hidden}`, { method: "PATCH", body: { band_ok: "adult" } });
  for (const id of ["featured", "recent", "genres", "genre"]) {
    const answer = await data(child, id);
    expect(answer).toEqual(id === "genres" ? { rows: [] } : []);
  }
  const visible = await data(child, "episodes", { id: show.id, season: 1 }) as Row[];
  expect(visible.map((row) => row.id)).not.toContain(hidden);
  expect(await data(child, "detail", { id: hidden })).toEqual([]);
  expect((await data(child, "item", { id: visible[0]!.id }) as { up_next?: unknown }).up_next).toBeUndefined();
  expect((await child.post("/api/plugins/shows/watchlist", { media_id: hidden })).status).toBe(404);
});

test("the Shows package passes the hub's own package-page check", async () => {
  const { appPackageProblems } = await import("@/lib/apps");
  const loaded = loadManifestOnly("shows");
  expect(loaded.ok).toBe(true);
  if (loaded.ok) expect(appPackageProblems(loaded.value, join(import.meta.dir, "../packages/shows"))).toEqual([]);
});

test("playing a show on the watchlist as want moves it to watching, and only on the player's own list", async () => {
  const { owner, child, rows, show } = await setup();
  await owner.post("/api/plugins/shows/watchlist", { media_id: show.id, status: "want" });
  const first = (await rows("episodes", { id: show.id, season: 1 }))[0]!;
  await owner.post("/api/plugins/shows/progress", { media_id: first.id, position_s: "5", duration_s: "100", reason: "pause" });
  expect(await rows("watchlist", { status: "watching" })).toHaveLength(1);
  expect(await rows("watchlist", { status: "want" })).toEqual([]);
  expect((await child.post("/api/plugins/shows/data/watchlist", {})).status).toBe(200);
});

test("the season picker, episode rows and billboard bind only fields the data ids return", async () => {
  const { rows, show } = await setup();
  const [episode] = await rows("episodes", { id: show.id, season: 1 }) as unknown as Array<Record<string, unknown>>;
  for (const field of ["id", "title", "summary", "thumbnail", "duration_s", "up_next"]) expect(Object.keys(episode!)).toContain(field);
  const [detail] = await rows("detail", { id: show.id }) as unknown as Array<Record<string, unknown>>;
  for (const field of ["id", "title", "summary", "channel", "backdrop", "play_id"]) expect(Object.keys(detail!)).toContain(field);
});

test("a child's seasons, next-episode offer and up-next list skip an episode held back for adults, and a title with a held-back word is gone", async () => {
  const { owner, child, data, rows, show } = await setup();
  const s1 = await rows("episodes", { id: show.id, season: 1 });
  await owner.request(`/api/media/items/${s1[1]!.id}`, { method: "PATCH", body: { band_ok: "adult" } });
  const seen = await data(child, "episodes", { id: show.id, season: 1 }) as Row[];
  expect(seen.map((row) => row.title)).toEqual(["1. Pilot", "3. The Garden"]);
  expect((await data(child, "up-next", { id: seen[0]!.id }) as Row[]).map((row) => row.id)).not.toContain(s1[1]!.id);
  expect(((await data(child, "seasons", { id: show.id })) as { rows: unknown[] }).rows).toHaveLength(2);
  db.update(mediaItems).set({ genre: "Hardcore porn" }).where(eq(mediaItems.id, s1[0]!.id)).run();
  expect((await data(child, "episodes", { id: show.id, season: 1 }) as Row[]).map((row) => row.id)).not.toContain(s1[0]!.id);
  expect((await data(owner, "episodes", { id: show.id, season: 1 }) as Row[]).map((row) => row.id)).toContain(s1[0]!.id);
});

test("a guest gets nothing from Shows or Music: every data id and action answers no such app", async () => {
  const { owner, show } = await setup();
  const made = await owner.post("/api/people", { displayName: "visitor", role: "guest", guestExpiresAt: "2030-01-01T00:00:00.000Z" });
  const { id } = await made.json() as { id: string };
  const guest = new TestClient();
  expect((await guest.post("/api/auth/select", { personId: id })).status).toBe(200);
  for (const [app, dataId] of [["shows", "shows"], ["shows", "featured"], ["shows", "watchlist"], ["shows", "episodes"], ["music", "songs"], ["music", "albums"], ["music", "radio-seeds"]] as const) {
    expect({ app, dataId, status: (await guest.post(`/api/plugins/${app}/data/${dataId}`, { id: show.id })).status }).toEqual({ app, dataId, status: 404 });
  }
  expect((await guest.post("/api/plugins/shows/watchlist", { media_id: show.id, status: "want" })).status).toBe(404);
  expect((await guest.post("/api/plugins/music/queue", { id: show.id })).status).toBe(404);
});

test("the person's allowlist setting empties discovery for an adult who turned it on, and never opens it for a child", async () => {
  const { owner, child, data, rows } = await setup();
  const adult = new TestClient();
  const made = await owner.post("/api/people", { displayName: "pippa", role: "adult", secret: "1111" });
  const { id } = await made.json() as { id: string };
  await adult.post("/api/auth/verify-secret", { personId: id, secret: "1111" });
  expect((await rows("featured")).length).toBeGreaterThan(0);
  expect((await data(adult, "recent") as Row[]).length).toBeGreaterThan(0);
  expect((await owner.put("/api/settings", { scope: `person:${id}`, key: "media.allowlist_only", value: true })).status).toBe(200);
  for (const dataId of ["featured", "recent", "genre"]) expect(await data(adult, dataId, { genre: "Drama" })).toEqual([]);
  expect(await data(adult, "genres")).toEqual({ rows: [] });
  expect(((await data(adult, "shows")) as Row[]).length).toBeGreaterThan(0); // the saved library itself stays
  expect((await owner.put("/api/settings", { scope: `person:${id}`, key: "media.allowlist_only", value: false })).status).toBe(200);
  expect((await data(adult, "featured") as Row[]).length).toBeGreaterThan(0);
  const kid = await data(child, "featured");
  expect(kid).toEqual([]);
});
