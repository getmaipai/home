// ACTIVITY-PAGE-01: the Activity list reads only the viewer's own job records, never names a locked item, gives a child the child-safe label,
// and computes the entry's dot (needs a look, finished and unopened, running) without a number.
import { beforeEach, describe, expect, test } from "bun:test";
import { db } from "@/db";
import { musicJobs, people, pictureJobs, videoJobs } from "@/db/schema";
import { activeGenerationRows, activityDot, activityForViewer, markActivitySeen, type ActivityItem } from "@/lib/activity";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";

beforeEach(() => resetDb());

async function household() {
  const owner = new TestClient();
  await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correct horse battery staple" });
  const child = (await (await owner.post("/api/people", { displayName: "Nova", role: "child" })).json()) as { id: string };
  const all = db.select().from(people).all();
  const childClient = new TestClient();
  await childClient.post("/api/auth/select", { personId: child.id });
  return { owner, ownerRow: all.find((p) => p.displayName === "Sage")!, childRow: all.find((p) => p.id === child.id)!, childClient };
}

const now = () => new Date().toISOString();
const picture = (id: string, personId: string, over: Partial<typeof pictureJobs.$inferInsert> = {}) => db.insert(pictureJobs).values({ id, personId, kind: "generate", state: "running", percent: 40, phase: "Adding light", prompt: "A red fox in the snow", request: JSON.stringify({ size: "1024x1024", n: 1, seed: null, loras: [], source_file_id: null, audience: "all-ages" }), files: "[]", createdAt: now(), updatedAt: now(), hlc: "h", ...over }).run();
const video = (id: string, personId: string, over: Partial<typeof videoJobs.$inferInsert> = {}) => db.insert(videoJobs).values({ id, personId, kind: "generate", state: "queued", percent: 0, phase: "queued", position: 1, prompt: "A paper lantern over a porch", request: JSON.stringify({ size: "832x480", seconds: 5, audience: "all-ages" }), files: "[]", createdAt: now(), updatedAt: now(), hlc: "h", ...over }).run();
const song = (id: string, personId: string, over: Partial<typeof musicJobs.$inferInsert> = {}) => db.insert(musicJobs).values({ id, personId, task: "text2music", request: JSON.stringify({ description: "Rainy porch song", title: "Rainy porch song", instrumental: false, seconds: 60 }), state: "running", stage: "Singing the verse", progress: 0.3, createdAt: now(), updatedAt: now(), hlc: "h", ...over }).run();

describe("ACTIVITY-PAGE-01: the list", () => {
  test("shows the viewer's own picture, clip and song with the five states and a next step", async () => {
    const { ownerRow } = await household();
    picture("p1", ownerRow.id);
    video("v1", ownerRow.id);
    video("v2", ownerRow.id, { state: "failed", error: "I couldn't make that video. Try again, or ask for something simpler.", phase: null });
    song("s1", ownerRow.id);
    const list = activityForViewer(ownerRow);
    const byId = new Map(list.items.map((item) => [item.id, item]));
    expect(byId.get("picture:p1")).toMatchObject({ state: "making", title: "A red fox in the snow", percent: 40 });
    expect(byId.get("video:v1")).toMatchObject({ state: "waiting", percent: null });
    expect(byId.get("video:v1")?.line).toBeTruthy();
    expect(byId.get("video:v2")).toMatchObject({ state: "failed", line: "I couldn't make that video. Try again, or ask for something simpler.", href: "/apps/videos/create" });
    expect(byId.get("song:s1")).toMatchObject({ state: "making", title: "Rainy porch song", percent: 30, href: "/apps/music/create?song=s1" });
  });

  test("never lists another person's job, an admin's included", async () => {
    const { ownerRow, childRow } = await household();
    picture("kid-pic", childRow.id);
    video("kid-vid", childRow.id);
    song("kid-song", childRow.id);
    expect(activityForViewer(ownerRow).items).toEqual([]);
    expect(activeGenerationRows(ownerRow)).toEqual([]);
    expect(activityForViewer(childRow).items).toHaveLength(3);
  });

  test("a child sees the child-safe label and line, never the prompt", async () => {
    const { childRow } = await household();
    picture("c1", childRow.id, { prompt: "a dragon eating a school" });
    video("c2", childRow.id, { state: "failed", error: "I couldn't make that video. The engine ran out of memory.", phase: null });
    const items = activityForViewer(childRow).items;
    expect(items.find((item) => item.id === "picture:c1")?.title).toBe("A picture");
    expect(items.find((item) => item.id === "video:c2")).toMatchObject({ title: "A video", line: "That did not work. Try again, or ask a grown-up to help." });
    expect(JSON.stringify(items)).not.toContain("dragon");
    expect(JSON.stringify(items)).not.toContain("memory");
  });

  test("a locked adult-only item is left out entirely, named nowhere", async () => {
    const { ownerRow } = await household();
    picture("locked-p", ownerRow.id, { prompt: "secret adult scene", request: JSON.stringify({ size: "1024x1024", n: 1, seed: null, loras: [], source_file_id: null, audience: "adult", adultLock: "on" }) });
    video("locked-v", ownerRow.id, { prompt: "secret adult clip", request: JSON.stringify({ size: "832x480", seconds: 5, audience: "adult", adultOnly: true, adultLock: "on" }) });
    picture("open-p", ownerRow.id);
    const list = activityForViewer(ownerRow);
    expect(list.items.map((item) => item.id)).toEqual(["picture:open-p"]);
    expect(JSON.stringify(activeGenerationRows(ownerRow))).not.toContain("secret");
  });

  test("a finished clip whose file is gone, a stopped job and an old job are not listed", async () => {
    const { ownerRow } = await household();
    video("gone", ownerRow.id, { state: "done", percent: 100, files: JSON.stringify([{ id: "missing-file", poster_id: "x", seconds: 5, width: 832, height: 480, audio: false }]) });
    picture("stopped", ownerRow.id, { state: "cancelled" });
    picture("ancient", ownerRow.id, { state: "done", updatedAt: new Date(Date.now() - 60 * 24 * 3_600_000).toISOString() });
    expect(activityForViewer(ownerRow).items).toEqual([]);
  });

  test("the jobs list the strip reads carries only waiting and making rows of the viewer's own", async () => {
    const { ownerRow } = await household();
    picture("p1", ownerRow.id);
    video("v1", ownerRow.id);
    picture("done1", ownerRow.id, { state: "done" });
    song("s-failed", ownerRow.id, { state: "failed", errorLine: "The song took longer than expected." });
    const rows = activeGenerationRows(ownerRow);
    expect(rows.map((row) => [row.kind, row.state]).sort()).toEqual([["picture", "running"], ["video", "queued"]]);
    expect(rows.every((row) => (row.progress as { percent: number }).percent >= 0 && row.forPerson === ownerRow.id)).toBe(true);
  });
});

