import { beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import { db } from "@/db";
import { attachments, mediaItems, mediaSources, musicJobs, people } from "@/db/schema";
import { nextHlc } from "@/lib/hlc";
import { listLibrary } from "@/lib/library";
import { mediaAppData } from "@/lib/media/appHost";
import { __unlockedForTests, __resetAdultLockForTests } from "@/lib/adultLock";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import type { PersonRow } from "@/types";

let client: TestClient, sage: PersonRow, fileId: string, mediaId: string;
beforeEach(async () => {
  resetDb(); __resetAdultLockForTests(); client = new TestClient();
  const setup = await (await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" })).json() as { person: { id: string } };
  sage = db.select().from(people).where(eq(people.id, setup.person.id)).get() as PersonRow;
  const now = new Date().toISOString(); fileId = "file-song00000001"; mediaId = "media-song0000001";
  db.insert(attachments).values({ id: fileId, ownerPersonId: sage.id, conversationId: null, turnId: null, mediaType: "audio/mpeg", size: 8, sha256: createHash("sha256").update("song").digest("hex"), storagePath: `people/${sage.id}/attachments/${fileId}`, provenance: 'music-gen:{"audience":"all-ages","job":"job-song1"}', createdAt: now, hlc: nextHlc() }).run();
  db.insert(musicJobs).values({ id: "job-song1", personId: sage.id, conversationId: null, turnId: null, task: "generate", request: JSON.stringify({ title: "Hidden Moon Song", lyrics: "silver lantern lyric" }), state: "done", progress: 1, fileId, createdAt: now, updatedAt: now, hlc: nextHlc() }).run();
  db.insert(mediaSources).values({ id: "msrc-sage0000001", kind: "root", scope: "person", ownerPersonId: sage.id, label: "Music", createdAt: now, hlc: nextHlc(), provenance: "test" }).run();
  db.insert(mediaItems).values({ id: mediaId, kind: "track", sourceId: "msrc-sage0000001", locFileId: fileId, title: "Hidden Moon Song", artist: "Sage", lyrics: "silver lantern lyric", bandOk: "adult", mediaType: "audio/mpeg", playable: "original", addedAt: now, createdAt: now, hlc: nextHlc(), provenance: "music:generated" }).run();
});

test("a music-gen file lock hides Library, file music metadata, and promoted Music rows until proof; minors never see it", async () => {
  expect((await client.post(`/api/library/files/${fileId}/adult-mark`, { action: "mark" })).status).toBe(200);
  expect(listLibrary(sage, {}).items.map((f) => f.id)).not.toContain(fileId);
  const fileBody = await (await client.get(`/api/files/${fileId}`)).text();
  expect(fileBody).not.toContain("Hidden Moon Song"); expect(fileBody).not.toContain("silver lantern");
  expect(mediaAppData(sage, "audio", "songs", {}) as unknown[]).toHaveLength(0);
  expect(mediaAppData(sage, "audio", "songs", { scope: "item", id: mediaId }) as unknown[]).toHaveLength(0);
  expect(__unlockedForTests(sage.id, () => listLibrary(sage, {}).items.some((f) => f.id === fileId))).toBe(true);
  expect(__unlockedForTests(sage.id, () => mediaAppData(sage, "audio", "songs", {}) as unknown[])).toHaveLength(1);
  const madeChild = await client.post("/api/people", { displayName: "Nova", role: "child", secret: "0000", birthdate: "2018-01-01" });
  const childResult = await madeChild.json() as { id: string };
  const child = db.select().from(people).where(eq(people.id, childResult.id)).get() as PersonRow;
  expect(mediaAppData(child, "audio", "songs", {}) as unknown[]).toHaveLength(0);
});
