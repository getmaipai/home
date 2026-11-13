// SPATIAL-04 (docs/design/spatial-sound-2026-11-06.md): `edit_video` change `spatial_sound` on the Stack's media.edit job, and the menu route behind
// SPATIAL-05. Real finished jobs made through the fake video Stack; the edit runs through lib/videos/stackEdit.ts against the fake edit Stack, which
// answers like the real one (files[] with the 5.1 sibling, the `spatial` notes, failure codes).
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { resetDb } from "./reset-db";
import { db } from "@/db";
import { attachments, people } from "@/db/schema";
import { fileAudience } from "@/lib/access";
import { newConversationTurnId } from "@/lib/id";
import { logTurn, resolveOrCreateConversation } from "@/lib/conversationHistory";
import { __setAgeCheckRunnerForTests } from "@/lib/pictures/ageCheck";
import { __setKeyframesForTests } from "@/lib/pictures/keyframes";
import { lockItemOfProvenance, withMark } from "@/lib/adultLock";
import { __resetAdultLockForTests } from "@/lib/adultLock";
import { getVideoJobFor, readVideoFile, type VideoJob } from "@/lib/videos/jobs";
import { EDIT_MINOR_LINE } from "@/lib/videos/editGate";
import { SPATIAL_NO_SOUND_LINE, runEditVideo } from "@/lib/videos/editTool";
import { spatialOps, spatialNote, SPATIAL_UNCHANGED_LINES } from "@/lib/videos/editPlan";
import { SPATIAL_FAILURE_COPY } from "@/lib/failureCopy";
import { __setVideoStatusForTests, readyVideoStatusForTests } from "@/lib/videos/ready";
import { __resetVideoAdapterCacheForTests } from "@/lib/videos/adapters";
import { runGenerateVideo } from "@/lib/videos/tool";
import { household, markAdultOnly } from "./fixtures/adultLock";
import { installFakeVideoStack, testJpeg, type FakeVideoStack } from "./videoFixture";
import { installFakeEditStack, type FakeEditStack } from "./videoEditStackFixture";
import { until } from "./pictureFixture";
import type { PersonRow } from "@/types";
import type { TurnState } from "@/lib/turnMachine/contract";

let video: FakeVideoStack;
let stack: FakeEditStack;
beforeEach(() => {
  resetDb(); __resetAdultLockForTests();
  __resetVideoAdapterCacheForTests();
  video = installFakeVideoStack();
  video.ltx25 = "ready";
  __setVideoStatusForTests(readyVideoStatusForTests({ ltx25: "ready" }));
  __setAgeCheckRunnerForTests(async (images) => images.map(() => ({ ok: true as const, verdict: { adult: false } as never })));
  __setKeyframesForTests(async () => [testJpeg(), testJpeg(), testJpeg()]);
  stack = installFakeEditStack();
});
afterEach(() => { stack.restore(); video.restore(); __setKeyframesForTests(null); __setVideoStatusForTests(undefined); });

