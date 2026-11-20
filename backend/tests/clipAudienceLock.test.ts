// CLIP-AUDIENCE-LOCK-01 (owner ruling 2026-11-20, "Follow the lock only"): an adult's ordinary clip with sound is not adult-only merely because its sound is
// unchecked. A clip is adult-only when its words or style say so, when the finished-clip check's own verdict is nude or sexual (the lock goes on), or when it
// follows an adult-only source. The fake Stack reports sound (`audio: true`) in every test here. The one-time backfill lowers only the clips the old stamp
// raised and nothing else.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { and, eq, like } from "drizzle-orm";
import { resetDb } from "./reset-db";
import { db } from "@/db";
import { attachments, settingsValues, videoJobs } from "@/db/schema";
import { __resetVideoAdapterCacheForTests } from "@/lib/videos/adapters";
import { installFakeVideoStack, type FakeVideoStack } from "./videoFixture";
import { __setVideoStatusForTests } from "@/lib/videos/ready";
import { __setAgeCheckRunnerForTests } from "@/lib/pictures/ageCheck";
import { __setKeyframesForTests } from "@/lib/pictures/keyframes";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { __resetAdultLockForTests } from "@/lib/adultLock";
import { getVideoJobFor } from "@/lib/videos/jobs";
import { backfillSoundOnlyClips } from "@/lib/videos/soundStampBackfill";
import { PLAIN_PROMPT, household, makeClip, markAdultOnly } from "./fixtures/adultLock";
import { until } from "./pictureFixture";

let fake: FakeVideoStack;
const clear = { people_count: 0, apparent_min_age_estimate: null, label: "none" as const, is_nude_or_sexual: false, confidence: 1 };
beforeEach(() => {
  resetDb(); __resetVideoAdapterCacheForTests(); __resetAdultLockForTests(); __resetThrottleForTests();
  fake = installFakeVideoStack();
  __setAgeCheckRunnerForTests(async (images) => images.map(() => ({ ok: true as const, verdict: clear })));
  __setKeyframesForTests(async () => [new Uint8Array([7])]); // the fake Stack's clip bytes are not decodable; an adult-only job is withheld without frames
});
afterEach(() => { fake.restore(); __setVideoStatusForTests(undefined); __setKeyframesForTests(null); });

const meta = (fileId: string) => { const row = db.select().from(attachments).where(eq(attachments.id, fileId)).get()!; return JSON.parse(row.provenance.slice(row.provenance.indexOf(":") + 1)) as { audience?: string; made_audience?: string; lock?: string; audio?: boolean }; };
const SEXUAL_WORDS = "an explicit nude couple, sexual";

describe("what marks a clip adult-only", () => {
  test("an adult's ordinary request with sound is all-ages with the lock off, though an adult made it", async () => {
    const { adult, row } = await household();
    const clip = await makeClip(adult.client, row("Marlow"), PLAIN_PROMPT);
    expect(getVideoJobFor(row("Marlow"), clip.jobId)!.files[0]!.audio).toBe(true);
    for (const id of [clip.fileId, clip.posterId]) expect(meta(id)).toMatchObject({ audience: "all-ages", lock: "off" });
  });

  test("an adult-word prompt with sound stays adult-only, as before", async () => {
    const { adult, row } = await household();
    const clip = await makeClip(adult.client, row("Marlow"), SEXUAL_WORDS);
    expect(meta(clip.fileId).audience).toBe("adult-only");
  });

  test("a nude or sexual frame verdict gives adult-only with the lock on", async () => {
    __setAgeCheckRunnerForTests(async (images) => images.map(() => ({ ok: true as const, verdict: { ...clear, is_nude_or_sexual: true } })));
    const { adult, row } = await household();
    const clip = await makeClip(adult.client, row("Marlow"), PLAIN_PROMPT);
    expect(meta(clip.fileId)).toMatchObject({ audience: "adult-only", lock: "on" });
  });

  test("frames that could not be checked, for an adult-only job, store nothing: the job fails and no file is kept", async () => {
    __setAgeCheckRunnerForTests(async (images) => images.map(() => ({ ok: false as const, why: "timeout" as const })));
    const { adult, row } = await household();
    const made = (await (await adult.client.post("/api/videos/make", { prompt: SEXUAL_WORDS })).json()) as { id: string };
    await until(() => ["done", "failed"].includes(getVideoJobFor(row("Marlow"), made.id)?.state ?? ""));
    expect(getVideoJobFor(row("Marlow"), made.id)!.state).toBe("failed");
    expect(db.select().from(attachments).where(like(attachments.provenance, `%"job":"${made.id}"%`)).all()).toHaveLength(0);
  });

  test("a child who is shared an adult's ordinary clip with sound can read it, and cannot read an adult-only one", async () => {
    const { adult, child, row } = await household();
    const plain = await makeClip(adult.client, row("Marlow"), PLAIN_PROMPT);
    const locked = await makeClip(adult.client, row("Marlow"), PLAIN_PROMPT);
    markAdultOnly(locked.jobId);
    for (const file of [plain.fileId, locked.fileId]) expect((await adult.client.post(`/api/files/${file}/shares`, { to: child.id })).status).toBeLessThan(500);
    expect((await child.client.get(`/api/files/${plain.fileId}/content`)).status).toBe(200);
    expect((await child.client.get(`/api/files/${locked.fileId}/content`)).status).toBe(404);
  });
});

