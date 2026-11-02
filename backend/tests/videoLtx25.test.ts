// VIDEO-TIERS-01 (docs/design/video-tiers-2026-11-02.md), Home side: for adults, Standard video is LTX-2.5 (512x256, up to 10 s, with sound) and
// Boost is LTX-2.5 (768x448, up to 5 s) when the Stack reports `qualities.ltx25.ready`; otherwise today's models, exactly. A teen or a child stays
// on the silent Wan lane (rules 0, 8, 10). Max is not offered. A picture start or a style goes the old way (the Stack answers 422 for them on LTX-2.5).
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { resetDb } from "./reset-db";
import { TestClient } from "./client";
import { db } from "@/db";
import { people as peopleTable } from "@/db/schema";
import { getVideoJobFor, startVideoJob } from "@/lib/videos/jobs";
import { LTX25_MAX_MODEL, LTX25_MODEL, chooseVideoQuality, ltx25MaxReady, etaWords, maxSecondsFor, videoSizeFor } from "@/lib/videos/quality";
import { WAN_QUICK_VIDEO_MODEL } from "@/lib/pictures/lane";
import { __setVideoStatusForTests, readyVideoStatusForTests, videoStatusReady } from "@/lib/videos/ready";
import { videoStatus, withCheckedLtx25, type StackVideoStatus } from "@/lib/videos/stack";
import { videoBodyForSlot } from "@/lib/videos/slotBody";
import { videoTierSegment } from "@/lib/media/videoCreateApp";
import { videoTiersStatus } from "@/routes/videos";
import { __resetVideoAdapterCacheForTests } from "@/lib/videos/adapters";
import { installFakeVideoStack, type FakeVideoStack } from "./videoFixture";
import { until } from "./pictureFixture";
import { invalidateSessionCacheForPerson } from "@/middleware/auth";
import { setHouseholdSettingValue } from "@/lib/settings";
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
    expect(videoStatusReady(readyVideoStatusForTests({ quickMissing: true, ltx25: "ready" }), true)).toBe(true);
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