function person(role: string, name = role): PersonRow {
  const now = new Date().toISOString();
  const id = `person-${name}xyz`;
  db.insert(people).values({ id, displayName: name, role, avatarSeed: name, source: "local", createdAt: now, updatedAt: now, hlc: "1:0:test" }).run();
  return db.select().from(people).where(eq(people.id, id)).get() as PersonRow;
}
function chatState(actor: PersonRow, conversationId?: string): TurnState {
  const conv = resolveOrCreateConversation(actor, "chat", conversationId, { temporary: false });
  if (!conv.ok) throw new Error("no conversation");
  const turnId = newConversationTurnId();
  logTurn(actor, "chat", "make a video", { reply: { text: "On its way." }, source: "plugin", plugin_id: "generate_video", routing: { tier: "tool", score: 1 }, safety: { flagged: false, categories: [], action: "allow", notify_parent: false, matched_signals: [], checked_at: new Date().toISOString() }, conversation_id: conv.value.id, turn_id: turnId });
  return { actor, surface: "chat", turnId, conversationId: conv.value.id, temporary: false, planBasis: { surfaceClass: "written" }, context: [], utterance: "make a video", persona: null, crisis: false } as unknown as TurnState;
}
async function makeClip(actor: PersonRow): Promise<{ job: VideoJob; state: TurnState }> {
  const state = chatState(actor);
  const outcome = await runGenerateVideo({ state, args: { prompt: "A paper boat floats down a rainy street, soft evening light" }, callId: "make", spoken: false });
  const id = (outcome.result?.data as { videoJobId?: string } | undefined)?.videoJobId;
  if (!id) throw new Error(`no job: ${outcome.result?.reply?.text ?? outcome.detail}`);
  await until(() => getVideoJobFor(actor, id)?.state === "done");
  return { job: getVideoJobFor(actor, id)!, state: chatState(actor, state.conversationId!) };
}
const edit = (state: TurnState, args: Record<string, unknown>) => runEditVideo({ state, args, callId: "edit", spoken: false });
const finished = async (actor: PersonRow, outcome: Awaited<ReturnType<typeof edit>>) => {
  const id = (outcome.result?.data as { videoJobId: string }).videoJobId;
  await until(() => ["done", "failed", "cancelled"].includes(getVideoJobFor(actor, id)?.state ?? ""));
  return getVideoJobFor(actor, id)!;
};
const attachmentOf = (id: string) => db.select().from(attachments).where(eq(attachments.id, id)).get()!;

describe("the plan", () => {
  test("the step is the Stack's spatial_sound op, with surround only when asked", () => {
    expect(spatialOps(false)).toEqual([{ op: "spatial_sound" }]);
    expect(spatialOps(true)).toEqual([{ op: "spatial_sound", surround: true }]);
  });

  test("SPATIAL-07: side is passed to the Stack op only when given", () => {
    expect(spatialOps(false, "left")).toEqual([{ op: "spatial_sound", side: "left" }]);
    expect(spatialOps(true, "right")).toEqual([{ op: "spatial_sound", surround: true, side: "right" }]);
  });

  test("SPATIAL-07: already_spatial has the Stack's line as a fallback, and the Stack's own note wins", () => {
    const line = "This clip's sound already moves with the picture, so it is unchanged.";
    expect(SPATIAL_UNCHANGED_LINES.already_spatial).toBe(line);
    expect(spatialNote({ applied: false, reason: "already_spatial", surround: false })).toBe(line);
    const effects = "Sound effects now come from the side of the picture where they happen. Wear headphones to hear it.";
    expect(spatialNote({ applied: true, reason: null, notes: [effects], surround: false })).toBe(effects);
  });
});

describe("SPATIAL-REACH: the card note reads clean", () => {
  const speech = "Sound now follows who is talking on screen. Wear headphones to hear it.";
  const effects = "Sound effects now come from the side of the picture where they happen. Wear headphones to hear it.";
  const five = "The 5.1 file plays on a surround system or an Apple TV. Other players play it as stereo.";
  const rear = "This clip's sound had little width, so the back speakers stay quiet.";
  test("moved sound first, with the headphones sentence once, then the 5.1 line, then the quiet-rear line", () => {
    expect(spatialNote({ applied: true, reason: null, notes: [speech, effects, five, rear], sources: ["speech", "walker"], surround: true }))
      .toBe("Sound now follows who is talking on screen. Sound effects now come from the side of the picture where they happen. Wear headphones to hear it. " + five + " " + rear);
    // Order does not depend on how the Stack listed them.
    expect(spatialNote({ applied: true, reason: null, notes: [rear, five, effects, speech], sources: ["speech", "vehicle"], surround: true }))
      .toBe("Sound now follows who is talking on screen. Sound effects now come from the side of the picture where they happen. Wear headphones to hear it. " + five + " " + rear);
  });
  test("a speech-only result drops the effects line, whatever the Stack listed", () => {
    expect(spatialNote({ applied: true, reason: null, notes: [speech, effects, five], sources: ["speech"], surround: true })).toBe(speech + " " + five);
  });
  test("an effects-only result keeps the effects line and says the headphones sentence once", () => {
    expect(spatialNote({ applied: true, reason: null, notes: [effects], sources: ["impact"], surround: false })).toBe(effects);
  });
  test("a Stack that sends no sources keeps its lines (older Stack), deduped and ordered", () => {
    expect(spatialNote({ applied: true, reason: null, notes: [speech, effects], surround: false })).toBe("Sound now follows who is talking on screen. Sound effects now come from the side of the picture where they happen. Wear headphones to hear it.");
  });
  test("an unchanged result still reads as before", () => {
    expect(spatialNote({ applied: false, reason: "centered", notes: ["The speaker stands in the middle of the picture, so the sound is unchanged stereo."], sources: [], surround: false })).toBe("The speaker stands in the middle of the picture, so the sound is unchanged stereo.");
  });
  test("the stored note of a real run carries the clean text, read from the Stack's spatial.sources", async () => {
    const owner = person("owner");
    const { state } = await makeClip(owner);
    stack.spatial = { applied: true, reason: null, note: speech, notes: [speech, effects, five, rear], sources: ["speech"], rear_quiet: true };
    const next = await finished(owner, await edit(state, { clip: "latest", change: "spatial_sound", surround: true }));
    expect(next.request.edit?.note).toBe(speech + " " + five + " " + rear);
    stack.spatial = { applied: true, reason: null, note: speech, notes: [speech, effects, five, rear], sources: ["speech", "side"], rear_quiet: true };
    const again = await finished(owner, await edit(state, { clip: "latest", change: "spatial_sound", surround: true }));
    expect(again.request.edit?.note).toBe("Sound now follows who is talking on screen. Sound effects now come from the side of the picture where they happen. Wear headphones to hear it. " + five + " " + rear);
  });
});

