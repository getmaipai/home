import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import sharp from "sharp";
import { db } from "@/db";
import { newPersonId } from "@/lib/id";
import { attachments, people, videoJobs } from "@/db/schema";
import { storeFile } from "@/lib/attachments";
import { createMediaProduction, getMediaProduction, shareMediaProduction } from "@/lib/mediaProductions";
import { __setAgeCheckRunnerForTests } from "@/lib/pictures/ageCheck";
import { runGenerateVideo } from "@/lib/videos/tool";
import { resetDb } from "./reset-db";
import { installFakeVideoStack } from "./videoFixture";
import { until } from "./pictureFixture";
import { createBenchPeople } from "../scripts/bench/conversationRunner";

describe("generate_video Production shot clips", () => {
  let owner: ReturnType<typeof createBenchPeople>["owner"];
  let fake: ReturnType<typeof installFakeVideoStack>;
  let productionId: string;
  const shotId = "shot-1";
  beforeEach(() => {
    resetDb(); owner = createBenchPeople().owner; fake = installFakeVideoStack();
    __setAgeCheckRunnerForTests(async (images) => images.map(() => ({ ok: true as const, verdict: { people_count: 0, apparent_min_age_estimate: null, label: "none" as const, is_nude_or_sexual: false, confidence: 1 } })));
    productionId = createMediaProduction(owner, { title: "Moon", episodes: [{ id: "ep", scenes: [{ id: "scene", shots: [{ id: shotId, subject_ids: [] }] }] }] }).id;
  });
  afterEach(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); fake.restore(); });
  async function picture(color = "blue") {
    const bytes = new Uint8Array(await sharp({ create: { width: 32, height: 32, channels: 3, background: color } }).png().toBuffer());
    const saved = storeFile(owner, { conversationId: null, turnId: null, mediaType: "image/png", bytes, provenance: "picture-gen:{\"v\":1,\"audience\":\"all-ages\",\"width\":32,\"height\":32}", deduplicate: false, retention: "kept" });
    if (!saved.ok) throw new Error("picture"); return saved.value.id;
  }
  async function call(args: Record<string, unknown>, actor: typeof owner = owner) {
    return runGenerateVideo({ state: { actor, temporary: false, conversationId: null, turnId: null }, args: { prompt: "A moonlit boat sails", production: productionId, shot: shotId, ...args }, callId: "c", spoken: false, audience: { actor, band: actor.role === "child" ? "child" : "adult", surface: "chat", surfaceClass: "written", spoken: false } as never });
  }
  test("finished clip records its Library id on the shot", async () => {
    const result = await call({}); expect(result.status).toBe("succeeded");
    await until(() => db.select().from(videoJobs).all().some((job) => job.state === "done"));
    const job = db.select().from(videoJobs).all()[0]!; const fileId = (JSON.parse(job.files) as Array<{ id: string }>)[0]!.id;
    expect(getMediaProduction(owner, productionId)?.episodes[0]?.scenes[0]?.shots[0]?.clip_file_id).toBe(fileId);
  }, 15000);
  test("one target id refuses before Stack", async () => { await call({ shot: "" }); expect(fake.submitted).toHaveLength(0); });
  test("shared person, guest and child refuse before Stack", async () => {
    const now = new Date().toISOString();
    const add = (id: string, role: string) => { db.insert(people).values({ id, displayName: id, role, avatarSeed: id, source: "local", createdAt: now, updatedAt: now, hlc: "1:0:test" }).run(); return db.select().from(people).all().find((p) => p.id === id)!; };
    const shared = add("viewer", "adult"); const guest = add("guest-viewer", "guest"); const child = db.select().from(people).all().find((p) => p.role === "child")!;
    shareMediaProduction(owner, productionId, shared.id, true);
    await call({}, shared as typeof owner); await call({}, guest as typeof owner); await call({}, child as typeof owner);
    expect(fake.submitted).toHaveLength(0);
  });
  test("unknown shot refuses", async () => { await call({ shot: "missing" }); expect(fake.submitted).toHaveLength(0); });
  test("shot picture starts the video and explicit from_picture wins", async () => {
    const first = await picture(); const prod = getMediaProduction(owner, productionId)!;
    const { updateMediaProduction } = await import("@/lib/mediaProductions");
    updateMediaProduction(owner, productionId, { episodes: [{ ...prod.episodes[0]!, scenes: [{ ...prod.episodes[0]!.scenes[0]!, shots: [{ id: shotId, subject_ids: [], picture_file_id: first }] }] }] });
    await call({}); await until(() => fake.submitted.length === 1); expect(fake.submitted[0]?.image).toBeTruthy();
    fake.restore(); fake = installFakeVideoStack();
    const second = await picture("red");
    const { createAttachment } = await import("@/lib/attachments");
    const chat = (await import("@/lib/conversationHistory")).resolveOrCreateConversation(owner, "chat"); if (!chat.ok) throw new Error("conversation");
    const turnId = (await import("@/lib/id")).newConversationTurnId();
    db.insert((await import("@/db/schema")).conversationTurns).values({ id: turnId, personId: owner.id, surface: "chat", conversationId: chat.value.id, userText: "make", replyText: "ok", source: "model", safetyAction: "allow", createdAt: new Date().toISOString(), hlc: "1:0:test" }).run();
    const attached = storeFile(owner, { conversationId: chat.value.id, turnId, mediaType: "image/png", bytes: new Uint8Array(await sharp({ create: { width: 32, height: 32, channels: 3, background: "red" } }).png().toBuffer()), provenance: "picture-gen:{\"v\":1,\"audience\":\"all-ages\"}", deduplicate: false, retention: "kept" }); if (!attached.ok) throw new Error("picture");
    await runGenerateVideo({ state: { actor: owner, temporary: false, conversationId: chat.value.id, turnId, }, args: { prompt: "A boat sails", production: productionId, shot: shotId, from_picture: attached.value.id }, callId: "c", spoken: false, audience: { actor: owner, band: "adult", surface: "chat", surfaceClass: "written", spoken: false } as never });
    expect(JSON.parse(db.select().from(videoJobs).all().at(-1)!.request).source_file_id).toBe(attached.value.id);
  }, 15000);
  test("failed job writes nothing", async () => { fake.failWith = { code: "failed", error: "failed" }; await call({}); await until(() => db.select().from(videoJobs).all().some((job) => job.state === "failed")); expect(getMediaProduction(owner, productionId)?.episodes[0]?.scenes[0]?.shots[0]?.clip_file_id).toBeUndefined(); });
  test("a later targeted take replaces the shot clip id", async () => {
    const make = async () => { const before = db.select().from(videoJobs).all().filter((job) => job.state === "done").length; await call({}); await until(() => db.select().from(videoJobs).all().filter((job) => job.state === "done").length > before); };
    await make(); const first = getMediaProduction(owner, productionId)?.episodes[0]?.scenes[0]?.shots[0]?.clip_file_id;
    fake.restore(); fake = installFakeVideoStack(); await make(); const second = getMediaProduction(owner, productionId)?.episodes[0]?.scenes[0]?.shots[0]?.clip_file_id;
    expect(first).toBeTruthy(); expect(second).toBeTruthy(); expect(second).not.toBe(first);
  }, 15000);
});
