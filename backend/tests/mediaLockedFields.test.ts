// MEDIA-DETAIL-04a: an edited field is locked, so a rescan never overwrites it.
import { beforeEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { mediaItems, people } from "@/db/schema";
import { createRootSource, type RootKind } from "@/lib/media/sources";
import { scanRoot } from "@/lib/media/scan";
import { itemFromRow } from "@/lib/media/model";
import { resetDb } from "./reset-db";
import { buildMediaTree } from "./support/mediaTree";
import type { PersonRow } from "@/types";

let admin: PersonRow;

beforeEach(() => {
  resetDb();
  const now = new Date().toISOString();
  db.insert(people).values({ id: "person-admin0001", displayName: "Sage", role: "owner", avatarSeed: "s", source: "local", createdAt: now, updatedAt: now, hlc: "1:0:aaaaaa" }).run();
  admin = db.select().from(people).where(eq(people.id, "person-admin0001")).get() as unknown as PersonRow;
});

function addRoot(path: string, kinds: RootKind[]) {
  const result = createRootSource(admin, { label: path.split("/").pop()!, path, kinds });
  if (!result.ok) throw new Error(result.error);
  return result.source;
}

const noProber = { prober: null, pruneGraceMs: 0 } as const;
const rowAt = (path: string) => db.select().from(mediaItems).all().find((row) => row.locPath === path)!;

const FILM = "Moon Rivets (2021).mp4";
const TRACK = "The Marlows/Tempo/01 Morning Light.mp3";

async function filmRoot() {
  const tree = buildMediaTree();
  const root = addRoot(tree.films, ["film"]);
  await scanRoot(root.id, noProber);
  return { tree, root };
}

describe("locked fields survive a rescan", () => {
  test("a locked title stays edited while an unlocked field is rescanned", async () => {
    const { tree, root } = await filmRoot();
    const id = rowAt(FILM).id;
    db.update(mediaItems).set({ title: "My own title", genre: "Stale", lockedFields: JSON.stringify(["title"]) }).where(eq(mediaItems.id, id)).run();
    writeFileSync(join(tree.films, "Moon Rivets (2021).nfo"), "<movie><title>NFO changed</title><year>2021</year><plot>A new plot.</plot><genre>Family</genre></movie>");
    writeFileSync(join(tree.films, FILM), "a longer film file");
    await scanRoot(root.id, noProber);
    const item = itemFromRow(rowAt(FILM));
    expect(item.title).toBe("My own title");
    expect(item.genre).toBe("Family");
    expect(item.description).toBe("A new plot.");
    expect(item.locked_fields).toEqual(["title"]);
  });

  test("locked artist and description stay edited", async () => {
    const { tree, root } = await filmRoot();
    const film = rowAt(FILM);
    db.update(mediaItems).set({ description: "My description", artist: "My artist", title: "Stale title", lockedFields: JSON.stringify(["artist", "description"]) }).where(eq(mediaItems.id, film.id)).run();
    writeFileSync(join(tree.films, FILM), "a longer film file");
    await scanRoot(root.id, noProber);
    const item = itemFromRow(rowAt(FILM));
    expect(item.description).toBe("My description");
    expect(item.artist).toBe("My artist");
    expect(item.title).toBe("Moon Rivets");
    expect(item.locked_fields).toEqual(["artist", "description"]);
  });

  test("a locked artwork keeps the stored artwork, an unlocked one is rescanned", async () => {
    const { tree, root } = await filmRoot();
    const id = rowAt(FILM).id;
    db.update(mediaItems).set({ artwork: JSON.stringify({ path: "custom/mine.jpg" }), lockedFields: JSON.stringify(["artwork"]) }).where(eq(mediaItems.id, id)).run();
    writeFileSync(join(tree.films, FILM), "a longer film file");
    await scanRoot(root.id, noProber);
    expect(itemFromRow(rowAt(FILM)).artwork).toMatchObject({ path: "custom/mine.jpg" });
    db.update(mediaItems).set({ lockedFields: null }).where(eq(mediaItems.id, id)).run();
    writeFileSync(join(tree.films, FILM), "an even longer film file");
    await scanRoot(root.id, noProber);
    expect(itemFromRow(rowAt(FILM)).artwork).toMatchObject({ path: "Moon Rivets (2021).jpg" });
  });

  test("a locked track artist survives a rescan of the tags", async () => {
    const tree = buildMediaTree();
    const root = addRoot(tree.music, ["track"]);
    await scanRoot(root.id, noProber);
    const id = rowAt(TRACK).id;
    db.update(mediaItems).set({ artist: "Edited artist", album: "Stale album", lockedFields: JSON.stringify(["artist"]) }).where(eq(mediaItems.id, id)).run();
    await scanRoot(root.id, { ...noProber, force: true });
    const item = itemFromRow(rowAt(TRACK));
    expect(item.artist).toBe("Edited artist");
    expect(item.album).toBe("Tempo");
  });

  test("with an empty list everything updates as before", async () => {
    const { tree, root } = await filmRoot();
    const id = rowAt(FILM).id;
    db.update(mediaItems).set({ title: "Edited", description: "Edited", lockedFields: JSON.stringify([]) }).where(eq(mediaItems.id, id)).run();
    writeFileSync(join(tree.films, FILM), "a longer film file");
    await scanRoot(root.id, noProber);
    const item = itemFromRow(rowAt(FILM));
    expect(item.title).toBe("Moon Rivets");
    expect(item.description).toBe("A small robot repairs the moon.");
    expect(item.locked_fields).toEqual([]);
  });
});
