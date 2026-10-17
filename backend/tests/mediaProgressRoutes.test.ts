// MEDIA-PROGRESS-01: the progress, collections and Pick up routes over HTTP.
import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { db } from "@/db";
import { mediaCollections, mediaProgress, people } from "@/db/schema";
import { createDevice } from "@/lib/devices";
import { createConversation, logTurn } from "@/lib/conversationHistory";
import { newConversationTurnId } from "@/lib/id";
import { scanRoot } from "@/lib/media/scan";
import { __resetProgressForTests } from "@/lib/media/progress";
import { erasePersonData } from "@/lib/personLifecycle";
import { buildMediaTree } from "./support/mediaTree";
import type { TurnValue } from "@/wire";
import type { PersonRow } from "@/types";

beforeEach(() => {
  resetDb();
  __resetProgressForTests();
});

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
  const adult = await signIn("Marlow", "adult");
  const child = await signIn("Sprout", "child");
  const tree = buildMediaTree();
  for (const [label, path, kinds] of [["films", tree.films, ["film"]], ["music", tree.music, ["track"]], ["reading", tree.reading, ["book", "audiobook"]]] as const) {
    const added = await owner.post("/api/media/sources", { label, path, kinds });
    await scanRoot(((await added.json()) as { source: { id: string } }).source.id, { prober: null, pruneGraceMs: 0 });
  }
  const find = async (client: TestClient, query: string) => ((await (await client.get(`/api/media/items?${query}`)).json()) as { items: Array<{ id: string; title: string }> }).items[0]!.id;
  return { owner, ownerId: person.id, adult, child, find };
}

const put = (client: TestClient, id: string, body: Record<string, unknown>) => client.request(`/api/media/progress/${id}`, { method: "PUT", body: { immediate: true, ...body } });
const pos = (seconds: number) => ({ position: { seconds }, duration_s: 100 });

