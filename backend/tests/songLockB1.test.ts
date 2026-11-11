import { beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import { db } from "@/db";
import { attachments, musicJobs, people } from "@/db/schema";
import { nextHlc } from "@/lib/hlc";
import { __unlockedForTests, __resetAdultLockForTests } from "@/lib/adultLock";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import type { PersonRow } from "@/types";

let client: TestClient, sage: PersonRow, id: string, fileId: string;
beforeEach(async () => {
  resetDb(); __resetAdultLockForTests(); client = new TestClient();
  const setup = await (await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" })).json() as { person: { id: string } };
  sage = db.select().from(people).where(eq(people.id, setup.person.id)).get() as PersonRow;
  const now = new Date().toISOString(); id = "job-song-lock"; fileId = "file-songlock001";
  db.insert(attachments).values({ id: fileId, ownerPersonId: sage.id, conversationId: null, turnId: null, mediaType: "audio/mpeg", size: 8, sha256: createHash("sha256").update("song").digest("hex"), storagePath: `people/${sage.id}/attachments/${fileId}`, provenance: `music-gen:{"audience":"adult-only","lock":"on","job":"${id}"}`, createdAt: now, hlc: nextHlc() }).run();
  db.insert(musicJobs).values({ id, personId: sage.id, conversationId: null, turnId: null, task: "text2music", request: JSON.stringify({ title: "Hidden Moon Song", lyrics: "silver lantern lyric" }), state: "done", progress: 1, fileId, createdAt: now, updatedAt: now, hlc: nextHlc() }).run();
});

test("locked music routes reveal only a lock card, refuse starts, and recover with proof", async () => {
  const card = await client.get(`/api/music/jobs/${id}`);
  expect(card.status).toBe(200); expect(await card.json()).toEqual({ locked: true, making: false });
  const list = await (await client.get("/api/music/jobs")).text();
  expect(list).not.toContain("Hidden Moon Song"); expect(list).not.toContain("silver lantern"); expect(list).toContain('"locked":true');
  for (const path of [`/api/music/jobs/${id}/files/${fileId}`, `/api/music/files/${fileId}`]) {
    const response = await client.get(path); const body = await response.text();
    expect(response.status).toBe(404); expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(body).not.toContain("Hidden Moon Song"); expect(body).not.toContain("silver lantern");
  }
  for (const path of [`/api/music/jobs/${id}/cover`, `/api/music/jobs/${id}/details`, `/api/music/jobs/${id}/delete`]) {
    const response = await client.post(path, {}); const body = await response.text();
    expect(response.status).toBe(404); expect(body).not.toContain("Hidden Moon Song"); expect(body).not.toContain("silver lantern");
  }
  for (const path of [`/api/music/jobs/${id}/revise`, `/api/music/jobs/${id}/length`, `/api/music/jobs/${id}/quality`]) {
    expect((await client.post(path, { change: "change style", length: "full", tier: "standard" })).status).toBe(423);
  }
  const clear = () => JSON.parse(db.select().from(musicJobs).where(eq(musicJobs.id, id)).get()!.request).title as string;
  expect(__unlockedForTests(sage.id, clear)).toBe("Hidden Moon Song");
  expect(__unlockedForTests(sage.id, () => true)).toBe(true);
});
