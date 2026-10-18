// MEDIA-KID-01 review regressions over HTTP: what a minor, a guest and an allowlisted teen see of the library's sources and of their
// own collection edits, and the media app data routes for a teen whose allowlist is on.
import { beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { mediaItems, mediaSources, people } from "@/db/schema";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { __resetProgressForTests } from "@/lib/media/progress";

beforeEach(() => { resetDb(); __resetProgressForTests(); });

async function setup() {
  const owner = new TestClient();
  expect((await owner.post("/api/auth/setup", { displayName: "atlas", secret: "correcthorse" })).status).toBe(201);
  async function person(displayName: string, role: string) {
    const res = await owner.post("/api/people", { displayName, role, secret: "0000" });
    expect(res.status).toBe(201);
    const { id } = await res.json() as { id: string };
    const client = new TestClient();
    expect((await client.post("/api/auth/verify-secret", { personId: id, secret: "0000" })).status).toBe(200);
    return { id, client, row: db.select().from(people).where(eq(people.id, id)).get()! };
  }
  const child = await person("sprout", "child");
  const teen = await person("nova", "teen");
  const guest = await person("pippa", "guest");
  const now = new Date().toISOString();
  db.insert(mediaSources).values({ id: "msrc-library0001", kind: "root", scope: "household", label: "Library", rootPath: "/fixture", rootKinds: '["video","track"]', visibleTo: '"household"',
    archive: JSON.stringify(["Adult/Hardcore porn 2.mp4"]), lastScanSummary: JSON.stringify({ at: now, added: 3, updated: 0, removed: 1, failed: 1, errors: ["Adult/broken.mp4"] }),
    createdAt: now, hlc: "1:0:aaaaaa", provenance: "admin:atlas" }).run();
  db.insert(mediaSources).values({ id: "msrc-feed00000001", kind: "feed", scope: "household", label: "Feed", url: "https://example.com/feed.xml", visibleTo: '"household"', createdAt: now, hlc: "1:0:aaaaaa", provenance: "test" }).run();
  const item = (id: string, sourceId: string, bandOk: string, title = "Moon song", kind = "video") =>
    db.insert(mediaItems).values({ id, sourceId, kind, title, locRootId: sourceId, locPath: `${id}.mp4`, mediaType: "video/mp4", playable: "original", size: 100, bandOk, addedAt: now, createdAt: now, hlc: "1:0:aaaaaa", provenance: "test" }).run();
  item("media-safe000001", "msrc-library0001", "child");
  item("media-adult00001", "msrc-library0001", "adult", "Late show");
  item("media-teen000001", "msrc-library0001", "teen", "Older show");
  item("media-feed000001", "msrc-feed00000001", "child", "Feed video");
  return { owner, child, teen, guest };
}

type View = { source: { id: string; archive: string[]; url: string | null; owner_person_id: string | null; root: { path: string } | null; provenance: string }; item_count: number; last_scan: unknown };
const sources = async (client: TestClient) => (await (await client.get("/api/media/sources")).json()) as View[];

test("sources_route_hides_archive_scan_and_counts_from_minor_and_guest", async () => {
  const { owner, child, guest } = await setup();
  for (const who of [child, guest]) {
    const views = await sources(who.client);
    expect(views.map((view) => view.source.id)).toEqual(["msrc-library0001"]); // the unnamed feed is outside the allowlist
    const [library] = views;
    expect(library!.source.archive).toEqual([]);
    expect(library!.last_scan).toBeNull();
    expect(library!.item_count).toBe(1); // only what this person may read
    expect(library!.source.root?.path).toBe("");
    expect(library!.source.owner_person_id).toBeNull();
    expect(JSON.stringify(library)).not.toContain("Hardcore");
    expect(JSON.stringify(library)).not.toContain("admin:atlas");
  }
  const adminView = (await sources(owner)).find((view) => view.source.id === "msrc-library0001")!;
  expect(adminView.source.archive).toEqual(["Adult/Hardcore porn 2.mp4"]);
  expect(adminView.last_scan).not.toBeNull();
  expect(adminView.item_count).toBe(3);
  expect(adminView.source.root?.path).toBe("/fixture");
});

test("a non-admin adult sees the feed with its counts but never another source's archive or address details", async () => {
  const { owner } = await setup();
  const res = await owner.post("/api/people", { displayName: "marlow", role: "adult", secret: "0000" });
  const { id } = await res.json() as { id: string };
  const marlow = new TestClient();
  await marlow.post("/api/auth/verify-secret", { personId: id, secret: "0000" });
  const views = await sources(marlow);
  const feed = views.find((view) => view.source.id === "msrc-feed00000001")!;
  expect(feed.source.url).toBeNull();
  expect(feed.item_count).toBe(1);
  expect(views.find((view) => view.source.id === "msrc-library0001")!.source.archive).toEqual([]);
});

test("collection_edit_responses_are_filtered", async () => {
  const { child } = await setup();
  const made = await child.client.post("/api/media/collections", { kind: "playlist", title: "Mine" });
  expect(made.status).toBeLessThan(300);
  const { id } = await made.json() as { id: string };
  expect((await child.client.post(`/api/media/collections/${id}/items`, { media_id: "media-safe000001" })).status).toBe(200);
  // An item the child may not read slips into the stored list (e.g. it was readable when added, then re-rated by an adult).
  const stored = db.select().from(mediaItems).where(eq(mediaItems.id, "media-safe000001")).get()!;
  expect(stored).toBeTruthy();
  db.update(mediaItems).set({ bandOk: "adult" }).where(eq(mediaItems.id, "media-safe000001")).run();
  const reordered = await child.client.put(`/api/media/collections/${id}/items`, { media_ids: ["media-safe000001"] });
  expect(reordered.status).toBe(200);
  expect(((await reordered.json()) as { items: unknown[] }).items).toEqual([]);
  const removed = await child.client.request(`/api/media/collections/${id}/items/media-nothing0001`, { method: "DELETE" });
  expect(removed.status).toBe(200);
  expect(((await removed.json()) as { items: unknown[] }).items).toEqual([]);
});

test("a teen whose allowlist is on gets no feed item and no discovery rows through the media app routes", async () => {
  const { owner, teen } = await setup();
  expect((await owner.put("/api/settings", { scope: `person:${teen.id}`, key: "media.allowlist_only", value: true })).status).toBe(200);
  const run = async (app: string, dataId: string, body: Record<string, unknown> = {}) => {
    const res = await teen.client.post(`/api/plugins/${app}/data/${dataId}`, body);
    return res.status === 200 ? JSON.stringify(await res.json()) : "";
  };
  for (const app of ["videos", "music", "podcasts"]) {
    for (const dataId of ["featured", "new", "recent"]) expect(await run(app, dataId)).not.toContain("media-");
  }
  expect(await run("videos", "library")).not.toContain("media-feed000001");
  expect((await teen.client.get("/api/media/items/media-feed000001")).status).toBe(404);
  expect((await teen.client.get("/api/media/items/media-feed000001/content")).status).toBe(404);
});