describe("edit_video spatial_sound", () => {
  test("stereo: one op goes to the Stack, the result is a new linked clip with the Stack's line as its note, and the old clip is kept", async () => {
    const owner = person("owner");
    const { job, state } = await makeClip(owner);
    expect(job.files[0]!.audio).toBe(true);
    const outcome = await edit(state, { clip: "latest", change: "spatial_sound" });
    expect(outcome.status).toBe("succeeded");
    expect(outcome.result?.data).toHaveProperty("videoJobId");
    const next = await finished(owner, outcome);
    expect(next.state).toBe("done");
    expect(next.files).toHaveLength(1);
    expect(next.request.edit).toEqual({ from: job.id, change: "spatial_sound", note: "Sound now follows who is talking on screen. Wear headphones to hear it." });
    const sent = stack.jobs.at(-1)!;
    expect(sent.input.ops).toEqual([{ op: "spatial_sound" }]);
    expect(sent.input.output.name).toEndWith(".mp4");
    expect(getVideoJobFor(owner, job.id)?.state).toBe("done");
  });

  test("surround: the 5.1 file is a second entry of the clip with its own attachment, readable and marked like the stereo clip", async () => {
    const owner = person("owner");
    const { state } = await makeClip(owner);
    stack.spatial = { applied: true, reason: null, note: "The 5.1 file plays on a surround system or an Apple TV. Other players play it as stereo.", notes: ["Sound now follows who is talking on screen. Wear headphones to hear it.", "The 5.1 file plays on a surround system or an Apple TV. Other players play it as stereo."] };
    const next = await finished(owner, await edit(state, { clip: "latest", change: "spatial_sound", surround: true }));
    expect(next.state).toBe("done");
    expect(stack.jobs.at(-1)!.input.ops).toEqual([{ op: "spatial_sound", surround: true }]);
    expect(next.files).toHaveLength(2);
    const [stereo, surround] = next.files as [typeof next.files[number], typeof next.files[number]];
    expect(surround.role).toBe("surround_5_1");
    expect(surround.id).not.toBe(stereo.id);
    expect(surround.poster_id).toBe(stereo.poster_id);
    expect(next.request.edit?.note).toContain("Sound now follows");
    expect(next.request.edit?.note).toContain("5.1 file plays");
    // Both are the person's own Library files with the same flags.
    const rows = [attachmentOf(stereo.id), attachmentOf(surround.id)];
    expect(rows[0]!.ownerPersonId).toBe(owner.id);
    expect(rows[1]!.ownerPersonId).toBe(owner.id);
    expect(lockItemOfProvenance(owner.id, rows[1]!.provenance)).toEqual(lockItemOfProvenance(owner.id, rows[0]!.provenance));
    expect(fileAudience(rows[1]!.provenance)).toBe(fileAudience(rows[0]!.provenance));
    // The 5.1 file is reachable by the same reader as the stereo clip, and the stereo clip stays files[0].
    expect(readVideoFile(owner, next, surround.id)?.bytes.byteLength).toBeGreaterThan(1024);
    expect(readVideoFile(owner, next, stereo.id)?.bytes[100]).not.toBe(0x35);
    expect(readVideoFile(owner, next, surround.id)?.bytes[100]).toBe(0x35);
  });

  test("the 5.1 file answers like the stereo clip on the file route: the owner gets it, another adult and a locked clip get nothing", async () => {
    const { owner, adult, other, row } = await household();
    const me = row("Marlow");
    const state = chatState(me);
    const made = await runGenerateVideo({ state, args: { prompt: "A paper boat floats down a rainy street, soft evening light" }, callId: "make", spoken: false });
    const id = (made.result?.data as { videoJobId: string }).videoJobId;
    await until(() => getVideoJobFor(me, id)?.state === "done");
    const next = await finished(me, await edit(chatState(me, state.conversationId!), { clip: "latest", change: "spatial_sound", surround: true }));
    const sibling = next.files[1]!.id;
    expect((await adult.client.get(`/api/videos/jobs/${next.id}/files/${sibling}`)).status).toBe(200);
    expect((await other.client.get(`/api/videos/jobs/${next.id}/files/${sibling}`)).status).toBe(404);
    expect((await owner.get(`/api/videos/jobs/${next.id}/files/${sibling}`)).status).toBe(404);
    // Lock it: the sibling answers exactly like the stereo clip.
    markAdultOnly(next.id);
    const stereoStatus = (await adult.client.get(`/api/videos/jobs/${next.id}/files/${next.files[0]!.id}`)).status;
    const siblingStatus = (await adult.client.get(`/api/videos/jobs/${next.id}/files/${sibling}`)).status;
    expect(siblingStatus).toBe(stereoStatus);
    expect(siblingStatus).toBe(404);
  });

  test("an adult-only source gives an adult-only stereo clip and an adult-only 5.1 file (the flags of the source, never lower)", async () => {
    const owner = person("owner");
    const { job, state } = await makeClip(owner);
    for (const file of [job.files[0]!.id, job.files[0]!.poster_id]) {
      const row = attachmentOf(file);
      db.update(attachments).set({ provenance: withMark(row.provenance, { lock: "off", raiseToAdult: true })! }).where(eq(attachments.id, file)).run();
    }
    const outcome = await edit(state, { clip: "latest", change: "spatial_sound", surround: true });
    const started = getVideoJobFor(owner, (outcome.result?.data as { videoJobId: string }).videoJobId)!;
    expect(started.request).toMatchObject({ adultOnly: true, adultLock: "off" });
    const next = await finished(owner, outcome);
    expect(next.state).toBe("done");
    expect(next.files).toHaveLength(2);
    for (const file of next.files) {
      const item = lockItemOfProvenance(owner.id, attachmentOf(file.id).provenance)!;
      expect({ madeAudience: item.madeAudience, lock: item.lock }).toEqual({ madeAudience: "adult-only", lock: "off" });
    }
  });

  test("unchanged stereo is a success: the clip is made, the Stack's reason line shows, and no 5.1 file is invented", async () => {
    const owner = person("owner");
    const { state } = await makeClip(owner);
    stack.spatial = { applied: false, reason: "no_person", note: "Nobody was found on screen, so the sound is unchanged.", notes: ["Nobody was found on screen, so the sound is unchanged."] };
    const next = await finished(owner, await edit(state, { clip: "latest", change: "spatial_sound" }));
    expect(next.state).toBe("done");
    expect(next.files).toHaveLength(1);
    expect(next.request.edit?.note).toBe("Nobody was found on screen, so the sound is unchanged.");
  });

  test("the card item carries the note as a plain line", async () => {
    const { adult, row } = await household();
    const me = row("Marlow");
    const state = chatState(me);
    const made = await runGenerateVideo({ state, args: { prompt: "A paper boat floats down a rainy street, soft evening light" }, callId: "make", spoken: false });
    await until(() => getVideoJobFor(me, (made.result?.data as { videoJobId: string }).videoJobId)?.state === "done");
    stack.spatial = { applied: false, reason: "centered", note: "The speaker stands in the middle, so the sound is unchanged.", notes: ["The speaker stands in the middle, so the sound is unchanged."] };
    const next = await finished(me, await edit(chatState(me, state.conversationId!), { clip: "latest", change: "spatial_sound" }));
    const card = (await (await adult.client.get(`/api/videos/jobs/${next.id}`)).json()) as { items: Array<{ id: string; note: string | null }> };
    expect(card.items.find((item) => item.id === next.id)?.note).toBe("The speaker stands in the middle, so the sound is unchanged.");
  });

  test("a clip with no sound returns the plain line and the Stack is never called", async () => {
    const owner = person("owner");
    const { job, state } = await makeClip(owner);
    job.files[0]!.audio = false;
    const { videoJobs } = await import("@/db/schema");
    db.update(videoJobs).set({ files: JSON.stringify(job.files) }).where(eq(videoJobs.id, job.id)).run();
    const outcome = await edit(state, { clip: "latest", change: "spatial_sound" });
    expect(outcome.result?.data).toEqual({ refused: "no_audio" });
    expect(outcome.result?.reply?.text).toContain(SPATIAL_NO_SOUND_LINE);
    expect(stack.jobs).toHaveLength(0);
  });

  test("each failure code reads as its own plain line, never the engine's raw text", async () => {
    const owner = person("owner");
    const { state } = await makeClip(owner);
    for (const code of Object.keys(SPATIAL_FAILURE_COPY)) {
      stack.failWith = "raw /private/var/folders/x text"; stack.failureCode = code;
      const next = await finished(owner, await edit(chatState(owner, state.conversationId!), { clip: "latest", change: "spatial_sound" }));
      expect(next.state).toBe("failed");
      expect(next.error).toContain(SPATIAL_FAILURE_COPY[code as keyof typeof SPATIAL_FAILURE_COPY]);
      expect(next.error).not.toContain("/private");
    }
  });

  test("SPATIAL-07: side reaches the Stack, the Stack's effects line is kept as the note, and already_spatial reads plain", async () => {
    const owner = person("owner");
    const { state } = await makeClip(owner);
    const effects = "Sound effects now come from the side of the picture where they happen. Wear headphones to hear it.";
    stack.spatial = { applied: true, reason: null, note: effects, notes: [effects] };
    const next = await finished(owner, await edit(state, { clip: "latest", change: "spatial_sound", side: "left" }));
    expect(stack.jobs.at(-1)!.input.ops).toEqual([{ op: "spatial_sound", side: "left" }]);
    expect(next.request.edit?.note).toBe(effects);
    stack.spatial = { applied: false, reason: "already_spatial", note: null, notes: [] };
    const again = await finished(owner, await edit(chatState(owner, state.conversationId!), { clip: "latest", change: "spatial_sound" }));
    expect(again.request.edit?.note).toBe("This clip's sound already moves with the picture, so it is unchanged.");
  });

  test("SPATIAL-07: side takes only left or right, and only with spatial sound", async () => {
    const owner = person("owner");
    const { state } = await makeClip(owner);
    expect((await edit(state, { clip: "latest", change: "spatial_sound", side: "middle" })).status).toBe("failed");
    expect((await edit(state, { clip: "latest", change: "trim", from_s: 0, to_s: 1, side: "left" })).status).toBe("failed");
    expect(stack.jobs).toHaveLength(0);
  });

  test("a child and a teen get the edit line from the chat tool, and no job starts", async () => {
    for (const role of ["child", "teen"]) {
      const minor = person(role, `${role}spatial`);
      const out = await edit(chatState(minor), { clip: "latest", change: "spatial_sound" });
      expect(out.result?.data).toHaveProperty("refused");
      expect(out.result?.reply?.text).toContain(EDIT_MINOR_LINE);
    }
    expect(stack.jobs).toHaveLength(0);
  });

  test("the offered change list and the arguments stay additive: nothing else is accepted with it", async () => {
    const owner = person("owner");
    const { state } = await makeClip(owner);
    const out = await edit(state, { clip: "latest", change: "spatial_sound", from_s: 2 });
    expect(out.status).toBe("failed");
  });
});

