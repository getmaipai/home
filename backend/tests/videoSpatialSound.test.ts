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
import { spatialOps } from "@/lib/videos/editPlan";
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
