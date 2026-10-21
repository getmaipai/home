// MEDIA-SOURCE-HEAL-01: a stored media source that no longer parses must never fail every media shelf. Live bug (2026-10-21): playing a song
// from "Created by you" saved a private root with an id and no folder the spec refuses (`msrc-made-<person>`), so every media query in
// every app answered 500 ("Could not load this shelf", "Could not load Media"). Boot now repairs it, and a bad source is left out.
import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { mediaItems, mediaSources } from "@/db/schema";
import { nextHlc } from "@/lib/hlc";
import { healMadeSources } from "@/lib/media/heal";
import { madeSourceId, sourceFromRow, sourcesFromRows } from "@/lib/media/model";
import { scanRoot } from "@/lib/media/scan";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { buildMediaTree } from "./support/mediaTree";

beforeEach(() => resetDb());

async function setup() {
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const people = (await (await client.get("/api/people")).json()) as Array<{ id: string }>;
  const personId = people[0]!.id;
  const tree = buildMediaTree();
  const added = await client.post("/api/media/sources", { label: "music", path: tree.music, kinds: ["track"] });
  const rootId = ((await added.json()) as { source: { id: string } }).source.id;
  await scanRoot(rootId, { prober: null, pruneGraceMs: 0 });
  return { client, personId, rootId };
}

const legacyMade = (personId: string) => ({
  id: `msrc-made-${personId}`, kind: "root", scope: "person", ownerPersonId: personId, label: "Created by you",
  visibleTo: JSON.stringify([personId]), createdAt: new Date().toISOString(), hlc: nextHlc(), provenance: "music:generated-library",
} as typeof mediaSources.$inferInsert);

describe("the early 'Created by you' source", () => {
  test("it cannot parse as saved, a bad source is left out, and every media route still answers", async () => {
    const { client, personId } = await setup();
    db.insert(mediaSources).values(legacyMade(personId)).run();
    const legacyRow = db.select().from(mediaSources).where(eq(mediaSources.id, `msrc-made-${personId}`)).get()!;
    expect(() => sourceFromRow(legacyRow)).toThrow();
    expect(sourcesFromRows([legacyRow])).toEqual([]);
    expect((await client.get("/api/media/sources")).status).toBe(200);
    expect((await client.post("/api/plugins/music/data/songs", {})).status).toBe(200);
    expect((await client.post("/api/plugins/videos/data/recent", {})).status).toBe(200);
    expect((await client.get("/api/media/home")).status).toBe(200);
  });

  test("boot repair renames it, moves the songs saved under it and leaves it paused", async () => {
    const { client, personId } = await setup();
    const song = db.select().from(mediaItems).get()!;
    const oldId = `msrc-made-${personId}`;
    db.insert(mediaSources).values(legacyMade(personId)).run();
    db.update(mediaItems).set({ sourceId: oldId }).where(eq(mediaItems.id, song.id)).run();

    expect(healMadeSources()).toBe(1);

    const newId = madeSourceId(personId);
    expect(db.select().from(mediaSources).where(eq(mediaSources.id, oldId)).get()).toBeUndefined();
    const healed = sourceFromRow(db.select().from(mediaSources).where(eq(mediaSources.id, newId)).get()!);
    expect(healed.root).toEqual({ mount_id: null, path: "made-at-home", kinds: ["track"] });
    expect(healed.paused).toBe(true);
    expect(db.select().from(mediaItems).where(eq(mediaItems.id, song.id)).get()!.sourceId).toBe(newId);
    const songs = (await (await client.post("/api/plugins/music/data/songs", {})).json()) as Array<{ id: string }>;
    expect(songs.map((row) => row.id)).toContain(song.id);
    expect(healMadeSources()).toBe(0);
  });

  test("the id for a made-at-home source is a valid spec id", () => {
    expect(madeSourceId("person-8t22v4br99")).toBe("msrc-madeperson8t22v4br99");
    expect(madeSourceId("person-8t22v4br99")).toMatch(/^msrc-[a-z0-9]{6,}$/);
  });
});