describe("the one-time fix of clips the old stamp raised", () => {
  /** A clip made before the fix: stamped adult-only only for its sound (lock off, request.adultOnly false, audio true). */
  function stampLikeBefore(jobId: string): void {
    for (const row of db.select().from(attachments).where(like(attachments.provenance, `%"job":"${jobId}"%`)).all()) {
      const colon = row.provenance.indexOf(":");
      const next = row.provenance.slice(0, colon + 1) + JSON.stringify({ ...JSON.parse(row.provenance.slice(colon + 1)), audience: "adult-only", made_audience: "adult-only" });
      db.update(attachments).set({ provenance: next }).where(eq(attachments.id, row.id)).run();
    }
  }
  const markerRow = () => db.select().from(settingsValues).where(and(eq(settingsValues.scope, "system"), eq(settingsValues.key, "__migration.clip_audience_lock_01"))).get();

  test("it lowers only sound-only clips; a locked clip, a clip an adult word raised, a silent one and an edit are left alone; a second run changes nothing", async () => {
    const { adult, row } = await household();
    const me = row("Marlow");
    const soundOnly = await makeClip(adult.client, me, PLAIN_PROMPT); stampLikeBefore(soundOnly.jobId);
    const locked = await makeClip(adult.client, me, PLAIN_PROMPT); markAdultOnly(locked.jobId);          // lock on: a human or the frame verdict
    const worded = await makeClip(adult.client, me, SEXUAL_WORDS);                                        // raised by its words (request.adultOnly true)
    const noJobRow = await makeClip(adult.client, me, PLAIN_PROMPT); stampLikeBefore(noJobRow.jobId);
    db.delete(videoJobs).where(eq(videoJobs.id, noJobRow.jobId)).run();                                  // the job row is gone: cannot be proved, stays adult-only
    fake.silent = true;
    const silent = await makeClip(adult.client, me, PLAIN_PROMPT); stampLikeBefore(silent.jobId);        // no sound: not the old stamp's doing
    const first = backfillSoundOnlyClips();
    expect(first.lowered).toBe(1);
    for (const id of [soundOnly.fileId, soundOnly.posterId]) expect(meta(id).audience).toBe("all-ages");
    expect(meta(locked.fileId)).toMatchObject({ audience: "adult-only", lock: "on" });
    expect(meta(worded.fileId).audience).toBe("adult-only");
    expect(meta(noJobRow.fileId).audience).toBe("adult-only");
    expect(meta(silent.fileId).audience).toBe("adult-only");
    expect(markerRow()).toBeDefined();
    const before = JSON.stringify(db.select().from(attachments).all().map((a) => [a.id, a.provenance]));
    expect(backfillSoundOnlyClips()).toEqual({ ran: false, lowered: 0 });
    expect(JSON.stringify(db.select().from(attachments).all().map((a) => [a.id, a.provenance]))).toBe(before);
  });

  test("a clip a person locked after the old stamp is not lowered by a later run of the same rule", async () => {
    const { adult, row } = await household();
    const clip = await makeClip(adult.client, row("Marlow"), PLAIN_PROMPT);
    stampLikeBefore(clip.jobId);
    markAdultOnly(clip.jobId);                                                                            // the creator locked it
    expect(backfillSoundOnlyClips().lowered).toBe(0);
    expect(meta(clip.fileId)).toMatchObject({ audience: "adult-only", lock: "on" });
  });
});
