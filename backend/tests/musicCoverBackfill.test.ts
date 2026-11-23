// COVER-BACKFILL-01: songs and sounds made before covers existed get a title (songs) and a cover, lazily, on their owner's first Audio read.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { people } from "@/db/schema";
import { resetDb } from "./reset-db";
import { TestClient } from "./client";
import { installFakeMusicStack, musicState, waitForMusic, LYRICS } from "./musicFixture";
import { installFakeImageStack, until } from "./pictureFixture";
import { runGenerateMusic } from "@/lib/music/tool";
import { runMakeSound } from "@/lib/music/soundMaker";
import { musicForOutcomes } from "@/lib/composer";
import { getMusicJobFor } from "@/lib/music/jobs";
import { saveMusicJob } from "@/lib/music/store";
import { getPictureJob } from "@/lib/pictures/jobs";
import { __setPictureStatusForTests, readyStatusForTests } from "@/lib/pictures/ready";
import { backfillMissingCovers, __resetCoverBackfillForTests } from "@/lib/music/coverBackfill";
import type { MusicJob } from "@/lib/music/types";
import type { PersonRow } from "@/types";

let music: ReturnType<typeof installFakeMusicStack>;
let pictures: ReturnType<typeof installFakeImageStack>;
beforeEach(() => { resetDb(); __resetCoverBackfillForTests(); music = installFakeMusicStack(); pictures = installFakeImageStack(); });
afterEach(() => { music.restore(); pictures.restore(); });

