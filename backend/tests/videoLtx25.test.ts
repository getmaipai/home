// VIDEO-TIERS-01 (docs/design/video-tiers-2026-11-02.md), Home side: for adults, Standard video is LTX-2.5 (512x256, up to 10 s, with sound) and
// Boost is LTX-2.5 (768x448, up to 5 s) when the Stack reports `qualities.ltx25.ready`; otherwise today's models, exactly. A teen or a child stays
// on the silent Wan lane (rules 0, 8, 10). Max is not offered. A picture start or a style goes the old way (the Stack answers 422 for them on LTX-2.5).
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { resetDb } from "./reset-db";
import { TestClient } from "./client";
import { db } from "@/db";
import { people as peopleTable } from "@/db/schema";
import { startVideoJob } from "@/lib/videos/jobs";
import { LTX25_MODEL, chooseVideoQuality, etaWords, maxSecondsFor, videoSizeFor } from "@/lib/videos/quality";
import { WAN_QUICK_VIDEO_MODEL } from "@/lib/pictures/lane";
import { __setVideoStatusForTests, readyVideoStatusForTests, videoStatusReady } from "@/lib/videos/ready";
import { videoStatus, withCheckedLtx25, type StackVideoStatus } from "@/lib/videos/stack";
import { videoBodyForSlot } from "@/lib/videos/slotBody";
import { videoTierSegment } from "@/lib/media/videoCreateApp";
import { videoTiersStatus } from "@/routes/videos";
import { __resetVideoAdapterCacheForTests } from "@/lib/videos/adapters";
import { installFakeVideoStack, type FakeVideoStack } from "./videoFixture";
import { until } from "./pictureFixture";
import type { PersonRow } from "@/types";

let fake: FakeVideoStack;
beforeEach(() => { resetDb(); __resetVideoAdapterCacheForTests(); fake = installFakeVideoStack(); });
afterEach(() => { fake.restore(); __setVideoStatusForTests(undefined); });

const READY = () => readyVideoStatusForTests({ ltx25: "ready", detailed: "installed" });
const NOT_READY = () => readyVideoStatusForTests({ ltx25: "missing", detailed: "installed" });
const BOAT = "A paper boat floats down a rainy street, soft evening light";

async function household() {
  const owner = new TestClient();
  await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const made = await owner.post("/api/people", { displayName: "Nova", role: "teen", secret: "0000", birthdate: "2011-03-01" });
  const teenId = ((await made.json()) as { id: string }).id;
  const madeChild = await owner.post("/api/people", { displayName: "Sprout", role: "child", secret: "0000", birthdate: "2018-03-01" });
  const childId = ((await madeChild.json()) as { id: string }).id;
  const row = (id: string) => db.select().from(peopleTable).where(eq(peopleTable.id, id)).get()! as PersonRow;
  const ownerRow = db.select().from(peopleTable).where(eq(peopleTable.displayName, "Sage")).get()! as PersonRow;
  return { owner, ownerRow, teen: row(teenId), child: row(childId) };
}