describe("progress routes", () => {
  test("save, read and read many; a title not started reads as null", async () => {
    const { adult, find } = await setup();
    const film = await find(adult.client, "kind=film&q=moon");
    expect(((await (await adult.client.get(`/api/media/progress/${film}`)).json()) as { progress: unknown }).progress).toBeNull();
    const saved = await put(adult.client, film, { ...pos(40), device_id: null, event: "play" });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ applied: true, progress: { media_id: film, person_id: adult.id, position: { seconds: 40 }, duration_s: 100, completed: false, plays: 1 } });
    expect(((await (await adult.client.get(`/api/media/progress/${film}`)).json()) as { progress: { position: unknown } }).progress.position).toEqual({ seconds: 40 });
    const many = (await (await adult.client.get(`/api/media/progress?ids=${film},media-nothing0001`)).json()) as unknown[];
    expect(many).toHaveLength(1);
    expect((await new TestClient().request(`/api/media/progress/${film}`, { method: "PUT", body: pos(1) })).status).toBe(401);
  });

  test("the flood from one tab is one row; a pause stores at once; a finish latches", async () => {
    const { adult, find } = await setup();
    const film = await find(adult.client, "kind=film&q=moon");
    await put(adult.client, film, pos(1));
    for (let i = 2; i < 30; i++) await adult.client.request(`/api/media/progress/${film}`, { method: "PUT", body: pos(i) });
    expect(db.select().from(mediaProgress).where(eq(mediaProgress.personId, adult.id)).all()).toHaveLength(1);
    expect(((await (await adult.client.get(`/api/media/progress/${film}`)).json()) as { progress: { position: unknown } }).progress.position).toEqual({ seconds: 29 });
    const done = await put(adult.client, film, { position: { seconds: 95 }, duration_s: 100, event: "finish" });
    expect(((await done.json()) as { progress: { completed: boolean; finishes: number } }).progress).toMatchObject({ completed: true, finishes: 1 });
  });

  test("the offline batch merges each write by the same rule; an older place is reported, not applied", async () => {
    const { adult, find } = await setup();
    const film = await find(adult.client, "kind=film&q=moon");
    await put(adult.client, film, pos(70));
    const old = new Date(Date.now() - 3600_000).toISOString();
    const batch = await adult.client.post("/api/media/progress/batch", {
      client_now: new Date().toISOString(),
      writes: [{ media_id: film, ...pos(10), sampled_at: old, counts: { plays: 3 } }, { media_id: "media-nothing0001", ...pos(1) }],
    });
    expect(batch.status).toBe(200);
    const { results } = (await batch.json()) as { results: Array<{ status: string; progress: { position: unknown; plays: number } | null }> };
    expect(results.map((r) => r.status)).toEqual(["older", "unknown_title"]);
    expect(results[0]!.progress).toMatchObject({ position: { seconds: 70 }, plays: 3 });
    // The same batch again changes nothing more.
    const again = (await (await adult.client.post("/api/media/progress/batch", { client_now: new Date().toISOString(), writes: [{ media_id: film, ...pos(10), sampled_at: old, counts: { plays: 3 } }] })).json()) as { results: Array<{ progress: { plays: number } }> };
    expect(again.results[0]!.progress.plays).toBe(3);
  });

  test("a child cannot save a place in a title cleared only for adults, and a parent's device cannot save a child's place", async () => {
    const { adult, child, find } = await setup();
    const explicit = await find(adult.client, "kind=track&q=Loud");
    expect((await put(child.client, explicit, pos(3))).status).toBe(404);
    const film = await find(child.client, "kind=film&q=moon");
    const parentTv = createDevice("tv", "Living room TV", adult.id);
    const refused = await put(child.client, film, { ...pos(3), device_id: parentTv.id });
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as { error: string }).error).toContain("belongs to someone else");
    expect(db.select().from(mediaProgress).where(eq(mediaProgress.personId, child.id)).all()).toHaveLength(0);
    const own = createDevice("browser", "Tablet", child.id);
    expect((await put(child.client, film, { ...pos(3), device_id: own.id })).status).toBe(200);
    // The batch refuses the same way, per write.
    const batch = (await (await child.client.post("/api/media/progress/batch", { writes: [{ media_id: film, ...pos(5), device_id: parentTv.id }] })).json()) as { results: Array<{ status: string }> };
    expect(batch.results[0]!.status).toBe("refused");
    // Nobody can write for another person: the route has no person in it.
    expect((await adult.client.get(`/api/media/progress/${film}`)).status).toBe(200);
    expect(((await (await adult.client.get(`/api/media/progress/${film}`)).json()) as { progress: unknown }).progress).toBeNull();
  });

  test("a book saves a place in the text", async () => {
    const { adult, find } = await setup();
    const book = await find(adult.client, "kind=book&q=Clockwork");
    expect((await put(adult.client, book, pos(5))).status).toBe(422);
    const ok = await put(adult.client, book, { position: { locator: { kind: "cfi", cfi: "epubcfi(/6/4)", spine_index: 1 }, percent: 12 } });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { progress: { position: { percent: number } } }).progress.position.percent).toBe(12);
  });

  test("erasing a person erases their places and collections", async () => {
    const { adult, find } = await setup();
    const film = await find(adult.client, "kind=film&q=moon");
    await put(adult.client, film, pos(5));
    await adult.client.get("/api/media/collections");
    expect(db.select().from(mediaCollections).where(eq(mediaCollections.personId, adult.id)).all()).toHaveLength(3);
    erasePersonData(adult.id, []);
    expect(db.select().from(mediaProgress).where(eq(mediaProgress.personId, adult.id)).all()).toHaveLength(0);
    expect(db.select().from(mediaCollections).where(eq(mediaCollections.personId, adult.id)).all()).toHaveLength(0);
  });
});