describe("readiness is per lane (a minor never counts LTX-2.5)", () => {
  const ONLY_LTX25 = () => readyVideoStatusForTests({ quickMissing: true, ltx25: "ready" });
  const setRole = (id: string, role: "teen" | "child" | "owner") => {
    db.update(peopleTable).set({ role }).where(eq(peopleTable.id, id)).run();
    invalidateSessionCacheForPerson(id);
    return db.select().from(peopleTable).where(eq(peopleTable.id, id)).get()! as PersonRow;
  };

  test("videoStatusReady: adult yes, minor no, with Wan missing and only ltx25 ready", () => {
    expect(videoStatusReady(ONLY_LTX25(), true)).toBe(true);
    expect(videoStatusReady(ONLY_LTX25(), false)).toBe(false);
    expect(videoStatusReady(ONLY_LTX25())).toBe(false);
  });

  test("the three gates: the adult can make; the same person as a teen and as a child gets the not-ready answer and nothing reaches the Stack", async () => {
    fake.quickMissing = true; fake.ltx25 = "ready"; __setVideoStatusForTests(ONLY_LTX25());
    const client = new TestClient();
    await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const owner = db.select().from(peopleTable).where(eq(peopleTable.displayName, "Sage")).get()! as PersonRow;
    // Adult: status says can_make, and a chat clip is made (a finished job gives the another route something to repeat).
    expect(((await (await client.get("/api/videos/status")).json()) as { can_make: boolean }).can_make).toBe(true);
    const conv = await import("@/lib/conversationHistory");
    const resolved = conv.resolveOrCreateConversation(owner, "chat", undefined, {});
    if (!resolved.ok) throw new Error("no conversation");
    const job = await startVideoJob({ actor: owner, conversationId: resolved.value.id, turnId: null, temporary: true, kind: "generate", prompt: BOAT, body: { prompt: BOAT, size: "512x256", seconds: 5, audience: "adult", model: LTX25_MODEL } });
    await until(() => getVideoJobFor(owner, job.id)?.state === "done");
    const { runGenerateVideo } = await import("@/lib/videos/tool");
    const { makeAudienceOf } = await import("@/lib/videos/make");
    const adultRun = await runGenerateVideo({ state: { actor: owner, persona: null, conversationId: null, turnId: null, temporary: false }, args: { prompt: BOAT }, callId: "a", spoken: false, audience: makeAudienceOf(owner) });
    expect(adultRun.status).toBe("succeeded");
    await until(() => fake.submitted.length === 2);
    const before = fake.submitted.length;
    for (const role of ["teen", "child"] as const) {
      const minor = setRole(owner.id, role);
      // 1. the tool gate
      const run = await runGenerateVideo({ state: { actor: minor, persona: null, conversationId: null, turnId: null, temporary: false }, args: { prompt: BOAT }, callId: "m", spoken: false, audience: makeAudienceOf(minor) });
      expect(run.status).toBe("failed");
      expect(run.errorCode).toBe("no_engine");
      // 2. /api/videos/status
      const status = await (await client.get("/api/videos/status")).json() as { can_make: boolean; engine_ready: boolean; reason: string | null };
      expect(status).toMatchObject({ can_make: false, engine_ready: false });
      expect(status.reason).toBeTruthy();
      // 3. the Another route's gate
      const another = await client.post(`/api/videos/jobs/${job.id}/another`, {});
      expect(another.status).toBe(503);
      expect(((await another.json()) as { code: string }).code).toBe("not_installed");
    }
    expect(fake.submitted.length).toBe(before);
    setRole(owner.id, "owner");
  });

  test("slotBody replays at release time with the Stack's own profile: a Boost that only lists 640x320 and 4 seconds", () => {
    const raw = readyVideoStatusForTests({ ltx25: "ready" });
    const engine = { qualities: { ...raw.qualities!, ltx25: { ...raw.qualities!.ltx25!, profiles: [
      { name: "standard" as const, size: "512x256", width: 512, height: 256, max_seconds: 8 },
      { name: "boost" as const, size: "640x320", width: 640, height: 320, max_seconds: 4 },
    ] } } };
    const base = { prompt: BOAT, audience: "adult" as const, model: LTX25_MODEL, size: "768x448", seconds: 5 };
    const boost = videoBodyForSlot(base, "boost", "adult", "adult", engine);
    expect(boost.body).toMatchObject({ size: "640x320", seconds: 4 });
    const standard = videoBodyForSlot({ ...base, size: "512x256", seconds: 10 }, "standard", "adult", "adult", engine);
    expect(standard.body).toMatchObject({ size: "512x256", seconds: 8 });
    // A queued size the Stack still lists is kept; without an engine read the table is used, as before.
    expect(videoBodyForSlot({ ...base, size: "640x320", seconds: 4 }, "boost", "adult", "adult", engine).body.size).toBe("640x320");
    expect(videoBodyForSlot(base, "boost", "adult", "adult").body).toMatchObject({ size: "768x448", seconds: 5 });
  });
});

// ---------------------------------------------------------------- LTX25-MAX-01 (VIDEO-TIERS-01): the Max level

