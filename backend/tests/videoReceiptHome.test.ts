// VF-RECEIPT-01, Home half: the Stack's receipt is read before the Stack's copy of the clip is deleted, kept in the owner's own job record, and named on the
// creation record by `receipt_ids`; a missing or unreadable receipt never fails the clip, and the delete still happens. Both doors, and each shot of a film its own.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { resetDb } from "./reset-db";
import { TestClient } from "./client";
import { db } from "@/db";
import { people as peopleTable } from "@/db/schema";
import { creationOfFile } from "@/lib/creations/store";
import { getVideoJobFor, startVideoJob } from "@/lib/videos/jobs";
import { installFakeVideoStack, type FakeVideoStack } from "./videoFixture";
import { __setVideoStatusForTests, readyVideoStatusForTests } from "@/lib/videos/ready";
import { until } from "./pictureFixture";
import type { PersonRow } from "@/types";

let fake: FakeVideoStack;
beforeEach(() => { resetDb(); fake = installFakeVideoStack({ pollsToFinish: 2 }); __setVideoStatusForTests(readyVideoStatusForTests({ ltx25: "ready" })); fake.silent = true; });
afterEach(() => { fake.restore(); });

const RECEIPT = { version: 1, operation: "generate", runtime: { id: "engine-a", revision: "abc1234" }, steps: { count: 11, schedule: "8 + 3" }, native: { width: 512, height: 256, frames: 121 }, delivered: { width: 512, height: 256, frames: 118 }, prompt: { bytes: 14, sha256: "a".repeat(64) } };

async function owner(): Promise<PersonRow> {
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  return db.select().from(peopleTable).where(eq(peopleTable.displayName, "Sage")).get()! as PersonRow;
}
// The Create page's way: no conversation, kept Library files, a creation record.
const makeClip = (actor: PersonRow, prompt = "a paper boat") => startVideoJob({ actor, conversationId: null, turnId: null, temporary: false, kind: "generate", prompt, body: { prompt, size: "512x256", seconds: 5, seed: 4242, audience: "adult" } });
async function done(actor: PersonRow, id: string) { await until(() => getVideoJobFor(actor, id)?.state === "done", 15_000); return getVideoJobFor(actor, id)!; }

describe("the receipt is kept before the Stack's copy goes", () => {
  test("old door: the receipt is in the owner's job record, the creation record names it, the Stack's copy is deleted", async () => {
    fake.receipt = RECEIPT;
    const actor = await owner();
    const job = await done(actor, (await makeClip(actor)).id);
    expect(fake.submitted[0]!.via).toBeUndefined();   // the old door
    expect(job.request.receipt).toMatchObject({ operation: "generate", steps: { count: 11 }, native: { frames: 121 }, delivered: { frames: 118 } });
    expect(job.request.receipt!.job_id).toBe(job.stackJob);
    expect(JSON.stringify(job.request.receipt)).not.toContain("a paper boat");   // the prompt is a byte count and a hash, never text
    const record = creationOfFile(actor.id, job.files[0]!.id);
    expect(record?.receipt_ids).toEqual([job.stackJob!]);
    await until(() => fake.jobs.every((item) => item.deleted));
    expect(fake.jobs.map((item) => item.deleted)).toEqual([true]);
  });

  // MAIPAI_VIDEO_LEGACY_DOOR=1 keeps every clip off the make door, so this test only means something without it.
  test.skipIf(process.env.MAIPAI_VIDEO_LEGACY_DOOR === "1")("generic door: the same, on the clip made through the make door", async () => {
    fake.door = true; fake.receipt = RECEIPT;
    const actor = await owner();
    const job = await done(actor, (await makeClip(actor)).id);
    expect(fake.submitted[0]!.via).toBe("door");
    expect(job.request.receipt).toMatchObject({ operation: "generate", native: { frames: 121 } });
    expect(creationOfFile(actor.id, job.files[0]!.id)?.receipt_ids).toEqual([job.stackJob!]);
    await until(() => fake.jobs.every((item) => item.deleted));
  });

  test("a Stack with no receipt (404) or a receipt route that fails (500) never fails the clip: it is made, kept and the Stack's copy deleted", async () => {
    for (const receipt of [null, "fail"] as const) {
      fake.receipt = receipt;
      const actor = (db.select().from(peopleTable).where(eq(peopleTable.displayName, "Sage")).get() as PersonRow | undefined) ?? await owner();
      const job = await done(actor, (await makeClip(actor, `a paper boat ${String(receipt)}`)).id);
      expect(job.state).toBe("done"); expect(job.files.length).toBeGreaterThan(0);
      expect(job.request.receipt).toBeUndefined();
      expect(creationOfFile(actor.id, job.files[0]!.id)?.receipt_ids ?? []).toEqual([]);
    }
    await until(() => fake.jobs.every((item) => item.deleted));
    expect(fake.jobs.every((item) => item.deleted)).toBe(true);
  });

  test("each shot of a film keeps its own receipt (one job, one receipt, one record)", async () => {
    fake.receipt = RECEIPT;
    const actor = await owner();
    const jobs = [];
    for (const shot of ["shot one", "shot two"]) jobs.push(await done(actor, (await makeClip(actor, shot)).id));
    const ids = jobs.map((job) => job.stackJob!);
    expect(new Set(ids).size).toBe(2);
    for (const job of jobs) {
      expect(job.request.receipt!.job_id).toBe(job.stackJob);
      expect(creationOfFile(actor.id, job.files[0]!.id)?.receipt_ids).toEqual([job.stackJob!]);
    }
  });
});