describe("collections", () => {
  test("liked, watch later and up next exist for everyone by construction, once", async () => {
    const { adult, child } = await setup();
    for (let i = 0; i < 3; i++) await adult.client.get("/api/media/collections");
    const mine = (await (await adult.client.get("/api/media/collections")).json()) as Array<{ kind: string; person_id: string }>;
    expect(mine.map((c) => c.kind).sort()).toEqual(["liked", "queue", "watch_later"]);
    expect(mine.every((c) => c.person_id === adult.id)).toBe(true);
    expect(((await (await child.client.get("/api/media/collections?kind=liked")).json()) as unknown[]).length).toBe(1);
    expect(db.select().from(mediaCollections).all()).toHaveLength(6);
  });

  test("add, dedupe, order, pointer and remove, by name or by id", async () => {
    const { adult, find } = await setup();
    const [a, b, c] = [await find(adult.client, "kind=film&q=moon"), await find(adult.client, "kind=film&q=garden"), await find(adult.client, "kind=audiobook&q=Clockwork")];
    for (const id of [a, b, c, a]) expect((await adult.client.post("/api/media/collections/queue/items", { media_id: id })).status).toBe(200);
    let queue = (await (await adult.client.get("/api/media/collections/queue")).json()) as { id: string; items: Array<{ media_id: string; position: number }>; pointer: number | null };
    expect(queue.items.map((i) => i.media_id)).toEqual([a, b, c]);
    expect(queue.items.map((i) => i.position)).toEqual([0, 1, 2]);
    const patched = await adult.client.request(`/api/media/collections/${queue.id}`, { method: "PATCH", body: { pointer: 1 } });
    expect(((await patched.json()) as { pointer: number }).pointer).toBe(1);
    // Moving the current title keeps the pointer on it.
    const reordered = (await (await adult.client.request("/api/media/collections/queue/items", { method: "PUT", body: { media_ids: [b, a] } })).json()) as { items: Array<{ media_id: string }>; pointer: number };
    expect(reordered.items.map((i) => i.media_id)).toEqual([b, a, c]);
    expect(reordered.pointer).toBe(0);
    const removed = (await (await adult.client.request(`/api/media/collections/queue/items/${a}`, { method: "DELETE" })).json()) as { items: unknown[]; pointer: number };
    expect(removed.items).toHaveLength(2);
    expect(removed.pointer).toBe(0);
    queue = (await (await adult.client.get(`/api/media/collections/${queue.id}`)).json()) as typeof queue;
    expect(queue.items.map((i) => i.media_id)).toEqual([b, c]);
  });

  test("playlists, watchlists and pins are made and deleted; the three standing ones are not deleted", async () => {
    const { adult, find } = await setup();
    const made = await adult.client.post("/api/media/collections", { kind: "watchlist", title: "Weekend" });
    expect(made.status).toBe(201);
    const list = (await made.json()) as { id: string; kind: string };
    const film = await find(adult.client, "kind=film&q=moon");
    const withFilm = (await (await adult.client.post(`/api/media/collections/${list.id}/items`, { media_id: film })).json()) as { items: Array<{ status: string }> };
    expect(withFilm.items[0]!.status).toBe("want");
    const watching = (await (await adult.client.post(`/api/media/collections/${list.id}/items`, { media_id: film, status: "watching" })).json()) as { items: Array<{ status: string }> };
    expect(watching.items).toHaveLength(1);
    expect(watching.items[0]!.status).toBe("watching");
    expect((await adult.client.request(`/api/media/collections/${list.id}`, { method: "DELETE" })).status).toBe(200);
    expect((await adult.client.get(`/api/media/collections/${list.id}`)).status).toBe(404);
    expect((await adult.client.request("/api/media/collections/liked", { method: "DELETE" })).status).toBe(409);
  });

  test("another person's collection is theirs: not readable, not changeable, until they share it", async () => {
    const { adult, child, find } = await setup();
    const film = await find(adult.client, "kind=film&q=moon");
    const mine = (await (await adult.client.post("/api/media/collections", { kind: "playlist", title: "Family night" })).json()) as { id: string };
    await adult.client.post(`/api/media/collections/${mine.id}/items`, { media_id: film });
    expect((await child.client.get(`/api/media/collections/${mine.id}`)).status).toBe(404);
    expect((await child.client.post(`/api/media/collections/${mine.id}/items`, { media_id: film })).status).toBe(404);
    expect((await child.client.request(`/api/media/collections/${mine.id}`, { method: "DELETE" })).status).toBe(404);
    await adult.client.request(`/api/media/collections/${mine.id}`, { method: "PATCH", body: { shared_to: "household" } });
    const shared = (await (await child.client.get("/api/media/collections/shared")).json()) as Array<{ id: string }>;
    expect(shared.map((c) => c.id)).toEqual([mine.id]);
    expect((await child.client.get(`/api/media/collections/${mine.id}`)).status).toBe(200);
    expect((await child.client.post(`/api/media/collections/${mine.id}/items`, { media_id: film })).status).toBe(404); // still not theirs to change
  });

  test("a child cannot collect a title cleared only for adults, and a shared list shows a child only what a child may see", async () => {
    const { adult, child, find } = await setup();
    const explicit = await find(adult.client, "kind=track&q=Loud");
    const film = await find(adult.client, "kind=film&q=moon");
    expect((await child.client.post("/api/media/collections/liked/items", { media_id: explicit })).status).toBe(404);
    const list = (await (await adult.client.post("/api/media/collections", { kind: "playlist", title: "Mixed" })).json()) as { id: string };
    for (const id of [explicit, film]) await adult.client.post(`/api/media/collections/${list.id}/items`, { media_id: id });
    await adult.client.request(`/api/media/collections/${list.id}`, { method: "PATCH", body: { shared_to: "household" } });
    const seen = (await (await child.client.get(`/api/media/collections/${list.id}`)).json()) as { items: Array<{ media_id: string }> };
    expect(seen.items.map((i) => i.media_id)).toEqual([film]);
  });
});

