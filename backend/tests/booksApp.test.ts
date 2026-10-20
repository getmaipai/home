// MEDIA-BOOKS-01: the Books app over HTTP through the shared media-app host: the reading locators (EPUB CFI, PDF page) round-trip
// through progress, an m4b lists its chapters and resumes mid-chapter, a folder audiobook plays its parts in order, the book and
// the audiobook link, and a child or a guest sees only what the rules allow.
import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { mediaItems, mediaSources } from "@/db/schema";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { scanRoot } from "@/lib/media/scan";
import { __resetProgressForTests, flushProgress } from "@/lib/media/progress";
import { buildMediaTree } from "./support/mediaTree";

beforeEach(() => {
  resetDb();
  __resetProgressForTests();
});

type Row = { id: string; title: string; channel: string | null; kind: string; progress?: number; completed?: boolean; position_s?: number; index?: number; action_label?: string; thumbnail: string | null };
type View = Row & { src: string; format?: string; locator?: { kind: string; cfi?: string; page?: number }; position_s?: number; parent_id?: string; linked?: Row[]; chapters: Array<{ start_s: number; title: string }>; up_next?: { id: string } };

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
  const added = await owner.post("/api/media/sources", { label: "reading", path: tree.reading, kinds: ["book", "audiobook"] });
  const sourceId = ((await added.json()) as { source: { id: string } }).source.id;
  await scanRoot(sourceId, { prober: null, pruneGraceMs: 0 });
  const rows = async (client: TestClient, id: string, body: Record<string, unknown> = {}) => (await client.post(`/api/plugins/books/data/${id}`, body)).json() as Promise<Row[]>;
  const view = async (client: TestClient, id: string) => (await client.post("/api/plugins/books/data/item", { id })).json() as Promise<View>;
  const idOf = async (title: string, kind: string) => (await rows(adult.client, kind === "book" ? "books" : "audiobooks")).find((row) => row.title === title)!.id;
  const save = (client: TestClient, body: Record<string, unknown>) => client.post("/api/plugins/books/progress", body);
  return { owner, adult, child, rows, view, idOf, save, sourceId };
}

const CFI = { kind: "cfi", cfi: "epubcfi(/6/4!/4/2/1:120)", spine_index: 1, block_index: 3 };

describe("books: the reading locators", () => {
  test("an EPUB's CFI locator round-trips through progress and comes back on the item and in continue reading", async () => {
    const { adult, rows, view, idOf, save } = await setup();
    const id = await idOf("The Clockwork Garden", "book");
    const first = await view(adult.client, id);
    expect(first).toMatchObject({ format: "epub", src: `/api/media/items/${id}/content` });
    expect(first.locator).toBeUndefined();
    const saved = await save(adult.client, { media_id: id, locator: CFI, percent: "42.5", reason: "pause" });
    expect(saved.status).toBe(200);
    flushProgress();
    const again = await view(adult.client, id);
    expect(again.locator).toMatchObject({ kind: "cfi", cfi: CFI.cfi, spine_index: 1, block_index: 3 });
    expect((await rows(adult.client, "continue-reading")).map((row) => row.id)).toEqual([id]);
    expect((await rows(adult.client, "continue-reading"))[0]!.progress).toBeCloseTo(0.43, 1);
  });

  test("a PDF saves a page locator, and a locator of the wrong kind or a bad percent is refused with a next step", async () => {
    const { adult, view, idOf, save } = await setup();
    const id = await idOf("Moon Rivets Field Guide", "book");
    expect((await view(adult.client, id)).format).toBe("pdf");
    expect((await save(adult.client, { media_id: id, locator: { kind: "page", page: 2 }, percent: 50, reason: "pause" })).status).toBe(200);
    flushProgress();
    expect((await view(adult.client, id)).locator).toMatchObject({ kind: "page", page: 2 });
    for (const bad of [{ locator: CFI, percent: 10 }, { locator: { kind: "page", page: 0 }, percent: 10 }, { locator: { kind: "page", page: 2 }, percent: 140 }, { percent: 10 }]) {
      const refused = await save(adult.client, { media_id: id, reason: "pause", ...bad });
      expect(refused.status).toBe(400);
      expect(((await refused.json()) as { error: string }).error).toContain("turn the page again");
    }
    const epub = await idOf("The Clockwork Garden", "book");
    expect((await save(adult.client, { media_id: epub, locator: { kind: "page", page: 1 }, percent: 1 })).status).toBe(400);
  });
});

