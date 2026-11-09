// VIDEOS-PARITY (2026-11-09): the YouTube-like pieces that need no new spec or kit tag: the "Channel, age" line, chapters for clips made by joining, the Liked
// videos page and the clip-ready notice. Everything reads the household's own library and jobs; nothing is fetched.
import { beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { db } from "@/db";
import { notificationDeliveries } from "@/db/schema";
import { ageLabel, withVideoByline } from "@/lib/media/videoByline";
import { chaptersForMadeClip } from "@/lib/videos/chapters";
import { notifyClipReady } from "@/lib/videos/clipNotice";
import { __resetVideoJobsForTests, __setVideoJobForTests, type VideoJob } from "@/lib/videos/jobs";
import { registerPackageNotificationTypes } from "@/lib/notificationTypes";
import { owner } from "./support/testAuth";
import { resetDb } from "./reset-db";
import type { PersonRow } from "@/types";

const pkg = join(import.meta.dir, "..", "packages", "videos");
const manifest = JSON.parse(readFileSync(join(pkg, "manifest.json"), "utf8"));

beforeEach(async () => { await resetDb(); __resetVideoJobsForTests(); });

function job(id: string, personId: string, over: Partial<VideoJob> & { seconds?: number; edit?: NonNullable<VideoJob["request"]["edit"]> } = {}): VideoJob {
  const { seconds = 5, edit, ...rest } = over;
  return {
    id, personId, conversationId: null, turnId: null, companionId: null, kind: edit ? "edit" : "generate", state: "done", stackJob: null, percent: 100, phase: "ready", position: null,
    prompt: `Prompt for ${id}`, request: { size: "1280x720", seconds, seed: null, loras: [], source_file_id: null, audience: "all-ages", ...(edit ? { edit } : {}) },
    error: null, files: [{ id: `file-${id}`, poster_id: `poster-${id}`, width: 1280, height: 720, seconds, seed: null, model: null, ms: null, bytes: 10 }],
    temporary: false, createdAt: "2026-11-09T10:00:00Z", updatedAt: "2026-11-09T10:00:00Z", ...rest,
  };
}

describe("the Channel, age line", () => {
  const now = new Date("2026-11-09T12:00:00Z");
  test("says how long ago in plain words", () => {
    expect(ageLabel("2026-11-09T01:00:00Z", now)).toBe("Today");
    expect(ageLabel("2026-11-08T01:00:00Z", now)).toBe("Yesterday");
    expect(ageLabel("2026-11-04T12:00:00Z", now)).toBe("5 days ago");
    expect(ageLabel("2026-10-19T12:00:00Z", now)).toBe("3 weeks ago");
    expect(ageLabel("2026-06-09T12:00:00Z", now)).toBe("5 months ago");
    expect(ageLabel("2024-11-09T12:00:00Z", now)).toBe("2 years ago");
    expect(ageLabel("not a date", now)).toBe("");
  });
  test("a row with no library record keeps just its channel; other answers pass through", () => {
    expect(withVideoByline<unknown>([{ id: "file-x", title: "Clip", channel: "Made at home" }], now)).toEqual([{ id: "file-x", title: "Clip", channel: "Made at home", byline: "Made at home" }]);
    expect(withVideoByline([], now)).toEqual([]);
    const view = { id: "a" };
    expect(withVideoByline(view, now)).toBe(view);
  });
});

describe("chapters for a clip made by joining", () => {
  test("each source clip is one chapter, at its cut", async () => {
    const { row } = await owner();
    __setVideoJobForTests(job("a", row.id, { seconds: 4 }));
    __setVideoJobForTests(job("b", row.id, { seconds: 6 }));
    __setVideoJobForTests(job("c", row.id, { seconds: 5 }));
    __setVideoJobForTests(job("joined", row.id, { seconds: 15, edit: { from: "a", change: "join", with: ["b", "c"] } }));
    expect(chaptersForMadeClip(row, "file-joined")).toEqual([{ start_s: 0, title: "Prompt for a" }, { start_s: 4, title: "Prompt for b" }, { start_s: 10, title: "Prompt for c" }]);
  });
  test("a plain clip, a missing source, or cuts that moved give no chapters", async () => {
    const { row } = await owner();
    __setVideoJobForTests(job("a", row.id, { seconds: 4 }));
    __setVideoJobForTests(job("b", row.id, { seconds: 6 }));
    __setVideoJobForTests(job("lost", row.id, { seconds: 9, edit: { from: "a", change: "join", with: ["gone"] } }));
    __setVideoJobForTests(job("short", row.id, { seconds: 6, edit: { from: "a", change: "join", with: ["b"] } }));
    expect(chaptersForMadeClip(row, "file-a")).toEqual([]);
    expect(chaptersForMadeClip(row, "file-lost")).toEqual([]);
    expect(chaptersForMadeClip(row, "file-short")).toEqual([]);
  });
  test("another person's clip is never read", async () => {
    const { row } = await owner();
    __setVideoJobForTests(job("a", "someone-else", { seconds: 4 }));
    __setVideoJobForTests(job("b", "someone-else", { seconds: 6 }));
    __setVideoJobForTests(job("joined", "someone-else", { seconds: 10, edit: { from: "a", change: "join", with: ["b"] } }));
    expect(chaptersForMadeClip(row as PersonRow, "file-joined")).toEqual([]);
  });
});

describe("the clip-ready notice", () => {
  test("a finished Create clip tells its maker once; a chat clip does not", async () => {
    const { row } = await owner();
    registerPackageNotificationTypes({ id: "videos", notifications: manifest.notifications });
    const made = job("made", row.id, { prompt: "A fox in the snow" });
    await notifyClipReady(made, row);
    await notifyClipReady(made, row);
    await notifyClipReady(job("chat", row.id, { conversationId: "conv-1" }), row);
    await notifyClipReady(job("running", row.id, { state: "running", files: [] }), row);
    const sent = db.select().from(notificationDeliveries).all().filter((item) => item.typeId === "videos.clip_ready");
    expect(sent.map((item) => item.repeatKey)).toEqual(["made"]);
    expect(sent[0]!.text).toBe("Your video is ready: A fox in the snow");
  });
});

describe("the package documents", () => {
  const pageOf = (id: string) => JSON.parse(readFileSync(join(pkg, "pages", `${id}.json`), "utf8"));
  test("Liked videos is a page, a sidebar entry and a data id, within the 16-id cap", () => {
    expect(manifest.contributes.pages.map((p: { id: string }) => p.id)).toContain("liked");
    expect(manifest.contributes.sidebar.groups[0].pages).toContain("liked");
    expect(manifest.contributes.data.map((d: { id: string }) => d.id)).toContain("liked");
    expect(manifest.contributes.data.length).toBeLessThanOrEqual(16);
    expect(pageOf("liked").body[0].bind.path).toBe("liked");
  });
  test("home shelves carry the byline and a card menu of Watch later, Like and Share; made-at-home stays plain", () => {
    const shelves = pageOf("index").body.filter((n: { type: string }) => n.type === "media_shelf");
    for (const shelf of shelves) {
      if (shelf.bind.path === "made-at-home") { expect(shelf.row_actions).toBeUndefined(); continue; }
      expect(shelf.item_subtitle_field).toBe("{byline}");
      expect(shelf.row_actions.map((a: { label: string }) => a.label)).toEqual(["Watch later", "Like", "Share"]);
    }
  });
  test("the watch page lists chapters", () => {
    const player = pageOf("watch").body[0].main[0];
    expect(player.details_show).toContain("chapters");
  });
});

describe("clip ready notice never names a locked clip", () => {
  test("an adult-only clip with the lock on is announced as just a video", async () => {
    const calls: unknown[] = [];
    const mod = await import("@/lib/notifications");
    const original = mod.trigger;
    // The notice calls trigger(type, { title }, ...): read the title it would send through the real function's input by spying.
    const spy = (await import("bun:test")).spyOn(mod, "trigger").mockImplementation((async (...args: unknown[]) => { calls.push(args); return undefined; }) as never);
    try {
      await notifyClipReady({ conversationId: null, temporary: false, state: "done", files: [{ id: "none" }], prompt: "secret adult words", personId: "p1", request: { adultOnly: true } } as never, { id: "p1" } as never);
      expect(JSON.stringify(calls)).not.toContain("secret adult words");
      expect(JSON.stringify(calls)).toContain("Your video");
    } finally { spy.mockRestore(); void original; }
  });
});

describe("apps parity: chips, sort and search filters", () => {
  const pageOf = (id: string) => JSON.parse(readFileSync(join(pkg, "pages", `${id}.json`), "utf8"));
  async function library() {
    const { client } = await owner();
    const { buildMediaTree } = await import("./support/mediaTree");
    const { scanRoot } = await import("@/lib/media/scan");
    const added = await client.post("/api/media/sources", { label: "videos", path: buildMediaTree().videos, kinds: ["video"] });
    await scanRoot(((await added.json()) as { source: { id: string } }).source.id, { prober: null, pruneGraceMs: 0 });
    const ask = async (id: string, body: Record<string, unknown> = {}) => (await (await client.post(`/api/plugins/videos/data/${id}`, body)).json()) as Array<Record<string, any>>;
    const rows = await ask("library");
    const { mediaItems } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const setLength = (title: string, seconds: number) => db.update(mediaItems).set({ durationS: seconds }).where(eq(mediaItems.title, title)).run();
    return { client, ask, rows, setLength };
  }

  test("Short and Long split the library by length; Unwatched drops what was started", async () => {
    const { client, ask, rows, setLength } = await library();
    const names = rows.map((row) => row.title as string);
    expect(names.length).toBeGreaterThanOrEqual(3);
    setLength(names[0]!, 120); setLength(names[1]!, 1500);
    expect((await ask("library", { filter: "short" })).map((row) => row.title)).toEqual([names[0]]);
    expect((await ask("library", { filter: "long" })).map((row) => row.title)).toEqual([names[1]]);
    const started = rows.find((row) => row.title === names[2])!;
    await client.post("/api/plugins/videos/progress", { media_id: started.id, position_s: 5, duration_s: 100 });
    const unwatched = (await ask("library", { filter: "unwatched" })).map((row) => row.title);
    expect(unwatched).not.toContain(names[2]);
    expect(unwatched.length).toBe(names.length - 1);
  });

  test("a channel narrows every shelf, the library sorts Recents or A to Z, and a bad chip changes nothing", async () => {
    const { ask, rows } = await library();
    const channel = rows[0]!.channel as string;
    const only = await ask("library", { channel });
    expect(only.length).toBeGreaterThan(0);
    expect(only.every((row) => row.channel === channel)).toBe(true);
    expect((await ask("recent", { channel })).every((row) => row.channel === channel)).toBe(true);
    const az = (await ask("library", { sort: "a-z" })).map((row) => row.title as string);
    expect(az).toEqual([...az].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })));
    expect((await ask("library", { sort: "recents" })).length).toBe(rows.length);
    expect((await ask("library", { filter: "nonsense" })).length).toBe(rows.length);
  });

  test("Made at home empties the saved shelves and a date chip keeps only what is recent", async () => {
    const { ask, rows } = await library();
    expect(await ask("continue", { filter: "made" })).toEqual([]);
    expect(await ask("library", { filter: "made" })).toEqual([]);
    // Just scanned, so everything counts as this week and nothing is older.
    expect((await ask("library", { filter: "week" })).length).toBe(rows.length);
    expect((await ask("library", { filter: "today" })).length).toBe(rows.length);
  });

  test("search words and the Type chip: All and Saved find saved videos; Made at home finds only made clips", async () => {
    const { ask, rows } = await library();
    const word = String(rows[0]!.title).split(" ")[0]!;
    const all = await ask("library", { query: word, type: "all" });
    expect(all.map((row) => row.title)).toContain(rows[0]!.title);
    expect((await ask("library", { query: word, type: "saved" })).map((row) => row.title)).toContain(rows[0]!.title);
    expect(await ask("library", { query: word, type: "made" })).toEqual([]);
  });

  test("the pages carry the chips, the sort and the pinned-spec fields", () => {
    const index = pageOf("index").body as Array<Record<string, any>>;
    const chipped = index.filter((node) => node.chips);
    expect(chipped.length).toBe(1);
    expect(chipped[0]!.chips).toMatchObject({ state: "vfilter" });
    expect(chipped[0]!.chips.options.map((option: { label: string }) => option.label)).toEqual(["All", "Made at home", "Unwatched", "Long", "Short"]);
    for (const shelf of index.filter((node) => ["recent", "new", "continue", "again", "more-from"].includes(node.bind?.path))) {
      expect(shelf.bind.params).toMatchObject({ filter: "$state.vfilter", channel: "$state.channel" });
    }
    expect(index.some((node) => node.type === "picker" && node.state === "channel")).toBe(true);
    const lib = (pageOf("library").body as Array<Record<string, any>>).find((node) => node.heading === "Library")!;
    expect(lib.sort.options.map((option: { label: string }) => option.label)).toEqual(["Recents", "A to Z"]);
    expect(lib.bind.params.sort).toBe("$state.sort");
    const search = pageOf("search").body as Array<Record<string, any>>;
    expect(search[0]!.type_chips.options.map((option: { label: string }) => option.label)).toEqual(["All", "Made at home", "Saved"]);
    const results = search.find((node) => node.heading === "Results")!;
    expect(results.chips.options.map((option: { label: string }) => option.label)).toEqual(["Any time", "Today", "This week", "This month", "Short", "Long"]);
    expect(results.bind.params).toMatchObject({ filter: "$state.when", type: "$state.kind" });
  });

  test("the watch page can be shared and turns on picture-in-picture, double tap and long press (the spec default is off)", () => {
    const player = pageOf("watch").body[0].main[0];
    expect(player).toMatchObject({ pip: true, double_tap_seek: true, long_press_speed: true });
    expect(player.actions.map((action: { label: string }) => action.label)).toEqual(["Like", "Watch later", "Share"]);
    expect(player.actions[2].action.share.to).toBe("/apps/videos/watch?id={id}");
  });
});