describe("the menu route", () => {
  async function adultWithClip() {
    const fixture = await household();
    const me = fixture.row("Marlow");
    const state = chatState(me);
    const made = await runGenerateVideo({ state, args: { prompt: "A paper boat floats down a rainy street, soft evening light" }, callId: "make", spoken: false });
    const id = (made.result?.data as { videoJobId: string }).videoJobId;
    await until(() => getVideoJobFor(me, id)?.state === "done");
    return { ...fixture, me, jobId: id, state };
  }

  test("an adult starts it from the menu and gets the card with the new clip; with surround the 5.1 file is made", async () => {
    const { adult, me, jobId } = await adultWithClip();
    const res = await adult.client.post(`/api/videos/jobs/${jobId}/spatial-sound`, { surround: true });
    expect(res.status).toBe(200);
    const card = (await res.json()) as { items: Array<{ id: string; kind: string }> };
    const edited = card.items.find((item) => item.kind === "edit")!;
    await until(() => getVideoJobFor(me, edited.id)?.state === "done");
    expect(getVideoJobFor(me, edited.id)!.files).toHaveLength(2);
    expect(stack.jobs.at(-1)!.input.ops).toEqual([{ op: "spatial_sound", surround: true }]);
  });

  test("SPATIAL-07: the menu route passes side on; a bad side is refused", async () => {
    const { adult, me, jobId } = await adultWithClip();
    const res = await adult.client.post(`/api/videos/jobs/${jobId}/spatial-sound`, { side: "right" });
    expect(res.status).toBe(200);
    const edited = ((await res.json()) as { items: Array<{ id: string; kind: string }> }).items.find((item) => item.kind === "edit")!;
    await until(() => getVideoJobFor(me, edited.id)?.state === "done");
    expect(stack.jobs.at(-1)!.input.ops).toEqual([{ op: "spatial_sound", side: "right" }]);
    expect((await adult.client.post(`/api/videos/jobs/${jobId}/spatial-sound`, { side: "up" })).status).toBe(400);
  });

  test("a clip with no sound is refused with the plain line", async () => {
    const { adult, me, jobId } = await adultWithClip();
    const job = getVideoJobFor(me, jobId)!;
    const { videoJobs } = await import("@/db/schema");
    db.update(videoJobs).set({ files: JSON.stringify(job.files.map((file) => ({ ...file, audio: false }))) }).where(eq(videoJobs.id, jobId)).run();
    const res = await adult.client.post(`/api/videos/jobs/${jobId}/spatial-sound`, {});
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toBe(SPATIAL_NO_SOUND_LINE);
    expect(stack.jobs).toHaveLength(0);
  });

  test("another person's clip is not found", async () => {
    const { other, jobId } = await adultWithClip();
    expect((await other.client.post(`/api/videos/jobs/${jobId}/spatial-sound`, {})).status).toBe(404);
    expect(stack.jobs).toHaveLength(0);
  });
});

