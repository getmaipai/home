import { beforeEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { attachments, musicJobs, people } from "@/db/schema";
import { __unlockedForTests, __resetAdultLockForTests } from "@/lib/adultLock";
import { activityForViewer } from "@/lib/activity";
import { mediaAppData, changeMusicCreationShare } from "@/lib/media/appHost";
import { __setMusicBedPollMsForTests, setPendingMix, whenMusicDone } from "@/lib/videos/musicBed";
import { resetDb } from "./reset-db";
import { TestClient } from "./client";
import type { PersonRow } from "@/types";

let sage: PersonRow, client: TestClient;
beforeEach(async () => {
  resetDb(); __resetAdultLockForTests();
  client = new TestClient();
  const setup = await (await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" })).json() as { person: { id: string } };
  sage = db.select().from(people).where(eq(people.id, setup.person.id)).get() as PersonRow;
});

test("adult-only queued and running songs stay out of activity until unlock", () => {
  const now = new Date().toISOString();
  for (const [id, state] of [["queued-lock-song", "queued"], ["running-lock-song", "running"]] as const) {
    db.insert(musicJobs).values({ id, personId: sage.id, conversationId: null, turnId: null, task: "text2music", request: JSON.stringify({ title: "Private song title", adultOnly: true }), state, progress: 0.2, fileId: null, createdAt: now, updatedAt: now, hlc: "1" }).run();
  }
  expect(activityForViewer(sage).items.filter((item) => item.source === "song")).toHaveLength(0);
  expect(__unlockedForTests(sage.id, () => activityForViewer(sage).items.filter((item) => item.source === "song").length)).toBe(2);
});

test("companion activity and counts omit locked songs until unlock", async () => {
  const now = new Date().toISOString();
  db.insert(musicJobs).values({ id: "companion-lock-song", personId: sage.id, companionId: "default", conversationId: null, turnId: null, task: "text2music", request: JSON.stringify({ title: "Private song title", adultOnly: true }), state: "running", progress: 0.2, fileId: null, createdAt: now, updatedAt: now, hlc: "1" }).run();
  const activity = await (await client.get("/api/companions/default/activity")).json() as { activity: Array<{ id: string }> };
  const cards = await (await client.get("/api/companions")).json() as { companions: Array<{ id: string; task_count: number }> };
  expect(activity.activity.some((row) => row.id === "companion-lock-song")).toBe(false);
  expect(cards.companions.find((row) => row.id === "default")?.task_count).toBe(0);
  db.update(musicJobs).set({ request: JSON.stringify({ title: "Private song title", adultOnly: true, adultLock: "off" }) }).where(eq(musicJobs.id, "companion-lock-song")).run();
  const rows = await client.get("/api/companions/default/activity").then((response) => response.json()) as { activity: Array<{ id: string }> };
  const list = await client.get("/api/companions").then((response) => response.json()) as { companions: Array<{ id: string; task_count: number }> };
  expect(rows.activity.some((row) => row.id === "companion-lock-song")).toBe(true);
  expect(list.companions.find((row) => row.id === "default")?.task_count).toBe(1);
});

test("locked music creations and sharing are missing until unlocked", () => {
  const now = new Date().toISOString();
  const fileId = "file-song-lock-b3";
  db.insert(attachments).values({ id: fileId, ownerPersonId: sage.id, conversationId: null, turnId: null, mediaType: "audio/mpeg", size: 4, sha256: createHash("sha256").update("song").digest("hex"), storagePath: `people/${sage.id}/attachments/${fileId}`, provenance: 'music-gen:{"made_audience":"adult-only","lock":"on","job_id":"locked-create-song"}', createdAt: now, hlc: "1" }).run();
  db.insert(musicJobs).values({ id: "locked-create-song", personId: sage.id, conversationId: null, turnId: null, task: "text2music", request: JSON.stringify({ title: "Private song", adultOnly: true }), state: "done", progress: 1, fileId, createdAt: now, updatedAt: now, hlc: "1" }).run();
  expect(mediaAppData(sage, "audio", "header", { scope: "creation", id: fileId })).toEqual([]);
  expect(changeMusicCreationShare(sage, "private", fileId).status).toBe(404);
  expect(__unlockedForTests(sage.id, () => (mediaAppData(sage, "audio", "header", { scope: "creation", id: fileId }) as unknown[]).length)).toBe(1);
});

test("a locked running song cannot start a waiting music bed mix", async () => {
  const now = new Date().toISOString();
  db.insert(musicJobs).values({ id: "locked-bed-song", personId: sage.id, conversationId: null, turnId: null, task: "text2music", request: JSON.stringify({ title: "Private bed", adultOnly: true }), state: "running", progress: 0.2, fileId: null, createdAt: now, updatedAt: now, hlc: "1" }).run();
  setPendingMix(sage, "locked-bed-song", { args: {}, conversationId: "c", turnId: "t" } as never);
  expect(db.select().from(musicJobs).where(eq(musicJobs.id, "locked-bed-song")).get()?.request).not.toContain("pendingMix");
  __setMusicBedPollMsForTests(1);
  try {
    const outcome = await new Promise<boolean>((resolve) => whenMusicDone(sage, "locked-bed-song", resolve));
    expect(outcome).toBe(false);
  } finally { __setMusicBedPollMsForTests(null); }
});
