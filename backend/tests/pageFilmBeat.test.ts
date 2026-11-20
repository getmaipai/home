// FILM-PAGE-01: "Music video to the beat" on the Film maker page: the finished film's clips go through the chat tool's cut_to_beat edit (clipEditStart),
// so the song checks, the lock checks and the beat grid are the ones the chat edit has. Fake video, edit and beat stacks; real route, run and production.
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
import { createFilmRun, updateFilmRun, getFilmRun } from "@/lib/films/store";
import { createMediaProduction, updateMediaProduction } from "@/lib/mediaProductions";
import { owner as signedInOwner } from "./support/testAuth";

let fakeVideo: ReturnType<typeof installFakeVideoStack>; let fakeEdit: FakeEditStack;
beforeEach(() => { resetDb(); fakeVideo = installFakeVideoStack(); fakeVideo.ltx25 = "ready"; __setVideoStatusForTests(readyVideoStatusForTests({ ltx25: "ready" })); __setAgeCheckRunnerForTests(async (images) => images.map(() => ({ ok: true as const, verdict: { people_count: 1, apparent_min_age_estimate: 99, label: "adult", is_nude_or_sexual: false, confidence: 0.99 } }))); __setKeyframesForTests(async () => [testJpeg(), testJpeg(), testJpeg()]); fakeEdit = installFakeEditStack(); });
afterEach(() => { fakeEdit.restore(); fakeVideo.restore(); __setVideoStatusForTests(undefined); __setKeyframesForTests(null); __setMusicFetchForTests(null); });
async function beatReady(ready = true) { const beat = { tempo_bpm: 120, meter: 4, beats: Array.from({ length: 80 }, (_, i) => i * 0.5), downbeats: [0, 2, 4, 6], sections: [], confidence: 0.9, downbeat_confidence: 0.8, duration_s: 40, engine: "librosa" }; __setMusicFetchForTests((async (req: string | URL | Request, init?: RequestInit) => { const path = new URL(typeof req === "string" ? req : req instanceof URL ? req.href : req.url).pathname; if (path === "/stack/v1/beats") return Response.json({ beats: { available: ready, state: ready ? "idle" : "not-installed", ready } }); if (path === "/v1/audio/beats" && init?.method === "POST") return Response.json({ job: "beat-job", data: beat }, { status: 200 }); if (path === "/v1/audio/beats/beat-job" && init?.method === "DELETE") return Response.json({}); return Response.json({ state: "done", data: beat }); }) as typeof fetch); }
async function makeClip(a: PersonRow) { const state = chat(a); const made = await runGenerateVideo({ state, args: { prompt: "A tiny paper boat on water" }, callId: "make", spoken: false }); const id = (made.result?.data as { videoJobId: string }).videoJobId; await until(() => getVideoJobFor(a, id)?.state === "done"); return { job: getVideoJobFor(a, id)!, state: chat(a) }; }
async function track(a: PersonRow, state: TurnState, adult = false) { const bytes = new Uint8Array(5000).fill(3); const file = createAttachment(a, { conversationId: state.conversationId!, turnId: state.turnId!, mediaType: "audio/mp4", bytes, provenance: adult ? '{"audience":"adult-only"}' : undefined, deduplicate: false }); if (!file.ok) throw new Error("track save failed"); const row = db.select().from(attachments).where(eq(attachments.id, file.value.id)).get()!; writeFileSync(attachmentFilePath(row.storagePath), bytes); return file.value.id; }
function chat(a: PersonRow): TurnState { const conv = resolveOrCreateConversation(a, "chat", undefined, { temporary: false }); if (!conv.ok) throw new Error("no conversation"); const turnId = newConversationTurnId(); logTurn(a, "chat", "make video", { reply: { text: "ok" }, source: "plugin", plugin_id: "generate_video", routing: { tier: "tool", score: 1 }, safety: { flagged: false, categories: [], action: "allow", notify_parent: false, matched_signals: [], checked_at: new Date().toISOString() }, conversation_id: conv.value.id, turn_id: turnId }); return { actor: a, surface: "chat", turnId, conversationId: conv.value.id, temporary: false, planBasis: { surfaceClass: "written" }, context: [], utterance: "make video", persona: null, crisis: false } as unknown as TurnState; }
function actor(role = "owner"): PersonRow { const now = new Date().toISOString(); const id = `person-beat${role}${++personN}`; db.insert(people).values({ id, displayName: role, role, avatarSeed: role, source: "local", createdAt: now, updatedAt: now, hlc: "1:0:test" }).run(); return db.select().from(people).where(eq(people.id, id)).get() as PersonRow; }
let personN = 0;

async function finishedFilm(a: PersonRow, clipFileIds: string[]) {
  const run = createFilmRun(a, { idea: "A crossing", goAhead: true });
  const production = createMediaProduction(a, { title: "Crossing", summary: "A crossing." }, "film");
  updateMediaProduction(a, production.id, { episodes: [{ id: "e", scenes: [{ id: "s", shots: clipFileIds.map((id, i) => ({ id: `shot${i}`, subject_ids: [], clip_file_id: id })) }] }] });
  const plan = { title: "Crossing", summary: "A crossing.", cast: [{ name: "Willow", kind: "character", locked: "Blue coat." }], shots: clipFileIds.map((_, i) => ({ id: `shot${i}`, subject_ids: [], framing: "wide", still: "Willow in a blue coat on a pier.", motion: "Walks.", seconds: 4 })), music: "Piano.", credits: [] };
  updateFilmRun(a, run.id, { plan: plan as never, production_id: production.id, state: "done", stage: "Assemble", film_file_id: clipFileIds[0] });
  return run.id;
}

describe("Film maker: music video to the beat", () => {
  test("no song gives a plain line and starts nothing; a song cuts the film's clips on its beat", async () => {
    await beatReady();
    const { client, row } = await signedInOwner();
    const one = await makeClip(row), two = await makeClip(row);
    const runId = await finishedFilm(row, [one.job.files[0]!.id, two.job.files[0]!.id]);
    const none = await client.post("/api/plugins/video/actions/film-beat", { run: runId, track: "latest" });
    expect(none.status).toBe(422);
    expect(((await none.json()) as { error: string }).error).toContain("song");
    expect(fakeEdit.jobs).toHaveLength(0);
    const song = await track(row, one.state);
    const cut = await client.post("/api/plugins/video/actions/film-beat", { run: runId, track: song });
    expect(cut.status).toBe(200);
    const { id } = await cut.json() as { id: string };
    await until(() => getVideoJobFor(row, id)?.state === "done");
    const trims = fakeEdit.jobs.filter((j) => j.input.ops[0]?.op === "trim");
    expect(trims.length).toBeGreaterThanOrEqual(2);
    expect(fakeEdit.jobs.at(-1)!.input.ops.map((op) => op.op)).toEqual(["concat", "mute", "audio_overlay"]);
    // A film that is not finished cannot be cut to a song.
    const waiting = createFilmRun(row, { idea: "Another", goAhead: false });
    updateFilmRun(row, waiting.id, { state: "waiting_for_go" });
    const early = await client.post("/api/plugins/video/actions/film-beat", { run: waiting.id, track: song });
    expect(early.status).toBe(422);
    expect(getFilmRun(row, runId)?.state).toBe("done");
  });
});
