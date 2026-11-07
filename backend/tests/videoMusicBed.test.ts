import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { installFakeMusicStack } from "./musicFixture";
import { __setMusicStatusForTests, readyMusicStatusForTests } from "@/lib/music/ready";
import { getMusicJobFor } from "@/lib/music/jobs";
import { __setMusicPollMsForTests } from "@/lib/music/jobs";
import { __setMusicBedPollMsForTests } from "@/lib/videos/musicBed";
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

let fakeMusic: ReturnType<typeof installFakeMusicStack> | undefined;
let fakeVideo: ReturnType<typeof installFakeVideoStack>; let fakeEdit: FakeEditStack;
beforeEach(() => { __setMusicBedPollMsForTests(20); __setMusicPollMsForTests(20); resetDb(); fakeVideo = installFakeVideoStack(); fakeVideo.ltx25 = "ready"; __setVideoStatusForTests(readyVideoStatusForTests({ ltx25: "ready" })); __setAgeCheckRunnerForTests(async (images) => images.map(() => ({ ok: true as const, verdict: { people_count: 1, apparent_min_age_estimate: 99, label: "adult", is_nude_or_sexual: false, confidence: 0.99 } }))); __setKeyframesForTests(async () => [testJpeg(), testJpeg(), testJpeg()]); fakeEdit = installFakeEditStack(); });
afterEach(() => { fakeMusic?.restore(); __setMusicStatusForTests(undefined); __setMusicBedPollMsForTests(null); __setMusicPollMsForTests(null); fakeEdit.restore(); fakeVideo.restore(); __setVideoStatusForTests(undefined); __setKeyframesForTests(null); __setMusicFetchForTests(null); });
let personN = 0;
function actor(role = "owner"): PersonRow { const now = new Date().toISOString(); const id = `person-beat${role}${++personN}`; db.insert(people).values({ id, displayName: role, role, avatarSeed: role, source: "local", createdAt: now, updatedAt: now, hlc: "1:0:test" }).run(); return db.select().from(people).where(eq(people.id, id)).get() as PersonRow; }
function chat(a: PersonRow): TurnState { const conv = resolveOrCreateConversation(a, "chat", undefined, { temporary: false }); if (!conv.ok) throw new Error("no conversation"); const turnId = newConversationTurnId(); logTurn(a, "chat", "make video", { reply: { text: "ok" }, source: "plugin", plugin_id: "generate_video", routing: { tier: "tool", score: 1 }, safety: { flagged: false, categories: [], action: "allow", notify_parent: false, matched_signals: [], checked_at: new Date().toISOString() }, conversation_id: conv.value.id, turn_id: turnId }); return { actor: a, surface: "chat", turnId, conversationId: conv.value.id, temporary: false, planBasis: { surfaceClass: "written" }, context: [], utterance: "make video", persona: null, crisis: false } as unknown as TurnState; }
async function makeClip(a: PersonRow) { const state = chat(a); const made = await runGenerateVideo({ state, args: { prompt: "A tiny paper boat on water" }, callId: "make", spoken: false }); const id = (made.result?.data as { videoJobId: string }).videoJobId; await until(() => getVideoJobFor(a, id)?.state === "done"); return { job: getVideoJobFor(a, id)!, state: chat(a) }; }

describe("add music to a clip (AUDIO-PARITY-01 P2)", () => {
  test("make_music makes an instrumental the length of the clip first, then lays it under the video through the one media.edit path", async () => {
    fakeMusic = installFakeMusicStack();
    const a = actor(); const made = await makeClip(a);
    const result = await runEditVideo({ state: made.state, args: { clip: "latest", change: "mix", sound: "music", make_music: "warm lo-fi piano bed" }, callId: "bed", spoken: false });
    expect((result.result?.data as { musicJobId?: string }).musicJobId).toBeTruthy();
    expect(fakeEdit.jobs).toHaveLength(0);
    await until(() => fakeEdit.jobs.length === 1, 6000);
    expect(fakeMusic.submitted).toHaveLength(1);
    expect(fakeMusic.submitted[0]).toMatchObject({ task: "text2music", duration_s: 10 });
    const sent = fakeEdit.jobs[0]!;
    expect(sent.input.inputs).toHaveLength(2);
    expect(sent.input.ops).toEqual([{ op: "audio_overlay", input: 1, gain_db: -8, clip_gain_db: 0, start_s: 0, duck: false }]);
  });
  test("a failed music job leaves the video alone", async () => {
    fakeMusic = installFakeMusicStack(); fakeMusic.fail = { code: "failed", error: "no" };
    const a = actor(); const made = await makeClip(a);
    const result = await runEditVideo({ state: made.state, args: { clip: "latest", change: "mix", sound: "music", make_music: "warm lo-fi piano bed" }, callId: "bed", spoken: false });
    const id = (result.result?.data as { musicJobId: string }).musicJobId;
    await until(() => getMusicJobFor(a, id)?.state === "failed", 6000);
    await new Promise((r) => setTimeout(r, 200));
    expect(fakeEdit.jobs).toHaveLength(0);
  });
  test("a child never reaches the editor or the music maker", async () => {
    fakeMusic = installFakeMusicStack();
    const c = actor("child"); const state = chat(c);
    const out = await runEditVideo({ state, args: { clip: "latest", change: "mix", sound: "music", make_music: "warm lo-fi piano bed" }, callId: "bed", spoken: false });
    expect(out.result?.data).toHaveProperty("refused"); expect(fakeMusic.submitted).toHaveLength(0);
  });
});

