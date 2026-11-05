import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import sharp from "sharp";
import { db } from "@/db";
import { attachments, conversationTurns } from "@/db/schema";
import { storeFile } from "@/lib/attachments";
import { resolveOrCreateConversation } from "@/lib/conversationHistory";
import { newConversationTurnId } from "@/lib/id";
import { __setAgeCheckRunnerForTests } from "@/lib/pictures/ageCheck";
import { CHILD_NO_PHOTOS_LINE } from "@/lib/pictures/lane";
import { runGenerateVideo } from "@/lib/videos/tool";
import { resetDb } from "./reset-db";
import { installFakeVideoStack } from "./videoFixture";
import { until } from "./pictureFixture";
import { __setVideoStatusForTests, readyVideoStatusForTests } from "@/lib/videos/ready";
import { createBenchPeople } from "../scripts/bench/conversationRunner";

describe("generate_video end frame", () => {
  let owner: ReturnType<typeof createBenchPeople>["owner"];
  let fake: ReturnType<typeof installFakeVideoStack>;
  let conversationId: string;
  let turnId: string;
  beforeEach(() => {
    resetDb(); owner = createBenchPeople().owner; fake = installFakeVideoStack(); __setVideoStatusForTests(readyVideoStatusForTests({ ltx25: "ready", ltx25Picture: true }));
    __setAgeCheckRunnerForTests(async (images) => images.map(() => ({ ok: true as const, verdict: { people_count: 0, apparent_min_age_estimate: null, label: "none" as const, is_nude_or_sexual: false, confidence: 1 } })));
    const c = resolveOrCreateConversation(owner, "chat"); if (!c.ok) throw new Error("conversation"); conversationId = c.value.id;
    turnId = newConversationTurnId();
    db.insert(conversationTurns).values({ id: turnId, personId: owner.id, surface: "chat", conversationId, userText: "make a video", replyText: "ok", source: "model", safetyAction: "allow", createdAt: new Date().toISOString(), hlc: "1:0:test" }).run();
  });
  afterEach(async () => { await new Promise((r) => setTimeout(r, 50)); fake.restore(); });
  // ADULT-LOCK-07: an adult-only picture is locked unless its lock is cleared; this helper clears it so the tool can read it.
  async function picture(color: string, audience = "all-ages", lock?: "on" | "off") {
    const bytes = new Uint8Array(await sharp({ create: { width: 32, height: 32, channels: 3, background: color } }).png().toBuffer());
    const file = storeFile(owner, { conversationId, turnId, mediaType: "image/png", bytes, provenance: `picture-gen:${JSON.stringify({ v: 1, audience, ...(lock ? { lock } : audience === "adult-only" ? { lock: "off" } : {}) })}`, deduplicate: false, retention: "kept" });
    if (!file.ok) throw new Error("picture"); return file.value.id;
  }
  async function call(args: Record<string, unknown>, actor = owner) { return runGenerateVideo({ state: { actor, temporary: false, conversationId, turnId }, args: { prompt: "A boat sails", ...args }, callId: "c", spoken: false, audience: { actor, band: actor.role === "child" ? "child" : "adult", surface: "chat", surfaceClass: "written", spoken: false } as never }); }
  test("sends both distinct pictures on LTX-2.5 and records end provenance", async () => {
    const start = await picture("red"); const end = await picture("blue");
    const result = await call({ from_picture: start, end_frame: end });
    expect(result.status).toBe("succeeded");
    await until(() => fake.submitted.length === 1);
    expect(fake.submitted).toHaveLength(1); expect(fake.submitted[0]?.model).toBe("ltx25-q8"); expect(fake.submitted[0]?.image).toBeTruthy(); expect(fake.submitted[0]?.end_image).toBeTruthy();
    const row = db.select().from((await import("@/db/schema")).videoJobs).all()[0]!; expect(JSON.parse(row.request).end_file_id).toBe(end);
  });
  test("requires a start picture", async () => { const end = await picture("blue"); await call({ end_frame: end }); expect(fake.submitted).toHaveLength(0); });
  test("refuses when no LTX-2.5 level supports an ending picture", async () => { const start = await picture("red"); const end = await picture("blue"); __setVideoStatusForTests(readyVideoStatusForTests({ ltx25: "ready" })); await call({ from_picture: start, end_frame: end }); expect(fake.submitted).toHaveLength(0); });
  test("children refuse end frames", async () => { const end = await picture("blue"); const child = db.select().from((await import("@/db/schema")).people).all().find((p) => p.role === "child")!; await call({ from_picture: "attached", end_frame: end }, child as typeof owner); expect(fake.submitted).toHaveLength(0); });
  test("refuses the same picture at both ends", async () => { const start = await picture("red"); await call({ from_picture: start, end_frame: start }); expect(fake.submitted).toHaveLength(0); });
  test("a locked adult-only ending picture is refused without an unlock", async () => { const start = await picture("red"); const end = await picture("blue", "adult-only", "on"); await call({ from_picture: start, end_frame: end }); expect(fake.submitted).toHaveLength(0); });
  test("adult-only ending picture makes the job adult-only", async () => { const start = await picture("red"); const end = await picture("blue", "adult-only"); await call({ from_picture: start, end_frame: end }); const row = db.select().from((await import("@/db/schema")).videoJobs).all()[0]!; expect(JSON.parse(row.request).adultOnly).toBe(true); expect(fake.submitted[0]?.audience).toBe("adult"); });
});