describe("the choice (quality.ts)", () => {
  test("adult Standard with LTX-2.5 ready: ltx25 at 512x256, 10 seconds, not shortened", () => {
    const engine = READY();
    const choice = chooseVideoQuality({ requested: "quick", seconds: 10, engine, adultLane: true });
    expect(choice).toMatchObject({ quality: "quick", maker: "ltx25", seconds: 10, shortened: false, note: null });
    expect(videoSizeFor(choice.maker, choice.quality, false, engine)).toBe("512x256");
    expect(videoSizeFor(choice.maker, choice.quality, true, engine)).toBe("256x512");
  });

  test("a length past five with nothing asked stays Standard on ltx25 (Boost is five seconds there)", () => {
    expect(chooseVideoQuality({ seconds: 8, engine: READY(), household: "quick", adultLane: true })).toMatchObject({ quality: "quick", maker: "ltx25", seconds: 8 });
    expect(chooseVideoQuality({ seconds: 8, engine: READY(), household: "detailed", adultLane: true })).toMatchObject({ quality: "quick", maker: "ltx25", seconds: 8 });
  });

  test("adult Boost on ltx25: the larger Boost size, five seconds, a ten second ask is cut and says so", () => {
    const engine = READY();
    const choice = chooseVideoQuality({ requested: "detailed", seconds: 10, engine, adultLane: true });
    expect(choice).toMatchObject({ quality: "detailed", maker: "ltx25", seconds: 5, shortened: true });
    expect(videoSizeFor(choice.maker, choice.quality, false, engine)).toBe("768x448");
    expect(maxSecondsFor("detailed", "ltx25", engine)).toBe(5);
    expect(maxSecondsFor("quick", "ltx25", engine)).toBe(10);
  });

  test("ltx25 not ready: exactly today's models (Wan Standard 5 s, LTX-2.3 Boost 10 s)", () => {
    for (const engine of [NOT_READY(), readyVideoStatusForTests({ detailed: "installed" })]) {
      expect(chooseVideoQuality({ requested: "quick", seconds: 10, engine, adultLane: true })).toMatchObject({ quality: "quick", maker: "wan", seconds: 5, shortened: true });
      expect(chooseVideoQuality({ requested: "detailed", seconds: 10, engine, adultLane: true })).toMatchObject({ quality: "detailed", maker: "ltx23", seconds: 10, shortened: false });
      expect(videoSizeFor("wan", "quick", false, engine)).toBe("832x480");
    }
  });

  test("a teen or a child (quickOnly, not adultLane) never gets ltx25, whatever was asked", () => {
    const choice = chooseVideoQuality({ requested: "detailed", seconds: 10, engine: READY(), quickOnly: true, adultLane: false });
    expect(choice).toMatchObject({ quality: "quick", maker: "wan", seconds: 5 });
    // Even a call that wrongly says adultLane while quickOnly is only ever Standard (no tier choice for a minor).
    expect(chooseVideoQuality({ requested: "detailed", engine: READY(), quickOnly: true }).maker).toBe("wan");
  });

  test("a picture start and a style go the old way", () => {
    const engine = READY();
    const picture = chooseVideoQuality({ requested: "quick", seconds: 5, engine, adultLane: true, hasPicture: true });
    expect(picture).toMatchObject({ quality: "quick", maker: "wan", note: "picture_needs_quick" });
    expect(chooseVideoQuality({ requested: "detailed", engine, adultLane: true, hasPicture: true })).toMatchObject({ quality: "quick", maker: "wan", note: "picture_needs_quick" });
    expect(chooseVideoQuality({ engine, adultLane: true, style: { base_model: "wan2.2-ti2v-5b" } })).toMatchObject({ quality: "quick", maker: "wan" });
    expect(chooseVideoQuality({ engine, adultLane: true, style: { base_model: "ltx-2.3" } })).toMatchObject({ quality: "detailed", maker: "ltx23" });
  });

  test("the ETA words and the status ceilings", () => {
    expect(etaWords("quick", 10, "ltx25")).toBe("about a minute");
    expect(etaWords("quick", 5)).toBe("about two minutes");
    const adult = videoTiersStatus(READY(), true);
    expect(adult.standard).toEqual({ ready: true, max_seconds: 10, sound: true, model: "ltx25" });
    expect(adult.boost).toEqual({ ready: true, max_seconds: 5, sound: true, model: "ltx25" });
    expect(adult.max.ready).toBe(false);
    expect(videoTiersStatus(READY(), false)).toMatchObject({ standard: { model: "wan", sound: false, max_seconds: 5 }, boost: { ready: false } });
    expect(videoTiersStatus(NOT_READY(), true)).toMatchObject({ standard: { model: "wan" }, boost: { model: "ltx23", max_seconds: 10 } });
    expect(videoStatusReady(readyVideoStatusForTests({ quickMissing: true, ltx25: "ready" }))).toBe(true);
  });
});