describe("add-music route", () => {
  test("describing music starts the song first and answers with the chat; naming both or neither is refused", async () => {
    fakeMusic = installFakeMusicStack();
    const client = new TestClient(); await client.post("/api/auth/setup", { displayName: "Bed Owner", secret: "correcthorse" });
    const a = db.select().from(people).where(eq(people.displayName, "Bed Owner")).get() as PersonRow;
    const made = await makeClip(a);
    const ok = await client.post("/api/videos/add-music", { clip: made.job.files[0]!.id, make_music: "soft piano" });
    expect(ok.status).toBe(200);
    const body = await ok.json() as { conversation_id: string; music_job_id: string | null };
    expect(body.conversation_id).toBe(made.job.conversationId!); expect(body.music_job_id).toBeTruthy();
    expect((await client.post("/api/videos/add-music", { clip: made.job.id })).status).toBe(400);
    expect((await client.post("/api/videos/add-music", { clip: made.job.id, make_music: "soft piano", track: "x" })).status).toBe(400);
    await until(() => fakeEdit.jobs.length === 1, 6000);
  });
});

describe("add music survives a restart (MUSIC-ADDMUSIC-RESTART-01)", () => {
  test("a song that finishes while the waiting is gone still gets its mix when Home starts again, once", async () => {
    const { resumePendingMixes } = await import("@/lib/videos/editTool");
    __setMusicBedPollMsForTests(1_000_000); // the in-process waiter never fires: this is the state after a restart
    fakeMusic = installFakeMusicStack();
    const a = actor(); const made = await makeClip(a);
    const result = await runEditVideo({ state: made.state, args: { clip: "latest", change: "mix", sound: "music", make_music: "warm lo-fi piano bed" }, callId: "bed", spoken: false });
    const id = (result.result?.data as { musicJobId: string }).musicJobId;
    expect(getMusicJobFor(a, id)?.request.pendingMix).toBeTruthy();
    await until(() => getMusicJobFor(a, id)?.state === "done", 6000);
    expect(fakeEdit.jobs).toHaveLength(0);
    __setMusicBedPollMsForTests(20);
    resumePendingMixes();
    await until(() => fakeEdit.jobs.length === 1, 6000);
    expect(fakeEdit.jobs[0]!.input.inputs).toHaveLength(2);
    expect(getMusicJobFor(a, id)?.request.pendingMix).toBeUndefined();
    resumePendingMixes(); await new Promise((r) => setTimeout(r, 200));
    expect(fakeEdit.jobs).toHaveLength(1);
  });
  test("a failed song clears the waiting mix and starts nothing", async () => {
    const { resumePendingMixes } = await import("@/lib/videos/editTool");
    __setMusicBedPollMsForTests(1_000_000);
    fakeMusic = installFakeMusicStack(); fakeMusic.fail = { code: "failed", error: "no" };
    const a = actor(); const made = await makeClip(a);
    const result = await runEditVideo({ state: made.state, args: { clip: "latest", change: "mix", sound: "music", make_music: "warm lo-fi piano bed" }, callId: "bed", spoken: false });
    const id = (result.result?.data as { musicJobId: string }).musicJobId;
    await until(() => getMusicJobFor(a, id)?.state === "failed", 6000);
    __setMusicBedPollMsForTests(20);
    resumePendingMixes();
    await until(() => getMusicJobFor(a, id)?.request.pendingMix === undefined, 6000);
    await new Promise((r) => setTimeout(r, 200));
    expect(fakeEdit.jobs).toHaveLength(0);
  });
});
