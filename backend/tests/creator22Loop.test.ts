import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resetDb } from "./reset-db";
import { TestClient } from "./client";
import { storeFile } from "@/lib/attachments";
import sharp from "sharp";
import { db } from "@/db";
import { people } from "@/db/schema";
import { eq } from "drizzle-orm";
import { __setAgeCheckRunnerForTests } from "@/lib/pictures/ageCheck";
import { installFakeVideoStack, type FakeVideoStack } from "./videoFixture";
import { __setVideoStatusForTests, readyVideoStatusForTests } from "@/lib/videos/ready";
import { evaluateClipSeries } from "@/lib/videos/frameCheck";

let fake: FakeVideoStack;
beforeEach(() => { resetDb(); fake = installFakeVideoStack(); });
afterEach(() => { fake.restore(); __setVideoStatusForTests(undefined); });

async function setup() {
  const owner = new TestClient();
  await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const res = await owner.post("/api/people", { displayName: "Marlow", role: "adult", secret: "0000" });
  const personId = (await res.json() as { id: string }).id;
  const client = new TestClient();
  await client.post("/api/auth/verify-secret", { personId, secret: "0000" });
  const actor = db.select().from(people).where(eq(people.id, personId)).get()!;
  __setAgeCheckRunnerForTests(async (images) => images.map(() => ({ ok: true as const, verdict: { people_count: 0, apparent_min_age_estimate: null, label: "none" as const, is_nude_or_sexual: false, confidence: 1 } })));
  return { client, actor };
}

describe("CREATOR-22 loop", () => {
  test("sets the end image to the start picture", async () => {
    const { client, actor } = await setup();
    const png = new Uint8Array(await sharp({ create: { width: 64, height: 64, channels: 3, background: "blue" } }).png().toBuffer());
    const saved = storeFile(actor, { conversationId: null, turnId: null, mediaType: "image/png", bytes: png, provenance: "composer:upload", retention: "kept", deduplicate: false });
    if (!saved.ok) throw new Error(saved.error);
    const pictureId = saved.value.id;
    __setVideoStatusForTests(readyVideoStatusForTests({ ltx25: "ready", ltx25Picture: true }));
    const made = await client.post("/api/plugins/video/actions/make", { prompt: "A paper boat circles", start_frame: pictureId, loop: true });
    expect(made.status).toBe(200);
    expect(fake.submitted[0]!.end_image).toBe(fake.submitted[0]!.image);
  });
  test("refuses without a start, without end_image support, or with end_frame", async () => {
    const { client, actor } = await setup();
    const png = new Uint8Array(await sharp({ create: { width: 32, height: 32, channels: 3, background: "blue" } }).png().toBuffer());
    const saved = storeFile(actor, { conversationId: null, turnId: null, mediaType: "image/png", bytes: png, provenance: "composer:upload", retention: "kept", deduplicate: false });
    if (!saved.ok) throw new Error(saved.error);
    const pictureId = saved.value.id;
    __setVideoStatusForTests(readyVideoStatusForTests({ ltx25: "ready", ltx25Picture: true }));
    const missingStart = await client.post("/api/videos/make", { prompt: "A paper boat circles", loop: true });
    expect(missingStart.status).toBe(422);
    const conflict = await client.post("/api/videos/make", { prompt: "A paper boat circles", loop: true, end_frame: "other" });
    expect(conflict.status).toBe(422);
    __setVideoStatusForTests(readyVideoStatusForTests({ ltx25: "ready" }));
    const missingCapability = await client.post("/api/videos/make", { prompt: "A paper boat circles", start_frame: pictureId, loop: true });
    expect(missingCapability.status).toBe(422);
    expect(fake.submitted).toHaveLength(0);
  });
  test("loop seam finding has the requested words for either result", () => {
    const series = { fps: 24, luma: [80, 80, 80], diff: [4, 4], sharpness: [1, 1] };
    expect(evaluateClipSeries(series, { loop: true, seamSsim: 0.95 }).findings).not.toContainEqual(expect.objectContaining({ code: "loop_seam" }));
    expect(evaluateClipSeries(series, { loop: true, seamSsim: 0.85 }).findings).toContainEqual(expect.objectContaining({ code: "loop_seam", message: "The loop seam may be visible." }));
  });
});