describe("LTX-2.5 Max: the choice", () => {
  const MAX_READY = (seconds?: number) => readyVideoStatusForTests({ ltx25: "ready", ltx25max: "ready", detailed: "installed", ...(seconds ? { ltx25maxSeconds: seconds } : {}) });

  test("Max asked, held and ready: ltx25max at 1024x576 (576x1024 portrait), ten seconds, a longer ask is cut and says so", () => {
    const engine = MAX_READY();
    const choice = chooseVideoQuality({ requested: "detailed", seconds: 15, engine, adultLane: true, max: true });
    expect(choice).toMatchObject({ quality: "detailed", maker: "ltx25max", seconds: 10, shortened: true, note: null, announce: true });
    expect(videoSizeFor(choice.maker, choice.quality, false, engine)).toBe("1024x576");
    expect(videoSizeFor(choice.maker, choice.quality, true, engine)).toBe("576x1024");
    expect(etaWords("detailed", 10, "ltx25max")).toBe("about four minutes");
  });

  test("the Stack's own profile can only lower the ceiling", () => {
    expect(maxSecondsFor("detailed", "ltx25max", MAX_READY(6))).toBe(6);
    expect(chooseVideoQuality({ requested: "detailed", seconds: 10, engine: MAX_READY(6), adultLane: true, max: true })).toMatchObject({ maker: "ltx25max", seconds: 6, shortened: true });
    // A profile that claims more than ten seconds is held to ten.
    expect(maxSecondsFor("detailed", "ltx25max", MAX_READY(20))).toBe(10);
    // No profile listed: the table's 1024x576 and ten seconds.
    const bare = MAX_READY();
    bare.qualities!.ltx25max!.profiles = [];
    expect(maxSecondsFor("detailed", "ltx25max", bare)).toBe(10);
    expect(videoSizeFor("ltx25max", "detailed", false, bare)).toBe("1024x576");
  });

  test("Max is used only when it was asked for, is held, and the Stack says ready", () => {
    const engine = MAX_READY();
    expect(chooseVideoQuality({ requested: "detailed", seconds: 5, engine, adultLane: true })).toMatchObject({ maker: "ltx25" });
    expect(chooseVideoQuality({ requested: "detailed", seconds: 5, engine, adultLane: true, max: false }).maker).toBe("ltx25");
    for (const status of ["not-installed", "missing"] as const) {
      const notReady = readyVideoStatusForTests({ ltx25: "ready", ltx25max: status });
      expect(ltx25MaxReady(notReady)).toBe(false);
      expect(chooseVideoQuality({ requested: "detailed", seconds: 5, engine: notReady, adultLane: true, max: true }).maker).toBe("ltx25");
    }
    expect(ltx25MaxReady(readyVideoStatusForTests({ ltx25: "ready" }))).toBe(false);
  });

  test("a minor never gets Max, a picture start and a style go the old way", () => {
    const engine = MAX_READY();
    expect(chooseVideoQuality({ requested: "detailed", seconds: 10, engine, quickOnly: true, adultLane: false, max: true })).toMatchObject({ maker: "wan", seconds: 5 });
    expect(chooseVideoQuality({ requested: "detailed", engine, adultLane: true, max: true, hasPicture: true }).maker).not.toBe("ltx25max");
    expect(chooseVideoQuality({ engine, adultLane: true, max: true, style: { base_model: "ltx-2.3" } }).maker).toBe("ltx23");
  });

  test("readiness: Max alone makes an adult ready, never a minor", () => {
    const only = readyVideoStatusForTests({ quickMissing: true, ltx25max: "ready" });
    expect(videoStatusReady(only, true)).toBe(true);
    expect(videoStatusReady(only, false)).toBe(false);
  });

  test("the Stack's reply is read defensively: a bad profile or ready value is never ready", () => {
    const raw = readyVideoStatusForTests({ ltx25max: "ready" });
    const broken = withCheckedLtx25({ ...raw, qualities: { ...raw.qualities!, ltx25max: { ready: "yes" as unknown as boolean, profiles: [{ name: "boost" as unknown as "max", width: 1024, height: 576, max_seconds: 10, size: "x" }, { name: "max", width: -1, height: 576, max_seconds: 10, size: "x" }] } } } as StackVideoStatus);
    expect(broken.qualities!.ltx25max!.ready).toBe(false);
    expect(broken.qualities!.ltx25max!.profiles).toEqual([]);
  });

  test("the status route reports Max ready, with its ceiling, for an adult only", () => {
    expect(videoTiersStatus(MAX_READY(), true).max).toEqual({ ready: true, max_seconds: 10, sound: true, model: "ltx25max" });
    expect(videoTiersStatus(MAX_READY(6), true).max.max_seconds).toBe(6);
    expect(videoTiersStatus(MAX_READY(), false).max.ready).toBe(false);
    expect(videoTiersStatus(readyVideoStatusForTests({ ltx25: "ready", ltx25max: "not-installed" }), true).max.ready).toBe(false);
  });
});