describe("Pick up where you left off", () => {
  async function chatFor(personId: string, text: string) {
    const person = db.select().from(people).where(eq(people.id, personId)).get() as unknown as PersonRow;
    const created = createConversation(person, { surface: "chat" });
    if (!created.ok) throw new Error("no conversation");
    logTurn(person, "chat", text, { reply: { text: "Sure." }, source: "model", safety: { flagged: false, categories: [], action: "allow", notify_parent: false, checked_at: new Date().toISOString() }, conversation_id: created.value.id, turn_id: newConversationTurnId() } as unknown as TurnValue);
    return created.value.id;
  }
  const rows = async (client: TestClient) => ((await (await client.get("/api/continue")).json()) as { rows: Array<{ kind: string; id: string; title: string; href: string; percent: number | null; media_kind: string | null }> }).rows;

  test("a media row sits beside the chats, newest first, three at most", async () => {
    const { adult, find } = await setup();
    const chat = await chatFor(adult.id, "what is a comet");
    const film = await find(adult.client, "kind=film&q=moon");
    await put(adult.client, film, { position: { seconds: 25 }, duration_s: 100 });
    const shelf = await rows(adult.client);
    expect(shelf.map((r) => [r.kind, r.id])).toEqual([["media", film], ["chat", chat]]);
    expect(shelf[0]).toMatchObject({ title: "Moon Rivets", percent: 25, media_kind: "film", href: `/media/${film}` });
    expect(shelf[1]).toMatchObject({ href: `/chat?conversation=${chat}` });
    for (const text of ["one", "two", "three"]) await chatFor(adult.id, text);
    expect(await rows(adult.client)).toHaveLength(3);
    expect(((await (await adult.client.get("/api/continue?limit=1")).json()) as { rows: unknown[] }).rows).toHaveLength(1);
  });

  test("own rows only: another person's places and chats never show", async () => {
    const { adult, child, find } = await setup();
    const film = await find(adult.client, "kind=film&q=moon");
    await put(adult.client, film, pos(30));
    await chatFor(adult.id, "adult chat");
    expect(await rows(child.client)).toEqual([]);
    await put(child.client, film, pos(10));
    const childShelf = await rows(child.client);
    expect(childShelf.map((r) => r.kind)).toEqual(["media"]);
    expect(childShelf[0]!.percent).toBe(10);
  });

  test("a finished title, a track and a title the person may no longer read are not on the shelf; a folder audiobook's part shows as the book", async () => {
    const { adult, owner, find } = await setup();
    const film = await find(adult.client, "kind=film&q=moon");
    await put(adult.client, film, { position: { seconds: 95 }, duration_s: 100 });
    const track = await find(adult.client, "kind=track&q=Morning");
    await put(adult.client, track, { position: { seconds: 1 }, duration_s: 2 });
    expect(await rows(adult.client)).toEqual([]);
    const book = await find(adult.client, "kind=audiobook&q=Moon");
    const part = ((await (await adult.client.get(`/api/media/items?parent_id=${book}`)).json()) as { items: Array<{ id: string }> }).items[0]!.id;
    await put(adult.client, part, { position: { seconds: 0.5 }, duration_s: 1 });
    expect(await rows(adult.client)).toMatchObject([{ id: book, title: "Moon Rivets", media_kind: "audiobook" }]);
    await owner.request(`/api/media/items/${book}`, { method: "DELETE" });
    expect(await rows(adult.client)).toEqual([]);
  });

  test("a guest has no shelf and a signed-out visitor is refused", async () => {
    const { owner } = await setup();
    const made = await owner.post("/api/people", { displayName: "Visitor", role: "guest", secret: "0000" });
    const guest = new TestClient();
    await guest.post("/api/auth/verify-secret", { personId: ((await made.json()) as { id: string }).id, secret: "0000" });
    expect(await rows(guest)).toEqual([]);
    expect((await new TestClient().get("/api/continue")).status).toBe(401);
  });
});
