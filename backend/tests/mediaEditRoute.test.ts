// MEDIA-DETAIL-04c: the edit and cover routes (POST /api/plugins/<app>/actions/edit and /cover) and the item view's can_edit and cover_choices.
import { beforeEach, describe, expect, test } from "bun:test";
import sharp from "sharp";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { scanRoot } from "@/lib/media/scan";
import { buildMediaTree } from "./support/mediaTree";
import { db } from "@/db";
import { mediaItems, people } from "@/db/schema";
import { eq } from "drizzle-orm";
import { storeFile } from "@/lib/attachments";
import type { PersonRow } from "@/types";

beforeEach(() => resetDb());

async function setup() {
  const owner = new TestClient();
  await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const signIn = async (displayName: string, role: string) => {
    const made = await owner.post("/api/people", { displayName, role, secret: "0000" });
    const created = (await made.json()) as { id: string };
    const client = new TestClient();
    await client.post("/api/auth/verify-secret", { personId: created.id, secret: "0000" });
    return client;
  };
  const adult = await signIn("Marlow", "adult");
  const teen = await signIn("Nova", "teen");
  const tree = buildMediaTree();
  const added = await owner.post("/api/media/sources", { label: "music", path: tree.music, kinds: ["track"] });
  await scanRoot(((await added.json()) as { source: { id: string } }).source.id, { prober: null, pruneGraceMs: 0 });
  const track = db.select().from(mediaItems).where(eq(mediaItems.kind, "track")).all()[0]!;
  const ownerPerson = db.select().from(people).where(eq(people.role, "owner")).get() as unknown as PersonRow;
  return { owner, adult, teen, track, ownerPerson };
}

const png = () => sharp({ create: { width: 40, height: 40, channels: 3, background: { r: 200, g: 30, b: 30 } } }).png().toBuffer();
const coverForm = async (id: string, file: File) => { const form = new FormData(); form.append("id", id); form.append("file", file); return form; };

describe("the edit route", () => {
  test("the owner changes a title and gets the fresh item view", async () => {
    const { owner, track } = await setup();
    const response = await owner.post("/api/plugins/music/actions/edit", { id: track.id, title: "Renamed" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: track.id, title: "Renamed", can_edit: true });
    expect(db.select().from(mediaItems).where(eq(mediaItems.id, track.id)).get()!.title).toBe("Renamed");
  });

  test("a teen gets 403 with a plain error", async () => {
    const { teen, track } = await setup();
    const response = await teen.post("/api/plugins/music/actions/edit", { id: track.id, title: "X" });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "You can't edit this." });
  });
});

describe("the cover route", () => {
  test("a non-image is 400, an image returns a file id the edit route accepts", async () => {
    const { owner, track } = await setup();
    const bad = await owner.postForm("/api/plugins/music/actions/cover", await coverForm(track.id, new File(["not a picture"], "x.txt", { type: "text/plain" })));
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "That file is not a supported picture." });
    const good = await owner.postForm("/api/plugins/music/actions/cover", await coverForm(track.id, new File([await png()], "cover.png", { type: "image/png" })));
    expect(good.status).toBe(200);
    const body = (await good.json()) as { file_id: string; url: string; alt: string };
    expect(body.file_id).toMatch(/^file-/);
    expect(body.url).toContain(body.file_id);
    const set = await owner.post("/api/plugins/music/actions/edit", { id: track.id, artwork: body.file_id });
    expect(set.status).toBe(200);
    expect(JSON.parse(db.select().from(mediaItems).where(eq(mediaItems.id, track.id)).get()!.artwork!)).toEqual({ file_id: body.file_id });
  });

  test("a teen is refused and an unknown item is 404", async () => {
    const { owner, teen, track } = await setup();
    const form = async (id: string) => coverForm(id, new File([await png()], "cover.png", { type: "image/png" }));
    expect((await teen.postForm("/api/plugins/music/actions/cover", await form(track.id))).status).toBe(403);
    expect((await owner.postForm("/api/plugins/music/actions/cover", await form("media-missing"))).status).toBe(404);
  });
});

describe("the item view", () => {
  test("can_edit is false for a teen and true for an adult", async () => {
    const { adult, teen, track } = await setup();
    db.update(mediaItems).set({ bandOk: "child", advisoryExplicit: false }).where(eq(mediaItems.id, track.id)).run();
    expect(await (await teen.post("/api/plugins/music/data/item", { id: track.id })).json()).toMatchObject({ can_edit: false, cover_choices: [] });
    expect(await (await adult.post("/api/plugins/music/data/item", { id: track.id })).json()).toMatchObject({ can_edit: true });
  });

  test("cover_choices lists only pictures the person can see", async () => {
    const { owner, adult, track, ownerPerson } = await setup();
    const stored = storeFile(ownerPerson, { conversationId: null, turnId: null, mediaType: "image/png", bytes: new Uint8Array(await png()), provenance: "library:upload", retention: "kept", name: "Mine" });
    if (!stored.ok) throw new Error(stored.error);
    const mine = (await (await owner.post("/api/plugins/music/data/item", { id: track.id })).json()) as { cover_choices: Array<{ file_id: string; alt: string }> };
    expect(mine.cover_choices.map((choice) => choice.file_id)).toEqual([stored.value.id]);
    expect(mine.cover_choices[0]!.alt).toBe("Mine");
    const theirs = (await (await adult.post("/api/plugins/music/data/item", { id: track.id })).json()) as { cover_choices: unknown[] };
    expect(theirs.cover_choices).toEqual([]);
  });
});