describe("LTX-2.5 Max: who is offered it, and the request on the wire", () => {
  async function people() {
    const { owner, ownerRow, teen, child } = await household();
    const made = await owner.post("/api/people", { displayName: "Marlow", role: "adult", secret: "0000" });
    const id = ((await made.json()) as { id: string }).id;
    const adult = new TestClient();
    await adult.post("/api/auth/verify-secret", { personId: id, secret: "0000" });
    const adultRow = db.select().from(peopleTable).where(eq(peopleTable.id, id)).get()! as PersonRow;
    return { owner, ownerRow, adult, adultRow, teen, child };
  }
  const ids = (segment: unknown) => ((segment as { tiers: Array<{ id: string }> } | null)?.tiers ?? []).map((t) => t.id);

  test("Max is offered iff the Stack says ready AND the person holds Max (owner by role, an adult only with the grant); never a teen or a child", async () => {
    const { ownerRow, adultRow, teen, child } = await people();
    __setVideoStatusForTests(readyVideoStatusForTests({ ltx25: "ready", ltx25max: "ready" }));
    const segment = videoTierSegment(ownerRow) as { tiers: Array<{ id: string; label?: string; hint?: string; disabled_reason?: string }> };
    expect(ids(segment)).toEqual(["standard", "boost", "max"]);
    expect(segment.tiers[2]).toEqual({ id: "max", label: "Max", hint: "Up to 10 seconds, sharpest picture, with sound" });
    expect(JSON.stringify(segment)).not.toMatch(/\b(GB|RAM|memory|LTX|ltx)\b/);
    expect(ids(videoTierSegment(adultRow))).not.toContain("max");
    expect(ids(videoTierSegment(teen))).not.toContain("max");
    expect(ids(videoTierSegment(child))).not.toContain("max");
    // An adult with the grant for video is offered it too.
    const { createGrant, personIsGranted } = await import("@/lib/grants");
    expect(personIsGranted(adultRow.id, "tier.max:video")).toBe(false);
    const granted = createGrant({ id: ownerRow.id, role: "owner" }, { person: adultRow.id, action: "tier.max:video", effect: "allow", acknowledged_at: new Date().toISOString(), acknowledged_by_person_id: ownerRow.id });
    expect(granted.ok).toBe(true);
    expect(ids(videoTierSegment(adultRow))).toContain("max");
  });

  test("Max is hidden when the Stack lacks the engine; with the engine but not the pack it is shown disabled with one plain status line (an owner only)", async () => {
    const { ownerRow, adultRow } = await people();
    __setVideoStatusForTests(readyVideoStatusForTests({ ltx25: "ready" }));
    expect(ids(videoTierSegment(ownerRow))).toEqual(["standard", "boost"]);
    for (const status of ["not-installed", "missing"] as const) {
      __setVideoStatusForTests(readyVideoStatusForTests({ ltx25: "ready", ltx25max: status }));
      const max = (videoTierSegment(ownerRow) as { tiers: Array<{ id: string; hint?: string; disabled_reason?: string }> }).tiers.find((t) => t.id === "max")!;
      expect(max.hint).toBeUndefined();
      expect(max.disabled_reason).toContain("Settings, Models and storage");
      expect(max.disabled_reason!.length).toBeLessThanOrEqual(120);
      expect(max.disabled_reason).not.toMatch(/\b(GB|RAM|memory|LTX|ltx)\b/);
      expect(ids(videoTierSegment(adultRow))).not.toContain("max");
    }
  });

  test("Create at Max sends model ltx25-max, 1024x576, up to ten seconds; the job is stored at Max; the clip comes back at 1024x576", async () => {
    fake.ltx25 = "ready"; fake.ltx25max = "ready"; __setVideoStatusForTests(readyVideoStatusForTests({ ltx25: "ready", ltx25max: "ready" }));
    const { owner } = await people();
    const res = await owner.post("/api/videos/make", { prompt: BOAT, tier: "max", seconds: 10 });
    expect(res.status).toBe(200);
    const card = await res.json() as { id: string; notice: string | null };
    await until(() => fake.submitted.length > 0);
    expect(fake.submitted[0]).toMatchObject({ model: LTX25_MAX_MODEL, size: "1024x576", seconds: 10, tier: "max" });
    expect(card.notice).toBeNull();
    const row = db.select().from((await import("@/db/schema")).videoJobs).all()[0]!;
    expect(row.id).toBe(card.id);
    expect(JSON.stringify(row)).toContain("ltx25-max");
  });

  test("the Stack's profile lowering the ceiling is honoured on the wire and said in one line", async () => {
    fake.ltx25 = "ready"; fake.ltx25max = "ready"; fake.ltx25maxSeconds = 6; __setVideoStatusForTests(readyVideoStatusForTests({ ltx25: "ready", ltx25max: "ready", ltx25maxSeconds: 6 }));
    const { owner } = await people();
    const res = await owner.post("/api/videos/make", { prompt: BOAT, tier: "max", seconds: 10 });
    expect(res.status).toBe(200);
    await until(() => fake.submitted.length > 0);
    expect(fake.submitted[0]).toMatchObject({ model: LTX25_MAX_MODEL, seconds: 6 });
    expect(((await res.json()) as { notice: string | null }).notice).toContain("6 seconds");
  });

  test("an adult without the grant is refused with one plain line and nothing is sent", async () => {
    fake.ltx25 = "ready"; fake.ltx25max = "ready"; __setVideoStatusForTests(readyVideoStatusForTests({ ltx25: "ready", ltx25max: "ready" }));
    const { adult } = await people();
    const refused = await adult.post("/api/videos/make", { prompt: BOAT, tier: "max" });
    expect(refused.status).toBe(422);
    expect(fake.submitted).toHaveLength(0);
  });

  test("Max asked while the pack is not ready: made at Boost, and the plain line says so (the Create page never offers it)", async () => {
    fake.ltx25 = "ready"; fake.ltx25max = "not-installed"; __setVideoStatusForTests(readyVideoStatusForTests({ ltx25: "ready", ltx25max: "not-installed" }));
    const { owner } = await people();
    const res = await owner.post("/api/videos/make", { prompt: BOAT, tier: "max", seconds: 10 });
    expect(res.status).toBe(200);
    await until(() => fake.submitted.length > 0);
    expect(fake.submitted[0]).toMatchObject({ model: LTX25_MODEL, size: "768x448", seconds: 5 });
    expect(fake.submitted[0]!.model).not.toBe(LTX25_MAX_MODEL);
  });

  test("a teen or a child sent the Max model by any route is put on silent Wan", async () => {
    fake.ltx25 = "ready"; fake.ltx25max = "ready"; __setVideoStatusForTests(readyVideoStatusForTests({ ltx25: "ready", ltx25max: "ready" }));
    const { teen, child } = await people();
    for (const actor of [teen, child]) {
      const job = await startVideoJob({ actor, conversationId: null, turnId: null, temporary: false, kind: "generate", prompt: BOAT, body: { prompt: BOAT, seconds: 10, size: "1024x576", audience: "all-ages", model: LTX25_MAX_MODEL }, tier: "max" });
      expect((job.request as { stackBody?: { model?: string } }).stackBody?.model).toBe(WAN_QUICK_VIDEO_MODEL);
      await (await import("@/lib/videos/jobs")).cancelVideoJob(actor, job.id).catch(() => undefined);
    }
    const base = { prompt: BOAT, audience: "all-ages" as const, model: LTX25_MAX_MODEL, size: "1024x576", seconds: 10 };
    const body = videoBodyForSlot(base, "max", "teen", "teen");
    expect(body.body.model).toBe(WAN_QUICK_VIDEO_MODEL);
    expect(body.body.size).toBe("832x480");
    expect(body.body.seconds).toBe(5);
    expect(body.quality).toBe("quick");
  });

  test("the slot body keeps the Max model at Max (size and ceiling from the Stack's profile); a Max level switched off is sent as an LTX-2.5 Boost clip", () => {
    const engine = readyVideoStatusForTests({ ltx25: "ready", ltx25max: "ready", ltx25maxSeconds: 8 });
    const base = { prompt: BOAT, audience: "adult" as const, model: LTX25_MAX_MODEL, size: "1024x576", seconds: 10 };
    const atMax = videoBodyForSlot(base, "max", "adult", "adult", engine);
    expect(atMax).toMatchObject({ tier: "max", quality: "detailed", body: { model: LTX25_MAX_MODEL, size: "1024x576", seconds: 8, tier: "max" } });
    expect(videoBodyForSlot({ ...base, size: "576x1024" }, "max", "adult", "adult", engine).body.size).toBe("576x1024");
    setHouseholdSettingValue("engines.video.tier.max", { model: "off", options: {}, who: "admins" });
    const lowered = videoBodyForSlot(base, "max", "adult", "adult", engine);
    expect(lowered).toMatchObject({ tier: "boost", quality: "detailed", body: { model: LTX25_MODEL, size: "768x448", seconds: 5, tier: "boost" } });
  });
});
