import { describe, expect, test } from "bun:test";
import { planBeatCut } from "@/lib/videos/beatCut";
import { afterEach, beforeEach } from "bun:test";
import { resetDb } from "./reset-db";
import { db } from "@/db";
import { people, attachments } from "@/db/schema";
import { eq } from "drizzle-orm";
import { createAttachment } from "@/lib/attachments";
import { newConversationTurnId } from "@/lib/id";
import { logTurn, resolveOrCreateConversation } from "@/lib/conversationHistory";
import { runGenerateVideo } from "@/lib/videos/tool";
import { runEditVideo } from "@/lib/videos/editTool";
import { getVideoJobFor } from "@/lib/videos/jobs";
import { getVideoJobByFileFor } from "@/lib/videos/jobs";
import { __setAgeCheckRunnerForTests } from "@/lib/pictures/ageCheck";
import { __setKeyframesForTests } from "@/lib/pictures/keyframes";
import { __setVideoStatusForTests, readyVideoStatusForTests } from "@/lib/videos/ready";
import { installFakeVideoStack, testJpeg } from "./videoFixture";
import { installFakeEditStack, type FakeEditStack } from "./videoEditStackFixture";
import { until } from "./pictureFixture";
import type { PersonRow } from "@/types";
import type { TurnState } from "@/lib/turnMachine/contract";
import { __setMusicFetchForTests } from "@/lib/music/stack";
import { attachmentFilePath } from "@/lib/attachments";
import { writeFileSync } from "node:fs";
import { TestClient } from "./client";

let fakeVideo: ReturnType<typeof installFakeVideoStack>; let fakeEdit: FakeEditStack;
beforeEach(() => { resetDb(); fakeVideo = installFakeVideoStack(); fakeVideo.detailed = "installed"; __setVideoStatusForTests(readyVideoStatusForTests({ detailed: "installed" })); __setAgeCheckRunnerForTests(async (images) => images.map(() => ({ ok: true as const, verdict: { people_count: 1, apparent_min_age_estimate: 99, label: "adult", is_nude_or_sexual: false, confidence: 0.99 } }))); __setKeyframesForTests(async () => [testJpeg(), testJpeg(), testJpeg()]); fakeEdit = installFakeEditStack(); });
afterEach(() => { fakeEdit.restore(); fakeVideo.restore(); __setVideoStatusForTests(undefined); __setKeyframesForTests(null); __setMusicFetchForTests(null); });

let personN = 0;
function actor(role = "owner"): PersonRow { const now = new Date().toISOString(); const id = `person-beat${role}${++personN}`; db.insert(people).values({ id, displayName: role, role, avatarSeed: role, source: "local", createdAt: now, updatedAt: now, hlc: "1:0:test" }).run(); return db.select().from(people).where(eq(people.id, id)).get() as PersonRow; }
function chat(a: PersonRow): TurnState { const conv = resolveOrCreateConversation(a, "chat", undefined, { temporary: false }); if (!conv.ok) throw new Error("no conversation"); const turnId = newConversationTurnId(); logTurn(a, "chat", "make video", { reply: { text: "ok" }, source: "plugin", plugin_id: "generate_video", routing: { tier: "tool", score: 1 }, safety: { flagged: false, categories: [], action: "allow", notify_parent: false, matched_signals: [], checked_at: new Date().toISOString() }, conversation_id: conv.value.id, turn_id: turnId }); return { actor: a, surface: "chat", turnId, conversationId: conv.value.id, temporary: false, planBasis: { surfaceClass: "written" }, context: [], utterance: "make video", persona: null, crisis: false } as unknown as TurnState; }

async function beatReady(ready = true) { const beat = { tempo_bpm: 120, meter: 4, beats: Array.from({ length: 80 }, (_, i) => i * 0.5), downbeats: [0, 2, 4, 6], sections: [], confidence: 0.9, downbeat_confidence: 0.8, duration_s: 40, engine: "librosa" }; __setMusicFetchForTests((async (req: string | URL | Request, init?: RequestInit) => { const path = new URL(typeof req === "string" ? req : req instanceof URL ? req.href : req.url).pathname; if (path === "/stack/v1/beats") return Response.json({ beats: { available: ready, state: ready ? "idle" : "not-installed", ready } }); if (path === "/v1/audio/beats" && init?.method === "POST") return Response.json({ job: "beat-job", data: beat }, { status: 200 }); if (path === "/v1/audio/beats/beat-job" && init?.method === "DELETE") return Response.json({}); return Response.json({ state: "done", data: beat }); }) as typeof fetch); }
async function makeClip(a: PersonRow) { const state = chat(a); const made = await runGenerateVideo({ state, args: { prompt: "A tiny paper boat on water" }, callId: "make", spoken: false }); const id = (made.result?.data as { videoJobId: string }).videoJobId; await until(() => getVideoJobFor(a, id)?.state === "done"); return { job: getVideoJobFor(a, id)!, state: chat(a) }; }
async function track(a: PersonRow, state: TurnState, adult = false) { const bytes = new Uint8Array(5000).fill(3); const file = createAttachment(a, { conversationId: state.conversationId!, turnId: state.turnId!, mediaType: "audio/mp4", bytes, provenance: adult ? '{"audience":"adult-only"}' : undefined, deduplicate: false }); if (!file.ok) throw new Error("track save failed"); const row = db.select().from(attachments).where(eq(attachments.id, file.value.id)).get()!; writeFileSync(attachmentFilePath(row.storagePath), bytes); return file.value.id; }

