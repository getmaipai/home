// ACTIVITY-RECHECK-01: every finished picture, clip and song in the Activity list carries a thumbnail URL that the real thumb route
// answers with an image, using real stored files (the earlier test only compared URL strings against one-byte stand-in files).
import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { musicJobs, people, pictureJobs, videoJobs } from "@/db/schema";
import { activityForViewer } from "@/lib/activity";
import { storeFile } from "@/lib/attachments";
import { TestClient } from "./client";
import { testPng } from "./pictureFixture";
import { resetDb } from "./reset-db";

beforeEach(() => resetDb());
const now = () => new Date().toISOString();

describe("ACTIVITY-RECHECK-01: real thumbnails", () => {
  test("a done picture, clip and song with a cover each point at a thumb URL that returns an image", async () => {
    const client = new TestClient();
    await client.post("/api/auth/setup", { displayName: "Sage", secret: "correct horse battery staple" });
    const sage = db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
    const png = await testPng();
    const store = (mediaType: string, bytes: Uint8Array, provenance: string) => {
      const out = storeFile(sage, { conversationId: null, turnId: null, mediaType, bytes, provenance, deduplicate: false });
      if (!out.ok) throw new Error(out.error);
      return out.value.id;
    };
    const pic = store("image/png", png, "picture-gen");
    const poster = store("image/png", png, "video-poster");
    const clip = store("video/mp4", new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]), "video-gen");
    const cover = store("image/png", png, "picture-gen");
    const audio = store("audio/mpeg", new Uint8Array([73, 68, 51, 4, 0, 0, 0, 0]), "music-gen");
    db.insert(pictureJobs).values({ id: "p1", personId: sage.id, kind: "generate", state: "done", percent: 100, phase: null, prompt: "A fox", request: JSON.stringify({ size: "1024x1024", n: 1, seed: null, loras: [], source_file_id: null, audience: "all-ages" }), files: JSON.stringify([{ id: pic, width: 1, height: 1, seed: null, model: null, steps: null, ms: null }]), createdAt: now(), updatedAt: now(), hlc: "h" }).run();
    db.insert(videoJobs).values({ id: "v1", personId: sage.id, kind: "generate", state: "done", percent: 100, phase: null, prompt: "A lantern", request: JSON.stringify({ size: "832x480", seconds: 5, audience: "all-ages" }), files: JSON.stringify([{ id: clip, poster_id: poster, seconds: 5, width: 832, height: 480, audio: false }]), createdAt: now(), updatedAt: now(), hlc: "h" }).run();
    db.insert(musicJobs).values({ id: "s1", personId: sage.id, task: "text2music", request: JSON.stringify({ title: "Rainy porch song", description: "Rainy porch song", instrumental: false, seconds: 60 }), state: "done", progress: 1, fileId: audio, coverFileId: cover, durationS: 60, createdAt: now(), updatedAt: now(), hlc: "h" } as never).run();

    const byId = new Map(activityForViewer(sage).items.map((item) => [item.id, item]));
    for (const id of ["picture:p1", "video:v1", "song:s1"]) {
      const url = byId.get(id)?.thumbnailUrl;
      expect(url, `${id} has a thumbnail URL`).toBeTruthy();
      const res = await client.get(url!);
      expect(res.status, `${id} thumb answers`).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/webp");
    }
  });

  test("a song with no cover has no thumbnail URL", async () => {
    const client = new TestClient();
    await client.post("/api/auth/setup", { displayName: "Sage", secret: "correct horse battery staple" });
    const sage = db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
    const out = storeFile(sage, { conversationId: null, turnId: null, mediaType: "audio/mpeg", bytes: new Uint8Array([73, 68, 51, 4]), provenance: "music-gen", deduplicate: false });
    if (!out.ok) throw new Error(out.error);
    db.insert(musicJobs).values({ id: "s2", personId: sage.id, task: "text2music", request: JSON.stringify({ title: "Quiet", description: "Quiet", instrumental: true, seconds: 30 }), state: "done", progress: 1, fileId: out.value.id, durationS: 30, createdAt: now(), updatedAt: now(), hlc: "h" } as never).run();
    expect(activityForViewer(sage).items.find((item) => item.id === "song:s2")?.thumbnailUrl ?? null).toBeNull();
  });
});
