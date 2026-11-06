import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resetDb } from "../../../tests/reset-db";
import { createBenchPeople } from "../../../scripts/bench/conversationRunner";
import { installFakeMusicStack, musicState, waitForMusic } from "../../../tests/musicFixture";
import { __setMusicStatusForTests, readyMusicStatusForTests } from "./ready";
import { getMusicJobFor } from "./jobs";
import { attachments } from "@/db/schema";
import { db } from "@/db";
import { eq } from "drizzle-orm";
import { toRecord } from "@/lib/attachments";
import { musicForOutcomes } from "../composer";
import { makeSoundArgs, runMakeSound } from "./soundMaker";
import { generationOf } from "./types";
import type { PersonRow } from "@/types";

let people: ReturnType<typeof createBenchPeople>;
let fake: ReturnType<typeof installFakeMusicStack>;
beforeEach(() => { resetDb(); people = createBenchPeople(); fake = installFakeMusicStack(); });
afterEach(() => { fake.restore(); __setMusicStatusForTests(undefined); });
const input = (actor: PersonRow, args: Record<string, unknown>) => runMakeSound({ state: musicState(actor), args, callId: "s", spoken: false });

describe("make_sound", () => {
  test("validates the bounded sound arguments", () => {
    expect(makeSoundArgs.safeParse({ description: "rain on a window", seconds: 1, loop: true, stick_to_words: false }).success).toBe(true);
    expect(makeSoundArgs.safeParse({ description: "no" }).success).toBe(false);
    expect(makeSoundArgs.safeParse({ description: "rain", seconds: 61 }).success).toBe(false);
  });
  test("starts instrumental ACE-Step sound with min clamp, loop wording and sound controls", async () => {
    const out = await input(people.owner, { description: "rain on a window", seconds: 1, loop: true, stick_to_words: false });
    expect(out.status).toBe("succeeded");
    const jobId = musicForOutcomes([out])!.id;
    const job = getMusicJobFor(people.owner, jobId)!;
    expect(job.request).toMatchObject({ instrumental: true, lyrics: "[Instrumental]", seconds: 10, quality: "quick", sound: { loop: true, surprise: true } });
    expect(job.request.description).toBe("sound effect, no melody, no singing: rain on a window, seamless loop");
    expect(out.result?.reply?.text).toContain("started");
    expect(out.result?.reply?.text).toContain("minimum length");
    expect(fake.submitted[0]).toMatchObject({ task: "text2music", duration_s: 10 });
  });
  test("passes policy refusals through musicRefusalFor", async () => {
    const out = await input(people.child, { description: "rain on a window" });
    expect(out.status).toBe("succeeded");
    expect(out.result?.data).toMatchObject({ refused: "minor" });
    expect(fake.submitted).toHaveLength(0);
  });
  test("reports unavailable engine and already making with the music outcome shapes", async () => {
    __setMusicStatusForTests({ available: false } as never);
    expect(await input(people.owner, { description: "rain on a window" })).toMatchObject({ status: "failed", errorCode: "no_engine" });
    __setMusicStatusForTests(readyMusicStatusForTests());
    fake.pollsToFinish = 1000;
    const first = await input(people.owner, { description: "rain on a window" });
    const second = await input(people.owner, { description: "wind in trees" });
    expect(first.status).toBe("succeeded");
    expect(second.result?.data).toMatchObject({ refused: "already_making" });
  });
  test("generationOf accepts sound provenance", () => {
    expect(generationOf(`music-gen:${JSON.stringify({ kind: "sound", task: "sfx" })}`)).toMatchObject({ kind: "sound", task: "sfx" });
  });
  test("finished sound job carries sound provenance and starts no cover or word timing", async () => {
    const out = await input(people.owner, { description: "rain on a window" });
    const id = musicForOutcomes([out])!.id;
    await waitForMusic(() => getMusicJobFor(people.owner, id)?.state === "done");
    const job = getMusicJobFor(people.owner, id)!;
    const file = db.select().from(attachments).where(eq(attachments.id, job.fileId!)).get();
    expect(generationOf(file?.provenance ?? null)).toMatchObject({ kind: "sound", task: "sfx" });
    expect(file && toRecord(file).provenance.package_id).toBe("make_sound");
    expect(job.coverJobId).toBeNull(); expect(job.coverFileId).toBeNull(); expect(job.timedWords).toBeNull();
    expect(fake.align.submitted).toHaveLength(0);
  });
});