const grid = (n: number) => Array.from({ length: n }, (_, i) => i * 0.5);

describe("beat cut planning", () => {
  test("starts at the first downbeat and cuts four beats apart on a 120 BPM grid", () => {
    const p = planBeatCut({ beats: grid(80), downbeats: [0], beatsPerCut: 4, lengthS: 8, clipSeconds: [null] });
    expect(p.ok).toBe(true);
    if (p.ok) { expect(p.segments[0]?.length).toBe(0); expect(p.segments.slice(1).map((s) => s.length)).toEqual([2, 2, 2, 2]); }
  });
  test("caps segments by increasing the beat interval", () => {
    const p = planBeatCut({ beats: grid(400), downbeats: [0], beatsPerCut: 1, lengthS: 60, clipSeconds: [null] });
    expect(p.ok && p.segments.length).toBeLessThanOrEqual(16);
    expect(p.ok && p.beatsPerCut).toBeGreaterThan(1);
  });
  test("wraps each clip cursor and refuses a segment longer than its clip", () => {
    const p = planBeatCut({ beats: grid(20), downbeats: [0], beatsPerCut: 4, lengthS: 8, clipSeconds: [3] });
    expect(p.ok && p.segments[2]?.inS).toBe(0);
    const short = planBeatCut({ beats: grid(20), downbeats: [0], beatsPerCut: 8, lengthS: 8, clipSeconds: [2] });
    expect(short.ok).toBe(false);
  });
  test("refuses sparse beats and accepts unknown clip length", () => {
    expect(planBeatCut({ beats: [0, 1, 2], downbeats: [], beatsPerCut: 4, lengthS: 8, clipSeconds: [null] }).ok).toBe(false);
    expect(planBeatCut({ beats: grid(20), downbeats: [0], beatsPerCut: 4, lengthS: 4, clipSeconds: [null] }).ok).toBe(true);
  });

  test("minor refusal and missing track happen before any Stack request", async () => {
    await beatReady(); const child = actor("child"); const state = chat(child); const noTrack = await runEditVideo({ state, args: { clip: "latest", change: "cut_to_beat" }, callId: "x", spoken: false }); expect(noTrack.result?.data).toHaveProperty("refused");
    const owner = actor("owner"); const adultState = chat(owner); const missing = await runEditVideo({ state: adultState, args: { clip: "latest", change: "cut_to_beat" }, callId: "x", spoken: false }); expect(missing.result?.data).toHaveProperty("refused"); expect(fakeEdit.jobs).toHaveLength(0);
  });

  test("beat cut creates a job with per-segment trims then concat, mute and a bounded song overlay", async () => {
    await beatReady(); const a = actor(); const made = await makeClip(a); const id = await track(a, made.state);
    const result = await runEditVideo({ state: made.state, args: { clip: "latest", change: "cut_to_beat", track: id, beats_per_cut: 4, length_s: 5 }, callId: "cut", spoken: false });
    const jobId = (result.result?.data as { videoJobId: string }).videoJobId; expect(jobId).toBeTruthy();
    await until(() => getVideoJobFor(a, jobId)?.state === "done");
    expect(fakeEdit.jobs.length).toBeGreaterThanOrEqual(2);
    expect(fakeEdit.jobs.slice(0, -1).every((j) => j.input.ops[0]?.op === "trim")).toBe(true);
    const final = fakeEdit.jobs.at(-1)!;
    expect(final.input.ops.at(0)).toEqual({ op: "concat", with: final.input.inputs.slice(1, -1).map((_, i) => i + 1) });
    expect(final.input.ops.slice(1).map((op) => op.op)).toEqual(["mute", "audio_overlay"]);
    expect(final.input.ops.at(-1)).toMatchObject({ op: "audio_overlay", input: final.input.inputs.length - 1, gain_db: 0, clip_gain_db: -60, start_s: 0, duck: false, end_s: 4 });
  });
});

describe("cut-to-beat route", () => {
  test("accepts a Library file id and defaults the chat to the clip's conversation", async () => {
    await beatReady(); const client = new TestClient(); await client.post("/api/auth/setup", { displayName: "Beat Owner", secret: "correcthorse" });
    const a = db.select().from(people).where(eq(people.displayName, "Beat Owner")).get() as PersonRow;
    const made = await makeClip(a); const song = await track(a, made.state);
    const response = await client.post("/api/videos/cut-to-beat", { clips: [made.job.files[0]!.id], track: song, length_s: 15 });
    expect(response.status).toBe(200);
    const card = await response.json() as { conversation_id: string | null };
    expect(card.conversation_id).toBe(made.job.conversationId);
    expect(getVideoJobByFileFor(a, made.job.files[0]!.id)?.id).toBe(made.job.id);
  });

  test("a child receives the minor refusal", async () => {
    const ownerClient = new TestClient(); await ownerClient.post("/api/auth/setup", { displayName: "Route Owner", secret: "correcthorse" });
    const made = await ownerClient.post("/api/people", { displayName: "Route Child", role: "child", secret: "0000", birthdate: "2018-03-01" });
    const child = await made.json() as { id: string };
    const client = new TestClient(); await client.post("/api/auth/verify-secret", { personId: child.id, secret: "0000" });
    const response = await client.post("/api/videos/cut-to-beat", { clips: ["anything"], track: "anything" });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: "minor", error: "This edit is for adults on their own screen." });
  });
});
