// LONGTAKE-01: the plan is pure; the run uses the fake video and edit Stacks (no network): parts continue from each other, the parts are joined and kept.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { resetDb } from "./reset-db";
import { TestClient } from "./client";
import { db } from "@/db";
import { people } from "@/db/schema";
import { __setAgeCheckRunnerForTests } from "@/lib/pictures/ageCheck";
import { __setKeyframesForTests } from "@/lib/pictures/keyframes";
import { __setVideoStatusForTests, readyVideoStatusForTests } from "@/lib/videos/ready";
import { __resetVideoAdapterCacheForTests } from "@/lib/videos/adapters";
import { CONTINUITY, TAKE_TOO_MUCH_LINE, MAX_TAKE_SECONDS, decodeParams, encodeParams, partPrompt, planParts, startLongTake, takeProgress } from "@/lib/videos/longTake";
import { installFakeVideoStack, testJpeg, type FakeVideoStack } from "./videoFixture";
import { installFakeEditStack, type FakeEditStack } from "./videoEditStackFixture";
import { until } from "./pictureFixture";
import type { PersonRow } from "@/types";

describe("planParts and partPrompt", () => {
  test("a length within one part is not a long take", () => {
    const r = planParts(10, "standard"); expect(r.ok).toBe(false);
    expect(planParts(5, "boost").ok).toBe(false);
  });
  test("parts are the length over the level's ceiling, rounded up, with an even share", () => {
    expect(planParts(20, "standard")).toEqual({ ok: true, parts: 2, perPart: 10 });
    expect(planParts(25, "standard")).toEqual({ ok: true, parts: 3, perPart: 8 });
    expect(planParts(30, "boost")).toEqual({ ok: true, parts: 6, perPart: 5 });
  });
  test("more than one unbroken take allows is refused and points to a film", () => {
    const r = planParts(MAX_TAKE_SECONDS + 1, "standard"); expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.line).toContain(String(MAX_TAKE_SECONDS)); expect(r.line).toContain("film"); }
    expect(planParts(MAX_TAKE_SECONDS, "standard")).toEqual({ ok: true, parts: 4, perPart: 10 });
  });
  test("part 1 is the words as written; later parts add the continuity sentence and their beat", () => {
    const p = { prompt: "A fox walks through snow.", beats: ["It stops at a frozen stream.", "It drinks."] };
    expect(partPrompt(p, 0)).toBe("A fox walks through snow. It stops at a frozen stream.");
    expect(partPrompt(p, 1)).toBe(`It drinks. ${CONTINUITY}`);
    expect(partPrompt(p, 2)).toBe(`A fox walks through snow. ${CONTINUITY}`);
    expect(partPrompt({ prompt: "A fox walks through snow.", beats: [] }, 0)).toBe("A fox walks through snow.");
  });
  test("parameters round trip, and a take whose parameters would not fit the summary is refused, not cut off", () => {
    const params = { v: 1 as const, prompt: "A fox.", beats: ["a"], tier: "standard" as const, parts: 2, per_part: 10 };
    const enc = encodeParams(params); expect(enc.ok).toBe(true);
    if (enc.ok) expect(decodeParams(enc.summary)).toEqual(params);
    expect(encodeParams({ ...params, prompt: "x".repeat(1200), beats: ["y".repeat(400), "z".repeat(400)] })).toEqual({ ok: false, line: TAKE_TOO_MUCH_LINE });
  });
});

let video: FakeVideoStack; let stack: FakeEditStack;
beforeEach(() => {
  resetDb(); __resetVideoAdapterCacheForTests();
  video = installFakeVideoStack(); video.ltx25 = "ready"; video.ltx25max = "ready";
  __setVideoStatusForTests(readyVideoStatusForTests({ ltx25: "ready", ltx25max: "ready", ltx25Picture: true, ltx25maxPicture: true }));
  __setAgeCheckRunnerForTests(async (images) => images.map(() => ({ ok: true as const, verdict: { adult: false } as never })));
  __setKeyframesForTests(async () => [testJpeg(), testJpeg(), testJpeg()]);
  stack = installFakeEditStack();
});
afterEach(() => { stack.restore(); video.restore(); __setKeyframesForTests(null); __setVideoStatusForTests(undefined); });
function person(role: string): PersonRow {
  const now = new Date().toISOString(), id = `person-${role}take`;
  db.insert(people).values({ id, displayName: role, role, avatarSeed: role, source: "local", createdAt: now, updatedAt: now, hlc: "1:0:test" }).run();
  return db.select().from(people).where(eq(people.id, id)).get() as PersonRow;
}

describe("startLongTake", () => {
  test("a child and a guest are refused with the usual line", () => {
    for (const role of ["child", "guest"]) {
      const r = startLongTake(person(role), { prompt: "A fox walks through snow.", seconds: 20 });
      expect(r.ok).toBe(false); if (!r.ok) expect(r.status).toBe(403);
    }
  });
  test("an adult asking for 20 s makes two parts that are joined into one kept clip", async () => {
    const adult = person("owner");
    const started = startLongTake(adult, { prompt: "A fox walks through snow.", seconds: 20 });
    expect(started).toMatchObject({ ok: true, parts: 2, per_part: 10 });
    if (!started.ok) return;
    await until(() => takeProgress(adult, started.id)?.state === "done" || takeProgress(adult, started.id)?.state === "failed", 20000);
    const progress = takeProgress(adult, started.id)!;
    expect(progress.error_line).toBeNull();
    expect(progress).toMatchObject({ state: "done", parts_done: 2, parts_total: 2 });
    expect(progress.file_id).toBeTruthy();
    const ops = stack.jobs.flatMap((j) => j.input.ops.map((o) => o.op));
    expect(ops).toContain("frame");   // the last picture of part 1 started part 2
    expect(ops).toContain("concat");  // the parts were joined with a cut
    expect(video.submitted.length).toBeGreaterThanOrEqual(2);
  });
  test("a part whose frames are black is made once more with a new seed, and the take still finishes", async () => {
    const black = new Uint8Array(await sharp({ create: { width: 64, height: 64, channels: 3, background: "#000" } }).jpeg().toBuffer());
    __setKeyframesForTests(async () => (video.submitted.length === 1 ? [black, black, black] : [testJpeg(), testJpeg(), testJpeg()]));
    const adult = person("owner");
    const started = startLongTake(adult, { prompt: "A fox walks through snow.", seconds: 20 });
    if (!started.ok) throw new Error(started.line);
    await until(() => ["done", "failed"].includes(takeProgress(adult, started.id)?.state ?? ""), 20000);
    expect(takeProgress(adult, started.id)).toMatchObject({ state: "done", parts_done: 2 });
    expect(video.submitted.length).toBe(3);   // part 1, part 1 again, part 2
  });
  test("the routes: nobody is 401, a minute-long ask past the limit is 422", async () => {
    expect((await new TestClient().post("/api/videos/long", { prompt: "A fox.", seconds: 20 })).status).toBe(401);
    const client = new TestClient();
    await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    expect((await client.post("/api/videos/long", { prompt: "A fox walks through snow.", seconds: 240 })).status).toBe(422);
    expect((await client.get("/api/videos/long/none")).status).toBe(404);
  });
});