describe("ACTIVITY-PAGE-01: the dot", () => {
  const item = (state: ActivityItem["state"], at: string): ActivityItem => ({ id: state, source: "picture", state, title: "t", line: null, percent: null, typicalMinutes: null, href: null, at });
  const t0 = "2026-11-09T10:00:00.000Z", t1 = "2026-11-09T11:00:00.000Z";
  test("idle is no dot; running pulses; finished is steady until opened; needs a look wins", () => {
    expect(activityDot([], null)).toBe("none");
    expect(activityDot([item("making", t1)], null)).toBe("running");
    expect(activityDot([item("done", t1)], t0)).toBe("finished");
    expect(activityDot([item("done", t0)], t1)).toBe("none");
    expect(activityDot([item("making", t1), item("done", t1)], t0)).toBe("finished");
    expect(activityDot([item("done", t1), item("attention", t0), item("making", t1)], t0)).toBe("attention");
    expect(activityDot([item("failed", t1)], t0)).toBe("attention");
    expect(activityDot([item("failed", t0)], t1)).toBe("none");
  });
});

describe("ACTIVITY-PAGE-01: the routes", () => {
  test("GET lists the signed-in person's rows, and POST seen clears the finished dot", async () => {
    const { owner, ownerRow } = await household();
    picture("done1", ownerRow.id, { state: "done" });
    const first = (await (await owner.get("/api/activity")).json()) as { items: Array<{ id: string }>; dot: string; seenAt: string | null };
    expect(first.items.map((entry) => entry.id)).toEqual(["picture:done1"]);
    expect(first.dot).toBe("finished");
    const seen = await owner.post("/api/activity/seen", {});
    expect(seen.status).toBe(200);
    const later = (await (await owner.get("/api/activity")).json()) as { dot: string; seenAt: string | null };
    expect(later.dot).toBe("none");
    expect(later.seenAt).toBeTruthy();
  });

  test("a signed-out request is refused, and a child's list holds only the child's own rows", async () => {
    const { ownerRow, childRow, childClient } = await household();
    picture("o", ownerRow.id);
    picture("c", childRow.id);
    expect((await new TestClient().get("/api/activity")).status).toBe(401);
    const body = (await (await childClient.get("/api/activity")).json()) as { items: Array<{ id: string }> };
    expect(body.items.map((entry) => entry.id)).toEqual(["picture:c"]);
    expect(markActivitySeen(ownerRow)).toBeTruthy();
  });

  test("GET /api/jobs carries the viewer's making rows beside the existing ones", async () => {
    const { owner, ownerRow } = await household();
    video("v1", ownerRow.id);
    const rows = (await (await owner.get("/api/jobs")).json()) as Array<{ id: string; kind: string }>;
    expect(rows.find((row) => row.id === "video:v1")?.kind).toBe("video");
  });
});