describe("the Stack's status (a fake Stack)", () => {
  test("qualities.ltx25 is read: ready, profiles with true sizes", async () => {
    fake.ltx25 = "ready";
    const status = (await videoStatus())!;
    const ltx = status.qualities!.ltx25!;
    expect(ltx.ready).toBe(true);
    expect(ltx.profiles!.map((p) => `${p.name} ${p.size} ${p.max_seconds}`)).toEqual(["standard 512x256 10", "boost 640x320 5", "boost 768x448 5"]);
  });

  test("a Stack without ltx25 reads as before; a half-written reply is never ready", async () => {
    expect((await videoStatus())!.qualities?.ltx25).toBeUndefined();
    const raw = readyVideoStatusForTests({ ltx25: "ready" });
    const broken = withCheckedLtx25({ ...raw, qualities: { ...raw.qualities!, ltx25: { ready: "yes" as unknown as boolean, profiles: [{ name: "boost", width: -1, height: 320, max_seconds: 5, size: "x" }, { name: "huge" as unknown as "boost", width: 1, height: 1, max_seconds: 1, size: "1x1" }] } } } as StackVideoStatus);
    expect(broken.qualities!.ltx25!.ready).toBe(false);
    expect(broken.qualities!.ltx25!.profiles).toEqual([]);
    fake.ltx25 = "missing";
    expect((await videoStatus())!.qualities!.ltx25!.ready).toBe(false);
  });
});

describe("the request on the wire", () => {
  async function made(body: Record<string, unknown>) {
    const { owner } = await household();
    const res = await owner.post("/api/videos/make", body);
    expect(res.status).toBe(200);
    await until(() => fake.submitted.length > 0);
    return { sent: fake.submitted[0]!, card: await res.json() as { notice: string | null } };
  }

  test("adult Standard, ltx25 ready: model ltx25-q8, 512x256, 10 seconds allowed", async () => {
    fake.ltx25 = "ready"; __setVideoStatusForTests(READY());
    const { sent, card } = await made({ prompt: BOAT, tier: "standard", seconds: 10 });
    expect(sent).toMatchObject({ model: LTX25_MODEL, size: "512x256", seconds: 10, audience: expect.any(String) });
    expect(card.notice).toBeNull();
  });

  test("adult Boost, ltx25 ready: 768x448 and five seconds, the cut is said in one plain line", async () => {
    fake.ltx25 = "ready"; __setVideoStatusForTests(READY());
    const { sent, card } = await made({ prompt: BOAT, tier: "boost", seconds: 10 });
    expect(sent).toMatchObject({ model: LTX25_MODEL, size: "768x448", seconds: 5, tier: "boost" });
    expect(card.notice).toContain("5 seconds");
  });

  test("ltx25 not ready: Standard falls back to Wan at five seconds (no model field)", async () => {
    fake.ltx25 = "missing"; __setVideoStatusForTests(NOT_READY());
    const { sent } = await made({ prompt: BOAT, tier: "standard", seconds: 10 });
    expect(sent.model).toBeUndefined();
    expect(sent).toMatchObject({ size: "832x480", seconds: 5 });
  });

  test("ltx25 not ready: Boost is LTX-2.3 Detailed at ten seconds", async () => {
    fake.detailed = "installed"; fake.ltx25 = "missing"; __setVideoStatusForTests(NOT_READY());
    const { sent } = await made({ prompt: BOAT, tier: "boost", seconds: 10 });
    expect(sent).toMatchObject({ model: "detailed", size: "768x448", seconds: 10 });
  });

  test("a start picture falls back to the old Wan path even when ltx25 is ready", async () => {
    // The chat/Create picture routes load a Library picture first; the choice itself is proven above, so here the sent body is checked through the job starter.
    fake.ltx25 = "ready"; __setVideoStatusForTests(READY());
    const { ownerRow } = await household();
    const job = await startVideoJob({ actor: ownerRow, conversationId: null, turnId: null, temporary: false, kind: "animate", prompt: BOAT, sourceFileId: "pic", body: { prompt: BOAT, seconds: 5, audience: "adult", image: "AAAA", image_source: "uploaded" } });
    expect((job.request as { stackBody?: { model?: string } }).stackBody?.model).toBeUndefined();
  });
});

