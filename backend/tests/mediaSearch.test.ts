import { beforeEach, describe, expect, test } from "bun:test";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { scanRoot } from "@/lib/media/scan";
import { buildMediaTree } from "./support/mediaTree";
import { db } from "@/db";
import { mediaItems, people } from "@/db/schema";
import { eq } from "drizzle-orm";
import { storeFile } from "@/lib/attachments";

beforeEach(resetDb);

interface Group { app: string; heading: string; rows: Array<{ id: string; app: string; kind: string; title: string; href: string }> }
async function setup() {
  const owner = new TestClient();
  await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const signIn = async (displayName: string, role: string) => {
    const made = await owner.post("/api/people", { displayName, role, secret: "0000", ...(role === "child" ? { birthdate: "2018-03-01" } : {}) });
    const created = await made.json() as { id: string };
    const client = new TestClient();
    await client.post("/api/auth/verify-secret", { personId: created.id, secret: "0000" });
    return { client, id: created.id };
  };
  const adult = await signIn("Marlow", "adult");
  const child = await signIn("Sprout", "child");
  const tree = buildMediaTree();
  const { mkdirSync, writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  mkdirSync(join(tree.videos, "Home videos"), { recursive: true });
  writeFileSync(join(tree.videos, "Home videos", "Garden Road.mp4"), "same title as film");
  const add = async (label: string, path: string, kinds: string[]) => {
    const response = await owner.post("/api/media/sources", { label, path, kinds });
    await scanRoot(((await response.json()) as { source: { id: string } }).source.id, { prober: null, pruneGraceMs: 0 });
  };
  await add("films", tree.films, ["film"]);
  await add("videos", tree.videos, ["video"]);
  await add("music", tree.music, ["track"]);
  await add("reading", tree.reading, ["book", "audiobook"]);
  return { owner, adult, child };
}
async function search(client: TestClient, q: string) {
  return await (await client.get(`/api/media/search?q=${encodeURIComponent(q)}`)).json() as { groups: Group[] };
}

describe("media search", () => {
  test("requires sign-in", async () => {
    expect((await new TestClient().get("/api/media/search?q=moon")).status).toBe(401);
  });

  test("finds a matching title in two apps", async () => {
    const { owner } = await setup();
    const result = await search(owner, "Garden Road");
    expect(result.groups.map((group) => group.app)).toEqual(expect.arrayContaining(["videos", "shows"]));
  });

  test("short queries and SQL LIKE wildcards return no matches", async () => {
    const { owner } = await setup();
    for (const q of ["m", "Moon%", "Moon_"]) expect((await search(owner, q)).groups).toEqual([]);
  });

  test("every child result is readable by that child", async () => {
    const { child } = await setup();
    const result = await search(child.client, "moon");
    expect(result.groups.flatMap((group) => group.rows).length).toBeGreaterThan(0);
    for (const group of result.groups) {
      for (const row of group.rows) expect((await child.client.get(`/api/media/items/${row.id}`)).status).toBe(200);
    }
    expect((await search(child.client, "Loud Song")).groups.flatMap((group) => group.rows).map((row) => row.title)).not.toContain("Loud Song");
  });

  test("finds a song made at home", async () => {
    const { adult } = await setup();
    const person = db.select().from(people).where(eq(people.id, adult.id)).get()!;
    const stored = storeFile(person, { conversationId: null, turnId: null, mediaType: "audio/mp4", bytes: new Uint8Array([4, 5, 6]), provenance: 'music-gen:{"title":"Searchable Home Song","duration_seconds":31}', deduplicate: false });
    if (!stored.ok) throw new Error(stored.error);
    const rows = (await search(adult.client, "Searchable Home")).groups.flatMap((group) => group.rows);
    expect(rows).toContainEqual(expect.objectContaining({ id: stored.value.id, app: "music", kind: "track", href: `/apps/music/play?id=${stored.value.id}` }));
  });

  test("skips an item that no longer parses", async () => {
    const { owner } = await setup();
    const item = db.select().from(mediaItems).where(eq(mediaItems.kind, "film")).get()!;
    const id = item.id;
    db.update(mediaItems).set({ locatorKind: "not-a-kind" }).where(eq(mediaItems.id, id)).run();
    expect((await owner.get("/api/media/search?q=moon")).status).toBe(200);
  });
});
