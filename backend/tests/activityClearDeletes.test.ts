// ACTIVITY-CLEAR-02: clearing a row that could not finish (or was stopped) removes its job record for good; the dismissal stays, and nothing else is touched.
import { beforeEach, describe, expect, test } from "bun:test";
import { db } from "@/db";
import { activityDismissals, musicJobs, people, pictureJobs, videoJobs } from "@/db/schema";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";

beforeEach(() => resetDb());

async function household() {
  const owner = new TestClient();
  await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correct horse battery staple" });
  const child = (await (await owner.post("/api/people", { displayName: "Nova", role: "child" })).json()) as { id: string };
  const all = db.select().from(people).all();
  return { owner, ownerRow: all.find((p) => p.displayName === "Sage")!, childRow: all.find((p) => p.id === child.id)! };
}

const now = () => new Date().toISOString();
const picture = (id: string, personId: string, over: Partial<typeof pictureJobs.$inferInsert> = {}) => db.insert(pictureJobs).values({ id, personId, kind: "generate", state: "running", percent: 40, phase: "Adding light", prompt: "A red fox in the snow", request: JSON.stringify({ size: "1024x1024", n: 1, seed: null, loras: [], source_file_id: null, audience: "all-ages" }), files: "[]", createdAt: now(), updatedAt: now(), hlc: "h", ...over }).run();
const video = (id: string, personId: string, over: Partial<typeof videoJobs.$inferInsert> = {}) => db.insert(videoJobs).values({ id, personId, kind: "generate", state: "queued", percent: 0, phase: "queued", position: 1, prompt: "A paper lantern over a porch", request: JSON.stringify({ size: "832x480", seconds: 5, audience: "all-ages" }), files: "[]", createdAt: now(), updatedAt: now(), hlc: "h", ...over }).run();
const song = (id: string, personId: string, over: Partial<typeof musicJobs.$inferInsert> = {}) => db.insert(musicJobs).values({ id, personId, task: "text2music", request: JSON.stringify({ description: "Rainy porch song", title: "Rainy porch song", instrumental: false, seconds: 60 }), state: "running", stage: "Singing the verse", progress: 0.3, createdAt: now(), updatedAt: now(), hlc: "h", ...over }).run();

const pictureIds = () => db.select().from(pictureJobs).all().map((row) => row.id).sort();
const videoIds = () => db.select().from(videoJobs).all().map((row) => row.id).sort();
const songIds = () => db.select().from(musicJobs).all().map((row) => row.id).sort();
const clear = (client: TestClient, body: unknown) => client.post("/api/activity/clear", body);

describe("ACTIVITY-CLEAR-02: clearing deletes failed and stopped job records", () => {
  test("a named failed picture, clip and song are deleted; done, making and waiting rows are not", async () => {
    const { owner, ownerRow } = await household();
    picture("p-failed", ownerRow.id, { state: "failed" });
    picture("p-done", ownerRow.id, { state: "done" });
    picture("p-run", ownerRow.id);
    video("v-failed", ownerRow.id, { state: "failed", phase: null });
    video("v-wait", ownerRow.id);
    song("s-failed", ownerRow.id, { state: "failed", errorLine: "x" });
    song("s-done", ownerRow.id, { state: "done" });
    const res = await clear(owner, { keys: ["picture:p-failed", "video:v-failed", "song:s-failed", "picture:p-done", "picture:p-run", "video:v-wait"] });
    expect(res.status).toBe(200);
    expect(pictureIds()).toEqual(["p-done", "p-run"]);
    expect(videoIds()).toEqual(["v-wait"]);
    expect(songIds()).toEqual(["s-done"]);
  });

  test("the dismissal stays for the failed rows, so a late write of the same key stays hidden", async () => {
    const { owner, ownerRow } = await household();
    picture("p-failed", ownerRow.id, { state: "failed" });
    await clear(owner, { keys: ["picture:p-failed"] });
    expect(db.select().from(activityDismissals).all().map((row) => row.rowKey)).toEqual(["picture:p-failed"]);
  });

  test("clear all also removes this person's stopped (cancelled) records, never done or running ones", async () => {
    const { owner, ownerRow } = await household();
    picture("p-stop", ownerRow.id, { state: "cancelled" });
    video("v-stop", ownerRow.id, { state: "cancelled", phase: null });
    song("s-stop", ownerRow.id, { state: "cancelled" });
    picture("p-done", ownerRow.id, { state: "done" });
    song("s-run", ownerRow.id);
    video("v-failed", ownerRow.id, { state: "failed", phase: null });
    await clear(owner, { all: true });
    expect(pictureIds()).toEqual(["p-done"]);
    expect(videoIds()).toEqual([]);
    expect(songIds()).toEqual(["s-run"]);
  });

  test("never deletes another person's failed or stopped records", async () => {
    const { owner, ownerRow, childRow } = await household();
    picture("kid-failed", childRow.id, { state: "failed" });
    picture("kid-stop", childRow.id, { state: "cancelled" });
    song("kid-song", childRow.id, { state: "failed", errorLine: "x" });
    picture("mine-failed", ownerRow.id, { state: "failed" });
    await clear(owner, { keys: ["picture:kid-failed", "song:kid-song"] });
    await clear(owner, { all: true });
    expect(pictureIds()).toEqual(["kid-failed", "kid-stop"]);
    expect(songIds()).toEqual(["kid-song"]);
  });

  test("clearing a done row by name keeps its job record (the files stay)", async () => {
    const { owner, ownerRow } = await household();
    song("s-done", ownerRow.id, { state: "done" });
    await clear(owner, { keys: ["song:s-done"] });
    expect(songIds()).toEqual(["s-done"]);
  });
});