async function owner() {
  const client = new TestClient();
  expect((await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" })).status).toBe(201);
  return { client, actor: db.select().from(people).where(eq(people.displayName, "Sage")).get()! as PersonRow };
}
/** A finished song made while no picture engine answered: no cover, and (when asked) no title. */
async function oldSong(actor: PersonRow, untitled = false): Promise<MusicJob> {
  __setPictureStatusForTests(null);
  const outcome = await runGenerateMusic({ state: musicState(actor), args: { description: "an original folk song", lyrics: LYRICS, title: "Pancakes" }, callId: "g", spoken: false });
  const id = musicForOutcomes([outcome])!.id;
  await waitForMusic(() => getMusicJobFor(actor, id)?.state === "done");
  __setPictureStatusForTests(readyStatusForTests());
  const job = getMusicJobFor(actor, id)!;
  expect(job.coverJobId).toBeNull();
  if (untitled) { delete job.request.title; saveMusicJob(job); }
  return getMusicJobFor(actor, id)!;
}
async function oldSound(actor: PersonRow): Promise<MusicJob> {
  __setPictureStatusForTests(null);
  const outcome = await runMakeSound({ state: musicState(actor), args: { description: "rain on a window", seconds: 10 }, callId: "s", spoken: false });
  const id = musicForOutcomes([outcome])!.id;
  await waitForMusic(() => getMusicJobFor(actor, id)?.state === "done");
  __setPictureStatusForTests(readyStatusForTests());
  return getMusicJobFor(actor, id)!;
}
/** More finished songs without a cover, each newer than the one before. */
function clones(base: MusicJob, count: number, personId = base.personId): MusicJob[] {
  return Array.from({ length: count }, (_, i) => {
    const copy: MusicJob = { ...base, personId, id: `mjob-clone${personId.slice(-4)}${String(i).padStart(3, "0")}`, createdAt: new Date(Date.parse(base.createdAt) + (i + 1) * 1000).toISOString(), coverJobId: null, coverFileId: null, request: { ...base.request } };
    saveMusicJob(copy);
    return copy;
  });
}

describe("cover backfill", () => {
  test("an older song without a cover gets exactly one cover job, and a second run adds none", async () => {
    const { actor } = await owner(); const job = await oldSong(actor);
    const first = await backfillMissingCovers(actor);
    expect(first.started).toBe(1);
    await until(() => Boolean(getMusicJobFor(actor, job.id)?.coverFileId));
    expect(pictures.submitted).toHaveLength(1);
    expect(getPictureJob(actor, getMusicJobFor(actor, job.id)!.coverJobId!)).toMatchObject({ purpose: "cover" });
    expect((await backfillMissingCovers(actor)).started).toBe(0);
    expect(pictures.submitted).toHaveLength(1);
  });

  test("an older sound without a cover gets one cover job", async () => {
    const { actor } = await owner(); const job = await oldSound(actor);
    expect((await backfillMissingCovers(actor)).started).toBe(1);
    await until(() => Boolean(getMusicJobFor(actor, job.id)?.coverFileId));
    expect(String(pictures.submitted[0]!.prompt)).toContain("sound effect");
  });

  test("at most 2 cover jobs are in flight, newest first, and a trigger looks at 20 at most", async () => {
    const { actor } = await owner(); const base = await oldSong(actor); pictures.pollsToFinish = 1000;
    const more = clones(base, 24);
    const result = await backfillMissingCovers(actor);
    expect(result.started).toBe(2); expect(result.considered).toBeLessThanOrEqual(20);
    expect(pictures.submitted.length).toBeLessThanOrEqual(2); // the household queue may still hold the second one back
    expect(getMusicJobFor(actor, more[23]!.id)?.coverJobId).toBeTruthy();
    expect(getMusicJobFor(actor, more[22]!.id)?.coverJobId).toBeTruthy();
    expect(getMusicJobFor(actor, more[21]!.id)?.coverJobId).toBeNull();
    expect((await backfillMissingCovers(actor)).started).toBe(0); // both slots are still busy
    expect(pictures.submitted.length).toBeLessThanOrEqual(2);
  });

  test("nothing starts while the picture engine is busy or not ready", async () => {
    const { actor } = await owner(); await oldSong(actor);
    __setPictureStatusForTests(readyStatusForTests({ state: "running" }));
    expect((await backfillMissingCovers(actor)).started).toBe(0);
    __setPictureStatusForTests(null);
    expect((await backfillMissingCovers(actor)).started).toBe(0);
    expect(pictures.submitted).toHaveLength(0);
  });

  test("a failed attempt is not retried within a day, and is tried once more after it", async () => {
    const { actor } = await owner(); const job = await oldSong(actor);
    pictures.failWith = { code: "boom", error: "The picture maker stopped." };
    expect((await backfillMissingCovers(actor)).started).toBe(1);
    await until(() => getPictureJob(actor, getMusicJobFor(actor, job.id)!.coverJobId!)?.state === "failed");
    expect((await backfillMissingCovers(actor, { now: Date.now() + 60 * 60_000 })).started).toBe(0);
    expect(pictures.submitted).toHaveLength(1);
    pictures.failWith = null;
    expect((await backfillMissingCovers(actor, { now: Date.now() + 25 * 60 * 60_000 })).started).toBe(1);
    await until(() => pictures.submitted.length === 2);
  });

  test("a backfill cover, done or failed, never appears in Activity", async () => {
    const { actor, client } = await owner(); const job = await oldSong(actor);
    const before = (await (await client.get("/api/activity")).json() as { items: Array<{ id: string; source: string }> }).items.filter((i) => i.source === "picture").length;
    pictures.failWith = { code: "boom", error: "The picture maker stopped." };
    await backfillMissingCovers(actor);
    await until(() => getPictureJob(actor, getMusicJobFor(actor, job.id)!.coverJobId!)?.state === "failed");
    const after = (await (await client.get("/api/activity")).json() as { items: Array<{ id: string; source: string; state: string }> }).items;
    expect(after.filter((i) => i.source === "picture")).toHaveLength(before);
    expect(after.some((i) => i.state === "failed")).toBe(false);
  });

  test("untitled songs get a title without the picture engine", async () => {
    const { actor } = await owner(); const job = await oldSong(actor, true);
    __setPictureStatusForTests(null);
    const result = await backfillMissingCovers(actor);
    expect(result.titled).toBe(1); expect(result.started).toBe(0);
    expect(getMusicJobFor(actor, job.id)!.request.title?.trim()).toBeTruthy();
    expect(getMusicJobFor(actor, job.id)!.request.title).not.toBe("Song");
    expect((await backfillMissingCovers(actor)).titled).toBe(0);
  });

  test("another person's items are never touched", async () => {
    const { actor } = await owner(); const base = await oldSong(actor, true);
    const now = new Date().toISOString();
    db.insert(people).values({ id: "person-marlow000001", displayName: "Marlow", role: "adult", avatarSeed: "s", source: "local", createdAt: now, updatedAt: now, hlc: "1:0:aaaaaa" }).run();
    const theirs = clones(base, 2, "person-marlow000001");
    for (const job of theirs) { delete job.request.title; saveMusicJob(job); }
    await backfillMissingCovers(actor);
    for (const job of theirs) {
      const row = getMusicJobFor({ id: "person-marlow000001" }, job.id)!;
      expect(row.coverJobId).toBeNull(); expect(row.request.title).toBeUndefined();
    }
  });

  test("temporary songs, stem splits and speech are never backfilled", async () => {
    const { actor } = await owner(); const base = await oldSong(actor);
    saveMusicJob({ ...base, id: "mjob-stems0000001", task: "stems", coverJobId: null, coverFileId: null });
    saveMusicJob({ ...base, id: "mjob-speech000001", request: { ...base.request, speech: { voiceName: "Sage" } } as MusicJob["request"], coverJobId: null, coverFileId: null });
    await backfillMissingCovers(actor);
    expect(getMusicJobFor(actor, "mjob-stems0000001")!.coverJobId).toBeNull();
    expect(getMusicJobFor(actor, "mjob-speech000001")!.coverJobId).toBeNull();
    expect(getMusicJobFor(actor, base.id)!.coverJobId).toBeTruthy();
  });

  test("the songs and sounds reads trigger it for the person who reads", async () => {
    const { actor, client } = await owner(); const song = await oldSong(actor);
    expect((await client.get("/api/music/jobs")).status).toBe(200);
    await until(() => Boolean(getMusicJobFor(actor, song.id)?.coverJobId));
    const sound = await oldSound(actor);
    expect((await client.get("/api/music/sounds")).status).toBe(200);
    await until(() => Boolean(getMusicJobFor(actor, sound.id)?.coverJobId));
  });
});
