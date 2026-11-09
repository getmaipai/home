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
  test("home shelves carry the byline and a two-action card menu; made-at-home stays plain", () => {
    const shelves = pageOf("index").body.filter((n: { type: string }) => n.type === "media_shelf");
    for (const shelf of shelves) {
      if (shelf.bind.path === "made-at-home") { expect(shelf.row_actions).toBeUndefined(); continue; }
      expect(shelf.item_subtitle_field).toBe("{byline}");
      expect(shelf.row_actions.map((a: { label: string }) => a.label)).toEqual(["Watch later", "Like"]);
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