describe("SPATIAL-REACH: the Create page action", () => {
  const ACTION = "/api/plugins/video/actions/spatial-sound";
  async function createClip() {
    const fixture = await household();
    const me = fixture.row("Marlow");
    const made = await runGenerateVideo({ state: chatState(me), args: { prompt: "A paper boat floats down a rainy street, soft evening light" }, callId: "make", spoken: false });
    const id = (made.result?.data as { videoJobId: string }).videoJobId;
    await until(() => getVideoJobFor(me, id)?.state === "done");
    // A clip made on the Create page has no chat behind it.
    const { videoJobs } = await import("@/db/schema");
    db.update(videoJobs).set({ conversationId: null }).where(eq(videoJobs.id, id)).run();
    return { ...fixture, me, jobId: id };
  }
  const feed = async (client: { post: (path: string, body: unknown) => Promise<Response> }) => (await (await client.post("/api/plugins/video/data/recipes", { scope: "feed" })).json()) as Array<{ id: string; status: string }>;

  test("the Create feed offers Spatial sound and Spatial sound with 5.1 file beside its other actions, within the kit's eight", async () => {
    const { readFileSync } = await import("node:fs");
    const page = JSON.parse(readFileSync(new URL("../packages/video/pages/create.json", import.meta.url), "utf8")) as unknown;
    const found: Array<{ label: string; starts?: string; action: { call?: { target: string; args: Record<string, unknown> } } }> = [];
    const walk = (node: unknown): void => { if (Array.isArray(node)) node.forEach(walk); else if (node && typeof node === "object") { const record = node as Record<string, unknown>; if (record.type === "result_feed") { const actions = record.actions as typeof found; expect(actions.length).toBeLessThanOrEqual(8); found.push(...actions); } Object.values(record).forEach(walk); } };
    walk(page);
    const entry = found.find((a) => a.label === "Spatial sound")!;
    expect(entry.action.call!.target).toBe(ACTION);
    expect(entry.starts).toBe("video");
    expect(entry.action.call!.args).toEqual({ id: "{id}" });
    const surround = found.find((a) => a.label === "Spatial sound with 5.1 file")!;
    expect(surround.action.call!.target).toBe(ACTION);
    expect(surround.starts).toBe("video");
    expect(surround.action.call!.args).toEqual({ id: "{id}", surround: true });
  });

  test("the Studio's export card offers it too, and then opens the Create page where the new clip shows", async () => {
    const { readFileSync } = await import("node:fs");
    const page = JSON.parse(readFileSync(new URL("../packages/video/pages/studio.json", import.meta.url), "utf8")) as unknown;
    const found: Array<{ label: string; action: { call?: { target: string; args?: Record<string, unknown>; then?: { navigate: { to: string } } } } }> = [];
    const walk = (node: unknown): void => { if (Array.isArray(node)) node.forEach(walk); else if (node && typeof node === "object") { const record = node as Record<string, unknown>; if (record.export_result) found.push(...((record.export_result as { actions: typeof found }).actions)); Object.values(record).forEach(walk); } };
    walk(page);
    expect(found.length).toBeLessThanOrEqual(3);
    const entry = found.find((a) => a.label === "Spatial sound")!;
    expect(entry.action.call!.target).toBe(ACTION);
    expect(entry.action.call!.then).toEqual({ navigate: { to: "/apps/video/create" } });
    const surround = found.find((a) => a.label === "Spatial sound with 5.1 file")!;
    expect(surround.action.call!.target).toBe(ACTION);
    expect(surround.action.call!.args).toEqual({ id: "{id}", surround: true });
    expect(surround.action.call!.then).toEqual({ navigate: { to: "/apps/video/create" } });
  });

  test("an adult starts it on a Create clip; the new clip is a row of the same feed, and surround makes the 5.1 file", async () => {
    const { adult, me, jobId } = await createClip();
    const res = await adult.client.post(ACTION, { id: jobId, surround: true });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; id: string };
    expect(body.ok).toBe(true);
    expect(body.id).not.toBe(jobId);
    await until(() => getVideoJobFor(me, body.id)?.state === "done");
    expect(getVideoJobFor(me, body.id)!.files).toHaveLength(2);
    expect((await feed(adult.client)).map((row) => row.id)).toContain(body.id);
    expect(stack.jobs.at(-1)!.input.ops).toEqual([{ op: "spatial_sound", surround: true }]);
  });

  test("a clip with no sound, someone else's clip and a made-up id each get the plain line and start nothing", async () => {
    const { adult, other, me, jobId } = await createClip();
    expect((await other.client.post(ACTION, { id: jobId })).status).toBe(404);
    expect((await adult.client.post(ACTION, { id: "nope" })).status).toBe(404);
    const job = getVideoJobFor(me, jobId)!;
    const { videoJobs } = await import("@/db/schema");
    db.update(videoJobs).set({ files: JSON.stringify(job.files.map((file) => ({ ...file, audio: false }))) }).where(eq(videoJobs.id, jobId)).run();
    const res = await adult.client.post(ACTION, { id: jobId });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toBe(SPATIAL_NO_SOUND_LINE);
    expect(stack.jobs).toHaveLength(0);
  });

  test("a teen and a child never start it; the edit line is the gate's, no job starts", async () => {
    const { teen, child, jobId } = await createClip();
    for (const minor of [teen, child]) {
      const res = await minor.client.post(ACTION, { id: jobId });
      expect([404, 422]).toContain(res.status);
      if (res.status === 422) expect(await res.json()).toEqual({ error: EDIT_MINOR_LINE, code: "minor" });
    }
    expect(stack.jobs).toHaveLength(0);
  });
});

