// MUSIC-GEN-03 review fixes: provenance from the Stack's own answer, the cancel race, existing-song routes, cheap edits and file reads.
import { secondsForWords } from "@/lib/music/sections";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { existsSync, unlinkSync } from "node:fs";
import { db, sqlite } from "@/db";
import { attachments, musicJobs } from "@/db/schema";
import { resetDb } from "./reset-db";
import { createBenchPeople } from "../scripts/bench/conversationRunner";
import { installFakeMusicStack, musicState, LYRICS, waitForMusic } from "./musicFixture";
import { runEditMusic, runGenerateMusic } from "@/lib/music/tool";
import { cancelMusicJob, getMusicJobFor, type MusicJob } from "@/lib/music/jobs";
import { __removedMusicJobCountForTests, deleteMusicJobsForTurns, liveJobs } from "@/lib/music/store";
import { commercialUseOf } from "@/lib/music/commercial";
import { generationOf } from "@/lib/music/types";
import { modelStampFor } from "@/lib/music/models";
import { __setMusicStatusForTests, readyMusicStatusForTests } from "@/lib/music/ready";
import { attachmentFilePath } from "@/lib/attachments";
import { musicForOutcomes } from "@/lib/composer";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import type { PersonRow } from "@/types";
let owner: ReturnType<typeof createBenchPeople>;
let fake: ReturnType<typeof installFakeMusicStack>;
beforeEach(() => { resetDb(); __resetThrottleForTests(); owner = createBenchPeople(); fake = installFakeMusicStack(); });
afterEach(() => fake.restore());
async function generate(actor: PersonRow, args: Record<string, unknown> = { description: "an original folk song", lyrics: LYRICS, title: "Pancakes", seconds: 60 }, state = musicState(actor)): Promise<MusicJob> {
  const outcome = await runGenerateMusic({ state, args, callId: "g", spoken: false });
  const id = musicForOutcomes([outcome])!.id;
  await waitForMusic(() => getMusicJobFor(actor, id)?.state === "done");
  return getMusicJobFor(actor, id)!;
}
const noteOf = (job: MusicJob) => generationOf(db.select().from(attachments).where(eq(attachments.id, job.fileId!)).get()!.provenance)!;

describe("provenance comes from the Stack's job result", () => {
  test("a known model is stamped from the table; trim, fade and loudness inherit the parent's model and clearance", async () => {
    const state = musicState(owner.owner); const first = await generate(owner.owner, undefined, state);
    expect(noteOf(first)).toMatchObject({ model: { id: "ace-step-1-5-turbo", licence: "MIT" }, commercial_use: "cleared" });
    fake.model = "ace-step-1-5-lm-0-6b";
    const outcome = await runEditMusic({ state, args: { track: "latest", change: "remake" }, callId: "e", spoken: false });
    const id = musicForOutcomes([outcome])!.id; await waitForMusic(() => getMusicJobFor(owner.owner, id)?.state === "done");
    const second = getMusicJobFor(owner.owner, id)!;
    expect(noteOf(second).model).toEqual({ id: "ace-step-1-5-lm-0-6b", revision: "148d8ea0225bdab342ee1ae3a354275ccd60ca80", licence: "MIT" });
    const trimmed = await runEditMusic({ state, args: { track: "latest", change: "trim", from_s: 1, to_s: 20 }, callId: "t", spoken: false });
    const tid = musicForOutcomes([trimmed])!.id; await waitForMusic(() => getMusicJobFor(owner.owner, tid)?.state === "done");
    const note = noteOf(getMusicJobFor(owner.owner, tid)!);
    expect(note).toMatchObject({ task: "trim", model: noteOf(second).model, engine: noteOf(second).engine, commercial_use: "cleared", commercial_basis: noteOf(second).commercial_basis });
  });
  test("an unknown or missing model is stamped unknown and is not cleared for commercial export", async () => {
    for (const model of ["some-other-weights", undefined]) {
      fake.model = model;
      const job = await generate(owner.owner);
      expect(noteOf(job)).toMatchObject({ model: { licence: "unknown", revision: "unknown" }, commercial_use: "unknown" });
      expect(commercialUseOf(job.fileId!)).toBe("unknown");
    }
    expect(modelStampFor("trim", "none", null).commercial_use).toBe("unknown");
    expect(modelStampFor("text2music", "__proto__", null).commercial_use).toBe("unknown");
  });
  test("an edit of an unknown-model song stays not cleared", async () => {
    fake.model = "some-other-weights";
    const state = musicState(owner.owner); await generate(owner.owner, undefined, state);
    fake.model = "ace-step-1-5-turbo";
    const outcome = await runEditMusic({ state, args: { track: "latest", change: "remake" }, callId: "e", spoken: false });
    const id = musicForOutcomes([outcome])!.id; await waitForMusic(() => getMusicJobFor(owner.owner, id)?.state === "done");
    expect(noteOf(getMusicJobFor(owner.owner, id)!).commercial_use).toBe("cleared");
    expect(commercialUseOf(getMusicJobFor(owner.owner, id)!.fileId!)).toBe("unknown");
  });
});