describe("books: audiobooks", () => {
  test("an m4b lists its chapters and resumes mid-chapter", async () => {
    const { adult, rows, view, idOf, save } = await setup();
    const id = await idOf("The Clockwork Garden", "audiobook");
    const first = await view(adult.client, id);
    expect(first.chapters.length).toBeGreaterThan(1);
    expect((await rows(adult.client, "chapters", { id })).map((row) => row.title)).toEqual(first.chapters.map((chapter) => chapter.title));
    const middle = first.chapters[1]!.start_s + 0.4;
    expect((await save(adult.client, { media_id: id, position_s: String(middle), duration_s: "9", reason: "pause" })).status).toBe(200);
    flushProgress();
    const again = await view(adult.client, id);
    expect(again.position_s).toBeCloseTo(middle, 1);
    expect((await rows(adult.client, "continue-listening")).map((row) => row.id)).toEqual([id]);
    // The chapter rows show where the person is: the first is done, the second is part way, the third has not started.
    const after = await rows(adult.client, "chapters", { id });
    expect(after[0]).toMatchObject({ completed: true, position_s: 0, index: 1 });
    expect(after[1]!.progress).toBeGreaterThan(0);
    expect(after[1]!.progress).toBeLessThan(0.2);
    expect(after[1]!.position_s).toBe(first.chapters[1]!.start_s);
    expect(after[2]!.progress).toBeUndefined();
    expect(after[2]!.completed).toBeUndefined();
  });

  test("a folder audiobook plays its parts in order, resumes the part in progress and moves on after a finished part", async () => {
    const { adult, rows, view, idOf, save } = await setup();
    const id = await idOf("Moon Rivets", "audiobook");
    const parts = await rows(adult.client, "chapters", { id });
    expect(parts.map((row) => row.title)).toEqual(["Part 1", "Part 2", "Part 3"]);
    const first = await view(adult.client, id);
    expect(first).toMatchObject({ id: parts[0]!.id, parent_id: id, title: "Moon Rivets" });
    expect(first.up_next?.id).toBe(parts[1]!.id);
    await save(adult.client, { media_id: parts[0]!.id, position_s: "2", duration_s: "2", reason: "ended" });
    flushProgress();
    expect((await view(adult.client, id)).id).toBe(parts[1]!.id);
    await save(adult.client, { media_id: parts[1]!.id, position_s: "0.5", duration_s: "2", reason: "pause" });
    flushProgress();
    const resumed = await view(adult.client, id);
    expect(resumed).toMatchObject({ id: parts[1]!.id, position_s: 0.5 });
    // A part opened by its own id still answers, with the book's title and the next part.
    expect(await view(adult.client, parts[2]!.id)).toMatchObject({ parent_id: id, title: "Moon Rivets" });
    expect((await rows(adult.client, "continue-listening")).map((row) => row.id)).toEqual([id]);
  });

  test("the book and the audiobook of one title link both ways, and a part is not a shelf row", async () => {
    const { adult, rows, view, idOf } = await setup();
    const book = await idOf("The Clockwork Garden", "book");
    const audio = await idOf("The Clockwork Garden", "audiobook");
    expect((await view(adult.client, book)).linked?.map((row) => row.id)).toEqual([audio]);
    expect((await view(adult.client, audio)).linked?.map((row) => row.id)).toEqual([book]);
    expect((await rows(adult.client, "linked-editions", { id: book })).map((row) => row.id)).toEqual([audio]);
    const shelf = [...(await rows(adult.client, "books")), ...(await rows(adult.client, "audiobooks"))];
    expect(shelf.some((row) => row.kind === "chapter")).toBe(false);
    expect(shelf.find((row) => row.id === book)).toMatchObject({ action_label: "Read" });
    expect(shelf.find((row) => row.id === audio)).toMatchObject({ action_label: "Listen" });
  });
});

describe("books: a child and a guest", () => {
  test("a child sees only band_ok child items, no discovery rows, and cannot read or save an adult one", async () => {
    const { owner, adult, child, rows, idOf, save } = await setup();
    const guide = await idOf("Moon Rivets Field Guide", "book");
    expect((await owner.request(`/api/media/items/${guide}`, { method: "PATCH", body: { band_ok: "adult" } })).status).toBe(200);
    for (const id of ["featured", "new", "recent", "more-from"]) expect(await rows(child.client, id)).toEqual([]);
    const childBooks = (await rows(child.client, "books")).map((row) => row.title);
    expect(childBooks).not.toContain("Moon Rivets Field Guide");
    expect((await rows(adult.client, "books")).map((row) => row.title)).toContain("Moon Rivets Field Guide");
    expect(await rows(child.client, "item", { id: guide })).toEqual([]);
    expect((await save(child.client, { media_id: guide, locator: { kind: "page", page: 1 }, percent: 3 })).status).toBe(404);
  });

  test("the allowlist: a child sees nothing from a source that is not a household root unless an adult named them, parts included", async () => {
    const { adult, child, rows, view, idOf, sourceId } = await setup();
    const audio = await idOf("Moon Rivets", "audiobook");
    const parts = await rows(adult.client, "chapters", { id: audio });
    expect((await rows(child.client, "audiobooks")).map((row) => row.id)).toContain(audio);
    const now = new Date().toISOString();
    db.insert(mediaSources).values({ id: "msrc-link00000001", kind: "link", scope: "household", ownerPersonId: null, label: "Link", rootPath: null, rootKinds: null, url: "https://example.com/feed", visibleTo: JSON.stringify("household"), createdAt: now, hlc: "1:0:aaaaaa", provenance: "test" }).run();
    db.update(mediaItems).set({ sourceId: "msrc-link00000001" }).where(eq(mediaItems.sourceId, sourceId)).run();
    expect(await rows(child.client, "audiobooks")).toEqual([]);
    expect(await rows(child.client, "chapters", { id: audio })).toEqual([]);
    expect(await rows(child.client, "item", { id: parts[0]!.id })).toEqual([]);
    expect((await rows(adult.client, "audiobooks")).map((row) => row.id)).toContain(audio);
    db.update(mediaSources).set({ visibleTo: JSON.stringify([child.id]) }).where(eq(mediaSources.id, "msrc-link00000001")).run();
    expect((await rows(child.client, "audiobooks")).map((row) => row.id)).toContain(audio);
    expect((await view(child.client, audio)).id).toBe(parts[0]!.id);
  });

  test("a guest (nobody signed in) gets nothing", async () => {
    await setup();
    const guest = new TestClient();
    for (const id of ["books", "audiobooks", "item", "chapters", "continue-reading"]) expect((await guest.post(`/api/plugins/books/data/${id}`, {})).status).toBe(401);
    expect((await guest.post("/api/plugins/books/progress", { media_id: "media-nothing0001", locator: { kind: "page", page: 1 }, percent: 1 })).status).toBe(401);
  });
});