describe("minors and Max", () => {
  test("a teen and a child asked for ltx25 are sent the silent Wan model; the stored request is Standard", async () => {
    fake.ltx25 = "ready"; __setVideoStatusForTests(READY());
    const { teen, child } = await household();
    for (const actor of [teen, child]) {
      const job = await startVideoJob({ actor, conversationId: null, turnId: null, temporary: false, kind: "generate", prompt: BOAT, body: { prompt: BOAT, seconds: 5, size: "512x256", audience: "all-ages", model: LTX25_MODEL }, tier: "boost" });
      expect((job.request as { stackBody?: { model?: string } }).stackBody?.model).toBe(WAN_QUICK_VIDEO_MODEL);
      expect(job.request.quality).toBe("quick");
      __setVideoStatusForTests(READY());
      await until(() => fake.submitted.length > 0);
      fake.submitted.length = 0;
      await (await import("@/lib/videos/jobs")).cancelVideoJob(actor, job.id).catch(() => undefined);
    }
  });

  test("the slot body keeps ltx25 for an adult and puts a minor on Wan", () => {
    const base = { prompt: BOAT, audience: "adult" as const, model: LTX25_MODEL, size: "512x256", seconds: 10 };
    const adult = videoBodyForSlot(base, "standard", "adult", "adult");
    expect(adult).toMatchObject({ tier: "standard", quality: "quick", body: { model: LTX25_MODEL, size: "512x256", seconds: 10 } });
    const boost = videoBodyForSlot({ ...base, size: "768x448", seconds: 8 }, "boost", "adult", "adult");
    expect(boost).toMatchObject({ tier: "boost", quality: "detailed", body: { model: LTX25_MODEL, size: "768x448", seconds: 5, tier: "boost" } });
    const teen = videoBodyForSlot({ ...base, audience: "all-ages" }, "standard", "teen", "teen");
    expect(teen.body.model).toBe(WAN_QUICK_VIDEO_MODEL);
    expect(teen.body.seconds).toBe(5);
    expect(teen.quality).toBe("quick");
  });

  test("Max is not offered: the segment has Standard and Boost only, the status says Max is not ready", async () => {
    __setVideoStatusForTests(READY());
    const { ownerRow } = await household();
    const segment = videoTierSegment(ownerRow) as { tiers: Array<{ id: string; hint: string }> };
    expect(segment.tiers.map((t) => t.id)).toEqual(["standard", "boost"]);
    expect(segment.tiers[0]!.hint).toBe("Up to 10 seconds, with sound");
    expect(segment.tiers[1]!.hint).toBe("Up to 5 seconds, with sound");
    __setVideoStatusForTests(NOT_READY());
    const old = videoTierSegment(ownerRow) as { tiers: Array<{ id: string; hint: string }> };
    expect(old.tiers.map((t) => t.hint)).toEqual(["Up to 5 seconds", "Up to 10 seconds, with sound"]);
  });

  test("/api/videos/status reports each level", async () => {
    fake.ltx25 = "ready"; __setVideoStatusForTests(READY());
    const { owner } = await household();
    const body = await (await owner.get("/api/videos/status")).json() as { tiers: { standard: { max_seconds: number; sound: boolean }; boost: { max_seconds: number }; max: { ready: boolean } } };
    expect(body.tiers.standard).toMatchObject({ max_seconds: 10, sound: true });
    expect(body.tiers.boost.max_seconds).toBe(5);
    expect(body.tiers.max.ready).toBe(false);
  });
});