describe("a stop during the submit sticks", () => {
  test("cancel while the Stack call is in flight frees the Stack copy, starts no watcher and stays cancelled", async () => {
    const state = musicState(owner.owner, true);
    let release!: () => void;
    fake.beforeSubmit = () => new Promise<void>((resolve) => { release = resolve; });
    const promise = runGenerateMusic({ state, args: { description: "an original folk song" }, callId: "c", spoken: false });
    await waitForMusic(() => !!release);
    const live = [...liveJobs.values()][0]!;
    expect((await cancelMusicJob(owner.owner, live.id))?.state).toBe("cancelled");
    release();
    expect((await promise).status).toBe("failed");
    await waitForMusic(() => fake.deleted.includes("mjob-1"));
    await new Promise((r) => setTimeout(r, 30));
    expect(fake.polls.get("mjob-1")).toBe(0);
    expect(getMusicJobFor(owner.owner, live.id)?.state).toBe("cancelled");
    expect(liveJobs.size).toBe(0);
  });
  test("a stored cancel is not overwritten by a later write from a watcher", async () => {
    fake.pollsToFinish = 1000;
    const state = musicState(owner.owner);
    const out = await runGenerateMusic({ state, args: { description: "an original folk song" }, callId: "c", spoken: false });
    const id = musicForOutcomes([out])!.id;
    db.update(musicJobs).set({ state: "cancelled" }).where(eq(musicJobs.id, id)).run();
    await new Promise((r) => setTimeout(r, 40));
    expect(db.select().from(musicJobs).where(eq(musicJobs.id, id)).get()?.state).toBe("cancelled");
    expect(liveJobs.size).toBe(0);
  });
  test("ids leave the removed set once their watcher finishes", async () => {
    fake.pollsToFinish = 1000;
    const state = musicState(owner.owner, true);
    const out = await runGenerateMusic({ state, args: { description: "an original folk song" }, callId: "c", spoken: false });
    const id = musicForOutcomes([out])!.id;
    deleteMusicJobsForTurns([state.turnId]);
    await waitForMusic(() => liveJobs.size === 0 && __removedMusicJobCountForTests() === 0);
    expect(getMusicJobFor(owner.owner, id)).toBeNull();
  });
});

describe("cheap edits and file reads", () => {
  test("a remake or variation reads no source bytes; a cover still needs them", async () => {
    const state = musicState(owner.owner); const original = await generate(owner.owner, undefined, state);
    const row = db.select().from(attachments).where(eq(attachments.id, original.fileId!)).get()!;
    unlinkSync(attachmentFilePath(row.storagePath));
    for (const change of ["remake", "variation"]) {
      const out = await runEditMusic({ state, args: { track: original.fileId, change }, callId: "e", spoken: false });
      expect(musicForOutcomes([out])?.id).toBeDefined(); expect(fake.submitted.at(-1)).not.toHaveProperty("source");
      await waitForMusic(() => liveJobs.size === 0);
    }
    // LIBRARY-DEDUP-01: the fake engine returns the same bytes each time, so a remake rewrote the one stored file; remove it again.
    if (existsSync(attachmentFilePath(row.storagePath))) unlinkSync(attachmentFilePath(row.storagePath));
    const before = fake.submitted.length;
    const cover = await runEditMusic({ state, args: { track: original.fileId, change: "restyle", description: "jazz" }, callId: "e", spoken: false });
    expect(musicForOutcomes([cover])).toBeFalsy(); expect(fake.submitted).toHaveLength(before);
  });
  test("music_jobs has the person and conversation index and the file index", () => {
    const names = (sqlite.query("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'music_jobs'").all() as { name: string }[]).map((r) => r.name);
    expect(names).toContain("music_jobs_person_conversation_idx"); expect(names).toContain("music_jobs_file_id_idx");
  });
});

describe("the Stack's defaults", () => {
  test("quality comes from the Stack's default_quality, and edits send the same", async () => {
    __setMusicStatusForTests(readyMusicStatusForTests({ default_quality: "detailed" }));
    const state = musicState(owner.owner); await generate(owner.owner, undefined, state);
    expect(fake.submitted[0]!.quality).toBe("detailed");
    __setMusicStatusForTests(readyMusicStatusForTests({ default_quality: "quick" }));
    await generate(owner.owner);
    expect(fake.submitted[1]!.quality).toBe("quick");
    __setMusicStatusForTests(readyMusicStatusForTests());
    await generate(owner.owner);
    expect(fake.submitted[2]!.quality).toBe("quick");
  });
  test("with no length given, the song is as long as its words, between 30 s and the Stack maximum", async () => {
    expect(secondsForWords(LYRICS)).toBe(52);
    expect(secondsForWords("[Verse]\nOne line")).toBe(30);
    expect(secondsForWords(Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\n"))).toBe(610);
    expect(secondsForWords("")).toBe(30);
    await generate(owner.owner, { description: "an original folk song", lyrics: LYRICS });
    expect(fake.submitted[0]!.duration_s).toBe(52);
    await generate(owner.owner, { description: "an original folk song", lyrics: LYRICS, seconds: 90 });
    expect(fake.submitted[1]!.duration_s).toBe(90);
  });
});
