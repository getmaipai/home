import { beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { mediaCollections, mediaItems, mediaProgress, mediaSources, people } from "@/db/schema";
import { createRootSource } from "@/lib/media/sources";
import { scanRoot } from "@/lib/media/scan";
import { flushProgress } from "@/lib/media/progress";
import { removeItem } from "@/lib/media/items";
import { createCollection, deleteCollection } from "@/lib/media/collections";
import { purgeExpired, type TrashRow } from "@/lib/trash/registry";
import { startTrashSweeper, stopTrashSweeper } from "@/lib/trash/sweep";
import type { PersonRow } from "@/types";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { buildMediaTree } from "./support/mediaTree";

beforeEach(() => resetDb());
async function setup() {
  const owner = new TestClient();
  const { person } = await (await owner.post("/api/auth/setup", { displayName: "atlas", secret: "correcthorse" })).json() as { person: { id: string } };
  const actor = db.select().from(people).where(eq(people.id, person.id)).get() as unknown as PersonRow;
  const tree = buildMediaTree();
  const result = createRootSource(actor, { label: "Films", path: tree.films, kinds: ["film"] });
  if (!result.ok) throw new Error("Fixture root failed. Check the fixture folder.");
  await scanRoot(result.source.id, { prober: null });
  const item = db.select().from(mediaItems).all()[0]!;
  return { owner, actor, source: result.source, item };
}
async function rows(client: TestClient) {
  return (await (await client.get("/api/trash")).json() as { rows: TrashRow[] }).rows;
}
const endpoint = (id: string, kind = "media_item") => `/api/trash/${kind}/${id}`;

test("trashed item lists and restores to media, and its archive clears", async () => {
  const { owner, item, source } = await setup();
  removeItem(item.id);
  expect(await rows(owner)).toEqual([{ kind: "media_item", id: item.id, title: item.title, deleted_at: expect.any(String), trash_until: expect.any(String), can_restore: true, can_purge: true }]);
  expect((await owner.get(`/api/media/items/${item.id}`)).status).toBe(404);
  expect((await owner.post(`${endpoint(item.id)}/restore`)).status).toBe(200);
  const live = await (await owner.get("/api/media/items")).json() as { items: Array<{ id: string }> };
  expect(live.items.some((row) => row.id === item.id)).toBe(true);
  expect(JSON.parse(db.select().from(mediaSources).where(eq(mediaSources.id, source.id)).get()!.archive)).not.toContain(item.locPath);
  expect(await rows(owner)).toEqual([]);
});

test("purge removes progress and item, preserves the archive and a scan skips its path", async () => {
  const { owner, item, source } = await setup();
  expect((await owner.put(`/api/media/progress/${item.id}`, { position: { seconds: 1 }, immediate: true })).status).toBe(200);
  expect((await owner.put(`/api/media/progress/${item.id}`, { position: { seconds: 2 } })).status).toBe(200);
  removeItem(item.id);
  expect((await owner.request(endpoint(item.id), { method: "DELETE" })).status).toBe(200);
  expect(db.select().from(mediaItems).where(eq(mediaItems.id, item.id)).get()).toBeUndefined();
  flushProgress();
  expect(db.select().from(mediaProgress).where(eq(mediaProgress.mediaId, item.id)).all()).toEqual([]);
  expect(JSON.parse(db.select().from(mediaSources).where(eq(mediaSources.id, source.id)).get()!.archive)).toContain(item.locPath);
  await scanRoot(source.id, { prober: null });
  expect(db.select().from(mediaItems).all().some((row) => row.locPath === item.locPath)).toBe(false);
});

test("expiry purges both kinds, keeps live rows and the boot sweep runs once", async () => {
  const { actor, item } = await setup();
  const expired = createCollection(actor.id, "playlist", "nova");
  deleteCollection(expired);
  const live = createCollection(actor.id, "watchlist", "pippa");
  removeItem(item.id);
  db.update(mediaItems).set({ trashUntil: "2000-01-01T00:00:00.000Z" }).where(eq(mediaItems.id, item.id)).run();
  db.update(mediaCollections).set({ trashUntil: "2000-01-01T00:00:00.000Z" }).where(eq(mediaCollections.id, expired.id)).run();
  startTrashSweeper();
  stopTrashSweeper();
  expect(db.select().from(mediaItems).where(eq(mediaItems.id, item.id)).get()).toBeUndefined();
  expect(db.select().from(mediaCollections).where(eq(mediaCollections.id, expired.id)).get()).toBeUndefined();
  expect(db.select().from(mediaCollections).where(eq(mediaCollections.id, live.id)).get()).toBeDefined();
  purgeExpired();
});

test("child sees and restores only their own safe rows; an admin cannot manage a child's collection", async () => {
  const { owner, actor, item, source } = await setup();
  const made = await (await owner.post("/api/people", { displayName: "sprout", role: "child", secret: "0000", birthdate: "2018-03-01" })).json() as { id: string };
  const child = new TestClient();
  await child.post("/api/auth/verify-secret", { personId: made.id, secret: "0000" });
  const other = createCollection(actor.id, "playlist", "atlas");
  deleteCollection(other);
  const own = createCollection(made.id, "playlist", "sprout");
  deleteCollection(own);
  removeItem(item.id);
  expect((await rows(child)).map((row) => row.id)).toEqual([own.id]);
  for (const path of [endpoint(item.id), endpoint(other.id, "media_collection"), endpoint("missing", "unknown")]) {
    expect((await child.post(`${path}/restore`)).status).toBe(404);
    expect((await child.request(path, { method: "DELETE" })).status).toBe(404);
  }
  expect((await owner.post(`${endpoint(own.id, "media_collection")}/restore`)).status).toBe(404);
  expect((await child.post(`${endpoint(own.id, "media_collection")}/restore`)).status).toBe(200);
  db.update(mediaSources).set({ scope: "person", ownerPersonId: made.id }).where(eq(mediaSources.id, source.id)).run();
  db.update(mediaItems).set({ bandOk: "adult" }).where(eq(mediaItems.id, item.id)).run();
  expect(await rows(child)).toEqual([]);
  expect((await child.post(`${endpoint(item.id)}/restore`)).status).toBe(404);
  db.update(mediaItems).set({ bandOk: "child" }).where(eq(mediaItems.id, item.id)).run();
  expect((await rows(owner)).some((row) => row.id === item.id)).toBe(false);
  expect((await owner.post(`${endpoint(item.id)}/restore`)).status).toBe(404);
  expect((await rows(child)).map((row) => row.id)).toEqual([item.id]);
  expect((await child.post(`${endpoint(item.id)}/restore`)).status).toBe(200);
});

test("expired restore is refused and a person's collection can be purged", async () => {
  const { owner, actor, item } = await setup();
  removeItem(item.id);
  db.update(mediaItems).set({ trashUntil: "2000-01-01T00:00:00.000Z" }).where(eq(mediaItems.id, item.id)).run();
  expect((await rows(owner)).find((row) => row.id === item.id)?.can_restore).toBe(false);
  expect((await owner.post(`${endpoint(item.id)}/restore`)).status).toBe(404);
  const collection = createCollection(actor.id, "watchlist", "nova");
  deleteCollection(collection);
  expect((await owner.request(endpoint(collection.id, "media_collection"), { method: "DELETE" })).status).toBe(200);
  expect(db.select().from(mediaCollections).where(eq(mediaCollections.id, collection.id)).get()).toBeUndefined();
});

test("folder audiobook parts restore together and remain gone after purge and rescan", async () => {
  const { owner, actor } = await setup();
  const tree = buildMediaTree();
  const made = createRootSource(actor, { label: "Reading", path: tree.reading, kinds: ["audiobook"] });
  if (!made.ok) throw new Error("Fixture root failed. Check the fixture folder.");
  await scanRoot(made.source.id, { prober: null });
  const all = db.select().from(mediaItems).where(eq(mediaItems.sourceId, made.source.id)).all();
  const part = all.find((row) => row.parentId)!;
  const parent = all.find((row) => row.id === part.parentId)!;
  const ids = all.filter((row) => row.parentId === parent.id || row.id === parent.id).map((row) => row.id);
  removeItem(parent.id);
  expect((await owner.post(`${endpoint(parent.id)}/restore`)).status).toBe(200);
  expect(db.select().from(mediaItems).all().filter((row) => ids.includes(row.id)).every((row) => row.deletedAt === null)).toBe(true);
  removeItem(parent.id);
  expect((await owner.request(endpoint(parent.id), { method: "DELETE" })).status).toBe(200);
  await scanRoot(made.source.id, { prober: null });
  expect(db.select().from(mediaItems).all().filter((row) => row.id === parent.id || row.parentId === parent.id)).toEqual([]);
});
