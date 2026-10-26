// MEDIA-DETAIL-04b: editMediaItem and every gate on it.
import { beforeEach, describe, expect, test } from "bun:test";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { scanRoot } from "@/lib/media/scan";
import { buildMediaTree } from "./support/mediaTree";
import { db } from "@/db";
import { people, mediaItems, mediaSources } from "@/db/schema";
import { eq } from "drizzle-orm";
import { editMediaItem } from "@/lib/media/mediaEdit";
import type { PersonRow } from "@/types";

beforeEach(() => resetDb());

async function setup() {
  const owner = new TestClient();
  await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const make = async (displayName: string, role: string) => {
    const made = await owner.post("/api/people", { displayName, role, secret: "0000", ...(role === "child" ? { birthdate: "2018-03-01" } : {}) });
    return ((await made.json()) as { id: string }).id;
  };
  const adultId = await make("Marlow", "adult");
  const teenId = await make("Nova", "teen");
  const childId = await make("Sprout", "child");
  const tree = buildMediaTree();
  const added = await owner.post("/api/media/sources", { label: "music", path: tree.music, kinds: ["track"] });
  const sourceId = ((await added.json()) as { source: { id: string } }).source.id;
  await scanRoot(sourceId, { prober: null, pruneGraceMs: 0 });
  const videos = await owner.post("/api/media/sources", { label: "videos", path: tree.videos, kinds: ["video"] });
  await scanRoot(((await videos.json()) as { source: { id: string } }).source.id, { prober: null, pruneGraceMs: 0 });
  const person = (id: string) => db.select().from(people).where(eq(people.id, id)).get() as unknown as PersonRow;
  const ownerPerson = db.select().from(people).where(eq(people.role, "owner")).get() as unknown as PersonRow;
  const track = db.select().from(mediaItems).where(eq(mediaItems.kind, "track")).all()[0]!;
  const video = db.select().from(mediaItems).where(eq(mediaItems.kind, "video")).all()[0]!;
  return { ownerPerson, adult: person(adultId), teen: person(teenId), child: person(childId), track, video, sourceId };
}
const row = (id: string) => db.select().from(mediaItems).where(eq(mediaItems.id, id)).get()!;

describe("editMediaItem", () => {
  test("the owner changes a title and the field is locked", async () => {
    const { ownerPerson, track } = await setup();
    const before = row(track.id);
    const result = editMediaItem(ownerPerson, "music", { id: track.id, title: "New name" });
    expect(result).toMatchObject({ ok: true, value: { id: track.id, title: "New name" } });
    const after = row(track.id);
    expect(after.title).toBe("New name");
    expect(JSON.parse(after.lockedFields!)).toContain("title");
    expect(after.provenance).toBe("hub:edit");
    expect(after.hlc > before.hlc).toBe(true);
  });

  test("a teen and a child get 403", async () => {
    const { teen, child, track } = await setup();
    for (const person of [teen, child]) expect(editMediaItem(person, "music", { id: track.id, title: "X" })).toEqual({ ok: false, status: 403, error: "You can't edit this." });
    expect(row(track.id).title).toBe(track.title);
  });

  test("an adult who cannot read the item gets 404", async () => {
    const { adult, track, sourceId } = await setup();
    db.update(mediaSources).set({ visibleTo: JSON.stringify([]) }).where(eq(mediaSources.id, sourceId)).run();
    expect(editMediaItem(adult, "music", { id: track.id, title: "X" })).toMatchObject({ ok: false, status: 404 });
    expect(editMediaItem(adult, "music", { id: "media-missing", title: "X" })).toMatchObject({ ok: false, status: 404 });
  });

  test("an artist on a non-track is 400", async () => {
    const { ownerPerson, video } = await setup();
    expect(editMediaItem(ownerPerson, "videos", { id: video.id, artist: "Someone" })).toEqual({ ok: false, status: 400, error: "Only songs have an artist." });
  });

  test("HTML is stripped and whitespace collapsed", async () => {
    const { ownerPerson, track } = await setup();
    const result = editMediaItem(ownerPerson, "music", { id: track.id, title: "  <b>Bold</b>   name  ", description: "<i>Hello</i>\n\n world" });
    expect(result).toMatchObject({ ok: true, value: { title: "Bold name", description: "Hello world" } });
    expect(row(track.id).title).toBe("Bold name");
  });

  test("an over-long or empty title is 400", async () => {
    const { ownerPerson, track } = await setup();
    expect(editMediaItem(ownerPerson, "music", { id: track.id, title: "a".repeat(201) })).toEqual({ ok: false, status: 400, error: "That title is too long." });
    expect(editMediaItem(ownerPerson, "music", { id: track.id, title: "  " })).toEqual({ ok: false, status: 400, error: "A title is needed." });
    expect(editMediaItem(ownerPerson, "music", { id: track.id, description: "a".repeat(4001) })).toEqual({ ok: false, status: 400, error: "That description is too long." });
  });

  test("a description that fails the child check lowers band_ok, and never raises it", async () => {
    const { ownerPerson, track } = await setup();
    db.update(mediaItems).set({ bandOk: "child" }).where(eq(mediaItems.id, track.id)).run();
    expect(editMediaItem(ownerPerson, "music", { id: track.id, description: "Hardcore porn" }).ok).toBe(true);
    expect(row(track.id).bandOk).toBe("adult");
    expect(editMediaItem(ownerPerson, "music", { id: track.id, description: "A calm tune" }).ok).toBe(true);
    expect(row(track.id).bandOk).toBe("adult");
  });

  test("no change writes nothing", async () => {
    const { ownerPerson, track } = await setup();
    const before = row(track.id);
    const result = editMediaItem(ownerPerson, "music", { id: track.id, title: before.title });
    expect(result).toMatchObject({ ok: true, value: { id: track.id, title: before.title } });
    expect(row(track.id)).toEqual(before);
  });

  test("a picture id must be a visible picture", async () => {
    const { ownerPerson, track } = await setup();
    expect(editMediaItem(ownerPerson, "music", { id: track.id, artwork: "file-nothere1" })).toEqual({ ok: false, status: 400, error: "That picture is not available." });
    expect(editMediaItem(ownerPerson, "music", { id: track.id, artwork: null })).toMatchObject({ ok: true });
  });
});
