import { describe, expect, test } from "bun:test";
import { createLikeStore, likeIdOf } from "./musicLike";

const track = { key: "file-1", url: "/a", title: "A" };
const collections = [{ kind: "liked", items: [{ media_id: "media-9" }] }];

describe("like heart", () => {
  test("loads the liked list and reads it by media id, falling back to the key", async () => {
    const store = createLikeStore((async () => collections) as never);
    await store.load();
    expect(store.isLiked("media-9")).toBe(true);
    expect(likeIdOf({ ...track, mediaId: "media-9" })).toBe("media-9");
    expect(likeIdOf(track)).toBe("file-1");
  });
  test("toggle turns the heart at once and posts the new state", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    let during: boolean | undefined;
    const store: ReturnType<typeof createLikeStore> = createLikeStore((async (path: string, init?: RequestInit) => { calls.push({ path, body: JSON.parse(String(init?.body)) }); during = store.isLiked("file-1"); return {}; }) as never);
    expect(await store.toggle(track)).toBe(true);
    expect(during).toBe(true);
    expect(calls[0]).toEqual({ path: "/api/plugins/audio/like", body: { media_id: "file-1", on: true } });
    expect(await store.toggle(track)).toBe(true);
    expect(calls[1]!.body).toEqual({ media_id: "file-1", on: false });
    expect(store.isLiked("file-1")).toBe(false);
  });
  test("a refused like rolls the heart back, and a refused unlike puts it back on", async () => {
    const store = createLikeStore((async () => { throw new Error("no"); }) as never);
    expect(await store.toggle(track)).toBe(false);
    expect(store.isLiked("file-1")).toBe(false);
    const bad = createLikeStore((async (path: string) => { if (path.includes("audio/like")) throw new Error("no"); return collections; }) as never);
    await bad.load();
    expect(await bad.toggle({ ...track, mediaId: "media-9" })).toBe(false);
    expect(bad.isLiked("media-9")).toBe(true);
  });
  test("subscribers hear both the optimistic change and the rollback", async () => {
    const store = createLikeStore((async () => { throw new Error("no"); }) as never);
    let heard = 0;
    store.subscribe(() => { heard++; });
    await store.toggle(track);
    expect(heard).toBe(2);
  });
});
