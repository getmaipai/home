// TIER-PIC-01: a picture job runs the model of its level slot, and the level travels to the Stack. The slot is read when the job is sent
// (`pictures/slotBody.ts`, the pattern of `videos/slotBody.ts`), so the body carries `tier` and `model`, and the job record keeps the level it ran at.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resetDb } from "./reset-db";
import { setHouseholdSettingValue } from "@/lib/settings";
import { createBenchPeople, type BenchPeople } from "../scripts/bench/conversationRunner";
import { getPictureJob, startPictureJob, __resetPictureJobsForTests } from "@/lib/pictures/jobs";
import { __setPictureStatusForTests, readyStatusForTests, TEST_PICTURE_PART } from "@/lib/pictures/ready";
import { chooseQuality } from "@/lib/pictures/quality";
import { RECOMMENDED_MAX_IMAGE_MODEL, jobTier, maxAvailable, slotKey, MAX_NOT_ON_THIS_COMPUTER_LINE, authorizeTier, type Tier } from "@/lib/tiers";
import { installFakeImageStack, until, type FakeImageStack } from "./pictureFixture";

let people: BenchPeople;
let fake: FakeImageStack;

const model = (id: string) => ({ id, family: id.split("-")[0]!, installed: true, licence: "Apache-2.0", loras: true, edit: false, steps_default: 8, peak_gb: 20 });
const KLEIN = model(TEST_PICTURE_PART);
const ZIMAGE = model(TEST_PICTURE_PART);
const QWEN = model(RECOMMENDED_MAX_IMAGE_MODEL);
const slot = (tier: Tier, value: string) => setHouseholdSettingValue(slotKey("image", tier), { model: value, options: {} });

beforeEach(() => {
  resetDb();
  people = createBenchPeople();
  fake = installFakeImageStack();
  __setPictureStatusForTests(readyStatusForTests({ models: [KLEIN, ZIMAGE] }));
});
afterEach(() => { __resetPictureJobsForTests(); fake.restore(); __setPictureStatusForTests(undefined); });

/** Queues one picture at `tier`, waits for the Stack to receive it and returns what it received and the stored job. */
async function send(tier: Tier | undefined, body: Record<string, unknown> = {}, actor = people.owner) {
  const before = fake.submitted.length;
  const job = await startPictureJob({ actor, conversationId: null, turnId: null, temporary: true, kind: "generate", prompt: "a red fox", ...(tier ? { tier } : {}), body: { prompt: "a red fox", size: "1024x1024", n: 1, audience: "adult", ...body } as never });
  await until(() => fake.submitted.length > before);
  return { sent: fake.submitted.at(-1)!, job: getPictureJob(actor, job.id)! };
}

describe("TIER-PIC-01 a picture runs its level slot", () => {
  test("(a) a Boost slot the household pinned sends that part and tier boost", async () => {
    slot("boost", TEST_PICTURE_PART);
    const { sent, job } = await send("boost");
    expect(sent.model).toBe(TEST_PICTURE_PART);
    expect(sent.tier).toBe("boost");
    expect(job.request.tier).toBe("boost");
    expect(job.request.lowered).toBeUndefined();
  });

  test("a Boost slot left on recommended names no part (the Stack picks) and still sends the level", async () => {
    const { sent } = await send("boost");
    expect(sent.model).toBeUndefined();
    expect(sent.tier).toBe("boost");
  });

  test("(b) a Boost slot switched off runs at Standard and names no part, lowered", async () => {
    slot("boost", "off");
    const { sent, job } = await send("boost");
    expect(sent.model).toBeUndefined();
    expect(sent.tier).toBeUndefined();
    expect(job.request.tier).toBeUndefined();
    expect(job.request.lowered).toBe(true);
    expect(job.request.quality).toBe("quick");
  });

  test("(c) Max with Qwen-Image installed sends the Max model and tier max", async () => {
    __setPictureStatusForTests(readyStatusForTests({ models: [KLEIN, ZIMAGE, QWEN] }));
    expect(maxAvailable("image")).toBe(true);
    expect(jobTier("image", "max", "detailed")).toBe("max");
    const { sent, job } = await send("max");
    expect(sent.model).toBe(RECOMMENDED_MAX_IMAGE_MODEL);
    expect(sent.tier).toBe("max");
    expect(job.request.tier).toBe("max");
  });

  test("(c) a Max slot pinned to another model sends that model", async () => {
    slot("max", "big-picture");
    const { sent } = await send("max");
    expect(sent.model).toBe("big-picture");
    expect(sent.tier).toBe("max");
  });

  test("(d) Max without Qwen-Image runs at Boost with the Boost slot's part and keeps the line", async () => {
    expect(maxAvailable("image")).toBe(false);
    expect(jobTier("image", "max", "detailed")).toBe("boost");
    const { sent, job } = await send("max");
    expect(sent.model).toBeUndefined();
    expect(sent.tier).toBe("boost");
    expect(job.request.tier).toBe("boost");
    expect(job.request.lowered).toBe(true);
    expect(job.request.line).toBe(MAX_NOT_ON_THIS_COMPUTER_LINE);
  });

  test("(e) a child's picture never exceeds Standard whatever the slots say", async () => {
    __setPictureStatusForTests(readyStatusForTests({ models: [KLEIN, ZIMAGE, QWEN] }));
    slot("boost", TEST_PICTURE_PART);
    slot("max", RECOMMENDED_MAX_IMAGE_MODEL);
    expect(authorizeTier({ person: people.child, category: "image", requested: "max" }).tier).toBe("standard");
    const { sent, job } = await send("max", { audience: "all-ages" }, people.child);
    expect(sent.tier).toBeUndefined();
    expect(sent.model).toBeUndefined();
    expect(job.request.tier).toBeUndefined();
  });

  test("a Standard picture is sent as it was queued, with no level", async () => {
    const { sent, job } = await send(undefined);
    expect(sent.tier).toBeUndefined();
    expect(sent.model).toBeUndefined();
    expect(job.request.lowered).toBeUndefined();
  });

  test("(f) Quick is Standard, Detailed is Boost, both on the part the Stack picks", () => {
    expect(chooseQuality({ requested: "quick" }).quality).toBe("quick");
    // One part serves both levels: Detailed asked for is the same part at the Boost level, not a second maker.
    expect(chooseQuality({ requested: "detailed" })).toMatchObject({ quality: "quick" });
    expect(jobTier("image", "boost", "quick")).toBe("standard");
    expect(jobTier("image", "boost", "detailed")).toBe("boost");
  });
});