describe("the minor line from the menu", () => {
  test("a teen and a child get EDIT_MINOR_LINE from the route, for any clip, and no job starts", async () => {
    const { teen, child, me } = await household().then(async (fixture) => ({ ...fixture, me: fixture.row("Marlow") }));
    const state = chatState(me);
    const made = await runGenerateVideo({ state, args: { prompt: "A paper boat floats down a rainy street, soft evening light" }, callId: "make", spoken: false });
    const id = (made.result?.data as { videoJobId: string }).videoJobId;
    await until(() => getVideoJobFor(me, id)?.state === "done");
    for (const minor of [teen, child]) {
      for (const clip of [id, "no-such-clip"]) {
        const res = await minor.client.post(`/api/videos/jobs/${clip}/spatial-sound`, {});
        expect(res.status).toBe(422);
        expect(await res.json()).toEqual({ error: EDIT_MINOR_LINE, code: "minor" });
      }
    }
    expect(stack.jobs).toHaveLength(0);
  });
});

describe("PHOSPHENE-PARITY-01: Make it vertical and Sharpen 2x on the Create page", () => {
  async function createClip() {
    const fixture = await household();
    const me = fixture.row("Marlow");
    const made = await runGenerateVideo({ state: chatState(me), args: { prompt: "A paper boat floats down a rainy street, soft evening light" }, callId: "make", spoken: false });
    const id = (made.result?.data as { videoJobId: string }).videoJobId;
    await until(() => getVideoJobFor(me, id)?.state === "done");
    const { videoJobs } = await import("@/db/schema");
    db.update(videoJobs).set({ conversationId: null }).where(eq(videoJobs.id, id)).run();
    return { ...fixture, me, jobId: id };
  }

  test("the feed offers Make it vertical and the Studio export offers Sharpen 2x, within their caps", async () => {
    const { readFileSync } = await import("node:fs");
    const create = JSON.parse(readFileSync(new URL("../packages/video/pages/create.json", import.meta.url), "utf8")) as unknown;
    const labels: string[] = [];
    const walk = (node: unknown): void => { if (Array.isArray(node)) node.forEach(walk); else if (node && typeof node === "object") { const r = node as Record<string, unknown>; if (r.type === "result_feed") labels.push(...(r.actions as Array<{ label: string }>).map((a) => a.label)); Object.values(r).forEach(walk); } };
    walk(create);
    expect(labels).toContain("Make it vertical");
    expect(labels.length).toBeLessThanOrEqual(8);
  });

  test("an adult reshapes a clip: the Stack gets a blurred 9:16 reframe, and a bad shape is refused", async () => {
    const { adult, me, jobId } = await createClip();
    expect((await adult.client.post("/api/plugins/video/actions/reshape", { id: jobId, shape: "tall" })).status).toBe(400);
    const res = await adult.client.post("/api/plugins/video/actions/reshape", { id: jobId, shape: "vertical" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string };
    await until(() => getVideoJobFor(me, body.id)?.state === "done");
    expect(stack.jobs.at(-1)!.input.ops).toEqual([{ op: "reframe", aspect: "9:16", fill: "blur" }]);
  });

  test("an adult sharpens a clip, someone else's clip is not found, and a child is refused", async () => {
    const { adult, other, me, jobId } = await createClip();
    expect((await other.client.post("/api/plugins/video/actions/sharpen", { id: jobId })).status).toBe(404);
    const res = await adult.client.post("/api/plugins/video/actions/sharpen", { id: jobId });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string };
    await until(() => getVideoJobFor(me, body.id)?.state === "done");
    expect(stack.jobs.at(-1)!.input.ops).toEqual([{ op: "upscale", factor: 2 }]);
  });
});
